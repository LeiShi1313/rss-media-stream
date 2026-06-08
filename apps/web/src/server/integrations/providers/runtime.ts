import type { MediaProvider } from "@rss-media/shared/types";
import type { AppConfig } from "../../config.js";
import { badRequest } from "../../core/errors.js";
import { prisma } from "../../db.js";
import { decryptSecret, encryptSecret } from "../../secrets.js";
import { getMetadataProvider, getProviderDefinition, listProviderDefinitions } from "./index.js";
import type { ProviderRuntimeContext, ProviderSecrets } from "./types.js";

export type ProviderCredentialSource = "workspace" | "environment";

export type ProviderSettingsStatus = {
  id: MediaProvider;
  label: string;
  supportedMediaTypes: readonly string[];
  authFields: readonly {
    key: string;
    label: string;
    secret: boolean;
    required: boolean;
  }[];
  supportsMetadataLanguage: boolean;
  supportsRegion: boolean;
  enabled: boolean;
  configured: boolean;
  credentialSource: ProviderCredentialSource | null;
  configuredAt?: Date | null;
  lastValidatedAt?: Date | null;
  lastError?: string | null;
  metadataLanguage?: string | null;
  region?: string | null;
};

export async function resolveProviderRuntime(
  config: AppConfig,
  tenantId: string,
  provider: MediaProvider
): Promise<ProviderRuntimeContext> {
  const definition = getProviderDefinition(provider);
  const row = await prisma.tenantProviderConfig.findUnique({
    where: { tenantId_provider: { tenantId, provider } }
  });
  const workspaceSecrets = row?.encryptedSecretsJson
    ? cleanSecrets(JSON.parse(decryptSecret(row.encryptedSecretsJson, config.appSecret)))
    : undefined;
  const environment = environmentSecrets(config, provider);
  const credential = workspaceSecrets && Object.keys(workspaceSecrets).length > 0
    ? { source: "workspace" as const, secrets: workspaceSecrets }
    : environment
      ? { source: "environment" as const, secrets: environment }
      : undefined;

  return {
    tenantId,
    provider,
    enabled: row?.enabled ?? true,
    credential,
    metadataLanguage: row?.metadataLanguage ?? definition.defaultMetadataLanguage,
    region: row?.region ?? undefined
  };
}

export async function providerIsConfigured(
  config: AppConfig,
  tenantId: string,
  provider: MediaProvider
) {
  const runtime = await resolveProviderRuntime(config, tenantId, provider);
  return runtime.enabled && Boolean(runtime.credential);
}

export async function listProviderSettings(config: AppConfig, tenantId: string) {
  const statuses = await Promise.all(
    listProviderDefinitions().map(async (definition): Promise<ProviderSettingsStatus> => {
      const runtime = await resolveProviderRuntime(config, tenantId, definition.id);
      const row = await prisma.tenantProviderConfig.findUnique({
        where: { tenantId_provider: { tenantId, provider: definition.id } }
      });
      return {
        id: definition.id,
        label: definition.label,
        supportedMediaTypes: definition.supportedMediaTypes,
        authFields: definition.authFields,
        supportsMetadataLanguage: definition.supportsMetadataLanguage,
        supportsRegion: definition.supportsRegion,
        enabled: runtime.enabled,
        configured: Boolean(runtime.credential),
        credentialSource: runtime.credential?.source ?? null,
        configuredAt: row?.configuredAt ?? null,
        lastValidatedAt: row?.lastValidatedAt ?? null,
        lastError: row?.lastError ?? null,
        metadataLanguage: runtime.metadataLanguage ?? null,
        region: runtime.region ?? null
      };
    })
  );

  return { providers: statuses };
}

export async function upsertProviderSettings(input: {
  config: AppConfig;
  tenantId: string;
  provider: MediaProvider;
  enabled?: boolean;
  secrets?: ProviderSecrets;
  clearSecrets?: boolean;
  metadataLanguage?: string | null;
  region?: string | null;
}) {
  const definition = getProviderDefinition(input.provider);
  const data: {
    enabled?: boolean;
    encryptedSecretsJson?: string | null;
    configuredAt?: Date | null;
    lastValidatedAt?: Date | null;
    lastError?: string | null;
    metadataLanguage?: string | null;
    region?: string | null;
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

  if (input.clearSecrets) {
    data.encryptedSecretsJson = null;
    data.configuredAt = null;
    data.lastValidatedAt = null;
    data.lastError = null;
  }

  if (input.secrets) {
    const secrets = validateSecretShape(input.provider, input.secrets);
    try {
      const provider = getMetadataProvider(input.provider);
      if (!provider.validateCredentials) {
        throw badRequest(`Media provider ${input.provider} cannot validate credentials`);
      }
      await provider.validateCredentials(secrets);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.tenantProviderConfig.upsert({
        where: { tenantId_provider: { tenantId: input.tenantId, provider: input.provider } },
        create: {
          tenantId: input.tenantId,
          provider: input.provider,
          enabled: input.enabled ?? true,
          metadataLanguage: data.metadataLanguage ?? definition.defaultMetadataLanguage,
          region: data.region,
          lastError: message
        },
        update: {
          ...data,
          lastError: message
        }
      });
      throw badRequest(message);
    }

    const now = new Date();
    data.encryptedSecretsJson = encryptSecret(JSON.stringify(secrets), input.config.appSecret);
    data.configuredAt = now;
    data.lastValidatedAt = now;
    data.lastError = null;
  }

  await prisma.tenantProviderConfig.upsert({
    where: { tenantId_provider: { tenantId: input.tenantId, provider: input.provider } },
    create: {
      tenantId: input.tenantId,
      provider: input.provider,
      enabled: data.enabled ?? true,
      encryptedSecretsJson: data.encryptedSecretsJson,
      configuredAt: data.configuredAt,
      lastValidatedAt: data.lastValidatedAt,
      lastError: data.lastError,
      metadataLanguage: data.metadataLanguage ?? definition.defaultMetadataLanguage,
      region: data.region
    },
    update: data
  });
}

export function validateSecretShape(provider: MediaProvider, rawSecrets: ProviderSecrets) {
  const definition = getProviderDefinition(provider);
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

function environmentSecrets(config: AppConfig, provider: MediaProvider): ProviderSecrets | undefined {
  if (provider === "tmdb" && config.tmdbApiKey) return { apiKey: config.tmdbApiKey };
  if (provider === "tvdb" && config.tvdbApiKey) {
    return {
      apiKey: config.tvdbApiKey,
      ...(config.tvdbPin ? { pin: config.tvdbPin } : {})
    };
  }
  return undefined;
}

function cleanSecrets(rawSecrets: unknown): ProviderSecrets {
  if (!rawSecrets || typeof rawSecrets !== "object") return {};
  return Object.fromEntries(
    Object.entries(rawSecrets as Record<string, unknown>)
      .map(([key, value]) => [key, typeof value === "string" ? value.trim() : ""] as const)
      .filter(([, value]) => value.length > 0)
  );
}
