import type { MediaType, ProviderTitleResult } from "@rss-media/shared/types";
import { notFound } from "../../core/errors.js";
import {
  parsePtgenProviderId,
  ptgenEntityTypeToSource,
  ptgenIdentity,
  ptgenProviderEntityType
} from "./identity.js";
import {
  ptgenLegacyRecordToTitleResult,
  ptgenLookupRecordToTitleResult,
  ptgenSearchHitToTitleResult
} from "./mapper.js";
import type {
  PtgenIdentity,
  PtgenLegacyRecord,
  PtgenSearchHit,
  PtgenSearchResponse,
  PtgenSite,
  PtgenSource
} from "./types.js";

export const PTGEN_SEARCH_BASE_URL = "https://ptgen.leishi.xyz";
export const PTGEN_INFOGEN_BASE_URL = "https://api.ourhelp.club/infogen";
export const PTGEN_STATIC_BASE_URLS = [
  "https://ourbits.github.io/PtGen/",
  "https://cdn.ourhelp.club/ptgen/"
] as const;

export const PTGEN_BACKENDS = [
  { id: "search_api", label: "PTGen Search API", baseUrl: PTGEN_SEARCH_BASE_URL },
  { id: "infogen_api", label: "Ourhelp infogen API", baseUrl: PTGEN_INFOGEN_BASE_URL },
  ...PTGEN_STATIC_BASE_URLS.map((baseUrl) => ({ id: "static_json", label: "Static JSON", baseUrl }))
] as const;

type PtgenClientOptions = {
  language?: string;
};

export async function searchPtgen(
  input: { title: string; mediaType: MediaType; year?: number; season?: number; episode?: number; language?: string; source?: PtgenSource },
  options: PtgenClientOptions = {}
): Promise<ProviderTitleResult[]> {
  let body: PtgenSearchResponse = { hits: [] };
  for (const attempt of ptgenSearchAttempts(input)) {
    body = await fetchPtgenSearch(attempt);
    if ((body.hits ?? []).length > 0) break;
  }

  const language = input.language ?? options.language;
  return (body.hits ?? [])
    .map((hit, index) =>
      ptgenSearchHitToTitleResult(hit, {
        query: input.title,
        mediaType: input.mediaType,
        year: input.year,
        season: input.season,
        language,
        baseUrl: PTGEN_SEARCH_BASE_URL,
        backend: "search_api",
        index
      })
    )
    .filter((result): result is ProviderTitleResult => Boolean(result));
}

async function fetchPtgenSearch(input: Parameters<typeof ptgenSearchUrl>[1]) {
  const response = await fetch(ptgenSearchUrl(PTGEN_SEARCH_BASE_URL, input));
  if (!response.ok) {
    throw new Error(`PTGen search failed with ${response.status}`);
  }

  return await response.json() as PtgenSearchResponse;
}

function ptgenSearchAttempts(input: { title: string; mediaType: MediaType; year?: number; source?: PtgenSource }) {
  const base = {
    q: input.title,
    source: input.source,
    limit: 8,
    offset: 0
  };
  const primaryKind: string = ptgenKind(input.mediaType);
  const attempts = [
    { ...base, kind: primaryKind, year: input.year },
    input.year ? { ...base, kind: primaryKind } : undefined,
    { ...base, kind: "work", year: input.year },
    input.year ? { ...base, kind: "work" } : undefined
  ].filter((attempt): attempt is typeof base & { kind: string; year?: number } => Boolean(attempt));

  const seen = new Set<string>();
  return attempts.filter((attempt) => {
    const key = `${attempt.source ?? ""}:${attempt.kind}:${attempt.year ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function getPtgenTitleByProviderId(
  input: {
    providerEntityType: string;
    providerId: string;
    mediaType?: MediaType;
    language?: string;
  },
  options: PtgenClientOptions = {}
): Promise<ProviderTitleResult> {
  const identity = parsePtgenProviderId(input.providerId);
  const expectedSource = ptgenEntityTypeToSource(input.providerEntityType);
  if (!identity || !expectedSource || identity.source !== expectedSource) {
    throw notFound("PTGen title");
  }

  const language = input.language ?? options.language;
  const errors: unknown[] = [];
  for (const adapter of lookupAdapters) {
    try {
      const result = await adapter(identity, {
        mediaType: input.mediaType,
        language
      });
      if (result) return result;
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length > 0) {
    throw errors[0];
  }
  throw notFound("PTGen title");
}

export async function getPtgenTitleById(
  input: { site: PtgenSite; sid: string; mediaType?: MediaType; language?: string },
  options: PtgenClientOptions = {}
): Promise<ProviderTitleResult> {
  const identity = ptgenIdentity(input.site, input.sid);
  if (!identity) throw notFound("PTGen title");
  return getPtgenTitleByProviderId(
    {
      providerEntityType: identity.providerEntityType,
      providerId: identity.providerId,
      mediaType: input.mediaType,
      language: input.language
    },
    options
  );
}

export function ptgenSearchUrl(
  baseUrl: string,
  input: {
    q: string;
    limit?: number;
    offset?: number;
    source?: PtgenSource;
    kind?: string;
    year?: number;
  }
) {
  const url = new URL("/api/search", ensureTrailingSlash(baseUrl));
  url.searchParams.set("q", input.q);
  url.searchParams.set("limit", String(input.limit ?? 20));
  url.searchParams.set("offset", String(input.offset ?? 0));
  if (input.source) url.searchParams.set("source", input.source);
  if (input.kind) url.searchParams.set("kind", input.kind);
  if (input.year) url.searchParams.set("year", String(input.year));
  return url.toString();
}

export function ptgenLookupUrl(baseUrl: string, identity: PtgenIdentity) {
  const url = new URL("/api/lookup", ensureTrailingSlash(baseUrl));
  url.searchParams.set("source", identity.source);
  url.searchParams.set("id", identity.lookupId);
  return url.toString();
}

export function ptgenRecordUrl(baseUrl: string, site: PtgenSite, sid: string) {
  const normalizedSid = normalizedStaticSourceId(site, sid);
  const parsed = new URL(baseUrl.trim());
  const isApi = parsed.hostname === "api.ourhelp.club" || parsed.pathname.replace(/\/+$/, "").endsWith("/infogen");
  if (isApi) {
    parsed.searchParams.set("site", site);
    parsed.searchParams.set("sid", normalizedSid);
    return parsed.toString();
  }

  return new URL(`${site}/${normalizedSid}.json`, ensureTrailingSlash(parsed.toString())).toString();
}

type LookupInput = {
  mediaType?: MediaType;
  language?: string;
};

const lookupAdapters = [
  lookupSearchApiRecord,
  lookupInfogenRecord,
  ...PTGEN_STATIC_BASE_URLS.map((baseUrl) =>
    (identity: PtgenIdentity, input: LookupInput) => lookupStaticRecord(baseUrl, identity, input)
  )
] as const;

async function lookupSearchApiRecord(identity: PtgenIdentity, input: LookupInput) {
  const record = await fetchJson<unknown>(ptgenLookupUrl(PTGEN_SEARCH_BASE_URL, identity), "PTGen lookup");
  if (!record) return undefined;
  const hit = extractPtgenSearchHit(record);
  if (!hit) return undefined;
  return ptgenLookupRecordToTitleResult(hit, identity, {
    mediaType: input.mediaType,
    language: input.language,
    baseUrl: PTGEN_SEARCH_BASE_URL,
    backend: "search_api"
  });
}

async function lookupInfogenRecord(identity: PtgenIdentity, input: LookupInput) {
  const record = await fetchJson<PtgenLegacyRecord>(
    ptgenRecordUrl(PTGEN_INFOGEN_BASE_URL, identity.source, identity.sourceId),
    "PTGen infogen lookup"
  );
  if (!record) return undefined;
  return ptgenLegacyRecordToTitleResult(record, {
    source: identity.source,
    sourceId: identity.sourceId,
    mediaType: input.mediaType,
    language: input.language,
    baseUrl: PTGEN_INFOGEN_BASE_URL,
    backend: "infogen_api"
  });
}

async function lookupStaticRecord(baseUrl: string, identity: PtgenIdentity, input: LookupInput) {
  const record = await fetchJson<PtgenLegacyRecord>(
    ptgenRecordUrl(baseUrl, identity.source, identity.sourceId),
    "PTGen static lookup"
  );
  if (!record) return undefined;
  return ptgenLegacyRecordToTitleResult(record, {
    source: identity.source,
    sourceId: identity.sourceId,
    mediaType: input.mediaType,
    language: input.language,
    baseUrl,
    backend: "static_json"
  });
}

async function fetchJson<T>(url: string, label: string): Promise<T | undefined> {
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) return undefined;
    throw new Error(`${label} failed with ${response.status}`);
  }

  const body = await response.json() as T & { success?: boolean; error?: string | null };
  if (body?.success === false || body?.error) {
    throw new Error(body.error || `${label} failed`);
  }
  return body;
}

function extractPtgenSearchHit(body: unknown): PtgenSearchHit | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  if (isPtgenSearchHit(record)) return record as PtgenSearchHit;

  for (const key of ["record", "work", "data", "result"]) {
    const nested = record[key];
    if (nested && typeof nested === "object" && isPtgenSearchHit(nested as Record<string, unknown>)) {
      return nested as PtgenSearchHit;
    }
  }
  return undefined;
}

function isPtgenSearchHit(record: Record<string, unknown>) {
  return typeof record.id === "string" ||
    Array.isArray(record.titles) ||
    Boolean(record.source_ids && typeof record.source_ids === "object");
}

function normalizedStaticSourceId(source: PtgenSource, sourceId: string) {
  const identity = ptgenIdentity(source, sourceId);
  if (!identity) return sourceId;
  return source === "imdb" ? identity.sourceId : identity.lookupId;
}

function ptgenKind(mediaType: MediaType) {
  return mediaType === "TV_SERIES" ? "tv" : "movie";
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

export { ptgenProviderEntityType };
