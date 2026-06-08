import type { MediaType, TmdbTitleResult } from "@rss-media/shared/types";
import type { AppConfig } from "../../config.js";
import { prisma } from "../../db.js";
import { decryptSecret } from "../../secrets.js";
import { toTitleResult } from "./mapper.js";
import type { TmdbResult, TmdbSearchInput, TmdbSearchResponse } from "./types.js";

type TmdbCredentialSource = "workspace" | "environment";

export async function searchTmdb(
  config: AppConfig,
  input: TmdbSearchInput,
  tenantId: string
): Promise<TmdbTitleResult[]> {
  const tmdbSettings = await resolveTmdbRuntimeSettings(config, tenantId);
  const language = input.language ?? tmdbSettings.language;
  const kind = tmdbEndpoint(input.mediaType);
  if (!tmdbSettings.credential) {
    throw new Error("TMDB API key is not configured");
  }

  const params = new URLSearchParams({
    query: input.title,
    include_adult: "false",
    language,
    page: "1"
  });
  if (input.region) params.set("region", input.region);
  if (input.year) {
    params.set(kind === "tv" ? "first_air_date_year" : "year", String(input.year));
  }
  applyTmdbApiKeyParam(params, tmdbSettings.credential.value);
  const response = await fetch(`https://api.themoviedb.org/3/search/${kind}?${params}`, {
    headers: tmdbHeaders(tmdbSettings.credential.value)
  });
  if (!response.ok) {
    throw new Error(`TMDB search failed with ${response.status}`);
  }
  const body = (await response.json()) as TmdbSearchResponse;
  return mapSearchResponse(body, kind, { ...input, language });
}

export async function getTmdbMediaById(
  config: AppConfig,
  tenantId: string,
  input: { mediaType: MediaType; tmdbId: string; language?: string; region?: string }
): Promise<TmdbTitleResult> {
  const tmdbSettings = await resolveTmdbRuntimeSettings(config, tenantId);
  const language = input.language ?? tmdbSettings.language;
  const kind = tmdbEndpoint(input.mediaType);
  if (!tmdbSettings.credential) {
    throw new Error("TMDB API key is not configured");
  }

  const params = new URLSearchParams({ language });
  if (input.region) params.set("region", input.region);
  applyTmdbApiKeyParam(params, tmdbSettings.credential.value);
  const response = await fetch(`https://api.themoviedb.org/3/${kind}/${input.tmdbId}?${params}`, {
    headers: tmdbHeaders(tmdbSettings.credential.value)
  });
  if (!response.ok) {
    throw new Error(`TMDB detail lookup failed with ${response.status}`);
  }
  const body = (await response.json()) as TmdbResult;
  return toTitleResult(body, kind, {
    title: body.title ?? body.name ?? String(input.tmdbId),
    mediaType: input.mediaType,
    language,
    region: input.region
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

export async function getTmdbCredentialStatus(config: AppConfig, tenantId: string) {
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: {
      encryptedTmdbApiKey: true,
      tmdbConfiguredAt: true,
      tmdbLastValidatedAt: true,
      tmdbLastError: true,
      tmdbLanguage: true,
      webLanguage: true
    }
  });

  if (settings?.encryptedTmdbApiKey) {
    return {
      configured: true,
      source: "workspace" as TmdbCredentialSource,
      configuredAt: settings.tmdbConfiguredAt,
      lastValidatedAt: settings.tmdbLastValidatedAt,
      lastError: settings.tmdbLastError,
      tmdbLanguage: settings.tmdbLanguage,
      webLanguage: settings.webLanguage
    };
  }

  return {
    configured: Boolean(config.tmdbApiKey),
    source: config.tmdbApiKey ? ("environment" as TmdbCredentialSource) : null,
    configuredAt: null,
    lastValidatedAt: null,
    lastError: null,
    tmdbLanguage: settings?.tmdbLanguage ?? "en-US",
    webLanguage: settings?.webLanguage ?? "en-US"
  };
}

export async function tenantHasTmdbCredential(config: AppConfig, tenantId: string) {
  return Boolean(await resolveTmdbCredential(config, tenantId));
}

async function resolveTmdbCredential(
  config: AppConfig,
  tenantId: string
): Promise<{ value: string; source: TmdbCredentialSource } | null> {
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: { encryptedTmdbApiKey: true }
  });
  if (settings?.encryptedTmdbApiKey) {
    return {
      value: normalizeTmdbCredential(decryptSecret(settings.encryptedTmdbApiKey, config.appSecret))!,
      source: "workspace"
    };
  }

  const fallback = normalizeTmdbCredential(config.tmdbApiKey);
  return fallback ? { value: fallback, source: "environment" } : null;
}

async function resolveTmdbRuntimeSettings(config: AppConfig, tenantId: string) {
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: { tmdbLanguage: true }
  });
  return {
    credential: await resolveTmdbCredential(config, tenantId),
    language: settings?.tmdbLanguage ?? "en-US"
  };
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
