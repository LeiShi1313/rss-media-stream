import type { PtgenIdentity, PtgenProviderEntityType, PtgenSource, PtgenSourceIds } from "./types.js";

export function ptgenProviderEntityType(source: PtgenSource): PtgenProviderEntityType {
  return source === "imdb" ? "ptgen_imdb" : "ptgen_douban";
}

export function ptgenEntityTypeToSource(entityType: string): PtgenSource | undefined {
  if (entityType === "ptgen_imdb") return "imdb";
  if (entityType === "ptgen_douban") return "douban";
  return undefined;
}

export function ptgenEntityTypeToSite(entityType: string): PtgenSource | undefined {
  return ptgenEntityTypeToSource(entityType);
}

export function ptgenProviderId(source: PtgenSource, rawSourceId: string): string | undefined {
  const sourceId = normalizePtgenSourceId(source, rawSourceId);
  return sourceId ? `${source}-${sourceId}` : undefined;
}

export function parsePtgenProviderId(value: string): PtgenIdentity | undefined {
  const match = value.trim().match(/^(imdb|douban)-(.+)$/i);
  if (!match) return undefined;
  return ptgenIdentity(match[1].toLowerCase() as PtgenSource, match[2]);
}

export function ptgenIdentity(source: PtgenSource, rawSourceId: string, transient = false): PtgenIdentity | undefined {
  const sourceId = normalizePtgenSourceId(source, rawSourceId);
  if (!sourceId) return undefined;
  return {
    source,
    sourceId,
    lookupId: source === "imdb" ? sourceId.replace(/^tt/i, "") : sourceId,
    providerEntityType: ptgenProviderEntityType(source),
    providerId: `${source}-${sourceId}`,
    transient
  };
}

export function identityFromPtgenRecordId(
  id: unknown,
  sourceIds: PtgenSourceIds | undefined,
  sources?: string[]
): PtgenIdentity | undefined {
  const value = typeof id === "string" ? id.trim() : "";
  const canonical = value ? parsePtgenProviderId(value) : undefined;
  if (canonical) return canonical;

  const transitional = value.match(/^work[_-](imdb|douban)[_-](.+)$/i);
  if (transitional) {
    const source = transitional[1].toLowerCase() as PtgenSource;
    const fromSourceIds = sourceIds?.[source];
    return ptgenIdentity(source, fromSourceIds ?? transitional[2], true);
  }

  const available = (["imdb", "douban"] as const)
    .map((source) => {
      const sourceId = sourceIds?.[source];
      return sourceId ? ptgenIdentity(source, sourceId, true) : undefined;
    })
    .filter((identity): identity is PtgenIdentity => Boolean(identity));

  if (available.length === 1) return available[0];

  const singleSource = (sources ?? []).filter((source): source is PtgenSource =>
    source === "imdb" || source === "douban"
  );
  if (singleSource.length === 1 && sourceIds?.[singleSource[0]]) {
    return ptgenIdentity(singleSource[0], sourceIds[singleSource[0]]!, true);
  }

  return undefined;
}

export function normalizePtgenSourceId(source: PtgenSource, value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (source === "imdb") {
    const raw = trimmed.toLowerCase().replace(/^imdb-/i, "");
    const normalized = raw.startsWith("tt") ? raw : `tt${raw}`;
    return /^tt\d+$/.test(normalized) ? normalized : undefined;
  }

  const normalized = trimmed.replace(/^douban-/i, "");
  return /^\d+$/.test(normalized) ? normalized : undefined;
}
