import { Prisma } from "@prisma/client";
import type { MediaType } from "@rss-media/shared/types";
import { db } from "../../core/dbClient.js";
import { conflict } from "../../core/errors.js";
import { prisma } from "../../db.js";
import {
  parsedReleaseMatchInclude,
  type ActiveParsedReleaseMatch
} from "./parsedReleaseMatchInclude.js";

type Transaction = Prisma.TransactionClient;
const ACTIVE_STATUSES = ["MATCHED", "UNMATCHED"] as const;

export type ParsedReleaseSnapshot = Pick<
  Prisma.ParsedReleaseGetPayload<{}>,
  | "id"
  | "tenantId"
  | "title"
  | "providerSearchTitles"
  | "year"
  | "mediaType"
  | "tvUnitType"
  | "season"
  | "episode"
  | "episodeEnd"
  | "specialNumber"
  | "episodePart"
  | "resolution"
  | "quality"
  | "source"
  | "codec"
  | "audio"
  | "releaseGroup"
  | "variant"
  | "parseConfidence"
>;

export function snapshotParsedRelease(release: ParsedReleaseSnapshot): ParsedReleaseSnapshot {
  return {
    id: release.id,
    tenantId: release.tenantId,
    title: release.title,
    providerSearchTitles: release.providerSearchTitles,
    year: release.year,
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
    parseConfidence: release.parseConfidence
  };
}

export async function assertParsedReleaseSnapshotCurrent(
  tx: Transaction,
  snapshot: ParsedReleaseSnapshot
) {
  await lockParsedReleaseMatchWrites(tx, {
    tenantId: snapshot.tenantId,
    parsedReleaseId: snapshot.id
  });
  if (!(await parsedReleaseSnapshotStillCurrent(tx, snapshot))) {
    throw conflict(
      "PARSED_RELEASE_CHANGED",
      "Parsed release changed while matching; retry matching with the current parse"
    );
  }
}

export async function lockAndFindActiveParsedReleaseMatch(
  tx: Transaction,
  input: { tenantId: string; parsedReleaseId: string }
): Promise<ActiveParsedReleaseMatch | null> {
  await lockParsedReleaseMatchWrites(tx, input);
  return findActiveParsedReleaseMatch(tx, input);
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
    include: parsedReleaseMatchInclude
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
  if (active && activeParsedReleaseMatchEquivalent(active, input)) {
    return active;
  }

  if (input.replaceActive === false) {
    const equivalent = await findEquivalentActiveParsedReleaseMatch(tx, input);
    if (equivalent) return equivalent;
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
    include: parsedReleaseMatchInclude
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
      tvUnitType: true,
      season: true,
      episode: true,
      episodeEnd: true,
      specialNumber: true,
      episodePart: true,
      resolution: true,
      quality: true,
      source: true,
      codec: true,
      audio: true,
      releaseGroup: true,
      variant: true,
      parseConfidence: true
    }
  });

  return current != null && parsedReleaseSnapshotsMatch(snapshot, current);
}

async function findActiveParsedReleaseMatch(
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
    include: parsedReleaseMatchInclude,
    orderBy: [{ matchedAt: "desc" }, { updatedAt: "desc" }]
  });
}

async function findEquivalentActiveParsedReleaseMatch(
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
  }
): Promise<ActiveParsedReleaseMatch | null> {
  return db(tx).parsedReleaseMatch.findFirst({
    where: {
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
      invalidatedAt: null
    },
    include: parsedReleaseMatchInclude,
    orderBy: [{ matchedAt: "desc" }, { updatedAt: "desc" }]
  });
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
    expected.tvUnitType === current.tvUnitType,
    expected.season === current.season,
    expected.episode === current.episode,
    expected.episodeEnd === current.episodeEnd,
    expected.specialNumber === current.specialNumber,
    expected.episodePart === current.episodePart,
    expected.resolution === current.resolution,
    expected.quality === current.quality,
    expected.source === current.source,
    expected.codec === current.codec,
    expected.audio === current.audio,
    expected.releaseGroup === current.releaseGroup,
    expected.variant === current.variant,
    expected.parseConfidence === current.parseConfidence
  ].every(Boolean);
}

function stringArraysEqual(left: string[] | null | undefined, right: string[] | null | undefined) {
  const leftValues = left ?? [];
  const rightValues = right ?? [];
  return leftValues.length === rightValues.length &&
    leftValues.every((value, index) => value === rightValues[index]);
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

async function lockParsedReleaseMatchWrites(
  tx: Transaction,
  input: { tenantId: string; parsedReleaseId: string }
) {
  await lockTransactionKey(tx, `parsed-release-match:${input.tenantId}:${input.parsedReleaseId}`);
}

async function lockTransactionKey(tx: Transaction, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
