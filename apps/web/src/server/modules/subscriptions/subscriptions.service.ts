import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { normalizeRule } from "@rss-media/shared/subscriptionRules";
import type { SubscriptionDto } from "@rss-media/shared/apiContracts";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { db } from "../../core/dbClient.js";
import { forbidden, notFound } from "../../core/errors.js";
import { isAdminRole } from "../../core/permissions.js";
import { legacyKindFromMediaType, serializeMediaPresentation } from "../media/presentation.js";
import {
  EMPTY_PRESENTATION_PREFERENCES,
  loadPresentationPreferences,
  presentationOptionsForMediaType,
  type PresentationPreferences
} from "../media/presentationPreferences.js";
import type {
  matchHistoryQuerySchema,
  subscriptionCreateSchema,
  subscriptionPatchSchema,
  subscriptionRuleSchema
} from "./subscriptions.schemas.js";
import {
  serializeSubscriptionRuleRecord,
  subscriptionRulePersistenceData
} from "./subscriptionRuleRecord.js";

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

  const presentationPreferences = await loadPresentationPreferences(input.tenantId);
  return subscriptions.map((subscription: any) => serializeSubscription(subscription, presentationPreferences));
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
        ...subscriptionRulePersistenceData(rule)
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
  return serializeSubscription(subscription, await loadPresentationPreferences(args.tenantId));
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
  return serializeSubscription(subscription, await loadPresentationPreferences(input.tenantId));
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
      ...subscriptionRulePersistenceData(normalized)
    },
    update: subscriptionRulePersistenceData(normalized)
  });

  const subscription = await db().subscription.findFirst({
    where: { id: input.subscriptionId, tenantId: input.tenantId },
    include: subscriptionInclude
  });
  if (!subscription) throw notFound("Subscription");
  return serializeSubscription(subscription, await loadPresentationPreferences(input.tenantId));
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

async function validateSubscriptionReferences(
  tx: Prisma.TransactionClient,
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

export async function serializeSubscriptionForTenant(
  tenantId: string,
  subscription: any
): Promise<SubscriptionDto> {
  return serializeSubscription(subscription, await loadPresentationPreferences(tenantId));
}

export function serializeSubscription(
  subscription: any,
  presentationPreferences: PresentationPreferences = EMPTY_PRESENTATION_PREFERENCES
): SubscriptionDto {
  const mediaPresentation = subscription.mediaTitle
    ? serializeMediaPresentation({
        mediaTitle: subscription.mediaTitle,
        providerIdentities: subscription.mediaTitle.providerIdentities
      }, presentationOptionsForMediaType(presentationPreferences, subscription.mediaTitle.mediaType))
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
    rule: subscription.rule
      ? serializeSubscriptionRuleRecord(subscription.rule, subscription.mediaTitleId)
      : undefined,
    createdAt: subscription.createdAt.toISOString(),
    updatedAt: subscription.updatedAt.toISOString()
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
