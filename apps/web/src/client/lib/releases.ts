import type { Item } from "../api.js";

export function releaseTitle(item: Item) {
  return item.mediaMatch?.title ?? item.parsedRelease?.title ?? item.rawTitle;
}

export function releaseStatus(item: Item): {
  label: string;
  detail: string;
  ok: boolean;
  group: "review" | "downloaded" | "failed";
} {
  const latestJob = [...(item.downloadJobs ?? [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0];
  if (latestJob?.status === "FAILED") {
    return { label: "Failed", detail: latestJob.error ?? "Download error", ok: false, group: "failed" };
  }
  if (latestJob && ["SENT", "COMPLETED"].includes(latestJob.status)) {
    return { label: "Downloaded", detail: "Sent to downloader", ok: true, group: "downloaded" };
  }
  if (latestJob) {
    return { label: latestJob.status, detail: "Download job active", ok: true, group: "review" };
  }
  if (item.mediaMatch) return { label: "Pending review", detail: "New match", ok: true, group: "review" };
  return { label: "Unmatched", detail: "Needs matching", ok: false, group: "review" };
}

export function confidencePercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function confidenceBarWidth(value: number) {
  return `${Math.min(100, Math.max(6, Math.round(value * 100)))}%`;
}

export function matchRate(matched: number, total: number) {
  if (total <= 0) return "0%";
  return `${Math.round((matched / total) * 100)}%`;
}

