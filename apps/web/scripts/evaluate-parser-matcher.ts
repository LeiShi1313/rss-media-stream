import { readFile } from "node:fs/promises";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/server/db.js";
import {
  evaluateParserItem,
  parserGateFailures,
  percentage,
  summarizeParserEvaluations,
  type ParserCorpusSummary,
  type ParserEvaluationFailure,
  type ParserEvaluationResult
} from "../src/server/modules/feeds/parserEvaluation.js";

const args = new Set(process.argv.slice(2));
const jsonOutput = args.has("--json");
const markdownOutput = args.has("--markdown") || !jsonOutput;
const batchSize = Number(process.env.PARSER_EVAL_BATCH_SIZE ?? 500);
const sampleLimit = Number(process.env.PARSER_EVAL_SAMPLE_LIMIT ?? 30);
const baselinePath = valueAfter("--baseline");
const baseline = baselinePath ? await loadBaseline(baselinePath) : undefined;

type BaselineReport = {
  parser?: ParserCorpusSummary;
};

type ParserEvalReport = {
  generatedAt: string;
  mode: "read_only";
  parser: ParserCorpusSummary;
  gateFailures: string[];
  samples: ParserEvaluationSample[];
  failures: ParserEvaluationFailure[];
  baselinePath?: string;
};

type ParserEvaluationSample = {
  itemId: string;
  feedName?: string | null;
  changes: string[];
  rawTitle: string;
  previous?: {
    title: string;
    mediaType: string;
    year?: number | null;
    season?: number | null;
    episode?: number | null;
  };
  next: {
    title: string;
    mediaType: string;
    year?: number;
    season?: number;
    episode?: number;
  };
};

const report = await prisma.$transaction(async (tx) => {
  await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");

  const total = await tx.rssItem.count();
  let cursor: string | undefined;
  let currentUnknown = 0;
  const results: ParserEvaluationResult[] = [];
  const failures: ParserEvaluationFailure[] = [];
  const samples: ParserEvaluationSample[] = [];

  while (true) {
    const items = await tx.rssItem.findMany({
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true,
        rawTitle: true,
        sizeBytes: true,
        releaseSignature: true,
        feed: { select: { name: true } },
        parsedRelease: {
          select: {
            title: true,
            providerSearchTitles: true,
            year: true,
            mediaType: true,
            season: true,
            episode: true,
            episodeEnd: true,
            resolution: true,
            quality: true,
            source: true,
            codec: true,
            audio: true,
            releaseGroup: true,
            parseConfidence: true
          }
        }
      }
    });
    if (items.length === 0) break;
    cursor = items[items.length - 1]!.id;

    for (const item of items) {
      if (item.parsedRelease?.mediaType === "UNKNOWN") currentUnknown += 1;
      try {
        const result = evaluateParserItem({
          id: item.id,
          feedName: item.feed.name,
          rawTitle: item.rawTitle,
          sizeBytes: item.sizeBytes,
          releaseSignature: item.releaseSignature,
          parsedRelease: item.parsedRelease
        });
        results.push(result);
        if (result.changes.length > 0) {
          samples.push(toSample(result, item.parsedRelease));
        }
      } catch (error) {
        failures.push({
          itemId: item.id,
          feedName: item.feed.name,
          rawTitle: item.rawTitle,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  const parser = summarizeParserEvaluations(results, failures, {
    total,
    currentUnknown
  });

  return {
    generatedAt: new Date().toISOString(),
    mode: "read_only" as const,
    parser,
    gateFailures: parserGateFailures(parser, baseline?.parser),
    samples: prioritizeSamples(samples).slice(0, sampleLimit),
    failures: failures.slice(0, sampleLimit),
    baselinePath
  } satisfies ParserEvalReport;
}, {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  maxWait: 10_000,
  timeout: 120_000
});

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
}
if (markdownOutput) {
  console.log(renderMarkdown(report));
}

if (report.gateFailures.length > 0) {
  process.exitCode = 1;
}

await prisma.$disconnect();

function toSample(
  result: ParserEvaluationResult,
  previous: ParserEvaluationSample["previous"] | null
): ParserEvaluationSample {
  return {
    itemId: result.itemId,
    feedName: result.feedName,
    changes: result.changes,
    rawTitle: result.rawTitle,
    previous: previous
      ? {
          title: previous.title,
          mediaType: previous.mediaType,
          year: previous.year,
          season: previous.season,
          episode: previous.episode
        }
      : undefined,
    next: {
      title: result.parsed.title,
      mediaType: result.parsed.mediaType,
      year: result.parsed.year,
      season: result.parsed.season,
      episode: result.parsed.episode
    }
  };
}

function prioritizeSamples(samples: ParserEvaluationSample[]) {
  const priority = [
    "known_media_to_unknown",
    "media_type_changed",
    "provider_search_titles_changed",
    "title_changed",
    "year_changed",
    "season_changed",
    "episode_changed",
    "release_signature_changed"
  ];
  return [...samples].sort((left, right) =>
    sampleRank(left, priority) - sampleRank(right, priority) ||
    left.itemId.localeCompare(right.itemId)
  );
}

function sampleRank(sample: ParserEvaluationSample, priority: string[]) {
  const ranks = sample.changes.map((change) => {
    const index = priority.indexOf(change);
    return index === -1 ? priority.length : index;
  });
  return Math.min(...ranks);
}

function renderMarkdown(report: ParserEvalReport) {
  const parser = report.parser;
  const lines = [
    "# Parser Corpus Evaluation",
    "",
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    report.baselinePath ? `Baseline: ${report.baselinePath}` : "Baseline: none",
    "",
    "## Summary",
    "",
    `- RSS items: ${parser.total}`,
    `- Parsed: ${parser.parsed}`,
    `- Parse failures: ${parser.failed}`,
    `- Unchanged: ${parser.unchanged}`,
    `- Changed: ${parser.changed}`,
    `- Current UNKNOWN: ${parser.currentUnknown} (${percentage(parser.currentUnknown, parser.total).toFixed(2)}%)`,
    `- Next UNKNOWN: ${parser.nextUnknown} (${percentage(parser.nextUnknown, parser.total).toFixed(2)}%)`,
    `- Known media -> UNKNOWN: ${parser.knownMediaToUnknown}`,
    `- UNKNOWN -> known media: ${parser.unknownToKnownMedia}`,
    "",
    "## Gate Status",
    "",
    report.gateFailures.length === 0
      ? "- PASS"
      : report.gateFailures.map((failure) => `- FAIL: ${failure}`).join("\n"),
    "",
    "## Changes By Kind",
    "",
    ...Object.entries(parser.changesByKind)
      .filter(([, count]) => count > 0)
      .map(([kind, count]) => `- ${kind}: ${count}`)
  ];

  if (report.samples.length > 0) {
    lines.push("", "## Sample Changes", "");
    for (const sample of report.samples) {
      lines.push(
        `- ${sample.itemId}${sample.feedName ? ` (${sample.feedName})` : ""}: ${sample.changes.join(", ")}`,
        `  - previous: ${sample.previous?.title ?? "(none)"} / ${sample.previous?.mediaType ?? "(none)"} / ${sample.previous?.year ?? ""}`,
        `  - next: ${sample.next.title} / ${sample.next.mediaType} / ${sample.next.year ?? ""}`,
        `  - raw: ${sample.rawTitle}`
      );
    }
  }

  if (report.failures.length > 0) {
    lines.push("", "## Parse Failures", "");
    for (const failure of report.failures) {
      lines.push(`- ${failure.itemId}: ${failure.message}`);
    }
  }

  return lines.join("\n");
}

async function loadBaseline(path: string): Promise<BaselineReport> {
  const text = await readFile(path, "utf8");
  return JSON.parse(text) as BaselineReport;
}

function valueAfter(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
