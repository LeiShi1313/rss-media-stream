import { normalizeTitleKey } from "@rss-media/shared/titleNormalization";
import type { ProviderTitleResult } from "@rss-media/shared/types";
import { scoreProviderCandidate } from "../providers/scoring.js";
import type { TvdbMovieRecord, TvdbSearchResult, TvdbSeriesRecord, TvdbTranslationRecord } from "./types.js";

export function tvdbSearchResultToTitleResult(
  result: TvdbSearchResult,
  input: { title: string; year?: number; season?: number; episode?: number; language?: string; region?: string }
): ProviderTitleResult | null {
  const providerId = result.tvdb_id ?? result.id;
  const title = result.name;
  if (!providerId || !title) return null;
  const searchScore = normalizeTvdbScore(result.score);
  const mediaType = result.type?.toLowerCase() === "movie" ? "MOVIE" : "TV_SERIES";
  const releaseYear = yearFromValue(result.year);

  return {
    provider: "tvdb",
    providerEntityType: mediaType === "MOVIE" ? "tvdb_movie" : "tvdb_series",
    providerId: String(providerId),
    mediaType,
    title,
    normalizedTitle: normalizeTitleKey(title),
    releaseYear,
    language: input.language,
    region: input.region,
    payload: {
      source: "tvdb",
      query: input.title,
      posterPath: result.image_url,
      overview: result.overview ?? result.overviews?.eng,
      slug: result.slug,
      searchScore,
      primaryLanguage: result.primary_language,
      aliases: result.aliases,
      raw: result
    },
    matchConfidence: scoreProviderCandidate({
      query: input.title,
      candidateTitles: [title, ...(result.aliases ?? [])],
      mediaType,
      expectedYear: input.year,
      actualYear: releaseYear,
      season: input.season,
      episode: input.episode
    }),
    externalUrl: tvdbExternalUrl(mediaType, result.slug)
  };
}

export function tvdbSeriesToTitleResult(
  series: TvdbSeriesRecord,
  input: { language?: string; region?: string; translation?: TvdbTranslationRecord } = {}
): ProviderTitleResult {
  const providerId = String(series.id ?? "");
  const title = input.translation?.name ?? series.name ?? `TVDB series ${providerId}`;
  const overview = input.translation?.overview ?? series.overview;

  return {
    provider: "tvdb",
    providerEntityType: "tvdb_series",
    providerId,
    mediaType: "TV_SERIES",
    title,
    normalizedTitle: normalizeTitleKey(title),
    releaseYear: yearFromValue(series.year ?? series.firstAired),
    language: input.language,
    region: input.region,
    payload: {
      source: "tvdb",
      posterPath: series.image,
      overview,
      slug: series.slug,
      firstAired: series.firstAired,
      lastAired: series.lastAired,
      nextAired: series.nextAired,
      searchScore: series.score,
      status: series.status?.name,
      originalLanguage: series.originalLanguage,
      translations: series.translations,
      raw: series,
      translation: input.translation
    },
    externalUrl: tvdbExternalUrl("TV_SERIES", series.slug)
  };
}

export function tvdbMovieToTitleResult(
  movie: TvdbMovieRecord,
  input: { language?: string; region?: string; translation?: TvdbTranslationRecord } = {}
): ProviderTitleResult {
  const providerId = String(movie.id ?? "");
  const title = input.translation?.name ?? movie.name ?? `TVDB movie ${providerId}`;
  const overview = input.translation?.overview ?? movie.overview;

  return {
    provider: "tvdb",
    providerEntityType: "tvdb_movie",
    providerId,
    mediaType: "MOVIE",
    title,
    normalizedTitle: normalizeTitleKey(title),
    releaseYear: yearFromValue(movie.year ?? movie.first_release?.date),
    language: input.language,
    region: input.region,
    payload: {
      source: "tvdb",
      posterPath: movie.image,
      overview,
      slug: movie.slug,
      searchScore: movie.score,
      status: movie.status?.name,
      raw: movie,
      translation: input.translation
    },
    externalUrl: tvdbExternalUrl("MOVIE", movie.slug)
  };
}

function yearFromValue(value?: string) {
  const match = value?.match(/\d{4}/);
  return match ? Number(match[0]) : undefined;
}

function normalizeTvdbScore(score?: number) {
  if (!Number.isFinite(score)) return 0.7;
  if (score! > 1) return Math.max(0, Math.min(1, score! / 100));
  return Math.max(0, Math.min(1, score!));
}

function tvdbExternalUrl(mediaType: "MOVIE" | "TV_SERIES", slug?: string) {
  if (!slug) return undefined;
  return `https://thetvdb.com/${mediaType === "MOVIE" ? "movies" : "series"}/${slug}`;
}
