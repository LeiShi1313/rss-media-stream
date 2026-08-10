import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  HardDrive,
  Rss,
  SlidersHorizontal,
  Sparkles
} from "lucide-react";
import type { DownloaderDto, ItemDto } from "@rss-media/shared/apiContracts";
import type { RunAction } from "../types.js";
import { StatTile } from "../components/ui/index.js";
import { OverviewCatalog } from "../components/overview/overview-catalog.js";
import {
  OverviewInspector,
  type OverviewInspectorTarget
} from "../components/overview/overview-inspector.js";
import { matchRate, releaseNeedsAttention } from "../lib/releases.js";

export function OverviewPage({
  busy,
  downloaders,
  items,
  stats,
  runAction
}: {
  busy: boolean;
  downloaders: DownloaderDto[];
  items: ItemDto[];
  stats: {
    totalItems: number;
    matched: number;
    feeds: number;
    failedJobs: number;
    subscriptions: number;
    downloaders: number;
  };
  runAction: RunAction;
}) {
  const { t } = useTranslation();
  const [inspectorTarget, setInspectorTarget] = useState<OverviewInspectorTarget | null>(null);
  const needsAttentionCount = items.filter(releaseNeedsAttention).length;

  return (
    <div className="overview-cinema">
      <section className="cinema-status-strip">
        <StatTile label={t("overview.stats.feedsOnline")} value={stats.feeds} detail={t("overview.stats.recentReleases", { count: stats.totalItems })} icon={<Rss size={19} />} />
        <StatTile label={t("common.downloaders")} value={stats.downloaders} detail={t("overview.stats.downloadersDetail")} icon={<HardDrive size={19} />} />
        <StatTile label={t("overview.stats.rules")} value={stats.subscriptions} detail={t("overview.stats.rulesDetail")} icon={<SlidersHorizontal size={19} />} />
        <StatTile label={t("overview.stats.matchRate")} value={matchRate(stats.matched, stats.totalItems)} detail={t("overview.stats.matchedDetail", { count: stats.matched })} icon={<Sparkles size={19} />} tone="accent" />
        <StatTile label={t("overview.stats.attention")} value={needsAttentionCount + stats.failedJobs} detail={t("overview.stats.attentionDetail")} icon={<AlertTriangle size={19} />} tone={needsAttentionCount + stats.failedJobs > 0 ? "danger" : "good"} />
      </section>

      <OverviewCatalog
        items={items}
        onInspectMedia={(mediaId) => setInspectorTarget({ type: "media", mediaId })}
        onInspectRelease={(item) => setInspectorTarget({ type: "release", item })}
      />

      {inspectorTarget && (
        <OverviewInspector
          busy={busy}
          downloaders={downloaders}
          onClose={() => setInspectorTarget(null)}
          runAction={runAction}
          target={inspectorTarget}
        />
      )}
    </div>
  );
}
