import type { MediaProvider, MediaType, ParsedMediaType, ProviderSource } from "@rss-media/shared/types";
import { badRequest } from "../../core/errors.js";
import { prisma } from "../../db.js";
import {
  getProviderSourceDefinition,
  providerSourceForLegacyProvider,
  providerSourceSupportsMediaType
} from "./index.js";
import { getDefaultProviderSourcePoliciesForMediaType } from "./sources.js";
import type { ProviderDefaultPolicy } from "./types.js";

export type ProviderPolicyDto = {
  providerSource: ProviderSource;
  provider: MediaProvider;
  label: string;
  mediaType: MediaType;
  enabledForMatching: boolean;
  enabledForPresentation: boolean;
  matchingPriority: number;
  presentationPriority: number;
};

export type ProviderPolicyInput = {
  providerSource?: ProviderSource | string;
  provider?: MediaProvider | string;
  enabledForMatching: boolean;
  enabledForPresentation: boolean;
  matchingPriority: number;
  presentationPriority: number;
};

export type BroadSearchTarget = {
  providerSource: ProviderSource;
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
): Promise<ProviderSource[]> {
  assertConcreteMediaType(mediaType);
  const disabled = await disabledProviderSources(tenantId);
  return (await getPoliciesForMediaType(tenantId, mediaType))
    .filter((policy) => policy.enabledForMatching && !disabled.has(policy.providerSource))
    .sort((a, b) => a.matchingPriority - b.matchingPriority)
    .map((policy) => policy.providerSource);
}

export async function getPresentationProviderOrder(
  tenantId: string,
  mediaType: ParsedMediaType
): Promise<ProviderSource[]> {
  assertConcreteMediaType(mediaType);
  const disabled = await disabledProviderSources(tenantId);
  return (await getPoliciesForMediaType(tenantId, mediaType))
    .filter((policy) => policy.enabledForPresentation && !disabled.has(policy.providerSource))
    .sort((a, b) => a.presentationPriority - b.presentationPriority)
    .map((policy) => policy.providerSource);
}

export async function getBroadSearchTargets(tenantId: string): Promise<BroadSearchTarget[]> {
  const mediaTypes = ["MOVIE", "TV_SERIES"] as const satisfies readonly MediaType[];
  const targets = await Promise.all(
    mediaTypes.map(async (mediaType) =>
      (await getMatchingProviderOrder(tenantId, mediaType)).map((providerSource) => ({
        providerSource,
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
    const sourcePolicyModel = (tx as any).tenantProviderSourcePolicy ?? (tx as any).tenantMediaProviderPolicy;
    await sourcePolicyModel.deleteMany({ where: { tenantId, mediaType } });
    if (policies.length === 0) return;
    await sourcePolicyModel.createMany({
      data: policies.map((policy) => ({
        tenantId,
        mediaType,
        ...policyProviderPersistence(policy),
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
  const sourcePolicyModel = (prisma as any).tenantProviderSourcePolicy ?? prisma.tenantMediaProviderPolicy;
  const rows = await sourcePolicyModel.findMany({
    where: { tenantId, mediaType },
    orderBy: [{ matchingPriority: "asc" }, { presentationPriority: "asc" }, { providerSource: "asc" }]
  });
  const defaults = getDefaultProviderSourcePoliciesForMediaType(mediaType);
  const source = rows.length > 0
    ? mergeMissingDefaultPolicies(rows.map(normalizePolicyRow), defaults)
    : defaults;

  return source.map((policy) => {
    const definition = getProviderSourceDefinition(policy.providerSource);
    return {
      providerSource: policy.providerSource as ProviderSource,
      provider: definition.provider as MediaProvider,
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
    providerSource: string;
    enabledForMatching: boolean;
    enabledForPresentation: boolean;
    matchingPriority: number;
    presentationPriority: number;
  }>,
  defaults: Array<ProviderDefaultPolicy & { providerSource: ProviderSource }>
) {
  const seen = new Set(rows.map((row) => row.providerSource));
  return [
    ...rows,
    ...defaults.filter((policy) => !seen.has(policy.providerSource))
  ].sort((a, b) =>
    a.matchingPriority - b.matchingPriority ||
    a.presentationPriority - b.presentationPriority ||
    a.providerSource.localeCompare(b.providerSource)
  );
}

async function disabledProviderSources(tenantId: string) {
  const rows: Array<{ providerSource: string }> = await ((prisma as any).tenantProviderSourceConfig?.findMany?.({
    where: { tenantId, enabled: false },
    select: { providerSource: true }
  }) ?? []);
  const disabled = new Set(rows.map((row) => row.providerSource as ProviderSource));

  const legacyRows = await prisma.tenantProviderConfig.findMany({
    where: { tenantId, enabled: false },
    select: { provider: true }
  });
  for (const row of legacyRows) {
    const source = providerSourceForLegacyProvider(row.provider);
    if (source) disabled.add(source);
    if (row.provider === "ptgen") disabled.add("ptgen_douban");
  }
  return disabled;
}

function validatePolicyRows(mediaType: MediaType, policies: ProviderPolicyInput[]) {
  const providerSources = new Set<string>();
  for (const policy of policies) {
    const providerSource = normalizePolicyProviderSource(policy);
    getProviderSourceDefinition(providerSource);
    if (!providerSourceSupportsMediaType(providerSource, mediaType)) {
      throw badRequest(`${providerSource} does not support ${mediaType}`);
    }
    if (providerSources.has(providerSource)) {
      throw badRequest(`Duplicate ${providerSource} policy for ${mediaType}`);
    }
    providerSources.add(providerSource);
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
        `Duplicate ${label} priority ${policy[priorityKey]} for ${existing} and ${normalizePolicyProviderSource(policy)}`
      );
    }
    seen.set(policy[priorityKey], normalizePolicyProviderSource(policy));
  }
}

function normalizePolicyProviderSource(policy: ProviderPolicyInput | { providerSource?: string; provider?: string }) {
  const providerSource = providerSourceForLegacyProvider(policy.providerSource ?? "") ??
    providerSourceForLegacyProvider(policy.provider ?? "") ??
    policy.providerSource;
  return getProviderSourceDefinition(providerSource ?? "").id;
}

function normalizePolicyRow(row: {
  providerSource?: string;
  provider?: string;
  enabledForMatching: boolean;
  enabledForPresentation: boolean;
  matchingPriority: number;
  presentationPriority: number;
}) {
  return {
    ...row,
    providerSource: normalizePolicyProviderSource(row)
  };
}

function policyProviderPersistence(policy: ProviderPolicyInput) {
  const providerSource = normalizePolicyProviderSource(policy);
  if ((prisma as any).tenantProviderSourcePolicy) return { providerSource };
  return { provider: providerSourceForLegacyProvider(providerSource) ?? providerSource };
}

function assertConcreteMediaType(mediaType: ParsedMediaType): asserts mediaType is MediaType {
  if (mediaType !== "MOVIE" && mediaType !== "TV_SERIES") {
    throw badRequest("Provider policies require a concrete media type");
  }
}
