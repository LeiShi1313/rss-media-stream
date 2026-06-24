import { describe, expect, it } from "vitest";
import {
  extractRssDownloadSizeBytes,
  extractRssDownloadUrl,
  extractInfoHash,
  extractRssSourceUrl,
  extractRssTorrentUrl,
  isLikelyTorrentDownloadUrl,
  normalizeInfoHash,
  parseHumanSizeBytes,
  parsePositiveBigInt,
  parseRssDate
} from "../src/rss.js";

describe("RSS item utilities", () => {
  it("prefers torrent enclosures over detail page links", () => {
    const item = {
      link: "https://tracker.example/details.php?id=10",
      links: [
        {
          rel: "alternate",
          type: "text/html",
          href: "https://tracker.example/details.php?id=10"
        },
        {
          rel: "enclosure",
          type: "application/x-bittorrent",
          href: "https://tracker.example/download.php?id=10&passkey=secret"
        }
      ]
    };

    expect(extractRssTorrentUrl(item)).toBe("https://tracker.example/download.php?id=10&passkey=secret");
    expect(extractRssSourceUrl(item, "https://tracker.example/download.php?id=10&passkey=secret")).toBe(
      "https://tracker.example/details.php?id=10"
    );
  });

  it("extracts strict download URLs without treating detail pages as torrents", () => {
    expect(extractRssDownloadUrl({
      link: "https://tracker.example/details.php?id=10",
      links: [
        {
          rel: "alternate",
          type: "text/html",
          href: "https://tracker.example/details.php?id=10"
        }
      ]
    })).toBeUndefined();

    expect(extractRssDownloadUrl({
      link: "https://tracker.example/download.php?id=11&source=rss"
    })).toBe("https://tracker.example/download.php?id=11&source=rss");

    expect(isLikelyTorrentDownloadUrl("https://tracker.example/file.torrent?passkey=secret")).toBe(true);
    expect(isLikelyTorrentDownloadUrl("https://tracker.example/details.php?id=12")).toBe(false);
  });

  it("extracts download size from matching RSS enclosure links", () => {
    const downloadUrl = "https://tracker.example/download.php?id=10&passkey=secret";
    expect(extractRssDownloadSizeBytes({
      links: [
        {
          rel: "enclosure",
          type: "application/x-bittorrent",
          href: downloadUrl,
          length: "12345"
        }
      ]
    }, downloadUrl)).toBe(12345n);
  });

  it("falls back to magnet, link, and URL-like guid for torrent URLs", () => {
    expect(extractRssTorrentUrl({ torrentMagnetUri: "magnet:?xt=urn:btih:ABCDEF" })).toBe(
      "magnet:?xt=urn:btih:ABCDEF"
    );
    expect(extractRssTorrentUrl({ link: "https://tracker.example/download.php?id=11" })).toBe(
      "https://tracker.example/download.php?id=11"
    );
    expect(extractRssTorrentUrl({ guid: "https://tracker.example/download.php?id=12" })).toBe(
      "https://tracker.example/download.php?id=12"
    );
  });

  it("normalizes info hashes from magnets and raw values", () => {
    expect(extractInfoHash("magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12")).toBe(
      "ABCDEF1234567890ABCDEF1234567890ABCDEF12"
    );
    expect(normalizeInfoHash("ABCDEF1234567890ABCDEF1234567890ABCDEF12")).toBe(
      "abcdef1234567890abcdef1234567890abcdef12"
    );
    expect(normalizeInfoHash("not-a-hash")).toBeUndefined();
  });

  it("parses dates and sizes without accepting invalid values", () => {
    expect(parseRssDate("2026-06-24T10:00:00Z")?.toISOString()).toBe("2026-06-24T10:00:00.000Z");
    expect(parseRssDate("not a date")).toBeUndefined();

    expect(parsePositiveBigInt("123")).toBe(123n);
    expect(parsePositiveBigInt("0")).toBeUndefined();
    expect(parsePositiveBigInt("12.5")).toBeUndefined();

    expect(parseHumanSizeBytes("1.5 GB")).toBe(1610612736n);
    expect(parseHumanSizeBytes("422.63 MB")).toBe(443159674n);
    expect(parseHumanSizeBytes("unknown")).toBeUndefined();
  });
});
