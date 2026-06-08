import { createHash } from "node:crypto";
import type { ProviderTitleResult } from "@rss-media/shared/types";
import type { AppConfig } from "../../config.js";
import { tvdbSearchResultToTitleResult, tvdbSeriesToTitleResult } from "./mapper.js";
import type { TvdbLoginResponse, TvdbSearchResponse, TvdbSeriesResponse } from "./types.js";

const TVDB_BASE_URL = "https://api4.thetvdb.com/v4";
const TOKEN_TTL_MS = 25 * 24 * 60 * 60 * 1000;

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export async function searchTvdbSeries(
  config: AppConfig,
  _tenantId: string,
  input: { title: string; mediaType: "TV_SERIES"; year?: number; language?: string; region?: string }
): Promise<ProviderTitleResult[]> {
  const token = await resolveTvdbToken(config);
  const params = new URLSearchParams({
    query: input.title,
    type: "series",
    limit: "8"
  });
  if (input.language) params.set("language", input.language);
  if (input.year) params.set("year", String(input.year));

  const response = await fetch(`${TVDB_BASE_URL}/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    throw new Error(`TVDB search failed with ${response.status}`);
  }

  const body = (await response.json()) as TvdbSearchResponse;
  return mapSearchResponse(body, input);
}

export async function getTvdbSeriesById(
  config: AppConfig,
  _tenantId: string,
  input: { providerId: string; providerEntityType: string; mediaType: "TV_SERIES"; language?: string; region?: string }
): Promise<ProviderTitleResult> {
  if (input.mediaType !== "TV_SERIES" || input.providerEntityType !== "tvdb_series") {
    throw new Error("TVDB detail lookup requires tvdb_series");
  }

  const token = await resolveTvdbToken(config);
  const response = await fetch(`${TVDB_BASE_URL}/series/${input.providerId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    throw new Error(`TVDB series lookup failed with ${response.status}`);
  }

  const body = (await response.json()) as TvdbSeriesResponse;
  return tvdbSeriesToTitleResult(body.data ?? {}, input);
}

export async function validateTvdbCredential(apiKey: string, pin?: string): Promise<void> {
  await loginTvdb(apiKey, pin);
}

async function resolveTvdbToken(config: AppConfig) {
  if (!config.tvdbApiKey) {
    throw new Error("TVDB API key is not configured");
  }
  return loginTvdb(config.tvdbApiKey, config.tvdbPin);
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

function credentialHash(apiKey: string, pin?: string) {
  return createHash("sha256")
    .update(JSON.stringify({ apiKey, pin: pin ?? null }))
    .digest("hex");
}
