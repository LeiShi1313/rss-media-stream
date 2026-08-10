import { Prisma } from "@prisma/client";
import type {
  ItemDto,
  MediaDetailDto,
  MediaTitleDto,
  ResolvedMediaTitleDto,
  TrendingMediaPageDto
} from "@rss-media/shared/apiContracts";
import { normalizeTitleKey } from "@rss-media/shared/titleNormalization";
import type { ProviderSource } from "@rss-media/shared/types";
import type { z } from "zod";
import type { AppConfig } from "../../config.js";
import { badRequest, conflict, notFound } from "../../core/errors.js";
import { prisma } from "../../db.js";
import {
  isProviderSource,
  providerSourceForLegacyProvider
} from "../../integrations/providers/sources.js";
import { itemRelations, serializeItem } from "../items/items.service.js";
import {
  legacyKindFromMediaType,
  serializeMediaPresentation
} from "./presentation.js";
import { lookupProviderMediaMetadata } from "./providerDiscovery.js";
import { upsertProviderMediaMetadata } from "./providerIdentity.js";
import {
  EMPTY_PRESENTATION_PREFERENCES,
  loadPresentationPreferences,
  presentationOptionsForMediaType,
  type PresentationPreferences
} from "./presentationPreferences.js";
import type {
  localMediaSearchQuerySchema,
  providerTitleResolveSchema,
  trendingMediaQuerySchema
} from "./media.schemas.js";

type ConcreteMediaType = "MOVIE" | "TV_SERIES";
type ProviderTitleResolveInput = z.infer<typeof providerTitleResolveSchema>;
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

export async function resolveProviderMediaTitle(
  config: AppConfig,
  tenantId: string,
  input: ProviderTitleResolveInput
): Promise<ResolvedMediaTitleDto> {
  const providerSource = canonicalProviderSource(input.providerSource);
  if (!providerSource) {
    throw conflict("UNSUPPORTED_PROVIDER_SOURCE", "Provider title resolution requires a supported provider source");
  }
  const selected = await lookupProviderMediaMetadata(config, tenantId, providerSource, {
    providerEntityType: input.providerEntityType,
    providerId: input.providerId,
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

async function assertMediaTitleExists(mediaTitleId: string) {
  const media = await prisma.mediaTitle.findUnique({
    where: { id: mediaTitleId },
    select: { id: true, mediaType: true }
  });
  if (!media) throw notFound("Media title");
  return media;
}

function canonicalProviderSource(value?: string | null): ProviderSource | undefined {
  if (!value) return undefined;
  if (isProviderSource(value)) return value;
  return providerSourceForLegacyProvider(value);
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
