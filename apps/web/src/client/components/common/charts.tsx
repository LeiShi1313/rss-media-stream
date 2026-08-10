import { useTranslation } from "react-i18next";
import type { TimelinePointDto } from "@rss-media/shared/apiContracts";
import { Empty } from "./feedback.js";

export function TimelineBars({ timeline }: { timeline: TimelinePointDto[] }) {
  const { t } = useTranslation();
  const maxCount = Math.max(1, ...timeline.map((point) => point.count));
  return (
    <div className="timeline">
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
