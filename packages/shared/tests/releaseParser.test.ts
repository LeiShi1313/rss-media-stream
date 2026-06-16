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
      title: "Jade How Dare You",
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

  it("extracts broadcaster metadata title candidates without keeping channel prefixes", () => {
    const release = parseReleaseTitle(
      "[电视剧 (TV Series)]CCTV-8 The First Jasmine 2026 S01E14-E15 1080i HDTV AVS+ DD5.1-QHstudIo[中央电视台电视剧频道 莫离 第14-15集【AVS+卫星源码｜高码率｜杜比环绕5.1】【导演：林玉芬 | 主演：白鹿 | 丞磊 | 蔡正杰 | 杨舒伊 | 林沐然 | 董洁 | 宣言】QHstudIo小组录制作品][7.54 GB][anonymous][Normal]"
    );

    expect(release).toMatchObject({
      title: "CCTV 8 The First Jasmine",
      year: 2026,
      mediaType: "TV_SERIES",
      season: 1,
      episode: 14,
      episodeEnd: 15
    });
    expect(release.titleCandidates).toEqual(expect.arrayContaining([
      "CCTV 8 The First Jasmine",
      "莫离"
    ]));
    expect(release.titleCandidates).not.toEqual(expect.arrayContaining([
      "电视剧",
      "中央电视台电视剧频道 莫离 第14 15集 AVS+卫星源码｜高码率｜杜比环绕5",
      "导演：林玉芬",
      "主演：白鹿"
    ]));
    expect(release.primarySearchTitle).toBe("莫离");
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
});
