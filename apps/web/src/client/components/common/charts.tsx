import type { ReactNode } from "react";
import type { Downloader, Item } from "../../api.js";
import type { TimelinePoint } from "../../types.js";
import { relativeTime } from "../../lib/format.js";
import { releaseStatus } from "../../lib/releases.js";
import { Empty, Pill, StatusPill } from "./feedback.js";

export function StatusSummary({ items }: { items: Item[] }) {
  const summary = [
    { label: "Matched", count: items.filter((item) => item.mediaMatch).length, tone: "good" },
    { label: "Unmatched", count: items.filter((item) => !item.mediaMatch).length, tone: "neutral" },
    { label: "Downloaded", count: items.filter((item) => releaseStatus(item).group === "downloaded").length, tone: "accent" },
    { label: "Failed", count: items.filter((item) => releaseStatus(item).group === "failed").length, tone: "danger" }
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
  if (downloaders.length === 0) return <Empty label="No downloader endpoints configured" />;

  return (
    <div className="endpoint-grid">
      {downloaders.map((downloader) => (
        <article className="endpoint-tile" key={downloader.id}>
          <div>
            <strong>{downloader.name}</strong>
            <span>{downloader.type}</span>
          </div>
          <div className="token-row">
            {downloader.isDefault && <Pill>Default</Pill>}
            <StatusPill ok={downloader.enabled}>{downloader.enabled ? "Enabled" : "Disabled"}</StatusPill>
          </div>
          <small>{downloader.jobCount ?? 0} jobs{downloader.category ? ` · ${downloader.category}` : ""}</small>
        </article>
      ))}
    </div>
  );
}

export function TimelineBars({ timeline, compact = false }: { timeline: TimelinePoint[]; compact?: boolean }) {
  const maxCount = Math.max(1, ...timeline.map((point) => point.count));
  return (
    <div className={compact ? "timeline compact" : "timeline"}>
      {timeline.length === 0 && <Empty label="No timeline data yet" />}
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

