import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    downloadJob: { findMany: vi.fn() }
  }
}));

vi.mock("../src/server/db.js", () => ({ prisma: mocks.prisma }));

const { listDownloadJobs } = await import(
  "../src/server/modules/jobs/jobs.service.js"
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("download job response serialization", () => {
  it("emits nullable lifecycle fields and ISO timestamps", async () => {
    mocks.prisma.downloadJob.findMany.mockResolvedValue([{
      id: "job-1",
      tenantId: "tenant-1",
      itemId: "item-1",
      subscriptionId: null,
      downloaderId: "downloader-1",
      createdByUserId: "user-1",
      source: "MANUAL",
      status: "QUEUED",
      clientHash: null,
      attemptCount: 0,
      lastAttemptAt: null,
      nextRetryAt: null,
      sentAt: null,
      completedAt: null,
      error: null,
      createdAt: new Date("2026-08-10T12:00:00.000Z"),
      updatedAt: new Date("2026-08-10T13:00:00.000Z"),
      item: {
        id: "item-1",
        rawTitle: "Stand-up.Comedy.S03E01",
        feed: { id: "feed-1", name: "Audience" }
      },
      downloader: { id: "downloader-1", name: "qBittorrent", type: "QBITTORRENT" },
      subscription: null
    }]);

    expect(JSON.parse(JSON.stringify(await listDownloadJobs("tenant-1")))).toEqual([{
      id: "job-1",
      itemId: "item-1",
      subscriptionId: null,
      downloaderId: "downloader-1",
      createdByUserId: "user-1",
      source: "MANUAL",
      status: "QUEUED",
      clientHash: null,
      attemptCount: 0,
      lastAttemptAt: null,
      nextRetryAt: null,
      sentAt: null,
      completedAt: null,
      error: null,
      createdAt: "2026-08-10T12:00:00.000Z",
      updatedAt: "2026-08-10T13:00:00.000Z",
      item: {
        id: "item-1",
        rawTitle: "Stand-up.Comedy.S03E01",
        feed: { id: "feed-1", name: "Audience" }
      },
      downloader: { id: "downloader-1", name: "qBittorrent", type: "QBITTORRENT" },
      subscription: null
    }]);
  });
});
