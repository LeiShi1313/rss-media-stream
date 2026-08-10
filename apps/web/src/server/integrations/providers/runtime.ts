import type {
  ProviderSettingsDto,
  ProviderSettingsResponseDto
} from "@rss-media/shared/apiContracts";
import type { MediaProvider, ProviderSource } from "@rss-media/shared/types";
import type { AppConfig } from "../../config.js";
import { badRequest } from "../../core/errors.js";
import { prisma } from "../../db.js";
import { decryptSecret, encryptSecret } from "../../secrets.js";
import { getMetadataProvider, listProviderSourceDefinitions } from "./index.js";
import { getProviderSourceDefinition, normalizeProviderSource } from "./sources.js";
import type { ProviderRuntimeContext, ProviderSecrets } from "./types.js";

export async function resolveProviderRuntime(
  config: AppConfig,
  tenantId: string,
  providerSource: ProviderSource | string
): Promise<ProviderRuntimeContext> {
  const normalizedProviderSource = requireProviderSource(providerSource);
  const definition = getProviderSourceDefinition(normalizedProviderSource);
  const row = await findProviderSourceConfig(tenantId, normalizedProviderSource);
  const workspaceSecrets = row?.encryptedSecretsJson
    ? cleanSecrets(JSON.parse(decryptSecret(row.encryptedSecretsJson, config.appSecret)))
    : undefined;
  const environment = environmentSecrets(config, normalizedProviderSource);
  const credential = workspaceSecrets && Object.keys(workspaceSecrets).length > 0
    ? { source: "workspace" as const, secrets: workspaceSecrets }
    : environment
      ? { source: "environment" as const, secrets: environment }
      : undefined;
  const baseUrl = providerSupportsBaseUrl(definition)
    ? row?.baseUrl ?? definition.defaultBaseUrl
    : undefined;

  return {
    tenantId,
    providerSource: normalizedProviderSource,
    provider: definition.provider,
    adapterId: definition.adapterId,
    enabled: row?.enabled ?? true,
    credential,
    metadataLanguage: row?.metadataLanguage ?? definition.defaultMetadataLanguage,
    region: row?.region ?? undefined,
    baseUrl
  };
}

export async function listProviderSettings(
  config: AppConfig,
  tenantId: string
): Promise<ProviderSettingsResponseDto> {
  const statuses = await Promise.all(
    listProviderSourceDefinitions().map(async (definition): Promise<ProviderSettingsDto> => {
      const runtime = await resolveProviderRuntime(config, tenantId, definition.id);
      const row = await findProviderSourceConfig(tenantId, definition.id);
      return {
        id: definition.id,
        provider: definition.provider,
        label: definition.label,
        supportedMediaTypes: [...definition.supportedMediaTypes],
        ratingSupportedMediaTypes: [...definition.ratingSupportedMediaTypes],
        authFields: definition.authFields.map((field) => ({ ...field })),
        supportsMetadataLanguage: definition.supportsMetadataLanguage,
        supportsRegion: definition.supportsRegion,
        baseUrlOptions: (definition.baseUrlOptions ?? []).map((option) => ({ ...option })),
        enabled: runtime.enabled,
        configured: providerRuntimeConfigured(runtime),
        credentialSource: runtime.credential?.source ?? null,
        configuredAt: row?.configuredAt?.toISOString() ?? null,
        lastValidatedAt: row?.lastValidatedAt?.toISOString() ?? null,
        lastError: row?.lastError ?? null,
        metadataLanguage: runtime.metadataLanguage ?? null,
        region: runtime.region ?? null,
        baseUrl: runtime.baseUrl ?? null
      };
    })
  );

  return { providers: statuses };
}

export async function upsertProviderSettings(input: {
  config: AppConfig;
  tenantId: string;
  providerSource?: ProviderSource | string;
  provider?: MediaProvider | string;
  enabled?: boolean;
  secrets?: ProviderSecrets;
  clearSecrets?: boolean;
  metadataLanguage?: string | null;
  region?: string | null;
  baseUrl?: string | null;
}) {
  const providerSource = requireProviderSource(input.providerSource ?? input.provider);
  const definition = getProviderSourceDefinition(providerSource);
  const data: {
    enabled?: boolean;
    encryptedSecretsJson?: string | null;
    configuredAt?: Date | null;
    lastValidatedAt?: Date | null;
    lastError?: string | null;
    metadataLanguage?: string | null;
    region?: string | null;
    baseUrl?: string | null;
  } = {};

  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.metadataLanguage !== undefined) {
    if (!definition.supportsMetadataLanguage && input.metadataLanguage) {
      throw badRequest(`${definition.label} does not support metadata language settings`);
    }
    data.metadataLanguage = input.metadataLanguage;
  }
  if (input.region !== undefined) {
    if (!definition.supportsRegion && input.region) {
      throw badRequest(`${definition.label} does not support region settings`);
    }
    data.region = input.region?.trim() || null;
  }
  if (input.baseUrl !== undefined) {
    data.baseUrl = validateBaseUrl(definition.label, definition.baseUrlOptions, input.baseUrl);
  }
  if (!providerSupportsBaseUrl(definition)) {
    data.baseUrl = null;
  }

  if (input.clearSecrets) {
    data.encryptedSecretsJson = null;
    data.configuredAt = null;
    data.lastValidatedAt = null;
    data.lastError = null;
  }

  // lastError is the only field that differs between the validation-failure
  // upsert and the final success upsert.
  const upsertConfig = (lastError?: string) =>
    prisma.tenantProviderSourceConfig.upsert({
      where: { tenantId_providerSource: { tenantId: input.tenantId, providerSource } },
      create: {
        tenantId: input.tenantId,
        providerSource,
        enabled: data.enabled ?? true,
        encryptedSecretsJson: data.encryptedSecretsJson,
        configuredAt: data.configuredAt,
        lastValidatedAt: data.lastValidatedAt,
        lastError: lastError ?? data.lastError,
        metadataLanguage: data.metadataLanguage ?? definition.defaultMetadataLanguage,
        region: data.region,
        baseUrl: data.baseUrl ?? definition.defaultBaseUrl
      },
      update: lastError === undefined ? data : { ...data, lastError }
    });

  if (input.secrets) {
    const secrets = validateSecretShape(providerSource, input.secrets);
    try {
      const provider = getMetadataProvider(definition.adapterId);
      if (!provider.validateCredentials) {
        throw badRequest(`Provider source ${providerSource} cannot validate credentials`);
      }
      await provider.validateCredentials(secrets);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await upsertConfig(message);
      throw badRequest(message);
    }

    const now = new Date();
    data.encryptedSecretsJson = encryptSecret(JSON.stringify(secrets), input.config.appSecret);
    data.configuredAt = now;
    data.lastValidatedAt = now;
    data.lastError = null;
  }

  await upsertConfig();
}

export function providerRuntimeAvailable(runtime: ProviderRuntimeContext) {
  return runtime.enabled && providerRuntimeConfigured(runtime);
}

export function providerRuntimeConfigured(runtime: ProviderRuntimeContext) {
  const definition = getProviderSourceDefinition(runtime.providerSource);
  return !providerRequiresCredentials(definition.authFields) || Boolean(runtime.credential);
}

function validateSecretShape(providerSource: ProviderSource | string, rawSecrets: ProviderSecrets) {
  const definition = getProviderSourceDefinition(requireProviderSource(providerSource));
  const allowed = new Set(definition.authFields.map((field) => field.key));
  const cleaned = cleanSecrets(rawSecrets);

  for (const key of Object.keys(cleaned)) {
    if (!allowed.has(key)) throw badRequest(`${definition.label} does not accept credential field ${key}`);
  }
  for (const field of definition.authFields) {
    if (field.required && !cleaned[field.key]) {
      throw badRequest(`${definition.label} ${field.label} is required`);
    }
  }

  return cleaned;
}

function requireProviderSource(providerSource?: string | null): ProviderSource {
  return getProviderSourceDefinition(normalizeProviderSource(providerSource) ?? providerSource ?? "").id;
}

function environmentSecrets(config: AppConfig, providerSource: ProviderSource): ProviderSecrets | undefined {
  if (providerSource === "tmdb_api" && config.tmdbApiKey) return { apiKey: config.tmdbApiKey };
  if (providerSource === "tvdb_api" && config.tvdbApiKey) {
    return {
      apiKey: config.tvdbApiKey,
      ...(config.tvdbPin ? { pin: config.tvdbPin } : {})
    };
  }
  return undefined;
}

async function legacyProviderConfig(tenantId: string, providerSource: ProviderSource) {
  const legacyProvider = legacyProviderForSource(providerSource);
  if (!legacyProvider) return null;
  return prisma.tenantProviderConfig.findUnique({
    where: { tenantId_provider: { tenantId, provider: legacyProvider } }
  });
}

async function findProviderSourceConfig(tenantId: string, providerSource: ProviderSource) {
  const sourceRow = await prisma.tenantProviderSourceConfig.findUnique({
    where: { tenantId_providerSource: { tenantId, providerSource } }
  });
  return sourceRow ?? legacyProviderConfig(tenantId, providerSource);
}

function legacyProviderForSource(providerSource: ProviderSource) {
  if (providerSource === "tmdb_api") return "tmdb";
  if (providerSource === "tvdb_api") return "tvdb";
  if (providerSource === "ptgen_imdb" || providerSource === "ptgen_douban") return "ptgen";
  return undefined;
}

function validateBaseUrl(
  label: string,
  options: readonly { value: string }[] | undefined,
  value: string | null
) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!options?.length) {
    throw badRequest(`${label} does not support base URL settings`);
  }

  try {
    new URL(trimmed);
  } catch {
    throw badRequest(`${label} base URL must be a valid URL`);
  }

  const canonical = options.find((option) =>
    normalizeBaseUrlForComparison(option.value) === normalizeBaseUrlForComparison(trimmed)
  )?.value;
  if (!canonical) {
    throw badRequest(`${label} base URL is not supported`);
  }

  return canonical;
}

function providerSupportsBaseUrl(definition: { defaultBaseUrl?: string; baseUrlOptions?: readonly { value: string }[] }) {
  return Boolean(definition.defaultBaseUrl || definition.baseUrlOptions?.length);
}

function providerRequiresCredentials(authFields: readonly { required: boolean }[]) {
  return authFields.some((field) => field.required);
}

function normalizeBaseUrlForComparison(value: string) {
  const url = new URL(value.trim());
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}

function cleanSecrets(rawSecrets: unknown): ProviderSecrets {
  if (!rawSecrets || typeof rawSecrets !== "object") return {};
  return Object.fromEntries(
    Object.entries(rawSecrets as Record<string, unknown>)
      .map(([key, value]) => [key, typeof value === "string" ? value.trim() : ""] as const)
      .filter(([, value]) => value.length > 0)
  );
}
