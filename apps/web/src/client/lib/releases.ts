import type { Item } from "../api.js";

export type ReleaseIdentityState = "resolved" | "review" | "unresolved";
export type ItemMatchState =
  | "unmatched"
  | "pending"
  | "unparsed"
  | "matched"
  | "provider_unavailable"
  | "manual_override"
  | "review";

export function itemMatchState(item: Item): ItemMatchState {
  const match = item.match;
  if (!match && item.enrichmentState === "PENDING") return "pending";
  if (!match && item.enrichmentState === "UNPARSED") return "unparsed";
  if (!match) return "unmatched";
  if (
    match.reason === "provider_unavailable" ||
    match.reason === "TMDB_NOT_CONFIGURED" ||
    match.attention.reasons.includes("provider_not_configured")
  ) {
    return "provider_unavailable";
  }
  if (match.status === "UNMATCHED") return "unmatched";
  if (match.status === "REJECTED") return "review";
  if (match.attention.required) return "review";
  if (match.status === "MATCHED") {
    return match.source === "MANUAL" || match.reason === "manual_provider_identity"
      ? "manual_override"
      : "matched";
  }
  return "unmatched";
}

export function releaseIdentityState(item: Item): ReleaseIdentityState {
  if (item.match?.status === "MATCHED") {
    return item.match.attention.required ? "review" : "resolved";
  }
  return item.match ? "review" : "unresolved";
}

export function releaseTitle(item: Item) {
  return item.match?.presentation?.title ?? item.parsedRelease?.title ?? item.rawTitle;
}

export function releaseStatus(item: Item): {
  label: string;
  labelKey: string;
  ok: boolean;
  group: "review" | "downloaded" | "failed";
} {
  const latestJob = [...(item.downloadJobs ?? [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0];
  if (latestJob?.status === "FAILED") {
    return { label: "Failed", labelKey: "release.status.failed", ok: false, group: "failed" };
  }
  if (latestJob && ["SENT", "COMPLETED"].includes(latestJob.status)) {
    return { label: "Downloaded", labelKey: "release.status.downloaded", ok: true, group: "downloaded" };
  }
  if (latestJob) {
    return { label: latestJob.status, labelKey: `release.status.${latestJob.status.toLowerCase()}`, ok: true, group: "review" };
  }
  const matchState = itemMatchState(item);
  if (matchState === "matched") return { label: "Ready", labelKey: "release.status.ready", ok: true, group: "review" };
  if (matchState === "manual_override") return { label: "Manual match", labelKey: "release.status.manualOverride", ok: true, group: "review" };
  if (matchState === "review") return { label: "Check match", labelKey: "release.status.checkTitle", ok: false, group: "review" };
  if (matchState === "provider_unavailable") return { label: "Provider unavailable", labelKey: "release.status.providerUnavailable", ok: false, group: "review" };
  if (matchState === "pending") return { label: "Processing", labelKey: "release.status.processing", ok: false, group: "review" };
  return { label: "Needs title", labelKey: "release.status.needsTitle", ok: false, group: "review" };
}

export function matchRate(matched: number, total: number) {
  if (total <= 0) return "0%";
  return `${Math.round((matched / total) * 100)}%`;
}
