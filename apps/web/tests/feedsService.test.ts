import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    rssFeed: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    }
  },
  publishTenantEvent: vi.fn(),
  listItems: vi.fn(),
  invalidateMatchesForParsedRelease: vi.fn(),
  matchParsedReleaseForItem: vi.fn(),
  evaluateAutoDownloadsForItem: vi.fn(),
  parseURL: vi.fn()
}));

vi.mock("rss-parser", () => ({
  default: class MockParser {
    parseURL = mocks.parseURL;
  }
}));
vi.mock("../src/server/db.js", () => ({ prisma: mocks.prisma }));
vi.mock("../src/server/core/events.js", () => ({
  publishTenantEvent: mocks.publishTenantEvent
}));
vi.mock("../src/server/modules/items/items.service.js", () => ({
  listItems: mocks.listItems
}));
vi.mock("../src/server/modules/media/media.service.js", () => ({
  invalidateMatchesForParsedRelease: mocks.invalidateMatchesForParsedRelease,
  matchParsedReleaseForItem: mocks.matchParsedReleaseForItem
}));
vi.mock("../src/server/modules/subscriptions/subscriptions.service.js", () => ({
  evaluateAutoDownloadsForItem: mocks.evaluateAutoDownloadsForItem
}));

const {
  createFeed,
  deleteFeed,
  listFeeds,
  refreshFeed
} = await import("../src/server/modules/feeds/feeds.service.js");
const { encryptAead } = await import("../src/server/secrets.js");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.parseURL.mockResolvedValue({ items: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("feed service deletion", () => {
  it("retires the feed URL without deleting the feed row or its items", async () => {
    mocks.prisma.rssFeed.findFirst.mockResolvedValue({ id: "feed-1" });
    mocks.prisma.rssFeed.update.mockResolvedValue({ id: "feed-1" });

    await expect(deleteFeed("tenant-1", "feed-1")).resolves.toEqual({ id: "feed-1" });

    expect(mocks.prisma.rssFeed.delete).not.toHaveBeenCalled();
    expect(mocks.prisma.rssFeed.update).toHaveBeenCalledWith({
      where: { id_tenantId: { id: "feed-1", tenantId: "tenant-1" } },
      data: {
        encryptedUrl: null,
        urlHash: null,
        encryptedRequestHeadersJson: null,
        enabled: false,
        deletedAt: expect.any(Date),
        lastError: null
      }
    });
  });

  it("stores optional request headers encrypted when creating a feed", async () => {
    mocks.prisma.rssFeed.create.mockResolvedValue({ id: "feed-1" });

    await expect(createFeed({
      name: "Private tracker",
      url: "https://example.invalid/rss",
      requestHeaders: {
        cookie: "session=value",
        "user-agent": "Test Agent"
      },
      pollIntervalSeconds: 600,
      enabled: true
    }, {
      tenantId: "tenant-1",
      userId: "user-1"
    })).resolves.toEqual({ id: "feed-1" });

    expect(mocks.prisma.rssFeed.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        encryptedUrl: expect.any(String),
        urlHash: expect.any(String),
        encryptedRequestHeadersJson: expect.any(String)
      }),
      select: { id: true }
    });
  });

  it("excludes retired feeds from feed management", async () => {
    mocks.prisma.rssFeed.findMany.mockResolvedValue([]);

    await expect(listFeeds("tenant-1")).resolves.toEqual([]);

    expect(mocks.prisma.rssFeed.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: "tenant-1", deletedAt: null }
    }));
  });

  it("does not refresh retired feeds or feeds without a URL", async () => {
    mocks.prisma.rssFeed.findFirst.mockResolvedValue(null);

    await expect(refreshFeed("feed-1", {
      tenantId: "tenant-1",
      actor: "worker"
    })).resolves.toMatchObject({
      created: 0,
      updated: 0,
      changed: 0,
      unchanged: 0,
      skipped: 0
    });

    expect(mocks.prisma.rssFeed.findFirst).toHaveBeenCalledWith({
      where: {
        id: "feed-1",
        tenantId: "tenant-1",
        enabled: true,
        deletedAt: null,
        encryptedUrl: { not: null }
      }
    });
  });
});

describe("feed refresh scheduling", () => {
  it("advances the next attempt after a successful refresh", async () => {
    const now = new Date("2026-08-10T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    mocks.prisma.rssFeed.findFirst.mockResolvedValue({
      id: "feed-1",
      tenantId: "tenant-1",
      encryptedUrl: encryptAead("https://example.invalid/rss"),
      encryptedRequestHeadersJson: null,
      pollIntervalSeconds: 300
    });
    mocks.prisma.rssFeed.update.mockResolvedValue({ id: "feed-1" });

    await refreshFeed("feed-1", {
      tenantId: "tenant-1",
      actor: "worker"
    });

    expect(mocks.prisma.rssFeed.update).toHaveBeenCalledWith({
      where: { id_tenantId: { id: "feed-1", tenantId: "tenant-1" } },
      data: {
        lastPolledAt: now,
        nextAttemptAt: new Date("2026-08-10T12:05:00.000Z"),
        lastError: null
      }
    });
  });

  it("advances the next attempt without changing last success after a failure", async () => {
    const now = new Date("2026-08-10T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    mocks.prisma.rssFeed.findFirst.mockResolvedValue({
      id: "feed-1",
      tenantId: "tenant-1",
      encryptedUrl: encryptAead("https://example.invalid/rss"),
      encryptedRequestHeadersJson: null,
      pollIntervalSeconds: 300
    });
    mocks.parseURL.mockRejectedValueOnce(new Error("upstream failed"));
    mocks.prisma.rssFeed.update.mockResolvedValue({ id: "feed-1" });

    await expect(refreshFeed("feed-1", {
      tenantId: "tenant-1",
      actor: "worker"
    })).rejects.toThrow("RSS refresh failed: upstream failed");

    expect(mocks.prisma.rssFeed.update).toHaveBeenCalledWith({
      where: { id_tenantId: { id: "feed-1", tenantId: "tenant-1" } },
      data: {
        nextAttemptAt: new Date("2026-08-10T12:05:00.000Z"),
        lastError: "upstream failed"
      }
    });
  });
});
