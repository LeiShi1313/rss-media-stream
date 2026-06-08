import type { MediaProvider, MediaType, ProviderTitleResult } from "@rss-media/shared/types";
import type { AppConfig } from "../../config.js";

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

export type ProviderContext = {
  config: AppConfig;
  tenantId: string;
};

export type MetadataProvider = {
  id: MediaProvider;
  supportedMediaTypes: readonly MediaType[];
  defaultFor: readonly MediaType[];
  isConfigured(context: ProviderContext): Promise<boolean>;
  search(input: ProviderSearchInput, context: ProviderContext): Promise<ProviderTitleResult[]>;
  fetchTitle(input: ProviderDetailInput, context: ProviderContext): Promise<ProviderTitleResult>;
  validateCredential?(secret: string, context?: Partial<ProviderContext>): Promise<void>;
};
