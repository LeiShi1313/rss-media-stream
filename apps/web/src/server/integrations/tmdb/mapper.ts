import type { TmdbMedia } from "@rss-media/shared/types";
import { scoreCandidate } from "./scoring.js";
import type { TmdbResult, TmdbSearchInput } from "./types.js";

export function toMedia(
  result: TmdbResult,
  endpoint: "movie" | "tv",
  input: TmdbSearchInput
): TmdbMedia {
  const title = endpoint === "movie" ? result.title : result.name;
  const originalTitle =
    endpoint === "movie" ? result.original_title : result.original_name;
  const year = extractYear(
    endpoint === "movie" ? result.release_date : result.first_air_date
  );
  return {
    provider: "tmdb",
    providerId: String(result.id),
    kind: endpoint === "movie" ? "MOVIE" : "TV",
    title: title ?? originalTitle ?? String(result.id),
    originalTitle,
    year,
    posterPath: result.poster_path,
    backdropPath: result.backdrop_path,
    overview: result.overview,
    score: scoreCandidate(input.query, title ?? "", input.year, year, result),
    metadataJson: tmdbMetadata(result),
    raw: result
  };
}

function extractYear(value?: string): number | undefined {
  if (!value) return undefined;
  const year = Number(value.slice(0, 4));
  return Number.isFinite(year) ? year : undefined;
}

function tmdbMetadata(result: TmdbResult) {
  return {
    popularity: result.popularity,
    voteCount: result.vote_count
  };
}
