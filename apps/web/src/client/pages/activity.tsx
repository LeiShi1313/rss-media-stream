import { CheckCircle2, Clock3, DownloadCloud, ListFilter, XCircle } from "lucide-react";
import type { DownloadJob } from "../api.js";
import type { TimelinePoint } from "../types.js";
import { Empty, StatusPill } from "../components/common/feedback.js";
import { Metric, Panel } from "../components/common/surfaces.js";
import { TimelineBars } from "../components/common/charts.js";
import { relativeTime } from "../lib/format.js";

export function ActivityPage({
  jobs,
  timeline
}: {
  jobs: DownloadJob[];
  timeline: TimelinePoint[];
}) {
  return (
    <div className="page-stack">
      <section className="two-column">
        <Panel title="Hourly Intake" icon={<Clock3 size={19} />}>
          <TimelineBars timeline={timeline} />
        </Panel>
        <Panel title="Job Status" icon={<DownloadCloud size={19} />}>
          <div className="status-grid">
            <Metric label="Queued" value={jobs.filter((job) => job.status === "QUEUED").length} icon={<Clock3 size={18} />} />
            <Metric label="Sent" value={jobs.filter((job) => job.status === "SENT").length} icon={<CheckCircle2 size={18} />} />
            <Metric label="Failed" value={jobs.filter((job) => job.status === "FAILED").length} icon={<XCircle size={18} />} />
          </div>
        </Panel>
      </section>
      <Panel title="Download Jobs" icon={<ListFilter size={19} />}>
        <div className="list">
          {jobs.length === 0 && <Empty label="No download jobs yet" />}
          {jobs.map((job) => (
            <article className="row-card job-card" key={job.id}>
              <div>
                <strong>{job.item?.rawTitle ?? job.id}</strong>
                <span>{job.downloader?.name ?? "Downloader"} · {job.source}</span>
                {job.error && <p className="error">{job.error}</p>}
              </div>
              <div className="row-actions">
                <StatusPill ok={!["FAILED", "SKIPPED"].includes(job.status)}>{job.status}</StatusPill>
                <small>{relativeTime(job.createdAt)}</small>
              </div>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}
