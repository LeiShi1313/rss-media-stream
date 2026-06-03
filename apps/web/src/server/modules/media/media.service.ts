import type { Prisma } from "@prisma/client";
import { redactSecrets } from "@rss-media/shared/redact";
import type { MediaKind, TmdbMedia } from "@rss-media/shared/types";
import type { AppConfig } from "../../config.js";
import { prisma } from "../../db.js";
import { searchTmdb } from "../../tmdb.js";
import { badRequest, conflict, notFound } from "../../core/errors.js";
import type { mediaImportSchema, mediaSearchQuerySchema } from "./media.schemas.js";
import type { z } from "zod";

type MediaProvider = "tmdb" | "imdb" | "douban";
type MediaSearchQuery = z.infer<typeof mediaSearchQuerySchema>;
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
  raw?: unknown;
};

export async function searchExternalMedia(
  config: AppConfig,
  query: MediaSearchQuery
): Promise<ExternalMedia[]> {
  if (query.provider !== "tmdb") {
    throw badRequest(`Media provider ${query.provider} is not supported yet`);
  }

  const results = await searchTmdb(config, {
    query: query.q,
    kind: query.kind,
    year: query.year
  });

  return results.map(fromTmdbMedia);
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
      mediaMatch: true,
      downloadJobs: { orderBy: { createdAt: "desc" }, take: 3 }
    }
  });

  return items.map(serializeItem);
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

  const candidates = await searchExternalMedia(input.config, {
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
        reason: status === "MATCHED" ? "automatic_match" : "candidate_below_threshold"
      }
    });
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
      overview: media.overview
    },
    update: {
      kind: media.kind,
      title: media.title,
      originalTitle: media.originalTitle,
      year: media.year,
      posterPath: media.posterPath,
      backdropPath: media.backdropPath,
      overview: media.overview
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
    raw: media.raw
  };
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
    publishDate: item.publishDate,
    firstSeenAt: item.firstSeenAt,
    sizeBytes: item.sizeBytes?.toString?.(),
    parsedRelease: item.parsedRelease,
    mediaMatch: item.mediaMatch,
    downloadJobs: item.downloadJobs?.map((job: any) => ({
      id: job.id,
      status: job.status,
      error: job.error,
      clientHash: job.clientHash,
      createdAt: job.createdAt
    }))
  };
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
