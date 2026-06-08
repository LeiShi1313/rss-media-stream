import { redactSecrets } from "@rss-media/shared/redact";
import { loadConfig } from "../server/config.js";
import { prisma } from "../server/db.js";
import { matchParsedReleaseForItem } from "../server/modules/media/media.service.js";
import { evaluateAutoDownloadsForItem } from "../server/modules/subscriptions/subscriptions.service.js";
import { pollDueFeeds } from "./feedWorker.js";

const config = loadConfig();
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    await pollDueFeeds(config);
    await enrichRecentUnmatchedItems();
  } catch (error) {
    console.error(error);
  } finally {
    running = false;
  }
}

async function enrichRecentUnmatchedItems() {
  const items = await prisma.rssItem.findMany({
    where: {
      parseStatus: "PARSED",
      parsedRelease: {
        is: {
          matches: {
            none: {
              status: { in: ["MATCHED", "UNMATCHED"] },
              invalidatedAt: null
            }
          }
        }
      }
    },
    orderBy: { firstSeenAt: "desc" },
    take: 50,
    select: { id: true, tenantId: true }
  });

  for (const item of items) {
    try {
      const match = await matchParsedReleaseForItem({
        tenantId: item.tenantId,
        itemId: item.id,
        config
      });
      if (match.status === "MATCHED") {
        await evaluateAutoDownloadsForItem({
          tenantId: item.tenantId,
          itemId: item.id,
          config
        });
      }
    } catch (error) {
      const message = redactSecrets(
        error instanceof Error ? error.message : String(error)
      );
      console.error(`Media match failed for ${item.id}`, message);
    }
  }
}

console.log("RSS media worker started");
await tick();
setInterval(tick, Math.max(10, config.pollIntervalSeconds / 5) * 1000);
