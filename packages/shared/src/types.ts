export type MediaType = "MOVIE" | "TV_SERIES";
export type ParsedMediaType = MediaType | "UNKNOWN";
export type MediaProvider = "tmdb" | "tvdb" | "imdb" | "douban" | "wikidata" | "trakt" | "musicbrainz";
export type ProviderEntityType = `${MediaProvider}_${string}`;
export type RatingType = "user_score" | "critic_score" | "popularity";
export type ProviderRatingType = RatingType;
export type RatingComparison = "gte" | "lte" | "gt" | "lt" | "eq";

export type ParsedRelease = {
  title: string;
  year?: number;
  mediaType: ParsedMediaType;
  season?: number;
  episode?: number;
  episodeEnd?: number;
  resolution?: number;
  quality?: string;
  source?: string;
  codec?: string;
  audio?: string;
  releaseGroup?: string;
  parseConfidence: number;
};

export type ProviderTitleResult = {
  provider: MediaProvider;
  providerEntityType: ProviderEntityType;
  providerId: string;
  mediaType: MediaType;
  title: string;
  normalizedTitle: string;
  originalTitle?: string;
  releaseYear?: number;
  endYear?: number;
  language?: string;
  region?: string;
  payload: unknown;
  ratingValue?: number;
  ratingScale?: number;
  ratingVoteCount?: number;
  ratingType?: RatingType;
  matchConfidence?: number;
  matchReason?: string;
};

export type TmdbTitleResult = ProviderTitleResult & {
  provider: "tmdb";
  providerEntityType: "tmdb_movie" | "tmdb_tv";
};

export type SubscriptionRuleInput = {
  mediaType?: ParsedMediaType | null;
  mediaTitleId?: string | null;
  selectedProvider?: ProviderIdentityFilter | null;
  linkedProviders?: ProviderIdentityFilter[] | null;
  providerRatings?: ProviderRatingFilter[] | null;
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
  minSizeBytes?: bigint | number | string | null;
  maxSizeBytes?: bigint | number | string | null;
  season?: number | null;
  episodeStart?: number | null;
  episodeEnd?: number | null;
  criteriaJson?: unknown;
};

export type NormalizedSubscriptionRule = {
  mediaType?: ParsedMediaType;
  mediaTitleId?: string;
  selectedProvider?: ProviderIdentityFilter;
  linkedProviders: ProviderIdentityFilter[];
  providerRatings: ProviderRatingFilter[];
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
  minSizeBytes?: bigint;
  maxSizeBytes?: bigint;
  season?: number;
  episodeStart?: number;
  episodeEnd?: number;
};

export type ProviderIdentityFilter = {
  provider: string;
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
  providerEntityType: string;
  providerId: string;
  mediaType: MediaType;
  ratingValue?: number | null;
  ratingScale?: number | null;
  ratingVoteCount?: number | null;
  ratingType?: ProviderRatingType | null;
};

export type CandidateInput = {
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
      mediaType: MediaType;
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
