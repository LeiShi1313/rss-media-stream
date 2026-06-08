import type { MediaType, TmdbTitleResult } from "@rss-media/shared/types";
import { toTitleResult } from "./mapper.js";
import type { TmdbResult, TmdbSearchInput, TmdbSearchResponse } from "./types.js";

type TmdbClientOptions = {
  credential?: string;
  language?: string;
  region?: string;
};

export async function searchTmdb(
  input: TmdbSearchInput,
  options: TmdbClientOptions
): Promise<TmdbTitleResult[]> {
  const credential = normalizeTmdbCredential(options.credential);
  const language = input.language ?? options.language ?? "en-US";
  const region = input.region ?? options.region;
  const kind = tmdbEndpoint(input.mediaType);
  if (!credential) {
    throw new Error("TMDB API key is not configured");
  }

  const params = new URLSearchParams({
    query: input.title,
    include_adult: "false",
    language,
    page: "1"
  });
  if (region) params.set("region", region);
  if (input.year) {
    params.set(kind === "tv" ? "first_air_date_year" : "year", String(input.year));
  }
  applyTmdbApiKeyParam(params, credential);
  const response = await fetch(`https://api.themoviedb.org/3/search/${kind}?${params}`, {
    headers: tmdbHeaders(credential)
  });
  if (!response.ok) {
    throw new Error(`TMDB search failed with ${response.status}`);
  }
  const body = (await response.json()) as TmdbSearchResponse;
  return mapSearchResponse(body, kind, { ...input, language, region });
}

export async function getTmdbMediaById(
  input: { mediaType: MediaType; tmdbId: string; language?: string; region?: string },
  options: TmdbClientOptions
): Promise<TmdbTitleResult> {
  const credential = normalizeTmdbCredential(options.credential);
  const language = input.language ?? options.language ?? "en-US";
  const region = input.region ?? options.region;
  const kind = tmdbEndpoint(input.mediaType);
  if (!credential) {
    throw new Error("TMDB API key is not configured");
  }

  const params = new URLSearchParams({ language });
  if (region) params.set("region", region);
  applyTmdbApiKeyParam(params, credential);
  const response = await fetch(`https://api.themoviedb.org/3/${kind}/${input.tmdbId}?${params}`, {
    headers: tmdbHeaders(credential)
  });
  if (!response.ok) {
    throw new Error(`TMDB detail lookup failed with ${response.status}`);
  }
  const body = (await response.json()) as TmdbResult;
  return toTitleResult(body, kind, {
    title: body.title ?? body.name ?? String(input.tmdbId),
    mediaType: input.mediaType,
    language,
    region
  });
}

export async function validateTmdbCredential(value: string): Promise<void> {
  const credential = normalizeTmdbCredential(value);
  if (!credential) {
    throw new Error("TMDB API key is required");
  }

  const params = new URLSearchParams();
  applyTmdbApiKeyParam(params, credential);
  const query = params.size > 0 ? `?${params}` : "";
  const response = await fetch(`https://api.themoviedb.org/3/authentication${query}`, {
    headers: tmdbHeaders(credential)
  });
  if (!response.ok) {
    throw new Error(`TMDB authentication failed with ${response.status}`);
  }
}

function mapSearchResponse(
  body: TmdbSearchResponse,
  kind: "movie" | "tv",
  input: TmdbSearchInput
) {
  return (body.results ?? []).slice(0, 8).map((result) => toTitleResult(result, kind, input));
}

function tmdbHeaders(credential: string) {
  const normalized = normalizeTmdbCredential(credential);
  if (!normalized) return undefined;
  if (looksLikeBearerToken(normalized)) {
    return { Authorization: `Bearer ${normalized}` };
  }
  return undefined;
}

function applyTmdbApiKeyParam(params: URLSearchParams, credential: string) {
  if (!looksLikeBearerToken(credential)) {
    params.set("api_key", credential);
  }
}

function normalizeTmdbCredential(value?: string) {
  const normalized = value?.trim().replace(/^Bearer\s+/i, "");
  return normalized || undefined;
}

function looksLikeBearerToken(value: string) {
  return value.startsWith("eyJ") || value.split(".").length === 3;
}

function tmdbEndpoint(mediaType: MediaType) {
  return mediaType === "TV_SERIES" ? "tv" : "movie";
}
