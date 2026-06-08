import type { MetadataProvider } from "../providers/types.js";
import { getTvdbSeriesById, searchTvdbSeries, validateTvdbCredential } from "./client.js";

export const tvdbProvider: MetadataProvider = {
  id: "tvdb",
  supportedMediaTypes: ["TV_SERIES"],
  defaultFor: ["TV_SERIES"],
  async isConfigured(context) {
    return Boolean(context.config.tvdbApiKey);
  },
  search(input, context) {
    if (input.mediaType !== "TV_SERIES") return Promise.resolve([]);
    return searchTvdbSeries(context.config, context.tenantId, {
      title: input.title,
      mediaType: input.mediaType,
      year: input.year,
      language: input.language,
      region: input.region
    });
  },
  fetchTitle(input, context) {
    if (input.mediaType !== "TV_SERIES" || input.providerEntityType !== "tvdb_series") {
      throw new Error("TVDB detail lookup requires tvdb_series");
    }
    return getTvdbSeriesById(context.config, context.tenantId, {
      providerId: input.providerId,
      providerEntityType: input.providerEntityType,
      mediaType: input.mediaType,
      language: input.language,
      region: input.region
    });
  },
  validateCredential(secret) {
    return validateTvdbCredential(secret);
  }
};
