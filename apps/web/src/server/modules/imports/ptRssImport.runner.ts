import { MongoClient, type Collection } from "mongodb";
import type { AppConfig } from "../../config.js";
import { upsertNormalizedRssItem } from "../feeds/itemIngestion.js";
import { importPtRssProviderMatchesForItem } from "./ptRssImport.service.js";
import {
  mapPtRssJoinedItem,
  type ImportedProviderId,
  type PtRssItemDocument,
  type PtRssMongoId,
  type PtRssVisitedDocument
} from "./ptRssImport.mapper.js";

export type PtRssImportOptions = {
  tenantId: string;
  feedId: string;
  mongoUri: string;
  mongoDb: string;
  site?: string;
  limit?: number;
  batchSize: number;
  providerLimit: number;
  write: boolean;
  resolveProviders: boolean;
};

export type PtRssImportSummary = {
  dryRun: boolean;
  scanned: number;
  mapped: number;
  created: number;
  updated: number;
  skipped: number;
  skippedByReason: Record<string, number>;
  providerEvidence: number;
  providerLookupsAttempted: number;
  providerMatches: number;
  providerSkipped: number;
  providerDeferred: number;
};

type ParsedArgs = {
  values: Map<string, string>;
  booleans: Set<string>;
};

type PtRssCollections = {
  visited: Collection<PtRssVisitedDocument>;
  items: Collection<PtRssItemDocument>;
};

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_PROVIDER_LIMIT = 100;
const KNOWN_FLAGS = new Set([
  "tenant-id",
  "feed-id",
  "mongo-uri",
  "mongo-db",
  "site",
  "limit",
  "batch-size",
  "provider-limit",
  "write",
  "resolve-providers"
]);

export function parsePtRssImportArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): PtRssImportOptions {
  const parsed = parseArgs(argv);
  const mongoUri = optionalOption(parsed, "mongo-uri") ?? env.PT_RSS_MONGO_URI;
  if (!mongoUri) throw new Error("--mongo-uri or PT_RSS_MONGO_URI is required");

  const options = {
    tenantId: requiredOption(parsed, "tenant-id"),
    feedId: requiredOption(parsed, "feed-id"),
    mongoUri,
    mongoDb: optionalOption(parsed, "mongo-db") ?? "pt",
    site: optionalOption(parsed, "site"),
    limit: positiveIntegerOption(parsed, "limit"),
    batchSize: positiveIntegerOption(parsed, "batch-size") ?? DEFAULT_BATCH_SIZE,
    providerLimit: positiveIntegerOption(parsed, "provider-limit") ?? DEFAULT_PROVIDER_LIMIT,
    write: parsed.booleans.has("write"),
    resolveProviders: parsed.booleans.has("resolve-providers")
  };

  if (options.resolveProviders && !options.write) throw new Error("--resolve-providers requires --write");
  return options;
}

export async function runPtRssImport(
  options: PtRssImportOptions,
  config?: AppConfig
): Promise<PtRssImportSummary> {
  if (options.resolveProviders && !config) {
    throw new Error("Provider resolution requires application config");
  }

  const summary = emptySummary(options);
  const client = new MongoClient(options.mongoUri);
  await client.connect();

  try {
    const db = client.db(options.mongoDb);
    const collections = {
      visited: db.collection<PtRssVisitedDocument>("visited"),
      items: db.collection<PtRssItemDocument>("items")
    };
    const query = options.site ? { "_id.site": options.site } : {};
    const cursor = collections.visited
      .find(query)
      .sort({ "_id.site": 1, "_id.id": 1 })
      .batchSize(options.batchSize);
    if (options.limit) cursor.limit(options.limit);

    const batch: PtRssVisitedDocument[] = [];
    for await (const visited of cursor) {
      batch.push(visited);
      if (batch.length >= options.batchSize) {
        await importPtRssBatch({ batch, collections, options, config, summary });
        batch.length = 0;
      }
    }
    if (batch.length > 0) {
      await importPtRssBatch({ batch, collections, options, config, summary });
    }
  } finally {
    await client.close();
  }

  return summary;
}

async function importPtRssBatch(input: {
  batch: PtRssVisitedDocument[];
  collections: PtRssCollections;
  options: PtRssImportOptions;
  config?: AppConfig;
  summary: PtRssImportSummary;
}) {
  const itemRows = await input.collections.items.find({
    _id: { $in: input.batch.map((visited) => visited._id) }
  }).toArray();
  const itemById = new Map(itemRows.map((item) => [ptRssMongoIdKey(item._id), item]));

  for (const visited of input.batch) {
    input.summary.scanned += 1;
    const mapped = mapPtRssJoinedItem({
      visited,
      item: itemById.get(ptRssMongoIdKey(visited._id))
    });

    if (mapped.status === "skipped") {
      input.summary.skipped += 1;
      input.summary.skippedByReason[mapped.reason] = (input.summary.skippedByReason[mapped.reason] ?? 0) + 1;
      continue;
    }

    input.summary.mapped += 1;
    input.summary.providerEvidence += mapped.value.importedProviderIds.length;

    if (!input.options.write) {
      input.summary.providerDeferred += mapped.value.importedProviderIds.length;
      continue;
    }

    const upserted = await upsertNormalizedRssItem({
      tenantId: input.options.tenantId,
      feedId: input.options.feedId,
      item: mapped.value.item,
      rawPayload: mapped.value.rawPayload
    });
    if (upserted.created) input.summary.created += 1;
    if (upserted.updated) input.summary.updated += 1;

    if (input.options.resolveProviders && input.config) {
      await importProviderMatches({
        itemId: upserted.itemId,
        importedProviderIds: mapped.value.importedProviderIds,
        options: input.options,
        config: input.config,
        summary: input.summary
      });
    } else {
      input.summary.providerDeferred += mapped.value.importedProviderIds.length;
    }
  }
}

async function importProviderMatches(input: {
  itemId: string;
  importedProviderIds: ImportedProviderId[];
  options: PtRssImportOptions;
  config: AppConfig;
  summary: PtRssImportSummary;
}) {
  const remaining = input.options.providerLimit - input.summary.providerLookupsAttempted;
  if (remaining <= 0) {
    input.summary.providerDeferred += input.importedProviderIds.length;
    return;
  }

  const providerIds = input.importedProviderIds.slice(0, remaining);
  input.summary.providerLookupsAttempted += providerIds.length;
  input.summary.providerDeferred += input.importedProviderIds.length - providerIds.length;

  const results = await importPtRssProviderMatchesForItem({
    tenantId: input.options.tenantId,
    itemId: input.itemId,
    config: input.config,
    importedProviderIds: providerIds
  });
  input.summary.providerMatches += results.filter((result) => result.status === "matched").length;
  input.summary.providerSkipped += results.filter((result) => result.status === "skipped").length;
}

function emptySummary(options: PtRssImportOptions): PtRssImportSummary {
  return {
    dryRun: !options.write,
    scanned: 0,
    mapped: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    skippedByReason: {},
    providerEvidence: 0,
    providerLookupsAttempted: 0,
    providerMatches: 0,
    providerSkipped: 0,
    providerDeferred: 0
  };
}

function parseArgs(argv: string[]): ParsedArgs {
  const values = new Map<string, string>();
  const booleans = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    if (!KNOWN_FLAGS.has(rawKey)) throw new Error(`Unknown option: --${rawKey}`);
    if (rawKey === "write" || rawKey === "resolve-providers") {
      booleans.add(rawKey);
      continue;
    }

    const value = inlineValue ?? argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`--${rawKey} requires a value`);
    values.set(rawKey, value);
    if (inlineValue === undefined) index += 1;
  }

  return { values, booleans };
}

function requiredOption(parsed: ParsedArgs, key: string): string {
  const value = optionalOption(parsed, key);
  if (!value) throw new Error(`--${key} is required`);
  return value;
}

function optionalOption(parsed: ParsedArgs, key: string): string | undefined {
  const value = parsed.values.get(key)?.trim();
  return value || undefined;
}

function positiveIntegerOption(parsed: ParsedArgs, key: string): number | undefined {
  const value = optionalOption(parsed, key);
  if (!value) return undefined;
  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`--${key} must be a positive integer`);
  }
  return parsedValue;
}

function ptRssMongoIdKey(id: PtRssMongoId): string {
  return `${id.site}:${id.id}`;
}
