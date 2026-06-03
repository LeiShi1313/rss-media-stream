import { useMemo, useState } from "react";
import { Activity, CheckCircle2, Clock3, DownloadCloud, Film, HardDrive, Rss, Search, SlidersHorizontal, Tv, XCircle, Pencil } from "lucide-react";
import { api, type Downloader, type Item } from "../api.js";
import type { RunAction, TimelinePoint } from "../types.js";
import { FieldLabel, FormInput, SelectField, SegmentedTabs, StatTile, UiButton } from "../components/ui/index.js";
import { Empty, Pill, StatusPill } from "../components/common/feedback.js";
import { Panel } from "../components/common/surfaces.js";
import { StatusSummary, TimelineBars } from "../components/common/charts.js";
import { ManualDownload } from "../components/common/manual-download.js";
import { formatBytes, relativeTime, tmdbImage } from "../lib/format.js";
import { confidenceBarWidth, confidencePercent, matchRate, releaseStatus, releaseTitle } from "../lib/releases.js";

export function OverviewPage({
  busy,
  downloaders,
  items,
  stats,
  timeline,
  runAction
}: {
  busy: boolean;
  downloaders: Downloader[];
  items: Item[];
  stats: {
    totalItems: number;
    matched: number;
    feeds: number;
    jobs: number;
    failedJobs: number;
    subscriptions: number;
    downloaders: number;
  };
  timeline: TimelinePoint[];
  runAction: RunAction;
}) {
  const [selectedRelease, setSelectedRelease] = useState<Item | null>(null);
  const [queueView, setQueueView] = useState("review");
  const [query, setQuery] = useState("");
  const [feedFilter, setFeedFilter] = useState("");
  const [matchFilter, setMatchFilter] = useState("all");

  const feedOptions = useMemo(
    () => [
      { value: "", label: "All feeds" },
      ...Array.from(new Map(items.flatMap((item) => item.feed ? [[item.feed.id, item.feed.name]] : [])).entries())
        .map(([value, label]) => ({ value, label }))
    ],
    [items]
  );
  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      const status = releaseStatus(item);
      const matchesQueue =
        queueView === "review" ||
        (queueView === "matched" && Boolean(item.mediaMatch)) ||
        (queueView === "downloaded" && status.group === "downloaded") ||
        (queueView === "failed" && status.group === "failed");
      const matchesSearch =
        !normalizedQuery ||
        [
          item.rawTitle,
          item.parsedRelease?.title,
          item.mediaMatch?.title,
          item.feed?.name,
          item.parsedRelease?.quality,
          item.parsedRelease?.source,
          item.parsedRelease?.codec
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedQuery));
      const matchesFeed = !feedFilter || item.feed?.id === feedFilter;
      const matchesMatch =
        matchFilter === "all" ||
        (matchFilter === "matched" && Boolean(item.mediaMatch)) ||
        (matchFilter === "unmatched" && !item.mediaMatch);
      return matchesQueue && matchesSearch && matchesFeed && matchesMatch;
    });
  }, [feedFilter, items, matchFilter, query, queueView]);
  const queueTabs = [
    { value: "review", label: "Review Queue", count: items.length },
    { value: "matched", label: "Matched", count: stats.matched },
    {
      value: "downloaded",
      label: "Downloaded",
      count: items.filter((item) => releaseStatus(item).group === "downloaded").length
    },
    {
      value: "failed",
      label: "Failed",
      count: items.filter((item) => releaseStatus(item).group === "failed").length
    }
  ];

  return (
    <div className="page-stack">
      <section className="stat-grid">
        <StatTile label="RSS feeds" value={stats.feeds} detail={`${stats.totalItems} recent items`} icon={<Rss size={20} />} />
        <StatTile label="Downloaders" value={stats.downloaders} detail="enabled endpoints" icon={<HardDrive size={20} />} />
        <StatTile label="Matching rules" value={stats.subscriptions} detail="active subscriptions" icon={<SlidersHorizontal size={20} />} />
        <StatTile label="Matched releases" value={stats.matched} detail={`${matchRate(stats.matched, stats.totalItems)} match rate`} icon={<Film size={20} />} tone="accent" />
        <StatTile label="Failed jobs" value={stats.failedJobs} detail={stats.failedJobs > 0 ? "needs review" : "all clear"} icon={<XCircle size={20} />} tone={stats.failedJobs > 0 ? "danger" : "good"} />
      </section>

      <section className="release-workbench">
        <header className="workbench-header">
          <div>
            <span className="section-kicker">Release review</span>
            <h3>New releases from your feeds</h3>
            <p>Verify matches, inspect parsed metadata, and send releases to the right downloader.</p>
          </div>
        </header>

        <SegmentedTabs value={queueView} onValueChange={setQueueView} tabs={queueTabs} />

        <div className="filter-bar">
          <FieldLabel className="search-control">
            <Search size={16} />
            <FormInput
              placeholder="Search title, feed, or release tag"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </FieldLabel>
          <SelectField value={feedFilter} onValueChange={setFeedFilter} options={feedOptions} placeholder="Feed" />
          <SelectField
            value={matchFilter}
            onValueChange={setMatchFilter}
            options={[
              { value: "all", label: "All matches" },
              { value: "matched", label: "Matched only" },
              { value: "unmatched", label: "Unmatched only" }
            ]}
            placeholder="Match"
          />
        </div>

        <div className="release-table-shell">
          <div className="release-table">
            <div className="release-table-head">
              <span>Release</span>
              <span>Feed</span>
              <span>Quality</span>
              <span>Match</span>
              <span>Status</span>
              <span>Actions</span>
            </div>
            {visibleItems.length === 0 && <Empty label="No releases match the current filters" />}
            {visibleItems.map((item) => (
              <ReleaseReviewRow
                busy={busy}
                downloaders={downloaders}
                item={item}
                key={item.id}
                onInspect={() => setSelectedRelease(item)}
                runAction={runAction}
              />
            ))}
          </div>
          <footer className="table-footer">
            <span>{visibleItems.length} of {items.length} releases</span>
            <span>TMDB metadata and images are used when a match is available.</span>
          </footer>
        </div>
      </section>

      <section className="overview-insight-grid">
        <Panel title="Feed intake" icon={<Clock3 size={19} />}>
          <TimelineBars timeline={timeline} compact />
        </Panel>
        <Panel title="Queue health" icon={<CheckCircle2 size={19} />}>
          <StatusSummary items={items} />
        </Panel>
      </section>

      {selectedRelease && (
        <ReleaseInspectorModal
          busy={busy}
          downloaders={downloaders}
          item={selectedRelease}
          onClose={() => setSelectedRelease(null)}
          runAction={runAction}
        />
      )}
    </div>
  );
}

function ReleaseReviewRow({
  busy,
  downloaders,
  item,
  onInspect,
  runAction
}: {
  busy: boolean;
  downloaders: Downloader[];
  item: Item;
  onInspect: () => void;
  runAction: RunAction;
}) {
  const title = releaseTitle(item);
  const status = releaseStatus(item);
  const confidence = item.mediaMatch?.score ?? item.parseConfidence ?? 0;

  return (
    <article className="release-table-row">
      <div className="release-title-cell">
        <div className="release-poster">
          {item.mediaMatch?.posterPath ? (
            <img src={tmdbImage(item.mediaMatch.posterPath, "w185")} alt={title} />
          ) : (
            <Film size={24} />
          )}
        </div>
        <div className="release-copy">
          <UiButton className="release-title-button" onClick={onInspect} type="button">
            {title}
          </UiButton>
          <span>{item.rawTitle}</span>
          <small>{relativeTime(item.firstSeenAt)}{item.sizeBytes ? ` · ${formatBytes(item.sizeBytes)}` : ""}</small>
        </div>
      </div>
      <div className="release-feed-cell">
        <strong>{item.feed?.name ?? "Feed"}</strong>
        <span>{item.parsedRelease?.kind ?? item.mediaMatch?.kind ?? "UNKNOWN"}</span>
      </div>
      <div className="token-row quality-cell">
        {item.parsedRelease?.quality && <Pill>{item.parsedRelease.quality}</Pill>}
        {item.parsedRelease?.source && <Pill>{item.parsedRelease.source}</Pill>}
        {item.parsedRelease?.codec && <Pill>{item.parsedRelease.codec}</Pill>}
        {item.parsedRelease?.kind === "TV" && (
          <Pill>
            <Tv size={13} />
            S{item.parsedRelease.season ?? "?"}E{item.parsedRelease.episode ?? "?"}
          </Pill>
        )}
      </div>
      <div className="confidence-cell">
        <strong>{confidencePercent(confidence)}</strong>
        <span><i style={{ width: confidenceBarWidth(confidence) }} /></span>
        <small>{item.mediaMatch ? "TMDB match" : "Parse confidence"}</small>
      </div>
      <div className="status-cell">
        <StatusPill ok={status.ok}>{status.label}</StatusPill>
        <small>{status.detail}</small>
      </div>
      <div className="item-actions">
        <UiButton
          className="secondary"
          disabled={busy}
          onClick={() => runAction(() => api(`/api/items/${item.id}/match`, { method: "POST" }))}
        >
          Match
        </UiButton>
        <ManualDownload
          disabled={busy || downloaders.length === 0}
          downloaders={downloaders}
          onDownload={(downloaderId) =>
            runAction(() =>
              api(`/api/items/${item.id}/downloads`, {
                method: "POST",
                body: JSON.stringify({ downloaderId })
              })
            )
          }
        />
      </div>
    </article>
  );
}

function ReleaseInspectorModal({
  busy,
  downloaders,
  item,
  onClose,
  runAction
}: {
  busy: boolean;
  downloaders: Downloader[];
  item: Item;
  onClose: () => void;
  runAction: RunAction;
}) {
  const title = releaseTitle(item);
  const status = releaseStatus(item);
  const backdropUrl = item.mediaMatch?.backdropPath ? tmdbImage(item.mediaMatch.backdropPath, "w342") : undefined;

  return (
    <AppDialog
      className="release-dialog"
      description={item.rawTitle}
      onClose={onClose}
      title={title}
    >
      <section
        className="release-dialog-hero"
        style={backdropUrl ? { backgroundImage: `linear-gradient(90deg, rgba(255,255,255,0.96), rgba(255,255,255,0.78)), url(${backdropUrl})` } : undefined}
      >
        <div className="release-dialog-poster">
          {item.mediaMatch?.posterPath ? (
            <img src={tmdbImage(item.mediaMatch.posterPath, "w342")} alt={title} />
          ) : (
            <Film size={34} />
          )}
        </div>
        <div className="release-dialog-summary">
          <div className="token-row">
            <StatusPill ok={status.ok}>{status.label}</StatusPill>
            {item.mediaMatch?.year && <Pill>{item.mediaMatch.year}</Pill>}
            {item.mediaMatch?.kind && <Pill>{item.mediaMatch.kind}</Pill>}
            {item.mediaMatch?.score !== undefined && <Pill>{confidencePercent(item.mediaMatch.score)} match</Pill>}
          </div>
          <p>{item.mediaMatch?.overview ?? "No TMDB overview is available for this release yet."}</p>
          <div className="release-dialog-actions">
            <UiButton
              className="secondary"
              disabled={busy}
              onClick={() => runAction(() => api(`/api/items/${item.id}/match`, { method: "POST" }))}
            >
              <Film size={17} />
              Match
            </UiButton>
            <ManualDownload
              disabled={busy || downloaders.length === 0}
              downloaders={downloaders}
              onDownload={(downloaderId) =>
                runAction(() =>
                  api(`/api/items/${item.id}/downloads`, {
                    method: "POST",
                    body: JSON.stringify({ downloaderId })
                  })
                )
              }
            />
          </div>
        </div>
      </section>
      <section className="release-dialog-grid">
        <DetailGroup
          title="Parsed release"
          rows={[
            ["Kind", item.parsedRelease?.kind ?? item.mediaMatch?.kind ?? "Unknown"],
            ["Quality", item.parsedRelease?.quality ?? "Unknown"],
            ["Source", item.parsedRelease?.source ?? "Unknown"],
            ["Codec", item.parsedRelease?.codec ?? "Unknown"],
            ["Size", item.sizeBytes ? formatBytes(item.sizeBytes) : "Unknown"]
          ]}
        />
        <DetailGroup
          title="Match detail"
          rows={[
            ["Provider", item.mediaMatch?.provider ?? "Not matched"],
            ["Provider ID", item.mediaMatch?.providerId ?? "Not matched"],
            ["Confidence", confidencePercent(item.mediaMatch?.score ?? item.parseConfidence ?? 0)],
            ["Reason", item.mediaMatch?.reason ?? "No match reason provided"]
          ]}
        />
        <DetailGroup
          title="Source and target"
          rows={[
            ["Feed", item.feed?.name ?? "Feed"],
            ["First seen", new Date(item.firstSeenAt).toLocaleString()],
            ["Downloader", downloaders.find((downloader) => downloader.isDefault)?.name ?? downloaders[0]?.name ?? "No downloader"],
            ["Job status", status.detail]
          ]}
        />
      </section>
    </AppDialog>
  );
}

function DetailGroup({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <article className="detail-group">
      <h4>{title}</h4>
      {rows.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </article>
  );
}

