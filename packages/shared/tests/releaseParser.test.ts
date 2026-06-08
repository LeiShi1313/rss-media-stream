import { describe, expect, it } from "vitest";
import { parseReleaseTitle } from "../src/releaseParser.js";

describe("parseReleaseTitle", () => {
  it("extracts movie metadata", () => {
    const release = parseReleaseTitle("Example.Movie.2024.2160p.WEB-DL.DDP5.1.H.265-GROUP");
    expect(release).toMatchObject({
      title: "Example Movie",
      year: 2024,
      mediaType: "MOVIE",
      quality: "2160p",
      source: "WEB-DL",
      codec: "H.265",
      releaseGroup: "GROUP"
    });
    expect(release.parseConfidence).toBeGreaterThanOrEqual(0.8);
  });

  it("extracts strict series episode metadata", () => {
    const release = parseReleaseTitle("[OurBits] Example.Show.S02E03.1080p.HDTV.x264-GRP");
    expect(release).toMatchObject({
      title: "Example Show",
      mediaType: "TV_SERIES",
      season: 2,
      episode: 3,
      quality: "1080p",
      source: "HDTV",
      codec: "H.264"
    });
  });

  it("recognizes season packs but leaves episode empty", () => {
    const release = parseReleaseTitle("Example.Show.S01.1080p.BluRay.x265-GRP");
    expect(release.mediaType).toBe("TV_SERIES");
    expect(release.season).toBe(1);
    expect(release.episode).toBeUndefined();
  });

  it("recognizes season word packs", () => {
    const release = parseReleaseTitle("Example.Show.Season.1.2024.1080p.WEB-DL.H264-GRP");
    expect(release).toMatchObject({
      title: "Example Show",
      mediaType: "TV_SERIES",
      season: 1,
      episode: undefined
    });
  });

  it("parses bracketed TJUPT release titles", () => {
    const release = parseReleaseTitle(
      "[电影][香港][龙门金剑][The.Golden.Sword.1969.1080p.BluRay.x265.10bit.DTS-HD.MA2.0-WiKi][The Golden Sword | 类型： 动作][9.34 GiB][]"
    );

    expect(release).toMatchObject({
      title: "The Golden Sword",
      year: 1969,
      mediaType: "MOVIE",
      quality: "1080p",
      source: "BluRay",
      codec: "H.265",
      audio: "DTS-HD",
      releaseGroup: "WiKi"
    });
    expect(release.parseConfidence).toBeGreaterThanOrEqual(0.8);
  });

  it("parses UBits category-prefixed titles from the release text", () => {
    const release = parseReleaseTitle(
      "[动漫(Animations)]Kami no Niwatsuki Kusunoki-tei 2026 S01E10 1080p LINETV WEB-DL H264 AAC-UBWEB[2026年4月新番 | 楠木邸的神明庭院/Kusunoki's Garden of Gods | 第10集 [日语/简繁中字]][569.44 MB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "Kami no Niwatsuki Kusunoki tei",
      year: 2026,
      mediaType: "TV_SERIES",
      season: 1,
      episode: 10,
      quality: "1080p",
      source: "WEB-DL",
      codec: "H.264",
      audio: "AAC",
      releaseGroup: "UBWEB"
    });
    expect(release.parseConfidence).toBe(1);
  });
});
