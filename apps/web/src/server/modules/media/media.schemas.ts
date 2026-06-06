import { z } from "zod";

export const mediaKindSchema = z.enum(["MOVIE", "TV", "UNKNOWN"]);
export const providerSchema = z.enum(["tmdb", "imdb", "douban"]);

export const mediaSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  provider: providerSchema.default("tmdb"),
  kind: mediaKindSchema.optional(),
  year: z.coerce.number().int().min(1900).max(2100).optional()
});

export const localMediaSearchQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  kind: mediaKindSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30)
});

export const trendingMediaQuerySchema = z.object({
  windowDays: z.coerce.number().int().min(1).max(365).default(7),
  limit: z.coerce.number().int().min(1).max(50).default(18)
});

export const mediaImportSchema = z.object({
  provider: providerSchema,
  providerId: z.string().trim().min(1).max(80),
  kind: mediaKindSchema,
  title: z.string().trim().min(1).max(300),
  originalTitle: z.string().trim().max(300).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  posterPath: z.string().trim().max(500).optional(),
  backdropPath: z.string().trim().max(500).optional(),
  overview: z.string().trim().max(5000).optional(),
  metadataJson: z.unknown().optional(),
  score: z.number().min(0).max(1).default(1),
  raw: z.unknown().optional()
});

export const mediaParamsSchema = z.object({
  mediaId: z.string().min(1)
});

export const itemParamsSchema = z.object({
  itemId: z.string().min(1)
});

export const manualTmdbMatchSchema = z.object({
  tmdbId: z.string().trim().regex(/^\d+$/, "TMDB ID must be numeric"),
  kind: z.enum(["MOVIE", "TV"])
});

export const acceptCandidateParamsSchema = z.object({
  itemId: z.string().min(1),
  candidateId: z.string().min(1)
});
