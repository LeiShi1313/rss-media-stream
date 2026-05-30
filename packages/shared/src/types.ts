export type MediaKind = "MOVIE" | "TV" | "UNKNOWN";

export type ParsedRelease = {
  title: string;
  year?: number;
  kind: MediaKind;
  season?: number;
  episode?: number;
  episodeEnd?: number;
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
};

export type SubscriptionRuleInput = {
  mediaProvider: string;
  mediaProviderId: string;
  mediaKind: MediaKind;
  includeRegex?: string | null;
  excludeRegex?: string | null;
  minQuality?: string | null;
  season?: number | null;
  episodeStart?: number | null;
  episodeEnd?: number | null;
};

export type CandidateInput = {
  rawTitle: string;
  release: ParsedRelease;
  match?: {
    provider: string;
    providerId: string;
    kind: MediaKind;
    score: number;
    status: string;
  } | null;
};

export type RuleDecision = {
  accepted: boolean;
  reason: string;
};
