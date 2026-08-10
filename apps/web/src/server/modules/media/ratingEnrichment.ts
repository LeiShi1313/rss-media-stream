import { normalizeTitleKey } from "@rss-media/shared/titleNormalization";
import type { MediaType, ProviderSource } from "@rss-media/shared/types";
import type { AppConfig } from "../../config.js";
import { prisma } from "../../db.js";
import { getActiveRatingProviderSources } from "../../integrations/providers/ratingPreference.js";
import { providerRuntimeAvailable, resolveProviderRuntime } from "../../integrations/providers/runtime.js";
import { ProviderSearchSession } from "../../integrations/providers/searchSession.js";
import type { ProviderMetadataCandidate } from "../../integrations/providers/types.js";
import {
  LOW_CONFIDENCE_THRESHOLD,
  matchingSearchTitles,
  releaseYearIncompatible
} from "./matchingPolicy.js";
import { searchProviderWithRuntime } from "./providerDiscovery.js";
import { upsertProviderMediaMetadata } from "./providerIdentity.js";

type RatingSearchInput = {
  config: AppConfig;
  tenantId: string;
  mediaType: MediaType;
  title: string;
  titleCandidates?: string[];
  year?: number;
  season?: number;
  episode?: number;
};

export type ResolvedRatingCandidate = {
  providerSource: ProviderSource;
  candidate?: ProviderMetadataCandidate;
};

export function startRatingCandidateResolution(
  input: RatingSearchInput & { searchSession: ProviderSearchSession }
): Promise<ResolvedRatingCandidate | undefined> {
  return resolveRatingEnrichmentCandidate(input).catch(() => undefined);
}

export async function persistResolvedRatingCandidate(input: {
  mediaTitleId?: string | null;
  selectedProviderSource?: ProviderSource;
  selectedConfidence?: number;
  resolvedRating?: ResolvedRatingCandidate;
}) {
  const resolvedRating = input.resolvedRating;
  const candidate = resolvedRating?.candidate;
  const mediaTitleId = input.mediaTitleId;
  if (
    !mediaTitleId ||
    !resolvedRating ||
    !candidate ||
    resolvedRating.providerSource === input.selectedProviderSource ||
    (input.selectedProviderSource !== undefined &&
      (input.selectedConfidence ?? 0) < LOW_CONFIDENCE_THRESHOLD)
  ) {
    return false;
  }

  try {
    await prisma.$transaction((tx) => upsertProviderMediaMetadata(tx, candidate, {
      linkConfidence: 1,
      linkSource: "SEARCH_MATCH",
      mediaTitleId
    }));
    return true;
  } catch {
    // Rating enrichment is best-effort and must not change a completed release match.
    return false;
  }
}

export async function enrichMediaTitleRating(input: RatingSearchInput & {
  mediaTitleId: string;
  ratingProviderSource: ProviderSource;
  selectedProviderSource?: ProviderSource;
  selectedConfidence?: number;
}) {
  try {
    const resolvedRating = await resolveRatingCandidateForSource({
      ...input,
      searchSession: new ProviderSearchSession(searchProviderWithRuntime)
    });
    return persistResolvedRatingCandidate({
      mediaTitleId: input.mediaTitleId,
      selectedProviderSource: input.selectedProviderSource,
      selectedConfidence: input.selectedConfidence,
      resolvedRating
    });
  } catch {
    return false;
  }
}

export async function enrichPreferredRatingForMediaTitle(input: RatingSearchInput & {
  mediaTitleId: string;
  selectedProviderSource: ProviderSource;
}) {
  try {
    const ratingProviderSource = (await getActiveRatingProviderSources(
      input.tenantId,
      [input.mediaType]
    ))[input.mediaType];
    if (!ratingProviderSource || ratingProviderSource === input.selectedProviderSource) return false;
    return enrichMediaTitleRating({
      ...input,
      ratingProviderSource,
      selectedConfidence: 1
    });
  } catch {
    return false;
  }
}

async function resolveRatingEnrichmentCandidate(
  input: RatingSearchInput & { searchSession: ProviderSearchSession }
): Promise<ResolvedRatingCandidate | undefined> {
  const ratingProviderSource = (await getActiveRatingProviderSources(
    input.tenantId,
    [input.mediaType]
  ))[input.mediaType];
  if (!ratingProviderSource) return undefined;

  return resolveRatingCandidateForSource({
    ...input,
    ratingProviderSource
  });
}

async function resolveRatingCandidateForSource(
  input: RatingSearchInput & {
    searchSession: ProviderSearchSession;
    ratingProviderSource: ProviderSource;
  }
): Promise<ResolvedRatingCandidate> {
  const { ratingProviderSource } = input;
  const runtime = await resolveProviderRuntime(input.config, input.tenantId, ratingProviderSource);
  if (!providerRuntimeAvailable(runtime)) return { providerSource: ratingProviderSource };

  for (const searchTitle of matchingSearchTitles(input.title, input.titleCandidates)) {
    const results = await input.searchSession.search(ratingProviderSource, runtime, {
      title: searchTitle.title,
      titleSource: searchTitle.titleSource,
      mediaType: input.mediaType,
      year: input.year,
      season: input.season,
      episode: input.episode
    });
    const candidate = results.find((result) => strictRatingCandidateMatches({
      result,
      searchTitle: searchTitle.title,
      mediaType: input.mediaType,
      year: input.year
    }));
    if (candidate) return { providerSource: ratingProviderSource, candidate };
  }

  return { providerSource: ratingProviderSource };
}

function strictRatingCandidateMatches(input: {
  result: ProviderMetadataCandidate;
  searchTitle: string;
  mediaType: MediaType;
  year?: number;
}) {
  const { result } = input;
  if (
    result.mediaType !== input.mediaType ||
    typeof result.ratingValue !== "number" ||
    typeof result.ratingScale !== "number" ||
    result.ratingScale <= 0 ||
    !result.ratingType ||
    input.year == null ||
    result.releaseYear == null ||
    releaseYearIncompatible(input.mediaType, input.year, result.releaseYear)
  ) {
    return false;
  }

  const searchTitleKey = normalizeTitleKey(input.searchTitle);
  return [result.titleKey, result.normalizedTitle, result.originalTitle, ...result.titleAliases]
    .filter((title): title is string => Boolean(title))
    .some((title) => normalizeTitleKey(title) === searchTitleKey);
}
