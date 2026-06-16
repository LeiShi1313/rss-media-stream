import type { MediaType } from "@rss-media/shared/types";
import { getPtgenTitleByProviderId, searchPtgen } from "./client.js";
import { ptgenIdentity, ptgenProviderEntityType } from "./identity.js";
import type { PtgenSource } from "./types.js";
import type { MetadataProvider, ProviderProbeResult } from "../providers/types.js";

export const ptgenProvider: MetadataProvider = {
  id: "ptgen",
  search(input, context) {
    return searchPtgen(
      {
        title: input.title,
        mediaType: input.mediaType,
        year: input.year,
        season: input.season,
        episode: input.episode,
        language: input.language,
        source: ptgenSourceFromProviderSource(context.runtime.providerSource)
      },
      {
        language: context.runtime.metadataLanguage
      }
    );
  },
  probe(input) {
    const value = input.input.trim();
    const mediaType = concreteMediaType(input.mediaType);
    const urlProbe = probePtgenUrl(value, mediaType);
    if (urlProbe) return [urlProbe];

    const canonical = value.match(/^(imdb|douban)-(.+)$/i);
    if (canonical) {
      return probeForSource(canonical[1].toLowerCase() as PtgenSource, canonical[2], mediaType);
    }

    return [];
  },
  fetchTitle(input, context) {
    return getPtgenTitleByProviderId(
      {
        providerEntityType: input.providerEntityType,
        providerId: input.providerId,
        mediaType: input.mediaType,
        language: input.language
      },
      {
        language: context.runtime.metadataLanguage
      }
    );
  }
};

function probeForSource(source: PtgenSource, sourceId: string, mediaType?: MediaType): ProviderProbeResult[] {
  const identity = ptgenIdentity(source, sourceId);
  if (!identity) return [];
  return [{
    provider: "ptgen",
    providerSource: source === "imdb" ? "ptgen_imdb" : "ptgen_douban",
    providerEntityType: identity.providerEntityType,
    providerId: identity.providerId,
    mediaType
  }];
}

function probePtgenUrl(input: string, mediaType?: MediaType): ProviderProbeResult | undefined {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host === "imdb.com") {
    const sourceId = url.pathname.match(/\/title\/(tt\d+)/i)?.[1];
    if (!sourceId) return undefined;
    return probeForSource("imdb", sourceId, mediaType)[0];
  }

  if (host === "douban.com" || host === "movie.douban.com") {
    const sourceId = url.pathname.match(/\/(?:subject|movie)\/(\d+)/i)?.[1];
    if (!sourceId) return undefined;
    return probeForSource("douban", sourceId, mediaType)[0];
  }

  return undefined;
}

function concreteMediaType(mediaType?: string): MediaType | undefined {
  return mediaType === "MOVIE" || mediaType === "TV_SERIES" ? mediaType : undefined;
}

function ptgenSourceFromProviderSource(providerSource?: string): PtgenSource | undefined {
  if (providerSource === "ptgen_imdb") return "imdb";
  if (providerSource === "ptgen_douban") return "douban";
  return undefined;
}

export { ptgenProviderEntityType as providerEntityType };
