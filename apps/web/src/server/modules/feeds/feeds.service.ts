import Parser from "rss-parser";
import type { FeedDto } from "@rss-media/shared/apiContracts";
import { redactSecrets } from "@rss-media/shared/redact";
import type { AppConfig } from "../../config.js";
import { prisma } from "../../db.js";
import { badGateway, notFound } from "../../core/errors.js";
import { publishTenantEvent } from "../../core/events.js";
import { decryptAead, encryptAead, hmacSecret } from "../../secrets.js";
import { listItems } from "../items/items.service.js";
import type { ItemQueryInput } from "../items/items.schemas.js";
import { matchParsedReleaseForItem } from "../media/releaseMatcher.js";
import { evaluateAutoDownloadsForItem } from "../subscriptions/subscriptionAutomation.js";
import type { CreateFeedInput, PatchFeedInput } from "./feeds.schemas.js";
import {
  normalizeFeedItem,
  upsertNormalizedRssItem,
  type RssParserItem
} from "./itemIngestion.js";

type TenantJobContext =
  | { tenantId: string; actor: "worker" }
  | { tenantId: string; actor: { userId: string } };

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

type FeedRequestHeaders = Record<string, string>;

const parserOptions = {
  customFields: {
    item: [
      ["torrent:contentLength", "torrentContentLength"],
      ["torrent:infoHash", "torrentInfoHash"],
      ["torrent:magnetURI", "torrentMagnetUri"],
      ["category", "category"]
    ]
  }
} satisfies ConstructorParameters<typeof Parser>[0];

export async function listFeeds(tenantId: string): Promise<FeedDto[]> {
  const feeds = await prisma.rssFeed.findMany({
    where: { tenantId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { items: true } } }
  });

  return feeds.map(serializeFeed);
}

export async function getFeed(
  tenantId: string,
  feedId: string
): Promise<FeedDto> {
  const feed = await prisma.rssFeed.findFirst({
    where: { id: feedId, tenantId, deletedAt: null },
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
      encryptedRequestHeadersJson: requestHeadersJson(input.requestHeaders),
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
}): Promise<FeedDto> {
  await assertFeedInTenant(input.tenantId, input.feedId, { activeOnly: true });

  const feed = await prisma.rssFeed.update({
    where: { id_tenantId: { id: input.feedId, tenantId: input.tenantId } },
    data: {
      name: input.patch.name,
      encryptedUrl: input.patch.url ? encryptAead(input.patch.url) : undefined,
      urlHash: input.patch.url ? hmacSecret(input.patch.url) : undefined,
      encryptedRequestHeadersJson: input.patch.requestHeaders === undefined
        ? undefined
        : requestHeadersJson(input.patch.requestHeaders),
      pollIntervalSeconds: input.patch.pollIntervalSeconds,
      enabled: input.patch.enabled
    },
    include: { _count: { select: { items: true } } }
  });

  return serializeFeed(feed);
}

export async function deleteFeed(tenantId: string, feedId: string) {
  await assertFeedInTenant(tenantId, feedId);
  await prisma.rssFeed.update({
    where: { id_tenantId: { id: feedId, tenantId } },
    data: {
      encryptedUrl: null,
      urlHash: null,
      encryptedRequestHeadersJson: null,
      enabled: false,
      deletedAt: new Date(),
      lastError: null
    }
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
    where: {
      id: feedId,
      tenantId: ctx.tenantId,
      enabled: true,
      deletedAt: null,
      encryptedUrl: { not: null }
    }
  });
  if (!feed) return emptyRefreshResult();

  try {
    if (!feed.encryptedUrl) return emptyRefreshResult();
    const url = decryptAead(feed.encryptedUrl);
    const parsed = await createParser(feedRequestHeaders(feed.encryptedRequestHeadersJson)).parseURL(url);

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

      const upserted = await upsertNormalizedRssItem({
        tenantId: ctx.tenantId,
        feedId,
        item,
        rawPayload: raw
      });

      if (upserted.created) {
        changedItemIds.push(upserted.itemId);
        created += 1;
      } else {
        if (upserted.releaseChanged) {
          changedItemIds.push(upserted.itemId);
          changed += 1;
        } else {
          unchanged += 1;
        }
        updated += 1;
      }
    }

    const lastPolledAt = new Date();
    await prisma.rssFeed.update({
      where: { id_tenantId: { id: feedId, tenantId: ctx.tenantId } },
      data: {
        lastPolledAt,
        nextAttemptAt: nextFeedAttemptAt(lastPolledAt, feed.pollIntervalSeconds),
        lastError: null
      }
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
    const failedAt = new Date();
    await prisma.rssFeed.update({
      where: { id_tenantId: { id: feedId, tenantId: ctx.tenantId } },
      data: {
        nextAttemptAt: nextFeedAttemptAt(failedAt, feed.pollIntervalSeconds),
        lastError: message
      }
    });
    throw badGateway(`RSS refresh failed: ${message}`);
  }
}

function nextFeedAttemptAt(from: Date, pollIntervalSeconds: number) {
  return new Date(from.getTime() + pollIntervalSeconds * 1000);
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

function createParser(headers: FeedRequestHeaders = {}) {
  return new Parser<Record<string, never>, RssParserItem>({
    ...parserOptions,
    headers
  });
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

export function urlPreview(encryptedUrl: string | null): string | null {
  if (!encryptedUrl) return null;
  return redactSecrets(decryptAead(encryptedUrl));
}

function requestHeadersJson(headers?: FeedRequestHeaders | null) {
  const sanitized = sanitizeRequestHeaders(headers);
  return sanitized ? encryptAead(JSON.stringify(sanitized)) : null;
}

function feedRequestHeaders(encryptedRequestHeadersJson?: string | null): FeedRequestHeaders {
  if (!encryptedRequestHeadersJson) return {};
  return sanitizeRequestHeaders(
    JSON.parse(decryptAead(encryptedRequestHeadersJson)) as Record<string, unknown>
  ) ?? {};
}

function sanitizeRequestHeaders(headers?: Record<string, unknown> | null): FeedRequestHeaders | null {
  if (!headers) return null;

  const sanitized: FeedRequestHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value !== "string") continue;
    const headerName = normalizedRequestHeaderName(key);
    const headerValue = value.trim();
    if (headerName && headerValue) sanitized[headerName] = headerValue;
  }

  return Object.keys(sanitized).length ? sanitized : null;
}

function normalizedRequestHeaderName(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "cookie") return "Cookie";
  if (normalized === "user-agent") return "User-Agent";
  return null;
}

async function assertFeedInTenant(
  tenantId: string,
  feedId: string,
  options: { activeOnly?: boolean } = {}
) {
  const feed = await prisma.rssFeed.findFirst({
    where: {
      id: feedId,
      tenantId,
      deletedAt: options.activeOnly ? null : undefined
    },
    select: { id: true }
  });

  if (!feed) throw notFound("Feed");
  return feed;
}

function serializeFeed(feed: {
  id: string;
  name: string;
  encryptedUrl: string | null;
  encryptedRequestHeadersJson?: string | null;
  enabled: boolean;
  pollIntervalSeconds: number;
  lastPolledAt: Date | null;
  lastError: string | null;
  deletedAt?: Date | null;
  _count: { items: number };
}): FeedDto {
  return {
    id: feed.id,
    name: feed.name,
    urlPreview: urlPreview(feed.encryptedUrl),
    hasRequestHeaders: Boolean(feed.encryptedRequestHeadersJson),
    enabled: feed.enabled,
    pollIntervalSeconds: feed.pollIntervalSeconds,
    lastPolledAt: feed.lastPolledAt?.toISOString() ?? null,
    lastError: feed.lastError ? redactSecrets(feed.lastError) : null,
    deletedAt: feed.deletedAt?.toISOString() ?? null,
    itemCount: feed._count.items
  };
}
