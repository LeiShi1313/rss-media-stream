import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    tenantSettings: { findUnique: vi.fn() },
    downloader: { findMany: vi.fn() }
  }
}));

vi.mock("../src/server/db.js", () => ({ prisma: mocks.prisma }));

const { listDownloaders } = await import(
  "../src/server/modules/downloaders/downloaders.service.js"
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.tenantSettings.findUnique.mockResolvedValue({
    defaultDownloaderId: "downloader-1"
  });
});

describe("downloader response serialization", () => {
  it("emits nullable settings, counts, and ISO timestamps", async () => {
    mocks.prisma.downloader.findMany.mockResolvedValue([{
      id: "downloader-1",
      name: "qBittorrent",
      type: "QBITTORRENT",
      baseUrl: "http://qbittorrent:8080",
      username: null,
      defaultSavePath: null,
      category: null,
      tags: [],
      enabled: true,
      createdAt: new Date("2026-08-10T12:00:00.000Z"),
      updatedAt: new Date("2026-08-10T13:00:00.000Z"),
      _count: { jobs: 3 }
    }]);

    const downloaders = await listDownloaders("tenant-1");
    expect(downloaders[0]?.createdAt).toBe("2026-08-10T12:00:00.000Z");
    expect(downloaders).toEqual([{
      id: "downloader-1",
      name: "qBittorrent",
      type: "QBITTORRENT",
      baseUrl: "http://qbittorrent:8080",
      username: null,
      defaultSavePath: null,
      category: null,
      tags: [],
      enabled: true,
      isDefault: true,
      jobCount: 3,
      createdAt: "2026-08-10T12:00:00.000Z",
      updatedAt: "2026-08-10T13:00:00.000Z"
    }]);
  });
});
