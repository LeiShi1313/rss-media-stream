import type { MediaType, TmdbTitleResult } from "@rss-media/shared/types";
import { fetchJson } from "../http.js";
import { PROVIDER_SEARCH_RESULT_LIMIT } from "../providers/searchExecution.js";
import { tmdbTitleSupportsSeasonEvidence, toTitleResult } from "./mapper.js";
import type {
  TmdbResult,
  TmdbSearchInput,
  TmdbSearchResponse,
  TmdbTvSeasonEpisodeEvidence
} from "./types.js";

type TmdbClientOptions = {
  credential?: string;
  language?: string;
  region?: string;
  signal?: AbortSignal;
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

  const primaryBody = await fetchTmdbSearch({
    kind,
    input,
    credential,
    language,
    region,
    signal: options.signal
  });
  const englishBody = language.toLowerCase() === "en-us"
    ? undefined
    : await fetchTmdbSearch({
        kind,
        input,
        credential,
        language: "en-US",
        region,
        signal: options.signal
      }).catch(() => undefined);

  return mapSearchResponse(primaryBody, kind, {
    input: { ...input, language, region },
    englishBody,
    credential,
    language,
    region,
    signal: options.signal
  });
}

async function fetchTmdbSearch(input: {
  kind: "movie" | "tv";
  input: TmdbSearchInput;
  credential: string;
  language: string;
  region?: string;
  signal?: AbortSignal;
}): Promise<TmdbSearchResponse> {
  const params = new URLSearchParams({
    query: input.input.title,
    include_adult: "false",
    language: input.language,
    page: "1"
  });
  if (input.region) params.set("region", input.region);
  if (input.input.year && shouldApplyTmdbYearFilter(input.kind, input.input)) {
    params.set(input.kind === "tv" ? "first_air_date_year" : "year", String(input.input.year));
  }
  applyTmdbApiKeyParam(params, input.credential);
  return fetchJson<TmdbSearchResponse>(`https://api.themoviedb.org/3/search/${input.kind}?${params}`, {
    label: "TMDB search",
    headers: tmdbHeaders(input.credential),
    signal: input.signal
  });
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

  const body = await fetchTmdbDetail({
    kind,
    tmdbId: input.tmdbId,
    credential,
    language,
    region,
    signal: options.signal
  });
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
  await fetchJson(`https://api.themoviedb.org/3/authentication${query}`, {
    label: "TMDB authentication",
    headers: tmdbHeaders(credential)
  });
}

function mapSearchResponse(
  body: TmdbSearchResponse,
  kind: "movie" | "tv",
  context: {
    input: TmdbSearchInput;
    englishBody?: TmdbSearchResponse;
    credential: string;
    language: string;
    region?: string;
    signal?: AbortSignal;
  }
) {
  const { input, englishBody } = context;
  const englishById = new Map((englishBody?.results ?? []).map((result) => [result.id, result]));
  const seen = new Set<number>();
  const merged: Array<{ result: TmdbResult; language: string; extraCandidateTitles: string[] }> = [];

  for (const result of body.results ?? []) {
    seen.add(result.id);
    merged.push({
      result,
      language: input.language ?? "en-US",
      extraCandidateTitles: tmdbCandidateTitles(englishById.get(result.id), kind)
    });
  }

  for (const result of englishBody?.results ?? []) {
    if (seen.has(result.id)) continue;
    merged.push({
      result,
      language: "en-US",
      extraCandidateTitles: []
    });
  }

  return Promise.all(merged.slice(0, PROVIDER_SEARCH_RESULT_LIMIT).map(async ({ result, language, extraCandidateTitles }) => {
    const seasonEpisodeEvidence = await maybeFetchTvSeasonEpisodeEvidence({
      kind,
      input,
      result,
      extraCandidateTitles,
      credential: context.credential,
      language,
      region: context.region,
      signal: context.signal
    });
    return toTitleResult(result, kind, { ...input, language }, extraCandidateTitles, seasonEpisodeEvidence);
  }));
}

function tmdbCandidateTitles(result: TmdbResult | undefined, kind: "movie" | "tv") {
  if (!result) return [];
  return [
    kind === "movie" ? result.title : result.name,
    kind === "movie" ? result.original_title : result.original_name
  ].filter((title): title is string => Boolean(title));
}

function shouldApplyTmdbYearFilter(kind: "movie" | "tv", input: TmdbSearchInput) {
  if (kind === "movie") return true;
  return !input.season && !input.episode;
}

async function maybeFetchTvSeasonEpisodeEvidence(input: {
  kind: "movie" | "tv";
  input: TmdbSearchInput;
  result: TmdbResult;
  extraCandidateTitles: string[];
  credential: string;
  language: string;
  region?: string;
  signal?: AbortSignal;
}): Promise<TmdbTvSeasonEpisodeEvidence | undefined> {
  if (input.kind !== "tv" || !input.input.season) return undefined;
  if (!tmdbTitleSupportsSeasonEvidence({
    query: input.input.title,
    candidateTitles: [...tmdbCandidateTitles(input.result, input.kind), ...input.extraCandidateTitles],
    originCountries: input.result.origin_country
  })) {
    return undefined;
  }

  try {
    const detail = await fetchTmdbDetail({
      kind: input.kind,
      tmdbId: String(input.result.id),
      credential: input.credential,
      language: input.language,
      region: input.region,
      signal: input.signal
    });
    return tvSeasonEpisodeEvidence(detail, {
      season: input.input.season,
      episode: input.input.episode
    });
  } catch {
    return undefined;
  }
}

async function fetchTmdbDetail(input: {
  kind: "movie" | "tv";
  tmdbId: string;
  credential: string;
  language: string;
  region?: string;
  signal?: AbortSignal;
}): Promise<TmdbResult> {
  const params = new URLSearchParams({ language: input.language });
  if (input.region) params.set("region", input.region);
  applyTmdbApiKeyParam(params, input.credential);
  return fetchJson<TmdbResult>(`https://api.themoviedb.org/3/${input.kind}/${input.tmdbId}?${params}`, {
    label: "TMDB detail lookup",
    headers: tmdbHeaders(input.credential),
    signal: input.signal
  });
}

function tvSeasonEpisodeEvidence(
  result: TmdbResult,
  input: { season: number; episode?: number }
): TmdbTvSeasonEpisodeEvidence {
  const season = result.seasons?.find((candidate) => candidate.season_number === input.season);
  if (!season) {
    return {
      season: input.season,
      episode: input.episode,
      confirmed: false,
      reason: "missing_season"
    };
  }
  if (input.episode == null) {
    return {
      season: input.season,
      episodeCount: season.episode_count,
      confirmed: true,
      reason: "season_confirmed"
    };
  }
  if (season.episode_count == null) {
    return {
      season: input.season,
      episode: input.episode,
      confirmed: false,
      reason: "missing_episode_count"
    };
  }
  return {
    season: input.season,
    episode: input.episode,
    episodeCount: season.episode_count,
    confirmed: season.episode_count >= input.episode,
    reason: season.episode_count >= input.episode
      ? "season_episode_confirmed"
      : "episode_out_of_range"
  };
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
