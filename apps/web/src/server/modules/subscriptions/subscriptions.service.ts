import type { FastifyRequest } from "fastify";
import { redactSecrets } from "@rss-media/shared/redact";
import {
  evaluateSubscriptionRule,
  normalizeRule,
  serializeRuleSnapshot
} from "@rss-media/shared/subscriptionRules";
import type {
  CandidateInput,
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
    const decision = evaluateSubscriptionRule(ruleInput, candidateFromItem(item));

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

    try {
      const job = await createDownloadJob({
        tenantId: input.tenantId,
        itemId: item.id,
        subscriptionId: subscription.id,
        downloaderId: subscription.downloaderId ?? undefined,
        source: "SUBSCRIPTION"
      });

      await recordDecision({
        tenantId: input.tenantId,
        subscriptionId: subscription.id,
        itemId: item.id,
        accepted: true,
        reason: decision.reason,
        ruleSnapshot: decision.ruleSnapshot ?? serializeRuleSnapshot(normalizeRule(ruleInput))
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

function rulePersistenceData(rule: ReturnType<typeof normalizeRule>) {
  return {
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
    releaseGroupsInclude: rule.releaseGroupsInclude,
    releaseGroupsExclude: rule.releaseGroupsExclude,
    minSizeBytes: rule.minSizeBytes ?? null,
    maxSizeBytes: rule.maxSizeBytes ?? null,
    season: rule.season ?? null,
    episodeStart: rule.episodeStart ?? null,
    episodeEnd: rule.episodeEnd ?? null,
    criteriaJson: ruleCriteriaJson(rule)
  };
}

function ruleCriteriaJson(rule: ReturnType<typeof normalizeRule>) {
  const criteria = {
    mediaTitleId: rule.mediaTitleId,
    selectedProvider: rule.selectedProvider,
    linkedProviders: rule.linkedProviders,
    providerRatings: rule.providerRatings
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
} {
  return rule.criteriaJson && typeof rule.criteriaJson === "object" && !Array.isArray(rule.criteriaJson)
    ? rule.criteriaJson
    : {};
}

function ruleFromRow(rule: any, subscriptionMediaTitleId?: string | null): SubscriptionRuleInput {
  const criteria = criteriaFromRow(rule);
  return {
    mediaType: rule.mediaType ?? undefined,
    mediaTitleId: subscriptionMediaTitleId ?? criteria.mediaTitleId,
    selectedProvider: criteria.selectedProvider,
    linkedProviders: criteria.linkedProviders ?? [],
    providerRatings: criteria.providerRatings ?? [],
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
    minSizeBytes: rule.minSizeBytes ?? undefined,
    maxSizeBytes: rule.maxSizeBytes ?? undefined,
    season: rule.season ?? undefined,
    episodeStart: rule.episodeStart ?? undefined,
    episodeEnd: rule.episodeEnd ?? undefined
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
    mediaType: rule.mediaType,
    mediaTitleId: ruleInput.mediaTitleId,
    selectedProvider: ruleInput.selectedProvider,
    linkedProviders: ruleInput.linkedProviders,
    providerRatings: ruleInput.providerRatings,
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
    minSizeBytes: rule.minSizeBytes?.toString?.(),
    maxSizeBytes: rule.maxSizeBytes?.toString?.(),
    season: rule.season,
    episodeStart: rule.episodeStart,
    episodeEnd: rule.episodeEnd,
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
