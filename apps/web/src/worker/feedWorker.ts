import { redactSecrets } from "@rss-media/shared/redact";
import type { AppConfig } from "../server/config.js";
import { prisma } from "../server/db.js";
import { refreshFeed } from "../server/modules/feeds/feeds.service.js";

export async function pollDueFeeds(config: AppConfig) {
  const now = new Date();
  const feeds = await prisma.rssFeed.findMany({
    where: {
      enabled: true,
      deletedAt: null,
      encryptedUrl: { not: null },
      OR: [
        { nextAttemptAt: null },
        { nextAttemptAt: { lte: now } }
      ]
    },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: 20,
    select: {
      id: true,
      tenantId: true
    }
  });

  for (const feed of feeds) {
    try {
      await refreshFeed(feed.id, { tenantId: feed.tenantId, actor: "worker" }, { config });
    } catch (error) {
      const message = redactSecrets(
        error instanceof Error ? error.message : String(error)
      );
      console.error(`Feed ${feed.id} failed`, message);
    }
  }
}
