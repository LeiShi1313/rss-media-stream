import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { notFound } from "../../core/errors.js";
import { decryptAead } from "../../secrets.js";
import type { ItemQueryInput } from "./items.schemas.js";

const itemRelations = {
  feed: { select: { id: true, name: true } },
  parsedRelease: true,
  mediaMatch: { include: { media: true } },
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
} as const;

export type ItemResponse = {
  id: string;
  feed: { id: string; name: string };
  rawTitle: string;
  sourceUrl?: string | null;
  sizeBytes?: string | null;
  firstSeenAt: string;
  dedupeKeyType: "INFO_HASH" | "RELEASE_SIGNATURE" | "LINK_HASH";
  parsedRelease?: unknown;
  mediaMatch?: unknown;
  downloadJobs: Array<{
    id: string;
    status: string;
    clientHash?: string | null;
    createdAt: string;
  }>;
};

type ItemWithRelations = Prisma.RssItemGetPayload<{
  include: typeof itemRelations;
}>;

export async function listItems(
  tenantId: string,
  query: ItemQueryInput
): Promise<ItemResponse[]> {
  const where: Prisma.RssItemWhereInput = {
    tenantId,
    feedId: query.feedId,
    mediaMatch: query.unmatched ? null : undefined,
    rawTitle: query.q
      ? { contains: query.q, mode: "insensitive" }
      : undefined
  };

  const cursor = query.cursor
    ? await prisma.rssItem.findFirst({
        where: { id: query.cursor, tenantId },
        select: { id: true, firstSeenAt: true }
      })
    : undefined;

  const items = await prisma.rssItem.findMany({
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
    take: query.limit,
    include: itemRelations
  });

  return items.map(serializeItem);
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
  return serializeItem(item);
}

export async function assertItemInTenant(tenantId: string, itemId: string) {
  const item = await prisma.rssItem.findFirst({
    where: { id: itemId, tenantId },
    select: { id: true, tenantId: true }
  });

  if (!item) throw notFound("Item");
  return item;
}

export function serializeItem(item: ItemWithRelations): ItemResponse {
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
    parsedRelease: item.parsedRelease
      ? serializeParsedRelease(item.parsedRelease)
      : undefined,
    mediaMatch: item.mediaMatch ? serializeMediaMatch(item.mediaMatch) : undefined,
    downloadJobs: item.downloadJobs.map((job) => ({
      id: job.id,
      status: job.status,
      clientHash: job.clientHash,
      createdAt: job.createdAt.toISOString()
    }))
  };
}

function serializeParsedRelease(
  release: NonNullable<ItemWithRelations["parsedRelease"]>
) {
  return {
    id: release.id,
    title: release.title,
    year: release.year,
    kind: release.kind,
    season: release.season,
    episode: release.episode,
    episodeEnd: release.episodeEnd,
    resolution: release.resolution,
    quality: release.quality,
    source: release.source,
    codec: release.codec,
    audio: release.audio,
    releaseGroup: release.releaseGroup,
    confidence: release.confidence
  };
}

function serializeMediaMatch(match: NonNullable<ItemWithRelations["mediaMatch"]>) {
  return {
    id: match.id,
    mediaId: match.mediaId,
    provider: match.provider,
    providerId: match.providerId,
    kind: match.kind,
    title: match.title,
    originalTitle: match.originalTitle,
    year: match.year,
    posterPath: match.posterPath,
    backdropPath: match.backdropPath,
    overview: match.overview,
    score: match.score,
    status: match.status,
    reason: match.reason,
    matchedAt: match.matchedAt?.toISOString(),
    media: match.media
      ? {
          id: match.media.id,
          provider: match.media.provider,
          providerId: match.media.providerId,
          kind: match.media.kind,
          title: match.media.title,
          originalTitle: match.media.originalTitle,
          year: match.media.year,
          posterPath: match.media.posterPath,
          backdropPath: match.media.backdropPath,
          overview: match.media.overview,
          searchTitle: match.media.searchTitle,
          tmdbFetchedAt: match.media.tmdbFetchedAt?.toISOString(),
          metadataJson: match.media.metadataJson
        }
      : undefined,
    createdAt: match.createdAt.toISOString(),
    updatedAt: match.updatedAt.toISOString()
  };
}
