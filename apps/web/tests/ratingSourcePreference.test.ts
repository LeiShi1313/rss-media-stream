import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    tenantRatingSourcePreference: {
      findMany: vi.fn(),
      upsert: vi.fn()
    },
    tenantProviderSourceConfig: {
      findMany: vi.fn()
    }
  }
}));

vi.mock("../src/server/db.js", () => ({ prisma: mocks.prisma }));

const {
  getActiveRatingProviderSources,
  getRatingSourcePreferences,
  setRatingSourcePreference
} = await import("../src/server/integrations/providers/ratingPreference.js");

describe("rating source preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.tenantRatingSourcePreference.findMany.mockResolvedValue([]);
    mocks.prisma.tenantProviderSourceConfig.findMany.mockResolvedValue([]);
    mocks.prisma.tenantRatingSourcePreference.upsert.mockImplementation(async (args: any) => args.create);
  });

  it("defaults movie and TV preferences to PTGen Douban", async () => {
    await expect(getRatingSourcePreferences("tenant-1")).resolves.toEqual({
      MOVIE: {
        mediaType: "MOVIE",
        providerSource: "ptgen_douban",
        provider: "douban",
        label: "PTGen Douban",
        enabled: true
      },
      TV_SERIES: {
        mediaType: "TV_SERIES",
        providerSource: "ptgen_douban",
        provider: "douban",
        label: "PTGen Douban",
        enabled: true
      }
    });
  });

  it("preserves a disabled selection but excludes it from active rating sources", async () => {
    mocks.prisma.tenantRatingSourcePreference.findMany.mockResolvedValue([
      { mediaType: "MOVIE", providerSource: "tmdb_api" }
    ]);
    mocks.prisma.tenantProviderSourceConfig.findMany.mockResolvedValue([
      { providerSource: "tmdb_api" }
    ]);

    const preferences = await getRatingSourcePreferences("tenant-1");
    expect(preferences.MOVIE).toMatchObject({
      providerSource: "tmdb_api",
      enabled: false
    });
    await expect(getActiveRatingProviderSources("tenant-1")).resolves.toEqual({
      TV_SERIES: "ptgen_douban"
    });
  });

  it("persists an exact rating-capable source and rejects unsupported sources", async () => {
    await setRatingSourcePreference("tenant-1", "TV_SERIES", "ptgen_imdb");
    expect(mocks.prisma.tenantRatingSourcePreference.upsert).toHaveBeenCalledWith({
      where: {
        tenantId_mediaType: { tenantId: "tenant-1", mediaType: "TV_SERIES" }
      },
      create: {
        tenantId: "tenant-1",
        mediaType: "TV_SERIES",
        providerSource: "ptgen_imdb"
      },
      update: { providerSource: "ptgen_imdb" }
    });

    await expect(
      setRatingSourcePreference("tenant-1", "TV_SERIES", "tvdb_api")
    ).rejects.toThrow("TVDB API does not provide ratings for TV_SERIES");
  });
});
