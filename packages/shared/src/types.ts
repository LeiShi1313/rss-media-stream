export type MediaKind = "MOVIE" | "TV" | "UNKNOWN";

export type ParsedRelease = {
  title: string;
  year?: number;
  kind: MediaKind;
  season?: number;
  episode?: number;
  episodeEnd?: number;
  resolution?: number;
  quality?: string;
  source?: string;
  codec?: string;
  audio?: string;
  releaseGroup?: string;
  confidence: number;
};

export type TmdbMedia = {
  provider: "tmdb";
  providerId: string;
  kind: Exclude<MediaKind, "UNKNOWN">;
  title: string;
  originalTitle?: string;
  year?: number;
  posterPath?: string;
  backdropPath?: string;
  overview?: string;
  score: number;
  metadataJson?: unknown;
  raw?: unknown;
};

export type SubscriptionRuleInput = {
  mediaKind?: MediaKind | null;
  provider?: string | null;
  providerId?: string | null;
  imdbId?: string | null;
  doubanId?: string | null;
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
  mediaKind?: MediaKind;
  provider?: string;
  providerId?: string;
  imdbId?: string;
  doubanId?: string;
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

export type CandidateInput = {
  rawTitle: string;
  sizeBytes?: bigint | number | string | null;
  release: ParsedRelease;
  match?: {
    mediaId?: string;
    provider: string;
    providerId: string;
    imdbId?: string | null;
    doubanId?: string | null;
    kind: MediaKind;
    score: number;
    status: string;
  } | null;
};

export type RuleDecision = {
  accepted: boolean;
  reason: string;
  ruleSnapshot?: Record<string, unknown>;
};
