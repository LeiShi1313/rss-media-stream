import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/server/config.js";
import { AppError } from "../src/server/core/errors.js";

const mocks = vi.hoisted(() => {
  const prisma = {
    $transaction: vi.fn(async (callback: any) => callback(prisma)),
    $executeRaw: vi.fn(async () => 0),
    rssItem: { findFirst: vi.fn() },
    parsedReleaseMatch: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    parsedRelease: {
      findUnique: vi.fn()
    },
    providerTitle: {
      upsert: vi.fn(),
      findUnique: vi.fn()
    },
    mediaTitle: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn()
    },
    mediaTitleProviderLink: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn()
    }
  };

  const provider = {
    id: "tmdb",
    search: vi.fn(),
    fetchTitle: vi.fn(),
    probe: vi.fn()
  };
  const tvdbProvider = {
    id: "tvdb",
    search: vi.fn(),
    fetchTitle: vi.fn(),
    probe: vi.fn()
  };
  const ptgenProvider = {
    id: "ptgen",
    search: vi.fn(),
    fetchTitle: vi.fn(),
    probe: vi.fn()
  };
  type MockRuntime = {
    tenantId: string;
    provider: "tmdb" | "tvdb" | "ptgen";
    enabled: boolean;
    credential?: { source: string; secrets: { apiKey: string } };
    metadataLanguage: string;
    baseUrl?: string;
  };
  const runtime: Record<"tmdb" | "tvdb" | "ptgen", MockRuntime> = {
    tmdb: {
      tenantId: "tenant-1",
      provider: "tmdb",
      enabled: true,
      credential: { source: "workspace", secrets: { apiKey: "tmdb-key" } },
      metadataLanguage: "en-US"
    },
    tvdb: {
      tenantId: "tenant-1",
      provider: "tvdb",
      enabled: true,
      credential: { source: "workspace", secrets: { apiKey: "tvdb-key" } },
      metadataLanguage: "en-US"
    },
    ptgen: {
      tenantId: "tenant-1",
      provider: "ptgen",
      enabled: true,
      metadataLanguage: "en-US",
      baseUrl: "https://ourbits.github.io/PtGen/"
    }
  };

  return { prisma, provider, tvdbProvider, ptgenProvider, runtime };
});

vi.mock("../src/server/db.js", () => ({
  prisma: mocks.prisma
}));

vi.mock("../src/server/integrations/providers/index.js", () => ({
  getMetadataProviders: vi.fn(() => [mocks.ptgenProvider, mocks.tvdbProvider, mocks.provider]),
  getMetadataProvider: vi.fn((providerId: string) =>
    providerId === "tvdb" ? mocks.tvdbProvider : providerId === "ptgen" ? mocks.ptgenProvider : mocks.provider
  )
}));

vi.mock("../src/server/integrations/providers/policy.js", () => ({
  getMatchingProviderOrder: vi.fn((_tenantId: string, mediaType: string) =>
    mediaType === "TV_SERIES" ? ["tvdb", "tmdb"] : ["tmdb", "tvdb"]
  ),
  getBroadSearchTargets: vi.fn(() => [
    { provider: "tmdb", mediaType: "MOVIE" },
    { provider: "tvdb", mediaType: "MOVIE" },
    { provider: "tvdb", mediaType: "TV_SERIES" },
    { provider: "tmdb", mediaType: "TV_SERIES" }
  ]),
  getPresentationProviderOrder: vi.fn((_tenantId: string, mediaType: string) =>
    mediaType === "TV_SERIES" ? ["tvdb", "tmdb"] : ["tmdb", "tvdb"]
  )
}));

vi.mock("../src/server/integrations/providers/runtime.js", () => ({
  providerRuntimeAvailable: vi.fn((runtime: any) =>
    runtime.enabled && (runtime.provider === "ptgen" || Boolean(runtime.credential))
  ),
  resolveProviderRuntime: vi.fn((_config: AppConfig, _tenantId: string, providerId: "tmdb" | "tvdb" | "ptgen") =>
    mocks.runtime[providerId]
  )
}));

const {
  manuallyMatchParsedReleaseWithProvider,
  matchParsedReleaseForItem,
  searchExternalMedia,
  smartSearchExternalMedia
} = await import("../src/server/modules/media/media.service.js");
const {
  serializeMediaPresentation,
  selectPresentationProviderTitle
} = await import("../src/server/modules/media/presentation.js");

const config = {
  databaseUrl: "postgresql://example.invalid/rss",
  appSecret: "test-app-secret-32-characters-long",
  jwtSecret: "test-jwt-secret-32-characters-long",
  apiHost: "127.0.0.1",
  apiPort: 4000,
  clientOrigin: "http://localhost:5173",
  pollIntervalSeconds: 600,
  nodeEnv: "test"
} satisfies AppConfig;

beforeEach(() => {
  mocks.runtime.tmdb = {
    tenantId: "tenant-1",
    provider: "tmdb",
    enabled: true,
    credential: { source: "workspace", secrets: { apiKey: "tmdb-key" } },
    metadataLanguage: "en-US"
  };
  mocks.runtime.tvdb = {
    tenantId: "tenant-1",
    provider: "tvdb",
    enabled: true,
    credential: { source: "workspace", secrets: { apiKey: "tvdb-key" } },
    metadataLanguage: "en-US"
  };
  mocks.runtime.ptgen = {
    tenantId: "tenant-1",
    provider: "ptgen",
    enabled: true,
    metadataLanguage: "en-US",
    baseUrl: "https://ourbits.github.io/PtGen/"
  };
});

describe("smartSearchExternalMedia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.provider.probe.mockReturnValue([]);
    mocks.tvdbProvider.probe.mockReturnValue([]);
    mocks.ptgenProvider.probe.mockReturnValue([]);
    mocks.provider.search.mockResolvedValue([]);
    mocks.tvdbProvider.search.mockResolvedValue([]);
    mocks.ptgenProvider.search.mockResolvedValue([]);
  });

  it("uses media type context to exact-fetch short TMDB IDs", async () => {
    mocks.provider.probe.mockReturnValue([{
      provider: "tmdb",
      providerEntityType: "tmdb_movie",
      providerId: "603",
      mediaType: "MOVIE"
    }]);
    mocks.provider.fetchTitle.mockResolvedValue(providerResult({
      provider: "tmdb",
      providerEntityType: "tmdb_movie",
      providerId: "603",
      mediaType: "MOVIE",
      title: "The Matrix",
      normalizedTitle: "the matrix",
      releaseYear: 1999
    }));

    const results = await smartSearchExternalMedia(config, "tenant-1", {
      input: "tmdb:603",
      mediaType: "MOVIE"
    });

    expect(mocks.provider.probe).toHaveBeenCalledWith(expect.objectContaining({
      input: "tmdb:603",
      mediaType: "MOVIE"
    }));
    expect(mocks.provider.fetchTitle).toHaveBeenCalledWith(
      expect.objectContaining({
        providerEntityType: "tmdb_movie",
        providerId: "603",
        mediaType: "MOVIE"
      }),
      expect.objectContaining({ runtime: expect.objectContaining({ tenantId: "tenant-1" }) })
    );
    expect(mocks.provider.search).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({
      provider: "tmdb",
      providerEntityType: "tmdb_movie",
      providerId: "603",
      title: "The Matrix"
    });
  });

  it("uses tenant provider policy order when GET search omits an explicit provider", async () => {
    mocks.tvdbProvider.search.mockResolvedValue([providerResult({
      provider: "tvdb",
      providerEntityType: "tvdb_series",
      providerId: "200",
      mediaType: "TV_SERIES",
      title: "Possible Series",
      normalizedTitle: "possible series",
      releaseYear: 2026
    })]);
    mocks.provider.search.mockResolvedValue([providerResult({
      provider: "tmdb",
      providerEntityType: "tmdb_tv",
      providerId: "300",
      mediaType: "TV_SERIES",
      title: "Possible Series",
      normalizedTitle: "possible series",
      releaseYear: 2026
    })]);

    const results = await searchExternalMedia(config, "tenant-1", {
      q: "Possible Series",
      mediaType: "TV_SERIES",
      kind: "TV"
    });

    expect(mocks.tvdbProvider.search).toHaveBeenCalledWith(
      expect.objectContaining({ mediaType: "TV_SERIES" }),
      expect.anything()
    );
    expect(mocks.provider.search).toHaveBeenCalledWith(
      expect.objectContaining({ mediaType: "TV_SERIES" }),
      expect.anything()
    );
    expect(
      mocks.tvdbProvider.search.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.provider.search.mock.invocationCallOrder[0]);
    expect(results.map((result) => result.provider)).toEqual(["tvdb", "tmdb"]);
  });

  it("exact-fetches explicit TVDB movie IDs", async () => {
    mocks.tvdbProvider.probe.mockReturnValue([{
      provider: "tvdb",
      providerEntityType: "tvdb_movie",
      providerId: "169",
      mediaType: "MOVIE"
    }]);
    mocks.tvdbProvider.fetchTitle.mockResolvedValue(providerResult({
      provider: "tvdb",
      providerEntityType: "tvdb_movie",
      providerId: "169",
      mediaType: "MOVIE",
      title: "The Matrix",
      normalizedTitle: "the matrix",
      releaseYear: 1999
    }));

    const results = await smartSearchExternalMedia(config, "tenant-1", {
      input: "tvdb:movie:169"
    });

    expect(mocks.tvdbProvider.fetchTitle).toHaveBeenCalledWith(
      expect.objectContaining({
        providerEntityType: "tvdb_movie",
        providerId: "169",
        mediaType: "MOVIE"
      }),
      expect.objectContaining({ runtime: expect.objectContaining({ tenantId: "tenant-1" }) })
    );
    expect(mocks.tvdbProvider.search).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({
      provider: "tvdb",
      providerEntityType: "tvdb_movie",
      providerId: "169",
      title: "The Matrix"
    });
  });

  it("exact-fetches PtGen IDs even when the probe does not know media type yet", async () => {
    mocks.ptgenProvider.probe.mockReturnValue([{
      provider: "ptgen",
      providerEntityType: "ptgen_imdb",
      providerId: "tt0133093"
    }]);
    mocks.ptgenProvider.fetchTitle.mockResolvedValue(providerResult({
      provider: "ptgen",
      providerEntityType: "ptgen_imdb",
      providerId: "tt0133093",
      mediaType: "MOVIE",
      title: "The Matrix",
      normalizedTitle: "the matrix",
      releaseYear: 1999,
      externalUrl: "https://www.imdb.com/title/tt0133093/"
    }));

    const results = await smartSearchExternalMedia(config, "tenant-1", {
      input: "imdb:tt0133093"
    });

    expect(mocks.ptgenProvider.fetchTitle).toHaveBeenCalledWith(
      expect.objectContaining({
        providerEntityType: "ptgen_imdb",
        providerId: "tt0133093",
        mediaType: undefined
      }),
      expect.objectContaining({
        runtime: expect.objectContaining({
          provider: "ptgen",
          baseUrl: "https://ourbits.github.io/PtGen/"
        })
      })
    );
    expect(results[0]).toMatchObject({
      provider: "ptgen",
      providerEntityType: "ptgen_imdb",
      providerId: "tt0133093",
      title: "The Matrix",
      externalUrl: "https://www.imdb.com/title/tt0133093/"
    });
  });

  it("returns no exact search results when a probed provider record is missing", async () => {
    mocks.ptgenProvider.probe.mockReturnValue([{
      provider: "ptgen",
      providerEntityType: "ptgen_imdb",
      providerId: "tt0000000"
    }]);
    mocks.ptgenProvider.fetchTitle.mockRejectedValue(new AppError(404, "NOT_FOUND", "PtGen title not found"));

    const results = await smartSearchExternalMedia(config, "tenant-1", {
      input: "imdb:tt0000000"
    });

    expect(mocks.ptgenProvider.fetchTitle).toHaveBeenCalled();
    expect(results).toEqual([]);
    expect(mocks.ptgenProvider.search).not.toHaveBeenCalled();
  });

  it("uses movie context to exact-fetch bare TVDB IDs", async () => {
    mocks.tvdbProvider.probe.mockReturnValue([{
      provider: "tvdb",
      providerEntityType: "tvdb_movie",
      providerId: "169",
      mediaType: "MOVIE"
    }]);
    mocks.tvdbProvider.fetchTitle.mockResolvedValue(providerResult({
      provider: "tvdb",
      providerEntityType: "tvdb_movie",
      providerId: "169",
      mediaType: "MOVIE",
      title: "The Matrix",
      normalizedTitle: "the matrix",
      releaseYear: 1999
    }));

    await smartSearchExternalMedia(config, "tenant-1", {
      input: "tvdb:169",
      mediaType: "MOVIE"
    });

    expect(mocks.tvdbProvider.probe).toHaveBeenCalledWith(expect.objectContaining({
      input: "tvdb:169",
      mediaType: "MOVIE"
    }));
    expect(mocks.tvdbProvider.fetchTitle).toHaveBeenCalledWith(
      expect.objectContaining({
        providerEntityType: "tvdb_movie",
        providerId: "169",
        mediaType: "MOVIE"
      }),
      expect.objectContaining({ runtime: expect.objectContaining({ tenantId: "tenant-1" }) })
    );
  });

  it("does not exact-fetch bare TVDB IDs without context", async () => {
    await smartSearchExternalMedia(config, "tenant-1", {
      input: "tvdb:169"
    });

    expect(mocks.tvdbProvider.fetchTitle).not.toHaveBeenCalled();
    expect(mocks.tvdbProvider.search).toHaveBeenCalledWith(
      expect.objectContaining({ title: "tvdb:169", mediaType: "MOVIE" }),
      expect.objectContaining({ runtime: expect.objectContaining({ tenantId: "tenant-1" }) })
    );
    expect(mocks.tvdbProvider.search).toHaveBeenCalledWith(
      expect.objectContaining({ title: "tvdb:169", mediaType: "TV_SERIES" }),
      expect.objectContaining({ runtime: expect.objectContaining({ tenantId: "tenant-1" }) })
    );
  });

  it("keeps provider_not_configured when every broad search target lacks credentials", async () => {
    mocks.runtime.tmdb = { ...mocks.runtime.tmdb, credential: undefined };
    mocks.runtime.tvdb = { ...mocks.runtime.tvdb, credential: undefined };

    await expect(smartSearchExternalMedia(config, "tenant-1", {
      input: "Unknown Title"
    })).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED"
    });
  });

  it("uses TVDB movie URL slug probes as search hints", async () => {
    mocks.tvdbProvider.probe.mockReturnValue([{
      provider: "tvdb",
      mediaType: "MOVIE",
      searchQuery: "the matrix"
    }]);

    await smartSearchExternalMedia(config, "tenant-1", {
      input: "https://thetvdb.com/movies/the-matrix"
    });

    expect(mocks.tvdbProvider.fetchTitle).not.toHaveBeenCalled();
    expect(mocks.tvdbProvider.search).toHaveBeenCalledWith(
      expect.objectContaining({ title: "the matrix", mediaType: "MOVIE" }),
      expect.objectContaining({ runtime: expect.objectContaining({ tenantId: "tenant-1" }) })
    );
    expect(mocks.provider.search).not.toHaveBeenCalled();
  });

  it("does not exact-fetch ambiguous short TMDB IDs without context", async () => {
    await smartSearchExternalMedia(config, "tenant-1", {
      input: "tmdb:603"
    });

    expect(mocks.provider.fetchTitle).not.toHaveBeenCalled();
    expect(mocks.tvdbProvider.fetchTitle).not.toHaveBeenCalled();
    expect(mocks.provider.search).toHaveBeenCalledWith(
      expect.objectContaining({ title: "tmdb:603", mediaType: "MOVIE" }),
      expect.objectContaining({ runtime: expect.objectContaining({ tenantId: "tenant-1" }) })
    );
    expect(mocks.tvdbProvider.search).toHaveBeenCalledWith(
      expect.objectContaining({ title: "tmdb:603", mediaType: "MOVIE" }),
      expect.objectContaining({ runtime: expect.objectContaining({ tenantId: "tenant-1" }) })
    );
    expect(mocks.provider.search).toHaveBeenCalledWith(
      expect.objectContaining({ title: "tmdb:603", mediaType: "TV_SERIES" }),
      expect.objectContaining({ runtime: expect.objectContaining({ tenantId: "tenant-1" }) })
    );
  });

  it("passes provider entity type context to provider probes", async () => {
    await smartSearchExternalMedia(config, "tenant-1", {
      input: "tmdb:603",
      providerEntityType: "tmdb_tv"
    });

    expect(mocks.provider.probe).toHaveBeenCalledWith(expect.objectContaining({
      input: "tmdb:603",
      providerEntityType: "tmdb_tv"
    }));
  });

  it("serializes provider external URLs in search results", async () => {
    mocks.provider.search.mockResolvedValue([providerResult({
      provider: "tmdb",
      providerEntityType: "tmdb_movie",
      providerId: "603",
      mediaType: "MOVIE",
      title: "The Matrix",
      normalizedTitle: "the matrix",
      releaseYear: 1999,
      externalUrl: "https://www.themoviedb.org/movie/603"
    })]);

    const results = await searchExternalMedia(config, "tenant-1", {
      q: "The Matrix",
      mediaType: "MOVIE",
      kind: "MOVIE"
    });

    expect(results[0]).toMatchObject({
      provider: "tmdb",
      providerEntityType: "tmdb_movie",
      providerId: "603",
      externalUrl: "https://www.themoviedb.org/movie/603"
    });
    expect("attributionUrl" in results[0]).toBe(false);
  });
});

describe("matchParsedReleaseForItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.provider.search.mockResolvedValue([]);
    mocks.tvdbProvider.search.mockResolvedValue([]);
    mocks.provider.fetchTitle.mockReset();
    mocks.tvdbProvider.fetchTitle.mockReset();
    mocks.prisma.parsedReleaseMatch.findFirst.mockResolvedValue(null);
    mocks.prisma.parsedReleaseMatch.findMany.mockResolvedValue([]);
    mocks.prisma.parsedReleaseMatch.updateMany.mockResolvedValue({ count: 0 });
  });

  it("creates an UNKNOWN unmatched decision", async () => {
    mockItemRelease({ mediaType: "UNKNOWN" });
    mocks.prisma.parsedReleaseMatch.create.mockResolvedValue({ id: "match-1", status: "UNMATCHED" });

    await matchParsedReleaseForItem({ tenantId: "tenant-1", itemId: "item-1", config });

    expect(mocks.prisma.parsedReleaseMatch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "UNMATCHED",
        reason: "unknown_media_type"
      })
    }));
    expect(rawLockKeys()).toContain("parsed-release-match:tenant-1:release-1");
    expect(mocks.provider.search).not.toHaveBeenCalled();
  });

  it("creates provider_not_configured when the default provider is unavailable", async () => {
    mockItemRelease({ mediaType: "MOVIE" });
    mocks.runtime.tmdb = { ...mocks.runtime.tmdb, credential: undefined };
    mocks.runtime.tvdb = { ...mocks.runtime.tvdb, credential: undefined };
    mocks.prisma.parsedReleaseMatch.create.mockResolvedValue({ id: "match-1", status: "UNMATCHED" });

    await matchParsedReleaseForItem({ tenantId: "tenant-1", itemId: "item-1", config });

    expect(mocks.prisma.parsedReleaseMatch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "UNMATCHED",
        reason: "provider_not_configured"
      })
    }));
    expect(mocks.provider.search).not.toHaveBeenCalled();
  });

  it("falls back to TVDB for movies when TMDB has no result", async () => {
    mockItemRelease({ mediaType: "MOVIE" });
    mocks.provider.search.mockResolvedValue([]);
    mocks.tvdbProvider.search.mockResolvedValue([{
      provider: "tvdb",
      providerEntityType: "tvdb_movie",
      providerId: "169",
      mediaType: "MOVIE",
      title: "The Matrix",
      normalizedTitle: "the matrix",
      releaseYear: 1999,
      payload: { posterPath: "https://artworks.thetvdb.com/movie.jpg" },
      matchConfidence: 0.9
    }]);
    mocks.prisma.providerTitle.upsert.mockResolvedValue({
      id: "provider-title-tvdb-movie",
      provider: "tvdb",
      providerEntityType: "tvdb_movie",
      providerId: "169",
      mediaType: "MOVIE",
      title: "The Matrix",
      normalizedTitle: "the matrix",
      releaseYear: 1999
    });
    mocks.prisma.mediaTitleProviderLink.findUnique.mockResolvedValue(null);
    mocks.prisma.mediaTitle.findFirst.mockResolvedValue(null);
    mocks.prisma.mediaTitle.create.mockResolvedValue({
      id: "media-title-tvdb-movie",
      mediaType: "MOVIE",
      canonicalTitle: "The Matrix",
      normalizedTitle: "the matrix",
      releaseYear: 1999
    });
    mocks.prisma.mediaTitle.findUnique.mockResolvedValue({ id: "media-title-tvdb-movie", mediaType: "MOVIE" });
    mocks.prisma.providerTitle.findUnique.mockResolvedValue({ id: "provider-title-tvdb-movie", mediaType: "MOVIE" });
    mocks.prisma.mediaTitleProviderLink.upsert.mockResolvedValue({ id: "link-tvdb-movie" });
    mocks.prisma.mediaTitleProviderLink.findFirst.mockResolvedValue({ id: "link-tvdb-movie" });
    mocks.prisma.parsedReleaseMatch.create.mockResolvedValue({ id: "match-tvdb-movie", status: "MATCHED" });

    await matchParsedReleaseForItem({ tenantId: "tenant-1", itemId: "item-1", config });

    expect(mocks.provider.search).toHaveBeenCalledWith(
      expect.objectContaining({ mediaType: "MOVIE" }),
      expect.objectContaining({ runtime: expect.objectContaining({ tenantId: "tenant-1" }) })
    );
    expect(mocks.tvdbProvider.search).toHaveBeenCalledWith(
      expect.objectContaining({ mediaType: "MOVIE" }),
      expect.objectContaining({ runtime: expect.objectContaining({ tenantId: "tenant-1" }) })
    );
    expect(
      mocks.provider.search.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.tvdbProvider.search.mock.invocationCallOrder[0]);
    expect(mocks.prisma.parsedReleaseMatch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "MATCHED",
        providerTitleId: "provider-title-tvdb-movie"
      })
    }));
  });

  it("creates provider_disabled_by_policy when no matching provider is enabled", async () => {
    mockItemRelease({ mediaType: "MOVIE" });
    const policy = await import("../src/server/integrations/providers/policy.js");
    vi.mocked(policy.getMatchingProviderOrder).mockResolvedValueOnce([]);
    mocks.prisma.parsedReleaseMatch.create.mockResolvedValue({ id: "match-1", status: "UNMATCHED" });

    await matchParsedReleaseForItem({ tenantId: "tenant-1", itemId: "item-1", config });

    expect(mocks.prisma.parsedReleaseMatch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "UNMATCHED",
        reason: "provider_disabled_by_policy"
      })
    }));
    expect(mocks.provider.search).not.toHaveBeenCalled();
  });

  it("creates no_result when provider search returns nothing", async () => {
    mockItemRelease({ mediaType: "MOVIE" });
    mocks.provider.search.mockResolvedValue([]);
    mocks.prisma.parsedReleaseMatch.create.mockResolvedValue({ id: "match-1", status: "UNMATCHED" });

    await matchParsedReleaseForItem({ tenantId: "tenant-1", itemId: "item-1", config });

    expect(mocks.prisma.parsedReleaseMatch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "UNMATCHED",
        reason: "no_result"
      })
    }));
  });

  it("falls back to TMDB for TV when TVDB is not configured", async () => {
    mockItemRelease({ mediaType: "TV_SERIES" });
    mocks.runtime.tvdb = { ...mocks.runtime.tvdb, credential: undefined };
    mocks.provider.search.mockResolvedValue([{
      provider: "tmdb",
      providerEntityType: "tmdb_tv",
      providerId: "300",
      mediaType: "TV_SERIES",
      title: "Possible Series",
      normalizedTitle: "possible series",
      releaseYear: 2026,
      payload: { posterPath: "/poster.jpg" },
      matchConfidence: 0.92
    }]);
    mocks.prisma.providerTitle.upsert.mockResolvedValue({
      id: "provider-title-tv",
      provider: "tmdb",
      providerEntityType: "tmdb_tv",
      providerId: "300",
      mediaType: "TV_SERIES",
      title: "Possible Series",
      normalizedTitle: "possible series",
      releaseYear: 2026
    });
    mocks.prisma.mediaTitleProviderLink.findUnique.mockResolvedValue(null);
    mocks.prisma.mediaTitle.findFirst.mockResolvedValue(null);
    mocks.prisma.mediaTitle.create.mockResolvedValue({
      id: "media-title-tv",
      mediaType: "TV_SERIES",
      canonicalTitle: "Possible Series",
      normalizedTitle: "possible series",
      releaseYear: 2026
    });
    mocks.prisma.mediaTitle.findUnique.mockResolvedValue({ id: "media-title-tv", mediaType: "TV_SERIES" });
    mocks.prisma.providerTitle.findUnique.mockResolvedValue({ id: "provider-title-tv", mediaType: "TV_SERIES" });
    mocks.prisma.mediaTitleProviderLink.upsert.mockResolvedValue({ id: "link-tv" });
    mocks.prisma.mediaTitleProviderLink.findFirst.mockResolvedValue({ id: "link-tv" });
    mocks.prisma.parsedReleaseMatch.create.mockResolvedValue({ id: "match-tv", status: "MATCHED" });

    await matchParsedReleaseForItem({ tenantId: "tenant-1", itemId: "item-1", config });

    expect(mocks.tvdbProvider.search).not.toHaveBeenCalled();
    expect(mocks.provider.search).toHaveBeenCalledWith(
      expect.objectContaining({ mediaType: "TV_SERIES" }),
      expect.objectContaining({ runtime: expect.objectContaining({ tenantId: "tenant-1" }) })
    );
    expect(mocks.prisma.parsedReleaseMatch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "MATCHED",
        providerTitleId: "provider-title-tv"
      })
    }));
  });

  it("falls back to TMDB for TV when TVDB has no result", async () => {
    mockItemRelease({ mediaType: "TV_SERIES" });
    mocks.tvdbProvider.search.mockResolvedValue([]);
    mocks.provider.search.mockResolvedValue([{
      provider: "tmdb",
      providerEntityType: "tmdb_tv",
      providerId: "301",
      mediaType: "TV_SERIES",
      title: "Fallback Series",
      normalizedTitle: "fallback series",
      releaseYear: 2026,
      payload: { posterPath: "/fallback.jpg" },
      matchConfidence: 0.91
    }]);
    mocks.prisma.providerTitle.upsert.mockResolvedValue({
      id: "provider-title-fallback",
      provider: "tmdb",
      providerEntityType: "tmdb_tv",
      providerId: "301",
      mediaType: "TV_SERIES",
      title: "Fallback Series",
      normalizedTitle: "fallback series",
      releaseYear: 2026
    });
    mocks.prisma.mediaTitleProviderLink.findUnique.mockResolvedValue(null);
    mocks.prisma.mediaTitle.findFirst.mockResolvedValue(null);
    mocks.prisma.mediaTitle.create.mockResolvedValue({
      id: "media-title-fallback",
      mediaType: "TV_SERIES",
      canonicalTitle: "Fallback Series",
      normalizedTitle: "fallback series",
      releaseYear: 2026
    });
    mocks.prisma.mediaTitle.findUnique.mockResolvedValue({ id: "media-title-fallback", mediaType: "TV_SERIES" });
    mocks.prisma.providerTitle.findUnique.mockResolvedValue({ id: "provider-title-fallback", mediaType: "TV_SERIES" });
    mocks.prisma.mediaTitleProviderLink.upsert.mockResolvedValue({ id: "link-fallback" });
    mocks.prisma.mediaTitleProviderLink.findFirst.mockResolvedValue({ id: "link-fallback" });
    mocks.prisma.parsedReleaseMatch.create.mockResolvedValue({ id: "match-fallback", status: "MATCHED" });

    await matchParsedReleaseForItem({ tenantId: "tenant-1", itemId: "item-1", config });

    expect(mocks.tvdbProvider.search).toHaveBeenCalled();
    expect(mocks.provider.search).toHaveBeenCalled();
    expect(mocks.prisma.parsedReleaseMatch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "MATCHED",
        providerTitleId: "provider-title-fallback"
      })
    }));
  });

  it("falls back to TMDB for TV when TVDB search fails", async () => {
    mockItemRelease({ mediaType: "TV_SERIES" });
    mocks.tvdbProvider.search.mockRejectedValue(new Error("TVDB unavailable"));
    mocks.provider.search.mockResolvedValue([{
      provider: "tmdb",
      providerEntityType: "tmdb_tv",
      providerId: "302",
      mediaType: "TV_SERIES",
      title: "Recovered Series",
      normalizedTitle: "recovered series",
      releaseYear: 2026,
      payload: { posterPath: "/recovered.jpg" },
      matchConfidence: 0.9
    }]);
    mocks.prisma.providerTitle.upsert.mockResolvedValue({
      id: "provider-title-recovered",
      provider: "tmdb",
      providerEntityType: "tmdb_tv",
      providerId: "302",
      mediaType: "TV_SERIES",
      title: "Recovered Series",
      normalizedTitle: "recovered series",
      releaseYear: 2026
    });
    mocks.prisma.mediaTitleProviderLink.findUnique.mockResolvedValue(null);
    mocks.prisma.mediaTitle.findFirst.mockResolvedValue(null);
    mocks.prisma.mediaTitle.create.mockResolvedValue({
      id: "media-title-recovered",
      mediaType: "TV_SERIES",
      canonicalTitle: "Recovered Series",
      normalizedTitle: "recovered series",
      releaseYear: 2026
    });
    mocks.prisma.mediaTitle.findUnique.mockResolvedValue({ id: "media-title-recovered", mediaType: "TV_SERIES" });
    mocks.prisma.providerTitle.findUnique.mockResolvedValue({ id: "provider-title-recovered", mediaType: "TV_SERIES" });
    mocks.prisma.mediaTitleProviderLink.upsert.mockResolvedValue({ id: "link-recovered" });
    mocks.prisma.mediaTitleProviderLink.findFirst.mockResolvedValue({ id: "link-recovered" });
    mocks.prisma.parsedReleaseMatch.create.mockResolvedValue({ id: "match-recovered", status: "MATCHED" });

    await matchParsedReleaseForItem({ tenantId: "tenant-1", itemId: "item-1", config });

    expect(mocks.tvdbProvider.search).toHaveBeenCalled();
    expect(mocks.provider.search).toHaveBeenCalled();
    expect(mocks.prisma.parsedReleaseMatch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "MATCHED",
        providerTitleId: "provider-title-recovered"
      })
    }));
  });

  it("writes an explicit unmatched decision when every configured provider search fails", async () => {
    mockItemRelease({ mediaType: "TV_SERIES" });
    mocks.tvdbProvider.search.mockRejectedValue(new Error("TVDB unavailable"));
    mocks.provider.search.mockRejectedValue(new Error("TMDB unavailable"));
    mocks.prisma.parsedReleaseMatch.create.mockResolvedValue({ id: "match-1", status: "UNMATCHED" });

    await matchParsedReleaseForItem({ tenantId: "tenant-1", itemId: "item-1", config });

    expect(mocks.prisma.parsedReleaseMatch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "UNMATCHED",
        reason: "no_result"
      })
    }));
  });

  it("does not auto-create canonical media when provider result has no release year", async () => {
    mockItemRelease({ mediaType: "MOVIE" });
    mocks.provider.search.mockResolvedValue([{
      provider: "tmdb",
      providerEntityType: "tmdb_movie",
      providerId: "100",
      mediaType: "MOVIE",
      title: "Possible Movie",
      normalizedTitle: "possible movie",
      payload: { posterPath: "/poster.jpg" },
      matchConfidence: 0.92
    }]);
    mocks.prisma.parsedReleaseMatch.create.mockResolvedValue({ id: "match-1", status: "UNMATCHED" });

    await matchParsedReleaseForItem({ tenantId: "tenant-1", itemId: "item-1", config });

    expect(mocks.prisma.parsedReleaseMatch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "UNMATCHED",
        reason: "missing_release_year_for_auto_match"
      })
    }));
    expect(mocks.prisma.providerTitle.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.mediaTitle.create).not.toHaveBeenCalled();
    expect(mocks.prisma.mediaTitleProviderLink.upsert).not.toHaveBeenCalled();
  });

  it("creates a matched low-confidence decision for any provider result", async () => {
    mockItemRelease({ mediaType: "MOVIE" });
    mocks.provider.search.mockResolvedValue([{
      provider: "tmdb",
      providerEntityType: "tmdb_movie",
      providerId: "100",
      mediaType: "MOVIE",
      title: "Possible Movie",
      normalizedTitle: "possible movie",
      releaseYear: 2026,
      payload: { posterPath: "/poster.jpg" },
      matchConfidence: 0.42
    }]);
    mocks.prisma.providerTitle.upsert.mockResolvedValue({
      id: "provider-title-1",
      provider: "tmdb",
      providerEntityType: "tmdb_movie",
      providerId: "100",
      mediaType: "MOVIE",
      title: "Possible Movie",
      normalizedTitle: "possible movie",
      releaseYear: 2026
    });
    mocks.prisma.mediaTitleProviderLink.findUnique.mockResolvedValue(null);
    mocks.prisma.mediaTitle.findFirst.mockResolvedValue(null);
    mocks.prisma.mediaTitle.create.mockResolvedValue({
      id: "media-title-1",
      mediaType: "MOVIE",
      canonicalTitle: "Possible Movie",
      normalizedTitle: "possible movie",
      releaseYear: 2026
    });
    mocks.prisma.mediaTitle.findUnique.mockResolvedValue({ id: "media-title-1", mediaType: "MOVIE" });
    mocks.prisma.providerTitle.findUnique.mockResolvedValue({ id: "provider-title-1", mediaType: "MOVIE" });
    mocks.prisma.mediaTitleProviderLink.upsert.mockResolvedValue({ id: "link-1" });
    mocks.prisma.mediaTitleProviderLink.findFirst.mockResolvedValue({ id: "link-1" });
    mocks.prisma.parsedReleaseMatch.create.mockResolvedValue({ id: "match-1", status: "MATCHED" });

    await matchParsedReleaseForItem({ tenantId: "tenant-1", itemId: "item-1", config });

    expect(rawLockKeys()).toContain("parsed-release-match:tenant-1:release-1");
    expect(rawLockKeys()).toContain("media-title:MOVIE:possible movie:2026");
    expect(mocks.prisma.parsedReleaseMatch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "MATCHED",
        source: "AUTO",
        confidence: 0.42,
        reason: "automatic_low_confidence_match",
        mediaTitleId: "media-title-1",
        providerTitleId: "provider-title-1"
      })
    }));
  });

  it("does not persist a matched decision when the parsed release snapshot is stale", async () => {
    mockItemRelease({ mediaType: "MOVIE" });
    mocks.provider.search.mockResolvedValue([{
      provider: "tmdb",
      providerEntityType: "tmdb_movie",
      providerId: "100",
      mediaType: "MOVIE",
      title: "Possible Movie",
      normalizedTitle: "possible movie",
      releaseYear: 2026,
      payload: { posterPath: "/poster.jpg" },
      matchConfidence: 0.92
    }]);
    mocks.prisma.parsedRelease.findUnique.mockResolvedValue({
      id: "release-1",
      tenantId: "tenant-1",
      title: "Different Movie",
      year: 2026,
      mediaType: "MOVIE",
      season: null,
      episode: null,
      episodeEnd: null,
      resolution: 1080,
      quality: "WEB-DL",
      source: "WEB",
      codec: "H.264",
      audio: "AAC",
      releaseGroup: "GROUP",
      parseConfidence: 0.98
    });

    await expect(
      matchParsedReleaseForItem({ tenantId: "tenant-1", itemId: "item-1", config })
    ).rejects.toMatchObject({
      code: "PARSED_RELEASE_CHANGED"
    });
    expect(rawLockKeys()).toContain("parsed-release-match:tenant-1:release-1");
    expect(mocks.prisma.parsedRelease.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id_tenantId: { id: "release-1", tenantId: "tenant-1" } }
    }));
    expect(mocks.prisma.providerTitle.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.mediaTitle.create).not.toHaveBeenCalled();
    expect(mocks.prisma.mediaTitleProviderLink.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.parsedReleaseMatch.create).not.toHaveBeenCalled();
  });

  it("does not persist an unmatched decision when the parsed release snapshot is stale", async () => {
    mockItemRelease({ mediaType: "MOVIE" });
    mocks.provider.search.mockResolvedValue([]);
    mocks.prisma.parsedRelease.findUnique.mockResolvedValue({
      id: "release-1",
      tenantId: "tenant-1",
      title: "Possible Movie",
      year: 2027,
      mediaType: "MOVIE",
      season: null,
      episode: null,
      episodeEnd: null,
      resolution: 1080,
      quality: "WEB-DL",
      source: "WEB",
      codec: "H.264",
      audio: "AAC",
      releaseGroup: "GROUP",
      parseConfidence: 0.98
    });

    await expect(
      matchParsedReleaseForItem({ tenantId: "tenant-1", itemId: "item-1", config })
    ).rejects.toMatchObject({
      code: "PARSED_RELEASE_CHANGED"
    });

    expect(rawLockKeys()).toContain("parsed-release-match:tenant-1:release-1");
    expect(mocks.prisma.parsedReleaseMatch.create).not.toHaveBeenCalled();
    expect(mocks.prisma.parsedReleaseMatch.updateMany).not.toHaveBeenCalled();
  });

  it("rejects active matched rows before creating a manual replacement", async () => {
    mockItemRelease({ mediaType: "MOVIE" });
    mocks.prisma.parsedReleaseMatch.findFirst.mockResolvedValue({
      id: "old-match-1",
      status: "MATCHED",
      reason: "automatic_match"
    });
    mocks.prisma.parsedReleaseMatch.findMany.mockResolvedValue([
      { id: "old-match-1" },
      { id: "old-match-2" }
    ]);
    mocks.provider.fetchTitle.mockResolvedValue({
      provider: "tmdb",
      providerEntityType: "tmdb_movie",
      providerId: "200",
      mediaType: "MOVIE",
      title: "Confirmed Movie",
      normalizedTitle: "confirmed movie",
      releaseYear: 2026,
      payload: { posterPath: "/confirmed.jpg" }
    });
    mocks.prisma.providerTitle.upsert.mockResolvedValue({
      id: "provider-title-2",
      provider: "tmdb",
      providerEntityType: "tmdb_movie",
      providerId: "200",
      mediaType: "MOVIE",
      title: "Confirmed Movie",
      normalizedTitle: "confirmed movie",
      releaseYear: 2026
    });
    mocks.prisma.mediaTitleProviderLink.findUnique.mockResolvedValue(null);
    mocks.prisma.mediaTitle.findFirst.mockResolvedValue(null);
    mocks.prisma.mediaTitle.create.mockResolvedValue({
      id: "media-title-2",
      mediaType: "MOVIE",
      canonicalTitle: "Confirmed Movie",
      normalizedTitle: "confirmed movie",
      releaseYear: 2026
    });
    mocks.prisma.mediaTitle.findUnique.mockResolvedValue({ id: "media-title-2", mediaType: "MOVIE" });
    mocks.prisma.providerTitle.findUnique.mockResolvedValue({ id: "provider-title-2", mediaType: "MOVIE" });
    mocks.prisma.mediaTitleProviderLink.upsert.mockResolvedValue({ id: "link-2" });
    mocks.prisma.mediaTitleProviderLink.findFirst.mockResolvedValue({ id: "link-2" });
    mocks.prisma.parsedReleaseMatch.create.mockResolvedValue({ id: "new-match-1", status: "MATCHED" });

    await manuallyMatchParsedReleaseWithProvider({
      tenantId: "tenant-1",
      itemId: "item-1",
      config,
      provider: "tmdb",
      providerId: "200",
      mediaType: "MOVIE"
    });

    const rejectCall = mocks.prisma.parsedReleaseMatch.updateMany.mock.calls.find((call) =>
      call[0]?.data?.status === "REJECTED"
    );
    const backfillCall = mocks.prisma.parsedReleaseMatch.updateMany.mock.calls.find((call) =>
      call[0]?.data?.replacedByMatchId === "new-match-1"
    );

    expect(rawLockKeys()).toContain("parsed-release-match:tenant-1:release-1");
    expect(rawLockKeys()).toContain("media-title:MOVIE:confirmed movie:2026");
    expect(rejectCall).toEqual([expect.objectContaining({
      where: { id: { in: ["old-match-1", "old-match-2"] } },
      data: expect.objectContaining({
        status: "REJECTED",
        reason: "user_replaced_match",
        rejectedAt: expect.any(Date)
      })
    })]);
    expect(mocks.prisma.parsedReleaseMatch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "MATCHED",
        source: "MANUAL",
        mediaTitleId: "media-title-2",
        providerTitleId: "provider-title-2"
      })
    }));
    expect(backfillCall).toEqual([expect.objectContaining({
      where: { id: { in: ["old-match-1", "old-match-2"] } },
      data: { replacedByMatchId: "new-match-1" }
    })]);
    expect(
      mocks.prisma.parsedReleaseMatch.updateMany.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.prisma.parsedReleaseMatch.create.mock.invocationCallOrder[0]);
    expect(
      mocks.prisma.parsedReleaseMatch.create.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.prisma.parsedReleaseMatch.updateMany.mock.invocationCallOrder[1]);
  });

  it("defaults omitted TVDB movie provider entity type at service level", async () => {
    mockItemRelease({ mediaType: "MOVIE" });
    mocks.tvdbProvider.fetchTitle.mockResolvedValue({
      provider: "tvdb",
      providerEntityType: "tvdb_movie",
      providerId: "169",
      mediaType: "MOVIE",
      title: "The Matrix",
      normalizedTitle: "the matrix",
      releaseYear: 1999,
      payload: { posterPath: "https://artworks.thetvdb.com/movie.jpg" }
    });
    mocks.prisma.providerTitle.upsert.mockResolvedValue({
      id: "provider-title-tvdb-manual",
      provider: "tvdb",
      providerEntityType: "tvdb_movie",
      providerId: "169",
      mediaType: "MOVIE",
      title: "The Matrix",
      normalizedTitle: "the matrix",
      releaseYear: 1999
    });
    mocks.prisma.mediaTitleProviderLink.findUnique.mockResolvedValue(null);
    mocks.prisma.mediaTitle.findFirst.mockResolvedValue(null);
    mocks.prisma.mediaTitle.create.mockResolvedValue({
      id: "media-title-tvdb-manual",
      mediaType: "MOVIE",
      canonicalTitle: "The Matrix",
      normalizedTitle: "the matrix",
      releaseYear: 1999
    });
    mocks.prisma.mediaTitle.findUnique.mockResolvedValue({ id: "media-title-tvdb-manual", mediaType: "MOVIE" });
    mocks.prisma.providerTitle.findUnique.mockResolvedValue({ id: "provider-title-tvdb-manual", mediaType: "MOVIE" });
    mocks.prisma.mediaTitleProviderLink.upsert.mockResolvedValue({ id: "link-tvdb-manual" });
    mocks.prisma.mediaTitleProviderLink.findFirst.mockResolvedValue({ id: "link-tvdb-manual" });
    mocks.prisma.parsedReleaseMatch.create.mockResolvedValue({ id: "match-tvdb-manual", status: "MATCHED" });

    await manuallyMatchParsedReleaseWithProvider({
      tenantId: "tenant-1",
      itemId: "item-1",
      config,
      provider: "tvdb",
      providerId: "169",
      mediaType: "MOVIE"
    });

    expect(mocks.tvdbProvider.fetchTitle).toHaveBeenCalledWith(
      expect.objectContaining({
        providerEntityType: "tvdb_movie",
        providerId: "169",
        mediaType: "MOVIE"
      }),
      expect.objectContaining({ runtime: expect.objectContaining({ tenantId: "tenant-1" }) })
    );
  });
});

describe("media presentation provider selection", () => {
  it("keeps the active match provider as release presentation provenance", () => {
    const selected = providerTitle({
      id: "tvdb-selected",
      provider: "tvdb",
      providerEntityType: "tvdb_series",
      providerId: "200",
      mediaType: "TV_SERIES",
      title: "Selected Series",
      fetchedAt: new Date("2026-06-01T10:00:00Z")
    });
    const newerLinked = providerTitle({
      id: "tmdb-linked",
      provider: "tmdb",
      providerEntityType: "tmdb_tv",
      providerId: "300",
      mediaType: "TV_SERIES",
      title: "Linked Series",
      fetchedAt: new Date("2026-06-02T10:00:00Z")
    });

    expect(selectPresentationProviderTitle({
      mediaTitle: { id: "media-1", mediaType: "TV_SERIES" },
      selectedProviderTitle: selected,
      providerLinks: [{ providerTitle: newerLinked }]
    })).toBe(selected);
  });

  it("does not use the active match provider when policy order excludes it", () => {
    const selected = providerTitle({
      id: "tvdb-selected",
      provider: "tvdb",
      providerEntityType: "tvdb_series",
      providerId: "200",
      mediaType: "TV_SERIES",
      title: "Selected Series",
      fetchedAt: new Date("2026-06-01T10:00:00Z")
    });
    const allowedLinked = providerTitle({
      id: "tmdb-linked",
      provider: "tmdb",
      providerEntityType: "tmdb_tv",
      providerId: "300",
      mediaType: "TV_SERIES",
      title: "Allowed Series",
      fetchedAt: new Date("2026-06-02T10:00:00Z")
    });

    expect(selectPresentationProviderTitle({
      mediaTitle: { id: "media-1", mediaType: "TV_SERIES" },
      selectedProviderTitle: selected,
      providerLinks: [{ providerTitle: allowedLinked }],
      providerOrder: ["tmdb"]
    })).toBe(allowedLinked);
  });

  it("prefers media-type default provider over provider link order", () => {
    const presentation = serializeMediaPresentation({
      mediaTitle: {
        id: "media-1",
        mediaType: "MOVIE",
        canonicalTitle: "Canonical Movie",
        providerLinks: [
          {
            updatedAt: new Date("2026-06-03T10:00:00Z"),
            providerTitle: providerTitle({
              id: "tvdb-linked",
              provider: "tvdb",
              providerEntityType: "tvdb_series",
              providerId: "200",
              mediaType: "TV_SERIES",
              title: "Wrong Type",
              fetchedAt: new Date("2026-06-03T10:00:00Z")
            })
          },
          {
            updatedAt: new Date("2026-06-01T10:00:00Z"),
            providerTitle: providerTitle({
              id: "tmdb-linked",
              provider: "tmdb",
              providerEntityType: "tmdb_movie",
              providerId: "100",
              mediaType: "MOVIE",
              title: "本地化电影名",
              fetchedAt: new Date("2026-06-01T10:00:00Z")
            })
          }
        ]
      }
    });

    expect(presentation.displaySource).toMatchObject({
      provider: "tmdb",
      providerEntityType: "tmdb_movie",
      providerId: "100"
    });
    expect(presentation.title).toBe("本地化电影名");
  });

  it("uses newest non-expired payload before stable provider identity tie-breakers", () => {
    const older = providerTitle({
      id: "older",
      provider: "customb",
      providerEntityType: "customb_movie",
      providerId: "2",
      mediaType: "MOVIE",
      title: "Older",
      fetchedAt: new Date("2026-06-01T10:00:00Z")
    });
    const newer = providerTitle({
      id: "newer",
      provider: "customa",
      providerEntityType: "customa_movie",
      providerId: "1",
      mediaType: "MOVIE",
      title: "Newer",
      fetchedAt: new Date("2026-06-02T10:00:00Z")
    });
    const expiredNewest = providerTitle({
      id: "expired",
      provider: "customc",
      providerEntityType: "customc_movie",
      providerId: "3",
      mediaType: "MOVIE",
      title: "Expired",
      fetchedAt: new Date("2026-06-03T10:00:00Z"),
      expiresAt: new Date("2000-01-01T00:00:00Z")
    });

    expect(selectPresentationProviderTitle({
      mediaTitle: { id: "media-1", mediaType: "UNKNOWN" },
      providerLinks: [
        { providerTitle: older },
        { providerTitle: expiredNewest },
        { providerTitle: newer }
      ]
    })).toBe(newer);

    expect(selectPresentationProviderTitle({
      mediaTitle: { id: "media-1", mediaType: "UNKNOWN" },
      providerLinks: [
        { providerTitle: providerTitle({ ...newer, fetchedAt: older.fetchedAt }) },
        { providerTitle: older }
      ]
    })?.provider).toBe("customa");
  });
});

function rawLockKeys() {
  return mocks.prisma.$executeRaw.mock.calls.map((call) => (call as unknown[])[1]);
}

function mockItemRelease(input: { mediaType: "MOVIE" | "TV_SERIES" | "UNKNOWN" }) {
  const parsedRelease = {
    id: "release-1",
    tenantId: "tenant-1",
    title: "Possible Movie",
    year: 2026,
    mediaType: input.mediaType,
    season: null,
    episode: null,
    episodeEnd: null,
    resolution: 1080,
    quality: "WEB-DL",
    source: "WEB",
    codec: "H.264",
    audio: "AAC",
    releaseGroup: "GROUP",
    parseConfidence: 0.98
  };

  mocks.prisma.rssItem.findFirst.mockResolvedValue({
    id: "item-1",
    tenantId: "tenant-1",
    parsedRelease
  });
  mocks.prisma.parsedRelease.findUnique.mockResolvedValue(parsedRelease);
}

function providerTitle(input: any) {
  return {
    providerId: "100",
    originalTitle: null,
    releaseYear: 2026,
    payload: {},
    ...input
  };
}

function providerResult(input: any) {
  return {
    originalTitle: input.title,
    payload: {},
    matchConfidence: 1,
    ...input
  };
}
