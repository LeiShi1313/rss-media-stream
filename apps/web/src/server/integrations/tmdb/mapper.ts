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
    payload: tmdbPayload(result, seasonEpisodeEvidence),
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

function tmdbPayload(
  result: TmdbResult,
  seasonEpisodeEvidence?: TmdbTvSeasonEpisodeEvidence
) {
  return {
    posterPath: result.poster_path,
    backdropPath: result.backdrop_path,
    overview: result.overview,
    popularity: result.popularity,
    tvSeasonEpisode: seasonEpisodeEvidence,
    raw: result
  };
}

function scoreTmdbCandidate(input: {
  endpoint: "movie" | "tv";
  input: TmdbSearchInput;
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
    exactTitleMatch(input.input.title, input.candidateTitles)
  ) {
    return Math.max(baseScore, input.input.episode ? 0.96 : 0.93);
  }
  return baseScore;
}

function exactTitleMatch(query: string, candidateTitles: string[]) {
  const queryKey = normalizeForScore(query);
  return Boolean(queryKey) && candidateTitles.some((candidate) => normalizeForScore(candidate) === queryKey);
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
