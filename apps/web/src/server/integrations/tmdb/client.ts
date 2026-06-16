import type { MediaType, TmdbTitleResult } from "@rss-media/shared/types";
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
    region
  });
  const englishBody = language.toLowerCase() === "en-us"
    ? undefined
    : await fetchTmdbSearch({
        kind,
        input,
        credential,
        language: "en-US",
        region
      }).catch(() => undefined);

  return mapSearchResponse(primaryBody, kind, {
    input: { ...input, language, region },
    englishBody,
    credential,
    language,
    region
  });
}

async function fetchTmdbSearch(input: {
  kind: "movie" | "tv";
  input: TmdbSearchInput;
  credential: string;
  language: string;
  region?: string;
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
  const response = await fetch(`https://api.themoviedb.org/3/search/${input.kind}?${params}`, {
    headers: tmdbHeaders(input.credential)
  });
  if (!response.ok) {
    throw new Error(`TMDB search failed with ${response.status}`);
  }
  return (await response.json()) as TmdbSearchResponse;
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
  context: {
    input: TmdbSearchInput;
    englishBody?: TmdbSearchResponse;
    credential: string;
    language: string;
    region?: string;
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

  return Promise.all(merged.slice(0, 8).map(async ({ result, language, extraCandidateTitles }) => {
    const seasonEpisodeEvidence = await maybeFetchTvSeasonEpisodeEvidence({
      kind,
      input,
      result,
      extraCandidateTitles,
      credential: context.credential,
      language,
      region: context.region
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
      region: input.region
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
}): Promise<TmdbResult> {
  const params = new URLSearchParams({ language: input.language });
  if (input.region) params.set("region", input.region);
  applyTmdbApiKeyParam(params, input.credential);
  const response = await fetch(`https://api.themoviedb.org/3/${input.kind}/${input.tmdbId}?${params}`, {
    headers: tmdbHeaders(input.credential)
  });
  if (!response.ok) {
    throw new Error(`TMDB detail lookup failed with ${response.status}`);
  }
  return (await response.json()) as TmdbResult;
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
