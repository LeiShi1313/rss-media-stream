import { describe, expect, it } from "vitest";
import {
  evaluateSubscriptionRule,
  normalizeRule,
  SubscriptionRuleValidationError
} from "../src/subscriptionRules.js";

describe("evaluateSubscriptionRule", () => {
  it("accepts a high confidence movie match that passes regex and resolution", () => {
    const decision = evaluateSubscriptionRule(
      {
        provider: "tmdb",
        providerId: "123",
        mediaKind: "MOVIE",
        includeRegex: "WEB-DL",
        minResolution: "1080p"
      },
      {
        rawTitle: "Example.Movie.2024.2160p.WEB-DL.x265-GRP",
        release: {
          title: "Example Movie",
          year: 2024,
          kind: "MOVIE",
          quality: "2160p",
          confidence: 0.85
        },
        match: {
          provider: "tmdb",
          providerId: "123",
          kind: "MOVIE",
          score: 0.93,
          status: "MATCHED"
        }
      }
    );
    expect(decision.accepted).toBe(true);
  });

  it("rejects series releases without strict episode fields", () => {
    const decision = evaluateSubscriptionRule(
      {
        provider: "tmdb",
        providerId: "999",
        mediaKind: "TV",
        minResolution: "720p"
      },
      {
        rawTitle: "Example.Show.S01.1080p.BluRay.x265-GRP",
        release: {
          title: "Example Show",
          kind: "TV",
          season: 1,
          quality: "1080p",
          confidence: 0.8
        },
        match: {
          provider: "tmdb",
          providerId: "999",
          kind: "TV",
          score: 0.94,
          status: "MATCHED"
        }
      }
    );
    expect(decision).toMatchObject({
      accepted: false,
      reason: "series release lacks strict season and episode fields"
    });
  });

  it("rejects excluded releases", () => {
    const decision = evaluateSubscriptionRule(
      {
        provider: "tmdb",
        providerId: "123",
        mediaKind: "MOVIE",
        excludeRegex: "CAM|TS"
      },
      {
        rawTitle: "Example.Movie.2024.1080p.CAM.x264-GRP",
        release: {
          title: "Example Movie",
          kind: "MOVIE",
          quality: "1080p",
          confidence: 0.7
        },
        match: {
          provider: "tmdb",
          providerId: "123",
          kind: "MOVIE",
          score: 0.9,
          status: "MATCHED"
        }
      }
    );
    expect(decision.accepted).toBe(false);
    expect(decision.reason).toBe("exclude regex matched");
  });

  it("accepts normalized structured rule dimensions", () => {
    const decision = evaluateSubscriptionRule(
      {
        mediaKind: "TV",
        provider: "TMDB",
        providerId: "tv-123",
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
      {
        rawTitle: "Example.Show.S01E03.2160p.WEB-DL.DDP5.1.HEVC-GRP",
        sizeBytes: 5_000_000n,
        release: {
          title: "Example Show",
          kind: "TV",
          season: 1,
          episode: 3,
          resolution: 2160,
          source: "WEB-DL",
          codec: "HEVC",
          audio: "DDP5.1",
          releaseGroup: "grp",
          confidence: 0.9
        },
        match: {
          provider: "tmdb",
          providerId: "tv-123",
          kind: "TV",
          score: 0.96,
          status: "MATCHED"
        }
      }
    );

    expect(decision).toMatchObject({ accepted: true, reason: "accepted" });
    expect(decision.ruleSnapshot).toMatchObject({
      provider: "tmdb",
      providerId: "tv-123",
      minResolution: 1080,
      maxResolution: 2160,
      sources: ["WEB-DL"],
      codecs: ["H.265"],
      releaseGroupsInclude: ["GRP"],
      minSizeBytes: "1000",
      maxSizeBytes: "10000000"
    });
  });

  it("rejects provider id mismatches", () => {
    const decision = evaluateSubscriptionRule(
      { provider: "tmdb", providerId: "123", mediaKind: "MOVIE" },
      {
        rawTitle: "Example.Movie.2024.1080p.WEB-DL.x264-GRP",
        release: {
          title: "Example Movie",
          kind: "MOVIE",
          resolution: 1080,
          confidence: 0.9
        },
        match: {
          provider: "tmdb",
          providerId: "999",
          kind: "MOVIE",
          score: 0.96,
          status: "MATCHED"
        }
      }
    );

    expect(decision).toMatchObject({
      accepted: false,
      reason: "metadata provider id does not match subscription"
    });
  });

  it("rejects releases outside source, codec, size, and episode constraints", () => {
    const decision = evaluateSubscriptionRule(
      {
        provider: "tmdb",
        providerId: "123",
        mediaKind: "TV",
        sources: ["BluRay"],
        codecs: ["H.265"],
        minSizeBytes: "1000",
        episodeStart: 4
      },
      {
        rawTitle: "Example.Show.S01E03.1080p.WEB-DL.x264-GRP",
        sizeBytes: 500n,
        release: {
          title: "Example Show",
          kind: "TV",
          season: 1,
          episode: 3,
          resolution: 1080,
          source: "WEB-DL",
          codec: "x264",
          confidence: 0.9
        },
        match: {
          provider: "tmdb",
          providerId: "123",
          kind: "TV",
          score: 0.96,
          status: "MATCHED"
        }
      }
    );

    expect(decision).toMatchObject({
      accepted: false,
      reason: "source does not match subscription"
    });
  });

  it("validates regex and numeric ranges during normalization", () => {
    expect(() => normalizeRule({ includeRegex: "[" })).toThrow(
      SubscriptionRuleValidationError
    );
    expect(() =>
      normalizeRule({ minResolution: 2160, maxResolution: 1080 })
    ).toThrow("minResolution cannot be greater than maxResolution");
    expect(() =>
      normalizeRule({ minSizeBytes: "20", maxSizeBytes: "10" })
    ).toThrow("minSizeBytes cannot be greater than maxSizeBytes");
  });
});
