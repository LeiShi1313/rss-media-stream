import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/server/config.js";

const mocks = vi.hoisted(() => ({
  prisma: {
    rssItem: {
      findFirst: vi.fn()
    },
    subscription: {
      findMany: vi.fn()
    },
    subscriptionAcquisition: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn()
    },
    subscriptionMatchDecision: {
      create: vi.fn()
    }
  },
  createDownloadJob: vi.fn(),
  sendDownloadJob: vi.fn(),
  getPresentationProviderOrder: vi.fn()
}));

vi.mock("../src/server/db.js", () => ({ prisma: mocks.prisma }));
vi.mock("../src/server/modules/jobs/jobs.service.js", () => ({
  createDownloadJob: mocks.createDownloadJob,
  sendDownloadJob: mocks.sendDownloadJob
}));
vi.mock("../src/server/integrations/providers/policy.js", () => ({
  getPresentationProviderOrder: mocks.getPresentationProviderOrder
}));

const { evaluateAutoDownloadsForItem } = await import(
  "../src/server/modules/subscriptions/subscriptions.service.js"
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
  mocks.prisma.subscriptionAcquisition.findUnique.mockResolvedValue(null);
  mocks.prisma.subscriptionAcquisition.upsert.mockResolvedValue({});
  mocks.prisma.subscriptionAcquisition.update.mockResolvedValue({});
  mocks.prisma.subscriptionMatchDecision.create.mockResolvedValue({});
  mocks.createDownloadJob.mockResolvedValue({ id: "job-1" });
  mocks.sendDownloadJob.mockResolvedValue({});
});

describe("evaluateAutoDownloadsForItem", () => {
  it("lets regex subscriptions download raw releases without an active media match", async () => {
    mocks.prisma.rssItem.findFirst.mockResolvedValue(rssItem({
      rawTitle: "TV Stand-up Comedy S03 2160p WEB-DL H.265-GROUP",
      parsedRelease: parsedRelease({ matches: [] })
    }));
    mocks.prisma.subscription.findMany.mockResolvedValue([
      subscription({
        id: "subscription-regex",
        mediaTitleId: null,
        rule: rule({
          mode: "REGEX",
          mediaType: "TV_SERIES",
          season: 3,
          minResolution: 2160,
          sources: ["WEB-DL"]
        })
      })
    ]);

    await expect(evaluateAutoDownloadsForItem({
      tenantId: "tenant-1",
      itemId: "item-1",
      config
    })).resolves.toEqual(["job-1"]);

    expect(mocks.createDownloadJob).toHaveBeenCalledWith(expect.objectContaining({
      itemId: "item-1",
      subscriptionId: "subscription-regex",
      source: "SUBSCRIPTION"
    }));
    expect(mocks.prisma.subscriptionAcquisition.findUnique).not.toHaveBeenCalled();
  });

  it("skips media-title downloads when another subscription already satisfied the same episode", async () => {
    mocks.prisma.rssItem.findFirst.mockResolvedValue(rssItem({
      parsedRelease: parsedRelease({ matches: [matchedMedia()] })
    }));
    mocks.prisma.subscription.findMany.mockResolvedValue([
      subscription({
        id: "subscription-tv",
        mediaTitleId: "media-title-1",
        rule: rule({
          mode: "MEDIA_TITLE",
          mediaTitleId: "media-title-1",
          mediaType: "TV_SERIES",
          season: 3,
          minResolution: 2160
        })
      })
    ]);
    mocks.prisma.subscriptionAcquisition.findUnique.mockResolvedValue({
      id: "acquisition-1",
      tenantId: "tenant-1",
      contentKey: "tv:media-title-1:s03:e01",
      crossSeedFeedsJson: { "feed-a": { jobId: "job-existing" } },
      currentResolution: 2160,
      currentSourceRank: 30,
      currentReleaseGroup: "GROUP"
    });

    await expect(evaluateAutoDownloadsForItem({
      tenantId: "tenant-1",
      itemId: "item-1",
      config
    })).resolves.toEqual([]);

    expect(mocks.prisma.subscriptionAcquisition.findUnique).toHaveBeenCalledWith({
      where: {
        tenantId_contentKey: {
          tenantId: "tenant-1",
          contentKey: "tv:media-title-1:s03:e01"
        }
      }
    });
    expect(mocks.createDownloadJob).not.toHaveBeenCalled();
    expect(mocks.prisma.subscriptionMatchDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accepted: false,
        reason: "media unit is already satisfied"
      })
    });
  });

  it("records feed history and uses a forced duplicate job for allowed cross-seed", async () => {
    mocks.prisma.rssItem.findFirst.mockResolvedValue(rssItem({
      feedId: "feed-b",
      parsedRelease: parsedRelease({ matches: [matchedMedia()] })
    }));
    mocks.prisma.subscription.findMany.mockResolvedValue([
      subscription({
        id: "subscription-cross-seed",
        mediaTitleId: "media-title-1",
        rule: rule({
          mode: "MEDIA_TITLE",
          mediaTitleId: "media-title-1",
          mediaType: "TV_SERIES",
          season: 3,
          minResolution: 2160,
          allowCrossSeed: true
        })
      })
    ]);
    mocks.prisma.subscriptionAcquisition.findUnique.mockResolvedValue({
      id: "acquisition-1",
      tenantId: "tenant-1",
      contentKey: "tv:media-title-1:s03:e01",
      crossSeedFeedsJson: { "feed-a": { jobId: "job-existing" } },
      currentResolution: 2160,
      currentSourceRank: 30,
      currentReleaseGroup: "GROUP"
    });

    await expect(evaluateAutoDownloadsForItem({
      tenantId: "tenant-1",
      itemId: "item-1",
      config
    })).resolves.toEqual(["job-1"]);

    expect(mocks.createDownloadJob).toHaveBeenCalledWith(expect.objectContaining({
      forceDuplicate: true,
      subscriptionId: "subscription-cross-seed"
    }));
    expect(mocks.prisma.subscriptionAcquisition.update).toHaveBeenCalledWith({
      where: {
        tenantId_contentKey: {
          tenantId: "tenant-1",
          contentKey: "tv:media-title-1:s03:e01"
        }
      },
      data: expect.objectContaining({
        crossSeedFeedsJson: expect.objectContaining({
          "feed-a": { jobId: "job-existing" },
          "feed-b": expect.objectContaining({
            jobId: "job-1",
            itemId: "item-1"
          })
        })
      })
    });
  });

  it("deduplicates parsed episode parts independently from the base episode", async () => {
    mocks.prisma.rssItem.findFirst.mockResolvedValue(rssItem({
      parsedRelease: parsedRelease({ matches: [matchedMedia()], episodePart: "A" })
    }));
    mocks.prisma.subscription.findMany.mockResolvedValue([
      subscription({
        id: "subscription-tv",
        mediaTitleId: "media-title-1",
        rule: rule({
          mode: "MEDIA_TITLE",
          mediaTitleId: "media-title-1",
          mediaType: "TV_SERIES",
          season: 3,
          minResolution: 2160
        })
      })
    ]);

    await expect(evaluateAutoDownloadsForItem({
      tenantId: "tenant-1",
      itemId: "item-1",
      config
    })).resolves.toEqual(["job-1"]);

    expect(mocks.prisma.subscriptionAcquisition.findUnique).toHaveBeenCalledWith({
      where: {
        tenantId_contentKey: {
          tenantId: "tenant-1",
          contentKey: "tv:media-title-1:s03:e01:part:A"
        }
      }
    });
    expect(mocks.prisma.subscriptionAcquisition.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        contentKey: "tv:media-title-1:s03:e01:part:A",
        unitType: "TV_EPISODE",
        episodePart: "A"
      })
    }));
  });

  it("uses separate variant acquisition keys only when the rule opts in", async () => {
    mocks.prisma.rssItem.findFirst.mockResolvedValue(rssItem({
      parsedRelease: parsedRelease({
        matches: [matchedMedia()],
        variant: "PLUS",
        episodePart: "B"
      })
    }));
    mocks.prisma.subscription.findMany.mockResolvedValue([
      subscription({
        id: "subscription-tv",
        mediaTitleId: "media-title-1",
        rule: rule({
          mode: "MEDIA_TITLE",
          mediaTitleId: "media-title-1",
          mediaType: "TV_SERIES",
          season: 3,
          minResolution: 2160,
          criteriaJson: { separateVariants: true }
        })
      })
    ]);

    await expect(evaluateAutoDownloadsForItem({
      tenantId: "tenant-1",
      itemId: "item-1",
      config
    })).resolves.toEqual(["job-1"]);

    expect(mocks.prisma.subscriptionAcquisition.findUnique).toHaveBeenCalledWith({
      where: {
        tenantId_contentKey: {
          tenantId: "tenant-1",
          contentKey: "tv:media-title-1:s03:e01:variant:PLUS:part:B"
        }
      }
    });
    expect(mocks.prisma.subscriptionAcquisition.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        contentKey: "tv:media-title-1:s03:e01:variant:PLUS:part:B",
        variant: "PLUS",
        episodePart: "B"
      })
    }));
  });

  it("deduplicates parsed TV specials separately from season packs", async () => {
    mocks.prisma.rssItem.findFirst.mockResolvedValue(rssItem({
      rawTitle: "Stand-up Comedy And Friends S01SP6 2024 2160p WEB-DL H265 AAC-TJUPT",
      parsedRelease: parsedRelease({
        matches: [matchedMedia()],
        season: 1,
        episode: null,
        tvUnitType: "SPECIAL",
        specialNumber: 6
      })
    }));
    mocks.prisma.subscription.findMany.mockResolvedValue([
      subscription({
        id: "subscription-tv",
        mediaTitleId: "media-title-1",
        rule: rule({
          mode: "MEDIA_TITLE",
          mediaTitleId: "media-title-1",
          mediaType: "TV_SERIES",
          season: 1,
          minResolution: 2160
        })
      })
    ]);

    await expect(evaluateAutoDownloadsForItem({
      tenantId: "tenant-1",
      itemId: "item-1",
      config
    })).resolves.toEqual(["job-1"]);

    expect(mocks.prisma.subscriptionAcquisition.findUnique).toHaveBeenCalledWith({
      where: {
        tenantId_contentKey: {
          tenantId: "tenant-1",
          contentKey: "tv:media-title-1:s01:sp:6"
        }
      }
    });
    expect(mocks.prisma.subscriptionAcquisition.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        contentKey: "tv:media-title-1:s01:sp:6",
        unitType: "TV_SPECIAL",
        specialNumber: 6
      })
    }));
  });
});

function rssItem(input: {
  feedId?: string;
  rawTitle?: string;
  parsedRelease: ReturnType<typeof parsedRelease>;
}) {
  return {
    id: "item-1",
    tenantId: "tenant-1",
    feedId: input.feedId ?? "feed-a",
    rawTitle: input.rawTitle ?? "TV Stand-up Comedy S03E01 2160p WEB-DL H.265-GROUP",
    sizeBytes: 12_000_000_000n,
    parsedRelease: input.parsedRelease
  };
}

function parsedRelease(input: {
  matches: any[];
  mediaType?: string;
  season?: number;
  episode?: number | null;
  episodeEnd?: number;
  tvUnitType?: "EPISODE" | "SPECIAL";
  specialNumber?: number;
  episodePart?: string;
  variant?: string;
  resolution?: number;
  source?: string;
  releaseGroup?: string;
}) {
  return {
    title: "TV Stand-up Comedy",
    year: undefined,
    mediaType: input.mediaType ?? "TV_SERIES",
    tvUnitType: input.tvUnitType,
    season: input.season ?? 3,
    episode: input.episode === null ? undefined : input.episode ?? 1,
    episodeEnd: input.episodeEnd,
    specialNumber: input.specialNumber,
    episodePart: input.episodePart,
    resolution: input.resolution ?? 2160,
    quality: undefined,
    source: input.source ?? "WEB-DL",
    codec: "H.265",
    audio: undefined,
    releaseGroup: input.releaseGroup ?? "GROUP",
    variant: input.variant,
    parseConfidence: 0.95,
    matches: input.matches
  };
}

function subscription(input: {
  id: string;
  mediaTitleId: string | null;
  rule: ReturnType<typeof rule>;
}) {
  return {
    id: input.id,
    tenantId: "tenant-1",
    downloaderId: "downloader-1",
    mediaTitleId: input.mediaTitleId,
    rule: input.rule
  };
}

function rule(input: Record<string, unknown>) {
  return {
    id: "rule-1",
    tenantId: "tenant-1",
    subscriptionId: "subscription-1",
    mediaType: null,
    mode: "MEDIA_TITLE",
    titleRegex: null,
    includeRegex: null,
    excludeRegex: null,
    minResolution: null,
    maxResolution: null,
    sources: [],
    codecs: [],
    audio: [],
    releaseGroupsInclude: [],
    releaseGroupsExclude: [],
    preferredReleaseGroups: [],
    minSizeBytes: null,
    maxSizeBytes: null,
    season: null,
    episodeStart: null,
    episodeEnd: null,
    feedIds: [],
    upgradePolicy: "none",
    allowCrossSeed: false,
    seasonPackAllowed: true,
    criteriaJson: null,
    ...input
  };
}

function matchedMedia() {
  return {
    id: "match-1",
    status: "MATCHED",
    source: "AUTO",
    confidence: 0.96,
    mediaTitle: {
      id: "media-title-1",
      mediaType: "TV_SERIES",
      title: "TV Stand-up Comedy",
      releaseYear: 2026,
      providerIdentities: []
    },
    providerMediaMetadata: {
      id: "metadata-1",
      mediaType: "TV_SERIES",
      mediaProviderIdentity: {
        provider: "tmdb",
        providerId: "123",
        mediaType: "TV_SERIES"
      }
    },
    providerTitle: null
  };
}
