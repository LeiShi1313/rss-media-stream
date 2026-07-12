import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPresentationProviderOrder: vi.fn(),
  getActiveRatingProviderSources: vi.fn()
}));

vi.mock("../src/server/integrations/providers/policy.js", () => ({
  getPresentationProviderOrder: mocks.getPresentationProviderOrder
}));

vi.mock("../src/server/integrations/providers/ratingPreference.js", () => ({
  getActiveRatingProviderSources: mocks.getActiveRatingProviderSources
}));

const {
  loadPresentationPreferences,
  presentationOptionsForMediaType
} = await import("../src/server/modules/media/presentationPreferences.js");

describe("presentation preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPresentationProviderOrder.mockImplementation(
      async (_tenantId: string, mediaType: string) => mediaType === "MOVIE"
        ? ["tmdb_api", "ptgen_douban"]
        : ["tvdb_api", "tmdb_api"]
    );
    mocks.getActiveRatingProviderSources.mockResolvedValue({
      MOVIE: "ptgen_douban"
    });
  });

  it("loads metadata order and active rating source once for each requested media type", async () => {
    const preferences = await loadPresentationPreferences("tenant-1");

    expect(preferences).toEqual({
      providerOrders: {
        MOVIE: ["tmdb_api", "ptgen_douban"],
        TV_SERIES: ["tvdb_api", "tmdb_api"]
      },
      ratingProviderSources: {
        MOVIE: "ptgen_douban"
      }
    });
    expect(mocks.getActiveRatingProviderSources).toHaveBeenCalledWith(
      "tenant-1",
      ["MOVIE", "TV_SERIES"]
    );
  });

  it("turns a media type into serializer options without falling back", async () => {
    const preferences = await loadPresentationPreferences("tenant-1", ["MOVIE"]);

    expect(presentationOptionsForMediaType(preferences, "MOVIE")).toEqual({
      providerOrder: ["tmdb_api", "ptgen_douban"],
      ratingProviderSource: "ptgen_douban"
    });
    expect(presentationOptionsForMediaType(preferences, "TV_SERIES")).toEqual({});
    expect(presentationOptionsForMediaType(preferences, "UNKNOWN")).toEqual({});
  });
});
