import { parseReleaseTitle } from "@rss-media/shared/releaseParser";
import { buildReleaseSignature } from "@rss-media/shared/releaseSignature";
import type { Prisma } from "@prisma/client";
import { loadConfig } from "../src/server/config.js";
import { prisma } from "../src/server/db.js";
import {
  invalidateMatchesForParsedRelease,
  matchParsedReleaseForItem
} from "../src/server/modules/media/media.service.js";

const dryRun = process.argv.includes("--dry-run");
const rematch = process.argv.includes("--rematch") && !dryRun;
const rematchConcurrency = Number(process.env.REPARSE_REMATCH_CONCURRENCY ?? 4);
const config = loadConfig();

type ExistingParsedRelease = Prisma.ParsedReleaseGetPayload<{
  select: ReturnType<typeof parsedReleaseComparisonSelect>;
}>;

type ChangedItem = {
  itemId: string;
  tenantId: string;
  parsedReleaseId: string;
};

const batchSize = Number(process.env.REPARSE_BATCH_SIZE ?? 500);
const total = await prisma.rssItem.count();

console.log(JSON.stringify({
  event: "selected",
  total,
  batchSize,
  dryRun,
  rematch,
  rematchConcurrency
}));

let processed = 0;
let created = 0;
let changed = 0;
let unchanged = 0;
let failed = 0;
const changedItems: ChangedItem[] = [];
const examples: Array<{
  itemId: string;
  oldTitle?: string;
  newTitle: string;
  oldMediaType?: string;
  newMediaType: string;
  oldYear?: number | null;
  newYear?: number;
  oldSeason?: number | null;
  newSeason?: number;
  oldProviderSearchTitles?: string[];
  newProviderSearchTitles?: string[];
}> = [];
const errors: Array<{ itemId: string; message: string }> = [];
const startedAt = Date.now();

let cursor: string | undefined;
while (true) {
  const items = await prisma.rssItem.findMany({
    take: batchSize,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { id: "asc" },
    select: {
      id: true,
      tenantId: true,
      rawTitle: true,
      sizeBytes: true,
      parseStatus: true,
      parseConfidence: true,
      releaseSignature: true,
      parsedRelease: {
        select: parsedReleaseComparisonSelect()
      }
    }
  });
  if (items.length === 0) break;
  cursor = items[items.length - 1]!.id;

  for (const item of items) {
    try {
      const release = parseReleaseTitle(item.rawTitle);
      const releaseSignature = buildReleaseSignature(release, item.sizeBytes ?? undefined);
      const releaseChanged = !item.parsedRelease || parsedReleaseChanged(item.parsedRelease, release);
      const itemParseChanged = item.parseStatus !== "PARSED" ||
        item.parseConfidence !== release.parseConfidence ||
        item.releaseSignature !== releaseSignature;

      if (!item.parsedRelease) created += 1;
      else if (releaseChanged) changed += 1;
      else unchanged += 1;

      if ((releaseChanged || itemParseChanged) && examples.length < 20) {
        examples.push({
          itemId: item.id,
          oldTitle: item.parsedRelease?.title,
          newTitle: release.title,
          oldMediaType: item.parsedRelease?.mediaType,
          newMediaType: release.mediaType,
          oldYear: item.parsedRelease?.year,
          newYear: release.year,
          oldSeason: item.parsedRelease?.season,
          newSeason: release.season,
          oldProviderSearchTitles: item.parsedRelease?.providerSearchTitles,
          newProviderSearchTitles: release.providerSearchTitles
        });
      }

      if (!dryRun && (releaseChanged || itemParseChanged)) {
        const parsedRelease = await prisma.$transaction(async (tx) => {
          await tx.rssItem.update({
            where: { id_tenantId: { id: item.id, tenantId: item.tenantId } },
            data: {
              parseStatus: "PARSED",
              parseConfidence: release.parseConfidence,
              releaseSignature
            }
          });

          return tx.parsedRelease.upsert({
            where: { rssItemId_tenantId: { rssItemId: item.id, tenantId: item.tenantId } },
            create: {
              tenantId: item.tenantId,
              rssItemId: item.id,
              ...parsedReleaseData(release)
            },
            update: parsedReleaseData(release),
            select: { id: true }
          });
        });

        if (releaseChanged) {
          await invalidateMatchesForParsedRelease({
            tenantId: item.tenantId,
            parsedReleaseId: parsedRelease.id,
            staleReason: "parsed_release_reparsed"
          });
          changedItems.push({
            itemId: item.id,
            tenantId: item.tenantId,
            parsedReleaseId: parsedRelease.id
          });
        }
      }
    } catch (error) {
      failed += 1;
      if (errors.length < 20) {
        errors.push({
          itemId: item.id,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    processed += 1;
    if (processed % 1000 === 0 || processed === total) {
      const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      console.log(JSON.stringify({
        event: "progress",
        processed,
        total,
        created,
        changed,
        unchanged,
        failed,
        elapsedSeconds,
        perSecond: Number((processed / elapsedSeconds).toFixed(2))
      }));
    }
  }
}

let rematchProcessed = 0;
let rematchMatched = 0;
let rematchUnmatched = 0;
let rematchFailed = 0;
const rematchErrors: Array<{ itemId: string; message: string }> = [];

if (rematch && changedItems.length > 0) {
  let index = 0;
  async function worker() {
    while (true) {
      const current = index++;
      if (current >= changedItems.length) return;
      const item = changedItems[current]!;
      try {
        const result = await matchParsedReleaseForItem({
          tenantId: item.tenantId,
          itemId: item.itemId,
          config
        });
        if (result.status === "MATCHED") rematchMatched += 1;
        else rematchUnmatched += 1;
      } catch (error) {
        rematchFailed += 1;
        if (rematchErrors.length < 20) {
          rematchErrors.push({
            itemId: item.itemId,
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }

      rematchProcessed += 1;
      if (rematchProcessed % 100 === 0 || rematchProcessed === changedItems.length) {
        console.log(JSON.stringify({
          event: "rematch_progress",
          processed: rematchProcessed,
          total: changedItems.length,
          matched: rematchMatched,
          unmatched: rematchUnmatched,
          failed: rematchFailed
        }));
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.max(1, rematchConcurrency) },
    () => worker()
  ));
}

console.log(JSON.stringify({
  event: "finished",
  total,
  processed,
  created,
  changed,
  unchanged,
  failed,
  changedItems: changedItems.length,
  rematchProcessed,
  rematchMatched,
  rematchUnmatched,
  rematchFailed,
  examples,
  errors,
  rematchErrors
}, null, 2));

await prisma.$disconnect();

function parsedReleaseData(release: ReturnType<typeof parseReleaseTitle>) {
  return {
    title: release.title,
    providerSearchTitles: release.providerSearchTitles ?? [],
    year: release.year ?? null,
    mediaType: release.mediaType,
    season: release.season ?? null,
    episode: release.episode ?? null,
    episodeEnd: release.episodeEnd ?? null,
    resolution: release.resolution ?? null,
    quality: release.quality ?? null,
    source: release.source ?? null,
    codec: release.codec ?? null,
    audio: release.audio ?? null,
    releaseGroup: release.releaseGroup ?? null,
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
    season: true,
    episode: true,
    episodeEnd: true,
    resolution: true,
    quality: true,
    source: true,
    codec: true,
    audio: true,
    releaseGroup: true,
    parseConfidence: true
  } as const;
}

function parsedReleaseChanged(
  previous: ExistingParsedRelease,
  next: ReturnType<typeof parseReleaseTitle>
) {
  return [
    previous.title !== next.title,
    !stringArraysEqual(previous.providerSearchTitles, next.providerSearchTitles ?? []),
    previous.year !== (next.year ?? null),
    previous.mediaType !== next.mediaType,
    previous.season !== (next.season ?? null),
    previous.episode !== (next.episode ?? null),
    previous.episodeEnd !== (next.episodeEnd ?? null),
    previous.resolution !== (next.resolution ?? null),
    previous.quality !== (next.quality ?? null),
    previous.source !== (next.source ?? null),
    previous.codec !== (next.codec ?? null),
    previous.audio !== (next.audio ?? null),
    previous.releaseGroup !== (next.releaseGroup ?? null),
    previous.parseConfidence !== next.parseConfidence
  ].some(Boolean);
}

function stringArraysEqual(left: string[] | null | undefined, right: string[] | null | undefined) {
  const leftValues = left ?? [];
  const rightValues = right ?? [];
  return leftValues.length === rightValues.length &&
    leftValues.every((value, index) => value === rightValues[index]);
}
