import type { MediaProvider, MediaType } from "@rss-media/shared/types";
import { badRequest } from "../../core/errors.js";
import { tmdbProvider } from "../tmdb/provider.js";
import { tvdbProvider } from "../tvdb/provider.js";
import type { MetadataProvider } from "./types.js";

const defaultProviderByMediaType = {
  MOVIE: "tmdb",
  TV_SERIES: "tvdb"
} as const satisfies Record<MediaType, MediaProvider>;

const providers = new Map<MediaProvider, MetadataProvider>([
  [tmdbProvider.id, tmdbProvider],
  [tvdbProvider.id, tvdbProvider]
]);

export function getMetadataProvider(providerId: string): MetadataProvider {
  const provider = providers.get(providerId as MediaProvider);
  if (!provider) {
    throw badRequest(`Media provider ${providerId} is not supported yet`);
  }
  return provider;
}

export function getDefaultProviderId(mediaType: MediaType): MediaProvider {
  return defaultProviderByMediaType[mediaType];
}

export function getDefaultMetadataProvider(mediaType: MediaType): MetadataProvider {
  return getMetadataProvider(getDefaultProviderId(mediaType));
}

export function getMetadataProviderCandidates(mediaType: MediaType): MetadataProvider[] {
  if (mediaType === "TV_SERIES") {
    return [getMetadataProvider("tvdb"), getMetadataProvider("tmdb")];
  }

  return [getDefaultMetadataProvider(mediaType)];
}

export type { MetadataProvider, ProviderContext, ProviderDetailInput, ProviderSearchInput } from "./types.js";
