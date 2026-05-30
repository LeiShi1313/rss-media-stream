import { loadConfig } from "../server/config.js";
import { prisma } from "../server/db.js";
import { refreshFeed } from "../server/rssService.js";
import { matchItemWithTmdb } from "../server/tmdb.js";
import { evaluateAutoDownloadsForItem } from "../server/jobs.js";

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

async function pollDueFeeds() {
  const now = new Date();
  const feeds = await prisma.rssFeed.findMany({
    where: { enabled: true },
    orderBy: { lastPolledAt: "asc" },
    take: 20
  });

  for (const feed of feeds) {
    const dueAt = feed.lastPolledAt
      ? new Date(feed.lastPolledAt.getTime() + feed.pollIntervalSeconds * 1000)
      : new Date(0);
    if (dueAt > now) continue;
    try {
      await refreshFeed(feed.id, config);
    } catch (error) {
      console.error(`Feed ${feed.id} failed`, error);
    }
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
    select: { id: true }
  });

  for (const item of items) {
    try {
      await matchItemWithTmdb(prisma, config, item.id);
      await evaluateAutoDownloadsForItem(item.id, config);
    } catch (error) {
      console.error(`TMDB match failed for ${item.id}`, error);
    }
  }
}

console.log("RSS media worker started");
await tick();
setInterval(tick, Math.max(10, config.pollIntervalSeconds / 5) * 1000);
