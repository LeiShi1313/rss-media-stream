import type { SubscriptionDto } from "@rss-media/shared/apiContracts";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function optionalText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function numberOrUndefined(value: string) {
  if (!value.trim()) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function filterByQuery<T>(rows: T[], query: string, fields: (row: T) => unknown[]) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return rows;
  return rows.filter((row) =>
    fields(row)
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedQuery))
  );
}

export function stringListFromInput(value: string) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function providerLabel(provider?: string) {
  if (!provider) return undefined;
  return provider.toUpperCase();
}

function comparisonLabel(comparison: string) {
  return comparison === "gte" ? ">=" :
    comparison === "lte" ? "<=" :
    comparison === "gt" ? ">" :
    comparison === "lt" ? "<" :
    "=";
}

export function ruleSummary(subscription: SubscriptionDto, t?: Translate) {
  const rule = subscription.rule;
  if (!rule) return t?.("subscriptions.noRule") ?? "No rule configured";
  return [
    rule.mode === "REGEX" ? t?.("subscriptions.regexMode") ?? "Regex" : t?.("subscriptions.mediaTitleMode") ?? "Media title",
    rule.mediaType === "TV_SERIES" ? t?.("common.series") ?? "Series" : rule.mediaType,
    rule.season ? t?.("subscriptions.seasonRule", { value: rule.season }) ?? `S${rule.season}` : undefined,
    rule.minResolution ? `${rule.minResolution}p+` : undefined,
    rule.selectedProvider
      ? `${providerLabel(rule.selectedProvider.provider)} ${rule.selectedProvider.providerId}`
      : undefined,
    ...(rule.linkedProviders ?? []).map((filter) =>
      `${providerLabel(filter.provider)} ${filter.providerId}`
    ),
    ...(rule.providerRatings ?? []).map((filter) =>
      `${providerLabel(filter.provider)} ${filter.ratingType ?? ""} ${comparisonLabel(filter.comparison)} ${filter.value}${filter.scale ? `/${filter.scale}` : ""}${filter.minVoteCount ? ` (${filter.minVoteCount}+ votes)` : ""}`.replace(/\s+/g, " ").trim()
    ),
    rule.feedIds?.length ? t?.("subscriptions.feedRule", { count: rule.feedIds.length }) ?? `${rule.feedIds.length} feeds` : undefined,
    rule.preferredReleaseGroups?.length ? t?.("subscriptions.preferredGroupRule", { value: rule.preferredReleaseGroups.join(", ") }) ?? `prefer ${rule.preferredReleaseGroups.join(", ")}` : undefined,
    rule.upgradePolicy && rule.upgradePolicy !== "none"
      ? t?.(`subscriptions.upgradeRule.${rule.upgradePolicy}`) ?? rule.upgradePolicy
      : undefined,
    rule.includeRegex ? t?.("subscriptions.includeRule", { value: rule.includeRegex }) ?? `include /${rule.includeRegex}/` : undefined,
    rule.excludeRegex ? t?.("subscriptions.excludeRule", { value: rule.excludeRegex }) ?? `exclude /${rule.excludeRegex}/` : undefined
  ]
    .filter(Boolean)
    .join(" · ") || t?.("subscriptions.anyRelease") || "Any release";
}
