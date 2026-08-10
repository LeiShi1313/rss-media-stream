import type { Prisma, SubscriptionRule } from "@prisma/client";
import type { SubscriptionRuleDto } from "@rss-media/shared/apiContracts";
import { toJsonStorageValue } from "@rss-media/shared/json";
import {
  normalizeRule,
  SubscriptionRuleValidationError
} from "@rss-media/shared/subscriptionRules";
import type {
  NormalizedSubscriptionRule,
  SubscriptionMode,
  SubscriptionRuleInput,
  SubscriptionUpgradePolicy
} from "@rss-media/shared/types";
import { z } from "zod";

type PersistedRuleInput = SubscriptionRuleInput & {
  mode: SubscriptionMode;
  linkedProviders: NonNullable<SubscriptionRuleInput["linkedProviders"]>;
  providerRatings: NonNullable<SubscriptionRuleInput["providerRatings"]>;
  feedIds: string[];
  variantsInclude: string[];
  variantsExclude: string[];
  upgradePolicy: SubscriptionUpgradePolicy;
  allowCrossSeed: boolean;
  seasonPackAllowed: boolean;
};

const persistedProviderIdentitySchema = z.object({
  provider: z.string(),
  mediaType: z.enum(["MOVIE", "TV_SERIES"]).nullable().optional(),
  providerEntityType: z.string().nullable().optional(),
  providerId: z.string()
});

const persistedProviderRatingSchema = z.object({
  provider: z.string(),
  ratingType: z
    .enum(["user_score", "critic_score", "popularity"])
    .nullable()
    .optional(),
  comparison: z.enum(["gte", "lte", "gt", "lt", "eq"]),
  value: z.number(),
  scale: z.number().nullable().optional(),
  minVoteCount: z.number().nullable().optional()
});

const persistedRuleCriteriaSchema = z.object({
  mediaTitleId: z.string().nullable().optional(),
  selectedProvider: persistedProviderIdentitySchema.nullable().optional(),
  linkedProviders: z
    .array(persistedProviderIdentitySchema)
    .nullish()
    .transform((value) => value ?? []),
  providerRatings: z
    .array(persistedProviderRatingSchema)
    .nullish()
    .transform((value) => value ?? []),
  variantsInclude: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? []),
  variantsExclude: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? []),
  separateVariants: z.boolean().nullable().optional()
});

type RuleCriteria = z.output<typeof persistedRuleCriteriaSchema>;

export function normalizeSubscriptionRuleRecord(
  rule: SubscriptionRule,
  subscriptionMediaTitleId?: string | null
): NormalizedSubscriptionRule {
  return normalizeRule(ruleInputFromRecord(rule, subscriptionMediaTitleId));
}

export function subscriptionRulePersistenceData(
  rule: NormalizedSubscriptionRule
) {
  return {
    mode: rule.mode,
    mediaType: rule.mediaType ?? null,
    provider: null,
    providerEntityType: null,
    providerId: null,
    imdbId: null,
    doubanId: null,
    titleRegex: rule.titleRegex ?? null,
    includeRegex: rule.includeRegex ?? null,
    excludeRegex: rule.excludeRegex ?? null,
    minResolution: rule.minResolution ?? null,
    maxResolution: rule.maxResolution ?? null,
    sources: rule.sources,
    codecs: rule.codecs,
    audio: rule.audio,
    feedIds: rule.feedIds,
    releaseGroupsInclude: rule.releaseGroupsInclude,
    releaseGroupsExclude: rule.releaseGroupsExclude,
    preferredReleaseGroups: rule.preferredReleaseGroups,
    minSizeBytes: rule.minSizeBytes ?? null,
    maxSizeBytes: rule.maxSizeBytes ?? null,
    season: rule.season ?? null,
    episodeStart: rule.episodeStart ?? null,
    episodeEnd: rule.episodeEnd ?? null,
    upgradePolicy: rule.upgradePolicy,
    allowCrossSeed: rule.allowCrossSeed,
    seasonPackAllowed: rule.seasonPackAllowed,
    criteriaJson: ruleCriteriaJson(rule)
  };
}

export function serializeSubscriptionRuleRecord(
  rule: SubscriptionRule,
  subscriptionMediaTitleId?: string | null
): SubscriptionRuleDto {
  const input = ruleInputFromRecord(rule, subscriptionMediaTitleId);
  return {
    id: rule.id,
    mode: input.mode,
    mediaType: rule.mediaType,
    mediaTitleId: input.mediaTitleId,
    selectedProvider: input.selectedProvider,
    linkedProviders: input.linkedProviders,
    providerRatings: input.providerRatings,
    feedIds: input.feedIds,
    titleRegex: rule.titleRegex,
    includeRegex: rule.includeRegex,
    excludeRegex: rule.excludeRegex,
    minResolution: rule.minResolution,
    maxResolution: rule.maxResolution,
    sources: rule.sources,
    codecs: rule.codecs,
    audio: rule.audio,
    releaseGroupsInclude: rule.releaseGroupsInclude,
    releaseGroupsExclude: rule.releaseGroupsExclude,
    variantsInclude: input.variantsInclude,
    variantsExclude: input.variantsExclude,
    preferredReleaseGroups: rule.preferredReleaseGroups,
    minSizeBytes: rule.minSizeBytes?.toString(),
    maxSizeBytes: rule.maxSizeBytes?.toString(),
    season: rule.season,
    episodeStart: rule.episodeStart,
    episodeEnd: rule.episodeEnd,
    upgradePolicy: input.upgradePolicy,
    allowCrossSeed: input.allowCrossSeed,
    separateVariants: input.separateVariants,
    seasonPackAllowed: input.seasonPackAllowed,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString()
  };
}

function ruleInputFromRecord(
  rule: SubscriptionRule,
  subscriptionMediaTitleId?: string | null
): PersistedRuleInput {
  const criteria = criteriaFromRow(rule.criteriaJson);
  return {
    mode: subscriptionModeFromRow(rule.mode),
    mediaType: rule.mediaType ?? undefined,
    mediaTitleId: subscriptionMediaTitleId ?? criteria.mediaTitleId,
    selectedProvider: criteria.selectedProvider,
    linkedProviders: criteria.linkedProviders,
    providerRatings: criteria.providerRatings,
    feedIds: rule.feedIds,
    titleRegex: rule.titleRegex ?? undefined,
    includeRegex: rule.includeRegex ?? undefined,
    excludeRegex: rule.excludeRegex ?? undefined,
    minResolution: rule.minResolution ?? undefined,
    maxResolution: rule.maxResolution ?? undefined,
    sources: rule.sources,
    codecs: rule.codecs,
    audio: rule.audio,
    releaseGroupsInclude: rule.releaseGroupsInclude,
    releaseGroupsExclude: rule.releaseGroupsExclude,
    variantsInclude: criteria.variantsInclude,
    variantsExclude: criteria.variantsExclude,
    preferredReleaseGroups: rule.preferredReleaseGroups,
    minSizeBytes: rule.minSizeBytes ?? undefined,
    maxSizeBytes: rule.maxSizeBytes ?? undefined,
    season: rule.season ?? undefined,
    episodeStart: rule.episodeStart ?? undefined,
    episodeEnd: rule.episodeEnd ?? undefined,
    upgradePolicy: subscriptionUpgradePolicyFromRow(rule.upgradePolicy),
    allowCrossSeed: rule.allowCrossSeed,
    separateVariants: criteria.separateVariants,
    seasonPackAllowed: rule.seasonPackAllowed
  };
}

function ruleCriteriaJson(rule: NormalizedSubscriptionRule) {
  const criteria = {
    mediaTitleId: rule.mediaTitleId,
    selectedProvider: rule.selectedProvider,
    linkedProviders: rule.linkedProviders,
    providerRatings: rule.providerRatings,
    variantsInclude: rule.variantsInclude,
    variantsExclude: rule.variantsExclude,
    separateVariants: rule.separateVariants ? true : undefined
  };
  const compact = Object.fromEntries(
    Object.entries(criteria).filter(([, value]) =>
      Array.isArray(value) ? value.length > 0 : value !== undefined
    )
  );
  const stored = toJsonStorageValue(Object.keys(compact).length > 0 ? compact : null);
  // Prisma distinguishes database null from JSON null in its types. Existing rows
  // intentionally store the plain null produced by the shared storage helper.
  return stored as Prisma.InputJsonValue;
}

function criteriaFromRow(value: Prisma.JsonValue | null): RuleCriteria {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = persistedRuleCriteriaSchema.safeParse(input);
  if (!result.success) {
    throw new SubscriptionRuleValidationError("subscription criteria are invalid");
  }
  return result.data;
}

function subscriptionModeFromRow(value: string): SubscriptionMode {
  if (value === "MEDIA_TITLE" || value === "REGEX") return value;
  throw new SubscriptionRuleValidationError("subscription mode is unsupported");
}

function subscriptionUpgradePolicyFromRow(value: string): SubscriptionUpgradePolicy {
  if (
    value === "none" ||
    value === "better_quality" ||
    value === "preferred_release_group"
  ) {
    return value;
  }
  throw new SubscriptionRuleValidationError("subscription upgrade policy is unsupported");
}
