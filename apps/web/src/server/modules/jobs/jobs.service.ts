import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { redactSecrets } from "@rss-media/shared/redact";
import type { AppConfig } from "../../config.js";
import { prisma } from "../../db.js";
import { createDownloaderClient } from "../../downloaders.js";
import { decryptSecret } from "../../secrets.js";
import { conflict, forbidden, notFound } from "../../core/errors.js";
import type { TenantRole } from "../../core/context.js";
import { isAdminRole } from "../../core/permissions.js";
import { publishTenantEvent } from "../../core/events.js";

export type DownloadSource = "MANUAL" | "SUBSCRIPTION" | "RETRY";
type DownloadStatus =
  | "QUEUED"
  | "SENDING"
  | "SENT"
  | "FAILED"
  | "SKIPPED"
  | "DOWNLOADING"
  | "COMPLETE";

export type CreateDownloadJobInput = {
  tenantId: string;
  itemId: string;
  downloaderId?: string;
  subscriptionId?: string;
  createdByUserId?: string;
  source: DownloadSource;
  forceDuplicate?: boolean;
};

type JobActor = {
  tenantId: string;
  userId: string;
  role: TenantRole;
};

type DownloadJobRecord = {
  id: string;
  tenantId: string;
  itemId: string;
  subscriptionId: string | null;
  downloaderId: string;
  createdByUserId: string | null;
  source: DownloadSource;
  status: DownloadStatus;
  clientHash: string | null;
  attemptCount?: number;
  lastAttemptAt?: Date | null;
  nextRetryAt?: Date | null;
  sentAt?: Date | null;
  completedAt?: Date | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  item?: {
    id: string;
    rawTitle: string;
    feed?: { id: string; name: string } | null;
  };
  downloader?: { id: string; name: string; type: string };
  subscription?: { id: string; title: string } | null;
};

export async function createDownloadJob(input: CreateDownloadJobInput) {
  return prisma.$transaction(async (tx) => {
    const item = await tx.rssItem.findFirst({
      where: { id: input.itemId, tenantId: input.tenantId },
      select: { id: true, infoHash: true }
    });
    if (!item) throw notFound("Item");

    const downloaderId = await resolveDownloaderId(tx, {
      tenantId: input.tenantId,
      requestedDownloaderId: input.downloaderId
    });

    if (input.subscriptionId) {
      const subscription = await tx.subscription.findFirst({
        where: { id: input.subscriptionId, tenantId: input.tenantId },
        select: { id: true }
      });
      if (!subscription) throw notFound("Subscription");
    }

    const dedupeKey = input.forceDuplicate
      ? null
      : buildDownloadDedupeKey({
          itemId: item.id,
          infoHash: item.infoHash,
          downloaderId,
          subscriptionId: input.subscriptionId,
          source: input.source
        });

    if (dedupeKey) {
      const existing = await tx.downloadJob.findFirst({
        where: { tenantId: input.tenantId, dedupeKey },
        select: { id: true, status: true }
      });
      if (existing) throwDuplicate(existing.id);
    }

    try {
      return await tx.downloadJob.create({
        data: {
          tenantId: input.tenantId,
          itemId: item.id,
          downloaderId,
          subscriptionId: input.subscriptionId,
          createdByUserId: input.createdByUserId,
          source: input.source,
          status: "QUEUED",
          infoHash: item.infoHash,
          dedupeKey
        }
      });
    } catch (error) {
      if (dedupeKey && isUniqueConstraintError(error)) {
        const existing = await tx.downloadJob.findFirst({
          where: { tenantId: input.tenantId, dedupeKey },
          select: { id: true }
        });
        throwDuplicate(existing?.id);
      }
      throw error;
    }
  });
}

export async function sendDownloadJob(jobId: string, config: AppConfig) {
  const claimed = await prisma.downloadJob.updateMany({
    where: { id: jobId, status: { in: ["QUEUED", "FAILED"] } },
    data: {
      status: "SENDING",
      attemptCount: { increment: 1 },
      lastAttemptAt: new Date(),
      nextRetryAt: null,
      error: null
    }
  });

  if (claimed.count !== 1) {
    throw conflict("JOB_NOT_SENDABLE", "Download job is not sendable");
  }

  const job = await prisma.downloadJob.findUnique({
    where: { id: jobId },
    include: { item: true, downloader: true }
  });
  if (!job) throw notFound("Download job");

  try {
    const torrentUrl = decryptSecret(job.item.encryptedTorrentUrl, config.appSecret);
    const response = await fetch(torrentUrl);
    if (!response.ok) {
      throw new Error(`Torrent fetch failed with ${response.status}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const client = createDownloaderClient(job.downloader, config);
    const added = await client.addTorrent(bytes, {
      savePath: job.downloader.defaultSavePath,
      category: job.downloader.category,
      tags: normalizeTagsForClient(job.downloader.tags)
    });

    const updated = await prisma.downloadJob.update({
      where: { id: job.id },
      data: {
        status: "SENT",
        clientHash: added.hash ?? null,
        sentAt: new Date(),
        error: null
      }
    });

    publishTenantEvent({
      tenantId: job.tenantId,
      type: "download.sent",
      data: {
        jobId: updated.id,
        itemId: job.itemId,
        downloaderId: job.downloaderId,
        status: updated.status,
        clientHash: updated.clientHash
      }
    });

    return getDownloadJob(job.tenantId, job.id);
  } catch (error) {
    const message = redactSecrets(
      error instanceof Error ? error.message : String(error)
    );

    const failed = await prisma.downloadJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        error: message
      }
    });

    publishTenantEvent({
      tenantId: job.tenantId,
      type: "download.failed",
      data: {
        jobId: failed.id,
        itemId: job.itemId,
        downloaderId: job.downloaderId,
        status: failed.status,
        message
      }
    });

    return getDownloadJob(job.tenantId, job.id);
  }
}

export async function listDownloadJobs(tenantId: string) {
  const jobs = await prisma.downloadJob.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      item: {
        select: {
          id: true,
          rawTitle: true,
          feed: { select: { id: true, name: true } }
        }
      },
      downloader: { select: { id: true, name: true, type: true } },
      subscription: { select: { id: true, title: true } }
    }
  });

  return jobs.map(serializeDownloadJob);
}

export async function getDownloadJob(tenantId: string, jobId: string) {
  const job = await prisma.downloadJob.findFirst({
    where: { id: jobId, tenantId },
    include: {
      item: {
        select: {
          id: true,
          rawTitle: true,
          feed: { select: { id: true, name: true } }
        }
      },
      downloader: { select: { id: true, name: true, type: true } },
      subscription: { select: { id: true, title: true } }
    }
  });

  if (!job) throw notFound("Download job");
  return serializeDownloadJob(job);
}

export async function retryDownloadJob(
  jobId: string,
  actor: JobActor,
  config: AppConfig
) {
  await assertCanMutateJob(jobId, actor);
  return sendDownloadJob(jobId, config);
}

export async function skipDownloadJob(jobId: string, actor: JobActor) {
  const job = await assertCanMutateJob(jobId, actor);

  const skipped = await prisma.downloadJob.updateMany({
    where: {
      id: job.id,
      tenantId: actor.tenantId,
      status: { in: ["QUEUED", "FAILED"] }
    },
    data: {
      status: "SKIPPED",
      error: null
    }
  });

  if (skipped.count !== 1) {
    throw conflict("JOB_NOT_SKIPPABLE", "Download job is not skippable");
  }

  const updated = await prisma.downloadJob.findUnique({
    where: { id: job.id }
  });
  if (!updated) throw notFound("Download job");

  publishTenantEvent({
    tenantId: actor.tenantId,
    type: "download.skipped",
    data: {
      jobId: updated.id,
      itemId: updated.itemId,
      downloaderId: updated.downloaderId,
      status: updated.status
    }
  });

  return getDownloadJob(actor.tenantId, job.id);
}

export function buildDownloadDedupeKey(input: {
  itemId: string;
  infoHash?: string | null;
  downloaderId: string;
  subscriptionId?: string;
  source: DownloadSource;
}) {
  const itemIdentity = input.infoHash
    ? `infoHash:${input.infoHash}`
    : `item:${input.itemId}`;
  const subscriptionIdentity = input.subscriptionId
    ? `subscription:${input.subscriptionId}`
    : "subscription:none";
  const raw = [
    "download-job-v1",
    input.source,
    itemIdentity,
    `downloader:${input.downloaderId}`,
    subscriptionIdentity
  ].join("\0");

  return `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

async function resolveDownloaderId(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; requestedDownloaderId?: string }
) {
  if (input.requestedDownloaderId) {
    const downloader = await tx.downloader.findFirst({
      where: {
        id: input.requestedDownloaderId,
        tenantId: input.tenantId,
        enabled: true
      },
      select: { id: true }
    });
    if (!downloader) throw notFound("Downloader");
    return downloader.id;
  }

  const settings = await tx.tenantSettings.findUnique({
    where: { tenantId: input.tenantId },
    select: { defaultDownloaderId: true }
  });

  if (!settings?.defaultDownloaderId) {
    throw conflict(
      "DEFAULT_DOWNLOADER_REQUIRED",
      "Default downloader is not configured"
    );
  }

  const downloader = await tx.downloader.findFirst({
    where: {
      id: settings.defaultDownloaderId,
      tenantId: input.tenantId,
      enabled: true
    },
    select: { id: true }
  });

  if (!downloader) {
    throw conflict(
      "DEFAULT_DOWNLOADER_UNAVAILABLE",
      "Default downloader is unavailable"
    );
  }

  return downloader.id;
}

async function assertCanMutateJob(jobId: string, actor: JobActor) {
  const job = await prisma.downloadJob.findFirst({
    where: { id: jobId, tenantId: actor.tenantId },
    select: {
      id: true,
      createdByUserId: true,
      source: true
    }
  });
  if (!job) throw notFound("Download job");

  if (isAdminRole(actor.role)) return job;
  if (job.source === "MANUAL" && job.createdByUserId === actor.userId) {
    return job;
  }

  throw forbidden();
}

function serializeDownloadJob(job: DownloadJobRecord) {
  return {
    id: job.id,
    itemId: job.itemId,
    subscriptionId: job.subscriptionId,
    downloaderId: job.downloaderId,
    createdByUserId: job.createdByUserId,
    source: job.source,
    status: job.status,
    clientHash: job.clientHash,
    attemptCount: job.attemptCount,
    lastAttemptAt: job.lastAttemptAt,
    nextRetryAt: job.nextRetryAt,
    sentAt: job.sentAt,
    completedAt: job.completedAt,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    item: job.item
      ? {
          id: job.item.id,
          rawTitle: job.item.rawTitle,
          feed: job.item.feed
        }
      : undefined,
    downloader: job.downloader,
    subscription: job.subscription
  };
}

function normalizeTagsForClient(tags: string[] | null | undefined) {
  if (!tags) return undefined;
  return tags;
}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function throwDuplicate(existingJobId?: string) {
  throw conflict("DOWNLOAD_DUPLICATE", "Download already exists", {
    existingJobId
  });
}
