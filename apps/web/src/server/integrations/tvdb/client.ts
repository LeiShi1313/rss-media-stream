import { createHash } from "node:crypto";
import type { ProviderTitleResult } from "@rss-media/shared/types";
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
};

export async function searchTvdbSeries(
  input: { title: string; mediaType: "TV_SERIES"; year?: number; language?: string; region?: string },
  options: TvdbClientOptions
): Promise<ProviderTitleResult[]> {
  const token = await resolveTvdbToken(options);
  const language = input.language ?? options.language ?? "en-US";
  const params = new URLSearchParams({
    query: input.title,
    type: "series",
    limit: "8"
  });
  if (language) params.set("language", language);
  if (input.year) params.set("year", String(input.year));

  const response = await fetch(`${TVDB_BASE_URL}/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    throw new Error(`TVDB search failed with ${response.status}`);
  }

  const body = (await response.json()) as TvdbSearchResponse;
  return mapSearchResponse(body, { ...input, language });
}

export async function searchTvdbMovie(
  input: { title: string; mediaType: "MOVIE"; year?: number; language?: string; region?: string },
  options: TvdbClientOptions
): Promise<ProviderTitleResult[]> {
  const token = await resolveTvdbToken(options);
  const language = input.language ?? options.language ?? "en-US";
  const params = new URLSearchParams({
    query: input.title,
    type: "movie",
    limit: "8"
  });
  if (input.year) params.set("year", String(input.year));

  const response = await fetch(`${TVDB_BASE_URL}/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    throw new Error(`TVDB movie search failed with ${response.status}`);
  }

  const body = (await response.json()) as TvdbSearchResponse;
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
  const response = await fetch(`${TVDB_BASE_URL}/series/${input.providerId}${suffix}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(language ? { "Accept-Language": language } : {})
    }
  });
  if (!response.ok) {
    throw new Error(`TVDB series lookup failed with ${response.status}`);
  }

  const body = (await response.json()) as TvdbSeriesResponse;
  const translation = await fetchTvdbSeriesTranslation(token, input.providerId, tvdbLanguageCode(language));
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
  const response = await fetch(`${TVDB_BASE_URL}/movies/${input.providerId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    throw new Error(`TVDB movie lookup failed with ${response.status}`);
  }

  const body = (await response.json()) as TvdbMovieResponse;
  const translation = await fetchTvdbMovieTranslation(token, input.providerId, tvdbLanguageCode(language));
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
  return loginTvdb(options.apiKey.trim(), options.pin?.trim() || undefined);
}

async function loginTvdb(apiKey: string, pin?: string) {
  const cacheKey = credentialHash(apiKey, pin);
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const response = await fetch(`${TVDB_BASE_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apikey: apiKey,
      ...(pin ? { pin } : {})
    })
  });
  if (!response.ok) {
    throw new Error(`TVDB authentication failed with ${response.status}`);
  }
  const body = (await response.json()) as TvdbLoginResponse;
  const token = body.data?.token;
  if (!token) throw new Error("TVDB authentication did not return a token");

  tokenCache.set(cacheKey, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

function mapSearchResponse(
  body: TvdbSearchResponse,
  input: { title: string; language?: string; region?: string }
) {
  return (body.data ?? [])
    .map((result) => tvdbSearchResultToTitleResult(result, input))
    .filter((media): media is ProviderTitleResult => Boolean(media))
    .slice(0, 8);
}

async function fetchTvdbMovieTranslation(
  token: string,
  providerId: string,
  language: string
): Promise<TvdbTranslationRecord | undefined> {
  const response = await fetch(`${TVDB_BASE_URL}/movies/${providerId}/translations/${language}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) return undefined;
  const body = (await response.json()) as TvdbTranslationResponse;
  const translation = body.data;
  if (!translation?.name && !translation?.overview) return undefined;
  return translation;
}

async function fetchTvdbSeriesTranslation(
  token: string,
  providerId: string,
  language: string
): Promise<TvdbTranslationRecord | undefined> {
  const response = await fetch(`${TVDB_BASE_URL}/series/${providerId}/translations/${language}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) return undefined;
  const body = (await response.json()) as TvdbTranslationResponse;
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
