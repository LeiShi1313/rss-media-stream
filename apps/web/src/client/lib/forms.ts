import type { Subscription } from "../api.js";

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

export function stringListFromInput(value: string) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function providerValue(value?: string): "" | "tmdb" | "tvdb" | "imdb" | "douban" | "wikidata" | "trakt" | "musicbrainz" {
  return value === "tmdb" ||
    value === "tvdb" ||
    value === "imdb" ||
    value === "douban" ||
    value === "wikidata" ||
    value === "trakt" ||
    value === "musicbrainz"
    ? value
    : "";
}

function providerLabel(provider?: string) {
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

export function ruleSummary(subscription: Subscription, t?: Translate) {
  const rule = subscription.rule;
  if (!rule) return t?.("subscriptions.noRule") ?? "No rule configured";
  return [
    rule.mediaType === "TV_SERIES" ? t?.("common.series") ?? "Series" : rule.mediaType,
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
    rule.includeRegex ? t?.("subscriptions.includeRule", { value: rule.includeRegex }) ?? `include /${rule.includeRegex}/` : undefined,
    rule.excludeRegex ? t?.("subscriptions.excludeRule", { value: rule.excludeRegex }) ?? `exclude /${rule.excludeRegex}/` : undefined
  ]
    .filter(Boolean)
    .join(" · ") || t?.("subscriptions.anyRelease") || "Any release";
}
