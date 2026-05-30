import { createHash } from "node:crypto";
import Parser from "rss-parser";
import type { Prisma } from "@prisma/client";
import { redactSecrets } from "@rss-media/shared/redact";
import { parseReleaseTitle } from "@rss-media/shared/releaseParser";
import type { AppConfig } from "./config.js";
import { prisma } from "./db.js";
import { decryptSecret, encryptSecret } from "./secrets.js";
import { publishEvent } from "./events.js";

type FeedItem = {
  title?: string;
  link?: string;
  guid?: string;
  isoDate?: string;
  pubDate?: string;
  content?: string;
  contentSnippet?: string;
  enclosure?: {
    url?: string;
    length?: string;
    type?: string;
  };
};

const parser = new Parser<object, FeedItem>({
  customFields: {
    item: [
      ["torrent:contentLength", "torrentContentLength"],
      ["torrent:infoHash", "torrentInfoHash"],
      ["category", "category"]
    ]
  }
});

export async function refreshFeed(feedId: string, config: AppConfig) {
  const feed = await prisma.rssFeed.findUnique({ where: { id: feedId } });
  if (!feed || !feed.enabled) return { created: 0, updated: 0 };

  try {
    const url = decryptSecret(feed.encryptedUrl, config.appSecret);
    const parsed = await parser.parseURL(url);
    let created = 0;
    let updated = 0;

    for (const rssItem of parsed.items ?? []) {
      const torrentUrl = extractTorrentUrl(rssItem);
      const rawTitle = rssItem.title?.trim() || rssItem.guid || torrentUrl;
      if (!torrentUrl || !rawTitle) continue;

      const release = parseReleaseTitle(rawTitle);
      const linkHash = hashStable(`${rssItem.guid ?? ""}|${torrentUrl}`);
      const existing = await prisma.rssItem.findUnique({
        where: { feedId_linkHash: { feedId: feed.id, linkHash } },
        select: { id: true }
      });

      await prisma.rssItem.upsert({
        where: { feedId_linkHash: { feedId: feed.id, linkHash } },
        create: {
          feedId: feed.id,
          guid: rssItem.guid,
          linkHash,
          rawTitle,
          encryptedTorrentUrl: encryptSecret(torrentUrl, config.appSecret),
          publishDate: parseDate(rssItem.isoDate ?? rssItem.pubDate),
          sizeBytes: parseSize(rssItem.enclosure?.length),
          rawJson: stripUndefined(rssItem),
          parseStatus: "PARSED",
          parseConfidence: release.confidence,
          parsedRelease: {
            create: parsedReleaseData(release)
          }
        },
        update: {
          rawTitle,
          publishDate: parseDate(rssItem.isoDate ?? rssItem.pubDate),
          rawJson: stripUndefined(rssItem),
          parseStatus: "PARSED",
          parseConfidence: release.confidence,
          parsedRelease: {
            upsert: {
              create: parsedReleaseData(release),
              update: parsedReleaseData(release)
            }
          }
        }
      });
      if (existing) updated += 1;
      else created += 1;
    }

    await prisma.rssFeed.update({
      where: { id: feed.id },
      data: { lastPolledAt: new Date(), lastError: null }
    });
    publishEvent({
      type: "feed.refresh",
      data: { feedId: feed.id, created, updated }
    });
    return { created, updated };
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error));
    await prisma.rssFeed.update({
      where: { id: feed.id },
      data: { lastError: message }
    });
    throw new Error(message);
  }
}

export function urlPreview(encryptedUrl: string, config: AppConfig): string {
  return redactSecrets(decryptSecret(encryptedUrl, config.appSecret));
}

export function hashStable(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function extractTorrentUrl(item: FeedItem): string {
  return item.enclosure?.url || item.link || item.guid || "";
}

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseSize(value?: string): bigint | undefined {
  if (!value) return undefined;
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = BigInt(value);
  return parsed > 0n ? parsed : undefined;
}

function parsedReleaseData(release: ReturnType<typeof parseReleaseTitle>) {
  return {
    title: release.title,
    year: release.year,
    kind: release.kind,
    season: release.season,
    episode: release.episode,
    episodeEnd: release.episodeEnd,
    quality: release.quality,
    source: release.source,
    codec: release.codec,
    audio: release.audio,
    releaseGroup: release.releaseGroup,
    confidence: release.confidence,
    raw: stripUndefined(release)
  };
}

function stripUndefined(value: unknown): Prisma.JsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.JsonObject;
}
