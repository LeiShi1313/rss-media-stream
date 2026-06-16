import type { MetadataProvider, ProviderProbeResult } from "../providers/types.js";
import { getTvdbMovieById, getTvdbSeriesById, searchTvdbMovie, searchTvdbSeries, validateTvdbCredential } from "./client.js";

export const tvdbProvider: MetadataProvider = {
  id: "tvdb",
  search(input, context) {
    if (input.mediaType === "MOVIE") {
      return searchTvdbMovie(
        {
          title: input.title,
          mediaType: input.mediaType,
          year: input.year,
          season: input.season,
          episode: input.episode,
          language: input.language,
          region: input.region
        },
        {
          apiKey: context.runtime.credential?.secrets.apiKey,
          pin: context.runtime.credential?.secrets.pin,
          language: context.runtime.metadataLanguage
        }
      );
    }
    if (input.mediaType !== "TV_SERIES") return Promise.resolve([]);
    return searchTvdbSeries(
      {
        title: input.title,
        mediaType: input.mediaType,
        year: input.year,
        season: input.season,
        episode: input.episode,
        language: input.language,
        region: input.region
      },
      {
        apiKey: context.runtime.credential?.secrets.apiKey,
        pin: context.runtime.credential?.secrets.pin,
        language: context.runtime.metadataLanguage
      }
    );
  },
  probe(input) {
    const value = input.input.trim();
    const explicit = value.match(/^tvdb:(movie|series):(\d+)$/i);
    if (explicit) {
      const mediaType = explicit[1].toLowerCase() === "movie" ? "MOVIE" : "TV_SERIES";
      return [{
        provider: "tvdb",
        providerSource: "tvdb_api",
        providerEntityType: mediaType === "MOVIE" ? "tvdb_movie" : "tvdb_series",
        providerId: explicit[2],
        mediaType
      }];
    }

    const contextual = value.match(/^tvdb:(\d+)$/i);
    if (contextual) {
      const mediaType = tvdbMediaTypeFromContext(input.mediaType, input.providerEntityType);
      if (!mediaType) return [];
      return [{
        provider: "tvdb",
        providerSource: "tvdb_api",
        providerEntityType: mediaType === "MOVIE" ? "tvdb_movie" : "tvdb_series",
        providerId: contextual[1],
        mediaType
      }];
    }

    const urlProbe = probeTvdbUrl(value);
    return urlProbe ? [urlProbe] : [];
  },
  fetchTitle(input, context) {
    if (!input.mediaType) {
      throw new Error("TVDB detail lookup requires a media type");
    }
    if (input.mediaType === "MOVIE" && input.providerEntityType === "tvdb_movie") {
      return getTvdbMovieById(
        {
          providerId: input.providerId,
          providerEntityType: input.providerEntityType,
          mediaType: input.mediaType,
          language: input.language,
          region: input.region
        },
        {
          apiKey: context.runtime.credential?.secrets.apiKey,
          pin: context.runtime.credential?.secrets.pin,
          language: context.runtime.metadataLanguage
        }
      );
    }
    if (input.mediaType !== "TV_SERIES" || input.providerEntityType !== "tvdb_series") {
      throw new Error("TVDB detail lookup requires tvdb_movie or tvdb_series");
    }
    return getTvdbSeriesById(
      {
        providerId: input.providerId,
        providerEntityType: input.providerEntityType,
        mediaType: input.mediaType,
        language: input.language,
        region: input.region
      },
      {
        apiKey: context.runtime.credential?.secrets.apiKey,
        pin: context.runtime.credential?.secrets.pin,
        language: context.runtime.metadataLanguage
      }
    );
  },
  validateCredentials(secrets) {
    return validateTvdbCredential(secrets.apiKey, secrets.pin);
  }
};

function probeTvdbUrl(input: string): ProviderProbeResult | undefined {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host !== "thetvdb.com") return undefined;

  const [, section, slug] = url.pathname.split("/");
  if ((section !== "series" && section !== "movies") || !slug) return undefined;
  const mediaType = section === "movies" ? "MOVIE" : "TV_SERIES";

  const numericId = slug.match(/^(\d+)$/)?.[1];
  if (numericId) {
    return {
      provider: "tvdb" as const,
      providerSource: "tvdb_api",
      providerEntityType: mediaType === "MOVIE" ? "tvdb_movie" : "tvdb_series",
      providerId: numericId,
      mediaType
    };
  }

  const searchQuery = decodeURIComponent(slug).replace(/-/g, " ").trim();
  if (!searchQuery) return undefined;

  return {
    provider: "tvdb" as const,
    providerSource: "tvdb_api",
    mediaType,
    searchQuery
  };
}

function tvdbMediaTypeFromContext(mediaType?: string, providerEntityType?: string): "MOVIE" | "TV_SERIES" | undefined {
  if (providerEntityType === "tvdb_movie") return "MOVIE";
  if (providerEntityType === "tvdb_series") return "TV_SERIES";
  if (mediaType === "MOVIE" || mediaType === "TV_SERIES") return mediaType;
  return undefined;
}
