import { ParsedReleaseMatchStatus, type Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { notFound } from "../../core/errors.js";
import { decryptAead } from "../../secrets.js";
import { getPresentationProviderOrder } from "../../integrations/providers/policy.js";
import {
  providerOrderForMediaType,
  selectReleaseMatchForPresentation,
  serializeReleaseMatch,
  type PresentationOrders,
  type ReleaseMatchDto
} from "../media/presentation.js";
import type { ItemQueryInput } from "./items.schemas.js";

const itemRelations = {
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
      clientHash: true,
      createdAt: true
    }
  }
} satisfies Prisma.RssItemInclude;

export type ItemResponse = {
  id: string;
  feed: { id: string; name: string };
  rawTitle: string;
  sourceUrl?: string | null;
  sizeBytes?: string | null;
  firstSeenAt: string;
  dedupeKeyType: "INFO_HASH" | "RELEASE_SIGNATURE" | "LINK_HASH";
  parsedRelease?: unknown;
  enrichmentState: "MATCHED" | "UNMATCHED" | "PENDING" | "UNPARSED";
  match?: ReleaseMatchDto;
  downloadJobs: Array<{
    id: string;
    status: string;
    clientHash?: string | null;
    createdAt: string;
  }>;
};

type ItemWithRelations = any;

export type ItemPageResponse = {
  items: ItemResponse[];
  nextCursor?: string;
};

export async function listItems(
  tenantId: string,
  query: ItemQueryInput
): Promise<ItemPageResponse> {
  const where: Prisma.RssItemWhereInput = {
    tenantId,
    feedId: query.feedId
  };

  const presentationOrders = await preloadPresentationOrders(tenantId);
  const items: ItemResponse[] = [];
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
      const item = serializeItem(row, presentationOrders);
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

export async function getItem(
  tenantId: string,
  itemId: string
): Promise<ItemResponse> {
  const item = await prisma.rssItem.findFirst({
    where: { id: itemId, tenantId },
    include: itemRelations
  });

  if (!item) throw notFound("Item");
  const presentationOrders = await preloadPresentationOrders(tenantId);
  return serializeItem(item, presentationOrders);
}

export async function assertItemInTenant(tenantId: string, itemId: string) {
  const item = await prisma.rssItem.findFirst({
    where: { id: itemId, tenantId },
    select: { id: true, tenantId: true }
  });

  if (!item) throw notFound("Item");
  return item;
}

export function serializeItem(item: ItemWithRelations, presentationOrders: PresentationOrders = {}): ItemResponse {
  const release = item.parsedRelease;
  const providerOrder = providerOrderForMediaType(presentationOrders, release?.mediaType);
  const activeMatch = selectReleaseMatchForPresentation(release?.matches, providerOrder);
  return {
    id: item.id,
    feed: {
      id: item.feed.id,
      name: item.feed.name
    },
    rawTitle: item.rawTitle,
    sourceUrl: item.encryptedSourceUrl ? decryptAead(item.encryptedSourceUrl) : null,
    sizeBytes: item.sizeBytes?.toString() ?? null,
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
    }, {
      providerOrder: providerOrderForMediaType(
        presentationOrders,
        activeMatch?.mediaType ?? activeMatch?.mediaTitle?.mediaType ?? release?.mediaType
      )
    }),
    downloadJobs: item.downloadJobs.map((job: any) => ({
      id: job.id,
      status: job.status,
      clientHash: job.clientHash,
      createdAt: job.createdAt.toISOString()
    }))
  };
}

async function preloadPresentationOrders(tenantId: string): Promise<PresentationOrders> {
  return {
    MOVIE: await getPresentationProviderOrder(tenantId, "MOVIE"),
    TV_SERIES: await getPresentationProviderOrder(tenantId, "TV_SERIES")
  };
}

function releaseEnrichmentState(release: any, activeMatch: any) {
  if (!release) return "UNPARSED";
  if (activeMatch?.status === "MATCHED") return "MATCHED";
  if (activeMatch?.status === "UNMATCHED") return "UNMATCHED";
  return "PENDING";
}

function itemMatchesSerializedFilters(row: ItemWithRelations, item: ItemResponse, query: ItemQueryInput) {
  if (query.q && !itemMatchesSearch(row, item, query.q)) return false;
  if (query.category && releaseCategory(item) !== query.category) return false;
  if (query.status && !itemBelongsToStatus(item, query.status)) return false;
  return true;
}

function itemMatchesSearch(row: ItemWithRelations, item: ItemResponse, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return itemSearchCandidates(row, item).some((value) =>
    String(value).toLowerCase().includes(normalizedQuery)
  );
}

function itemSearchCandidates(row: ItemWithRelations, item: ItemResponse) {
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

function releaseCategory(item: ItemResponse): "MOVIE" | "TV" | "OTHER" {
  const release = item.parsedRelease as { kind?: "MOVIE" | "TV" | "UNKNOWN" } | undefined;
  const kind = release?.kind && release.kind !== "UNKNOWN"
    ? release.kind
    : legacyKindFromMediaType(item.match?.presentation?.mediaType);
  return kind === "MOVIE" || kind === "TV" ? kind : "OTHER";
}

function itemBelongsToStatus(
  item: ItemResponse,
  status: NonNullable<ItemQueryInput["status"]>
) {
  const identity = releaseIdentityState(item);
  if (status === "matched") return identity === "resolved";
  if (status === "unmatched") return identity !== "resolved";
  if (status === "downloading") return isDownloadInProgress(item);
  return latestDownloadJob(item)?.status === "FAILED" || identity !== "resolved";
}

function releaseIdentityState(item: ItemResponse) {
  if (item.match?.status === "MATCHED") {
    return item.match.attention.required ? "review" : "resolved";
  }
  return item.match ? "review" : "unresolved";
}

function isDownloadInProgress(item: ItemResponse) {
  const job = latestDownloadJob(item);
  return Boolean(job && !isTerminalDownloadStatus(job.status));
}

function latestDownloadJob(item: ItemResponse) {
  return [...(item.downloadJobs ?? [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0];
}

function isTerminalDownloadStatus(status?: string | null) {
  return Boolean(status && ["FAILED", "SENT", "COMPLETE", "COMPLETED", "SKIPPED"].includes(status));
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
    parsedAt: release.parsedAt.toISOString()
  };
}

function legacyKindFromMediaType(mediaType?: "MOVIE" | "TV_SERIES" | "UNKNOWN") {
  if (!mediaType) return undefined;
  return mediaType === "TV_SERIES" ? "TV" : mediaType;
}
