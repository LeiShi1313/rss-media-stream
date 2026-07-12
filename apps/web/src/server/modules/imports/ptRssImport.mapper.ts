import {
  extractInfoHash,
  extractRssDownloadSizeBytes,
  extractRssDownloadUrl,
  extractRssSourceUrl,
  isLikelyTorrentDownloadUrl,
  normalizeInfoHash,
  parseHumanSizeBytes,
  parseRssDate,
  readString
} from "@rss-media/shared/rss";
import type { RssUrlFields } from "@rss-media/shared/rss";
import { ptgenIdentity } from "../../integrations/ptgen/identity.js";
import type { PtgenProviderEntityType, PtgenSource } from "../../integrations/ptgen/types.js";
import type { NormalizedRssItem } from "../feeds/itemIngestion.js";

export type PtRssMongoId = {
  id: string;
  site: string;
};

export type PtRssVisitedDocument = RssUrlFields & {
  _id: PtRssMongoId;
  title?: unknown;
  title_detail?: {
    value?: unknown;
  };
  isoDate?: unknown;
  pubDate?: unknown;
  published?: unknown;
  torrentInfoHash?: unknown;
  torrentContentLength?: unknown;
  [key: string]: unknown;
};

export type PtRssItemDocument = RssUrlFields & {
  _id: PtRssMongoId;
  imdb?: unknown;
  douban?: unknown;
  size?: unknown;
  [key: string]: unknown;
};

export type ImportedProviderId = {
  providerSource: PtgenProviderEntityType;
  provider: PtgenSource;
  providerId: string;
  originalValue: string;
  source: "mongo_item_imdb" | "mongo_item_douban";
};

export type PtRssImportRawPayload = {
  source: "pt_rss";
  mongoId: PtRssMongoId;
  visited: PtRssVisitedDocument;
  item?: PtRssItemDocument;
};

export type PtRssMapResult =
  | {
    status: "mapped";
    value: {
      item: NormalizedRssItem;
      rawPayload: PtRssImportRawPayload;
      importedProviderIds: ImportedProviderId[];
    };
  }
  | {
    status: "skipped";
    reason: "missing_raw_title" | "missing_torrent_url";
    mongoId: PtRssMongoId;
  };

export function mapPtRssJoinedItem(input: {
  visited: PtRssVisitedDocument;
  item?: PtRssItemDocument;
}): PtRssMapResult {
  const mongoId = input.visited._id;
  const rawTitle = ptRssRawTitle(input.visited);
  if (!rawTitle) {
    return { status: "skipped", reason: "missing_raw_title", mongoId };
  }

  const torrentUrl = extractRssDownloadUrl(input.visited) ?? extractRssDownloadUrl(input.item ?? {});
  if (!torrentUrl) {
    return { status: "skipped", reason: "missing_torrent_url", mongoId };
  }

  const publishDate = ptRssPublishDate(input.visited);
  return {
    status: "mapped",
    value: {
      item: ptRssNormalizedItem({
        visited: input.visited,
        item: input.item,
        rawTitle,
        torrentUrl,
        publishDate
      }),
      rawPayload: {
        source: "pt_rss",
        mongoId,
        visited: input.visited,
        item: input.item
      },
      importedProviderIds: ptRssProviderIds(input.item)
    }
  };
}

function ptRssNormalizedItem(input: {
  visited: PtRssVisitedDocument;
  item?: PtRssItemDocument;
  rawTitle: string;
  torrentUrl: string;
  publishDate?: Date;
}): NormalizedRssItem {
  return {
    rawTitle: input.rawTitle,
    torrentUrl: input.torrentUrl,
    sourceUrl: ptRssSourceUrl(input.visited, input.item, input.torrentUrl),
    guid: readString(input.visited.guid),
    infoHash: normalizeInfoHash(
      readString(input.visited.torrentInfoHash) ??
      extractInfoHash(input.torrentUrl) ??
      readString(input.visited.guid)
    ),
    publishDate: input.publishDate,
    firstSeenAt: input.publishDate,
    sizeBytes: ptRssSizeBytes(input.visited, input.item, input.torrentUrl)
  };
}

function ptRssRawTitle(visited: PtRssVisitedDocument): string | undefined {
  return (readString(visited.title) ?? readString(visited.title_detail?.value))?.trim() || undefined;
}

function ptRssPublishDate(visited: PtRssVisitedDocument): Date | undefined {
  return parseRssDate(
    readString(visited.isoDate) ??
    readString(visited.pubDate) ??
    readString(visited.published)
  );
}

function ptRssSizeBytes(
  visited: PtRssVisitedDocument,
  item: PtRssItemDocument | undefined,
  torrentUrl: string
): bigint | undefined {
  return extractRssDownloadSizeBytes(visited, torrentUrl) ??
    extractRssDownloadSizeBytes(item ?? {}, torrentUrl) ??
    parseHumanSizeBytes(readString(item?.size));
}

function ptRssSourceUrl(
  visited: PtRssVisitedDocument,
  item: PtRssItemDocument | undefined,
  torrentUrl: string
): string | undefined {
  return extractRssSourceUrl({ link: visited.link, links: visited.links }, torrentUrl) ??
    sourcePageUrl(readString(item?.link), torrentUrl);
}

function sourcePageUrl(value: string | undefined, torrentUrl: string): string | undefined {
  if (!value || value === torrentUrl) return undefined;
  if (!/^https?:\/\//i.test(value) || isLikelyTorrentDownloadUrl(value)) return undefined;
  return value;
}

function ptRssProviderIds(item: PtRssItemDocument | undefined): ImportedProviderId[] {
  return [
    ptRssProviderId("imdb", readString(item?.imdb), "mongo_item_imdb"),
    ptRssProviderId("douban", readString(item?.douban), "mongo_item_douban")
  ].filter((value): value is ImportedProviderId => Boolean(value));
}

function ptRssProviderId(
  provider: PtgenSource,
  originalValue: string | undefined,
  source: ImportedProviderId["source"]
): ImportedProviderId | undefined {
  if (!originalValue) return undefined;
  const identity = ptgenIdentity(provider, originalValue);
  if (!identity) return undefined;
  return {
    providerSource: identity.providerEntityType,
    provider,
    providerId: identity.providerId,
    originalValue,
    source
  };
}
