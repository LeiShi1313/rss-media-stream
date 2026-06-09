import type { MediaType } from "@rss-media/shared/types";
import { getPtgenTitleById, searchPtgen } from "./client.js";
import { providerEntityType, ptgenEntityTypeToSite } from "./mapper.js";
import type { PtgenSite } from "./types.js";
import type { MetadataProvider, ProviderProbeResult } from "../providers/types.js";

export const ptgenProvider: MetadataProvider = {
  id: "ptgen",
  search() {
    return searchPtgen();
  },
  probe(input) {
    const value = input.input.trim();
    const mediaType = concreteMediaType(input.mediaType);
    const urlProbe = probePtgenUrl(value, mediaType);
    if (urlProbe) return [urlProbe];

    const explicit = value.match(/^ptgen:(imdb|douban):(.+)$/i);
    if (explicit) {
      return probeForSite(explicit[1].toLowerCase() as PtgenSite, explicit[2], mediaType);
    }

    const imdbShorthand = value.match(/^imdb:(tt\d+)$/i) ?? value.match(/^(tt\d+)$/i);
    if (imdbShorthand) {
      return probeForSite("imdb", imdbShorthand[1], mediaType);
    }

    const doubanShorthand = value.match(/^douban:(\d+)$/i);
    if (doubanShorthand) {
      return probeForSite("douban", doubanShorthand[1], mediaType);
    }

    return [];
  },
  fetchTitle(input, context) {
    const site = ptgenEntityTypeToSite(input.providerEntityType);
    if (!site) throw new Error("PtGen detail lookup requires ptgen_imdb or ptgen_douban");
    return getPtgenTitleById(
      {
        site,
        sid: input.providerId,
        mediaType: input.mediaType,
        language: input.language
      },
      {
        baseUrl: context.runtime.baseUrl,
        language: context.runtime.metadataLanguage
      }
    );
  }
};

function probeForSite(site: PtgenSite, sid: string, mediaType?: MediaType): ProviderProbeResult[] {
  const normalized = normalizeSid(site, sid);
  if (!normalized) return [];
  return [{
    provider: "ptgen",
    providerEntityType: providerEntityType(site),
    providerId: normalized,
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
    const sid = url.pathname.match(/\/title\/(tt\d+)/i)?.[1];
    if (!sid) return undefined;
    return {
      provider: "ptgen",
      providerEntityType: "ptgen_imdb",
      providerId: sid.toLowerCase(),
      mediaType
    };
  }

  if (host === "douban.com" || host === "movie.douban.com") {
    const sid = url.pathname.match(/\/(?:subject|movie)\/(\d+)/i)?.[1];
    if (!sid) return undefined;
    return {
      provider: "ptgen",
      providerEntityType: "ptgen_douban",
      providerId: sid,
      mediaType
    };
  }

  return undefined;
}

function normalizeSid(site: PtgenSite, sid: string) {
  const trimmed = sid.trim().replace(/\/+$/, "");
  if (site === "imdb") return /^tt\d+$/i.test(trimmed) ? trimmed.toLowerCase() : undefined;
  return /^\d+$/.test(trimmed) ? trimmed : undefined;
}

function concreteMediaType(mediaType?: string): MediaType | undefined {
  return mediaType === "MOVIE" || mediaType === "TV_SERIES" ? mediaType : undefined;
}
