import { redactSecrets } from "@rss-media/shared/redact";
import { prisma } from "../server/db.js";
import { refreshFeed } from "../server/modules/feeds/feeds.service.js";

export async function pollDueFeeds() {
  const now = new Date();
  const feeds = await prisma.rssFeed.findMany({
    where: { enabled: true },
    orderBy: [{ lastPolledAt: "asc" }, { createdAt: "asc" }],
    take: 20,
    select: {
      id: true,
      tenantId: true,
      pollIntervalSeconds: true,
      lastPolledAt: true
    }
  });

  for (const feed of feeds) {
    const dueAt = feed.lastPolledAt
      ? new Date(feed.lastPolledAt.getTime() + feed.pollIntervalSeconds * 1000)
      : new Date(0);
    if (dueAt > now) continue;

    try {
      await refreshFeed(feed.id, { tenantId: feed.tenantId, actor: "worker" });
    } catch (error) {
      const message = redactSecrets(
        error instanceof Error ? error.message : String(error)
      );
      await prisma.rssFeed.update({
        where: { id_tenantId: { id: feed.id, tenantId: feed.tenantId } },
        data: { lastError: message }
      });
      console.error(`Feed ${feed.id} failed`, message);
    }
  }
}
