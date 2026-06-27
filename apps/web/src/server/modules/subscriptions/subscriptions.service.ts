import type { FastifyRequest } from "fastify";
import { redactSecrets } from "@rss-media/shared/redact";
import {
  evaluateSubscriptionRule,
  normalizeReleaseGroup,
  normalizeRule,
  normalizeResolution,
  normalizeSource,
  serializeRuleSnapshot
} from "@rss-media/shared/subscriptionRules";
import type {
  CandidateInput,
  NormalizedSubscriptionRule,
  ProviderTitleRuleView,
  SubscriptionRuleInput
} from "@rss-media/shared/types";
import type { AppConfig } from "../../config.js";
import { prisma } from "../../db.js";
import { forbidden, notFound } from "../../core/errors.js";
import { isAdminRole } from "../../core/permissions.js";
import { getPresentationProviderOrder } from "../../integrations/providers/policy.js";
import { createDownloadJob, sendDownloadJob } from "../jobs/jobs.service.js";
import {
  providerOrderForMediaType,
  serializeMediaPresentation,
  type PresentationOrders
} from "../media/presentation.js";
import type {
  matchHistoryQuerySchema,
  subscriptionCreateSchema,
  subscriptionPatchSchema,
  subscriptionRuleSchema
} from "./subscriptions.schemas.js";
import type { z } from "zod";

type SubscriptionCreateInput = z.infer<typeof subscriptionCreateSchema>;
type SubscriptionPatchInput = z.infer<typeof subscriptionPatchSchema>;
type SubscriptionRuleBody = z.infer<typeof subscriptionRuleSchema>;
type MatchHistoryQuery = z.infer<typeof matchHistoryQuerySchema>;

type AcquisitionUnit = {
  contentKey: string;
  mediaTitleId: string;
  unitType: "MOVIE" | "TV_SEASON" | "TV_EPISODE";
  season?: number;
  episode?: number;
  episodeEnd?: number;
};

type ReleaseScore = {
  resolution: number | null;
  source: string | null;
  sourceRank: number;
  releaseGroup: string | null;
  preferredReleaseGroup: boolean;
};

type AcquisitionPlan =
  | {
      accepted: true;
      unit?: AcquisitionUnit;
      existing?: any;
      score?: ReleaseScore;
      forceDuplicate?: boolean;
      reason?: string;
    }
  | {
      accepted: false;
      reason: string;
    };

const SOURCE_RANKS: Record<string, number> = {
  REMUX: 60,
  UHD: 55,
  BLURAY: 50,
  "WEB-DL": 40,
  WEB: 35,
  WEBRIP: 30,
  HDTV: 20,
  DVDRIP: 10
};

const subscriptionInclude = {
  rule: true,
  mediaTitle: {
    select: {
      id: true,
      mediaType: true,
      title: true,
      releaseYear: true,
      providerIdentities: {
        include: { metadata: true }
      }
    }
  },
  downloader: {
    select: {
      id: true,
      name: true,
      type: true,
      enabled: true
    }
  }
};

export async function requireOwnSubscriptionOrAdmin(
  request: FastifyRequest,
  id: string
) {
  const subscription = await db().subscription.findFirst({
    where: { id, tenantId: request.tenantId! },
    include: subscriptionInclude
  });
  if (!subscription) throw notFound("Subscription");

  if (
    !isAdminRole(request.currentMembership!.role) &&
    subscription.createdByUserId !== request.currentUser!.id
  ) {
    throw forbidden();
  }

  return subscription;
}

export async function listSubscriptions(input: {
  tenantId: string;
  userId: string;
  scope: "mine" | "all";
  canSeeAll: boolean;
}) {
  const subscriptions = await db().subscription.findMany({
    where: {
      tenantId: input.tenantId,
      createdByUserId:
        input.scope === "mine" || !input.canSeeAll ? input.userId : undefined
    },
    include: subscriptionInclude,
    orderBy: { createdAt: "desc" }
  });

  const presentationOrders = await preloadPresentationOrders(input.tenantId);
  return subscriptions.map((subscription: any) => serializeSubscription(subscription, presentationOrders));
}

export async function createSubscriptionWithRule(args: {
  tenantId: string;
  userId: string;
  input: SubscriptionCreateInput;
}) {
  const subscription = await prisma.$transaction(async (tx) => {
    await validateSubscriptionReferences(tx, {
      tenantId: args.tenantId,
      mediaTitleId: args.input.mediaTitleId ?? args.input.mediaId,
      downloaderId: args.input.downloaderId
    });

    const rule = normalizeRule(args.input.rule);

    const created = await db(tx).subscription.create({
      data: {
        tenantId: args.tenantId,
        createdByUserId: args.userId,
        title: args.input.title,
        mediaTitleId: args.input.mediaTitleId ?? args.input.mediaId,
        downloaderId: args.input.downloaderId,
        autoDownload: args.input.autoDownload,
        enabled: args.input.enabled
      },
      select: { id: true }
    });

    await db(tx).subscriptionRule.create({
      data: {
        tenantId: args.tenantId,
        subscriptionId: created.id,
        ...rulePersistenceData(rule)
      }
    });

    const subscription = await db(tx).subscription.findUniqueOrThrow({
      where: {
        id_tenantId: {
          id: created.id,
          tenantId: args.tenantId
        }
      },
      include: subscriptionInclude
    });

    return subscription;
  });
  return serializeSubscription(subscription, await preloadPresentationOrders(args.tenantId));
}

export async function updateSubscription(input: {
  tenantId: string;
  id: string;
  patch: SubscriptionPatchInput;
}) {
  const subscription = await prisma.$transaction(async (tx) => {
    await validateSubscriptionReferences(tx, {
      tenantId: input.tenantId,
      mediaTitleId: input.patch.mediaTitleId ?? input.patch.mediaId,
      downloaderId: input.patch.downloaderId
    });

    const subscription = await db(tx).subscription.update({
      where: {
        id_tenantId: {
          id: input.id,
          tenantId: input.tenantId
        }
      },
      data: {
        title: input.patch.title,
        mediaTitleId:
          input.patch.mediaTitleId === null || input.patch.mediaId === null
            ? null
            : input.patch.mediaTitleId ?? input.patch.mediaId,
        downloaderId:
          input.patch.downloaderId === null ? null : input.patch.downloaderId,
        autoDownload: input.patch.autoDownload,
        enabled: input.patch.enabled
      },
      include: subscriptionInclude
    });

    return subscription;
  });
  return serializeSubscription(subscription, await preloadPresentationOrders(input.tenantId));
}

export async function deleteSubscription(tenantId: string, id: string) {
  const result = await db().subscription.deleteMany({
    where: { id, tenantId }
  });
  if (result.count !== 1) throw notFound("Subscription");
  return { ok: true };
}

export async function updateSubscriptionRule(input: {
  tenantId: string;
  subscriptionId: string;
  rule: SubscriptionRuleBody;
}) {
  const normalized = normalizeRule(input.rule);

  await db().subscriptionRule.upsert({
    where: {
      subscriptionId_tenantId: {
        subscriptionId: input.subscriptionId,
        tenantId: input.tenantId
      }
    },
    create: {
      tenantId: input.tenantId,
      subscriptionId: input.subscriptionId,
      ...rulePersistenceData(normalized)
    },
    update: rulePersistenceData(normalized)
  });

  const subscription = await db().subscription.findFirst({
    where: { id: input.subscriptionId, tenantId: input.tenantId },
    include: subscriptionInclude
  });
  if (!subscription) throw notFound("Subscription");
  return serializeSubscription(subscription, await preloadPresentationOrders(input.tenantId));
}

export async function listSubscriptionHistory(input: {
  tenantId: string;
  subscriptionId: string;
}) {
  const decisions = await db().subscriptionMatchDecision.findMany({
    where: {
      tenantId: input.tenantId,
      subscriptionId: input.subscriptionId
    },
    orderBy: { createdAt: "desc" },
    take: 200
  });

  return decisions.map(serializeDecision);
}

export async function listMatchHistory(input: {
  tenantId: string;
  userId: string;
  canSeeAll: boolean;
  query: MatchHistoryQuery;
}) {
  const subscriptionIds = await visibleSubscriptionIds(input);
  if (subscriptionIds.length === 0) return [];

  const decisions = await db().subscriptionMatchDecision.findMany({
    where: {
      tenantId: input.tenantId,
      subscriptionId: { in: subscriptionIds },
      accepted: input.query.accepted,
      ...(input.query.subscriptionId ? { subscriptionId: input.query.subscriptionId } : {})
    },
    orderBy: { createdAt: "desc" },
    take: input.query.limit
  });

  return decisions.map(serializeDecision);
}

export async function evaluateAutoDownloadsForItem(input: {
  tenantId: string;
  itemId: string;
  config: AppConfig;
}) {
  const item = await db().rssItem.findFirst({
    where: { id: input.itemId, tenantId: input.tenantId },
    include: {
      parsedRelease: {
        include: {
          matches: {
            where: { status: "MATCHED", invalidatedAt: null },
            take: 1,
            include: {
              mediaTitle: {
                include: { providerIdentities: { include: { metadata: true } } }
              },
              mediaProviderIdentity: true,
              providerMediaMetadata: { include: { mediaProviderIdentity: true } },
              providerTitle: true
            },
            orderBy: [{ matchedAt: "desc" }, { updatedAt: "desc" }]
          }
        }
      }
    }
  });
  if (!item?.parsedRelease) return [];

  const subscriptions = await db().subscription.findMany({
    where: {
      tenantId: input.tenantId,
      enabled: true,
      autoDownload: true
    },
    include: { rule: true }
  });

  const created: string[] = [];
  const candidate = candidateFromItem(item);
  for (const subscription of subscriptions) {
    if (!subscription.rule) {
      await recordDecision({
        tenantId: input.tenantId,
        subscriptionId: subscription.id,
        itemId: item.id,
        accepted: false,
        reason: "subscription rule is missing",
        ruleSnapshot: {}
      });
      continue;
    }

    const ruleInput = ruleFromRow(subscription.rule, subscription.mediaTitleId);
    const normalizedRule = normalizeRule(ruleInput);
    const decision = evaluateSubscriptionRule(ruleInput, candidate);

    if (!decision.accepted) {
      await recordDecision({
        tenantId: input.tenantId,
        subscriptionId: subscription.id,
        itemId: item.id,
        accepted: false,
        reason: decision.reason,
        ruleSnapshot: decision.ruleSnapshot ?? serializeRuleSnapshot(normalizeRule(ruleInput))
      });
      continue;
    }

    const acquisition = await planAcquisition({
      tenantId: input.tenantId,
      subscription,
      rule: normalizedRule,
      candidate,
      item
    });

    if (!acquisition.accepted) {
      await recordDecision({
        tenantId: input.tenantId,
        subscriptionId: subscription.id,
        itemId: item.id,
        accepted: false,
        reason: acquisition.reason,
        ruleSnapshot: decision.ruleSnapshot ?? serializeRuleSnapshot(normalizedRule)
      });
      continue;
    }

    try {
      const job = await createDownloadJob({
        tenantId: input.tenantId,
        itemId: item.id,
        subscriptionId: subscription.id,
        downloaderId: subscription.downloaderId ?? undefined,
        source: "SUBSCRIPTION",
        forceDuplicate: acquisition.forceDuplicate
      });

      await recordAcquisitionAccepted({
        tenantId: input.tenantId,
        subscriptionId: subscription.id,
        item,
        job,
        acquisition
      });

      await recordDecision({
        tenantId: input.tenantId,
        subscriptionId: subscription.id,
        itemId: item.id,
        accepted: true,
        reason: acquisition.reason ?? decision.reason,
        ruleSnapshot: decision.ruleSnapshot ?? serializeRuleSnapshot(normalizedRule)
      });

      created.push(job.id);
      await sendDownloadJob(job.id, input.config);
    } catch (error) {
      if (!isNonFatalAutoDownloadError(error)) throw error;

      await recordDecision({
        tenantId: input.tenantId,
        subscriptionId: subscription.id,
        itemId: item.id,
        accepted: isDuplicateDownloadError(error),
        reason: redactSecrets(error instanceof Error ? error.message : String(error)),
        ruleSnapshot: decision.ruleSnapshot ?? serializeRuleSnapshot(normalizeRule(ruleInput))
      });
    }
  }

  return created;
}

async function validateSubscriptionReferences(
  tx: unknown,
  input: {
    tenantId: string;
    mediaTitleId?: string | null;
    downloaderId?: string | null;
  }
) {
  if (input.mediaTitleId) {
    const media = await db(tx).mediaTitle.findUnique({
      where: { id: input.mediaTitleId },
      select: { id: true }
    });
    if (!media) throw notFound("Media");
  }

  if (input.downloaderId) {
    const downloader = await db(tx).downloader.findFirst({
      where: {
        id: input.downloaderId,
        tenantId: input.tenantId,
        enabled: true
      },
      select: { id: true }
    });
    if (!downloader) throw notFound("Downloader");
  }
}

async function visibleSubscriptionIds(input: {
  tenantId: string;
  userId: string;
  canSeeAll: boolean;
  query: MatchHistoryQuery;
}) {
  if (input.query.subscriptionId) {
    const subscription = await db().subscription.findFirst({
      where: { id: input.query.subscriptionId, tenantId: input.tenantId },
      select: { id: true, createdByUserId: true }
    });
    if (!subscription) throw notFound("Subscription");
    if (!input.canSeeAll && subscription.createdByUserId !== input.userId) {
      throw forbidden();
    }
    return [subscription.id];
  }

  if (input.canSeeAll) {
    const subscriptions = await db().subscription.findMany({
      where: { tenantId: input.tenantId },
      select: { id: true }
    });
    return subscriptions.map((subscription: { id: string }) => subscription.id);
  }

  const subscriptions = await db().subscription.findMany({
    where: { tenantId: input.tenantId, createdByUserId: input.userId },
    select: { id: true }
  });
  return subscriptions.map((subscription: { id: string }) => subscription.id);
}

async function recordDecision(input: {
  tenantId: string;
  subscriptionId: string;
  itemId: string;
  accepted: boolean;
  reason: string;
  ruleSnapshot: unknown;
}) {
  await db().subscriptionMatchDecision.create({
    data: {
      tenantId: input.tenantId,
      subscriptionId: input.subscriptionId,
      itemId: input.itemId,
      accepted: input.accepted,
      reason: input.reason,
      ruleSnapshot: input.ruleSnapshot as object
    }
  });
}

async function planAcquisition(input: {
  tenantId: string;
  subscription: any;
  rule: NormalizedSubscriptionRule;
  candidate: CandidateInput;
  item: any;
}): Promise<AcquisitionPlan> {
  if (input.rule.mode !== "MEDIA_TITLE") return { accepted: true };

  const unit = acquisitionUnitFromCandidate(input.candidate);
  if (!unit) {
    return {
      accepted: false,
      reason: "release cannot be mapped to a media unit"
    };
  }

  const score = scoreRelease(input.candidate, input.rule);
  const existing = await db().subscriptionAcquisition.findUnique({
    where: {
      tenantId_contentKey: {
        tenantId: input.tenantId,
        contentKey: unit.contentKey
      }
    }
  });

  if (!existing) {
    return { accepted: true, unit, score };
  }

  const feedHistory = crossSeedHistory(existing.crossSeedFeedsJson);
  if (
    input.rule.allowCrossSeed &&
    input.item.feedId &&
    !Object.hasOwn(feedHistory, input.item.feedId)
  ) {
    return {
      accepted: true,
      unit,
      existing,
      score,
      forceDuplicate: true,
      reason: "accepted for cross-seed feed"
    };
  }

  const upgradeReason = acceptedUpgradeReason(input.rule, score, existing);
  if (upgradeReason) {
    return {
      accepted: true,
      unit,
      existing,
      score,
      reason: upgradeReason
    };
  }

  return {
    accepted: false,
    reason: "media unit is already satisfied"
  };
}

async function recordAcquisitionAccepted(input: {
  tenantId: string;
  subscriptionId: string;
  item: any;
  job: { id: string };
  acquisition: AcquisitionPlan;
}) {
  if (!input.acquisition.accepted || !input.acquisition.unit || !input.acquisition.score) {
    return;
  }

  const now = new Date();
  const crossSeedFeedsJson = addCrossSeedFeed({
    value: input.acquisition.existing?.crossSeedFeedsJson,
    feedId: input.item.feedId,
    itemId: input.item.id,
    jobId: input.job.id,
    subscriptionId: input.subscriptionId,
    recordedAt: now
  });
  const where = {
    tenantId_contentKey: {
      tenantId: input.tenantId,
      contentKey: input.acquisition.unit.contentKey
    }
  };

  if (input.acquisition.existing && input.acquisition.forceDuplicate) {
    await db().subscriptionAcquisition.update({
      where,
      data: { crossSeedFeedsJson }
    });
    return;
  }

  const currentData = {
    acceptedBySubscriptionId: input.subscriptionId,
    currentItemId: input.item.id,
    currentJobId: input.job.id,
    currentFeedId: input.item.feedId ?? null,
    currentResolution: input.acquisition.score.resolution,
    currentSource: input.acquisition.score.source,
    currentSourceRank: input.acquisition.score.sourceRank,
    currentReleaseGroup: input.acquisition.score.releaseGroup,
    currentScoreJson: scoreJson(input.acquisition.score),
    crossSeedFeedsJson,
    satisfiedAt: now
  };

  if (input.acquisition.existing) {
    await db().subscriptionAcquisition.update({
      where,
      data: currentData
    });
    return;
  }

  await db().subscriptionAcquisition.upsert({
    where,
    create: {
      tenantId: input.tenantId,
      contentKey: input.acquisition.unit.contentKey,
      mediaTitleId: input.acquisition.unit.mediaTitleId,
      unitType: input.acquisition.unit.unitType,
      season: input.acquisition.unit.season ?? null,
      episode: input.acquisition.unit.episode ?? null,
      episodeEnd: input.acquisition.unit.episodeEnd ?? null,
      ...currentData
    },
    update: currentData
  });
}

function acquisitionUnitFromCandidate(candidate: CandidateInput): AcquisitionUnit | undefined {
  const mediaTitle = candidate.activeMatch?.mediaTitle;
  if (!mediaTitle) return undefined;

  if (mediaTitle.mediaType === "MOVIE") {
    return {
      contentKey: `movie:${mediaTitle.id}`,
      mediaTitleId: mediaTitle.id,
      unitType: "MOVIE"
    };
  }

  const season = candidate.release.season;
  if (season === undefined) return undefined;

  const seasonKey = `tv:${mediaTitle.id}:s${padNumber(season)}`;
  if (candidate.release.episode === undefined) {
    return {
      contentKey: `${seasonKey}:season`,
      mediaTitleId: mediaTitle.id,
      unitType: "TV_SEASON",
      season
    };
  }

  const episodeEnd =
    candidate.release.episodeEnd !== undefined &&
    candidate.release.episodeEnd > candidate.release.episode
      ? candidate.release.episodeEnd
      : undefined;
  return {
    contentKey: episodeEnd
      ? `${seasonKey}:e${padNumber(candidate.release.episode)}-e${padNumber(episodeEnd)}`
      : `${seasonKey}:e${padNumber(candidate.release.episode)}`,
    mediaTitleId: mediaTitle.id,
    unitType: "TV_EPISODE",
    season,
    episode: candidate.release.episode,
    episodeEnd
  };
}

function scoreRelease(
  candidate: CandidateInput,
  rule: NormalizedSubscriptionRule
): ReleaseScore {
  const source = normalizeSource(candidate.release.source) ?? null;
  const releaseGroup = normalizeReleaseGroup(candidate.release.releaseGroup) ?? null;
  return {
    resolution: releaseResolution(candidate),
    source,
    sourceRank: source ? SOURCE_RANKS[source] ?? 0 : 0,
    releaseGroup,
    preferredReleaseGroup: Boolean(
      releaseGroup && rule.preferredReleaseGroups.includes(releaseGroup)
    )
  };
}

function acceptedUpgradeReason(
  rule: NormalizedSubscriptionRule,
  score: ReleaseScore,
  existing: any
): string | undefined {
  if (rule.upgradePolicy === "better_quality" && isBetterQuality(score, existing)) {
    return "accepted as quality upgrade";
  }

  if (
    rule.upgradePolicy === "preferred_release_group" &&
    isPreferredReleaseGroupUpgrade(rule, score, existing)
  ) {
    return "accepted as preferred release group upgrade";
  }

  return undefined;
}

function isBetterQuality(score: ReleaseScore, existing: any) {
  const existingResolution = numberOrNull(existing.currentResolution);
  if (score.resolution !== null && score.resolution > (existingResolution ?? -1)) {
    return true;
  }

  if (score.resolution !== existingResolution) return false;
  return score.sourceRank > (numberOrNull(existing.currentSourceRank) ?? -1);
}

function isPreferredReleaseGroupUpgrade(
  rule: NormalizedSubscriptionRule,
  score: ReleaseScore,
  existing: any
) {
  if (!score.releaseGroup || !rule.preferredReleaseGroups.includes(score.releaseGroup)) {
    return false;
  }
  const existingGroup = normalizeReleaseGroup(existing.currentReleaseGroup);
  return !existingGroup || !rule.preferredReleaseGroups.includes(existingGroup);
}

function releaseResolution(candidate: CandidateInput): number | null {
  if (candidate.release.resolution !== undefined) return candidate.release.resolution;
  if (candidate.release.quality) {
    try {
      return normalizeResolution(candidate.release.quality);
    } catch {
      // Quality strings frequently contain source names; fall back to the raw title.
    }
  }
  const match = candidate.rawTitle.match(/\b(2160p|4k|1080p|720p|480p)\b/i);
  return match ? normalizeResolution(match[1]) : null;
}

function crossSeedHistory(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function addCrossSeedFeed(input: {
  value: unknown;
  feedId?: string | null;
  itemId: string;
  jobId: string;
  subscriptionId: string;
  recordedAt: Date;
}) {
  const history = crossSeedHistory(input.value);
  if (input.feedId) {
    history[input.feedId] = {
      itemId: input.itemId,
      jobId: input.jobId,
      subscriptionId: input.subscriptionId,
      recordedAt: input.recordedAt.toISOString()
    };
  }
  return Object.keys(history).length > 0 ? history : null;
}

function scoreJson(score: ReleaseScore) {
  return {
    resolution: score.resolution,
    source: score.source,
    sourceRank: score.sourceRank,
    releaseGroup: score.releaseGroup,
    preferredReleaseGroup: score.preferredReleaseGroup
  };
}

function numberOrNull(value: unknown) {
  return typeof value === "number" ? value : null;
}

function padNumber(value: number) {
  return String(value).padStart(2, "0");
}

function rulePersistenceData(rule: ReturnType<typeof normalizeRule>) {
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

function ruleCriteriaJson(rule: ReturnType<typeof normalizeRule>) {
  const criteria = {
    mediaTitleId: rule.mediaTitleId,
    selectedProvider: rule.selectedProvider,
    linkedProviders: rule.linkedProviders,
    providerRatings: rule.providerRatings,
    variantsInclude: rule.variantsInclude,
    variantsExclude: rule.variantsExclude
  };
  const compact = Object.fromEntries(
    Object.entries(criteria).filter(([, value]) =>
      Array.isArray(value) ? value.length > 0 : value !== undefined
    )
  );
  return Object.keys(compact).length > 0 ? compact : null;
}

function criteriaFromRow(rule: any): {
  mediaTitleId?: string;
  selectedProvider?: SubscriptionRuleInput["selectedProvider"];
  linkedProviders?: SubscriptionRuleInput["linkedProviders"];
  providerRatings?: SubscriptionRuleInput["providerRatings"];
  variantsInclude?: SubscriptionRuleInput["variantsInclude"];
  variantsExclude?: SubscriptionRuleInput["variantsExclude"];
} {
  return rule.criteriaJson && typeof rule.criteriaJson === "object" && !Array.isArray(rule.criteriaJson)
    ? rule.criteriaJson
    : {};
}

function ruleFromRow(rule: any, subscriptionMediaTitleId?: string | null): SubscriptionRuleInput {
  const criteria = criteriaFromRow(rule);
  return {
    mode: rule.mode ?? undefined,
    mediaType: rule.mediaType ?? undefined,
    mediaTitleId: subscriptionMediaTitleId ?? criteria.mediaTitleId,
    selectedProvider: criteria.selectedProvider,
    linkedProviders: criteria.linkedProviders ?? [],
    providerRatings: criteria.providerRatings ?? [],
    feedIds: rule.feedIds ?? [],
    titleRegex: rule.titleRegex ?? undefined,
    includeRegex: rule.includeRegex ?? undefined,
    excludeRegex: rule.excludeRegex ?? undefined,
    minResolution: rule.minResolution ?? undefined,
    maxResolution: rule.maxResolution ?? undefined,
    sources: rule.sources ?? [],
    codecs: rule.codecs ?? [],
    audio: rule.audio ?? [],
    releaseGroupsInclude: rule.releaseGroupsInclude ?? [],
    releaseGroupsExclude: rule.releaseGroupsExclude ?? [],
    variantsInclude: criteria.variantsInclude ?? [],
    variantsExclude: criteria.variantsExclude ?? [],
    preferredReleaseGroups: rule.preferredReleaseGroups ?? [],
    minSizeBytes: rule.minSizeBytes ?? undefined,
    maxSizeBytes: rule.maxSizeBytes ?? undefined,
    season: rule.season ?? undefined,
    episodeStart: rule.episodeStart ?? undefined,
    episodeEnd: rule.episodeEnd ?? undefined,
    upgradePolicy: rule.upgradePolicy ?? undefined,
    allowCrossSeed: rule.allowCrossSeed ?? undefined,
    seasonPackAllowed: rule.seasonPackAllowed ?? undefined
  };
}

function activeMatchFromRow(match: any): CandidateInput["activeMatch"] {
  const selectedMetadata = match?.providerMediaMetadata ?? match?.providerTitle;
  if (!match?.mediaTitle || !selectedMetadata) return null;
  return {
    id: match.id,
    status: match.status,
    source: match.source,
    confidence: match.confidence ?? 0,
    mediaTitle: {
      id: match.mediaTitle.id,
      mediaType: match.mediaTitle.mediaType,
      canonicalTitle: match.mediaTitle.title ?? match.mediaTitle.canonicalTitle,
      releaseYear: match.mediaTitle.releaseYear ?? null
    },
    selectedProviderTitle: providerTitleRuleView(selectedMetadata),
    linkedProviderTitles: providerMetadataRows(match.mediaTitle)
      .filter(Boolean)
      .map(providerTitleRuleView)
  };
}

function providerMetadataRows(mediaTitle: any) {
  return (mediaTitle.providerIdentities ?? [])
    .flatMap((identity: any) =>
      (identity.metadata ?? []).map((metadata: any) => ({
        ...metadata,
        mediaProviderIdentity: metadata.mediaProviderIdentity ?? identity
      }))
    );
}

function providerTitleRuleView(providerTitle: any): ProviderTitleRuleView {
  const identity = providerTitle.mediaProviderIdentity;
  return {
    providerTitleId: providerTitle.id,
    provider: identity?.provider ?? providerTitle.provider,
    providerSource: providerTitle.providerSource,
    providerEntityType: providerTitle.providerEntityType,
    providerId: identity?.providerId ?? providerTitle.providerId,
    mediaType: identity?.mediaType ?? providerTitle.mediaType,
    ratingValue: providerTitle.ratingValue ?? null,
    ratingScale: providerTitle.ratingScale ?? null,
    ratingVoteCount: providerTitle.ratingVoteCount ?? null,
    ratingType: providerRatingType(providerTitle.ratingType)
  };
}

function providerRatingType(value?: string | null): ProviderTitleRuleView["ratingType"] {
  if (value === "USER_SCORE") return "user_score";
  if (value === "CRITIC_SCORE") return "critic_score";
  if (value === "POPULARITY") return "popularity";
  return null;
}

function candidateFromItem(item: any): CandidateInput {
  const match = item.parsedRelease.matches[0] ?? null;
  return {
    feedId: item.feedId,
    rawTitle: item.rawTitle,
    sizeBytes: item.sizeBytes,
    release: {
      title: item.parsedRelease.title,
      year: item.parsedRelease.year ?? undefined,
      mediaType: item.parsedRelease.mediaType,
      season: item.parsedRelease.season ?? undefined,
      episode: item.parsedRelease.episode ?? undefined,
      episodeEnd: item.parsedRelease.episodeEnd ?? undefined,
      resolution: item.parsedRelease.resolution ?? undefined,
      quality: item.parsedRelease.quality ?? undefined,
      source: item.parsedRelease.source ?? undefined,
      codec: item.parsedRelease.codec ?? undefined,
      audio: item.parsedRelease.audio ?? undefined,
      releaseGroup: item.parsedRelease.releaseGroup ?? undefined,
      variant: item.parsedRelease.variant ?? undefined,
      parseConfidence: item.parsedRelease.parseConfidence
    },
    activeMatch: activeMatchFromRow(match)
  };
}

export async function serializeSubscriptionForTenant(tenantId: string, subscription: any) {
  return serializeSubscription(subscription, await preloadPresentationOrders(tenantId));
}

export function serializeSubscription(subscription: any, presentationOrders: PresentationOrders = {}) {
  const mediaPresentation = subscription.mediaTitle
    ? serializeMediaPresentation({
        mediaTitle: subscription.mediaTitle,
        providerIdentities: subscription.mediaTitle.providerIdentities
      }, {
        providerOrder: providerOrderForMediaType(presentationOrders, subscription.mediaTitle.mediaType)
      })
    : undefined;
  return {
    id: subscription.id,
    title: subscription.title,
    createdByUserId: subscription.createdByUserId,
    media: subscription.mediaTitle
      ? {
          id: subscription.mediaTitle.id,
          provider: mediaPresentation?.displaySource?.provider ?? "internal",
          providerSource: mediaPresentation?.displaySource?.providerSource,
          providerEntityType: mediaPresentation?.displaySource?.providerEntityType,
          providerId: mediaPresentation?.displaySource?.providerId ?? subscription.mediaTitle.id,
          kind: legacyKindFromMediaType(subscription.mediaTitle.mediaType),
          mediaType: subscription.mediaTitle.mediaType,
          title: mediaPresentation?.title ?? subscription.mediaTitle.title,
          year: mediaPresentation?.releaseYear ?? subscription.mediaTitle.releaseYear,
          posterUrl: mediaPresentation?.posterUrl,
          hasCover: mediaPresentation?.hasCover ?? false
        }
      : undefined,
    downloader: subscription.downloader
      ? {
          id: subscription.downloader.id,
          name: subscription.downloader.name,
          type: subscription.downloader.type,
          enabled: subscription.downloader.enabled
        }
      : undefined,
    autoDownload: subscription.autoDownload,
    enabled: subscription.enabled,
    rule: subscription.rule ? serializeRule(subscription.rule, subscription.mediaTitleId) : undefined,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt
  };
}

async function preloadPresentationOrders(tenantId: string): Promise<PresentationOrders> {
  return {
    MOVIE: await getPresentationProviderOrder(tenantId, "MOVIE"),
    TV_SERIES: await getPresentationProviderOrder(tenantId, "TV_SERIES")
  };
}

function serializeRule(rule: any, subscriptionMediaTitleId?: string | null) {
  const ruleInput = ruleFromRow(rule, subscriptionMediaTitleId);
  return {
    id: rule.id,
    mode: ruleInput.mode,
    mediaType: rule.mediaType,
    mediaTitleId: ruleInput.mediaTitleId,
    selectedProvider: ruleInput.selectedProvider,
    linkedProviders: ruleInput.linkedProviders,
    providerRatings: ruleInput.providerRatings,
    feedIds: ruleInput.feedIds,
    titleRegex: rule.titleRegex,
    includeRegex: rule.includeRegex,
    excludeRegex: rule.excludeRegex,
    minResolution: rule.minResolution,
    maxResolution: rule.maxResolution,
    sources: rule.sources ?? [],
    codecs: rule.codecs ?? [],
    audio: rule.audio ?? [],
    releaseGroupsInclude: rule.releaseGroupsInclude ?? [],
    releaseGroupsExclude: rule.releaseGroupsExclude ?? [],
    variantsInclude: ruleInput.variantsInclude ?? [],
    variantsExclude: ruleInput.variantsExclude ?? [],
    preferredReleaseGroups: rule.preferredReleaseGroups ?? [],
    minSizeBytes: rule.minSizeBytes?.toString?.(),
    maxSizeBytes: rule.maxSizeBytes?.toString?.(),
    season: rule.season,
    episodeStart: rule.episodeStart,
    episodeEnd: rule.episodeEnd,
    upgradePolicy: ruleInput.upgradePolicy,
    allowCrossSeed: ruleInput.allowCrossSeed,
    seasonPackAllowed: ruleInput.seasonPackAllowed,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt
  };
}

function serializeDecision(decision: any) {
  return {
    id: decision.id,
    subscriptionId: decision.subscriptionId,
    itemId: decision.itemId,
    accepted: decision.accepted,
    reason: decision.reason,
    ruleSnapshot: serializeJsonValue(decision.ruleSnapshot),
    createdAt: decision.createdAt
  };
}

function serializeJsonValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serializeJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        serializeJsonValue(nested)
      ])
    );
  }
  return value;
}

function isNonFatalAutoDownloadError(error: unknown) {
  return isDuplicateDownloadError(error) || isDefaultDownloaderError(error);
}

function isDuplicateDownloadError(error: unknown) {
  const value = error as { code?: string; message?: string };
  return value?.code === "DOWNLOAD_DUPLICATE" || /download already exists/i.test(value?.message ?? "");
}

function isDefaultDownloaderError(error: unknown) {
  const value = error as { code?: string; message?: string };
  return (
    value?.code === "DEFAULT_DOWNLOADER_REQUIRED" ||
    value?.code === "DEFAULT_DOWNLOADER_UNAVAILABLE" ||
    /default downloader/i.test(value?.message ?? "")
  );
}

function legacyKindFromMediaType(mediaType?: string | null) {
  if (!mediaType) return undefined;
  return mediaType === "TV_SERIES" ? "TV" : mediaType;
}

function db(tx?: unknown) {
  return (tx ?? prisma) as any;
}
