import type { MediaType, ProviderSource } from "@rss-media/shared/types";
import { getPresentationProviderOrder } from "../../integrations/providers/policy.js";
import { getActiveRatingProviderSources } from "../../integrations/providers/ratingPreference.js";
import type { PresentationOptions } from "./presentation.js";

const PRESENTATION_MEDIA_TYPES = ["MOVIE", "TV_SERIES"] as const satisfies readonly MediaType[];

export type PresentationPreferences = {
  providerOrders: Partial<Record<MediaType, ProviderSource[]>>;
  ratingProviderSources: Partial<Record<MediaType, ProviderSource>>;
};

export const EMPTY_PRESENTATION_PREFERENCES: PresentationPreferences = {
  providerOrders: {},
  ratingProviderSources: {}
};

export async function loadPresentationPreferences(
  tenantId: string,
  mediaTypes: readonly MediaType[] = PRESENTATION_MEDIA_TYPES
): Promise<PresentationPreferences> {
  const uniqueMediaTypes = [...new Set(mediaTypes)];
  const [providerOrderEntries, ratingProviderSources] = await Promise.all([
    Promise.all(uniqueMediaTypes.map(async (mediaType) => [
      mediaType,
      await getPresentationProviderOrder(tenantId, mediaType)
    ] as const)),
    getActiveRatingProviderSources(tenantId, uniqueMediaTypes)
  ]);

  return {
    providerOrders: Object.fromEntries(providerOrderEntries),
    ratingProviderSources
  };
}

export function presentationOptionsForMediaType(
  preferences: PresentationPreferences,
  mediaType?: string | null
): PresentationOptions {
  if (mediaType !== "MOVIE" && mediaType !== "TV_SERIES") return {};
  const providerOrder = preferences.providerOrders[mediaType];
  const ratingProviderSource = preferences.ratingProviderSources[mediaType];
  return {
    ...(providerOrder ? { providerOrder } : {}),
    ...(ratingProviderSource ? { ratingProviderSource } : {})
  };
}
