import { describe, expect, it } from "vitest";
import { parseReleaseTitle } from "../src/shared/releaseParser.js";

describe("parseReleaseTitle", () => {
  it("extracts movie metadata", () => {
    const release = parseReleaseTitle("Example.Movie.2024.2160p.WEB-DL.DDP5.1.H.265-GROUP");
    expect(release).toMatchObject({
      title: "Example Movie",
      year: 2024,
      kind: "MOVIE",
      quality: "2160p",
      source: "WEB-DL",
      codec: "H.265",
      releaseGroup: "GROUP"
    });
    expect(release.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("extracts strict series episode metadata", () => {
    const release = parseReleaseTitle("[OurBits] Example.Show.S02E03.1080p.HDTV.x264-GRP");
    expect(release).toMatchObject({
      title: "Example Show",
      kind: "TV",
      season: 2,
      episode: 3,
      quality: "1080p",
      source: "HDTV",
      codec: "H.264"
    });
  });

  it("recognizes season packs but leaves episode empty", () => {
    const release = parseReleaseTitle("Example.Show.S01.1080p.BluRay.x265-GRP");
    expect(release.kind).toBe("TV");
    expect(release.season).toBe(1);
    expect(release.episode).toBeUndefined();
  });
});
