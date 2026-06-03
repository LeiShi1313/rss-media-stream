import type { FastifyInstance } from "fastify";
import { requireTenantRole } from "../../core/permissions.js";
import { prisma } from "../../db.js";

export function registerDashboardRoutes(app: FastifyInstance) {
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
