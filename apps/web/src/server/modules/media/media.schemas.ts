import { z } from "zod";

export const mediaTypeSchema = z.enum(["MOVIE", "TV_SERIES"]);
export const parsedMediaTypeSchema = z.enum(["MOVIE", "TV_SERIES", "UNKNOWN"]);
export const providerSchema = z.enum(["tmdb", "tvdb", "ptgen"]);
export const providerEntityTypeSchema = z.string().trim().min(1).max(80);

const providerEntityTypeFor = (provider: "tmdb" | "tvdb", mediaType: "MOVIE" | "TV_SERIES") => {
  if (provider === "tmdb") return mediaType === "MOVIE" ? "tmdb_movie" : "tmdb_tv";
  return mediaType === "MOVIE" ? "tvdb_movie" : "tvdb_series";
};

const ptgenEntityTypes = new Set(["ptgen_imdb", "ptgen_douban"]);

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
  kind: query.mediaType === "TV_SERIES" ? "TV" : query.mediaType
}));

export const smartProviderTitleSearchSchema = z.object({
  input: z.string().trim().min(1).max(500),
  mediaType: searchableMediaTypeFromRequest.optional(),
  kind: searchableMediaTypeFromRequest.optional(),
  providerEntityType: providerEntityTypeSchema.optional(),
  year: z.coerce.number().int().min(1900).max(2100).optional()
}).transform((input) => ({
  input: input.input,
  mediaType: input.mediaType ?? input.kind,
  providerEntityType: input.providerEntityType,
  year: input.year
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
    providerId: input.provider === "ptgen" && input.providerEntityType === "ptgen_imdb"
      ? input.providerId.toLowerCase()
      : input.providerId,
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
    (input) => input.provider !== "ptgen" || ptgenEntityTypes.has(input.providerEntityType ?? ""),
    { message: "PtGen providerEntityType must be ptgen_imdb or ptgen_douban" }
  )
  .refine(
    (input) => input.provider !== "ptgen" || input.providerEntityType !== "ptgen_imdb" || /^tt\d+$/i.test(input.providerId),
    { message: "provider ID must be an IMDb tt ID for PtGen IMDb" }
  )
  .refine(
    (input) => input.provider !== "ptgen" || input.providerEntityType !== "ptgen_douban" || /^\d+$/.test(input.providerId),
    { message: "provider ID must be numeric for PtGen Douban" }
  )
  .refine(
    (input) => input.provider === "ptgen" || providerEntityTypeFor(input.provider, input.mediaType) !== undefined,
    { message: "provider does not support this media type" }
  )
  .refine(
    (input) => input.provider === "ptgen" || !input.providerEntityType || input.providerEntityType === providerEntityTypeFor(input.provider, input.mediaType),
    { message: "providerEntityType must match provider and media type" }
  );
