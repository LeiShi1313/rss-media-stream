import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
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
import { api, type Downloader, type Item, type Media, type MediaDetail, type MediaSearchResult, type TrendingMedia } from "../api.js";
import type { RunAction } from "../types.js";
import { AppDialog, FieldLabel, FormInput, SelectField, StatTile, UiButton } from "../components/ui/index.js";
import { Empty, Pill, StatusPill } from "../components/common/feedback.js";
import { ManualDownload } from "../components/common/manual-download.js";
import { formatBytes, relativeTime } from "../lib/format.js";
import { matchRate, releaseIdentityState, releaseStatus, releaseTitle } from "../lib/releases.js";

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
  const { t } = useTranslation();
  const [selectedReleaseId, setSelectedReleaseId] = useState<string | null>(null);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [selectedMediaDetail, setSelectedMediaDetail] = useState<MediaDetail | null>(null);
  const [query, setQuery] = useState("");
  const [feedFilter, setFeedFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<ReleaseCategoryFilter>("");
  const [statusFilter, setStatusFilter] = useState<ReleaseStatusFilter>("");

  const feedOptions = useMemo(
    () => [
      { value: "", label: t("overview.filters.allFeeds") },
      ...Array.from(new Map(items.flatMap((item) => item.feed ? [[item.feed.id, item.feed.name]] : [])).entries())
        .map(([value, label]) => ({ value, label }))
    ],
    [items, t]
  );

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      const matchesSearch =
        !normalizedQuery ||
        [
          item.rawTitle,
          item.parsedRelease?.title,
          item.match?.presentation?.title,
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
  const selectedRelease = useMemo(
    () => items.find((item) => item.id === selectedReleaseId) ?? null,
    [items, selectedReleaseId]
  );
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
    api<MediaDetail>(`/api/media-titles/${selectedMediaId}/detail`)
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
        <StatTile label={t("overview.stats.feedsOnline")} value={stats.feeds} detail={t("overview.stats.recentReleases", { count: stats.totalItems })} icon={<Rss size={19} />} />
        <StatTile label={t("common.downloaders")} value={stats.downloaders} detail={t("overview.stats.downloadersDetail")} icon={<HardDrive size={19} />} />
        <StatTile label={t("overview.stats.rules")} value={stats.subscriptions} detail={t("overview.stats.rulesDetail")} icon={<SlidersHorizontal size={19} />} />
        <StatTile label={t("overview.stats.matchRate")} value={matchRate(stats.matched, stats.totalItems)} detail={t("overview.stats.matchedDetail", { count: stats.matched })} icon={<Sparkles size={19} />} tone="accent" />
        <StatTile label={t("overview.stats.attention")} value={needsAttentionCount + stats.failedJobs} detail={t("overview.stats.attentionDetail")} icon={<AlertTriangle size={19} />} tone={needsAttentionCount + stats.failedJobs > 0 ? "danger" : "good"} />
      </section>

      <section className="cinema-controls">
        <div className="cinema-filter-bar">
          <FieldLabel className="search-control">
            <Search size={16} />
            <FormInput
              placeholder={t("overview.filters.searchPlaceholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </FieldLabel>
          <SelectField value={feedFilter} onValueChange={setFeedFilter} options={feedOptions} placeholder={t("common.feed")} />
          <SelectField
            value={categoryFilter}
            onValueChange={(value) => setCategoryFilter(value as ReleaseCategoryFilter)}
            options={[
              { value: "", label: t("common.anyCategory") },
              { value: "MOVIE", label: t("common.movies") },
              { value: "TV", label: t("common.tv") },
              { value: "OTHER", label: t("overview.filters.otherReleases") }
            ]}
            placeholder={t("common.category")}
          />
          <SelectField
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as ReleaseStatusFilter)}
            options={[
              { value: "", label: t("common.anyStatus") },
              { value: "matched", label: t("overview.filters.matched") },
              { value: "unmatched", label: t("overview.filters.unmatched") },
              { value: "downloading", label: t("overview.filters.downloading") },
              { value: "attention", label: t("overview.filters.attention") }
            ]}
            placeholder={t("common.status")}
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
            {t("common.clear")}
          </UiButton>
        </div>
      </section>

      <section className="poster-wall-workbench">
        <div className="poster-shelves">
          {filtersActive ? (
            <PosterShelf
              cardVariant="parsed"
              emptyLabel={t("overview.shelves.filteredEmpty")}
              icon={<Search size={18} />}
              items={filteredReleaseItems}
              layout="grid"
              limit={60}
              onInspect={(item) => setSelectedReleaseId(item.id)}
              title={t("overview.shelves.filtered")}
            />
          ) : (
            <>
              <PosterShelf
                cardVariant="parsed"
                emptyLabel={t("overview.shelves.newlyAddedEmpty")}
                icon={<Clock3 size={18} />}
                items={shelves.newlyAdded}
                onInspect={(item) => setSelectedReleaseId(item.id)}
                title={t("overview.shelves.newlyAdded")}
              />
              <TrendingMediaShelf
                items={trendingMedia}
                onInspect={(media) => setSelectedMediaId(media.id)}
              />
              <PosterShelf
                emptyLabel={t("overview.shelves.matchedEmpty")}
                icon={<CheckCircle2 size={18} />}
                items={shelves.matched}
                onInspect={(item) => setSelectedReleaseId(item.id)}
                title={t("overview.shelves.matched")}
              />
              <PosterShelf
                emptyLabel={t("overview.shelves.downloadingEmpty")}
                icon={<DownloadCloud size={18} />}
                items={shelves.downloading}
                onInspect={(item) => setSelectedReleaseId(item.id)}
                title={t("overview.shelves.downloading")}
              />
              <PosterShelf
                emptyLabel={t("overview.shelves.attentionEmpty")}
                icon={<XCircle size={18} />}
                items={shelves.attention}
                onInspect={(item) => setSelectedReleaseId(item.id)}
                title={t("overview.shelves.attention")}
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
          onClose={() => setSelectedReleaseId(null)}
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
  const { t } = useTranslation();
  return (
    <section className="poster-shelf">
      <header className="poster-shelf-head">
        <h3><Sparkles size={18} />{t("overview.shelves.trending")}</h3>
        <span>{t("overview.shelves.trendingWindow")}</span>
      </header>
      {items.length === 0 ? (
        <Empty label={t("overview.shelves.trendingEmpty")} />
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
  const { t } = useTranslation();
  const posterUrl = entry.media.posterUrl ?? undefined;
  return (
    <button className="release-poster-card" onClick={onInspect} type="button">
      <span className="poster-badge">{t("common.releaseCount", { count: entry.releaseCount })}</span>
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
  const { t } = useTranslation();
  return (
    <section className="poster-shelf">
      <header className="poster-shelf-head">
        <h3>{icon}{title}</h3>
        <span>{t("common.releaseCount", { count: items.length })}</span>
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
  const { t } = useTranslation();
  const title = releaseTitle(item);
  const status = releaseStatus(item);
  const enrichmentPending = item.enrichmentState === "PENDING";
  const presentation = item.match?.presentation;
  const posterUrl = presentation?.posterUrl ?? undefined;
  const parsedTags = parsedReleaseTags(item);

  return (
    <button className="release-poster-card" onClick={onInspect} type="button">
      {variant === "status" && (
        <span className={status.ok ? "poster-badge" : "poster-badge warn"}>{t(status.labelKey, { defaultValue: status.label })}</span>
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
  const { t } = useTranslation();
  const identity = releaseIdentityState(item);
  const title = releaseTitle(item);
  const status = releaseStatus(item);
  const enrichmentPending = item.enrichmentState === "PENDING";
  const unknown = t("common.unknown");
  const presentation = item.match?.presentation;
  const backdropUrl = presentation?.backdropUrl ?? undefined;
  const posterUrl = presentation?.posterUrl ?? undefined;
  const parsedFacts = [
    [t("common.kind"), item.parsedRelease?.kind ?? legacyKindFromMediaType(presentation?.mediaType) ?? unknown],
    [t("common.quality"), item.parsedRelease?.quality ?? unknown],
    [t("common.source"), item.parsedRelease?.source ?? unknown],
    [t("common.codecs"), item.parsedRelease?.codec ?? unknown],
    [t("common.audio"), item.parsedRelease?.audio ?? unknown],
    [t("common.group"), item.parsedRelease?.releaseGroup ?? unknown],
    [t("common.episode"), episodeLabel(item, unknown)],
    [t("common.size"), item.sizeBytes ? formatBytes(item.sizeBytes, unknown) : unknown]
  ] as const;
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [titleSearchQuery, setTitleSearchQuery] = useState(item.parsedRelease?.title ?? title);
  const [titleSearchResults, setTitleSearchResults] = useState<MediaSearchResult[]>([]);
  const [titleSearchBusy, setTitleSearchBusy] = useState(false);
  const [titleSearchError, setTitleSearchError] = useState("");
  const [titleSearchSubmitted, setTitleSearchSubmitted] = useState(false);
  const [titleSearchMediaType, setTitleSearchMediaType] = useState<"" | "MOVIE" | "TV_SERIES">("");
  const initializedItemId = useRef(item.id);

  const inferredSearchMediaType =
    mediaTypeFromKind(item.parsedRelease?.kind) ?? (presentation?.mediaType !== "UNKNOWN" ? presentation?.mediaType : undefined);
  const effectiveSearchMediaType = titleSearchMediaType || inferredSearchMediaType;

  useEffect(() => {
    if (initializedItemId.current === item.id) return;
    initializedItemId.current = item.id;
    setCorrectionOpen(false);
    setTitleSearchQuery(item.parsedRelease?.title ?? title);
    setTitleSearchResults([]);
    setTitleSearchError("");
    setTitleSearchSubmitted(false);
    setTitleSearchMediaType("");
  }, [enrichmentPending, identity, item.id, item.parsedRelease?.kind, item.parsedRelease?.title, title]);

  async function searchTitles(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = titleSearchQuery.trim();
    if (!q) return;
    setTitleSearchBusy(true);
    setTitleSearchError("");
    setTitleSearchSubmitted(true);
    try {
      const response = await api<{ results: MediaSearchResult[] }>("/api/provider-titles/search", {
        method: "POST",
        body: JSON.stringify({
          input: q,
          mediaType: effectiveSearchMediaType,
          year: item.parsedRelease?.year ?? presentation?.releaseYear ?? undefined
        })
      });
      setTitleSearchResults(response.results);
    } catch (error) {
      setTitleSearchError(error instanceof Error ? error.message : String(error));
    } finally {
      setTitleSearchBusy(false);
    }
  }

  function chooseProviderTitle(input: {
    provider: string;
    providerEntityType?: string;
    providerId: string;
    mediaType: "MOVIE" | "TV_SERIES";
  }) {
    const { provider, providerEntityType, providerId, mediaType } = input;
    void runAction(() =>
      api(`/api/items/${item.id}/match/manual`, {
        method: "POST",
        body: JSON.stringify({ provider, providerEntityType, providerId, mediaType })
      })
    ).then((result) => {
      if (result.ok) {
        setCorrectionOpen(false);
      }
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
            <StatusPill ok={status.ok}>{t(status.labelKey, { defaultValue: status.label })}</StatusPill>
            <span>{item.feed?.name ?? t("common.feed")}</span>
            <span>{relativeTime(item.firstSeenAt)}</span>
          </div>
          <div className="release-sheet-title">
            <h3>{title}</h3>
            <div className="token-row">
              {presentation?.releaseYear && <Pill>{presentation.releaseYear}</Pill>}
              {presentation?.mediaType && presentation.mediaType !== "UNKNOWN" && <Pill>{legacyKindFromMediaType(presentation.mediaType)}</Pill>}
              {identity !== "resolved" && item.parsedRelease?.year && <Pill>{item.parsedRelease.year}</Pill>}
              {identity !== "resolved" && item.parsedRelease?.kind && item.parsedRelease.kind !== "UNKNOWN" && <Pill>{item.parsedRelease.kind}</Pill>}
            </div>
          </div>
          <p>{presentation?.overview ?? t(identity === "resolved" ? "overview.inspector.noOverview" : "overview.inspector.chooseTitleLead")}</p>
          <div className="release-sheet-actions">
            {!enrichmentPending && identity === "resolved" ? (
              <UiButton className="secondary glass" disabled={busy} onClick={() => setCorrectionOpen((open) => !open)}>
                <Search size={17} />
                {t("overview.inspector.wrongTitle")}
              </UiButton>
            ) : !enrichmentPending ? (
              <UiButton className="secondary glass" disabled={busy} onClick={() => setCorrectionOpen(true)}>
                <Search size={17} />
                {t("overview.inspector.chooseTitle")}
              </UiButton>
            ) : null}
            {item.sourceUrl && (
              <a className="secondary glass source-link" href={item.sourceUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={17} />
                {t("common.source")}
              </a>
            )}
            <ManualDownload
              buttonLabel={identity === "resolved" ? undefined : t("overview.inspector.downloadAnyway")}
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

      {correctionOpen && (
        <section className="release-title-correction release-sheet-panel">
          <header>
            <div>
              <span>{t("overview.inspector.titleCorrection")}</span>
              <h4>{t(identity === "resolved" ? "overview.inspector.wrongTitle" : "overview.inspector.chooseTitle")}</h4>
            </div>
            <small>{t("overview.inspector.chooseTitleLead")}</small>
          </header>
          <form className="title-search-form" onSubmit={searchTitles}>
            <FormInput
              disabled={busy || titleSearchBusy}
              onChange={(event) => {
                setTitleSearchQuery(event.target.value);
                setTitleSearchSubmitted(false);
                setTitleSearchResults([]);
              }}
              placeholder={t("overview.inspector.smartSearchPlaceholder")}
              value={titleSearchQuery}
            />
            <UiButton className="secondary glass" disabled={busy || titleSearchBusy || !titleSearchQuery.trim()}>
              <Search size={17} />
              {titleSearchBusy ? t("common.loading") : t("common.search")}
            </UiButton>
          </form>
          {titleSearchError && <p className="modal-feedback error">{titleSearchError}</p>}
          {titleSearchSubmitted && !titleSearchBusy && !titleSearchError && titleSearchResults.length === 0 && /^\d+$/.test(titleSearchQuery.trim()) && (
            <p className="modal-feedback">{t("overview.inspector.providerLinkHint")}</p>
          )}
          <details className="release-id-fallback">
            <summary>{t("overview.inspector.searchOptions")}</summary>
            <SelectField
              disabled={busy || titleSearchBusy}
              onValueChange={(value) => setTitleSearchMediaType(value as "" | "MOVIE" | "TV_SERIES")}
              options={[
                { value: "", label: inferredSearchMediaType ? t("overview.inspector.useParsedType") : t("common.anyKind") },
                { value: "MOVIE", label: t("common.movie") },
                { value: "TV_SERIES", label: t("common.tv") }
              ]}
              value={titleSearchMediaType}
            />
          </details>
          {titleSearchResults.length > 0 && (
            <div className="title-result-grid">
              {titleSearchResults.map((result) => (
                <article className="title-result" key={`${result.provider}-${result.providerEntityType ?? result.kind}-${result.providerId}`}>
                  {result.posterUrl ? (
                    <img src={result.posterUrl} alt={result.title} />
                  ) : (
                    <PosterFallback title={result.title} />
                  )}
                  <div>
                    <strong>{result.title}</strong>
                    <span>{[providerLabel(result.provider), legacyKindFromMediaType(result.mediaType), result.year].filter(Boolean).join(" · ") || t("common.unknown")}</span>
                  </div>
                  <div className="title-result-actions">
                    {result.externalUrl && (
                      <a
                        className="secondary glass compact"
                        href={result.externalUrl}
                        onClick={(event) => event.stopPropagation()}
                        rel="noreferrer"
                        target="_blank"
                        title={t("common.source")}
                      >
                        <ExternalLink size={16} />
                      </a>
                    )}
                    <UiButton
                      className="secondary glass"
                      disabled={busy}
                      onClick={() => chooseProviderTitle({
                        provider: result.provider,
                        providerEntityType: result.providerEntityType,
                        providerId: result.providerId,
                        mediaType: result.mediaType
                      })}
                    >
                      {t("common.select")}
                    </UiButton>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="release-sheet-panel">
        <header>
          <div>
            <span>{t("overview.inspector.parsedRelease")}</span>
            <h4>{item.parsedRelease?.title ?? title}</h4>
          </div>
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
          <span>{t("common.advancedDetails")}</span>
          <small>{t("overview.inspector.sourceTools")}</small>
        </summary>
        <section className="release-advanced-grid">
          <div>
            <h4>{t("overview.inspector.identityDetail")}</h4>
            <ReleaseInlineFact label={t("common.provider")} value={item.match?.providerTitle?.provider ?? t("common.missing")} />
            <ReleaseInlineFact label={t("common.providerId")} value={item.match?.providerTitle?.providerId ?? t("common.missing")} />
            <ReleaseInlineFact label={t("overview.inspector.reason")} value={item.match?.reason ?? t("overview.inspector.noMatchReason")} />
          </div>
          <div>
            <h4>{t("overview.inspector.sourceAndTarget")}</h4>
            <ReleaseInlineFact label={t("common.feed")} value={item.feed?.name ?? t("common.feed")} />
            <ReleaseInlineFact label={t("overview.inspector.firstSeen")} value={new Date(item.firstSeenAt).toLocaleString()} />
            <ReleaseInlineFact label={t("common.downloader")} value={downloaders.find((downloader) => downloader.isDefault)?.name ?? downloaders[0]?.name ?? t("common.noDownloader")} />
          </div>
        </section>
        <section className="rss-title-panel">
          <span>{t("overview.inspector.originalRssTitle")}</span>
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
  const { t } = useTranslation();
  const media = detail?.media;
  const title = media?.title ?? t("overview.inspector.loadingMedia");
  const backdropUrl = media?.backdropUrl ?? undefined;
  const posterUrl = media?.posterUrl ?? undefined;
  const releases = detail?.releases ?? [];

  return (
    <AppDialog className="release-dialog cinema-dialog" description={t("overview.inspector.groupedReleases")} onClose={onClose} title={title}>
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
            <Pill>{t("common.releaseCount", { count: releases.length })}</Pill>
          </div>
          <p>{media?.overview ?? t("overview.inspector.loadingDetail")}</p>
        </div>
      </section>
      <section className="media-release-section">
        <header className="poster-shelf-head">
          <h3><Film size={18} />{t("overview.inspector.releaseVersions")}</h3>
          <span>{t("common.releaseCount", { count: releases.length })}</span>
        </header>
        <div className="media-release-list">
          {releases.length === 0 && <Empty label={t("overview.inspector.noReleaseVersions")} />}
          {releases.map((release) => (
            <article className="media-release-row" key={release.id}>
              <div>
                <strong>{releaseTitle(release)}</strong>
                <span>{release.feed?.name ?? t("common.feed")} · {relativeTime(release.firstSeenAt)}</span>
              </div>
              <div className="token-row">
                {release.parsedRelease?.releaseGroup && <Pill>{release.parsedRelease.releaseGroup}</Pill>}
                {release.parsedRelease?.quality && <Pill>{release.parsedRelease.quality}</Pill>}
                {release.parsedRelease?.source && <Pill>{release.parsedRelease.source}</Pill>}
                {release.parsedRelease?.codec && <Pill>{release.parsedRelease.codec}</Pill>}
                {release.parsedRelease?.audio && <Pill>{release.parsedRelease.audio}</Pill>}
                {release.sizeBytes && <Pill>{formatBytes(release.sizeBytes)}</Pill>}
                <StatusPill ok={releaseStatus(release).ok}>{t(releaseStatus(release).labelKey, { defaultValue: releaseStatus(release).label })}</StatusPill>
              </div>
              <div className="media-release-actions">
                {release.sourceUrl && (
                  <a className="secondary source-link compact" href={release.sourceUrl} target="_blank" rel="noreferrer" title={t("overview.inspector.openSourceRelease")}>
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
  const identity = releaseIdentityState(item);
  if (shelf === "all") return true;
  if (shelf === "matched") return identity === "resolved";
  if (shelf === "downloading") return Boolean(latestJob && !["FAILED", "SENT", "COMPLETED"].includes(latestJob.status));
  return status.group === "failed" || identity !== "resolved";
}

function itemBelongsToStatus(item: Item, status: ReleaseStatusFilter) {
  if (!status) return true;
  const identity = releaseIdentityState(item);
  if (status === "matched") return identity === "resolved";
  if (status === "unmatched") return identity !== "resolved";
  if (status === "downloading") return itemBelongsToShelf(item, "downloading");
  return itemBelongsToShelf(item, "attention");
}

function releaseCategory(item: Item): "MOVIE" | "TV" | "OTHER" {
  const kind = item.parsedRelease?.kind && item.parsedRelease.kind !== "UNKNOWN"
    ? item.parsedRelease.kind
    : legacyKindFromMediaType(item.match?.presentation?.mediaType);
  return kind === "MOVIE" || kind === "TV" ? kind : "OTHER";
}

function latestDownloadJob(item: Item) {
  return [...(item.downloadJobs ?? [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0];
}

function posterMetadata(item: Item) {
  const presentation = item.match?.presentation;
  const parts = [
    presentation?.releaseYear,
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
    item.sizeBytes ? formatBytes(item.sizeBytes) : undefined
  ]
    .filter(Boolean)
    .map(String)
    .slice(0, 8);
}

function episodeLabel(item: Item, unknownLabel = "Unknown") {
  const presentationKind = legacyKindFromMediaType(item.match?.presentation?.mediaType);
  if (item.parsedRelease?.kind !== "TV") return presentationKind ?? item.parsedRelease?.kind ?? unknownLabel;
  return `S${item.parsedRelease.season ?? "?"}E${item.parsedRelease.episode ?? "?"}`;
}

function legacyKindFromMediaType(mediaType?: "MOVIE" | "TV_SERIES" | "UNKNOWN") {
  if (!mediaType) return undefined;
  return mediaType === "TV_SERIES" ? "TV" : mediaType;
}

function mediaTypeFromKind(kind?: "MOVIE" | "TV" | "UNKNOWN") {
  if (kind === "TV") return "TV_SERIES";
  if (kind === "MOVIE") return "MOVIE";
  return undefined;
}

function providerLabel(provider?: string) {
  return provider ? provider.toUpperCase() : undefined;
}

function initials(value: string) {
  const words = value.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).slice(0, 2);
  return words.map((word) => word[0]?.toUpperCase()).join("") || "RM";
}
