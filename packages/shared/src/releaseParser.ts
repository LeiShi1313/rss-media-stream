import type { ParsedRelease } from "./types.js";

const QUALITY_RE = /\b(2160p|4k|1080p|1080i|720p|576p|540p|480p)\b/i;
const ONLY_QUALITY_RE = /^(?:2160p|4k|1080p|1080i|720p|576p|540p|480p)$/i;
const DIMENSION_RE = /\b(3840[ ._-]?x[ ._-]?2160|1920[ ._-]?x[ ._-]?1080|1280[ ._-]?x[ ._-]?720|720[ ._-]?x[ ._-]?480)\b/i;
const SOURCE_RE = /\b(WEB[- .]?DL|WEBRip|Blu[- .]?Ray|BDRip|HDTV|DVDRip|Remux|UHD|HDRip|WEB)\b/i;
const CODEC_RE = /\b(x265|x264|h[ .]?265|h[ .]?264|hevc|avc|av1|mpeg[ .]?2)\b/i;
const AUDIO_RE = /\b(DDP?[ .]?(?:5\.1|7\.1|2\.0)?|DD\+[ .]?(?:5\.1|7\.1|2\.0)?|DTS[- .]?HD|TrueHD|Atmos|AAC[ .]?(?:2\.0|5\.1)?|FLAC|OPUS[ .]?(?:2\.0|5\.1)?|LPCM[ .]?(?:2\.0|5\.1)?)\b/i;
const YEAR_RE = /\b(19\d{2}|20\d{2})\b/;
const TV_RE = /\bS(\d{1,4})[ ._-]?E(\d{1,3})(?:(?:[- ._]+E?|E)(\d{1,3}))*\b/i;
const LONG_TV_RE = /\bS(\d{1,2})[ ._-]?E(\d{4})(?:(?:[-_]+E?|[ .]+E|E)(\d{4}))?\b/i;
const EPISODE_ONLY_RE = /\bEP?(\d{1,3})(?:[- ._]?EP?(\d{1,3}))?\b/i;
const LONG_EPISODE_ONLY_RE = /\bEP?(\d{4})(?:[- ._]?EP?(\d{4}))?\b/i;
const SEASON_PACK_RE = /\bS(\d{1,2})(?:\b|[- .])(?!E\d)/i;
const SEASON_WORD_PACK_RE = /\bSeason[ ._-]?(\d{1,2})\b/i;
const COMPLETE_WORD_RE = /\bComplete\b/i;
const AKA_RE = /\b(?:AKA|ALIAS)\b/i;
const SIZE_SEGMENT_RE = /^\d+(?:\.\d+)?\s*(?:gib|gb|mib|mb|tib|tb)$/i;
const CATEGORY_SEGMENT_RE = /^(?:(?:movies?|movie|tv(?:\s*series)?|series|animations?|animation|anime|sports|documentaries?|documentary|hd|sd|uhd)|(?:电影|剧集|电视剧|纪录片|动漫|动画|音乐|综艺|连载|完结|完结撒花))(?:\s+(?:(?:movies?|movie|tv(?:\s*series)?|series|animations?|animation|anime|sports|documentaries?|documentary|hd|sd|uhd)|(?:电影|剧集|电视剧|纪录片|动漫|动画|音乐|综艺|连载|完结|完结撒花)))*$/i;
const UNSUPPORTED_MEDIA_CATEGORY_SEGMENT_RE = /^(?:music(?:s)?(?:\s+(?:videos?|mv|lossless))?(?:\s*\([^)]*\))?(?:\s*\/\s*音乐\s*mv)?|sports?(?:\s+\d{3,4}[pi])?|音乐\s*(?:cd|mv|短片)?(?:\s*\([^)]*\))?)$/iu;
const EXTRA_INFO_RE = /类型|主演|类别|字幕|国语|中字|导演|演员|简繁|第\d|全\d|日语|英语|粤语|内封|内嵌|\|/i;
const METADATA_INFO_FIELD_RE = /^(?:类型|类别|字幕|导演|主演|演员|语言|音频|视频|格式|地区|年份|年代|上映|首播|播出|国语|中字|简繁|简中|繁中|日语|英语|粤语|汉语普通话|网络收费短剧|4k|1080p|1080i|720p|2160p|uhd|hdr)$/i;
const METADATA_TITLE_PREFIX_RE = /^(?:(?:\d{1,2}|[一二三四五六七八九十两]{1,3})\s*月\s*新番|(?:陸劇|陆剧|港劇|港剧|日劇|日剧|韓劇|韩剧|美劇|美剧|英劇|英剧|台劇|台剧|劇集|剧集|电视剧|電視劇|綜藝|综艺|動畫|动画|動漫|动漫|電影|电影|国漫|國漫|日漫))\s*[:：]?\s*/iu;
const PROVIDER_ALIAS_NOISE_RE = /字幕|sub|中字|简繁|簡繁|简体|簡體|繁体|繁體|双语|雙語|国语|國語|粤语|粵語|英语|英語|日语|日語|韩语|韓語|内封|內封|内嵌|內嵌|多国|多國|类别|類別|类型|類型|导演|導演|主演|演员|演員|频道|頻道|高码率|高碼率|码率|碼率|杜比|源码|源碼|小组录制|小組錄製|出品|评论|評論|音轨|音軌|音频|音頻|花絮|特典|幕后|幕後|原盘|原盤|美版|港版|台版|日版|英版|加长版|加長版|完整版|导演剪辑|導演剪輯|官方|纪念版|紀念版|菜单|菜單|按钮|按鈕|原生|新增|shout\s*factory|生肉|自录|自錄|压缩包|壓縮包|破解|自动发种|自動發種|人工编辑|人工編輯/iu;
const PROVIDER_ALIAS_CATEGORY_PREFIX_RE = /^(?:动漫|動畫|动画|游戏|遊戲|電影|电影|电视剧|電視劇|剧集|劇集|(?:海外)?综艺|(?:海外)?綜藝|movie|movies|series|tv(?:\s+series)?|pc)\b/iu;
const BROADCAST_CAPTURE_PREFIX_RE = /^(?:ZJTV[- .]?4K|GDTV[- .]?4K|JSWS[- .]?4K|HNTV[- .]?4K|SDTV[- .]?4K|BRTV[- .]?WS4K|CCTV[- .]?3|CWJDTV)[ ._-]+/i;
const BROADCASTER_METADATA_PREFIX_RE = /^(?:(?:中央电视台|央视|北京卫视|浙江卫视|广东卫视|湖南卫视|江苏卫视|山东卫视)[^ ]*(?:频道)?|中国广电重温经典频道)\s+/u;
const CJK_VARIETY_SECTION_LABEL_RE = /\s+(?:(?:正片|纯享|純享|加更|日记|日記|私藏日记|私藏日記|萌娃当家|副本存档中)(?:版)?\s*)+$/u;
const TV_CATEGORY_WRAPPER_FIELD_RE = /^(?:tv\s*series|series)\s*[\/|]\s*(?:剧集|劇集)\s*(?:分集|合集)?$/iu;
const SHORT_DRAMA_METADATA_PREFIX_RE = /^(?:短剧|短劇)\s*[:：]\s*/u;
const MIN_METADATA_YEAR = 1900;
const NATIVE_SCRIPT_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const LATIN_RE = /[A-Za-z]/;
const SLASH_NUMERIC_TITLE_RE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
const CHINESE_SEASON_RE = /(?:第\s*([一二三四五六七八九十两\d]{1,3})\s*(?:季|部)|([一二三四五六七八九十两\d]{1,3})\s*季)/u;
const CHINESE_EPISODE_RE = /第\s*([一二三四五六七八九十两\d]{1,4})(?:\s*[-~至到－—]\s*([一二三四五六七八九十两\d]{1,4}))?\s*(?:集|话|話)/u;
const WHOLE_SERIES_EPISODE_RE = /全\s*(?!0*1\s*(?:集|话|話)|一\s*(?:集|话|話))[一二三四五六七八九十两\d]{1,3}\s*(?:集|话|話)/u;
const CJK_COMPLETE_EPISODE_RANGE_RE = /\d{1,4}\s*[-~至到－—]\s*\d{1,4}\s*(?:集|话|話)\s*(?:全|完|完结|完結)/u;
const ANIMATION_TV_EPISODE_RANGE_RE = /\bTV\b[^\[\]]{0,40}\d{1,4}\s*[-~－—]\s*\d{1,4}/iu;

export function parseReleaseTitle(rawTitle: string): ParsedRelease {
  const cleanedRawTitle = stripMediaExtension(rawTitle);
  const parseInput = stripBroadcastCapturePrefix(stripMediaExtension(releaseParseInput(rawTitle)));
  const unsupportedMediaCategory = hasUnsupportedLeadingMediaCategory(rawTitle);
  const movieMediaCategory = hasMovieLeadingMediaCategory(rawTitle);
  const categorySeriesEvidence =
    (hasStrongTvLeadingMediaCategory(rawTitle) && hasWholeSeriesTvMarker(rawTitle)) ||
    hasAnimationSeriesEvidence(rawTitle);
  const releaseGroup = extractReleaseGroup(parseInput);
  const normalized = normalizeReleaseText(parseInput);
  const rawNormalized = normalizeReleaseText(cleanedRawTitle);
  const parseInputHasBrackets = /[\[\]]/.test(parseInput);

  const tvMatch = normalized.match(TV_RE) ?? normalized.match(LONG_TV_RE);
  const tv = usableTvMatch(normalized, tvMatch) ? tvMatch : undefined;
  const episodeOnly = tv ? undefined : normalized.match(EPISODE_ONLY_RE);
  const longEpisodeOnly = tv || episodeOnly || !hasLongEpisodeOnlyTvEvidence(rawTitle)
    ? undefined
    : normalized.match(LONG_EPISODE_ONLY_RE);
  const seasonPack = normalized.match(SEASON_PACK_RE) ?? normalized.match(SEASON_WORD_PACK_RE);
  const normalizedChineseSeason = parseInputHasBrackets ? undefined : findChineseSeason(normalized, "normalized");
  const chineseSeason = normalizedChineseSeason ?? (movieMediaCategory ? undefined : findChineseSeason(rawTitle, "raw"));
  const rawChineseEpisode = tv || episodeOnly || seasonPack || chineseSeason
    ? findChineseEpisode(rawTitle, "raw")
    : undefined;
  const chineseEpisode = parseInputHasBrackets
    ? rawChineseEpisode
    : findChineseEpisode(normalized, "normalized") ?? rawChineseEpisode;
  const yearMatch = normalized.match(YEAR_RE);
  const qualityMatch = normalized.match(QUALITY_RE) ?? rawNormalized.match(QUALITY_RE);
  const dimensionMatch = normalized.match(DIMENSION_RE) ?? rawNormalized.match(DIMENSION_RE);
  const quality = normalizeQuality(qualityMatch?.[1]) ?? normalizeDimensionQuality(dimensionMatch?.[1]);
  const resolution = normalizeResolution(quality) ?? normalizeDimensionResolution(dimensionMatch?.[1]);
  const source = normalizeSource((normalized.match(SOURCE_RE) ?? rawNormalized.match(SOURCE_RE))?.[1]);
  const codec = normalizeCodec((normalized.match(CODEC_RE) ?? rawNormalized.match(CODEC_RE))?.[1]);
  const audio = normalizeAudio((normalized.match(AUDIO_RE) ?? rawNormalized.match(AUDIO_RE))?.[1]);
  const year = yearMatch ? Number(yearMatch[1]) : inferMetadataYear(rawTitle);
  const completeIndex = categorySeriesEvidence ? normalized.search(COMPLETE_WORD_RE) : -1;
  const hasTvEvidence = Boolean(tv || episodeOnly || longEpisodeOnly || seasonPack || chineseSeason || chineseEpisode || categorySeriesEvidence);

  const titleStop = firstDefinedIndex(
    tv?.index,
    episodeOnly?.index,
    longEpisodeOnly?.index,
    seasonPack?.index,
    chineseSeason?.source === "normalized" ? chineseSeason.index : undefined,
    chineseEpisode?.source === "normalized" ? chineseEpisode.index : undefined,
    completeIndex,
    yearMatch?.index,
    normalized.search(QUALITY_RE),
    normalized.search(DIMENSION_RE),
    normalized.search(SOURCE_RE)
  );

  const rawName = titleStop >= 0 ? normalized.slice(0, titleStop) : normalized;
  const fallbackTitle = cleanTitle(rawName) || cleanTitle(normalized);
  const titleInfo = deriveTitleInfo({
    rawTitle,
    rawName,
    fallbackTitle
  });
  const title = titleInfo.title;
  const mediaType = unsupportedMediaCategory
    ? "UNKNOWN"
    : hasTvEvidence
      ? "TV_SERIES"
      : year
        ? "MOVIE"
        : "UNKNOWN";
  const season = tv ? Number(tv[1]) : seasonPack ? Number(seasonPack[1]) : chineseSeason?.season ?? (episodeOnly || longEpisodeOnly || chineseEpisode ? 1 : undefined);
  const episode = tv ? Number(tv[2]) : episodeOnly ? Number(episodeOnly[1]) : longEpisodeOnly ? Number(longEpisodeOnly[1]) : chineseEpisode?.episode;
  const episodeEnd = tv?.[3] ? Number(tv[3]) : episodeOnly?.[2] ? Number(episodeOnly[2]) : longEpisodeOnly?.[2] ? Number(longEpisodeOnly[2]) : chineseEpisode?.episodeEnd;
  const parseConfidence = scoreConfidence({
    title,
    mediaType,
    hasYear: Boolean(year),
    hasQuality: Boolean(quality),
    hasTv: hasTvEvidence
  });

  return {
    title,
    titleCandidates: titleInfo.titleCandidates,
    providerSearchTitles: titleInfo.providerSearchTitles,
    primarySearchTitle: titleInfo.primarySearchTitle,
    year,
    mediaType,
    season,
    episode,
    episodeEnd,
    resolution,
    quality,
    source,
    codec,
    audio,
    releaseGroup,
    parseConfidence
  };
}

function releaseParseInput(rawTitle: string): string {
  const categoryStrippedTitle = stripLeadingCategoryWrappers(rawTitle);
  const releaseSegment = releaseLikeSegments(categoryStrippedTitle)[0];
  if (releaseSegment) return releaseSegment.segment;

  const bracketSegments = [...categoryStrippedTitle.matchAll(/\[([^\]]*)\]/g)]
    .map((match) => match[1]?.trim())
    .filter((segment): segment is string => Boolean(segment));
  const rawWithoutBracketSegments = categoryStrippedTitle.replace(/\[[^\]]*\]/g, " ").trim();
  const bestBracketSegment = bracketSegments
    .map((segment) => ({ segment, score: scoreReleaseLikeSegment(segment) }))
    .filter((candidate) => candidate.score >= 3 && isReleaseLikeSegment(candidate.segment))
    .sort((a, b) => b.score - a.score)[0];
  const unbracketedScore = scoreReleaseLikeSegment(rawWithoutBracketSegments);

  if (unbracketedScore >= 3 && isReleaseLikeSegment(rawWithoutBracketSegments)) {
    return rawWithoutBracketSegments;
  }

  if (bestBracketSegment && bestBracketSegment.score > unbracketedScore) {
    return bestBracketSegment.segment;
  }

  return categoryStrippedTitle
    .replace(/\[[^\]]*(?:ourbits|torrent|rss)[^\]]*\]/gi, " ")
    .replace(/\([^\)]*(?:ourbits|torrent|rss)[^\)]*\)/gi, " ");
}

function stripLeadingCategoryWrappers(rawTitle: string) {
  const stripped = rawTitle.trimStart();
  const match = stripped.match(/^\[([^\]]+)\]\s*/u);
  if (!match?.[1] || !categoryWrapperSegment(match[1])) return stripped;

  const afterWrapper = stripped.slice(match[0].length).trimStart();
  return afterWrapper.startsWith("[") ? stripped : afterWrapper;
}

function categoryWrapperSegment(segment: string) {
  const normalized = segment.trim();
  return movieMediaCategorySegment(normalized) ||
    animationMediaCategorySegment(normalized) ||
    strongTvMediaCategorySegment(normalized) ||
    documentaryMediaCategorySegment(normalized);
}

function documentaryMediaCategorySegment(segment: string) {
  const trimmed = segment.trim();
  return /^(?:纪录片|紀錄片|documentaries?|documentary)(?:$|\b|[\s(/]|\p{Script=Han})/iu.test(trimmed);
}

function normalizeReleaseText(input: string): string {
  return input
    .replace(/_/g, ".")
    .replace(/\s+/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

function stripBroadcastCapturePrefix(input: string): string {
  return input.replace(BROADCAST_CAPTURE_PREFIX_RE, "");
}

function usableTvMatch(normalized: string, match: RegExpMatchArray | null) {
  if (!match || match.index == null || match.index <= 0) return false;
  const leadingTitle = cleanTitle(normalized.slice(0, match.index));
  if (!leadingTitle || ONLY_QUALITY_RE.test(leadingTitle)) return false;
  return /[\p{Letter}\p{Number}]/u.test(leadingTitle);
}

function stripMediaExtension(input: string): string {
  return input.replace(/\.(?:mkv|mp4|avi|mov|wmv|flv|webm|ts|m2ts|iso|m4v|mpg|mpeg)$/i, "");
}

function releaseLikeSegments(rawTitle: string) {
  return titleSegments(rawTitle)
    .map((segment, index) => ({
      segment,
      index,
      score: scoreReleaseLikeSegment(segment)
    }))
    .filter((candidate) => candidate.score >= 3 && isReleaseLikeSegment(candidate.segment))
    .sort((a, b) => b.score - a.score || b.segment.length - a.segment.length);
}

function titleSegments(rawTitle: string) {
  const segments = rawTitle
    .split(/[\[\]]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.length > 0 ? segments : [rawTitle.trim()].filter(Boolean);
}

function scoreReleaseLikeSegment(segment: string): number {
  if (!segment || SIZE_SEGMENT_RE.test(segment) || CATEGORY_SEGMENT_RE.test(segment) || unsupportedMediaCategorySegment(segment)) return 0;
  let score = 0;
  if (TV_RE.test(segment)) score += 5;
  if (SEASON_PACK_RE.test(segment) || SEASON_WORD_PACK_RE.test(segment)) score += 3;
  if (YEAR_RE.test(segment)) score += 3;
  if (QUALITY_RE.test(segment) || DIMENSION_RE.test(segment)) score += 2;
  if (SOURCE_RE.test(segment)) score += 2;
  if (CODEC_RE.test(segment)) score += 1;
  if (AUDIO_RE.test(segment)) score += 1;
  if (extractReleaseGroup(segment)) score += 2;
  if ((segment.match(/[._]/g) ?? []).length >= 2) score += 1;
  if (EXTRA_INFO_RE.test(segment)) score -= 3;
  return score;
}

function isReleaseLikeSegment(segment: string) {
  if (!segment || SIZE_SEGMENT_RE.test(segment) || CATEGORY_SEGMENT_RE.test(segment) || unsupportedMediaCategorySegment(segment)) return false;
  const hasQuality = QUALITY_RE.test(segment) || DIMENSION_RE.test(segment);
  const hasTech = SOURCE_RE.test(segment) || CODEC_RE.test(segment) || AUDIO_RE.test(segment);
  const looksLikeSceneFilename = YEAR_RE.test(segment) &&
    SOURCE_RE.test(segment) &&
    Boolean(extractReleaseGroup(segment)) &&
    (segment.match(/[._]/g) ?? []).length >= 1;
  const looksLikeEpisodeFilename = TV_RE.test(segment) &&
    YEAR_RE.test(segment) &&
    (segment.match(/[._]/g) ?? []).length >= 2;
  const hasIdentitySignal = YEAR_RE.test(segment) ||
    TV_RE.test(segment) ||
    SEASON_PACK_RE.test(segment) ||
    SEASON_WORD_PACK_RE.test(segment) ||
    Boolean(extractReleaseGroup(segment)) ||
    (segment.match(/[._]/g) ?? []).length >= 2;
  return looksLikeSceneFilename || looksLikeEpisodeFilename || (hasQuality && hasTech && hasIdentitySignal);
}

function hasUnsupportedLeadingMediaCategory(rawTitle: string) {
  const trimmed = rawTitle.trim();
  const bracketed = trimmed.match(/^\[([^\]]+)\]/)?.[1];
  if (bracketed && unsupportedMediaCategorySegment(bracketed)) return true;
  const leadingWord = trimmed.match(/^([^\s[\]:：]+)/u)?.[1];
  return Boolean(leadingWord && unsupportedMediaCategorySegment(leadingWord));
}

function hasMovieLeadingMediaCategory(rawTitle: string) {
  const bracketed = rawTitle.trim().match(/^\[([^\]]+)\]/)?.[1];
  return Boolean(bracketed && movieMediaCategorySegment(bracketed));
}

function hasStrongTvLeadingMediaCategory(rawTitle: string) {
  const bracketed = rawTitle.trim().match(/^\[([^\]]+)\]/)?.[1];
  return Boolean(bracketed && strongTvMediaCategorySegment(bracketed));
}

function hasAnimationSeriesEvidence(rawTitle: string) {
  return hasAnimationLeadingMediaCategory(rawTitle) &&
    !hasMangaBracketCategory(rawTitle) &&
    (
      hasExplicitTvBracketSegment(rawTitle) ||
      hasAnimationTvEpisodeRange(rawTitle) ||
      hasBracketEpisodeRange(rawTitle) ||
      CJK_COMPLETE_EPISODE_RANGE_RE.test(rawTitle) ||
      WHOLE_SERIES_EPISODE_RE.test(rawTitle)
    );
}

function hasAnimationLeadingMediaCategory(rawTitle: string) {
  const bracketed = rawTitle.trim().match(/^\[([^\]]+)\]/)?.[1];
  return Boolean(bracketed && animationMediaCategorySegment(bracketed));
}

function hasLongEpisodeOnlyTvEvidence(rawTitle: string) {
  return hasStrongTvLeadingMediaCategory(rawTitle) ||
    (hasAnimationLeadingMediaCategory(rawTitle) && !hasMangaBracketCategory(rawTitle));
}

function movieMediaCategorySegment(segment: string) {
  const trimmed = segment.trim();
  return /^(?:电影|電影)/u.test(trimmed) ||
    /^movies?(?:\b|[\s(/]|\p{Script=Han})/iu.test(trimmed);
}

function animationMediaCategorySegment(segment: string) {
  const trimmed = segment.trim();
  return /^(?:动漫|動畫|动画|animations?|animation|anime)(?:$|\b|[\s(/]|\p{Script=Han})/iu.test(trimmed);
}

function strongTvMediaCategorySegment(segment: string) {
  const trimmed = segment.trim();
  return /^(?:电视剧|電視劇|剧集|劇集|综艺|綜藝)/u.test(trimmed) ||
    /^(?:tv\s*series|series)(?:\b|[\s(/]|\p{Script=Han})/iu.test(trimmed);
}

function hasExplicitTvBracketSegment(rawTitle: string) {
  return titleSegments(rawTitle).some((segment) =>
    /^(?:tv|テレビ|テレビアニメ)$/iu.test(segment.trim())
  );
}

function hasAnimationTvEpisodeRange(rawTitle: string) {
  return titleSegments(rawTitle).some((segment) =>
    ANIMATION_TV_EPISODE_RANGE_RE.test(segment.trim())
  );
}

function hasBracketEpisodeRange(rawTitle: string) {
  return titleSegments(rawTitle).some((segment) =>
    /^\d{1,3}\s*[-~－—]\s*\d{1,3}\s*(?:fin(?:\+sp)?|合集|完结|完結)?$/iu.test(segment.trim())
  );
}

function hasMangaBracketCategory(rawTitle: string) {
  return titleSegments(rawTitle).some((segment) =>
    /^(?:漫画|manga)$/iu.test(segment.trim())
  );
}

function hasWholeSeriesTvMarker(rawTitle: string) {
  return WHOLE_SERIES_EPISODE_RE.test(rawTitle) || COMPLETE_WORD_RE.test(rawTitle);
}

function unsupportedMediaCategorySegment(segment: string) {
  return UNSUPPORTED_MEDIA_CATEGORY_SEGMENT_RE.test(segment.trim());
}

function extractReleaseGroup(input: string): string | undefined {
  const match = stripMediaExtension(input.trim()).match(/-([\p{Letter}\p{Number}@][\p{Letter}\p{Number}@._³™]{1,30})(?:\s*[\])]+)?\s*$/u);
  return match?.[1];
}

function normalizeQuality(quality?: string): string | undefined {
  if (!quality) return undefined;
  return quality.replace(/^4k$/i, "2160p");
}

function normalizeResolution(quality?: string): number | undefined {
  if (!quality) return undefined;
  const normalized = quality.toLowerCase();
  if (normalized === "4k") return 2160;
  const match = normalized.match(/^(\d{3,4})[pi]$/);
  return match ? Number(match[1]) : undefined;
}

function normalizeDimensionQuality(dimension?: string): string | undefined {
  const resolution = normalizeDimensionResolution(dimension);
  return resolution ? `${resolution}p` : undefined;
}

function normalizeDimensionResolution(dimension?: string): number | undefined {
  if (!dimension) return undefined;
  const normalized = dimension.toLowerCase().replace(/[ ._-]/g, "");
  if (normalized === "3840x2160") return 2160;
  if (normalized === "1920x1080") return 1080;
  if (normalized === "1280x720") return 720;
  if (normalized === "720x480") return 480;
  return undefined;
}

function normalizeSource(source?: string): string | undefined {
  if (!source) return undefined;
  const normalized = source.toLowerCase().replace(/[- .]/g, "");
  if (normalized === "webdl") return "WEB-DL";
  if (normalized === "webrip") return "WEBRip";
  if (normalized === "bluray") return "BluRay";
  if (normalized === "bdrip") return "BDRip";
  if (normalized === "dvdrip") return "DVDRip";
  if (normalized === "hdrip") return "HDRip";
  if (normalized === "remux") return "Remux";
  if (normalized === "web") return "WEB";
  return source.toUpperCase();
}

function normalizeCodec(codec?: string): string | undefined {
  if (!codec) return undefined;
  const lower = codec.toLowerCase().replace(/[ .]/g, "");
  if (lower === "h265" || lower === "x265" || lower === "hevc") return "H.265";
  if (lower === "h264" || lower === "x264" || lower === "avc") return "H.264";
  if (lower === "mpeg2") return "MPEG-2";
  return codec.toUpperCase();
}

function normalizeAudio(audio?: string): string | undefined {
  if (!audio) return undefined;
  return audio.replace(/[ .]/g, ".");
}

function deriveTitleInfo(input: {
  rawTitle: string;
  rawName: string;
  fallbackTitle: string;
}) {
  const candidates: string[] = [];
  const releaseNameCandidates: string[] = [];
  const humanCandidates: string[] = [];
  const addCandidate = (candidate: string | undefined, options: { preservePunctuation?: boolean } = {}) => {
    const cleaned = options.preservePunctuation
      ? cleanHumanTitleCandidate(candidate ?? "")
      : cleanCandidateTitle(candidate ?? "");
    if (!isTitleCandidate(cleaned)) return undefined;
    if (!candidates.some((existing) => sameCandidate(existing, cleaned))) {
      candidates.push(cleaned);
    }
    return cleaned;
  };

  for (const candidate of titleCandidatesFromValue(input.rawName)) {
    const cleaned = addCandidate(candidate);
    if (cleaned && !releaseNameCandidates.some((existing) => sameCandidate(existing, cleaned))) {
      releaseNameCandidates.push(cleaned);
    }
  }

  for (const segment of titleSegments(input.rawTitle)) {
    if (!hasNativeScript(segment) && !AKA_RE.test(segment)) continue;
    if (scoreReleaseLikeSegment(segment) >= 3 && segment !== input.rawName) continue;
    for (const candidate of metadataTitleCandidatesFromSegment(segment)) {
      addCandidate(candidate, { preservePunctuation: true });
    }
  }

  for (const candidate of humanMetadataTitleCandidates(input.rawTitle)) {
    for (const titleCandidate of titleCandidatesFromValue(candidate)) {
      const cleaned = addCandidate(titleCandidate, { preservePunctuation: true });
      if (cleaned) humanCandidates.push(cleaned);
    }
  }

  addCandidate(input.fallbackTitle);

  const fallbackCandidates = validTitleCandidatesFromValue(input.fallbackTitle);
  const baseCanonical = chooseCanonicalTitle(
    input.rawName,
    releaseNameCandidates.length > 0 ? releaseNameCandidates : fallbackCandidates
  ) || input.fallbackTitle;
  const canonical = weakCanonicalTitle(baseCanonical)
    ? chooseCanonicalTitle(input.rawName, humanCandidates) ?? humanCandidates[0] ?? baseCanonical
    : humanCandidates.find((candidate) => equivalentTitleKey(candidate) === equivalentTitleKey(baseCanonical)) ?? baseCanonical;
  const nativeCandidate = candidates.find((candidate) => hasNativeScript(candidate));
  return {
    title: canonical,
    titleCandidates: candidates.length > 0 ? candidates : undefined,
    providerSearchTitles: providerSearchTitles(candidates, canonical),
    primarySearchTitle: nativeCandidate && !sameCandidate(nativeCandidate, canonical)
      ? nativeCandidate
      : canonical
  };
}

function providerSearchTitles(candidates: string[], canonical: string) {
  const aliases = candidates
    .filter((candidate) => providerSearchTitleCandidate(candidate, canonical));
  const nativeAliases = aliases.filter((candidate) => hasNativeScript(candidate));
  const latinAliases = aliases.filter((candidate) => !hasNativeScript(candidate));
  const ordered = [...nativeAliases, ...latinAliases];
  const unique: string[] = [];
  for (const alias of ordered) {
    if (unique.some((existing) => sameCandidate(existing, alias))) continue;
    unique.push(alias);
    if (unique.length >= 4) break;
  }
  return unique.length > 0 ? unique : undefined;
}

function providerSearchTitleCandidate(candidate: string, canonical: string) {
  if (sameCandidate(candidate, canonical)) return false;
  if (equivalentTitleKey(candidate) === equivalentTitleKey(canonical)) return false;
  if (!isTitleCandidate(candidate)) return false;
  if (standaloneCategoryAlias(candidate)) return false;
  if (PROVIDER_ALIAS_CATEGORY_PREFIX_RE.test(candidate)) return false;
  if (PROVIDER_ALIAS_NOISE_RE.test(candidate)) return false;
  if (/^\d{1,3}(?:\s*[/-]\s*\d{1,3})?$/.test(candidate)) return false;
  if (/\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:\s*[/-]\s*\d{1,2})?\b/i.test(candidate)) return false;
  if (!hasNativeScript(candidate)) {
    const words = candidate.split(/\s+/).filter(Boolean);
    if (words.length < 2) return false;
  }
  return true;
}

function standaloneCategoryAlias(candidate: string) {
  return /^(?:剧场|劇場|分集|合集|tv|ova|ona|sp|movie)$/iu.test(candidate.trim());
}

function titleCandidatesFromValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return [];

  const candidates: string[] = [];
  const slashNumericTitle = trimmed.replace(/^[\s.。·:：,，;；/\\|—-]+|[\s.。·:：,，;；/\\|—-]+$/gu, "");
  if (SLASH_NUMERIC_TITLE_RE.test(slashNumericTitle)) {
    candidates.push(slashNumericTitle);
  }
  for (const aliasPart of trimmed.split(AKA_RE)) {
    for (const part of splitTitlePart(aliasPart)) {
      for (const scriptPart of splitScriptRuns(part)) {
        candidates.push(scriptPart);
      }
      candidates.push(part);
    }
  }
  return candidates;
}

function humanMetadataTitleCandidates(rawTitle: string) {
  const match = rawTitle.match(/^\s*(.+?)\s*[\[(](?:19|20)\d{2}[\])]\s+by\b/i);
  return match?.[1] ? [match[1]] : [];
}

function metadataTitleCandidatesFromSegment(segment: string) {
  const cleanedSegment = cleanHumanTitleCandidate(segment);
  if (!cleanedSegment || CATEGORY_SEGMENT_RE.test(cleanedSegment)) return [];

  const candidates: string[] = [];
  for (const field of metadataTitleFields(cleanedSegment)) {
    const titleField = cleanMetadataTitleField(field);
    if (!titleField || metadataInfoField(titleField)) {
      continue;
    }
    for (const candidate of titleCandidatesFromValue(titleField)) {
      candidates.push(candidate);
    }
    break;
  }
  return candidates;
}

function metadataTitleFields(segment: string) {
  return segment
    .split(/\s*\|\s*/u)
    .map((field) => field.trim())
    .filter(Boolean);
}

function cleanMetadataTitleField(field: string) {
  let cleaned = field;
  while (METADATA_TITLE_PREFIX_RE.test(cleaned)) {
    cleaned = cleaned.replace(METADATA_TITLE_PREFIX_RE, "");
  }
  return cleaned
    .replace(/【[^】]*】/gu, " ")
    .replace(TV_CATEGORY_WRAPPER_FIELD_RE, " ")
    .replace(SHORT_DRAMA_METADATA_PREFIX_RE, " ")
    .replace(/(?:导演|主演|演员)[:：].*$/u, " ")
    .replace(/(?:类型|类别|類型|類別)[:：].*$/u, " ")
    .replace(BROADCASTER_METADATA_PREFIX_RE, " ")
    .replace(/\s+第\s*[一二三四五六七八九十两\d]{1,3}\s*(?:季|部)\s*第\s*[一二三四五六七八九十两\d]{1,4}(?:\s*[-~至到－—]\s*[一二三四五六七八九十两\d]{1,4})?\s*期.*$/u, " ")
    .replace(/\s*第\s*[一二三四五六七八九十两\d]{1,4}(?:\s*[-~至到－—]\s*[一二三四五六七八九十两\d]{1,4})?\s*期.*$/u, " ")
    .replace(/\s*第\s*[一二三四五六七八九十两\d]{1,4}(?:\s*[-~至到－—]\s*[一二三四五六七八九十两\d]{1,4})?\s*(?:集|话|話).*$/u, " ")
    .replace(/\s+第\s*[一二三四五六七八九十两\d]{1,3}\s*(?:季|部)(?=\s|$)/u, " ")
    .replace(/\s+(?:日记|日記)\s+.+(?:日记|日記)\s*$/u, " ")
    .replace(CJK_VARIETY_SECTION_LABEL_RE, " ")
    .replace(/\s+[一二三四五六七八九十两\d]{1,4}\s*(?:集|期)全(?:\s+.*)?$/u, " ")
    .replace(/\s+全\s*[一二三四五六七八九十两\d]{1,3}\s*(?:集|话|話).*$/u, " ")
    .replace(/(?:19|20)\d{2}\s*年?/g, " ")
    .replace(/^\s+/, "")
    .replace(METADATA_TITLE_PREFIX_RE, " ")
    .replace(/\b(?:4k|2160p|1080p|1080i|720p|576p|540p|480p)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function metadataInfoField(value: string) {
  const cleaned = cleanHumanTitleCandidate(value);
  if (!cleaned || CATEGORY_SEGMENT_RE.test(cleaned) || METADATA_INFO_FIELD_RE.test(cleaned)) return true;
  if (/^(?:(?:剧集|劇集)\s*)?(?:分集|合集)$/u.test(cleaned)) return true;
  if (/^\d{1,3}\s*(?:帧|幀|fps)$/iu.test(cleaned)) return true;
  if (/^(?:去头尾广告纯享版|去頭尾廣告純享版|非伪去头|非偽去頭|\*?发现未去净的广告.*奖励魔力|\*?發現未去淨的廣告.*獎勵魔力)/u.test(cleaned)) return true;
  if (/^(?:类型|類型|类别|類別)[:：]/u.test(cleaned)) return true;
  if (/^(?:英|中|简|簡|繁|日|韩|韓|粤|粵|国|國|台)$/u.test(cleaned)) return true;
  if (/^(?:[国國粤粵英日韩韓中简簡繁多]+(?:语|語|字|字幕|双语|雙語)|(?:简繁|簡繁|中字|英字|内封|內封|内嵌|內嵌).*)$/iu.test(cleaned)) return true;
  if (PROVIDER_ALIAS_NOISE_RE.test(cleaned) && !/[A-Za-z]{2,}/.test(cleaned.replace(/sub/ig, ""))) return true;
  if (/^(?:19|20)\d{2}\s*年?\s*(?:\d+\s*月)?\s*(?:新番)?$/i.test(cleaned)) return true;
  if (/^(?:第\s*)?[一二三四五六七八九十两\d]{1,3}\s*(?:季|部)$/u.test(cleaned)) return true;
  if (/^(?:s|season\s*)\d{1,2}$/i.test(cleaned)) return true;
  if (/^\d{1,2}(?:st|nd|rd|th)\s+season$/i.test(cleaned)) return true;
  if (/^(?:第\s*)?[一二三四五六七八九十两\d]{1,4}\s*(?:[-~至到－—]\s*[一二三四五六七八九十两\d]{1,4})?\s*(?:集|话|話)$/u.test(cleaned)) return true;
  if (/^(?:第\s*)?[一二三四五六七八九十两\d]{1,3}\s*(?:季|部)\s+第\s*[一二三四五六七八九十两\d]{1,4}(?:\s*[-~至到－—]\s*[一二三四五六七八九十两\d]{1,4})?\s*(?:集|话|話)$/u.test(cleaned)) return true;
  if (/^全\s*[一二三四五六七八九十两\d]{1,3}\s*(?:集|话|話)$/u.test(cleaned)) return true;
  return false;
}

function splitTitlePart(value: string) {
  return value
    .split(/[|/]+|[—]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitScriptRuns(value: string) {
  const tokens = cleanCandidateTitle(value)
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length <= 1) return tokens;

  const groups: string[] = [];
  let current: string[] = [];
  let currentNative = hasNativeScript(tokens[0]);
  for (const token of tokens) {
    const tokenNative = hasNativeScript(token);
    if (current.length > 0 && tokenNative !== currentNative) {
      groups.push(current.join(" "));
      current = [];
    }
    current.push(token);
    currentNative = tokenNative;
  }
  if (current.length > 0) groups.push(current.join(" "));
  return groups.length > 1 ? groups : [];
}

function chooseCanonicalTitle(rawName: string, candidates: string[]) {
  if (AKA_RE.test(rawName)) {
    const akaParts = rawName.split(AKA_RE);
    const beforeAlias = akaParts[0] ?? "";
    const afterAlias = akaParts.slice(1).join(" ");
    const beforeCandidates = validTitleCandidatesFromValue(beforeAlias);
    const afterCandidates = validTitleCandidatesFromValue(afterAlias);

    if (hasNativeScript(beforeAlias)) {
      const alias = afterCandidates.find((candidate) => hasLatin(candidate) && !hasNativeScript(candidate));
      if (alias) return alias;
    }

    return beforeCandidates.find((candidate) => hasLatin(candidate) && !hasNativeScript(candidate)) ??
      afterCandidates.find((candidate) => hasLatin(candidate) && !hasNativeScript(candidate)) ??
      candidates[0];
  }

  const latinCandidates = candidates.filter((candidate) => hasLatin(candidate) && !hasNativeScript(candidate));
  return preferredLatinTitle(latinCandidates) ?? candidates[0];
}

function validTitleCandidatesFromValue(value: string) {
  const candidates: string[] = [];
  for (const candidate of titleCandidatesFromValue(value)) {
    const cleaned = cleanCandidateTitle(candidate);
    if (!isTitleCandidate(cleaned)) continue;
    if (!candidates.some((existing) => sameCandidate(existing, cleaned))) {
      candidates.push(cleaned);
    }
  }
  return candidates;
}

function weakCanonicalTitle(value: string) {
  const normalized = value.trim();
  if (/^(?:19|20)\d{2}$/.test(normalized)) return true;
  if (/\sby\s.+\b(?:h\s?264|x264|xvid|dvd5|dvd9|web|mkv|avi|remux)\b/i.test(normalized)) return true;
  return false;
}

function cleanCandidateTitle(value: string): string {
  return cleanTitle(value
    .replace(/[()[\]{}【】（）「」『』]/g, " ")
    .replace(METADATA_TITLE_PREFIX_RE, " ")
    .replace(CHINESE_SEASON_RE, " ")
    .replace(CHINESE_EPISODE_RE, " ")
    .replace(/\s+(?:台|港|陆|陸|日|韩|韓|美|英)\s*$/u, " ")
    .replace(/\b\d{1,3}\s*[-~－—]\s*\d{1,3}\b/g, " ")
    .replace(/\s*-\s*$/, " ")
    .replace(/^[\s.。·:：,，;；/\\|—-]+|[\s.。·:：,，;；/\\|—-]+$/gu, " "));
}

function cleanHumanTitleCandidate(value: string): string {
  return value
    .replace(/[()[\]{}【】（）「」『』]/g, " ")
    .replace(/\s+(?:台|港|陆|陸|日|韩|韓|美|英)\s*$/u, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.。·:：,，;；/\\|—-]+|[\s.。·:：,，;；/\\|—-]+$/gu, "")
    .trim();
}

function isTitleCandidate(value: string) {
  if (!value || SIZE_SEGMENT_RE.test(value) || CATEGORY_SEGMENT_RE.test(value)) return false;
  if (metadataInfoField(value)) return false;
  if (AKA_RE.test(value)) return false;
  if (!hasLatin(value) && !hasNativeScript(value) && !/\d/.test(value)) return false;
  if (YEAR_RE.test(value) && value.replace(YEAR_RE, "").trim().length === 0) return false;
  if (QUALITY_RE.test(value) || SOURCE_RE.test(value) || CODEC_RE.test(value) || AUDIO_RE.test(value)) return false;
  return true;
}

function preferredLatinTitle(candidates: string[]) {
  return candidates.find((candidate) => candidate.split(/\s+/).filter(Boolean).length >= 2) ?? candidates[0];
}

function sameCandidate(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

function equivalentTitleKey(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function hasNativeScript(value: string) {
  return NATIVE_SCRIPT_RE.test(value);
}

function hasLatin(value: string) {
  return LATIN_RE.test(value);
}

function findChineseSeason(value: string, source: "normalized" | "raw") {
  const match = value.match(CHINESE_SEASON_RE);
  if (!match || match.index == null) return undefined;
  const season = parseChineseNumber(match[1] ?? match[2]);
  return season == null ? undefined : { index: match.index, season, source };
}

function findChineseEpisode(value: string, source: "normalized" | "raw") {
  const match = value.match(CHINESE_EPISODE_RE);
  if (!match || match.index == null) return undefined;
  const episode = parseChineseNumber(match[1]);
  const episodeEnd = parseChineseNumber(match[2]);
  return episode == null ? undefined : { index: match.index, episode, episodeEnd, source };
}

function parseChineseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  };
  if (value === "十") return 10;
  const tenIndex = value.indexOf("十");
  if (tenIndex >= 0) {
    const before = value.slice(0, tenIndex);
    const after = value.slice(tenIndex + 1);
    const tens = before ? digits[before] : 1;
    const ones = after ? digits[after] : 0;
    if (tens == null || ones == null) return undefined;
    return tens * 10 + ones;
  }
  return digits[value];
}

function inferMetadataYear(rawTitle: string, currentYear = new Date().getFullYear()): number | undefined {
  const candidates = titleSegments(rawTitle)
    .flatMap((segment) => metadataYearsFromSegment(segment, currentYear));
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : undefined;
}

function metadataYearsFromSegment(segment: string, currentYear: number) {
  const years = [...segment.matchAll(/(?:^|[^\d])((?:19|20)\d{2})(?=$|[^\d])/g)]
    .map((match) => Number(match[1]))
    .filter((year) => year >= MIN_METADATA_YEAR && year <= currentYear);
  if (years.length === 0) return [];
  const trimmed = segment.trim();
  const metadataContext = /^(?:19|20)\d{2}$/.test(trimmed) ||
    /(?:^|\|)\s*(?:19|20)\d{2}\s*(?:\||$)/.test(trimmed) ||
    /(?:year|年份|年代|上映|首播|播出)[:：]?\s*(?:19|20)\d{2}/i.test(trimmed) ||
    /\((?:19|20)\d{2}\)/.test(trimmed);
  return metadataContext ? years : [];
}

function cleanTitle(value: string): string {
  return value
    .replace(/[.\-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\bDeluxe\s+Limited\s+Edition\b/gi, "Deluxe Edition")
    .replace(/\bLimited\s+(Edition)\b(?=\s+(?:CD|FLAC)\b)/gi, "$1")
    .replace(/\b(PROPER|REPACK|EXTENDED|UNCUT)\b/gi, "")
    .replace(/\bLIMITED\b(?!\s+(?:Edition|Express)\b)/gi, "")
    .trim();
}

function firstDefinedIndex(...indexes: Array<number | undefined>): number {
  return indexes
    .filter((index): index is number => typeof index === "number" && index >= 0)
    .sort((a, b) => a - b)[0] ?? -1;
}

function scoreConfidence(input: {
  title: string;
  mediaType: string;
  hasYear: boolean;
  hasQuality: boolean;
  hasTv: boolean;
}): number {
  let score = input.title ? 0.35 : 0;
  if (input.mediaType !== "UNKNOWN") score += 0.25;
  if (input.hasYear) score += 0.15;
  if (input.hasQuality) score += 0.1;
  if (input.hasTv) score += 0.15;
  return Math.min(1, Number(score.toFixed(2)));
}
