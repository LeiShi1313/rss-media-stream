import type { MediaProvider, MediaType, ParsedMediaType, ProviderTitleResult } from "@rss-media/shared/types";

export type ProviderSearchInput = {
  title: string;
  mediaType: MediaType;
  year?: number;
  language?: string;
  region?: string;
};

export type ProviderDetailInput = {
  mediaType: MediaType;
  providerEntityType: string;
  providerId: string;
  language?: string;
  region?: string;
};

export type ProviderProbeInput = {
  input: string;
  mediaType?: ParsedMediaType;
  providerEntityType?: string;
  year?: number;
};

export type ProviderProbeResult = {
  provider: MediaProvider;
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

export type ProviderDefaultPolicy = {
  mediaType: MediaType;
  enabledForMatching: boolean;
  enabledForPresentation: boolean;
  matchingPriority: number;
  presentationPriority: number;
};

export type ProviderDefinition = {
  id: MediaProvider;
  label: string;
  supportedMediaTypes: readonly MediaType[];
  authFields: readonly ProviderSecretField[];
  supportsMetadataLanguage: boolean;
  supportsRegion: boolean;
  defaultMetadataLanguage?: string;
  defaultPolicies: readonly ProviderDefaultPolicy[];
};

export type ProviderSecrets = Record<string, string>;

export type ProviderRuntimeContext = {
  tenantId: string;
  provider: MediaProvider;
  enabled: boolean;
  credential?: {
    source: "workspace" | "environment";
    secrets: ProviderSecrets;
  };
  metadataLanguage?: string;
  region?: string;
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
