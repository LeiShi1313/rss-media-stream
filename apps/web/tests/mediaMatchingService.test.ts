import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/server/config.js";
import { AppError } from "../src/server/core/errors.js";

const mocks = vi.hoisted(() => {
  const prisma = {
    $transaction: vi.fn(async (callback: any) => callback(prisma)),
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(),
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
    mediaProviderIdentity: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      findFirst: vi.fn()
    },
    providerMediaMetadata: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn()
    },
    mediaTitle: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
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
    providerSource?: "tmdb_api" | "tvdb_api" | "ptgen_imdb" | "ptgen_douban";
    adapterId?: "tmdb" | "tvdb" | "ptgen";
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
      metadataLanguage: "en-US"
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
  ),
  getProviderDefinition: vi.fn((providerId: string) => ({
    id: providerId,
    label: providerId.toUpperCase(),
    supportedMediaTypes: ["MOVIE", "TV_SERIES"],
    authFields: [],
    supportsMetadataLanguage: true,
    supportsRegion: false,
    defaultPolicies: []
  }))
}));

vi.mock("../src/server/integrations/providers/policy.js", () => ({
  getMatchingProviderOrder: vi.fn(() => ["tmdb_api", "tvdb_api"]),
  getBroadSearchTargets: vi.fn(() => [
    { providerSource: "tmdb_api", mediaType: "MOVIE" },
    { providerSource: "tvdb_api", mediaType: "MOVIE" },
    { providerSource: "tmdb_api", mediaType: "TV_SERIES" },
    { providerSource: "tvdb_api", mediaType: "TV_SERIES" }
  ]),
  getPresentationProviderOrder: vi.fn(() => ["tmdb_api", "tvdb_api"])
}));

vi.mock("../src/server/integrations/providers/runtime.js", () => ({
  providerRuntimeAvailable: vi.fn((runtime: any) =>
    runtime.enabled && (runtime.adapterId === "ptgen" || Boolean(runtime.credential))
  ),
  resolveProviderRuntime: vi.fn((_config: AppConfig, _tenantId: string, providerId: string) => {
    if (providerId === "tmdb_api" || providerId === "tmdb") {
      return { ...mocks.runtime.tmdb, providerSource: "tmdb_api", adapterId: "tmdb" };
    }
    if (providerId === "tvdb_api" || providerId === "tvdb") {
      return { ...mocks.runtime.tvdb, providerSource: "tvdb_api", adapterId: "tvdb" };
    }
    if (providerId === "ptgen_douban") {
      return { ...mocks.runtime.ptgen, providerSource: "ptgen_douban", adapterId: "ptgen" };
    }
    return { ...mocks.runtime.ptgen, providerSource: "ptgen_imdb", adapterId: "ptgen" };
  })
}));

const {
  listTrendingMedia,
  manuallyMatchParsedReleaseWithProvider,
  matchParsedReleaseForItem,
  searchExternalMedia,
  smartSearchExternalMedia,
  upsertProviderMediaMetadata
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
    metadataLanguage: "en-US"
  };
  mocks.prisma.mediaProviderIdentity.findUnique.mockResolvedValue(null);
  mocks.prisma.mediaProviderIdentity.upsert.mockImplementation(async (args: any) => ({
    id: mediaProviderIdentityId(args.create.provider, args.create.providerId),
    ...args.create
  }));
  mocks.prisma.mediaProviderIdentity.findFirst.mockImplementation(async (args: any) => ({
    id: args.where.id,
    mediaTitleId: args.where.mediaTitleId,
    mediaType: args.where.mediaType
  }));
  mocks.prisma.providerMediaMetadata.upsert.mockImplementation(async (args: any) => ({
    id: providerMediaMetadataId(args.create.providerSource, args.create.mediaProviderIdentityId),
    ...args.create,
    mediaProviderIdentity: { id: args.create.mediaProviderIdentityId }
  }));
  mocks.prisma.providerMediaMetadata.findFirst.mockImplementation(async (args: any) => ({
    id: args.where.id
  }));
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
      mocks.provider.search.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.tvdbProvider.search.mock.invocationCallOrder[0]);
    expect(results.map((result) => result.provider)).toEqual(["tmdb", "tvdb"]);
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

  it("exact-fetches PTGen IDs even when the probe does not know media type yet", async () => {
    mocks.ptgenProvider.probe.mockReturnValue([{
      provider: "ptgen",
      providerEntityType: "ptgen_imdb",
      providerId: "imdb-tt0133093"
    }]);
    mocks.ptgenProvider.fetchTitle.mockResolvedValue(providerResult({
      provider: "ptgen",
      providerEntityType: "ptgen_imdb",
      providerId: "imdb-tt0133093",
      mediaType: "MOVIE",
      title: "The Matrix",
      normalizedTitle: "the matrix",
      releaseYear: 1999,
      externalUrl: "https://www.imdb.com/title/tt0133093/"
    }));

    const results = await smartSearchExternalMedia(config, "tenant-1", {
      input: "imdb-tt0133093"
    });

    expect(mocks.ptgenProvider.fetchTitle).toHaveBeenCalledWith(
      expect.objectContaining({
        providerEntityType: "ptgen_imdb",
        providerId: "imdb-tt0133093",
        mediaType: undefined
      }),
      expect.objectContaining({
        runtime: expect.objectContaining({
          provider: "ptgen"
        })
      })
    );
    expect(results[0]).toMatchObject({
      provider: "imdb",
      providerEntityType: "ptgen_imdb",
      providerId: "tt0133093",
      title: "The Matrix",
      externalUrl: "https://www.imdb.com/title/tt0133093/"
    });
  });

  it("restricts exact probes to a selected correction search provider", async () => {
    mocks.provider.probe.mockReturnValue([{
      provider: "tmdb",
      providerEntityType: "tmdb_movie",
      providerId: "603",
      mediaType: "MOVIE"
    }]);
    mocks.ptgenProvider.probe.mockReturnValue([{
      provider: "ptgen",
      providerEntityType: "ptgen_douban",
      providerId: "douban-1291843"
    }]);
    mocks.ptgenProvider.fetchTitle.mockResolvedValue(providerResult({
      provider: "ptgen",
      providerEntityType: "ptgen_douban",
      providerId: "douban-1291843",
      mediaType: "MOVIE",
      title: "The Matrix",
      normalizedTitle: "the matrix",
      releaseYear: 1999
    }));

    const results = await smartSearchExternalMedia(config, "tenant-1", {
      input: "douban-1291843",
      provider: "ptgen"
    });

    expect(mocks.ptgenProvider.probe).toHaveBeenCalledWith(expect.objectContaining({
      input: "douban-1291843"
    }));
    expect(mocks.provider.probe).not.toHaveBeenCalled();
    expect(mocks.tvdbProvider.probe).not.toHaveBeenCalled();
    expect(mocks.ptgenProvider.fetchTitle).toHaveBeenCalledWith(
      expect.objectContaining({
        providerEntityType: "ptgen_douban",
        providerId: "douban-1291843"
      }),
      expect.objectContaining({ runtime: expect.objectContaining({ provider: "ptgen" }) })
    );
    expect(mocks.provider.fetchTitle).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({
      provider: "douban",
      providerEntityType: "ptgen_douban",
      providerId: "1291843"
    });
  });

  it("returns no exact search results when a probed provider record is missing", async () => {
    mocks.ptgenProvider.probe.mockReturnValue([{
      provider: "ptgen",
      providerEntityType: "ptgen_imdb",
      providerId: "imdb-tt0000000"
    }]);
    mocks.ptgenProvider.fetchTitle.mockRejectedValue(new AppError(404, "NOT_FOUND", "PTGen title not found"));

    const results = await smartSearchExternalMedia(config, "tenant-1", {
      input: "imdb-tt0000000"
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

  it("restricts title search to a selected correction search provider", async () => {
    mocks.ptgenProvider.search.mockResolvedValue([providerResult({
      provider: "ptgen",
      providerEntityType: "ptgen_imdb",
      providerId: "imdb-tt0133093",
      mediaType: "MOVIE",
      title: "The Matrix",
      normalizedTitle: "the matrix",
      releaseYear: 1999
    })]);

    const results = await smartSearchExternalMedia(config, "tenant-1", {
      input: "The Matrix",
      provider: "ptgen",
      mediaType: "MOVIE",
      year: 1999
    });

    expect(mocks.ptgenProvider.search).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "The Matrix",
        mediaType: "MOVIE",
        year: 1999
      }),
      expect.objectContaining({ runtime: expect.objectContaining({ provider: "ptgen" }) })
    );
    expect(mocks.provider.search).not.toHaveBeenCalled();
    expect(mocks.tvdbProvider.search).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({
      provider: "imdb",
      providerEntityType: "ptgen_imdb",
      providerId: "tt0133093"
    });
  });

  it("searches all supported media types for a selected correction provider without type context", async () => {
    await smartSearchExternalMedia(config, "tenant-1", {
      input: "The Matrix",
      provider: "ptgen"
    });

    expect(mocks.ptgenProvider.search).toHaveBeenCalledWith(
      expect.objectContaining({ title: "The Matrix", mediaType: "MOVIE" }),
      expect.anything()
    );
    expect(mocks.ptgenProvider.search).toHaveBeenCalledWith(
      expect.objectContaining({ title: "The Matrix", mediaType: "TV_SERIES" }),
      expect.anything()
    );
    expect(mocks.provider.search).not.toHaveBeenCalled();
    expect(mocks.tvdbProvider.search).not.toHaveBeenCalled();
  });
});

describe("listTrendingMedia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$queryRaw.mockResolvedValue([
      trendingMatch("media-1", "metadata-1", "2026-06-15T10:00:00Z", "feed-1", "Feed 1"),
      trendingMatch("media-1", "metadata-1", "2026-06-15T09:00:00Z", "feed-2", "Feed 2"),
      trendingMatch("media-2", "metadata-2", "2026-06-15T08:00:00Z", "feed-1", "Feed 1")
    ]);
    mocks.prisma.mediaTitle.findMany.mockResolvedValue([
      {
        id: "media-1",
        mediaType: "MOVIE",
        title: "Canonical Movie",
        titleKey: "canonical movie",
        releaseYear: 2026,
        providerIdentities: []
      },
      {
        id: "media-2",
        mediaType: "MOVIE",
        title: "Other Movie",
        titleKey: "other movie",
        releaseYear: 2026,
        providerIdentities: []
      }
    ]);
    mocks.prisma.providerMediaMetadata.findMany.mockResolvedValue([
      {
        id: "metadata-1",
        providerSource: "tmdb_api",
        title: "Selected Movie",
        originalTitle: null,
        releaseYear: 2026,
        payload: {},
        mediaProviderIdentity: {
          provider: "tmdb",
          providerId: "100",
          mediaType: "MOVIE"
        }
      },
      {
        id: "metadata-2",
        providerSource: "tmdb_api",
        title: "Other Movie",
        originalTitle: null,
        releaseYear: 2026,
        payload: {},
        mediaProviderIdentity: {
          provider: "tmdb",
          providerId: "101",
          mediaType: "MOVIE"
        }
      }
    ]);
  });

  it("groups releases before loading provider metadata for trending titles", async () => {
    const results = await listTrendingMedia("tenant-1", { windowDays: 7, limit: 18 });

    expect(mocks.prisma.parsedReleaseMatch.findMany).not.toHaveBeenCalled();
    expect(mocks.prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.mediaTitle.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["media-1", "media-2"] } }
    }));
    expect(mocks.prisma.providerMediaMetadata.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["metadata-1", "metadata-2"] } }
    }));
    expect(results[0]).toMatchObject({
      releaseCount: 2,
      feedCount: 2,
      media: {
        id: "media-1",
        title: "Selected Movie"
      }
    });
  });
});

describe("matchParsedReleaseForItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.provider.search.mockResolvedValue([]);
    mocks.tvdbProvider.search.mockResolvedValue([]);
    mocks.ptgenProvider.search.mockResolvedValue([]);
    mocks.provider.fetchTitle.mockReset();
    mocks.tvdbProvider.fetchTitle.mockReset();
    mocks.ptgenProvider.fetchTitle.mockReset();
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
    mockItemRelease({ mediaType: "MOVIE", title: "The Matrix", year: 1999 });
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
        mediaTitleId: "media-title-tvdb-movie",
        mediaProviderIdentityId: mediaProviderIdentityId("tvdb", "169"),
        providerMediaMetadataId: providerMediaMetadataId("tvdb_api", mediaProviderIdentityId("tvdb", "169"))
      })
    }));
  });

  it("falls back to PTGen when TMDB and TVDB credentials are missing", async () => {
    mockItemRelease({ mediaType: "MOVIE", title: "The Matrix", year: 1999 });
    const policy = await import("../src/server/integrations/providers/policy.js");
    vi.mocked(policy.getMatchingProviderOrder).mockResolvedValueOnce(["tmdb_api", "tvdb_api", "ptgen_douban"]);
    mocks.runtime.tmdb = { ...mocks.runtime.tmdb, credential: undefined };
    mocks.runtime.tvdb = { ...mocks.runtime.tvdb, credential: undefined };
    mocks.ptgenProvider.search.mockResolvedValue([{
      provider: "ptgen",
      providerEntityType: "ptgen_douban",
      providerId: "douban-1291843",
      mediaType: "MOVIE",
      title: "The Matrix",
      normalizedTitle: "the matrix",
      releaseYear: 1999,
      payload: { posterPath: "https://ptgen.leishi.xyz/api/posters/matrix.jpg" },
      ratingValue: 9.1,
      ratingScale: 10,
      ratingVoteCount: 944092,
      ratingType: "user_score",
      matchConfidence: 0.91
    }]);
    mocks.prisma.providerTitle.upsert.mockResolvedValue({
      id: "provider-title-ptgen-movie",
      provider: "ptgen",
      providerEntityType: "ptgen_douban",
      providerId: "douban-1291843",
      mediaType: "MOVIE",
      title: "The Matrix",
      normalizedTitle: "the matrix",
      releaseYear: 1999
    });
    mocks.prisma.mediaTitleProviderLink.findUnique.mockResolvedValue(null);
    mocks.prisma.mediaTitle.findFirst.mockResolvedValue(null);
    mocks.prisma.mediaTitle.create.mockResolvedValue({
      id: "media-title-ptgen-movie",
      mediaType: "MOVIE",
      canonicalTitle: "The Matrix",
      normalizedTitle: "the matrix",
      releaseYear: 1999
    });
    mocks.prisma.mediaTitle.findUnique.mockResolvedValue({ id: "media-title-ptgen-movie", mediaType: "MOVIE" });
    mocks.prisma.providerTitle.findUnique.mockResolvedValue({ id: "provider-title-ptgen-movie", mediaType: "MOVIE" });
    mocks.prisma.mediaTitleProviderLink.upsert.mockResolvedValue({ id: "link-ptgen-movie" });
    mocks.prisma.mediaTitleProviderLink.findFirst.mockResolvedValue({ id: "link-ptgen-movie" });
    mocks.prisma.parsedReleaseMatch.create.mockResolvedValue({ id: "match-ptgen-movie", status: "MATCHED" });

    await matchParsedReleaseForItem({ tenantId: "tenant-1", itemId: "item-1", config });

    expect(mocks.provider.search).not.toHaveBeenCalled();
    expect(mocks.tvdbProvider.search).not.toHaveBeenCalled();
    expect(mocks.ptgenProvider.search).toHaveBeenCalledWith(
      expect.objectContaining({ title: "The Matrix", mediaType: "MOVIE", year: 1999 }),
      expect.objectContaining({ runtime: expect.objectContaining({ provider: "ptgen" }) })
    );
    expect(mocks.prisma.parsedReleaseMatch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "MATCHED",
        reason: "automatic_match",
        mediaTitleId: "media-title-ptgen-movie",
        mediaProviderIdentityId: mediaProviderIdentityId("douban", "1291843"),
        providerMediaMetadataId: providerMediaMetadataId("ptgen_douban", mediaProviderIdentityId("douban", "1291843"))
      })
    }));
  });

  it("continues past weak early provider matches to find a high-confidence provider result", async () => {
    mockItemRelease({
      mediaType: "TV_SERIES",
      title: "American Ninja Warrior",
      year: 2026,
      season: 18,
      episode: 2
    });
    const policy = await import("../src/server/integrations/providers/policy.js");
    vi.mocked(policy.getMatchingProviderOrder).mockResolvedValueOnce(["ptgen_imdb", "tmdb_api"]);
    mocks.ptgenProvider.search.mockResolvedValue([providerResult({
      provider: "ptgen",
      providerEntityType: "ptgen_imdb",
      providerId: "imdb-tt0101122",
      mediaType: "TV_SERIES",
      title: "American Dreams",
      normalizedTitle: "american dreams",
      releaseYear: 2002,
      payload: {},
      matchConfidence: 0.51
    })]);
    mocks.provider.search.mockResolvedValue([providerResult({
      provider: "tmdb",
      providerEntityType: "tmdb_tv",
      providerId: "37913",
      mediaType: "TV_SERIES",
      title: "美国忍者勇士",
      normalizedTitle: "美国忍者勇士",
      originalTitle: "American Ninja Warrior",
      titleAliases: ["American Ninja Warrior"],
      releaseYear: 2009,
      payload: {
        tvSeasonEpisode: {
          season: 18,
          episode: 2,
          episodeCount: 4,
          confirmed: true
        }
      },
      matchConfidence: 0.96
    })]);
    mocks.prisma.mediaTitle.findFirst.mockResolvedValue(null);
    mocks.prisma.mediaTitle.create.mockResolvedValue({
      id: "media-title-american-ninja-warrior",
      mediaType: "TV_SERIES",
      title: "美国忍者勇士",
      titleKey: "美国忍者勇士",
      releaseYear: 2009
    });
    mocks.prisma.mediaTitle.findUnique.mockResolvedValue({
      id: "media-title-american-ninja-warrior",
      mediaType: "TV_SERIES"
    });
    mocks.prisma.parsedReleaseMatch.create.mockResolvedValue({ id: "match-tv", status: "MATCHED" });

    await matchParsedReleaseForItem({ tenantId: "tenant-1", itemId: "item-1", config });

    expect(mocks.ptgenProvider.search).toHaveBeenCalledWith(
      expect.objectContaining({ title: "American Ninja Warrior", mediaType: "TV_SERIES" }),
      expect.objectContaining({ runtime: expect.objectContaining({ providerSource: "ptgen_imdb" }) })
    );
    expect(mocks.provider.search).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "American Ninja Warrior",
        mediaType: "TV_SERIES",
        year: 2026,
        season: 18,
        episode: 2
      }),
      expect.objectContaining({ runtime: expect.objectContaining({ providerSource: "tmdb_api" }) })
    );
    expect(mocks.prisma.parsedReleaseMatch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "MATCHED",
        reason: "automatic_match",
        confidence: 0.96,
        mediaTitleId: "media-title-american-ninja-warrior",
        mediaProviderIdentityId: mediaProviderIdentityId("tmdb", "37913"),
        providerMediaMetadataId: providerMediaMetadataId("tmdb_api", mediaProviderIdentityId("tmdb", "37913"))
      })
    }));
  });

  it("evaluates later results from the same provider search before accepting a low-confidence candidate", async () => {
    mockItemRelease({
      mediaType: "TV_SERIES",
      title: "Deal Or No Deal Au",
      year: 2026,
      season: 14,
      episode: 38
    });
    mocks.provider.search.mockResolvedValue([
      providerResult({
        provider: "tmdb",
        providerEntityType: "tmdb_tv",
        providerId: "2176",
        mediaType: "TV_SERIES",
        title: "Deal or No Deal",
        normalizedTitle: "deal or no deal",
        originalTitle: "Deal or No Deal",
        releaseYear: 2003,
        payload: { posterPath: "/deal-or-no-deal-au-old.jpg" },
        matchConfidence: 0.69
      }),
      providerResult({
        provider: "tmdb",
        providerEntityType: "tmdb_tv",
        providerId: "211249",
        mediaType: "TV_SERIES",
        title: "Deal or No Deal",
        normalizedTitle: "deal or no deal",
        originalTitle: "Deal or No Deal",
        releaseYear: 2003,
        payload: { posterPath: "/deal-or-no-deal-au.jpg" },
        matchConfidence: 0.96
      })
    ]);
    mocks.prisma.mediaTitle.findFirst.mockResolvedValue(null);
    mocks.prisma.mediaTitle.create.mockResolvedValue({
      id: "media-title-deal-or-no-deal-au",
      mediaType: "TV_SERIES",
      title: "Deal or No Deal",
      titleKey: "deal or no deal",
      releaseYear: 2003
    });
    mocks.prisma.parsedReleaseMatch.create.mockResolvedValue({ id: "match-deal-or-no-deal-au", status: "MATCHED" });

    await matchParsedReleaseForItem({ tenantId: "tenant-1", itemId: "item-1", config });

    expect(mocks.prisma.parsedReleaseMatch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "MATCHED",
        reason: "automatic_match",
        confidence: 0.96,
        mediaProviderIdentityId: mediaProviderIdentityId("tmdb", "211249"),
        providerMediaMetadataId: providerMediaMetadataId("tmdb_api", mediaProviderIdentityId("tmdb", "211249"))
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

  it("tries persisted parser alias candidates before declaring no result", async () => {
    mockItemRelease({
      mediaType: "MOVIE",
      title: "Lao hu li",
      year: 2023,
      providerSearchTitles: ["Old Fox"],
      rawTitle: "Lao.hu.li.AKA.Old.Fox.2023.1080p.TWN.Blu-ray.AVC.DTS-HD.MA.7.1-CMCT"
    });
    mocks.provider.search.mockImplementation(async (searchInput: any) =>
      searchInput.title === "Old Fox"
        ? [providerResult({
          provider: "tmdb",
          providerEntityType: "tmdb_movie",
          providerId: "100",
          mediaType: "MOVIE",
          title: "Old Fox",
          normalizedTitle: "old fox",
          releaseYear: 2023,
          payload: { posterPath: "/old-fox.jpg" },
          matchConfidence: 0.93
        })]
        : []
    );
    mocks.prisma.mediaTitle.findFirst.mockResolvedValue(null);
    mocks.prisma.mediaTitle.create.mockResolvedValue({
      id: "media-title-old-fox",
      mediaType: "MOVIE",
      title: "Old Fox",
      titleKey: "old fox",
      releaseYear: 2023
    });
    mocks.prisma.parsedReleaseMatch.create.mockResolvedValue({ id: "match-old-fox", status: "MATCHED" });

    await matchParsedReleaseForItem({ tenantId: "tenant-1", itemId: "item-1", config });

    expect(mocks.provider.search.mock.calls.map(([searchInput]) => searchInput.title)).toEqual([
      "Lao hu li",
      "Old Fox"
    ]);
    expect(mocks.prisma.parsedReleaseMatch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "MATCHED",
        reason: "automatic_match",
        mediaTitleId: "media-title-old-fox",
        mediaProviderIdentityId: mediaProviderIdentityId("tmdb", "100"),
        providerMediaMetadataId: providerMediaMetadataId("tmdb_api", mediaProviderIdentityId("tmdb", "100"))
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
        mediaTitleId: "media-title-tv",
        mediaProviderIdentityId: mediaProviderIdentityId("tmdb", "300"),
        providerMediaMetadataId: providerMediaMetadataId("tmdb_api", mediaProviderIdentityId("tmdb", "300"))
      })
    }));
  });

  it("falls back to TVDB for TV when TMDB has no result", async () => {
    mockItemRelease({ mediaType: "TV_SERIES" });
    mocks.provider.search.mockResolvedValue([]);
    mocks.tvdbProvider.search.mockResolvedValue([{
      provider: "tvdb",
      providerEntityType: "tvdb_series",
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
      provider: "tvdb",
      providerEntityType: "tvdb_series",
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

    expect(mocks.provider.search).toHaveBeenCalled();
    expect(mocks.tvdbProvider.search).toHaveBeenCalled();
    expect(mocks.prisma.parsedReleaseMatch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "MATCHED",
        mediaTitleId: "media-title-fallback",
        mediaProviderIdentityId: mediaProviderIdentityId("tvdb", "301"),
        providerMediaMetadataId: providerMediaMetadataId("tvdb_api", mediaProviderIdentityId("tvdb", "301"))
      })
    }));
  });

  it("falls back to TVDB for TV when TMDB search fails", async () => {
    mockItemRelease({ mediaType: "TV_SERIES" });
    mocks.provider.search.mockRejectedValue(new Error("TMDB unavailable"));
    mocks.tvdbProvider.search.mockResolvedValue([{
      provider: "tvdb",
      providerEntityType: "tvdb_series",
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
      provider: "tvdb",
      providerEntityType: "tvdb_series",
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

    expect(mocks.provider.search).toHaveBeenCalled();
    expect(mocks.tvdbProvider.search).toHaveBeenCalled();
    expect(mocks.prisma.parsedReleaseMatch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "MATCHED",
        mediaTitleId: "media-title-recovered",
        mediaProviderIdentityId: mediaProviderIdentityId("tvdb", "302"),
        providerMediaMetadataId: providerMediaMetadataId("tvdb_api", mediaProviderIdentityId("tvdb", "302"))
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
        mediaProviderIdentityId: mediaProviderIdentityId("tmdb", "100"),
        providerMediaMetadataId: providerMediaMetadataId("tmdb_api", mediaProviderIdentityId("tmdb", "100"))
      })
    }));
  });

  it("does not auto-match provider results with only year-level confidence", async () => {
    mockItemRelease({ mediaType: "MOVIE", title: "Mr. K", year: 2024 });
    mocks.provider.search.mockResolvedValue([{
      provider: "tmdb",
      providerEntityType: "tmdb_movie",
      providerId: "100",
      mediaType: "MOVIE",
      title: "Different Movie",
      normalizedTitle: "different movie",
      releaseYear: 2024,
      payload: { posterPath: "/poster.jpg" },
      matchConfidence: 0.2
    }]);
    mocks.tvdbProvider.search.mockResolvedValue([]);
    mocks.prisma.parsedReleaseMatch.create.mockResolvedValue({ id: "match-1", status: "UNMATCHED" });

    await matchParsedReleaseForItem({ tenantId: "tenant-1", itemId: "item-1", config });

    expect(mocks.prisma.providerMediaMetadata.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.mediaTitle.create).not.toHaveBeenCalled();
    expect(mocks.prisma.parsedReleaseMatch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "UNMATCHED",
        reason: "no_result"
      })
    }));
  });

  it("replaces an active automatic match when rematching raises confidence for the same provider identity", async () => {
    mockItemRelease({ mediaType: "MOVIE", title: "The Matrix", year: 1999 });
    const identityId = mediaProviderIdentityId("tmdb", "603");
    const metadataId = providerMediaMetadataId("tmdb_api", identityId);
    mocks.prisma.parsedReleaseMatch.findFirst.mockResolvedValue({
      id: "old-low-confidence-match",
      status: "MATCHED",
      source: "AUTO",
      mediaTitleId: "media-title-1",
      mediaProviderIdentityId: identityId,
      providerMediaMetadataId: metadataId,
      mediaType: "MOVIE",
      confidence: 0.42,
      reason: "automatic_low_confidence_match"
    });
    mocks.provider.search.mockResolvedValue([{
      provider: "tmdb",
      providerEntityType: "tmdb_movie",
      providerId: "603",
      mediaType: "MOVIE",
      title: "The Matrix",
      normalizedTitle: "the matrix",
      releaseYear: 1999,
      payload: { posterPath: "/poster.jpg" },
      matchConfidence: 0.93
    }]);
    mocks.prisma.providerTitle.upsert.mockResolvedValue({
      id: "provider-title-1",
      provider: "tmdb",
      providerEntityType: "tmdb_movie",
      providerId: "603",
      mediaType: "MOVIE",
      title: "The Matrix",
      normalizedTitle: "the matrix",
      releaseYear: 1999
    });
    mocks.prisma.mediaTitleProviderLink.findUnique.mockResolvedValue(null);
    mocks.prisma.mediaTitle.findFirst.mockResolvedValue({
      id: "media-title-1",
      mediaType: "MOVIE",
      canonicalTitle: "The Matrix",
      normalizedTitle: "the matrix",
      releaseYear: 1999
    });
    mocks.prisma.mediaTitle.findUnique.mockResolvedValue({ id: "media-title-1", mediaType: "MOVIE" });
    mocks.prisma.providerTitle.findUnique.mockResolvedValue({ id: "provider-title-1", mediaType: "MOVIE" });
    mocks.prisma.mediaTitleProviderLink.upsert.mockResolvedValue({ id: "link-1" });
    mocks.prisma.mediaTitleProviderLink.findFirst.mockResolvedValue({ id: "link-1" });
    mocks.prisma.parsedReleaseMatch.create.mockResolvedValue({ id: "new-high-confidence-match", status: "MATCHED" });

    await matchParsedReleaseForItem({ tenantId: "tenant-1", itemId: "item-1", config });

    expect(mocks.prisma.parsedReleaseMatch.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        staleReason: "automatic_match",
        invalidatedAt: expect.any(Date)
      })
    }));
    expect(mocks.prisma.parsedReleaseMatch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "MATCHED",
        source: "AUTO",
        confidence: 0.93,
        reason: "automatic_match",
        mediaTitleId: "media-title-1",
        mediaProviderIdentityId: identityId,
        providerMediaMetadataId: metadataId
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

    const invalidateCall = mocks.prisma.parsedReleaseMatch.updateMany.mock.calls.find((call) =>
      call[0]?.data?.staleReason === "manual_provider_identity"
    );

    expect(rawLockKeys()).toContain("parsed-release-match:tenant-1:release-1");
    expect(rawLockKeys()).toContain("media-title:MOVIE:confirmed movie:2026");
    expect(invalidateCall).toEqual([expect.objectContaining({
      where: expect.objectContaining({
        tenantId: "tenant-1",
        parsedReleaseId: "release-1",
        invalidatedAt: null
      }),
      data: expect.objectContaining({
        staleReason: "manual_provider_identity",
        invalidatedAt: expect.any(Date)
      })
    })]);
    expect(mocks.prisma.parsedReleaseMatch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "MATCHED",
        source: "MANUAL",
        mediaTitleId: "media-title-2",
        mediaProviderIdentityId: mediaProviderIdentityId("tmdb", "200"),
        providerMediaMetadataId: providerMediaMetadataId("tmdb_api", mediaProviderIdentityId("tmdb", "200"))
      })
    }));
    expect(
      mocks.prisma.parsedReleaseMatch.updateMany.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.prisma.parsedReleaseMatch.create.mock.invocationCallOrder[0]);
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
    })).toMatchObject({
      id: "tvdb-selected",
      provider: "tvdb",
      providerId: "200",
      title: "Selected Series"
    });
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
    })).toMatchObject({
      id: "tmdb-linked",
      provider: "tmdb",
      providerId: "300",
      title: "Allowed Series"
    });
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
    })).toMatchObject({
      id: "newer",
      provider: "customa",
      providerId: "1",
      title: "Newer"
    });

    expect(selectPresentationProviderTitle({
      mediaTitle: { id: "media-1", mediaType: "UNKNOWN" },
      providerLinks: [
        { providerTitle: providerTitle({ ...newer, fetchedAt: older.fetchedAt }) },
        { providerTitle: older }
      ]
    })?.provider).toBe("customa");
  });
});

describe("upsertProviderMediaMetadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.mediaTitle.findFirst.mockResolvedValue({
      id: "media-title-current",
      mediaType: "TV_SERIES",
      title: "意外调查组",
      titleKey: "意外调查组",
      releaseYear: 2026
    });
    mocks.prisma.mediaProviderIdentity.upsert.mockImplementation(async (args: any) => ({
      id: "identity-tmdb-323685",
      ...args.create,
      ...args.update
    }));
    mocks.prisma.providerMediaMetadata.upsert.mockImplementation(async (args: any) => ({
      id: "metadata-tmdb-api-identity-tmdb-323685",
      ...args.create,
      mediaProviderIdentity: { id: args.create.mediaProviderIdentityId }
    }));
  });

  it("relinks an existing provider identity to the media title implied by current metadata", async () => {
    await upsertProviderMediaMetadata(mocks.prisma as any, {
      provider: "tmdb",
      providerSource: "tmdb_api",
      providerEntityType: "tmdb_tv",
      providerId: "323685",
      mediaType: "TV_SERIES",
      title: "意外调查组",
      normalizedTitle: "意外调查组",
      titleKey: "意外调查组",
      originalTitle: "Accident Squad",
      titleAliases: ["Accident Squad"],
      releaseYear: 2026,
      localeKey: "zh-CN",
      payload: { posterPath: "/poster.jpg" }
    } as any, {
      linkConfidence: 0.98,
      linkSource: "SEARCH_MATCH"
    });

    expect(mocks.prisma.mediaProviderIdentity.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        provider_providerId_mediaType: {
          provider: "tmdb",
          providerId: "323685",
          mediaType: "TV_SERIES"
        }
      },
      create: expect.objectContaining({
        mediaTitleId: "media-title-current"
      }),
      update: expect.objectContaining({
        mediaTitleId: "media-title-current",
        linkSource: "SEARCH_MATCH",
        linkConfidence: 0.98
      })
    }));
  });
});

function rawLockKeys() {
  return mocks.prisma.$executeRaw.mock.calls.map((call) => (call as unknown[])[1]);
}

function mockItemRelease(input: {
  mediaType: "MOVIE" | "TV_SERIES" | "UNKNOWN";
  title?: string;
  providerSearchTitles?: string[];
  year?: number;
  season?: number | null;
  episode?: number | null;
  rawTitle?: string;
}) {
  const parsedRelease = {
    id: "release-1",
    tenantId: "tenant-1",
    title: input.title ?? "Possible Movie",
    providerSearchTitles: input.providerSearchTitles ?? [],
    year: input.year ?? 2026,
    mediaType: input.mediaType,
    season: input.season ?? null,
    episode: input.episode ?? null,
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
    rawTitle: input.rawTitle ?? `${parsedRelease.title}.${parsedRelease.year}.1080p.WEB-DL.H264-GROUP`,
    parsedRelease
  });
  mocks.prisma.parsedRelease.findUnique.mockResolvedValue(parsedRelease);
}

function trendingMatch(
  mediaTitleId: string,
  providerMediaMetadataId: string,
  firstSeenAt: string,
  feedId: string,
  feedName: string
) {
  return {
    mediaTitleId,
    providerMediaMetadataId,
    quality: "WEB-DL",
    releaseGroup: "GROUP",
    firstSeenAt: new Date(firstSeenAt),
    feedId,
    feedName
  };
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

function mediaProviderIdentityId(provider: string, providerId: string) {
  return `identity-${provider}-${providerId}`;
}

function providerMediaMetadataId(providerSource: string, identityId: string) {
  return `metadata-${providerSource}-${identityId}`;
}
