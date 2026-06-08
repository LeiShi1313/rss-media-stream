import type { MediaProvider, MediaType, ParsedMediaType } from "@rss-media/shared/types";
import { badRequest } from "../../core/errors.js";
import { tmdbProvider } from "../tmdb/provider.js";
import { tvdbProvider } from "../tvdb/provider.js";
import type { MetadataProvider, ProviderDefinition, ProviderDefaultPolicy } from "./types.js";

const providerDefinitions = {
  tmdb: {
    id: "tmdb",
    label: "TMDB",
    supportedMediaTypes: ["MOVIE", "TV_SERIES"],
    authFields: [{ key: "apiKey", label: "API key or read access token", secret: true, required: true }],
    supportsMetadataLanguage: true,
    supportsRegion: true,
    defaultMetadataLanguage: "en-US",
    defaultPolicies: [
      {
        mediaType: "MOVIE",
        enabledForMatching: true,
        enabledForPresentation: true,
        matchingPriority: 1,
        presentationPriority: 1
      },
      {
        mediaType: "TV_SERIES",
        enabledForMatching: true,
        enabledForPresentation: true,
        matchingPriority: 2,
        presentationPriority: 2
      }
    ]
  },
  tvdb: {
    id: "tvdb",
    label: "TVDB",
    supportedMediaTypes: ["MOVIE", "TV_SERIES"],
    authFields: [
      { key: "apiKey", label: "API key", secret: true, required: true },
      { key: "pin", label: "PIN", secret: true, required: false }
    ],
    supportsMetadataLanguage: true,
    supportsRegion: false,
    defaultMetadataLanguage: "en-US",
    defaultPolicies: [
      {
        mediaType: "MOVIE",
        enabledForMatching: true,
        enabledForPresentation: true,
        matchingPriority: 2,
        presentationPriority: 2
      },
      {
        mediaType: "TV_SERIES",
        enabledForMatching: true,
        enabledForPresentation: true,
        matchingPriority: 1,
        presentationPriority: 1
      }
    ]
  }
} as const satisfies Record<"tmdb" | "tvdb", ProviderDefinition>;

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

export function getProviderDefinition(providerId: string): ProviderDefinition {
  const definition = providerDefinitions[providerId as keyof typeof providerDefinitions];
  if (!definition) {
    throw badRequest(`Media provider ${providerId} is not supported yet`);
  }
  return definition;
}

export function listProviderDefinitions(): ProviderDefinition[] {
  return Object.values(providerDefinitions);
}

export function getDefaultPoliciesForMediaType(
  mediaType: ParsedMediaType
): Array<ProviderDefaultPolicy & { provider: MediaProvider }> {
  if (mediaType === "UNKNOWN") return [];
  return listProviderDefinitions()
    .flatMap((definition) => definition.defaultPolicies.map((policy) => ({
      ...policy,
      provider: definition.id
    })))
    .filter((policy) => policy.mediaType === mediaType)
    .sort((a, b) => a.matchingPriority - b.matchingPriority || a.presentationPriority - b.presentationPriority);
}

export function providerSupportsMediaType(providerId: string, mediaType: ParsedMediaType): boolean {
  if (mediaType === "UNKNOWN") return false;
  return getProviderDefinition(providerId).supportedMediaTypes.includes(mediaType);
}

export function getMetadataProviders(): MetadataProvider[] {
  return Array.from(providers.values());
}

export type {
  MetadataProvider,
  ProviderContext,
  ProviderDefinition,
  ProviderDetailInput,
  ProviderProbeInput,
  ProviderProbeResult,
  ProviderRuntimeContext,
  ProviderSearchInput,
  ProviderSecretField,
  ProviderSecrets
} from "./types.js";
