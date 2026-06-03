import Parser from "rss-parser";
import type { Prisma } from "@prisma/client";
import { parseReleaseTitle } from "@rss-media/shared/releaseParser";
import { redactSecrets } from "@rss-media/shared/redact";
import { prisma } from "../../db.js";
import { badGateway, notFound } from "../../core/errors.js";
import { publishTenantEvent } from "../../core/events.js";
import { decryptAead, encryptAead, hmacSecret } from "../../secrets.js";
import { listItems } from "../items/items.service.js";
import type { ItemQueryInput } from "../items/items.schemas.js";
import type { CreateFeedInput, PatchFeedInput } from "./feeds.schemas.js";

type TenantJobContext =
  | { tenantId: string; actor: "worker" }
  | { tenantId: string; actor: { userId: string } };

type RssParserItem = {
  title?: string;
  link?: string;
  guid?: string;
  isoDate?: string;
  pubDate?: string;
  content?: string;
  contentSnippet?: string;
  enclosure?: {
    url?: string;
    length?: string | number;
    type?: string;
  };
  torrentInfoHash?: string;
  torrentContentLength?: string | number;
  torrentMagnetUri?: string;
  [key: string]: unknown;
};

type ParsedFeedItem = {
  rawTitle: string;
  torrentUrl: string;
  guid?: string;
  infoHash?: string;
  publishDate?: Date;
  sizeBytes?: bigint;
};

type DedupeKey = {
  type: "INFO_HASH" | "RELEASE_SIGNATURE" | "LINK_HASH";
  hash: string;
  releaseSignature?: string;
};

export type FeedResponse = {
  id: string;
  name: string;
  urlPreview: string;
  enabled: boolean;
  pollIntervalSeconds: number;
  lastPolledAt?: string | null;
  lastError?: string | null;
  itemCount: number;
};

const parser = new Parser<Record<string, never>, RssParserItem>({
  customFields: {
    item: [
      ["torrent:contentLength", "torrentContentLength"],
      ["torrent:infoHash", "torrentInfoHash"],
      ["torrent:magnetURI", "torrentMagnetUri"],
      ["category", "category"]
    ]
  }
});

export async function listFeeds(tenantId: string): Promise<FeedResponse[]> {
  const feeds = await prisma.rssFeed.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { items: true } } }
  });

  return feeds.map(serializeFeed);
}

export async function getFeed(
  tenantId: string,
  feedId: string
): Promise<FeedResponse> {
  const feed = await prisma.rssFeed.findFirst({
    where: { id: feedId, tenantId },
    include: { _count: { select: { items: true } } }
  });

  if (!feed) throw notFound("Feed");
  return serializeFeed(feed);
}

export async function createFeed(
  input: CreateFeedInput,
  ctx: { tenantId: string; userId: string }
) {
  return prisma.rssFeed.create({
    data: {
      tenantId: ctx.tenantId,
      createdByUserId: ctx.userId,
      name: input.name,
      encryptedUrl: encryptAead(input.url),
      urlHash: hmacSecret(input.url),
      pollIntervalSeconds: input.pollIntervalSeconds,
      enabled: input.enabled
    },
    select: { id: true }
  });
}

export async function updateFeed(input: {
  tenantId: string;
  feedId: string;
  patch: PatchFeedInput;
}): Promise<FeedResponse> {
  await assertFeedInTenant(input.tenantId, input.feedId);

  const feed = await prisma.rssFeed.update({
    where: { id_tenantId: { id: input.feedId, tenantId: input.tenantId } },
    data: {
      name: input.patch.name,
      encryptedUrl: input.patch.url ? encryptAead(input.patch.url) : undefined,
      urlHash: input.patch.url ? hmacSecret(input.patch.url) : undefined,
      pollIntervalSeconds: input.patch.pollIntervalSeconds,
      enabled: input.patch.enabled
    },
    include: { _count: { select: { items: true } } }
  });

  return serializeFeed(feed);
}

export async function deleteFeed(tenantId: string, feedId: string) {
  await assertFeedInTenant(tenantId, feedId);
  await prisma.rssFeed.delete({
    where: { id_tenantId: { id: feedId, tenantId } }
  });
  return { id: feedId };
}

export async function listFeedItems(
  tenantId: string,
  feedId: string,
  query: Omit<ItemQueryInput, "feedId">
) {
  await assertFeedInTenant(tenantId, feedId);
  return listItems(tenantId, { ...query, feedId });
}

export async function refreshFeed(feedId: string, ctx: TenantJobContext) {
  const feed = await prisma.rssFeed.findFirst({
    where: { id: feedId, tenantId: ctx.tenantId, enabled: true }
  });
  if (!feed) return { created: 0, updated: 0 };

  try {
    const url = decryptAead(feed.encryptedUrl);
    const parsed = await parser.parseURL(url);

    let created = 0;
    let updated = 0;

    for (const raw of parsed.items ?? []) {
      const item = normalizeFeedItem(raw);
      if (!item) continue;

      const dedupe = chooseDedupeKey(item);
      const safeRaw = safeRawPayload(raw);
      const release = parseReleaseTitle(item.rawTitle);
      const unique = {
        feedId,
        dedupeKeyType: dedupe.type,
        dedupeKeyHash: dedupe.hash
      };

      const existing = await prisma.rssItem.findUnique({
        where: { feedId_dedupeKeyType_dedupeKeyHash: unique },
        select: { id: true }
      });

      await prisma.rssItem.upsert({
        where: { feedId_dedupeKeyType_dedupeKeyHash: unique },
        create: {
          tenantId: ctx.tenantId,
          feedId,
          rawTitle: item.rawTitle,
          infoHash: item.infoHash ? hmacSecret(item.infoHash.toLowerCase()) : null,
          guidHash: item.guid ? hmacSecret(item.guid) : null,
          linkHash: hmacSecret(item.torrentUrl),
          dedupeKeyType: dedupe.type,
          dedupeKeyHash: dedupe.hash,
          releaseSignature: dedupe.releaseSignature,
          encryptedTorrentUrl: encryptAead(item.torrentUrl),
          publishDate: item.publishDate,
          sizeBytes: item.sizeBytes,
          ...safeRaw,
          parseStatus: "PARSED",
          parseConfidence: release.confidence,
          parsedRelease: {
            create: parsedReleaseData(release)
          }
        },
        update: {
          rawTitle: item.rawTitle,
          publishDate: item.publishDate,
          sizeBytes: item.sizeBytes,
          ...safeRaw,
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
      where: { id_tenantId: { id: feedId, tenantId: ctx.tenantId } },
      data: { lastPolledAt: new Date(), lastError: null }
    });

    publishTenantEvent({
      tenantId: ctx.tenantId,
      type: "feed.refresh",
      data: { feedId, created, updated }
    });

    return { created, updated };
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error));
    await prisma.rssFeed.update({
      where: { id_tenantId: { id: feedId, tenantId: ctx.tenantId } },
      data: { lastError: message }
    });
    throw badGateway(`RSS refresh failed: ${message}`);
  }
}

export function chooseDedupeKey(item: ParsedFeedItem): DedupeKey {
  if (item.infoHash) {
    return {
      type: "INFO_HASH",
      hash: hmacSecret(item.infoHash.toLowerCase())
    };
  }

  const release = parseReleaseTitle(item.rawTitle);
  const signature = buildReleaseSignature(release, item.sizeBytes);
  if (signature) {
    return {
      type: "RELEASE_SIGNATURE",
      hash: hmacSecret(signature),
      releaseSignature: signature
    };
  }

  return {
    type: "LINK_HASH",
    hash: hmacSecret(item.torrentUrl)
  };
}

export function normalizeFeedItem(raw: RssParserItem): ParsedFeedItem | null {
  const torrentUrl = extractTorrentUrl(raw);
  const rawTitle = readString(raw.title)?.trim();
  if (!torrentUrl || !rawTitle) return null;

  return {
    rawTitle,
    torrentUrl,
    guid: readString(raw.guid),
    infoHash: normalizeInfoHash(
      readString(raw.torrentInfoHash) ?? extractInfoHash(torrentUrl)
    ),
    publishDate: parseDate(raw.isoDate ?? raw.pubDate),
    sizeBytes: parseSize(raw.torrentContentLength ?? raw.enclosure?.length)
  };
}

export function safeRawPayload(raw: unknown) {
  const json = JSON.stringify(stripUndefined(raw));
  return {
    rawJsonEncrypted: encryptAead(json),
    rawJsonRedacted: JSON.parse(redactSecrets(json)) as Prisma.InputJsonValue
  };
}

export function urlPreview(encryptedUrl: string): string {
  return redactSecrets(decryptAead(encryptedUrl));
}

async function assertFeedInTenant(tenantId: string, feedId: string) {
  const feed = await prisma.rssFeed.findFirst({
    where: { id: feedId, tenantId },
    select: { id: true }
  });

  if (!feed) throw notFound("Feed");
  return feed;
}

function serializeFeed(feed: {
  id: string;
  name: string;
  encryptedUrl: string;
  enabled: boolean;
  pollIntervalSeconds: number;
  lastPolledAt: Date | null;
  lastError: string | null;
  _count: { items: number };
}): FeedResponse {
  return {
    id: feed.id,
    name: feed.name,
    urlPreview: urlPreview(feed.encryptedUrl),
    enabled: feed.enabled,
    pollIntervalSeconds: feed.pollIntervalSeconds,
    lastPolledAt: feed.lastPolledAt?.toISOString() ?? null,
    lastError: feed.lastError ? redactSecrets(feed.lastError) : null,
    itemCount: feed._count.items
  };
}

function extractTorrentUrl(item: RssParserItem): string {
  return (
    readString(item.enclosure?.url) ??
    readString(item.torrentMagnetUri) ??
    readString(item.link) ??
    readUrlLikeGuid(item.guid) ??
    ""
  );
}

function readUrlLikeGuid(guid?: string): string | undefined {
  if (!guid) return undefined;
  return /^(https?:|magnet:)/i.test(guid) ? guid : undefined;
}

function extractInfoHash(value: string): string | undefined {
  const match = value.match(/(?:btih:|[?&]xt=urn:btih:)([a-z0-9]+)/i);
  return match?.[1];
}

function normalizeInfoHash(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[a-z0-9]{32,64}$/.test(normalized)
    ? normalized
    : undefined;
}

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseSize(value?: string | number): bigint | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value);
  if (!/^\d+$/.test(text)) return undefined;
  const parsed = BigInt(text);
  return parsed > 0n ? parsed : undefined;
}

function buildReleaseSignature(
  release: ReturnType<typeof parseReleaseTitle>,
  sizeBytes?: bigint
): string | undefined {
  if (!release.title) return undefined;

  return [
    ["title", normalizeSignaturePart(release.title)],
    ["kind", release.kind],
    ["year", release.year],
    ["season", release.season],
    ["episode", release.episode],
    ["episodeEnd", release.episodeEnd],
    ["quality", release.quality],
    ["source", release.source],
    ["codec", release.codec],
    ["audio", release.audio],
    ["group", release.releaseGroup],
    ["size", sizeBytes?.toString()]
  ]
    .map(([key, value]) => `${key}=${normalizeSignaturePart(value)}`)
    .join("|");
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

function normalizeSignaturePart(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stripUndefined(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
