import type { ProviderTitleResult } from "@rss-media/shared/types";
import type { TvdbSearchResult, TvdbSeriesRecord } from "./types.js";

export function tvdbSearchResultToTitleResult(
  result: TvdbSearchResult,
  input: { title: string; language?: string; region?: string }
): ProviderTitleResult | null {
  const providerId = result.tvdb_id ?? result.id;
  const title = result.name;
  if (!providerId || !title) return null;
  const searchScore = normalizeTvdbScore(result.score);

  return {
    provider: "tvdb",
    providerEntityType: "tvdb_series",
    providerId: String(providerId),
    mediaType: "TV_SERIES",
    title,
    normalizedTitle: normalizeTitle(title),
    releaseYear: yearFromValue(result.year),
    language: input.language,
    region: input.region,
    payload: {
      source: "tvdb",
      query: input.title,
      posterPath: result.image_url,
      overview: result.overview ?? result.overviews?.eng,
      searchScore,
      primaryLanguage: result.primary_language,
      aliases: result.aliases,
      raw: result
    },
    matchConfidence: searchScore
  };
}

export function tvdbSeriesToTitleResult(
  series: TvdbSeriesRecord,
  input: { language?: string; region?: string } = {}
): ProviderTitleResult {
  const providerId = String(series.id ?? "");
  const title = series.name ?? `TVDB series ${providerId}`;

  return {
    provider: "tvdb",
    providerEntityType: "tvdb_series",
    providerId,
    mediaType: "TV_SERIES",
    title,
    normalizedTitle: normalizeTitle(title),
    releaseYear: yearFromValue(series.year ?? series.firstAired),
    language: input.language,
    region: input.region,
    payload: {
      source: "tvdb",
      posterPath: series.image,
      overview: series.overview,
      slug: series.slug,
      firstAired: series.firstAired,
      lastAired: series.lastAired,
      nextAired: series.nextAired,
      searchScore: series.score,
      status: series.status?.name,
      originalLanguage: series.originalLanguage,
      translations: series.translations,
      raw: series
    }
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

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
