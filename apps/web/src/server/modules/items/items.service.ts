import { ParsedReleaseMatchStatus, type Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { notFound } from "../../core/errors.js";
import { decryptAead } from "../../secrets.js";
import { getPresentationProviderOrder } from "../../integrations/providers/policy.js";
import {
  providerOrderForMediaType,
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
            include: { providerLinks: { include: { providerTitle: true } } }
          },
          providerTitle: true
        },
        orderBy: [{ matchedAt: "desc" }, { updatedAt: "desc" }],
        take: 1
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

export async function listItems(
  tenantId: string,
  query: ItemQueryInput
): Promise<ItemResponse[]> {
  const where: Prisma.RssItemWhereInput = {
    tenantId,
    feedId: query.feedId,
    OR: query.unmatched
      ? [
          { parsedRelease: { is: null } },
          {
            parsedRelease: {
              is: {
                matches: {
                  none: {
                    status: "MATCHED",
                    invalidatedAt: null
                  }
                }
              }
            }
          }
        ]
      : undefined,
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

  const presentationOrders = await preloadPresentationOrders(tenantId);
  return items.map((item) => serializeItem(item, presentationOrders));
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
  const activeMatch = release?.matches[0];
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

function legacyKindFromMediaType(mediaType: "MOVIE" | "TV_SERIES" | "UNKNOWN") {
  return mediaType === "TV_SERIES" ? "TV" : mediaType;
}
