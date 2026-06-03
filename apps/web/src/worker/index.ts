import { redactSecrets } from "@rss-media/shared/redact";
import { loadConfig } from "../server/config.js";
import { prisma } from "../server/db.js";
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
  if (!config.tmdbApiKey) return;
  const items = await prisma.rssItem.findMany({
    where: {
      parseStatus: "PARSED",
      mediaMatch: null
    },
    orderBy: { firstSeenAt: "desc" },
    take: 50,
    select: { id: true, tenantId: true }
  });

  for (const item of items) {
    try {
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

console.log("RSS media worker started");
await tick();
setInterval(tick, Math.max(10, config.pollIntervalSeconds / 5) * 1000);
