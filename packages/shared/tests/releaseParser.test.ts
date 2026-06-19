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

  it("parses chained special-episode markers as TV episodes", () => {
    const release = parseReleaseTitle(
      "Doctor Who 2005 S00E09E13E14 60th Anniversary Edition 1080p USA Blu-ray AVC DTS-HD MA 5.1-L0ST"
    );

    expect(release).toMatchObject({
      title: "Doctor Who",
      year: 2005,
      mediaType: "TV_SERIES",
      season: 0,
      episode: 9,
      episodeEnd: 14,
      quality: "1080p",
      source: "BluRay",
      releaseGroup: "L0ST"
    });
  });

  it("parses year-numbered SyyyyEyy releases as TV episodes", () => {
    const release = parseReleaseTitle(
      "[综艺]Only You S2026E41 2010 2160p WEB-DL H265 AAC-ADWeb[非你莫属 2026年度 正片 第41期 职点迷津专场，企业家分享人生“动摇”时刻 *酷喵TV*][1.64 GB][anonymous][国语 | 中字 | 官方]"
    );

    expect(release).toMatchObject({
      title: "Only You",
      year: 2010,
      mediaType: "TV_SERIES",
      season: 2026,
      episode: 41,
      quality: "2160p",
      source: "WEB-DL",
      releaseGroup: "ADWeb"
    });
    expect(release.providerSearchTitles).toEqual(["非你莫属"]);
  });

  it("does not promote titleless year-numbered episode files to TV", () => {
    const release = parseReleaseTitle("S2026E11 0 1080p WEB-DL AAC2.0 H.264-BTN");

    expect(release).toMatchObject({
      title: "S2026E11 0",
      mediaType: "UNKNOWN",
      season: undefined,
      episode: undefined,
      quality: "1080p",
      source: "WEB-DL",
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

  it("removes leading category wrappers when release text has no resolution token", () => {
    const release = parseReleaseTitle(
      "[动漫(Animations)]Love Live Nijigasaki Gakuen School Idol Doukoukai 2022 S02 Blu-ray x265 FLAC-VCB-Studio[Love Live! Nijigasaki High School Idol Club Season 2/爱与演唱会 虹咲学园学园偶像同好会 第二季][83.37 GB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "Love Live Nijigasaki Gakuen School Idol Doukoukai",
      year: 2022,
      mediaType: "TV_SERIES",
      season: 2,
      source: "BluRay",
      codec: "H.265",
      audio: "FLAC"
    });
    expect(release.titleCandidates).not.toEqual(expect.arrayContaining([
      "Animations Love Live Nijigasaki Gakuen School Idol Doukoukai",
      "动漫 Animations Love Live Nijigasaki Gakuen School Idol Doukoukai"
    ]));
    expect(release.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining([
      "动漫 Animations Love Live Nijigasaki Gakuen School Idol Doukoukai"
    ]));
  });

  it("prefers PTP bracketed release filenames over human metadata", () => {
    const release = parseReleaseTitle(
      "Moolyam [2026] by PV Avinash Varma - H.264 / WEB / MKV / 2160p [ Moolyam.2160p.ETVWIN.WEB-DL.Telugu.AAC.2.0.H264-CloudMovieZ ]"
    );

    expect(release).toMatchObject({
      title: "Moolyam",
      year: 2026,
      mediaType: "MOVIE",
      quality: "2160p",
      source: "WEB-DL",
      codec: "H.264",
      audio: "AAC.2.0",
      releaseGroup: "CloudMovieZ"
    });
  });

  it("uses the PTP display title when the filename only extends it", () => {
    const release = parseReleaseTitle(
      "Free to Go [2015] by John Koster and Marie Elisa Scheidt - x264 / WEB / MKV / 1080p [ Free.to.go.Mit.leichtem.Gepack.2016.GERMAN.1080p.WEB-DL.AAC2.0.H.264-aurez29 ]"
    );

    expect(release).toMatchObject({
      title: "Free to Go",
      year: 2015,
      mediaType: "MOVIE",
      quality: "1080p",
      source: "WEB-DL",
      codec: "H.264",
      audio: "AAC2.0",
      releaseGroup: "aurez29"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["Free to go Mit leichtem Gepack"]));
  });

  it("keeps PTP display titles when title words look like source tokens", () => {
    const release = parseReleaseTitle(
      "Fungi: The Web of Life [2023] by Gisela Kaufmann and Joseph Nizeti - x264 / DVD / MKV / Other [ Fungi.The.Web.Of.Life.2023.DVDRip.h264 ]"
    );

    expect(release).toMatchObject({
      title: "Fungi: The Web of Life",
      year: 2023,
      mediaType: "MOVIE",
      source: "DVD",
      codec: "H.264"
    });
    expect(release.titleCandidates).toEqual(expect.arrayContaining(["Fungi: The"]));
  });

  it("uses the PTP display year when the scene filename year conflicts", () => {
    const release = parseReleaseTitle(
      "Massacre pour une orgie AKA Massacre of Pleasure [1966] by Jean-Pierre Bastid - x264 / Blu-ray / MKV / 1080p [ Massacre.pour.une.orgie.1996.1080p.BluRay.x264-PTP ]"
    );

    expect(release).toMatchObject({
      title: "Massacre pour une orgie",
      year: 1966,
      mediaType: "MOVIE",
      quality: "1080p",
      source: "BluRay",
      codec: "H.264",
      releaseGroup: "PTP"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["Massacre of Pleasure"]));
  });

  it("keeps explicit one-word AKA aliases as provider search titles", () => {
    const release = parseReleaseTitle(
      "Main basse sur la TV AKA Network 1976 1080p FRA Blu-ray AVC DTS-HD MA 1.0[电视台风云 / 荧光屏后(台) / 萤光幕后 / 传媒｜类型：剧情 [法版原盘]][27.58 GB]"
    );

    expect(release).toMatchObject({
      title: "Main basse sur la TV",
      year: 1976,
      mediaType: "MOVIE",
      quality: "1080p",
      source: "BluRay",
      codec: "H.264",
      audio: "DTS-HD"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["Network"]));
  });

  it("uses the PTP display year for exact one-year title-alias matches", () => {
    const release = parseReleaseTitle(
      "Soy Frankelda AKA I Am Frankelda [2025] by Arturo Ambriz and Roy Ambriz - H.265 / WEB / MKV / 2160p / Dual Audio / Dolby Vision [ I.Am.Frankelda.2026.2160p.NF.WEB-DL.DDP5.1.DV.H.265-CHORTLE ]"
    );

    expect(release).toMatchObject({
      title: "I Am Frankelda",
      year: 2025,
      mediaType: "MOVIE",
      quality: "2160p",
      source: "WEB-DL",
      codec: "H.265",
      audio: "DDP5.1",
      releaseGroup: "CHORTLE"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["Soy Frankelda"]));
  });

  it("uses the PTP display year when the release filename title is not a display alias", () => {
    const release = parseReleaseTitle(
      "A la cara AKA Nothing Personal [2025] by Javier Marco - H.265 / WEB / MKV / 2160p / Dolby Atmos / Dolby Vision / HDR10+ [ Pressure.2026.REPACK.2160p.iT.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-WarRunsOnWeather ]"
    );

    expect(release).toMatchObject({
      title: "Pressure",
      year: 2025,
      mediaType: "MOVIE",
      quality: "2160p",
      source: "WEB-DL",
      codec: "H.265",
      audio: "DDP5.1"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining([
      "A la cara",
      "Nothing Personal"
    ]));
  });

  it("keeps one-year transliteration drift on the PTP filename year", () => {
    const release = parseReleaseTitle(
      "Moya sobaka kosmonavt AKA My Space Dog [2026] by Mikhail Morskov - x264 / WEB / MKV / 1080p [ Moia.sobaka.kosmonavt.2025.RUSSiAN.1080p.WEB.x264-Altansar ]"
    );

    expect(release).toMatchObject({
      title: "Moia sobaka kosmonavt",
      year: 2025,
      mediaType: "MOVIE",
      quality: "1080p",
      source: "WEB",
      codec: "H.264",
      releaseGroup: "Altansar"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining([
      "Moya sobaka kosmonavt",
      "My Space Dog"
    ]));
  });

  it("keeps the PTP filename year when the display title is unrelated", () => {
    const release = parseReleaseTitle(
      "Syriana [2005] by Stephen Gaghan - x264 / WEB / MKV / 1080p [ Another.Life.2019.1080p.WEB-DL.AAC2.0.H.264-aurez29 ]"
    );

    expect(release).toMatchObject({
      title: "Another Life",
      year: 2019,
      mediaType: "MOVIE",
      quality: "1080p",
      source: "WEB-DL",
      codec: "H.264",
      audio: "AAC2.0",
      releaseGroup: "aurez29"
    });
  });

  it("does not use PTP bundle collection years as individual movie years", () => {
    const release = parseReleaseTitle(
      "The Lustful Turk (1968) / The Joys of Jezebel (1970) [2026] by Byron Mabe and Peter Perry Jr. - BD50 / Blu-ray / m2ts / 1080p / 4K Restoration [ The Lustful Turk (1968) & The Joys of Jezebel (1970) 1080p USA Blu-ray AVC DTS-HD MA 2.0 ]"
    );

    expect(release).toMatchObject({
      title: "The Lustful Turk",
      year: 1968,
      mediaType: "MOVIE",
      quality: "1080p",
      source: "BluRay"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining([
      "The Lustful Turk 1968",
      "The Joys of Jezebel 1970"
    ]));
  });

  it("uses the PTP display year when a year-like token is part of the title", () => {
    const release = parseReleaseTitle(
      "Gojira ni-sen mireniamu AKA Godzilla 2000: Millennium [1999] by Takao Okawara - x264 / Blu-ray / MKV / 1080p / Japanese Version [ Godzilla.2000.Millennium.1999.Japanese.Version.1080p.BluRay.FLAC2.0.x264-iNDORAPTOR ]"
    );

    expect(release).toMatchObject({
      title: "Godzilla",
      year: 1999,
      mediaType: "MOVIE",
      quality: "1080p",
      source: "BluRay",
      codec: "H.264",
      releaseGroup: "iNDORAPTOR"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining([
      "Gojira ni-sen mireniamu",
      "Godzilla 2000: Millennium"
    ]));
  });

  it("uses the later release year when an AKA title contains a year-like title token", () => {
    const godzilla = parseReleaseTitle(
      "Godzilla 2000: Millennium AKA Gojira ni-sen mireniamu 1999 1080p BluRay FLAC 2.0 x264-iNDORAPTOR"
    );
    const yearTitle = parseReleaseTitle(
      "1987: When the Day Comes AKA 1987 2017 1080p ATV WEB-DL AAC 2.0 H.264-DUSKLiGHT"
    );

    expect(godzilla).toMatchObject({
      title: "Godzilla 2000: Millennium",
      year: 1999,
      mediaType: "MOVIE",
      quality: "1080p",
      source: "BluRay",
      codec: "H.264",
      releaseGroup: "iNDORAPTOR"
    });
    expect(godzilla.providerSearchTitles).toEqual(expect.arrayContaining([
      "Gojira ni sen mireniamu"
    ]));
    expect(yearTitle).toMatchObject({
      title: "1987: When the Day Comes",
      year: 2017,
      mediaType: "MOVIE",
      quality: "1080p",
      source: "WEB-DL",
      codec: "H.264",
      releaseGroup: "DUSKLiGHT"
    });
  });

  it("keeps future year-like title tokens before TV season markers", () => {
    const firstSeason = parseReleaseTitle(
      "[Anime 1080p]Ghost in the Shell SAC_2045 S01 2020 Complete 1080p Netflix WEB-DL AVC DDP 5.1 Atmos-DBTV[攻壳机动队：SAC_2045 第 1 季 / 攻殻機動隊 SAC_2045 / Ghost in the Shell: SAC_2045 全 12 集 (2020)][11.81 GB][anonymous]"
    );
    const secondSeason = parseReleaseTitle(
      "[Animations]Ghost in the Shell SAC_2045 S02 2022 Complete 1080p Netflix WEB-DL AVC DDP 5.1 Atmos-DBTV[攻壳机动队：SAC_2045 第 2 季 / 攻殻機動隊 SAC_2045 / Ghost in the Shell: SAC_2045 全 12 集 (2022)][11.99 GB][anonymous]"
    );

    expect(firstSeason).toMatchObject({
      title: "Ghost in the Shell SAC 2045",
      year: 2020,
      mediaType: "TV_SERIES",
      season: 1,
      quality: "1080p",
      source: "WEB-DL"
    });
    expect(secondSeason).toMatchObject({
      title: "Ghost in the Shell SAC 2045",
      year: 2022,
      mediaType: "TV_SERIES",
      season: 2,
      quality: "1080p",
      source: "WEB-DL"
    });
  });

  it("keeps ordinary first-air years before TV episode markers", () => {
    const release = parseReleaseTitle(
      "Doctor Who 2005 S01E02 2026 1080p WEB-DL H.264-GRP"
    );

    expect(release).toMatchObject({
      title: "Doctor Who",
      year: 2005,
      mediaType: "TV_SERIES",
      season: 1,
      episode: 2,
      quality: "1080p",
      source: "WEB-DL",
      codec: "H.264",
      releaseGroup: "GRP"
    });
  });

  it("keeps a one-word TV title year when metadata aliases include that year", () => {
    const release = parseReleaseTitle(
      "[电视剧 (TV Series)]Reply 1988 S01 2015 1080p NF WEB-DL x264 AAC 2.0-CMCTV[请回答1988 / Reply 1988 / 回应吧1988 | 全20集 | 成东日 / 李一花 / 罗美兰 [韩语] [简繁英字幕]][61.87 GB][anonymous][Free]"
    );

    expect(release).toMatchObject({
      title: "Reply 1988",
      year: 2015,
      mediaType: "TV_SERIES",
      season: 1,
      quality: "1080p",
      source: "WEB-DL",
      codec: "H.264",
      audio: "AAC.2.0",
      releaseGroup: "CMCTV"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining([
      "回应吧1988"
    ]));
  });

  it("uses the later release year for a one-word TV title-year alias without an explicit season token", () => {
    const release = parseReleaseTitle(
      "[电视剧 (TV Series)]Reply 1988 2015 1080p WEB-DL H265 AAC-PTerWEB[请回答1988 | 全20集 | 导演: 申源浩 | 主演: 成东日 李一花 罗美兰 金成钧 崔武成 [韩语中字]][60.20 GB][anonymous][Free]"
    );

    expect(release).toMatchObject({
      title: "Reply 1988",
      year: 2015,
      mediaType: "TV_SERIES",
      quality: "1080p",
      source: "WEB-DL",
      codec: "H.265",
      audio: "AAC",
      releaseGroup: "PTerWEB"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["请回答1988"]));
  });

  it("does not treat multi-word TV first-air years as title-year aliases", () => {
    const release = parseReleaseTitle(
      "Doctor Who 2005 S01 2026 Complete 1080p WEB-DL H.264-GRP[Doctor Who 2005 全13集]"
    );

    expect(release).toMatchObject({
      title: "Doctor Who",
      year: 2005,
      mediaType: "TV_SERIES",
      season: 1,
      quality: "1080p",
      source: "WEB-DL",
      codec: "H.264",
      releaseGroup: "GRP"
    });
  });

  it("keeps Limited when it is part of a TV title phrase", () => {
    const release = parseReleaseTitle(
      "[综艺]Unplanned Trip Limited Edition S01 2026 1080p WEB-DL AAC H.264-JKCT[韩综|花样青春:限量版/Friends Over Flowers:limited edition][10.05 GB]"
    );

    expect(release).toMatchObject({
      title: "Unplanned Trip Limited Edition",
      year: 2026,
      mediaType: "TV_SERIES",
      season: 1,
      quality: "1080p",
      source: "WEB-DL",
      releaseGroup: "JKCT"
    });
  });

  it("keeps Limited when it is part of a movie title phrase", () => {
    const release = parseReleaseTitle(
      "Milky Subway The Galactic Limited Express 2026 1080p NF WEB-DL H264 DDP5.1-UBWEB"
    );

    expect(release).toMatchObject({
      title: "Milky Subway The Galactic Limited Express",
      year: 2026,
      mediaType: "MOVIE",
      quality: "1080p",
      source: "WEB-DL",
      releaseGroup: "UBWEB"
    });
  });

  it("still removes trailing Limited release flags", () => {
    const release = parseReleaseTitle("Example Movie LIMITED 1080p WEB-DL H264-GRP");

    expect(release).toMatchObject({
      title: "Example Movie",
      mediaType: "UNKNOWN",
      quality: "1080p",
      source: "WEB-DL",
      releaseGroup: "GRP"
    });
  });

  it("does not keep Limited from deluxe edition labels", () => {
    const release = parseReleaseTitle(
      "In this Corner of the World (Deluxe Limited Edition) 2016 1080p Blu-ray AVC TrueHD 5.1-GRP"
    );

    expect(release).toMatchObject({
      title: "In this Corner of the World Deluxe Edition",
      year: 2016,
      mediaType: "MOVIE",
      quality: "1080p",
      source: "BluRay",
      releaseGroup: "GRP"
    });
  });

  it("keeps slash-delimited numeric movie titles intact", () => {
    const release = parseReleaseTitle("11/11/11 2011 UNCUT 1080p GER Blu-ray AVC DTS-HD MA 5.1-MAMA");

    expect(release).toMatchObject({
      title: "11/11/11",
      year: 2011,
      mediaType: "MOVIE",
      quality: "1080p",
      source: "BluRay",
      audio: "DTS-HD",
      releaseGroup: "MAMA"
    });
    expect(release.titleCandidates).toEqual(expect.arrayContaining(["11/11/11"]));
  });

  it("keeps repeated slash-delimited numeric horror titles intact", () => {
    const release = parseReleaseTitle("13/13/13 2013 UNCUT 1080p GER Blu-ray AVC DTS-HD MA 5.1-MAMA");

    expect(release).toMatchObject({
      title: "13/13/13",
      year: 2013,
      mediaType: "MOVIE"
    });
    expect(release.titleCandidates).toEqual(expect.arrayContaining(["13/13/13"]));
  });

  it("parses numeric-only movie titles before their release year", () => {
    const release = parseReleaseTitle(
      "[Movies]2046 2004 UHD BluRay 2160p x265 DV HDR DTS-HD MA 5.1 mUHD-FRDS[2046][20.28 GB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "2046",
      year: 2004,
      mediaType: "MOVIE",
      quality: "2160p",
      source: "UHD",
      codec: "H.265",
      audio: "DTS-HD",
      releaseGroup: "FRDS"
    });
  });

  it("keeps numeric-only titles distinct from the following release year", () => {
    const release = parseReleaseTitle(
      "[电影(Movie)]2012 2009 UHD BluRay 2160p REMUX HDR HEVC TrueHD Atmos 7.1-UBits[2012世界末日][60.64 GB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "2012",
      year: 2009,
      mediaType: "MOVIE",
      quality: "2160p",
      source: "UHD",
      codec: "H.265",
      audio: "TrueHD",
      releaseGroup: "UBits"
    });
  });

  it("keeps leading year-like title tokens before the real release year", () => {
    const release = parseReleaseTitle(
      "[Movie/Blu-Ray]2001 A Space Odyssey 1968 1080p BluRay AVC DTS-HD MA 5.1-HDBEE[2001太空漫游 |类型: 科幻 / 惊悚 / 冒险|主演: 凯尔·杜拉 / 加里·洛克伍德][42.83 GB][N/A]"
    );

    expect(release).toMatchObject({
      title: "2001 A Space Odyssey",
      year: 1968,
      mediaType: "MOVIE",
      quality: "1080p",
      source: "BluRay",
      codec: "H.264",
      audio: "DTS-HD",
      releaseGroup: "HDBEE"
    });
    expect(release.titleCandidates).toEqual(expect.arrayContaining(["2001 A Space Odyssey"]));
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["太空漫游"]));
  });

  it("parses year-like title prefixes with words as title, not release year", () => {
    const release = parseReleaseTitle("2001 Maniacs 2005 1080p WEB-DL H264-GROUP");

    expect(release).toMatchObject({
      title: "2001 Maniacs",
      year: 2005,
      mediaType: "MOVIE",
      quality: "1080p",
      source: "WEB-DL",
      codec: "H.264",
      releaseGroup: "GROUP"
    });
  });

  it("does not collapse repeated event date years into leading-year titles", () => {
    const release = parseReleaseTitle("2026 FIFA World Cup 2026-06-17 1080p ITV WEB-DL AAC 2.0 H.264-FFG");

    expect(release).toMatchObject({
      title: "2026 FIFA World Cup 2026 06 17 1080p ITV WEB DL AAC 2 0 H 264 FFG",
      year: 2026,
      mediaType: "MOVIE"
    });
  });

  it("keeps title-embedded years for nonnumeric movie titles", () => {
    const release = parseReleaseTitle("Fear Street 1666 2021 1080p WEB-DL H264-HHWEB");

    expect(release).toMatchObject({
      title: "Fear Street 1666",
      year: 2021,
      mediaType: "MOVIE"
    });
  });

  it("does not treat sports season ranges as numeric movie titles", () => {
    const release = parseReleaseTitle(
      "[Sports]2025-2026 Sichuan Provincial Urban Football League (Dazhou-Nanchong) 20260614 HDTV 1080i AAC H.264-TPTV[20252026四川省城市足球联赛(达州-南充)][9.03 GB][N/A]"
    );

    expect(release.title).toContain("Sichuan Provincial Urban Football League");
    expect(release.title).not.toBe("2025");
    expect(release.year).toBe(2025);
    expect(release.mediaType).toBe("UNKNOWN");
  });

  it("prefers bracketed scene filenames even when quality is only in PTP metadata", () => {
    const release = parseReleaseTitle(
      "Mr. K [2024] by Tallulah Hazekamp Schwab - BD50 / Blu-ray / m2ts / 1080p / Scene [ Mr.K.2024.COMPLETE.BLURAY-UNTOUCHED ]"
    );

    expect(release).toMatchObject({
      title: "Mr. K",
      year: 2024,
      mediaType: "MOVIE",
      quality: "1080p",
      source: "BluRay",
      releaseGroup: "UNTOUCHED"
    });
    expect(release.titleCandidates).toEqual(expect.arrayContaining(["Mr. K", "Mr K"]));
  });

  it("fills missing years from strict metadata segments only after release parsing", () => {
    const release = parseReleaseTitle(
      "[剧集]Taskmaster Australia S05E06 1080p TEN WEB-DL AAC 2.0 H.264-RAWR[Taskmaster Australia [第五季 第06集] | 2026][1.98 GB][anonymous][]"
    );

    expect(release).toMatchObject({
      title: "Taskmaster Australia",
      year: 2026,
      mediaType: "TV_SERIES",
      season: 5,
      episode: 6,
      quality: "1080p",
      source: "WEB-DL",
      codec: "H.264",
      audio: "AAC.2.0",
      releaseGroup: "RAWR"
    });
  });

  it("does not infer metadata years from embedded date-like numbers", () => {
    const release = parseReleaseTitle(
      "[TV Series]Jade How Dare You Ep22 20260609 HDTV 1080i H264 2Audio-CHDHKTV[陸劇:成何体统(第22集)][3.07 GB][anonymous]"
    );

    expect(release.year).toBeUndefined();
    expect(release).toMatchObject({
      title: "How Dare You",
      mediaType: "TV_SERIES",
      season: 1,
      episode: 22,
      quality: "1080i",
      source: "HDTV",
      codec: "H.264",
      releaseGroup: "CHDHKTV"
    });
  });

  it("does not infer future metadata years", () => {
    const release = parseReleaseTitle(
      "[剧集]Future Show S01E01 1080p WEB-DL H264-GRP[Future Show [第一季 第01集] | 2099][1.00 GB]"
    );

    expect(release.year).toBeUndefined();
    expect(release).toMatchObject({
      title: "Future Show",
      mediaType: "TV_SERIES",
      season: 1,
      episode: 1
    });
  });

  it("parses SSD-style nested bracket release filenames", () => {
    const release = parseReleaseTitle(
      "[ WIND.BREAKER.S01.1080p.BluRay.x265.OPUS.2.0-7³ACG[WIND BREAKER—防风少年— | 14-25 日语+简繁字幕][11.43 GB] ]]"
    );

    expect(release).toMatchObject({
      title: "WIND BREAKER",
      mediaType: "TV_SERIES",
      season: 1,
      quality: "1080p",
      source: "BluRay",
      codec: "H.265",
      audio: "OPUS.2.0",
      releaseGroup: "7³ACG"
    });
  });

  it("prefers the Latin title from native plus Latin release names", () => {
    const release = parseReleaseTitle("IT狂人.The.IT.Crowd.S03.2008.1080p.WEB-DL.AAC.H264-HDSWEB");

    expect(release).toMatchObject({
      title: "The IT Crowd",
      year: 2008,
      mediaType: "TV_SERIES",
      season: 3
    });
    expect(release.titleCandidates).toEqual(expect.arrayContaining(["IT狂人", "The IT Crowd"]));
    expect(release.primarySearchTitle).toBe("IT狂人");
  });

  it("uses AKA aliases as title candidates while keeping the first Latin title", () => {
    const release = parseReleaseTitle("Lao.hu.li.AKA.Old.Fox.2023.1080p.TWN.Blu-ray.AVC.DTS-HD.MA.7.1-CMCT");

    expect(release).toMatchObject({
      title: "Lao hu li",
      year: 2023,
      mediaType: "MOVIE"
    });
    expect(release.titleCandidates).toEqual(expect.arrayContaining(["Lao hu li", "Old Fox"]));
  });

  it("keeps native and multiple Latin aliases from mixed AKA names", () => {
    const release = parseReleaseTitle("步履不停.Aruitemo.Aruitemo.AKA.Still.Walking.2008.1080p.Blu-ray.AVC.LPCM.2.0-bbba@HDSky");

    expect(release).toMatchObject({
      title: "Still Walking",
      year: 2008,
      mediaType: "MOVIE"
    });
    expect(release.titleCandidates).toEqual(expect.arrayContaining([
      "步履不停",
      "Aruitemo Aruitemo",
      "Still Walking"
    ]));
    expect(release.primarySearchTitle).toBe("步履不停");
  });

  it("uses bracketed native titles as search candidates while keeping Latin canonical title", () => {
    const release = parseReleaseTitle("[星辰变 第七季].Stellar.Transformation.2026.S07.Complete.2160p.WEB-DL.H265.AAC-UBWEB");

    expect(release).toMatchObject({
      title: "Stellar Transformation",
      year: 2026,
      mediaType: "TV_SERIES",
      season: 7
    });
    expect(release.titleCandidates).toEqual(expect.arrayContaining(["星辰变", "Stellar Transformation"]));
    expect(release.primarySearchTitle).toBe("星辰变");
  });

  it("parses Chinese season text when Sxx is absent", () => {
    const release = parseReleaseTitle("踢馆秘笈（第六季）—测试样片.1080p.WEB-DL.H264-GRP");

    expect(release).toMatchObject({
      title: "踢馆秘笈",
      mediaType: "TV_SERIES",
      season: 6,
      quality: "1080p"
    });
  });

  it("does not treat movie collection part metadata as a TV season", () => {
    const release = parseReleaseTitle(
      "[电影(Movie)]Basic Instinct 2 2006 1080p BluRay x265 10bit DDP 5.1 2Audios MNHD-FRDS[【本能2/Basic Instinct 2: Risk Addiction/本能2:致命诱惑/第六感追緝令2(台)】 10bit HEVC版本 情色系列第10部 英语 评论音轨 双语字幕][7.68 GB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "Basic Instinct 2",
      year: 2006,
      mediaType: "MOVIE",
      season: undefined,
      quality: "1080p",
      source: "BluRay",
      releaseGroup: "FRDS"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["本能2"]));
  });

  it("does not treat uncategorized movie collection part metadata as a TV season", () => {
    const release = parseReleaseTitle(
      "Nûdo no yoru Ai wa oshiminaku ubau AKA A Night in Nude Salvation 2010 1080p BluRay x265 10bit FLAC 2.0 MNHD-FRDS[【裸体之夜：掠夺狂爱/ヌードの夜 愛は惜しみなく奪う/裸夜】10bit HEVC版本 情色系列第234部 日语 简繁字幕][10.81 GB]"
    );

    expect(release).toMatchObject({
      title: "Nûdo no yoru Ai wa oshiminaku ubau",
      year: 2010,
      mediaType: "MOVIE",
      season: undefined,
      quality: "1080p",
      source: "BluRay",
      releaseGroup: "FRDS"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining([
      "裸体之夜：掠夺狂爱",
      "A Night in Nude Salvation"
    ]));
  });

  it("does not let movie collection part metadata override a documentary category", () => {
    const release = parseReleaseTitle(
      "[纪录片(Documentaries)]Oniroku Dan: Best of SM 1984 BluRay 1080p x265 10bit FLAC 2.0 MNHD-FRDS[【团鬼六绳妆馆/団鬼六監修 SM大全集/SM daizenshû】10bit HEVC版本 情色系列第35部 日语 简繁日双语字幕][3.85 GB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "Oniroku Dan: Best of SM",
      year: 1984,
      mediaType: "MOVIE",
      season: undefined,
      quality: "1080p",
      source: "BluRay",
      releaseGroup: "FRDS"
    });
  });

  it("uses strong TV categories with all-episode metadata as series evidence", () => {
    const release = parseReleaseTitle(
      "[TV Series/HD]Da Ming Feng Hua 2019 2160p 60FPS WEB-DL H265 10bit AAC-ADORE[大明风华 大明皇妃孙若微传 大明皇妃孙若微传 大明皇妃 六朝纪事 全62集 | 类型:古装 主演: 汤唯 / 朱亚文 / 邓家佳 / 乔振宇 / 王学圻 / 张艺兴][145.4 GB][N/A]"
    );

    expect(release).toMatchObject({
      title: "Da Ming Feng Hua",
      year: 2019,
      mediaType: "TV_SERIES",
      season: undefined,
      episode: undefined,
      quality: "2160p",
      source: "WEB-DL",
      codec: "H.265",
      audio: "AAC",
      releaseGroup: "ADORE"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining([
      "大明风华 大明皇妃孙若微传 大明皇妃孙若微传 大明皇妃 六朝纪事"
    ]));
  });

  it("uses documentary categories with all-episode metadata as series evidence", () => {
    const release = parseReleaseTitle(
      "[Documentaries]Kontant 2025 1080p DRTV WEB-DL AAC 2.0 x264-FFG[Kontant 全16集][25.00 GB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "Kontant",
      year: 2025,
      mediaType: "TV_SERIES",
      season: undefined,
      episode: undefined,
      quality: "1080p",
      source: "WEB-DL",
      codec: "H.264",
      audio: "AAC.2.0",
      releaseGroup: "FFG"
    });
  });

  it("uses short documentary categories with all-episode metadata as series evidence", () => {
    const release = parseReleaseTitle(
      "[Doc 1080p]CCTV9 Crunch And Munch In Macao 2021 Complete 1080i HDTV H264-HDHTV[澳门之味 全4集 澳门制造/好食不过澳门街/餐桌的年轮/恋曲1999 [汉语普通话/简体中字]][9.93 GB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "Crunch And Munch In Macao",
      year: 2021,
      mediaType: "TV_SERIES",
      season: undefined,
      episode: undefined,
      quality: "1080i",
      source: "HDTV",
      codec: "H.264",
      releaseGroup: "HDHTV"
    });
  });

  it("uses uncategorized all-episode metadata as series evidence", () => {
    const mytvRelease = parseReleaseTitle(
      "How Dare You 2026 Complete 1080p MyTVSuper WEB-DL H.265 AAC 2Audio-HDHWEB[成何体统 | 全25集 | 粤语/普通话 | SRT简繁字幕 | MytvSuper][31.22 GB]"
    );
    const documentaryRelease = parseReleaseTitle(
      "Kontant 2025 1080p DRTV WEB-DL AAC 2.0 x264-FFG[Kontant 全16集][25.00 GB]"
    );

    expect(mytvRelease).toMatchObject({
      title: "How Dare You",
      year: 2026,
      mediaType: "TV_SERIES",
      season: undefined,
      episode: undefined,
      quality: "1080p",
      source: "WEB-DL",
      codec: "H.265",
      releaseGroup: "HDHWEB"
    });
    expect(mytvRelease.providerSearchTitles).toEqual(["成何体统"]);
    expect(documentaryRelease).toMatchObject({
      title: "Kontant",
      year: 2025,
      mediaType: "TV_SERIES",
      quality: "1080p",
      source: "WEB-DL"
    });
  });

  it("uses stacked TV drama category brackets as series evidence", () => {
    const mainlandRelease = parseReleaseTitle(
      "[剧集][大陆][太极宗师之太极门][Taichi.Heros.2017.WEB-DL.2160p.H265.AAC-PTerWEB][[剧情 / 武侠]][45.75 GiB][anonymous]"
    );
    const japaneseRelease = parseReleaseTitle(
      "[剧集][日剧][真假学园2][Majisuka Gakuen 2 2011 DVDRip 720p x264 AAC2.0][6.01 GiB][]"
    );

    expect(mainlandRelease).toMatchObject({
      title: "Taichi Heros",
      year: 2017,
      mediaType: "TV_SERIES",
      season: undefined,
      episode: undefined,
      quality: "2160p",
      source: "WEB-DL"
    });
    expect(mainlandRelease.providerSearchTitles).toEqual(expect.arrayContaining(["太极宗师之太极门"]));
    expect(japaneseRelease).toMatchObject({
      title: "Majisuka Gakuen 2",
      year: 2011,
      mediaType: "TV_SERIES",
      season: undefined,
      episode: undefined,
      quality: "720p",
      source: "DVDRip"
    });
    expect(japaneseRelease.providerSearchTitles).toEqual(expect.arrayContaining(["真假学园2"]));
  });

  it("does not promote explicit movie or audiobook categories with all-episode metadata", () => {
    const movieRelease = parseReleaseTitle(
      "[电影]Example Movie 2026 1080p WEB-DL H264-GRP[示例电影 | 全3集 | 类型: 剧情][1.00 GB]"
    );
    const audiobookRelease = parseReleaseTitle(
      "[有声书]Harry Potter 2022 WEB-DL PCM-ZARD[哈利·波特 1-7部全集 |演播：光合积木 | 作者：J.K.罗琳 | 全668集 | 2117kbps | [国语/驻站]][127.33 GB][anonymous]"
    );

    expect(movieRelease.mediaType).toBe("MOVIE");
    expect(audiobookRelease.mediaType).not.toBe("TV_SERIES");
  });

  it("does not treat a TV category alone as whole-series evidence", () => {
    const release = parseReleaseTitle(
      "[TV Series/HD]BBC News 2026 06 11 HDTV 1080p WEBRip H264 AAC-D0[BBC News 新闻片段 2026.06.11 英语听力口语 / 雅思托福练习 / 时政素材 / 自录][1.39 GB][N/A]"
    );

    expect(release.mediaType).toBe("MOVIE");
  });

  it("keeps one-episode documentary specials out of the whole-series rule", () => {
    const release = parseReleaseTitle(
      "[纪录片]Example Documentary Special 2026 1080p WEB-DL H264-GRP[示例纪录片特别篇 | 全1集 | 类型: 纪录片][1.00 GB]"
    );

    expect(release.mediaType).toBe("MOVIE");
  });

  it("does not treat complete concert titles as documentary series evidence", () => {
    const release = parseReleaseTitle(
      "[Documentaries]Billy Joel The 100th Live at Madison Square Garden The Complete Concert 2024 Blu-ray 1080p AVC DTS-HD MA 5.1[比利·乔尔—第100场麦迪逊广场花园现场][44.55 GB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "Billy Joel The 100th Live at Madison Square Garden The Complete Concert",
      year: 2024,
      mediaType: "MOVIE",
      quality: "1080p",
      source: "BluRay",
      codec: "H.264",
      audio: "DTS-HD"
    });
  });

  it("keeps one-episode TV-category specials out of the whole-series rule", () => {
    const release = parseReleaseTitle(
      "[电视剧]Sherlock The Abominable Bride 2016 1080p MYVIDEO WEB-DL AAC2 0 H264-HHWEB[神探夏洛克：可恶的新娘 / 神探夏洛克：2016新年特别篇 | 全1集 | 1080p | 类型: 剧情/悬疑/犯罪][2.93 GB][anonymous]"
    );

    expect(release.mediaType).toBe("MOVIE");
  });

  it("uses explicit animation TV segments as series evidence", () => {
    const release = parseReleaseTitle(
      "[动漫][TV][7³ACG][青春猪头少年不会梦到圣诞服女郎][Seishun Buta Yarou wa Santa Claus no Yume wo Minai][01-13 Fin][1080p][BDRip][MKV][2025.07][日漫][2025年7月新番 | 青春猪头少年不会梦到圣诞服女郎 | 全13集 | AV1-10bit 2.0ch Opus | 简繁内封字幕][3.25 GiB][jys210]"
    );

    expect(release).toMatchObject({
      mediaType: "TV_SERIES",
      year: 2025,
      quality: "1080p",
      source: "BDRip"
    });
    expect(release.primarySearchTitle).toBe("青春猪头少年不会梦到圣诞服女郎");
  });

  it("uses animation multi-episode metadata as series evidence", () => {
    const release = parseReleaseTitle(
      "[动画 (Animation)]Fullmetal Alchemist Brotherhood 2009 Blu-ray USA 1080p AVC LPCM 2.0-Malos@U2[钢之炼金术师FA [美版 全64集]][505.09 GB][anonymous][Free]"
    );

    expect(release).toMatchObject({
      title: "Fullmetal Alchemist Brotherhood",
      mediaType: "TV_SERIES",
      year: 2009,
      quality: "1080p",
      source: "BluRay"
    });
    expect(release.primarySearchTitle).toBe("钢之炼金术师FA");
  });

  it("extracts anime title aliases from metadata fields with season headings", () => {
    const release = parseReleaseTitle(
      "[动漫]Tsue to Tsurugi no Wistoria S02 2026 2160p IQ WEB-DL H.265 AAC2.0-UBWEB[2026年4月新番 | 杖与剑的魔剑谭 第二季/Wistoria: Wand and Sword Season 2 | 全22集 [日语/多语字幕 | 4K版][10.59 GB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "Tsue to Tsurugi no Wistoria",
      year: 2026,
      mediaType: "TV_SERIES",
      season: 2
    });
    expect(release.titleCandidates).toEqual(expect.arrayContaining([
      "杖与剑的魔剑谭",
      "Wistoria: Wand and Sword Season 2"
    ]));
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining([
      "杖与剑的魔剑谭",
      "Wistoria: Wand and Sword Season 2"
    ]));
    expect(release.titleCandidates).not.toEqual(expect.arrayContaining(["版"]));
    expect(release.providerSearchTitles).not.toEqual(expect.arrayContaining(["版"]));
    expect(release.primarySearchTitle).toBe("杖与剑的魔剑谭");
  });

  it("does not use quality-version labels as title aliases", () => {
    const release = parseReleaseTitle(
      "[动漫]Example Show S01 2160p WEB-DL H265-GRP[日语/多语字幕 | 4K版] *菁彩HDR*[1.00 GB]"
    );

    expect(release.title).toBe("Example Show");
    expect(release.titleCandidates).not.toEqual(expect.arrayContaining(["版"]));
    expect(release.titleCandidates).not.toEqual(expect.arrayContaining(["*菁彩HDR*"]));
    expect(release.providerSearchTitles).toBeUndefined();
  });

  it("extracts anime title aliases after new-season headings without pipe delimiters", () => {
    const release = parseReleaseTitle(
      "[Animations]Wistoria Wand and Sword S02 1080p CR WEB-DL AAC2 0 H.264-CHDWEB[2026年4月新番 杖与剑的魔剑谭 第二季 第8-9集 /杖と剣のウィストリア Season 2 | 类型:动画/奇幻 | 主演:天崎滉平/关根明良][2.72 GB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "Wistoria Wand and Sword",
      mediaType: "TV_SERIES",
      season: 2,
      episode: 8,
      episodeEnd: 9
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["杖与剑的魔剑谭"]));
    expect(release.primarySearchTitle).toBe("杖与剑的魔剑谭");
  });

  it("extracts anime title aliases when the new-season marker is at the end of metadata", () => {
    const release = parseReleaseTitle(
      "[剧集]Tsue to Tsurugi no Wistoria S02E10 2026 1080p LINETV WEB-DL H264 AAC-ADWeb[杖与剑的魔剑谭 杖與劍的魔劍譚Season2 杖と剣のウィストリア 第02季 第10集 | 类型: 动画 / 奇幻 主演: 天崎滉平 / 关根明良 2026年4月新番][552.68 MB][anonymous][中字 | 动画 | 官方]"
    );

    expect(release).toMatchObject({
      title: "Tsue to Tsurugi no Wistoria",
      year: 2026,
      mediaType: "TV_SERIES",
      season: 2,
      episode: 10
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining([
      "杖与剑的魔剑谭",
      "杖與劍的魔劍譚",
      "杖と剣のウィストリア"
    ]));
    expect(release.primarySearchTitle).toBe("杖与剑的魔剑谭");
  });

  it("does not use anime season arc labels as title aliases", () => {
    const release = parseReleaseTitle(
      "[剧集]Classroom of the Elite S04E14 2026 1080p LINETV WEB-DL H264 AAC-ADWeb[欢迎来到实力至上主义教室 歡迎來到實力至上主義的教室 第四季 2年級篇 第一學期 ようこそ実力至上主義の教室へ 4th Season 第04季 第14集 | 类型: 动画 主演: 千叶翔也 2026年4月新番][550.69 MB][anonymous][中字 | 动画 | 官方]"
    );

    expect(release.providerSearchTitles).toEqual(expect.arrayContaining([
      "欢迎来到实力至上主义教室",
      "歡迎來到實力至上主義的教室",
      "ようこそ実力至上主義の教室へ"
    ]));
    expect(release.providerSearchTitles).not.toEqual(expect.arrayContaining([
      "第四季",
      "2年級篇",
      "第一學期",
      "第4シリーズ"
    ]));
  });

  it("keeps slash-separated anime aliases when adding base season aliases", () => {
    const release = parseReleaseTitle(
      "[剧集]Chained Soldier S02 2026 1080p JPN Blu-ray AVC LPCM 2.0-YE@Nyaa[魔都精兵的奴隶 第二季 / 魔都精兵のスレイブ 第2期 / 魔都精兵のスレイブ2 [日版原盘]][64.31 GB][anonymous][动画]"
    );

    expect(release.providerSearchTitles).toEqual(expect.arrayContaining([
      "魔都精兵的奴隶",
      "魔都精兵のスレイブ"
    ]));
  });

  it("does not keep new-season labels in base season aliases", () => {
    const release = parseReleaseTitle(
      "[剧集]Kanojo Okarishimasu S05E10 2026 1080p Baha WEB-DL x264 AAC-AnimeS@ADWeb[2026年4月新番 出租女友 第五季 / 彼女、お借りします 第5期 第10集][400.95 MB][anonymous][中字 | 动画 | 官方]"
    );

    expect(release.providerSearchTitles).toEqual(expect.arrayContaining([
      "出租女友",
      "彼女、お借りします"
    ]));
    expect(release.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining([
      "2026年4月新番 出租女友"
    ]));
  });

  it("does not combine separate native aliases before season markers", () => {
    const release = parseReleaseTitle(
      "[剧集]That Time I Got Reincarnated as a Slime S04E10 2026 1080p LINETV WEB-DL H264 AAC-ADWeb[关于我转生变成史莱姆这档事 關於我轉生變成史萊姆這檔事 第四季 転生したらスライムだった件 第4期 第04季 第10集 | 类型: 动画 / 奇幻 / 冒险 主演: 冈咲美保 2026年4月新番][905.48 MB][anonymous][中字 | 动画 | 官方]"
    );

    expect(release.providerSearchTitles).toEqual(expect.arrayContaining([
      "关于我转生变成史莱姆这档事",
      "關於我轉生變成史萊姆這檔事",
      "転生したらスライムだった件"
    ]));
    expect(release.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining([
      "关于我转生变成史莱姆这档事 關於我轉生變成史萊姆這檔事"
    ]));
  });

  it("adds base aliases for compact native season suffixes when explicit season metadata matches", () => {
    const release = parseReleaseTitle(
      "[Animations/动漫]The OutCast S06 2026 1080p WEB-DL DDP2.0 H265-HDSWEB[国漫: 一人之下6 第6季 全26集 | 主演: 曹云图 小连杀 藤新][2.73 GB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "The OutCast",
      year: 2026,
      mediaType: "TV_SERIES",
      season: 6
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining([
      "一人之下",
      "一人之下6"
    ]));
    expect(release.primarySearchTitle).toBe("一人之下");
  });

  it("does not strip compact native numeric aliases when explicit season metadata conflicts", () => {
    const release = parseReleaseTitle(
      "[Animations/动漫]The OutCast S05 2026 1080p WEB-DL DDP2.0 H265-HDSWEB[国漫: 一人之下6 第5季 全10集 | 主演: 曹云图 小连杀 藤新][2.73 GB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "The OutCast",
      mediaType: "TV_SERIES",
      season: 5
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["一人之下6"]));
    expect(release.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining(["一人之下"]));
  });

  it("does not strip title-internal Latin numeric suffixes from native aliases", () => {
    const release = parseReleaseTitle(
      "[剧集]Diamond no Ace act II S02E11 2026 1080p friDay WEB-DL H264 AAC-AnimeS@ADWeb[2026年4月新番 钻石王牌act2 第二季 / 鑽石王牌act2 第二季 / Ace of the Diamond actⅡ -Second Season- 第11集][1.61 GB][anonymous][中字 | 动画 | 官方]"
    );

    expect(release.providerSearchTitles).toEqual(expect.arrayContaining([
      "钻石王牌act2",
      "鑽石王牌act2",
      "Ace of the Diamond actⅡ -Second Season"
    ]));
    expect(release.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining([
      "钻石王牌act",
      "鑽石王牌act"
    ]));
  });

  it("adds base aliases for compact native season suffixes before episode metadata", () => {
    const release = parseReleaseTitle(
      "The Heart 2026 S02 E01-E04 1080p WEB-DL H264 AAC-PTerWEB[问心2 第1-4集 | 导演: 黎志 主演: 赵又廷 毛晓彤 金世佳 [国语/中字]][1.37 GB]"
    );

    expect(release).toMatchObject({
      title: "The Heart",
      year: 2026,
      mediaType: "TV_SERIES",
      season: 2,
      episode: 1,
      episodeEnd: 4
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining([
      "问心",
      "问心2"
    ]));
    expect(release.primarySearchTitle).toBe("问心");
  });

  it("does not strip compact native episode aliases when parsed season conflicts", () => {
    const release = parseReleaseTitle(
      "The Heart2 S01 2026 1080p WEB-DL H264 AAC-HHWEB[问心2 第01-04集 | 类型: 剧情][2.18 GB]"
    );

    expect(release).toMatchObject({
      title: "The Heart2",
      mediaType: "TV_SERIES",
      season: 1
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["问心2"]));
    expect(release.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining(["问心"]));
  });

  it("does not strip compact native aliases when episode metadata is in a separate field", () => {
    const release = parseReleaseTitle(
      "The Heart2 S01 2026 1080p WEB-DL H264 AAC-HHWEB[问心2 | 第01-04集 | 类型: 剧情][2.18 GB]"
    );

    expect(release).toMatchObject({
      title: "The Heart2",
      mediaType: "TV_SERIES",
      season: 1
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["问心2"]));
    expect(release.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining(["问心"]));
  });

  it("adds base aliases for compact native season suffixes before adjacent episode fields", () => {
    const release = parseReleaseTitle(
      "The Heart S02E01-E04 2026 2160p WEB-DL H265 AAC-CMCTV[问心2 | 第01-04集 | 赵又廷 / 毛晓彤 / 金世佳 [国语]][4.97 GB]"
    );

    expect(release).toMatchObject({
      title: "The Heart",
      year: 2026,
      mediaType: "TV_SERIES",
      season: 2,
      episode: 1,
      episodeEnd: 4
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining([
      "问心",
      "问心2"
    ]));
    expect(release.primarySearchTitle).toBe("问心");
  });

  it("adds base aliases for compact native season suffixes before later matching season episode fields", () => {
    const release = parseReleaseTitle(
      "[TV Series/HD]The Heart S02E03 1080p TX WEB-DL AAC2.0 H.264-MWeb[问心2 | 2026 | 中国大陆 | 剧情 | 黎志 | 赵又廷 毛晓彤 | 第2季第3集][295.66 MB][N/A]"
    );

    expect(release).toMatchObject({
      title: "The Heart",
      mediaType: "TV_SERIES",
      season: 2,
      episode: 3
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining([
      "问心",
      "问心2"
    ]));
    expect(release.primarySearchTitle).toBe("问心");
  });

  it("does not strip compact native aliases when later season episode metadata conflicts", () => {
    const release = parseReleaseTitle(
      "The Outcast S06E01 2026 1080p WEB-DL H265-HDSWEB[一人之下6 | 第5季第1集][128.18 MB]"
    );

    expect(release).toMatchObject({
      title: "The Outcast",
      mediaType: "TV_SERIES",
      season: 6,
      episode: 1
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["一人之下6"]));
    expect(release.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining(["一人之下"]));
  });

  it("does not create combined base aliases from slash-separated native titles", () => {
    const release = parseReleaseTitle(
      "The Outcast S06E25 2026 1080p WEB-DL H265-HDSWEB[一人之下第六季/一人之下6 第6季 第25集][128.18 MB]"
    );

    expect(release).toMatchObject({
      title: "The Outcast",
      mediaType: "TV_SERIES",
      season: 6,
      episode: 25
    });
    expect(release.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining([
      "一人之下第六季/一人之下"
    ]));
  });

  it("does not use anime edit labels as title aliases", () => {
    const release = parseReleaseTitle(
      "[动漫(Animations)]Yowayowa Sensei 2026 S01E10 1080p friDay WEB-DL H264 AAC-UBWEB[2026年4月新番 | 弱弱老师 (无修版) | 第10集 [日语/简繁中字]][1.62 GB][anonymous]"
    );

    expect(release.providerSearchTitles).toEqual(["弱弱老师"]);
    expect(release.providerSearchTitles).not.toEqual(expect.arrayContaining([
      "无修版",
      "弱弱老师 无修版"
    ]));
  });

  it("removes anime edit labels from slash-separated native aliases", () => {
    const release = parseReleaseTitle(
      "[剧集]Yowayowa Sensei (superyowayowa) S01E10 2026 1080p friDay WEB-DL H264 AAC-AnimeS@ADWeb[2026年4月新番 弱弱老师（无修版） / 弱弱老師（無修版） / Yowayowa Sensei （superyowayowa） 第10集][1.62 GB][anonymous][中字 | 动画 | 官方]"
    );

    expect(release).toMatchObject({
      title: "Yowayowa Sensei superyowayowa",
      year: 2026,
      mediaType: "TV_SERIES",
      season: 1,
      episode: 10
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining([
      "弱弱老师",
      "弱弱老師"
    ]));
    expect(release.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining([
      "无修版",
      "無修版",
      "弱弱老师 无修版",
      "弱弱老師 無修版"
    ]));
  });

  it("keeps Latin anime aliases after removing native season suffixes", () => {
    const release = parseReleaseTitle(
      "[剧集]Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e S04E14 2026 1080p friDay WEB-DL H264 AAC-AnimeS@ADWeb[2026年4月新番 欢迎来到实力至上主义的教室 第4季 2年级篇 第一学期 / 歡迎來到實力至上主義的教室 第4季 2年級篇 第一學期 / Classroom of the Elite 4th Season： Second Year， First Semester 第14集][1.62 GB][anonymous][中字 | 动画 | 官方]"
    );

    expect(release.providerSearchTitles).toEqual(expect.arrayContaining([
      "欢迎来到实力至上主义的教室",
      "歡迎來到實力至上主義的教室",
      "Classroom of the Elite 4th Season： Second Year， First Semester"
    ]));
    expect(release.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining([
      "欢迎来到实力至上主义的教室 2年级篇 第一学期",
      "歡迎來到實力至上主義的教室 第4季 2年級篇 第一學期"
    ]));
  });

  it("adds separate provider aliases for simplified/traditional title variants", () => {
    const release = parseReleaseTitle(
      "[Movies]The Mindful Architects 2021 1080p WEB-DL H.264 AAC 2.0-UBWEB[建筑慢慢 建築慢慢 | 导演：陈芝安 / 谢欣志 | 主演：江文淵 | 类别：纪录片 | 音频:汉语普通话 | 字幕:简中/英][2.82 GB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "The Mindful Architects",
      year: 2021,
      mediaType: "MOVIE"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining([
      "建筑慢慢",
      "建築慢慢"
    ]));
  });

  it("uses animation TV episode-range pack markers as series evidence", () => {
    const release = parseReleaseTitle(
      "[动漫(Animations)]Cat Ninden Teyandee 1990 BluRay 1080p x264 FLAC-jsum@U2[功夫猫党 TV 01-54 Fin+SP][80.24 GB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "Cat Ninden Teyandee",
      mediaType: "TV_SERIES",
      year: 1990,
      quality: "1080p",
      source: "BluRay",
      codec: "H.264",
      audio: "FLAC",
      releaseGroup: "jsum@U2"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["功夫猫党"]));
  });

  it("uses animation bracket TV ranges without keeping category aliases", () => {
    const release = parseReleaseTitle(
      "[动漫][TV/剧场][FRDS][灌篮高手][Slam Dunk][TV 01-101 Fin+SP+MOVIE][1080p][BDRip][MKV][1993.10][日漫][TV版+特别篇+4部剧场版+2022电影版 | 日语/DVD台配/俏佳人VCD台配/辽艺国语/粤语 | 中日字幕/台配字幕/官方简体字幕/官方繁体字幕][114.29 GiB][anonymous]"
    );

    expect(release.mediaType).toBe("TV_SERIES");
    expect(release.year).toBe(1993);
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["灌篮高手"]));
    expect(release.providerSearchTitles).not.toContain("剧场");
  });

  it("uses CJK complete episode ranges in animation metadata as series evidence", () => {
    const release = parseReleaseTitle(
      "[Anime SD]Doraemon  1-1400 SD AAC MP4[哆啦A梦 1-1400集全 TV怀旧版][48.63 GB][anonymous]"
    );

    expect(release.mediaType).toBe("TV_SERIES");
    expect(release.primarySearchTitle).toBe("哆啦A梦");
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["哆啦A梦"]));
  });

  it("does not classify manga brackets as animation series", () => {
    const release = parseReleaseTitle(
      "[动漫][漫画][地主][在超市后门吸烟的二人][Super no Ura de Yani Suu Futari][Vol.01-Vol.5 Fin][HXR][东立][ZIP][2022.08][日漫][在超市后吸烟的故事 | 作者: 地主 | 一到五单行本对应1-38话 | 繁体中文][2.05 GiB][jys210]"
    );

    expect(release.mediaType).toBe("MOVIE");
  });

  it("does not treat complete animation movie discs as series", () => {
    const release = parseReleaseTitle(
      "[Anime]Toy Story 2 1999 3D COMPLETE BluRay 1080p AVC DTS-HD MA 5.1-UNTOUCHED.iso[玩具总动员2 |类型: 喜剧 / 动画 / 奇幻 / 冒险|主演: 汤姆·汉克斯 / 蒂姆·艾伦][38.24 GB][N/A]"
    );

    expect(release).toMatchObject({
      title: "Toy Story 2",
      mediaType: "MOVIE",
      year: 1999
    });
  });

  it("still trusts explicit TV markers when a category label says movie", () => {
    const release = parseReleaseTitle(
      "[电影(Movie)]Example Show 2026 S01E02 1080p WEB-DL H264-GRP[错误分类 第10部][1.00 GB]"
    );

    expect(release).toMatchObject({
      title: "Example Show",
      year: 2026,
      mediaType: "TV_SERIES",
      season: 1,
      episode: 2
    });
  });

  it("parses episode-only TV releases as first-season episodes", () => {
    const release = parseReleaseTitle("Fan.Ren.Xiu.Xian.Zhuan.E32.1080p.WEB-DL.H264.AAC-CHDWEB.mp4");

    expect(release).toMatchObject({
      title: "Fan Ren Xiu Xian Zhuan",
      mediaType: "TV_SERIES",
      season: 1,
      episode: 32,
      quality: "1080p",
      resolution: 1080,
      source: "WEB-DL",
      codec: "H.264",
      audio: "AAC",
      releaseGroup: "CHDWEB"
    });
  });

  it("parses long-running episode-only TV releases under TV categories", () => {
    const release = parseReleaseTitle(
      "[TV Series]Jade Come Home Love：Lo And Behold Ep2826 20260610 HDTV 1080i H264-CHDHKTV[港劇:愛.回家之開心速遞(第2826集)[粤语][簡繁DVB字幕]][1.58 GB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "Come Home Love：Lo And Behold",
      mediaType: "TV_SERIES",
      season: 1,
      episode: 2826,
      quality: "1080i",
      resolution: 1080,
      source: "HDTV",
      codec: "H.264",
      releaseGroup: "CHDHKTV"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["愛.回家之開心速遞"]));
  });

  it("does not parse long E-number tokens as episodes outside TV categories", () => {
    const release = parseReleaseTitle(
      "[Game]Example E2026 1080p WEB-DL H264-GRP[示例游戏][1.00 GB]"
    );

    expect(release).toMatchObject({
      title: "Example E2026",
      mediaType: "UNKNOWN",
      quality: "1080p",
      source: "WEB-DL",
      codec: "H.264"
    });
  });

  it("parses dotted Sxx.Exx TV releases", () => {
    const release = parseReleaseTitle("Example.Show.S01.E03.2160p.NF.WEB-DL.DDP5.1.H.265-GROUP.mkv");

    expect(release).toMatchObject({
      title: "Example Show",
      mediaType: "TV_SERIES",
      season: 1,
      episode: 3,
      quality: "2160p",
      resolution: 2160,
      source: "WEB-DL",
      codec: "H.265",
      releaseGroup: "GROUP"
    });
  });

  it("parses four-digit SxxE episode numbers for long-running TV releases", () => {
    const release = parseReleaseTitle(
      "[剧集]Come Home Love Lo and Behold S01E2826 2017 1080p MyTVSuper WEB-DL H265 AAC-ADWeb[爱·回家之开心速递 第2826集][639.35 MB]"
    );

    expect(release).toMatchObject({
      title: "Come Home Love Lo and Behold",
      mediaType: "TV_SERIES",
      year: 2017,
      season: 1,
      episode: 2826,
      quality: "1080p",
      source: "WEB-DL",
      codec: "H.265",
      audio: "AAC",
      releaseGroup: "ADWeb"
    });
    expect(release.episodeEnd).toBeUndefined();
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["爱·回家之开心速递"]));
  });

  it("parses four-digit SxxE episode ranges for long-running anime releases", () => {
    const release = parseReleaseTitle(
      "[Animations]One Piece S23E1162 E1163 1999 1080p CR WEB-DL AAC2.0 H.264-CHDWEB[航海王 第1162-1163集 / ワンピース][2.00 GB]"
    );

    expect(release).toMatchObject({
      title: "One Piece",
      mediaType: "TV_SERIES",
      year: 1999,
      season: 23,
      episode: 1162,
      episodeEnd: 1163,
      quality: "1080p",
      source: "WEB-DL",
      codec: "H.264",
      audio: "AAC2.0",
      releaseGroup: "CHDWEB"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["航海王"]));
  });

  it("keeps the base native metadata title before season-specific variety subtitles", () => {
    const release = parseReleaseTitle(
      "[综艺]Guo Yue Wu Shuang S01E04 Show 2026 2160p WEB-DL H265 DDP2.0-ADWeb[国乐无双 第一季 星乐秀 星乐秀第04期：刘惜君想和杨千嬅陈小春合作 | 国粤无双 / 创新声 / 华乐无双 *云视听极光*][524.23 MB][anonymous][国语 | 中字 | 官方]"
    );

    expect(release).toMatchObject({
      title: "Guo Yue Wu Shuang",
      mediaType: "TV_SERIES",
      year: 2026,
      season: 1,
      episode: 4,
      quality: "2160p",
      source: "WEB-DL",
      codec: "H.265",
      releaseGroup: "ADWeb"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["国乐无双"]));
  });

  it("keeps the base native metadata title before season-specific bonus subtitles", () => {
    const release = parseReleaseTitle(
      "[综艺]Guo Yue Wu Shuang S01E02 Bonus 2026 1080p WEB-DL H265 DDP2.0-ADWeb[国乐无双 第一季 花絮 成龙来了：“大哥”现场表演经典醉拳 | 国粤无双 / 创新声 / 华乐无双 *云视听极光*][130.89 MB][anonymous][国语 | 中字 | 官方]"
    );

    expect(release).toMatchObject({
      title: "Guo Yue Wu Shuang",
      mediaType: "TV_SERIES",
      year: 2026,
      season: 1,
      episode: 2
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["国乐无双"]));
  });

  it("skips standalone native serialization labels before metadata titles", () => {
    const release = parseReleaseTitle(
      "[剧集]Legendary Su Dongpo S01E01 2026 1080p WEB-DL H264 AAC-ADWeb[[国创连载] 苏东坡与杭州的故事 第01集 | 类型：剧情 动画 历史 *酷喵TV*][127.97 MB][anonymous][国语 | 中字 | 动画 | 官方]"
    );

    expect(release).toMatchObject({
      title: "Legendary Su Dongpo",
      mediaType: "TV_SERIES",
      year: 2026,
      season: 1,
      episode: 1
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["苏东坡与杭州的故事"]));
    expect(release.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining(["国创连载", "酷喵TV"]));
  });

  it("skips standalone streaming platform labels after metadata titles", () => {
    const release = parseReleaseTitle(
      "[纪录片]FOOD with the MOVE S01E01 2026 2160p WEB-DL H264 AAC-ADWeb[[连载] 一招一食 / FOOD with the MOVE 第01集 4K [Bilibili大陆]][3.21 GB][anonymous][官方 | 国语 | 中字]"
    );

    expect(release).toMatchObject({
      title: "FOOD with the MOVE",
      mediaType: "TV_SERIES",
      year: 2026,
      season: 1,
      episode: 1
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["一招一食"]));
    expect(release.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining(["连载", "Bilibili大陆"]));
  });

  it("does not expose presentation labels after platform labels are removed", () => {
    const release = parseReleaseTitle(
      "Wonder Wall 2026 S01E09 2160p WEB-DL H.265 DV DDP5.1 Pure-AilMWeb[迷墙 | 第1季 第09集 | 主演：任素汐 / 郭京飞 / 谷嘉诚 | 普通话 | [简] 硬字幕 | 云视听极光 | 精简版 [首集保留片头片尾]][3.06 GB]"
    );

    expect(release).toMatchObject({
      title: "Wonder Wall",
      mediaType: "TV_SERIES",
      year: 2026,
      season: 1,
      episode: 9
    });
    expect(release.providerSearchTitles).toEqual(["迷墙"]);
  });

  it("keeps complete when it is part of the title", () => {
    const release = parseReleaseTitle("Indiana Jones The Complete Adventures 1981-2008 UHD Blu-Ray 2160p HEVC-CHDBits");

    expect(release).toMatchObject({
      title: "Indiana Jones The Complete Adventures",
      year: 1981,
      mediaType: "MOVIE",
      quality: "2160p",
      resolution: 2160,
      source: "UHD",
      codec: "H.265",
      releaseGroup: "CHDBits"
    });
  });

  it("parses Chinese season and episode text", () => {
    const release = parseReleaseTitle("托马斯和他的朋友们第18季 第4集_3840x2160_H265.mp4");

    expect(release).toMatchObject({
      title: "托马斯和他的朋友们",
      mediaType: "TV_SERIES",
      season: 18,
      episode: 4,
      quality: "2160p",
      resolution: 2160,
      codec: "H.265"
    });
  });

  it("uses explicit season metadata when a movie category wraps a dated TV release", () => {
    const release = parseReleaseTitle(
      "[Movies/电影]The Daily Show 2026-06-15 1080p WEB-DL DDP 2.0 H.264-EDITH[司徒囧每日秀 第一季 | 类型：喜剧][3.08 GB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "The Daily Show",
      year: 2026,
      mediaType: "TV_SERIES",
      season: 1,
      quality: "1080p",
      source: "WEB-DL",
      codec: "H.264",
      releaseGroup: "EDITH"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining([
      "司徒囧每日秀"
    ]));
  });

  it("uses explicit season and episode metadata when a movie category wraps a series episode", () => {
    const release = parseReleaseTitle(
      "[Movie/HD]Sheng Hua Ju Shou 2160p TX WEB-DL AAC2.0 H.265-MWeb[生化巨兽 | 2026 | 中国大陆 | 战争 | 郑建强 林秉翰 | 第1季第1集][1.25 GB][N/A]"
    );

    expect(release).toMatchObject({
      title: "Sheng Hua Ju Shou",
      year: 2026,
      mediaType: "TV_SERIES",
      season: 1,
      episode: 1,
      quality: "2160p",
      source: "WEB-DL",
      codec: "H.265",
      releaseGroup: "MWeb"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining([
      "生化巨兽"
    ]));
  });

  it("does not use movie part labels as season metadata", () => {
    const firstPart = parseReleaseTitle(
      "[电影]Mektoub, My Love: Canto Uno 2017 1080i FRA Blu-ray AVC DTS-HD MA 5.1[宿命，吾爱：第一部 / 宿命 / 宿命，吾爱：首部曲 / Les Dés sont jetés | 类别：剧情 爱情 [法版原盘]][46.36 GB][anonymous][]"
    );
    const bondPart = parseReleaseTitle(
      "[电影(Movie)]Live and Let Die 1973 1080p TWN BluRay x265 10bit DTS-HD MA 5.1-UBits[007第八部：007之你死我活/铁金刚勇破黑魔党/生死关头 | 导演：盖伊·汉弥尔顿 | 主演: 罗杰·摩尔 亚非特·科托 简·西摩 | 繁体中文][14.58 GB][anonymous]"
    );
    const fourSeasonsTitle = parseReleaseTitle(
      "[电影 (Movie)]Conte de printemps 1990 1080p ESP Blu-ray AVC DTS-HD MA 2.0-PTer[春天的故事/  A Tale of Springtime /人间四季之春天的故事 | 侯麦导演 ][44.55 GB][Voner369][Free]"
    );

    expect(firstPart).toMatchObject({
      title: "Mektoub, My Love: Canto Uno",
      year: 2017,
      mediaType: "MOVIE",
      season: undefined
    });
    expect(bondPart).toMatchObject({
      title: "Live and Let Die",
      year: 1973,
      mediaType: "MOVIE",
      season: undefined
    });
    expect(fourSeasonsTitle).toMatchObject({
      title: "Conte de printemps",
      year: 1990,
      mediaType: "MOVIE",
      season: undefined
    });
  });

  it("prefers bracketed release identity over conflicting PTP display metadata", () => {
    const release = parseReleaseTitle(
      "Newboen [1977] by Heather Cook - DVD5 / DVD / VOB IFO / NTSC [ The.Nature.of.Things.S17E03.Newborn.1977.NTSC.DVD5 ]"
    );

    expect(release).toMatchObject({
      title: "The Nature of Things",
      year: 1977,
      mediaType: "TV_SERIES",
      season: 17,
      episode: 3
    });
    expect(release.titleCandidates).toEqual(expect.arrayContaining(["Newboen"]));
  });

  it("keeps category prefixes out of TV title candidates", () => {
    const release = parseReleaseTitle(
      "[电视剧 (TV Series)]Du Shi Gu Yi Xian 2026 S01 Complete 1080p WEB-DL H264 AAC-PTerWEB[都市古医仙/一夜成名/名不虚传2/名不虚传第二季 全36集 | 导演: 王凯 主演: 韩一霆 聂新源 潘铭允  [国语/中字]][4.48 GB][anonymous][Free]"
    );

    expect(release).toMatchObject({
      title: "Du Shi Gu Yi Xian",
      year: 2026,
      mediaType: "TV_SERIES",
      season: 1,
      episode: undefined,
      episodeEnd: undefined
    });
    expect(release.titleCandidates).toEqual(expect.arrayContaining([
      "Du Shi Gu Yi Xian",
      "都市古医仙",
      "一夜成名",
      "名不虚传2",
      "名不虚传第二季"
    ]));
    expect(release.titleCandidates).not.toEqual(expect.arrayContaining([
      "电视剧",
      "TV Series",
      "电视剧 TV Series",
      "导演: 王凯 主演: 韩一霆 聂新源 潘铭允",
      "国语",
      "中字"
    ]));
    expect(release.primarySearchTitle).toBe("都市古医仙");
  });

  it("keeps category prefixes out of TV titles when release text has no resolution token", () => {
    const release = parseReleaseTitle(
      "[电视剧 (TV Series)]Lotus Lantern Prequel 2009 E01-E46 NTSC DVD5-Dave[宝莲灯前传 国版DVD原盘 国语 简体字幕 全46集][64.09 GB][anonymous][Free]"
    );

    expect(release).toMatchObject({
      title: "Lotus Lantern Prequel",
      year: 2009,
      mediaType: "TV_SERIES",
      season: 1,
      episode: 1,
      episodeEnd: 46
    });
    expect(release.titleCandidates).not.toEqual(expect.arrayContaining([
      "TV Series Lotus Lantern Prequel",
      "电视剧 TV Series Lotus Lantern Prequel"
    ]));
    expect(release.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining([
      "电视剧 TV Series Lotus Lantern Prequel"
    ]));
  });

  it("extracts broadcaster metadata title candidates without keeping channel prefixes", () => {
    const release = parseReleaseTitle(
      "[电视剧 (TV Series)]CCTV-8 The First Jasmine 2026 S01E14-E15 1080i HDTV AVS+ DD5.1-QHstudIo[中央电视台电视剧频道 莫离 第14-15集【AVS+卫星源码｜高码率｜杜比环绕5.1】【导演：林玉芬 | 主演：白鹿 | 丞磊 | 蔡正杰 | 杨舒伊 | 林沐然 | 董洁 | 宣言】QHstudIo小组录制作品][7.54 GB][anonymous][Normal]"
    );

    expect(release).toMatchObject({
      title: "The First Jasmine",
      year: 2026,
      mediaType: "TV_SERIES",
      season: 1,
      episode: 14,
      episodeEnd: 15
    });
    expect(release.titleCandidates).toEqual(expect.arrayContaining([
      "The First Jasmine",
      "莫离"
    ]));
    expect(release.titleCandidates).not.toEqual(expect.arrayContaining([
      "CCTV 8 The First Jasmine",
      "电视剧",
      "中央电视台电视剧频道 莫离 第14 15集 AVS+卫星源码｜高码率｜杜比环绕5",
      "导演：林玉芬",
      "主演：白鹿"
    ]));
    expect(release.primarySearchTitle).toBe("莫离");
  });

  it("strips dated regional channel prefixes from TV music captures", () => {
    const release = parseReleaseTitle(
      "[TVMusic 1080i]20200213 Mnet Japan M!Countdown E652 1080i HDTV H264-HDHTV[韩国音乐节目 Mnet M!Countdown 日本台版本 第652期][8.31 GB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "M!Countdown",
      mediaType: "TV_SERIES",
      season: 1,
      episode: 652,
      quality: "1080i",
      source: "HDTV",
      codec: "H.264",
      releaseGroup: "HDHTV"
    });
    expect(release.providerSearchTitles).toEqual(["Mnet M!Countdown"]);
    expect(release.primarySearchTitle).toBe("M!Countdown");
  });

  it("skips Hong Kong channel labels when extracting pipe-delimited metadata titles", () => {
    const release = parseReleaseTitle(
      "[TVSeries 1080i]Jade The Map Of Truth Complete HDTV 1080i H264 2Audio-HDHTV[翡翠台 | 香港探秘地图 | 全20集 | 粤语/普通话 | SRT简繁字幕 *HDHTV 高清家园荣誉出品*][56.32 GB][xiaocilang2023]"
    );

    expect(release).toMatchObject({
      title: "The Map Of Truth",
      mediaType: "TV_SERIES",
      quality: "1080i",
      source: "HDTV",
      codec: "H.264"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["香港探秘地图"]));
    expect(release.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining(["翡翠台"]));
    expect(release.primarySearchTitle).toBe("香港探秘地图");
  });

  it("skips Taiwanese channel labels when extracting pipe-delimited metadata titles", () => {
    const release = parseReleaseTitle(
      "[电视剧(TV Series)]CTV Liang Ren 1992 S01E37-S01E38 1080p HDTV H264 AAC-UBTV[中视经典HD | 良人 | 第37~38集 | 导演: 阮虔芷 | 主演: 杨贵媚 刘林 素珠 杨怀民 [闽南语/繁中]][2.14 GB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "Liang Ren",
      year: 1992,
      mediaType: "TV_SERIES",
      season: 1,
      episode: 37,
      episodeEnd: 38,
      quality: "1080p",
      source: "HDTV",
      codec: "H.264"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["良人"]));
    expect(release.providerSearchTitles ?? []).not.toContain("中视经典HD");
    expect(release.providerSearchTitles ?? []).not.toContain("闽南语");
    expect(release.primarySearchTitle).toBe("良人");
  });

  it("skips original-recording labels before Taiwanese metadata titles", () => {
    const release = parseReleaseTitle(
      "[电视剧(TV Series)]CTS Shi Gong Qi An 1997 S01 Complete 1080i HDTV H264 AAC-UBTV[[台剧原创录制第070部] 华视HD | 施公奇案 | 全272集 | 导演: 陈俊良 | 主演: 廖峻 侯炳莹 崔浩然 邰智源 [国语 闽南语/繁中]][460.86 GB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "Shi Gong Qi An",
      year: 1997,
      mediaType: "TV_SERIES",
      season: 1,
      quality: "1080i",
      source: "HDTV",
      codec: "H.264"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["施公奇案"]));
    expect(release.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining([
      "原创录制",
      "原创录制第070部",
      "华视HD"
    ]));
    expect(release.primarySearchTitle).toBe("施公奇案");
  });

  it("strips regional TV channel prefixes without stripping movie titles", () => {
    const tvRelease = parseReleaseTitle(
      "[TVSeries 1080i]Jade Born Rich 2009 Complete 1080i HDTV H264 DD5.1-HDHTV[翡翠台 富贵门 全41集  粤语/简繁中字 *2023年重播版*][128.67 GB][suandsu]"
    );
    const movieRelease = parseReleaseTitle(
      "Jade 1995 1080p BluRay x264-GRP"
    );
    const pearlTitleRelease = parseReleaseTitle(
      "[剧集]Pearl in Red S01E65 2026 1080p Viu WEB-DL H264 AAC-ADWeb[红色珍珠 Pearl in Red 붉은 진주 第01季 第65集 | 类型: 剧情 主演: 朴真熙 / 李甫姫 / 李元宗 / 韩振熙 / 李应敬][721.99 MB][anonymous][中字 | 官方]"
    );

    expect(tvRelease).toMatchObject({
      title: "Born Rich",
      year: 2009,
      mediaType: "TV_SERIES",
      quality: "1080i",
      source: "HDTV"
    });
    expect(tvRelease.providerSearchTitles).toEqual(expect.arrayContaining(["富贵门"]));
    expect(tvRelease.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining([
      "翡翠台 富贵门"
    ]));
    expect(movieRelease).toMatchObject({
      title: "Jade",
      year: 1995,
      mediaType: "MOVIE"
    });
    expect(pearlTitleRelease).toMatchObject({
      title: "Pearl in Red",
      year: 2026,
      mediaType: "TV_SERIES",
      season: 1,
      episode: 65
    });
  });

  it("uses roman sequel suffixes as season markers for regional episode-only TV captures", () => {
    const release = parseReleaseTitle(
      "[TV Series]Jade The Airport Diary II Ep02 20260616 HDTV 1080i H264-CHDHKTV[港劇:飞常日志II(第02集)[粤语][簡繁英SUB字幕][馬國明/高海寧/劉穎鏇/周嘉洛    主演][CHDHKTV港劇聯盟榮譽出品]][3.07 GB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "The Airport Diary",
      mediaType: "TV_SERIES",
      season: 2,
      episode: 2,
      quality: "1080i",
      source: "HDTV",
      codec: "H.264",
      releaseGroup: "CHDHKTV"
    });
    expect(release.year).toBeUndefined();
    expect(release.providerSearchTitles).toEqual(["飞常日志II"]);
    expect(release.primarySearchTitle).toBe("飞常日志II");
  });

  it("treats typoed complete markers as whole-series stops for regional TV captures", () => {
    const release = parseReleaseTitle(
      "[TV Series/HD]Jade.The Map Of Truth.Completet.HDTV.1080p.H264-CNHK[港劇: 香港探秘地圖 (全20集)[粤语][簡体字幕][黎耀祥/龔嘉欣/丁子朗 主演][CNHK製作組榮譽出品]][64.04 GB][N/A]"
    );

    expect(release).toMatchObject({
      title: "The Map Of Truth",
      mediaType: "TV_SERIES",
      quality: "1080p",
      source: "HDTV",
      codec: "H.264",
      releaseGroup: "CNHK"
    });
    expect(release.providerSearchTitles).toEqual(["香港探秘地圖"]);
    expect(release.primarySearchTitle).toBe("香港探秘地圖");
  });

  it("strips TVB Plus as a channel prefix and metadata field", () => {
    const release = parseReleaseTitle(
      "[TVSeries 1080i]TVB Plus Ode To Joy S05 2024 Complete HDTV 1080i H264-HDHTV[TVB Plus | 欢乐颂5 | 全34集 | 粤语/普通话 | 繁体DVB字幕][51.61 GB][xiaocilang2023]"
    );

    expect(release).toMatchObject({
      title: "Ode To Joy",
      year: 2024,
      mediaType: "TV_SERIES",
      season: 5,
      quality: "1080i",
      source: "HDTV"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["欢乐颂5"]));
    expect(release.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining(["TVB Plus"]));
  });

  it("strips ViuTV channel prefixes from whole-series TV captures", () => {
    const courtRelease = parseReleaseTitle(
      "ViuTV COURT! 2026 COMPLETE 1080i HDTV H264-NGB [ViuTV COURT! 全12集] 粤语 | 繁体DvbSub字幕 21.02 GB"
    );
    const dramaRelease = parseReleaseTitle(
      "ViuTV What Comes After Love 2024 COMPLETE 1080i HDTV H264-NGB [ViuTV 爱过之后来临的 全8集] 粤韩双语 | 繁体DvbSub字幕 13.73 GB"
    );

    expect(courtRelease).toMatchObject({
      title: "COURT!",
      year: 2026,
      mediaType: "TV_SERIES",
      quality: "1080i",
      source: "HDTV"
    });
    expect(courtRelease.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining([
      "ViuTV COURT",
      "繁体DvbSub字幕",
      "21 02 GB"
    ]));
    expect(courtRelease.primarySearchTitle).toBe("COURT!");
    expect(dramaRelease).toMatchObject({
      title: "What Comes After Love",
      year: 2024,
      mediaType: "TV_SERIES",
      quality: "1080i",
      source: "HDTV"
    });
    expect(dramaRelease.providerSearchTitles).toEqual(expect.arrayContaining(["爱过之后来临的"]));
    expect(dramaRelease.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining([
      "ViuTV 爱过之后来临的",
      "13 73 GB"
    ]));
  });

  it("keeps native compound titles joined by Chinese em dashes", () => {
    const release = parseReleaseTitle(
      "CCTV-3 Heavenly Voices  Chinese Folk Song Festival S01E09 1080i HDTV AVS+ DD5.1-QHstudIo[中央电视台综艺频道 原声天籁——中国民歌盛典 第一季第九期 重播版【AVS+卫星源码｜高码率 | 杜比环绕音5.1】QHstudIo小组录制作品][4.50 GB]"
    );

    expect(release).toMatchObject({
      title: "Heavenly Voices Chinese Folk Song Festival",
      mediaType: "TV_SERIES",
      season: 1,
      episode: 9,
      quality: "1080i",
      source: "HDTV"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining([
      "原声天籁——中国民歌盛典",
      "原声天籁",
      "中国民歌盛典"
    ]));
    expect(release.providerSearchTitles?.[0]).toBe("原声天籁——中国民歌盛典");
  });

  it("keeps native yearly variety titles as provider search aliases", () => {
    const release = parseReleaseTitle(
      "[TV Shows综艺]Singer 2026 S07E03 2160p WEB-DL HEVC AAC-QHstudIo[歌手2026 第03期 *含纯享+加更版+直拍REACTION+歌手后花园+超前营业【无芒果TV水印 | 4K高码率】【嘉宾：齐豫 | 胡彦斌 | 张碧晨 | 斯塔纳伊 | 尤长靖 | 周兴哲 | 窦靖童】QHstudIo小组作品][41.10 GB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "Singer",
      year: 2026,
      mediaType: "TV_SERIES",
      season: 7,
      episode: 3,
      quality: "2160p",
      source: "WEB-DL"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["歌手2026", "歌手"]));
    expect(release.providerSearchTitles).not.toEqual(expect.arrayContaining(["Shows综艺", "TV Shows综艺"]));
    expect(release.primarySearchTitle).toBe("歌手2026");
  });

  it("keeps native yearly variety titles before episode ranges", () => {
    const release = parseReleaseTitle(
      "[TV Shows]HNTV4K Singer 2026 S07E00-E04 2160p 50fps UHDTV AVS2 10bit HLG DD5.1-QHstudIo[湖南卫视4K超高清频道 歌手2026 第00-04期【AVS2卫星源码 | 4K HLG 10bit | 高帧率 | 高码率 | 杜比环绕音5.1】【嘉宾：何炅 | 那英 | 沈梦辰】QHstudIo小组录制作品][193.04 GB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "Singer",
      year: 2026,
      mediaType: "TV_SERIES",
      season: 7,
      episode: 0,
      episodeEnd: 4,
      quality: "2160p"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["歌手2026", "歌手"]));
    expect(release.primarySearchTitle).toBe("歌手2026");
  });

  it("uses TV Shows variety labels and broadcaster metadata for regional TV captures without episode markers", () => {
    const release = parseReleaseTitle(
      "[TV Shows/综艺]HunanTV Singer 2026 20260612 HDTV 1080i H264-HDSTV[湖南卫视 歌手2026 20260612][8.26 GB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "Singer",
      year: 2026,
      mediaType: "TV_SERIES",
      quality: "1080i",
      source: "HDTV",
      codec: "H.264",
      releaseGroup: "HDSTV"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["歌手2026", "歌手"]));
    expect(release.titleCandidates).not.toEqual(expect.arrayContaining(["HunanTV Singer", "TV Shows"]));
    expect(release.primarySearchTitle).toBe("歌手2026");
  });

  it("does not keep long native em dash descriptions as title aliases", () => {
    const release = parseReleaseTitle(
      "Example Movie 2026 1080p WEB-DL H264-GRP[这是一段很长很长的剧情描述，不是标题本身——后面仍然是在继续描述剧情内容和人物关系][1.00 GB]"
    );

    expect(release.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining([
      "这是一段很长很长的剧情描述，不是标题本身——后面仍然是在继续描述剧情内容和人物关系"
    ]));
  });

  it("strips broadcast capture prefixes before release parsing", () => {
    const release = parseReleaseTitle(
      "ZJTV-4K The Treasured Voice S07E01 2160p 50fps UHDTV AVS2.10bit HLG DD5.1-QHstudIo[浙江卫视4K超高清频道 天赐的声音 第七季第1期 【AVS2卫星源码 | 4K HLG 10bit | 高帧率 | 高码率 | 杜比环绕音5.1】QHstudIo小组录制作品][26.16 GB]"
    );

    expect(release).toMatchObject({
      title: "The Treasured Voice",
      mediaType: "TV_SERIES",
      season: 7,
      episode: 1,
      quality: "2160p",
      releaseGroup: "QHstudIo"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["天赐的声音"]));
    expect(release.titleCandidates).not.toEqual(expect.arrayContaining(["ZJTV"]));
  });

  it("strips hyphenated 4K broadcast capture prefixes", () => {
    const release = parseReleaseTitle(
      "[TV Shows]HNTV-4K Infinity and Beyond Mandopop 2025 S05E01-E02 2160p 50fps UHDTV AVS2 10bit HLG DD5.1-QHstudIo[湖南卫视4K超高清频道 声生不息华流季 第01-02期【AVS2卫星源码 | 4K HLG 10bit | 高帧率 | 高码率 | 杜比环绕音5.1】QHstudIo小组录制作品][42.04 GB]"
    );

    expect(release).toMatchObject({
      title: "Infinity and Beyond Mandopop",
      year: 2025,
      mediaType: "TV_SERIES",
      season: 5,
      episode: 1,
      episodeEnd: 2,
      quality: "2160p",
      releaseGroup: "QHstudIo"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["声生不息华流季"]));
    expect(release.titleCandidates).not.toEqual(expect.arrayContaining(["HNTV"]));
  });

  it("strips dotted broadcast capture prefixes before scene-style TV titles", () => {
    const release = parseReleaseTitle(
      "GDTV-4K.Battle.of.Changsha.2014.S01E05-E09.1080p.HDTV.H264.AAC-CMCTV[广东卫视4K超高清频道 战长沙 | 第5-9集 | 导演: 孔笙 张开宙][26.42 GB]"
    );

    expect(release).toMatchObject({
      title: "Battle of Changsha",
      year: 2014,
      mediaType: "TV_SERIES",
      season: 1,
      episode: 5,
      episodeEnd: 9,
      quality: "1080p",
      source: "HDTV",
      releaseGroup: "CMCTV"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["战长沙"]));
    expect(release.titleCandidates).not.toEqual(expect.arrayContaining(["GDTV"]));
  });

  it("extracts Chinese titles from CCTV variety metadata", () => {
    const release = parseReleaseTitle(
      "CCTV-3 Epic Guofeng The Quest for the Wind S01E10 1080i HDTV AVS+ DD5.1-QHstudIo[中央电视台综艺频道 国风超有戏·寻风季 第10期:国潮·国风音乐会 重播版【AVS+卫星源码｜高码率 | 杜比环绕音5.1】QHstudIo小组录制作品][6.23 GB]"
    );

    expect(release).toMatchObject({
      title: "Epic Guofeng The Quest for the Wind",
      mediaType: "TV_SERIES",
      season: 1,
      episode: 10,
      quality: "1080i",
      source: "HDTV",
      releaseGroup: "QHstudIo"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["国风超有戏·寻风季"]));
  });

  it("removes CJK variety section labels from provider search titles", () => {
    const release = parseReleaseTitle(
      "[综艺]Im So Into You S06E04 2026 2160p WEB-DL H265 AAC-ADWeb[喜欢你我也是 第六季 正片 第02期上 社牛男五1V4约会女嘉宾 晨晨拆小朱炼炼CP | 喜欢你我也是 旅行季 *银河奇异果*][1.58 GB][anonymous][国语 | 中字 | 官方]"
    );

    expect(release).toMatchObject({
      title: "Im So Into You",
      year: 2026,
      mediaType: "TV_SERIES",
      season: 6,
      episode: 4
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["喜欢你我也是"]));
    expect(release.providerSearchTitles).not.toEqual(expect.arrayContaining([
      "喜欢你我也是 正片"
    ]));
  });

  it("removes CJK plus-section labels without removing the show title", () => {
    const release = parseReleaseTitle(
      "[综艺]Love Actually S05E02 Plus 2026 2160p WEB-DL H265 AAC-ADWeb[半熟恋人 第五季 加更 第02期加更上：你是明星吗？年下弟弟好会撩 *云视听极光*][604.02 MB][anonymous][国语 | 中字 | 官方]"
    );

    expect(release.providerSearchTitles).toEqual(["半熟恋人"]);
  });

  it("removes CJK variety side-section subtitles from provider search titles", () => {
    const bookRelease = parseReleaseTitle(
      "[综艺]VOWS S01E01 Book 2026 1080p WEB-DL H264 AAC-ADWeb[少年无尽夏 第一季 同学录 同学录：吴晗大型破防现场！安仔竟是隐藏绘画大佬！ *酷喵TV*][209.20 MB][anonymous][国语 | 中字 | 官方]"
    );
    const liveRelease = parseReleaseTitle(
      "[综艺]VOWS S01E01 Live 2026 1080p WEB-DL H264 AAC-ADWeb[少年无尽夏 第一季 直播回看 直播回看：《》开播唠嗑局，全员集结线上畅聊 *酷喵TV*][296.79 MB][anonymous][国语 | 中字 | 官方]"
    );

    expect(bookRelease.providerSearchTitles).toEqual(["少年无尽夏"]);
    expect(liveRelease.providerSearchTitles).toEqual(["少年无尽夏"]);
  });

  it("removes CJK annual markers before variety section labels", () => {
    const datingRelease = parseReleaseTitle(
      "[综艺]Ai Qing Bao Wei Zhan S2026E58 2010 1080p WEB-DL H265 DDP2.0-ADWeb[爱情保卫战 2026年度 正片 屡次背叛承诺的男友还要再相信吗？ *云视听极光*][376.62 MB][anonymous][国语 | 中字 | 官方]"
    );
    const peekRelease = parseReleaseTitle(
      "[综艺]H!6 S2026E03 Peek 2026 1080p WEB-DL H265 AAC-ADWeb[你好，星期六 2026年度 抢先逛  好六街抢先逛第03期：王安宇王玉雯合拍手势舞手拿把掐 孙怡上演空耳名场面王星越在线提醒 *芒果TV*][626.69 MB][anonymous][国语 | 中字 | 官方]"
    );

    expect(datingRelease.providerSearchTitles).toEqual(["爱情保卫战"]);
    expect(peekRelease.providerSearchTitles).toEqual(["你好，星期六"]);
  });

  it("removes CJK variety side-section subtitles after season labels", () => {
    const pureRelease = parseReleaseTitle(
      "[综艺]The Melody of You S03E10 Pure 2026 1080p WEB-DL H264 AAC-ADWeb[音你而来 第三季 纯享 纯享版：张碧晨周震南《遗书》太好哭，王琳凯刘雨昕超燃合作 | 音你而来3 *酷喵TV*][807.13 MB][anonymous][国语 | 中字 | 官方]"
    );
    const extraRelease = parseReleaseTitle(
      "[综艺]The Melody of You S03E10 Extra 2026 1080p WEB-DL H264 AAC-ADWeb[音你而来 第三季 整活局 整活局：刘雨昕把王赫野哄成“胚胎”，王琳凯姚晓棠“大战”跳舞机 | 音你而来3 *酷喵TV*][344.79 MB][anonymous][国语 | 中字 | 官方]"
    );

    expect(pureRelease.providerSearchTitles).toEqual(["音你而来"]);
    expect(extraRelease.providerSearchTitles).toEqual(["音你而来"]);
  });

  it("keeps diary words that are part of a title token", () => {
    const release = parseReleaseTitle(
      "[动漫]Koala Enikki S01E01 2026 1080p WEB-DL H264 AAC-GRP[考拉绘日记 無尾熊繪日記 コアラ絵日記 | 第01集][300 MB]"
    );

    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["考拉绘日记 無尾熊繪日記 コアラ絵日記"]));
  });

  it("removes TV category wrapper aliases from short-drama episode releases", () => {
    const release = parseReleaseTitle(
      "[TV Series/剧集(分集）]Accident Squad S01E13-E16 2026 2160p WEB-DL DDP2.0 H265 60fps HDR-HDSWEB[短剧: 意外调查组 第13-16集 [60帧] 【去头尾广告纯享版】[非伪去头] *发现未去净的广告或片头片尾，奖励魔力1W][2.76 GB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "Accident Squad",
      year: 2026,
      mediaType: "TV_SERIES",
      season: 1,
      episode: 13,
      episodeEnd: 16
    });
    expect(release.providerSearchTitles).toEqual(["意外调查组"]);
    expect(release.titleCandidates).not.toEqual(expect.arrayContaining([
      "分集",
      "剧集 分集",
      "短剧: 意外调查组",
      "非伪去头",
      "*发现未去净的广告或片头片尾，奖励魔力1W"
    ]));
  });

  it("removes TV category wrapper aliases from short-drama season packs", () => {
    const release = parseReleaseTitle(
      "[TV Series/剧集(合集）]Crime Scene S01 2026 2160p WEB-DL DDP2.0 H265-HDSWEB[短剧: 罪案现场 全24集 | 主演: 刘俊孝 刘宇航 许晓诺][8.62 GB][anonymous]"
    );

    expect(release.providerSearchTitles).toEqual(["罪案现场"]);
    expect(release.titleCandidates).not.toEqual(expect.arrayContaining([
      "合集",
      "剧集 合集",
      "短剧: 罪案现场"
    ]));
  });

  it("removes source and region bracket labels from short-drama provider search titles", () => {
    const release = parseReleaseTitle(
      "[移动视频][大陆][八零再出发][Ba Ling Zai Chu Fa 2026 S01 720p WEB-DL H.265 AAC-GodDramas][八零再出发 | 全41集 | 2026年 | 网络收费短剧 | 类型：年代 穿越 爱情][149.75 MiB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "Ba Ling Zai Chu Fa",
      year: 2026,
      mediaType: "TV_SERIES",
      season: 1,
      quality: "720p",
      source: "WEB-DL",
      codec: "H.265",
      releaseGroup: "GodDramas"
    });
    expect(release.providerSearchTitles).toEqual(["八零再出发"]);
    expect(release.titleCandidates).not.toEqual(expect.arrayContaining([
      "移动视频",
      "大陆"
    ]));
  });

  it("removes mixed-language documentary category labels from provider search titles", () => {
    const release = parseReleaseTitle(
      "[Documentaries纪录片]Kontant 2025 1080p DRTV WEB-DL AAC 2.0 x264-FFG[Kontant 全16集][25.00 GB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "Kontant",
      year: 2025,
      mediaType: "TV_SERIES",
      quality: "1080p",
      source: "WEB-DL",
      codec: "H.264",
      releaseGroup: "FFG"
    });
    expect(release.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining([
      "Documentaries纪录片"
    ]));
  });

  it("removes CJK diary section subtitles from provider search titles", () => {
    const release = parseReleaseTitle(
      "[综艺]Im So Into You S06E01 Diary 2026 2160p WEB-DL H265 AAC-ADWeb[喜欢你我也是 第六季 日记 喜欢你日记第01期上：女二暖心安慰男一 张馨予孔雪儿甜度爆表 | 喜欢你我也是 旅行季 *银河奇异果*][634.25 MB][anonymous][国语 | 中字 | 官方]"
    );

    expect(release).toMatchObject({
      title: "Im So Into You",
      year: 2026,
      mediaType: "TV_SERIES",
      season: 6,
      episode: 1
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["喜欢你我也是"]));
    expect(release.providerSearchTitles).not.toEqual(expect.arrayContaining([
      "喜欢你我也是 日记 喜欢你日记"
    ]));
  });

  it("removes CJK episode-count and technical suffixes from provider search titles", () => {
    const release = parseReleaseTitle(
      "[纪录片]SDTV-4K The Great Yellow River Delta 2026 S02 Complete 2160p 50fps UHDTV HEVC 10bit HLG DD5.1 2Audios-QHstudlo[山东卫视4K超高清频道 大河之州 第二季 2期全【4K HLG 10bit | 高帧率 | 高码率 | 杜比环绕音5.1】【导演：贾海宁 | 蒋超、李宁】QHstudIo小组录制作品][15.24 GB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "The Great Yellow River Delta",
      year: 2026,
      mediaType: "TV_SERIES",
      season: 2
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["大河之州"]));
    expect(release.providerSearchTitles).not.toEqual(expect.arrayContaining([
      "大河之州 2期全",
      "大河之州 2期全 HLG 10bit",
      "HLG 10bit"
    ]));
  });

  it("removes CJK movie presentation labels from provider search titles", () => {
    const edrRelease = parseReleaseTitle(
      "[电影]Amongst White Clouds 2025 2160p 60fps WEB-DL HEVC DDP 2Audios-QHstudIo[白云深处 4K EDR高帧率60fps | 杜比音效  导演：李根 | 主演：刘柠昊 | 刘欣蕾 | 卢梦琳 | 李森 QHstudIo小组作品][2.76 GB][anonymous]"
    );
    const vividRelease = parseReleaseTitle(
      "[Movies 2160p]Bu Li Bu Qi 2026 2160p 60fps WEB-DL HEVC 10bit HDR Vivid DDP 2Audios-QHstudIo[不离不弃【菁彩影像 | 4K高帧率 | 杜比音效】【导演：张纪中 | 主演：张芷溪 | 初俊辰 | 沈晓海 | 黄俊鹏】QHstudIo小组作品][2.72 GB][anonymous]"
    );

    expect(edrRelease).toMatchObject({
      title: "Amongst White Clouds",
      year: 2025,
      mediaType: "MOVIE",
      quality: "2160p",
      source: "WEB-DL"
    });
    expect(vividRelease).toMatchObject({
      title: "Bu Li Bu Qi",
      year: 2026,
      mediaType: "MOVIE",
      quality: "2160p",
      source: "WEB-DL"
    });
    expect(edrRelease.providerSearchTitles).toEqual(["白云深处"]);
    expect(vividRelease.providerSearchTitles).toEqual(["不离不弃"]);
    expect(edrRelease.titleCandidates).not.toEqual(expect.arrayContaining(["白云深处 EDR高帧率60fps"]));
    expect(vividRelease.titleCandidates).not.toEqual(expect.arrayContaining(["不离不弃 菁彩影像"]));
  });

  it("uses Chinese metadata episode ranges when the release segment only has a season pack", () => {
    const release = parseReleaseTitle(
      "[电视剧]Cang Yue Xing Lan S01 2026 1080p WEB-DL H264 AAC-HHWEB[沧月星澜 | 第19-23集 | 1080p  | 类型: 剧情/爱情/奇幻 | 导演: 钟大维 | 主演: 朱致灵/邵思涵/靳旺/罗予甜][913.03 MB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "Cang Yue Xing Lan",
      year: 2026,
      mediaType: "TV_SERIES",
      season: 1,
      episode: 19,
      episodeEnd: 23,
      quality: "1080p",
      source: "WEB-DL",
      codec: "H.264",
      audio: "AAC",
      releaseGroup: "HHWEB"
    });
    expect(release.titleCandidates).toEqual(expect.arrayContaining(["沧月星澜"]));
    expect(release.titleCandidates).not.toEqual(expect.arrayContaining(["电视剧", "剧情", "爱情", "奇幻"]));
    expect(release.primarySearchTitle).toBe("沧月星澜");
  });

  it("keeps season-only metadata out of provider search titles", () => {
    const release = parseReleaseTitle(
      "[综艺]Deal Or No Deal Au S14E038 1080p WEB-DL AAC 2.0 H.264-WH[成交不成交(澳版) [第十四季 第038集] | 类型：真人秀 | 2026][920.47 MB][anonymous][]"
    );

    expect(release).toMatchObject({
      title: "Deal Or No Deal Au",
      year: 2026,
      mediaType: "TV_SERIES",
      season: 14,
      episode: 38,
      quality: "1080p",
      source: "WEB-DL",
      codec: "H.264",
      audio: "AAC.2.0",
      releaseGroup: "WH"
    });
    expect(release.providerSearchTitles).toEqual(["成交不成交 澳版"]);
    expect(release.titleCandidates).toEqual(expect.arrayContaining(["成交不成交 澳版"]));
    expect(release.titleCandidates).not.toEqual(expect.arrayContaining(["第十四季"]));
    expect(release.primarySearchTitle).toBe("成交不成交 澳版");
  });

  it("strips Hong Kong variety labels from provider search titles", () => {
    const release = parseReleaseTitle(
      "[TV Shows]Jade Lose the Battle Win the War Complete HDTV 1080i H264-CHDHKTV[港綜:夫妻肺片(全10集)[粵語][简繁字幕][CHDHKTV港劇聯盟榮譽出品]][16.09 GB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "Lose the Battle Win the War",
      mediaType: "TV_SERIES",
      quality: "1080i",
      source: "HDTV",
      codec: "H.264"
    });
    expect(release.providerSearchTitles).toEqual(["夫妻肺片"]);
    expect(release.titleCandidates).not.toEqual(expect.arrayContaining(["港綜:夫妻肺片"]));
  });

  it("keeps parenthesized regional TV aliases as provider search fallbacks", () => {
    const release = parseReleaseTitle(
      "[剧集]Dertigers NL S07E05 DUTCH 1080p WEB h264-TRIPEL[Dertigers (NL)  [第七季 第05集] | 类型：剧情 | 2026][723.58 MB][anonymous][]"
    );

    expect(release).toMatchObject({
      title: "Dertigers NL",
      year: 2026,
      mediaType: "TV_SERIES",
      season: 7,
      episode: 5,
      quality: "1080p",
      source: "WEB",
      codec: "H.264",
      releaseGroup: "TRIPEL"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining(["Dertigers"]));
    expect(release.providerSearchTitles).not.toEqual(expect.arrayContaining(["第七季"]));
  });

  it("extracts Latin aliases before nested season metadata", () => {
    const release = parseReleaseTitle(
      "[剧集]Fosca S01 1080p AMZN WEB-DL DDP 2.0 H.264-FFG[Fosca Innocenti  [第一季] / Fosca: A Tuscan Policewoman | 2022][24.27 GB][anonymous][完结]"
    );

    expect(release).toMatchObject({
      title: "Fosca",
      year: 2022,
      mediaType: "TV_SERIES",
      season: 1,
      quality: "1080p",
      source: "WEB-DL"
    });
    expect(release.providerSearchTitles).toEqual(expect.arrayContaining([
      "Fosca Innocenti",
      "Fosca: A Tuscan Policewoman"
    ]));
    expect(release.providerSearchTitles).not.toEqual(expect.arrayContaining(["第一季"]));
  });

  it("does not prefer short bracket group tokens over structured title candidates", () => {
    const release = parseReleaseTitle(
      "[动漫][连载][huthid][斗罗大陆Ⅱ绝世唐门][Douluo Dalu II: Jueshi Tangmen][105-156][2160p][WEB-DL][MP4][2025年06月][国漫][斗罗大陆Ⅱ绝世唐门 第105-156集 / Soul Land 2：The Peerless Tang Clan Ⅲ][50.12 GiB][huthid]"
    );

    expect(release.title).toBe("Douluo Dalu II: Jueshi Tangmen");
    expect(release.titleCandidates).toEqual(expect.arrayContaining([
      "斗罗大陆Ⅱ绝世唐门",
      "Douluo Dalu II: Jueshi Tangmen"
    ]));
    expect(release.titleCandidates).not.toEqual(expect.arrayContaining(["连载", "WEB DL"]));
    expect(release.primarySearchTitle).toBe("斗罗大陆Ⅱ绝世唐门");
  });

  it("uses structured anime TV title brackets instead of category and group prefixes", () => {
    const release = parseReleaseTitle(
      "[动漫][TV][VARYG][动物狂想曲 最终季 第二部分][Beastars Final Season Part 2][01-24 Fin][1080p][WEB-DL][MKV][2026.03][日漫][完结撒花 | 最终季 第二部分  |  板垣巴留 |  HEVC-8bit AAC | 内封多语言字幕（含简中） |][25.44 GiB][jys210]"
    );

    expect(release).toMatchObject({
      title: "Beastars Final Season Part 2",
      year: 2026,
      mediaType: "TV_SERIES",
      season: 2
    });
    expect(release.titleCandidates).toEqual(expect.arrayContaining([
      "动物狂想曲 最终季 第二部分",
      "Beastars Final Season Part 2"
    ]));
    expect(release.titleCandidates).not.toEqual(expect.arrayContaining(["TV VARYG"]));
    expect(release.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining([
      "动漫 TV VARYG 动物狂想曲 最终季 分 Beastars Final Season Part 2 Fin"
    ]));
    expect(release.primarySearchTitle).toBe("动物狂想曲 最终季 第二部分");
  });

  it("uses serialized anime title brackets instead of release group prefixes", () => {
    const release = parseReleaseTitle(
      "[动漫][连载][GM-Team][师兄啊师兄 第二季][Shixiong A Shixiong 2nd Season][2160p][145][MP4/WEB-DL][2023年12月][师兄啊师兄/ 我师兄实在太稳健了 第145集 跟据言归正传同名小说改编，玄机科技出品 4K版][687.62 MiB][]"
    );

    expect(release).toMatchObject({
      title: "Shixiong A Shixiong 2nd Season",
      year: 2023,
      mediaType: "TV_SERIES",
      season: 2,
      episode: 145
    });
    expect(release.titleCandidates).toEqual(expect.arrayContaining([
      "师兄啊师兄 第二季",
      "Shixiong A Shixiong 2nd Season"
    ]));
    expect(release.titleCandidates ?? []).not.toEqual(expect.arrayContaining([
      "GM Team",
      "动漫 连载 GM Team 师兄啊师兄 Shixiong A Shixiong 2nd Season"
    ]));
    expect(release.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining([
      "动漫 连载 GM Team 师兄啊师兄 Shixiong A Shixiong 2nd Season"
    ]));
    expect(release.primarySearchTitle).toBe("师兄啊师兄");
  });

  it("extracts bare episode brackets from serialized anime title layouts", () => {
    const release = parseReleaseTitle(
      "[动漫][连载][Nekomoe kissaten][上伊那牡丹，酒醉身姿似百合花般][Kamiina Botan, Yoeru Sugata wa Yuri no Hana][10][1080p][WebRip][MP4][2026.04][日漫][[喵萌奶茶屋]上伊那牡丹，酒醉身姿似百合花般[10][1080p][简日双语]][383.54 MiB][banned404]"
    );

    expect(release).toMatchObject({
      title: "Kamiina Botan, Yoeru Sugata wa Yuri no Hana",
      year: 2026,
      mediaType: "TV_SERIES",
      episode: 10
    });
    expect(release.titleCandidates).toEqual(expect.arrayContaining([
      "上伊那牡丹，酒醉身姿似百合花般",
      "Kamiina Botan, Yoeru Sugata wa Yuri no Hana"
    ]));
    expect(release.titleCandidates ?? []).not.toEqual(expect.arrayContaining([
      "Nekomoe kissaten",
      "Kamiina Botan, Yoeru Sugata wa Yuri no Hana 10"
    ]));
    expect(release.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining([
      "动漫 连载 Nekomoe kissaten 上伊那牡丹，酒醉身姿似百合花般 Kamiina Botan, Yoeru Sugata wa Yuri no Hana 10"
    ]));
    expect(release.primarySearchTitle).toBe("上伊那牡丹，酒醉身姿似百合花般");
  });

  it("skips source group fields before structured anime metadata aliases", () => {
    const release = parseReleaseTitle(
      "[动漫][连载][orion origin][石纪元 科学与未来 第3部分][Dr. Stone: Science Future Part 3][1080p][34][MP4/WEB-DL][2026年04月][猎户发布组/猎户压制部 | 新石纪 第四季 第三部分 / Dr.STONE SCIENCE FUTURE 第3クール / Dr. Stone 4th Season Part 3 [H265 AAC] [简日内嵌]][491.77 MiB][]"
    );

    expect(release).toMatchObject({
      title: "Dr. Stone: Science Future Part 3",
      mediaType: "TV_SERIES",
      season: 3,
      episode: 34
    });
    expect(release.providerSearchTitles ?? []).toEqual(expect.arrayContaining([
      "石纪元 科学与未来 第3部分",
      "新石纪 第三部分",
      "Dr. Stone 4th Season Part 3"
    ]));
    expect(release.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining([
      "猎户发布组",
      "猎户压制部",
      "第3クール"
    ]));
  });

  it("does not replace source attribution aliases with deletion disclaimers", () => {
    const release = parseReleaseTitle(
      "[电影][少林门][Shao.Lin.men.1976.BluRay.1080p.x265.10bit.MNHD-FRDS][动作][华语][导演: 吴宇森 主演: 谭道良 / 田俊 / 成龙 / 朱青 / 洪金宝|转自MNHD-FRDS|如有侵权请立刻联系删除][6.04 GiB][Box2002]"
    );

    expect(release).toMatchObject({
      title: "Shao Lin men",
      year: 1976,
      mediaType: "MOVIE"
    });
    expect(release.providerSearchTitles ?? []).toEqual(expect.arrayContaining(["少林门"]));
    expect(release.providerSearchTitles ?? []).not.toContain("转自MNHD");
    expect(release.providerSearchTitles ?? []).not.toContain("如有侵权请立刻联系删除");
  });

  it("does not use standalone genre or region brackets as provider aliases", () => {
    const release = parseReleaseTitle(
      "[电影][警察故事2013][Police.Story.2013.BluRay.1080p.x265.10bit.2Audio.MNHD-FRDS][动作/剧情/犯罪][华语][转自MNHD-FRDS|如有侵权请立刻联系删除][4.60 GiB][Box2002]"
    );

    expect(release).toMatchObject({
      title: "Police Story",
      year: 2013,
      mediaType: "MOVIE"
    });
    expect(release.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining([
      "动作",
      "剧情",
      "犯罪",
      "华语"
    ]));
    expect(release.primarySearchTitle).toBe("Police Story");
  });

  it("does not replace genre aliases with broad region labels", () => {
    const release = parseReleaseTitle(
      "[电影][第一滴血2/兰博2][Rambo.First.Blood.Part.II.1985.ITA.UHD.Bluray.2160p.x265.HDR.DTS-HD.MA.5.1-Zone][动作/惊悚/冒险][北美][4K版|转自Zone|如有侵权请立刻联系删除][13.01 GiB][Box2002]"
    );

    expect(release).toMatchObject({
      title: "Rambo First Blood Part II",
      year: 1985,
      mediaType: "MOVIE"
    });
    expect(release.providerSearchTitles ?? []).toEqual(expect.arrayContaining([
      "第一滴血2",
      "兰博2"
    ]));
    expect(release.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining([
      "动作",
      "惊悚",
      "冒险",
      "北美"
    ]));
    expect(release.primarySearchTitle).toBe("第一滴血2");
  });

  it("keeps a single genre-looking native alias when it is the only alias", () => {
    const release = parseReleaseTitle(
      "Love 2012 1080p WEB-DL H264-GRP[爱情]"
    );

    expect(release).toMatchObject({
      title: "Love",
      year: 2012,
      mediaType: "MOVIE"
    });
    expect(release.providerSearchTitles ?? []).toEqual(expect.arrayContaining(["爱情"]));
    expect(release.primarySearchTitle).toBe("爱情");
  });

  it("keeps AKA aliases from release filenames before season tokens", () => {
    const release = parseReleaseTitle(
      "[剧集][西班牙][皇家大酒店][Grand.Hotel.2011.AKA.Gran.Hotel.S01.International.Cut.1080p.DSNP.WEB-DL.AAC2.0.H.264-FLUX][26.05 GiB][anonymous]"
    );

    expect(release).toMatchObject({
      title: "Grand Hotel",
      year: 2011,
      mediaType: "TV_SERIES",
      season: 1
    });
    expect(release.providerSearchTitles ?? []).toEqual(expect.arrayContaining([
      "皇家大酒店",
      "Gran Hotel"
    ]));
  });

  it("keeps native title aliases while dropping country bracket metadata", () => {
    const release = parseReleaseTitle(
      "[电影][美国][男孩，当心！][Boys.Beware.1962.576p.BDRip.x264.FLAC-eve99][类型： 剧情 短片][588.82 MiB][]"
    );

    expect(release).toMatchObject({
      title: "Boys Beware",
      year: 1962,
      mediaType: "MOVIE"
    });
    expect(release.providerSearchTitles ?? []).toEqual(expect.arrayContaining(["男孩，当心！"]));
    expect(release.providerSearchTitles ?? []).not.toContain("美国");
    expect(release.primarySearchTitle).toBe("男孩，当心！");
  });

  it("drops CJK category-prefixed region aliases", () => {
    const release = parseReleaseTitle(
      "[纪录片][美国][Geometry of Return][Geometry.of.Return.2025.1080p][类型： 纪录片 短片][155.37 MiB][]"
    );

    expect(release).toMatchObject({
      title: "Geometry of Return Geometry of Return",
      year: 2025,
      mediaType: "MOVIE"
    });
    expect(release.providerSearchTitles ?? []).not.toEqual(expect.arrayContaining([
      "纪录片 美国",
      "纪录片 美国 Geometry of Return Geometry of Return",
      "美国"
    ]));
  });

  it("does not mistake native characters in anime TV release groups for title brackets", () => {
    const release = parseReleaseTitle(
      "[动漫][TV][U2娘@Share][青兰圆舞曲/亲亲天使心/青涩花园][Oniisama e / Dear Brother][Blu-ray BOX DISC×5][1080p][BDMV][M2TS][1991.07][日漫][转自U2(#25885)][212.63 GiB][kallerwu]"
    );

    expect(release).toMatchObject({
      title: "Oniisama e",
      year: 1991,
      mediaType: "TV_SERIES"
    });
    expect(release.titleCandidates).toEqual(expect.arrayContaining([
      "青兰圆舞曲",
      "亲亲天使心",
      "青涩花园",
      "Oniisama e",
      "Dear Brother"
    ]));
    expect(release.titleCandidates).not.toEqual(expect.arrayContaining(["U2娘@Share"]));
    expect(release.primarySearchTitle).toBe("青兰圆舞曲");
  });

  it("classifies leading music category releases as unsupported instead of movies", () => {
    const release = parseReleaseTitle(
      "[Music]Torkil Bye & Helge Myhren - The Sound of Gold and Palladium Flutes (2026) - FLAC - CHDMusic[专辑 | Torkil Bye & Helge Myhren - The Sound of Gold and Palladium Flutes | Classical | WEB | 24bit 192khz][1.60 GB][anonymous]"
    );

    expect(release.mediaType).toBe("UNKNOWN");
  });

  it("classifies leading Chinese music category releases as unsupported instead of movies", () => {
    const release = parseReleaseTitle(
      "[音乐]Heart - Red Velvet Car (2010) [FLAC][252.58 MB][anonymous]"
    );

    expect(release.mediaType).toBe("UNKNOWN");
  });

  it("classifies leading sports category releases as unsupported instead of movies", () => {
    const release = parseReleaseTitle(
      "[Sports]2019 WTT German Open WEB-DL 1080P H264 AAC[2019WTT德国公开赛部分比赛合集][51.22 GB][N/A]"
    );

    expect(release.mediaType).toBe("UNKNOWN");
  });

  it("classifies leading sports categories with quality suffixes as unsupported", () => {
    const release = parseReleaseTitle(
      "[Sports 1080i]HOY TV FIVB Women's Volleyball Nations League 2025 Hong Kong 1080i HDTV H264 DD2.0 2Audio-HDHTV[HOY 76&77 FIVB世界女排联赛2025-香港站 6月20-22日部分赛事 粤/英双语旁述 无字幕][37.88 GB][suandsu]"
    );

    expect(release.mediaType).toBe("UNKNOWN");
  });

  it("classifies leading Chinese sports categories as unsupported", () => {
    const release = parseReleaseTitle(
      "[体育]Premier League Round 37 2025-26 1080p WEB-DL H.264 AAC 2.0-TJUPT[英格兰足球超级联赛 | 类别：运动][67.32 GB][anonymous]"
    );

    expect(release.mediaType).toBe("UNKNOWN");
  });

  it("classifies leading mixed sports categories as unsupported", () => {
    const mixed = parseReleaseTitle(
      "[Sports/体育]CCTV5 2025-2026 National Basketball Association 20260611 HDTV 1080i H264-HDSTV[央视体育频道 2025/2026赛季美国职业篮球联赛-总决赛][10.83 GB][anonymous]"
    );
    const parenthesized = parseReleaseTitle(
      "[体育 (Sport)]The 15th National Games 2025 1080i HDTV H.264-NGB[中华人民共和国第十五届运动会（香港地面波版本）][1.469 TB][anonymous][Free]"
    );

    expect(mixed.mediaType).toBe("UNKNOWN");
    expect(parenthesized.mediaType).toBe("UNKNOWN");
  });

  it("classifies leading music-video categories as unsupported", () => {
    const release = parseReleaseTitle(
      "[Music Videos/音乐MV]LE SSERAFIM-2023 LE SSERAFIM TOUR 'FLAME RISES' IN JAPAN Blu-ray 1080i AVC LPCM 2.0[2023 年 Le Sserafim 日本巡演“火焰崛起”][52.55 GB][anonymous]"
    );

    expect(release.mediaType).toBe("UNKNOWN");
  });

  it("classifies leading lossless-audio categories as unsupported", () => {
    const release = parseReleaseTitle(
      "[HQ Audio/无损音乐]Ennio Morricone - Veruschka - 1971 - FLAC分轨[453.84 MB][anonymous]"
    );
    const compact = parseReleaseTitle(
      "[HQ Audio音乐]VA - The Best Of Disco Fox: Vol. 1, 2 (2012-2013) [FLAC][1.95 GB][anonymous]"
    );

    expect(release.mediaType).toBe("UNKNOWN");
    expect(compact.mediaType).toBe("UNKNOWN");
  });

  it("classifies leading Chinese music-video categories as unsupported", () => {
    const release = parseReleaseTitle(
      "[音乐短片 (MV)]Ava Max - Maybe You're The Problem 2022 2160p WEB-DL ProRes PCM-PTerMV[Ava Max - Maybe You're The Problem][15.27 GB][anonymous][Free]"
    );

    expect(release.mediaType).toBe("UNKNOWN");
  });

  it("classifies leading game and software categories as unsupported", () => {
    const game = parseReleaseTitle(
      "[PCGame]PC Racing MX vs ATV Legends Deluxe Edition-FitGirl[MX vs ATV Legends：豪华版 [版本 5.04 + 全部DLC] [2022] [重新打包]][27.09 GB][N/A]"
    );
    const software = parseReleaseTitle(
      "[软件]Topaz Video AI 6.0.0 x64[Topaz Video AI 6.0.0][6.12 GB][anonymous]"
    );

    expect(game.mediaType).toBe("UNKNOWN");
    expect(software.mediaType).toBe("UNKNOWN");
  });

  it("classifies leading ebook and audiobook categories as unsupported", () => {
    const ebook = parseReleaseTitle(
      "[电子书 (Ebook)]有声书 宿命之环 爱潜水的乌贼 729声工厂 2023 MP3 320kbps[宿命之环 | 起点独家 | 诡秘之主第二部 | 729声工厂 | 完结][31.56 GB][anonymous][Free]"
    );
    const audiobook = parseReleaseTitle(
      "[有声书]Chao Ji Dao Zei 2016 WEB-DL MP3-ZARD[超级盗贼 |演播：Lovskey斯基 | 作者：不是浮云 | 全511集 | 64Kbs | [国语/单播]][5.77 GB][anonymous]"
    );

    expect(ebook.mediaType).toBe("UNKNOWN");
    expect(audiobook.mediaType).toBe("UNKNOWN");
  });

  it("classifies leading data and adult categories as unsupported", () => {
    const data = parseReleaseTitle(
      "[资料][BBC 新闻片段][BBC.News.2024.11.17.HDTV.1080p.WEBRip.H264.AAC-D0][外语学习][MP4][2024.11.17/英语听力口语 / 雅思托福练习 / 时政素材 / 转自M-Team][1.05 GiB][anonymous]"
    );
    const adult = parseReleaseTitle(
      "[AV(無碼)/HD Uncensored]OFJE-593 本郷愛 引退 S1全19作コンプリート 15時間BOX[restored][29.07 GB][N/A]"
    );
    const imageVideo = parseReleaseTitle(
      "[IV/Video Collection]GirlsDelta 2022 July - September x264 AAC[null][44.9 GB][N/A]"
    );

    expect(data.mediaType).toBe("UNKNOWN");
    expect(adult.mediaType).toBe("UNKNOWN");
    expect(imageVideo.mediaType).toBe("UNKNOWN");
  });

  it("does not treat music as unsupported when it is part of a normal movie title", () => {
    const release = parseReleaseTitle("The.Sound.of.Music.1965.1080p.BluRay.x264-GROUP");

    expect(release).toMatchObject({
      title: "The Sound of Music",
      year: 1965,
      mediaType: "MOVIE"
    });
  });

  it("does not treat game as unsupported when it is part of a normal movie title", () => {
    const release = parseReleaseTitle("Game.Night.2018.1080p.BluRay.x264-GROUP");

    expect(release).toMatchObject({
      title: "Game Night",
      year: 2018,
      mediaType: "MOVIE"
    });
  });
});
