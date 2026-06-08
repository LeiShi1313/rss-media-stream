import Parser from "rss-parser";
import type { Prisma } from "@prisma/client";
import { parseReleaseTitle } from "@rss-media/shared/releaseParser";
import { redactSecrets } from "@rss-media/shared/redact";
import type { AppConfig } from "../../config.js";
import { prisma } from "../../db.js";
import { badGateway, notFound } from "../../core/errors.js";
import { publishTenantEvent } from "../../core/events.js";
import { decryptAead, encryptAead, hmacSecret } from "../../secrets.js";
import { listItems } from "../items/items.service.js";
import type { ItemQueryInput } from "../items/items.schemas.js";
import {
  invalidateMatchesForParsedRelease,
  matchParsedReleaseForItem
} from "../media/media.service.js";
import { evaluateAutoDownloadsForItem } from "../subscriptions/subscriptions.service.js";
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
  sourceUrl?: string;
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

type FeedRefreshOptions = {
  config?: AppConfig;
  enrichmentLimit?: number;
};

type FeedRefreshResult = {
  created: number;
  updated: number;
  changed: number;
  unchanged: number;
  skipped: number;
  enrichment: {
    attempted: number;
    matched: number;
    unmatched: number;
    queued: number;
    failed: number;
    reasons: Record<string, number>;
  };
  subscriptions: {
    evaluatedItems: number;
    downloadJobsCreated: number;
    failed: number;
  };
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

export async function refreshFeed(
  feedId: string,
  ctx: TenantJobContext,
  options: FeedRefreshOptions = {}
): Promise<FeedRefreshResult> {
  const feed = await prisma.rssFeed.findFirst({
    where: { id: feedId, tenantId: ctx.tenantId, enabled: true }
  });
  if (!feed) return emptyRefreshResult();

  try {
    const url = decryptAead(feed.encryptedUrl);
    const parsed = await parser.parseURL(url);

    let created = 0;
    let updated = 0;
    let changed = 0;
    let unchanged = 0;
    let skipped = 0;
    const changedItemIds: string[] = [];

    for (const raw of parsed.items ?? []) {
      const item = normalizeFeedItem(raw);
      if (!item) {
        skipped += 1;
        continue;
      }

      const dedupe = chooseDedupeKey(item);
      const safeRaw = safeRawPayload(raw);
      const release = parseReleaseTitle(item.rawTitle);
      const infoHash = item.infoHash ? hmacSecret(item.infoHash.toLowerCase()) : null;
      const guidHash = item.guid ? hmacSecret(item.guid) : null;
      const linkHash = hmacSecret(item.torrentUrl);
      const unique = {
        feedId,
        dedupeKeyType: dedupe.type,
        dedupeKeyHash: dedupe.hash
      };

      const existing = await findExistingFeedItem({
        feedId,
        tenantId: ctx.tenantId,
        unique,
        infoHash,
        guidHash,
        linkHash
      });

      if (existing) {
        const previousRelease = await prisma.parsedRelease.findUnique({
          where: {
            rssItemId_tenantId: {
              rssItemId: existing.id,
              tenantId: ctx.tenantId
            }
          },
          select: parsedReleaseComparisonSelect()
        });

        await prisma.rssItem.update({
          where: { id_tenantId: { id: existing.id, tenantId: ctx.tenantId } },
          data: {
            rawTitle: item.rawTitle,
            infoHash,
            guidHash,
            linkHash,
            dedupeKeyType: dedupe.type,
            dedupeKeyHash: dedupe.hash,
            releaseSignature: dedupe.releaseSignature,
            encryptedTorrentUrl: encryptAead(item.torrentUrl),
            encryptedSourceUrl: item.sourceUrl ? encryptAead(item.sourceUrl) : null,
            publishDate: item.publishDate,
            sizeBytes: item.sizeBytes,
            ...safeRaw,
            parseStatus: "PARSED",
            parseConfidence: release.parseConfidence,
            parsedRelease: {
              upsert: {
                create: parsedReleaseData(release),
                update: parsedReleaseData(release)
              }
            }
          }
        });

        const releaseChanged = !previousRelease || parsedReleaseChanged(previousRelease, release);
        if (previousRelease && releaseChanged) {
          await invalidateMatchesForParsedRelease({
            tenantId: ctx.tenantId,
            parsedReleaseId: previousRelease.id,
            staleReason: "parsed_release_changed"
          });
        }
        if (releaseChanged) {
          changedItemIds.push(existing.id);
          changed += 1;
        } else {
          unchanged += 1;
        }

        updated += 1;
      } else {
        const createdItem = await prisma.rssItem.create({
          data: {
            tenantId: ctx.tenantId,
            feedId,
            rawTitle: item.rawTitle,
            infoHash,
            guidHash,
            linkHash,
            dedupeKeyType: dedupe.type,
            dedupeKeyHash: dedupe.hash,
            releaseSignature: dedupe.releaseSignature,
            encryptedTorrentUrl: encryptAead(item.torrentUrl),
            encryptedSourceUrl: item.sourceUrl ? encryptAead(item.sourceUrl) : null,
            publishDate: item.publishDate,
            sizeBytes: item.sizeBytes,
            ...safeRaw,
            parseStatus: "PARSED",
            parseConfidence: release.parseConfidence,
            parsedRelease: {
              create: parsedReleaseData(release)
            }
          },
          select: { id: true }
        });
        changedItemIds.push(createdItem.id);
        created += 1;
      }
    }

    await prisma.rssFeed.update({
      where: { id_tenantId: { id: feedId, tenantId: ctx.tenantId } },
      data: { lastPolledAt: new Date(), lastError: null }
    });

    const { enrichment, subscriptions } = await enrichChangedItems({
      itemIds: changedItemIds,
      tenantId: ctx.tenantId,
      config: options.config,
      limit: options.enrichmentLimit ?? 50
    });
    const result = {
      created,
      updated,
      changed,
      unchanged,
      skipped,
      enrichment,
      subscriptions
    };

    publishTenantEvent({
      tenantId: ctx.tenantId,
      type: "feed.refresh",
      data: { feedId, ...result }
    });

    return result;
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error));
    await prisma.rssFeed.update({
      where: { id_tenantId: { id: feedId, tenantId: ctx.tenantId } },
      data: { lastError: message }
    });
    throw badGateway(`RSS refresh failed: ${message}`);
  }
}

async function enrichChangedItems(input: {
  tenantId: string;
  itemIds: string[];
  config?: AppConfig;
  limit: number;
}): Promise<Pick<FeedRefreshResult, "enrichment" | "subscriptions">> {
  const enrichment = emptyEnrichmentSummary();
  const subscriptions = emptySubscriptionSummary();

  if (!input.config) {
    enrichment.queued = input.itemIds.length;
    return { enrichment, subscriptions };
  }

  const itemIds = input.itemIds.slice(0, input.limit);
  enrichment.queued = Math.max(0, input.itemIds.length - itemIds.length);

  for (const itemId of itemIds) {
    enrichment.attempted += 1;
    try {
      const match = await matchParsedReleaseForItem({
        tenantId: input.tenantId,
        itemId,
        config: input.config
      });
      if (match.status === "MATCHED") {
        enrichment.matched += 1;
        await evaluateSubscriptionsForMatchedItem({
          tenantId: input.tenantId,
          itemId,
          config: input.config,
          subscriptions
        });
      } else {
        enrichment.unmatched += 1;
      }
      countReason(enrichment.reasons, match.reason ?? match.status);
    } catch (error) {
      enrichment.failed += 1;
      countReason(
        enrichment.reasons,
        redactSecrets(error instanceof Error ? error.message : String(error))
      );
      console.error(`Media enrichment failed for ${itemId}`, redactSecrets(error instanceof Error ? error.message : String(error)));
    }
  }

  return { enrichment, subscriptions };
}

async function evaluateSubscriptionsForMatchedItem(input: {
  tenantId: string;
  itemId: string;
  config: AppConfig;
  subscriptions: FeedRefreshResult["subscriptions"];
}) {
  input.subscriptions.evaluatedItems += 1;
  try {
    const createdJobs = await evaluateAutoDownloadsForItem({
      tenantId: input.tenantId,
      itemId: input.itemId,
      config: input.config
    });
    input.subscriptions.downloadJobsCreated += createdJobs.length;
  } catch (error) {
    input.subscriptions.failed += 1;
    console.error(
      `Subscription evaluation failed for ${input.itemId}`,
      redactSecrets(error instanceof Error ? error.message : String(error))
    );
  }
}

function emptyRefreshResult(): FeedRefreshResult {
  return {
    created: 0,
    updated: 0,
    changed: 0,
    unchanged: 0,
    skipped: 0,
    enrichment: emptyEnrichmentSummary(),
    subscriptions: emptySubscriptionSummary()
  };
}

function emptyEnrichmentSummary(): FeedRefreshResult["enrichment"] {
  return {
    attempted: 0,
    matched: 0,
    unmatched: 0,
    queued: 0,
    failed: 0,
    reasons: {}
  };
}

function emptySubscriptionSummary(): FeedRefreshResult["subscriptions"] {
  return {
    evaluatedItems: 0,
    downloadJobsCreated: 0,
    failed: 0
  };
}

function countReason(reasons: Record<string, number>, reason: string) {
  reasons[reason] = (reasons[reason] ?? 0) + 1;
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
    sourceUrl: extractSourceUrl(raw, torrentUrl),
    guid: readString(raw.guid),
    infoHash: normalizeInfoHash(
      readString(raw.torrentInfoHash) ?? extractInfoHash(torrentUrl) ?? readString(raw.guid)
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

async function findExistingFeedItem(input: {
  feedId: string;
  tenantId: string;
  unique: {
    feedId: string;
    dedupeKeyType: DedupeKey["type"];
    dedupeKeyHash: string;
  };
  infoHash: string | null;
  guidHash: string | null;
  linkHash: string;
}) {
  const exact = await prisma.rssItem.findUnique({
    where: { feedId_dedupeKeyType_dedupeKeyHash: input.unique },
    select: { id: true }
  });
  if (exact) return exact;

  const stableIdentifiers: Prisma.RssItemWhereInput[] = [{ linkHash: input.linkHash }];
  if (input.infoHash) stableIdentifiers.push({ infoHash: input.infoHash });
  if (input.guidHash) stableIdentifiers.push({ guidHash: input.guidHash });

  return prisma.rssItem.findFirst({
    where: {
      feedId: input.feedId,
      tenantId: input.tenantId,
      OR: stableIdentifiers
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true }
  });
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

function extractSourceUrl(item: RssParserItem, torrentUrl: string): string | undefined {
  return [
    readString(item.link),
    readUrlFromText(readString(item.contentSnippet)),
    readUrlFromText(readString(item.content)),
    readUrlFromText(readString(item.description))
  ].find((value) => value && value !== torrentUrl && /^https?:\/\//i.test(value));
}

function readUrlFromText(value?: string): string | undefined {
  return value?.trim().match(/https?:\/\/[^\s<>"']+/i)?.[0];
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
    ["mediaType", release.mediaType],
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
    mediaType: release.mediaType,
    season: release.season,
    episode: release.episode,
    episodeEnd: release.episodeEnd,
    resolution: release.resolution,
    quality: release.quality,
    source: release.source,
    codec: release.codec,
    audio: release.audio,
    releaseGroup: release.releaseGroup,
    parseConfidence: release.parseConfidence,
    parsedAt: new Date()
  };
}

function parsedReleaseComparisonSelect() {
  return {
    id: true,
    title: true,
    year: true,
    mediaType: true,
    season: true,
    episode: true,
    episodeEnd: true,
    resolution: true,
    quality: true,
    source: true,
    codec: true,
    audio: true,
    releaseGroup: true,
    parseConfidence: true
  } as const;
}

function parsedReleaseChanged(
  previous: Prisma.ParsedReleaseGetPayload<{ select: ReturnType<typeof parsedReleaseComparisonSelect> }>,
  next: ReturnType<typeof parseReleaseTitle>
) {
  return [
    previous.title !== next.title,
    previous.year !== (next.year ?? null),
    previous.mediaType !== next.mediaType,
    previous.season !== (next.season ?? null),
    previous.episode !== (next.episode ?? null),
    previous.episodeEnd !== (next.episodeEnd ?? null),
    previous.resolution !== (next.resolution ?? null),
    previous.quality !== (next.quality ?? null),
    previous.source !== (next.source ?? null),
    previous.codec !== (next.codec ?? null),
    previous.audio !== (next.audio ?? null),
    previous.releaseGroup !== (next.releaseGroup ?? null),
    previous.parseConfidence !== next.parseConfidence
  ].some(Boolean);
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
