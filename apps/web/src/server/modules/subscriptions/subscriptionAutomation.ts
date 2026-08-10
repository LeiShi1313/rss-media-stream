import type { Prisma, SubscriptionAcquisition } from "@prisma/client";
import { redactSecrets } from "@rss-media/shared/redact";
import {
  evaluateSubscriptionRule,
  serializeRuleSnapshot
} from "@rss-media/shared/subscriptionRules";
import type {
  CandidateInput,
  NormalizedSubscriptionRule
} from "@rss-media/shared/types";
import type { AppConfig } from "../../config.js";
import { db } from "../../core/dbClient.js";
import { createDownloadJob, sendDownloadJob } from "../jobs/jobs.service.js";
import {
  decideAcquisition,
  prepareAcquisition,
  type AcquisitionDecision,
  type AcquisitionState,
  type ReleaseScore
} from "./subscriptionAcquisitionPolicy.js";
import {
  candidateFromSubscriptionItem,
  subscriptionCandidateInclude,
  type SubscriptionCandidateRecord
} from "./subscriptionCandidate.js";
import { normalizeSubscriptionRuleRecord } from "./subscriptionRuleRecord.js";

type AcquisitionPlan = AcquisitionDecision & {
  existing?: SubscriptionAcquisition;
};

export async function evaluateAutoDownloadsForItem(input: {
  tenantId: string;
  itemId: string;
  config: AppConfig;
}) {
  const item = await db().rssItem.findFirst({
    where: { id: input.itemId, tenantId: input.tenantId },
    include: subscriptionCandidateInclude
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
  const candidate = candidateFromSubscriptionItem(item);
  if (!candidate) return [];

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

    const normalizedRule = normalizeSubscriptionRuleRecord(
      subscription.rule,
      subscription.mediaTitleId
    );
    const decision = evaluateSubscriptionRule(normalizedRule, candidate);

    if (!decision.accepted) {
      await recordDecision({
        tenantId: input.tenantId,
        subscriptionId: subscription.id,
        itemId: item.id,
        accepted: false,
        reason: decision.reason,
        ruleSnapshot: decision.ruleSnapshot ?? serializeRuleSnapshot(normalizedRule)
      });
      continue;
    }

    const acquisition = await planAcquisition({
      tenantId: input.tenantId,
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
        forceDuplicate:
          acquisition.action === "CROSS_SEED"
            ? acquisition.forceDuplicate
            : undefined
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
        reason:
          acquisition.action === "UPGRADE" || acquisition.action === "CROSS_SEED"
            ? acquisition.reason
            : decision.reason,
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
        ruleSnapshot: decision.ruleSnapshot ?? serializeRuleSnapshot(normalizedRule)
      });
    }
  }

  return created;
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
  rule: NormalizedSubscriptionRule;
  candidate: CandidateInput;
  item: Pick<SubscriptionCandidateRecord, "feedId">;
}): Promise<AcquisitionPlan> {
  const preparation = prepareAcquisition({
    rule: input.rule,
    candidate: input.candidate
  });
  if (!preparation.accepted || preparation.action === "DIRECT") {
    return preparation;
  }

  const existing = await db().subscriptionAcquisition.findUnique({
    where: {
      tenantId_contentKey: {
        tenantId: input.tenantId,
        contentKey: preparation.unit.contentKey
      }
    }
  });
  const decision = decideAcquisition({
    preparation,
    rule: input.rule,
    feedId: input.item.feedId,
    state: existing ? acquisitionState(existing) : null
  });
  return existing ? { ...decision, existing } : decision;
}

async function recordAcquisitionAccepted(input: {
  tenantId: string;
  subscriptionId: string;
  item: Pick<SubscriptionCandidateRecord, "id" | "feedId">;
  job: { id: string };
  acquisition: AcquisitionPlan;
}) {
  if (!input.acquisition.accepted || input.acquisition.action === "DIRECT") {
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

  if (input.acquisition.existing && input.acquisition.action === "CROSS_SEED") {
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
    currentFeedId: input.item.feedId,
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
      specialNumber: input.acquisition.unit.specialNumber ?? null,
      episodePart: input.acquisition.unit.episodePart ?? null,
      variant: input.acquisition.unit.variant ?? null,
      ...currentData
    },
    update: currentData
  });
}

function acquisitionState(existing: SubscriptionAcquisition): AcquisitionState {
  return {
    crossSeedFeedIds: Object.keys(crossSeedHistory(existing.crossSeedFeedsJson)),
    currentResolution: numberOrNull(existing.currentResolution),
    currentSourceRank: numberOrNull(existing.currentSourceRank),
    currentReleaseGroup: existing.currentReleaseGroup
  };
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
  // Prisma distinguishes database null from JSON null in its types. Existing rows
  // intentionally store the plain null produced by this persistence mapping.
  return (Object.keys(history).length > 0 ? history : null) as Prisma.InputJsonValue;
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

function isNonFatalAutoDownloadError(error: unknown) {
  return isDuplicateDownloadError(error) || isDefaultDownloaderError(error);
}

function isDuplicateDownloadError(error: unknown) {
  return errorCode(error) === "DOWNLOAD_DUPLICATE";
}

function isDefaultDownloaderError(error: unknown) {
  const code = errorCode(error);
  return code === "DEFAULT_DOWNLOADER_REQUIRED" || code === "DEFAULT_DOWNLOADER_UNAVAILABLE";
}

function errorCode(error: unknown) {
  return (error as { code?: string } | null | undefined)?.code;
}
