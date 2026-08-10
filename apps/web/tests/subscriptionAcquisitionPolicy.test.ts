import { describe, expect, it } from "vitest";
import type {
  CandidateInput,
  NormalizedSubscriptionRule
} from "@rss-media/shared/types";
import {
  decideAcquisition,
  prepareAcquisition
} from "../src/server/modules/subscriptions/subscriptionAcquisitionPolicy.js";

describe("subscription acquisition policy", () => {
  it("keeps regex subscriptions on the direct path", () => {
    expect(prepareAcquisition({
      rule: normalizedRule({ mode: "REGEX" }),
      candidate: candidate({ activeMatch: null })
    })).toEqual({ accepted: true, action: "DIRECT" });
  });

  it.each([
    {
      name: "movie",
      candidate: candidate({ mediaType: "MOVIE" }),
      expected: { contentKey: "movie:media-1", unitType: "MOVIE" }
    },
    {
      name: "season pack",
      candidate: candidate({ episode: undefined }),
      expected: { contentKey: "tv:media-1:s03:season", unitType: "TV_SEASON", season: 3 }
    },
    {
      name: "episode",
      candidate: candidate({ episode: 4 }),
      expected: { contentKey: "tv:media-1:s03:e04", unitType: "TV_EPISODE", episode: 4 }
    },
    {
      name: "episode range",
      candidate: candidate({ episode: 4, episodeEnd: 6 }),
      expected: {
        contentKey: "tv:media-1:s03:e04-e06",
        unitType: "TV_EPISODE",
        episode: 4,
        episodeEnd: 6
      }
    },
    {
      name: "special",
      candidate: candidate({ tvUnitType: "SPECIAL", episode: undefined, specialNumber: 2 }),
      expected: {
        contentKey: "tv:media-1:s03:sp:2",
        unitType: "TV_SPECIAL",
        specialNumber: 2
      }
    },
    {
      name: "part and variant",
      candidate: candidate({ episode: 4, episodePart: "a", variant: "纯享" }),
      rule: normalizedRule({ separateVariants: true }),
      expected: {
        contentKey: "tv:media-1:s03:e04:variant:PURE:part:A",
        unitType: "TV_EPISODE",
        episode: 4,
        episodePart: "A",
        variant: "PURE"
      }
    }
  ])("derives the $name acquisition unit", ({ candidate: input, rule, expected }) => {
    const preparation = prepareAcquisition({
      rule: rule ?? normalizedRule(),
      candidate: input
    });

    expect(preparation).toMatchObject({ accepted: true, action: "CHECK", unit: expected });
  });

  it("rejects releases that cannot be mapped to a media unit", () => {
    expect(prepareAcquisition({
      rule: normalizedRule(),
      candidate: candidate({ activeMatch: null })
    })).toEqual({
      accepted: false,
      reason: "release cannot be mapped to a media unit"
    });
  });

  it("satisfies an unseen media unit", () => {
    const preparation = prepareAcquisition({ rule: normalizedRule(), candidate: candidate() });

    expect(decideAcquisition({
      preparation,
      rule: normalizedRule(),
      feedId: "feed-a",
      state: null
    })).toMatchObject({ accepted: true, action: "SATISFY" });
  });

  it("chooses an unseen cross-seed feed before a simultaneous quality upgrade", () => {
    const rule = normalizedRule({ allowCrossSeed: true, upgradePolicy: "better_quality" });
    const preparation = prepareAcquisition({
      rule,
      candidate: candidate({ resolution: 2160, source: "REMUX" })
    });

    expect(decideAcquisition({
      preparation,
      rule,
      feedId: "feed-b",
      state: acquisitionState({
        crossSeedFeedIds: ["feed-a"],
        currentResolution: 1080,
        currentSourceRank: 30
      })
    })).toMatchObject({
      accepted: true,
      action: "CROSS_SEED",
      forceDuplicate: true,
      reason: "accepted for cross-seed feed"
    });
  });

  it("rejects a same-feed duplicate when no upgrade applies", () => {
    const rule = normalizedRule({ allowCrossSeed: true });
    const preparation = prepareAcquisition({ rule, candidate: candidate() });

    expect(decideAcquisition({
      preparation,
      rule,
      feedId: "feed-a",
      state: acquisitionState({ crossSeedFeedIds: ["feed-a"] })
    })).toEqual({ accepted: false, reason: "media unit is already satisfied" });
  });

  it.each([
    {
      name: "higher resolution",
      candidate: candidate({ resolution: 2160, source: "WEB-DL" }),
      state: acquisitionState({ currentResolution: 1080, currentSourceRank: 60 })
    },
    {
      name: "higher source rank at equal resolution",
      candidate: candidate({ resolution: 1080, source: "REMUX" }),
      state: acquisitionState({ currentResolution: 1080, currentSourceRank: 40 })
    }
  ])("accepts a $name quality upgrade", ({ candidate: input, state }) => {
    const rule = normalizedRule({ upgradePolicy: "better_quality" });
    const preparation = prepareAcquisition({ rule, candidate: input });

    expect(decideAcquisition({
      preparation,
      rule,
      feedId: "feed-a",
      state
    })).toMatchObject({
      accepted: true,
      action: "UPGRADE",
      reason: "accepted as quality upgrade"
    });
  });

  it("only upgrades to a newly preferred release group", () => {
    const rule = normalizedRule({
      upgradePolicy: "preferred_release_group",
      preferredReleaseGroups: ["PREFERRED"]
    });
    const preparation = prepareAcquisition({
      rule,
      candidate: candidate({ releaseGroup: "PREFERRED" })
    });

    expect(decideAcquisition({
      preparation,
      rule,
      feedId: "feed-a",
      state: acquisitionState({ currentReleaseGroup: "OTHER" })
    })).toMatchObject({ accepted: true, action: "UPGRADE" });

    expect(decideAcquisition({
      preparation,
      rule,
      feedId: "feed-a",
      state: acquisitionState({ currentReleaseGroup: "PREFERRED" })
    })).toEqual({ accepted: false, reason: "media unit is already satisfied" });
  });
});

function normalizedRule(
  input: Partial<NormalizedSubscriptionRule> = {}
): NormalizedSubscriptionRule {
  return {
    mode: "MEDIA_TITLE",
    linkedProviders: [],
    providerRatings: [],
    feedIds: [],
    sources: [],
    codecs: [],
    audio: [],
    releaseGroupsInclude: [],
    releaseGroupsExclude: [],
    variantsInclude: [],
    variantsExclude: [],
    preferredReleaseGroups: [],
    upgradePolicy: "none",
    allowCrossSeed: false,
    separateVariants: false,
    seasonPackAllowed: true,
    ...input
  };
}

function candidate(input: {
  activeMatch?: CandidateInput["activeMatch"];
  mediaType?: "MOVIE" | "TV_SERIES";
  tvUnitType?: "EPISODE" | "SPECIAL";
  episode?: number;
  episodeEnd?: number;
  specialNumber?: number;
  episodePart?: string;
  variant?: string;
  resolution?: number;
  source?: string;
  releaseGroup?: string;
} = {}): CandidateInput {
  const hasActiveMatch = Object.hasOwn(input, "activeMatch");
  return {
    feedId: "feed-a",
    rawTitle: "Stand-up Comedy S03E04 1080p WEB-DL",
    release: {
      title: "Stand-up Comedy",
      mediaType: input.mediaType ?? "TV_SERIES",
      tvUnitType: input.tvUnitType ?? "EPISODE",
      season: 3,
      episode: Object.hasOwn(input, "episode") ? input.episode : 4,
      episodeEnd: input.episodeEnd,
      specialNumber: input.specialNumber,
      episodePart: input.episodePart,
      variant: input.variant,
      resolution: input.resolution ?? 1080,
      source: input.source ?? "WEB-DL",
      releaseGroup: input.releaseGroup ?? "GROUP",
      parseConfidence: 0.95
    },
    activeMatch: hasActiveMatch
      ? input.activeMatch
      : {
          id: "match-1",
          status: "MATCHED",
          source: "AUTO",
          confidence: 0.96,
          mediaTitle: {
            id: "media-1",
            mediaType: input.mediaType ?? "TV_SERIES",
            canonicalTitle: "Stand-up Comedy"
          },
          selectedProviderTitle: providerTitle(),
          linkedProviderTitles: []
        }
  };
}

function providerTitle() {
  return {
    providerTitleId: "provider-title-1",
    provider: "tmdb",
    providerId: "123",
    mediaType: "TV_SERIES" as const
  };
}

function acquisitionState(input: {
  crossSeedFeedIds?: string[];
  currentResolution?: number | null;
  currentSourceRank?: number | null;
  currentReleaseGroup?: string | null;
} = {}) {
  return {
    crossSeedFeedIds: input.crossSeedFeedIds ?? [],
    currentResolution: input.currentResolution ?? 1080,
    currentSourceRank: input.currentSourceRank ?? 40,
    currentReleaseGroup: input.currentReleaseGroup ?? "GROUP"
  };
}
