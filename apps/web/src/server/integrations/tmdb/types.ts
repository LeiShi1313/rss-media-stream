import type { MediaType } from "@rss-media/shared/types";

export type TmdbResult = {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string;
  backdrop_path?: string;
  overview?: string;
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
  origin_country?: string[];
  seasons?: TmdbSeasonSummary[];
};

export type TmdbSeasonSummary = {
  season_number?: number;
  episode_count?: number;
};

export type TmdbSearchResponse = {
  page?: number;
  results?: TmdbResult[];
  total_pages?: number;
  total_results?: number;
};

export type TmdbSearchInput = {
  title: string;
  titleSource?: "parsed_title" | "provider_search_title";
  mediaType: MediaType;
  year?: number;
  season?: number;
  episode?: number;
  language?: string;
  region?: string;
};

export type TmdbTvSeasonEpisodeEvidence = {
  season: number;
  episode?: number;
  episodeCount?: number;
  confirmed: boolean;
  reason: "season_confirmed" | "season_episode_confirmed" | "missing_season" | "missing_episode_count" | "episode_out_of_range";
};
