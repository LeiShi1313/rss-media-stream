import { z } from "zod";

const mediaKindSchema = z.enum(["MOVIE", "TV", "UNKNOWN"]);
const providerSchema = z.enum(["tmdb", "imdb", "douban"]);

const optionalTrimmedString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length ? value : undefined))
    .optional();

const regexString = optionalTrimmedString(300).refine(
  (value) => {
    if (!value) return true;
    try {
      new RegExp(value, "i");
      return true;
    } catch {
      return false;
    }
  },
  { message: "Invalid regular expression" }
);

const stringList = z.array(z.string().trim().min(1).max(80)).max(50).default([]);

export const subscriptionRuleSchema = z
  .object({
    mediaKind: mediaKindSchema.optional(),
    provider: providerSchema.optional(),
    providerId: optionalTrimmedString(80),
    imdbId: z.string().regex(/^tt\d+$/).optional(),
    doubanId: optionalTrimmedString(80),
    titleRegex: regexString,
    includeRegex: regexString,
    excludeRegex: regexString,
    minResolution: z.coerce.number().int().positive().optional(),
    maxResolution: z.coerce.number().int().positive().optional(),
    sources: stringList,
    codecs: stringList,
    audio: stringList,
    releaseGroupsInclude: stringList,
    releaseGroupsExclude: stringList,
    minSizeBytes: z.coerce.bigint().optional(),
    maxSizeBytes: z.coerce.bigint().optional(),
    season: z.number().int().optional(),
    episodeStart: z.number().int().optional(),
    episodeEnd: z.number().int().optional()
  })
  .refine(
    (rule) =>
      rule.minResolution === undefined ||
      rule.maxResolution === undefined ||
      rule.minResolution <= rule.maxResolution,
    { message: "minResolution cannot be greater than maxResolution" }
  )
  .refine(
    (rule) =>
      rule.minSizeBytes === undefined ||
      rule.maxSizeBytes === undefined ||
      rule.minSizeBytes <= rule.maxSizeBytes,
    { message: "minSizeBytes cannot be greater than maxSizeBytes" }
  );

export const subscriptionCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  mediaId: z.string().min(1).optional(),
  downloaderId: z.string().min(1).optional(),
  autoDownload: z.boolean().default(true),
  enabled: z.boolean().default(true),
  rule: subscriptionRuleSchema
});

export const subscriptionPatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  mediaId: z.string().min(1).nullable().optional(),
  downloaderId: z.string().min(1).nullable().optional(),
  autoDownload: z.boolean().optional(),
  enabled: z.boolean().optional()
});

export const subscriptionParamsSchema = z.object({
  id: z.string().min(1)
});

export const subscriptionListQuerySchema = z.object({
  scope: z.enum(["mine", "all"]).default("mine")
});

export const matchHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  subscriptionId: z.string().min(1).optional(),
  accepted: z.coerce.boolean().optional()
});
