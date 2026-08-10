import type { Prisma } from "@prisma/client";
import type { SubscriptionDto } from "@rss-media/shared/apiContracts";
import { normalizeRule } from "@rss-media/shared/subscriptionRules";
import { z } from "zod";
import { prisma } from "../../db.js";
import type { TenantRole } from "../../core/context.js";
import { db } from "../../core/dbClient.js";
import { forbidden, notFound } from "../../core/errors.js";
import { isAdminRole } from "../../core/permissions.js";
import { legacyKindFromMediaType, serializeMediaPresentation } from "../media/presentation.js";
import {
  loadPresentationPreferences,
  presentationOptionsForMediaType,
  type PresentationPreferences
} from "../media/presentationPreferences.js";
import {
  serializeSubscriptionRuleRecord,
  subscriptionRulePersistenceData
} from "./subscriptionRuleRecord.js";
import {
  subscriptionPatchSchema,
  subscriptionRuleSchema,
  type matchHistoryQuerySchema,
  type subscriptionCreateSchema
} from "./subscriptions.schemas.js";
type SubscriptionCreateInput = z.infer<typeof subscriptionCreateSchema>;
type MatchHistoryQuery = z.infer<typeof matchHistoryQuerySchema>;

export type SubscriptionActor = {
  tenantId: string;
  userId: string;
  role: TenantRole;
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
} satisfies Prisma.SubscriptionInclude;

type SubscriptionRecord = Prisma.SubscriptionGetPayload<{
  include: typeof subscriptionInclude;
}>;

export async function listSubscriptions(input: {
  actor: SubscriptionActor;
  scope: "mine" | "all";
}): Promise<SubscriptionDto[]> {
  if (input.scope === "all" && !isAdminRole(input.actor.role)) {
    throw forbidden();
  }

  const subscriptions = await db().subscription.findMany({
    where: {
      tenantId: input.actor.tenantId,
      createdByUserId:
        input.scope === "mine" ? input.actor.userId : undefined
    },
    include: subscriptionInclude,
    orderBy: { createdAt: "desc" }
  });
  const preferences = await loadPresentationPreferences(input.actor.tenantId);
  return subscriptions.map((subscription) =>
    serializeSubscription(subscription, preferences)
  );
}

export async function getSubscription(input: {
  actor: SubscriptionActor;
  id: string;
}): Promise<SubscriptionDto> {
  const subscription = await requireManageableSubscription(
    input.actor,
    input.id
  );
  return serializeSubscription(
    subscription,
    await loadPresentationPreferences(input.actor.tenantId)
  );
}

export async function createSubscriptionWithRule(input: {
  actor: SubscriptionActor;
  input: SubscriptionCreateInput;
}): Promise<SubscriptionDto> {
  const subscription = await prisma.$transaction(async (tx) => {
    await validateSubscriptionReferences(tx, {
      tenantId: input.actor.tenantId,
      mediaTitleId: input.input.mediaTitleId ?? input.input.mediaId,
      downloaderId: input.input.downloaderId
    });

    const rule = normalizeRule(input.input.rule);
    const created = await db(tx).subscription.create({
      data: {
        tenantId: input.actor.tenantId,
        createdByUserId: input.actor.userId,
        title: input.input.title,
        mediaTitleId: input.input.mediaTitleId ?? input.input.mediaId,
        downloaderId: input.input.downloaderId,
        autoDownload: input.input.autoDownload,
        enabled: input.input.enabled
      },
      select: { id: true }
    });

    await db(tx).subscriptionRule.create({
      data: {
        tenantId: input.actor.tenantId,
        subscriptionId: created.id,
        ...subscriptionRulePersistenceData(rule)
      }
    });

    return db(tx).subscription.findUniqueOrThrow({
      where: {
        id_tenantId: {
          id: created.id,
          tenantId: input.actor.tenantId
        }
      },
      include: subscriptionInclude
    });
  });

  return serializeSubscription(
    subscription,
    await loadPresentationPreferences(input.actor.tenantId)
  );
}

export async function updateSubscription(input: {
  actor: SubscriptionActor;
  id: string;
  patch: unknown;
}): Promise<SubscriptionDto> {
  const subscription = await prisma.$transaction(async (tx) => {
    await requireManageableSubscription(input.actor, input.id, tx);
    const patch = subscriptionPatchSchema.parse(input.patch);
    await validateSubscriptionReferences(tx, {
      tenantId: input.actor.tenantId,
      mediaTitleId: patch.mediaTitleId ?? patch.mediaId,
      downloaderId: patch.downloaderId
    });

    return db(tx).subscription.update({
      where: {
        id_tenantId: {
          id: input.id,
          tenantId: input.actor.tenantId
        }
      },
      data: {
        title: patch.title,
        mediaTitleId:
          patch.mediaTitleId === null || patch.mediaId === null
            ? null
            : patch.mediaTitleId ?? patch.mediaId,
        downloaderId:
          patch.downloaderId === null ? null : patch.downloaderId,
        autoDownload: patch.autoDownload,
        enabled: patch.enabled
      },
      include: subscriptionInclude
    });
  });

  return serializeSubscription(
    subscription,
    await loadPresentationPreferences(input.actor.tenantId)
  );
}

export async function deleteSubscription(input: {
  actor: SubscriptionActor;
  id: string;
}) {
  await prisma.$transaction(async (tx) => {
    await requireManageableSubscription(input.actor, input.id, tx);
    const result = await db(tx).subscription.deleteMany({
      where: { id: input.id, tenantId: input.actor.tenantId }
    });
    if (result.count !== 1) throw notFound("Subscription");
  });
  return { ok: true };
}

export async function replaceSubscriptionRule(input: {
  actor: SubscriptionActor;
  id: string;
  rule: unknown;
}): Promise<SubscriptionDto> {
  const subscription = await prisma.$transaction(async (tx) => {
    await requireManageableSubscription(input.actor, input.id, tx);
    const normalized = normalizeRule(subscriptionRuleSchema.parse(input.rule));

    await db(tx).subscriptionRule.upsert({
      where: {
        subscriptionId_tenantId: {
          subscriptionId: input.id,
          tenantId: input.actor.tenantId
        }
      },
      create: {
        tenantId: input.actor.tenantId,
        subscriptionId: input.id,
        ...subscriptionRulePersistenceData(normalized)
      },
      update: subscriptionRulePersistenceData(normalized)
    });

    return db(tx).subscription.findUniqueOrThrow({
      where: {
        id_tenantId: {
          id: input.id,
          tenantId: input.actor.tenantId
        }
      },
      include: subscriptionInclude
    });
  });

  return serializeSubscription(
    subscription,
    await loadPresentationPreferences(input.actor.tenantId)
  );
}

export async function listSubscriptionHistory(input: {
  actor: SubscriptionActor;
  id: string;
}) {
  await requireManageableSubscription(input.actor, input.id);
  const decisions = await db().subscriptionMatchDecision.findMany({
    where: {
      tenantId: input.actor.tenantId,
      subscriptionId: input.id
    },
    orderBy: { createdAt: "desc" },
    take: 200
  });
  return decisions.map(serializeDecision);
}

export async function listMatchHistory(input: {
  actor: SubscriptionActor;
  query: MatchHistoryQuery;
}) {
  const subscriptionIds = await visibleSubscriptionIds(input);
  if (subscriptionIds.length === 0) return [];

  const decisions = await db().subscriptionMatchDecision.findMany({
    where: {
      tenantId: input.actor.tenantId,
      subscriptionId: { in: subscriptionIds },
      accepted: input.query.accepted,
      ...(input.query.subscriptionId
        ? { subscriptionId: input.query.subscriptionId }
        : {})
    },
    orderBy: { createdAt: "desc" },
    take: input.query.limit
  });
  return decisions.map(serializeDecision);
}

async function requireManageableSubscription(
  actor: SubscriptionActor,
  id: string,
  tx?: Prisma.TransactionClient
): Promise<SubscriptionRecord> {
  const subscription = await db(tx).subscription.findFirst({
    where: { id, tenantId: actor.tenantId },
    include: subscriptionInclude
  });
  if (!subscription) throw notFound("Subscription");
  if (!isAdminRole(actor.role) && subscription.createdByUserId !== actor.userId) {
    throw forbidden();
  }
  return subscription;
}

async function visibleSubscriptionIds(input: {
  actor: SubscriptionActor;
  query: MatchHistoryQuery;
}) {
  if (input.query.subscriptionId) {
    const subscription = await requireManageableSubscription(
      input.actor,
      input.query.subscriptionId
    );
    return [subscription.id];
  }

  const subscriptions = await db().subscription.findMany({
    where: {
      tenantId: input.actor.tenantId,
      createdByUserId: isAdminRole(input.actor.role)
        ? undefined
        : input.actor.userId
    },
    select: { id: true }
  });
  return subscriptions.map((subscription) => subscription.id);
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

function serializeSubscription(
  subscription: SubscriptionRecord,
  presentationPreferences: PresentationPreferences
): SubscriptionDto {
  const mediaPresentation = subscription.mediaTitle
    ? serializeMediaPresentation({
        mediaTitle: subscription.mediaTitle,
        providerIdentities: subscription.mediaTitle.providerIdentities
      }, presentationOptionsForMediaType(
        presentationPreferences,
        subscription.mediaTitle.mediaType
      ))
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
          providerId:
            mediaPresentation?.displaySource?.providerId ?? subscription.mediaTitle.id,
          kind: legacyKindFromMediaType(subscription.mediaTitle.mediaType),
          mediaType: subscription.mediaTitle.mediaType,
          title: mediaPresentation?.title ?? subscription.mediaTitle.title,
          year:
            mediaPresentation?.releaseYear ?? subscription.mediaTitle.releaseYear,
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

function serializeDecision(decision: {
  id: string;
  subscriptionId: string;
  itemId: string;
  accepted: boolean;
  reason: string;
  ruleSnapshot: Prisma.JsonValue | null;
  createdAt: Date;
}) {
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
