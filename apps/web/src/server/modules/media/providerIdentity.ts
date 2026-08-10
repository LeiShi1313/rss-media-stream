import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { toJsonStorageValue } from "@rss-media/shared/json";
import type { ProviderMetadataCandidate } from "../../integrations/providers/types.js";
import { db } from "../../core/dbClient.js";
import { conflict, notFound } from "../../core/errors.js";

type Transaction = Prisma.TransactionClient;

export async function upsertProviderMediaMetadata(
  tx: Transaction,
  result: ProviderMetadataCandidate,
  input: {
    linkConfidence: number;
    linkSource: "MANUAL" | "PROVIDER_CROSSREF" | "SEARCH_MATCH" | "IMPORT";
    mediaTitleId?: string;
  }
) {
  const payload = toPrismaJson(result.payload);
  const payloadHash = hashJson(payload);
  const mediaTitle = input.mediaTitleId
    ? await db(tx).mediaTitle.findUnique({ where: { id: input.mediaTitleId } })
    : await upsertMediaTitleFromMetadata(tx, result);
  if (!mediaTitle) throw notFound("Media title");
  if (mediaTitle.mediaType !== result.mediaType) {
    throw conflict("MEDIA_TYPE_MISMATCH", "Provider metadata media type must match canonical title");
  }
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

async function upsertMediaTitleFromMetadata(
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

function providerRatingType(ratingType?: string) {
  if (ratingType === "user_score") return "USER_SCORE";
  if (ratingType === "critic_score") return "CRITIC_SCORE";
  if (ratingType === "popularity") return "POPULARITY";
  return undefined;
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return toJsonStorageValue(value) as Prisma.InputJsonValue;
}

function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
