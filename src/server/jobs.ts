import { evaluateSubscriptionRule } from "../shared/subscriptionRules.js";
import { redactSecrets } from "../shared/redact.js";
import type { AppConfig } from "./config.js";
import { prisma } from "./db.js";
import { decryptSecret } from "./secrets.js";
import { createDownloaderClient } from "./downloaders.js";
import { publishEvent } from "./events.js";

export async function evaluateAutoDownloadsForItem(itemId: string, config: AppConfig) {
  const item = await prisma.rssItem.findUnique({
    where: { id: itemId },
    include: {
      feed: true,
      parsedRelease: true,
      mediaMatch: true
    }
  });
  if (!item?.parsedRelease || !item.mediaMatch) return [];

  const subscriptions = await prisma.subscription.findMany({
    where: {
      enabled: true,
      autoDownload: true,
      userId: item.feed.userId,
      mediaProvider: item.mediaMatch.provider,
      mediaProviderId: item.mediaMatch.providerId
    },
    include: { downloader: true }
  });

  const created: string[] = [];
  for (const subscription of subscriptions) {
    const decision = evaluateSubscriptionRule(
      {
        mediaProvider: subscription.mediaProvider,
        mediaProviderId: subscription.mediaProviderId,
        mediaKind: subscription.mediaKind,
        includeRegex: subscription.includeRegex,
        excludeRegex: subscription.excludeRegex,
        minQuality: subscription.minQuality,
        season: subscription.season,
        episodeStart: subscription.episodeStart,
        episodeEnd: subscription.episodeEnd
      },
      {
        rawTitle: item.rawTitle,
        release: {
          title: item.parsedRelease.title,
          year: item.parsedRelease.year ?? undefined,
          kind: item.parsedRelease.kind,
          season: item.parsedRelease.season ?? undefined,
          episode: item.parsedRelease.episode ?? undefined,
          episodeEnd: item.parsedRelease.episodeEnd ?? undefined,
          quality: item.parsedRelease.quality ?? undefined,
          source: item.parsedRelease.source ?? undefined,
          codec: item.parsedRelease.codec ?? undefined,
          audio: item.parsedRelease.audio ?? undefined,
          releaseGroup: item.parsedRelease.releaseGroup ?? undefined,
          confidence: item.parsedRelease.confidence
        },
        match: {
          provider: item.mediaMatch.provider,
          providerId: item.mediaMatch.providerId,
          kind: item.mediaMatch.kind,
          score: item.mediaMatch.score,
          status: item.mediaMatch.status
        }
      }
    );
    if (!decision.accepted) continue;

    const downloader =
      subscription.downloader ??
      (await prisma.downloader.findFirst({
        where: { userId: item.feed.userId, enabled: true },
        orderBy: { createdAt: "asc" }
      }));
    if (!downloader) continue;

    const existing = await prisma.downloadJob.findFirst({
      where: { itemId: item.id, subscriptionId: subscription.id }
    });
    if (existing) continue;

    const job = await prisma.downloadJob.create({
      data: {
        itemId: item.id,
        subscriptionId: subscription.id,
        downloaderId: downloader.id,
        status: "QUEUED"
      }
    });
    created.push(job.id);
    await sendDownloadJob(job.id, config);
  }
  return created;
}

export async function sendDownloadJob(jobId: string, config: AppConfig) {
  const job = await prisma.downloadJob.findUnique({
    where: { id: jobId },
    include: { item: true, downloader: true }
  });
  if (!job) throw new Error("Download job not found");

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
      tags: job.downloader.tags
    });
    const updated = await prisma.downloadJob.update({
      where: { id: job.id },
      data: {
        status: "SENT",
        clientHash: added.hash
      }
    });
    publishEvent({
      type: "download.sent",
      data: { jobId: updated.id, itemId: job.itemId, downloaderId: job.downloaderId }
    });
    return updated;
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error));
    const failed = await prisma.downloadJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: message }
    });
    publishEvent({
      type: "download.failed",
      data: { jobId: failed.id, itemId: job.itemId, message }
    });
    return failed;
  }
}
