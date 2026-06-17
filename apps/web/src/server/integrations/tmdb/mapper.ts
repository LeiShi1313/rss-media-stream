import { normalizeTitleKey } from "@rss-media/shared/titleNormalization";
import type { TmdbTitleResult } from "@rss-media/shared/types";
import { normalizeForScore, scoreProviderCandidate } from "../providers/scoring.js";
import type { TmdbResult, TmdbSearchInput, TmdbTvSeasonEpisodeEvidence } from "./types.js";

export function toTitleResult(
  result: TmdbResult,
  endpoint: "movie" | "tv",
  input: TmdbSearchInput,
  extraCandidateTitles: string[] = [],
  seasonEpisodeEvidence?: TmdbTvSeasonEpisodeEvidence
): TmdbTitleResult {
  const title = endpoint === "movie" ? result.title : result.name;
  const originalTitle =
    endpoint === "movie" ? result.original_title : result.original_name;
  const releaseYear = extractYear(
    endpoint === "movie" ? result.release_date : result.first_air_date
  );
  const displayTitle = title ?? originalTitle ?? String(result.id);
  const candidateTitles = uniqueTitles([displayTitle, originalTitle, ...extraCandidateTitles]);
  const titleAliases = candidateTitles.filter((candidate) => candidate !== displayTitle);
  const matchConfidence = scoreTmdbCandidate({
    endpoint,
    input,
    result,
    candidateTitles,
    releaseYear,
    seasonEpisodeEvidence
  });
  return {
    provider: "tmdb",
    providerEntityType: endpoint === "movie" ? "tmdb_movie" : "tmdb_tv",
    providerId: String(result.id),
    mediaType: endpoint === "movie" ? "MOVIE" : "TV_SERIES",
    title: displayTitle,
    normalizedTitle: normalizeTitleKey(displayTitle),
    originalTitle,
    titleAliases,
    releaseYear,
    language: input.language,
    region: input.region,
    payload: tmdbPayload(result),
    ratingValue: result.vote_average,
    ratingScale: result.vote_average === undefined ? undefined : 10,
    ratingVoteCount: result.vote_count,
    ratingType: result.vote_average === undefined ? undefined : "user_score",
    matchConfidence,
    externalUrl: `https://www.themoviedb.org/${endpoint}/${result.id}`
  };
}

function extractYear(value?: string): number | undefined {
  if (!value) return undefined;
  const year = Number(value.slice(0, 4));
  return Number.isFinite(year) ? year : undefined;
}

function tmdbPayload(result: TmdbResult) {
  return {
    posterPath: result.poster_path,
    backdropPath: result.backdrop_path,
    overview: result.overview,
    popularity: result.popularity,
    raw: result
  };
}

function scoreTmdbCandidate(input: {
  endpoint: "movie" | "tv";
  input: TmdbSearchInput;
  result: TmdbResult;
  candidateTitles: string[];
  releaseYear?: number;
  seasonEpisodeEvidence?: TmdbTvSeasonEpisodeEvidence;
}) {
  const mediaType = input.endpoint === "movie" ? "MOVIE" : "TV_SERIES";
  const baseScore = scoreProviderCandidate({
    query: input.input.title,
    candidateTitles: input.candidateTitles,
    mediaType,
    expectedYear: input.input.year,
    actualYear: input.releaseYear,
    season: input.input.season
  });
  if (
    input.endpoint === "tv" &&
    input.input.season &&
    input.seasonEpisodeEvidence?.confirmed &&
    tmdbTitleSupportsSeasonEvidence({
      query: input.input.title,
      candidateTitles: input.candidateTitles,
      originCountries: input.result.origin_country
    })
  ) {
    return Math.max(baseScore, input.input.episode ? 0.96 : 0.93);
  }
  if (
    input.endpoint === "tv" &&
    input.input.season &&
    input.input.episode &&
    tmdbTitleHasRegionalEvidence({
      query: input.input.title,
      candidateTitles: input.candidateTitles,
      originCountries: input.result.origin_country
    })
  ) {
    return Math.max(baseScore, 0.88);
  }
  if (
    input.endpoint === "tv" &&
    tmdbTitleHasChineseRegionDisplayEvidence({
      query: input.input.title,
      displayTitle: input.result.name,
      originCountries: input.result.origin_country
    })
  ) {
    return Math.max(baseScore, 0.88);
  }
  return baseScore;
}

export function tmdbTitleSupportsSeasonEvidence(input: {
  query: string;
  candidateTitles: readonly string[];
  originCountries?: readonly string[];
}) {
  const queryKey = normalizeForScore(input.query);
  if (!queryKey) return false;
  const candidateKeys = input.candidateTitles
    .map((candidate) => normalizeForScore(candidate))
    .filter(Boolean);
  if (candidateKeys.some((candidate) => candidate === queryKey)) return true;

  const queryRegional = stripQueryRegionalSuffix(input.query, queryKey);
  if (!queryRegional) return false;
  if (!originCountryMatches(input.originCountries, queryRegional.country)) return false;

  return candidateKeys.some((candidate) => {
    if (candidate === queryRegional.titleKey) return true;
    const candidateRegional = stripRegionalSuffix(candidate);
    return candidateRegional?.country === queryRegional.country &&
      candidateRegional.titleKey === queryRegional.titleKey;
  });
}

function tmdbTitleHasRegionalEvidence(input: {
  query: string;
  candidateTitles: readonly string[];
  originCountries?: readonly string[];
}) {
  const queryKey = normalizeForScore(input.query);
  if (!queryKey) return false;

  const queryRegional = stripQueryRegionalSuffix(input.query, queryKey);
  if (!queryRegional) return false;
  if (!originCountryMatches(input.originCountries, queryRegional.country)) return false;

  const candidateKeys = input.candidateTitles
    .map((candidate) => normalizeForScore(candidate))
    .filter(Boolean);
  return candidateKeys.some((candidate) => {
    if (candidate === queryKey || candidate === queryRegional.titleKey) return true;
    const candidateRegional = stripRegionalSuffix(candidate);
    return candidateRegional?.country === queryRegional.country &&
      candidateRegional.titleKey === queryRegional.titleKey;
  });
}

function tmdbTitleHasChineseRegionDisplayEvidence(input: {
  query: string;
  displayTitle?: string;
  originCountries?: readonly string[];
}) {
  if (!originCountryMatches(input.originCountries, "CN") && !originCountryMatches(input.originCountries, "HK")) {
    return false;
  }
  if (!containsCjk(input.query)) return false;

  const queryKey = normalizeForScore(input.query);
  const displayTitleKey = normalizeForScore(input.displayTitle ?? "");
  return Boolean(queryKey && displayTitleKey && queryKey === displayTitleKey);
}

function originCountryMatches(
  originCountries: readonly string[] | undefined,
  expectedCountry: string
) {
  return originCountries?.some((country) => country.toUpperCase() === expectedCountry) ?? false;
}

function stripQueryRegionalSuffix(query: string, titleKey: string) {
  const regional = stripRegionalSuffix(titleKey);
  if (!regional) return undefined;
  const rawSuffix = query.trim().match(/([\p{Letter}\p{Number}]+)$/u)?.[1];
  if (regional.country === "US" && rawSuffix !== "US" && rawSuffix !== "USA") {
    return undefined;
  }
  return regional;
}

function stripRegionalSuffix(titleKey: string) {
  const tokens = titleKey.split(" ");
  if (tokens.length < 2) return undefined;
  const country = regionalSuffixCountries[tokens[tokens.length - 1] ?? ""];
  if (!country) return undefined;
  return {
    titleKey: tokens.slice(0, -1).join(" "),
    country
  };
}

const regionalSuffixCountries: Record<string, string> = {
  au: "AU",
  aus: "AU",
  australia: "AU",
  us: "US",
  usa: "US",
  uk: "GB",
  gb: "GB",
  nz: "NZ",
  ca: "CA",
  canada: "CA"
};

function containsCjk(value: string) {
  return /[\u3400-\u9fff]/u.test(value);
}

function uniqueTitles(values: Array<string | undefined>) {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const value of values) {
    const title = value?.trim();
    if (!title) continue;
    const key = title.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
  }
  return titles;
}
