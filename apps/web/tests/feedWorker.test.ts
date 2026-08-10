import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    rssFeed: {
      findMany: vi.fn()
    }
  },
  refreshFeed: vi.fn()
}));

vi.mock("../src/server/db.js", () => ({ prisma: mocks.prisma }));
vi.mock("../src/server/modules/feeds/feeds.service.js", () => ({
  refreshFeed: mocks.refreshFeed
}));

const { pollDueFeeds } = await import("../src/worker/feedWorker.js");

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("feed worker scheduling", () => {
  it("selects only feeds whose next attempt is due", async () => {
    const now = new Date("2026-08-10T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    mocks.prisma.rssFeed.findMany.mockResolvedValue([]);

    await pollDueFeeds({} as never);

    expect(mocks.prisma.rssFeed.findMany).toHaveBeenCalledWith({
      where: {
        enabled: true,
        deletedAt: null,
        encryptedUrl: { not: null },
        OR: [
          { nextAttemptAt: null },
          { nextAttemptAt: { lte: now } }
        ]
      },
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
      take: 20,
      select: {
        id: true,
        tenantId: true
      }
    });
  });

  it("refreshes feeds returned as due", async () => {
    mocks.prisma.rssFeed.findMany.mockResolvedValue([
      { id: "feed-1", tenantId: "tenant-1" }
    ]);
    mocks.refreshFeed.mockResolvedValue({});

    await pollDueFeeds({} as never);

    expect(mocks.refreshFeed).toHaveBeenCalledWith(
      "feed-1",
      { tenantId: "tenant-1", actor: "worker" },
      { config: {} }
    );
  });
});
