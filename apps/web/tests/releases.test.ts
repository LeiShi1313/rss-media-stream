import { describe, expect, it } from "vitest";
import type { Item } from "../src/client/api.js";
import { releaseIdentityState, releaseStatus, releaseTitle } from "../src/client/lib/releases.js";

function item(input: Partial<Item>): Item {
  return {
    id: "item-1",
    rawTitle: "Raw.Movie.2026.1080p.WEB-DL-GRP",
    firstSeenAt: new Date("2026-06-01T10:00:00Z").toISOString(),
    ...input
  };
}

describe("release identity", () => {
  it("treats only MATCHED media as resolved", () => {
    const release = item({
      parsedRelease: {
        title: "Raw Movie",
        kind: "MOVIE",
        confidence: 0.85
      },
      mediaMatch: {
        id: "match-1",
        provider: "tmdb",
        providerId: "100",
        kind: "MOVIE",
        title: "Canonical Movie",
        score: 0.98,
        status: "MATCHED"
      }
    });

    expect(releaseIdentityState(release)).toBe("resolved");
    expect(releaseTitle(release)).toBe("Canonical Movie");
    expect(releaseStatus(release)).toMatchObject({
      labelKey: "release.status.ready",
      ok: true
    });
  });

  it("keeps candidates in review and shows the parsed title", () => {
    const release = item({
      parsedRelease: {
        title: "Raw Movie",
        kind: "MOVIE",
        confidence: 0.7
      },
      mediaMatch: {
        id: "match-1",
        provider: "tmdb",
        providerId: "100",
        kind: "MOVIE",
        title: "Possible Movie",
        score: 0.72,
        status: "CANDIDATE"
      }
    });

    expect(releaseIdentityState(release)).toBe("review");
    expect(releaseTitle(release)).toBe("Raw Movie");
    expect(releaseStatus(release)).toMatchObject({
      labelKey: "release.status.checkTitle",
      ok: false
    });
  });

  it("routes missing and unmatched identities to title selection", () => {
    expect(releaseIdentityState(item({}))).toBe("unresolved");
    expect(
      releaseStatus(item({ mediaMatch: {
        id: "match-1",
        provider: "tmdb",
        providerId: "unmatched",
        kind: "UNKNOWN",
        title: "Raw Movie",
        score: 0,
        status: "UNMATCHED"
      } }))
    ).toMatchObject({
      labelKey: "release.status.needsTitle",
      ok: false
    });
  });

  it("keeps failed downloads in attention regardless of identity", () => {
    const status = releaseStatus(item({
      mediaMatch: {
        id: "match-1",
        provider: "tmdb",
        providerId: "100",
        kind: "MOVIE",
        title: "Canonical Movie",
        score: 1,
        status: "MATCHED"
      },
      downloadJobs: [{
        id: "job-1",
        status: "FAILED",
        error: "Downloader rejected torrent",
        createdAt: new Date("2026-06-01T11:00:00Z").toISOString()
      }]
    }));

    expect(status).toMatchObject({
      labelKey: "release.status.failed",
      group: "failed",
      ok: false
    });
  });
});
