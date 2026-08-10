import type { MediaType, ProviderSource } from "@rss-media/shared/types";
import type { AppConfig } from "../server/config.js";
import { prisma } from "../server/db.js";
import { getActiveRatingProviderSources } from "../server/integrations/providers/ratingPreference.js";
import { enrichMediaTitleRating } from "../server/modules/media/ratingEnrichment.js";
import { LOW_CONFIDENCE_THRESHOLD } from "../server/modules/media/matchingPolicy.js";

const RATING_MEDIA_TYPES = ["MOVIE", "TV_SERIES"] as const satisfies readonly MediaType[];
const backfillCursors = new Map<string, string>();

export async function backfillMissingRatings(
  config: AppConfig,
  options: { batchSize?: number } = {}
) {
  const batchSize = options.batchSize ?? 5;
  const tenants = await prisma.tenant.findMany({ select: { id: true } });

  for (const tenant of tenants) {
    const ratingProviderSources = await getActiveRatingProviderSources(
      tenant.id,
      RATING_MEDIA_TYPES
    );
    for (const mediaType of RATING_MEDIA_TYPES) {
      const ratingProviderSource = ratingProviderSources[mediaType];
      if (!ratingProviderSource) continue;
      await backfillRatingPreference({
        config,
        tenantId: tenant.id,
        mediaType,
        ratingProviderSource,
        batchSize
      });
    }
  }
}

async function backfillRatingPreference(input: {
  config: AppConfig;
  tenantId: string;
  mediaType: MediaType;
  ratingProviderSource: ProviderSource;
  batchSize: number;
}) {
  const cursorKey = `${input.tenantId}:${input.mediaType}:${input.ratingProviderSource}`;
  const cursor = backfillCursors.get(cursorKey);
  const mediaTitles = await prisma.mediaTitle.findMany({
    where: {
      mediaType: input.mediaType,
      ...(cursor ? { id: { gt: cursor } } : {}),
      releaseMatches: {
        some: {
          tenantId: input.tenantId,
          status: "MATCHED",
          confidence: { gte: LOW_CONFIDENCE_THRESHOLD },
          invalidatedAt: null
        }
      },
      providerIdentities: {
        none: {
          metadata: { some: { providerSource: input.ratingProviderSource } }
        }
      }
    },
    orderBy: { id: "asc" },
    take: input.batchSize,
    select: {
      id: true,
      mediaType: true,
      title: true,
      releaseYear: true,
      releaseMatches: {
        where: {
          tenantId: input.tenantId,
          status: "MATCHED",
          confidence: { gte: LOW_CONFIDENCE_THRESHOLD },
          invalidatedAt: null
        },
        orderBy: [{ matchedAt: "desc" }, { updatedAt: "desc" }],
        take: 1,
        select: {
          parsedRelease: {
            select: {
              title: true,
              providerSearchTitles: true,
              year: true,
              season: true,
              episode: true
            }
          }
        }
      }
    }
  });

  if (mediaTitles.length === 0) {
    backfillCursors.delete(cursorKey);
    return;
  }
  const lastMediaTitle = mediaTitles.at(-1);
  if (lastMediaTitle) backfillCursors.set(cursorKey, lastMediaTitle.id);

  for (const mediaTitle of mediaTitles) {
    const release = mediaTitle.releaseMatches[0]?.parsedRelease;
    await enrichMediaTitleRating({
      config: input.config,
      tenantId: input.tenantId,
      mediaTitleId: mediaTitle.id,
      mediaType: input.mediaType,
      title: release?.title ?? mediaTitle.title,
      titleCandidates: release?.providerSearchTitles,
      year: release?.year ?? mediaTitle.releaseYear ?? undefined,
      season: release?.season ?? undefined,
      episode: release?.episode ?? undefined,
      ratingProviderSource: input.ratingProviderSource
    });
  }
}
