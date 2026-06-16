import type { FastifyInstance } from "fastify";
import { requireTenantRole } from "../../core/permissions.js";
import { prisma } from "../../db.js";
import { getPresentationProviderOrder } from "../../integrations/providers/policy.js";
import {
  providerOrderForMediaType,
  serializeMediaPresentation,
  legacyKindFromMediaType,
  type PresentationOrders
} from "../media/presentation.js";

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
      const heat = new Map<
        string,
        { title: string; count: number; posterUrl?: string | null; latest: Date }
      >();
      const presentationOrders = await preloadPresentationOrders(request.tenantId!);
      for (const item of items) {
        const match = item.parsedRelease?.matches[0];
        const presentation = serializeMediaPresentation({
          mediaTitle: match?.mediaTitle,
          providerMetadata: match?.providerMediaMetadata,
          release: item.parsedRelease,
          rawTitle: item.rawTitle
        }, {
          providerOrder: providerOrderForMediaType(
            presentationOrders,
            match?.mediaType ?? match?.mediaTitle?.mediaType ?? item.parsedRelease?.mediaType
          )
        });
        const title = presentation.title;
        const current = heat.get(title) ?? {
          title,
          count: 0,
          posterUrl: presentation.posterUrl,
          latest: item.firstSeenAt
        };
        current.count += 1;
        if (item.firstSeenAt > current.latest) current.latest = item.firstSeenAt;
        if (!current.posterUrl && presentation.posterUrl) {
          current.posterUrl = presentation.posterUrl;
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
      const matches = await prisma.parsedReleaseMatch.findMany({
        where: {
          tenantId: request.tenantId!,
          status: "MATCHED",
          invalidatedAt: null,
          providerMediaMetadataId: { not: null }
        },
        orderBy: { updatedAt: "desc" },
        take: 40,
        include: {
          mediaTitle: {
            include: { providerIdentities: { include: { metadata: true } } }
          },
          mediaProviderIdentity: true,
          providerMediaMetadata: { include: { mediaProviderIdentity: true } },
          providerTitle: true,
          parsedRelease: { include: { item: true } }
        }
      });
      const presentationOrders = await preloadPresentationOrders(request.tenantId!);
      return matches
        .map((match) => {
          const presentation = serializeMediaPresentation({
            mediaTitle: match.mediaTitle,
            providerMetadata: match.providerMediaMetadata,
            release: match.parsedRelease,
            rawTitle: match.parsedRelease.item.rawTitle
          }, {
            providerOrder: providerOrderForMediaType(
              presentationOrders,
              match.mediaType ?? match.mediaTitle?.mediaType ?? match.parsedRelease?.mediaType
            )
          });
          if (!presentation.posterUrl) return null;
          return {
            id: match.id,
            title: presentation.title,
            year: presentation.releaseYear,
            kind: legacyKindFromMediaType(match.mediaType ?? match.mediaTitle?.mediaType ?? "UNKNOWN"),
            posterUrl: presentation.posterUrl,
            score: match.confidence ?? 0,
            rawTitle: match.parsedRelease.item.rawTitle
          };
        })
        .filter(Boolean);
    }
  );
}

async function preloadPresentationOrders(tenantId: string): Promise<PresentationOrders> {
  return {
    MOVIE: await getPresentationProviderOrder(tenantId, "MOVIE"),
    TV_SERIES: await getPresentationProviderOrder(tenantId, "TV_SERIES")
  };
}
