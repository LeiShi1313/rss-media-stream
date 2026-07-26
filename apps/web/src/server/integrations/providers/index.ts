import type { MediaProvider, ParsedMediaType, ProviderSource } from "@rss-media/shared/types";
import { badRequest } from "../../core/errors.js";
import { ptgenProvider } from "../ptgen/provider.js";
import { tmdbProvider } from "../tmdb/provider.js";
import { tvdbProvider } from "../tvdb/provider.js";
import {
  getDefaultProviderSourcePoliciesForMediaType,
  getProviderSourceDefinition,
  listProviderSourceDefinitions,
  type MetadataAdapterId
} from "./sources.js";
import type { MetadataProvider, ProviderDefinition, ProviderDefaultPolicy } from "./types.js";

const adapters = new Map<MetadataAdapterId, MetadataProvider>([
  ["tmdb", tmdbProvider],
  ["tvdb", tvdbProvider],
  ["ptgen", ptgenProvider]
]);

export function getMetadataProvider(providerId: string): MetadataProvider {
  const provider = adapters.get(providerId as MetadataAdapterId);
  if (!provider) {
    throw badRequest(`Metadata adapter ${providerId} is not supported yet`);
  }
  return provider;
}

export function listProviderDefinitions(): ProviderDefinition[] {
  return listProviderSourceDefinitions();
}

export function getDefaultPoliciesForMediaType(
  mediaType: ParsedMediaType
): Array<ProviderDefaultPolicy & { provider: MediaProvider; providerSource: ProviderSource }> {
  return getDefaultProviderSourcePoliciesForMediaType(mediaType)
    .map((policy) => ({
      ...policy,
      provider: getProviderSourceDefinition(policy.providerSource).provider
    }));
}

export function getMetadataProviders(): MetadataProvider[] {
  return Array.from(adapters.values());
}

export type {
  MetadataProvider,
  ProviderContext,
  ProviderBaseUrlOption,
  ProviderDefinition,
  ProviderDetailInput,
  ProviderProbeInput,
  ProviderProbeResult,
  ProviderRuntimeContext,
  ProviderSearchInput,
  ProviderSecretField,
  ProviderSecrets
} from "./types.js";
export {
  getProviderSourceDefinition,
  listProviderSourceDefinitions,
  providerSourceForLegacyProvider,
  providerSourceForLegacyProviderEntity,
  providerSourceSupportsMediaType
} from "./sources.js";
