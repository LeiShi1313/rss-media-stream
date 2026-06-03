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
  vote_count?: number;
  popularity?: number;
};

export type TmdbSearchInput = {
  query: string;
  kind?: "MOVIE" | "TV" | "UNKNOWN";
  year?: number;
};
