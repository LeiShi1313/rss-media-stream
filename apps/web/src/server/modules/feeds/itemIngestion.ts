import type { Prisma } from "@prisma/client";
import {
  extractInfoHash,
  extractRssSourceUrl,
  extractRssTorrentUrl,
  normalizeInfoHash,
  parsePositiveBigInt,
  parseRssDate,
  readString
} from "@rss-media/shared/rss";
import { buildReleaseSignature } from "@rss-media/shared/releaseSignature";
import { parseReleaseTitle } from "@rss-media/shared/releaseParser";
import { stringifyJsonStorageValue } from "@rss-media/shared/json";
import { redactSecrets } from "@rss-media/shared/redact";
import { prisma } from "../../db.js";
import { encryptAead, hmacSecret } from "../../secrets.js";
import { invalidateMatchesForParsedRelease } from "../media/releaseMatchLedger.js";

export type RssParserItem = {
  title?: string;
  link?: string;
  guid?: string;
  isoDate?: string;
  pubDate?: string;
  content?: string;
  contentSnippet?: string;
  enclosure?: {
    url?: string;
    length?: string | number;
    type?: string;
  };
  links?: unknown;
  torrentInfoHash?: string;
  torrentContentLength?: string | number;
  torrentMagnetUri?: string;
  [key: string]: unknown;
};

export type NormalizedRssItem = {
  rawTitle: string;
  torrentUrl: string;
  sourceUrl?: string;
  guid?: string;
  infoHash?: string;
  publishDate?: Date;
  firstSeenAt?: Date;
  sizeBytes?: bigint;
};

export type UpsertNormalizedRssItemResult = {
  itemId: string;
  created: boolean;
  updated: boolean;
  releaseChanged: boolean;
};

type DedupeKey = {
  type: "INFO_HASH" | "RELEASE_SIGNATURE" | "LINK_HASH";
  hash: string;
  releaseSignature?: string;
};

export function normalizeFeedItem(raw: RssParserItem): NormalizedRssItem | null {
  const torrentUrl = extractRssTorrentUrl(raw);
  const rawTitle = readString(raw.title)?.trim();
  if (!torrentUrl || !rawTitle) return null;

  return {
    rawTitle,
    torrentUrl,
    sourceUrl: extractRssSourceUrl(raw, torrentUrl),
    guid: readString(raw.guid),
    infoHash: normalizeInfoHash(
      readString(raw.torrentInfoHash) ?? extractInfoHash(torrentUrl) ?? readString(raw.guid)
    ),
    publishDate: parseRssDate(raw.isoDate ?? raw.pubDate),
    sizeBytes: parsePositiveBigInt(raw.torrentContentLength ?? raw.enclosure?.length)
  };
}

export async function upsertNormalizedRssItem(input: {
  tenantId: string;
  feedId: string;
  item: NormalizedRssItem;
  rawPayload: unknown;
}): Promise<UpsertNormalizedRssItemResult> {
  const release = parseReleaseTitle(input.item.rawTitle);
  const dedupe = chooseDedupeKey(input.item, release);
  const safeRaw = safeRawPayload(input.rawPayload);
  const infoHash = input.item.infoHash ? hmacSecret(input.item.infoHash.toLowerCase()) : null;
  const guidHash = input.item.guid ? hmacSecret(input.item.guid) : null;
  const linkHash = hmacSecret(input.item.torrentUrl);
  const unique = {
    feedId: input.feedId,
    dedupeKeyType: dedupe.type,
    dedupeKeyHash: dedupe.hash
  };

  const existing = await findExistingFeedItem({
    feedId: input.feedId,
    tenantId: input.tenantId,
    unique,
    infoHash,
    guidHash,
    linkHash
  });

  if (!existing) {
    const createdItem = await prisma.rssItem.create({
      data: {
        tenantId: input.tenantId,
        feedId: input.feedId,
        ...rssItemData(input.item, dedupe, infoHash, guidHash, linkHash, safeRaw, release),
        parsedRelease: {
          create: parsedReleaseData(release)
        }
      },
      select: { id: true }
    });

    return {
      itemId: createdItem.id,
      created: true,
      updated: false,
      releaseChanged: true
    };
  }

  const previousRelease = await prisma.parsedRelease.findUnique({
    where: {
      rssItemId_tenantId: {
        rssItemId: existing.id,
        tenantId: input.tenantId
      }
    },
    select: parsedReleaseComparisonSelect()
  });

  await prisma.rssItem.update({
    where: { id_tenantId: { id: existing.id, tenantId: input.tenantId } },
    data: {
      ...rssItemData(input.item, dedupe, infoHash, guidHash, linkHash, safeRaw, release),
      parsedRelease: {
        upsert: {
          create: parsedReleaseData(release),
          update: parsedReleaseData(release)
        }
      }
    }
  });

  const releaseChanged = !previousRelease || parsedReleaseChanged(previousRelease, release);
  if (previousRelease && releaseChanged) {
    await invalidateMatchesForParsedRelease({
      tenantId: input.tenantId,
      parsedReleaseId: previousRelease.id,
      staleReason: "parsed_release_changed"
    });
  }

  return {
    itemId: existing.id,
    created: false,
    updated: true,
    releaseChanged
  };
}

export function chooseDedupeKey(
  item: NormalizedRssItem,
  release = parseReleaseTitle(item.rawTitle)
): DedupeKey {
  if (item.infoHash) {
    return {
      type: "INFO_HASH",
      hash: hmacSecret(item.infoHash.toLowerCase())
    };
  }

  const signature = buildReleaseSignature(release, item.sizeBytes);
  if (signature) {
    return {
      type: "RELEASE_SIGNATURE",
      hash: hmacSecret(signature),
      releaseSignature: signature
    };
  }

  return {
    type: "LINK_HASH",
    hash: hmacSecret(item.torrentUrl)
  };
}

export function safeRawPayload(raw: unknown) {
  const json = stringifyJsonStorageValue(raw);
  return {
    rawJsonEncrypted: encryptAead(json),
    rawJsonRedacted: JSON.parse(redactSecrets(json)) as Prisma.InputJsonValue
  };
}

async function findExistingFeedItem(input: {
  feedId: string;
  tenantId: string;
  unique: {
    feedId: string;
    dedupeKeyType: DedupeKey["type"];
    dedupeKeyHash: string;
  };
  infoHash: string | null;
  guidHash: string | null;
  linkHash: string;
}) {
  const exact = await prisma.rssItem.findUnique({
    where: { feedId_dedupeKeyType_dedupeKeyHash: input.unique },
    select: { id: true }
  });
  if (exact) return exact;

  const stableIdentifiers: Prisma.RssItemWhereInput[] = [{ linkHash: input.linkHash }];
  if (input.infoHash) stableIdentifiers.push({ infoHash: input.infoHash });
  if (input.guidHash) stableIdentifiers.push({ guidHash: input.guidHash });

  return prisma.rssItem.findFirst({
    where: {
      feedId: input.feedId,
      tenantId: input.tenantId,
      OR: stableIdentifiers
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true }
  });
}

function rssItemData(
  item: NormalizedRssItem,
  dedupe: DedupeKey,
  infoHash: string | null,
  guidHash: string | null,
  linkHash: string,
  safeRaw: ReturnType<typeof safeRawPayload>,
  release: ReturnType<typeof parseReleaseTitle>
) {
  return {
    rawTitle: item.rawTitle,
    infoHash,
    guidHash,
    linkHash,
    dedupeKeyType: dedupe.type,
    dedupeKeyHash: dedupe.hash,
    releaseSignature: dedupe.releaseSignature,
    encryptedTorrentUrl: encryptAead(item.torrentUrl),
    encryptedSourceUrl: item.sourceUrl ? encryptAead(item.sourceUrl) : null,
    publishDate: item.publishDate,
    firstSeenAt: item.firstSeenAt,
    sizeBytes: item.sizeBytes,
    ...safeRaw,
    parseStatus: "PARSED" as const,
    parseConfidence: release.parseConfidence
  };
}

function parsedReleaseData(release: ReturnType<typeof parseReleaseTitle>) {
  return {
    title: release.title,
    providerSearchTitles: release.providerSearchTitles ?? [],
    year: release.year ?? null,
    mediaType: release.mediaType,
    tvUnitType: release.tvUnitType ?? null,
    season: release.season ?? null,
    episode: release.episode ?? null,
    episodeEnd: release.episodeEnd ?? null,
    specialNumber: release.specialNumber ?? null,
    episodePart: release.episodePart ?? null,
    resolution: release.resolution ?? null,
    quality: release.quality ?? null,
    source: release.source ?? null,
    codec: release.codec ?? null,
    audio: release.audio ?? null,
    releaseGroup: release.releaseGroup ?? null,
    variant: release.variant ?? null,
    parseConfidence: release.parseConfidence,
    parsedAt: new Date()
  };
}

function parsedReleaseComparisonSelect() {
  return {
    id: true,
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
  } as const;
}

function parsedReleaseChanged(
  previous: Prisma.ParsedReleaseGetPayload<{ select: ReturnType<typeof parsedReleaseComparisonSelect> }>,
  next: ReturnType<typeof parseReleaseTitle>
) {
  return [
    previous.title !== next.title,
    !stringArraysEqual(previous.providerSearchTitles, next.providerSearchTitles ?? []),
    previous.year !== (next.year ?? null),
    previous.mediaType !== next.mediaType,
    (previous.tvUnitType ?? null) !== (next.tvUnitType ?? null),
    previous.season !== (next.season ?? null),
    previous.episode !== (next.episode ?? null),
    previous.episodeEnd !== (next.episodeEnd ?? null),
    previous.specialNumber !== (next.specialNumber ?? null),
    (previous.episodePart ?? null) !== (next.episodePart ?? null),
    previous.resolution !== (next.resolution ?? null),
    previous.quality !== (next.quality ?? null),
    previous.source !== (next.source ?? null),
    previous.codec !== (next.codec ?? null),
    previous.audio !== (next.audio ?? null),
    previous.releaseGroup !== (next.releaseGroup ?? null),
    (previous.variant ?? null) !== (next.variant ?? null),
    previous.parseConfidence !== next.parseConfidence
  ].some(Boolean);
}

function stringArraysEqual(left: string[] | null | undefined, right: string[] | null | undefined) {
  const leftValues = left ?? [];
  const rightValues = right ?? [];
  return leftValues.length === rightValues.length &&
    leftValues.every((value, index) => value === rightValues[index]);
}
