import { createHash } from "node:crypto";
import { ParsedReleaseMatchStatus, type Prisma } from "@prisma/client";
import { redactSecrets } from "@rss-media/shared/redact";
import type { MediaProvider, MediaType, ParsedMediaType, ProviderTitleResult } from "@rss-media/shared/types";
import type { AppConfig } from "../../config.js";
import { AppError, conflict, notFound, badGateway } from "../../core/errors.js";
import { prisma } from "../../db.js";
import { getMetadataProviders, getMetadataProvider } from "../../integrations/providers/index.js";
import {
  getBroadSearchTargets,
  getMatchingProviderOrder,
  getPresentationProviderOrder
} from "../../integrations/providers/policy.js";
import { providerRuntimeAvailable, resolveProviderRuntime } from "../../integrations/providers/runtime.js";
import type { ProviderRuntimeContext } from "../../integrations/providers/types.js";
import {
  LOW_CONFIDENCE_THRESHOLD,
  legacyKindFromMediaType,
  providerOrderForMediaType,
  serializeMediaPresentation,
  serializeProviderTitleSearchResult,
  serializeReleaseMatch,
  type PresentationOrders
} from "./presentation.js";
import type {
  localMediaSearchQuerySchema,
  mediaSearchQuerySchema,
  trendingMediaQuerySchema
} from "./media.schemas.js";
import type { z } from "zod";

type MediaSearchQuery = z.infer<typeof mediaSearchQuerySchema>;
type SmartProviderTitleSearchInput = {
  input: string;
  mediaType?: ParsedMediaType;
  providerEntityType?: string;
  year?: number;
};
type LocalMediaSearchQuery = z.infer<typeof localMediaSearchQuerySchema>;
type TrendingMediaQuery = z.infer<typeof trendingMediaQuerySchema>;
type Transaction = Prisma.TransactionClient;
type ActiveParsedReleaseMatch = Prisma.ParsedReleaseMatchGetPayload<{
  include: {
    mediaTitle: {
      include: { providerLinks: { include: { providerTitle: true } } };
    };
    providerTitle: true;
  };
}>;
type ParsedReleaseSnapshot = Pick<
  Prisma.ParsedReleaseGetPayload<{}>,
  | "id"
  | "tenantId"
  | "title"
  | "year"
  | "mediaType"
  | "season"
  | "episode"
  | "episodeEnd"
  | "resolution"
  | "quality"
  | "source"
  | "codec"
  | "audio"
  | "releaseGroup"
  | "parseConfidence"
>;

const ACTIVE_STATUSES = ["MATCHED", "UNMATCHED"] as const;

export async function searchExternalMedia(
  config: AppConfig,
  tenantId: string,
  query: MediaSearchQuery
) {
  const results = query.provider
    ? await runProviderSearch(config, tenantId, query.provider, {
        title: query.q,
        mediaType: query.mediaType,
        year: query.year
      })
    : await searchProviderTargets(
        config,
        tenantId,
        (await providerSearchTargets(tenantId, query.mediaType)).map((target) => ({
          ...target,
          title: query.q,
          year: query.year
        }))
      );

  return dedupeProviderResults(results).map(serializeProviderTitleSearchResult);
}

export async function smartSearchExternalMedia(
  config: AppConfig,
  tenantId: string,
  query: SmartProviderTitleSearchInput
) {
  const probes = getMetadataProviders().flatMap((provider) =>
    provider.probe?.({
      input: query.input,
      mediaType: query.mediaType,
      providerEntityType: query.providerEntityType,
      year: query.year
    }) ?? []
  );

  const exactProbes = probes.filter((probe) => probe.providerId && probe.providerEntityType);
  if (exactProbes.length > 0) {
    const results = await Promise.all(
      exactProbes.map(async (probe) => {
        try {
          return await runProviderDetailLookup(config, tenantId, probe.provider, {
            providerEntityType: probe.providerEntityType!,
            providerId: probe.providerId!,
            mediaType: probe.mediaType
          });
        } catch (error) {
          if (isProviderLookupNotFound(error)) return undefined;
          throw error;
        }
      })
    );
    return dedupeProviderResults(results.filter((result): result is ProviderTitleResult => Boolean(result)))
      .map(serializeProviderTitleSearchResult);
  }

  const hintedTargets = probes
    .filter((probe) => probe.searchQuery && probe.mediaType)
    .map((probe) => ({
      provider: probe.provider,
      title: probe.searchQuery!,
      mediaType: probe.mediaType!,
      year: query.year
    }));

  const targets = hintedTargets.length > 0
    ? hintedTargets
    : (await providerSearchTargets(tenantId, query.mediaType)).map((target) => ({
        ...target,
        title: query.input,
        year: query.year
      }));

  const results = await searchProviderTargets(config, tenantId, targets);
  return dedupeProviderResults(results).map(serializeProviderTitleSearchResult);
}

export async function searchLocalMedia(tenantId: string, query: LocalMediaSearchQuery) {
  const normalizedQuery = query.q ? normalizeTitle(query.q) : undefined;
  const media = await prisma.mediaTitle.findMany({
    where: {
      mediaType: query.mediaType,
      OR: normalizedQuery
        ? [
            { normalizedTitle: { contains: normalizedQuery, mode: "insensitive" } },
            { canonicalTitle: { contains: query.q, mode: "insensitive" } },
            { originalTitle: { contains: query.q, mode: "insensitive" } }
          ]
        : undefined
    },
    include: {
      providerLinks: {
        include: { providerTitle: true }
      },
      _count: { select: { releaseMatches: true, subscriptions: true } }
    },
    orderBy: [{ updatedAt: "desc" }, { canonicalTitle: "asc" }],
    take: query.limit
  });

  const presentationOrders = await preloadPresentationOrders(
    tenantId,
    query.mediaType ? [query.mediaType] : undefined
  );
  return media.map((item) =>
    serializeMediaTitle({
      ...item,
      matchCount: item._count.releaseMatches,
      subscriptionCount: item._count.subscriptions
    }, presentationOrders)
  );
}

export async function listTrendingMedia(tenantId: string, query: TrendingMediaQuery) {
  const since = new Date(Date.now() - query.windowDays * 24 * 60 * 60 * 1000);
  const matches = await prisma.parsedReleaseMatch.findMany({
    where: {
      tenantId,
      status: "MATCHED",
      invalidatedAt: null,
      parsedRelease: { item: { firstSeenAt: { gte: since } } }
    },
    include: {
      mediaTitle: {
        include: {
          providerLinks: {
            include: { providerTitle: true }
          }
        }
      },
      providerTitle: true,
      parsedRelease: {
        include: {
          item: {
            select: {
              firstSeenAt: true,
              feed: { select: { id: true, name: true } }
            }
          }
        }
      }
    },
    orderBy: { matchedAt: "desc" }
  });

  const grouped = new Map<string, any>();
  for (const match of matches) {
    if (!match.mediaTitleId || !match.mediaTitle) continue;
    const current = grouped.get(match.mediaTitleId) ?? {
      media: match.mediaTitle,
      selectedProviderTitle: match.providerTitle,
      releaseCount: 0,
      latestReleaseAt: match.parsedRelease.item.firstSeenAt,
      feeds: new Map<string, string>(),
      qualities: new Set<string>(),
      releaseGroups: new Set<string>()
    };
    current.releaseCount += 1;
    if (match.parsedRelease.item.firstSeenAt > current.latestReleaseAt) {
      current.latestReleaseAt = match.parsedRelease.item.firstSeenAt;
    }
    const feed = match.parsedRelease.item.feed;
    if (feed) current.feeds.set(feed.id, feed.name);
    if (match.parsedRelease.quality) current.qualities.add(match.parsedRelease.quality);
    if (match.parsedRelease.releaseGroup) current.releaseGroups.add(match.parsedRelease.releaseGroup);
    grouped.set(match.mediaTitleId, current);
  }

  const presentationOrders = await preloadPresentationOrders(tenantId);
  return [...grouped.values()]
    .sort((a, b) => b.releaseCount - a.releaseCount || b.latestReleaseAt.getTime() - a.latestReleaseAt.getTime())
    .slice(0, query.limit)
    .map((entry) => ({
      media: serializeMediaTitle({
        ...entry.media,
        selectedProviderTitle: entry.selectedProviderTitle,
        matchCount: entry.releaseCount
      }, presentationOrders),
      releaseCount: entry.releaseCount,
      latestReleaseAt: entry.latestReleaseAt.toISOString(),
      feedCount: entry.feeds.size,
      feeds: [...entry.feeds.values()].slice(0, 6),
      qualities: [...entry.qualities].slice(0, 8),
      releaseGroups: [...entry.releaseGroups].slice(0, 8)
    }));
}

export async function getMedia(tenantId: string, mediaTitleId: string) {
  const media = await prisma.mediaTitle.findUnique({
    where: { id: mediaTitleId },
    include: {
      providerLinks: {
        include: { providerTitle: true }
      },
      _count: { select: { releaseMatches: true, subscriptions: true } }
    }
  });
  if (!media) throw notFound("Media title");

  const presentationOrders = await preloadPresentationOrders(tenantId, concreteMediaTypeList(media.mediaType));
  return serializeMediaTitle({
    ...media,
    matchCount: media._count.releaseMatches,
    subscriptionCount: media._count.subscriptions
  }, presentationOrders);
}

export async function listMediaItems(tenantId: string, mediaTitleId: string) {
  const media = await assertMediaTitleExists(mediaTitleId);
  const presentationOrders = await preloadPresentationOrders(tenantId, concreteMediaTypeList(media.mediaType));

  const items = await prisma.rssItem.findMany({
    where: {
      tenantId,
      parsedRelease: {
        matches: {
          some: {
            tenantId,
            mediaTitleId,
            status: "MATCHED",
            invalidatedAt: null
          }
        }
      }
    },
    orderBy: { firstSeenAt: "desc" },
    include: itemRelations()
  });

  return items.map((item) => serializeItem(item, presentationOrders));
}

export async function getMediaDetail(tenantId: string, mediaTitleId: string) {
  const media = await getMedia(tenantId, mediaTitleId);
  const releases = await listMediaItems(tenantId, mediaTitleId);
  return { media, releases };
}

export async function matchParsedReleaseForItem(input: {
  tenantId: string;
  itemId: string;
  config: AppConfig;
}) {
  const item = await prisma.rssItem.findFirst({
    where: { id: input.itemId, tenantId: input.tenantId },
    include: { parsedRelease: true }
  });
  if (!item) throw notFound("Item");
  if (!item.parsedRelease) {
    throw conflict("ITEM_NOT_PARSED", "Item has not been parsed");
  }

  const release = item.parsedRelease;
  const releaseSnapshot = snapshotParsedRelease(release);
  if (release.mediaType === "UNKNOWN") {
    return prisma.$transaction(async (tx) => {
      await lockParsedReleaseMatchWrites(tx, {
        tenantId: input.tenantId,
        parsedReleaseId: releaseSnapshot.id
      });
      if (!(await parsedReleaseSnapshotStillCurrent(tx, releaseSnapshot))) {
        throwStaleParsedReleaseSnapshot();
      }

      return createUnmatchedParsedReleaseMatch(tx, {
        tenantId: input.tenantId,
        parsedReleaseId: releaseSnapshot.id,
        reason: "unknown_media_type"
      });
    });
  }

  const selected = await selectProviderTitleCandidate({
    config: input.config,
    tenantId: input.tenantId,
    title: release.title,
    mediaType: release.mediaType,
    year: release.year ?? undefined
  });

  if (!selected.result) {
    return prisma.$transaction(async (tx) => {
      await lockParsedReleaseMatchWrites(tx, {
        tenantId: input.tenantId,
        parsedReleaseId: releaseSnapshot.id
      });
      if (!(await parsedReleaseSnapshotStillCurrent(tx, releaseSnapshot))) {
        throwStaleParsedReleaseSnapshot();
      }

      return createUnmatchedParsedReleaseMatch(tx, {
        tenantId: input.tenantId,
        parsedReleaseId: releaseSnapshot.id,
        reason: selected.reason
      });
    });
  }

  return prisma.$transaction(async (tx) => {
    await lockParsedReleaseMatchWrites(tx, {
      tenantId: input.tenantId,
      parsedReleaseId: releaseSnapshot.id
    });
    if (!(await parsedReleaseSnapshotStillCurrent(tx, releaseSnapshot))) {
      throwStaleParsedReleaseSnapshot();
    }

    const providerTitle = await upsertProviderTitle(tx, selected.result);
    const mediaTitle = await upsertMediaTitleFromProviderTitle(tx, providerTitle);
    const confidence = selected.result.matchConfidence ?? 0;
    await confirmMediaTitleProviderLink(tx, {
      mediaTitleId: mediaTitle.id,
      providerTitleId: providerTitle.id,
      confidence,
      source: "SEARCH_MATCH"
    });

    return createMatchedParsedReleaseMatch(tx, {
      tenantId: input.tenantId,
      parsedReleaseId: releaseSnapshot.id,
      mediaTitleId: mediaTitle.id,
      providerTitleId: providerTitle.id,
      mediaType: mediaTitle.mediaType,
      source: "AUTO",
      confidence,
      reason: confidence < LOW_CONFIDENCE_THRESHOLD
        ? "automatic_low_confidence_match"
        : "automatic_match"
    });
  });
}

async function selectProviderTitleCandidate(input: {
  config: AppConfig;
  tenantId: string;
  mediaType: MediaType;
  title: string;
  year?: number;
}) {
  let configured = 0;
  let missingReleaseYear = false;
  let providerFailed = false;
  const providerOrder = await getMatchingProviderOrder(input.tenantId, input.mediaType);
  if (providerOrder.length === 0) {
    return { reason: "provider_disabled_by_policy" };
  }

  for (const providerId of providerOrder) {
    const runtime = await resolveProviderRuntime(input.config, input.tenantId, providerId);
    if (!providerRuntimeAvailable(runtime)) {
      continue;
    }
    configured += 1;

    let result: ProviderTitleResult | undefined;
    try {
      [result] = await runProviderSearchWithRuntime(providerId, runtime, {
        title: input.title,
        mediaType: input.mediaType,
        year: input.year
      });
    } catch {
      providerFailed = true;
      continue;
    }
    if (!result) continue;
    if (result.releaseYear == null) {
      missingReleaseYear = true;
      continue;
    }
    return { result };
  }

  return {
    reason: configured === 0
      ? "provider_not_configured"
      : missingReleaseYear
        ? "missing_release_year_for_auto_match"
        : providerFailed
          ? "no_result"
        : "no_result"
  };
}

function snapshotParsedRelease(release: ParsedReleaseSnapshot): ParsedReleaseSnapshot {
  return {
    id: release.id,
    tenantId: release.tenantId,
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
    parseConfidence: release.parseConfidence
  };
}

async function parsedReleaseSnapshotStillCurrent(
  tx: Transaction,
  snapshot: ParsedReleaseSnapshot
) {
  const current = await db(tx).parsedRelease.findUnique({
    where: { id_tenantId: { id: snapshot.id, tenantId: snapshot.tenantId } },
    select: {
      id: true,
      tenantId: true,
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
    }
  });

  return current != null && parsedReleaseSnapshotsMatch(snapshot, current);
}

function parsedReleaseSnapshotsMatch(
  expected: ParsedReleaseSnapshot,
  current: ParsedReleaseSnapshot
) {
  return [
    expected.id === current.id,
    expected.tenantId === current.tenantId,
    expected.title === current.title,
    expected.year === current.year,
    expected.mediaType === current.mediaType,
    expected.season === current.season,
    expected.episode === current.episode,
    expected.episodeEnd === current.episodeEnd,
    expected.resolution === current.resolution,
    expected.quality === current.quality,
    expected.source === current.source,
    expected.codec === current.codec,
    expected.audio === current.audio,
    expected.releaseGroup === current.releaseGroup,
    expected.parseConfidence === current.parseConfidence
  ].every(Boolean);
}

function throwStaleParsedReleaseSnapshot(): never {
  throw conflict(
    "PARSED_RELEASE_CHANGED",
    "Parsed release changed while matching; retry matching with the current parse"
  );
}

export async function manuallyMatchParsedReleaseWithProvider(input: {
  tenantId: string;
  itemId: string;
  config: AppConfig;
  provider: MediaProvider;
  providerEntityType?: string;
  providerId: string;
  mediaType: MediaType;
}) {
  const item = await prisma.rssItem.findFirst({
    where: { id: input.itemId, tenantId: input.tenantId },
    include: { parsedRelease: true }
  });
  if (!item) throw notFound("Item");
  if (!item.parsedRelease) {
    throw conflict("ITEM_NOT_PARSED", "Item has not been parsed");
  }

  const providerEntityType = input.providerEntityType ?? providerEntityTypeFor(input.provider, input.mediaType);
  const selected = await runProviderDetailLookup(input.config, input.tenantId, input.provider, {
    providerEntityType,
    providerId: input.providerId,
    mediaType: input.mediaType
  });

  return prisma.$transaction(async (tx) => {
    await lockParsedReleaseMatchWrites(tx, {
      tenantId: input.tenantId,
      parsedReleaseId: item.parsedRelease!.id
    });
    const oldActive = await findActiveParsedReleaseMatch(tx, {
      tenantId: input.tenantId,
      parsedReleaseId: item.parsedRelease!.id
    });
    const providerTitle = await upsertProviderTitle(tx, selected);
    const mediaTitle = await upsertMediaTitleFromProviderTitle(tx, providerTitle);

    await confirmMediaTitleProviderLink(tx, {
      mediaTitleId: mediaTitle.id,
      providerTitleId: providerTitle.id,
      confidence: 1,
      source: "MANUAL"
    });

    const replacedMatchIds = await rejectActiveMatchedParsedReleaseMatches(tx, {
      tenantId: input.tenantId,
      parsedReleaseId: item.parsedRelease!.id,
      reason: "user_replaced_match"
    });

    if (oldActive?.status === "UNMATCHED") {
      await invalidateActiveReleaseDecisions(tx, {
        tenantId: input.tenantId,
        parsedReleaseId: item.parsedRelease!.id,
        staleReason: "manual_provider_identity"
      });
    }

    const next = await createMatchedParsedReleaseMatch(tx, {
      tenantId: input.tenantId,
      parsedReleaseId: item.parsedRelease!.id,
      mediaTitleId: mediaTitle.id,
      providerTitleId: providerTitle.id,
      mediaType: mediaTitle.mediaType,
      source: "MANUAL",
      confidence: 1,
      reason: "manual_provider_identity",
      replaceActive: false
    });

    if (replacedMatchIds.length > 0) {
      await db(tx).parsedReleaseMatch.updateMany({
        where: { id: { in: replacedMatchIds } },
        data: { replacedByMatchId: next.id }
      });
    }

    return next;
  });
}

export async function upsertProviderTitle(tx: Transaction, result: ProviderTitleResult) {
  const payload = toPrismaJson(result.payload);
  const payloadHash = hashJson(payload);

  return db(tx).providerTitle.upsert({
    where: {
      provider_providerEntityType_providerId: {
        provider: result.provider,
        providerEntityType: result.providerEntityType,
        providerId: result.providerId
      }
    },
    create: {
      provider: result.provider,
      providerEntityType: result.providerEntityType,
      providerId: result.providerId,
      mediaType: result.mediaType,
      title: result.title,
      normalizedTitle: result.normalizedTitle || normalizeTitle(result.title),
      originalTitle: result.originalTitle,
      releaseYear: result.releaseYear,
      endYear: result.endYear,
      language: result.language,
      region: result.region,
      payload,
      payloadHash,
      ratingValue: result.ratingValue,
      ratingScale: result.ratingScale,
      ratingVoteCount: result.ratingVoteCount,
      ratingType: providerRatingType(result.ratingType)
    },
    update: {
      mediaType: result.mediaType,
      title: result.title,
      normalizedTitle: result.normalizedTitle || normalizeTitle(result.title),
      originalTitle: result.originalTitle,
      releaseYear: result.releaseYear,
      endYear: result.endYear,
      language: result.language,
      region: result.region,
      payload,
      payloadHash,
      ratingValue: result.ratingValue,
      ratingScale: result.ratingScale,
      ratingVoteCount: result.ratingVoteCount,
      ratingType: providerRatingType(result.ratingType),
      fetchedAt: new Date()
    }
  });
}

export async function upsertMediaTitleFromProviderTitle(
  tx: Transaction,
  providerTitle: Prisma.ProviderTitleGetPayload<{}>
) {
  const existingLink = await db(tx).mediaTitleProviderLink.findUnique({
    where: { providerTitleId: providerTitle.id },
    include: { mediaTitle: true }
  });
  if (existingLink?.mediaTitle) return existingLink.mediaTitle;

  const normalizedTitle = providerTitle.normalizedTitle || normalizeTitle(providerTitle.title);
  if (providerTitle.releaseYear != null) {
    await lockKnownYearMediaTitleWrites(tx, {
      mediaType: providerTitle.mediaType,
      normalizedTitle,
      releaseYear: providerTitle.releaseYear
    });
  }

  const existing = await db(tx).mediaTitle.findFirst({
    where: {
      mediaType: providerTitle.mediaType,
      normalizedTitle,
      releaseYear: providerTitle.releaseYear ?? null
    },
    orderBy: { createdAt: "asc" }
  });
  if (existing) return existing;

  return db(tx).mediaTitle.create({
    data: {
      mediaType: providerTitle.mediaType,
      canonicalTitle: providerTitle.title,
      normalizedTitle,
      originalTitle: providerTitle.originalTitle,
      releaseYear: providerTitle.releaseYear,
      endYear: providerTitle.endYear
    }
  });
}

export async function confirmMediaTitleProviderLink(
  tx: Transaction,
  input: {
    mediaTitleId: string;
    providerTitleId: string;
    confidence: number;
    source: "MANUAL" | "PROVIDER_CROSSREF" | "SEARCH_MATCH" | "IMPORT";
  }
) {
  const [mediaTitle, providerTitle] = await Promise.all([
    db(tx).mediaTitle.findUnique({ where: { id: input.mediaTitleId } }),
    db(tx).providerTitle.findUnique({ where: { id: input.providerTitleId } })
  ]);
  if (!mediaTitle || !providerTitle) throw notFound("Media/provider title");
  if (mediaTitle.mediaType !== providerTitle.mediaType) {
    throw conflict("MEDIA_TYPE_MISMATCH", "Provider title media type must match canonical title");
  }

  const existing = await db(tx).mediaTitleProviderLink.findUnique({
    where: { providerTitleId: input.providerTitleId }
  });
  if (existing && existing.mediaTitleId !== input.mediaTitleId) {
    throw conflict("PROVIDER_TITLE_ALREADY_LINKED", "Provider title is already linked to another media title");
  }

  return db(tx).mediaTitleProviderLink.upsert({
    where: { providerTitleId: input.providerTitleId },
    create: {
      mediaTitleId: input.mediaTitleId,
      providerTitleId: input.providerTitleId,
      mediaType: mediaTitle.mediaType,
      confidence: input.confidence,
      source: input.source,
      confirmedAt: new Date()
    },
    update: {
      confidence: input.confidence,
      source: input.source,
      confirmedAt: new Date()
    }
  });
}

export async function findActiveParsedReleaseMatch(
  tx: Transaction,
  input: { tenantId: string; parsedReleaseId: string }
): Promise<ActiveParsedReleaseMatch | null> {
  return db(tx).parsedReleaseMatch.findFirst({
    where: {
      tenantId: input.tenantId,
      parsedReleaseId: input.parsedReleaseId,
      status: { in: [...ACTIVE_STATUSES] },
      invalidatedAt: null
    },
    include: {
      mediaTitle: {
        include: { providerLinks: { include: { providerTitle: true } } }
      },
      providerTitle: true
    },
    orderBy: [{ matchedAt: "desc" }, { updatedAt: "desc" }]
  });
}

export async function invalidateActiveReleaseDecisions(
  tx: Transaction,
  input: { tenantId: string; parsedReleaseId: string; staleReason: string }
) {
  return db(tx).parsedReleaseMatch.updateMany({
    where: {
      tenantId: input.tenantId,
      parsedReleaseId: input.parsedReleaseId,
      invalidatedAt: null,
      status: { in: [...ACTIVE_STATUSES] }
    },
    data: {
      invalidatedAt: new Date(),
      staleReason: input.staleReason
    }
  });
}

async function rejectActiveMatchedParsedReleaseMatches(
  tx: Transaction,
  input: { tenantId: string; parsedReleaseId: string; reason: string }
) {
  await lockParsedReleaseMatchWrites(tx, input);

  const activeMatches = await db(tx).parsedReleaseMatch.findMany({
    where: {
      tenantId: input.tenantId,
      parsedReleaseId: input.parsedReleaseId,
      status: "MATCHED",
      invalidatedAt: null
    },
    select: { id: true }
  });
  const ids = activeMatches.map((match: { id: string }) => match.id);
  if (ids.length === 0) return ids;

  await db(tx).parsedReleaseMatch.updateMany({
    where: { id: { in: ids } },
    data: {
      status: "REJECTED",
      reason: input.reason,
      rejectedAt: new Date()
    }
  });

  return ids;
}

export async function createUnmatchedParsedReleaseMatch(
  tx: Transaction,
  input: { tenantId: string; parsedReleaseId: string; reason: string }
) {
  assertMatchShape({ status: "UNMATCHED", reason: input.reason });
  await lockParsedReleaseMatchWrites(tx, input);

  const active = await findActiveParsedReleaseMatch(tx, input);
  if (active?.status === "UNMATCHED" && active.reason === input.reason) return active;

  await invalidateActiveReleaseDecisions(tx, {
    ...input,
    staleReason: input.reason
  });

  return db(tx).parsedReleaseMatch.create({
    data: {
      tenantId: input.tenantId,
      parsedReleaseId: input.parsedReleaseId,
      status: "UNMATCHED",
      source: "AUTO",
      reason: input.reason
    },
    include: { mediaTitle: true, providerTitle: true }
  });
}

export async function createMatchedParsedReleaseMatch(
  tx: Transaction,
  input: {
    tenantId: string;
    parsedReleaseId: string;
    mediaTitleId: string;
    providerTitleId: string;
    mediaType: MediaType;
    source: "AUTO" | "MANUAL";
    confidence: number;
    reason: string;
    replaceActive?: boolean;
  }
) {
  assertMatchShape({ status: "MATCHED", ...input });
  await lockParsedReleaseMatchWrites(tx, input);

  if (input.replaceActive !== false) {
    await invalidateActiveReleaseDecisions(tx, {
      tenantId: input.tenantId,
      parsedReleaseId: input.parsedReleaseId,
      staleReason: input.reason
    });
  }

  const link = await db(tx).mediaTitleProviderLink.findFirst({
    where: {
      mediaTitleId: input.mediaTitleId,
      providerTitleId: input.providerTitleId,
      mediaType: input.mediaType
    }
  });
  if (!link) {
    throw conflict("PROVIDER_TITLE_NOT_LINKED", "Matched provider title must be confirmed for the media title");
  }

  return db(tx).parsedReleaseMatch.create({
    data: {
      tenantId: input.tenantId,
      parsedReleaseId: input.parsedReleaseId,
      mediaTitleId: input.mediaTitleId,
      providerTitleId: input.providerTitleId,
      mediaType: input.mediaType,
      status: "MATCHED",
      source: input.source,
      confidence: input.confidence,
      reason: input.reason,
      matchedAt: new Date()
    },
    include: { mediaTitle: true, providerTitle: true }
  });
}

export async function invalidateMatchesForParsedRelease(input: {
  tenantId: string;
  parsedReleaseId: string;
  staleReason: string;
}) {
  return prisma.$transaction(async (tx) => {
    await lockParsedReleaseMatchWrites(tx, input);
    return invalidateActiveReleaseDecisions(tx, input);
  });
}

async function lockParsedReleaseMatchWrites(
  tx: Transaction,
  input: { tenantId: string; parsedReleaseId: string }
) {
  await lockTransactionKey(tx, `parsed-release-match:${input.tenantId}:${input.parsedReleaseId}`);
}

async function lockKnownYearMediaTitleWrites(
  tx: Transaction,
  input: { mediaType: string; normalizedTitle: string; releaseYear: number }
) {
  await lockTransactionKey(
    tx,
    `media-title:${input.mediaType}:${input.normalizedTitle}:${input.releaseYear}`
  );
}

async function lockTransactionKey(tx: Transaction, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

async function runProviderSearch(
  config: AppConfig,
  tenantId: string,
  providerId: MediaProvider,
  input: { title: string; mediaType: MediaType; year?: number }
) {
  try {
    const runtime = await resolveProviderRuntime(config, tenantId, providerId);
    if (!providerRuntimeAvailable(runtime)) {
      throw new Error(`${providerId.toUpperCase()} API key is not configured`);
    }
    return await runProviderSearchWithRuntime(providerId, runtime, input);
  } catch (error) {
    throw providerError(error);
  }
}

async function runProviderSearchWithRuntime(
  providerId: MediaProvider,
  runtime: ProviderRuntimeContext,
  input: { title: string; mediaType: MediaType; year?: number }
) {
  return getMetadataProvider(providerId).search(
    {
      title: input.title,
      mediaType: input.mediaType,
      year: input.year
    },
    { runtime }
  );
}

async function searchProviderTargets(
  config: AppConfig,
  tenantId: string,
  targets: Array<{ provider: MediaProvider; title: string; mediaType: MediaType; year?: number }>
) {
  const results: ProviderTitleResult[] = [];
  const errors: unknown[] = [];

  for (const target of targets) {
    try {
      results.push(...await runProviderSearch(config, tenantId, target.provider, {
        title: target.title,
        mediaType: target.mediaType,
        year: target.year
      }));
    } catch (error) {
      errors.push(error);
    }
  }

  if (results.length === 0 && errors.length === targets.length && errors.length > 0) {
    throw providerError(errors[0]);
  }

  return results;
}

async function providerSearchTargets(tenantId: string, mediaType?: ParsedMediaType) {
  if (mediaType && mediaType !== "UNKNOWN") {
    return (await getMatchingProviderOrder(tenantId, mediaType)).map((provider) => ({
      provider,
      mediaType
    }));
  }

  return getBroadSearchTargets(tenantId);
}

function dedupeProviderResults(results: ProviderTitleResult[]) {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = `${result.provider}:${result.providerEntityType}:${result.providerId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function runProviderDetailLookup(
  config: AppConfig,
  tenantId: string,
  providerId: MediaProvider,
  input: { providerEntityType: string; providerId: string; mediaType?: MediaType }
) {
  try {
    const runtime = await resolveProviderRuntime(config, tenantId, providerId);
    if (!providerRuntimeAvailable(runtime)) {
      throw new Error(`${providerId.toUpperCase()} API key is not configured`);
    }
    return await getMetadataProvider(providerId).fetchTitle(
      {
        providerEntityType: input.providerEntityType,
        providerId: input.providerId,
        mediaType: input.mediaType
      },
      { runtime }
    );
  } catch (error) {
    throw providerError(error);
  }
}

function providerError(error: unknown) {
  if (error instanceof AppError) return error;
  const message = redactSecrets(error instanceof Error ? error.message : String(error));
  if (/api key is not configured/i.test(message)) {
    return conflict("PROVIDER_NOT_CONFIGURED", "Add the provider API key before matching media");
  }
  return badGateway(message);
}

function isProviderLookupNotFound(error: unknown) {
  return error instanceof AppError && error.statusCode === 404;
}

function providerEntityTypeFor(provider: MediaProvider, mediaType: MediaType) {
  if (provider === "tmdb" && mediaType === "MOVIE") return "tmdb_movie";
  if (provider === "tmdb" && mediaType === "TV_SERIES") return "tmdb_tv";
  if (provider === "tvdb" && mediaType === "MOVIE") return "tvdb_movie";
  if (provider === "tvdb" && mediaType === "TV_SERIES") return "tvdb_series";
  if (provider === "ptgen") {
    throw conflict("UNSUPPORTED_PROVIDER_ENTITY", "PtGen detail lookup requires ptgen_imdb or ptgen_douban");
  }
  throw conflict("UNSUPPORTED_PROVIDER_ENTITY", `Provider ${provider} does not support ${mediaType} detail lookup yet`);
}

async function assertMediaTitleExists(mediaTitleId: string) {
  const media = await prisma.mediaTitle.findUnique({
    where: { id: mediaTitleId },
    select: { id: true, mediaType: true }
  });
  if (!media) throw notFound("Media title");
  return media;
}

function assertMatchShape(input: {
  status: "MATCHED" | "UNMATCHED";
  mediaTitleId?: string;
  providerTitleId?: string;
  confidence?: number;
  reason?: string;
}) {
  if (input.status === "MATCHED") {
    if (!input.mediaTitleId || !input.providerTitleId || input.confidence === undefined) {
      throw conflict("INVALID_MATCH_SHAPE", "Matched release decisions require mediaTitleId, providerTitleId, and confidence");
    }
    return;
  }

  if (!input.reason || input.mediaTitleId || input.providerTitleId) {
    throw conflict("INVALID_MATCH_SHAPE", "Unmatched release decisions require a reason and no title links");
  }
}

async function preloadPresentationOrders(
  tenantId: string,
  mediaTypes: Array<"MOVIE" | "TV_SERIES"> = ["MOVIE", "TV_SERIES"]
): Promise<PresentationOrders> {
  const unique = [...new Set(mediaTypes)];
  return Object.fromEntries(
    await Promise.all(unique.map(async (mediaType) => [
      mediaType,
      await getPresentationProviderOrder(tenantId, mediaType)
    ]))
  );
}

function concreteMediaTypeList(mediaType?: string | null): Array<"MOVIE" | "TV_SERIES"> | undefined {
  return mediaType === "MOVIE" || mediaType === "TV_SERIES" ? [mediaType] : undefined;
}

function serializeMediaTitle(media: any, presentationOrders: PresentationOrders = {}) {
  const presentation = serializeMediaPresentation({
    mediaTitle: media,
    providerTitle: media.selectedProviderTitle,
    providerLinks: media.providerLinks
  }, {
    providerOrder: providerOrderForMediaType(presentationOrders, media.mediaType)
  });

  return {
    id: media.id,
    mediaTitleId: media.id,
    kind: legacyKindFromMediaType(media.mediaType),
    mediaType: media.mediaType,
    title: presentation.title,
    originalTitle: presentation.originalTitle,
    year: presentation.releaseYear,
    releaseYear: presentation.releaseYear,
    overview: presentation.overview,
    posterUrl: presentation.posterUrl,
    backdropUrl: presentation.backdropUrl,
    displaySource: presentation.displaySource,
    rating: presentation.rating,
    hasCover: presentation.hasCover,
    createdAt: media.createdAt?.toISOString?.() ?? media.createdAt,
    updatedAt: media.updatedAt?.toISOString?.() ?? media.updatedAt,
    matchCount: media.matchCount,
    subscriptionCount: media.subscriptionCount
  };
}

function serializeItem(item: any, presentationOrders: PresentationOrders = {}) {
  const activeMatch = item.parsedRelease?.matches?.[0];
  return {
    id: item.id,
    feed: item.feed ? { id: item.feed.id, name: item.feed.name } : undefined,
    rawTitle: item.rawTitle,
    publishDate: item.publishDate?.toISOString?.() ?? item.publishDate,
    firstSeenAt: item.firstSeenAt?.toISOString?.() ?? item.firstSeenAt,
    sizeBytes: item.sizeBytes?.toString?.(),
    dedupeKeyType: item.dedupeKeyType,
    parsedRelease: item.parsedRelease ? serializeParsedRelease(item.parsedRelease) : undefined,
    enrichmentState: releaseEnrichmentState(item.parsedRelease, activeMatch),
    match: serializeReleaseMatch({
      match: activeMatch,
      release: item.parsedRelease,
      rawTitle: item.rawTitle,
      downloadJobs: item.downloadJobs
    }, {
      providerOrder: providerOrderForMediaType(
        presentationOrders,
        activeMatch?.mediaType ?? activeMatch?.mediaTitle?.mediaType ?? item.parsedRelease?.mediaType
      )
    }),
    downloadJobs: item.downloadJobs?.map((job: any) => ({
      id: job.id,
      status: job.status,
      error: job.error,
      clientHash: job.clientHash,
      createdAt: job.createdAt?.toISOString?.() ?? job.createdAt
    }))
  };
}

function releaseEnrichmentState(release: any, activeMatch: any) {
  if (!release) return "UNPARSED";
  if (activeMatch?.status === "MATCHED") return "MATCHED";
  if (activeMatch?.status === "UNMATCHED") return "UNMATCHED";
  return "PENDING";
}

function serializeParsedRelease(release: any) {
  return {
    id: release.id,
    title: release.title,
    year: release.year,
    kind: legacyKindFromMediaType(release.mediaType),
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
    confidence: release.parseConfidence,
    parseConfidence: release.parseConfidence,
    parsedAt: release.parsedAt?.toISOString?.() ?? release.parsedAt
  };
}

function itemRelations() {
  return {
    feed: { select: { id: true, name: true } },
    parsedRelease: {
      include: {
        matches: {
          where: {
            OR: [
              { status: ParsedReleaseMatchStatus.MATCHED },
              { status: ParsedReleaseMatchStatus.UNMATCHED }
            ],
            invalidatedAt: null
          },
          include: {
            mediaTitle: {
              include: { providerLinks: { include: { providerTitle: true } } }
            },
            providerTitle: true
          },
          orderBy: [{ matchedAt: "desc" as const }, { updatedAt: "desc" as const }],
          take: 1
        }
      }
    },
    downloadJobs: {
      orderBy: { createdAt: "desc" as const },
      take: 3,
      select: {
        id: true,
        status: true,
        error: true,
        clientHash: true,
        createdAt: true
      }
    }
  };
}

function providerRatingType(ratingType?: string) {
  if (ratingType === "user_score") return "USER_SCORE";
  if (ratingType === "critic_score") return "CRITIC_SCORE";
  if (ratingType === "popularity") return "POPULARITY";
  return undefined;
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function db(tx?: Transaction) {
  return (tx ?? prisma) as any;
}
