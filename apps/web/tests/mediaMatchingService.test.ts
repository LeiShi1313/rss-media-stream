import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/server/config.js";
import { AppError } from "../src/server/core/errors.js";

const mocks = vi.hoisted(() => {
  const prisma = {
    $transaction: vi.fn(async (callback: any) => callback(prisma)),
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(),
    rssItem: { findFirst: vi.fn(), findMany: vi.fn() },
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

  const getActiveRatingProviderSources = vi.fn();

  return { prisma, provider, tvdbProvider, ptgenProvider, runtime, getActiveRatingProviderSources };
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

vi.mock("../src/server/integrations/providers/ratingPreference.js", () => ({
  getActiveRatingProviderSources: mocks.getActiveRatingProviderSources
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
  manuallyMatchParsedReleaseWithProvider,
  matchParsedReleaseForItem
} = await import("../src/server/modules/media/media.service.js");
const {
  getMedia,
  getMediaDetail,
  listTrendingMedia,
  listMediaItems,
  resolveProviderMediaTitle,
  searchLocalMedia
} = await import("../src/server/modules/media/mediaCatalog.js");
const {
  searchExternalMedia,
  smartSearchExternalMedia
} = await import("../src/server/modules/media/providerDiscovery.js");
const { upsertProviderMediaMetadata } = await import(
  "../src/server/modules/media/providerIdentity.js"
);
const {
  createMatchedParsedReleaseMatch,
  createUnmatchedParsedReleaseMatch
} = await import("../src/server/modules/media/releaseMatchLedger.js");
const {
  serializeMediaPresentation,
  selectReleaseMatchForPresentation,
  selectPresentationProviderMetadata
} = await import("../src/server/modules/media/presentation.js");

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

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  mocks.getActiveRatingProviderSources.mockResolvedValue({
    MOVIE: "ptgen_douban",
    TV_SERIES: "ptgen_douban"
  });
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

  it("starts enabled provider searches concurrently while preserving policy result order", async () => {
    let resolveTmdb!: (results: ReturnType<typeof providerResult>[]) => void;
    mocks.provider.search.mockImplementation(() => new Promise((resolve) => {
      resolveTmdb = resolve;
    }));
    mocks.tvdbProvider.search.mockResolvedValue([providerResult({
      provider: "tvdb",
      providerEntityType: "tvdb_series",
      providerId: "200",
      mediaType: "TV_SERIES",
      title: "Concurrent Series",
      normalizedTitle: "concurrent series",
      releaseYear: 2026
    })]);

    const search = searchExternalMedia(config, "tenant-1", {
      q: "Concurrent Series",
      mediaType: "TV_SERIES",
      kind: "TV"
    });
    await vi.waitFor(() => expect(mocks.provider.search).toHaveBeenCalled());
    const tvdbStartedBeforeTmdbCompleted = mocks.tvdbProvider.search.mock.calls.length > 0;

    resolveTmdb([providerResult({
      provider: "tmdb",
      providerEntityType: "tmdb_tv",
      providerId: "300",
      mediaType: "TV_SERIES",
      title: "Concurrent Series",
      normalizedTitle: "concurrent series",
      releaseYear: 2026
    })]);

    await expect(search).resolves.toEqual([
      expect.objectContaining({ provider: "tmdb" }),
      expect.objectContaining({ provider: "tvdb" })
    ]);
    expect(tvdbStartedBeforeTmdbCompleted).toBe(true);
  });

  it("returns partial results after aborting a timed-out provider and logs each outcome", async () => {
    vi.useFakeTimers();
    let tmdbSignal: AbortSignal | undefined;
    mocks.provider.search.mockImplementation((_input, context) => {
      tmdbSignal = context.signal;
      return new Promise<never>((_resolve, reject) => {
        context.signal?.addEventListener("abort", () => reject(context.signal?.reason), { once: true });
      });
    });
    mocks.tvdbProvider.search.mockResolvedValue([providerResult({
      provider: "tvdb",
      providerEntityType: "tvdb_series",
      providerId: "200",
      mediaType: "TV_SERIES",
      title: "Recovered Series",
      normalizedTitle: "recovered series",
      releaseYear: 2026
    })]);
    const logger = { info: vi.fn(), warn: vi.fn() };

    const search = searchExternalMedia(config, "tenant-1", {
      q: "Recovered Series",
      mediaType: "TV_SERIES",
      kind: "TV"
    }, logger);
    const guardedResult = Promise.race([
      search.then((results) => ({ status: "completed" as const, results })),
      new Promise<{ status: "guard" }>((resolve) => {
        setTimeout(() => resolve({ status: "guard" }), 5_001);
      })
    ]);

    await vi.advanceTimersByTimeAsync(5_001);

    await expect(guardedResult).resolves.toEqual({
      status: "completed",
      results: [expect.objectContaining({ provider: "tvdb", providerId: "200" })]
    });
    expect(tmdbSignal?.aborted).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({
      event: "provider_search_finished",
      providerSource: "tmdb_api",
      mediaType: "TV_SERIES",
      outcome: "timeout",
      durationMs: 5_000,
      errorCode: "OPERATION_TIMEOUT"
    }), "provider search finished");
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({
      event: "provider_search_finished",
      providerSource: "tvdb_api",
      mediaType: "TV_SERIES",
      outcome: "success",
      resultCount: 1
    }), "provider search finished");
    expect(logger.warn.mock.calls[0]?.[0]).not.toHaveProperty("title");
    expect(logger.warn.mock.calls[0]?.[0]).not.toHaveProperty("query");
  });

  it("redacts provider failure details in structured search logs", async () => {
    mocks.provider.search.mockRejectedValue(
      new Error("TMDB search failed for https://example.test/search?api_key=secret-value")
    );
    mocks.tvdbProvider.search.mockResolvedValue([providerResult({
      provider: "tvdb",
      providerEntityType: "tvdb_series",
      providerId: "200",
      mediaType: "TV_SERIES",
      title: "Recovered Series",
      normalizedTitle: "recovered series",
      releaseYear: 2026
    })]);
    const logger = { info: vi.fn(), warn: vi.fn() };

    await expect(searchExternalMedia(config, "tenant-1", {
      q: "Recovered Series",
      mediaType: "TV_SERIES",
      kind: "TV"
    }, logger)).resolves.toEqual([
      expect.objectContaining({ provider: "tvdb", providerId: "200" })
    ]);

    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({
      event: "provider_search_finished",
      providerSource: "tmdb_api",
      outcome: "error",
      errorCode: "Error",
      errorMessage: "TMDB search failed for https://example.test/search?api_key=[REDACTED]"
    }), "provider search finished");
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

describe("media catalog reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.rssItem.findMany.mockResolvedValue([]);
  });

  it("searches the global canonical catalog with the existing ordering and aggregate counts", async () => {
    mocks.prisma.mediaTitle.findMany.mockResolvedValue([catalogMedia({
      _count: { releaseMatches: 7, subscriptions: 3 }
    })]);

    const result = await searchLocalMedia("tenant-1", {
      q: "The Matrix",
      mediaType: "MOVIE",
      limit: 20
    });

    expect(mocks.prisma.mediaTitle.findMany).toHaveBeenCalledWith({
      where: {
        mediaType: "MOVIE",
        OR: [
          { titleKey: { contains: "the matrix", mode: "insensitive" } },
          { title: { contains: "The Matrix", mode: "insensitive" } },
          {
            providerIdentities: {
              some: {
                metadata: {
                  some: {
                    OR: [
                      { title: { contains: "The Matrix", mode: "insensitive" } },
                      { originalTitle: { contains: "The Matrix", mode: "insensitive" } }
                    ]
                  }
                }
              }
            }
          }
        ]
      },
      include: {
        providerIdentities: { include: { metadata: true } },
        _count: { select: { releaseMatches: true, subscriptions: true } }
      },
      orderBy: [{ updatedAt: "desc" }, { title: "asc" }],
      take: 20
    });
    expect(result).toEqual([
      expect.objectContaining({
        id: "media-1",
        mediaTitleId: "media-1",
        mediaType: "MOVIE",
        title: "The Matrix",
        releaseYear: 1999,
        matchCount: 7,
        subscriptionCount: 3,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z"
      })
    ]);
  });

  it("gets a global media title while using the tenant only for presentation", async () => {
    mocks.prisma.mediaTitle.findUnique.mockResolvedValue(catalogMedia({
      _count: { releaseMatches: 4, subscriptions: 2 }
    }));

    const result = await getMedia("tenant-1", "media-1");

    expect(mocks.prisma.mediaTitle.findUnique).toHaveBeenCalledWith({
      where: { id: "media-1" },
      include: {
        providerIdentities: { include: { metadata: true } },
        _count: { select: { releaseMatches: true, subscriptions: true } }
      }
    });
    expect(result).toMatchObject({ id: "media-1", matchCount: 4, subscriptionCount: 2 });
  });

  it("lists only active matched items from the requested tenant", async () => {
    mocks.prisma.mediaTitle.findUnique.mockResolvedValue({ id: "media-1", mediaType: "MOVIE" });

    const result = await listMediaItems("tenant-1", "media-1");

    expect(result).toEqual([]);
    expect(mocks.prisma.rssItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        tenantId: "tenant-1",
        parsedRelease: {
          matches: {
            some: {
              tenantId: "tenant-1",
              mediaTitleId: "media-1",
              status: "MATCHED",
              invalidatedAt: null
            }
          }
        }
      },
      orderBy: { firstSeenAt: "desc" }
    }));
  });

  it("short-circuits media detail item reads when the title does not exist", async () => {
    mocks.prisma.mediaTitle.findUnique.mockResolvedValue(null);

    await expect(getMediaDetail("tenant-1", "missing-media"))
      .rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });

    expect(mocks.prisma.rssItem.findMany).not.toHaveBeenCalled();
  });
});

describe("listTrendingMedia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$queryRaw.mockResolvedValue([
      trendingGroup("media-1", "metadata-1", 2, "2026-06-15T10:00:00Z", ["Feed 1", "Feed 2"]),
      trendingGroup("media-2", "metadata-2", 1, "2026-06-15T08:00:00Z", ["Feed 1"])
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

  it("returns a paginated trending media page", async () => {
    const results = await listTrendingMedia("tenant-1", { windowDays: 7, limit: 18 });

    expect(mocks.prisma.parsedReleaseMatch.findMany).not.toHaveBeenCalled();
    expect(mocks.prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.mediaTitle.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["media-1", "media-2"] } }
    }));
    expect(mocks.prisma.providerMediaMetadata.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["metadata-1", "metadata-2"] } }
    }));
    expect(results.nextCursor).toBeUndefined();
    expect(results.items).toHaveLength(2);
    expect(results.items[0]).toMatchObject({
      releaseCount: 2,
      feedCount: 2,
      media: {
        id: "media-1",
        title: "Selected Movie"
      }
    });
  });

  it("returns a cursor when more trending media exists", async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([
      trendingGroup("media-1", "metadata-1", 4, "2026-06-15T10:00:00Z", ["Feed 1"]),
      trendingGroup("media-2", "metadata-2", 3, "2026-06-15T09:00:00Z", ["Feed 2"]),
      trendingGroup("media-3", "metadata-3", 2, "2026-06-15T08:00:00Z", ["Feed 3"])
    ]);

    const results = await listTrendingMedia("tenant-1", { windowDays: 7, limit: 2, mediaType: "MOVIE" });

    expect(results.items.map((entry) => entry.media.id)).toEqual(["media-1", "media-2"]);
    expect(results.nextCursor).toEqual(expect.any(String));
    expect(mocks.prisma.mediaTitle.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["media-1", "media-2"] } }
    }));
  });

  it("accepts the returned cursor for the next page", async () => {
    mocks.prisma.$queryRaw
      .mockResolvedValueOnce([
        trendingGroup("media-1", "metadata-1", 4, "2026-06-15T10:00:00Z", ["Feed 1"]),
        trendingGroup("media-2", "metadata-2", 3, "2026-06-15T09:00:00Z", ["Feed 2"])
      ])
      .mockResolvedValueOnce([
        trendingGroup("media-3", "metadata-3", 2, "2026-06-15T08:00:00Z", ["Feed 3"])
      ]);

    mocks.prisma.mediaTitle.findMany.mockResolvedValueOnce([
      {
        id: "media-1",
        mediaType: "MOVIE",
        title: "Canonical Movie",
        titleKey: "canonical movie",
        releaseYear: 2026,
        providerIdentities: []
      }
    ]).mockResolvedValueOnce([
      {
        id: "media-3",
        mediaType: "MOVIE",
        title: "Third Movie",
        titleKey: "third movie",
        releaseYear: 2026,
        providerIdentities: []
      }
    ]);
    mocks.prisma.providerMediaMetadata.findMany.mockResolvedValueOnce([
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
      }
    ]).mockResolvedValueOnce([]);

    const firstPage = await listTrendingMedia("tenant-1", { windowDays: 7, limit: 1, mediaType: "MOVIE" });
    const secondPage = await listTrendingMedia("tenant-1", {
      windowDays: 7,
      limit: 1,
      mediaType: "MOVIE",
      cursor: firstPage.nextCursor
    });

    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0].media.id).toBe("media-3");
    expect(mocks.prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed cursors before querying", async () => {
    await expect(listTrendingMedia("tenant-1", {
      windowDays: 7,
      limit: 18,
      cursor: "not-a-cursor"
    })).rejects.toMatchObject({ statusCode: 400, code: "BAD_REQUEST" });

    expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("rejects a query media type that conflicts with the cursor", async () => {
    await expect(listTrendingMedia("tenant-1", {
      windowDays: 7,
      limit: 18,
      mediaType: "TV_SERIES",
      cursor: encodeTestTrendingCursor({ mediaType: "MOVIE" })
    })).rejects.toMatchObject({ statusCode: 400, code: "BAD_REQUEST" });

    expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("freezes the timestamp and window from the first page cursor", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
    mocks.prisma.$queryRaw
      .mockResolvedValueOnce([
        trendingGroup("media-1", "metadata-1", 4, "2026-06-15T10:00:00Z", ["Feed 1"]),
        trendingGroup("media-2", "metadata-2", 3, "2026-06-15T09:00:00Z", ["Feed 2"])
      ])
      .mockResolvedValueOnce([]);
    mocks.prisma.mediaTitle.findMany.mockResolvedValueOnce([
      catalogMedia({ id: "media-1" })
    ]).mockResolvedValueOnce([]);

    const firstPage = await listTrendingMedia("tenant-1", {
      windowDays: 7,
      limit: 1,
      mediaType: "MOVIE"
    });
    vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
    await listTrendingMedia("tenant-1", {
      windowDays: 30,
      limit: 1,
      mediaType: "MOVIE",
      cursor: firstPage.nextCursor
    });

    const secondQueryDates = mocks.prisma.$queryRaw.mock.calls[1]
      .filter((value: unknown): value is Date => value instanceof Date)
      .map((value: Date) => value.toISOString());
    expect(secondQueryDates).toContain("2026-06-15T12:00:00.000Z");
    expect(secondQueryDates).toContain("2026-06-08T12:00:00.000Z");
  });

  it("preserves SQL ranking when media rows arrive in a different order", async () => {
    mocks.prisma.mediaTitle.findMany.mockResolvedValue([
      catalogMedia({ id: "media-2", title: "Other Movie", titleKey: "other movie" }),
      catalogMedia({ id: "media-1" })
    ]);

    const result = await listTrendingMedia("tenant-1", { windowDays: 7, limit: 18 });

    expect(result.items.map((entry) => entry.media.id)).toEqual(["media-1", "media-2"]);
  });

  it("caps trending summary arrays without changing stored query results", async () => {
    mocks.prisma.$queryRaw.mockResolvedValueOnce([{
      ...trendingGroup("media-1", "metadata-1", 10, "2026-06-15T10:00:00Z", numbered("Feed", 9)),
      qualities: numbered("Quality", 10),
      releaseGroups: numbered("Group", 10)
    }]);

    const result = await listTrendingMedia("tenant-1", { windowDays: 7, limit: 18 });

    expect(result.items[0].feeds).toHaveLength(6);
    expect(result.items[0].qualities).toHaveLength(8);
    expect(result.items[0].releaseGroups).toHaveLength(8);
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

  it("searches a different rating source concurrently and links its rating to the matched media title", async () => {
    mockItemRelease({ mediaType: "MOVIE", title: "The Matrix", year: 1999 });
    mocks.getActiveRatingProviderSources.mockResolvedValue({ MOVIE: "ptgen_douban" });
    let resolveTmdb!: (results: any[]) => void;
    mocks.provider.search.mockImplementation(() => new Promise((resolve) => {
      resolveTmdb = resolve;
    }));
    mocks.ptgenProvider.search.mockResolvedValue([providerResult({
      provider: "ptgen",
      providerEntityType: "ptgen_douban",
      providerId: "douban-1291843",
      mediaType: "MOVIE",
      title: "The Matrix",
      normalizedTitle: "the matrix",
      releaseYear: 1999,
      ratingValue: 8.8,
      ratingScale: 10,
      ratingVoteCount: 912345,
      ratingType: "user_score",
      matchConfidence: 1
    })]);
    mocks.prisma.mediaTitle.findFirst.mockResolvedValue(null);
    mocks.prisma.mediaTitle.findUnique.mockResolvedValue({
      id: "media-title-matrix",
      mediaType: "MOVIE"
    });
    mocks.prisma.mediaTitle.create.mockResolvedValue({
      id: "media-title-matrix",
      mediaType: "MOVIE",
      title: "The Matrix",
      titleKey: "the matrix",
      releaseYear: 1999
    });
    mocks.prisma.parsedReleaseMatch.create.mockResolvedValue({
      id: "match-matrix",
      status: "MATCHED"
    });

    const matching = matchParsedReleaseForItem({
      tenantId: "tenant-1",
      itemId: "item-1",
      config
    });
    await vi.waitFor(() => {
      expect(mocks.provider.search).toHaveBeenCalled();
      expect(mocks.ptgenProvider.search).toHaveBeenCalled();
    });

    resolveTmdb([providerResult({
      provider: "tmdb",
      providerEntityType: "tmdb_movie",
      providerId: "603",
      mediaType: "MOVIE",
      title: "The Matrix",
      normalizedTitle: "the matrix",
      releaseYear: 1999,
      matchConfidence: 0.98
    })]);

    await expect(matching).resolves.toMatchObject({ status: "MATCHED" });
    expect(mocks.prisma.mediaProviderIdentity.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        mediaTitleId: "media-title-matrix",
        provider: "douban",
        providerId: "1291843",
        linkSource: "SEARCH_MATCH"
      })
    }));
    expect(mocks.prisma.providerMediaMetadata.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        providerSource: "ptgen_douban",
        ratingValue: 8.8,
        ratingScale: 10,
        ratingVoteCount: 912345
      })
    }));
  });

  it("reuses one provider search when matching and rating select the same source", async () => {
    mockItemRelease({ mediaType: "MOVIE", title: "The Matrix", year: 1999 });
    mocks.getActiveRatingProviderSources.mockResolvedValue({ MOVIE: "tmdb_api" });
    mocks.provider.search.mockResolvedValue([providerResult({
      provider: "tmdb",
      providerEntityType: "tmdb_movie",
      providerId: "603",
      mediaType: "MOVIE",
      title: "The Matrix",
      normalizedTitle: "the matrix",
      releaseYear: 1999,
      ratingValue: 8.7,
      ratingScale: 10,
      ratingVoteCount: 25000,
      ratingType: "user_score",
      matchConfidence: 0.98
    })]);
    mocks.prisma.mediaTitle.findFirst.mockResolvedValue(null);
    mocks.prisma.mediaTitle.create.mockResolvedValue({
      id: "media-title-matrix",
      mediaType: "MOVIE",
      title: "The Matrix",
      titleKey: "the matrix",
      releaseYear: 1999
    });
    mocks.prisma.parsedReleaseMatch.create.mockResolvedValue({
      id: "match-matrix",
      status: "MATCHED"
    });

    await matchParsedReleaseForItem({ tenantId: "tenant-1", itemId: "item-1", config });

    expect(mocks.provider.search).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.providerMediaMetadata.upsert).toHaveBeenCalledTimes(1);
  });

  it("keeps a successful release match when rating enrichment fails", async () => {
    mockItemRelease({ mediaType: "MOVIE", title: "The Matrix", year: 1999 });
    mocks.getActiveRatingProviderSources.mockResolvedValue({ MOVIE: "ptgen_douban" });
    mocks.provider.search.mockResolvedValue([providerResult({
      provider: "tmdb",
      providerEntityType: "tmdb_movie",
      providerId: "603",
      mediaType: "MOVIE",
      title: "The Matrix",
      normalizedTitle: "the matrix",
      releaseYear: 1999,
      matchConfidence: 0.98
    })]);
    mocks.ptgenProvider.search.mockRejectedValue(new Error("rating backend unavailable"));
    mocks.prisma.mediaTitle.findFirst.mockResolvedValue(null);
    mocks.prisma.mediaTitle.create.mockResolvedValue({
      id: "media-title-matrix",
      mediaType: "MOVIE",
      title: "The Matrix",
      titleKey: "the matrix",
      releaseYear: 1999
    });
    mocks.prisma.parsedReleaseMatch.create.mockResolvedValue({
      id: "match-matrix",
      status: "MATCHED"
    });

    await expect(matchParsedReleaseForItem({
      tenantId: "tenant-1",
      itemId: "item-1",
      config
    })).resolves.toMatchObject({ status: "MATCHED" });
    expect(mocks.prisma.parsedReleaseMatch.create).toHaveBeenCalled();
    expect(mocks.ptgenProvider.search).toHaveBeenCalled();
    expect(mocks.prisma.providerMediaMetadata.upsert).toHaveBeenCalledTimes(1);
  });

  it("returns a committed release match without waiting for a slow rating source", async () => {
    mockItemRelease({ mediaType: "MOVIE", title: "The Matrix", year: 1999 });
    mocks.getActiveRatingProviderSources.mockResolvedValue({ MOVIE: "ptgen_douban" });
    mocks.provider.search.mockResolvedValue([providerResult({
      provider: "tmdb",
      providerEntityType: "tmdb_movie",
      providerId: "603",
      mediaType: "MOVIE",
      title: "The Matrix",
      normalizedTitle: "the matrix",
      releaseYear: 1999,
      matchConfidence: 0.98
    })]);
    let resolveRating!: (results: any[]) => void;
    mocks.ptgenProvider.search.mockImplementation(() => new Promise((resolve) => {
      resolveRating = resolve;
    }));
    mocks.prisma.mediaTitle.findFirst.mockResolvedValue(null);
    mocks.prisma.mediaTitle.create.mockResolvedValue({
      id: "media-title-matrix",
      mediaType: "MOVIE",
      title: "The Matrix",
      titleKey: "the matrix",
      releaseYear: 1999
    });
    mocks.prisma.parsedReleaseMatch.create.mockResolvedValue({
      id: "match-matrix",
      status: "MATCHED"
    });

    const matching = matchParsedReleaseForItem({
      tenantId: "tenant-1",
      itemId: "item-1",
      config
    });
    const outcome = await Promise.race([
      matching.then(() => "matched" as const),
      new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 50))
    ]);
    resolveRating([]);
    await matching;

    expect(outcome).toBe("matched");
  });

  it("does not cross-link rating metadata through a low-confidence automatic match", async () => {
    mockItemRelease({ mediaType: "MOVIE", title: "The Matrix", year: 1999 });
    mocks.getActiveRatingProviderSources.mockResolvedValue({ MOVIE: "ptgen_douban" });
    mocks.provider.search.mockResolvedValue([providerResult({
      provider: "tmdb",
      providerEntityType: "tmdb_movie",
      providerId: "603",
      mediaType: "MOVIE",
      title: "The Matrix Reloaded",
      normalizedTitle: "the matrix reloaded",
      releaseYear: 1999,
      matchConfidence: 0.5
    })]);
    mocks.ptgenProvider.search.mockResolvedValue([providerResult({
      provider: "ptgen",
      providerEntityType: "ptgen_douban",
      providerId: "douban-1291843",
      mediaType: "MOVIE",
      title: "The Matrix",
      normalizedTitle: "the matrix",
      releaseYear: 1999,
      ratingValue: 8.8,
      ratingScale: 10,
      ratingType: "user_score",
      matchConfidence: 1
    })]);
    mocks.prisma.mediaTitle.findFirst.mockResolvedValue(null);
    mocks.prisma.mediaTitle.create.mockResolvedValue({
      id: "media-title-low-confidence",
      mediaType: "MOVIE",
      title: "The Matrix Reloaded",
      titleKey: "the matrix reloaded",
      releaseYear: 1999
    });
    mocks.prisma.parsedReleaseMatch.create.mockResolvedValue({
      id: "match-low-confidence",
      status: "MATCHED"
    });

    await matchParsedReleaseForItem({ tenantId: "tenant-1", itemId: "item-1", config });

    expect(mocks.ptgenProvider.search).toHaveBeenCalled();
    expect(mocks.prisma.providerMediaMetadata.upsert).toHaveBeenCalledTimes(1);
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
  it("falls through an empty preferred source to the next configured metadata source", () => {
    const presentation = serializeMediaPresentation({
      mediaTitle: {
        id: "media-1",
        mediaType: "MOVIE",
        title: "Obsession",
        releaseYear: 2025,
        providerIdentities: [
          {
            provider: "tmdb",
            providerId: "1436161",
            mediaType: "MOVIE",
            metadata: [{
              providerSource: "tmdb_api",
              title: "Obsession",
              releaseYear: 2025,
              payload: {
                overview: "",
                posterPath: null,
                backdropPath: null
              }
            }]
          },
          {
            provider: "douban",
            providerId: "37450627",
            mediaType: "MOVIE",
            metadata: [{
              providerSource: "ptgen_douban",
              title: "Obsession",
              originalTitle: "痴迷",
              releaseYear: 2025,
              payload: {
                overview: "A supernatural wish becomes an obsession.",
                posterPath: "https://ptgen.example/posters/obsession"
              }
            }]
          }
        ]
      }
    }, {
      providerOrder: ["tmdb_api", "ptgen_douban"]
    });

    expect(presentation.displaySource).toMatchObject({
      provider: "douban",
      providerSource: "ptgen_douban",
      providerId: "37450627"
    });
    expect(presentation.overview).toBe("A supernatural wish becomes an obsession.");
    expect(presentation.posterUrl).toBe("https://ptgen.example/posters/obsession");
  });

  it("chooses the active matched release row from presentation provider order", () => {
    const imdbMatch = {
      id: "imdb-match",
      status: "MATCHED",
      matchedAt: new Date("2026-06-03T10:00:00Z"),
      providerMediaMetadata: {
        providerSource: "ptgen_imdb",
        mediaProviderIdentity: { provider: "imdb", providerId: "imdb-tt0133093" }
      }
    };
    const doubanMatch = {
      id: "douban-match",
      status: "MATCHED",
      matchedAt: new Date("2026-06-01T10:00:00Z"),
      providerMediaMetadata: {
        providerSource: "ptgen_douban",
        mediaProviderIdentity: { provider: "douban", providerId: "douban-1291843" }
      }
    };
    const unmatched = {
      id: "unmatched",
      status: "UNMATCHED",
      updatedAt: new Date("2026-06-04T10:00:00Z")
    };

    expect(selectReleaseMatchForPresentation(
      [unmatched, imdbMatch, doubanMatch],
      ["ptgen_douban", "ptgen_imdb"]
    )).toMatchObject({ id: "douban-match" });
  });

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

    expect(selectPresentationProviderMetadata({
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

    expect(selectPresentationProviderMetadata({
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

    expect(selectPresentationProviderMetadata({
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

    expect(selectPresentationProviderMetadata({
      mediaTitle: { id: "media-1", mediaType: "UNKNOWN" },
      providerLinks: [
        { providerTitle: providerTitle({ ...newer, fetchedAt: older.fetchedAt }) },
        { providerTitle: older }
      ]
    })?.provider).toBe("customa");
  });

  it("selects rating metadata independently from display metadata", () => {
    const presentation = serializeMediaPresentation({
      mediaTitle: {
        id: "media-1",
        mediaType: "MOVIE",
        title: "Canonical Movie",
        releaseYear: 1999,
        providerIdentities: [
          {
            provider: "tmdb",
            providerId: "603",
            mediaType: "MOVIE",
            metadata: [{
              providerSource: "tmdb_api",
              title: "The Matrix",
              releaseYear: 1999,
              payload: { posterPath: "/matrix.jpg" },
              ratingValue: 7.2,
              ratingScale: 10,
              ratingVoteCount: 1200,
              ratingType: "USER_SCORE",
              fetchedAt: new Date("2026-07-01T10:00:00Z")
            }]
          },
          {
            provider: "douban",
            providerId: "1291843",
            mediaType: "MOVIE",
            metadata: [{
              providerSource: "ptgen_douban",
              title: "The Matrix",
              releaseYear: 1999,
              payload: {},
              ratingValue: 8.8,
              ratingScale: 10,
              ratingVoteCount: 912345,
              ratingType: "USER_SCORE",
              fetchedAt: new Date("2026-07-02T10:00:00Z")
            }]
          }
        ]
      }
    }, {
      providerOrder: ["tmdb_api"],
      ratingProviderSource: "ptgen_douban"
    });

    expect(presentation.title).toBe("The Matrix");
    expect(presentation.displaySource).toMatchObject({
      provider: "tmdb",
      providerSource: "tmdb_api",
      providerId: "603"
    });
    expect(presentation.rating).toEqual({
      provider: "douban",
      providerSource: "ptgen_douban",
      providerId: "1291843",
      providerLabel: "Douban",
      providerSourceLabel: "PTGen Douban",
      value: 8.8,
      scale: 10,
      voteCount: 912345,
      type: "user_score",
      fetchedAt: "2026-07-02T10:00:00.000Z"
    });
    expect(presentation.rating).not.toHaveProperty("normalized");
  });

  it("does not fall back when the selected rating source has no valid rating", () => {
    const presentation = serializeMediaPresentation({
      mediaTitle: {
        id: "media-1",
        mediaType: "MOVIE",
        title: "Canonical Movie",
        providerIdentities: [{
          provider: "tmdb",
          providerId: "603",
          mediaType: "MOVIE",
          metadata: [{
            providerSource: "tmdb_api",
            title: "The Matrix",
            payload: {},
            ratingValue: 7.2,
            ratingScale: 10,
            ratingType: "USER_SCORE"
          }]
        }]
      }
    }, {
      providerOrder: ["tmdb_api"],
      ratingProviderSource: "ptgen_douban"
    });

    expect(presentation.rating).toBeUndefined();
  });
});

describe("createMatchedParsedReleaseMatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reuses an identical active unmatched decision", async () => {
    const existing = {
      id: "existing-unmatched",
      status: "UNMATCHED",
      reason: "no_result"
    };
    mocks.prisma.parsedReleaseMatch.findFirst.mockResolvedValue(existing);

    const result = await createUnmatchedParsedReleaseMatch(mocks.prisma as any, {
      tenantId: "tenant-1",
      parsedReleaseId: "parsed-release-1",
      reason: "no_result"
    });

    expect(result).toBe(existing);
    expect(rawLockKeys()).toContain("parsed-release-match:tenant-1:parsed-release-1");
    expect(mocks.prisma.parsedReleaseMatch.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.parsedReleaseMatch.create).not.toHaveBeenCalled();
  });

  it("invalidates an active decision before validating links and creating its replacement", async () => {
    mocks.prisma.parsedReleaseMatch.findFirst.mockResolvedValue(null);
    mocks.prisma.parsedReleaseMatch.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.mediaProviderIdentity.findFirst.mockResolvedValue({ id: "identity-1" });
    mocks.prisma.providerMediaMetadata.findFirst.mockResolvedValue({ id: "metadata-1" });
    mocks.prisma.parsedReleaseMatch.create.mockResolvedValue({ id: "replacement-match" });

    await createMatchedParsedReleaseMatch(mocks.prisma as any, matchedLedgerInput());

    expect(mocks.prisma.parsedReleaseMatch.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ staleReason: "automatic_match" })
    }));
    expect(mocks.prisma.parsedReleaseMatch.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.prisma.mediaProviderIdentity.findFirst.mock.invocationCallOrder[0]);
    expect(mocks.prisma.mediaProviderIdentity.findFirst.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.prisma.providerMediaMetadata.findFirst.mock.invocationCallOrder[0]);
    expect(mocks.prisma.providerMediaMetadata.findFirst.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.prisma.parsedReleaseMatch.create.mock.invocationCallOrder[0]);
  });

  it("creates a distinct active match without invalidation when replaceActive is false", async () => {
    mocks.prisma.parsedReleaseMatch.findFirst
      .mockResolvedValueOnce({
        id: "different-active-match",
        status: "MATCHED",
        mediaTitleId: "different-media"
      })
      .mockResolvedValueOnce(null);
    mocks.prisma.mediaProviderIdentity.findFirst.mockResolvedValue({ id: "identity-1" });
    mocks.prisma.providerMediaMetadata.findFirst.mockResolvedValue({ id: "metadata-1" });
    mocks.prisma.parsedReleaseMatch.create.mockResolvedValue({ id: "second-active-match" });

    const result = await createMatchedParsedReleaseMatch(mocks.prisma as any, {
      ...matchedLedgerInput(),
      replaceActive: false
    });

    expect(result).toEqual({ id: "second-active-match" });
    expect(mocks.prisma.parsedReleaseMatch.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.parsedReleaseMatch.create).toHaveBeenCalledTimes(1);
  });

  it("reuses an equivalent active match when preserving multiple active provider matches", async () => {
    const existingImportedMatch = {
      id: "existing-imdb-match",
      status: "MATCHED",
      mediaTitleId: "media-title-imdb",
      mediaProviderIdentityId: "identity-imdb",
      providerMediaMetadataId: "metadata-imdb",
      mediaType: "MOVIE",
      source: "AUTO",
      confidence: 1,
      reason: "imported_provider_identity"
    };

    mocks.prisma.parsedReleaseMatch.findFirst
      .mockResolvedValueOnce({
        id: "newer-douban-match",
        status: "MATCHED",
        mediaTitleId: "media-title-douban",
        mediaProviderIdentityId: "identity-douban",
        providerMediaMetadataId: "metadata-douban",
        mediaType: "MOVIE",
        source: "AUTO",
        confidence: 1,
        reason: "imported_provider_identity"
      })
      .mockResolvedValueOnce(existingImportedMatch);

    const result = await createMatchedParsedReleaseMatch(mocks.prisma as any, {
      tenantId: "tenant-1",
      parsedReleaseId: "parsed-release-1",
      mediaTitleId: "media-title-imdb",
      mediaProviderIdentityId: "identity-imdb",
      providerMediaMetadataId: "metadata-imdb",
      mediaType: "MOVIE",
      source: "AUTO",
      confidence: 1,
      reason: "imported_provider_identity",
      replaceActive: false
    });

    expect(result).toBe(existingImportedMatch);
    expect(mocks.prisma.parsedReleaseMatch.create).not.toHaveBeenCalled();
    expect(mocks.prisma.parsedReleaseMatch.updateMany).not.toHaveBeenCalled();
  });
});

describe("resolveProviderMediaTitle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.provider.fetchTitle.mockResolvedValue(providerResult({
      provider: "tmdb",
      providerEntityType: "tmdb_tv",
      providerId: "300",
      mediaType: "TV_SERIES",
      title: "TV Stand-up Comedy",
      normalizedTitle: "tv stand up comedy",
      releaseYear: 2024,
      payload: { posterPath: "/poster.jpg" }
    }));
    mocks.prisma.mediaTitle.findFirst.mockResolvedValue(null);
    mocks.prisma.mediaTitle.create.mockResolvedValue({
      id: "media-title-stand-up",
      mediaType: "TV_SERIES",
      title: "TV Stand-up Comedy",
      titleKey: "tv stand up comedy",
      releaseYear: 2024
    });
  });

  it("resolves a selected provider result into a canonical media title", async () => {
    const resolved = await resolveProviderMediaTitle(config, "tenant-1", {
      providerSource: "tmdb_api",
      providerEntityType: "tmdb_tv",
      providerId: "300",
      mediaType: "TV_SERIES"
    });

    expect(mocks.provider.fetchTitle).toHaveBeenCalledWith(
      expect.objectContaining({
        providerEntityType: "tmdb_tv",
        providerId: "300",
        mediaType: "TV_SERIES"
      }),
      expect.objectContaining({ runtime: expect.objectContaining({ tenantId: "tenant-1" }) })
    );
    expect(mocks.prisma.mediaProviderIdentity.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        mediaTitleId: "media-title-stand-up",
        provider: "tmdb",
        providerId: "300",
        mediaType: "TV_SERIES",
        linkSource: "MANUAL",
        linkConfidence: 1
      })
    }));
    expect(resolved).toMatchObject({
      mediaTitleId: "media-title-stand-up",
      mediaType: "TV_SERIES",
      title: "TV Stand-up Comedy",
      provider: "tmdb",
      providerSource: "tmdb_api",
      providerEntityType: "tmdb_tv",
      providerId: "300"
    });
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
    expect(rawLockKeys()).toContain("media-title:TV_SERIES:意外调查组:2026");
    expect(mocks.prisma.mediaTitle.findFirst.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.prisma.mediaProviderIdentity.upsert.mock.invocationCallOrder[0]);
    expect(mocks.prisma.mediaProviderIdentity.upsert.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.prisma.providerMediaMetadata.upsert.mock.invocationCallOrder[0]);
  });

  it("rejects forced metadata persistence when the canonical title type differs", async () => {
    mocks.prisma.mediaTitle.findUnique.mockResolvedValue({
      id: "media-title-movie",
      mediaType: "MOVIE"
    });

    await expect(upsertProviderMediaMetadata(mocks.prisma as any, {
      provider: "tmdb",
      providerSource: "tmdb_api",
      providerEntityType: "tmdb_tv",
      providerId: "323685",
      mediaType: "TV_SERIES",
      title: "意外调查组",
      normalizedTitle: "意外调查组",
      titleKey: "意外调查组",
      titleAliases: [],
      releaseYear: 2026,
      localeKey: "zh-CN",
      payload: {}
    } as any, {
      linkConfidence: 1,
      linkSource: "SEARCH_MATCH",
      mediaTitleId: "media-title-movie"
    })).rejects.toMatchObject({ code: "MEDIA_TYPE_MISMATCH" });

    expect(mocks.prisma.mediaProviderIdentity.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.providerMediaMetadata.upsert).not.toHaveBeenCalled();
  });

  it("does not take the known-year canonical title lock when the year is absent", async () => {
    mocks.prisma.mediaTitle.findFirst.mockResolvedValue(null);
    mocks.prisma.mediaTitle.create.mockResolvedValue({
      id: "media-title-no-year",
      mediaType: "MOVIE",
      title: "Unknown Year",
      titleKey: "unknown year",
      releaseYear: null
    });

    await upsertProviderMediaMetadata(mocks.prisma as any, {
      provider: "tmdb",
      providerSource: "tmdb_api",
      providerEntityType: "tmdb_movie",
      providerId: "999",
      mediaType: "MOVIE",
      title: "Unknown Year",
      normalizedTitle: "unknown year",
      titleKey: "unknown year",
      titleAliases: [],
      localeKey: "en-US",
      payload: {}
    } as any, {
      linkConfidence: 1,
      linkSource: "SEARCH_MATCH"
    });

    expect(rawLockKeys().filter((key) => String(key).startsWith("media-title:"))).toEqual([]);
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

function trendingGroup(
  mediaTitleId: string,
  providerMediaMetadataId: string,
  releaseCount: number,
  latestReleaseAt: string,
  feeds: string[]
) {
  return {
    mediaTitleId,
    providerMediaMetadataId,
    releaseCount,
    latestReleaseAt: new Date(latestReleaseAt),
    feedCount: feeds.length,
    feeds,
    qualities: ["WEB-DL"],
    releaseGroups: ["GROUP"]
  };
}

function catalogMedia(overrides: Record<string, unknown> = {}) {
  return {
    id: "media-1",
    mediaType: "MOVIE",
    title: "The Matrix",
    titleKey: "the matrix",
    releaseYear: 1999,
    endYear: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    providerIdentities: [],
    ...overrides
  };
}

function encodeTestTrendingCursor(overrides: Record<string, unknown> = {}) {
  return Buffer.from(JSON.stringify({
    timestamp: "2026-06-15T12:00:00.000Z",
    windowDays: 7,
    releaseCount: 4,
    latestReleaseAt: "2026-06-15T10:00:00.000Z",
    mediaTitleId: "media-1",
    ...overrides
  }), "utf8").toString("base64url");
}

function numbered(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`);
}

function matchedLedgerInput() {
  return {
    tenantId: "tenant-1",
    parsedReleaseId: "parsed-release-1",
    mediaTitleId: "media-1",
    mediaProviderIdentityId: "identity-1",
    providerMediaMetadataId: "metadata-1",
    mediaType: "MOVIE" as const,
    source: "AUTO" as const,
    confidence: 0.95,
    reason: "automatic_match"
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
