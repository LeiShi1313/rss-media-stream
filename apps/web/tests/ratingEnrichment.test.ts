import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/server/config.js";

const mocks = vi.hoisted(() => {
  const prisma = {
    $transaction: vi.fn(async (callback: any) => callback(prisma))
  };
  return {
    prisma,
    runtime: {
      tenantId: "tenant-1",
      providerSource: "ptgen_douban",
      provider: "douban",
      adapterId: "ptgen",
      enabled: true,
      metadataLanguage: "zh-CN"
    },
    resolveProviderRuntime: vi.fn(),
    providerRuntimeAvailable: vi.fn(),
    searchProviderWithRuntime: vi.fn(),
    upsertProviderMediaMetadata: vi.fn()
  };
});

vi.mock("../src/server/db.js", () => ({ prisma: mocks.prisma }));
vi.mock("../src/server/integrations/providers/runtime.js", () => ({
  resolveProviderRuntime: mocks.resolveProviderRuntime,
  providerRuntimeAvailable: mocks.providerRuntimeAvailable
}));
vi.mock("../src/server/modules/media/providerDiscovery.js", () => ({
  searchProviderWithRuntime: mocks.searchProviderWithRuntime
}));
vi.mock("../src/server/modules/media/providerIdentity.js", () => ({
  upsertProviderMediaMetadata: mocks.upsertProviderMediaMetadata
}));

const { enrichMediaTitleRating } = await import(
  "../src/server/modules/media/ratingEnrichment.js"
);

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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveProviderRuntime.mockResolvedValue(mocks.runtime);
  mocks.providerRuntimeAvailable.mockReturnValue(true);
  mocks.searchProviderWithRuntime.mockResolvedValue([ratingCandidate()]);
  mocks.upsertProviderMediaMetadata.mockResolvedValue({});
});

describe("enrichMediaTitleRating", () => {
  it("persists a strict rating candidate against the requested canonical title", async () => {
    await expect(enrichMediaTitleRating(ratingInput())).resolves.toBe(true);

    expect(mocks.resolveProviderRuntime).toHaveBeenCalledWith(
      config,
      "tenant-1",
      "ptgen_douban"
    );
    expect(mocks.searchProviderWithRuntime).toHaveBeenCalledWith(
      "ptgen_douban",
      mocks.runtime,
      {
        title: "The Matrix",
        titleSource: "parsed_title",
        mediaType: "MOVIE",
        year: 1999,
        season: undefined,
        episode: undefined
      }
    );
    expect(mocks.upsertProviderMediaMetadata).toHaveBeenCalledWith(
      mocks.prisma,
      ratingCandidate(),
      {
        linkConfidence: 1,
        linkSource: "SEARCH_MATCH",
        mediaTitleId: "media-1"
      }
    );
  });

  it("skips lookup and persistence when the selected rating runtime is unavailable", async () => {
    mocks.providerRuntimeAvailable.mockReturnValue(false);

    await expect(enrichMediaTitleRating(ratingInput())).resolves.toBe(false);

    expect(mocks.searchProviderWithRuntime).not.toHaveBeenCalled();
    expect(mocks.upsertProviderMediaMetadata).not.toHaveBeenCalled();
  });

  it("swallows rating persistence failures", async () => {
    mocks.upsertProviderMediaMetadata.mockRejectedValue(new Error("database unavailable"));

    await expect(enrichMediaTitleRating(ratingInput())).resolves.toBe(false);
  });
});

function ratingInput() {
  return {
    config,
    tenantId: "tenant-1",
    mediaTitleId: "media-1",
    mediaType: "MOVIE" as const,
    title: "The Matrix",
    year: 1999,
    ratingProviderSource: "ptgen_douban" as const,
    selectedProviderSource: "tmdb_api" as const,
    selectedConfidence: 0.95
  };
}

function ratingCandidate() {
  return {
    provider: "douban" as const,
    providerSource: "ptgen_douban" as const,
    providerEntityType: "ptgen_douban",
    providerId: "1295644",
    mediaType: "MOVIE" as const,
    title: "The Matrix",
    normalizedTitle: "the matrix",
    titleKey: "the matrix",
    originalTitle: "The Matrix",
    titleAliases: [],
    releaseYear: 1999,
    localeKey: "zh-CN",
    payload: {},
    ratingValue: 9.1,
    ratingScale: 10,
    ratingType: "user_score" as const
  };
}
