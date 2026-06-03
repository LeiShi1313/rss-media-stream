import { z } from "zod";

export const mediaKindSchema = z.enum(["MOVIE", "TV", "UNKNOWN"]);
export const providerSchema = z.enum(["tmdb", "imdb", "douban"]);

export const mediaSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  provider: providerSchema.default("tmdb"),
  kind: mediaKindSchema.optional(),
  year: z.coerce.number().int().min(1900).max(2100).optional()
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
  score: z.number().min(0).max(1).default(1),
  raw: z.unknown().optional()
});

export const mediaParamsSchema = z.object({
  mediaId: z.string().min(1)
});

export const itemParamsSchema = z.object({
  itemId: z.string().min(1)
});

export const acceptCandidateParamsSchema = z.object({
  itemId: z.string().min(1),
  candidateId: z.string().min(1)
});
