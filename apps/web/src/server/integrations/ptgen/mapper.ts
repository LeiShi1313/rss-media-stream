import type { MediaType, ProviderTitleResult } from "@rss-media/shared/types";
import type { PtgenProviderEntityType, PtgenRecord, PtgenSite } from "./types.js";

export function ptgenRecordToTitleResult(
  record: PtgenRecord,
  input: {
    site: PtgenSite;
    sid: string;
    mediaType?: MediaType;
    language?: string;
    baseUrl?: string;
  }
): ProviderTitleResult {
  const mediaType = inferMediaType(record, input.mediaType);
  const title = preferredTitle(record, input.language) ?? input.sid;
  const originalTitle = alternateTitle(record, title, input.language);
  const rating = primaryRating(record, input.site);

  return {
    provider: "ptgen",
    providerEntityType: providerEntityType(input.site),
    providerId: input.sid,
    mediaType,
    title,
    normalizedTitle: normalizeTitle(title),
    originalTitle,
    releaseYear: yearFromValue(record.year ?? record.datePublished ?? firstValue(record.playdate)),
    language: input.language,
    payload: {
      source: "ptgen",
      site: input.site,
      sid: input.sid,
      posterPath: record.poster,
      overview: record.introduction ?? record.description,
      imdbId: record.imdb_id ?? imdbIdFromLink(record.imdb_link),
      imdbLink: record.imdb_link,
      doubanLink: record.douban_link,
      genre: record.genre,
      language: record.language,
      region: record.region,
      episodes: record.episodes,
      aka: record.aka,
      transTitle: record.trans_title,
      thisTitle: record.this_title,
      updateAt: record.update_at,
      baseUrl: input.baseUrl,
      raw: record
    },
    ratingValue: rating?.value,
    ratingScale: rating ? 10 : undefined,
    ratingVoteCount: rating?.voteCount,
    ratingType: rating ? "user_score" : undefined,
    matchConfidence: 1,
    externalUrl: externalUrl(record, input.site, input.sid)
  };
}

export function ptgenEntityTypeToSite(entityType: string): PtgenSite | undefined {
  if (entityType === "ptgen_imdb") return "imdb";
  if (entityType === "ptgen_douban") return "douban";
  return undefined;
}

export function providerEntityType(site: PtgenSite): PtgenProviderEntityType {
  return site === "imdb" ? "ptgen_imdb" : "ptgen_douban";
}

function preferredTitle(record: PtgenRecord, language?: string) {
  if (language?.toLowerCase().startsWith("zh")) {
    return firstNonEmpty(record.chinese_title, firstValue(record.trans_title), record.foreign_title, record.name);
  }
  return firstNonEmpty(record.name, record.foreign_title, firstValue(record.this_title), record.chinese_title);
}

function alternateTitle(record: PtgenRecord, title: string, language?: string) {
  const candidates = language?.toLowerCase().startsWith("zh")
    ? [record.foreign_title, record.name, firstValue(record.this_title)]
    : [record.chinese_title, firstValue(record.trans_title)];
  return candidates.find((candidate) => candidate && candidate !== title);
}

function inferMediaType(record: PtgenRecord, fallback?: MediaType): MediaType {
  const imdbType = record["@type"]?.toLowerCase();
  if (imdbType === "tvseries" || imdbType === "tvepisode") return "TV_SERIES";
  if (imdbType === "movie") return "MOVIE";

  const episodes = numberFromValue(record.episodes);
  if (episodes && episodes > 0) return "TV_SERIES";
  return fallback ?? "MOVIE";
}

function primaryRating(record: PtgenRecord, site: PtgenSite) {
  const average = site === "douban"
    ? numberFromValue(record.douban_rating_average) ?? numberFromValue(record.imdb_rating_average)
    : numberFromValue(record.imdb_rating_average) ?? numberFromValue(record.douban_rating_average);
  if (average === undefined) return undefined;
  return {
    value: average,
    voteCount: site === "douban"
      ? integerFromValue(record.douban_votes) ?? integerFromValue(record.imdb_votes)
      : integerFromValue(record.imdb_votes) ?? integerFromValue(record.douban_votes)
  };
}

function externalUrl(record: PtgenRecord, site: PtgenSite, sid: string) {
  if (site === "imdb") return record.imdb_link ?? `https://www.imdb.com/title/${sid}/`;
  return record.douban_link ?? `https://movie.douban.com/subject/${sid}/`;
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

function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim();
}

function imdbIdFromLink(value?: string) {
  return value?.match(/\/title\/(tt\d+)/i)?.[1];
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}
