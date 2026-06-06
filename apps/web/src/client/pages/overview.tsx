import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  DownloadCloud,
  ExternalLink,
  Film,
  HardDrive,
  Rss,
  Search,
  SlidersHorizontal,
  Sparkles,
  XCircle
} from "lucide-react";
import { api, type Downloader, type Item, type Media, type MediaDetail, type TrendingMedia } from "../api.js";
import type { RunAction } from "../types.js";
import { AppDialog, FieldLabel, FormInput, SelectField, StatTile, UiButton } from "../components/ui/index.js";
import { Empty, Pill, StatusPill } from "../components/common/feedback.js";
import { ManualDownload } from "../components/common/manual-download.js";
import { formatBytes, relativeTime, tmdbImage } from "../lib/format.js";
import { confidencePercent, matchRate, releaseStatus, releaseTitle } from "../lib/releases.js";

type ShelfKey = "all" | "matched" | "downloading" | "attention";
type ReleaseCategoryFilter = "" | "MOVIE" | "TV" | "OTHER";
type ReleaseStatusFilter = "" | "matched" | "unmatched" | "downloading" | "attention";

export function OverviewPage({
  busy,
  downloaders,
  items,
  stats,
  trendingMedia,
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
  trendingMedia: TrendingMedia[];
  runAction: RunAction;
}) {
  const [selectedRelease, setSelectedRelease] = useState<Item | null>(null);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [selectedMediaDetail, setSelectedMediaDetail] = useState<MediaDetail | null>(null);
  const [query, setQuery] = useState("");
  const [feedFilter, setFeedFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<ReleaseCategoryFilter>("");
  const [statusFilter, setStatusFilter] = useState<ReleaseStatusFilter>("");

  const feedOptions = useMemo(
    () => [
      { value: "", label: "All feeds" },
      ...Array.from(new Map(items.flatMap((item) => item.feed ? [[item.feed.id, item.feed.name]] : [])).entries())
        .map(([value, label]) => ({ value, label }))
    ],
    [items]
  );

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      const matchesSearch =
        !normalizedQuery ||
        [
          item.rawTitle,
          item.parsedRelease?.title,
          item.mediaMatch?.title,
          item.feed?.name,
          item.parsedRelease?.quality,
          item.parsedRelease?.source,
          item.parsedRelease?.codec,
          item.parsedRelease?.audio,
          item.parsedRelease?.releaseGroup
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedQuery));
      const matchesFeed = !feedFilter || item.feed?.id === feedFilter;
      const matchesCategory = !categoryFilter || releaseCategory(item) === categoryFilter;
      const matchesStatus = !statusFilter || itemBelongsToStatus(item, statusFilter);
      return matchesSearch && matchesFeed && matchesCategory && matchesStatus;
    });
  }, [categoryFilter, feedFilter, items, query, statusFilter]);

  const shelves = useMemo(() => buildShelves(items), [items]);
  const filteredReleaseItems = useMemo(
    () => [...filteredItems].sort((a, b) => new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime()),
    [filteredItems]
  );
  const filtersActive = Boolean(query.trim() || feedFilter || categoryFilter || statusFilter);
  const needsAttentionCount = items.filter((item) => itemBelongsToShelf(item, "attention")).length;

  useEffect(() => {
    if (!selectedMediaId) {
      setSelectedMediaDetail(null);
      return;
    }
    setSelectedMediaDetail(null);
    let cancelled = false;
    api<MediaDetail>(`/api/media/${selectedMediaId}/detail`)
      .then((detail) => {
        if (!cancelled) setSelectedMediaDetail(detail);
      })
      .catch(() => {
        if (!cancelled) setSelectedMediaDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedMediaId]);

  return (
    <div className="overview-cinema">
      <section className="cinema-status-strip">
        <StatTile label="Feeds online" value={stats.feeds} detail={`${stats.totalItems} recent releases`} icon={<Rss size={19} />} />
        <StatTile label="Downloaders" value={stats.downloaders} detail="enabled endpoints" icon={<HardDrive size={19} />} />
        <StatTile label="Rules" value={stats.subscriptions} detail="active subscriptions" icon={<SlidersHorizontal size={19} />} />
        <StatTile label="Match rate" value={matchRate(stats.matched, stats.totalItems)} detail={`${stats.matched} matched`} icon={<Sparkles size={19} />} tone="accent" />
        <StatTile label="Attention" value={needsAttentionCount + stats.failedJobs} detail="failed or unmatched" icon={<AlertTriangle size={19} />} tone={needsAttentionCount + stats.failedJobs > 0 ? "danger" : "good"} />
      </section>

      <section className="cinema-controls">
        <div className="cinema-filter-bar">
          <FieldLabel className="search-control">
            <Search size={16} />
            <FormInput
              placeholder="Search title, feed, group, quality"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </FieldLabel>
          <SelectField value={feedFilter} onValueChange={setFeedFilter} options={feedOptions} placeholder="Feed" />
          <SelectField
            value={categoryFilter}
            onValueChange={(value) => setCategoryFilter(value as ReleaseCategoryFilter)}
            options={[
              { value: "", label: "Any category" },
              { value: "MOVIE", label: "Movies" },
              { value: "TV", label: "TV" },
              { value: "OTHER", label: "Other releases" }
            ]}
            placeholder="Category"
          />
          <SelectField
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as ReleaseStatusFilter)}
            options={[
              { value: "", label: "Any status" },
              { value: "matched", label: "Matched" },
              { value: "unmatched", label: "Unmatched" },
              { value: "downloading", label: "Downloading" },
              { value: "attention", label: "Needs attention" }
            ]}
            placeholder="Status"
          />
          <UiButton
            className="secondary"
            disabled={!filtersActive}
            onClick={() => {
              setQuery("");
              setFeedFilter("");
              setCategoryFilter("");
              setStatusFilter("");
            }}
            type="button"
          >
            Clear
          </UiButton>
        </div>
      </section>

      <section className="poster-wall-workbench">
        <div className="poster-shelves">
          {filtersActive ? (
            <PosterShelf
              cardVariant="parsed"
              emptyLabel="No releases match the current filters"
              icon={<Search size={18} />}
              items={filteredReleaseItems}
              layout="grid"
              limit={60}
              onInspect={setSelectedRelease}
              title="Filtered releases"
            />
          ) : (
            <>
              <PosterShelf
                cardVariant="parsed"
                emptyLabel="No newly added releases yet"
                icon={<Clock3 size={18} />}
                items={shelves.newlyAdded}
                onInspect={setSelectedRelease}
                title="Newly added"
              />
              <TrendingMediaShelf
                items={trendingMedia}
                onInspect={(media) => setSelectedMediaId(media.id)}
              />
              <PosterShelf
                emptyLabel="No high-confidence matches right now"
                icon={<CheckCircle2 size={18} />}
                items={shelves.matched}
                onInspect={setSelectedRelease}
                title="Recently matched"
              />
              <PosterShelf
                emptyLabel="No active downloads right now"
                icon={<DownloadCloud size={18} />}
                items={shelves.downloading}
                onInspect={setSelectedRelease}
                title="Downloading"
              />
              <PosterShelf
                emptyLabel="No releases need attention"
                icon={<XCircle size={18} />}
                items={shelves.attention}
                onInspect={setSelectedRelease}
                title="Needs attention"
              />
            </>
          )}
        </div>
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
      {selectedMediaId && (
        <MediaInspectorModal
          busy={busy}
          detail={selectedMediaDetail}
          downloaders={downloaders}
          onClose={() => setSelectedMediaId(null)}
          runAction={runAction}
        />
      )}
    </div>
  );
}

function TrendingMediaShelf({
  items,
  onInspect
}: {
  items: TrendingMedia[];
  onInspect: (media: Media) => void;
}) {
  return (
    <section className="poster-shelf">
      <header className="poster-shelf-head">
        <h3><Sparkles size={18} />Trending titles</h3>
        <span>last 7 days</span>
      </header>
      {items.length === 0 ? (
        <Empty label="No matched title trends yet" />
      ) : (
        <div className="poster-rail">
          {items.map((entry) => (
            <TrendingMediaCard entry={entry} key={entry.media.id} onInspect={() => onInspect(entry.media)} />
          ))}
        </div>
      )}
    </section>
  );
}

function TrendingMediaCard({ entry, onInspect }: { entry: TrendingMedia; onInspect: () => void }) {
  const posterUrl = entry.media.posterPath ? tmdbImage(entry.media.posterPath, "w342") : undefined;
  return (
    <button className="release-poster-card" onClick={onInspect} type="button">
      <span className="poster-badge">{entry.releaseCount} releases</span>
      <span className="poster-art">
        {posterUrl ? <img src={posterUrl} alt="" /> : <PosterFallback title={entry.media.title} />}
      </span>
      <span className="poster-card-copy">
        <strong>{entry.media.title}</strong>
        <small>{[entry.media.year, entry.media.kind, ...entry.qualities.slice(0, 2)].filter(Boolean).join(" · ")}</small>
      </span>
    </button>
  );
}

function PosterShelf({
  cardVariant = "status",
  emptyLabel,
  icon,
  items,
  layout = "rail",
  limit = 18,
  onInspect,
  title
}: {
  cardVariant?: "status" | "parsed";
  emptyLabel: string;
  icon: ReactNode;
  items: Item[];
  layout?: "rail" | "grid";
  limit?: number;
  onInspect: (item: Item) => void;
  title: string;
}) {
  return (
    <section className="poster-shelf">
      <header className="poster-shelf-head">
        <h3>{icon}{title}</h3>
        <span>{items.length} releases</span>
      </header>
      {items.length === 0 ? (
        <Empty label={emptyLabel} />
      ) : (
        <div className={layout === "grid" ? "poster-grid" : "poster-rail"}>
          {items.slice(0, limit).map((item) => (
            <ReleasePosterCard
              item={item}
              key={item.id}
              onInspect={() => onInspect(item)}
              variant={cardVariant}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ReleasePosterCard({
  item,
  onInspect,
  variant
}: {
  item: Item;
  onInspect: () => void;
  variant: "status" | "parsed";
}) {
  const title = releaseTitle(item);
  const status = releaseStatus(item);
  const posterUrl = item.mediaMatch?.posterPath ? tmdbImage(item.mediaMatch.posterPath, "w342") : undefined;
  const parsedTags = parsedReleaseTags(item);

  return (
    <button className="release-poster-card" onClick={onInspect} type="button">
      {variant === "status" && (
        <span className={status.ok ? "poster-badge" : "poster-badge warn"}>{status.label}</span>
      )}
      <span className="poster-art">
        {posterUrl ? <img src={posterUrl} alt="" /> : <PosterFallback title={title} />}
      </span>
      <span className="poster-card-copy">
        <strong>{title}</strong>
        {variant === "parsed" && parsedTags.length > 0 ? (
          <span className="poster-card-tags">
            {parsedTags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </span>
        ) : (
          <small>{posterMetadata(item)}</small>
        )}
      </span>
    </button>
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
  const posterUrl = item.mediaMatch?.posterPath ? tmdbImage(item.mediaMatch.posterPath, "w342") : undefined;
  const parsedFacts = [
    ["Kind", item.parsedRelease?.kind ?? item.mediaMatch?.kind ?? "Unknown"],
    ["Quality", item.parsedRelease?.quality ?? "Unknown"],
    ["Source", item.parsedRelease?.source ?? "Unknown"],
    ["Codec", item.parsedRelease?.codec ?? "Unknown"],
    ["Audio", item.parsedRelease?.audio ?? "Unknown"],
    ["Group", item.parsedRelease?.releaseGroup ?? "Unknown"],
    ["Episode", episodeLabel(item)],
    ["Size", item.sizeBytes ? formatBytes(item.sizeBytes) : "Unknown"]
  ] as const;
  const [manualTmdbId, setManualTmdbId] = useState("");
  const [manualTmdbKind, setManualTmdbKind] = useState<"MOVIE" | "TV">(
    item.parsedRelease?.kind === "TV" ? "TV" : "MOVIE"
  );

  function submitManualTmdbMatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const tmdbId = manualTmdbId.trim();
    if (!tmdbId) return;
    void runAction(() =>
      api(`/api/items/${item.id}/match/tmdb`, {
        method: "POST",
        body: JSON.stringify({ tmdbId, kind: manualTmdbKind })
      })
    ).then((result) => {
      if (result.ok) setManualTmdbId("");
    });
  }

  return (
    <AppDialog
      className="release-dialog release-sheet cinema-dialog"
      description={item.rawTitle}
      onClose={onClose}
      title={title}
    >
      <section
        className="release-sheet-hero"
        style={backdropUrl ? { backgroundImage: `linear-gradient(90deg, rgba(7,10,18,0.98), rgba(7,10,18,0.82), rgba(7,10,18,0.58)), url(${backdropUrl})` } : undefined}
      >
        <div className="release-sheet-poster">
          {posterUrl ? <img src={posterUrl} alt={title} /> : <PosterFallback title={title} />}
        </div>
        <div className="release-sheet-summary">
          <div className="release-sheet-kicker">
            <StatusPill ok={status.ok}>{status.label}</StatusPill>
            <span>{item.feed?.name ?? "Feed"}</span>
            <span>{relativeTime(item.firstSeenAt)}</span>
          </div>
          <div className="release-sheet-title">
            <h3>{title}</h3>
            <div className="token-row">
              {item.mediaMatch?.year && <Pill>{item.mediaMatch.year}</Pill>}
              {item.mediaMatch?.kind && <Pill>{item.mediaMatch.kind}</Pill>}
              {item.mediaMatch?.score !== undefined && <Pill>{confidencePercent(item.mediaMatch.score)} match</Pill>}
            </div>
          </div>
          <p>{item.mediaMatch?.overview ?? "No TMDB overview is available for this release yet."}</p>
          <div className="release-sheet-actions">
            <UiButton
              className="secondary glass"
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

      <section className="release-sheet-panel">
        <header>
          <div>
            <span>Parsed release</span>
            <h4>{item.parsedRelease?.title ?? title}</h4>
          </div>
          <small>{status.detail}</small>
        </header>
        <div className="release-fact-grid">
          {parsedFacts.map(([label, value]) => (
            <div className="release-fact" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </section>

      <details className="release-detail-disclosure release-sheet-details">
        <summary>
          <span>Advanced details</span>
          <small>source, raw RSS, and manual match tools</small>
        </summary>
        <div className="release-detail-tools">
          {item.sourceUrl && (
            <a className="secondary glass source-link" href={item.sourceUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={17} />
              Source
            </a>
          )}
          <form className="manual-tmdb-form" onSubmit={submitManualTmdbMatch}>
            <SelectField
              disabled={busy}
              onValueChange={(value) => setManualTmdbKind(value === "TV" ? "TV" : "MOVIE")}
              options={[
                { value: "MOVIE", label: "Movie" },
                { value: "TV", label: "TV" }
              ]}
              placeholder="Kind"
              value={manualTmdbKind}
            />
            <FormInput
              disabled={busy}
              inputMode="numeric"
              onChange={(event) => setManualTmdbId(event.target.value)}
              pattern="[0-9]*"
              placeholder="TMDB ID"
              value={manualTmdbId}
            />
            <UiButton className="secondary glass" disabled={busy || !manualTmdbId.trim()}>
              Use ID
            </UiButton>
          </form>
        </div>
        <section className="release-advanced-grid">
          <div>
            <h4>Match detail</h4>
            <ReleaseInlineFact label="Provider" value={item.mediaMatch?.provider ?? "Not matched"} />
            <ReleaseInlineFact label="Provider ID" value={item.mediaMatch?.providerId ?? "Not matched"} />
            <ReleaseInlineFact label="Confidence" value={confidencePercent(item.mediaMatch?.score ?? item.parseConfidence ?? 0)} />
            <ReleaseInlineFact label="Reason" value={item.mediaMatch?.reason ?? "No match reason provided"} />
          </div>
          <div>
            <h4>Source and target</h4>
            <ReleaseInlineFact label="Feed" value={item.feed?.name ?? "Feed"} />
            <ReleaseInlineFact label="First seen" value={new Date(item.firstSeenAt).toLocaleString()} />
            <ReleaseInlineFact label="Downloader" value={downloaders.find((downloader) => downloader.isDefault)?.name ?? downloaders[0]?.name ?? "No downloader"} />
            <ReleaseInlineFact label="Job status" value={status.detail} />
          </div>
        </section>
        <section className="rss-title-panel">
          <span>Original RSS title</span>
          <p>{item.rawTitle}</p>
        </section>
      </details>
    </AppDialog>
  );
}

function ReleaseInlineFact({ label, value }: { label: string; value: string }) {
  return (
    <p className="release-inline-fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </p>
  );
}

function MediaInspectorModal({
  busy,
  detail,
  downloaders,
  onClose,
  runAction
}: {
  busy: boolean;
  detail: MediaDetail | null;
  downloaders: Downloader[];
  onClose: () => void;
  runAction: RunAction;
}) {
  const media = detail?.media;
  const title = media?.title ?? "Loading media";
  const backdropUrl = media?.backdropPath ? tmdbImage(media.backdropPath, "w342") : undefined;
  const posterUrl = media?.posterPath ? tmdbImage(media.posterPath, "w342") : undefined;
  const releases = detail?.releases ?? [];

  return (
    <AppDialog className="release-dialog cinema-dialog" description="Grouped media releases" onClose={onClose} title={title}>
      <section
        className="release-dialog-hero"
        style={backdropUrl ? { backgroundImage: `linear-gradient(90deg, rgba(7,10,18,0.96), rgba(7,10,18,0.76), rgba(7,10,18,0.42)), url(${backdropUrl})` } : undefined}
      >
        <div className="release-dialog-poster">
          {posterUrl ? <img src={posterUrl} alt={title} /> : <PosterFallback title={title} />}
        </div>
        <div className="release-dialog-summary">
          <div className="token-row">
            {media?.year && <Pill>{media.year}</Pill>}
            {media?.kind && <Pill>{media.kind}</Pill>}
            <Pill>{releases.length} release versions</Pill>
          </div>
          <p>{media?.overview ?? "Loading media detail and release versions."}</p>
        </div>
      </section>
      <section className="media-release-section">
        <header className="poster-shelf-head">
          <h3><Film size={18} />Release versions</h3>
          <span>{releases.length} releases</span>
        </header>
        <div className="media-release-list">
          {releases.length === 0 && <Empty label="No release versions loaded yet" />}
          {releases.map((release) => (
            <article className="media-release-row" key={release.id}>
              <div>
                <strong>{releaseTitle(release)}</strong>
                <span>{release.feed?.name ?? "Feed"} · {relativeTime(release.firstSeenAt)}</span>
              </div>
              <div className="token-row">
                {release.parsedRelease?.releaseGroup && <Pill>{release.parsedRelease.releaseGroup}</Pill>}
                {release.parsedRelease?.quality && <Pill>{release.parsedRelease.quality}</Pill>}
                {release.parsedRelease?.source && <Pill>{release.parsedRelease.source}</Pill>}
                {release.parsedRelease?.codec && <Pill>{release.parsedRelease.codec}</Pill>}
                {release.parsedRelease?.audio && <Pill>{release.parsedRelease.audio}</Pill>}
                {release.sizeBytes && <Pill>{formatBytes(release.sizeBytes)}</Pill>}
                <StatusPill ok={releaseStatus(release).ok}>{releaseStatus(release).label}</StatusPill>
              </div>
              <div className="media-release-actions">
                {release.sourceUrl && (
                  <a className="secondary source-link compact" href={release.sourceUrl} target="_blank" rel="noreferrer" title="Open source release">
                    <ExternalLink size={16} />
                  </a>
                )}
                <ManualDownload
                  disabled={busy || downloaders.length === 0}
                  downloaders={downloaders}
                  onDownload={(downloaderId) =>
                    runAction(() =>
                      api(`/api/items/${release.id}/downloads`, {
                        method: "POST",
                        body: JSON.stringify({ downloaderId })
                      })
                    )
                  }
                />
              </div>
            </article>
          ))}
        </div>
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

function PosterFallback({ title }: { title: string }) {
  return (
    <span className="poster-fallback">
      <Film size={26} />
      <b>{initials(title)}</b>
    </span>
  );
}

function buildShelves(items: Item[]) {
  const newlyAdded = [...items]
    .sort((a, b) => new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime())
    .slice(0, 18);

  return {
    newlyAdded,
    matched: items.filter((item) => itemBelongsToShelf(item, "matched")),
    downloading: items.filter((item) => itemBelongsToShelf(item, "downloading")),
    attention: items.filter((item) => itemBelongsToShelf(item, "attention"))
  };
}

function itemBelongsToShelf(item: Item, shelf: ShelfKey) {
  const status = releaseStatus(item);
  const latestJob = latestDownloadJob(item);
  if (shelf === "all") return true;
  if (shelf === "matched") return Boolean(item.mediaMatch);
  if (shelf === "downloading") return Boolean(latestJob && !["FAILED", "SENT", "COMPLETED"].includes(latestJob.status));
  return status.group === "failed" || !item.mediaMatch;
}

function itemBelongsToStatus(item: Item, status: ReleaseStatusFilter) {
  if (!status) return true;
  if (status === "matched") return Boolean(item.mediaMatch);
  if (status === "unmatched") return !item.mediaMatch;
  if (status === "downloading") return itemBelongsToShelf(item, "downloading");
  return itemBelongsToShelf(item, "attention");
}

function releaseCategory(item: Item): "MOVIE" | "TV" | "OTHER" {
  const kind = item.parsedRelease?.kind && item.parsedRelease.kind !== "UNKNOWN"
    ? item.parsedRelease.kind
    : item.mediaMatch?.kind;
  return kind === "MOVIE" || kind === "TV" ? kind : "OTHER";
}

function latestDownloadJob(item: Item) {
  return [...(item.downloadJobs ?? [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0];
}

function posterMetadata(item: Item) {
  const parts = [
    item.mediaMatch?.year,
    episodeLabel(item),
    item.parsedRelease?.quality,
    item.parsedRelease?.source,
    item.parsedRelease?.releaseGroup,
    item.feed?.name
  ].filter(Boolean);
  return parts.join(" · ") || relativeTime(item.firstSeenAt);
}

function parsedReleaseTags(item: Item) {
  const parsed = item.parsedRelease;
  const episode = parsed?.kind === "TV" ? episodeLabel(item) : undefined;
  return [
    parsed?.kind && parsed.kind !== "UNKNOWN" ? parsed.kind : undefined,
    parsed?.year,
    episode && episode !== "Unknown" ? episode : undefined,
    parsed?.quality,
    parsed?.source,
    parsed?.codec,
    parsed?.audio,
    parsed?.releaseGroup,
    item.sizeBytes ? formatBytes(item.sizeBytes) : undefined,
    parsed?.confidence !== undefined ? confidencePercent(parsed.confidence) : undefined
  ]
    .filter(Boolean)
    .map(String)
    .slice(0, 8);
}

function episodeLabel(item: Item) {
  if (item.parsedRelease?.kind !== "TV") return item.mediaMatch?.kind ?? item.parsedRelease?.kind ?? "Unknown";
  return `S${item.parsedRelease.season ?? "?"}E${item.parsedRelease.episode ?? "?"}`;
}

function initials(value: string) {
  const words = value.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).slice(0, 2);
  return words.map((word) => word[0]?.toUpperCase()).join("") || "RM";
}
