import { createHash } from "node:crypto";
import type { ProviderTitleResult } from "@rss-media/shared/types";
import { fetchJson, HttpStatusError } from "../http.js";
import { PROVIDER_SEARCH_RESULT_LIMIT } from "../providers/searchExecution.js";
import { tvdbMovieToTitleResult, tvdbSearchResultToTitleResult, tvdbSeriesToTitleResult } from "./mapper.js";
import type {
  TvdbLoginResponse,
  TvdbMovieResponse,
  TvdbSearchResponse,
  TvdbSeriesResponse,
  TvdbTranslationRecord,
  TvdbTranslationResponse
} from "./types.js";

const TVDB_BASE_URL = "https://api4.thetvdb.com/v4";
const TOKEN_TTL_MS = 25 * 24 * 60 * 60 * 1000;

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

type TvdbClientOptions = {
  apiKey?: string;
  pin?: string;
  language?: string;
  signal?: AbortSignal;
};

type TvdbSearchInput = {
  title: string;
  year?: number;
  season?: number;
  episode?: number;
  language?: string;
  region?: string;
};

export function searchTvdbSeries(
  input: TvdbSearchInput & { mediaType: "TV_SERIES" },
  options: TvdbClientOptions
): Promise<ProviderTitleResult[]> {
  return searchTvdb("series", input, options);
}

export function searchTvdbMovie(
  input: TvdbSearchInput & { mediaType: "MOVIE" },
  options: TvdbClientOptions
): Promise<ProviderTitleResult[]> {
  return searchTvdb("movie", input, options);
}

async function searchTvdb(
  type: "series" | "movie",
  input: TvdbSearchInput,
  options: TvdbClientOptions
): Promise<ProviderTitleResult[]> {
  const token = await resolveTvdbToken(options);
  const language = input.language ?? options.language ?? "en-US";
  const params = new URLSearchParams({
    query: input.title,
    type,
    limit: String(PROVIDER_SEARCH_RESULT_LIMIT)
  });
  // Intentional divergence preserved from the original implementations:
  // series search filters by language, movie search never has.
  if (type === "series" && language) params.set("language", language);
  if (input.year) params.set("year", String(input.year));

  const body = await fetchJson<TvdbSearchResponse>(`${TVDB_BASE_URL}/search?${params}`, {
    label: type === "movie" ? "TVDB movie search" : "TVDB search",
    headers: { Authorization: `Bearer ${token}` },
    signal: options.signal
  });
  return mapSearchResponse(body, { ...input, language });
}

export async function getTvdbSeriesById(
  input: { providerId: string; providerEntityType: string; mediaType: "TV_SERIES"; language?: string; region?: string },
  options: TvdbClientOptions
): Promise<ProviderTitleResult> {
  if (input.mediaType !== "TV_SERIES" || input.providerEntityType !== "tvdb_series") {
    throw new Error("TVDB detail lookup requires tvdb_series");
  }

  const token = await resolveTvdbToken(options);
  const language = input.language ?? options.language ?? "en-US";
  const params = new URLSearchParams();
  if (language) params.set("language", language);
  const suffix = params.size > 0 ? `?${params}` : "";
  const body = await fetchJson<TvdbSeriesResponse>(`${TVDB_BASE_URL}/series/${input.providerId}${suffix}`, {
    label: "TVDB series lookup",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(language ? { "Accept-Language": language } : {})
    },
    signal: options.signal
  });
  const translation = await fetchTvdbTranslation("series", token, input.providerId, tvdbLanguageCode(language), options.signal);
  return tvdbSeriesToTitleResult(body.data ?? {}, {
    ...input,
    language,
    translation
  });
}

export async function getTvdbMovieById(
  input: { providerId: string; providerEntityType: string; mediaType: "MOVIE"; language?: string; region?: string },
  options: TvdbClientOptions
): Promise<ProviderTitleResult> {
  if (input.mediaType !== "MOVIE" || input.providerEntityType !== "tvdb_movie") {
    throw new Error("TVDB detail lookup requires tvdb_movie");
  }

  const token = await resolveTvdbToken(options);
  const language = input.language ?? options.language ?? "en-US";
  const body = await fetchJson<TvdbMovieResponse>(`${TVDB_BASE_URL}/movies/${input.providerId}`, {
    label: "TVDB movie lookup",
    headers: { Authorization: `Bearer ${token}` },
    signal: options.signal
  });
  const translation = await fetchTvdbTranslation("movies", token, input.providerId, tvdbLanguageCode(language), options.signal);
  return tvdbMovieToTitleResult(body.data ?? {}, {
    ...input,
    language,
    translation
  });
}

export async function validateTvdbCredential(apiKey: string, pin?: string): Promise<void> {
  await loginTvdb(apiKey, pin);
}

async function resolveTvdbToken(options: TvdbClientOptions) {
  if (!options.apiKey?.trim()) {
    throw new Error("TVDB API key is not configured");
  }
  return loginTvdb(options.apiKey.trim(), options.pin?.trim() || undefined, options.signal);
}

async function loginTvdb(apiKey: string, pin?: string, signal?: AbortSignal) {
  const cacheKey = credentialHash(apiKey, pin);
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const body = await fetchJson<TvdbLoginResponse>(`${TVDB_BASE_URL}/login`, {
    label: "TVDB authentication",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apikey: apiKey,
      ...(pin ? { pin } : {})
    }),
    signal
  });
  const token = body.data?.token;
  if (!token) throw new Error("TVDB authentication did not return a token");

  tokenCache.set(cacheKey, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

function mapSearchResponse(
  body: TvdbSearchResponse,
  input: { title: string; year?: number; season?: number; episode?: number; language?: string; region?: string }
) {
  return (body.data ?? [])
    .map((result) => tvdbSearchResultToTitleResult(result, input))
    .filter((media): media is ProviderTitleResult => Boolean(media))
    .slice(0, PROVIDER_SEARCH_RESULT_LIMIT);
}

async function fetchTvdbTranslation(
  segment: "movies" | "series",
  token: string,
  providerId: string,
  language: string,
  signal?: AbortSignal
): Promise<TvdbTranslationRecord | undefined> {
  let body: TvdbTranslationResponse;
  try {
    body = await fetchJson<TvdbTranslationResponse>(
      `${TVDB_BASE_URL}/${segment}/${providerId}/translations/${language}`,
      {
        label: "TVDB translation lookup",
        headers: { Authorization: `Bearer ${token}` },
        signal
      }
    );
  } catch (error) {
    if (error instanceof HttpStatusError) return undefined;
    throw error;
  }
  const translation = body.data;
  if (!translation?.name && !translation?.overview) return undefined;
  return translation;
}

function tvdbLanguageCode(language?: string) {
  return {
    "en-US": "eng",
    "zh-CN": "zho",
    "zh-TW": "zho",
    "ja-JP": "jpn",
    "ko-KR": "kor",
    "fr-FR": "fra",
    "de-DE": "deu",
    "es-ES": "spa"
  }[language ?? ""] ?? "eng";
}

function credentialHash(apiKey: string, pin?: string) {
  return createHash("sha256")
    .update(JSON.stringify({ apiKey, pin: pin ?? null }))
    .digest("hex");
}
