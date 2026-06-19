import type { ParsedRelease } from "./types.js";

const QUALITY_RE = /\b(2160p|4k|1080p|1080i|720p|576p|540p|480p)\b/i;
const ONLY_QUALITY_RE = /^(?:2160p|4k|1080p|1080i|720p|576p|540p|480p)$/i;
const DIMENSION_RE = /\b(3840[ ._-]?x[ ._-]?2160|1920[ ._-]?x[ ._-]?1080|1280[ ._-]?x[ ._-]?720|720[ ._-]?x[ ._-]?480)\b/i;
const SOURCE_RE = /\b(WEB[- .]?DL|WEBRip|Blu[- .]?Ray|BDRip|HDTV|DVDRip|Remux|UHD|HDRip|WEB)\b/i;
const PTP_METADATA_SOURCE_RE = /\b(DVD)\b/i;
const CODEC_RE = /\b(x265|x264|h[ .]?265|h[ .]?264|hevc|avc|av1|mpeg[ .]?2)\b/i;
const AUDIO_RE = /\b(DDP?[ .]?(?:5\.1|7\.1|2\.0)?|DD\+[ .]?(?:5\.1|7\.1|2\.0)?|DTS[- .]?HD|TrueHD|Atmos|AAC[ .]?(?:2\.0|5\.1)?|FLAC|OPUS[ .]?(?:2\.0|5\.1)?|LPCM[ .]?(?:2\.0|5\.1)?)\b/i;
const YEAR_RE = /\b(19\d{2}|20\d{2})\b/;
const YEAR_GLOBAL_RE = /\b(19\d{2}|20\d{2})\b/g;
const TV_RE = /\bS(\d{1,4})[ ._-]?E(\d{1,3})(?:(?:[- ._]+E?|E)(\d{1,3}))*\b/i;
const LONG_TV_RE = /\bS(\d{1,2})[ ._-]?E(\d{4})(?:(?:[-_]+E?|[ .]+E|E)(\d{4}))?\b/i;
const EPISODE_ONLY_RE = /\bEP?(\d{1,3})(?:[- ._]?EP?(\d{1,3}))?\b/i;
const LONG_EPISODE_ONLY_RE = /\bEP?(\d{4})(?:[- ._]?EP?(\d{4}))?\b/i;
const SEASON_PACK_RE = /\bS(\d{1,2})(?:\b|[- .])(?!E\d)/i;
const SEASON_WORD_PACK_RE = /\bSeason[ ._-]?(\d{1,2})\b/i;
const COMPLETE_WORD_RE = /\bCompletet?\b/i;
const AKA_RE = /\b(?:AKA|ALIAS)\b/i;
const PTP_DISPLAY_WITH_CREATOR_RE = /^\s*(.+?)\s*[\[(]((?:19|20)\d{2})[\])]\s+by\b/i;
const PTP_DISPLAY_WITH_FORMAT_RE = /^\s*(.+?)\s*[\[(]((?:19|20)\d{2})[\])]\s+-\s+(?=[^\[\]\r\n]{1,120}\s\/)/i;
const SIZE_SEGMENT_RE = /^\d+(?:\.\d+)?\s*(?:gib|gb|mib|mb|tib|tb)$/i;
const SIZE_ALIAS_RE = /^\d+(?:\s+\d{1,2})?\s*(?:gib|gb|mib|mb|tib|tb|g|m)$/i;
const CATEGORY_SEGMENT_RE = /^(?:(?:movies?|movie|tv(?:\s*(?:series|shows?))?|series|animations?|animation|anime|sports|documentaries?|documentary|hd|sd|uhd)|(?:电影|剧集|电视剧|纪录片|动漫|动画|音乐|综艺|连载|完结|完结撒花))(?:\s+(?:(?:movies?|movie|tv(?:\s*(?:series|shows?))?|series|animations?|animation|anime|sports|documentaries?|documentary|hd|sd|uhd)|(?:电影|剧集|电视剧|纪录片|动漫|动画|音乐|综艺|连载|完结|完结撒花)))*$/i;
const MIXED_CATEGORY_SEGMENT_RE = /^(?:(?:documentaries?|documentary)\s*(?:纪录片|紀錄片)|(?:tv\s*shows?|tv\s*series|series)\s*(?:综艺|綜藝|剧集|劇集)|(?:movies?|movie)\s*(?:电影|電影)|(?:animations?|animation|anime)\s*(?:动漫|動漫|动画|動畫))$/iu;
const UNSUPPORTED_BARE_MEDIA_CATEGORY_SEGMENT_RE = /^(?:music(?:s)?(?:\s+(?:videos?|mv|lossless))?(?:\s*\([^)]*\))?(?:\s*\/\s*音乐\s*mv)?|sports?(?:\s*\/?\s*体育)?(?:\s+\d{3,4}[pi])?|体育(?:\s*\([^)]*\))?(?:\s*\/\s*sports?)?(?:\s+\d{3,4}[pi])?|音乐\s*(?:cd|mv|短片)?(?:\s*\([^)]*\))?)$/iu;
const UNSUPPORTED_MEDIA_CATEGORY_SEGMENT_RE = /^(?:music(?:s)?(?:\s+(?:videos?|mv|lossless))?(?:\s*\([^)]*\))?(?:\s*\/\s*音乐\s*mv)?|sports?(?:\s*\/?\s*体育)?(?:\s+\d{3,4}[pi])?|体育(?:\s*\([^)]*\))?(?:\s*\/\s*sports?)?(?:\s+\d{3,4}[pi])?|音乐\s*(?:cd|mv|短片)?(?:\s*\([^)]*\))?|hq\s*audio(?:\s*\/?\s*(?:无损音乐|無損音樂|音乐|音樂))?|(?:(?:pc\s*)?games?|pcgame|游戏|遊戲|software|applications?|软件|軟件|应用软件|應用軟體|ebooks?|电子书|電子書|auibook|audiobooks?|有声书|有聲書|有声读物|有聲讀物)(?:\s*\([^)]*\))?|资料|資料|h-?comic|iv(?:\s*\/\s*video\s+collection)?|av(?:\([^)]*\))?(?:\s*\/\s*(?:hd|sd|blu[- .]?ray)(?:\s+(?:un)?censored)?)?|(?:hd|sd|blu[- .]?ray)\s+(?:un)?censored)$/iu;
const TECHNICAL_MEDIA_WRAPPER_RE = /^(?:(?:4k|8k|2160p|1080p|720p|480p)\s*)?(?:电影|電影|movie|movies|电视剧|電視劇|剧集|劇集|tv\s*series|series)(?:\s*(?:4k|8k|2160p|1080p|720p|480p))?$/iu;
const LANGUAGE_METADATA_SEGMENT_RE = /^(?:英语|英語|日语|日語|国语|國語|粤语|粵語|韩语|韓語|汉语普通话|普通话|多语|多語|中字|简中|繁中|简繁|簡繁)$/iu;
const EXTRA_INFO_RE = /类型|主演|类别|字幕|国语|中字|导演|演员|简繁|第\d|全\d|日语|英语|粤语|内封|内嵌|\|/i;
const METADATA_INFO_FIELD_RE = /^(?:类型|类别|字幕|导演|主演|演员|语言|音频|视频|格式|地区|年份|年代|上映|首播|播出|国语|中字|简繁|简中|繁中|日语|英语|粤语|汉语普通话|网络收费短剧|4k|1080p|1080i|720p|2160p|uhd|hdr)$/i;
const METADATA_STANDALONE_LABEL_RE = /^(?:移动视频|移動視頻|大陆|大陸|中国大陆|中國大陸|内地|內地|香港|台湾|台灣|日本|韩国|韓國|(?:国创|國創|国漫|國漫|日漫|动漫|動漫|动画|動畫)?(?:连载|連載)|(?:bilibili|哔哩哔哩|嗶哩嗶哩)(?:大陆|大陸)?|(?:酷喵|芒果)tv|云视听极光|精简版|精簡版|首集保留片头片尾|首集保留片頭片尾)$/iu;
const METADATA_TITLE_PREFIX_RE = /^(?:(?:\d{1,2}|[一二三四五六七八九十两]{1,3})\s*月\s*新番|(?:陸劇|陆剧|港劇|港剧|港綜|港综|日劇|日剧|韓劇|韩剧|美劇|美剧|英劇|英剧|台劇|台剧|劇集|剧集|电视剧|電視劇|綜藝|综艺|動畫|动画|動漫|动漫|電影|电影|国漫|國漫|日漫))\s*[:：]?\s*/iu;
const PROVIDER_ALIAS_NOISE_RE = /字幕|sub|中字|简繁|簡繁|简体|簡體|繁体|繁體|双语|雙語|国语|國語|粤语|粵語|英语|英語|日语|日語|韩语|韓語|内封|內封|内嵌|內嵌|多国|多國|类别|類別|类型|類型|导演|導演|主演|演员|演員|频道|頻道|高码率|高碼率|码率|碼率|杜比|dolby\s*vision|hdr10|hdr|sdr|菁彩\s*hdr|源码|源碼|小组录制|小組錄製|出品|评论|評論|音轨|音軌|音频|音頻|花絮|特典|幕后|幕後|原盘|原盤|美版|港版|台版|日版|英版|加长版|加長版|完整版|导演剪辑|導演剪輯|官方|纪念版|紀念版|菜单|菜單|按钮|按鈕|原生|新增|shout\s*factory|生肉|自录|自錄|压缩包|壓縮包|破解|自动发种|自動發種|人工编辑|人工編輯/iu;
const PROVIDER_ALIAS_CJK_CATEGORY_PREFIX_RE = /^(?:动漫|動漫|動畫|动画|游戏|遊戲|電影|电影|电视剧|電視劇|剧集|劇集|纪录片|紀錄片|港综|港綜|(?:海外)?综艺|(?:海外)?綜藝)(?:\s|$)/iu;
const PROVIDER_ALIAS_LATIN_CATEGORY_PREFIX_RE = /^(?:movie|movies|documentary|documentaries|series|tv(?:\s+series)?|pc)\b/iu;
const PROVIDER_ALIAS_REGION_LABEL_RE = /^(?:大陆|大陸|内地|內地|中国大陆|中國大陸|华语|華語|香港|台湾|台灣|美国|美國|英国|英國|日本|韩国|韓國|印度|瑞典|西班牙|意大利|義大利|奥地利|奧地利|墨西哥|法国|法國|德国|德國|加拿大|澳大利亚|澳大利亞|北美|欧洲|歐洲|欧美|歐美|亚洲|亞洲|东亚|東亞|南亚|南亞|东南亚|東南亞|中东|中東|南美|拉美|非洲|大洋洲|海外)$/u;
const PROVIDER_ALIAS_GENRE_LABEL_RE = /^(?:动作|動作|剧情|劇情|犯罪|喜剧|喜劇|爱情|愛情|动画|動畫|动漫|動漫|纪录片|紀錄片|短片|音乐|音樂|家庭|奇幻|恐怖|冒险|冒險|悬疑|懸疑|科幻|历史|歷史|战争|戰爭|古装|古裝|传记|傳記|惊悚|驚悚|情色|同性|儿童|兒童|歌舞|武侠|武俠|西部|灾难|災難|真人秀|脱口秀|脫口秀|运动|運動|体育|體育)$/u;
const SOURCE_ATTRIBUTION_RE = /(?:转自|轉自|转载自|轉載自)/u;
const RELEASE_GROUP_ATTRIBUTION_RE = /(?:发布组|發布組|压制组|壓制組|压制部|壓制部)/u;
const LEGAL_DISCLAIMER_ALIAS_RE = /(?:如有侵[权權]|联系删除|聯繫刪除|刪除|删除)/u;
const BROADCAST_CAPTURE_PREFIX_RE = /^(?:ZJTV[- .]?4K|GDTV[- .]?4K|JSWS[- .]?4K|HNTV[- .]?4K|SDTV[- .]?4K|BRTV[- .]?WS4K|CCTV[- .]?3|CWJDTV|(?:\d{8}[ ._-]+)?Mnet[ ._-]+Japan)[ ._-]+/i;
const CCTV_4K_BROADCAST_PREFIX_RE = /^CCTV[- .]?4K[ ._-]+/i;
const TV_SHOWS_BROADCAST_CAPTURE_PREFIX_RE = /^(?:CCTV[- .]?\d+|HunanTV|DragonTV|PhoenixTV|JSTV|ZJTV|SZTV|SHANGHAI[- .]?4K)[ ._-]+/i;
const BROADCASTER_METADATA_PREFIX_RE = /^(?:(?:中央电视台|央视|北京卫视|浙江卫视|广东卫视|湖南卫视|江苏卫视|山东卫视)[^ ]*(?:频道)?|中国广电重温经典频道)\s+/u;
const BROADCASTER_METADATA_FIELD_RE = /^(?:翡翠台|明珠台|中视经典HD|中視經典HD|华视HD|華視HD|台视HD|台視HD|民视HD|民視HD|公视HD|公視HD|TVB(?:\s+(?:Jade|Pearl|Plus))?|ViuTV|Jade|Pearl|CTV|CTS|TTV|FTV|PTS)$/iu;
const BROADCASTER_METADATA_FIELD_PREFIX_RE = /^(?:翡翠台|明珠台|中视经典HD|中視經典HD|华视HD|華視HD|台视HD|台視HD|民视HD|民視HD|公视HD|公視HD|TVB(?:\s+(?:Jade|Pearl|Plus))?|ViuTV|Jade|Pearl|CTV|CTS|TTV|FTV|PTS)\s+/iu;
const REGIONAL_TV_BROADCAST_PREFIX_RE = /^(TVB[ ._-]+(?:Jade|Pearl|Plus)|ViuTV|Jade|Pearl|CTV|CTS|TTV|FTV|PTS|BRTV|CCTV[- .]?\d+)[ ._-]+/iu;
const ORIGINAL_RECORDING_METADATA_FIELD_RE = /^(?:(?:台剧|台劇|港剧|港劇)?(?:原创录制|原創錄製)(?:第\d+部)?)(?:\s+(?:翡翠台|明珠台|中视经典HD|中視經典HD|华视HD|華視HD|台视HD|台視HD|民视HD|民視HD|公视HD|公視HD))?$/u;
const CJK_VARIETY_SECTION_LABEL_RE = /\s+(?:(?:正片|纯享|純享|加更|日记|日記|私藏日记|私藏日記|萌娃当家|副本存档中|同学录|同學錄|直播回看|少年的挑战|少年的挑戰|抢先逛|搶先逛|整活局)(?:版)?\s*)+$/u;
const CJK_VARIETY_SECTION_SUBTITLE_RE = /\s+(?:正片|纯享|純享|同学录|同學錄|直播回看|少年的挑战|少年的挑戰|抢先逛|搶先逛|整活局)(?:版)?(?:\s+.*)?$/u;
const CJK_ANNUAL_METADATA_RE = /[\p{Script=Han}].*(?:19|20)\d{2}\s*年度/u;
const CJK_PRESENTATION_SUFFIX_RE = /\s+(?:(?:edr\s*)?高帧率(?:\s*\d{1,3}\s*fps)?|菁彩影像|hdr\s*vivid|杜比音效)(?:\s+.*)?$/iu;
const TV_CATEGORY_WRAPPER_FIELD_RE = /^(?:tv\s*(?:series|shows?)|series)\s*[\/|]\s*(?:剧集|劇集|综艺|綜藝)\s*(?:分集|合集)?$/iu;
const STACKED_TV_DRAMA_CATEGORY_RE = /^\s*\[(?:剧集|劇集|电视剧|電視劇)\]\s*\[(?:日剧|日劇|韩剧|韓劇|美剧|美劇|英剧|英劇|港剧|港劇|台剧|台劇|陆剧|陸劇|大陆|大陸|内地|內地)\]/u;
const SHORT_DRAMA_METADATA_PREFIX_RE = /^(?:短剧|短劇)\s*[:：]\s*/u;
const MIN_METADATA_YEAR = 1900;
const NATIVE_SCRIPT_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const NATIVE_EM_DASH_TITLE_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]\s*[—－–]{2,}\s*[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const NATIVE_YEARLY_TITLE_RE = /(?:^|\s)([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}][\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}A-Za-z0-9·・:：!！?？&+.'\-\s]{0,24}?(?:19|20)\d{2})(?=\s*(?:第\s*[一二三四五六七八九十两\d]{1,4}(?:\s*[-~至到－—]\s*[一二三四五六七八九十两\d]{1,4})?\s*(?:季|部|期|集|话|話)|[一二三四五六七八九十两\d]{1,4}(?:\s*[-~至到－—]\s*[一二三四五六七八九十两\d]{1,4})?\s*(?:季|期|集|话|話)|$))/u;
const LATIN_RE = /[A-Za-z]/;
const SLASH_NUMERIC_TITLE_RE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
const CHINESE_SEASON_RE = /(?:第\s*([一二三四五六七八九十两\d]{1,3})\s*(?:季|部)|([一二三四五六七八九十两\d]{1,3})\s*季)/u;
const CHINESE_SEASON_ONLY_RE = /(?:^|[\s[({【「『|｜:：,，;；/])(?:第\s*([一二三四五六七八九十两\d]{1,3})\s*季|([一二三四五六七八九十两\d]{1,3})\s*季)/u;
const CHINESE_EPISODE_RE = /第\s*([一二三四五六七八九十两\d]{1,4})(?:\s*[-~至到－—]\s*([一二三四五六七八九十两\d]{1,4}))?\s*(?:集|话|話)/u;
const WHOLE_SERIES_EPISODE_RE = /全\s*(?!0*1\s*(?:集|话|話)|一\s*(?:集|话|話))[一二三四五六七八九十两\d]{1,3}\s*(?:集|话|話)/u;
const CJK_TRAILING_WHOLE_SERIES_RE = /(?:(?:[2-9]\d{0,2})|(?:十|[二三四五六七八九两][一二三四五六七八九十]?))\s*(?:集|话|話)\s*全/u;
const CJK_COMPLETE_SERIES_LABEL_RE = /全集/u;
const CJK_COMPLETE_EPISODE_RANGE_RE = /\d{1,4}\s*[-~至到－—]\s*\d{1,4}\s*(?:集|话|話)\s*(?:全|完|完结|完結)/u;
const ANIMATION_TV_EPISODE_RANGE_RE = /\bTV\b[^\[\]]{0,40}\d{1,4}\s*[-~－—]\s*\d{1,4}/iu;
const ANIMATION_TV_LAYOUT_MARKER_RE = /^(?:tv|连载|連載|完结|完結|完结撒花)$/iu;
const ANIMATION_TV_EPISODE_BRACKET_RE = /^(\d{1,4})(?:\s*\(\s*\d{1,4}\s*\))?$/u;
const ANIMATION_TV_EPISODE_RANGE_BRACKET_RE = /^(\d{1,4})\s*[-~－—]\s*(\d{1,4})(?:\s*(?:fin(?:\+sp)?|合集|完结|完結))?$/iu;
const NESTED_SEASON_METADATA_ALIAS_RE = /\[([^\[\]\r\n|/]{2,80}?)\s+\[(?:第\s*[一二三四五六七八九十两\d]{1,3}\s*(?:季|部)(?:\s+第\s*[一二三四五六七八九十两\d]{1,4}\s*(?:集|话|話|期))?|Season\s*\d{1,2}|S\d{1,2}(?:E\d{1,4})?)[^\]]*\]\s*\/\s*([^|\[\]]{2,120}?)(?=\s*(?:\||\]))/giu;
const REGIONAL_VARIANT_CODE_TOKENS = new Set(["AU", "AUS", "US", "USA", "UK", "GB", "NZ", "CA", "NL", "PT", "BE"]);
const REGIONAL_VARIANT_NAME_TOKENS = new Set(["australia", "canada", "netherlands", "portugal", "belgium"]);
const ROMAN_SEASON_NUMBERS: Record<string, number> = {
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8,
  IX: 9,
  X: 10,
  XI: 11,
  XII: 12
};

export function parseReleaseTitle(rawTitle: string): ParsedRelease {
  const cleanedRawTitle = stripMediaExtension(rawTitle);
  const releaseInput = stripBroadcastCapturePrefix(stripMediaExtension(releaseParseInput(rawTitle)), rawTitle);
  const regionalTvSeriesEvidence = hasRegionalTvWholeSeriesEvidence(releaseInput, rawTitle);
  const parseInput = stripRegionalTvBroadcastPrefix(releaseInput, rawTitle);
  const strippedRegionalTvBroadcastPrefix = parseInput !== releaseInput;
  const stackedAnimationTvEpisode = findStackedAnimationTvBracketEpisode(rawTitle);
  const unsupportedMediaCategory = hasUnsupportedLeadingMediaCategory(rawTitle);
  const movieMediaCategory = hasMovieLeadingMediaCategory(rawTitle);
  const movieCategorySeasonMetadataEvidence = hasMovieCategorySeasonMetadataEvidence(rawTitle);
  const categorySeriesEvidence =
    regionalTvSeriesEvidence ||
    hasStackedTvDramaCategoryEvidence(rawTitle) ||
    (hasStrongTvLeadingMediaCategory(rawTitle) && hasTvCategoryWholeSeriesMarker(rawTitle)) ||
    hasTvShowsLeadingMediaCategory(rawTitle) ||
    (hasDocumentaryLeadingMediaCategory(rawTitle) && WHOLE_SERIES_EPISODE_RE.test(rawTitle)) ||
    hasUncategorizedWholeSeriesEvidence(rawTitle) ||
    hasAnimationSeriesEvidence(rawTitle) ||
    movieCategorySeasonMetadataEvidence;
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
  const chineseSeason = normalizedChineseSeason ?? (movieCategorySeasonMetadataEvidence
    ? findChineseSeasonOnly(rawTitle, "raw")
    : movieMediaCategory
      ? undefined
      : findChineseSeason(rawTitle, "raw"));
  const rawChineseEpisode = tv || episodeOnly || seasonPack || chineseSeason
    ? findChineseEpisode(rawTitle, "raw")
    : undefined;
  const chineseEpisode = parseInputHasBrackets
    ? rawChineseEpisode
    : findChineseEpisode(normalized, "normalized") ?? rawChineseEpisode;
  const tvMarkerIndex = firstDefinedIndex(
    tv?.index,
    episodeOnly?.index,
    longEpisodeOnly?.index,
    seasonPack?.index,
    normalizedChineseSeason?.index,
    chineseEpisode?.source === "normalized" ? chineseEpisode.index : undefined
  );
  const hasTvContext = Boolean(tv || episodeOnly || longEpisodeOnly || seasonPack || chineseSeason || chineseEpisode || stackedAnimationTvEpisode || categorySeriesEvidence);
  const yearMatch = findReleaseYearMatch(normalized, {
    tvMarkerIndex,
    rawTitle,
    hasTvContext
  });
  const ptpDisplayYear = findPtpDisplayMetadataYear(rawTitle, parseInput);
  const technicalNormalized = ptpDisplayYear
    ? technicalSearchInputAfterYear(normalized, yearMatch)
    : normalized;
  const ptpTechnicalNormalized = ptpDisplayYear
    ? ptpDisplayTechnicalSearchInput(rawTitle)
    : undefined;
  const primaryTechnicalInput = ptpDisplayYear && !yearMatch && !releaseGroup
    ? ptpTechnicalNormalized ?? technicalNormalized
    : technicalNormalized;
  const secondaryTechnicalInput = primaryTechnicalInput === technicalNormalized
    ? ptpTechnicalNormalized
    : technicalNormalized;
  const qualityMatch = primaryTechnicalInput.match(QUALITY_RE) ?? secondaryTechnicalInput?.match(QUALITY_RE) ?? rawNormalized.match(QUALITY_RE);
  const dimensionMatch = primaryTechnicalInput.match(DIMENSION_RE) ?? secondaryTechnicalInput?.match(DIMENSION_RE) ?? rawNormalized.match(DIMENSION_RE);
  const quality = normalizeQuality(qualityMatch?.[1]) ?? normalizeDimensionQuality(dimensionMatch?.[1]);
  const resolution = normalizeResolution(quality) ?? normalizeDimensionResolution(dimensionMatch?.[1]);
  const primarySourceMatch = primaryTechnicalInput.match(SOURCE_RE);
  const ptpMetadataSourceMatch = ptpTechnicalNormalized?.match(PTP_METADATA_SOURCE_RE);
  const sourceMatch = ptpMetadataSourceMatch && normalizeSource(primarySourceMatch?.[1]) === "WEB"
    ? ptpMetadataSourceMatch
    : primarySourceMatch ?? ptpMetadataSourceMatch ?? secondaryTechnicalInput?.match(SOURCE_RE) ?? rawNormalized.match(SOURCE_RE);
  const source = normalizeSource(sourceMatch?.[1]);
  const codec = normalizeCodec((primaryTechnicalInput.match(CODEC_RE) ?? secondaryTechnicalInput?.match(CODEC_RE) ?? rawNormalized.match(CODEC_RE))?.[1]);
  const audio = normalizeAudio((primaryTechnicalInput.match(AUDIO_RE) ?? secondaryTechnicalInput?.match(AUDIO_RE) ?? rawNormalized.match(AUDIO_RE))?.[1]);
  const numericTitleYear = findNumericTitleYear(normalized);
  const releaseYear = numericTitleYear?.year ?? (yearMatch ? Number(yearMatch[1]) : undefined);
  const year = preferredReleaseYear(releaseYear, ptpDisplayYear) ?? inferMetadataYear(rawTitle);
  const completeIndex = categorySeriesEvidence ? normalized.search(COMPLETE_WORD_RE) : -1;
  const hasTvEvidence = hasTvContext;

  const titleStop = firstDefinedIndex(
    tv?.index,
    episodeOnly?.index,
    longEpisodeOnly?.index,
    seasonPack?.index,
    chineseSeason?.source === "normalized" ? chineseSeason.index : undefined,
    chineseEpisode?.source === "normalized" ? chineseEpisode.index : undefined,
    completeIndex,
    numericTitleYear?.yearIndex ?? yearMatch?.index,
    normalized.search(QUALITY_RE),
    normalized.search(DIMENSION_RE),
    normalized.search(SOURCE_RE)
  );

  const rawName = titleStop >= 0 ? normalized.slice(0, titleStop) : normalized;
  const fallbackTitle = cleanTitle(rawName) || cleanTitle(normalized);
  const romanSeasonSuffix = inferRegionalRomanSeasonSuffix({
    fallbackTitle,
    hasEpisodeOnlyMarker: Boolean(episodeOnly || longEpisodeOnly || chineseEpisode),
    hasExplicitSeasonMarker: Boolean(tv || seasonPack || chineseSeason),
    strippedRegionalTvBroadcastPrefix
  });
  const mediaType = unsupportedMediaCategory
    ? "UNKNOWN"
    : hasTvEvidence
    ? "TV_SERIES"
    : year
      ? "MOVIE"
      : "UNKNOWN";
  const season = tv ? Number(tv[1]) : seasonPack ? Number(seasonPack[1]) : chineseSeason?.season ?? romanSeasonSuffix?.season ?? (episodeOnly || longEpisodeOnly || chineseEpisode ? 1 : undefined);
  const titleInfo = deriveTitleInfo({
    rawTitle,
    rawName: romanSeasonSuffix?.title ?? rawName,
    fallbackTitle: romanSeasonSuffix?.title ?? fallbackTitle,
    season: mediaType === "TV_SERIES" ? season : undefined
  });
  const title = titleInfo.title;
  const episode = tv ? Number(tv[2]) : episodeOnly ? Number(episodeOnly[1]) : longEpisodeOnly ? Number(longEpisodeOnly[1]) : chineseEpisode?.episode ?? stackedAnimationTvEpisode?.episode;
  const episodeEnd = tv?.[3] ? Number(tv[3]) : episodeOnly?.[2] ? Number(episodeOnly[2]) : longEpisodeOnly?.[2] ? Number(longEpisodeOnly[2]) : chineseEpisode?.episodeEnd ?? stackedAnimationTvEpisode?.episodeEnd;
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

  const structuredMetadataInput = structuredBracketMetadataParseInput(categoryStrippedTitle);
  if (structuredMetadataInput) return structuredMetadataInput;

  return categoryStrippedTitle
    .replace(/\[[^\]]*(?:ourbits|torrent|rss)[^\]]*\]/gi, " ")
    .replace(/\([^\)]*(?:ourbits|torrent|rss)[^\)]*\)/gi, " ");
}

function structuredBracketMetadataParseInput(rawTitle: string) {
  const metadata = leadingBracketMetadata(rawTitle);
  if (!metadata || !supportedMediaCategorySegment(metadata.segments[0])) return undefined;

  if (metadata.rest) {
    return metadata.segments.every((segment) => leadingMetadataWrapperSegment(segment))
      ? metadata.rest
      : undefined;
  }

  const yearIndex = metadata.segments.findIndex((segment) => /^(?:19|20)\d{2}$/.test(segment.trim()));
  if (yearIndex < 0) return undefined;
  const title = metadata.segments
    .slice(yearIndex + 1)
    .map((segment) => structuredBracketTitleSegment(segment))
    .find((segment): segment is string => Boolean(segment));
  return title ? `${title} ${metadata.segments[yearIndex]}` : undefined;
}

function leadingBracketMetadata(rawTitle: string) {
  let rest = rawTitle.trimStart();
  const segments: string[] = [];
  while (rest.startsWith("[")) {
    const match = rest.match(/^\[([^\]]*)\]/u);
    if (!match) break;
    segments.push(match[1]?.trim() ?? "");
    rest = rest.slice(match[0].length).trimStart();
  }
  return segments.length > 0 ? { segments, rest: rest.trim() } : undefined;
}

function leadingMetadataWrapperSegment(segment: string) {
  return supportedMediaCategorySegment(segment) || TECHNICAL_MEDIA_WRAPPER_RE.test(segment.trim());
}

function supportedMediaCategorySegment(segment: string | undefined) {
  if (!segment) return false;
  return movieMediaCategorySegment(segment) ||
    animationMediaCategorySegment(segment) ||
    strongTvMediaCategorySegment(segment) ||
    documentaryMediaCategorySegment(segment);
}

function structuredBracketTitleSegment(segment: string) {
  const cleaned = cleanStructuredBracketTitleSegment(segment);
  if (!cleaned) return undefined;
  if (categorySegment(cleaned) || unsupportedMediaCategorySegment(cleaned)) return undefined;
  if (metadataInfoField(cleaned) || standaloneProviderRegionAlias(cleaned)) return undefined;
  if (SIZE_SEGMENT_RE.test(cleaned) || LANGUAGE_METADATA_SEGMENT_RE.test(cleaned)) return undefined;
  return isTitleCandidate(cleaned) ? cleaned : undefined;
}

function cleanStructuredBracketTitleSegment(segment: string) {
  return cleanHumanTitleCandidate(segment
    .replace(/【[^】]*(?:全集|字幕|内嵌|內嵌|季|集|版)[^】]*】/gu, " ")
    .replace(/\([^)]*(?:字幕|内嵌|內嵌|蓝光|藍光|原版)[^)]*\)/giu, " "))
    .replace(/\s+/g, " ")
    .trim();
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

function categorySegment(segment: string) {
  return CATEGORY_SEGMENT_RE.test(segment) || MIXED_CATEGORY_SEGMENT_RE.test(segment);
}

function documentaryMediaCategorySegment(segment: string) {
  const trimmed = segment.trim();
  return /^(?:纪录片|紀錄片|doc|documentaries?|documentary)(?:$|\b|[\s(/]|\p{Script=Han})/iu.test(trimmed);
}

function normalizeReleaseText(input: string): string {
  return input
    .replace(/_/g, ".")
    .replace(/\s+/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

function findNumericTitleYear(normalized: string) {
  const match = normalized.match(/^([12]\d{3})\.+((?:19|20)\d{2})(?=\.)/);
  if (match?.[1] && match[2]) {
    const yearIndex = match[0].indexOf(match[2], match[1].length);
    if (yearIndex < 0) return undefined;
    const afterYear = normalized.slice(yearIndex + match[2].length);
    if (!technicalTokenFollowsYear(afterYear)) {
      return undefined;
    }
    return {
      year: Number(match[2]),
      yearIndex
    };
  }

  return findLeadingYearLikeTitleReleaseYear(normalized);
}

function findLeadingYearLikeTitleReleaseYear(normalized: string) {
  const firstYear = normalized.match(/^([12]\d{3})(?=\.)/);
  if (!firstYear?.[1]) return undefined;

  const technicalStop = firstDefinedIndex(
    normalized.search(QUALITY_RE),
    normalized.search(DIMENSION_RE),
    normalized.search(SOURCE_RE),
    normalized.search(CODEC_RE)
  );
  if (technicalStop < 0) return undefined;

  const releaseYearMatch = [...normalized.matchAll(YEAR_GLOBAL_RE)].find((match) =>
    match.index != null &&
    match.index > firstYear[1]!.length &&
    match.index < technicalStop
  );
  if (!releaseYearMatch?.[1] || releaseYearMatch.index == null) return undefined;

  const titleCandidate = cleanTitle(normalized.slice(0, releaseYearMatch.index));
  const afterLeadingYear = titleCandidate.replace(/^([12]\d{3})\s+/, "");
  if (!afterLeadingYear || !hasLatin(afterLeadingYear) || !isTitleCandidate(titleCandidate)) {
    return undefined;
  }

  const afterYear = normalized.slice(releaseYearMatch.index + releaseYearMatch[1].length);
  if (!technicalTokenFollowsYear(afterYear)) {
    return undefined;
  }

  return {
    year: Number(releaseYearMatch[1]),
    yearIndex: releaseYearMatch.index
  };
}

function technicalTokenFollowsYear(value: string) {
  const next = value.replace(/^[\s._-]+/u, "");
  return technicalPatternStarts(QUALITY_RE, next) ||
    technicalPatternStarts(DIMENSION_RE, next) ||
    technicalPatternStarts(SOURCE_RE, next) ||
    technicalPatternStarts(CODEC_RE, next);
}

function technicalPatternStarts(pattern: RegExp, value: string) {
  return value.match(pattern)?.index === 0;
}

function technicalSearchInputAfterYear(normalized: string, yearMatch: RegExpMatchArray | undefined) {
  if (!yearMatch?.[1] || yearMatch.index == null) return normalized;
  const afterYear = normalized.slice(yearMatch.index + yearMatch[1].length);
  return afterYear || normalized;
}

function ptpDisplayTechnicalSearchInput(rawTitle: string) {
  const metadata = ptpDisplayMetadata(rawTitle);
  const technicalText = metadata?.technicalText?.replace(/\s*\[[\s\S]*$/u, " ");
  return technicalText
    ? normalizeReleaseText(technicalText)
    : undefined;
}

function findReleaseYearMatch(
  normalized: string,
  context: {
    tvMarkerIndex: number;
    rawTitle: string;
    hasTvContext: boolean;
  }
) {
  const matches = [...normalized.matchAll(YEAR_GLOBAL_RE)];
  const first = matches[0];
  if (!first || first.index == null) return undefined;

  const firstYear = Number(first[1]);
  const technicalStop = firstDefinedIndex(
    normalized.search(QUALITY_RE),
    normalized.search(DIMENSION_RE),
    normalized.search(SOURCE_RE),
    normalized.search(CODEC_RE)
  );

  const titleYearReleaseMatch = context.hasTvContext
    ? findTvTitleYearAliasReleaseMatch(normalized, matches, technicalStop, context.rawTitle)
    : undefined;
  if (titleYearReleaseMatch) return titleYearReleaseMatch;

  const akaTitleYearReleaseMatch = context.hasTvContext
    ? undefined
    : findAkaTitleYearReleaseMatch(normalized, matches, technicalStop);
  if (akaTitleYearReleaseMatch) return akaTitleYearReleaseMatch;

  if (context.tvMarkerIndex < 0 || first.index > context.tvMarkerIndex) return first;

  return matches.find((match) => {
    if (match.index == null || match.index <= context.tvMarkerIndex) return false;
    if (technicalStop >= 0 && match.index >= technicalStop) return false;
    const laterYear = Number(match[1]);
    return firstYear - laterYear > 1;
  }) ?? first;
}

function findAkaTitleYearReleaseMatch(
  normalized: string,
  matches: RegExpMatchArray[],
  technicalStop: number
) {
  const akaMatch = normalized.match(AKA_RE);
  if (!akaMatch?.[0] || akaMatch.index == null) return undefined;

  const titleYearMatch = matches.find((match) =>
    match.index != null &&
    match.index < akaMatch.index! &&
    match[1] != null
  );
  if (!titleYearMatch?.[1]) return undefined;

  const titleYear = Number(titleYearMatch[1]);
  return matches.slice().reverse().find((match) => {
    if (!match[1] || match.index == null) return false;
    if (match.index <= akaMatch.index!) return false;
    if (technicalStop >= 0 && match.index >= technicalStop) return false;
    return Number(match[1]) !== titleYear;
  });
}

function findTvTitleYearAliasReleaseMatch(
  normalized: string,
  matches: RegExpMatchArray[],
  technicalStop: number,
  rawTitle: string
) {
  const first = matches[0];
  if (!first?.[1] || first.index == null) return undefined;

  const titlePrefix = cleanTitle(normalized.slice(0, first.index));
  if (!oneWordLatinTitlePrefix(titlePrefix)) return undefined;

  const titleYear = Number(first[1]);
  const releaseYearMatch = matches.slice(1).find((match) => {
    if (!match[1] || match.index == null) return false;
    if (technicalStop >= 0 && match.index >= technicalStop) return false;
    return Number(match[1]) - titleYear > 1;
  });
  if (!releaseYearMatch) return undefined;

  return hasTitleYearAliasEvidence(rawTitle, titlePrefix, first[1])
    ? releaseYearMatch
    : undefined;
}

function oneWordLatinTitlePrefix(value: string) {
  const words = value.split(/\s+/).filter(Boolean);
  return words.length === 1 && hasLatin(value) && !hasNativeScript(value);
}

function hasTitleYearAliasEvidence(rawTitle: string, titlePrefix: string, titleYear: string) {
  const expectedLatinKey = equivalentTitleKey(`${titlePrefix} ${titleYear}`);
  for (const candidate of metadataAliasCandidates(rawTitle)) {
    const cleaned = cleanCandidateTitle(candidate);
    if (!isTitleCandidate(cleaned)) continue;
    if (equivalentTitleKey(cleaned) === expectedLatinKey) return true;
    if (hasNativeScript(cleaned) && cleaned.includes(titleYear)) {
      const withoutYear = cleanCandidateTitle(cleaned.replace(titleYear, " "));
      if (withoutYear && hasNativeScript(withoutYear) && !metadataInfoField(withoutYear)) {
        return true;
      }
    }
  }
  return false;
}

function inferRegionalRomanSeasonSuffix(input: {
  fallbackTitle: string;
  hasEpisodeOnlyMarker: boolean;
  hasExplicitSeasonMarker: boolean;
  strippedRegionalTvBroadcastPrefix: boolean;
}) {
  if (!input.strippedRegionalTvBroadcastPrefix || !input.hasEpisodeOnlyMarker || input.hasExplicitSeasonMarker) {
    return undefined;
  }

  const match = input.fallbackTitle.match(/\s+(II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)$/i);
  const roman = match?.[1]?.toUpperCase();
  const season = roman ? ROMAN_SEASON_NUMBERS[roman] : undefined;
  if (!match || !season || match.index == null) return undefined;

  const title = input.fallbackTitle.slice(0, match.index).trim();
  if (!isTitleCandidate(title)) return undefined;
  return { title, season };
}

function metadataAliasCandidates(rawTitle: string) {
  const candidates: string[] = [];
  const allowDatedBroadcastAlias = hasTvShowsLeadingMediaCategory(rawTitle);
  for (const segment of titleSegments(rawTitle)) {
    if (
      scoreReleaseLikeSegment(segment) >= 3 &&
      !releaseLikeMetadataTitleSegment(segment) &&
      !(allowDatedBroadcastAlias && broadcasterDatedNativeMetadataTitleSegment(segment))
    ) continue;
    candidates.push(...metadataTitleCandidatesFromSegment(segment));
    candidates.push(...titleCandidatesFromValue(segment));
  }
  return candidates;
}

function stripBroadcastCapturePrefix(input: string, rawTitle: string): string {
  const cctv4kStripped = input.replace(CCTV_4K_BROADCAST_PREFIX_RE, "");
  if (
    cctv4kStripped !== input &&
    hasStrongTvLeadingMediaCategory(rawTitle) &&
    hasExplicitTvContextInInput(cctv4kStripped)
  ) {
    return cctv4kStripped;
  }

  const stripped = input.replace(BROADCAST_CAPTURE_PREFIX_RE, "");
  if (stripped !== input) return stripped;
  return hasTvShowsLeadingMediaCategory(rawTitle)
    ? input.replace(TV_SHOWS_BROADCAST_CAPTURE_PREFIX_RE, "")
    : input;
}

function hasExplicitTvContextInInput(input: string) {
  const normalized = normalizeReleaseText(input);
  return TV_RE.test(normalized) ||
    LONG_TV_RE.test(normalized) ||
    EPISODE_ONLY_RE.test(normalized) ||
    LONG_EPISODE_ONLY_RE.test(normalized) ||
    SEASON_PACK_RE.test(normalized) ||
    SEASON_WORD_PACK_RE.test(normalized) ||
    COMPLETE_WORD_RE.test(normalized) ||
    CJK_TRAILING_WHOLE_SERIES_RE.test(input) ||
    CJK_COMPLETE_SERIES_LABEL_RE.test(input);
}

function stripRegionalTvBroadcastPrefix(input: string, rawTitle: string): string {
  const match = input.match(REGIONAL_TV_BROADCAST_PREFIX_RE);
  if (!match?.[0]) return input;

  const rest = input.slice(match[0].length).trimStart();
  if (!rest || !hasTvContextAfterBroadcastPrefix(rest, rawTitle)) return input;
  if (!hasStandaloneHkChannelPrefixContext(match[1], rest, rawTitle)) return input;

  const normalizedRest = normalizeReleaseText(rest);
  const titleStop = firstDefinedIndex(
    normalizedRest.search(TV_RE),
    normalizedRest.search(LONG_TV_RE),
    normalizedRest.search(EPISODE_ONLY_RE),
    normalizedRest.search(LONG_EPISODE_ONLY_RE),
    normalizedRest.search(SEASON_PACK_RE),
    normalizedRest.search(SEASON_WORD_PACK_RE),
    normalizedRest.search(COMPLETE_WORD_RE),
    normalizedRest.search(YEAR_RE),
    normalizedRest.search(QUALITY_RE),
    normalizedRest.search(DIMENSION_RE),
    normalizedRest.search(SOURCE_RE)
  );
  const titlePart = titleStop >= 0 ? normalizedRest.slice(0, titleStop) : normalizedRest;
  const strippedTitle = cleanTitle(titlePart);
  if (!strippedTitle || !LATIN_RE.test(strippedTitle)) return input;

  return rest;
}

function hasTvContextAfterBroadcastPrefix(rest: string, rawTitle: string) {
  const normalizedRest = normalizeReleaseText(rest);
  return hasStrongTvLeadingMediaCategory(rawTitle) ||
    TV_RE.test(normalizedRest) ||
    LONG_TV_RE.test(normalizedRest) ||
    EPISODE_ONLY_RE.test(normalizedRest) ||
    LONG_EPISODE_ONLY_RE.test(normalizedRest) ||
    SEASON_PACK_RE.test(normalizedRest) ||
    SEASON_WORD_PACK_RE.test(normalizedRest) ||
    COMPLETE_WORD_RE.test(normalizedRest);
}

function hasRegionalTvWholeSeriesEvidence(input: string, rawTitle: string) {
  if (!REGIONAL_TV_BROADCAST_PREFIX_RE.test(input)) return false;
  return (COMPLETE_WORD_RE.test(input) || COMPLETE_WORD_RE.test(normalizeReleaseText(input))) &&
    hasWholeSeriesTvMarker(rawTitle);
}

function hasStandaloneHkChannelPrefixContext(prefix: string | undefined, rest: string, rawTitle: string) {
  const normalizedPrefix = prefix?.replace(/[._-]+/g, " ").trim().toLowerCase();
  if (normalizedPrefix !== "jade" && normalizedPrefix !== "pearl") return true;
  if (!/\bhdtv\b/i.test(rest)) return false;
  if (normalizedPrefix === "jade") {
    return /(?:翡翠台|港劇|港剧|陸劇|陆剧|CHDHKTV|HDHTV|CNHK|TVB)/iu.test(rawTitle);
  }
  return /(?:明珠台|TVB\s*Pearl)/iu.test(rawTitle);
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
  if (!segment || SIZE_SEGMENT_RE.test(segment) || categorySegment(segment) || unsupportedMediaCategorySegment(segment)) return 0;
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
  if (!segment || SIZE_SEGMENT_RE.test(segment) || categorySegment(segment) || unsupportedMediaCategorySegment(segment)) return false;
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
  return Boolean(leadingWord && unsupportedBareMediaCategorySegment(leadingWord));
}

function hasMovieLeadingMediaCategory(rawTitle: string) {
  const bracketed = rawTitle.trim().match(/^\[([^\]]+)\]/)?.[1];
  return Boolean(bracketed && movieMediaCategorySegment(bracketed));
}

function hasMovieCategorySeasonMetadataEvidence(rawTitle: string) {
  if (!hasMovieLeadingMediaCategory(rawTitle)) return false;
  return titleSegments(rawTitle).slice(1).some((segment) => {
    if (!CHINESE_SEASON_ONLY_RE.test(segment)) return false;
    return CHINESE_EPISODE_RE.test(segment) ||
      /[|｜]/u.test(segment) ||
      /(?:类型|類型|类别|類別)[:：]/u.test(segment);
  });
}

function hasStrongTvLeadingMediaCategory(rawTitle: string) {
  const bracketed = rawTitle.trim().match(/^\[([^\]]+)\]/)?.[1];
  return Boolean(bracketed && strongTvMediaCategorySegment(bracketed));
}

function hasTvShowsLeadingMediaCategory(rawTitle: string) {
  const bracketed = rawTitle.trim().match(/^\[([^\]]+)\]/)?.[1]?.trim();
  return /^(?:tv\s*shows?|tvshow)(?:\b|[\s(/]|\p{Script=Han})/iu.test(bracketed ?? "");
}

function hasDocumentaryLeadingMediaCategory(rawTitle: string) {
  const bracketed = rawTitle.trim().match(/^\[([^\]]+)\]/)?.[1];
  return Boolean(bracketed && documentaryMediaCategorySegment(bracketed));
}

function hasStackedTvDramaCategoryEvidence(rawTitle: string) {
  return STACKED_TV_DRAMA_CATEGORY_RE.test(rawTitle);
}

function hasUncategorizedWholeSeriesEvidence(rawTitle: string) {
  return WHOLE_SERIES_EPISODE_RE.test(rawTitle) &&
    !hasMovieLeadingMediaCategory(rawTitle) &&
    !hasUnsupportedLeadingMediaCategory(rawTitle) &&
    !hasAudiobookLeadingMediaCategory(rawTitle);
}

function hasAnimationSeriesEvidence(rawTitle: string) {
  return hasAnimationLeadingMediaCategory(rawTitle) &&
    !hasMangaBracketCategory(rawTitle) &&
    (
      hasAnimationTvLayoutBracketEvidence(rawTitle) ||
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

function hasAudiobookLeadingMediaCategory(rawTitle: string) {
  const bracketed = rawTitle.trim().match(/^\[([^\]]+)\]/)?.[1];
  return /^(?:有声书|有聲書|有声读物|有聲讀物|audiobooks?)(?:$|\b|[\s(/]|\p{Script=Han})/iu.test(bracketed ?? "");
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
    /^(?:tv\s*(?:series|shows?)|series)(?:\b|[\s(/]|\p{Script=Han})/iu.test(trimmed);
}

function hasExplicitTvBracketSegment(rawTitle: string) {
  return titleSegments(rawTitle).some((segment) =>
    /^(?:tv|テレビ|テレビアニメ)$/iu.test(segment.trim())
  );
}

function hasAnimationTvLayoutBracketEvidence(rawTitle: string) {
  const segments = titleSegments(rawTitle);
  return Boolean(
    segments[0] &&
    animationMediaCategorySegment(segments[0]) &&
    animationTvLayoutMarkerSegment(segments[1])
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

function hasTvCategoryWholeSeriesMarker(rawTitle: string) {
  return hasWholeSeriesTvMarker(rawTitle) ||
    CJK_TRAILING_WHOLE_SERIES_RE.test(rawTitle) ||
    CJK_COMPLETE_SERIES_LABEL_RE.test(rawTitle);
}

function unsupportedMediaCategorySegment(segment: string) {
  return UNSUPPORTED_MEDIA_CATEGORY_SEGMENT_RE.test(segment.trim());
}

function unsupportedBareMediaCategorySegment(segment: string) {
  return UNSUPPORTED_BARE_MEDIA_CATEGORY_SEGMENT_RE.test(segment.trim());
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
  season?: number;
}) {
  const candidates: string[] = [];
  const explicitAliasCandidates: string[] = [];
  const releaseNameCandidates: string[] = [];
  const humanCandidates: string[] = [];
  const allowDatedBroadcastAlias = hasTvShowsLeadingMediaCategory(input.rawTitle);
  const stackedAnimationTvInfo = stackedAnimationTvBracketTitleInfo(input.rawTitle);
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
  const addExplicitAliasCandidate = (candidate: string | undefined, options: { preservePunctuation?: boolean } = {}) => {
    const cleaned = addCandidate(candidate, options);
    if (cleaned && !explicitAliasCandidates.some((existing) => sameCandidate(existing, cleaned))) {
      explicitAliasCandidates.push(cleaned);
    }
  };

  const releaseTitleCandidates = stackedAnimationTvInfo?.candidates ?? titleCandidatesFromValue(input.rawName);
  for (const candidate of releaseTitleCandidates) {
    const cleaned = addCandidate(candidate, stackedAnimationTvInfo ? { preservePunctuation: true } : {});
    if (cleaned && !releaseNameCandidates.some((existing) => sameCandidate(existing, cleaned))) {
      releaseNameCandidates.push(cleaned);
    }
  }
  if (!stackedAnimationTvInfo) {
    for (const candidate of explicitAliasTitleCandidatesFromValue(input.rawName)) {
      addExplicitAliasCandidate(candidate);
    }
  }

  for (const segment of titleSegments(input.rawTitle)) {
    if (stackedAnimationTvInfo?.ignoredSegments.includes(segment)) continue;
    if (!hasNativeScript(segment) && !AKA_RE.test(segment) && !hasParenthesizedRegionalVariant(segment)) continue;
    const metadataCandidates = metadataTitleCandidatesFromSegment(segment, { season: input.season });
    const explicitSegmentAliasCandidates = explicitAliasTitleCandidatesFromValue(segment);
    for (const candidate of explicitSegmentAliasCandidates) {
      addExplicitAliasCandidate(candidate, { preservePunctuation: true });
    }
    if (
      scoreReleaseLikeSegment(segment) >= 3 &&
      segment !== input.rawName &&
      !releaseLikeMetadataTitleSegment(segment) &&
      !cjkAnnualMetadataTitleSegment(segment) &&
      !(allowDatedBroadcastAlias && broadcasterDatedNativeMetadataTitleSegment(segment))
    ) continue;
    for (const candidate of metadataCandidates) {
      addCandidate(candidate, { preservePunctuation: true });
    }
  }

  for (const candidate of humanMetadataTitleCandidates(input.rawTitle)) {
    for (const titleCandidate of explicitAliasTitleCandidatesFromValue(candidate)) {
      addExplicitAliasCandidate(titleCandidate, { preservePunctuation: true });
    }
    for (const titleCandidate of titleCandidatesFromValue(candidate)) {
      const cleaned = addCandidate(titleCandidate, { preservePunctuation: true });
      if (cleaned) humanCandidates.push(cleaned);
    }
  }

  for (const candidate of nestedSeasonMetadataTitleCandidates(input.rawTitle)) {
    for (const titleCandidate of titleCandidatesFromValue(candidate)) {
      addCandidate(titleCandidate, { preservePunctuation: true });
    }
  }

  if (!stackedAnimationTvInfo) {
    addCandidate(input.fallbackTitle);
  }

  const fallbackCandidates = validTitleCandidatesFromValue(input.fallbackTitle);
  const baseCanonical = chooseCanonicalTitle(
    input.rawName,
    releaseNameCandidates.length > 0 ? releaseNameCandidates : fallbackCandidates
  ) || input.fallbackTitle;
  const ptpDisplayCanonical = ptpDisplayTitleOverride(input.rawTitle, baseCanonical);
  const canonical = ptpDisplayCanonical ?? (weakCanonicalTitle(baseCanonical)
    ? chooseCanonicalTitle(input.rawName, humanCandidates) ?? humanCandidates[0] ?? baseCanonical
    : humanCandidates.find((candidate) => equivalentTitleKey(candidate) === equivalentTitleKey(baseCanonical)) ?? baseCanonical);
  const searchTitles = providerSearchTitles(candidates, canonical, explicitAliasCandidates);
  const nativeCandidate = searchTitles?.find((candidate) => hasNativeScript(candidate));
  return {
    title: canonical,
    titleCandidates: candidates.length > 0 ? candidates : undefined,
    providerSearchTitles: searchTitles,
    primarySearchTitle: nativeCandidate && !sameCandidate(nativeCandidate, canonical)
      ? nativeCandidate
      : canonical
  };
}

function stackedAnimationTvBracketTitleInfo(rawTitle: string) {
  const segments = titleSegments(rawTitle);
  if (!segments[0] || !animationMediaCategorySegment(segments[0])) return undefined;
  if (!animationTvLayoutMarkerSegment(segments[1])) return undefined;

  const withGroup = stackedAnimationTvTitlePair(segments[3], segments[4]);
  if (withGroup.length > 0 && segments[2]) {
    return {
      candidates: withGroup,
      ignoredSegments: [segments[0], segments[1], segments[2]]
    };
  }

  const withoutGroup = stackedAnimationTvTitlePair(segments[2], segments[3]);
  if (withoutGroup.length === 0) return undefined;
  return {
    candidates: withoutGroup,
    ignoredSegments: [segments[0], segments[1]]
  };
}

function animationTvLayoutMarkerSegment(segment: string | undefined) {
  return ANIMATION_TV_LAYOUT_MARKER_RE.test(segment?.trim() ?? "");
}

function findStackedAnimationTvBracketEpisode(rawTitle: string) {
  const info = stackedAnimationTvBracketTitleInfo(rawTitle);
  if (!info) return undefined;

  const segments = titleSegments(rawTitle);
  const startIndex = info.ignoredSegments.length + 2;
  for (const segment of segments.slice(startIndex, startIndex + 4)) {
    const cleaned = segment.trim();
    const rangeMatch = cleaned.match(ANIMATION_TV_EPISODE_RANGE_BRACKET_RE);
    if (rangeMatch?.[1]) {
      return {
        episode: Number(rangeMatch[1]),
        episodeEnd: rangeMatch[2] ? Number(rangeMatch[2]) : undefined
      };
    }

    const episodeMatch = cleaned.match(ANIMATION_TV_EPISODE_BRACKET_RE);
    if (episodeMatch?.[1]) {
      return {
        episode: Number(episodeMatch[1]),
        episodeEnd: undefined
      };
    }
  }

  return undefined;
}

function stackedAnimationTvTitlePair(nativeSegment: string | undefined, latinSegment: string | undefined) {
  if (!stackedAnimationTvNativeTitleSegment(nativeSegment) || !stackedAnimationTvLatinTitleSegment(latinSegment)) {
    return [];
  }

  const nativeTitleSegment = nativeSegment ?? "";
  const latinTitleSegment = latinSegment ?? "";
  const candidates: string[] = [];
  for (const candidate of [
    ...titleCandidatesFromValue(nativeTitleSegment),
    ...titleCandidatesFromValue(latinTitleSegment)
  ]) {
    const cleaned = cleanHumanTitleCandidate(candidate);
    if (!isTitleCandidate(cleaned)) continue;
    if (!candidates.some((existing) => sameCandidate(existing, cleaned))) {
      candidates.push(cleaned);
    }
  }
  return candidates;
}

function stackedAnimationTvNativeTitleSegment(segment: string | undefined) {
  const cleaned = cleanHumanTitleCandidate(segment ?? "");
  return Boolean(cleaned) &&
    hasNativeScript(cleaned) &&
    !categorySegment(cleaned) &&
    !metadataInfoField(cleaned) &&
    !SIZE_SEGMENT_RE.test(cleaned) &&
    !unsupportedMediaCategorySegment(cleaned);
}

function stackedAnimationTvLatinTitleSegment(segment: string | undefined) {
  const cleaned = cleanHumanTitleCandidate(segment ?? "");
  return Boolean(cleaned) &&
    hasLatin(cleaned) &&
    !hasNativeScript(cleaned) &&
    !categorySegment(cleaned) &&
    !metadataInfoField(cleaned) &&
    !SIZE_SEGMENT_RE.test(cleaned) &&
    !QUALITY_RE.test(cleaned) &&
    !SOURCE_RE.test(cleaned) &&
    !CODEC_RE.test(cleaned) &&
    !AUDIO_RE.test(cleaned) &&
    !/^(?:tv|ova|ona|sp|disc|vol(?:ume)?)\b/iu.test(cleaned) &&
    isTitleCandidate(cleaned);
}

function providerSearchTitles(candidates: string[], canonical: string, explicitAliasCandidates: string[] = []) {
  const candidateAliases = candidates
    .filter((candidate) => providerSearchTitleCandidate(candidate, canonical, {
      allowSingleWordAlias: explicitAliasCandidates.some((alias) => sameCandidate(alias, candidate))
    }));
  const metadataAliasCount = candidateAliases.filter((candidate) => standaloneProviderMetadataAlias(candidate)).length;
  const hasNonMetadataAlias = candidateAliases.some((candidate) => !standaloneProviderMetadataAlias(candidate));
  const aliases = candidateAliases.filter((candidate) => {
    if (standaloneProviderRegionAlias(candidate)) return false;
    return !(standaloneProviderGenreAlias(candidate) && (metadataAliasCount > 1 || hasNonMetadataAlias));
  });
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

function providerSearchTitleCandidate(
  candidate: string,
  canonical: string,
  options: { allowSingleWordAlias?: boolean } = {}
) {
  if (sameCandidate(candidate, canonical)) return false;
  if (equivalentTitleKey(candidate) === equivalentTitleKey(canonical)) return false;
  if (!isTitleCandidate(candidate)) return false;
  if (standaloneCategoryAlias(candidate)) return false;
  if (seasonCourAlias(candidate)) return false;
  if (sourceAttributionAlias(candidate)) return false;
  if (legalDisclaimerAlias(candidate)) return false;
  if (SIZE_ALIAS_RE.test(candidate)) return false;
  if (categoryPrefixedProviderAlias(candidate)) return false;
  if (PROVIDER_ALIAS_NOISE_RE.test(candidate)) return false;
  if (/^\d{1,3}(?:\s*[/-]\s*\d{1,3})?$/.test(candidate)) return false;
  if (/\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:\s*[/-]\s*\d{1,2})?\b/i.test(candidate)) return false;
  if (!hasNativeScript(candidate)) {
    const words = candidate.split(/\s+/).filter(Boolean);
    if (words.length < 2 && !regionalBaseAlias(candidate, canonical) && !options.allowSingleWordAlias) return false;
  }
  return true;
}

function categoryPrefixedProviderAlias(candidate: string) {
  const cleaned = cleanHumanTitleCandidate(candidate);
  return PROVIDER_ALIAS_CJK_CATEGORY_PREFIX_RE.test(cleaned) ||
    PROVIDER_ALIAS_LATIN_CATEGORY_PREFIX_RE.test(cleaned);
}

function standaloneProviderMetadataAlias(candidate: string) {
  return standaloneProviderRegionAlias(candidate) || standaloneProviderGenreAlias(candidate);
}

function standaloneProviderRegionAlias(candidate: string) {
  return PROVIDER_ALIAS_REGION_LABEL_RE.test(cleanHumanTitleCandidate(candidate));
}

function standaloneProviderGenreAlias(candidate: string) {
  return PROVIDER_ALIAS_GENRE_LABEL_RE.test(cleanHumanTitleCandidate(candidate));
}

function standaloneCategoryAlias(candidate: string) {
  return /^(?:剧场|劇場|分集|合集|tv|ova|ona|sp|movie|(?:tv\s*)?shows?\s*(?:综艺|綜藝)?)$/iu.test(candidate.trim());
}

function seasonCourAlias(candidate: string) {
  return /第\s*\d{1,3}\s*クール/u.test(cleanHumanTitleCandidate(candidate));
}

function sourceAttributionAlias(candidate: string) {
  const cleaned = cleanHumanTitleCandidate(candidate);
  return sourceAttributionOnlyField(cleaned) || SOURCE_ATTRIBUTION_RE.test(cleaned);
}

function legalDisclaimerAlias(candidate: string) {
  return LEGAL_DISCLAIMER_ALIAS_RE.test(cleanHumanTitleCandidate(candidate));
}

function sourceAttributionOnlyField(value: string) {
  const cleaned = cleanHumanTitleCandidate(value);
  if (!cleaned) return false;
  if (releaseGroupAttributionOnlyField(cleaned)) return true;
  return /^(?:转自|轉自|转载自|轉載自)\S{1,40}$/u.test(cleaned);
}

function releaseGroupAttributionOnlyField(value: string) {
  const parts = cleanHumanTitleCandidate(value)
    .split(/[\/|｜]/u)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 &&
    parts.every((part) =>
      RELEASE_GROUP_ATTRIBUTION_RE.test(part) &&
      !hasLatin(part) &&
      Array.from(part).length <= 24
    );
}

function titleCandidatesFromValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return [];

  const candidates: string[] = [];
  const slashNumericTitle = trimmed.replace(/^[\s.。·:：,，;；/\\|—-]+|[\s.。·:：,，;；/\\|—-]+$/gu, "");
  if (SLASH_NUMERIC_TITLE_RE.test(slashNumericTitle)) {
    candidates.push(slashNumericTitle);
  }
  const nativeEmDashTitle = nativeEmDashTitleCandidate(trimmed);
  if (nativeEmDashTitle) {
    candidates.push(nativeEmDashTitle);
  }
  for (const aliasPart of trimmed.split(AKA_RE)) {
    candidates.push(...titleCandidatesFromAliasPart(aliasPart));
  }
  return candidates;
}

function explicitAliasTitleCandidatesFromValue(value: string) {
  const aliasParts = value.trim().split(AKA_RE).slice(1);
  return aliasParts.flatMap((aliasPart) => titleCandidatesFromAliasPart(aliasPart, {
    releasePrefixAlias: true
  }));
}

function titleCandidatesFromAliasPart(aliasPart: string, options: { releasePrefixAlias?: boolean } = {}) {
  const candidates: string[] = [];
  for (const part of splitTitlePart(aliasPart)) {
    if (options.releasePrefixAlias) {
      const releasePrefixAlias = releasePrefixAliasTitleCandidate(part);
      if (releasePrefixAlias) {
        candidates.push(releasePrefixAlias);
        continue;
      }
    }
    candidates.push(...nativeVariantWhitespaceTitleCandidates(part));
    for (const scriptPart of splitScriptRuns(part)) {
      candidates.push(scriptPart);
    }
    candidates.push(part);
  }
  return candidates;
}

function releasePrefixAliasTitleCandidate(value: string) {
  const normalized = normalizeReleaseText(value);
  const stop = firstDefinedIndex(
    normalized.search(TV_RE),
    normalized.search(LONG_TV_RE),
    normalized.search(SEASON_PACK_RE),
    normalized.search(SEASON_WORD_PACK_RE),
    normalized.search(YEAR_RE),
    normalized.search(QUALITY_RE),
    normalized.search(DIMENSION_RE),
    normalized.search(SOURCE_RE),
    normalized.search(CODEC_RE),
    normalized.search(AUDIO_RE)
  );
  if (stop <= 0) return undefined;

  const candidate = cleanCandidateTitle(normalized.slice(0, stop));
  if (!candidate || !isTitleCandidate(candidate)) return undefined;
  return candidate;
}

function nativeEmDashTitleCandidate(value: string) {
  if (!NATIVE_EM_DASH_TITLE_RE.test(value)) return undefined;
  const cleaned = cleanCandidateTitle(value);
  if (!NATIVE_EM_DASH_TITLE_RE.test(cleaned)) return undefined;
  if (hasLatin(cleaned) || Array.from(cleaned).length > 40) return undefined;
  const parts = cleaned
    .split(/\s*[—－–]{2,}\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return undefined;
  if (parts.some((part) => !hasNativeScript(part) || metadataInfoField(part))) {
    return undefined;
  }
  return cleaned;
}

function humanMetadataTitleCandidates(rawTitle: string) {
  const metadata = ptpDisplayMetadata(rawTitle);
  return metadata?.kind === "creator" ? [metadata.title] : [];
}

function nestedSeasonMetadataTitleCandidates(rawTitle: string) {
  const candidates: string[] = [];
  for (const nestedMatch of rawTitle.matchAll(NESTED_SEASON_METADATA_ALIAS_RE)) {
    if (nestedMatch[1]) candidates.push(nestedMatch[1]);
    if (nestedMatch[2]) candidates.push(nestedMatch[2]);
  }
  return candidates;
}

function findPtpDisplayMetadataYear(rawTitle: string, parseInput: string) {
  const metadata = ptpDisplayMetadata(rawTitle);
  if (!metadata) return undefined;
  const prefixHasYear = YEAR_RE.test(metadata.title);
  if (prefixHasYear && (metadata.kind === "format" || /\s\/\s/.test(metadata.title))) return undefined;
  const prefixCandidates = ptpDisplayTitleCandidates(metadata.title);
  const releaseTitleCandidates = releaseSegmentTitleCandidates(parseInput);
  return {
    year: metadata.year,
    prefixHasYear,
    titleCompatible: ptpDisplayTitleCompatible(prefixCandidates, releaseTitleCandidates),
    exactTitleMatch: ptpDisplayTitleExactMatch(prefixCandidates, releaseTitleCandidates),
    prefixTitleVariant: !AKA_RE.test(metadata.title) &&
      ptpDisplayPrefixTitleVariant(prefixCandidates, releaseTitleCandidates),
    preferForAliasMismatch: AKA_RE.test(metadata.title) &&
      releaseTitleCandidates.length > 0 &&
      prefixCandidates.length > 0 &&
      releaseTitleCandidates.every((candidate) =>
        !prefixCandidates.some((prefixCandidate) => compatibleTitleKey(prefixCandidate, candidate))
      )
  };
}

function ptpDisplayMetadata(rawTitle: string) {
  const creatorMatch = rawTitle.match(PTP_DISPLAY_WITH_CREATOR_RE);
  if (creatorMatch?.[1] && creatorMatch[2]) {
    return {
      title: creatorMatch[1],
      year: Number(creatorMatch[2]),
      technicalText: rawTitle.slice(creatorMatch[0].length),
      kind: "creator" as const
    };
  }

  const match = rawTitle.match(PTP_DISPLAY_WITH_FORMAT_RE);
  if (!match?.[1] || !match[2]) return undefined;
  return {
    title: match[1],
    year: Number(match[2]),
    technicalText: rawTitle.slice(match[0].length),
    kind: "format" as const
  };
}

function preferredReleaseYear(
  releaseYear: number | undefined,
  ptpDisplayYear: {
    year: number;
    prefixHasYear: boolean;
    titleCompatible: boolean;
    exactTitleMatch: boolean;
    prefixTitleVariant: boolean;
    preferForAliasMismatch: boolean;
  } | undefined
) {
  if (releaseYear == null) return ptpDisplayYear?.year;
  if (ptpDisplayYear == null) return releaseYear;
  const yearDelta = Math.abs(releaseYear - ptpDisplayYear.year);
  if (
    yearDelta <= 1 &&
    (
      ptpDisplayYear.prefixHasYear ||
      ptpDisplayYear.preferForAliasMismatch ||
      ptpDisplayYear.exactTitleMatch ||
      ptpDisplayYear.prefixTitleVariant
    )
  ) {
    return ptpDisplayYear.year;
  }
  if (!ptpDisplayYear.titleCompatible) return releaseYear;
  return yearDelta > 5 ? ptpDisplayYear.year : releaseYear;
}

function releaseSegmentTitleCandidates(parseInput: string) {
  const normalized = normalizeReleaseText(parseInput);
  const stop = firstDefinedIndex(
    normalized.search(YEAR_RE),
    normalized.search(QUALITY_RE),
    normalized.search(DIMENSION_RE),
    normalized.search(SOURCE_RE)
  );
  const titleSegment = stop >= 0 ? normalized.slice(0, stop) : normalized;
  return validTitleCandidatesFromValue(titleSegment);
}

function ptpDisplayTitleOverride(rawTitle: string, baseCanonical: string) {
  const metadata = ptpDisplayMetadata(rawTitle);
  if (!metadata || AKA_RE.test(metadata.title) || /\//u.test(metadata.title)) return undefined;
  if (metadata.kind === "format" && YEAR_RE.test(metadata.title)) return undefined;

  const displayCanonical = ptpDisplayTitleCandidate(metadata.title);
  if (!displayCanonical) return undefined;
  return ptpDisplayPrefixTitleVariant([displayCanonical], [baseCanonical])
    ? displayCanonical
    : undefined;
}

function ptpDisplayTitleCandidates(value: string) {
  const candidates: string[] = [];
  const displayCandidate = ptpDisplayTitleCandidate(value);
  if (displayCandidate) candidates.push(displayCandidate);
  for (const candidate of validTitleCandidatesFromValue(value)) {
    if (!candidates.some((existing) => sameCandidate(existing, candidate))) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

function ptpDisplayTitleCandidate(value: string) {
  const cleaned = cleanHumanTitleCandidate(value);
  if (!cleaned || SIZE_SEGMENT_RE.test(cleaned) || categorySegment(cleaned)) return undefined;
  if (metadataInfoField(cleaned)) return undefined;
  if (AKA_RE.test(cleaned)) return undefined;
  if (!hasLatin(cleaned) && !hasNativeScript(cleaned) && !/\d/.test(cleaned)) return undefined;
  if (YEAR_RE.test(cleaned) && cleaned.replace(YEAR_RE, "").trim().length === 0) return undefined;
  if (ONLY_QUALITY_RE.test(cleaned)) return undefined;
  if (cleaned.match(SOURCE_RE)?.[0]?.length === cleaned.length) return undefined;
  if (cleaned.match(CODEC_RE)?.[0]?.length === cleaned.length) return undefined;
  if (cleaned.match(AUDIO_RE)?.[0]?.length === cleaned.length) return undefined;
  return cleaned;
}

function ptpDisplayPrefixTitleVariant(prefixCandidates: string[], releaseTitleCandidates: string[]) {
  if (prefixCandidates.length === 0 || releaseTitleCandidates.length === 0) return false;
  return releaseTitleCandidates.some((candidate) =>
    prefixCandidates.some((prefixCandidate) => titleKeyPrefixVariant(prefixCandidate, candidate))
  );
}

function titleKeyPrefixVariant(left: string, right: string) {
  const leftKey = equivalentTitleKey(left);
  const rightKey = equivalentTitleKey(right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;
  if (leftKey.length < 5 || rightKey.length < 5) return false;
  return leftKey.startsWith(rightKey) || rightKey.startsWith(leftKey);
}

function ptpDisplayTitleCompatible(prefixCandidates: string[], releaseTitleCandidates: string[]) {
  if (prefixCandidates.length === 0 || releaseTitleCandidates.length === 0) return false;
  return releaseTitleCandidates.some((candidate) =>
    prefixCandidates.some((prefixCandidate) => compatibleTitleKey(prefixCandidate, candidate))
  );
}

function ptpDisplayTitleExactMatch(prefixCandidates: string[], releaseTitleCandidates: string[]) {
  if (prefixCandidates.length === 0 || releaseTitleCandidates.length === 0) return false;
  return releaseTitleCandidates.some((candidate) =>
    prefixCandidates.some((prefixCandidate) => equivalentTitleKey(prefixCandidate) === equivalentTitleKey(candidate))
  );
}

function compatibleTitleKey(left: string, right: string) {
  const leftKey = equivalentTitleKey(left);
  const rightKey = equivalentTitleKey(right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;
  if (leftKey.length < 5 || rightKey.length < 5) return false;
  if (leftKey.startsWith(rightKey) || rightKey.startsWith(leftKey)) return true;
  return Math.min(leftKey.length, rightKey.length) >= 8 &&
    levenshteinDistance(leftKey, rightKey) / Math.max(leftKey.length, rightKey.length) <= 0.12;
}

function levenshteinDistance(left: string, right: string) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      current[rightIndex + 1] = Math.min(
        previous[rightIndex + 1] + 1,
        current[rightIndex] + 1,
        previous[rightIndex] + (left[leftIndex] === right[rightIndex] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[right.length] ?? 0;
}

function metadataTitleCandidatesFromSegment(segment: string, options: { season?: number } = {}) {
  const cleanedSegment = cleanHumanTitleCandidate(segment);
  if (!cleanedSegment || categorySegment(cleanedSegment)) return [];

  const candidates: string[] = [];
  const regionalAlias = parenthesizedRegionalTitleAlias(segment);
  if (regionalAlias) {
    candidates.push(regionalAlias);
  }
  const fields = metadataTitleFields(cleanedSegment);
  for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
    const field = fields[fieldIndex];
    if (!field) continue;
    const yearlyTitle = nativeYearlyTitleCandidate(field);
    if (yearlyTitle) {
      candidates.push(yearlyTitle);
    }
    const seasonEpisodeBaseTitle = nativeSeasonEpisodeBaseTitleCandidate(field);
    if (seasonEpisodeBaseTitle) {
      candidates.push(seasonEpisodeBaseTitle);
    }
    const compactSeasonBaseTitle = nativeCompactSeasonSuffixBaseTitleCandidate(field);
    if (compactSeasonBaseTitle) {
      candidates.push(compactSeasonBaseTitle);
    }
    const parsedSeasonEpisodeBaseTitle = nativeParsedSeasonEpisodeBaseTitleCandidate(field, options.season);
    if (parsedSeasonEpisodeBaseTitle) {
      candidates.push(parsedSeasonEpisodeBaseTitle);
    }
    const parsedSeasonSeparatedEpisodeBaseTitle = nativeParsedSeasonSeparatedEpisodeBaseTitleCandidate(
      field,
      fields.slice(fieldIndex + 1),
      options.season
    );
    if (parsedSeasonSeparatedEpisodeBaseTitle) {
      candidates.push(parsedSeasonSeparatedEpisodeBaseTitle);
    }
    const titleField = cleanMetadataTitleField(field);
    if (!titleField || metadataInfoField(titleField)) {
      continue;
    }
    const releaseLikeCandidates = releaseLikeMetadataTitleSegment(segment)
      ? releaseLikeMetadataTitleCandidates(titleField)
      : [];
    if (releaseLikeCandidates.length > 0) {
      candidates.push(...releaseLikeCandidates);
      break;
    }
    for (const candidate of titleCandidatesFromValue(titleField)) {
      candidates.push(candidate);
    }
    break;
  }
  return candidates;
}

function nativeParsedSeasonSeparatedEpisodeBaseTitleCandidate(
  field: string,
  followingFields: string[],
  parsedSeason: number | undefined
) {
  const baseTitle = nativeParsedSeasonCompactBaseTitleCandidate(field, parsedSeason);
  if (!baseTitle) return undefined;
  const nextField = followingFields[0];
  if (nextField && episodeOnlyMetadataField(nextField)) return baseTitle;
  return followingFields.some((followingField) => seasonEpisodeMetadataField(followingField, parsedSeason))
    ? baseTitle
    : undefined;
}

function nativeParsedSeasonCompactBaseTitleCandidate(field: string, parsedSeason: number | undefined) {
  if (!parsedSeason || parsedSeason < 2 || parsedSeason > 99) return undefined;
  let cleaned = cleanHumanTitleCandidate(field);
  cleaned = cleaned.replace(/^(?:19|20)\d{2}\s*年?\s*/u, "");
  while (METADATA_TITLE_PREFIX_RE.test(cleaned)) {
    cleaned = cleaned.replace(METADATA_TITLE_PREFIX_RE, "");
  }
  cleaned = cleaned
    .replace(/【[^】]*】/gu, " ")
    .replace(TV_CATEGORY_WRAPPER_FIELD_RE, " ")
    .replace(SHORT_DRAMA_METADATA_PREFIX_RE, " ")
    .replace(BROADCASTER_METADATA_PREFIX_RE, " ")
    .replace(BROADCASTER_METADATA_FIELD_PREFIX_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  const match = cleaned.match(/^(.+?)(\d{1,2})$/u);
  const suffixSeason = match?.[2] ? Number(match[2]) : undefined;
  if (!suffixSeason || suffixSeason !== parsedSeason) return undefined;

  const candidate = cleanHumanTitleCandidate(match?.[1] ?? "");
  if (!candidate || !hasNativeScript(candidate)) return undefined;
  if (/[A-Za-z]/u.test(candidate)) return undefined;
  if (/[\/|]/u.test(candidate)) return undefined;
  if (/\s/u.test(candidate)) return undefined;
  if (metadataInfoField(candidate) || PROVIDER_ALIAS_NOISE_RE.test(candidate)) return undefined;
  return candidate;
}

function episodeOnlyMetadataField(field: string) {
  const cleaned = cleanHumanTitleCandidate(field).replace(/\s+/g, " ").trim();
  return /^第\s*[一二三四五六七八九十两\d]{1,4}(?:\s*[-~至到－—]\s*[一二三四五六七八九十两\d]{1,4})?\s*(?:集|话|話|期)$/u.test(cleaned) ||
    /^全\s*[一二三四五六七八九十两\d]{1,4}\s*(?:集|话|話)$/u.test(cleaned);
}

function seasonEpisodeMetadataField(field: string, parsedSeason: number | undefined) {
  if (!parsedSeason) return false;
  const cleaned = cleanHumanTitleCandidate(field).replace(/\s+/g, " ").trim();
  const match = cleaned.match(/^第\s*([一二三四五六七八九十两\d]{1,3})\s*(?:季|部)\s*第\s*[一二三四五六七八九十两\d]{1,4}(?:\s*[-~至到－—]\s*[一二三四五六七八九十两\d]{1,4})?\s*(?:集|话|話|期)$/u);
  return parseChineseNumber(match?.[1]) === parsedSeason;
}

function nativeYearlyTitleCandidate(field: string) {
  let cleaned = cleanHumanTitleCandidate(field);
  while (METADATA_TITLE_PREFIX_RE.test(cleaned)) {
    cleaned = cleaned.replace(METADATA_TITLE_PREFIX_RE, "");
  }
  cleaned = cleaned
    .replace(/【[^】]*】/gu, " ")
    .replace(TV_CATEGORY_WRAPPER_FIELD_RE, " ")
    .replace(SHORT_DRAMA_METADATA_PREFIX_RE, " ")
    .replace(BROADCASTER_METADATA_PREFIX_RE, " ")
    .replace(BROADCASTER_METADATA_FIELD_PREFIX_RE, " ")
    .replace(/\s+(?:19|20)\d{6}(?:\s*[-~至到－—]\s*(?:19|20)\d{6})?\b.*$/u, " ")
    .replace(/\s+/g, " ")
    .trim();
  const match = cleaned.match(NATIVE_YEARLY_TITLE_RE);
  const candidate = cleanHumanTitleCandidate(match?.[1] ?? "");
  if (!candidate || !hasNativeScript(candidate) || !YEAR_RE.test(candidate)) return undefined;
  if (metadataInfoField(candidate) || PROVIDER_ALIAS_NOISE_RE.test(candidate)) return undefined;
  return candidate;
}

function nativeSeasonEpisodeBaseTitleCandidate(field: string) {
  let cleaned = cleanHumanTitleCandidate(field);
  cleaned = cleaned.replace(/^(?:19|20)\d{2}\s*年?\s*/u, "");
  while (METADATA_TITLE_PREFIX_RE.test(cleaned)) {
    cleaned = cleaned.replace(METADATA_TITLE_PREFIX_RE, "");
  }
  cleaned = cleaned
    .replace(/【[^】]*】/gu, " ")
    .replace(TV_CATEGORY_WRAPPER_FIELD_RE, " ")
    .replace(SHORT_DRAMA_METADATA_PREFIX_RE, " ")
    .replace(BROADCASTER_METADATA_PREFIX_RE, " ")
    .replace(BROADCASTER_METADATA_FIELD_PREFIX_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  const match = cleaned.match(/^(.+?)\s+第\s*[一二三四五六七八九十两\d]{1,3}\s*季\s+.+?第\s*[一二三四五六七八九十两\d]{1,4}(?:\s*[-~至到－—]\s*[一二三四五六七八九十两\d]{1,4})?\s*期/u) ??
    cleaned.match(/^(.+?)\s+第\s*[一二三四五六七八九十两\d]{1,3}\s*季\s+[^|/]{1,40}[:：]/u);
  const candidate = cleanHumanTitleCandidate(match?.[1] ?? "");
  if (!candidate || !hasNativeScript(candidate)) return undefined;
  if (/[A-Za-z]/u.test(candidate)) return undefined;
  if (/[\/|]/u.test(candidate)) return undefined;
  if (/\s/u.test(candidate)) return undefined;
  if (metadataInfoField(candidate) || PROVIDER_ALIAS_NOISE_RE.test(candidate)) return undefined;
  return candidate;
}

function nativeCompactSeasonSuffixBaseTitleCandidate(field: string) {
  let cleaned = cleanHumanTitleCandidate(field);
  cleaned = cleaned.replace(/^(?:19|20)\d{2}\s*年?\s*/u, "");
  while (METADATA_TITLE_PREFIX_RE.test(cleaned)) {
    cleaned = cleaned.replace(METADATA_TITLE_PREFIX_RE, "");
  }
  cleaned = cleaned
    .replace(/【[^】]*】/gu, " ")
    .replace(TV_CATEGORY_WRAPPER_FIELD_RE, " ")
    .replace(SHORT_DRAMA_METADATA_PREFIX_RE, " ")
    .replace(BROADCASTER_METADATA_PREFIX_RE, " ")
    .replace(BROADCASTER_METADATA_FIELD_PREFIX_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  const match = cleaned.match(/^(.+?)(\d{1,2})\s+(?:第\s*([一二三四五六七八九十两\d]{1,3})\s*(?:季|部)|S0?(\d{1,2})\b|Season\s*(\d{1,2})\b)/iu);
  const suffixSeason = match?.[2] ? Number(match[2]) : undefined;
  const markerSeason = parseChineseNumber(match?.[3] ?? match?.[4] ?? match?.[5]);
  if (!suffixSeason || !markerSeason || suffixSeason !== markerSeason) return undefined;

  const candidate = cleanHumanTitleCandidate(match?.[1] ?? "");
  if (!candidate || !hasNativeScript(candidate)) return undefined;
  if (/[A-Za-z]/u.test(candidate)) return undefined;
  if (/[\/|]/u.test(candidate)) return undefined;
  if (/\s/u.test(candidate)) return undefined;
  if (metadataInfoField(candidate) || PROVIDER_ALIAS_NOISE_RE.test(candidate)) return undefined;
  return candidate;
}

function nativeParsedSeasonEpisodeBaseTitleCandidate(field: string, parsedSeason: number | undefined) {
  if (!parsedSeason || parsedSeason < 2 || parsedSeason > 99) return undefined;
  let cleaned = cleanHumanTitleCandidate(field);
  cleaned = cleaned.replace(/^(?:19|20)\d{2}\s*年?\s*/u, "");
  while (METADATA_TITLE_PREFIX_RE.test(cleaned)) {
    cleaned = cleaned.replace(METADATA_TITLE_PREFIX_RE, "");
  }
  cleaned = cleaned
    .replace(/【[^】]*】/gu, " ")
    .replace(TV_CATEGORY_WRAPPER_FIELD_RE, " ")
    .replace(SHORT_DRAMA_METADATA_PREFIX_RE, " ")
    .replace(BROADCASTER_METADATA_PREFIX_RE, " ")
    .replace(BROADCASTER_METADATA_FIELD_PREFIX_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  const match = cleaned.match(/^(.+?)(\d{1,2})\s+(?:第\s*[一二三四五六七八九十两\d]{1,4}(?:\s*[-~至到－—]\s*[一二三四五六七八九十两\d]{1,4})?\s*(?:集|话|話|期)|全\s*[一二三四五六七八九十两\d]{1,4}\s*(?:集|话|話))/u);
  const suffixSeason = match?.[2] ? Number(match[2]) : undefined;
  if (!suffixSeason || suffixSeason !== parsedSeason) return undefined;

  const candidate = cleanHumanTitleCandidate(match?.[1] ?? "");
  if (!candidate || !hasNativeScript(candidate)) return undefined;
  if (/[A-Za-z]/u.test(candidate)) return undefined;
  if (/[\/|]/u.test(candidate)) return undefined;
  if (/\s/u.test(candidate)) return undefined;
  if (metadataInfoField(candidate) || PROVIDER_ALIAS_NOISE_RE.test(candidate)) return undefined;
  return candidate;
}

function hasParenthesizedRegionalVariant(value: string) {
  return /\(([^)]{2,24})\)/u.test(value) &&
    [...value.matchAll(/\(([^)]{2,24})\)/gu)].some((match) => regionalVariantToken(match[1]));
}

function parenthesizedRegionalTitleAlias(value: string) {
  const match = value.trim().match(/^(.+?)\s*\(([^)]{2,24})\)\s*$/u);
  if (!match?.[1] || !regionalVariantToken(match[2])) return undefined;
  return cleanCandidateTitle(match[1]);
}

function regionalBaseAlias(candidate: string, canonical: string) {
  const canonicalWords = canonical.trim().split(/\s+/).filter(Boolean);
  if (canonicalWords.length < 2) return false;
  const suffix = canonicalWords[canonicalWords.length - 1];
  if (!suffix || !regionalVariantSuffixToken(suffix)) return false;
  return equivalentTitleKey(canonicalWords.slice(0, -1).join(" ")) === equivalentTitleKey(candidate);
}

function regionalVariantToken(value: string | undefined) {
  const token = value?.trim();
  if (!token) return false;
  return REGIONAL_VARIANT_CODE_TOKENS.has(token.toUpperCase()) ||
    REGIONAL_VARIANT_NAME_TOKENS.has(token.toLowerCase());
}

function regionalVariantSuffixToken(value: string) {
  const token = value.trim();
  if (REGIONAL_VARIANT_CODE_TOKENS.has(token.toUpperCase())) {
    return token === token.toUpperCase();
  }
  return REGIONAL_VARIANT_NAME_TOKENS.has(token.toLowerCase());
}

function metadataTitleFields(segment: string) {
  return segment
    .split(/\s*\|\s*/u)
    .map((field) => field.trim())
    .filter(Boolean);
}

function releaseLikeMetadataTitleSegment(segment: string) {
  return /(?:(?:19|20)\d{2}\s*年\s*)?\d{1,2}\s*月\s*新番/u.test(segment);
}

function cjkAnnualMetadataTitleSegment(segment: string) {
  return CJK_ANNUAL_METADATA_RE.test(segment);
}

function broadcasterDatedNativeMetadataTitleSegment(segment: string) {
  const cleaned = cleanHumanTitleCandidate(segment);
  return hasNativeScript(cleaned) &&
    BROADCASTER_METADATA_PREFIX_RE.test(cleaned) &&
    /\s(?:19|20)\d{6}(?:\s*[-~至到－—]\s*(?:19|20)\d{6})?\b/u.test(cleaned);
}

function nativeWhitespaceTitleCandidates(value: string) {
  if (/[\/|]/u.test(value)) return [];
  const splitParts = value
    .replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])\s*Season\s*\d{1,2}\b/giu, "$1")
    .split(/\s+/u)
    .map((part) => cleanCandidateTitle(part));
  if (splitParts.length < 2) return [];
  const parts = splitParts.filter((part) => nativeWhitespaceTitleCandidate(part));
  return parts;
}

function releaseLikeMetadataTitleCandidates(value: string) {
  const candidates = nativeWhitespaceTitleCandidates(value);
  if (candidates.length > 0) return candidates;
  if (!/[\/|]/u.test(value)) return [];

  const unique: string[] = [];
  let foundNativeWhitespaceCandidate = false;
  for (const part of splitTitlePart(value)) {
    const nativeCandidates = nativeWhitespaceTitleCandidates(part);
    if (nativeCandidates.length > 0) {
      foundNativeWhitespaceCandidate = true;
    }
    const partCandidates = nativeCandidates.length > 0
      ? nativeCandidates
      : titleCandidatesFromValue(part);
    for (const candidate of partCandidates) {
      if (!unique.some((existing) => sameCandidate(existing, candidate))) {
        unique.push(candidate);
      }
    }
  }
  for (const candidate of titleCandidatesFromValue(value)) {
    if (nativeEditLabelAlias(candidate)) continue;
    if (hasNativeScript(candidate) && !hasLatin(candidate)) continue;
    if (!unique.some((existing) => sameCandidate(existing, candidate))) {
      unique.push(candidate);
    }
  }
  return foundNativeWhitespaceCandidate ? unique : [];
}

function nativeWhitespaceTitleCandidate(value: string) {
  if (!hasNativeScript(value) || !isTitleCandidate(value)) return false;
  if (/^(?:(?:第\s*)?[一二三四五六七八九十两\d]{1,3}\s*(?:季|期)|第?\s*\d+\s*シリーズ|\d+\s*年[级級]篇|第?[一二三四五六七八九十两\d]{1,3}\s*(?:学期|學期)|(?:最终|最終)季|(?:无修|無修|修正|未删减|未刪減)版)$/u.test(value)) {
    return false;
  }
  return true;
}

function nativeEditLabelAlias(value: string) {
  const cleaned = cleanCandidateTitle(value);
  return hasNativeScript(cleaned) &&
    /(?:无修|無修|修正|未删减|未刪減)版/u.test(cleaned);
}

function nativeVariantWhitespaceTitleCandidates(value: string) {
  if (/[\/|]/u.test(value)) return [];
  const parts = cleanCandidateTitle(value)
    .split(/\s+/u)
    .filter(Boolean);
  if (parts.length !== 2) return [];
  if (!parts.every(nativeVariantWhitespaceTitleCandidate)) return [];
  return likelySimplifiedTraditionalPair(parts[0], parts[1]) ? parts : [];
}

function nativeVariantWhitespaceTitleCandidate(value: string) {
  const chars = Array.from(value);
  return chars.length >= 4 &&
    chars.length <= 16 &&
    hasNativeScript(value) &&
    !hasLatin(value) &&
    !/\d/u.test(value) &&
    isTitleCandidate(value) &&
    !PROVIDER_ALIAS_NOISE_RE.test(value);
}

function likelySimplifiedTraditionalPair(left: string, right: string) {
  const leftChars = Array.from(left);
  const rightChars = Array.from(right);
  if (leftChars.length !== rightChars.length) return false;

  const samePositions = leftChars.reduce((count, char, index) =>
    count + (char === rightChars[index] ? 1 : 0), 0);
  return samePositions / leftChars.length >= 0.5;
}

function cleanMetadataTitleField(field: string) {
  if (BROADCASTER_METADATA_FIELD_RE.test(cleanHumanTitleCandidate(field))) return "";
  let cleaned = field;
  while (METADATA_TITLE_PREFIX_RE.test(cleaned)) {
    cleaned = cleaned.replace(METADATA_TITLE_PREFIX_RE, "");
  }
  return cleaned
    .replace(/【[^】]*】/gu, " ")
    .replace(TV_CATEGORY_WRAPPER_FIELD_RE, " ")
    .replace(SHORT_DRAMA_METADATA_PREFIX_RE, " ")
    .replace(/^(?:韩国|韓國)?(?:音乐|音樂)节目\s+/u, " ")
    .replace(/(?:导演|主演|演员)[:：].*$/u, " ")
    .replace(/(?:类型|类别|類型|類別)[:：].*$/u, " ")
    .replace(/\s*(?:转自|轉自|转载自|轉載自).+$/u, " ")
    .replace(BROADCASTER_METADATA_PREFIX_RE, " ")
    .replace(BROADCASTER_METADATA_FIELD_PREFIX_RE, " ")
    .replace(/\s+第\s*[一二三四五六七八九十两\d]{1,3}\s*(?:季|部)\s*第\s*[一二三四五六七八九十两\d]{1,4}(?:\s*[-~至到－—]\s*[一二三四五六七八九十两\d]{1,4})?\s*期.*$/u, " ")
    .replace(/\s*第\s*[一二三四五六七八九十两\d]{1,4}(?:\s*[-~至到－—]\s*[一二三四五六七八九十两\d]{1,4})?\s*期.*$/u, " ")
    .replace(/\s*第\s*[一二三四五六七八九十两\d]{1,4}(?:\s*[-~至到－—]\s*[一二三四五六七八九十两\d]{1,4})?\s*(?:集|话|話).*$/u, " ")
    .replace(/\s+第\s*[一二三四五六七八九十两\d]{1,3}\s*(?:季|部)(?=\s|$)/u, " ")
    .replace(/\s+(?:日记|日記)\s+.+(?:日记|日記)\s*$/u, " ")
    .replace(CJK_VARIETY_SECTION_SUBTITLE_RE, " ")
    .replace(CJK_VARIETY_SECTION_LABEL_RE, " ")
    .replace(/\s+[一二三四五六七八九十两\d]{1,4}\s*(?:集|期)全(?:\s+.*)?$/u, " ")
    .replace(/\s+全\s*[一二三四五六七八九十两\d]{1,3}\s*(?:集|话|話).*$/u, " ")
    .replace(/(?:19|20)\d{2}\s*年度/g, " ")
    .replace(/(?:19|20)\d{2}\s*年?/g, " ")
    .replace(/^\s+/, "")
    .replace(METADATA_TITLE_PREFIX_RE, " ")
    .replace(/\b(?:4k|2160p|1080p|1080i|720p|576p|540p|480p)\b/gi, " ")
    .replace(CJK_PRESENTATION_SUFFIX_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function metadataInfoField(value: string) {
  const cleaned = cleanHumanTitleCandidate(value);
  if (!cleaned || categorySegment(cleaned) || METADATA_INFO_FIELD_RE.test(cleaned) || METADATA_STANDALONE_LABEL_RE.test(cleaned)) return true;
  if (sourceAttributionOnlyField(cleaned)) return true;
  if (legalDisclaimerAlias(cleaned)) return true;
  if (BROADCASTER_METADATA_FIELD_RE.test(cleaned) || ORIGINAL_RECORDING_METADATA_FIELD_RE.test(cleaned)) return true;
  if (/^(?:(?:剧集|劇集)\s*)?(?:分集|合集)$/u.test(cleaned)) return true;
  if (/^\d{1,3}\s*(?:帧|幀|fps)$/iu.test(cleaned)) return true;
  if (/^(?:去头尾广告纯享版|去頭尾廣告純享版|非伪去头|非偽去頭|\*?发现未去净的广告.*奖励魔力|\*?發現未去淨的廣告.*獎勵魔力)/u.test(cleaned)) return true;
  if (/^(?:类型|類型|类别|類別)[:：]/u.test(cleaned)) return true;
  if (/^(?:英|中|简|簡|繁|日|韩|韓|粤|粵|国|國|台)$/u.test(cleaned)) return true;
  if (/^(?:闽南|閩南|客家)(?:语|語)$/u.test(cleaned)) return true;
  if (/^(?:[国國粤粵英日韩韓中简簡繁多]+(?:语|語|字|字幕|双语|雙語)|(?:简繁|簡繁|中字|英字|内封|內封|内嵌|內嵌).*)$/iu.test(cleaned)) return true;
  if (/(?:dvbsub|srt|ass|sup|sub).*字幕|字幕.*(?:dvbsub|srt|ass|sup|sub)/iu.test(cleaned)) return true;
  if (/^\*?\s*(?:菁彩\s*hdr|hdr10\+?|hdr|sdr|dolby\s*vision|杜比视界|杜比視界)\s*\*?$/iu.test(cleaned)) return true;
  if (PROVIDER_ALIAS_NOISE_RE.test(cleaned) && !/[A-Za-z]{2,}/.test(cleaned.replace(/sub/ig, ""))) return true;
  if (/^(?:19|20)\d{2}\s*年?\s*(?:\d+\s*月)?\s*(?:新番)?$/i.test(cleaned)) return true;
  if (/^(?:版|版本)$/u.test(cleaned)) return true;
  if (/^第\s*\d{1,3}\s*クール$/u.test(cleaned)) return true;
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
  if (!value || SIZE_SEGMENT_RE.test(value) || categorySegment(value)) return false;
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
  if (nonTvCollectionPartBeforeChineseSeason(value, match.index)) return undefined;
  const season = parseChineseNumber(match[1] ?? match[2]);
  return season == null ? undefined : { index: match.index, season, source };
}

function findChineseSeasonOnly(value: string, source: "normalized" | "raw") {
  const match = value.match(CHINESE_SEASON_ONLY_RE);
  if (!match || match.index == null) return undefined;
  if (nonTvCollectionPartBeforeChineseSeason(value, match.index)) return undefined;
  const season = parseChineseNumber(match[1] ?? match[2]);
  return season == null ? undefined : { index: match.index, season, source };
}

function nonTvCollectionPartBeforeChineseSeason(value: string, seasonIndex: number) {
  const prefix = value.slice(Math.max(0, seasonIndex - 8), seasonIndex);
  return /情色系列\s*$/u.test(prefix);
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
