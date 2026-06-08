import { z } from "zod";

export const mediaTypeSchema = z.enum(["MOVIE", "TV_SERIES"]);
export const parsedMediaTypeSchema = z.enum(["MOVIE", "TV_SERIES", "UNKNOWN"]);
export const providerSchema = z.enum(["tmdb", "tvdb"]);
export const providerEntityTypeSchema = z.string().trim().min(1).max(80);

const providerEntityTypeFor = (provider: "tmdb" | "tvdb", mediaType: "MOVIE" | "TV_SERIES") => {
  if (provider === "tmdb") return mediaType === "MOVIE" ? "tmdb_movie" : "tmdb_tv";
  return mediaType === "TV_SERIES" ? "tvdb_series" : undefined;
};

const mediaTypeFromRequest = z.preprocess(
  (value) => value === "TV" ? "TV_SERIES" : value,
  parsedMediaTypeSchema
);

const searchableMediaTypeFromRequest = z.preprocess(
  (value) => value === "TV" ? "TV_SERIES" : value,
  mediaTypeSchema
);

export const mediaSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  provider: providerSchema.optional(),
  mediaType: searchableMediaTypeFromRequest.default("MOVIE"),
  year: z.coerce.number().int().min(1900).max(2100).optional()
}).transform((query) => ({
  ...query,
  provider: query.provider ?? (query.mediaType === "TV_SERIES" ? "tvdb" : "tmdb"),
  kind: query.mediaType === "TV_SERIES" ? "TV" : query.mediaType
}));

export const localMediaSearchQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  mediaType: mediaTypeFromRequest.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30)
}).transform((query) => ({
  ...query,
  mediaType: query.mediaType === "UNKNOWN" ? undefined : query.mediaType,
  kind: query.mediaType === "TV_SERIES" ? "TV" : query.mediaType
}));

export const trendingMediaQuerySchema = z.object({
  windowDays: z.coerce.number().int().min(1).max(365).default(7),
  limit: z.coerce.number().int().min(1).max(50).default(18)
});

export const mediaParamsSchema = z.object({
  mediaId: z.string().min(1)
});

export const itemParamsSchema = z.object({
  itemId: z.string().min(1)
});

export const manualProviderMatchSchema = z
  .object({
    provider: providerSchema.default("tmdb"),
    providerEntityType: providerEntityTypeSchema.optional(),
    providerId: z.string().trim().min(1).max(80),
    mediaType: searchableMediaTypeFromRequest.optional(),
    kind: searchableMediaTypeFromRequest.optional()
  })
  .transform((input) => ({
    provider: input.provider,
    providerEntityType: input.providerEntityType,
    providerId: input.providerId,
    mediaType: input.mediaType ?? input.kind ?? "MOVIE"
  }))
  .refine(
    (input) => input.provider !== "tmdb" || /^\d+$/.test(input.providerId),
    { message: "provider ID must be numeric for TMDB" }
  )
  .refine(
    (input) => input.provider !== "tvdb" || /^\d+$/.test(input.providerId),
    { message: "provider ID must be numeric for TVDB" }
  )
  .refine(
    (input) => providerEntityTypeFor(input.provider, input.mediaType) !== undefined,
    { message: "provider does not support this media type" }
  )
  .refine(
    (input) => !input.providerEntityType || input.providerEntityType === providerEntityTypeFor(input.provider, input.mediaType),
    { message: "providerEntityType must match provider and media type" }
  );
