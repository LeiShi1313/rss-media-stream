import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/server/config.js";
import {
  getDefaultPoliciesForMediaType,
  listProviderDefinitions
} from "../src/server/integrations/providers/index.js";
import {
  getBroadSearchTargets,
  getMatchingProviderOrder,
  getPresentationProviderOrder,
  replaceMediaProviderPolicies
} from "../src/server/integrations/providers/policy.js";
import { scoreProviderCandidate } from "../src/server/integrations/providers/scoring.js";
import { resolveProviderRuntime, upsertProviderSettings } from "../src/server/integrations/providers/runtime.js";
import {
  getPtgenTitleByProviderId,
  ptgenLookupUrl,
  ptgenRecordUrl,
  ptgenSearchUrl,
  searchPtgen
} from "../src/server/integrations/ptgen/client.js";
import {
  ptgenLegacyRecordToTitleResult,
  ptgenSearchHitToTitleResult
} from "../src/server/integrations/ptgen/mapper.js";
import { ptgenProvider } from "../src/server/integrations/ptgen/provider.js";
import { searchTmdb } from "../src/server/integrations/tmdb/client.js";
import { tmdbProvider } from "../src/server/integrations/tmdb/provider.js";
import { toTitleResult } from "../src/server/integrations/tmdb/mapper.js";
import { tvdbProvider } from "../src/server/integrations/tvdb/provider.js";
import { getTvdbMovieById, getTvdbSeriesById } from "../src/server/integrations/tvdb/client.js";
import { tvdbSearchResultToTitleResult } from "../src/server/integrations/tvdb/mapper.js";
import { manualProviderMatchSchema } from "../src/server/modules/media/media.schemas.js";
import { encryptSecret } from "../src/server/secrets.js";

const mocks = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(),
    tenantProviderConfig: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn()
    },
    tenantMediaProviderPolicy: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn()
    }
  }
}));

vi.mock("../src/server/db.js", () => ({ prisma: mocks.prisma }));

const baseConfig: AppConfig = {
  databaseUrl: "postgresql://example.invalid/rss",
  appSecret: "test-app-secret-32-characters-long",
  jwtSecret: "test-jwt-secret-32-characters-long",
  apiHost: "127.0.0.1",
  apiPort: 4000,
  clientOrigin: "http://localhost:5173",
  pollIntervalSeconds: 600,
  nodeEnv: "test"
};

describe("provider adapter defaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.tenantProviderConfig.findUnique.mockResolvedValue(null);
    mocks.prisma.tenantProviderConfig.findMany.mockResolvedValue([]);
    mocks.prisma.tenantMediaProviderPolicy.findMany.mockResolvedValue([]);
  });

  it("uses registry default media type policies", () => {
    expect(listProviderDefinitions().map((provider) => provider.id)).toEqual(["tmdb_api", "tvdb_api", "ptgen_imdb", "ptgen_douban"]);
    const tvdb = listProviderDefinitions().find((provider) => provider.id === "tvdb_api");
    expect(tvdb?.supportedMediaTypes).toEqual(["MOVIE", "TV_SERIES"]);
    const ptgen = listProviderDefinitions().find((provider) => provider.id === "ptgen_imdb");
    expect(ptgen).toMatchObject({
      label: "PTGen IMDb",
      authFields: [],
      baseUrlOptions: []
    });
    expect(getDefaultPoliciesForMediaType("MOVIE").map((policy) => policy.providerSource)).toEqual(["tmdb_api", "tvdb_api", "ptgen_imdb", "ptgen_douban"]);
    expect(getDefaultPoliciesForMediaType("TV_SERIES").map((policy) => policy.providerSource)).toEqual(["tmdb_api", "tvdb_api", "ptgen_imdb", "ptgen_douban"]);
    expect(getDefaultPoliciesForMediaType("MOVIE").find((policy) => policy.providerSource === "ptgen_imdb")).toMatchObject({
      enabledForMatching: true,
      enabledForPresentation: true
    });
  });

  it("resolves missing and environment credential state through runtime", async () => {
    mocks.prisma.tenantProviderConfig.findUnique.mockResolvedValue(null);
    await expect(resolveProviderRuntime(baseConfig, "tenant-1", "tmdb")).resolves.toMatchObject({
      enabled: true,
      credential: undefined,
      metadataLanguage: "en-US"
    });
    await expect(resolveProviderRuntime({ ...baseConfig, tmdbApiKey: "env-key" }, "tenant-1", "tmdb")).resolves.toMatchObject({
      credential: { source: "environment", secrets: { apiKey: "env-key" } }
    });
    await expect(resolveProviderRuntime(baseConfig, "tenant-1", "ptgen")).resolves.toMatchObject({
      enabled: true,
      credential: undefined,
      metadataLanguage: "en-US"
    });
  });

  it("ignores stale base URLs for providers that no longer expose base URL options", async () => {
    mocks.prisma.tenantProviderConfig.findUnique.mockResolvedValue({
      enabled: true,
      baseUrl: "https://ourbits.github.io/PtGen/",
      metadataLanguage: "en-US"
    });

    const runtime = await resolveProviderRuntime(baseConfig, "tenant-1", "ptgen");
    expect(runtime.baseUrl).toBeUndefined();
  });

  it("prefers workspace secrets over environment credentials", async () => {
    mocks.prisma.tenantProviderConfig.findUnique.mockResolvedValue({
      enabled: true,
      encryptedSecretsJson: encryptSecret(JSON.stringify({ apiKey: "workspace-key" }), baseConfig.appSecret),
      metadataLanguage: "ja-JP",
      region: "JP"
    });

    await expect(resolveProviderRuntime({ ...baseConfig, tmdbApiKey: "env-key" }, "tenant-1", "tmdb")).resolves.toMatchObject({
      enabled: true,
      credential: { source: "workspace", secrets: { apiKey: "workspace-key" } },
      metadataLanguage: "ja-JP",
      region: "JP"
    });
  });

  it("removes globally disabled providers from matching and presentation policy order", async () => {
    mocks.prisma.tenantProviderConfig.findMany.mockResolvedValue([{ provider: "tvdb" }]);

    await expect(getMatchingProviderOrder("tenant-1", "TV_SERIES")).resolves.toEqual(["tmdb_api", "ptgen_imdb", "ptgen_douban"]);
    await expect(getPresentationProviderOrder("tenant-1", "TV_SERIES")).resolves.toEqual(["tmdb_api", "ptgen_imdb", "ptgen_douban"]);
  });

  it("builds broad search targets from matching policy order", async () => {
    await expect(getBroadSearchTargets("tenant-1")).resolves.toEqual([
      { providerSource: "tmdb_api", mediaType: "MOVIE" },
      { providerSource: "tvdb_api", mediaType: "MOVIE" },
      { providerSource: "ptgen_imdb", mediaType: "MOVIE" },
      { providerSource: "ptgen_douban", mediaType: "MOVIE" },
      { providerSource: "tmdb_api", mediaType: "TV_SERIES" },
      { providerSource: "tvdb_api", mediaType: "TV_SERIES" },
      { providerSource: "ptgen_imdb", mediaType: "TV_SERIES" },
      { providerSource: "ptgen_douban", mediaType: "TV_SERIES" }
    ]);

    mocks.prisma.tenantMediaProviderPolicy.findMany.mockImplementation(async (args: any) =>
      args.where.mediaType === "MOVIE"
        ? [
            {
              provider: "tmdb",
              enabledForMatching: true,
              enabledForPresentation: true,
              matchingPriority: 1,
              presentationPriority: 1
            },
            {
              provider: "tvdb",
              enabledForMatching: true,
              enabledForPresentation: true,
              matchingPriority: 2,
              presentationPriority: 2
            }
          ]
        : []
    );

    await expect(getPresentationProviderOrder("tenant-1", "MOVIE")).resolves.toEqual(["tmdb_api", "ptgen_imdb", "tvdb_api", "ptgen_douban"]);
  });

  it("rejects duplicate enabled policy priorities", async () => {
    await expect(replaceMediaProviderPolicies("tenant-1", "TV_SERIES", [
      {
        provider: "tvdb",
        enabledForMatching: true,
        enabledForPresentation: true,
        matchingPriority: 1,
        presentationPriority: 1
      },
      {
        provider: "tmdb",
        enabledForMatching: true,
        enabledForPresentation: true,
        matchingPriority: 1,
        presentationPriority: 2
      }
    ])).rejects.toThrow("Duplicate matching priority");
  });

  it("rejects base URL settings for providers without options", async () => {
    await expect(upsertProviderSettings({
      config: baseConfig,
      tenantId: "tenant-1",
      provider: "ptgen",
      baseUrl: "https://cdn.ourhelp.club/ptgen"
    })).rejects.toThrow("PTGen IMDb does not support base URL settings");

    await expect(upsertProviderSettings({
      config: baseConfig,
      tenantId: "tenant-1",
      provider: "tmdb",
      baseUrl: "https://example.invalid"
    })).rejects.toThrow("TMDB API does not support base URL settings");
  });
});

describe("provider adapter probes", () => {
  it("resolves TMDB URLs and explicit shorthand", () => {
    expect(tmdbProvider.probe?.({ input: "https://www.themoviedb.org/movie/603-the-matrix" })).toEqual([{
      provider: "tmdb",
      providerSource: "tmdb_api",
      providerEntityType: "tmdb_movie",
      providerId: "603",
      mediaType: "MOVIE"
    }]);
    expect(tmdbProvider.probe?.({ input: "tmdb:tv:1399" })).toEqual([{
      provider: "tmdb",
      providerSource: "tmdb_api",
      providerEntityType: "tmdb_tv",
      providerId: "1399",
      mediaType: "TV_SERIES"
    }]);
  });

  it("uses media type context for short TMDB IDs", () => {
    expect(tmdbProvider.probe?.({ input: "tmdb:603", mediaType: "MOVIE" })).toEqual([{
      provider: "tmdb",
      providerSource: "tmdb_api",
      providerEntityType: "tmdb_movie",
      providerId: "603",
      mediaType: "MOVIE"
    }]);
    expect(tmdbProvider.probe?.({ input: "tmdb:603", providerEntityType: "tmdb_tv" })).toEqual([{
      provider: "tmdb",
      providerSource: "tmdb_api",
      providerEntityType: "tmdb_tv",
      providerId: "603",
      mediaType: "TV_SERIES"
    }]);
    expect(tmdbProvider.probe?.({ input: "tmdb:603" })).toEqual([]);
  });

  it("resolves contextual TVDB shorthand and turns slug URLs into search hints", () => {
    expect(tvdbProvider.probe?.({ input: "tvdb:series:121361" })).toEqual([{
      provider: "tvdb",
      providerSource: "tvdb_api",
      providerEntityType: "tvdb_series",
      providerId: "121361",
      mediaType: "TV_SERIES"
    }]);
    expect(tvdbProvider.probe?.({ input: "tvdb:movie:169" })).toEqual([{
      provider: "tvdb",
      providerSource: "tvdb_api",
      providerEntityType: "tvdb_movie",
      providerId: "169",
      mediaType: "MOVIE"
    }]);
    expect(tvdbProvider.probe?.({ input: "tvdb:169", mediaType: "MOVIE" })).toEqual([{
      provider: "tvdb",
      providerSource: "tvdb_api",
      providerEntityType: "tvdb_movie",
      providerId: "169",
      mediaType: "MOVIE"
    }]);
    expect(tvdbProvider.probe?.({ input: "tvdb:121361", providerEntityType: "tvdb_series" })).toEqual([{
      provider: "tvdb",
      providerSource: "tvdb_api",
      providerEntityType: "tvdb_series",
      providerId: "121361",
      mediaType: "TV_SERIES"
    }]);
    expect(tvdbProvider.probe?.({ input: "tvdb:169" })).toEqual([]);
    expect(tvdbProvider.probe?.({ input: "https://thetvdb.com/series/game-of-thrones" })).toEqual([{
      provider: "tvdb",
      providerSource: "tvdb_api",
      mediaType: "TV_SERIES",
      searchQuery: "game of thrones"
    }]);
    expect(tvdbProvider.probe?.({ input: "https://thetvdb.com/movies/the-matrix" })).toEqual([{
      provider: "tvdb",
      providerSource: "tvdb_api",
      mediaType: "MOVIE",
      searchQuery: "the matrix"
    }]);
  });

  it("resolves PTGen IMDb and Douban exact IDs and URLs", () => {
    expect(ptgenProvider.probe?.({ input: "imdb-tt0133093", mediaType: "MOVIE" })).toEqual([{
      provider: "ptgen",
      providerSource: "ptgen_imdb",
      providerEntityType: "ptgen_imdb",
      providerId: "imdb-tt0133093",
      mediaType: "MOVIE"
    }]);
    expect(ptgenProvider.probe?.({ input: "imdb-TT0944947" })).toEqual([{
      provider: "ptgen",
      providerSource: "ptgen_imdb",
      providerEntityType: "ptgen_imdb",
      providerId: "imdb-tt0944947",
      mediaType: undefined
    }]);
    expect(ptgenProvider.probe?.({ input: "douban-1291843", mediaType: "MOVIE" })).toEqual([{
      provider: "ptgen",
      providerSource: "ptgen_douban",
      providerEntityType: "ptgen_douban",
      providerId: "douban-1291843",
      mediaType: "MOVIE"
    }]);
    expect(ptgenProvider.probe?.({ input: "https://www.imdb.com/title/TT0133093/" })).toEqual([{
      provider: "ptgen",
      providerSource: "ptgen_imdb",
      providerEntityType: "ptgen_imdb",
      providerId: "imdb-tt0133093",
      mediaType: undefined
    }]);
    expect(ptgenProvider.probe?.({ input: "https://movie.douban.com/subject/1291843/" })).toEqual([{
      provider: "ptgen",
      providerSource: "ptgen_douban",
      providerEntityType: "ptgen_douban",
      providerId: "douban-1291843",
      mediaType: undefined
    }]);
    expect(ptgenProvider.probe?.({ input: "imdb:tt0133093" })).toEqual([]);
    expect(ptgenProvider.probe?.({ input: "douban:not-a-number" })).toEqual([]);
  });
});

describe("manual provider match schema", () => {
  it("accepts TVDB movie entity types", () => {
    expect(manualProviderMatchSchema.parse({
      provider: "tvdb",
      providerEntityType: "tvdb_movie",
      providerId: "169",
      mediaType: "MOVIE"
    })).toEqual({
      providerSource: "tvdb_api",
      providerEntityType: "tvdb_movie",
      providerId: "169",
      mediaType: "MOVIE"
    });
  });

  it("accepts PTGen entity types and validates canonical IDs by source site", () => {
    expect(manualProviderMatchSchema.parse({
      provider: "ptgen",
      providerEntityType: "ptgen_imdb",
      providerId: "imdb-tt0133093",
      mediaType: "MOVIE"
    })).toEqual({
      providerSource: "ptgen_imdb",
      providerEntityType: "ptgen_imdb",
      providerId: "imdb-tt0133093",
      mediaType: "MOVIE"
    });
    expect(manualProviderMatchSchema.parse({
      provider: "ptgen",
      providerEntityType: "ptgen_imdb",
      providerId: "IMDB-TT0133093",
      mediaType: "MOVIE"
    })).toEqual({
      providerSource: "ptgen_imdb",
      providerEntityType: "ptgen_imdb",
      providerId: "imdb-tt0133093",
      mediaType: "MOVIE"
    });
    expect(manualProviderMatchSchema.parse({
      provider: "ptgen",
      providerEntityType: "ptgen_douban",
      providerId: "douban-3016187",
      mediaType: "TV_SERIES"
    })).toEqual({
      providerSource: "ptgen_douban",
      providerEntityType: "ptgen_douban",
      providerId: "douban-3016187",
      mediaType: "TV_SERIES"
    });
    expect(() => manualProviderMatchSchema.parse({
      provider: "ptgen",
      providerEntityType: "ptgen_imdb",
      providerId: "1291843",
      mediaType: "MOVIE"
    })).toThrow("provider ID must be tt... for PTGen IMDb");
  });
});

describe("PTGen title mapper", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps Douban records into provider title results", () => {
    const result = ptgenLegacyRecordToTitleResult(
      {
        site: "douban",
        sid: "1291843",
        chinese_title: "黑客帝国",
        foreign_title: "The Matrix",
        this_title: ["The Matrix"],
        trans_title: ["黑客帝国", "骇客任务"],
        year: "1999",
        imdb_id: "tt0133093",
        imdb_link: "https://www.imdb.com/title/tt0133093/",
        douban_link: "https://movie.douban.com/subject/1291843/",
        poster: "https://img1.doubanio.com/poster.jpg",
        poster_ptgen: "/api/posters/matrix.jpg",
        introduction: "A localized overview.",
        douban_rating_average: "9.1",
        douban_votes: "944092",
        episodes: ""
      },
      {
        source: "douban",
        sourceId: "1291843",
        language: "en-US",
        baseUrl: "https://ptgen.leishi.xyz",
        backend: "search_api"
      }
    )!;

    expect(result).toMatchObject({
      provider: "ptgen",
      providerEntityType: "ptgen_douban",
      providerId: "douban-1291843",
      mediaType: "MOVIE",
      title: "The Matrix",
      originalTitle: "黑客帝国",
      normalizedTitle: "the matrix",
      releaseYear: 1999,
      ratingValue: 9.1,
      ratingScale: 10,
      ratingVoteCount: 944092,
      ratingType: "user_score",
      externalUrl: "https://movie.douban.com/subject/1291843/"
    });
    expect(result.payload).toMatchObject({
      source: "ptgen",
      site: "douban",
      sourceId: "1291843",
      sourceIds: { douban: "1291843", imdb: "tt0133093" },
      posterPath: "https://ptgen.leishi.xyz/api/posters/matrix.jpg",
      originalPoster: "https://img1.doubanio.com/poster.jpg",
      overview: "A localized overview."
    });
  });

  it("maps IMDb series records and host URL formats", () => {
    const result = ptgenLegacyRecordToTitleResult(
      {
        site: "imdb",
        sid: "tt0944947",
        "@type": "TVSeries",
        name: "Game of Thrones",
        year: "2011",
        datePublished: "2011-04-17",
        imdb_link: "https://www.imdb.com/title/tt0944947/",
        poster: "https://m.media-amazon.com/poster.jpg",
        description: "Nine noble families fight for control.",
        imdb_rating_average: 9.2,
        imdb_votes: 2411567
      },
      { source: "imdb", sourceId: "tt0944947", backend: "static_json" }
    )!;

    expect(result).toMatchObject({
      provider: "ptgen",
      providerEntityType: "ptgen_imdb",
      providerId: "imdb-tt0944947",
      mediaType: "TV_SERIES",
      title: "Game of Thrones",
      releaseYear: 2011,
      ratingValue: 9.2,
      ratingVoteCount: 2411567
    });
    expect(ptgenSearchUrl("https://ptgen.leishi.xyz", {
      q: "The Matrix",
      limit: 8,
      offset: 0,
      kind: "movie",
      year: 1999
    })).toBe("https://ptgen.leishi.xyz/api/search?q=The+Matrix&limit=8&offset=0&kind=movie&year=1999");
    expect(ptgenLookupUrl("https://ptgen.leishi.xyz", {
      source: "imdb",
      sourceId: "tt0133093",
      lookupId: "0133093",
      providerEntityType: "ptgen_imdb",
      providerId: "imdb-tt0133093"
    })).toBe("https://ptgen.leishi.xyz/api/lookup?source=imdb&id=0133093");
    expect(ptgenRecordUrl("https://ourbits.github.io/PtGen/", "imdb", "tt0133093"))
      .toBe("https://ourbits.github.io/PtGen/imdb/tt0133093.json");
    expect(ptgenRecordUrl("https://cdn.ourhelp.club/ptgen", "douban", "1291843"))
      .toBe("https://cdn.ourhelp.club/ptgen/douban/1291843.json");
    expect(ptgenRecordUrl("https://api.ourhelp.club/infogen", "imdb", "tt0133093"))
      .toBe("https://api.ourhelp.club/infogen?site=imdb&sid=tt0133093");
  });

  it("maps PTGen Search API hits with canonical IDs and PTGen poster cache first", () => {
    const result = ptgenSearchHitToTitleResult(
      {
        id: "douban-1291843",
        kind: "movie",
        source_ids: { douban: "1291843", imdb: "tt0133093" },
        source_paths: { douban: "douban/1291843.json", imdb: "imdb/tt0133093.json" },
        titles: ["黑客帝国", "The Matrix"],
        aliases: ["骇客任务"],
        year: 1999,
        release_date: "1999-03-31",
        description: "Neo discovers reality is not what it seems.",
        poster: "https://img1.doubanio.com/poster.jpg",
        poster_ptgen: "/api/posters/matrix.jpg",
        rating_score: 9.1,
        rating_votes: 944092
      },
      {
        query: "The Matrix",
        mediaType: "MOVIE",
        language: "en-US",
        baseUrl: "https://ptgen.leishi.xyz",
        backend: "search_api"
      }
    );

    expect(result).toMatchObject({
      provider: "ptgen",
      providerEntityType: "ptgen_douban",
      providerId: "douban-1291843",
      title: "The Matrix",
      originalTitle: "黑客帝国",
      releaseYear: 1999,
      ratingValue: 9.1,
      ratingVoteCount: 944092,
      externalUrl: "https://movie.douban.com/subject/1291843/"
    });
    expect(result?.payload).toMatchObject({
      posterPath: "https://ptgen.leishi.xyz/api/posters/matrix.jpg",
      originalPoster: "https://img1.doubanio.com/poster.jpg",
      backend: "search_api"
    });
    expect(result?.matchConfidence).toBeGreaterThan(0.7);
  });

  it("falls back to PTGen work-kind search while the public index is migrating", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ hits: [] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          hits: [{
            id: "douban-1291843",
            kind: "work",
            source_ids: { douban: "1291843" },
            titles: ["黑客帝国", "The Matrix"],
            year: 1999
          }]
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchPtgen({ title: "The Matrix", mediaType: "MOVIE" });

    expect(fetchMock.mock.calls[0]?.[0]).toContain("kind=movie");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("kind=work");
    expect(results[0]).toMatchObject({
      providerEntityType: "ptgen_douban",
      providerId: "douban-1291843",
      title: "The Matrix"
    });
  });

  it("retries PTGen text search without year when correction context is too narrow", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ hits: [] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ hits: [] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ hits: [] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          hits: [{
            id: "imdb-tt1741246",
            kind: "work",
            source_ids: { imdb: "tt1741246" },
            titles: ["花蕾", "Poupata", "Flower Buds"],
            year: 2011
          }]
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchPtgen({ title: "花蕾", mediaType: "MOVIE", year: 1999 });

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      "https://ptgen.leishi.xyz/api/search?q=%E8%8A%B1%E8%95%BE&limit=8&offset=0&kind=movie&year=1999",
      "https://ptgen.leishi.xyz/api/search?q=%E8%8A%B1%E8%95%BE&limit=8&offset=0&kind=movie",
      "https://ptgen.leishi.xyz/api/search?q=%E8%8A%B1%E8%95%BE&limit=8&offset=0&kind=work&year=1999",
      "https://ptgen.leishi.xyz/api/search?q=%E8%8A%B1%E8%95%BE&limit=8&offset=0&kind=work"
    ]);
    expect(results[0]).toMatchObject({
      providerEntityType: "ptgen_imdb",
      providerId: "imdb-tt1741246",
      title: "Poupata",
      releaseYear: 2011
    });
    expect(results[0]?.matchConfidence).toBeLessThan(0.88);
  });

  it("normalizes transitional work IDs without assigning ambiguous merged ratings", () => {
    const result = ptgenSearchHitToTitleResult(
      {
        id: "work_imdb_tt0133093",
        sources: ["douban", "imdb"],
        source_ids: { douban: "1291843", imdb: "tt0133093" },
        titles: ["黑客帝国", "The Matrix"],
        year: 1999,
        rating_score: 9.1,
        rating_votes: 944092
      },
      {
        query: "The Matrix",
        mediaType: "MOVIE",
        baseUrl: "https://ptgen.leishi.xyz",
        backend: "search_api"
      }
    );

    expect(result).toMatchObject({
      providerEntityType: "ptgen_imdb",
      providerId: "imdb-tt0133093"
    });
    expect(result?.ratingValue).toBeUndefined();
    expect(result?.payload).toMatchObject({
      sourceIds: { douban: "1291843", imdb: "tt0133093" }
    });
  });

  it("uses PTGen Search API lookup records before fallback backends", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "douban-1291843",
        kind: "movie",
        source_ids: { douban: "1291843", imdb: "tt0133093" },
        titles: ["黑客帝国", "The Matrix"],
        year: 1999,
        poster: "https://img1.doubanio.com/poster.jpg",
        poster_ptgen: "/api/posters/matrix.jpg",
        rating_score: 9.1,
        rating_votes: 944092
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getPtgenTitleByProviderId({
      providerEntityType: "ptgen_douban",
      providerId: "douban-1291843",
      mediaType: "MOVIE"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://ptgen.leishi.xyz/api/lookup?source=douban&id=1291843");
    expect(result).toMatchObject({
      providerEntityType: "ptgen_douban",
      providerId: "douban-1291843",
      title: "The Matrix",
      ratingValue: 9.1,
      ratingVoteCount: 944092
    });
    expect(result.payload).toMatchObject({
      posterPath: "https://ptgen.leishi.xyz/api/posters/matrix.jpg",
      originalPoster: "https://img1.doubanio.com/poster.jpg"
    });
  });

  it("treats missing PTGen records as not found instead of upstream failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 404
    }));

    await expect(getPtgenTitleByProviderId({
      providerEntityType: "ptgen_imdb",
      providerId: "imdb-tt0000000"
    })).rejects.toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "PTGen title not found"
    });
  });

  it("surfaces PTGen lookup backend errors when no fallback succeeds", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500
      })
      .mockResolvedValue({
        ok: false,
        status: 404
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getPtgenTitleByProviderId({
      providerEntityType: "ptgen_douban",
      providerId: "douban-1291843"
    })).rejects.toThrow("PTGen lookup failed with 500");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe("TMDB title mapper", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scores localized display titles by original title when available", () => {
    const result = toTitleResult(
      {
        id: 603,
        title: "黑客帝国",
        original_title: "The Matrix",
        release_date: "1999-03-31"
      },
      "movie",
      { title: "The Matrix", mediaType: "MOVIE", year: 1999, language: "zh-CN" }
    );

    expect(result).toMatchObject({
      title: "黑客帝国",
      originalTitle: "The Matrix",
      matchConfidence: expect.any(Number)
    });
    expect(result.matchConfidence).toBeGreaterThanOrEqual(0.88);
  });

  it("maps vote_average and vote_count into provider rating fields", () => {
    const result = toTitleResult(
      {
        id: 27205,
        title: "Inception",
        original_title: "Inception",
        release_date: "2010-07-16",
        poster_path: "/poster.jpg",
        backdrop_path: "/backdrop.jpg",
        overview: "A thief steals secrets through dream-sharing technology.",
        popularity: 83,
        vote_average: 8.37,
        vote_count: 37000
      },
      "movie",
      { title: "Inception", mediaType: "MOVIE", year: 2010, language: "en-US", region: "US" }
    );

    expect(result).toMatchObject({
      provider: "tmdb",
      providerEntityType: "tmdb_movie",
      providerId: "27205",
      mediaType: "MOVIE",
      title: "Inception",
      normalizedTitle: "inception",
      releaseYear: 2010,
      language: "en-US",
      region: "US",
      ratingValue: 8.37,
      ratingScale: 10,
      ratingVoteCount: 37000,
      ratingType: "user_score"
    });
    expect(result.matchConfidence).toBeGreaterThan(0);
  });

  it("uses en-US search titles as scoring aliases for localized TMDB results", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{
            id: 1001,
            name: "莫离",
            original_name: "莫离",
            first_air_date: "2026-01-15"
          }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{
            id: 1001,
            name: "The First Jasmine",
            original_name: "莫离",
            first_air_date: "2026-01-15"
          }]
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchTmdb(
      { title: "The First Jasmine", mediaType: "TV_SERIES", year: 2026 },
      { credential: "tmdb-key", language: "zh-CN" }
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("language=zh-CN");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("language=en-US");
    expect(results[0]).toMatchObject({
      title: "莫离",
      originalTitle: "莫离",
      titleAliases: expect.arrayContaining(["The First Jasmine"]),
      matchConfidence: expect.any(Number)
    });
    expect(results[0]?.matchConfidence).toBeGreaterThanOrEqual(0.88);
  });

  it("boosts exact TV matches when TMDB confirms the parsed season and episode exist", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{
            id: 37913,
            name: "美国忍者勇士",
            original_name: "American Ninja Warrior",
            first_air_date: "2009-12-12"
          }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{
            id: 37913,
            name: "American Ninja Warrior",
            original_name: "American Ninja Warrior",
            first_air_date: "2009-12-12"
          }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 37913,
          name: "美国忍者勇士",
          original_name: "American Ninja Warrior",
          first_air_date: "2009-12-12",
          seasons: [{ season_number: 18, episode_count: 4 }]
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchTmdb(
      {
        title: "American Ninja Warrior",
        mediaType: "TV_SERIES",
        year: 2026,
        season: 18,
        episode: 2
      },
      { credential: "tmdb-key", language: "zh-CN" }
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("first_air_date_year");
    expect(String(fetchMock.mock.calls[1]?.[0])).not.toContain("first_air_date_year");
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/tv/37913?");
    expect(results[0]).toMatchObject({
      title: "美国忍者勇士",
      originalTitle: "American Ninja Warrior",
      matchConfidence: 0.96
    });
    expect(results[0]?.payload).not.toHaveProperty("tvSeasonEpisode");
  });

  it("boosts exact TV season-pack matches when TMDB confirms the parsed season exists", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{
            id: 39898,
            name: "功夫熊猫：盖世传奇",
            original_name: "Kung Fu Panda: Legends of Awesomeness",
            first_air_date: "2011-09-19"
          }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{
            id: 39898,
            name: "Kung Fu Panda: Legends of Awesomeness",
            original_name: "Kung Fu Panda: Legends of Awesomeness",
            first_air_date: "2011-09-19"
          }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 39898,
          name: "功夫熊猫：盖世传奇",
          original_name: "Kung Fu Panda: Legends of Awesomeness",
          first_air_date: "2011-09-19",
          seasons: [{ season_number: 1, episode_count: 26 }]
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchTmdb(
      {
        title: "Kung Fu Panda: Legends of Awesomeness",
        mediaType: "TV_SERIES",
        season: 1
      },
      { credential: "tmdb-key", language: "zh-CN" }
    );

    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/tv/39898?");
    expect(results[0]).toMatchObject({
      title: "功夫熊猫：盖世传奇",
      originalTitle: "Kung Fu Panda: Legends of Awesomeness",
      matchConfidence: 0.93
    });
    expect(results[0]?.payload).not.toHaveProperty("tvSeasonEpisode");
  });

  it("boosts regional TV suffix matches when TMDB country and episode evidence agree", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{
            id: 211249,
            name: "Deal or No Deal",
            original_name: "Deal or No Deal",
            first_air_date: "2003-07-13",
            origin_country: ["AU"]
          }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 211249,
          name: "Deal or No Deal",
          original_name: "Deal or No Deal",
          first_air_date: "2003-07-13",
          origin_country: ["AU"],
          seasons: [{ season_number: 14, episode_count: 40 }]
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchTmdb(
      {
        title: "Deal Or No Deal Au",
        mediaType: "TV_SERIES",
        season: 14,
        episode: 38
      },
      { credential: "tmdb-key", language: "en-US" }
    );

    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/tv/211249?");
    expect(results[0]).toMatchObject({
      title: "Deal or No Deal",
      matchConfidence: 0.96
    });
    expect(results[0]?.payload).not.toHaveProperty("tvSeasonEpisode");
  });

  it("keeps regional TV suffix matches confident when TMDB season detail is stale", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{
            id: 2176,
            name: "Deal or No Deal",
            original_name: "Deal or No Deal",
            first_air_date: "2003-07-13",
            origin_country: ["AU"]
          }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 2176,
          name: "Deal or No Deal",
          original_name: "Deal or No Deal",
          first_air_date: "2003-07-13",
          origin_country: ["AU"],
          seasons: [{ season_number: 12, episode_count: 116 }]
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchTmdb(
      {
        title: "Deal Or No Deal Au",
        mediaType: "TV_SERIES",
        year: 2026,
        season: 14,
        episode: 38
      },
      { credential: "tmdb-key", language: "en-US" }
    );

    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/tv/2176?");
    expect(results[0]).toMatchObject({
      title: "Deal or No Deal",
      matchConfidence: 0.93
    });
  });

  it("accepts exact primary TV title matches when TMDB season detail is stale", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{
            id: 100683,
            name: "Farm to Fork",
            original_name: "Farm to Fork",
            first_air_date: "2019-11-11",
            origin_country: ["AU"]
          }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 100683,
          name: "Farm to Fork",
          original_name: "Farm to Fork",
          first_air_date: "2019-11-11",
          origin_country: ["AU"],
          seasons: [{ season_number: 1, episode_count: 20 }]
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchTmdb(
      {
        title: "Farm to Fork",
        titleSource: "parsed_title",
        mediaType: "TV_SERIES",
        season: 1,
        episode: 68
      },
      { credential: "tmdb-key", language: "en-US" }
    );

    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/tv/100683?");
    expect(results[0]).toMatchObject({
      title: "Farm to Fork",
      matchConfidence: 0.88
    });
  });

  it("accepts exact primary TV special episode matches", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{
            id: 105,
            name: "园艺世界",
            original_name: "Gardeners' World",
            first_air_date: "1968-01-05",
            origin_country: ["GB"]
          }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] })
      });
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchTmdb(
      {
        title: "Gardeners' World",
        titleSource: "parsed_title",
        mediaType: "TV_SERIES",
        season: 0,
        episode: 29
      },
      { credential: "tmdb-key", language: "zh-CN" }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results[0]).toMatchObject({
      title: "园艺世界",
      matchConfidence: 0.88
    });
  });

  it("accepts China-origin localized TV display title matches when episode detail is stale", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{
            id: 303099,
            name: "探索·发现",
            original_name: "探索·发现",
            first_air_date: "2001-07-09",
            origin_country: ["CN"]
          }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 303099,
          name: "探索·发现",
          original_name: "探索·发现",
          first_air_date: "2001-07-09",
          origin_country: ["CN"],
          seasons: [{ season_number: 1, episode_count: 20 }]
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchTmdb(
      {
        title: "探索·发现",
        mediaType: "TV_SERIES",
        year: 2026,
        season: 1,
        episode: 164
      },
      { credential: "tmdb-key", language: "zh-CN" }
    );

    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/tv/303099?");
    expect(results[0]).toMatchObject({
      title: "探索·发现",
      matchConfidence: 0.88
    });
  });

  it("accepts China-origin localized TV display title matches without season evidence", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{
            id: 280632,
            name: "成何体统",
            original_name: "成何体统",
            first_air_date: "2026-06-09",
            origin_country: ["CN"]
          }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] })
      });
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchTmdb(
      {
        title: "成何体统",
        mediaType: "TV_SERIES"
      },
      { credential: "tmdb-key", language: "zh-CN" }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results[0]).toMatchObject({
      title: "成何体统",
      matchConfidence: 0.88
    });
  });

  it("accepts Hong Kong localized TV display title matches without season evidence", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{
            id: 277870,
            name: "香港探秘地图",
            original_name: "香港探秘地圖",
            first_air_date: "2026-06-02",
            origin_country: ["HK"]
          }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] })
      });
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchTmdb(
      {
        title: "香港探秘地图",
        mediaType: "TV_SERIES"
      },
      { credential: "tmdb-key", language: "zh-CN" }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results[0]).toMatchObject({
      title: "香港探秘地图",
      matchConfidence: 0.88
    });
  });

  it("does not boost non-China localized TV display title matches with stale episode detail", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{
            id: 69881,
            name: "出租女友",
            original_name: "レンタルの恋",
            first_air_date: "2017-01-19",
            origin_country: ["JP"]
          }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 69881,
          name: "出租女友",
          original_name: "レンタルの恋",
          first_air_date: "2017-01-19",
          origin_country: ["JP"],
          seasons: [{ season_number: 1, episode_count: 4 }]
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchTmdb(
      {
        title: "出租女友",
        titleSource: "provider_search_title",
        mediaType: "TV_SERIES",
        year: 2026,
        season: 5,
        episode: 10
      },
      { credential: "tmdb-key", language: "zh-CN" }
    );

    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/tv/69881?");
    expect(results[0]?.matchConfidence).toBeLessThan(0.88);
  });

  it("treats US and USA regional TV suffixes as equivalent with TMDB country evidence", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{
            id: 90521,
            name: "Love Island USA",
            original_name: "Love Island USA",
            first_air_date: "2019-07-09",
            origin_country: ["US"]
          }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 90521,
          name: "Love Island USA",
          original_name: "Love Island USA",
          first_air_date: "2019-07-09",
          origin_country: ["US"],
          seasons: [{ season_number: 8, episode_count: 36 }]
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchTmdb(
      {
        title: "Love Island US",
        mediaType: "TV_SERIES",
        season: 8,
        episode: 12
      },
      { credential: "tmdb-key", language: "en-US" }
    );

    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/tv/90521?");
    expect(results[0]?.matchConfidence).toBe(0.96);
  });

  it("treats Portuguese regional TV suffixes as country evidence", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{
            id: 195531,
            name: "Taskmaster Portugal",
            original_name: "Taskmaster",
            first_air_date: "2022-03-19",
            origin_country: ["PT"]
          }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 195531,
          name: "Taskmaster Portugal",
          original_name: "Taskmaster",
          first_air_date: "2022-03-19",
          origin_country: ["PT"],
          seasons: [{ season_number: 7, episode_count: 10 }]
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchTmdb(
      {
        title: "Taskmaster PT",
        mediaType: "TV_SERIES",
        season: 7
      },
      { credential: "tmdb-key", language: "en-US" }
    );

    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/tv/195531?");
    expect(results[0]?.matchConfidence).toBe(0.93);
  });

  it("does not boost regional TV suffix matches when TMDB country evidence disagrees", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{
            id: 3771,
            name: "Deal or No Deal",
            original_name: "Deal or No Deal",
            first_air_date: "2005-12-19",
            origin_country: ["US"]
          }]
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchTmdb(
      {
        title: "Deal Or No Deal Au",
        mediaType: "TV_SERIES",
        season: 14,
        episode: 38
      },
      { credential: "tmdb-key", language: "en-US" }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results[0]?.matchConfidence).toBeLessThan(0.88);
  });

  it("does not treat title-cased Us as a regional TV suffix", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{
            id: 1002,
            name: "The Killer Among",
            original_name: "The Killer Among",
            first_air_date: "2026-06-01",
            origin_country: ["US"]
          }]
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchTmdb(
      {
        title: "The Killer Among Us",
        mediaType: "TV_SERIES",
        season: 1,
        episode: 3
      },
      { credential: "tmdb-key", language: "en-US" }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results[0]?.matchConfidence).toBeLessThan(0.88);
  });

  it("does not boost exact TV matches when TMDB cannot confirm the parsed episode", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{
            id: 37913,
            name: "American Ninja Warrior",
            original_name: "American Ninja Warrior",
            first_air_date: "2009-12-12"
          }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 37913,
          name: "American Ninja Warrior",
          original_name: "American Ninja Warrior",
          first_air_date: "2009-12-12",
          seasons: [{ season_number: 18, episode_count: 1 }]
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchTmdb(
      {
        title: "American Ninja Warrior",
        mediaType: "TV_SERIES",
        season: 18,
        episode: 2
      },
      { credential: "tmdb-key", language: "en-US" }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results[0]?.matchConfidence).toBeLessThan(0.88);
    expect(results[0]?.payload).not.toHaveProperty("tvSeasonEpisode");
  });

  it("does not boost exact TV season-pack matches when TMDB cannot confirm the parsed season", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{
            id: 39898,
            name: "Kung Fu Panda: Legends of Awesomeness",
            original_name: "Kung Fu Panda: Legends of Awesomeness",
            first_air_date: "2011-09-19"
          }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 39898,
          name: "Kung Fu Panda: Legends of Awesomeness",
          original_name: "Kung Fu Panda: Legends of Awesomeness",
          first_air_date: "2011-09-19",
          seasons: [{ season_number: 2, episode_count: 26 }]
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchTmdb(
      {
        title: "Kung Fu Panda: Legends of Awesomeness",
        mediaType: "TV_SERIES",
        season: 1
      },
      { credential: "tmdb-key", language: "en-US" }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results[0]?.matchConfidence).toBeLessThan(0.88);
    expect(results[0]?.payload).not.toHaveProperty("tvSeasonEpisode");
  });

  it("does not fetch TMDB TV detail for fuzzy title matches", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{
            id: 37913,
            name: "American Ninja Warrior",
            original_name: "American Ninja Warrior",
            first_air_date: "2009-12-12"
          }]
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchTmdb(
      {
        title: "American Gladiator",
        mediaType: "TV_SERIES",
        season: 18,
        episode: 2
      },
      { credential: "tmdb-key", language: "en-US" }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results[0]?.matchConfidence).toBeLessThan(0.88);
  });
});

describe("provider candidate scoring", () => {
  it("normalizes punctuation without lowering obvious title/year matches", () => {
    expect(scoreProviderCandidate({
      query: "U S Against the World Four Years with the Mens National Soccer Team",
      candidateTitles: ["U.S. Against the World: Four Years with the Men's National Soccer Team"],
      mediaType: "TV_SERIES",
      expectedYear: 2026,
      actualYear: 2026
    })).toBeGreaterThanOrEqual(0.88);
  });

  it("keeps short contained spin-off titles below automatic confidence", () => {
    expect(scoreProviderCandidate({
      query: "Love Island",
      candidateTitles: ["Love Island: The Debrief"],
      mediaType: "TV_SERIES",
      expectedYear: 2026,
      actualYear: 2026
    })).toBeLessThan(0.88);
  });

  it("allows season suffixes for TV series when the parsed season agrees", () => {
    expect(scoreProviderCandidate({
      query: "Stellar Transformation",
      candidateTitles: ["Stellar Transformation 7"],
      mediaType: "TV_SERIES",
      expectedYear: 2025,
      actualYear: 2025,
      season: 7
    })).toBeGreaterThanOrEqual(0.88);
  });

  it("treats later parsed TV years as noisy instead of first-air-year mismatches", () => {
    expect(scoreProviderCandidate({
      query: "American Ninja Warrior",
      candidateTitles: ["American Ninja Warrior"],
      mediaType: "TV_SERIES",
      expectedYear: 2026,
      actualYear: 2009,
      season: 18
    })).toBe(0.78);
  });

  it("accepts exact TV season-pack matches when the release has no parsed year", () => {
    expect(scoreProviderCandidate({
      query: "Yozakura san Chi no Daisakusen",
      candidateTitles: ["Yozakura-san Chi no Daisakusen"],
      mediaType: "TV_SERIES",
      season: 1,
      actualYear: 2024
    })).toBeGreaterThanOrEqual(0.88);
  });

  it("accepts a short subtitle difference when title and year otherwise match", () => {
    expect(scoreProviderCandidate({
      query: "7 vs Wild",
      candidateTitles: ["7 vs. Wild: Castaway"],
      mediaType: "TV_SERIES",
      expectedYear: 2026,
      actualYear: 2026
    })).toBeGreaterThanOrEqual(0.88);
  });

  it("does not treat shared honorifics as meaningful overlap for short titles", () => {
    expect(scoreProviderCandidate({
      query: "Mr. K",
      candidateTitles: ["Mr. Freeman"],
      mediaType: "MOVIE",
      expectedYear: 2024,
      actualYear: 2024
    })).toBeLessThan(0.3);

    expect(scoreProviderCandidate({
      query: "Mr. K",
      candidateTitles: ["Mr. Kneff"],
      mediaType: "MOVIE",
      expectedYear: 2024,
      actualYear: 2024
    })).toBeLessThan(0.3);
  });
});

describe("TVDB title mapper", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps search relevance separate from rating fields", () => {
    const result = tvdbSearchResultToTitleResult(
      {
        id: "121361",
        tvdb_id: "121361",
        name: "Game of Thrones",
        year: "2011",
        image_url: "https://artworks.thetvdb.com/poster.jpg",
        overview: "Noble families fight for power.",
        score: 98
      },
      { title: "Game of Thrones", year: 2011, language: "en-US", region: "US" }
    );

    expect(result).toMatchObject({
      provider: "tvdb",
      providerEntityType: "tvdb_series",
      providerId: "121361",
      mediaType: "TV_SERIES",
      title: "Game of Thrones",
      normalizedTitle: "game of thrones",
      releaseYear: 2011,
      language: "en-US",
      region: "US",
      matchConfidence: expect.any(Number)
    });
    expect(result?.matchConfidence).toBeGreaterThanOrEqual(0.88);
    expect(result?.ratingValue).toBeUndefined();
    expect(result?.ratingVoteCount).toBeUndefined();
    expect(result?.ratingType).toBeUndefined();
    expect(result?.payload).toMatchObject({ searchScore: 0.98 });
  });

  it("maps TVDB movie search results with provider URLs", () => {
    const result = tvdbSearchResultToTitleResult(
      {
        id: "movie-169",
        tvdb_id: "169",
        type: "movie",
        name: "The Matrix",
        year: "1999",
        image_url: "https://artworks.thetvdb.com/movie.jpg",
        slug: "the-matrix",
        overview: "A hacker discovers reality is not what it seems.",
        score: 99
      },
      { title: "The Matrix", year: 1999, language: "en-US" }
    );

    expect(result).toMatchObject({
      provider: "tvdb",
      providerEntityType: "tvdb_movie",
      providerId: "169",
      mediaType: "MOVIE",
      title: "The Matrix",
      normalizedTitle: "the matrix",
      releaseYear: 1999,
      language: "en-US",
      matchConfidence: expect.any(Number),
      externalUrl: "https://thetvdb.com/movies/the-matrix"
    });
    expect(result?.matchConfidence).toBeGreaterThanOrEqual(0.88);
    expect(result?.ratingValue).toBeUndefined();
  });

  it("passes metadata language through TVDB detail lookup requests", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { token: "token-zh" } })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: 121361,
            name: "Game of Thrones",
            slug: "game-of-thrones",
            year: "2011",
            overview: "Base overview."
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            name: "冰與火之歌 : 權力的遊戲",
            overview: "Localized series overview.",
            language: "zho"
          }
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getTvdbSeriesById(
      {
        providerId: "121361",
        providerEntityType: "tvdb_series",
        mediaType: "TV_SERIES",
        language: "zh-CN"
      },
      { apiKey: "tvdb-language-test-key" }
    );

    expect(fetchMock.mock.calls[1]?.[0]).toContain("/series/121361?language=zh-CN");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: {
        "Accept-Language": "zh-CN",
        Authorization: "Bearer token-zh"
      }
    });
    expect(fetchMock.mock.calls[2]?.[0]).toContain("/series/121361/translations/zho");
    expect(result).toMatchObject({
      title: "冰與火之歌 : 權力的遊戲",
      language: "zh-CN",
      externalUrl: "https://thetvdb.com/series/game-of-thrones",
      payload: {
        overview: "Localized series overview.",
        translation: {
          name: "冰與火之歌 : 權力的遊戲",
          overview: "Localized series overview.",
          language: "zho"
        }
      }
    });
  });

  it("maps TVDB movie detail and overlays translations with TVDB language codes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { token: "token-movie-zh" } })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: 169,
            name: "The Matrix",
            slug: "the-matrix",
            image: "https://artworks.thetvdb.com/movie.jpg",
            first_release: { date: "1999-03-31" },
            overview: "Base overview.",
            status: { name: "Released" }
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { name: "黑客帝国", overview: "Localized overview." } })
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getTvdbMovieById(
      {
        providerId: "169",
        providerEntityType: "tvdb_movie",
        mediaType: "MOVIE",
        language: "zh-CN"
      },
      { apiKey: "tvdb-movie-translation-key" }
    );

    expect(fetchMock.mock.calls[1]?.[0]).toContain("/movies/169");
    expect(fetchMock.mock.calls[2]?.[0]).toContain("/movies/169/translations/zho");
    expect(result).toMatchObject({
      provider: "tvdb",
      providerEntityType: "tvdb_movie",
      providerId: "169",
      mediaType: "MOVIE",
      title: "黑客帝国",
      releaseYear: 1999,
      language: "zh-CN",
      externalUrl: "https://thetvdb.com/movies/the-matrix",
      payload: {
        overview: "Localized overview.",
        translation: { name: "黑客帝国", overview: "Localized overview." }
      }
    });
  });

  it("falls back to base TVDB movie fields when translation is missing", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { token: "token-movie-fallback" } })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: 169,
            name: "The Matrix",
            slug: "the-matrix",
            first_release: { date: "1999-03-31" },
            overview: "Base overview."
          }
        })
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({})
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getTvdbMovieById(
      {
        providerId: "169",
        providerEntityType: "tvdb_movie",
        mediaType: "MOVIE",
        language: "fr-FR"
      },
      { apiKey: "tvdb-movie-fallback-key" }
    );

    expect(fetchMock.mock.calls[2]?.[0]).toContain("/movies/169/translations/fra");
    expect(result).toMatchObject({
      title: "The Matrix",
      language: "fr-FR",
      payload: { overview: "Base overview." }
    });
    expect((result.payload as { translation?: unknown }).translation).toBeUndefined();
  });
});
