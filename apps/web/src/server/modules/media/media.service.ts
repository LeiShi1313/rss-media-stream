import type { Prisma } from "@prisma/client";
import { redactSecrets } from "@rss-media/shared/redact";
import type { MediaKind, TmdbMedia } from "@rss-media/shared/types";
import type { AppConfig } from "../../config.js";
import { prisma } from "../../db.js";
import { getTmdbMediaById, searchTmdb } from "../../tmdb.js";
import { decryptAead } from "../../secrets.js";
import { badGateway, badRequest, conflict, notFound } from "../../core/errors.js";
import type {
  localMediaSearchQuerySchema,
  mediaImportSchema,
  mediaSearchQuerySchema,
  trendingMediaQuerySchema
} from "./media.schemas.js";
import type { z } from "zod";

type MediaProvider = "tmdb" | "imdb" | "douban";
type MediaSearchQuery = z.infer<typeof mediaSearchQuerySchema>;
type LocalMediaSearchQuery = z.infer<typeof localMediaSearchQuerySchema>;
type TrendingMediaQuery = z.infer<typeof trendingMediaQuerySchema>;
type MediaImportInput = z.infer<typeof mediaImportSchema>;
type Transaction = Prisma.TransactionClient;

export type ExternalMedia = {
  provider: MediaProvider;
  providerId: string;
  kind: MediaKind;
  title: string;
  originalTitle?: string;
  year?: number;
  posterPath?: string;
  backdropPath?: string;
  overview?: string;
  score: number;
  metadataJson?: unknown;
  raw?: unknown;
};

const matchedStatuses = ["MATCHED"] as const;

export async function searchExternalMedia(
  config: AppConfig,
  tenantId: string,
  query: MediaSearchQuery
): Promise<ExternalMedia[]> {
  if (query.provider !== "tmdb") {
    throw badRequest(`Media provider ${query.provider} is not supported yet`);
  }

  const results = await runTmdbSearch(config, tenantId, {
    query: query.q,
    kind: query.kind,
    year: query.year
  });

  return results.map(fromTmdbMedia);
}

export async function searchLocalMedia(tenantId: string, query: LocalMediaSearchQuery) {
  const normalizedQuery = normalizeSearchTitle(query.q ?? "");
  const where: Prisma.MediaWhereInput = {
    tenantId,
    kind: query.kind,
    OR: normalizedQuery
      ? [
          { searchTitle: { contains: normalizedQuery, mode: "insensitive" } },
          { title: { contains: query.q, mode: "insensitive" } },
          { originalTitle: { contains: query.q, mode: "insensitive" } },
          { providerId: query.q }
        ]
      : undefined
  };

  const media = await db().media.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { title: "asc" }],
    take: query.limit,
    include: {
      _count: {
        select: {
          matches: { where: { status: { in: [...matchedStatuses] } } },
          subscriptions: true
        }
      }
    }
  });

  return media.map((item: any) =>
    serializeMedia({
      ...item,
      matchCount: item._count.matches,
      subscriptionCount: item._count.subscriptions
    })
  );
}

export async function listTrendingMedia(tenantId: string, query: TrendingMediaQuery) {
  const since = new Date(Date.now() - query.windowDays * 24 * 60 * 60 * 1000);
  const matches = await db().mediaMatch.findMany({
    where: {
      tenantId,
      status: "MATCHED",
      mediaId: { not: null },
      item: { firstSeenAt: { gte: since } }
    },
    include: {
      media: true,
      item: {
        select: {
          firstSeenAt: true,
          parsedRelease: true,
          feed: { select: { id: true, name: true } }
        }
      }
    },
    orderBy: { matchedAt: "desc" }
  });

  const grouped = new Map<string, any>();
  for (const match of matches) {
    if (!match.mediaId || !match.media) continue;
    const current = grouped.get(match.mediaId) ?? {
      media: match.media,
      releaseCount: 0,
      latestReleaseAt: match.item.firstSeenAt,
      feeds: new Map<string, string>(),
      qualities: new Set<string>(),
      releaseGroups: new Set<string>()
    };
    current.releaseCount += 1;
    if (match.item.firstSeenAt > current.latestReleaseAt) {
      current.latestReleaseAt = match.item.firstSeenAt;
    }
    if (match.item.feed) current.feeds.set(match.item.feed.id, match.item.feed.name);
    if (match.item.parsedRelease?.quality) current.qualities.add(match.item.parsedRelease.quality);
    if (match.item.parsedRelease?.releaseGroup) current.releaseGroups.add(match.item.parsedRelease.releaseGroup);
    grouped.set(match.mediaId, current);
  }

  return [...grouped.values()]
    .sort((a, b) => b.releaseCount - a.releaseCount || b.latestReleaseAt.getTime() - a.latestReleaseAt.getTime())
    .slice(0, query.limit)
    .map((entry) => ({
      media: serializeMedia({ ...entry.media, matchCount: entry.releaseCount, subscriptionCount: undefined }),
      releaseCount: entry.releaseCount,
      latestReleaseAt: entry.latestReleaseAt.toISOString(),
      feedCount: entry.feeds.size,
      feeds: [...entry.feeds.values()].slice(0, 6),
      qualities: [...entry.qualities].slice(0, 8),
      releaseGroups: [...entry.releaseGroups].slice(0, 8)
    }));
}

export async function importMedia(tenantId: string, input: MediaImportInput) {
  return prisma.$transaction((tx) => upsertMediaFromExternal(tx, tenantId, input));
}

export async function getMedia(tenantId: string, mediaId: string) {
  const media = await db().media.findFirst({
    where: { id: mediaId, tenantId }
  });
  if (!media) throw notFound("Media");

  const [matchCount, subscriptionCount] = await Promise.all([
    db().mediaMatch.count({ where: { tenantId, mediaId } }),
    db().subscription.count({ where: { tenantId, mediaId } })
  ]);

  return serializeMedia({ ...media, matchCount, subscriptionCount });
}

export async function listMediaItems(tenantId: string, mediaId: string) {
  await assertMediaInTenant(tenantId, mediaId);

  const items = await db().rssItem.findMany({
    where: {
      tenantId,
      mediaMatch: { mediaId }
    },
    orderBy: { firstSeenAt: "desc" },
    include: {
      feed: { select: { id: true, name: true } },
      parsedRelease: true,
      mediaMatch: { include: { media: true } },
      downloadJobs: { orderBy: { createdAt: "desc" }, take: 3 }
    }
  });

  return items.map(serializeItem);
}

export async function getMediaDetail(tenantId: string, mediaId: string) {
  const media = await getMedia(tenantId, mediaId);
  const releases = await listMediaItems(tenantId, mediaId);
  return { media, releases };
}

export async function matchItemWithExternalMedia(input: {
  tenantId: string;
  itemId: string;
  config: AppConfig;
}) {
  const item = await db().rssItem.findFirst({
    where: { id: input.itemId, tenantId: input.tenantId },
    include: { parsedRelease: true }
  });
  if (!item) throw notFound("Item");
  if (!item.parsedRelease) {
    throw conflict("ITEM_NOT_PARSED", "Item has not been parsed");
  }

  const candidates = await searchExternalMedia(input.config, input.tenantId, {
    provider: "tmdb",
    q: item.parsedRelease.title,
    kind: item.parsedRelease.kind,
    year: item.parsedRelease.year ?? undefined
  });

  return prisma.$transaction(async (tx) => {
    await storeMatchCandidates(tx, input.tenantId, input.itemId, candidates);

    const best = candidates[0];
    if (!best) {
      return upsertUnmatchedMediaMatch(tx, input.tenantId, input.itemId, {
        title: item.parsedRelease.title
      });
    }

    const status = best.score >= 0.88 ? "MATCHED" : "CANDIDATE";
    const matchedAt = status === "MATCHED" ? new Date() : null;
    const media =
      status === "MATCHED"
        ? await upsertMediaFromExternal(tx, input.tenantId, best)
        : null;

    return db(tx).mediaMatch.upsert({
      where: {
        itemId_tenantId: {
          itemId: input.itemId,
          tenantId: input.tenantId
        }
      },
      create: {
        tenantId: input.tenantId,
        itemId: input.itemId,
        mediaId: media?.id,
        provider: best.provider,
        providerId: best.providerId,
        kind: best.kind,
        title: best.title,
        originalTitle: best.originalTitle,
        year: best.year,
        posterPath: best.posterPath,
        backdropPath: best.backdropPath,
        overview: best.overview,
        score: best.score,
        status,
        matchedAt,
        reason: status === "MATCHED" ? "automatic_match" : "candidate_below_threshold"
      },
      update: {
        mediaId: media?.id,
        provider: best.provider,
        providerId: best.providerId,
        kind: best.kind,
        title: best.title,
        originalTitle: best.originalTitle,
        year: best.year,
        posterPath: best.posterPath,
        backdropPath: best.backdropPath,
        overview: best.overview,
        score: best.score,
        status,
        matchedAt,
        reason: status === "MATCHED" ? "automatic_match" : "candidate_below_threshold"
      }
    });
  });
}

export async function matchItemWithTmdbId(input: {
  tenantId: string;
  itemId: string;
  config: AppConfig;
  tmdbId: string;
  kind: "MOVIE" | "TV";
}) {
  await assertItemInTenant(input.tenantId, input.itemId);
  const media = fromTmdbMedia(
    await runTmdbDetailLookup(input.config, input.tenantId, {
      tmdbId: input.tmdbId,
      kind: input.kind
    })
  );
  media.score = 1;

  return prisma.$transaction(async (tx) => {
    const storedMedia = await upsertMediaFromExternal(tx, input.tenantId, media);
    await db(tx).mediaMatch.upsert({
      where: {
        itemId_tenantId: {
          itemId: input.itemId,
          tenantId: input.tenantId
        }
      },
      create: {
        tenantId: input.tenantId,
        itemId: input.itemId,
        mediaId: storedMedia.id,
        provider: storedMedia.provider,
        providerId: storedMedia.providerId,
        kind: storedMedia.kind,
        title: storedMedia.title,
        originalTitle: storedMedia.originalTitle,
        year: storedMedia.year,
        posterPath: storedMedia.posterPath,
        backdropPath: storedMedia.backdropPath,
        overview: storedMedia.overview,
        score: 1,
        status: "MATCHED",
        matchedAt: new Date(),
        reason: "manual_tmdb_id"
      },
      update: {
        mediaId: storedMedia.id,
        provider: storedMedia.provider,
        providerId: storedMedia.providerId,
        kind: storedMedia.kind,
        title: storedMedia.title,
        originalTitle: storedMedia.originalTitle,
        year: storedMedia.year,
        posterPath: storedMedia.posterPath,
        backdropPath: storedMedia.backdropPath,
        overview: storedMedia.overview,
        score: 1,
        status: "MATCHED",
        matchedAt: new Date(),
        reason: "manual_tmdb_id"
      }
    });

    return storedMedia;
  });
}

export async function listMatchCandidates(tenantId: string, itemId: string) {
  await assertItemInTenant(tenantId, itemId);

  return db().mediaMatchCandidate.findMany({
    where: { tenantId, itemId },
    orderBy: [{ chosenAt: "desc" }, { rank: "asc" }, { createdAt: "desc" }]
  });
}

export async function acceptCandidate(input: {
  tenantId: string;
  itemId: string;
  candidateId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const candidate = await db(tx).mediaMatchCandidate.findFirst({
      where: {
        id: input.candidateId,
        itemId: input.itemId,
        tenantId: input.tenantId
      }
    });
    if (!candidate) throw notFound("Match candidate");

    const media = await upsertMediaFromCandidate(tx, input.tenantId, candidate);

    await db(tx).mediaMatch.upsert({
      where: {
        itemId_tenantId: {
          itemId: input.itemId,
          tenantId: input.tenantId
        }
      },
      create: {
        tenantId: input.tenantId,
        itemId: input.itemId,
        mediaId: media.id,
        provider: media.provider,
        providerId: media.providerId,
        kind: media.kind,
        title: media.title,
        originalTitle: media.originalTitle,
        year: media.year,
        posterPath: media.posterPath,
        backdropPath: media.backdropPath,
        overview: media.overview,
        score: candidate.score,
        status: "MATCHED",
        matchedAt: new Date(),
        reason: "accepted_candidate"
      },
      update: {
        mediaId: media.id,
        provider: media.provider,
        providerId: media.providerId,
        kind: media.kind,
        title: media.title,
        originalTitle: media.originalTitle,
        year: media.year,
        posterPath: media.posterPath,
        backdropPath: media.backdropPath,
        overview: media.overview,
        score: candidate.score,
        status: "MATCHED",
        matchedAt: new Date(),
        reason: "accepted_candidate"
      }
    });

    await db(tx).mediaMatchCandidate.update({
      where: { id: candidate.id },
      data: { chosenAt: new Date() }
    });

    return media;
  });
}

export async function upsertMediaFromExternal(
  tx: Transaction,
  tenantId: string,
  media: ExternalMedia
) {
  return db(tx).media.upsert({
    where: {
      tenantId_provider_providerId: {
        tenantId,
        provider: media.provider,
        providerId: media.providerId
      }
    },
    create: {
      tenantId,
      provider: media.provider,
      providerId: media.providerId,
      kind: media.kind,
      title: media.title,
      originalTitle: media.originalTitle,
      year: media.year,
      posterPath: media.posterPath,
      backdropPath: media.backdropPath,
      overview: media.overview,
      searchTitle: normalizeSearchTitle(media.title),
      tmdbFetchedAt: media.provider === "tmdb" ? new Date() : undefined,
      metadataJson: media.metadataJson === undefined ? undefined : sanitizeProviderValue(media.metadataJson, 0)
    },
    update: {
      kind: media.kind,
      title: media.title,
      originalTitle: media.originalTitle,
      year: media.year,
      posterPath: media.posterPath,
      backdropPath: media.backdropPath,
      overview: media.overview,
      searchTitle: normalizeSearchTitle(media.title),
      tmdbFetchedAt: media.provider === "tmdb" ? new Date() : undefined,
      metadataJson: media.metadataJson === undefined ? undefined : sanitizeProviderValue(media.metadataJson, 0)
    }
  });
}

export async function storeMatchCandidates(
  tx: Transaction,
  tenantId: string,
  itemId: string,
  candidates: ExternalMedia[]
) {
  await db(tx).mediaMatchCandidate.deleteMany({
    where: { tenantId, itemId, chosenAt: null }
  });

  if (candidates.length === 0) return { count: 0 };

  return db(tx).mediaMatchCandidate.createMany({
    data: candidates.map((candidate, index) => ({
      tenantId,
      itemId,
      provider: candidate.provider,
      providerId: candidate.providerId,
      kind: candidate.kind,
      title: candidate.title,
      originalTitle: candidate.originalTitle,
      year: candidate.year,
      posterPath: candidate.posterPath,
      backdropPath: candidate.backdropPath,
      overview: candidate.overview,
      score: candidate.score,
      rank: index + 1,
      rawExcerpt: redactProviderPayload(candidate.raw)
    }))
  });
}

export function redactProviderPayload(raw: unknown): unknown {
  return sanitizeProviderValue(raw, 0);
}

function fromTmdbMedia(media: TmdbMedia): ExternalMedia {
  return {
    provider: media.provider,
    providerId: media.providerId,
    kind: media.kind,
    title: media.title,
    originalTitle: media.originalTitle,
    year: media.year,
    posterPath: media.posterPath,
    backdropPath: media.backdropPath,
    overview: media.overview,
    score: media.score,
    metadataJson: media.metadataJson,
    raw: media.raw
  };
}

export async function backfillMediaLibraryFields(tenantId?: string) {
  const [mediaRows, matchRows] = await Promise.all([
    prisma.media.findMany({
      where: { tenantId, searchTitle: null },
      select: { id: true, title: true }
    }),
    prisma.mediaMatch.findMany({
      where: { tenantId, status: "MATCHED", matchedAt: null },
      select: { id: true, updatedAt: true }
    })
  ]);

  if (mediaRows.length > 0) {
    await prisma.$transaction(
      mediaRows.map((media) =>
        prisma.media.update({
          where: { id: media.id },
          data: { searchTitle: normalizeSearchTitle(media.title) }
        })
      )
    );
  }

  if (matchRows.length > 0) {
    await prisma.$transaction(
      matchRows.map((match) =>
        prisma.mediaMatch.update({
          where: { id: match.id },
          data: { matchedAt: match.updatedAt }
        })
      )
    );
  }

  return {
    mediaSearchTitles: mediaRows.length,
    matchedAt: matchRows.length
  };
}

async function runTmdbSearch(config: AppConfig, tenantId: string, input: Parameters<typeof searchTmdb>[1]) {
  try {
    return await searchTmdb(config, input, tenantId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "TMDB API key is not configured") {
      throw conflict("TMDB_NOT_CONFIGURED", "Add a TMDB API key in Workspace before matching media");
    }
    throw badGateway(message);
  }
}

async function runTmdbDetailLookup(
  config: AppConfig,
  tenantId: string,
  input: Parameters<typeof getTmdbMediaById>[2]
) {
  try {
    return await getTmdbMediaById(config, tenantId, input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "TMDB API key is not configured") {
      throw conflict("TMDB_NOT_CONFIGURED", "Add a TMDB API key in Settings before matching media");
    }
    throw badGateway(message);
  }
}

async function upsertUnmatchedMediaMatch(
  tx: Transaction,
  tenantId: string,
  itemId: string,
  input: { title: string }
) {
  return db(tx).mediaMatch.upsert({
    where: {
      itemId_tenantId: {
        itemId,
        tenantId
      }
    },
    create: {
      tenantId,
      itemId,
      provider: "tmdb",
      providerId: "unmatched",
      kind: "UNKNOWN",
      title: input.title,
      score: 0,
      status: "UNMATCHED",
      matchedAt: null,
      reason: "no_candidates"
    },
    update: {
      mediaId: null,
      provider: "tmdb",
      providerId: "unmatched",
      kind: "UNKNOWN",
      title: input.title,
      originalTitle: null,
      year: null,
      posterPath: null,
      backdropPath: null,
      overview: null,
      score: 0,
      status: "UNMATCHED",
      matchedAt: null,
      reason: "no_candidates"
    }
  });
}

async function upsertMediaFromCandidate(
  tx: Transaction,
  tenantId: string,
  candidate: {
    provider: MediaProvider;
    providerId: string;
    kind: MediaKind;
    title: string;
    originalTitle?: string | null;
    year?: number | null;
    posterPath?: string | null;
    backdropPath?: string | null;
    overview?: string | null;
    score: number;
  }
) {
  return upsertMediaFromExternal(tx, tenantId, {
    provider: candidate.provider,
    providerId: candidate.providerId,
    kind: candidate.kind,
    title: candidate.title,
    originalTitle: candidate.originalTitle ?? undefined,
    year: candidate.year ?? undefined,
    posterPath: candidate.posterPath ?? undefined,
    backdropPath: candidate.backdropPath ?? undefined,
    overview: candidate.overview ?? undefined,
    score: candidate.score
  });
}

async function assertItemInTenant(tenantId: string, itemId: string) {
  const item = await db().rssItem.findFirst({
    where: { id: itemId, tenantId },
    select: { id: true }
  });
  if (!item) throw notFound("Item");
}

async function assertMediaInTenant(tenantId: string, mediaId: string) {
  const media = await db().media.findFirst({
    where: { id: mediaId, tenantId },
    select: { id: true }
  });
  if (!media) throw notFound("Media");
}

function serializeMedia(media: any) {
  return {
    id: media.id,
    provider: media.provider,
    providerId: media.providerId,
    kind: media.kind,
    title: media.title,
    originalTitle: media.originalTitle,
    year: media.year,
    posterPath: media.posterPath,
    backdropPath: media.backdropPath,
    overview: media.overview,
    searchTitle: media.searchTitle,
    tmdbFetchedAt: media.tmdbFetchedAt,
    metadataJson: media.metadataJson,
    createdAt: media.createdAt,
    updatedAt: media.updatedAt,
    matchCount: media.matchCount,
    subscriptionCount: media.subscriptionCount
  };
}

function serializeItem(item: any) {
  return {
    id: item.id,
    feed: item.feed ? { id: item.feed.id, name: item.feed.name } : undefined,
    rawTitle: item.rawTitle,
    sourceUrl: item.encryptedSourceUrl ? decryptAead(item.encryptedSourceUrl) : null,
    publishDate: item.publishDate,
    firstSeenAt: item.firstSeenAt,
    sizeBytes: item.sizeBytes?.toString?.(),
    parsedRelease: item.parsedRelease,
    mediaMatch: item.mediaMatch ? serializeMediaMatch(item.mediaMatch) : undefined,
    downloadJobs: item.downloadJobs?.map((job: any) => ({
      id: job.id,
      status: job.status,
      error: job.error,
      clientHash: job.clientHash,
      createdAt: job.createdAt
    }))
  };
}

function serializeMediaMatch(match: any) {
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
    matchedAt: match.matchedAt?.toISOString?.(),
    media: match.media ? serializeMedia({ ...match.media, matchCount: undefined, subscriptionCount: undefined }) : undefined,
    createdAt: match.createdAt?.toISOString?.(),
    updatedAt: match.updatedAt?.toISOString?.()
  };
}

function normalizeSearchTitle(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sanitizeProviderValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactSecrets(value).slice(0, 1000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (depth >= 3) return "[REDACTED]";

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeProviderValue(item, depth + 1));
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      output[key] = sensitiveProviderKey(key)
        ? "[REDACTED]"
        : sanitizeProviderValue(nested, depth + 1);
    }
    return output;
  }

  return String(value);
}

function sensitiveProviderKey(key: string): boolean {
  return /token|secret|api[_-]?key|password|passkey|auth|credential/i.test(key);
}

function db(tx?: Transaction) {
  return (tx ?? prisma) as any;
}
