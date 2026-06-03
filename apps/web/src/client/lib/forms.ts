import type { Subscription } from "../api.js";

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

export function providerValue(value?: string): "" | "tmdb" | "imdb" | "douban" {
  return value === "tmdb" || value === "imdb" || value === "douban" ? value : "";
}

export function ruleSummary(subscription: Subscription) {
  const rule = subscription.rule;
  if (!rule) return "No rule configured";
  return [
    rule.mediaKind,
    rule.minResolution ? `${rule.minResolution}p+` : undefined,
    rule.includeRegex ? `include /${rule.includeRegex}/` : undefined,
    rule.excludeRegex ? `exclude /${rule.excludeRegex}/` : undefined
  ]
    .filter(Boolean)
    .join(" · ") || "Any release";
}

