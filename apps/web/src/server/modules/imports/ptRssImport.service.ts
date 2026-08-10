import { redactSecrets } from "@rss-media/shared/redact";
import type { MediaType } from "@rss-media/shared/types";
import type { AppConfig } from "../../config.js";
import { prisma } from "../../db.js";
import type { ProviderMetadataCandidate } from "../../integrations/providers/types.js";
import { lookupProviderMediaMetadata } from "../media/providerDiscovery.js";
import { upsertProviderMediaMetadata } from "../media/providerIdentity.js";
import { createMatchedParsedReleaseMatch } from "../media/releaseMatchLedger.js";
import type { ImportedProviderId } from "./ptRssImport.mapper.js";

export type PtRssProviderMatchImportResult =
  | {
    status: "matched";
    providerSource: ImportedProviderId["providerSource"];
    provider: ImportedProviderId["provider"];
    providerId: string;
    matchId: string;
    mediaTitleId: string;
    providerMediaMetadataId: string;
  }
  | {
    status: "skipped";
    providerSource: ImportedProviderId["providerSource"];
    provider: ImportedProviderId["provider"];
    providerId: string;
    reason: "item_not_parsed" | "lookup_failed";
    error?: string;
  };

type ResolvedProviderMatch = {
  evidence: ImportedProviderId;
  metadata: ProviderMetadataCandidate;
};

export async function importPtRssProviderMatchesForItem(input: {
  tenantId: string;
  itemId: string;
  config: AppConfig;
  importedProviderIds: ImportedProviderId[];
}): Promise<PtRssProviderMatchImportResult[]> {
  if (input.importedProviderIds.length === 0) return [];

  const item = await prisma.rssItem.findFirst({
    where: { id: input.itemId, tenantId: input.tenantId },
    include: { parsedRelease: true }
  });

  if (!item?.parsedRelease) {
    return input.importedProviderIds.map((evidence) => skippedProviderMatch(evidence, "item_not_parsed"));
  }

  const mediaType = item.parsedRelease.mediaType === "MOVIE" || item.parsedRelease.mediaType === "TV_SERIES"
    ? item.parsedRelease.mediaType
    : undefined;
  const skipped: PtRssProviderMatchImportResult[] = [];
  const resolved: ResolvedProviderMatch[] = [];

  for (const evidence of dedupeImportedProviderIds(input.importedProviderIds)) {
    try {
      resolved.push({
        evidence,
        metadata: await lookupProviderMediaMetadata(input.config, input.tenantId, evidence.providerSource, {
          providerEntityType: evidence.providerSource,
          providerId: evidence.providerId,
          mediaType
        })
      });
    } catch (error) {
      skipped.push(skippedProviderMatch(evidence, "lookup_failed", error));
    }
  }

  if (resolved.length === 0) return skipped;

  const matched = await prisma.$transaction(async (tx) => {
    const results: PtRssProviderMatchImportResult[] = [];
    for (const entry of resolved) {
      const providerMetadata = await upsertProviderMediaMetadata(tx, entry.metadata, {
        linkConfidence: 1,
        linkSource: "IMPORT"
      });
      const match = await createMatchedParsedReleaseMatch(tx, {
        tenantId: input.tenantId,
        parsedReleaseId: item.parsedRelease!.id,
        mediaTitleId: providerMetadata.mediaTitle.id,
        mediaProviderIdentityId: providerMetadata.identity.id,
        providerMediaMetadataId: providerMetadata.metadata.id,
        mediaType: providerMetadata.mediaTitle.mediaType as MediaType,
        source: "AUTO",
        confidence: 1,
        reason: "imported_provider_identity",
        replaceActive: false
      });
      results.push({
        status: "matched",
        providerSource: entry.evidence.providerSource,
        provider: entry.evidence.provider,
        providerId: entry.evidence.providerId,
        matchId: match.id,
        mediaTitleId: providerMetadata.mediaTitle.id,
        providerMediaMetadataId: providerMetadata.metadata.id
      });
    }
    return results;
  });

  return [...matched, ...skipped];
}

function dedupeImportedProviderIds(importedProviderIds: ImportedProviderId[]) {
  const seen = new Set<string>();
  return importedProviderIds.filter((evidence) => {
    const key = `${evidence.providerSource}:${evidence.providerId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function skippedProviderMatch(
  evidence: ImportedProviderId,
  reason: "item_not_parsed" | "lookup_failed",
  error?: unknown
): PtRssProviderMatchImportResult {
  return {
    status: "skipped",
    providerSource: evidence.providerSource,
    provider: evidence.provider,
    providerId: evidence.providerId,
    reason,
    error: error ? redactSecrets(error instanceof Error ? error.message : String(error)) : undefined
  };
}
