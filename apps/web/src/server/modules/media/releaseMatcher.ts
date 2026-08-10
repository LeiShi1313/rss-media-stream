import type { MediaProvider, MediaType, ProviderSource } from "@rss-media/shared/types";
import type { AppConfig } from "../../config.js";
import { conflict, notFound } from "../../core/errors.js";
import { prisma } from "../../db.js";
import {
  normalizeProviderSource
} from "../../integrations/providers/sources.js";
import { getMatchingProviderOrder } from "../../integrations/providers/policy.js";
import { providerRuntimeAvailable, resolveProviderRuntime } from "../../integrations/providers/runtime.js";
import { ProviderSearchSession } from "../../integrations/providers/searchSession.js";
import type { ProviderMetadataCandidate } from "../../integrations/providers/types.js";
import {
  LOW_CONFIDENCE_THRESHOLD,
  MIN_AUTO_MATCH_CONFIDENCE,
  matchingSearchTitles,
  releaseYearIncompatible
} from "./matchingPolicy.js";
import {
  lookupProviderMediaMetadata,
  searchProviderWithRuntime
} from "./providerDiscovery.js";
import { upsertProviderMediaMetadata } from "./providerIdentity.js";
import {
  enrichPreferredRatingForMediaTitle,
  persistResolvedRatingCandidate,
  startRatingCandidateResolution
} from "./ratingEnrichment.js";
import {
  assertParsedReleaseSnapshotCurrent,
  createMatchedParsedReleaseMatch,
  createUnmatchedParsedReleaseMatch,
  invalidateActiveReleaseDecisions,
  lockAndFindActiveParsedReleaseMatch,
  snapshotParsedRelease
} from "./releaseMatchLedger.js";

export async function matchParsedReleaseForItem(input: {
  tenantId: string;
  itemId: string;
  config: AppConfig;
}) {
  const item = await prisma.rssItem.findFirst({
    where: { id: input.itemId, tenantId: input.tenantId },
    include: { parsedRelease: true }
  });
  if (!item) throw notFound("Item");
  if (!item.parsedRelease) {
    throw conflict("ITEM_NOT_PARSED", "Item has not been parsed");
  }

  const release = item.parsedRelease;
  const releaseSnapshot = snapshotParsedRelease(release);
  if (release.mediaType === "UNKNOWN") {
    return prisma.$transaction(async (tx) => {
      await assertParsedReleaseSnapshotCurrent(tx, releaseSnapshot);

      return createUnmatchedParsedReleaseMatch(tx, {
        tenantId: input.tenantId,
        parsedReleaseId: releaseSnapshot.id,
        reason: "unknown_media_type"
      });
    });
  }

  const searchSession = new ProviderSearchSession(searchProviderWithRuntime);
  const ratingCandidatePromise = startRatingCandidateResolution({
    config: input.config,
    tenantId: input.tenantId,
    title: release.title,
    titleCandidates: release.providerSearchTitles,
    mediaType: release.mediaType,
    year: release.year ?? undefined,
    season: release.season ?? undefined,
    episode: release.episode ?? undefined,
    searchSession
  });
  const selected = await selectProviderTitleCandidate({
    config: input.config,
    tenantId: input.tenantId,
    title: release.title,
    titleCandidates: release.providerSearchTitles,
    mediaType: release.mediaType,
    year: release.year ?? undefined,
    season: release.season ?? undefined,
    episode: release.episode ?? undefined,
    searchSession
  });

  if (!selected.result) {
    return prisma.$transaction(async (tx) => {
      await assertParsedReleaseSnapshotCurrent(tx, releaseSnapshot);

      return createUnmatchedParsedReleaseMatch(tx, {
        tenantId: input.tenantId,
        parsedReleaseId: releaseSnapshot.id,
        reason: selected.reason
      });
    });
  }

  const persistedMatch = await prisma.$transaction(async (tx) => {
    await assertParsedReleaseSnapshotCurrent(tx, releaseSnapshot);

    const providerMetadata = await upsertProviderMediaMetadata(tx, selected.result, {
      linkConfidence: selected.result.matchConfidence ?? 0,
      linkSource: "SEARCH_MATCH"
    });
    const confidence = selected.result.matchConfidence ?? 0;

    const match = await createMatchedParsedReleaseMatch(tx, {
      tenantId: input.tenantId,
      parsedReleaseId: releaseSnapshot.id,
      mediaTitleId: providerMetadata.mediaTitle.id,
      mediaProviderIdentityId: providerMetadata.identity.id,
      providerMediaMetadataId: providerMetadata.metadata.id,
      // upsertProviderMediaMetadata guarantees mediaTitle.mediaType === selected.result.mediaType
      mediaType: selected.result.mediaType,
      source: "AUTO",
      confidence,
      reason: confidence < LOW_CONFIDENCE_THRESHOLD
        ? "automatic_low_confidence_match"
        : "automatic_match"
    });
    return { match, mediaTitleId: providerMetadata.mediaTitle.id };
  });

  void ratingCandidatePromise.then((resolvedRating) => persistResolvedRatingCandidate({
    mediaTitleId: persistedMatch.mediaTitleId,
    selectedProviderSource: selected.result.providerSource,
    selectedConfidence: selected.result.matchConfidence ?? 0,
    resolvedRating
  }));
  return persistedMatch.match;
}

async function selectProviderTitleCandidate(input: {
  config: AppConfig;
  tenantId: string;
  mediaType: MediaType;
  title: string;
  titleCandidates?: string[];
  year?: number;
  season?: number;
  episode?: number;
  searchSession: ProviderSearchSession;
}) {
  let configured = 0;
  let missingReleaseYear = false;
  let bestLowConfidenceResult: ProviderMetadataCandidate | undefined;
  const searchTitles = matchingSearchTitles(input.title, input.titleCandidates);
  const providerSourceOrder = await getMatchingProviderOrder(input.tenantId, input.mediaType);
  if (providerSourceOrder.length === 0) {
    return { reason: "provider_disabled_by_policy" };
  }

  for (const providerSource of providerSourceOrder) {
    const runtime = await resolveProviderRuntime(input.config, input.tenantId, providerSource);
    if (!providerRuntimeAvailable(runtime)) {
      continue;
    }
    configured += 1;

    for (const searchTitle of searchTitles) {
      let results: ProviderMetadataCandidate[];
      try {
        results = await input.searchSession.search(providerSource, runtime, {
          title: searchTitle.title,
          titleSource: searchTitle.titleSource,
          mediaType: input.mediaType,
          year: input.year,
          season: input.season,
          episode: input.episode
        });
      } catch {
        break;
      }

      for (const result of results) {
        if (result.releaseYear == null) {
          missingReleaseYear = true;
          continue;
        }
        if (releaseYearIncompatible(input.mediaType, input.year, result.releaseYear)) {
          continue;
        }
        if ((result.matchConfidence ?? 0) < MIN_AUTO_MATCH_CONFIDENCE) {
          continue;
        }
        if ((result.matchConfidence ?? 0) < LOW_CONFIDENCE_THRESHOLD) {
          if (
            !bestLowConfidenceResult ||
            (result.matchConfidence ?? 0) > (bestLowConfidenceResult.matchConfidence ?? 0)
          ) {
            bestLowConfidenceResult = result;
          }
          continue;
        }
        return { result };
      }
    }
  }

  if (bestLowConfidenceResult) {
    return { result: bestLowConfidenceResult };
  }

  return {
    reason: configured === 0
      ? "provider_not_configured"
      : missingReleaseYear
        ? "missing_release_year_for_auto_match"
        : "no_result"
  };
}

export async function manuallyMatchParsedReleaseWithProvider(input: {
  tenantId: string;
  itemId: string;
  config: AppConfig;
  providerSource?: ProviderSource;
  provider?: MediaProvider;
  providerEntityType?: string;
  providerId: string;
  mediaType: MediaType;
}) {
  const item = await prisma.rssItem.findFirst({
    where: { id: input.itemId, tenantId: input.tenantId },
    include: { parsedRelease: true }
  });
  if (!item) throw notFound("Item");
  if (!item.parsedRelease) {
    throw conflict("ITEM_NOT_PARSED", "Item has not been parsed");
  }

  const providerSource = normalizeProviderSource(input.providerSource ?? input.provider);
  if (!providerSource) {
    throw conflict("UNSUPPORTED_PROVIDER_SOURCE", "Manual match requires a supported provider source");
  }
  const selected = await lookupProviderMediaMetadata(input.config, input.tenantId, providerSource, {
    providerEntityType: input.providerEntityType,
    providerId: input.providerId,
    mediaType: input.mediaType
  });

  const persistedMatch = await prisma.$transaction(async (tx) => {
    const oldActive = await lockAndFindActiveParsedReleaseMatch(tx, {
      tenantId: input.tenantId,
      parsedReleaseId: item.parsedRelease!.id
    });
    const providerMetadata = await upsertProviderMediaMetadata(tx, selected, {
      linkConfidence: 1,
      linkSource: "MANUAL"
    });

    if (oldActive?.status === "UNMATCHED") {
      await invalidateActiveReleaseDecisions(tx, {
        tenantId: input.tenantId,
        parsedReleaseId: item.parsedRelease!.id,
        staleReason: "manual_provider_identity"
      });
    }

    const next = await createMatchedParsedReleaseMatch(tx, {
      tenantId: input.tenantId,
      parsedReleaseId: item.parsedRelease!.id,
      mediaTitleId: providerMetadata.mediaTitle.id,
      mediaProviderIdentityId: providerMetadata.identity.id,
      providerMediaMetadataId: providerMetadata.metadata.id,
      // upsertProviderMediaMetadata guarantees mediaTitle.mediaType === selected.mediaType
      mediaType: selected.mediaType,
      source: "MANUAL",
      confidence: 1,
      reason: "manual_provider_identity"
    });

    return { match: next, mediaTitleId: providerMetadata.mediaTitle.id };
  });

  void enrichPreferredRatingForMediaTitle({
    config: input.config,
    tenantId: input.tenantId,
    mediaTitleId: persistedMatch.mediaTitleId,
    mediaType: selected.mediaType,
    title: item.parsedRelease.title,
    titleCandidates: item.parsedRelease.providerSearchTitles,
    year: item.parsedRelease.year ?? undefined,
    season: item.parsedRelease.season ?? undefined,
    episode: item.parsedRelease.episode ?? undefined,
    selectedProviderSource: selected.providerSource
  });
  return persistedMatch.match;
}
