import { z } from "zod";

const mediaTypeSchema = z.preprocess(
  (value) => value === "TV" ? "TV_SERIES" : value,
  z.enum(["MOVIE", "TV_SERIES", "UNKNOWN"])
);
const providerSchema = z.enum(["tmdb", "tvdb", "imdb", "douban", "wikidata", "trakt", "musicbrainz"]);
const ratingTypeSchema = z.enum(["user_score", "critic_score", "popularity"]);
const ratingComparisonSchema = z.enum(["gte", "lte", "gt", "lt", "eq"]);

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
const providerIdentitySchema = z.object({
  provider: providerSchema,
  providerEntityType: optionalTrimmedString(80),
  providerId: z.string().trim().min(1).max(80)
});
const providerRatingFilterSchema = z.object({
  provider: providerSchema,
  ratingType: ratingTypeSchema.optional(),
  comparison: ratingComparisonSchema,
  value: z.coerce.number().finite(),
  scale: z.coerce.number().finite().positive().optional(),
  minVoteCount: z.coerce.number().int().nonnegative().optional()
});

export const subscriptionRuleSchema = z
  .object({
    mediaType: mediaTypeSchema.optional(),
    mediaTitleId: z.string().min(1).optional(),
    selectedProvider: providerIdentitySchema.optional(),
    linkedProviders: z.array(providerIdentitySchema).max(20).default([]),
    providerRatings: z.array(providerRatingFilterSchema).max(20).default([]),
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
  )
  .transform((rule) => rule);

export const subscriptionCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  mediaTitleId: z.string().min(1).optional(),
  mediaId: z.string().min(1).optional(),
  downloaderId: z.string().min(1).optional(),
  autoDownload: z.boolean().default(true),
  enabled: z.boolean().default(true),
  rule: subscriptionRuleSchema
});

export const subscriptionPatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  mediaTitleId: z.string().min(1).nullable().optional(),
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
