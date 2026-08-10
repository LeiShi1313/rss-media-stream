import { ParsedReleaseMatchStatus, type Prisma } from "@prisma/client";
import type {
  ItemDto,
  ItemPageDto,
  ParsedReleaseDto
} from "@rss-media/shared/apiContracts";
import { prisma } from "../../db.js";
import { notFound } from "../../core/errors.js";
import { decryptAead } from "../../secrets.js";
import {
  legacyKindFromMediaType,
  selectReleaseMatchForPresentation,
  serializeReleaseMatch
} from "../media/presentation.js";
import { parsedReleaseMatchInclude } from "../media/parsedReleaseMatchInclude.js";
import {
  EMPTY_PRESENTATION_PREFERENCES,
  loadPresentationPreferences,
  presentationOptionsForMediaType,
  type PresentationPreferences
} from "../media/presentationPreferences.js";
import type { ItemQueryInput } from "./items.schemas.js";

export const itemRelations = {
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
        include: parsedReleaseMatchInclude,
        orderBy: [{ matchedAt: "desc" }, { updatedAt: "desc" }],
      }
    }
  },
  downloadJobs: {
    orderBy: { createdAt: "desc" },
    take: 3,
    select: {
      id: true,
      status: true,
      error: true,
      clientHash: true,
      createdAt: true
    }
  }
} satisfies Prisma.RssItemInclude;

type ItemWithRelations = Prisma.RssItemGetPayload<{ include: typeof itemRelations }>;

export async function listItems(
  tenantId: string,
  query: ItemQueryInput
): Promise<ItemPageDto> {
  const where = itemListWhere(tenantId, query);

  const presentationPreferences = await loadPresentationPreferences(tenantId);
  const items: ItemDto[] = [];
  let cursorId = query.cursor;
  const scanLimit = query.q || query.category || query.status
    ? Math.min(200, Math.max(query.limit * 4, query.limit + 1))
    : query.limit;

  while (items.length < query.limit) {
    const cursor = cursorId
      ? await prisma.rssItem.findFirst({
          where: { id: cursorId, tenantId },
          select: { id: true, firstSeenAt: true }
        })
      : undefined;

    const rows = await prisma.rssItem.findMany({
      where: cursor
        ? {
            AND: [
              where,
              {
                OR: [
                  { firstSeenAt: { lt: cursor.firstSeenAt } },
                  { firstSeenAt: cursor.firstSeenAt, id: { lt: cursor.id } }
                ]
              }
            ]
          }
        : where,
      orderBy: [{ firstSeenAt: "desc" }, { id: "desc" }],
      take: scanLimit + 1,
      include: itemRelations
    });

    const hasMoreRows = rows.length > scanLimit;
    const scannedRows = rows.slice(0, scanLimit);
    if (scannedRows.length === 0) break;

    for (const [index, row] of scannedRows.entries()) {
      cursorId = row.id;
      const item = serializeItem(row, presentationPreferences);
      if (itemMatchesSerializedFilters(row, item, query)) {
        items.push(item);
      }
      if (items.length >= query.limit) {
        return {
          items,
          nextCursor: hasMoreRows || index < scannedRows.length - 1 ? row.id : undefined
        };
      }
    }

    if (!hasMoreRows) break;
  }

  return { items };
}

function itemListWhere(tenantId: string, query: ItemQueryInput): Prisma.RssItemWhereInput {
  const filters: Prisma.RssItemWhereInput[] = [{
    tenantId,
    feedId: query.feedId
  }];
  const searchWhere = query.q ? itemDatabaseSearchWhere(query.q) : undefined;
  if (searchWhere) filters.push(searchWhere);
  return filters.length === 1 ? filters[0] : { AND: filters };
}

function itemDatabaseSearchWhere(query: string): Prisma.RssItemWhereInput | undefined {
  const value = query.trim();
  if (!value) return undefined;

  return {
    OR: [
      { rawTitle: stringContains(value) },
      { feed: { name: stringContains(value) } },
      {
        parsedRelease: {
          is: {
            OR: [
              { title: stringContains(value) },
              { quality: stringContains(value) },
              { source: stringContains(value) },
              { codec: stringContains(value) },
              { audio: stringContains(value) },
              { releaseGroup: stringContains(value) },
              { matches: { some: activeMatchSearchWhere(value) } }
            ]
          }
        }
      }
    ]
  };
}

function activeMatchSearchWhere(query: string): Prisma.ParsedReleaseMatchWhereInput {
  return {
    invalidatedAt: null,
    OR: [
      { status: ParsedReleaseMatchStatus.MATCHED },
      { status: ParsedReleaseMatchStatus.UNMATCHED }
    ],
    AND: [{
      OR: [
        { mediaTitle: { is: mediaTitleSearchWhere(query) } },
        { providerMediaMetadata: { is: providerMetadataSearchWhere(query) } },
        { providerTitle: { is: providerTitleSearchWhere(query) } }
      ]
    }]
  };
}

function mediaTitleSearchWhere(query: string): Prisma.MediaTitleWhereInput {
  return {
    OR: [
      { title: stringContains(query) },
      { originalTitle: stringContains(query) },
      {
        providerIdentities: {
          some: {
            metadata: {
              some: providerMetadataSearchWhere(query)
            }
          }
        }
      }
    ]
  };
}

function providerMetadataSearchWhere(query: string): Prisma.ProviderMediaMetadataWhereInput {
  return {
    OR: [
      { title: stringContains(query) },
      { originalTitle: stringContains(query) },
      { titleAliases: { has: query } }
    ]
  };
}

function providerTitleSearchWhere(query: string): Prisma.ProviderTitleWhereInput {
  return {
    OR: [
      { title: stringContains(query) },
      { originalTitle: stringContains(query) }
    ]
  };
}

function stringContains(value: string): Prisma.StringFilter {
  return { contains: value, mode: "insensitive" };
}

export async function getItem(
  tenantId: string,
  itemId: string
): Promise<ItemDto> {
  const item = await prisma.rssItem.findFirst({
    where: { id: itemId, tenantId },
    include: itemRelations
  });

  if (!item) throw notFound("Item");
  const presentationPreferences = await loadPresentationPreferences(tenantId);
  return serializeItem(item, presentationPreferences);
}

export function serializeItem(
  item: ItemWithRelations,
  presentationPreferences: PresentationPreferences = EMPTY_PRESENTATION_PREFERENCES
): ItemDto {
  const release = item.parsedRelease;
  const releaseOptions = presentationOptionsForMediaType(presentationPreferences, release?.mediaType);
  const activeMatch = selectReleaseMatchForPresentation(release?.matches, releaseOptions.providerOrder);
  return {
    id: item.id,
    feed: {
      id: item.feed.id,
      name: item.feed.name
    },
    rawTitle: item.rawTitle,
    sourceUrl: item.encryptedSourceUrl ? decryptAead(item.encryptedSourceUrl) : null,
    sizeBytes: item.sizeBytes?.toString() ?? null,
    publishDate: item.publishDate?.toISOString() ?? null,
    firstSeenAt: item.firstSeenAt.toISOString(),
    dedupeKeyType: item.dedupeKeyType,
    parsedRelease: release
      ? serializeParsedRelease(release)
      : undefined,
    enrichmentState: releaseEnrichmentState(release, activeMatch),
    match: serializeReleaseMatch({
      match: activeMatch,
      release,
      rawTitle: item.rawTitle,
      downloadJobs: item.downloadJobs
    }, presentationOptionsForMediaType(
      presentationPreferences,
      activeMatch?.mediaType ?? activeMatch?.mediaTitle?.mediaType ?? release?.mediaType
    )),
    downloadJobs: item.downloadJobs.map((job) => ({
      id: job.id,
      status: job.status,
      error: job.error,
      clientHash: job.clientHash,
      createdAt: job.createdAt.toISOString()
    }))
  };
}

function releaseEnrichmentState(release: any, activeMatch: any) {
  if (!release) return "UNPARSED";
  if (activeMatch?.status === "MATCHED") return "MATCHED";
  if (activeMatch?.status === "UNMATCHED") return "UNMATCHED";
  return "PENDING";
}

function itemMatchesSerializedFilters(row: ItemWithRelations, item: ItemDto, query: ItemQueryInput) {
  if (query.q && !itemMatchesSearch(row, item, query.q)) return false;
  if (query.category && releaseCategory(item) !== query.category) return false;
  if (query.status && !itemBelongsToStatus(item, query.status)) return false;
  return true;
}

function itemMatchesSearch(row: ItemWithRelations, item: ItemDto, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return itemSearchCandidates(row, item).some((value) =>
    String(value).toLowerCase().includes(normalizedQuery)
  );
}

function itemSearchCandidates(row: ItemWithRelations, item: ItemDto) {
  const release = item.parsedRelease as {
    title?: string | null;
    quality?: string | null;
    source?: string | null;
    codec?: string | null;
    audio?: string | null;
    releaseGroup?: string | null;
  } | undefined;

  const candidates: unknown[] = [
    item.rawTitle,
    release?.title,
    item.match?.presentation?.title,
    item.match?.presentation?.originalTitle,
    item.feed?.name,
    release?.quality,
    release?.source,
    release?.codec,
    release?.audio,
    release?.releaseGroup
  ];

  for (const match of row.parsedRelease?.matches ?? []) {
    addMediaTitleSearchCandidates(candidates, match.mediaTitle);
    addProviderMetadataSearchCandidates(candidates, match.providerMediaMetadata);
    addProviderTitleSearchCandidates(candidates, match.providerTitle);

    for (const identity of match.mediaTitle?.providerIdentities ?? []) {
      for (const metadata of identity.metadata ?? []) {
        addProviderMetadataSearchCandidates(candidates, metadata);
      }
    }
  }

  return candidates.filter(Boolean);
}

function addMediaTitleSearchCandidates(candidates: unknown[], mediaTitle: any) {
  if (!mediaTitle) return;
  candidates.push(mediaTitle.title, mediaTitle.canonicalTitle, mediaTitle.originalTitle);
}

function addProviderMetadataSearchCandidates(candidates: unknown[], metadata: any) {
  if (!metadata) return;
  candidates.push(metadata.title, metadata.originalTitle);
  if (Array.isArray(metadata.titleAliases)) {
    candidates.push(...metadata.titleAliases);
  }
}

function addProviderTitleSearchCandidates(candidates: unknown[], providerTitle: any) {
  if (!providerTitle) return;
  candidates.push(providerTitle.title, providerTitle.originalTitle);
}

function releaseCategory(item: ItemDto): "MOVIE" | "TV" | "OTHER" {
  const release = item.parsedRelease as { kind?: "MOVIE" | "TV" | "UNKNOWN" } | undefined;
  const kind = release?.kind && release.kind !== "UNKNOWN"
    ? release.kind
    : legacyKindFromMediaType(item.match?.presentation?.mediaType);
  return kind === "MOVIE" || kind === "TV" ? kind : "OTHER";
}

function itemBelongsToStatus(
  item: ItemDto,
  status: NonNullable<ItemQueryInput["status"]>
) {
  const identity = releaseIdentityState(item);
  if (status === "matched") return identity === "resolved";
  if (status === "unmatched") return identity !== "resolved";
  if (status === "downloading") return isDownloadInProgress(item);
  return latestDownloadJob(item)?.status === "FAILED" || identity !== "resolved";
}

function releaseIdentityState(item: ItemDto) {
  if (item.match?.status === "MATCHED") {
    return item.match.attention.required ? "review" : "resolved";
  }
  return item.match ? "review" : "unresolved";
}

function isDownloadInProgress(item: ItemDto) {
  const job = latestDownloadJob(item);
  return Boolean(job && !isTerminalDownloadStatus(job.status));
}

function latestDownloadJob(item: ItemDto) {
  return [...(item.downloadJobs ?? [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0];
}

function isTerminalDownloadStatus(status?: string | null) {
  return Boolean(status && ["FAILED", "SENT", "COMPLETE", "COMPLETED", "SKIPPED"].includes(status));
}

function serializeParsedRelease(release: any): ParsedReleaseDto {
  return {
    id: release.id,
    title: release.title,
    year: release.year,
    kind: legacyKindFromMediaType(release.mediaType),
    mediaType: release.mediaType,
    tvUnitType: release.tvUnitType,
    season: release.season,
    episode: release.episode,
    episodeEnd: release.episodeEnd,
    specialNumber: release.specialNumber,
    episodePart: release.episodePart,
    resolution: release.resolution,
    quality: release.quality,
    source: release.source,
    codec: release.codec,
    audio: release.audio,
    releaseGroup: release.releaseGroup,
    variant: release.variant,
    confidence: release.parseConfidence,
    parseConfidence: release.parseConfidence,
    parsedAt: release.parsedAt.toISOString()
  };
}
