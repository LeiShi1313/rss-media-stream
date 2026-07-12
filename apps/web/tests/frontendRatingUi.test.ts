import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("workspace rating source and overview score UI", () => {
  it("saves one rating-capable source with each media type policy group", () => {
    const source = readFileSync(resolve(__dirname, "../src/client/pages/settings.tsx"), "utf8");

    expect(source).toContain("ratingSupportedMediaTypes.includes(group.mediaType)");
    expect(source).toContain("ratingProviderSource: group.ratingProviderSource");
    expect(source).toContain("settings.ratingProviderSource");
  });

  it("renders the shared score badge on release and trending poster cards", () => {
    const overviewSource = readFileSync(resolve(__dirname, "../src/client/pages/overview.tsx"), "utf8");
    const badgeSource = readFileSync(
      resolve(__dirname, "../src/client/components/media/rating-badge.tsx"),
      "utf8"
    );

    expect(overviewSource.match(/<RatingBadge/g)).toHaveLength(2);
    expect(badgeSource).toContain("<Tooltip");
    expect(badgeSource).toContain("rating.providerLabel");
    expect(badgeSource).toContain("rating.providerSourceLabel");
    expect(badgeSource).toContain("formatNativeRating");
    expect(badgeSource).toContain("formatRatingVoteCount");
    expect(badgeSource).toContain("rating.fetchedAt");
  });
});
