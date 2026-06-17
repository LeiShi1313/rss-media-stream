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

  it("does not treat a TV category alone as whole-series evidence", () => {
    const release = parseReleaseTitle(
      "[TV Series/HD]BBC News 2026 06 11 HDTV 1080p WEBRip H264 AAC-D0[BBC News 新闻片段 2026.06.11 英语听力口语 / 雅思托福练习 / 时政素材 / 自录][1.39 GB][N/A]"
    );

    expect(release.mediaType).toBe("MOVIE");
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
      title: "Jade Come Home Love：Lo And Behold",
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

  it("classifies leading music-video categories as unsupported", () => {
    const release = parseReleaseTitle(
      "[Music Videos/音乐MV]LE SSERAFIM-2023 LE SSERAFIM TOUR 'FLAME RISES' IN JAPAN Blu-ray 1080i AVC LPCM 2.0[2023 年 Le Sserafim 日本巡演“火焰崛起”][52.55 GB][anonymous]"
    );

    expect(release.mediaType).toBe("UNKNOWN");
  });

  it("classifies leading Chinese music-video categories as unsupported", () => {
    const release = parseReleaseTitle(
      "[音乐短片 (MV)]Ava Max - Maybe You're The Problem 2022 2160p WEB-DL ProRes PCM-PTerMV[Ava Max - Maybe You're The Problem][15.27 GB][anonymous][Free]"
    );

    expect(release.mediaType).toBe("UNKNOWN");
  });

  it("does not treat music as unsupported when it is part of a normal movie title", () => {
    const release = parseReleaseTitle("The.Sound.of.Music.1965.1080p.BluRay.x264-GROUP");

    expect(release).toMatchObject({
      title: "The Sound of Music",
      year: 1965,
      mediaType: "MOVIE"
    });
  });
});
