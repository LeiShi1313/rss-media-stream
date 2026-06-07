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

export function providerValue(value?: string): "" | "tmdb" | "imdb" | "douban" {
  return value === "tmdb" || value === "imdb" || value === "douban" ? value : "";
}

export function ruleSummary(subscription: Subscription, t?: Translate) {
  const rule = subscription.rule;
  if (!rule) return t?.("subscriptions.noRule") ?? "No rule configured";
  return [
    rule.mediaKind,
    rule.minResolution ? `${rule.minResolution}p+` : undefined,
    rule.includeRegex ? t?.("subscriptions.includeRule", { value: rule.includeRegex }) ?? `include /${rule.includeRegex}/` : undefined,
    rule.excludeRegex ? t?.("subscriptions.excludeRule", { value: rule.excludeRegex }) ?? `exclude /${rule.excludeRegex}/` : undefined
  ]
    .filter(Boolean)
    .join(" · ") || t?.("subscriptions.anyRelease") || "Any release";
}
