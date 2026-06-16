import { z } from "zod";

export const mediaTypeSchema = z.enum(["MOVIE", "TV_SERIES"]);
export const parsedMediaTypeSchema = z.enum(["MOVIE", "TV_SERIES", "UNKNOWN"]);
export const providerSchema = z.enum(["tmdb", "tvdb", "ptgen"]);
export const providerSourceSchema = z.enum(["tmdb_api", "tvdb_api", "ptgen_imdb", "ptgen_douban"]);
const providerSourceInputSchema = z.union([providerSourceSchema, providerSchema]).transform((provider) => {
  if (provider === "tmdb") return "tmdb_api" as const;
  if (provider === "tvdb") return "tvdb_api" as const;
  if (provider === "ptgen") return "ptgen_imdb" as const;
  return provider;
});
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
  providerSource: providerSourceInputSchema.optional(),
  provider: providerSourceInputSchema.optional(),
  mediaType: searchableMediaTypeFromRequest.default("MOVIE"),
  year: z.coerce.number().int().min(1900).max(2100).optional()
}).transform((query) => ({
  ...query,
  providerSource: query.providerSource ?? query.provider,
  kind: query.mediaType === "TV_SERIES" ? "TV" : query.mediaType
}));

export const smartProviderTitleSearchSchema = z.object({
  input: z.string().trim().min(1).max(500),
  providerSource: providerSourceInputSchema.optional(),
  provider: providerSourceInputSchema.optional(),
  mediaType: searchableMediaTypeFromRequest.optional(),
  kind: searchableMediaTypeFromRequest.optional(),
  providerEntityType: providerEntityTypeSchema.optional(),
  year: z.coerce.number().int().min(1900).max(2100).optional()
}).transform((input) => ({
  input: input.input,
  providerSource: input.providerSource ?? input.provider,
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
    providerSource: providerSourceInputSchema.optional(),
    provider: providerSourceInputSchema.optional(),
    providerEntityType: providerEntityTypeSchema.optional(),
    providerId: z.string().trim().min(1).max(80),
    mediaType: searchableMediaTypeFromRequest.optional(),
    kind: searchableMediaTypeFromRequest.optional()
  })
  .transform((input) => {
    const providerSource = input.providerSource ??
      (input.provider === "ptgen_imdb" && input.providerEntityType === "ptgen_douban"
        ? "ptgen_douban"
        : input.provider) ??
      "tmdb_api";
    return {
      providerSource,
      providerEntityType: input.providerEntityType,
      providerId: providerSource.startsWith("ptgen_")
        ? input.providerId.toLowerCase()
        : input.providerId,
      mediaType: input.mediaType ?? input.kind ?? "MOVIE"
    };
  })
  .refine(
    (input) => input.providerSource !== "tmdb_api" || /^\d+$/.test(input.providerId),
    { message: "provider ID must be numeric for TMDB" }
  )
  .refine(
    (input) => input.providerSource !== "tvdb_api" || /^\d+$/.test(input.providerId),
    { message: "provider ID must be numeric for TVDB" }
  )
  .refine(
    (input) => !input.providerSource.startsWith("ptgen_") || !input.providerEntityType || ptgenEntityTypes.has(input.providerEntityType ?? ""),
    { message: "PTGen providerEntityType must be ptgen_imdb or ptgen_douban when provided" }
  )
  .refine(
    (input) => input.providerSource !== "ptgen_imdb" || /^(?:imdb-)?tt\d+$/i.test(input.providerId),
    { message: "provider ID must be tt... for PTGen IMDb" }
  )
  .refine(
    (input) => input.providerSource !== "ptgen_douban" || /^(?:douban-)?\d+$/i.test(input.providerId),
    { message: "provider ID must be numeric for PTGen Douban" }
  )
  .refine(
    (input) => !input.providerSource.startsWith("ptgen_") || input.providerEntityType === undefined || input.providerEntityType === input.providerSource,
    { message: "PTGen providerEntityType must match providerSource" }
  )
  .refine(
    (input) => input.providerSource.startsWith("ptgen_") || !input.providerEntityType || input.providerEntityType === providerEntityTypeFor(input.providerSource === "tmdb_api" ? "tmdb" : "tvdb", input.mediaType),
    { message: "providerEntityType must match provider and media type" }
  );
