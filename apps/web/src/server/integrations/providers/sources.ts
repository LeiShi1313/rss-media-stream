import type { MediaProvider, MediaType, ParsedMediaType, ProviderSource } from "@rss-media/shared/types";
import { badRequest } from "../../core/errors.js";
import type {
  ProviderBaseUrlOption,
  ProviderDefaultPolicy,
  ProviderSecretField
} from "./types.js";

export type MetadataAdapterId = "tmdb" | "tvdb" | "ptgen";

export type ProviderSourceDefinition = {
  id: ProviderSource;
  provider: Exclude<MediaProvider, "ptgen">;
  adapterId: MetadataAdapterId;
  label: string;
  supportedMediaTypes: readonly MediaType[];
  authFields: readonly ProviderSecretField[];
  supportsMetadataLanguage: boolean;
  supportsRegion: boolean;
  defaultMetadataLanguage?: string;
  defaultBaseUrl?: string;
  baseUrlOptions?: readonly ProviderBaseUrlOption[];
  defaultPolicies: readonly ProviderDefaultPolicy[];
};

const mediaTypes = ["MOVIE", "TV_SERIES"] as const satisfies readonly MediaType[];

const providerSourceDefinitions = {
  tmdb_api: {
    id: "tmdb_api",
    provider: "tmdb",
    adapterId: "tmdb",
    label: "TMDB API",
    supportedMediaTypes: mediaTypes,
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
  },
  tvdb_api: {
    id: "tvdb_api",
    provider: "tvdb",
    adapterId: "tvdb",
    label: "TVDB API",
    supportedMediaTypes: mediaTypes,
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
        presentationPriority: 3
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
  ptgen_imdb: {
    id: "ptgen_imdb",
    provider: "imdb",
    adapterId: "ptgen",
    label: "PTGen IMDb",
    supportedMediaTypes: mediaTypes,
    authFields: [],
    supportsMetadataLanguage: true,
    supportsRegion: false,
    defaultMetadataLanguage: "en-US",
    baseUrlOptions: [],
    defaultPolicies: [
      {
        mediaType: "MOVIE",
        enabledForMatching: true,
        enabledForPresentation: true,
        matchingPriority: 3,
        presentationPriority: 1
      },
      {
        mediaType: "TV_SERIES",
        enabledForMatching: true,
        enabledForPresentation: true,
        matchingPriority: 3,
        presentationPriority: 3
      }
    ]
  },
  ptgen_douban: {
    id: "ptgen_douban",
    provider: "douban",
    adapterId: "ptgen",
    label: "PTGen Douban",
    supportedMediaTypes: mediaTypes,
    authFields: [],
    supportsMetadataLanguage: true,
    supportsRegion: false,
    defaultMetadataLanguage: "zh-CN",
    baseUrlOptions: [],
    defaultPolicies: [
      {
        mediaType: "MOVIE",
        enabledForMatching: true,
        enabledForPresentation: true,
        matchingPriority: 4,
        presentationPriority: 4
      },
      {
        mediaType: "TV_SERIES",
        enabledForMatching: true,
        enabledForPresentation: true,
        matchingPriority: 4,
        presentationPriority: 4
      }
    ]
  }
} as const satisfies Record<ProviderSource, ProviderSourceDefinition>;

export function getProviderSourceDefinition(providerSource: string): ProviderSourceDefinition {
  const definition = providerSourceDefinitions[providerSource as ProviderSource];
  if (!definition) {
    throw badRequest(`Provider source ${providerSource} is not supported yet`);
  }
  return definition;
}

export function listProviderSourceDefinitions(): ProviderSourceDefinition[] {
  return Object.values(providerSourceDefinitions);
}

export function getDefaultProviderSourcePoliciesForMediaType(
  mediaType: ParsedMediaType
): Array<ProviderDefaultPolicy & { providerSource: ProviderSource }> {
  if (mediaType === "UNKNOWN") return [];
  return listProviderSourceDefinitions()
    .flatMap((definition) => definition.defaultPolicies.map((policy) => ({
      ...policy,
      providerSource: definition.id
    })))
    .filter((policy) => policy.mediaType === mediaType)
    .sort((a, b) => a.matchingPriority - b.matchingPriority || a.presentationPriority - b.presentationPriority);
}

export function providerSourceSupportsMediaType(providerSource: string, mediaType: ParsedMediaType): boolean {
  if (mediaType === "UNKNOWN") return false;
  return getProviderSourceDefinition(providerSource).supportedMediaTypes.includes(mediaType);
}

export function isProviderSource(value: string): value is ProviderSource {
  return Boolean(providerSourceDefinitions[value as ProviderSource]);
}

export function providerSourceForLegacyProvider(provider: string): ProviderSource | undefined {
  if (provider === "tmdb") return "tmdb_api";
  if (provider === "tvdb") return "tvdb_api";
  if (provider === "ptgen") return "ptgen_imdb";
  return undefined;
}

export function providerSourceForLegacyProviderEntity(
  provider: string,
  providerEntityType?: string | null
): ProviderSource | undefined {
  if (provider === "ptgen" && providerEntityType === "ptgen_douban") return "ptgen_douban";
  if (provider === "ptgen" && providerEntityType === "ptgen_imdb") return "ptgen_imdb";
  return providerSourceForLegacyProvider(provider);
}
