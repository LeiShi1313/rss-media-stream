import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/server/config.js";
import {
  getDefaultProviderId,
  getMetadataProviderCandidates
} from "../src/server/integrations/providers/index.js";
import { tmdbProvider } from "../src/server/integrations/tmdb/provider.js";
import { toTitleResult } from "../src/server/integrations/tmdb/mapper.js";
import { tvdbProvider } from "../src/server/integrations/tvdb/provider.js";
import { tvdbSearchResultToTitleResult } from "../src/server/integrations/tvdb/mapper.js";

vi.mock("../src/server/db.js", () => ({
  prisma: {
    tenantSettings: {
      findUnique: vi.fn().mockResolvedValue(null)
    }
  }
}));

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
  it("uses hard-coded media type defaults", () => {
    expect(getDefaultProviderId("MOVIE")).toBe("tmdb");
    expect(getDefaultProviderId("TV_SERIES")).toBe("tvdb");
    expect(getMetadataProviderCandidates("MOVIE").map((provider) => provider.id)).toEqual(["tmdb"]);
    expect(getMetadataProviderCandidates("TV_SERIES").map((provider) => provider.id)).toEqual(["tvdb", "tmdb"]);
    expect(tmdbProvider.defaultFor).toContain("MOVIE");
    expect(tvdbProvider.defaultFor).toContain("TV_SERIES");
  });

  it("exposes missing API key state through isConfigured", async () => {
    await expect(tmdbProvider.isConfigured({ config: baseConfig, tenantId: "tenant-1" })).resolves.toBe(false);
    await expect(tvdbProvider.isConfigured({ config: baseConfig, tenantId: "tenant-1" })).resolves.toBe(false);
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
});
