import { normalizeTitleKey } from "@rss-media/shared/titleNormalization";
import type { MediaType, ProviderTitleResult } from "@rss-media/shared/types";
import { scoreProviderCandidate } from "../providers/scoring.js";
import {
  identityFromPtgenRecordId,
  ptgenEntityTypeToSite,
  ptgenEntityTypeToSource,
  ptgenIdentity,
  ptgenProviderEntityType
} from "./identity.js";
import type {
  PtgenIdentity,
  PtgenLegacyRecord,
  PtgenNormalizedRecord,
  PtgenProviderEntityType,
  PtgenSearchHit,
  PtgenSite,
  PtgenSource
} from "./types.js";

export {
  ptgenEntityTypeToSite,
  ptgenEntityTypeToSource,
  ptgenProviderEntityType as providerEntityType
};

export function ptgenSearchHitToTitleResult(
  record: PtgenSearchHit,
  input: {
    query: string;
    mediaType?: MediaType;
    year?: number;
    season?: number;
    episode?: number;
    language?: string;
    baseUrl: string;
    backend: string;
    index?: number;
  }
): ProviderTitleResult | undefined {
  const identity = identityFromPtgenRecordId(record.id, record.source_ids, record.sources);
  if (!identity) return undefined;

  const normalized = searchHitToNormalizedRecord(record, identity, {
    mediaType: input.mediaType,
    language: input.language,
    baseUrl: input.baseUrl,
    backend: input.backend,
    matchConfidence: scorePtgenCandidate(
      input.query,
      [...(record.titles ?? []), ...(record.aliases ?? [])],
      inferSearchMediaType(record, input.mediaType),
      input.year,
      input.season,
      input.episode,
      input.index ?? 0,
      yearFromValue(record.year ?? record.release_date)
    )
  });
  return ptgenNormalizedRecordToTitleResult(normalized, { language: input.language });
}

export function ptgenLookupRecordToTitleResult(
  record: PtgenSearchHit,
  identity: PtgenIdentity,
  input: {
    mediaType?: MediaType;
    language?: string;
    baseUrl: string;
    backend: string;
  }
): ProviderTitleResult {
  const normalized = searchHitToNormalizedRecord(record, identity, {
    mediaType: input.mediaType,
    language: input.language,
    baseUrl: input.baseUrl,
    backend: input.backend,
    matchConfidence: 1
  });
  return ptgenNormalizedRecordToTitleResult(normalized, { language: input.language });
}

export function ptgenLegacyRecordToTitleResult(
  record: PtgenLegacyRecord,
  input: {
    source: PtgenSource;
    sourceId: string;
    mediaType?: MediaType;
    language?: string;
    baseUrl?: string;
    backend: string;
  }
): ProviderTitleResult | undefined {
  const identity = ptgenIdentity(input.source, input.sourceId);
  if (!identity) return undefined;
  return ptgenNormalizedRecordToTitleResult(
    legacyRecordToNormalizedRecord(record, identity, input),
    { language: input.language }
  );
}

export function ptgenRecordToTitleResult(
  record: PtgenLegacyRecord,
  input: {
    site: PtgenSite;
    sid: string;
    mediaType?: MediaType;
    language?: string;
    baseUrl?: string;
  }
): ProviderTitleResult {
  const result = ptgenLegacyRecordToTitleResult(record, {
    source: input.site,
    sourceId: input.sid,
    mediaType: input.mediaType,
    language: input.language,
    baseUrl: input.baseUrl,
    backend: "static_json"
  });
  if (!result) throw new Error("Invalid PTGen source ID");
  return result;
}

export function ptgenNormalizedRecordToTitleResult(
  record: PtgenNormalizedRecord,
  input: { language?: string } = {}
): ProviderTitleResult {
  const title = record.title ?? record.sourceId;
  const ratingValue = numberFromValue(record.ratingScore);

  return {
    provider: "ptgen",
    providerEntityType: record.providerEntityType,
    providerId: record.providerId,
    mediaType: record.mediaType ?? "MOVIE",
    title,
    normalizedTitle: normalizeTitleKey(title),
    originalTitle: record.originalTitle,
    releaseYear: record.releaseYear,
    language: input.language,
    payload: {
      source: "ptgen",
      site: record.source,
      sourceId: record.sourceId,
      sid: record.sourceId,
      titles: record.titles,
      aliases: record.aliases,
      posterPath: record.poster,
      originalPoster: record.originalPoster,
      overview: record.overview,
      releaseDate: record.releaseDate,
      genres: record.genres,
      regions: record.regions,
      languages: record.languages,
      directors: record.directors,
      writers: record.writers,
      cast: record.cast,
      people: record.people,
      sourceIds: record.sourceIds,
      sourcePaths: record.sourcePaths,
      providerScores: record.providerScores,
      updatedAt: record.updatedAt,
      backend: record.backend,
      baseUrl: record.baseUrl,
      raw: record.raw
    },
    ratingValue,
    ratingScale: ratingValue === undefined ? undefined : 10,
    ratingVoteCount: integerFromValue(record.ratingVotes),
    ratingType: ratingValue === undefined ? undefined : "user_score",
    matchConfidence: record.matchConfidence ?? 1,
    externalUrl: externalUrl(record.source, record.sourceId)
  };
}

function searchHitToNormalizedRecord(
  record: PtgenSearchHit,
  identity: PtgenIdentity,
  input: {
    mediaType?: MediaType;
    language?: string;
    baseUrl: string;
    backend: string;
    matchConfidence?: number;
  }
): PtgenNormalizedRecord {
  const title = preferredSearchTitle(record, input.language) ?? identity.sourceId;
  const rating = searchHitRating(record, identity);
  return {
    source: identity.source,
    sourceId: identity.sourceId,
    providerEntityType: identity.providerEntityType,
    providerId: identity.providerId,
    mediaType: inferSearchMediaType(record, input.mediaType),
    title,
    originalTitle: alternateSearchTitle(record, title, input.language),
    titles: record.titles,
    aliases: record.aliases,
    releaseYear: yearFromValue(record.year ?? record.release_date),
    releaseDate: record.release_date ?? undefined,
    poster: resolvePtgenPosterUrl(record.poster_ptgen, input.baseUrl) ??
      resolvePtgenPosterUrl(stringFromFormatted(record._formatted, "poster_ptgen"), input.baseUrl) ??
      record.poster ?? undefined,
    originalPoster: record.poster ?? undefined,
    overview: record.description ?? undefined,
    genres: record.genres,
    regions: record.regions,
    languages: record.languages,
    directors: record.directors,
    writers: record.writers,
    cast: record.cast,
    people: record.people,
    sourceIds: record.source_ids,
    sourcePaths: record.source_paths,
    ratingScore: rating?.score,
    ratingVotes: rating?.votes,
    providerScores: record.provider_scores,
    updatedAt: record.updated_at ?? undefined,
    backend: input.backend,
    baseUrl: input.baseUrl,
    matchConfidence: input.matchConfidence,
    raw: record
  };
}

function legacyRecordToNormalizedRecord(
  record: PtgenLegacyRecord,
  identity: PtgenIdentity,
  input: {
    mediaType?: MediaType;
    language?: string;
    baseUrl?: string;
    backend: string;
  }
): PtgenNormalizedRecord {
  const title = preferredLegacyTitle(record, identity.source, input.language) ?? identity.sourceId;
  const rating = legacyRecordRating(record, identity.source);
  return {
    source: identity.source,
    sourceId: identity.sourceId,
    providerEntityType: identity.providerEntityType,
    providerId: identity.providerId,
    mediaType: inferLegacyMediaType(record, input.mediaType),
    title,
    originalTitle: alternateLegacyTitle(record, title, input.language),
    titles: legacyTitles(record),
    aliases: record.aka,
    releaseYear: yearFromValue(record.year ?? record.datePublished ?? firstValue(record.playdate)),
    releaseDate: stringValue(record.datePublished) ?? firstValue(record.release_date),
    poster: resolvePtgenPosterUrl(record.poster_ptgen, input.baseUrl) ?? record.poster,
    originalPoster: record.poster,
    overview: record.introduction ?? record.description,
    genres: record.genre,
    regions: record.region,
    languages: record.language,
    directors: personNames((record as { director?: unknown }).director) ?? personNames((record as { directors?: unknown }).directors),
    cast: personNames(record.cast),
    sourceIds: {
      douban: identity.source === "douban" ? identity.sourceId : doubanIdFromLink(record.douban_link),
      imdb: record.imdb_id ?? imdbIdFromLink(record.imdb_link) ?? (identity.source === "imdb" ? identity.sourceId : undefined)
    },
    ratingScore: rating?.score,
    ratingVotes: rating?.votes,
    providerScores: legacyProviderScores(record),
    updatedAt: record.update_at,
    backend: input.backend,
    baseUrl: input.baseUrl,
    matchConfidence: 1,
    raw: record
  };
}

function searchHitRating(record: PtgenSearchHit, identity: PtgenIdentity) {
  const providerScore = ratingFromProviderScores(record.provider_scores, identity.source);
  const isAmbiguousTransientRecord = identity.transient && (record.sources?.length ?? 0) > 1;
  const score = isAmbiguousTransientRecord
    ? providerScore?.score
    : numberFromValue(record.rating_score) ?? providerScore?.score;
  if (score === undefined) return undefined;
  return {
    score,
    votes: isAmbiguousTransientRecord
      ? providerScore?.votes
      : integerFromValue(record.rating_votes) ?? providerScore?.votes
  };
}

function legacyRecordRating(record: PtgenLegacyRecord, source: PtgenSource) {
  const score = source === "douban"
    ? numberFromValue(record.douban_rating_average)
    : numberFromValue(record.imdb_rating_average);
  if (score === undefined) return undefined;
  return {
    score,
    votes: source === "douban"
      ? integerFromValue(record.douban_votes)
      : integerFromValue(record.imdb_votes)
  };
}

function ratingFromProviderScores(
  scores: PtgenSearchHit["provider_scores"],
  source: PtgenSource
) {
  const score = scores?.[source];
  if (!score) return undefined;
  return {
    score: numberFromValue(score.rating_score ?? score.score ?? score.value),
    votes: integerFromValue(score.rating_votes ?? score.votes ?? score.voteCount)
  };
}

function legacyProviderScores(record: PtgenLegacyRecord) {
  return {
    douban: {
      rating_score: numberFromValue(record.douban_rating_average),
      rating_votes: integerFromValue(record.douban_votes)
    },
    imdb: {
      rating_score: numberFromValue(record.imdb_rating_average),
      rating_votes: integerFromValue(record.imdb_votes)
    }
  };
}

function preferredSearchTitle(record: PtgenSearchHit, language?: string) {
  return preferredTitle(record.titles ?? [], record.aliases ?? [], language);
}

function alternateSearchTitle(record: PtgenSearchHit, title: string, language?: string) {
  return alternateTitle([...(record.titles ?? []), ...(record.aliases ?? [])], title, language);
}

function preferredLegacyTitle(record: PtgenLegacyRecord, source: PtgenSource, language?: string) {
  if (source === "imdb") {
    return firstNonEmpty(record.name, record.foreign_title, firstValue(record.this_title), record.chinese_title);
  }
  if (language?.toLowerCase().startsWith("zh")) {
    return firstNonEmpty(record.chinese_title, firstValue(record.trans_title), record.foreign_title, record.name);
  }
  return firstNonEmpty(record.foreign_title, record.name, firstValue(record.this_title), record.chinese_title);
}

function alternateLegacyTitle(record: PtgenLegacyRecord, title: string, language?: string) {
  const candidates = language?.toLowerCase().startsWith("zh")
    ? [record.foreign_title, record.name, firstValue(record.this_title)]
    : [record.chinese_title, firstValue(record.trans_title)];
  return candidates.find((candidate) => candidate && candidate !== title);
}

function preferredTitle(titles: string[], aliases: string[], language?: string) {
  const candidates = [...titles, ...aliases].map((value) => value?.trim()).filter(Boolean);
  if (language?.toLowerCase().startsWith("zh")) return candidates[0];
  return candidates.find((value) => /[A-Za-z]/.test(value)) ?? candidates[0];
}

function alternateTitle(values: string[], title: string, language?: string) {
  const candidates = values.map((value) => value?.trim()).filter(Boolean);
  if (language?.toLowerCase().startsWith("zh")) {
    return candidates.find((candidate) => candidate !== title && /[A-Za-z]/.test(candidate));
  }
  return candidates.find((candidate) => candidate !== title && !/[A-Za-z]/.test(candidate));
}

function inferSearchMediaType(record: PtgenSearchHit, fallback?: MediaType): MediaType {
  if (fallback) return fallback;
  const kind = record.kind?.toLowerCase();
  if (kind === "tv" || kind === "series" || kind === "anime") return "TV_SERIES";
  return "MOVIE";
}

function inferLegacyMediaType(record: PtgenLegacyRecord, fallback?: MediaType): MediaType {
  const imdbType = record["@type"]?.toLowerCase();
  if (imdbType === "tvseries" || imdbType === "tvepisode") return "TV_SERIES";
  if (imdbType === "movie") return "MOVIE";

  const episodes = numberFromValue(record.episodes);
  if (episodes && episodes > 0) return "TV_SERIES";
  return fallback ?? "MOVIE";
}

function externalUrl(source: PtgenSource, sourceId: string) {
  return source === "imdb"
    ? `https://www.imdb.com/title/${sourceId}/`
    : `https://movie.douban.com/subject/${sourceId}/`;
}

function resolvePtgenPosterUrl(value: unknown, baseUrl?: string) {
  const path = typeof value === "string" ? value.trim() : "";
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  if (!baseUrl) return path;
  return new URL(path, ensureTrailingSlash(baseUrl)).toString();
}

function scorePtgenCandidate(
  query: string,
  titles: string[],
  mediaType: MediaType,
  expectedYear: number | undefined,
  season: number | undefined,
  episode: number | undefined,
  index: number,
  actualYear?: number
) {
  const score = scoreProviderCandidate({
    query,
    candidateTitles: titles,
    mediaType,
    expectedYear,
    actualYear,
    season,
    episode
  });
  const rankPenalty = score >= 0.94 ? 0 : Math.min(index, 4) * 0.03;
  return Math.max(0, Math.min(1, Number((score - rankPenalty).toFixed(2))));
}

function legacyTitles(record: PtgenLegacyRecord) {
  return [
    record.chinese_title,
    record.foreign_title,
    record.name,
    ...arrayValue(record.this_title),
    ...arrayValue(record.trans_title)
  ].filter((value): value is string => Boolean(value));
}

function yearFromValue(value: unknown): number | undefined {
  const match = String(value ?? "").match(/\d{4}/);
  if (!match) return undefined;
  const year = Number(match[0]);
  return Number.isFinite(year) ? year : undefined;
}

function numberFromValue(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function integerFromValue(value: unknown): number | undefined {
  const number = numberFromValue(value);
  return number === undefined ? undefined : Math.trunc(number);
}

function firstValue(values?: string[] | string) {
  if (Array.isArray(values)) return values.find(Boolean);
  return values;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim();
}

function arrayValue(value?: string[] | string) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function personNames(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value
    .map((item) => typeof item === "string"
      ? item
      : item && typeof item === "object" && "name" in item
        ? String((item as { name?: unknown }).name ?? "")
        : "")
    .filter(Boolean);
  return names.length > 0 ? names : undefined;
}

function imdbIdFromLink(value?: string) {
  return value?.match(/\/title\/(tt\d+)/i)?.[1]?.toLowerCase();
}

function doubanIdFromLink(value?: string) {
  return value?.match(/\/subject\/(\d+)/i)?.[1];
}

function stringFromFormatted(formatted: Record<string, unknown> | undefined, key: string) {
  const value = formatted?.[key];
  return typeof value === "string" ? value : undefined;
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}
