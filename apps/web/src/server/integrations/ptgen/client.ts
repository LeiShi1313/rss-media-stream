import type { MediaType, ProviderTitleResult } from "@rss-media/shared/types";
import { notFound } from "../../core/errors.js";
import { ptgenRecordToTitleResult } from "./mapper.js";
import type { PtgenRecord, PtgenSite } from "./types.js";

export const PTGEN_BASE_URLS = [
  {
    label: "GitHub Pages",
    value: "https://ourbits.github.io/PtGen/"
  },
  {
    label: "Ourhelp CDN",
    value: "https://cdn.ourhelp.club/ptgen/"
  },
  {
    label: "Ourhelp API",
    value: "https://api.ourhelp.club/infogen"
  }
] as const;

export const DEFAULT_PTGEN_BASE_URL = PTGEN_BASE_URLS[0].value;

type PtgenClientOptions = {
  baseUrl?: string;
  language?: string;
};

export async function searchPtgen(): Promise<ProviderTitleResult[]> {
  return [];
}

export async function getPtgenTitleById(
  input: { site: PtgenSite; sid: string; mediaType?: MediaType; language?: string },
  options: PtgenClientOptions = {}
): Promise<ProviderTitleResult> {
  const baseUrl = options.baseUrl ?? DEFAULT_PTGEN_BASE_URL;
  const sid = normalizePtgenSid(input.site, input.sid);
  const url = ptgenRecordUrl(baseUrl, input.site, sid);
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) throw notFound("PtGen title");
    throw new Error(`PtGen lookup failed with ${response.status}`);
  }

  const body = (await response.json()) as PtgenRecord;
  if (body.success === false || body.error) {
    throw new Error(body.error || "PtGen lookup failed");
  }

  return ptgenRecordToTitleResult(body, {
    site: input.site,
    sid,
    mediaType: input.mediaType,
    language: input.language ?? options.language,
    baseUrl
  });
}

function normalizePtgenSid(site: PtgenSite, sid: string) {
  return site === "imdb" ? sid.toLowerCase() : sid;
}

export function ptgenRecordUrl(baseUrl: string, site: PtgenSite, sid: string) {
  const normalized = normalizePtgenBaseUrl(baseUrl);
  const parsed = new URL(normalized);
  const isApi = parsed.hostname === "api.ourhelp.club" || parsed.pathname.replace(/\/+$/, "").endsWith("/infogen");
  if (isApi) {
    parsed.searchParams.set("site", site);
    parsed.searchParams.set("sid", sid);
    return parsed.toString();
  }

  return new URL(`${site}/${sid}.json`, ensureTrailingSlash(parsed.toString())).toString();
}

function normalizePtgenBaseUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_PTGEN_BASE_URL;
  return trimmed;
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}
