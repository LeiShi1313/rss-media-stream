import { redactSecrets } from "@rss-media/shared/redact";
import { loadConfig } from "../server/config.js";
import { prisma } from "../server/db.js";
import { tenantHasTmdbCredential } from "../server/tmdb.js";
import { matchItemWithExternalMedia } from "../server/modules/media/media.service.js";
import { evaluateAutoDownloadsForItem } from "../server/modules/subscriptions/subscriptions.service.js";
import { pollDueFeeds } from "./feedWorker.js";

const config = loadConfig();
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    await pollDueFeeds();
    await enrichRecentUnmatchedItems();
  } catch (error) {
    console.error(error);
  } finally {
    running = false;
  }
}

async function enrichRecentUnmatchedItems() {
  const tenantIds = await tmdbEnabledTenantIds();
  if (tenantIds.length === 0) return;

  const items = await prisma.rssItem.findMany({
    where: {
      parseStatus: "PARSED",
      mediaMatch: null,
      tenantId: { in: tenantIds }
    },
    orderBy: { firstSeenAt: "desc" },
    take: 50,
    select: { id: true, tenantId: true }
  });

  for (const item of items) {
    try {
      if (!(await tenantHasTmdbCredential(config, item.tenantId))) continue;
      await matchItemWithExternalMedia({
        tenantId: item.tenantId,
        itemId: item.id,
        config
      });
      await evaluateAutoDownloadsForItem({
        tenantId: item.tenantId,
        itemId: item.id,
        config
      });
    } catch (error) {
      const message = redactSecrets(
        error instanceof Error ? error.message : String(error)
      );
      console.error(`TMDB match failed for ${item.id}`, message);
    }
  }
}

async function tmdbEnabledTenantIds() {
  if (config.tmdbApiKey) {
    const tenants = await prisma.tenant.findMany({ select: { id: true } });
    return tenants.map((tenant) => tenant.id);
  }

  const settings = await prisma.tenantSettings.findMany({
    where: { encryptedTmdbApiKey: { not: null } },
    select: { tenantId: true }
  });
  return settings.map((setting) => setting.tenantId);
}

console.log("RSS media worker started");
await tick();
setInterval(tick, Math.max(10, config.pollIntervalSeconds / 5) * 1000);
