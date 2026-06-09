import { getTmdbMediaById, searchTmdb, validateTmdbCredential } from "./client.js";
import type { MediaType } from "@rss-media/shared/types";
import type { MetadataProvider, ProviderProbeResult } from "../providers/types.js";

export const tmdbProvider: MetadataProvider = {
  id: "tmdb",
  search(input, context) {
    return searchTmdb(
      {
        title: input.title,
        mediaType: input.mediaType,
        year: input.year,
        language: input.language,
        region: input.region
      },
      {
        credential: context.runtime.credential?.secrets.apiKey,
        language: context.runtime.metadataLanguage,
        region: context.runtime.region
      }
    );
  },
  probe(input) {
    const value = input.input.trim();
    const urlProbe = probeTmdbUrl(value);
    if (urlProbe) return [urlProbe];

    const explicit = value.match(/^tmdb:(movie|tv):(\d+)$/i);
    if (explicit) {
      const mediaType = explicit[1].toLowerCase() === "tv" ? "TV_SERIES" : "MOVIE";
      return [{
        provider: "tmdb",
        providerEntityType: mediaType === "TV_SERIES" ? "tmdb_tv" : "tmdb_movie",
        providerId: explicit[2],
        mediaType
      }];
    }

    const contextual = value.match(/^tmdb:(\d+)$/i);
    if (contextual) {
      const mediaType = tmdbMediaTypeFromContext(input.mediaType, input.providerEntityType);
      if (!mediaType) return [];
      return [{
        provider: "tmdb",
        providerEntityType: mediaType === "TV_SERIES" ? "tmdb_tv" : "tmdb_movie",
        providerId: contextual[1],
        mediaType
      }];
    }

    return [];
  },
  fetchTitle(input, context) {
    if (!input.mediaType) {
      throw new Error("TMDB detail lookup requires a media type");
    }
    const expectedEntityType = input.mediaType === "MOVIE" ? "tmdb_movie" : "tmdb_tv";
    if (input.providerEntityType !== expectedEntityType) {
      throw new Error(`TMDB ${input.mediaType} lookup requires ${expectedEntityType}`);
    }
    return getTmdbMediaById(
      {
        mediaType: input.mediaType,
        tmdbId: input.providerId,
        language: input.language,
        region: input.region
      },
      {
        credential: context.runtime.credential?.secrets.apiKey,
        language: context.runtime.metadataLanguage,
        region: context.runtime.region
      }
    );
  },
  validateCredentials(secrets) {
    return validateTmdbCredential(secrets.apiKey);
  }
};

function probeTmdbUrl(input: string): ProviderProbeResult | undefined {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host !== "themoviedb.org") return undefined;

  const [, kind, slug] = url.pathname.split("/");
  if (kind !== "movie" && kind !== "tv") return undefined;

  const id = slug?.match(/^(\d+)/)?.[1];
  if (!id) return undefined;

  const mediaType = kind === "tv" ? "TV_SERIES" : "MOVIE";
  return {
    provider: "tmdb" as const,
    providerEntityType: mediaType === "TV_SERIES" ? "tmdb_tv" : "tmdb_movie",
    providerId: id,
    mediaType
  };
}

function tmdbMediaTypeFromContext(mediaType?: string, providerEntityType?: string): MediaType | undefined {
  if (providerEntityType === "tmdb_movie") return "MOVIE";
  if (providerEntityType === "tmdb_tv") return "TV_SERIES";
  if (mediaType === "MOVIE" || mediaType === "TV_SERIES") return mediaType;
  return undefined;
}
