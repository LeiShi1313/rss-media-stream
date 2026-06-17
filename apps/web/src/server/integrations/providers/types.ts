import type { MediaProvider, MediaType, ParsedMediaType, ProviderSource, ProviderTitleResult } from "@rss-media/shared/types";

export type ProviderSearchInput = {
  title: string;
  titleSource?: "parsed_title" | "provider_search_title";
  mediaType: MediaType;
  year?: number;
  season?: number;
  episode?: number;
  language?: string;
  region?: string;
  providerSource?: ProviderSource;
};

export type ProviderDetailInput = {
  mediaType?: MediaType;
  providerEntityType: string;
  providerId: string;
  language?: string;
  region?: string;
  providerSource?: ProviderSource;
};

export type ProviderProbeInput = {
  input: string;
  mediaType?: ParsedMediaType;
  providerEntityType?: string;
  year?: number;
};

export type ProviderProbeResult = {
  provider: MediaProvider;
  providerSource?: ProviderSource;
  providerEntityType?: string;
  providerId?: string;
  mediaType?: MediaType;
  searchQuery?: string;
};

export type ProviderSecretField = {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
};

export type ProviderBaseUrlOption = {
  label: string;
  value: string;
};

export type ProviderDefaultPolicy = {
  mediaType: MediaType;
  enabledForMatching: boolean;
  enabledForPresentation: boolean;
  matchingPriority: number;
  presentationPriority: number;
};

export type ProviderDefinition = {
  id: ProviderSource;
  provider: MediaProvider;
  adapterId: string;
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

export type ProviderSecrets = Record<string, string>;

export type ProviderRuntimeContext = {
  tenantId: string;
  providerSource: ProviderSource;
  provider: MediaProvider;
  adapterId: string;
  enabled: boolean;
  credential?: {
    source: "workspace" | "environment";
    secrets: ProviderSecrets;
  };
  metadataLanguage?: string;
  region?: string;
  baseUrl?: string;
};

export type ProviderContext = {
  runtime: ProviderRuntimeContext;
};

export type MetadataProvider = {
  id: MediaProvider;
  search(input: ProviderSearchInput, context: ProviderContext): Promise<ProviderTitleResult[]>;
  fetchTitle(input: ProviderDetailInput, context: ProviderContext): Promise<ProviderTitleResult>;
  probe?(input: ProviderProbeInput): ProviderProbeResult[];
  validateCredentials?(secrets: ProviderSecrets): Promise<void>;
};
