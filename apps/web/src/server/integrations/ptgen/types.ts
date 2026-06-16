import type { MediaType } from "@rss-media/shared/types";

export type PtgenSource = "imdb" | "douban";
export type PtgenSite = PtgenSource;
export type PtgenProviderEntityType = "ptgen_imdb" | "ptgen_douban";

export type PtgenIdentity = {
  source: PtgenSource;
  sourceId: string;
  lookupId: string;
  providerEntityType: PtgenProviderEntityType;
  providerId: string;
  transient?: boolean;
};

export type PtgenSourceIds = Partial<Record<PtgenSource, string>>;

export type PtgenSearchResponse = {
  hits?: PtgenSearchHit[];
  estimatedTotalHits?: number;
  limit?: number;
  offset?: number;
  processingTimeMs?: number;
  query?: string;
};

export type PtgenSearchHit = {
  id?: string;
  kind?: string | null;
  source?: string | null;
  sources?: string[];
  source_ids?: PtgenSourceIds & Record<string, string | undefined>;
  source_paths?: Record<string, string | undefined>;
  titles?: string[];
  aliases?: string[];
  year?: string | number | null;
  release_date?: string | null;
  genres?: string[];
  tags?: string[];
  regions?: string[];
  languages?: string[];
  people?: string[];
  directors?: string[];
  writers?: string[];
  cast?: string[];
  staff?: string[];
  developers?: string[];
  publishers?: string[];
  description?: string | null;
  poster?: string | null;
  poster_ptgen?: string | null;
  rating_score?: string | number | null;
  rating_votes?: string | number | null;
  provider_scores?: Record<string, PtgenProviderScore | undefined>;
  updated_at?: string | null;
  _formatted?: Record<string, unknown>;
  success?: boolean;
  error?: string | null;
};

export type PtgenProviderScore = {
  rating_score?: string | number | null;
  rating_votes?: string | number | null;
  score?: string | number | null;
  votes?: string | number | null;
  value?: string | number | null;
  voteCount?: string | number | null;
};

export type PtgenLegacyRecord = {
  success?: boolean;
  error?: string | null;
  site?: string;
  sid?: string | number;
  "@type"?: string;
  name?: string;
  chinese_title?: string;
  foreign_title?: string;
  this_title?: string[];
  trans_title?: string[];
  aka?: string[];
  year?: string | number;
  playdate?: string[];
  datePublished?: string;
  release_date?: string[] | string;
  imdb_id?: string;
  imdb_link?: string;
  douban_link?: string;
  poster?: string;
  poster_ptgen?: string;
  introduction?: string;
  description?: string;
  director?: unknown;
  directors?: unknown;
  cast?: unknown;
  douban_rating_average?: string | number;
  douban_votes?: string | number;
  imdb_rating_average?: string | number;
  imdb_votes?: string | number;
  genre?: string[];
  language?: string[];
  region?: string[];
  episodes?: string | number | null;
  update_at?: string;
};

export type PtgenRecord = PtgenLegacyRecord;

export type PtgenNormalizedRecord = {
  source: PtgenSource;
  sourceId: string;
  providerEntityType: PtgenProviderEntityType;
  providerId: string;
  mediaType?: MediaType;
  title?: string;
  originalTitle?: string;
  titles?: string[];
  aliases?: string[];
  releaseYear?: number;
  releaseDate?: string;
  poster?: string;
  originalPoster?: string;
  overview?: string;
  genres?: string[];
  regions?: string[];
  languages?: string[];
  directors?: string[];
  writers?: string[];
  cast?: string[];
  people?: string[];
  sourceIds?: PtgenSourceIds;
  sourcePaths?: Record<string, string | undefined>;
  ratingScore?: number;
  ratingVotes?: number;
  providerScores?: Record<string, unknown>;
  updatedAt?: string;
  backend: string;
  baseUrl?: string;
  matchConfidence?: number;
  raw: unknown;
};
