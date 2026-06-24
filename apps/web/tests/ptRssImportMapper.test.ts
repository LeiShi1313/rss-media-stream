import { describe, expect, it } from "vitest";
import { mapPtRssJoinedItem } from "../src/server/modules/imports/ptRssImport.mapper.js";

describe("mapPtRssJoinedItem", () => {
  it("maps raw RSS fields, link roles, and provider IDs from joined pt_rss documents", () => {
    const result = mapPtRssJoinedItem({
      visited: {
        _id: { id: "160093", site: "chdbits.co" },
        title: "Shang-Chi and the Legend of the Ten Rings 2021 1080p Blu-ray Remux AVC DTS-HD MA 7 1-BdC",
        link: "https://chdbits.co/details.php?id=160093",
        links: [
          {
            rel: "alternate",
            type: "text/html",
            href: "https://chdbits.co/details.php?id=160093"
          },
          {
            rel: "enclosure",
            type: "application/x-bittorrent",
            href: "https://chdbits.co/download.php?id=160093&passkey=secret",
            length: "34745702058"
          }
        ],
        published: "Fri, 24 Dec 2021 00:45:35 +0800"
      },
      item: {
        _id: { id: "160093", site: "chdbits.co" },
        imdb: "https://www.imdb.com/title/tt9376612",
        douban: "https://douban.com/subject/30394797",
        size: "32.36 GB",
        torrent: "Shang-Chi and the Legend of the Ten Rings 2021 1080p Blu-ray Remux AVC DTS-HD MA 7 1-BdC"
      }
    });

    expect(result.status).toBe("mapped");
    if (result.status !== "mapped") throw new Error("expected mapped result");

    expect(result.value.item).toMatchObject({
      rawTitle: "Shang-Chi and the Legend of the Ten Rings 2021 1080p Blu-ray Remux AVC DTS-HD MA 7 1-BdC",
      torrentUrl: "https://chdbits.co/download.php?id=160093&passkey=secret",
      sourceUrl: "https://chdbits.co/details.php?id=160093",
      publishDate: new Date("2021-12-23T16:45:35.000Z"),
      firstSeenAt: new Date("2021-12-23T16:45:35.000Z"),
      sizeBytes: 34745702058n
    });
    expect(result.value.importedProviderIds).toEqual([
      {
        providerSource: "ptgen_imdb",
        provider: "imdb",
        providerId: "imdb-tt9376612",
        originalValue: "https://www.imdb.com/title/tt9376612",
        source: "mongo_item_imdb"
      },
      {
        providerSource: "ptgen_douban",
        provider: "douban",
        providerId: "douban-30394797",
        originalValue: "https://douban.com/subject/30394797",
        source: "mongo_item_douban"
      }
    ]);
    expect(result.value.rawPayload).toMatchObject({
      source: "pt_rss",
      mongoId: { id: "160093", site: "chdbits.co" },
      visited: expect.any(Object),
      item: expect.any(Object)
    });
  });

  it("accepts HDBits-style RSS links where the main link is the torrent download URL", () => {
    const result = mapPtRssJoinedItem({
      visited: {
        _id: { id: "593522", site: "hdbits.org" },
        title: "Manhunt 2019 S02 1080p GBR Blu-ray AVC LPCM 2.0-PzD",
        link: "https://hdbits.org/download.php?id=593522&passkey=secret&source=rss",
        summary: "https://www.imdb.com/title/tt7801964/",
        published: "Mon, 13 Dec 2021 23:15:47 +0000"
      },
      item: {
        _id: { id: "593522", site: "hdbits.org" },
        link: "https://hdbits.org/details.php?id=593522",
        imdb: "https://www.imdb.com/title/tt7801964/",
        torrent_name: "Manhunt 2019 S02 1080p GBR Blu-ray AVC LPCM 2.0-PzD"
      }
    });

    expect(result.status).toBe("mapped");
    if (result.status !== "mapped") throw new Error("expected mapped result");

    expect(result.value.item.torrentUrl).toBe("https://hdbits.org/download.php?id=593522&passkey=secret&source=rss");
    expect(result.value.item.sourceUrl).toBe("https://hdbits.org/details.php?id=593522");
  });

  it("skips detail-page-only rows because they are not downloadable RSS items", () => {
    const result = mapPtRssJoinedItem({
      visited: {
        _id: { id: "97510", site: "hdroute.org" },
        title: "(电影)回归之路-The Comeback Trail 2020 1080p Blu-ray AVC DTS-HD MA 5.1-BDA",
        link: "http://hdroute.org/details.php?id=97510&hit=1",
        links: [
          {
            rel: "alternate",
            type: "text/html",
            href: "http://hdroute.org/details.php?id=97510&hit=1"
          }
        ]
      }
    });

    expect(result).toEqual({
      status: "skipped",
      reason: "missing_torrent_url",
      mongoId: { id: "97510", site: "hdroute.org" }
    });
  });
});
