import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/server/config.js";

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
    isConfigured: vi.fn(),
    search: vi.fn(),
    fetchTitle: vi.fn()
  };
  const tvdbProvider = {
    id: "tvdb",
    isConfigured: vi.fn(),
    search: vi.fn(),
    fetchTitle: vi.fn()
  };

  return { prisma, provider, tvdbProvider };
});

vi.mock("../src/server/db.js", () => ({
  prisma: mocks.prisma
}));

vi.mock("../src/server/integrations/providers/index.js", () => ({
  getDefaultMetadataProvider: vi.fn(() => mocks.provider),
  getMetadataProviderCandidates: vi.fn((mediaType: string) =>
    mediaType === "TV_SERIES"
      ? [mocks.tvdbProvider, mocks.provider]
      : [mocks.provider]
  ),
  getMetadataProvider: vi.fn((providerId: string) =>
    providerId === "tvdb" ? mocks.tvdbProvider : mocks.provider
  )
}));

const {
  manuallyMatchParsedReleaseWithProvider,
  matchParsedReleaseForItem
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

describe("matchParsedReleaseForItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mocks.provider.isConfigured.mockResolvedValue(false);
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

  it("creates no_result when provider search returns nothing", async () => {
    mockItemRelease({ mediaType: "MOVIE" });
    mocks.provider.isConfigured.mockResolvedValue(true);
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
    mocks.tvdbProvider.isConfigured.mockResolvedValue(false);
    mocks.provider.isConfigured.mockResolvedValue(true);
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
      expect.objectContaining({ tenantId: "tenant-1" })
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
    mocks.tvdbProvider.isConfigured.mockResolvedValue(true);
    mocks.tvdbProvider.search.mockResolvedValue([]);
    mocks.provider.isConfigured.mockResolvedValue(true);
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
    mocks.tvdbProvider.isConfigured.mockResolvedValue(true);
    mocks.tvdbProvider.search.mockRejectedValue(new Error("TVDB unavailable"));
    mocks.provider.isConfigured.mockResolvedValue(true);
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
    mocks.tvdbProvider.isConfigured.mockResolvedValue(true);
    mocks.tvdbProvider.search.mockRejectedValue(new Error("TVDB unavailable"));
    mocks.provider.isConfigured.mockResolvedValue(true);
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
    mocks.provider.isConfigured.mockResolvedValue(true);
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
    mocks.provider.isConfigured.mockResolvedValue(true);
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
    mocks.provider.isConfigured.mockResolvedValue(true);
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
    mocks.provider.isConfigured.mockResolvedValue(true);
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
              title: "Canonical Movie",
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
