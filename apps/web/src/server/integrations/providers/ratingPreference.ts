import type { Prisma } from "@prisma/client";
import type { MediaType, ProviderSource } from "@rss-media/shared/types";
import { badRequest } from "../../core/errors.js";
import { prisma } from "../../db.js";
import {
  getProviderSourceDefinition,
  providerSourceSupportsRatings
} from "./sources.js";

export const DEFAULT_RATING_PROVIDER_SOURCE: ProviderSource = "ptgen_douban";

const RATING_MEDIA_TYPES = ["MOVIE", "TV_SERIES"] as const satisfies readonly MediaType[];

export type RatingSourcePreference = {
  mediaType: MediaType;
  providerSource: ProviderSource;
  provider: string;
  label: string;
  enabled: boolean;
};

export type RatingSourcePreferences = Partial<Record<MediaType, RatingSourcePreference>>;
export type ActiveRatingProviderSources = Partial<Record<MediaType, ProviderSource>>;
type RatingPreferenceClient = Pick<Prisma.TransactionClient, "tenantRatingSourcePreference">;

export async function getRatingSourcePreferences(
  tenantId: string,
  mediaTypes: readonly MediaType[] = RATING_MEDIA_TYPES
): Promise<RatingSourcePreferences> {
  const uniqueMediaTypes = [...new Set(mediaTypes)];
  const [rows, disabledRows] = await Promise.all([
    prisma.tenantRatingSourcePreference.findMany({
      where: { tenantId, mediaType: { in: uniqueMediaTypes } },
      select: { mediaType: true, providerSource: true }
    }),
    prisma.tenantProviderSourceConfig.findMany({
      where: { tenantId, enabled: false },
      select: { providerSource: true }
    })
  ]);
  const selectedByMediaType = new Map(rows.map((row) => [row.mediaType, row.providerSource]));
  const disabled = new Set(disabledRows.map((row) => row.providerSource));

  return Object.fromEntries(uniqueMediaTypes.map((mediaType) => {
    const providerSource = selectedByMediaType.get(mediaType) ?? DEFAULT_RATING_PROVIDER_SOURCE;
    const definition = getProviderSourceDefinition(providerSource);
    if (!providerSourceSupportsRatings(providerSource, mediaType)) {
      throw badRequest(`${definition.label} does not provide ratings for ${mediaType}`);
    }
    return [mediaType, {
      mediaType,
      providerSource: definition.id,
      provider: definition.provider,
      label: definition.label,
      enabled: !disabled.has(definition.id)
    }];
  }));
}

export async function getActiveRatingProviderSources(
  tenantId: string,
  mediaTypes: readonly MediaType[] = RATING_MEDIA_TYPES
): Promise<ActiveRatingProviderSources> {
  const preferences = await getRatingSourcePreferences(tenantId, mediaTypes);
  return Object.fromEntries(
    Object.values(preferences)
      .filter((preference): preference is RatingSourcePreference => Boolean(preference?.enabled))
      .map((preference) => [preference.mediaType, preference.providerSource])
  );
}

export async function setRatingSourcePreference(
  tenantId: string,
  mediaType: MediaType,
  providerSource: ProviderSource,
  client: RatingPreferenceClient = prisma
) {
  const definition = assertRatingSourcePreference(mediaType, providerSource);

  return client.tenantRatingSourcePreference.upsert({
    where: { tenantId_mediaType: { tenantId, mediaType } },
    create: { tenantId, mediaType, providerSource: definition.id },
    update: { providerSource: definition.id }
  });
}

export function assertRatingSourcePreference(mediaType: MediaType, providerSource: ProviderSource) {
  const definition = getProviderSourceDefinition(providerSource);
  if (!providerSourceSupportsRatings(providerSource, mediaType)) {
    throw badRequest(`${definition.label} does not provide ratings for ${mediaType}`);
  }
  return definition;
}
