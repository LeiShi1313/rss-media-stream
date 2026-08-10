import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  DownloaderDto,
  FeedDto,
  ItemDto,
  ReleaseMatchDto,
  SubscriptionDto
} from "../src/apiContracts.js";

describe("API wire contracts", () => {
  it("publishes a dedicated contracts module", async () => {
    await expect(import("../src/apiContracts.js")).resolves.toBeDefined();
  });

  it("models required nullable feed fields as serialized JSON values", () => {
    const feed = {
      id: "feed-1",
      name: "Audience",
      urlPreview: null,
      hasRequestHeaders: false,
      pollIntervalSeconds: 600,
      enabled: true,
      lastPolledAt: null,
      lastError: null,
      deletedAt: null,
      itemCount: 12
    } satisfies FeedDto;

    expect(feed.lastPolledAt).toBeNull();
    expectTypeOf(feed).toMatchTypeOf<FeedDto>();
  });

  it("keeps current release-match aliases and parsed-release nulls", () => {
    const provider = {
      provider: "tmdb",
      providerSource: "tmdb_api",
      providerEntityType: "tmdb_tv",
      providerId: "123"
    };
    const match = {
      id: "match-1",
      status: "MATCHED",
      source: "AUTO",
      confidence: 0.98,
      reason: null,
      matchedAt: "2026-08-10T12:00:00.000Z",
      providerTitle: provider,
      providerMetadata: provider,
      presentation: {
        mediaTitleId: "media-1",
        mediaType: "TV_SERIES",
        title: "Stand-up Comedy",
        releaseYear: 2026,
        displaySource: provider,
        hasCover: false
      },
      attention: { required: false, reasons: [] }
    } satisfies ReleaseMatchDto;
    const item = {
      id: "item-1",
      feed: { id: "feed-1", name: "Audience" },
      rawTitle: "Stand-up.Comedy.S03E01.2160p.WEB-DL",
      sourceUrl: null,
      sizeBytes: null,
      publishDate: null,
      firstSeenAt: "2026-08-10T12:00:00.000Z",
      dedupeKeyType: "LINK_HASH",
      parsedRelease: {
        id: "release-1",
        title: "Stand-up Comedy",
        year: null,
        kind: "TV",
        mediaType: "TV_SERIES",
        tvUnitType: "EPISODE",
        season: 3,
        episode: 1,
        episodeEnd: null,
        specialNumber: null,
        episodePart: null,
        resolution: 2160,
        quality: "WEB-DL",
        source: "WEB",
        codec: "H265",
        audio: null,
        releaseGroup: null,
        variant: null,
        confidence: 0.99,
        parseConfidence: 0.99,
        parsedAt: "2026-08-10T12:00:00.000Z"
      },
      enrichmentState: "MATCHED",
      match,
      downloadJobs: []
    } satisfies ItemDto;

    expect(item.match.providerMetadata).toEqual(item.match.providerTitle);
    expect(item.parsedRelease.episodeEnd).toBeNull();
  });

  it("uses JSON timestamps and explicit nullable downloader values", () => {
    const downloader = {
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
      jobCount: 0,
      createdAt: "2026-08-10T12:00:00.000Z",
      updatedAt: "2026-08-10T12:00:00.000Z"
    } satisfies DownloaderDto;

    expectTypeOf(downloader.createdAt).toEqualTypeOf<string>();
  });

  it("keeps subscription rule wire nullability separate from domain inputs", () => {
    const subscription = {
      id: "subscription-1",
      title: "Stand-up Comedy",
      createdByUserId: "user-1",
      autoDownload: true,
      enabled: true,
      rule: {
        id: "rule-1",
        mode: "REGEX",
        mediaType: "TV_SERIES",
        mediaTitleId: undefined,
        selectedProvider: undefined,
        linkedProviders: [],
        providerRatings: [],
        feedIds: [],
        titleRegex: "Stand-up",
        includeRegex: null,
        excludeRegex: null,
        minResolution: null,
        maxResolution: null,
        sources: [],
        codecs: [],
        audio: [],
        releaseGroupsInclude: [],
        releaseGroupsExclude: [],
        variantsInclude: [],
        variantsExclude: [],
        preferredReleaseGroups: [],
        minSizeBytes: undefined,
        maxSizeBytes: undefined,
        season: null,
        episodeStart: null,
        episodeEnd: null,
        upgradePolicy: "none",
        allowCrossSeed: false,
        separateVariants: false,
        seasonPackAllowed: true,
        createdAt: "2026-08-10T12:00:00.000Z",
        updatedAt: "2026-08-10T12:00:00.000Z"
      },
      createdAt: "2026-08-10T12:00:00.000Z",
      updatedAt: "2026-08-10T12:00:00.000Z"
    } satisfies SubscriptionDto;

    expect(subscription.rule.linkedProviders).toEqual([]);
  });
});
