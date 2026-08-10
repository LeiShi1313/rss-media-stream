import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  Clock3,
  DownloadCloud,
  Search,
  Sparkles,
  XCircle
} from "lucide-react";
import type {
  ItemDto,
  ItemPageDto,
  MediaTitleDto,
  TrendingMediaDto,
  TrendingMediaPageDto
} from "@rss-media/shared/apiContracts";
import { api } from "../../api.js";
import { Empty } from "../common/feedback.js";
import { PosterFallback } from "../media/poster-fallback.js";
import { RatingBadge } from "../media/rating-badge.js";
import { FieldLabel, FormInput, SelectField, UiButton } from "../ui/index.js";
import { errorMessage, formatBytes, relativeTime } from "../../lib/format.js";
import {
  isTerminalDownloadStatus,
  latestDownloadJob,
  releaseIdentityState,
  releaseKindOrEpisodeLabel,
  releaseNeedsAttention,
  releaseStatus,
  releaseTitle
} from "../../lib/releases.js";

type ShelfKey = "matched" | "downloading" | "attention";
type ReleaseCategoryFilter = "" | "MOVIE" | "TV" | "OTHER";
type ReleaseStatusFilter = "" | "matched" | "unmatched" | "downloading" | "attention";

export type OverviewCatalogProps = {
  items: ItemDto[];
  onInspectRelease: (item: ItemDto) => void;
  onInspectMedia: (mediaId: string) => void;
};

export function OverviewCatalog({
  items,
  onInspectMedia,
  onInspectRelease
}: OverviewCatalogProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [feedFilter, setFeedFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<ReleaseCategoryFilter>("");
  const [statusFilter, setStatusFilter] = useState<ReleaseStatusFilter>("");
  const filtersActive = Boolean(query.trim() || feedFilter || categoryFilter || statusFilter);
  const newlyAddedShelf = useItemShelf({ enabled: !filtersActive });
  const filteredShelf = useItemShelf({
    enabled: filtersActive,
    q: query,
    feedId: feedFilter,
    category: categoryFilter,
    status: statusFilter
  });
  const trendingMovies = useTrendingMediaShelf("MOVIE");
  const trendingTv = useTrendingMediaShelf("TV_SERIES");

  const feedOptions = useMemo(
    () => [
      { value: "", label: t("overview.filters.allFeeds") },
      ...Array.from(new Map(items.flatMap((item) => item.feed ? [[item.feed.id, item.feed.name]] : [])).entries())
        .map(([value, label]) => ({ value, label }))
    ],
    [items, t]
  );
  const shelves = useMemo(() => buildShelves(items), [items]);

  return (
    <>
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
              error={filteredShelf.error}
              icon={<Search size={18} />}
              items={filteredShelf.items}
              layout="grid"
              limit={null}
              loading={filteredShelf.loading}
              onInspect={onInspectRelease}
              onRetry={filteredShelf.loadMore}
              sentinelRef={filteredShelf.sentinelRef}
              title={t("overview.shelves.filtered")}
            />
          ) : (
            <>
              <PosterShelf
                cardVariant="parsed"
                emptyLabel={t("overview.shelves.newlyAddedEmpty")}
                error={newlyAddedShelf.error}
                icon={<Clock3 size={18} />}
                items={newlyAddedShelf.items}
                limit={null}
                loading={newlyAddedShelf.loading}
                onInspect={onInspectRelease}
                onRetry={newlyAddedShelf.loadMore}
                railRef={newlyAddedShelf.railRef}
                sentinelRef={newlyAddedShelf.sentinelRef}
                title={t("overview.shelves.newlyAdded")}
              />
              <TrendingMediaShelf
                shelf={trendingMovies}
                onInspect={(media) => onInspectMedia(media.id)}
                title={t("overview.shelves.trendingMovies")}
              />
              <TrendingMediaShelf
                shelf={trendingTv}
                onInspect={(media) => onInspectMedia(media.id)}
                title={t("overview.shelves.trendingTv")}
              />
              <PosterShelf
                emptyLabel={t("overview.shelves.matchedEmpty")}
                icon={<CheckCircle2 size={18} />}
                items={shelves.matched}
                onInspect={onInspectRelease}
                title={t("overview.shelves.matched")}
              />
              <PosterShelf
                emptyLabel={t("overview.shelves.downloadingEmpty")}
                icon={<DownloadCloud size={18} />}
                items={shelves.downloading}
                onInspect={onInspectRelease}
                title={t("overview.shelves.downloading")}
              />
              <PosterShelf
                emptyLabel={t("overview.shelves.attentionEmpty")}
                icon={<XCircle size={18} />}
                items={shelves.attention}
                onInspect={onInspectRelease}
                title={t("overview.shelves.attention")}
              />
            </>
          )}
        </div>
      </section>
    </>
  );
}

function TrendingMediaShelf({
  onInspect,
  shelf,
  title
}: {
  onInspect: (media: MediaTitleDto) => void;
  shelf: TrendingShelfState;
  title: string;
}) {
  const { t } = useTranslation();
  return (
    <section className="poster-shelf">
      <header className="poster-shelf-head">
        <h3><Sparkles size={18} />{title}</h3>
        <span>{t("overview.shelves.trendingWindow")}</span>
      </header>
      {shelf.items.length === 0 && !shelf.loading ? (
        <Empty label={t("overview.shelves.trendingEmpty")} />
      ) : (
        <div className="poster-rail" ref={shelf.railRef}>
          {shelf.items.map((entry) => (
            <TrendingMediaCard entry={entry} key={entry.media.id} onInspect={() => onInspect(entry.media)} />
          ))}
          {!shelf.exhausted && <span aria-hidden="true" className="poster-rail-sentinel" ref={shelf.sentinelRef} />}
        </div>
      )}
      {(shelf.loading || shelf.error) && (
        <div className="shelf-inline-status">
          {shelf.loading && <span>{t("common.loading")}</span>}
          {shelf.error && (
            <>
              <span>{shelf.error}</span>
              <UiButton className="secondary compact" onClick={() => shelf.loadMore()}>
                {t("common.retry")}
              </UiButton>
            </>
          )}
        </div>
      )}
    </section>
  );
}

type TrendingShelfState = {
  items: TrendingMediaDto[];
  loading: boolean;
  error: string;
  exhausted: boolean;
  loadMore: () => void;
  railRef: RefObject<HTMLDivElement | null>;
  sentinelRef: RefObject<HTMLSpanElement | null>;
};

type ItemShelfState = {
  items: ItemDto[];
  loading: boolean;
  error: string;
  exhausted: boolean;
  loadMore: () => void;
  railRef: RefObject<HTMLDivElement | null>;
  sentinelRef: RefObject<HTMLSpanElement | null>;
};

type ItemShelfOptions = {
  enabled?: boolean;
  q?: string;
  feedId?: string;
  category?: ReleaseCategoryFilter;
  status?: ReleaseStatusFilter;
};

type CursorPage<T> = { items: T[]; nextCursor?: string };

function useCursorShelf<T>({
  enabled = true,
  fetchPage,
  keyOf
}: {
  enabled?: boolean;
  fetchPage: (cursor: string | undefined, signal: AbortSignal) => Promise<CursorPage<T>>;
  keyOf: (item: T) => string;
}) {
  const [items, setItems] = useState<T[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [exhausted, setExhausted] = useState(false);
  const loadingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLSpanElement | null>(null);

  const loadPage = useCallback(async (cursor?: string, replace = false) => {
    if (!enabled) return;
    if (loadingRef.current) {
      if (!replace) return;
      abortRef.current?.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;
    loadingRef.current = true;
    setLoading(true);
    setError("");
    try {
      const page = await fetchPage(cursor, controller.signal);
      if (controller.signal.aborted) return;
      setItems((current) => replace ? page.items : appendByKey(current, page.items, keyOf));
      setNextCursor(page.nextCursor);
      setExhausted(!page.nextCursor);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(errorMessage(err));
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [enabled, fetchPage, keyOf]);

  const loadMore = useCallback(() => {
    if (loadingRef.current || exhausted) return;
    void loadPage(nextCursor);
  }, [exhausted, loadPage, nextCursor]);

  useEffect(() => {
    setItems([]);
    setNextCursor(undefined);
    setError("");
    setExhausted(!enabled);
    if (!enabled) {
      abortRef.current?.abort();
      abortRef.current = null;
      loadingRef.current = false;
      setLoading(false);
      return undefined;
    }
    void loadPage(undefined, true);
    return () => abortRef.current?.abort();
  }, [enabled, loadPage]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!enabled || !sentinel || exhausted) return undefined;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    }, {
      root: railRef.current,
      rootMargin: railRef.current ? "0px 320px 0px 0px" : "360px 0px 360px 0px"
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [enabled, exhausted, items.length, loadMore]);

  return { items, loading, error, exhausted, loadMore, railRef, sentinelRef };
}

function appendByKey<T>(current: T[], next: T[], keyOf: (item: T) => string) {
  const seen = new Set(current.map(keyOf));
  return [
    ...current,
    ...next.filter((item) => {
      if (seen.has(keyOf(item))) return false;
      seen.add(keyOf(item));
      return true;
    })
  ];
}

function useItemShelf({
  enabled = true,
  q = "",
  feedId = "",
  category = "",
  status = ""
}: ItemShelfOptions): ItemShelfState {
  const query = q.trim();
  const fetchPage = useCallback((cursor: string | undefined, signal: AbortSignal) => {
    const params = new URLSearchParams({ limit: "24" });
    if (cursor) params.set("cursor", cursor);
    if (query) params.set("q", query);
    if (feedId) params.set("feedId", feedId);
    if (category) params.set("category", category);
    if (status) params.set("status", status);
    return api<ItemPageDto>(`/api/items?${params.toString()}`, { signal });
  }, [category, feedId, query, status]);
  return useCursorShelf({ enabled, fetchPage, keyOf: itemKey });
}

function itemKey(item: ItemDto) {
  return item.id;
}

function useTrendingMediaShelf(mediaType: "MOVIE" | "TV_SERIES"): TrendingShelfState {
  const fetchPage = useCallback((cursor: string | undefined, signal: AbortSignal) => {
    const params = new URLSearchParams({ windowDays: "7", limit: "24", mediaType });
    if (cursor) params.set("cursor", cursor);
    return api<TrendingMediaPageDto>(`/api/media-titles/trending?${params.toString()}`, { signal });
  }, [mediaType]);
  return useCursorShelf({ fetchPage, keyOf: trendingKey });
}

function trendingKey(entry: TrendingMediaDto) {
  return entry.media.id;
}

function TrendingMediaCard({ entry, onInspect }: { entry: TrendingMediaDto; onInspect: () => void }) {
  const { t } = useTranslation();
  const posterUrl = entry.media.posterUrl ?? undefined;
  return (
    <button className="release-poster-card" onClick={onInspect} type="button">
      <span className="poster-badge">{t("common.releaseCount", { count: entry.releaseCount })}</span>
      <RatingBadge rating={entry.media.rating} />
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
  error = "",
  icon,
  items,
  layout = "rail",
  limit = 18,
  loading = false,
  onInspect,
  onRetry,
  railRef,
  sentinelRef,
  title
}: {
  cardVariant?: "status" | "parsed";
  emptyLabel: string;
  error?: string;
  icon: ReactNode;
  items: ItemDto[];
  layout?: "rail" | "grid";
  limit?: number | null;
  loading?: boolean;
  onInspect: (item: ItemDto) => void;
  onRetry?: () => void;
  railRef?: RefObject<HTMLDivElement | null>;
  sentinelRef?: RefObject<HTMLSpanElement | null>;
  title: string;
}) {
  const { t } = useTranslation();
  const visibleItems = limit == null ? items : items.slice(0, limit);
  return (
    <section className="poster-shelf">
      <header className="poster-shelf-head">
        <h3>{icon}{title}</h3>
        <span>{t("common.releaseCount", { count: items.length })}</span>
      </header>
      {items.length === 0 && !loading ? (
        <Empty label={emptyLabel} />
      ) : (
        <div className={layout === "grid" ? "poster-grid" : "poster-rail"} ref={layout === "rail" ? railRef : undefined}>
          {visibleItems.map((item) => (
            <ReleasePosterCard
              item={item}
              key={item.id}
              onInspect={() => onInspect(item)}
              variant={cardVariant}
            />
          ))}
          {sentinelRef && <span aria-hidden="true" className={layout === "grid" ? "poster-grid-sentinel" : "poster-rail-sentinel"} ref={sentinelRef} />}
        </div>
      )}
      {(loading || error) && (
        <div className="shelf-inline-status">
          {loading && <span>{t("common.loading")}</span>}
          {error && (
            <>
              <span>{error}</span>
              {onRetry && (
                <UiButton className="secondary compact" onClick={onRetry}>
                  {t("common.retry")}
                </UiButton>
              )}
            </>
          )}
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
  item: ItemDto;
  onInspect: () => void;
  variant: "status" | "parsed";
}) {
  const { t } = useTranslation();
  const title = releaseTitle(item);
  const status = releaseStatus(item);
  const presentation = item.match?.presentation;
  const posterUrl = presentation?.posterUrl ?? undefined;
  const parsedTags = parsedReleaseTags(item);

  return (
    <button className="release-poster-card" onClick={onInspect} type="button">
      {variant === "status" && (
        <span className={status.ok ? "poster-badge" : "poster-badge warn"}>{t(status.labelKey, { defaultValue: status.label })}</span>
      )}
      <RatingBadge rating={presentation?.rating} />
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

function buildShelves(items: ItemDto[]) {
  return {
    matched: items.filter((item) => itemBelongsToShelf(item, "matched")),
    downloading: items.filter((item) => itemBelongsToShelf(item, "downloading")),
    attention: items.filter((item) => itemBelongsToShelf(item, "attention"))
  };
}

function itemBelongsToShelf(item: ItemDto, shelf: ShelfKey) {
  const latestJob = latestDownloadJob(item);
  const identity = releaseIdentityState(item);
  if (shelf === "matched") return identity === "resolved";
  if (shelf === "downloading") return Boolean(latestJob && !isTerminalDownloadStatus(latestJob.status));
  return releaseNeedsAttention(item);
}

function posterMetadata(item: ItemDto) {
  const presentation = item.match?.presentation;
  const parts = [
    presentation?.releaseYear,
    releaseKindOrEpisodeLabel(item),
    item.parsedRelease?.quality,
    item.parsedRelease?.source,
    item.parsedRelease?.releaseGroup,
    item.feed?.name
  ].filter(Boolean);
  return parts.join(" · ") || relativeTime(item.firstSeenAt);
}

function parsedReleaseTags(item: ItemDto) {
  const parsed = item.parsedRelease;
  const episode = parsed?.kind === "TV" ? releaseKindOrEpisodeLabel(item) : undefined;
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
