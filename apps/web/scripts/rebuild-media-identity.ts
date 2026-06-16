import { parseReleaseTitle } from "@rss-media/shared/releaseParser";
import { buildReleaseSignature } from "@rss-media/shared/releaseSignature";
import { normalizeTitleKey } from "@rss-media/shared/titleNormalization";
import type { ProviderSource } from "@rss-media/shared/types";
import type { Prisma } from "@prisma/client";
import { loadConfig } from "../src/server/config.js";
import { prisma } from "../src/server/db.js";
import {
  providerSourceForLegacyProviderEntity,
  getProviderSourceDefinition
} from "../src/server/integrations/providers/index.js";
import {
  matchParsedReleaseForItem,
  upsertProviderMediaMetadata
} from "../src/server/modules/media/media.service.js";

const dryRun = process.argv.includes("--dry-run");
const skipMatch = process.argv.includes("--skip-match");
const matchConcurrency = Number(process.env.REBUILD_MATCH_CONCURRENCY ?? 4);
const config = loadConfig();

type ReparseItem = {
  id: string;
  tenantId: string;
  rawTitle: string;
  sizeBytes: bigint | null;
};
type LegacyProviderTitleRow = Prisma.ProviderTitleGetPayload<{
  include: { mediaTitleLink: true };
}>;

async function main() {
  console.log(`media identity rebuild started${dryRun ? " (dry run)" : ""}`);

  const providerSourceConfigs = await backfillProviderSourceConfigs();
  const providerSourcePolicies = await backfillProviderSourcePolicies();
  const legacyProviderTitles = await loadLegacyProviderTitles();
  const providerMetadata = dryRun
    ? await backfillProviderMetadata(legacyProviderTitles)
    : undefined;

  const items = await prisma.rssItem.findMany({
    select: { id: true, tenantId: true, rawTitle: true, sizeBytes: true },
    orderBy: { firstSeenAt: "asc" }
  });

  if (dryRun) {
    console.log(JSON.stringify({
      providerSourceConfigs,
      providerSourcePolicies,
      providerMetadata,
      rssItemsToReparse: items.length
    }, null, 2));
    return;
  }

  await deleteDerivedMediaIdentityState();
  await backfillProviderMetadata(legacyProviderTitles);
  await deleteDerivedParseState();
  await reparseItems(items);

  if (!skipMatch) {
    await rematchItems(items);
  }

  console.log("media identity rebuild finished");
}

async function backfillProviderSourceConfigs() {
  const rows = await prisma.tenantProviderConfig.findMany();
  let upserted = 0;
  for (const row of rows) {
    for (const providerSource of providerSourcesForLegacyProvider(row.provider)) {
      upserted += 1;
      if (dryRun) continue;
      await prisma.tenantProviderSourceConfig.upsert({
        where: {
          tenantId_providerSource: {
            tenantId: row.tenantId,
            providerSource
          }
        },
        create: {
          tenantId: row.tenantId,
          providerSource,
          enabled: row.enabled,
          encryptedSecretsJson: row.encryptedSecretsJson,
          configuredAt: row.configuredAt,
          lastValidatedAt: row.lastValidatedAt,
          lastError: row.lastError,
          metadataLanguage: defaultLanguageForBackfill(providerSource, row.metadataLanguage),
          region: row.region,
          baseUrl: row.baseUrl
        },
        update: {
          enabled: row.enabled,
          encryptedSecretsJson: row.encryptedSecretsJson,
          configuredAt: row.configuredAt,
          lastValidatedAt: row.lastValidatedAt,
          lastError: row.lastError,
          metadataLanguage: defaultLanguageForBackfill(providerSource, row.metadataLanguage),
          region: row.region,
          baseUrl: row.baseUrl
        }
      });
    }
  }
  console.log(`provider source configs backfilled: ${upserted}`);
  return upserted;
}

async function backfillProviderSourcePolicies() {
  const rows = await prisma.tenantMediaProviderPolicy.findMany();
  let upserted = 0;
  for (const row of rows) {
    const providerSources = providerSourcesForLegacyProvider(row.provider);
    for (const [index, providerSource] of providerSources.entries()) {
      upserted += 1;
      if (dryRun) continue;
      await prisma.tenantProviderSourcePolicy.upsert({
        where: {
          tenantId_mediaType_providerSource: {
            tenantId: row.tenantId,
            mediaType: row.mediaType,
            providerSource
          }
        },
        create: {
          tenantId: row.tenantId,
          mediaType: row.mediaType,
          providerSource,
          enabledForMatching: row.enabledForMatching,
          enabledForPresentation: row.enabledForPresentation,
          matchingPriority: row.matchingPriority + index,
          presentationPriority: row.presentationPriority + index
        },
        update: {
          enabledForMatching: row.enabledForMatching,
          enabledForPresentation: row.enabledForPresentation,
          matchingPriority: row.matchingPriority + index,
          presentationPriority: row.presentationPriority + index
        }
      });
    }
  }
  console.log(`provider source policies backfilled: ${upserted}`);
  return upserted;
}

async function loadLegacyProviderTitles(): Promise<LegacyProviderTitleRow[]> {
  return prisma.providerTitle.findMany({
    include: { mediaTitleLink: true },
    orderBy: { createdAt: "asc" }
  });
}

async function backfillProviderMetadata(rows: LegacyProviderTitleRow[]) {
  let upserted = 0;
  let skipped = 0;
  for (const row of rows) {
    const providerSource = providerSourceForLegacyProviderEntity(row.provider, row.providerEntityType);
    if (!providerSource) {
      skipped += 1;
      continue;
    }
    upserted += 1;
    if (dryRun) continue;
    await prisma.$transaction(async (tx) => {
      await upsertProviderMediaMetadata(tx, {
        providerSource,
        provider: getProviderSourceDefinition(providerSource).provider,
        providerEntityType: row.providerEntityType as any,
        providerId: providerIdForSource(providerSource, row.providerId),
        mediaType: row.mediaType,
        title: row.title,
        normalizedTitle: row.normalizedTitle || normalizeTitleKey(row.title),
        titleKey: row.normalizedTitle || normalizeTitleKey(row.title),
        originalTitle: row.originalTitle ?? undefined,
        titleAliases: titleAliasesFromPayload(row.payload, row.title, row.originalTitle),
        releaseYear: row.releaseYear ?? undefined,
        endYear: row.endYear ?? undefined,
        language: row.language ?? undefined,
        region: row.region ?? undefined,
        localeKey: localeKeyFromParts(
          row.language ?? getProviderSourceDefinition(providerSource).defaultMetadataLanguage,
          row.region
        ),
        payload: row.payload,
        ratingValue: row.ratingValue ?? undefined,
        ratingScale: row.ratingScale ?? undefined,
        ratingVoteCount: row.ratingVoteCount ?? undefined,
        ratingType: ratingType(row.ratingType),
        matchConfidence: row.mediaTitleLink?.confidence ?? 1
      }, {
        linkConfidence: row.mediaTitleLink?.confidence ?? 1,
        linkSource: linkSource(row.mediaTitleLink?.source)
      });
    });
  }
  console.log(`provider metadata backfilled: ${upserted}; skipped: ${skipped}`);
  return { upserted, skipped };
}

async function deleteDerivedMediaIdentityState() {
  console.log("deleting derived media identity state");
  await prisma.subscription.updateMany({
    where: { mediaTitleId: { not: null } },
    data: { mediaTitleId: null }
  });
  await prisma.mediaTitleMerge.deleteMany({});
  await prisma.parsedReleaseMatch.deleteMany({});
  await prisma.parsedRelease.deleteMany({});
  await prisma.mediaTitle.deleteMany({});
}

async function deleteDerivedParseState() {
  console.log("deleting derived parsed release state");
  await prisma.parsedReleaseMatch.deleteMany({});
  await prisma.parsedRelease.deleteMany({});
}

async function reparseItems(items: ReparseItem[]) {
  console.log(`reparsing RSS items: ${items.length}`);
  let parsed = 0;
  let failed = 0;
  for (const item of items) {
    try {
      const release = parseReleaseTitle(item.rawTitle);
      const releaseSignature = buildReleaseSignature(release, item.sizeBytes ?? undefined);
      await prisma.rssItem.update({
        where: { id_tenantId: { id: item.id, tenantId: item.tenantId } },
        data: {
          parseStatus: "PARSED",
          parseConfidence: release.parseConfidence,
          releaseSignature,
          parsedRelease: {
            create: {
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
            }
          }
        }
      });
      parsed += 1;
    } catch (error) {
      failed += 1;
      await prisma.rssItem.update({
        where: { id_tenantId: { id: item.id, tenantId: item.tenantId } },
        data: {
          parseStatus: "FAILED",
          parseConfidence: 0
        }
      });
      console.error(`parse failed for ${item.id}`, error instanceof Error ? error.message : String(error));
    }
    if ((parsed + failed) % 250 === 0) {
      console.log(`reparse progress: ${parsed + failed}/${items.length}`);
    }
  }
  console.log(`reparse finished: parsed=${parsed}; failed=${failed}`);
}

async function rematchItems(items: ReparseItem[]) {
  console.log(`rematching parsed releases: ${items.length}; concurrency=${matchConcurrency}`);
  let matched = 0;
  let unmatched = 0;
  let failed = 0;
  let index = 0;

  async function worker() {
    while (true) {
      const current = index++;
      if (current >= items.length) return;
      const item = items[current]!;
      try {
        const match = await matchParsedReleaseForItem({
          tenantId: item.tenantId,
          itemId: item.id,
          config
        });
        if (match.status === "MATCHED") matched += 1;
        else unmatched += 1;
      } catch (error) {
        failed += 1;
        console.error(`match failed for ${item.id}`, error instanceof Error ? error.message : String(error));
      }
      if ((matched + unmatched + failed) % 50 === 0) {
        console.log(`match progress: ${matched + unmatched + failed}/${items.length} matched=${matched} unmatched=${unmatched} failed=${failed}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, matchConcurrency) }, () => worker()));
  console.log(`rematch finished: matched=${matched}; unmatched=${unmatched}; failed=${failed}`);
}

function providerSourcesForLegacyProvider(provider: string): ProviderSource[] {
  if (provider === "tmdb") return ["tmdb_api"];
  if (provider === "tvdb") return ["tvdb_api"];
  if (provider === "ptgen") return ["ptgen_imdb", "ptgen_douban"];
  return [];
}

function defaultLanguageForBackfill(providerSource: ProviderSource, language?: string | null) {
  return language ?? getProviderSourceDefinition(providerSource).defaultMetadataLanguage ?? null;
}

function providerIdForSource(providerSource: ProviderSource, providerId: string) {
  if (providerSource === "ptgen_imdb") return providerId.replace(/^imdb-/i, "");
  if (providerSource === "ptgen_douban") return providerId.replace(/^douban-/i, "");
  return providerId;
}

function titleAliasesFromPayload(payload: unknown, title: string, originalTitle?: string | null) {
  const blocked = new Set([title.toLowerCase(), originalTitle?.toLowerCase()].filter(Boolean) as string[]);
  const aliases = [
    ...stringArrayFromPayload(payload, "aliases"),
    ...stringArrayFromPayload(payload, "titles")
  ];
  return [...new Set(
    aliases
      .map((value) => value.trim())
      .filter((value) => value && !blocked.has(value.toLowerCase()))
  )];
}

function stringArrayFromPayload(payload: unknown, key: string) {
  if (!payload || typeof payload !== "object") return [];
  const value = (payload as Record<string, unknown>)[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function localeKeyFromParts(language?: string | null, region?: string | null) {
  const normalizedLanguage = language?.trim();
  const normalizedRegion = region?.trim();
  if (normalizedLanguage && normalizedRegion) return `${normalizedLanguage}-${normalizedRegion}`;
  return normalizedLanguage || normalizedRegion || "und";
}

function linkSource(value?: string | null) {
  if (value === "MANUAL" || value === "PROVIDER_CROSSREF" || value === "SEARCH_MATCH" || value === "IMPORT") {
    return value;
  }
  return "IMPORT";
}

function ratingType(value?: string | null) {
  if (value === "USER_SCORE") return "user_score";
  if (value === "CRITIC_SCORE") return "critic_score";
  if (value === "POPULARITY") return "popularity";
  return undefined;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
