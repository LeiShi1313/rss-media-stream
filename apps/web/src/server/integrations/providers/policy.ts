import type { MediaProvider, MediaType, ParsedMediaType } from "@rss-media/shared/types";
import { badRequest } from "../../core/errors.js";
import { prisma } from "../../db.js";
import {
  getDefaultPoliciesForMediaType,
  getProviderDefinition,
  providerSupportsMediaType
} from "./index.js";
import type { ProviderDefaultPolicy } from "./types.js";

export type ProviderPolicyDto = {
  provider: MediaProvider;
  label: string;
  mediaType: MediaType;
  enabledForMatching: boolean;
  enabledForPresentation: boolean;
  matchingPriority: number;
  presentationPriority: number;
};

export type ProviderPolicyInput = {
  provider: MediaProvider;
  enabledForMatching: boolean;
  enabledForPresentation: boolean;
  matchingPriority: number;
  presentationPriority: number;
};

export type BroadSearchTarget = {
  provider: MediaProvider;
  mediaType: MediaType;
};

const CONCRETE_MEDIA_TYPES = ["MOVIE", "TV_SERIES"] as const satisfies readonly MediaType[];

export async function getProviderPolicies(tenantId: string) {
  const policies = await Promise.all(
    CONCRETE_MEDIA_TYPES.map(async (mediaType) => ({
      mediaType,
      policies: await getPoliciesForMediaType(tenantId, mediaType)
    }))
  );
  return { mediaTypes: policies };
}

export async function getMatchingProviderOrder(
  tenantId: string,
  mediaType: ParsedMediaType
): Promise<MediaProvider[]> {
  assertConcreteMediaType(mediaType);
  const disabled = await disabledProviders(tenantId);
  return (await getPoliciesForMediaType(tenantId, mediaType))
    .filter((policy) => policy.enabledForMatching && !disabled.has(policy.provider))
    .sort((a, b) => a.matchingPriority - b.matchingPriority)
    .map((policy) => policy.provider);
}

export async function getPresentationProviderOrder(
  tenantId: string,
  mediaType: ParsedMediaType
): Promise<MediaProvider[]> {
  assertConcreteMediaType(mediaType);
  const disabled = await disabledProviders(tenantId);
  return (await getPoliciesForMediaType(tenantId, mediaType))
    .filter((policy) => policy.enabledForPresentation && !disabled.has(policy.provider))
    .sort((a, b) => a.presentationPriority - b.presentationPriority)
    .map((policy) => policy.provider);
}

export async function getBroadSearchTargets(tenantId: string): Promise<BroadSearchTarget[]> {
  const mediaTypes = ["MOVIE", "TV_SERIES"] as const satisfies readonly MediaType[];
  const targets = await Promise.all(
    mediaTypes.map(async (mediaType) =>
      (await getMatchingProviderOrder(tenantId, mediaType)).map((provider) => ({
        provider,
        mediaType
      }))
    )
  );
  return targets.flat();
}

export async function replaceMediaProviderPolicies(
  tenantId: string,
  mediaType: ParsedMediaType,
  policies: ProviderPolicyInput[]
) {
  assertConcreteMediaType(mediaType);
  validatePolicyRows(mediaType, policies);

  await prisma.$transaction(async (tx) => {
    await tx.tenantMediaProviderPolicy.deleteMany({ where: { tenantId, mediaType } });
    if (policies.length === 0) return;
    await tx.tenantMediaProviderPolicy.createMany({
      data: policies.map((policy) => ({
        tenantId,
        mediaType,
        provider: policy.provider,
        enabledForMatching: policy.enabledForMatching,
        enabledForPresentation: policy.enabledForPresentation,
        matchingPriority: policy.matchingPriority,
        presentationPriority: policy.presentationPriority
      }))
    });
  });
}

async function getPoliciesForMediaType(
  tenantId: string,
  mediaType: MediaType
): Promise<ProviderPolicyDto[]> {
  assertConcreteMediaType(mediaType);
  const rows = await prisma.tenantMediaProviderPolicy.findMany({
    where: { tenantId, mediaType },
    orderBy: [{ matchingPriority: "asc" }, { presentationPriority: "asc" }, { provider: "asc" }]
  });
  const defaults = getDefaultPoliciesForMediaType(mediaType);
  const source = rows.length > 0
    ? mergeMissingDefaultPolicies(rows, defaults)
    : defaults;

  return source.map((policy) => {
    const definition = getProviderDefinition(policy.provider);
    return {
      provider: policy.provider as MediaProvider,
      label: definition.label,
      mediaType,
      enabledForMatching: policy.enabledForMatching,
      enabledForPresentation: policy.enabledForPresentation,
      matchingPriority: policy.matchingPriority,
      presentationPriority: policy.presentationPriority
    };
  });
}

function mergeMissingDefaultPolicies(
  rows: Array<{
    provider: string;
    enabledForMatching: boolean;
    enabledForPresentation: boolean;
    matchingPriority: number;
    presentationPriority: number;
  }>,
  defaults: Array<ProviderDefaultPolicy & { provider: MediaProvider }>
) {
  const seen = new Set(rows.map((row) => row.provider));
  return [
    ...rows,
    ...defaults.filter((policy) => !seen.has(policy.provider))
  ].sort((a, b) =>
    a.matchingPriority - b.matchingPriority ||
    a.presentationPriority - b.presentationPriority ||
    a.provider.localeCompare(b.provider)
  );
}

async function disabledProviders(tenantId: string) {
  const rows = await prisma.tenantProviderConfig.findMany({
    where: { tenantId, enabled: false },
    select: { provider: true }
  });
  return new Set(rows.map((row) => row.provider as MediaProvider));
}

function validatePolicyRows(mediaType: MediaType, policies: ProviderPolicyInput[]) {
  const providers = new Set<string>();
  for (const policy of policies) {
    getProviderDefinition(policy.provider);
    if (!providerSupportsMediaType(policy.provider, mediaType)) {
      throw badRequest(`${policy.provider} does not support ${mediaType}`);
    }
    if (providers.has(policy.provider)) {
      throw badRequest(`Duplicate ${policy.provider} policy for ${mediaType}`);
    }
    providers.add(policy.provider);
  }

  rejectDuplicateEnabledPriority(policies, "enabledForMatching", "matchingPriority", "matching");
  rejectDuplicateEnabledPriority(
    policies,
    "enabledForPresentation",
    "presentationPriority",
    "presentation"
  );
}

function rejectDuplicateEnabledPriority(
  policies: ProviderPolicyInput[],
  enabledKey: "enabledForMatching" | "enabledForPresentation",
  priorityKey: "matchingPriority" | "presentationPriority",
  label: string
) {
  const seen = new Map<number, string>();
  for (const policy of policies) {
    if (!policy[enabledKey]) continue;
    const existing = seen.get(policy[priorityKey]);
    if (existing) {
      throw badRequest(
        `Duplicate ${label} priority ${policy[priorityKey]} for ${existing} and ${policy.provider}`
      );
    }
    seen.set(policy[priorityKey], policy.provider);
  }
}

function assertConcreteMediaType(mediaType: ParsedMediaType): asserts mediaType is MediaType {
  if (mediaType !== "MOVIE" && mediaType !== "TV_SERIES") {
    throw badRequest("Provider policies require a concrete media type");
  }
}
