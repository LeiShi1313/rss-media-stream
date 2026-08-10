import type { MediaSearchResultDto } from "@rss-media/shared/apiContracts";
import { redactSecrets } from "@rss-media/shared/redact";
import { normalizeTitleKey } from "@rss-media/shared/titleNormalization";
import type {
  MediaType,
  ParsedMediaType,
  ProviderSource,
  ProviderTitleResult
} from "@rss-media/shared/types";
import type { z } from "zod";
import type { AppConfig } from "../../config.js";
import { AppError, badGateway, conflict } from "../../core/errors.js";
import {
  getMetadataProvider,
  getMetadataProviders
} from "../../integrations/providers/index.js";
import {
  getBroadSearchTargets,
  getMatchingProviderOrder
} from "../../integrations/providers/policy.js";
import { providerRuntimeAvailable, resolveProviderRuntime } from "../../integrations/providers/runtime.js";
import {
  executeProviderSearch,
  type ProviderSearchLogger
} from "../../integrations/providers/searchExecution.js";
import {
  getProviderSourceDefinition,
  normalizeProviderSource,
  providerSourceForLegacyProviderEntity
} from "../../integrations/providers/sources.js";
import type {
  ProviderMetadataCandidate,
  ProviderRuntimeContext
} from "../../integrations/providers/types.js";
import { serializeProviderTitleSearchResult } from "./presentation.js";
import type { mediaSearchQuerySchema } from "./media.schemas.js";

type MediaSearchQuery = z.infer<typeof mediaSearchQuerySchema>;
type SmartProviderTitleSearchInput = {
  input: string;
  providerSource?: ProviderSource;
  provider?: ProviderSource;
  mediaType?: ParsedMediaType;
  providerEntityType?: string;
  year?: number;
};

export async function searchExternalMedia(
  config: AppConfig,
  tenantId: string,
  query: MediaSearchQuery,
  logger?: ProviderSearchLogger
): Promise<MediaSearchResultDto[]> {
  const providerSource = normalizeProviderSource(query.providerSource ?? query.provider);
  const targets = (providerSource
    ? [{ providerSource, mediaType: query.mediaType }]
    : await providerSearchTargets(tenantId, query.mediaType)
  ).map((target) => ({
    ...target,
    title: query.q,
    year: query.year
  }));
  const results = await searchProviderTargets(config, tenantId, targets, logger);

  return dedupeProviderResults(results).map(serializeProviderTitleSearchResult);
}

export async function smartSearchExternalMedia(
  config: AppConfig,
  tenantId: string,
  query: SmartProviderTitleSearchInput,
  logger?: ProviderSearchLogger
): Promise<MediaSearchResultDto[]> {
  const providerSource = normalizeProviderSource(query.providerSource ?? query.provider);
  const metadataProviders = providerSource
    ? [getMetadataProvider(adapterIdForProviderSource(providerSource))]
    : getMetadataProviders();
  const probes = metadataProviders.flatMap((provider) =>
    provider.probe?.({
      input: query.input,
      mediaType: query.mediaType,
      providerEntityType: query.providerEntityType,
      year: query.year
    }) ?? []
  );

  const exactProbes = probes.filter((probe) => probe.providerId && probe.providerEntityType);
  if (exactProbes.length > 0) {
    const results = await Promise.all(
      exactProbes.map(async (probe) => {
        try {
          return await runProviderDetailLookup(
            config,
            tenantId,
            normalizeProviderSource(probe.providerSource) ??
              providerSourceForProbe(probe.provider, probe.providerEntityType) ??
              "tmdb_api",
            {
              providerEntityType: probe.providerEntityType!,
              providerId: probe.providerId!,
              mediaType: probe.mediaType
            }
          );
        } catch (error) {
          if (isProviderLookupNotFound(error)) return undefined;
          throw error;
        }
      })
    );
    return dedupeProviderResults(results.filter((result): result is ProviderMetadataCandidate => Boolean(result)))
      .map(serializeProviderTitleSearchResult);
  }

  const hintedTargets = probes.flatMap((probe) => {
    const targetProviderSource =
      normalizeProviderSource(probe.providerSource) ??
      providerSourceForProbe(probe.provider, probe.providerEntityType) ??
      providerSource;
    if (!probe.searchQuery || !probe.mediaType || !targetProviderSource) return [];
    return [{
      providerSource: targetProviderSource,
      title: probe.searchQuery,
      mediaType: probe.mediaType,
      year: query.year
    }];
  });

  const targets = hintedTargets.length > 0
    ? hintedTargets
    : (providerSource
        ? explicitProviderSearchTargets(providerSource, query.mediaType)
        : await providerSearchTargets(tenantId, query.mediaType)
      ).map((target) => ({
        ...target,
        title: query.input,
        year: query.year
      }));

  const results = await searchProviderTargets(config, tenantId, targets, logger);
  return dedupeProviderResults(results).map(serializeProviderTitleSearchResult);
}

export async function lookupProviderMediaMetadata(
  config: AppConfig,
  tenantId: string,
  providerSource: ProviderSource,
  input: { providerEntityType?: string; providerId: string; mediaType?: MediaType }
) {
  const normalizedProviderSource = normalizeProviderSource(providerSource) ?? providerSource;
  const providerEntityType = input.providerEntityType ?? (
    input.mediaType ? providerEntityTypeForSource(normalizedProviderSource, input.mediaType) : undefined
  );
  if (!providerEntityType) {
    throw conflict(
      "UNSUPPORTED_PROVIDER_ENTITY",
      `Provider source ${normalizedProviderSource} requires a provider entity type`
    );
  }
  return runProviderDetailLookup(config, tenantId, normalizedProviderSource, {
    ...input,
    providerEntityType,
    providerId: providerDetailIdForSource(normalizedProviderSource, input.providerId)
  });
}

export async function searchProviderWithRuntime(
  providerSource: ProviderSource,
  runtime: ProviderRuntimeContext,
  input: {
    title: string;
    titleSource?: "parsed_title" | "provider_search_title";
    mediaType: MediaType;
    year?: number;
    season?: number;
    episode?: number;
  },
  logger?: ProviderSearchLogger
) {
  const normalizedProviderSource = normalizeProviderSource(providerSource) ?? providerSource;
  const results = await executeProviderSearch(
    {
      providerSource: normalizedProviderSource,
      mediaType: input.mediaType,
      logger
    },
    (signal) => getMetadataProvider(adapterIdForProviderSource(normalizedProviderSource)).search(
      {
        title: input.title,
        titleSource: input.titleSource,
        mediaType: input.mediaType,
        year: input.year,
        season: input.season,
        episode: input.episode,
        providerSource: normalizedProviderSource
      },
      { runtime, signal }
    )
  );
  return results.map((result) => normalizeProviderResult(result, normalizedProviderSource));
}

async function runProviderSearch(
  config: AppConfig,
  tenantId: string,
  providerSource: ProviderSource,
  input: {
    title: string;
    titleSource?: "parsed_title" | "provider_search_title";
    mediaType: MediaType;
    year?: number;
    season?: number;
    episode?: number;
  },
  logger?: ProviderSearchLogger
) {
  try {
    const normalizedProviderSource = normalizeProviderSource(providerSource) ?? providerSource;
    const runtime = await resolveProviderRuntime(config, tenantId, normalizedProviderSource);
    if (!providerRuntimeAvailable(runtime)) {
      throw new Error(`${normalizedProviderSource.toUpperCase()} API key is not configured`);
    }
    return await searchProviderWithRuntime(normalizedProviderSource, runtime, input, logger);
  } catch (error) {
    throw providerError(error);
  }
}

async function searchProviderTargets(
  config: AppConfig,
  tenantId: string,
  targets: Array<{
    providerSource: ProviderSource;
    title: string;
    mediaType: MediaType;
    year?: number;
    season?: number;
    episode?: number;
  }>,
  logger?: ProviderSearchLogger
) {
  const settled = await Promise.allSettled(
    targets.map((target) =>
      runProviderSearch(config, tenantId, target.providerSource, {
        title: target.title,
        mediaType: target.mediaType,
        year: target.year,
        season: target.season,
        episode: target.episode
      }, logger)
    )
  );
  const results = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const errors = settled.flatMap((result) => result.status === "rejected" ? [result.reason] : []);

  if (results.length === 0 && errors.length === targets.length && errors.length > 0) {
    throw providerError(errors[0]);
  }

  return results;
}

async function providerSearchTargets(tenantId: string, mediaType?: ParsedMediaType) {
  if (mediaType && mediaType !== "UNKNOWN") {
    return (await getMatchingProviderOrder(tenantId, mediaType)).map((providerSource) => ({
      providerSource,
      mediaType
    }));
  }

  return getBroadSearchTargets(tenantId);
}

function explicitProviderSearchTargets(providerSource: ProviderSource, mediaType?: ParsedMediaType) {
  const supportedMediaTypes = supportedMediaTypesForProviderSource(providerSource);
  const targetMediaTypes = mediaType && mediaType !== "UNKNOWN"
    ? supportedMediaTypes.filter((supportedType) => supportedType === mediaType)
    : supportedMediaTypes;

  return targetMediaTypes.map((supportedType) => ({
    providerSource,
    mediaType: supportedType
  }));
}

function dedupeProviderResults<
  T extends Pick<ProviderMetadataCandidate, "provider" | "providerSource" | "providerId" | "mediaType">
>(results: T[]) {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = `${result.providerSource}:${result.provider}:${result.providerId}:${result.mediaType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function runProviderDetailLookup(
  config: AppConfig,
  tenantId: string,
  providerSource: ProviderSource,
  input: { providerEntityType: string; providerId: string; mediaType?: MediaType }
) {
  try {
    const normalizedProviderSource = normalizeProviderSource(providerSource) ?? providerSource;
    const runtime = await resolveProviderRuntime(config, tenantId, normalizedProviderSource);
    if (!providerRuntimeAvailable(runtime)) {
      throw new Error(`${normalizedProviderSource.toUpperCase()} API key is not configured`);
    }
    const result = await getMetadataProvider(adapterIdForProviderSource(normalizedProviderSource)).fetchTitle(
      {
        providerEntityType: input.providerEntityType,
        providerId: input.providerId,
        mediaType: input.mediaType,
        providerSource: normalizedProviderSource
      },
      { runtime }
    );
    return normalizeProviderResult(result, normalizedProviderSource);
  } catch (error) {
    throw providerError(error);
  }
}

function providerError(error: unknown) {
  if (error instanceof AppError) return error;
  const message = redactSecrets(error instanceof Error ? error.message : String(error));
  if (/api key is not configured/i.test(message)) {
    return conflict("PROVIDER_NOT_CONFIGURED", "Add the provider API key before matching media");
  }
  return badGateway(message);
}

function isProviderLookupNotFound(error: unknown) {
  return error instanceof AppError && error.statusCode === 404;
}

function normalizeProviderResult(
  result: ProviderTitleResult,
  providerSource: ProviderSource
): ProviderMetadataCandidate {
  const providerId = normalizeProviderIdForSource(providerSource, result.providerId);
  const titleKey = result.normalizedTitle || normalizeTitleKey(result.title);
  const localeKey = result.localeKey ?? localeKeyFromParts(
    result.language ?? defaultLanguageForProviderSource(providerSource),
    result.region
  );

  return {
    ...result,
    providerSource,
    provider: providerForProviderSource(providerSource),
    providerId,
    normalizedTitle: titleKey,
    titleKey,
    localeKey,
    titleAliases: extractTitleAliases(result)
  };
}

function providerSourceForProbe(
  provider?: string | null,
  providerEntityType?: string | null
): ProviderSource | undefined {
  if (!provider) return undefined;
  return providerSourceForLegacyProviderEntity(provider, providerEntityType) ?? normalizeProviderSource(provider);
}

function adapterIdForProviderSource(providerSource: ProviderSource) {
  return getProviderSourceDefinition(providerSource).adapterId;
}

function providerForProviderSource(providerSource: ProviderSource) {
  return getProviderSourceDefinition(providerSource).provider;
}

function defaultLanguageForProviderSource(providerSource: ProviderSource) {
  return getProviderSourceDefinition(providerSource).defaultMetadataLanguage ?? "en-US";
}

function supportedMediaTypesForProviderSource(providerSource: ProviderSource): readonly MediaType[] {
  return getProviderSourceDefinition(providerSource).supportedMediaTypes;
}

function normalizeProviderIdForSource(providerSource: ProviderSource, providerId: string) {
  if (providerSource === "ptgen_imdb") {
    return providerId.replace(/^imdb-/i, "");
  }
  if (providerSource === "ptgen_douban") {
    return providerId.replace(/^douban-/i, "");
  }
  return providerId;
}

function localeKeyFromParts(language?: string | null, region?: string | null) {
  const normalizedLanguage = language?.trim();
  const normalizedRegion = region?.trim();
  if (normalizedLanguage && normalizedRegion) return `${normalizedLanguage}-${normalizedRegion}`;
  return normalizedLanguage || normalizedRegion || "und";
}

function extractTitleAliases(result: ProviderTitleResult) {
  const aliases = [
    ...(result.titleAliases ?? []),
    ...stringArrayFromPayload(result.payload, "aliases"),
    ...stringArrayFromPayload(result.payload, "titles")
  ];
  const blocked = new Set([
    result.title.toLowerCase(),
    result.originalTitle?.toLowerCase()
  ].filter(Boolean) as string[]);
  return [...new Set(
    aliases
      .map((value) => value.trim())
      .filter((value) => value && !blocked.has(value.toLowerCase()))
  )];
}

function stringArrayFromPayload(payload: unknown, key: string) {
  if (!payload || typeof payload !== "object") return [];
  const value = (payload as Record<string, unknown>)[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function providerEntityTypeForSource(providerSource: ProviderSource, mediaType: MediaType) {
  if (providerSource === "tmdb_api" && mediaType === "MOVIE") return "tmdb_movie";
  if (providerSource === "tmdb_api" && mediaType === "TV_SERIES") return "tmdb_tv";
  if (providerSource === "tvdb_api" && mediaType === "MOVIE") return "tvdb_movie";
  if (providerSource === "tvdb_api" && mediaType === "TV_SERIES") return "tvdb_series";
  if (providerSource === "ptgen_imdb") return "ptgen_imdb";
  if (providerSource === "ptgen_douban") return "ptgen_douban";
  throw conflict(
    "UNSUPPORTED_PROVIDER_ENTITY",
    `Provider source ${providerSource} does not support ${mediaType} detail lookup yet`
  );
}

function providerDetailIdForSource(providerSource: ProviderSource, providerId: string) {
  if (providerSource === "ptgen_imdb") {
    const normalized = providerId.replace(/^imdb-/i, "");
    return normalized.startsWith("tt") ? `imdb-${normalized}` : `imdb-tt${normalized}`;
  }
  if (providerSource === "ptgen_douban") {
    return `douban-${providerId.replace(/^douban-/i, "")}`;
  }
  return providerId;
}
