export type RssLink = {
  rel?: unknown;
  type?: unknown;
  href?: unknown;
  length?: unknown;
};

export type RssUrlFields = {
  link?: unknown;
  guid?: unknown;
  links?: unknown;
  enclosure?: {
    url?: unknown;
    length?: unknown;
    type?: unknown;
  };
  torrentMagnetUri?: unknown;
  contentSnippet?: unknown;
  content?: unknown;
  description?: unknown;
};

const SIZE_UNITS = {
  B: 1n,
  KB: 1024n,
  KIB: 1024n,
  MB: 1024n ** 2n,
  MIB: 1024n ** 2n,
  GB: 1024n ** 3n,
  GIB: 1024n ** 3n,
  TB: 1024n ** 4n,
  TIB: 1024n ** 4n
} as const;

export function extractRssTorrentUrl(item: RssUrlFields): string {
  return (
    enclosureTorrentUrl(item) ??
    readString(item.torrentMagnetUri) ??
    readString(item.enclosure?.url) ??
    readString(item.link) ??
    readUrlLikeGuid(readString(item.guid)) ??
    ""
  );
}

export function extractRssDownloadUrl(item: RssUrlFields): string | undefined {
  const enclosureUrl = enclosureTorrentUrl(item);
  if (enclosureUrl) return enclosureUrl;

  return [
    ...rssLinks(item).map((link) => readString(link.href)),
    readString(item.torrentMagnetUri),
    readString(item.enclosure?.url),
    readString(item.link),
    readUrlLikeGuid(readString(item.guid))
  ].find(isLikelyTorrentDownloadUrl);
}

export function extractRssSourceUrl(item: RssUrlFields, torrentUrl: string): string | undefined {
  return [
    alternateHtmlUrl(item),
    readString(item.link),
    readUrlFromText(readString(item.contentSnippet)),
    readUrlFromText(readString(item.content)),
    readUrlFromText(readString(item.description))
  ].find((value) => value && value !== torrentUrl && /^https?:\/\//i.test(value));
}

export function extractRssDownloadSizeBytes(item: RssUrlFields, downloadUrl?: string): bigint | undefined {
  const link = rssLinks(item).find((candidate) =>
    (!downloadUrl || readString(candidate.href) === downloadUrl) &&
    (isTorrentEnclosureLink(candidate) || isLikelyTorrentDownloadUrl(readString(candidate.href)))
  );
  return parsePositiveBigInt(link?.length ?? item.enclosure?.length);
}

export function extractInfoHash(value: string): string | undefined {
  return value.match(/(?:btih:|[?&]xt=urn:btih:)([a-z0-9]+)/i)?.[1];
}

export function normalizeInfoHash(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[a-z0-9]{32,64}$/.test(normalized)
    ? normalized
    : undefined;
}

export function parseRssDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function parsePositiveBigInt(value?: unknown): bigint | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value);
  if (!/^\d+$/.test(text)) return undefined;
  const parsed = BigInt(text);
  return parsed > 0n ? parsed : undefined;
}

export function parseHumanSizeBytes(value?: string): bigint | undefined {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)\s*([kmgt]?i?b)$/i);
  if (!match) return undefined;

  const unit = match[2].toUpperCase() as keyof typeof SIZE_UNITS;
  const multiplier = SIZE_UNITS[unit];
  if (!multiplier) return undefined;

  return decimalToBigIntBytes(match[1], multiplier);
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function readUrlFromText(value?: string): string | undefined {
  return value?.trim().match(/https?:\/\/[^\s<>"']+/i)?.[0];
}

export function readUrlLikeGuid(guid?: string): string | undefined {
  if (!guid) return undefined;
  return /^(https?:|magnet:)/i.test(guid) ? guid : undefined;
}

export function isLikelyTorrentDownloadUrl(value?: string): value is string {
  const url = value?.trim();
  if (!url) return false;
  return /^magnet:/i.test(url) ||
    /\.torrent(?:[?#]|$)/i.test(url) ||
    /\/download(?:\.php)?(?:[/?#]|$)/i.test(url) ||
    /[?&]action=download(?:[&#]|$)/i.test(url);
}

function enclosureTorrentUrl(item: RssUrlFields): string | undefined {
  const link = rssLinks(item).find(isTorrentEnclosureLink);
  return readString(link?.href);
}

function isTorrentEnclosureLink(candidate: RssLink): boolean {
  return lowerString(candidate.rel) === "enclosure" &&
    /bittorrent|octet-stream/i.test(readString(candidate.type) ?? "") &&
    Boolean(readString(candidate.href));
}

function alternateHtmlUrl(item: RssUrlFields): string | undefined {
  const link = rssLinks(item).find((candidate) =>
    lowerString(candidate.rel) === "alternate" &&
    (!candidate.type || /html/i.test(readString(candidate.type) ?? "")) &&
    readString(candidate.href)
  );
  return readString(link?.href);
}

function rssLinks(item: RssUrlFields): RssLink[] {
  return Array.isArray(item.links) ? item.links as RssLink[] : [];
}

function lowerString(value: unknown): string | undefined {
  return readString(value)?.toLowerCase();
}

function decimalToBigIntBytes(decimal: string, multiplier: bigint): bigint {
  const [whole, fraction = ""] = decimal.split(".");
  const scale = 10n ** BigInt(fraction.length);
  return (BigInt(whole) * multiplier) + (BigInt(fraction || "0") * multiplier / scale);
}
