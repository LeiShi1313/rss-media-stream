export type TvdbLoginResponse = {
  data?: {
    token?: string;
  };
};

export type TvdbSearchResponse = {
  data?: TvdbSearchResult[];
};

export type TvdbSeriesResponse = {
  data?: TvdbSeriesRecord;
};

export type TvdbSearchResult = {
  id?: string;
  tvdb_id?: string;
  type?: string;
  name?: string;
  primary_language?: string;
  year?: string;
  image_url?: string;
  overview?: string;
  overviews?: Record<string, string>;
  translations?: Record<string, string>;
  aliases?: string[];
  score?: number;
};

export type TvdbSeriesRecord = {
  id?: number;
  name?: string;
  slug?: string;
  image?: string;
  firstAired?: string;
  lastAired?: string;
  nextAired?: string;
  year?: string;
  overview?: string;
  score?: number;
  status?: {
    name?: string;
  };
  originalLanguage?: string;
  translations?: {
    nameTranslations?: string[];
    overviewTranslations?: string[];
  };
};
