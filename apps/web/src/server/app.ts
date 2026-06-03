import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import { prisma } from "./db.js";
import { registerErrorHandler } from "./core/errors.js";
import { registerEventRoutes } from "./core/events.js";
import { requireTenantRole } from "./core/permissions.js";
import { registerAuthRoutes } from "./modules/auth/auth.routes.js";
import { registerWorkspaceRoutes } from "./modules/workspaces/workspaces.routes.js";
import { registerMemberRoutes } from "./modules/members/members.routes.js";
import { registerFeedRoutes } from "./modules/feeds/index.js";
import { registerItemRoutes } from "./modules/items/index.js";
import { registerMediaRoutes } from "./modules/media/index.js";
import { registerSubscriptionRoutes } from "./modules/subscriptions/index.js";
import { registerDownloaderRoutes } from "./modules/downloaders/index.js";
import { registerJobRoutes } from "./modules/jobs/index.js";

export async function buildApp(config: AppConfig) {
  const app = Fastify({
    logger: {
      redact: [
        "req.headers.cookie",
        "req.headers.authorization",
        "req.body.password",
        "req.body.url"
      ]
    }
  });

  registerErrorHandler(app);

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

  await registerAuthRoutes(app, config);
  await registerWorkspaceRoutes(app, config);
  await registerMemberRoutes(app);
  await registerEventRoutes(app);
  await registerFeedRoutes(app, config);
  await registerItemRoutes(app, config);
  await registerMediaRoutes(app, config);
  await registerSubscriptionRoutes(app, config);
  await registerDownloaderRoutes(app, config);
  await registerJobRoutes(app, config);
  registerDashboardRoutes(app);

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

function registerDashboardRoutes(app: FastifyInstance) {
  app.get(
    "/api/dashboard/timeline",
    { preHandler: requireTenantRole("VIEWER") },
    async (request) => {
      const items = await prisma.rssItem.findMany({
        where: { tenantId: request.tenantId! },
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
    }
  );

  app.get(
    "/api/dashboard/heat",
    { preHandler: requireTenantRole("VIEWER") },
    async (request) => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const items = await prisma.rssItem.findMany({
        where: { tenantId: request.tenantId!, firstSeenAt: { gte: since } },
        include: { parsedRelease: true, mediaMatch: true }
      });
      const heat = new Map<
        string,
        { title: string; count: number; posterPath?: string | null; latest: Date }
      >();
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
        if (!current.posterPath && item.mediaMatch?.posterPath) {
          current.posterPath = item.mediaMatch.posterPath;
        }
        heat.set(title, current);
      }
      return [...heat.values()].sort((a, b) => b.count - a.count).slice(0, 20);
    }
  );

  app.get(
    "/api/dashboard/posters",
    { preHandler: requireTenantRole("VIEWER") },
    async (request) => {
      const matches = await prisma.mediaMatch.findMany({
        where: {
          tenantId: request.tenantId!,
          status: { in: ["MATCHED", "CANDIDATE"] },
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
    }
  );
}
