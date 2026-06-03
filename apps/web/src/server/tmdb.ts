import type { TmdbMedia } from "@rss-media/shared/types";
import type { AppConfig } from "./config.js";

type TmdbResult = {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string;
  backdrop_path?: string;
  overview?: string;
  vote_count?: number;
  popularity?: number;
};

export async function searchTmdb(
  config: AppConfig,
  input: { query: string; kind?: "MOVIE" | "TV" | "UNKNOWN"; year?: number }
): Promise<TmdbMedia[]> {
  if (!config.tmdbApiKey) return [];
  const kind = input.kind === "TV" ? "tv" : "movie";
  const params = new URLSearchParams({
    api_key: config.tmdbApiKey,
    query: input.query,
    include_adult: "false",
    language: "en-US",
    page: "1"
  });
  if (input.year) {
    params.set(kind === "tv" ? "first_air_date_year" : "year", String(input.year));
  }
  const response = await fetch(`https://api.themoviedb.org/3/search/${kind}?${params}`);
  if (!response.ok) {
    throw new Error(`TMDB search failed with ${response.status}`);
  }
  const body = (await response.json()) as { results?: TmdbResult[] };
  return (body.results ?? []).slice(0, 8).map((result) => toMedia(result, kind, input));
}

function toMedia(
  result: TmdbResult,
  endpoint: "movie" | "tv",
  input: { query: string; year?: number }
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
    raw: result
  };
}

function extractYear(value?: string): number | undefined {
  if (!value) return undefined;
  const year = Number(value.slice(0, 4));
  return Number.isFinite(year) ? year : undefined;
}

function scoreCandidate(
  query: string,
  candidate: string,
  expectedYear: number | undefined,
  actualYear: number | undefined,
  result: TmdbResult
): number {
  const q = normalize(query);
  const c = normalize(candidate);
  let score = q === c ? 0.72 : tokenOverlap(q, c) * 0.72;
  if (expectedYear && actualYear) {
    score += expectedYear === actualYear ? 0.2 : Math.abs(expectedYear - actualYear) <= 1 ? 0.08 : -0.15;
  }
  if ((result.vote_count ?? 0) > 10) score += 0.04;
  if ((result.popularity ?? 0) > 10) score += 0.04;
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenOverlap(a: string, b: string): number {
  const aTokens = new Set(a.split(" ").filter(Boolean));
  const bTokens = new Set(b.split(" ").filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(aTokens.size, bTokens.size);
}
