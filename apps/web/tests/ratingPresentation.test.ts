import { describe, expect, it } from "vitest";
import {
  formatNativeRating,
  formatRatingScore,
  formatRatingVoteCount
} from "../src/client/lib/ratings.js";

const rating = {
  provider: "douban",
  providerSource: "ptgen_douban",
  providerId: "1291843",
  providerLabel: "Douban",
  providerSourceLabel: "PTGen Douban",
  value: 8.8,
  scale: 10,
  voteCount: 912345,
  type: "user_score" as const,
  fetchedAt: "2026-07-02T10:00:00.000Z"
};

describe("rating presentation formatting", () => {
  it("keeps the card badge score-only and the tooltip value on its native scale", () => {
    expect(formatRatingScore(rating, "en-US")).toBe("8.8");
    expect(formatNativeRating(rating, "en-US")).toBe("8.8/10");
  });

  it("formats full vote details without changing the score", () => {
    expect(formatRatingVoteCount(rating, "en-US")).toBe("912,345");
  });
});
