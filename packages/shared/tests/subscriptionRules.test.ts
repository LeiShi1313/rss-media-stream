import { describe, expect, it } from "vitest";
import {
  evaluateSubscriptionRule,
  normalizeRule,
  SubscriptionRuleValidationError
} from "../src/subscriptionRules.js";
import type { CandidateInput, ProviderTitleRuleView } from "../src/types.js";

const tmdbTitle: ProviderTitleRuleView = {
  providerTitleId: "pt_tmdb_123",
  provider: "tmdb",
  providerEntityType: "tmdb_movie",
  providerId: "123",
  mediaType: "MOVIE",
  ratingValue: 8.2,
  ratingScale: 10,
  ratingVoteCount: 1200,
  ratingType: "user_score"
};

const imdbTitle: ProviderTitleRuleView = {
  providerTitleId: "pt_imdb_tt123",
  provider: "imdb",
  providerEntityType: "imdb_title",
  providerId: "tt1234567",
  mediaType: "MOVIE",
  ratingValue: 7.6,
  ratingScale: 10,
  ratingVoteCount: 24000,
  ratingType: "user_score"
};

function candidate(overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    rawTitle: "Example.Movie.2024.2160p.WEB-DL.x265-GRP",
    release: {
      title: "Example Movie",
      year: 2024,
      mediaType: "MOVIE",
      quality: "2160p",
      parseConfidence: 0.85
    },
    activeMatch: {
      id: "match_1",
      status: "MATCHED",
      source: "AUTO",
      confidence: 0.92,
      mediaTitle: {
        id: "media_1",
        mediaType: "MOVIE",
        canonicalTitle: "Example Movie",
        releaseYear: 2024
      },
      selectedProviderTitle: tmdbTitle,
      linkedProviderTitles: [tmdbTitle, imdbTitle]
    },
    ...overrides
  };
}

describe("evaluateSubscriptionRule", () => {
  it("accepts an active matched movie that passes identity, regex, and resolution filters", () => {
    const decision = evaluateSubscriptionRule(
      {
        mediaType: "MOVIE",
        mediaTitleId: "media_1",
        selectedProvider: {
          provider: "tmdb",
          providerEntityType: "tmdb_movie",
          providerId: "123"
        },
        includeRegex: "WEB-DL",
        minResolution: "1080p"
      },
      candidate()
    );

    expect(decision.accepted).toBe(true);
  });

  it("rejects candidates without an active matched release match", () => {
    const decision = evaluateSubscriptionRule(
      {
        mediaType: "MOVIE",
        includeRegex: "WEB-DL"
      },
      candidate({ activeMatch: null })
    );

    expect(decision).toMatchObject({
      accepted: false,
      reason: "release has no active matched media title"
    });
  });

  it("rejects low-confidence automatic matches for auto-download", () => {
    const decision = evaluateSubscriptionRule(
      {
        mediaType: "MOVIE",
        includeRegex: "WEB-DL"
      },
      candidate({
        activeMatch: {
          ...candidate().activeMatch!,
          source: "AUTO",
          confidence: 0.42
        }
      })
    );

    expect(decision).toMatchObject({
      accepted: false,
      reason: "metadata match confidence is below auto-download threshold"
    });
  });

  it("rejects media title identity mismatches", () => {
    const decision = evaluateSubscriptionRule(
      { mediaType: "MOVIE", mediaTitleId: "media_2" },
      candidate()
    );

    expect(decision).toMatchObject({
      accepted: false,
      reason: "media title does not match subscription"
    });
  });

  it("rejects selected provider identity mismatches", () => {
    const decision = evaluateSubscriptionRule(
      {
        selectedProvider: {
          provider: "tmdb",
          providerEntityType: "tmdb_movie",
          providerId: "999"
        }
      },
      candidate()
    );

    expect(decision).toMatchObject({
      accepted: false,
      reason: "selected provider title does not match subscription"
    });
  });

  it("supports linked provider identity filters", () => {
    const accepted = evaluateSubscriptionRule(
      {
        linkedProviders: [
          {
            provider: "imdb",
            providerEntityType: "imdb_title",
            providerId: "tt1234567"
          }
        ]
      },
      candidate()
    );

    const rejected = evaluateSubscriptionRule(
      {
        linkedProviders: [
          {
            provider: "douban",
            providerEntityType: "douban_subject",
            providerId: "26752088"
          }
        ]
      },
      candidate()
    );

    expect(accepted.accepted).toBe(true);
    expect(rejected).toMatchObject({
      accepted: false,
      reason: "linked provider title does not match subscription"
    });
  });

  it("supports normalized provider rating filters with scale and minimum votes", () => {
    const decision = evaluateSubscriptionRule(
      {
        providerRatings: [
          {
            provider: "imdb",
            ratingType: "user_score",
            comparison: "gte",
            value: 7.5,
            scale: 10,
            minVoteCount: 1000
          }
        ]
      },
      candidate()
    );

    expect(decision.accepted).toBe(true);
  });

  it("rejects missing provider ratings and low vote counts", () => {
    const missing = evaluateSubscriptionRule(
      {
        providerRatings: [
          {
            provider: "douban",
            comparison: "gte",
            value: 0.7
          }
        ]
      },
      candidate()
    );

    const lowVotes = evaluateSubscriptionRule(
      {
        providerRatings: [
          {
            provider: "tmdb",
            comparison: "gte",
            value: 8,
            scale: 10,
            minVoteCount: 2000
          }
        ]
      },
      candidate()
    );

    expect(missing).toMatchObject({
      accepted: false,
      reason: "provider rating is missing"
    });
    expect(lowVotes).toMatchObject({
      accepted: false,
      reason: "provider rating vote count is below subscription minimum"
    });
  });

  it("accepts normalized structured release dimensions", () => {
    const decision = evaluateSubscriptionRule(
      {
        mediaType: "TV_SERIES",
        titleRegex: "example show",
        includeRegex: "WEB[-.]DL",
        minResolution: "1080p",
        maxResolution: "4K",
        sources: ["web dl"],
        codecs: ["x265"],
        audio: ["DDP 5.1"],
        releaseGroupsInclude: ["grp"],
        minSizeBytes: "1000",
        maxSizeBytes: 10_000_000,
        season: 1,
        episodeStart: 2,
        episodeEnd: 4
      },
      candidate({
        rawTitle: "Example.Show.S01E03.2160p.WEB-DL.DDP5.1.HEVC-GRP",
        sizeBytes: 5_000_000n,
        release: {
          title: "Example Show",
          mediaType: "TV_SERIES",
          season: 1,
          episode: 3,
          resolution: 2160,
          source: "WEB-DL",
          codec: "HEVC",
          audio: "DDP5.1",
          releaseGroup: "grp",
          parseConfidence: 0.9
        },
        activeMatch: {
          id: "match_tv",
          status: "MATCHED",
          source: "AUTO",
          confidence: 0.94,
          mediaTitle: {
            id: "media_tv",
            mediaType: "TV_SERIES",
            canonicalTitle: "Example Show"
          },
          selectedProviderTitle: {
            ...tmdbTitle,
            providerEntityType: "tmdb_tv",
            mediaType: "TV_SERIES"
          },
          linkedProviderTitles: []
        }
      })
    );

    expect(decision).toMatchObject({ accepted: true, reason: "accepted" });
    expect(decision.ruleSnapshot).toMatchObject({
      minResolution: 1080,
      maxResolution: 2160,
      sources: ["WEB-DL"],
      codecs: ["H.265"],
      releaseGroupsInclude: ["GRP"],
      minSizeBytes: "1000",
      maxSizeBytes: "10000000"
    });
  });

  it("rejects series releases without strict episode fields", () => {
    const decision = evaluateSubscriptionRule(
      {
        mediaType: "TV_SERIES",
        minResolution: "720p"
      },
      candidate({
        rawTitle: "Example.Show.S01.1080p.BluRay.x265-GRP",
        release: {
          title: "Example Show",
          mediaType: "TV_SERIES",
          season: 1,
          quality: "1080p",
          parseConfidence: 0.8
        },
        activeMatch: {
          id: "match_tv",
          status: "MATCHED",
          source: "AUTO",
          confidence: 0.94,
          mediaTitle: {
            id: "media_tv",
            mediaType: "TV_SERIES",
            canonicalTitle: "Example Show"
          },
          selectedProviderTitle: {
            ...tmdbTitle,
            providerEntityType: "tmdb_tv",
            mediaType: "TV_SERIES"
          },
          linkedProviderTitles: []
        }
      })
    );

    expect(decision).toMatchObject({
      accepted: false,
      reason: "series release lacks strict season and episode fields"
    });
  });

  it("rejects excluded releases", () => {
    const decision = evaluateSubscriptionRule(
      {
        mediaType: "MOVIE",
        excludeRegex: "CAM|TS"
      },
      candidate({
        rawTitle: "Example.Movie.2024.1080p.CAM.x264-GRP",
        release: {
          title: "Example Movie",
          mediaType: "MOVIE",
          quality: "1080p",
          parseConfidence: 0.7
        }
      })
    );

    expect(decision.accepted).toBe(false);
    expect(decision.reason).toBe("exclude regex matched");
  });

  it("rejects releases outside source, codec, size, and episode constraints", () => {
    const decision = evaluateSubscriptionRule(
      {
        mediaType: "TV_SERIES",
        sources: ["BluRay"],
        codecs: ["H.265"],
        minSizeBytes: "1000",
        episodeStart: 4
      },
      candidate({
        rawTitle: "Example.Show.S01E03.1080p.WEB-DL.x264-GRP",
        sizeBytes: 500n,
        release: {
          title: "Example Show",
          mediaType: "TV_SERIES",
          season: 1,
          episode: 3,
          resolution: 1080,
          source: "WEB-DL",
          codec: "x264",
          parseConfidence: 0.9
        },
        activeMatch: {
          id: "match_tv",
          status: "MATCHED",
          source: "AUTO",
          confidence: 0.96,
          mediaTitle: {
            id: "media_tv",
            mediaType: "TV_SERIES",
            canonicalTitle: "Example Show"
          },
          selectedProviderTitle: {
            ...tmdbTitle,
            providerEntityType: "tmdb_tv",
            mediaType: "TV_SERIES"
          },
          linkedProviderTitles: []
        }
      })
    );

    expect(decision).toMatchObject({
      accepted: false,
      reason: "source does not match subscription"
    });
  });

  it("normalizes criteriaJson structured filters", () => {
    expect(normalizeRule({
      criteriaJson: {
        mediaTitleId: "media_1",
        selectedProvider: {
          provider: "TMDB",
          providerEntityType: "tmdb_movie",
          providerId: "123"
        },
        linkedProviders: [
          {
            provider: "IMDB",
            providerEntityType: "imdb_title",
            providerId: "tt1234567"
          }
        ],
        providerRatings: [
          {
            provider: "IMDB",
            ratingType: "user_score",
            comparison: "gte",
            value: "7.5",
            scale: "10",
            minVoteCount: "100"
          }
        ]
      }
    })).toMatchObject({
      mediaTitleId: "media_1",
      selectedProvider: {
        provider: "tmdb",
        providerEntityType: "tmdb_movie",
        providerId: "123"
      },
      linkedProviders: [
        {
          provider: "imdb",
          providerEntityType: "imdb_title",
          providerId: "tt1234567"
        }
      ],
      providerRatings: [
        {
          provider: "imdb",
          ratingType: "user_score",
          comparison: "gte",
          value: 7.5,
          scale: 10,
          minVoteCount: 100
        }
      ]
    });
  });

  it("validates regex, numeric ranges, and structured filters during normalization", () => {
    expect(() => normalizeRule({ includeRegex: "[" })).toThrow(
      SubscriptionRuleValidationError
    );
    expect(() =>
      normalizeRule({ minResolution: 2160, maxResolution: 1080 })
    ).toThrow("minResolution cannot be greater than maxResolution");
    expect(() =>
      normalizeRule({ minSizeBytes: "20", maxSizeBytes: "10" })
    ).toThrow("minSizeBytes cannot be greater than maxSizeBytes");
    expect(() =>
      normalizeRule({ selectedProvider: { provider: "imdb", providerId: "" } })
    ).toThrow("provider identity filters require provider and providerId");
    expect(() =>
      normalizeRule({
        providerRatings: [
          { provider: "imdb", comparison: "gte", value: 7.5, scale: 0 }
        ]
      })
    ).toThrow("provider rating scale must be positive");
  });
});
