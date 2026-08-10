import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/server/config.js";

const mocks = vi.hoisted(() => {
  const prisma = {
    $transaction: vi.fn(async (callback: any) => callback(prisma)),
    rssItem: {
      findFirst: vi.fn()
    }
  };
  return {
    prisma,
    media: {
      lookupProviderMediaMetadata: vi.fn(),
      upsertProviderMediaMetadata: vi.fn(),
      createMatchedParsedReleaseMatch: vi.fn()
    }
  };
});

vi.mock("../src/server/db.js", () => ({
  prisma: mocks.prisma
}));

vi.mock("../src/server/modules/media/providerDiscovery.js", () => ({
  lookupProviderMediaMetadata: mocks.media.lookupProviderMediaMetadata
}));
vi.mock("../src/server/modules/media/providerIdentity.js", () => ({
  upsertProviderMediaMetadata: mocks.media.upsertProviderMediaMetadata
}));
vi.mock("../src/server/modules/media/releaseMatchLedger.js", () => ({
  createMatchedParsedReleaseMatch: mocks.media.createMatchedParsedReleaseMatch
}));

const { importPtRssProviderMatchesForItem } = await import(
  "../src/server/modules/imports/ptRssImport.service.js"
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
  mocks.prisma.rssItem.findFirst.mockResolvedValue({
    id: "item-1",
    parsedRelease: {
      id: "parsed-release-1",
      mediaType: "MOVIE"
    }
  });
  mocks.media.lookupProviderMediaMetadata.mockImplementation(async (_config: AppConfig, _tenantId: string, providerSource: string, detail: any) => ({
    provider: providerSource === "ptgen_imdb" ? "imdb" : "douban",
    providerSource,
    providerEntityType: detail.providerEntityType,
    providerId: providerSource === "ptgen_imdb" ? "tt9376612" : "30394797",
    mediaType: "MOVIE",
    title: "Shang-Chi and the Legend of the Ten Rings",
    normalizedTitle: "shang chi and the legend of the ten rings",
    titleKey: "shang chi and the legend of the ten rings",
    localeKey: providerSource === "ptgen_imdb" ? "en-US" : "zh-CN",
    titleAliases: [],
    releaseYear: 2021,
    payload: {}
  }));
  mocks.media.upsertProviderMediaMetadata.mockImplementation(async (_tx: any, result: any) => ({
    mediaTitle: { id: `media-title-${result.providerSource}`, mediaType: result.mediaType },
    identity: { id: `identity-${result.providerSource}` },
    metadata: { id: `metadata-${result.providerSource}` }
  }));
  mocks.media.createMatchedParsedReleaseMatch.mockImplementation(async (_tx: any, input: any) => ({
    id: `match-${input.providerMediaMetadataId}`,
    status: "MATCHED",
    ...input
  }));
});

describe("importPtRssProviderMatchesForItem", () => {
  it("imports provider IDs as normal parsed release matches without replacing other active matches", async () => {
    const results = await importPtRssProviderMatchesForItem({
      tenantId: "tenant-1",
      itemId: "item-1",
      config,
      importedProviderIds: [
        {
          providerSource: "ptgen_imdb",
          provider: "imdb",
          providerId: "imdb-tt9376612",
          originalValue: "https://www.imdb.com/title/tt9376612",
          source: "mongo_item_imdb"
        },
        {
          providerSource: "ptgen_douban",
          provider: "douban",
          providerId: "douban-30394797",
          originalValue: "https://douban.com/subject/30394797",
          source: "mongo_item_douban"
        }
      ]
    });

    expect(results).toEqual([
      expect.objectContaining({ status: "matched", providerSource: "ptgen_imdb", providerId: "imdb-tt9376612" }),
      expect.objectContaining({ status: "matched", providerSource: "ptgen_douban", providerId: "douban-30394797" })
    ]);
    expect(mocks.media.lookupProviderMediaMetadata).toHaveBeenCalledWith(
      config,
      "tenant-1",
      "ptgen_imdb",
      {
        providerEntityType: "ptgen_imdb",
        providerId: "imdb-tt9376612",
        mediaType: "MOVIE"
      }
    );
    expect(mocks.media.upsertProviderMediaMetadata).toHaveBeenCalledWith(
      mocks.prisma,
      expect.objectContaining({ providerSource: "ptgen_imdb" }),
      { linkConfidence: 1, linkSource: "IMPORT" }
    );
    expect(mocks.media.createMatchedParsedReleaseMatch).toHaveBeenCalledWith(
      mocks.prisma,
      expect.objectContaining({
        tenantId: "tenant-1",
        parsedReleaseId: "parsed-release-1",
        providerMediaMetadataId: "metadata-ptgen_imdb",
        source: "AUTO",
        confidence: 1,
        reason: "imported_provider_identity",
        replaceActive: false
      })
    );
    expect(mocks.media.createMatchedParsedReleaseMatch).toHaveBeenCalledTimes(2);
  });
});
