import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    rssItem: {
      findFirst: vi.fn(),
      findMany: vi.fn()
    }
  },
  getPresentationProviderOrder: vi.fn()
}));

vi.mock("../src/server/db.js", () => ({ prisma: mocks.prisma }));
vi.mock("../src/server/integrations/providers/policy.js", () => ({
  getPresentationProviderOrder: mocks.getPresentationProviderOrder
}));

const { listItems } = await import("../src/server/modules/items/items.service.js");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPresentationProviderOrder.mockResolvedValue(["tmdb_api"]);
});

describe("items service pagination", () => {
  it("returns items in a page envelope with a cursor when more rows exist", async () => {
    mocks.prisma.rssItem.findMany.mockResolvedValue([
      rssItem({ id: "item-3", firstSeenAt: "2026-06-25T12:00:00.000Z" }),
      rssItem({ id: "item-2", firstSeenAt: "2026-06-25T11:00:00.000Z" }),
      rssItem({ id: "item-1", firstSeenAt: "2026-06-25T10:00:00.000Z" })
    ]);

    const page = await listItems("tenant-1", { limit: 2 });

    expect(page.items.map((item) => item.id)).toEqual(["item-3", "item-2"]);
    expect(page.nextCursor).toBe("item-2");
    expect(mocks.prisma.rssItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 3
    }));
  });

  it("filters serialized items by resolved match status before returning a page", async () => {
    mocks.prisma.rssItem.findMany.mockResolvedValue([
      rssItem({ id: "unmatched", parsedRelease: parsedRelease({ matches: [match({ status: "UNMATCHED" })] }) }),
      rssItem({ id: "matched", parsedRelease: parsedRelease({ matches: [match({ status: "MATCHED" })] }) })
    ]);

    const page = await listItems("tenant-1", { limit: 2, status: "matched" });

    expect(page.items.map((item) => item.id)).toEqual(["matched"]);
    expect(page.nextCursor).toBeUndefined();
  });

  it("matches search against serialized parsed release fields", async () => {
    mocks.prisma.rssItem.findMany.mockResolvedValue([
      rssItem({ id: "raw-only", parsedRelease: parsedRelease({ title: "Other title" }) }),
      rssItem({ id: "parsed-title", parsedRelease: parsedRelease({ title: "Needle title" }) })
    ]);

    const page = await listItems("tenant-1", { limit: 2, q: "needle" });

    expect(page.items.map((item) => item.id)).toEqual(["parsed-title"]);
  });

  it("pushes item search terms into the database query", async () => {
    mocks.prisma.rssItem.findMany.mockResolvedValue([]);

    await listItems("tenant-1", { limit: 2, q: "花样年华" });

    const where = mocks.prisma.rssItem.findMany.mock.calls[0]?.[0]?.where;
    expect(JSON.stringify(where)).toContain("花样年华");
    expect(JSON.stringify(where)).toContain("parsedRelease");
    expect(JSON.stringify(where)).toContain("titleAliases");
  });

  it("matches search against matched media original titles", async () => {
    mocks.prisma.rssItem.findMany.mockResolvedValue([
      rssItem({ id: "english-title", parsedRelease: parsedRelease({ matches: [match({ status: "MATCHED" })] }) })
    ]);

    const page = await listItems("tenant-1", { limit: 2, q: "花蕾" });

    expect(page.items.map((item) => item.id)).toEqual(["english-title"]);
  });

  it("matches search against aliases from non-presentation provider metadata", async () => {
    mocks.prisma.rssItem.findMany.mockResolvedValue([
      rssItem({
        id: "provider-alias",
        parsedRelease: parsedRelease({
          matches: [
            match({
              status: "MATCHED",
              linkedMetadata: [
                {
                  id: "metadata-alt",
                  providerSource: "douban_api",
                  title: "Buds",
                  originalTitle: "蓓蕾",
                  titleAliases: ["花样年华"]
                }
              ]
            })
          ]
        })
      })
    ]);

    const page = await listItems("tenant-1", { limit: 2, q: "花样年华" });

    expect(page.items.map((item) => item.id)).toEqual(["provider-alias"]);
  });
});

function rssItem(input: {
  id: string;
  firstSeenAt?: string;
  parsedRelease?: ReturnType<typeof parsedRelease> | null;
  downloadJobs?: Array<{ id: string; status: string; createdAt: Date }>;
}) {
  return {
    id: input.id,
    tenantId: "tenant-1",
    feed: { id: "feed-1", name: "Feed" },
    rawTitle: `Release ${input.id}`,
    encryptedSourceUrl: null,
    sizeBytes: null,
    firstSeenAt: new Date(input.firstSeenAt ?? "2026-06-25T12:00:00.000Z"),
    dedupeKeyType: "LINK_HASH",
    parsedRelease: input.parsedRelease ?? null,
    downloadJobs: input.downloadJobs ?? []
  };
}

function parsedRelease(input: {
  matches?: Array<ReturnType<typeof match>>;
  title?: string;
} = {}) {
  return {
    id: "release-1",
    title: input.title ?? "Example",
    year: 2026,
    mediaType: "MOVIE",
    season: null,
    episode: null,
    episodeEnd: null,
    resolution: 1080,
    quality: "WEB-DL",
    source: "WEB",
    codec: "H264",
    audio: "AAC",
    releaseGroup: "GROUP",
    parseConfidence: 1,
    parsedAt: new Date("2026-06-25T12:00:00.000Z"),
    matches: input.matches ?? []
  };
}

function match(input: {
  status: "MATCHED" | "UNMATCHED";
  linkedMetadata?: Array<{
    id: string;
    providerSource: string;
    title: string;
    originalTitle?: string;
    titleAliases?: string[];
  }>;
}) {
  return {
    id: `${input.status.toLowerCase()}-match`,
    status: input.status,
    source: "AUTO",
    confidence: input.status === "MATCHED" ? 0.98 : null,
    reason: input.status === "UNMATCHED" ? "no_result" : null,
    matchedAt: new Date("2026-06-25T12:00:00.000Z"),
    updatedAt: new Date("2026-06-25T12:00:00.000Z"),
    createdAt: new Date("2026-06-25T12:00:00.000Z"),
    mediaTitle: input.status === "MATCHED"
      ? {
          id: "media-1",
          mediaType: "MOVIE",
          title: "Example",
          originalTitle: null,
          releaseYear: 2026,
          providerIdentities: [
            {
              metadata: input.linkedMetadata ?? []
            }
          ]
        }
      : null,
    mediaProviderIdentity: null,
    providerTitle: null,
    providerMediaMetadata: input.status === "MATCHED"
      ? {
          id: "metadata-1",
          provider: "tmdb",
          providerSource: "tmdb_api",
          providerId: "1",
          mediaType: "MOVIE",
          title: "Example",
          originalTitle: "花蕾",
          payload: { posterPath: "/poster.jpg" }
        }
      : null
  };
}
