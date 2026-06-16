import { parseReleaseTitle } from "@rss-media/shared/releaseParser";
import { buildReleaseSignature } from "@rss-media/shared/releaseSignature";
import type { ParsedRelease } from "@rss-media/shared/types";

export type PersistedParsedReleaseSnapshot = {
  title: string;
  providerSearchTitles: string[];
  year: number | null;
  mediaType: ParsedRelease["mediaType"];
  season: number | null;
  episode: number | null;
  episodeEnd: number | null;
  resolution: number | null;
  quality: string | null;
  source: string | null;
  codec: string | null;
  audio: string | null;
  releaseGroup: string | null;
  parseConfidence: number;
};

export type ParserEvaluationItem = {
  id: string;
  feedName?: string | null;
  rawTitle: string;
  sizeBytes?: bigint | null;
  releaseSignature?: string | null;
  parsedRelease?: PersistedParsedReleaseSnapshot | null;
};

export type ParserChangeKind =
  | "missing_persisted_parse"
  | "title_changed"
  | "provider_search_titles_changed"
  | "media_type_changed"
  | "year_changed"
  | "season_changed"
  | "episode_changed"
  | "episode_end_changed"
  | "resolution_changed"
  | "quality_changed"
  | "source_changed"
  | "codec_changed"
  | "audio_changed"
  | "release_group_changed"
  | "parse_confidence_changed"
  | "release_signature_changed"
  | "known_media_to_unknown"
  | "unknown_to_known_media";

export type ParserEvaluationResult = {
  itemId: string;
  feedName?: string | null;
  rawTitle: string;
  parsed: ParsedRelease;
  releaseSignature?: string;
  changes: ParserChangeKind[];
};

export type ParserEvaluationFailure = {
  itemId: string;
  feedName?: string | null;
  rawTitle: string;
  message: string;
};

export type ParserCorpusSummary = {
  total: number;
  parsed: number;
  failed: number;
  missingPersistedParse: number;
  unchanged: number;
  changed: number;
  currentUnknown: number;
  nextUnknown: number;
  knownMediaToUnknown: number;
  unknownToKnownMedia: number;
  changesByKind: Record<ParserChangeKind, number>;
};

export function evaluateParserItem(item: ParserEvaluationItem): ParserEvaluationResult {
  const parsed = parseReleaseTitle(item.rawTitle);
  const releaseSignature = buildReleaseSignature(parsed, item.sizeBytes ?? undefined);
  const changes = compareParsedRelease(item.parsedRelease ?? null, parsed, {
    previousReleaseSignature: item.releaseSignature ?? undefined,
    nextReleaseSignature: releaseSignature
  });

  return {
    itemId: item.id,
    feedName: item.feedName,
    rawTitle: item.rawTitle,
    parsed,
    releaseSignature,
    changes
  };
}

export function compareParsedRelease(
  previous: PersistedParsedReleaseSnapshot | null,
  next: ParsedRelease,
  input: { previousReleaseSignature?: string | null; nextReleaseSignature?: string }
): ParserChangeKind[] {
  if (!previous) return ["missing_persisted_parse"];

  const changes: ParserChangeKind[] = [];
  pushIf(changes, previous.title !== next.title, "title_changed");
  pushIf(
    changes,
    !stringArraysEqual(previous.providerSearchTitles, next.providerSearchTitles ?? []),
    "provider_search_titles_changed"
  );
  pushIf(changes, previous.mediaType !== next.mediaType, "media_type_changed");
  pushIf(changes, previous.year !== (next.year ?? null), "year_changed");
  pushIf(changes, previous.season !== (next.season ?? null), "season_changed");
  pushIf(changes, previous.episode !== (next.episode ?? null), "episode_changed");
  pushIf(changes, previous.episodeEnd !== (next.episodeEnd ?? null), "episode_end_changed");
  pushIf(changes, previous.resolution !== (next.resolution ?? null), "resolution_changed");
  pushIf(changes, previous.quality !== (next.quality ?? null), "quality_changed");
  pushIf(changes, previous.source !== (next.source ?? null), "source_changed");
  pushIf(changes, previous.codec !== (next.codec ?? null), "codec_changed");
  pushIf(changes, previous.audio !== (next.audio ?? null), "audio_changed");
  pushIf(changes, previous.releaseGroup !== (next.releaseGroup ?? null), "release_group_changed");
  pushIf(changes, previous.parseConfidence !== next.parseConfidence, "parse_confidence_changed");
  pushIf(
    changes,
    (input.previousReleaseSignature ?? null) !== (input.nextReleaseSignature ?? null),
    "release_signature_changed"
  );
  pushIf(changes, previous.mediaType !== "UNKNOWN" && next.mediaType === "UNKNOWN", "known_media_to_unknown");
  pushIf(changes, previous.mediaType === "UNKNOWN" && next.mediaType !== "UNKNOWN", "unknown_to_known_media");
  return changes;
}

export function summarizeParserEvaluations(
  results: ParserEvaluationResult[],
  failures: ParserEvaluationFailure[],
  input: { total: number; currentUnknown: number }
): ParserCorpusSummary {
  const changesByKind = emptyChangesByKind();
  for (const result of results) {
    for (const change of result.changes) {
      changesByKind[change] += 1;
    }
  }

  return {
    total: input.total,
    parsed: results.length,
    failed: failures.length,
    missingPersistedParse: changesByKind.missing_persisted_parse,
    unchanged: results.filter((result) => result.changes.length === 0).length,
    changed: results.filter((result) => result.changes.length > 0).length,
    currentUnknown: input.currentUnknown,
    nextUnknown: results.filter((result) => result.parsed.mediaType === "UNKNOWN").length,
    knownMediaToUnknown: changesByKind.known_media_to_unknown,
    unknownToKnownMedia: changesByKind.unknown_to_known_media,
    changesByKind
  };
}

export function parserGateFailures(
  summary: ParserCorpusSummary,
  baseline?: Pick<ParserCorpusSummary, "total" | "failed" | "nextUnknown">
) {
  const failures: string[] = [];
  if (baseline && summary.failed > baseline.failed) {
    failures.push(`parse failures increased from ${baseline.failed} to ${summary.failed}`);
  }
  if (baseline) {
    const previousUnknownRate = percentage(baseline.nextUnknown, baseline.total);
    const nextUnknownRate = percentage(summary.nextUnknown, summary.total);
    if (nextUnknownRate - previousUnknownRate > 0.5) {
      failures.push(`UNKNOWN parser rate increased from ${previousUnknownRate.toFixed(2)}% to ${nextUnknownRate.toFixed(2)}%`);
    }
  }
  if (summary.knownMediaToUnknown > 0) {
    failures.push(`${summary.knownMediaToUnknown} known-media rows now parse as UNKNOWN`);
  }
  return failures;
}

export function percentage(count: number, total: number) {
  return total === 0 ? 0 : (count / total) * 100;
}

function pushIf<T>(values: T[], condition: boolean, value: T) {
  if (condition) values.push(value);
}

function emptyChangesByKind(): Record<ParserChangeKind, number> {
  return {
    missing_persisted_parse: 0,
    title_changed: 0,
    provider_search_titles_changed: 0,
    media_type_changed: 0,
    year_changed: 0,
    season_changed: 0,
    episode_changed: 0,
    episode_end_changed: 0,
    resolution_changed: 0,
    quality_changed: 0,
    source_changed: 0,
    codec_changed: 0,
    audio_changed: 0,
    release_group_changed: 0,
    parse_confidence_changed: 0,
    release_signature_changed: 0,
    known_media_to_unknown: 0,
    unknown_to_known_media: 0
  };
}

function stringArraysEqual(left: string[] | null | undefined, right: string[] | null | undefined) {
  const leftValues = left ?? [];
  const rightValues = right ?? [];
  return leftValues.length === rightValues.length &&
    leftValues.every((value, index) => value === rightValues[index]);
}
