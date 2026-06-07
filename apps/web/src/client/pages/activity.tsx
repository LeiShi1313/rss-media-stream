import { CheckCircle2, Clock3, DownloadCloud, ListFilter, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  return (
    <div className="page-stack">
      <section className="two-column">
        <Panel title={t("activity.hourlyIntake")} icon={<Clock3 size={19} />}>
          <TimelineBars timeline={timeline} />
        </Panel>
        <Panel title={t("activity.jobStatus")} icon={<DownloadCloud size={19} />}>
          <div className="status-grid">
            <Metric label={t("activity.queued")} value={jobs.filter((job) => job.status === "QUEUED").length} icon={<Clock3 size={18} />} />
            <Metric label={t("activity.sent")} value={jobs.filter((job) => job.status === "SENT").length} icon={<CheckCircle2 size={18} />} />
            <Metric label={t("activity.failed")} value={jobs.filter((job) => job.status === "FAILED").length} icon={<XCircle size={18} />} />
          </div>
        </Panel>
      </section>
      <Panel title={t("activity.downloadJobs")} icon={<ListFilter size={19} />}>
        <div className="list">
          {jobs.length === 0 && <Empty label={t("activity.noJobs")} />}
          {jobs.map((job) => (
            <article className="row-card job-card" key={job.id}>
              <div>
                <strong>{job.item?.rawTitle ?? job.id}</strong>
                <span>{job.downloader?.name ?? t("common.downloader")} · {job.source}</span>
                {job.error && <p className="error">{job.error}</p>}
              </div>
              <div className="row-actions">
                <StatusPill ok={!["FAILED", "SKIPPED"].includes(job.status)}>
                  {t(`release.status.${job.status.toLowerCase()}`, { defaultValue: job.status })}
                </StatusPill>
                <small>{relativeTime(job.createdAt)}</small>
              </div>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}
