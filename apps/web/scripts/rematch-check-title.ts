import { loadConfig } from "../src/server/config.js";
import { prisma } from "../src/server/db.js";
import { matchParsedReleaseForItem } from "../src/server/modules/media/media.service.js";

type Candidate = {
  itemId: string;
  tenantId: string;
  matchId: string;
  mediaType: string;
  providerSource: string | null;
  confidence: number | null;
};

const concurrency = Number(process.env.REMATCH_CONCURRENCY ?? 4);
const config = loadConfig();

const candidates = await prisma.$queryRaw<Candidate[]>`
  WITH active AS (
    SELECT DISTINCT ON (pr.id)
      i.id AS "itemId",
      i."tenantId" AS "tenantId",
      pr."mediaType"::text AS "mediaType",
      m.id AS "matchId",
      m.confidence,
      pmm."providerSource",
      COALESCE(NULLIF(pmm.payload->>'posterPath', ''), NULL) AS poster_path,
      m.status,
      m.source,
      m.reason,
      m."matchedAt",
      m."updatedAt"
    FROM "ParsedRelease" pr
    JOIN "RssItem" i ON i.id = pr."rssItemId" AND i."tenantId" = pr."tenantId"
    JOIN "ParsedReleaseMatch" m ON m."parsedReleaseId" = pr.id AND m."tenantId" = pr."tenantId"
    LEFT JOIN "ProviderMediaMetadata" pmm ON pmm.id = m."providerMediaMetadataId"
    WHERE m."invalidatedAt" IS NULL
      AND m.status IN ('MATCHED', 'UNMATCHED')
    ORDER BY pr.id, m."matchedAt" DESC NULLS LAST, m."updatedAt" DESC
  )
  SELECT "itemId", "tenantId", "matchId", "mediaType", "providerSource", confidence
  FROM active
  WHERE status = 'UNMATCHED'
    OR (
      status = 'MATCHED'
      AND source = 'AUTO'
      AND (
        confidence < 0.88
        OR reason = 'automatic_low_confidence_match'
        OR poster_path IS NULL
      )
    )
  ORDER BY "mediaType", "providerSource", "itemId"
`;

console.log(JSON.stringify({ event: "selected", count: candidates.length, concurrency }));

let index = 0;
let processed = 0;
let matched = 0;
let unmatched = 0;
let failed = 0;
let unchanged = 0;
let providerChanged = 0;
let nowClean = 0;
const byOldProvider: Record<string, number> = {};
const byNewProvider: Record<string, number> = {};
const errors: Array<{ itemId: string; message: string }> = [];
const startedAt = Date.now();

function key(value: unknown) {
  return typeof value === "string" && value ? value : "unknown";
}

async function worker() {
  while (true) {
    const currentIndex = index++;
    if (currentIndex >= candidates.length) return;
    const candidate = candidates[currentIndex]!;
    byOldProvider[key(candidate.providerSource)] = (byOldProvider[key(candidate.providerSource)] ?? 0) + 1;

    try {
      const result = await matchParsedReleaseForItem({
        tenantId: candidate.tenantId,
        itemId: candidate.itemId,
        config
      });

      if (result.status === "MATCHED") matched += 1;
      else unmatched += 1;
      if (result.id === candidate.matchId) unchanged += 1;

      const newProviderSource = key(result.providerMediaMetadata?.providerSource);
      byNewProvider[newProviderSource] = (byNewProvider[newProviderSource] ?? 0) + 1;
      if (newProviderSource !== key(candidate.providerSource)) providerChanged += 1;
      if (result.status === "MATCHED" && typeof result.confidence === "number" && result.confidence >= 0.88) {
        nowClean += 1;
      }
    } catch (error) {
      failed += 1;
      if (errors.length < 20) {
        errors.push({
          itemId: candidate.itemId,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    processed += 1;
    if (processed % 100 === 0 || processed === candidates.length) {
      const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      console.log(JSON.stringify({
        event: "progress",
        processed,
        total: candidates.length,
        matched,
        unmatched,
        failed,
        unchanged,
        providerChanged,
        nowClean,
        elapsedSeconds,
        perSecond: Number((processed / elapsedSeconds).toFixed(2))
      }));
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
console.log(JSON.stringify({
  event: "finished",
  selected: candidates.length,
  processed,
  matched,
  unmatched,
  failed,
  unchanged,
  providerChanged,
  nowClean,
  byOldProvider,
  byNewProvider,
  errors
}, null, 2));
await prisma.$disconnect();
