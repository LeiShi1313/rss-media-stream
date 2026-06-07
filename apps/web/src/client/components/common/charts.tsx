import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Downloader, Item } from "../../api.js";
import type { TimelinePoint } from "../../types.js";
import { relativeTime } from "../../lib/format.js";
import { releaseIdentityState, releaseStatus } from "../../lib/releases.js";
import { Empty, Pill, StatusPill } from "./feedback.js";

export function StatusSummary({ items }: { items: Item[] }) {
  const { t } = useTranslation();
  const summary = [
    { label: t("overview.filters.matched"), count: items.filter((item) => releaseIdentityState(item) === "resolved").length, tone: "good" },
    { label: t("overview.filters.unmatched"), count: items.filter((item) => releaseIdentityState(item) !== "resolved").length, tone: "neutral" },
    { label: t("release.status.downloaded"), count: items.filter((item) => releaseStatus(item).group === "downloaded").length, tone: "accent" },
    { label: t("release.status.failed"), count: items.filter((item) => releaseStatus(item).group === "failed").length, tone: "danger" }
  ];
  const total = Math.max(items.length, 1);

  return (
    <div className="summary-bars">
      {summary.map((entry) => (
        <div className="summary-bar" key={entry.label}>
          <div>
            <span>{entry.label}</span>
            <strong>{entry.count}</strong>
          </div>
          <span className={`bar-track ${entry.tone}`}>
            <i style={{ width: `${Math.round((entry.count / total) * 100)}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

export function DistributionBars({
  entries,
  emptyLabel,
  suffix = ""
}: {
  entries: Array<{ label: string; value: number; detail: string; tone?: string }>;
  emptyLabel: string;
  suffix?: string;
}) {
  const maxValue = Math.max(1, ...entries.map((entry) => entry.value));

  return (
    <div className="summary-bars">
      {entries.length === 0 && <Empty label={emptyLabel} />}
      {entries.map((entry) => (
        <div className="summary-bar" key={entry.label}>
          <div>
            <span>{entry.label}</span>
            <strong>{entry.value}{suffix}</strong>
          </div>
          <span className={`bar-track ${entry.tone ?? "neutral"}`}>
            <i style={{ width: `${Math.max(4, Math.round((entry.value / maxValue) * 100))}%` }} />
          </span>
          <small>{entry.detail}</small>
        </div>
      ))}
    </div>
  );
}

export function EndpointStatusGrid({ downloaders }: { downloaders: Downloader[] }) {
  const { t } = useTranslation();
  if (downloaders.length === 0) return <Empty label={t("downloaders.noEndpoints")} />;

  return (
    <div className="endpoint-grid">
      {downloaders.map((downloader) => (
        <article className="endpoint-tile" key={downloader.id}>
          <div>
            <strong>{downloader.name}</strong>
            <span>{downloader.type}</span>
          </div>
          <div className="token-row">
            {downloader.isDefault && <Pill>{t("downloaders.default")}</Pill>}
            <StatusPill ok={downloader.enabled}>{downloader.enabled ? t("common.enabled") : t("common.disabled")}</StatusPill>
          </div>
          <small>{t("downloaders.jobs", { count: downloader.jobCount ?? 0 })}{downloader.category ? ` · ${downloader.category}` : ""}</small>
        </article>
      ))}
    </div>
  );
}

export function TimelineBars({ timeline, compact = false }: { timeline: TimelinePoint[]; compact?: boolean }) {
  const { t } = useTranslation();
  const maxCount = Math.max(1, ...timeline.map((point) => point.count));
  return (
    <div className={compact ? "timeline compact" : "timeline"}>
      {timeline.length === 0 && <Empty label={t("activity.noTimeline")} />}
      {timeline.map((point) => (
        <div className="bar-row" key={point.time}>
          <span>{new Date(point.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          <div><i style={{ width: `${Math.max(6, Math.round((point.count / maxCount) * 100))}%` }} /></div>
          <b>{point.count}</b>
        </div>
      ))}
    </div>
  );
}
