import type { Item } from "../api.js";

export type ReleaseIdentityState = "resolved" | "review" | "unresolved";

export function releaseIdentityState(item: Item): ReleaseIdentityState {
  if (item.mediaMatch?.status === "MATCHED") return "resolved";
  if (item.mediaMatch?.status === "CANDIDATE") return "review";
  return "unresolved";
}

export function releaseTitle(item: Item) {
  return releaseIdentityState(item) === "resolved"
    ? item.mediaMatch?.title ?? item.parsedRelease?.title ?? item.rawTitle
    : item.parsedRelease?.title ?? item.rawTitle;
}

export function releaseStatus(item: Item): {
  label: string;
  labelKey: string;
  detail: string;
  detailKey: string;
  ok: boolean;
  group: "review" | "downloaded" | "failed";
} {
  const latestJob = [...(item.downloadJobs ?? [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0];
  if (latestJob?.status === "FAILED") {
    return { label: "Failed", labelKey: "release.status.failed", detail: latestJob.error ?? "Download error", detailKey: latestJob.error ? "" : "release.detail.downloadError", ok: false, group: "failed" };
  }
  if (latestJob && ["SENT", "COMPLETED"].includes(latestJob.status)) {
    return { label: "Downloaded", labelKey: "release.status.downloaded", detail: "Sent to downloader", detailKey: "release.detail.sentToDownloader", ok: true, group: "downloaded" };
  }
  if (latestJob) {
    return { label: latestJob.status, labelKey: `release.status.${latestJob.status.toLowerCase()}`, detail: "Download job active", detailKey: "release.detail.downloadJobActive", ok: true, group: "review" };
  }
  const identity = releaseIdentityState(item);
  if (identity === "resolved") return { label: "Ready", labelKey: "release.status.ready", detail: "Ready to download", detailKey: "release.detail.readyToDownload", ok: true, group: "review" };
  if (identity === "review") return { label: "Check title", labelKey: "release.status.checkTitle", detail: "Choose the right title", detailKey: "release.detail.chooseTitle", ok: false, group: "review" };
  return { label: "Needs title", labelKey: "release.status.needsTitle", detail: "Choose a title", detailKey: "release.detail.chooseTitle", ok: false, group: "review" };
}

export function matchRate(matched: number, total: number) {
  if (total <= 0) return "0%";
  return `${Math.round((matched / total) * 100)}%`;
}
