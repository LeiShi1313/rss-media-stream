import type { TmdbTitleResult } from "@rss-media/shared/types";
import { scoreCandidate } from "./scoring.js";
import type { TmdbResult, TmdbSearchInput } from "./types.js";

export function toTitleResult(
  result: TmdbResult,
  endpoint: "movie" | "tv",
  input: TmdbSearchInput
): TmdbTitleResult {
  const title = endpoint === "movie" ? result.title : result.name;
  const originalTitle =
    endpoint === "movie" ? result.original_title : result.original_name;
  const releaseYear = extractYear(
    endpoint === "movie" ? result.release_date : result.first_air_date
  );
  const displayTitle = title ?? originalTitle ?? String(result.id);
  return {
    provider: "tmdb",
    providerEntityType: endpoint === "movie" ? "tmdb_movie" : "tmdb_tv",
    providerId: String(result.id),
    mediaType: endpoint === "movie" ? "MOVIE" : "TV_SERIES",
    title: displayTitle,
    normalizedTitle: normalizeTitle(displayTitle),
    originalTitle,
    releaseYear,
    language: input.language,
    region: input.region,
    payload: tmdbPayload(result),
    ratingValue: result.vote_average,
    ratingScale: result.vote_average === undefined ? undefined : 10,
    ratingVoteCount: result.vote_count,
    ratingType: result.vote_average === undefined ? undefined : "user_score",
    matchConfidence: scoreCandidate(input.title, displayTitle, input.year, releaseYear, result)
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

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
