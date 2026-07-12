import { describe, expect, it } from "vitest";
import { buildReleaseSignature } from "../src/releaseSignature.js";
import type { ParsedRelease } from "../src/types.js";

describe("buildReleaseSignature", () => {
  it("builds a stable signature from parsed release identity fields", () => {
    const release: ParsedRelease = {
      title: "Example  Movie",
      mediaType: "MOVIE",
      year: 2024,
      quality: "2160p",
      source: "WEB-DL",
      codec: "H.265",
      audio: "DDP 5.1",
      releaseGroup: "GROUP",
      parseConfidence: 0.98
    };

    expect(buildReleaseSignature(release, 123456n)).toBe(
      "title=example movie|mediaType=movie|year=2024|season=|episode=|episodeEnd=|quality=2160p|source=web-dl|codec=h.265|audio=ddp 5.1|group=group|size=123456"
    );
  });

  it("returns undefined when the parsed release has no title", () => {
    expect(buildReleaseSignature({
      title: "",
      mediaType: "UNKNOWN",
      parseConfidence: 0
    })).toBeUndefined();
  });

  it("includes parsed TV specials, parts, and variants when present", () => {
    expect(buildReleaseSignature({
      title: "Stand up Comedy",
      mediaType: "TV_SERIES",
      season: 1,
      tvUnitType: "SPECIAL",
      specialNumber: 6,
      quality: "2160p",
      parseConfidence: 0.98
    })).toBe(
      "title=stand up comedy|mediaType=tv_series|year=|season=1|episode=|episodeEnd=|tvUnitType=special|specialNumber=6|quality=2160p|source=|codec=|audio=|group=|size="
    );

    expect(buildReleaseSignature({
      title: "Stand up Comedy",
      mediaType: "TV_SERIES",
      season: 1,
      episode: 1,
      episodePart: "A",
      variant: "PURE",
      quality: "2160p",
      parseConfidence: 0.98
    })).toBe(
      "title=stand up comedy|mediaType=tv_series|year=|season=1|episode=1|episodeEnd=|episodePart=a|variant=pure|quality=2160p|source=|codec=|audio=|group=|size="
    );
  });
});
