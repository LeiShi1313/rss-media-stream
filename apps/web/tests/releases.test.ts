import { describe, expect, it } from "vitest";
import type { Item } from "../src/client/api.js";
import { itemMatchState, releaseIdentityState, releaseStatus, releaseTitle } from "../src/client/lib/releases.js";

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
      match: {
        id: "match-1",
        status: "MATCHED",
        source: "AUTO",
        confidence: 0.98,
        providerTitle: {
          provider: "tmdb",
          providerEntityType: "tmdb_movie",
          providerId: "100"
        },
        presentation: {
          mediaType: "MOVIE",
          title: "Canonical Movie",
          releaseYear: 2026,
          hasCover: true,
          posterUrl: "https://image.tmdb.org/t/p/w342/poster.jpg"
        },
        attention: { required: false, reasons: [] }
      }
    });

    expect(releaseIdentityState(release)).toBe("resolved");
    expect(releaseTitle(release)).toBe("Canonical Movie");
    expect(itemMatchState(release)).toBe("matched");
    expect(releaseStatus(release)).toMatchObject({
      labelKey: "release.status.ready",
      ok: true
    });
  });

  it("keeps low-confidence automatic matches displayable but in review", () => {
    const release = item({
      parsedRelease: {
        title: "Raw Movie",
        kind: "MOVIE",
        confidence: 0.7
      },
      match: {
        id: "match-1",
        status: "MATCHED",
        source: "AUTO",
        confidence: 0.72,
        reason: "automatic_low_confidence_match",
        providerTitle: {
          provider: "tmdb",
          providerEntityType: "tmdb_movie",
          providerId: "100"
        },
        presentation: {
          mediaType: "MOVIE",
          title: "Possible Movie",
          releaseYear: 2026,
          hasCover: true,
          posterUrl: "https://image.tmdb.org/t/p/w342/poster.jpg"
        },
        attention: { required: true, reasons: ["low_confidence"] }
      }
    });

    expect(releaseIdentityState(release)).toBe("review");
    expect(releaseTitle(release)).toBe("Possible Movie");
    expect(itemMatchState(release)).toBe("review");
    expect(releaseStatus(release)).toMatchObject({
      labelKey: "release.status.checkTitle",
      ok: false
    });
  });

  it("treats manual provider matches as manual overrides", () => {
    const release = item({
      match: {
        id: "match-1",
        status: "MATCHED",
        source: "MANUAL",
        confidence: 1,
        reason: "manual_provider_identity",
        providerTitle: {
          provider: "tmdb",
          providerEntityType: "tmdb_movie",
          providerId: "100"
        },
        presentation: {
          mediaType: "MOVIE",
          title: "Canonical Movie",
          hasCover: true
        },
        attention: { required: false, reasons: [] }
      }
    });

    expect(releaseIdentityState(release)).toBe("resolved");
    expect(itemMatchState(release)).toBe("manual_override");
    expect(releaseStatus(release)).toMatchObject({
      labelKey: "release.status.manualOverride",
      ok: true
    });
  });

  it("routes missing and unmatched identities to title selection", () => {
    expect(releaseIdentityState(item({}))).toBe("unresolved");
    expect(
      releaseStatus(item({ match: {
        id: "match-1",
        status: "UNMATCHED",
        source: "AUTO",
        reason: "unknown_media_type",
        presentation: {
          mediaType: "UNKNOWN",
          title: "Raw Movie",
          hasCover: false
        },
        attention: {
          required: true,
          reasons: ["unmatched", "unknown_media_type", "no_cover"]
        }
      } }))
    ).toMatchObject({
      labelKey: "release.status.needsTitle",
      ok: false
    });
  });

  it("shows parsed releases without an active match as processing while enrichment is pending", () => {
    const pending = item({
      enrichmentState: "PENDING",
      parsedRelease: {
        title: "Raw Movie",
        kind: "MOVIE",
        confidence: 0.85
      }
    });

    expect(releaseIdentityState(pending)).toBe("unresolved");
    expect(itemMatchState(pending)).toBe("pending");
    expect(releaseStatus(pending)).toMatchObject({
      labelKey: "release.status.processing",
      ok: false
    });
  });

  it("keeps explicitly unmatched releases in title selection", () => {
    expect(itemMatchState(item({ enrichmentState: "UNMATCHED" }))).toBe("unmatched");
  });

  it("keeps failed downloads in attention regardless of identity", () => {
    const status = releaseStatus(item({
      match: {
        id: "match-1",
        status: "MATCHED",
        source: "AUTO",
        confidence: 1,
        presentation: {
          mediaType: "MOVIE",
          title: "Canonical Movie",
          hasCover: true
        },
        attention: { required: false, reasons: [] }
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
