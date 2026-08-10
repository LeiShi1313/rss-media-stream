export type MediaType = "MOVIE" | "TV_SERIES";
export type ParsedMediaType = MediaType | "UNKNOWN";
export type MediaProvider = "tmdb" | "tvdb" | "ptgen" | "imdb" | "douban" | "wikidata" | "trakt" | "musicbrainz";
export type ProviderSource = "tmdb_api" | "tvdb_api" | "ptgen_imdb" | "ptgen_douban";
export type ProviderEntityType = `${MediaProvider}_${string}`;
export type RatingType = "user_score" | "critic_score" | "popularity";
export type ProviderRatingType = RatingType;
export type RatingComparison = "gte" | "lte" | "gt" | "lt" | "eq";
export type SubscriptionMode = "MEDIA_TITLE" | "REGEX";
export type SubscriptionUpgradePolicy = "none" | "better_quality" | "preferred_release_group";

export type ParsedRelease = {
  title: string;
  titleCandidates?: string[];
  providerSearchTitles?: string[];
  primarySearchTitle?: string;
  year?: number;
  mediaType: ParsedMediaType;
  tvUnitType?: "EPISODE" | "SPECIAL";
  season?: number;
  episode?: number;
  episodeEnd?: number;
  specialNumber?: number;
  episodePart?: string;
  resolution?: number;
  quality?: string;
  source?: string;
  codec?: string;
  audio?: string;
  releaseGroup?: string;
  variant?: string;
  parseConfidence: number;
};

export type ProviderTitleResult = {
  provider: MediaProvider;
  providerSource?: ProviderSource;
  providerEntityType: ProviderEntityType;
  providerId: string;
  mediaType: MediaType;
  title: string;
  normalizedTitle: string;
  originalTitle?: string;
  titleAliases?: string[];
  releaseYear?: number;
  endYear?: number;
  language?: string;
  region?: string;
  localeKey?: string;
  payload: unknown;
  ratingValue?: number;
  ratingScale?: number;
  ratingVoteCount?: number;
  ratingType?: RatingType;
  matchConfidence?: number;
  matchReason?: string;
  externalUrl?: string;
};

export type TmdbTitleResult = ProviderTitleResult & {
  provider: "tmdb";
  providerEntityType: "tmdb_movie" | "tmdb_tv";
};

export type SubscriptionRuleInput = {
  mode?: SubscriptionMode | null;
  mediaType?: ParsedMediaType | null;
  mediaTitleId?: string | null;
  selectedProvider?: ProviderIdentityFilter | null;
  linkedProviders?: ProviderIdentityFilter[] | null;
  providerRatings?: ProviderRatingFilter[] | null;
  feedIds?: string[] | null;
  titleRegex?: string | null;
  includeRegex?: string | null;
  excludeRegex?: string | null;
  minResolution?: number | string | null;
  maxResolution?: number | string | null;
  sources?: string[] | null;
  codecs?: string[] | null;
  audio?: string[] | null;
  releaseGroupsInclude?: string[] | null;
  releaseGroupsExclude?: string[] | null;
  variantsInclude?: string[] | null;
  variantsExclude?: string[] | null;
  preferredReleaseGroups?: string[] | null;
  minSizeBytes?: bigint | number | string | null;
  maxSizeBytes?: bigint | number | string | null;
  season?: number | null;
  episodeStart?: number | null;
  episodeEnd?: number | null;
  upgradePolicy?: SubscriptionUpgradePolicy | null;
  allowCrossSeed?: boolean | null;
  separateVariants?: boolean | null;
  seasonPackAllowed?: boolean | null;
  criteriaJson?: unknown;
};

export type NormalizedSubscriptionRule = {
  mode: SubscriptionMode;
  mediaType?: ParsedMediaType;
  mediaTitleId?: string;
  selectedProvider?: ProviderIdentityFilter;
  linkedProviders: ProviderIdentityFilter[];
  providerRatings: ProviderRatingFilter[];
  feedIds: string[];
  titleRegex?: string;
  includeRegex?: string;
  excludeRegex?: string;
  minResolution?: number;
  maxResolution?: number;
  sources: string[];
  codecs: string[];
  audio: string[];
  releaseGroupsInclude: string[];
  releaseGroupsExclude: string[];
  variantsInclude: string[];
  variantsExclude: string[];
  preferredReleaseGroups: string[];
  minSizeBytes?: bigint;
  maxSizeBytes?: bigint;
  season?: number;
  episodeStart?: number;
  episodeEnd?: number;
  upgradePolicy: SubscriptionUpgradePolicy;
  allowCrossSeed: boolean;
  separateVariants: boolean;
  seasonPackAllowed: boolean;
};

export type ProviderIdentityFilter = {
  provider: string;
  mediaType?: MediaType | null;
  providerEntityType?: string | null;
  providerId: string;
};

export type ProviderRatingFilter = {
  provider: string;
  ratingType?: ProviderRatingType | null;
  comparison: RatingComparison;
  value: number;
  scale?: number | null;
  minVoteCount?: number | null;
};

export type ProviderTitleRuleView = {
  providerTitleId: string;
  provider: string;
  providerSource?: string | null;
  providerEntityType?: string | null;
  providerId: string;
  mediaType: ParsedMediaType;
  ratingValue?: number | null;
  ratingScale?: number | null;
  ratingVoteCount?: number | null;
  ratingType?: ProviderRatingType | null;
};

export type CandidateInput = {
  feedId?: string | null;
  rawTitle: string;
  sizeBytes?: bigint | number | string | null;
  release: ParsedRelease;
  activeMatch?: {
    id: string;
    status: "MATCHED" | "UNMATCHED" | "REJECTED";
    source: "AUTO" | "MANUAL";
    confidence: number;
    mediaTitle: {
      id: string;
      mediaType: ParsedMediaType;
      canonicalTitle: string;
      releaseYear?: number | null;
    };
    selectedProviderTitle: ProviderTitleRuleView;
    linkedProviderTitles: ProviderTitleRuleView[];
  } | null;
};

export type RuleDecision = {
  accepted: boolean;
  reason: string;
  ruleSnapshot?: Record<string, unknown>;
};
