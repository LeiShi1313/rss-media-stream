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
import { resolveProviderRuntime, upsertProviderSettings } from "../src/server/integrations/providers/runtime.js";
import { getPtgenTitleById, ptgenRecordUrl } from "../src/server/integrations/ptgen/client.js";
import { ptgenRecordToTitleResult } from "../src/server/integrations/ptgen/mapper.js";
import { ptgenProvider } from "../src/server/integrations/ptgen/provider.js";
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
    expect(listProviderDefinitions().map((provider) => provider.id)).toEqual(["tmdb", "tvdb", "ptgen"]);
    const tvdb = listProviderDefinitions().find((provider) => provider.id === "tvdb");
    expect(tvdb?.supportedMediaTypes).toEqual(["MOVIE", "TV_SERIES"]);
    const ptgen = listProviderDefinitions().find((provider) => provider.id === "ptgen");
    expect(ptgen).toMatchObject({
      authFields: [],
      defaultBaseUrl: "https://ourbits.github.io/PtGen/"
    });
    expect(getDefaultPoliciesForMediaType("MOVIE").map((policy) => policy.provider)).toEqual(["tmdb", "tvdb", "ptgen"]);
    expect(getDefaultPoliciesForMediaType("TV_SERIES").map((policy) => policy.provider)).toEqual(["tvdb", "tmdb", "ptgen"]);
    expect(getDefaultPoliciesForMediaType("MOVIE").find((policy) => policy.provider === "ptgen")).toMatchObject({
      enabledForMatching: false,
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
      metadataLanguage: "en-US",
      baseUrl: "https://ourbits.github.io/PtGen/"
    });
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

    await expect(getMatchingProviderOrder("tenant-1", "TV_SERIES")).resolves.toEqual(["tmdb"]);
    await expect(getPresentationProviderOrder("tenant-1", "TV_SERIES")).resolves.toEqual(["tmdb", "ptgen"]);
  });

  it("builds broad search targets from matching policy order", async () => {
    await expect(getBroadSearchTargets("tenant-1")).resolves.toEqual([
      { provider: "tmdb", mediaType: "MOVIE" },
      { provider: "tvdb", mediaType: "MOVIE" },
      { provider: "tvdb", mediaType: "TV_SERIES" },
      { provider: "tmdb", mediaType: "TV_SERIES" }
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

    await expect(getPresentationProviderOrder("tenant-1", "MOVIE")).resolves.toEqual(["tmdb", "tvdb", "ptgen"]);
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

  it("canonicalizes PtGen base URL settings and rejects base URLs for providers without options", async () => {
    await upsertProviderSettings({
      config: baseConfig,
      tenantId: "tenant-1",
      provider: "ptgen",
      baseUrl: "https://cdn.ourhelp.club/ptgen"
    });

    expect(mocks.prisma.tenantProviderConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        provider: "ptgen",
        baseUrl: "https://cdn.ourhelp.club/ptgen/"
      }),
      update: expect.objectContaining({
        baseUrl: "https://cdn.ourhelp.club/ptgen/"
      })
    }));

    await expect(upsertProviderSettings({
      config: baseConfig,
      tenantId: "tenant-1",
      provider: "tmdb",
      baseUrl: "https://example.invalid"
    })).rejects.toThrow("TMDB does not support base URL settings");
  });
});

describe("provider adapter probes", () => {
  it("resolves TMDB URLs and explicit shorthand", () => {
    expect(tmdbProvider.probe?.({ input: "https://www.themoviedb.org/movie/603-the-matrix" })).toEqual([{
      provider: "tmdb",
      providerEntityType: "tmdb_movie",
      providerId: "603",
      mediaType: "MOVIE"
    }]);
    expect(tmdbProvider.probe?.({ input: "tmdb:tv:1399" })).toEqual([{
      provider: "tmdb",
      providerEntityType: "tmdb_tv",
      providerId: "1399",
      mediaType: "TV_SERIES"
    }]);
  });

  it("uses media type context for short TMDB IDs", () => {
    expect(tmdbProvider.probe?.({ input: "tmdb:603", mediaType: "MOVIE" })).toEqual([{
      provider: "tmdb",
      providerEntityType: "tmdb_movie",
      providerId: "603",
      mediaType: "MOVIE"
    }]);
    expect(tmdbProvider.probe?.({ input: "tmdb:603", providerEntityType: "tmdb_tv" })).toEqual([{
      provider: "tmdb",
      providerEntityType: "tmdb_tv",
      providerId: "603",
      mediaType: "TV_SERIES"
    }]);
    expect(tmdbProvider.probe?.({ input: "tmdb:603" })).toEqual([]);
  });

  it("resolves contextual TVDB shorthand and turns slug URLs into search hints", () => {
    expect(tvdbProvider.probe?.({ input: "tvdb:series:121361" })).toEqual([{
      provider: "tvdb",
      providerEntityType: "tvdb_series",
      providerId: "121361",
      mediaType: "TV_SERIES"
    }]);
    expect(tvdbProvider.probe?.({ input: "tvdb:movie:169" })).toEqual([{
      provider: "tvdb",
      providerEntityType: "tvdb_movie",
      providerId: "169",
      mediaType: "MOVIE"
    }]);
    expect(tvdbProvider.probe?.({ input: "tvdb:169", mediaType: "MOVIE" })).toEqual([{
      provider: "tvdb",
      providerEntityType: "tvdb_movie",
      providerId: "169",
      mediaType: "MOVIE"
    }]);
    expect(tvdbProvider.probe?.({ input: "tvdb:121361", providerEntityType: "tvdb_series" })).toEqual([{
      provider: "tvdb",
      providerEntityType: "tvdb_series",
      providerId: "121361",
      mediaType: "TV_SERIES"
    }]);
    expect(tvdbProvider.probe?.({ input: "tvdb:169" })).toEqual([]);
    expect(tvdbProvider.probe?.({ input: "https://thetvdb.com/series/game-of-thrones" })).toEqual([{
      provider: "tvdb",
      mediaType: "TV_SERIES",
      searchQuery: "game of thrones"
    }]);
    expect(tvdbProvider.probe?.({ input: "https://thetvdb.com/movies/the-matrix" })).toEqual([{
      provider: "tvdb",
      mediaType: "MOVIE",
      searchQuery: "the matrix"
    }]);
  });

  it("resolves PtGen IMDb and Douban exact IDs and URLs", () => {
    expect(ptgenProvider.probe?.({ input: "imdb:tt0133093", mediaType: "MOVIE" })).toEqual([{
      provider: "ptgen",
      providerEntityType: "ptgen_imdb",
      providerId: "tt0133093",
      mediaType: "MOVIE"
    }]);
    expect(ptgenProvider.probe?.({ input: "tt0944947" })).toEqual([{
      provider: "ptgen",
      providerEntityType: "ptgen_imdb",
      providerId: "tt0944947",
      mediaType: undefined
    }]);
    expect(ptgenProvider.probe?.({ input: "ptgen:douban:1291843", mediaType: "MOVIE" })).toEqual([{
      provider: "ptgen",
      providerEntityType: "ptgen_douban",
      providerId: "1291843",
      mediaType: "MOVIE"
    }]);
    expect(ptgenProvider.probe?.({ input: "https://www.imdb.com/title/TT0133093/" })).toEqual([{
      provider: "ptgen",
      providerEntityType: "ptgen_imdb",
      providerId: "tt0133093",
      mediaType: undefined
    }]);
    expect(ptgenProvider.probe?.({ input: "https://movie.douban.com/subject/1291843/" })).toEqual([{
      provider: "ptgen",
      providerEntityType: "ptgen_douban",
      providerId: "1291843",
      mediaType: undefined
    }]);
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
      provider: "tvdb",
      providerEntityType: "tvdb_movie",
      providerId: "169",
      mediaType: "MOVIE"
    });
  });

  it("accepts PtGen entity types and validates IDs by source site", () => {
    expect(manualProviderMatchSchema.parse({
      provider: "ptgen",
      providerEntityType: "ptgen_imdb",
      providerId: "tt0133093",
      mediaType: "MOVIE"
    })).toEqual({
      provider: "ptgen",
      providerEntityType: "ptgen_imdb",
      providerId: "tt0133093",
      mediaType: "MOVIE"
    });
    expect(manualProviderMatchSchema.parse({
      provider: "ptgen",
      providerEntityType: "ptgen_imdb",
      providerId: "TT0133093",
      mediaType: "MOVIE"
    })).toEqual({
      provider: "ptgen",
      providerEntityType: "ptgen_imdb",
      providerId: "tt0133093",
      mediaType: "MOVIE"
    });
    expect(manualProviderMatchSchema.parse({
      provider: "ptgen",
      providerEntityType: "ptgen_douban",
      providerId: "3016187",
      mediaType: "TV_SERIES"
    })).toEqual({
      provider: "ptgen",
      providerEntityType: "ptgen_douban",
      providerId: "3016187",
      mediaType: "TV_SERIES"
    });
    expect(() => manualProviderMatchSchema.parse({
      provider: "ptgen",
      providerEntityType: "ptgen_imdb",
      providerId: "1291843",
      mediaType: "MOVIE"
    })).toThrow("provider ID must be an IMDb tt ID");
  });
});

describe("PtGen title mapper", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps Douban records into provider title results", () => {
    const result = ptgenRecordToTitleResult(
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
        introduction: "A localized overview.",
        douban_rating_average: "9.1",
        douban_votes: "944092",
        episodes: ""
      },
      { site: "douban", sid: "1291843", language: "en-US" }
    );

    expect(result).toMatchObject({
      provider: "ptgen",
      providerEntityType: "ptgen_douban",
      providerId: "1291843",
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
      imdbId: "tt0133093",
      posterPath: "https://img1.doubanio.com/poster.jpg",
      overview: "A localized overview."
    });
  });

  it("maps IMDb series records and host URL formats", () => {
    const result = ptgenRecordToTitleResult(
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
      { site: "imdb", sid: "tt0944947" }
    );

    expect(result).toMatchObject({
      provider: "ptgen",
      providerEntityType: "ptgen_imdb",
      providerId: "tt0944947",
      mediaType: "TV_SERIES",
      title: "Game of Thrones",
      releaseYear: 2011,
      ratingValue: 9.2,
      ratingVoteCount: 2411567
    });
    expect(ptgenRecordUrl("https://ourbits.github.io/PtGen/", "imdb", "tt0133093"))
      .toBe("https://ourbits.github.io/PtGen/imdb/tt0133093.json");
    expect(ptgenRecordUrl("https://cdn.ourhelp.club/ptgen", "douban", "1291843"))
      .toBe("https://cdn.ourhelp.club/ptgen/douban/1291843.json");
    expect(ptgenRecordUrl("https://api.ourhelp.club/infogen", "imdb", "tt0133093"))
      .toBe("https://api.ourhelp.club/infogen?site=imdb&sid=tt0133093");
  });

  it("treats missing PtGen records as not found instead of upstream failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 404
    }));

    await expect(getPtgenTitleById({
      site: "imdb",
      sid: "tt0000000"
    })).rejects.toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "PtGen title not found"
    });
  });
});

describe("TMDB title mapper", () => {
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
      { title: "Game of Thrones", language: "en-US", region: "US" }
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
      matchConfidence: 0.98
    });
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
      { title: "The Matrix", language: "en-US" }
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
      matchConfidence: 0.99,
      externalUrl: "https://thetvdb.com/movies/the-matrix"
    });
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
