import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    rssItem: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    parsedRelease: {
      findUnique: vi.fn()
    }
  },
  invalidateMatchesForParsedRelease: vi.fn()
}));

vi.mock("../src/server/db.js", () => ({ prisma: mocks.prisma }));
vi.mock("../src/server/modules/media/media.service.js", () => ({
  invalidateMatchesForParsedRelease: mocks.invalidateMatchesForParsedRelease
}));

const {
  normalizeFeedItem,
  upsertNormalizedRssItem
} = await import("../src/server/modules/feeds/itemIngestion.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("normalizeFeedItem", () => {
  it("keeps torrent and source URLs separate", () => {
    const item = normalizeFeedItem({
      title: "Example Movie 2024 1080p WEB-DL H.264-GROUP",
      guid: "feed-guid-1",
      link: "https://tracker.example/details.php?id=10",
      links: [
        {
          rel: "alternate",
          type: "text/html",
          href: "https://tracker.example/details.php?id=10"
        },
        {
          rel: "enclosure",
          type: "application/x-bittorrent",
          href: "https://tracker.example/download.php?id=10&passkey=secret"
        }
      ],
      isoDate: "2026-06-24T10:00:00Z",
      torrentContentLength: "123456"
    });

    expect(item).toEqual({
      rawTitle: "Example Movie 2024 1080p WEB-DL H.264-GROUP",
      torrentUrl: "https://tracker.example/download.php?id=10&passkey=secret",
      sourceUrl: "https://tracker.example/details.php?id=10",
      guid: "feed-guid-1",
      infoHash: undefined,
      publishDate: new Date("2026-06-24T10:00:00Z"),
      sizeBytes: 123456n
    });
  });
});

describe("upsertNormalizedRssItem", () => {
  it("creates a parsed RSS item when no existing identifier matches", async () => {
    mocks.prisma.rssItem.findUnique.mockResolvedValue(null);
    mocks.prisma.rssItem.findFirst.mockResolvedValue(null);
    mocks.prisma.rssItem.create.mockResolvedValue({ id: "item-1" });

    await expect(upsertNormalizedRssItem({
      tenantId: "tenant-1",
      feedId: "feed-1",
      item: {
        rawTitle: "Example Movie 2024 1080p WEB-DL H.264-GROUP",
        torrentUrl: "https://tracker.example/download.php?id=10",
        sourceUrl: "https://tracker.example/details.php?id=10",
        guid: "guid-1",
        publishDate: new Date("2026-06-24T10:00:00Z"),
        sizeBytes: 123456n
      },
      rawPayload: { title: "Example Movie 2024 1080p WEB-DL H.264-GROUP" }
    })).resolves.toEqual({
      itemId: "item-1",
      created: true,
      updated: false,
      releaseChanged: true
    });

    expect(mocks.prisma.rssItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        feedId: "feed-1",
        rawTitle: "Example Movie 2024 1080p WEB-DL H.264-GROUP",
        dedupeKeyType: "RELEASE_SIGNATURE",
        parseStatus: "PARSED",
        parsedRelease: {
          create: expect.objectContaining({
            title: "Example Movie",
            year: 2024,
            mediaType: "MOVIE"
          })
        }
      }),
      select: { id: true }
    });
  });

  it("invalidates previous matches when an existing parsed release changes", async () => {
    mocks.prisma.rssItem.findUnique.mockResolvedValue({ id: "item-1" });
    mocks.prisma.parsedRelease.findUnique.mockResolvedValue({
      id: "release-1",
      title: "Old Title",
      providerSearchTitles: [],
      year: 2023,
      mediaType: "MOVIE",
      season: null,
      episode: null,
      episodeEnd: null,
      resolution: 1080,
      quality: "1080p",
      source: "WEB-DL",
      codec: "H.264",
      audio: null,
      releaseGroup: "GROUP",
      parseConfidence: 0.9
    });
    mocks.prisma.rssItem.update.mockResolvedValue({ id: "item-1" });

    await expect(upsertNormalizedRssItem({
      tenantId: "tenant-1",
      feedId: "feed-1",
      item: {
        rawTitle: "Example Movie 2024 1080p WEB-DL H.264-GROUP",
        torrentUrl: "https://tracker.example/download.php?id=10",
        sourceUrl: "https://tracker.example/details.php?id=10"
      },
      rawPayload: { title: "Example Movie 2024 1080p WEB-DL H.264-GROUP" }
    })).resolves.toEqual({
      itemId: "item-1",
      created: false,
      updated: true,
      releaseChanged: true
    });

    expect(mocks.invalidateMatchesForParsedRelease).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      parsedReleaseId: "release-1",
      staleReason: "parsed_release_changed"
    });
  });
});
