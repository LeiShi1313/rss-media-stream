import { Prisma } from "@prisma/client";
import type {
  ItemDto,
  MediaDetailDto,
  MediaSearchResultDto,
  MediaTitleDto,
  ResolvedMediaTitleDto,
  TrendingMediaPageDto
} from "@rss-media/shared/apiContracts";
import { redactSecrets } from "@rss-media/shared/redact";
import { normalizeTitleKey } from "@rss-media/shared/titleNormalization";
import type { MediaProvider, MediaType, ParsedMediaType, ProviderSource, ProviderTitleResult } from "@rss-media/shared/types";
import type { AppConfig } from "../../config.js";
import { AppError, badRequest, conflict, notFound, badGateway } from "../../core/errors.js";
import { prisma } from "../../db.js";
import {
  getMetadataProviders,
  getMetadataProvider
} from "../../integrations/providers/index.js";
import {
  getProviderSourceDefinition,
  isProviderSource,
  providerSourceForLegacyProvider,
  providerSourceForLegacyProviderEntity
} from "../../integrations/providers/sources.js";
import {
  getBroadSearchTargets,
  getMatchingProviderOrder
} from "../../integrations/providers/policy.js";
import { providerRuntimeAvailable, resolveProviderRuntime } from "../../integrations/providers/runtime.js";
import { getActiveRatingProviderSources } from "../../integrations/providers/ratingPreference.js";
import {
  executeProviderSearch,
  type ProviderSearchLogger
} from "../../integrations/providers/searchExecution.js";
import { ProviderSearchSession } from "../../integrations/providers/searchSession.js";
import type {
  ProviderMetadataCandidate,
  ProviderRuntimeContext
} from "../../integrations/providers/types.js";
import {
  legacyKindFromMediaType,
  serializeMediaPresentation,
  serializeProviderTitleSearchResult
} from "./presentation.js";
import { itemRelations, serializeItem } from "../items/items.service.js";
import { LOW_CONFIDENCE_THRESHOLD } from "./matchingPolicy.js";
import { upsertProviderMediaMetadata } from "./providerIdentity.js";
import {
  assertParsedReleaseSnapshotCurrent,
  createMatchedParsedReleaseMatch,
  createUnmatchedParsedReleaseMatch,
  invalidateActiveReleaseDecisions,
  lockAndFindActiveParsedReleaseMatch,
  snapshotParsedRelease
} from "./releaseMatchLedger.js";
import {
  EMPTY_PRESENTATION_PREFERENCES,
  loadPresentationPreferences,
  presentationOptionsForMediaType,
  type PresentationPreferences
} from "./presentationPreferences.js";
import type {
  localMediaSearchQuerySchema,
  mediaSearchQuerySchema,
  providerTitleResolveSchema,
  trendingMediaQuerySchema
} from "./media.schemas.js";
import type { z } from "zod";

type MediaSearchQuery = z.infer<typeof mediaSearchQuerySchema>;
type ConcreteMediaType = "MOVIE" | "TV_SERIES";
type ProviderTitleResolveInput = z.infer<typeof providerTitleResolveSchema>;
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
type TrendingCursor = {
  timestamp: string;
  windowDays: number;
  mediaType?: ConcreteMediaType;
  releaseCount: number;
  latestReleaseAt: string;
  mediaTitleId: string;
};
type TrendingMediaRow = {
  mediaTitleId: string;
  providerMediaMetadataId: string | null;
  releaseCount: number;
  latestReleaseAt: Date;
  feedCount: number;
  feeds: string[];
  qualities: string[];
  releaseGroups: string[];
};
const MIN_AUTO_MATCH_CONFIDENCE = 0.3;

export async function searchExternalMedia(
  config: AppConfig,
  tenantId: string,
  query: MediaSearchQuery,
  logger?: ProviderSearchLogger
): Promise<MediaSearchResultDto[]> {
  const providerSource = canonicalProviderSource(query.providerSource ?? query.provider);
  const targets = (providerSource
    ? [{ providerSource, mediaType: query.mediaType }]
    : await providerSearchTargets(tenantId, query.mediaType)
  ).map((target) => ({
    ...target,
    title: query.q,
    year: query.year
  }));
  const results = await searchProviderTargets(config, tenantId, targets, logger);

  return dedupeProviderResults(results).map(serializeProviderTitleSearchResult);
}

export async function smartSearchExternalMedia(
  config: AppConfig,
  tenantId: string,
  query: SmartProviderTitleSearchInput,
  logger?: ProviderSearchLogger
): Promise<MediaSearchResultDto[]> {
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

  const results = await searchProviderTargets(config, tenantId, targets, logger);
  return dedupeProviderResults(results).map(serializeProviderTitleSearchResult);
}

export async function resolveProviderMediaTitle(
  config: AppConfig,
  tenantId: string,
  input: ProviderTitleResolveInput
): Promise<ResolvedMediaTitleDto> {
  const providerSource = canonicalProviderSource(input.providerSource);
  if (!providerSource) {
    throw conflict("UNSUPPORTED_PROVIDER_SOURCE", "Provider title resolution requires a supported provider source");
  }
  const providerEntityType = input.providerEntityType ?? providerEntityTypeForSource(providerSource, input.mediaType);
  const selected = await runProviderDetailLookup(config, tenantId, providerSource, {
    providerEntityType,
    providerId: providerDetailIdForSource(providerSource, input.providerId),
    mediaType: input.mediaType
  });

  const resolved = await prisma.$transaction(async (tx) =>
    upsertProviderMediaMetadata(tx, selected, {
      linkConfidence: 1,
      linkSource: "MANUAL"
    })
  );
  const presentationPreferences = await loadPresentationPreferences(
    tenantId,
    concreteMediaTypeList(resolved.mediaTitle.mediaType)
  );
  const presentation = serializeMediaPresentation({
    mediaTitle: resolved.mediaTitle,
    providerMetadata: resolved.metadata
  }, presentationOptionsForMediaType(presentationPreferences, resolved.mediaTitle.mediaType));

  return {
    mediaTitleId: resolved.mediaTitle.id,
    mediaType: resolved.mediaTitle.mediaType as ResolvedMediaTitleDto["mediaType"],
    title: presentation.title,
    originalTitle: presentation.originalTitle,
    year: presentation.releaseYear,
    posterUrl: presentation.posterUrl,
    hasCover: presentation.hasCover,
    provider: resolved.identity.provider,
    providerSource: selected.providerSource,
    providerEntityType: selected.providerEntityType,
    providerId: resolved.identity.providerId,
    presentation
  };
}

export async function searchLocalMedia(
  tenantId: string,
  query: LocalMediaSearchQuery
): Promise<MediaTitleDto[]> {
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

  const presentationPreferences = await loadPresentationPreferences(
    tenantId,
    query.mediaType ? [query.mediaType] : undefined
  );
  return media.map((item) =>
    serializeMediaTitle({
      ...item,
      matchCount: item._count.releaseMatches,
      subscriptionCount: item._count.subscriptions
    }, presentationPreferences)
  );
}

export async function listTrendingMedia(
  tenantId: string,
  query: TrendingMediaQuery
): Promise<TrendingMediaPageDto> {
  const cursor = decodeTrendingCursor(query.cursor);
  const mediaType = effectiveTrendingMediaType(query.mediaType, cursor);
  const windowDays = effectiveTrendingWindowDays(query.windowDays, cursor);
  const timestamp = cursor ? parseCursorDate(cursor.timestamp, "timestamp") : new Date();
  const since = new Date(timestamp.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const take = query.limit + 1;
  const latestReleaseAtCursor = cursor ? parseCursorDate(cursor.latestReleaseAt, "latestReleaseAt") : undefined;
  const mediaTypeFilter = mediaType
    ? Prisma.sql`AND media."mediaType" = ${mediaType}::"MediaType"`
    : Prisma.empty;
  const cursorFilter = cursor && latestReleaseAtCursor
    ? Prisma.sql`
      WHERE
        grouped."releaseCount" < ${cursor.releaseCount}
        OR (
          grouped."releaseCount" = ${cursor.releaseCount}
          AND grouped."latestReleaseAt" < ${latestReleaseAtCursor}
        )
        OR (
          grouped."releaseCount" = ${cursor.releaseCount}
          AND grouped."latestReleaseAt" = ${latestReleaseAtCursor}
          AND grouped."mediaTitleId" > ${cursor.mediaTitleId}
        )
    `
    : Prisma.empty;
  const rows = await prisma.$queryRaw<TrendingMediaRow[]>`
    WITH base AS (
      SELECT
        m."mediaTitleId",
        m."providerMediaMetadataId",
        m."matchedAt",
        m."updatedAt" AS "matchUpdatedAt",
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
      JOIN "MediaTitle" AS media
        ON media."id" = m."mediaTitleId"
      LEFT JOIN "RssFeed" AS feed
        ON feed."id" = item."feedId"
        AND feed."tenantId" = item."tenantId"
      WHERE m."tenantId" = ${tenantId}
        AND m."status" = 'MATCHED'::"ParsedReleaseMatchStatus"
        AND m."invalidatedAt" IS NULL
        AND m."mediaTitleId" IS NOT NULL
        AND item."firstSeenAt" >= ${since}
        AND item."firstSeenAt" <= ${timestamp}
        ${mediaTypeFilter}
    ),
    grouped AS (
      SELECT
        base."mediaTitleId",
        (array_agg(base."providerMediaMetadataId" ORDER BY base."matchedAt" DESC NULLS LAST, base."matchUpdatedAt" DESC)
          FILTER (WHERE base."providerMediaMetadataId" IS NOT NULL))[1] AS "providerMediaMetadataId",
        count(*)::int AS "releaseCount",
        max(base."firstSeenAt") AS "latestReleaseAt",
        count(DISTINCT base."feedId") FILTER (WHERE base."feedId" IS NOT NULL)::int AS "feedCount",
        COALESCE(array_remove(array_agg(DISTINCT base."feedName"), NULL), ARRAY[]::text[]) AS "feeds",
        COALESCE(array_remove(array_agg(DISTINCT base."quality"), NULL), ARRAY[]::text[]) AS "qualities",
        COALESCE(array_remove(array_agg(DISTINCT base."releaseGroup"), NULL), ARRAY[]::text[]) AS "releaseGroups"
      FROM base
      GROUP BY base."mediaTitleId"
    )
    SELECT *
    FROM grouped
    ${cursorFilter}
    ORDER BY grouped."releaseCount" DESC, grouped."latestReleaseAt" DESC, grouped."mediaTitleId" ASC
    LIMIT ${take}
  `;

  const topEntries = rows.slice(0, query.limit);
  const lastEntry = topEntries.at(-1);
  const nextCursor = rows.length > query.limit && lastEntry
    ? encodeTrendingCursor({
        timestamp: timestamp.toISOString(),
        windowDays,
        mediaType,
        releaseCount: lastEntry.releaseCount,
        latestReleaseAt: lastEntry.latestReleaseAt.toISOString(),
        mediaTitleId: lastEntry.mediaTitleId
      })
    : undefined;
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
    .map((entry) => entry.providerMediaMetadataId)
    .filter((id): id is string => Boolean(id));
  const selectedMetadata = selectedMetadataIds.length > 0
    ? await prisma.providerMediaMetadata.findMany({
        where: { id: { in: selectedMetadataIds } },
        include: { mediaProviderIdentity: true }
      })
    : [];
  const selectedMetadataById = new Map(selectedMetadata.map((metadata) => [metadata.id, metadata]));
  const presentationPreferences = await loadPresentationPreferences(
    tenantId,
    mediaType ? [mediaType] : undefined
  );
  const items = topEntries
    .filter((entry) => mediaById.has(entry.mediaTitleId))
    .map((entry) => ({
      media: serializeMediaTitle({
        ...mediaById.get(entry.mediaTitleId)!,
        selectedProviderMetadata: entry.providerMediaMetadataId
          ? selectedMetadataById.get(entry.providerMediaMetadataId)
          : undefined,
        matchCount: entry.releaseCount
      }, presentationPreferences),
      releaseCount: entry.releaseCount,
      latestReleaseAt: entry.latestReleaseAt.toISOString(),
      feedCount: entry.feedCount,
      feeds: entry.feeds.slice(0, 6),
      qualities: entry.qualities.slice(0, 8),
      releaseGroups: entry.releaseGroups.slice(0, 8)
    }));

  return { items, nextCursor };
}

function decodeTrendingCursor(value?: string): TrendingCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<TrendingCursor>;
    if (
      typeof parsed.timestamp !== "string" ||
      typeof parsed.windowDays !== "number" ||
      !Number.isInteger(parsed.windowDays) ||
      parsed.windowDays < 1 ||
      parsed.windowDays > 365 ||
      (parsed.mediaType !== undefined && !isConcreteMediaType(parsed.mediaType)) ||
      typeof parsed.releaseCount !== "number" ||
      !Number.isInteger(parsed.releaseCount) ||
      parsed.releaseCount < 0 ||
      typeof parsed.latestReleaseAt !== "string" ||
      typeof parsed.mediaTitleId !== "string" ||
      parsed.mediaTitleId.length === 0
    ) {
      throw new Error("Invalid cursor payload");
    }
    parseCursorDate(parsed.timestamp, "timestamp");
    parseCursorDate(parsed.latestReleaseAt, "latestReleaseAt");
    return parsed as TrendingCursor;
  } catch {
    throw badRequest("Invalid trending cursor");
  }
}

function encodeTrendingCursor(cursor: TrendingCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function effectiveTrendingMediaType(
  queryMediaType: ConcreteMediaType | undefined,
  cursor?: TrendingCursor
): ConcreteMediaType | undefined {
  if (queryMediaType && cursor?.mediaType && queryMediaType !== cursor.mediaType) {
    throw badRequest("Trending cursor media type does not match query");
  }
  return cursor?.mediaType ?? queryMediaType;
}

function effectiveTrendingWindowDays(queryWindowDays: number, cursor?: TrendingCursor) {
  return cursor?.windowDays ?? queryWindowDays;
}

function parseCursorDate(value: string, field: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw badRequest(`Invalid trending cursor ${field}`);
  }
  return date;
}

function isConcreteMediaType(value: unknown): value is ConcreteMediaType {
  return value === "MOVIE" || value === "TV_SERIES";
}

export async function getMedia(
  tenantId: string,
  mediaTitleId: string
): Promise<MediaTitleDto> {
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

  const presentationPreferences = await loadPresentationPreferences(
    tenantId,
    concreteMediaTypeList(media.mediaType)
  );
  return serializeMediaTitle({
    ...media,
    matchCount: media._count.releaseMatches,
    subscriptionCount: media._count.subscriptions
  }, presentationPreferences);
}

export async function listMediaItems(
  tenantId: string,
  mediaTitleId: string
): Promise<ItemDto[]> {
  const media = await assertMediaTitleExists(mediaTitleId);
  const presentationPreferences = await loadPresentationPreferences(
    tenantId,
    concreteMediaTypeList(media.mediaType)
  );

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
    include: itemRelations
  });

  return items.map((item) => serializeItem(item, presentationPreferences));
}

export async function getMediaDetail(
  tenantId: string,
  mediaTitleId: string
): Promise<MediaDetailDto> {
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
      await assertParsedReleaseSnapshotCurrent(tx, releaseSnapshot);

      return createUnmatchedParsedReleaseMatch(tx, {
        tenantId: input.tenantId,
        parsedReleaseId: releaseSnapshot.id,
        reason: "unknown_media_type"
      });
    });
  }

  const searchSession = new ProviderSearchSession(runProviderSearchWithRuntime);
  const ratingCandidatePromise = resolveRatingEnrichmentCandidate({
    config: input.config,
    tenantId: input.tenantId,
    title: release.title,
    titleCandidates: release.providerSearchTitles,
    mediaType: release.mediaType,
    year: release.year ?? undefined,
    season: release.season ?? undefined,
    episode: release.episode ?? undefined,
    searchSession
  }).catch(() => undefined);
  const selected = await selectProviderTitleCandidate({
    config: input.config,
    tenantId: input.tenantId,
    title: release.title,
    titleCandidates: release.providerSearchTitles,
    mediaType: release.mediaType,
    year: release.year ?? undefined,
    season: release.season ?? undefined,
    episode: release.episode ?? undefined,
    searchSession
  });

  if (!selected.result) {
    return prisma.$transaction(async (tx) => {
      await assertParsedReleaseSnapshotCurrent(tx, releaseSnapshot);

      return createUnmatchedParsedReleaseMatch(tx, {
        tenantId: input.tenantId,
        parsedReleaseId: releaseSnapshot.id,
        reason: selected.reason
      });
    });
  }

  const persistedMatch = await prisma.$transaction(async (tx) => {
    await assertParsedReleaseSnapshotCurrent(tx, releaseSnapshot);

    const providerMetadata = await upsertProviderMediaMetadata(tx, selected.result, {
      linkConfidence: selected.result.matchConfidence ?? 0,
      linkSource: "SEARCH_MATCH"
    });
    const confidence = selected.result.matchConfidence ?? 0;

    const match = await createMatchedParsedReleaseMatch(tx, {
      tenantId: input.tenantId,
      parsedReleaseId: releaseSnapshot.id,
      mediaTitleId: providerMetadata.mediaTitle.id,
      mediaProviderIdentityId: providerMetadata.identity.id,
      providerMediaMetadataId: providerMetadata.metadata.id,
      // upsertProviderMediaMetadata guarantees mediaTitle.mediaType === selected.result.mediaType
      mediaType: selected.result.mediaType,
      source: "AUTO",
      confidence,
      reason: confidence < LOW_CONFIDENCE_THRESHOLD
        ? "automatic_low_confidence_match"
        : "automatic_match"
    });
    return { match, mediaTitleId: providerMetadata.mediaTitle.id };
  });

  void ratingCandidatePromise.then((resolvedRating) => persistResolvedRatingCandidate({
    mediaTitleId: persistedMatch.mediaTitleId,
    selectedProviderSource: selected.result.providerSource,
    selectedConfidence: selected.result.matchConfidence ?? 0,
    resolvedRating
  }));
  return persistedMatch.match;
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
  searchSession: ProviderSearchSession;
}) {
  let configured = 0;
  let missingReleaseYear = false;
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

    for (const searchTitle of searchTitles) {
      let results: ProviderMetadataCandidate[];
      try {
        results = await input.searchSession.search(providerSource, runtime, {
          title: searchTitle.title,
          titleSource: searchTitle.titleSource,
          mediaType: input.mediaType,
          year: input.year,
          season: input.season,
          episode: input.episode
        });
      } catch {
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
        : "no_result"
  };
}

async function resolveRatingEnrichmentCandidate(input: {
  config: AppConfig;
  tenantId: string;
  mediaType: MediaType;
  title: string;
  titleCandidates?: string[];
  year?: number;
  season?: number;
  episode?: number;
  searchSession: ProviderSearchSession;
}) {
  const ratingProviderSource = (await getActiveRatingProviderSources(
    input.tenantId,
    [input.mediaType]
  ))[input.mediaType];
  if (!ratingProviderSource) return undefined;

  return resolveRatingCandidateForSource({
    ...input,
    ratingProviderSource
  });
}

async function resolveRatingCandidateForSource(input: {
  config: AppConfig;
  tenantId: string;
  mediaType: MediaType;
  title: string;
  titleCandidates?: string[];
  year?: number;
  season?: number;
  episode?: number;
  searchSession: ProviderSearchSession;
  ratingProviderSource: ProviderSource;
}) {
  const { ratingProviderSource } = input;

  const runtime = await resolveProviderRuntime(input.config, input.tenantId, ratingProviderSource);
  if (!providerRuntimeAvailable(runtime)) return { providerSource: ratingProviderSource };

  for (const searchTitle of matchingSearchTitles(input.title, input.titleCandidates)) {
    const results = await input.searchSession.search(ratingProviderSource, runtime, {
      title: searchTitle.title,
      titleSource: searchTitle.titleSource,
      mediaType: input.mediaType,
      year: input.year,
      season: input.season,
      episode: input.episode
    });
    const candidate = results.find((result) => strictRatingCandidateMatches({
      result,
      searchTitle: searchTitle.title,
      mediaType: input.mediaType,
      year: input.year
    }));
    if (candidate) return { providerSource: ratingProviderSource, candidate };
  }

  return { providerSource: ratingProviderSource };
}

export async function enrichMediaTitleRating(input: {
  config: AppConfig;
  tenantId: string;
  mediaTitleId: string;
  mediaType: MediaType;
  title: string;
  titleCandidates?: string[];
  year?: number;
  season?: number;
  episode?: number;
  ratingProviderSource: ProviderSource;
  selectedProviderSource?: ProviderSource;
  selectedConfidence?: number;
}) {
  try {
    const resolvedRating = await resolveRatingCandidateForSource({
      ...input,
      searchSession: new ProviderSearchSession(runProviderSearchWithRuntime)
    });
    return persistResolvedRatingCandidate({
      mediaTitleId: input.mediaTitleId,
      selectedProviderSource: input.selectedProviderSource,
      selectedConfidence: input.selectedConfidence,
      resolvedRating
    });
  } catch {
    return false;
  }
}

function strictRatingCandidateMatches(input: {
  result: ProviderMetadataCandidate;
  searchTitle: string;
  mediaType: MediaType;
  year?: number;
}) {
  const { result } = input;
  if (
    result.mediaType !== input.mediaType ||
    typeof result.ratingValue !== "number" ||
    typeof result.ratingScale !== "number" ||
    result.ratingScale <= 0 ||
    !result.ratingType ||
    input.year == null ||
    result.releaseYear == null ||
    releaseYearIncompatible(input.mediaType, input.year, result.releaseYear)
  ) {
    return false;
  }

  const searchTitleKey = normalizeTitle(input.searchTitle);
  return [result.titleKey, result.normalizedTitle, result.originalTitle, ...result.titleAliases]
    .filter((title): title is string => Boolean(title))
    .some((title) => normalizeTitle(title) === searchTitleKey);
}

async function persistResolvedRatingCandidate(input: {
  mediaTitleId?: string | null;
  selectedProviderSource?: ProviderSource;
  selectedConfidence?: number;
  resolvedRating?: {
    providerSource: ProviderSource;
    candidate?: ProviderMetadataCandidate;
  };
}) {
  const resolvedRating = input.resolvedRating;
  const candidate = resolvedRating?.candidate;
  const mediaTitleId = input.mediaTitleId;
  if (
    !mediaTitleId ||
    !resolvedRating ||
    !candidate ||
    resolvedRating.providerSource === input.selectedProviderSource ||
    (input.selectedProviderSource !== undefined &&
      (input.selectedConfidence ?? 0) < LOW_CONFIDENCE_THRESHOLD)
  ) {
    return false;
  }

  try {
    await prisma.$transaction((tx) => upsertProviderMediaMetadata(tx, candidate, {
      linkConfidence: 1,
      linkSource: "SEARCH_MATCH",
      mediaTitleId
    }));
    return true;
  } catch {
    // Rating enrichment is best-effort and must not change a completed release match.
    return false;
  }
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

type MatchingSearchTitle = {
  title: string;
  titleSource: "parsed_title" | "provider_search_title";
};

function matchingSearchTitles(title: string, titleCandidates: string[] | undefined) {
  const titles: MatchingSearchTitle[] = [];
  const candidates: MatchingSearchTitle[] = [
    { title, titleSource: "parsed_title" },
    ...(titleCandidates ?? []).map((candidate) => ({
      title: candidate,
      titleSource: "provider_search_title" as const
    }))
  ];
  for (const candidate of candidates) {
    const trimmed = candidate.title.trim();
    if (!trimmed) continue;
    if (!titles.some((existing) => existing.title.localeCompare(trimmed, undefined, { sensitivity: "accent" }) === 0)) {
      titles.push({ ...candidate, title: trimmed });
    }
    if (titles.length >= 5) break;
  }
  return titles;
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

  const persistedMatch = await prisma.$transaction(async (tx) => {
    const oldActive = await lockAndFindActiveParsedReleaseMatch(tx, {
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
      // upsertProviderMediaMetadata guarantees mediaTitle.mediaType === selected.mediaType
      mediaType: selected.mediaType,
      source: "MANUAL",
      confidence: 1,
      reason: "manual_provider_identity"
    });

    return { match: next, mediaTitleId: providerMetadata.mediaTitle.id };
  });

  void enrichPreferredRatingForMediaTitle({
    config: input.config,
    tenantId: input.tenantId,
    mediaTitleId: persistedMatch.mediaTitleId,
    mediaType: selected.mediaType,
    title: item.parsedRelease.title,
    titleCandidates: item.parsedRelease.providerSearchTitles,
    year: item.parsedRelease.year ?? undefined,
    season: item.parsedRelease.season ?? undefined,
    episode: item.parsedRelease.episode ?? undefined,
    selectedProviderSource: selected.providerSource
  });
  return persistedMatch.match;
}

async function enrichPreferredRatingForMediaTitle(input: {
  config: AppConfig;
  tenantId: string;
  mediaTitleId: string;
  mediaType: MediaType;
  title: string;
  titleCandidates?: string[];
  year?: number;
  season?: number;
  episode?: number;
  selectedProviderSource: ProviderSource;
}) {
  try {
    const ratingProviderSource = (await getActiveRatingProviderSources(
      input.tenantId,
      [input.mediaType]
    ))[input.mediaType];
    if (!ratingProviderSource || ratingProviderSource === input.selectedProviderSource) return false;
    return enrichMediaTitleRating({
      ...input,
      ratingProviderSource,
      selectedConfidence: 1
    });
  } catch {
    return false;
  }
}

async function runProviderSearch(
  config: AppConfig,
  tenantId: string,
  providerSource: ProviderSource,
  input: {
    title: string;
    titleSource?: "parsed_title" | "provider_search_title";
    mediaType: MediaType;
    year?: number;
    season?: number;
    episode?: number;
  },
  logger?: ProviderSearchLogger
) {
  try {
    const normalizedProviderSource = canonicalProviderSource(providerSource) ?? providerSource;
    const runtime = await resolveProviderRuntime(config, tenantId, normalizedProviderSource);
    if (!providerRuntimeAvailable(runtime)) {
      throw new Error(`${normalizedProviderSource.toUpperCase()} API key is not configured`);
    }
    return await runProviderSearchWithRuntime(normalizedProviderSource, runtime, input, logger);
  } catch (error) {
    throw providerError(error);
  }
}

async function runProviderSearchWithRuntime(
  providerSource: ProviderSource,
  runtime: ProviderRuntimeContext,
  input: {
    title: string;
    titleSource?: "parsed_title" | "provider_search_title";
    mediaType: MediaType;
    year?: number;
    season?: number;
    episode?: number;
  },
  logger?: ProviderSearchLogger
) {
  const normalizedProviderSource = canonicalProviderSource(providerSource) ?? providerSource;
  const results = await executeProviderSearch(
    {
      providerSource: normalizedProviderSource,
      mediaType: input.mediaType,
      logger
    },
    (signal) => getMetadataProvider(adapterIdForProviderSource(normalizedProviderSource)).search(
      {
        title: input.title,
        titleSource: input.titleSource,
        mediaType: input.mediaType,
        year: input.year,
        season: input.season,
        episode: input.episode,
        providerSource: normalizedProviderSource
      },
      { runtime, signal }
    )
  );
  return results.map((result) => normalizeProviderResult(result, normalizedProviderSource));
}

async function searchProviderTargets(
  config: AppConfig,
  tenantId: string,
  targets: Array<{ providerSource: ProviderSource; title: string; mediaType: MediaType; year?: number; season?: number; episode?: number }>,
  logger?: ProviderSearchLogger
) {
  const settled = await Promise.allSettled(
    targets.map((target) =>
      runProviderSearch(config, tenantId, target.providerSource, {
        title: target.title,
        mediaType: target.mediaType,
        year: target.year,
        season: target.season,
        episode: target.episode
      }, logger)
    )
  );
  const results = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const errors = settled.flatMap((result) => result.status === "rejected" ? [result.reason] : []);

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

export async function lookupProviderMediaMetadata(
  config: AppConfig,
  tenantId: string,
  providerSource: ProviderSource,
  input: { providerEntityType: string; providerId: string; mediaType?: MediaType }
) {
  const normalizedProviderSource = canonicalProviderSource(providerSource) ?? providerSource;
  return runProviderDetailLookup(config, tenantId, normalizedProviderSource, {
    ...input,
    providerId: providerDetailIdForSource(normalizedProviderSource, input.providerId)
  });
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
  if (!value) return undefined;
  if (isProviderSource(value)) return value;
  return providerSourceForLegacyProvider(value);
}

function providerSourceForProbe(provider?: string | null, providerEntityType?: string | null): ProviderSource | undefined {
  if (!provider) return undefined;
  return providerSourceForLegacyProviderEntity(provider, providerEntityType) ?? canonicalProviderSource(provider);
}

function adapterIdForProviderSource(providerSource: ProviderSource) {
  return getProviderSourceDefinition(providerSource).adapterId;
}

function providerForProviderSource(providerSource: ProviderSource): MediaProvider {
  return getProviderSourceDefinition(providerSource).provider;
}

function defaultLanguageForProviderSource(providerSource: ProviderSource) {
  return getProviderSourceDefinition(providerSource).defaultMetadataLanguage ?? "en-US";
}

function supportedMediaTypesForProviderSource(providerSource: ProviderSource): readonly MediaType[] {
  return getProviderSourceDefinition(providerSource).supportedMediaTypes;
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

function concreteMediaTypeList(mediaType?: string | null): Array<"MOVIE" | "TV_SERIES"> | undefined {
  return mediaType === "MOVIE" || mediaType === "TV_SERIES" ? [mediaType] : undefined;
}

function serializeMediaTitle(
  media: any,
  presentationPreferences: PresentationPreferences = EMPTY_PRESENTATION_PREFERENCES
): MediaTitleDto {
  const presentation = serializeMediaPresentation({
    mediaTitle: media,
    providerMetadata: media.selectedProviderMetadata,
    providerIdentities: media.providerIdentities
  }, presentationOptionsForMediaType(presentationPreferences, media.mediaType));

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

function normalizeTitle(value: string) {
  return normalizeTitleKey(value);
}
