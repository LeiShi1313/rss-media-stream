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
});
