import { createHash } from "node:crypto";
import { ParsedReleaseMatchStatus, type Prisma } from "@prisma/client";
import { redactSecrets } from "@rss-media/shared/redact";
import { normalizeTitleKey } from "@rss-media/shared/titleNormalization";
import type { MediaProvider, MediaType, ParsedMediaType, ProviderSource, ProviderTitleResult } from "@rss-media/shared/types";
import type { AppConfig } from "../../config.js";
import { AppError, conflict, notFound, badGateway } from "../../core/errors.js";
import { prisma } from "../../db.js";
import {
  getMetadataProviders,
  getMetadataProvider
} from "../../integrations/providers/index.js";
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
  providerSource?: ProviderSource;
  provider?: ProviderSource;
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
      include: { providerIdentities: { include: { metadata: true } } };
    };
    mediaProviderIdentity: true;
    providerMediaMetadata: { include: { mediaProviderIdentity: true } };
    providerTitle: true;
  };
}>;

type ProviderMetadataCandidate = ProviderTitleResult & {
  providerSource: ProviderSource;
  provider: Exclude<MediaProvider, "ptgen">;
  providerId: string;
  titleKey: string;
  localeKey: string;
  titleAliases: string[];
};
const MIN_AUTO_MATCH_CONFIDENCE = 0.3;
type ParsedReleaseSnapshot = Pick<
  Prisma.ParsedReleaseGetPayload<{}>,
  | "id"
  | "tenantId"
  | "title"
  | "providerSearchTitles"
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
  const providerSource = canonicalProviderSource(query.providerSource ?? query.provider);
  const results = providerSource
    ? await runProviderSearch(config, tenantId, providerSource, {
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
  const providerSource = canonicalProviderSource(query.providerSource ?? query.provider);
  const metadataProviders = providerSource
    ? [getMetadataProvider(adapterIdForProviderSource(providerSource))]
    : getMetadataProviders();
  const probes = metadataProviders.flatMap((provider) =>
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
          return await runProviderDetailLookup(config, tenantId, canonicalProviderSource(probe.providerSource) ?? providerSourceForProbe(probe.provider, probe.providerEntityType) ?? "tmdb_api", {
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
    return dedupeProviderResults(results.filter((result): result is ProviderMetadataCandidate => Boolean(result)))
      .map(serializeProviderTitleSearchResult);
  }

  const hintedTargets = probes.flatMap((probe) => {
    const targetProviderSource =
      canonicalProviderSource(probe.providerSource) ?? providerSourceForProbe(probe.provider, probe.providerEntityType) ?? providerSource;
    if (!probe.searchQuery || !probe.mediaType || !targetProviderSource) return [];
    return [{
      providerSource: targetProviderSource,
      title: probe.searchQuery,
      mediaType: probe.mediaType,
      year: query.year
    }];
  });

  const targets = hintedTargets.length > 0
    ? hintedTargets
    : (providerSource
        ? explicitProviderSearchTargets(providerSource, query.mediaType)
        : await providerSearchTargets(tenantId, query.mediaType)
      ).map((target) => ({
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
            { titleKey: { contains: normalizedQuery, mode: "insensitive" } },
            { title: { contains: query.q, mode: "insensitive" } },
            {
              providerIdentities: {
                some: {
                  metadata: {
                    some: {
                      OR: [
                        { title: { contains: query.q, mode: "insensitive" } },
                        { originalTitle: { contains: query.q, mode: "insensitive" } }
                      ]
                    }
                  }
                }
              }
            }
          ]
        : undefined
    },
    include: {
      providerIdentities: {
        include: { metadata: true }
      },
      _count: { select: { releaseMatches: true, subscriptions: true } }
    },
    orderBy: [{ updatedAt: "desc" }, { title: "asc" }],
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
  const matches = await prisma.$queryRaw<Array<{
    mediaTitleId: string | null;
    providerMediaMetadataId: string | null;
    quality: string | null;
    releaseGroup: string | null;
    firstSeenAt: Date;
    feedId: string | null;
    feedName: string | null;
  }>>`
    SELECT
      m."mediaTitleId",
      m."providerMediaMetadataId",
      release."quality",
      release."releaseGroup",
      item."firstSeenAt",
      feed."id" AS "feedId",
      feed."name" AS "feedName"
    FROM "ParsedReleaseMatch" AS m
    JOIN "ParsedRelease" AS release
      ON release."id" = m."parsedReleaseId"
      AND release."tenantId" = m."tenantId"
    JOIN "RssItem" AS item
      ON item."id" = release."rssItemId"
      AND item."tenantId" = release."tenantId"
    LEFT JOIN "RssFeed" AS feed
      ON feed."id" = item."feedId"
      AND feed."tenantId" = item."tenantId"
    WHERE m."tenantId" = ${tenantId}
      AND m."status" = 'MATCHED'::"ParsedReleaseMatchStatus"
      AND m."invalidatedAt" IS NULL
      AND item."firstSeenAt" >= ${since}
    ORDER BY m."matchedAt" DESC NULLS LAST, m."updatedAt" DESC
  `;

  const grouped = new Map<string, any>();
  for (const match of matches) {
    if (!match.mediaTitleId) continue;
    const current = grouped.get(match.mediaTitleId) ?? {
      mediaTitleId: match.mediaTitleId,
      selectedProviderMediaMetadataId: match.providerMediaMetadataId,
      releaseCount: 0,
      latestReleaseAt: match.firstSeenAt,
      feeds: new Map<string, string>(),
      qualities: new Set<string>(),
      releaseGroups: new Set<string>()
    };
    current.releaseCount += 1;
    if (match.firstSeenAt > current.latestReleaseAt) {
      current.latestReleaseAt = match.firstSeenAt;
    }
    if (match.feedId && match.feedName) current.feeds.set(match.feedId, match.feedName);
    if (match.quality) current.qualities.add(match.quality);
    if (match.releaseGroup) current.releaseGroups.add(match.releaseGroup);
    grouped.set(match.mediaTitleId, current);
  }

  const topEntries = [...grouped.values()]
    .sort((a, b) => b.releaseCount - a.releaseCount || b.latestReleaseAt.getTime() - a.latestReleaseAt.getTime())
    .slice(0, query.limit);
  const mediaTitles = await prisma.mediaTitle.findMany({
    where: { id: { in: topEntries.map((entry) => entry.mediaTitleId) } },
    include: {
      providerIdentities: {
        include: { metadata: true }
      }
    }
  });
  const mediaById = new Map(mediaTitles.map((media) => [media.id, media]));
  const selectedMetadataIds = topEntries
    .map((entry) => entry.selectedProviderMediaMetadataId)
    .filter((id): id is string => Boolean(id));
  const selectedMetadata = selectedMetadataIds.length > 0
    ? await prisma.providerMediaMetadata.findMany({
        where: { id: { in: selectedMetadataIds } },
        include: { mediaProviderIdentity: true }
      })
    : [];
  const selectedMetadataById = new Map(selectedMetadata.map((metadata) => [metadata.id, metadata]));
  const presentationOrders = await preloadPresentationOrders(tenantId);
  return topEntries
    .filter((entry) => mediaById.has(entry.mediaTitleId))
    .map((entry) => ({
      media: serializeMediaTitle({
        ...mediaById.get(entry.mediaTitleId)!,
        selectedProviderMetadata: entry.selectedProviderMediaMetadataId
          ? selectedMetadataById.get(entry.selectedProviderMediaMetadataId)
          : undefined,
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
      providerIdentities: {
        include: { metadata: true }
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
    titleCandidates: release.providerSearchTitles,
    mediaType: release.mediaType,
    year: release.year ?? undefined,
    season: release.season ?? undefined,
    episode: release.episode ?? undefined
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

    const providerMetadata = await upsertProviderMediaMetadata(tx, selected.result, {
      linkConfidence: selected.result.matchConfidence ?? 0,
      linkSource: "SEARCH_MATCH"
    });
    const confidence = selected.result.matchConfidence ?? 0;

    return createMatchedParsedReleaseMatch(tx, {
      tenantId: input.tenantId,
      parsedReleaseId: releaseSnapshot.id,
      mediaTitleId: providerMetadata.mediaTitle.id,
      mediaProviderIdentityId: providerMetadata.identity.id,
      providerMediaMetadataId: providerMetadata.metadata.id,
      mediaType: providerMetadata.mediaTitle.mediaType,
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
  titleCandidates?: string[];
  year?: number;
  season?: number;
  episode?: number;
}) {
  let configured = 0;
  let missingReleaseYear = false;
  let providerFailed = false;
  let bestLowConfidenceResult: ProviderMetadataCandidate | undefined;
  const searchTitles = matchingSearchTitles(input.title, input.titleCandidates);
  const providerSourceOrder = await getMatchingProviderOrder(input.tenantId, input.mediaType);
  if (providerSourceOrder.length === 0) {
    return { reason: "provider_disabled_by_policy" };
  }

  for (const providerSource of providerSourceOrder) {
    const runtime = await resolveProviderRuntime(input.config, input.tenantId, providerSource);
    if (!providerRuntimeAvailable(runtime)) {
      continue;
    }
    configured += 1;

    for (const title of searchTitles) {
      let results: ProviderMetadataCandidate[];
      try {
        results = await runProviderSearchWithRuntime(providerSource, runtime, {
          title,
          mediaType: input.mediaType,
          year: input.year,
          season: input.season,
          episode: input.episode
        });
      } catch {
        providerFailed = true;
        break;
      }

      for (const result of results) {
        if (result.releaseYear == null) {
          missingReleaseYear = true;
          continue;
        }
        if (releaseYearIncompatible(input.mediaType, input.year, result.releaseYear)) {
          continue;
        }
        if ((result.matchConfidence ?? 0) < MIN_AUTO_MATCH_CONFIDENCE) {
          continue;
        }
        if ((result.matchConfidence ?? 0) < LOW_CONFIDENCE_THRESHOLD) {
          if (
            !bestLowConfidenceResult ||
            (result.matchConfidence ?? 0) > (bestLowConfidenceResult.matchConfidence ?? 0)
          ) {
            bestLowConfidenceResult = result;
          }
          continue;
        }
        return { result };
      }
    }
  }

  if (bestLowConfidenceResult) {
    return { result: bestLowConfidenceResult };
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

function releaseYearIncompatible(
  mediaType: MediaType,
  expectedYear?: number,
  actualYear?: number
) {
  if (expectedYear == null || actualYear == null) return false;
  if (mediaType === "TV_SERIES") {
    return expectedYear < actualYear;
  }
  return expectedYear !== actualYear;
}

function matchingSearchTitles(title: string, titleCandidates: string[] | undefined) {
  const titles: string[] = [];
  for (const candidate of [title, ...(titleCandidates ?? [])]) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    if (!titles.some((existing) => existing.localeCompare(trimmed, undefined, { sensitivity: "accent" }) === 0)) {
      titles.push(trimmed);
    }
    if (titles.length >= 5) break;
  }
  return titles;
}

function snapshotParsedRelease(release: ParsedReleaseSnapshot): ParsedReleaseSnapshot {
  return {
    id: release.id,
    tenantId: release.tenantId,
    title: release.title,
    providerSearchTitles: release.providerSearchTitles,
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
      providerSearchTitles: true,
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
    stringArraysEqual(expected.providerSearchTitles, current.providerSearchTitles),
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

function stringArraysEqual(left: string[] | null | undefined, right: string[] | null | undefined) {
  const leftValues = left ?? [];
  const rightValues = right ?? [];
  return leftValues.length === rightValues.length &&
    leftValues.every((value, index) => value === rightValues[index]);
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
  providerSource?: ProviderSource;
  provider?: MediaProvider;
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

  const providerSource = canonicalProviderSource(input.providerSource ?? input.provider);
  if (!providerSource) {
    throw conflict("UNSUPPORTED_PROVIDER_SOURCE", "Manual match requires a supported provider source");
  }
  const providerEntityType = input.providerEntityType ?? providerEntityTypeForSource(providerSource, input.mediaType);
  const selected = await runProviderDetailLookup(input.config, input.tenantId, providerSource, {
    providerEntityType,
    providerId: providerDetailIdForSource(providerSource, input.providerId),
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
    const providerMetadata = await upsertProviderMediaMetadata(tx, selected, {
      linkConfidence: 1,
      linkSource: "MANUAL"
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
      mediaTitleId: providerMetadata.mediaTitle.id,
      mediaProviderIdentityId: providerMetadata.identity.id,
      providerMediaMetadataId: providerMetadata.metadata.id,
      mediaType: providerMetadata.mediaTitle.mediaType,
      source: "MANUAL",
      confidence: 1,
      reason: "manual_provider_identity"
    });

    return next;
  });
}

export async function upsertProviderMediaMetadata(
  tx: Transaction,
  result: ProviderMetadataCandidate,
  input: {
    linkConfidence: number;
    linkSource: "MANUAL" | "PROVIDER_CROSSREF" | "SEARCH_MATCH" | "IMPORT";
  }
) {
  const payload = toPrismaJson(result.payload);
  const payloadHash = hashJson(payload);
  const mediaTitle = await upsertMediaTitleFromMetadata(tx, result);
  const identity = await db(tx).mediaProviderIdentity.upsert({
    where: {
      provider_providerId_mediaType: {
        provider: result.provider,
        providerId: result.providerId,
        mediaType: result.mediaType
      }
    },
    create: {
      mediaTitleId: mediaTitle.id,
      provider: result.provider,
      providerId: result.providerId,
      mediaType: result.mediaType,
      linkConfidence: input.linkConfidence,
      linkSource: input.linkSource,
      confirmedAt: new Date()
    },
    update: {
      mediaTitleId: mediaTitle.id,
      linkConfidence: input.linkConfidence,
      linkSource: input.linkSource,
      confirmedAt: new Date()
    }
  });

  const metadata = await db(tx).providerMediaMetadata.upsert({
    where: {
      mediaProviderIdentityId_providerSource_localeKey: {
        mediaProviderIdentityId: identity.id,
        providerSource: result.providerSource,
        localeKey: result.localeKey
      }
    },
    create: {
      mediaProviderIdentityId: identity.id,
      providerSource: result.providerSource,
      localeKey: result.localeKey,
      title: result.title,
      originalTitle: result.originalTitle,
      titleAliases: result.titleAliases,
      titleKey: result.titleKey,
      releaseYear: result.releaseYear,
      endYear: result.endYear,
      payload,
      payloadHash,
      ratingValue: result.ratingValue,
      ratingScale: result.ratingScale,
      ratingVoteCount: result.ratingVoteCount,
      ratingType: providerRatingType(result.ratingType)
    },
    update: {
      title: result.title,
      originalTitle: result.originalTitle,
      titleAliases: result.titleAliases,
      titleKey: result.titleKey,
      releaseYear: result.releaseYear,
      endYear: result.endYear,
      payload,
      payloadHash,
      ratingValue: result.ratingValue,
      ratingScale: result.ratingScale,
      ratingVoteCount: result.ratingVoteCount,
      ratingType: providerRatingType(result.ratingType),
      fetchedAt: new Date()
    },
    include: { mediaProviderIdentity: true }
  });

  return {
    mediaTitle,
    identity,
    metadata
  };
}

export async function upsertMediaTitleFromMetadata(
  tx: Transaction,
  result: Pick<ProviderMetadataCandidate, "mediaType" | "title" | "titleKey" | "releaseYear" | "endYear">
) {
  if (result.releaseYear != null) {
    await lockKnownYearMediaTitleWrites(tx, {
      mediaType: result.mediaType,
      normalizedTitle: result.titleKey,
      releaseYear: result.releaseYear
    });
  }

  const existing = await db(tx).mediaTitle.findFirst({
    where: {
      mediaType: result.mediaType,
      titleKey: result.titleKey,
      releaseYear: result.releaseYear ?? null
    },
    orderBy: { createdAt: "asc" }
  });
  if (existing) return existing;

  return db(tx).mediaTitle.create({
    data: {
      mediaType: result.mediaType,
      title: result.title,
      titleKey: result.titleKey,
      releaseYear: result.releaseYear,
      endYear: result.endYear
    }
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
      titleKey: normalizedTitle,
      releaseYear: providerTitle.releaseYear ?? null
    },
    orderBy: { createdAt: "asc" }
  });
  if (existing) return existing;

  return db(tx).mediaTitle.create({
    data: {
      mediaType: providerTitle.mediaType,
      title: providerTitle.title,
      titleKey: normalizedTitle,
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
        include: { providerIdentities: { include: { metadata: true } } }
      },
      mediaProviderIdentity: true,
      providerMediaMetadata: { include: { mediaProviderIdentity: true } },
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
    include: {
      mediaTitle: {
        include: { providerIdentities: { include: { metadata: true } } }
      },
      mediaProviderIdentity: true,
      providerMediaMetadata: { include: { mediaProviderIdentity: true } },
      providerTitle: true
    }
  });
}

export async function createMatchedParsedReleaseMatch(
  tx: Transaction,
  input: {
    tenantId: string;
    parsedReleaseId: string;
    mediaTitleId: string;
    mediaProviderIdentityId: string;
    providerMediaMetadataId: string;
    mediaType: MediaType;
    source: "AUTO" | "MANUAL";
    confidence: number;
    reason: string;
    replaceActive?: boolean;
  }
) {
  assertMatchShape({ status: "MATCHED", ...input });
  await lockParsedReleaseMatchWrites(tx, input);

  const active = await findActiveParsedReleaseMatch(tx, input);
  if (activeParsedReleaseMatchEquivalent(active, input)) {
    return active;
  }

  if (input.replaceActive !== false) {
    await invalidateActiveReleaseDecisions(tx, {
      tenantId: input.tenantId,
      parsedReleaseId: input.parsedReleaseId,
      staleReason: input.reason
    });
  }

  const identity = await db(tx).mediaProviderIdentity.findFirst({
    where: {
      id: input.mediaProviderIdentityId,
      mediaTitleId: input.mediaTitleId,
      mediaType: input.mediaType
    }
  });
  if (!identity) {
    throw conflict("PROVIDER_IDENTITY_NOT_LINKED", "Matched provider identity must be linked to the media title");
  }
  const metadata = await db(tx).providerMediaMetadata.findFirst({
    where: {
      id: input.providerMediaMetadataId,
      mediaProviderIdentityId: input.mediaProviderIdentityId
    },
    select: { id: true }
  });
  if (!metadata) {
    throw conflict("PROVIDER_METADATA_NOT_LINKED", "Matched provider metadata must belong to the provider identity");
  }

  return db(tx).parsedReleaseMatch.create({
    data: {
      tenantId: input.tenantId,
      parsedReleaseId: input.parsedReleaseId,
      mediaTitleId: input.mediaTitleId,
      mediaProviderIdentityId: input.mediaProviderIdentityId,
      providerMediaMetadataId: input.providerMediaMetadataId,
      mediaType: input.mediaType,
      status: "MATCHED",
      source: input.source,
      confidence: input.confidence,
      reason: input.reason,
      matchedAt: new Date()
    },
    include: {
      mediaTitle: {
        include: { providerIdentities: { include: { metadata: true } } }
      },
      mediaProviderIdentity: true,
      providerMediaMetadata: { include: { mediaProviderIdentity: true } },
      providerTitle: true
    }
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

function activeParsedReleaseMatchEquivalent(
  active: ActiveParsedReleaseMatch | null,
  input: {
    mediaTitleId: string;
    mediaProviderIdentityId: string;
    providerMediaMetadataId: string;
    mediaType: MediaType;
    source: "AUTO" | "MANUAL";
    confidence: number;
    reason: string;
  }
) {
  return Boolean(
    active &&
    active.status === "MATCHED" &&
    active.mediaTitleId === input.mediaTitleId &&
    active.mediaProviderIdentityId === input.mediaProviderIdentityId &&
    active.providerMediaMetadataId === input.providerMediaMetadataId &&
    active.mediaType === input.mediaType &&
    active.source === input.source &&
    active.confidence === input.confidence &&
    active.reason === input.reason
  );
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
  providerSource: ProviderSource,
  input: { title: string; mediaType: MediaType; year?: number; season?: number; episode?: number }
) {
  try {
    const normalizedProviderSource = canonicalProviderSource(providerSource) ?? providerSource;
    const runtime = await resolveProviderRuntime(config, tenantId, normalizedProviderSource);
    if (!providerRuntimeAvailable(runtime)) {
      throw new Error(`${normalizedProviderSource.toUpperCase()} API key is not configured`);
    }
    return await runProviderSearchWithRuntime(normalizedProviderSource, runtime, input);
  } catch (error) {
    throw providerError(error);
  }
}

async function runProviderSearchWithRuntime(
  providerSource: ProviderSource,
  runtime: ProviderRuntimeContext,
  input: { title: string; mediaType: MediaType; year?: number; season?: number; episode?: number }
) {
  const normalizedProviderSource = canonicalProviderSource(providerSource) ?? providerSource;
  const results = await getMetadataProvider(adapterIdForProviderSource(normalizedProviderSource)).search(
    {
      title: input.title,
      mediaType: input.mediaType,
      year: input.year,
      season: input.season,
      episode: input.episode,
      providerSource: normalizedProviderSource
    },
    { runtime }
  );
  return results.map((result) => normalizeProviderResult(result, normalizedProviderSource));
}

async function searchProviderTargets(
  config: AppConfig,
  tenantId: string,
  targets: Array<{ providerSource: ProviderSource; title: string; mediaType: MediaType; year?: number; season?: number; episode?: number }>
) {
  const results: ProviderMetadataCandidate[] = [];
  const errors: unknown[] = [];

  for (const target of targets) {
    try {
      results.push(...await runProviderSearch(config, tenantId, target.providerSource, {
        title: target.title,
        mediaType: target.mediaType,
        year: target.year,
        season: target.season,
        episode: target.episode
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
    return (await getMatchingProviderOrder(tenantId, mediaType)).map((providerSource) => ({
      providerSource,
      mediaType
    }));
  }

  return getBroadSearchTargets(tenantId);
}

function explicitProviderSearchTargets(providerSource: ProviderSource, mediaType?: ParsedMediaType) {
  const supportedMediaTypes = supportedMediaTypesForProviderSource(providerSource);
  const targetMediaTypes = mediaType && mediaType !== "UNKNOWN"
    ? supportedMediaTypes.filter((supportedType) => supportedType === mediaType)
    : supportedMediaTypes;

  return targetMediaTypes.map((supportedType) => ({
    providerSource,
    mediaType: supportedType
  }));
}

function dedupeProviderResults<T extends Pick<ProviderMetadataCandidate, "provider" | "providerSource" | "providerId" | "mediaType">>(results: T[]) {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = `${result.providerSource}:${result.provider}:${result.providerId}:${result.mediaType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function runProviderDetailLookup(
  config: AppConfig,
  tenantId: string,
  providerSource: ProviderSource,
  input: { providerEntityType: string; providerId: string; mediaType?: MediaType }
) {
  try {
    const normalizedProviderSource = canonicalProviderSource(providerSource) ?? providerSource;
    const runtime = await resolveProviderRuntime(config, tenantId, normalizedProviderSource);
    if (!providerRuntimeAvailable(runtime)) {
      throw new Error(`${normalizedProviderSource.toUpperCase()} API key is not configured`);
    }
    const result = await getMetadataProvider(adapterIdForProviderSource(normalizedProviderSource)).fetchTitle(
      {
        providerEntityType: input.providerEntityType,
        providerId: input.providerId,
        mediaType: input.mediaType,
        providerSource: normalizedProviderSource
      },
      { runtime }
    );
    return normalizeProviderResult(result, normalizedProviderSource);
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

function normalizeProviderResult(
  result: ProviderTitleResult,
  providerSource: ProviderSource
): ProviderMetadataCandidate {
  const providerId = normalizeProviderIdForSource(providerSource, result.providerId);
  const titleKey = result.normalizedTitle || normalizeTitle(result.title);
  const localeKey = result.localeKey ?? localeKeyFromParts(
    result.language ?? defaultLanguageForProviderSource(providerSource),
    result.region
  );

  return {
    ...result,
    providerSource,
    provider: providerForProviderSource(providerSource) as Exclude<MediaProvider, "ptgen">,
    providerId,
    normalizedTitle: titleKey,
    titleKey,
    localeKey,
    titleAliases: extractTitleAliases(result)
  };
}

function canonicalProviderSource(value?: string | null): ProviderSource | undefined {
  if (value === "tmdb_api" || value === "tvdb_api" || value === "ptgen_imdb" || value === "ptgen_douban") {
    return value;
  }
  if (value === "tmdb") return "tmdb_api";
  if (value === "tvdb") return "tvdb_api";
  if (value === "ptgen") return "ptgen_imdb";
  return undefined;
}

function providerSourceForProbe(provider?: string | null, providerEntityType?: string | null): ProviderSource | undefined {
  if (provider === "ptgen" && providerEntityType === "ptgen_douban") return "ptgen_douban";
  if (provider === "ptgen" && providerEntityType === "ptgen_imdb") return "ptgen_imdb";
  return canonicalProviderSource(provider);
}

function adapterIdForProviderSource(providerSource: ProviderSource) {
  if (providerSource === "tmdb_api") return "tmdb";
  if (providerSource === "tvdb_api") return "tvdb";
  return "ptgen";
}

function providerForProviderSource(providerSource: ProviderSource): MediaProvider {
  if (providerSource === "tmdb_api") return "tmdb";
  if (providerSource === "tvdb_api") return "tvdb";
  if (providerSource === "ptgen_douban") return "douban";
  return "imdb";
}

function defaultLanguageForProviderSource(providerSource: ProviderSource) {
  return providerSource === "ptgen_douban" ? "zh-CN" : "en-US";
}

function supportedMediaTypesForProviderSource(_providerSource: ProviderSource): readonly MediaType[] {
  return ["MOVIE", "TV_SERIES"];
}

function normalizeProviderIdForSource(providerSource: ProviderSource, providerId: string) {
  if (providerSource === "ptgen_imdb") {
    return providerId.replace(/^imdb-/i, "");
  }
  if (providerSource === "ptgen_douban") {
    return providerId.replace(/^douban-/i, "");
  }
  return providerId;
}

function localeKeyFromParts(language?: string | null, region?: string | null) {
  const normalizedLanguage = language?.trim();
  const normalizedRegion = region?.trim();
  if (normalizedLanguage && normalizedRegion) return `${normalizedLanguage}-${normalizedRegion}`;
  return normalizedLanguage || normalizedRegion || "und";
}

function extractTitleAliases(result: ProviderTitleResult) {
  const aliases = [
    ...(result.titleAliases ?? []),
    ...stringArrayFromPayload(result.payload, "aliases"),
    ...stringArrayFromPayload(result.payload, "titles")
  ];
  const blocked = new Set([
    result.title.toLowerCase(),
    result.originalTitle?.toLowerCase()
  ].filter(Boolean) as string[]);
  return [...new Set(
    aliases
      .map((value) => value.trim())
      .filter((value) => value && !blocked.has(value.toLowerCase()))
  )];
}

function stringArrayFromPayload(payload: unknown, key: string) {
  if (!payload || typeof payload !== "object") return [];
  const value = (payload as Record<string, unknown>)[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function providerEntityTypeForSource(providerSource: ProviderSource, mediaType: MediaType) {
  if (providerSource === "tmdb_api" && mediaType === "MOVIE") return "tmdb_movie";
  if (providerSource === "tmdb_api" && mediaType === "TV_SERIES") return "tmdb_tv";
  if (providerSource === "tvdb_api" && mediaType === "MOVIE") return "tvdb_movie";
  if (providerSource === "tvdb_api" && mediaType === "TV_SERIES") return "tvdb_series";
  if (providerSource === "ptgen_imdb") return "ptgen_imdb";
  if (providerSource === "ptgen_douban") return "ptgen_douban";
  throw conflict("UNSUPPORTED_PROVIDER_ENTITY", `Provider source ${providerSource} does not support ${mediaType} detail lookup yet`);
}

function providerDetailIdForSource(providerSource: ProviderSource, providerId: string) {
  if (providerSource === "ptgen_imdb") {
    const normalized = providerId.replace(/^imdb-/i, "");
    return normalized.startsWith("tt") ? `imdb-${normalized}` : `imdb-tt${normalized}`;
  }
  if (providerSource === "ptgen_douban") {
    return `douban-${providerId.replace(/^douban-/i, "")}`;
  }
  return providerId;
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
  mediaProviderIdentityId?: string;
  providerMediaMetadataId?: string;
  confidence?: number;
  reason?: string;
}) {
  if (input.status === "MATCHED") {
    if (!input.mediaTitleId || !input.mediaProviderIdentityId || !input.providerMediaMetadataId || input.confidence === undefined) {
      throw conflict("INVALID_MATCH_SHAPE", "Matched release decisions require mediaTitleId, mediaProviderIdentityId, providerMediaMetadataId, and confidence");
    }
    return;
  }

  if (!input.reason || input.mediaTitleId || input.mediaProviderIdentityId || input.providerMediaMetadataId) {
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
    providerMetadata: media.selectedProviderMetadata,
    providerIdentities: media.providerIdentities
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
              include: { providerIdentities: { include: { metadata: true } } }
            },
            mediaProviderIdentity: true,
            providerMediaMetadata: { include: { mediaProviderIdentity: true } },
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
  return normalizeTitleKey(value);
}

function db(tx?: Transaction) {
  return (tx ?? prisma) as any;
}
