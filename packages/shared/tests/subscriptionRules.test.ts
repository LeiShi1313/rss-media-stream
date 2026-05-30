import { describe, expect, it } from "vitest";
import { evaluateSubscriptionRule } from "../src/subscriptionRules.js";

describe("evaluateSubscriptionRule", () => {
  it("accepts a high confidence movie match that passes regex and quality", () => {
    const decision = evaluateSubscriptionRule(
      {
        mediaProvider: "tmdb",
        mediaProviderId: "123",
        mediaKind: "MOVIE",
        includeRegex: "WEB-DL",
        minQuality: "1080p"
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
        mediaProvider: "tmdb",
        mediaProviderId: "999",
        mediaKind: "TV",
        minQuality: "720p"
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
        mediaProvider: "tmdb",
        mediaProviderId: "123",
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
});
