import { describe, expect, it } from "vitest";
import {
  compareParsedRelease,
  evaluateParserItem,
  parserGateFailures,
  summarizeParserEvaluations
} from "../src/server/modules/feeds/parserEvaluation.js";

describe("parser evaluation", () => {
  it("reports no changes for a persisted parse that matches current parser output", () => {
    const result = evaluateParserItem({
      id: "item-1",
      rawTitle: "Example.Movie.2024.2160p.WEB-DL.H264-GROUP",
      sizeBytes: 123n,
      releaseSignature: "title=example movie|mediaType=movie|year=2024|season=|episode=|episodeEnd=|quality=2160p|source=web-dl|codec=h.264|audio=|group=group|size=123",
      parsedRelease: {
        title: "Example Movie",
        year: 2024,
        mediaType: "MOVIE",
        season: null,
        episode: null,
        episodeEnd: null,
        resolution: 2160,
        quality: "2160p",
        source: "WEB-DL",
        codec: "H.264",
        audio: null,
        releaseGroup: "GROUP",
        parseConfidence: 0.85
      }
    });

    expect(result.changes).toEqual([]);
  });

  it("flags known media that would now parse as UNKNOWN", () => {
    const changes = compareParsedRelease({
      title: "Old Movie",
      year: 2024,
      mediaType: "MOVIE",
      season: null,
      episode: null,
      episodeEnd: null,
      resolution: null,
      quality: null,
      source: null,
      codec: null,
      audio: null,
      releaseGroup: null,
      parseConfidence: 0.8
    }, {
      title: "Old Movie",
      mediaType: "UNKNOWN",
      parseConfidence: 0.2
    }, {
      previousReleaseSignature: "old",
      nextReleaseSignature: "new"
    });

    expect(changes).toEqual(expect.arrayContaining([
      "media_type_changed",
      "known_media_to_unknown",
      "release_signature_changed"
    ]));
  });

  it("summarizes parser changes and gate failures", () => {
    const changed = evaluateParserItem({
      id: "item-2",
      rawTitle: "Example.Show.S01E02.1080p.WEB-DL.H264-GROUP",
      parsedRelease: null
    });
    const summary = summarizeParserEvaluations([changed], [], {
      total: 1,
      currentUnknown: 1
    });

    expect(summary).toMatchObject({
      total: 1,
      parsed: 1,
      failed: 0,
      missingPersistedParse: 1,
      changed: 1,
      unknownToKnownMedia: 0
    });
    expect(parserGateFailures({
      ...summary,
      knownMediaToUnknown: 1
    })).toEqual(["1 known-media rows now parse as UNKNOWN"]);
  });
});
