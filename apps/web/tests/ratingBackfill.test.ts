import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/server/config.js";

const mocks = vi.hoisted(() => ({
  prisma: {
    tenant: { findMany: vi.fn() },
    mediaTitle: { findMany: vi.fn() }
  },
  getActiveRatingProviderSources: vi.fn(),
  enrichMediaTitleRating: vi.fn()
}));

vi.mock("../src/server/db.js", () => ({ prisma: mocks.prisma }));
vi.mock("../src/server/integrations/providers/ratingPreference.js", () => ({
  getActiveRatingProviderSources: mocks.getActiveRatingProviderSources
}));
vi.mock("../src/server/modules/media/media.service.js", () => ({
  enrichMediaTitleRating: mocks.enrichMediaTitleRating
}));

const { backfillMissingRatings } = await import("../src/worker/ratingBackfill.js");

const config = {
  databaseUrl: "postgresql://example.invalid/rss",
  appSecret: "test-app-secret-32-characters-long",
  jwtSecret: "test-jwt-secret-32-characters-long",
  apiHost: "127.0.0.1",
  apiPort: 4000,
  clientOrigins: ["http://rss.localhost:5173"],
  pollIntervalSeconds: 600,
  nodeEnv: "test"
} satisfies AppConfig;

describe("rating backfill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.tenant.findMany.mockResolvedValue([{ id: "tenant-1" }]);
    mocks.getActiveRatingProviderSources.mockResolvedValue({
      MOVIE: "ptgen_douban",
      TV_SERIES: "ptgen_douban"
    });
    mocks.prisma.mediaTitle.findMany.mockImplementation(async (args: any) =>
      args.where.mediaType === "MOVIE"
        ? [{
            id: "media-1",
            mediaType: "MOVIE",
            title: "The Matrix",
            releaseYear: 1999,
            releaseMatches: [{
              parsedRelease: {
                title: "The Matrix",
                providerSearchTitles: [],
                year: 1999,
                season: null,
                episode: null
              }
            }]
          }]
        : []
    );
    mocks.enrichMediaTitleRating.mockResolvedValue(true);
  });

  it("processes a small batch of unmatched selected-source metadata", async () => {
    await backfillMissingRatings(config, { batchSize: 2 });

    expect(mocks.prisma.mediaTitle.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        mediaType: "MOVIE",
        providerIdentities: {
          none: {
            metadata: { some: { providerSource: "ptgen_douban" } }
          }
        }
      }),
      orderBy: { id: "asc" },
      take: 2
    }));
    expect(mocks.enrichMediaTitleRating).toHaveBeenCalledWith(expect.objectContaining({
      config,
      tenantId: "tenant-1",
      mediaTitleId: "media-1",
      mediaType: "MOVIE",
      title: "The Matrix",
      year: 1999,
      ratingProviderSource: "ptgen_douban"
    }));
  });
});
