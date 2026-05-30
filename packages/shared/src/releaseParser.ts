import type { ParsedRelease } from "./types.js";

const QUALITY_RE = /\b(2160p|4k|1080p|720p|480p)\b/i;
const SOURCE_RE = /\b(WEB[- .]?DL|WEBRip|BluRay|BDRip|HDTV|DVDRip|Remux|UHD|HDRip)\b/i;
const CODEC_RE = /\b(x265|x264|h\.?265|h\.?264|hevc|avc|av1)\b/i;
const AUDIO_RE = /\b(DDP?5\.1|DDP?7\.1|DTS[- .]?HD|TrueHD|Atmos|AAC[ .]?2\.0|AAC[ .]?5\.1|FLAC)\b/i;
const YEAR_RE = /\b(19\d{2}|20\d{2})\b/;
const TV_RE = /\bS(\d{1,2})E(\d{1,3})(?:[- .]?E?(\d{1,3}))?\b/i;
const SEASON_PACK_RE = /\bS(\d{1,2})(?:\b|[- .])(?!E\d)/i;

export function parseReleaseTitle(rawTitle: string): ParsedRelease {
  const withoutSiteTags = rawTitle
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\([^\)]*(?:ourbits|torrent|rss)[^\)]*\)/gi, " ");
  const releaseGroup = extractReleaseGroup(withoutSiteTags);
  const normalized = withoutSiteTags
    .replace(/_/g, ".")
    .replace(/\s+/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.+|\.+$/g, "");

  const tv = normalized.match(TV_RE);
  const seasonPack = normalized.match(SEASON_PACK_RE);
  const yearMatch = normalized.match(YEAR_RE);
  const quality = normalized.match(QUALITY_RE)?.[1]?.replace(/^4k$/i, "2160p");
  const source = normalized.match(SOURCE_RE)?.[1]?.replace(/[ .]/g, "-");
  const codec = normalizeCodec(normalized.match(CODEC_RE)?.[1]);
  const audio = normalized.match(AUDIO_RE)?.[1]?.replace(/[ .]/g, ".");

  const titleStop = firstDefinedIndex(
    tv?.index,
    seasonPack?.index,
    yearMatch?.index,
    normalized.search(QUALITY_RE),
    normalized.search(SOURCE_RE)
  );

  const rawName = titleStop >= 0 ? normalized.slice(0, titleStop) : normalized;
  const title = cleanTitle(rawName) || cleanTitle(normalized);
  const kind = tv || seasonPack ? "TV" : yearMatch ? "MOVIE" : "UNKNOWN";
  const confidence = scoreConfidence({
    title,
    kind,
    hasYear: Boolean(yearMatch),
    hasQuality: Boolean(quality),
    hasTv: Boolean(tv || seasonPack)
  });

  return {
    title,
    year: yearMatch ? Number(yearMatch[1]) : undefined,
    kind,
    season: tv ? Number(tv[1]) : seasonPack ? Number(seasonPack[1]) : undefined,
    episode: tv ? Number(tv[2]) : undefined,
    episodeEnd: tv?.[3] ? Number(tv[3]) : undefined,
    quality,
    source,
    codec,
    audio,
    releaseGroup,
    confidence
  };
}

function extractReleaseGroup(input: string): string | undefined {
  const match = input.match(/-([A-Za-z0-9]+)\s*$/);
  return match?.[1];
}

function normalizeCodec(codec?: string): string | undefined {
  if (!codec) return undefined;
  const lower = codec.toLowerCase().replace(".", "");
  if (lower === "h265" || lower === "x265" || lower === "hevc") return "H.265";
  if (lower === "h264" || lower === "x264" || lower === "avc") return "H.264";
  return codec.toUpperCase();
}

function cleanTitle(value: string): string {
  return value
    .replace(/[.\-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b(PROPER|REPACK|LIMITED|EXTENDED|UNCUT)\b/gi, "")
    .trim();
}

function firstDefinedIndex(...indexes: Array<number | undefined>): number {
  return indexes
    .filter((index): index is number => typeof index === "number" && index >= 0)
    .sort((a, b) => a - b)[0] ?? -1;
}

function scoreConfidence(input: {
  title: string;
  kind: string;
  hasYear: boolean;
  hasQuality: boolean;
  hasTv: boolean;
}): number {
  let score = input.title ? 0.35 : 0;
  if (input.kind !== "UNKNOWN") score += 0.25;
  if (input.hasYear) score += 0.15;
  if (input.hasQuality) score += 0.1;
  if (input.hasTv) score += 0.15;
  return Math.min(1, Number(score.toFixed(2)));
}
