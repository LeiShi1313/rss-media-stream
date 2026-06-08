import { getTmdbMediaById, searchTmdb, tenantHasTmdbCredential, validateTmdbCredential } from "./client.js";
import type { MetadataProvider } from "../providers/types.js";

export const tmdbProvider: MetadataProvider = {
  id: "tmdb",
  supportedMediaTypes: ["MOVIE", "TV_SERIES"],
  defaultFor: ["MOVIE"],
  isConfigured(context) {
    return tenantHasTmdbCredential(context.config, context.tenantId);
  },
  search(input, context) {
    return searchTmdb(
      context.config,
      {
        title: input.title,
        mediaType: input.mediaType,
        year: input.year,
        language: input.language,
        region: input.region
      },
      context.tenantId
    );
  },
  fetchTitle(input, context) {
    const expectedEntityType = input.mediaType === "MOVIE" ? "tmdb_movie" : "tmdb_tv";
    if (input.providerEntityType !== expectedEntityType) {
      throw new Error(`TMDB ${input.mediaType} lookup requires ${expectedEntityType}`);
    }
    return getTmdbMediaById(context.config, context.tenantId, {
      mediaType: input.mediaType,
      tmdbId: input.providerId,
      language: input.language,
      region: input.region
    });
  },
  validateCredential(secret) {
    return validateTmdbCredential(secret);
  }
};
