import type { TmdbMedia } from "@rss-media/shared/types";
import type { AppConfig } from "../../config.js";
import { toMedia } from "./mapper.js";
import type { TmdbResult, TmdbSearchInput } from "./types.js";

export async function searchTmdb(
  config: AppConfig,
  input: TmdbSearchInput
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
