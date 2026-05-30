import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { prisma } from "./db.js";
import { encryptSecret } from "./secrets.js";
import { registerAuthRoutes, requireAdmin, requireUser } from "./auth.js";
import { audit } from "./audit.js";
import { refreshFeed, urlPreview } from "./rssService.js";
import { matchItemWithTmdb, searchTmdb } from "./tmdb.js";
import { createDownloaderClient } from "./downloaders.js";
import { evaluateAutoDownloadsForItem, sendDownloadJob } from "./jobs.js";
import { addEventClient } from "./events.js";

const feedSchema = z.object({
  name: z.string().min(1).max(120),
  url: z.string().url(),
  pollIntervalSeconds: z.number().int().min(60).max(86400).default(300),
  enabled: z.boolean().default(true)
});

const feedPatchSchema = feedSchema.partial();

const downloaderSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(["QBITTORRENT", "TRANSMISSION"]),
  baseUrl: z.string().url(),
  username: z.string().optional(),
  password: z.string().optional(),
  defaultSavePath: z.string().optional(),
  category: z.string().optional(),
  tags: z.string().optional(),
  enabled: z.boolean().default(true)
});

const subscriptionSchema = z.object({
  downloaderId: z.string().optional(),
  mediaProvider: z.string().default("tmdb"),
  mediaProviderId: z.string().min(1),
  mediaKind: z.enum(["MOVIE", "TV", "UNKNOWN"]),
  title: z.string().min(1),
  year: z.number().int().optional(),
  includeRegex: z.string().optional(),
  excludeRegex: z.string().optional(),
  minQuality: z.string().optional(),
  season: z.number().int().optional(),
  episodeStart: z.number().int().optional(),
  episodeEnd: z.number().int().optional(),
  autoDownload: z.boolean().default(true),
  enabled: z.boolean().default(true)
});

export async function buildApp(config: AppConfig) {
  const app = Fastify({
    logger: {
      redact: ["req.headers.cookie", "req.body.password", "req.body.url"]
    }
  });

  await app.register(fastifyCors, {
    origin: config.clientOrigin,
    credentials: true
  });
  await app.register(fastifyCookie);
  await app.register(fastifyJwt, {
    secret: config.jwtSecret,
    cookie: {
      cookieName: "session",
      signed: false
    }
  });

  app.get("/api/health", async () => ({ ok: true }));
  registerAuthRoutes(app, config);

  app.get("/events", { preHandler: requireUser }, async (_request, reply) => {
    addEventClient(reply);
  });

  app.get("/api/feeds", { preHandler: requireUser }, async (request) => {
    const feeds = await prisma.rssFeed.findMany({
      where: { userId: request.currentUser!.id },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { items: true } } }
    });
    return feeds.map((feed) => ({
      id: feed.id,
      name: feed.name,
      urlPreview: urlPreview(feed.encryptedUrl, config),
      pollIntervalSeconds: feed.pollIntervalSeconds,
      enabled: feed.enabled,
      lastPolledAt: feed.lastPolledAt,
      lastError: feed.lastError,
      itemCount: feed._count.items
    }));
  });

  app.post("/api/feeds", { preHandler: requireUser }, async (request) => {
    requireAdmin(request);
    const input = feedSchema.parse(request.body);
    const feed = await prisma.rssFeed.create({
      data: {
        userId: request.currentUser!.id,
        name: input.name,
        encryptedUrl: encryptSecret(input.url, config.appSecret),
        pollIntervalSeconds: input.pollIntervalSeconds,
        enabled: input.enabled
      }
    });
    await audit(prisma, {
      userId: request.currentUser!.id,
      action: "feed.create",
      entityType: "feed",
      entityId: feed.id
    });
    return { id: feed.id };
  });

  app.patch("/api/feeds/:id", { preHandler: requireUser }, async (request) => {
    requireAdmin(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const input = feedPatchSchema.parse(request.body);
    const feed = await prisma.rssFeed.update({
      where: { id: params.id, userId: request.currentUser!.id },
      data: {
        name: input.name,
        encryptedUrl: input.url ? encryptSecret(input.url, config.appSecret) : undefined,
        pollIntervalSeconds: input.pollIntervalSeconds,
        enabled: input.enabled
      }
    });
    return { id: feed.id };
  });

  app.post("/api/feeds/:id/refresh", { preHandler: requireUser }, async (request) => {
    requireAdmin(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const feed = await prisma.rssFeed.findFirst({
      where: { id: params.id, userId: request.currentUser!.id }
    });
    if (!feed) throw Object.assign(new Error("Feed not found"), { statusCode: 404 });
    return refreshFeed(feed.id, config);
  });

  app.get("/api/items", { preHandler: requireUser }, async (request) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        unmatched: z.coerce.boolean().optional()
      })
      .parse(request.query);
    const items = await prisma.rssItem.findMany({
      where: {
        feed: { userId: request.currentUser!.id },
        mediaMatch: query.unmatched ? null : undefined
      },
      orderBy: { firstSeenAt: "desc" },
      take: query.limit,
      include: {
        feed: true,
        parsedRelease: true,
        mediaMatch: true,
        downloadJobs: { orderBy: { createdAt: "desc" }, take: 3 }
      }
    });
    return items.map(serializeItem);
  });

  app.post("/api/items/:id/match", { preHandler: requireUser }, async (request) => {
    requireAdmin(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    await assertOwnsItem(params.id, request.currentUser!.id);
    const match = await matchItemWithTmdb(prisma, config, params.id);
    await evaluateAutoDownloadsForItem(params.id, config);
    return match;
  });

  app.post("/api/items/:id/download", { preHandler: requireUser }, async (request) => {
    requireAdmin(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const input = z.object({ downloaderId: z.string() }).parse(request.body);
    await assertOwnsItem(params.id, request.currentUser!.id);
    const downloader = await prisma.downloader.findFirst({
      where: { id: input.downloaderId, userId: request.currentUser!.id, enabled: true }
    });
    if (!downloader) throw Object.assign(new Error("Downloader not found"), { statusCode: 404 });
    const job = await prisma.downloadJob.create({
      data: {
        itemId: params.id,
        downloaderId: downloader.id,
        status: "QUEUED"
      }
    });
    return sendDownloadJob(job.id, config);
  });

  app.get("/api/media/search", { preHandler: requireUser }, async (request) => {
    const query = z
      .object({
        q: z.string().min(1),
        kind: z.enum(["MOVIE", "TV", "UNKNOWN"]).optional(),
        year: z.coerce.number().int().optional()
      })
      .parse(request.query);
    return searchTmdb(config, { query: query.q, kind: query.kind, year: query.year });
  });

  app.get("/api/subscriptions", { preHandler: requireUser }, async (request) => {
    return prisma.subscription.findMany({
      where: { userId: request.currentUser!.id },
      orderBy: { createdAt: "desc" },
      include: { downloader: { select: { id: true, name: true, type: true } } }
    });
  });

  app.post("/api/subscriptions", { preHandler: requireUser }, async (request) => {
    requireAdmin(request);
    const input = subscriptionSchema.parse(request.body);
    const subscription = await prisma.subscription.create({
      data: {
        userId: request.currentUser!.id,
        ...input
      }
    });
    return subscription;
  });

  app.patch("/api/subscriptions/:id", { preHandler: requireUser }, async (request) => {
    requireAdmin(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const input = subscriptionSchema.partial().parse(request.body);
    return prisma.subscription.update({
      where: { id: params.id, userId: request.currentUser!.id },
      data: input
    });
  });

  app.get("/api/subscriptions/:id/history", { preHandler: requireUser }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const subscription = await prisma.subscription.findFirst({
      where: { id: params.id, userId: request.currentUser!.id },
      include: {
        jobs: {
          orderBy: { createdAt: "desc" },
          include: { item: { include: { parsedRelease: true, mediaMatch: true } } }
        }
      }
    });
    if (!subscription) throw Object.assign(new Error("Subscription not found"), { statusCode: 404 });
    return subscription.jobs.map((job) => ({ ...job, item: serializeItem(job.item as any) }));
  });

  app.get("/api/downloaders", { preHandler: requireUser }, async (request) => {
    const downloaders = await prisma.downloader.findMany({
      where: { userId: request.currentUser!.id },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { jobs: true } } }
    });
    return downloaders.map((downloader) => ({
      id: downloader.id,
      name: downloader.name,
      type: downloader.type,
      baseUrl: downloader.baseUrl,
      username: downloader.username,
      defaultSavePath: downloader.defaultSavePath,
      category: downloader.category,
      tags: downloader.tags,
      enabled: downloader.enabled,
      jobCount: downloader._count.jobs
    }));
  });

  app.post("/api/downloaders", { preHandler: requireUser }, async (request) => {
    requireAdmin(request);
    const input = downloaderSchema.parse(request.body);
    const downloader = await prisma.downloader.create({
      data: {
        userId: request.currentUser!.id,
        name: input.name,
        type: input.type,
        baseUrl: input.baseUrl,
        username: input.username,
        encryptedPassword: input.password
          ? encryptSecret(input.password, config.appSecret)
          : undefined,
        defaultSavePath: input.defaultSavePath,
        category: input.category,
        tags: input.tags,
        enabled: input.enabled
      }
    });
    return { id: downloader.id };
  });

  app.post("/api/downloaders/:id/test", { preHandler: requireUser }, async (request) => {
    requireAdmin(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const downloader = await prisma.downloader.findFirst({
      where: { id: params.id, userId: request.currentUser!.id }
    });
    if (!downloader) throw Object.assign(new Error("Downloader not found"), { statusCode: 404 });
    return createDownloaderClient(downloader, config).test();
  });

  app.get("/api/downloaders/:id/torrents", { preHandler: requireUser }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const downloader = await prisma.downloader.findFirst({
      where: { id: params.id, userId: request.currentUser!.id }
    });
    if (!downloader) throw Object.assign(new Error("Downloader not found"), { statusCode: 404 });
    return createDownloaderClient(downloader, config).listTorrents();
  });

  app.get("/api/dashboard/timeline", { preHandler: requireUser }, async (request) => {
    const items = await prisma.rssItem.findMany({
      where: { feed: { userId: request.currentUser!.id } },
      orderBy: { firstSeenAt: "desc" },
      take: 300,
      select: { firstSeenAt: true }
    });
    const buckets = new Map<string, number>();
    for (const item of items) {
      const key = item.firstSeenAt.toISOString().slice(0, 13) + ":00:00.000Z";
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return [...buckets.entries()].map(([time, count]) => ({ time, count })).reverse();
  });

  app.get("/api/dashboard/heat", { preHandler: requireUser }, async (request) => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const items = await prisma.rssItem.findMany({
      where: { feed: { userId: request.currentUser!.id }, firstSeenAt: { gte: since } },
      include: { parsedRelease: true, mediaMatch: true }
    });
    const heat = new Map<string, { title: string; count: number; posterPath?: string | null; latest: Date }>();
    for (const item of items) {
      const title = item.mediaMatch?.title ?? item.parsedRelease?.title ?? item.rawTitle;
      const current = heat.get(title) ?? {
        title,
        count: 0,
        posterPath: item.mediaMatch?.posterPath,
        latest: item.firstSeenAt
      };
      current.count += 1;
      if (item.firstSeenAt > current.latest) current.latest = item.firstSeenAt;
      if (!current.posterPath && item.mediaMatch?.posterPath) current.posterPath = item.mediaMatch.posterPath;
      heat.set(title, current);
    }
    return [...heat.values()].sort((a, b) => b.count - a.count).slice(0, 20);
  });

  app.get("/api/dashboard/posters", { preHandler: requireUser }, async (request) => {
    const matches = await prisma.mediaMatch.findMany({
      where: {
        status: { in: ["MATCHED", "CANDIDATE"] },
        item: { feed: { userId: request.currentUser!.id } },
        posterPath: { not: null }
      },
      orderBy: { updatedAt: "desc" },
      take: 40,
      include: { item: { include: { parsedRelease: true } } }
    });
    return matches.map((match) => ({
      id: match.id,
      title: match.title,
      year: match.year,
      kind: match.kind,
      posterUrl: `https://image.tmdb.org/t/p/w342${match.posterPath}`,
      score: match.score,
      rawTitle: match.item.rawTitle
    }));
  });

  const clientRoot = join(dirname(fileURLToPath(import.meta.url)), "../client");
  if (existsSync(clientRoot)) {
    await app.register(fastifyStatic, { root: clientRoot, prefix: "/" });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api") || request.url.startsWith("/events")) {
        reply.code(404).send({ message: "Not found" });
      } else {
        reply.sendFile("index.html");
      }
    });
  }

  return app;
}

async function assertOwnsItem(itemId: string, userId: string) {
  const item = await prisma.rssItem.findFirst({
    where: { id: itemId, feed: { userId } },
    select: { id: true }
  });
  if (!item) throw Object.assign(new Error("Item not found"), { statusCode: 404 });
}

function serializeItem(item: any) {
  return {
    id: item.id,
    feed: item.feed ? { id: item.feed.id, name: item.feed.name } : undefined,
    rawTitle: item.rawTitle,
    publishDate: item.publishDate,
    firstSeenAt: item.firstSeenAt,
    sizeBytes: item.sizeBytes?.toString?.(),
    parseStatus: item.parseStatus,
    parseConfidence: item.parseConfidence,
    parsedRelease: item.parsedRelease,
    mediaMatch: item.mediaMatch,
    downloadJobs: item.downloadJobs?.map((job: any) => ({
      id: job.id,
      status: job.status,
      error: job.error,
      clientHash: job.clientHash,
      createdAt: job.createdAt
    }))
  };
}
