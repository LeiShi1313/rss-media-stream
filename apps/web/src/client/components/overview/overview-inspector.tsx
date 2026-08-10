import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Film, Search } from "lucide-react";
import type {
  DownloaderDto,
  ItemDto,
  MediaDetailDto,
  MediaSearchResultDto,
  ProviderSearchResponseDto
} from "@rss-media/shared/apiContracts";
import { api } from "../../api.js";
import type { RunAction } from "../../types.js";
import { AppDialog, FormInput, SelectField, UiButton } from "../ui/index.js";
import { Empty, Pill, StatusPill } from "../common/feedback.js";
import { ManualDownload } from "../common/manual-download.js";
import { PosterFallback } from "../media/poster-fallback.js";
import { errorMessage, formatBytes, relativeTime } from "../../lib/format.js";
import { formatNativeRating } from "../../lib/ratings.js";
import {
  releaseIdentityState,
  releaseKindOrEpisodeLabel,
  releaseStatus,
  releaseTitle
} from "../../lib/releases.js";
import { providerLabel } from "../../lib/forms.js";
import { legacyKindFromMediaType, mediaTypeFromKind } from "../../lib/media.js";

export type OverviewInspectorTarget =
  | { type: "release"; item: ItemDto }
  | { type: "media"; mediaId: string };

export type OverviewInspectorProps = {
  target: OverviewInspectorTarget;
  busy: boolean;
  downloaders: DownloaderDto[];
  runAction: RunAction;
  onClose: () => void;
};

export function OverviewInspector({
  target,
  busy,
  downloaders,
  runAction,
  onClose
}: OverviewInspectorProps) {
  if (target.type === "release") {
    return (
      <ReleaseInspectorModal
        busy={busy}
        downloaders={downloaders}
        item={target.item}
        key={`release:${target.item.id}`}
        onClose={onClose}
        runAction={runAction}
      />
    );
  }

  return (
    <MediaInspectorModal
      busy={busy}
      downloaders={downloaders}
      key={`media:${target.mediaId}`}
      mediaId={target.mediaId}
      onClose={onClose}
      runAction={runAction}
    />
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
  downloaders: DownloaderDto[];
  item: ItemDto;
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
    [t("common.episode"), releaseKindOrEpisodeLabel(item, unknown)],
    [t("common.size"), item.sizeBytes ? formatBytes(item.sizeBytes, unknown) : unknown]
  ] as const;
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [titleSearchQuery, setTitleSearchQuery] = useState(item.parsedRelease?.title ?? title);
  const [titleSearchResults, setTitleSearchResults] = useState<MediaSearchResultDto[]>([]);
  const [titleSearchBusy, setTitleSearchBusy] = useState(false);
  const [titleSearchError, setTitleSearchError] = useState("");
  const [titleSearchSubmitted, setTitleSearchSubmitted] = useState(false);
  const [titleSearchMediaType, setTitleSearchMediaType] = useState<"" | "MOVIE" | "TV_SERIES">("");
  const [titleSearchProvider, setTitleSearchProvider] = useState<"" | "tmdb" | "tvdb" | "ptgen">("");

  const inferredSearchMediaType =
    mediaTypeFromKind(item.parsedRelease?.kind) ?? (presentation?.mediaType !== "UNKNOWN" ? presentation?.mediaType : undefined);
  const effectiveSearchMediaType = titleSearchMediaType || inferredSearchMediaType;

  async function searchTitles(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = titleSearchQuery.trim();
    if (!q) return;
    setTitleSearchBusy(true);
    setTitleSearchError("");
    setTitleSearchSubmitted(true);
    try {
      const response = await api<ProviderSearchResponseDto>("/api/provider-titles/search", {
        method: "POST",
        body: JSON.stringify({
          input: q,
          provider: titleSearchProvider || undefined,
          mediaType: effectiveSearchMediaType,
          year: item.parsedRelease?.year ?? presentation?.releaseYear ?? undefined
        })
      });
      setTitleSearchResults(response.results);
    } catch (error) {
      setTitleSearchError(errorMessage(error));
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
        style={heroBackdropStyle(backdropUrl, [0.98, 0.82, 0.58])}
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
          {titleSearchSubmitted && !titleSearchBusy && !titleSearchError && titleSearchResults.length === 0 && (
            <p className="modal-feedback">
              {t("overview.inspector.noTitleResults")} {t("overview.inspector.providerLinkHint")}
            </p>
          )}
          <details className="release-id-fallback">
            <summary>{t("overview.inspector.searchOptions")}</summary>
            <div className="title-search-options-row">
              <SelectField
                disabled={busy || titleSearchBusy}
                onValueChange={(value) => setTitleSearchProvider(value as "" | "tmdb" | "tvdb" | "ptgen")}
                options={[
                  { value: "", label: t("common.anyProvider") },
                  { value: "tmdb", label: "TMDB" },
                  { value: "tvdb", label: "TVDB" },
                  { value: "ptgen", label: "PTGen" }
                ]}
                value={titleSearchProvider}
              />
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
            </div>
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
                    <span>{[searchResultSourceLabel(result), legacyKindFromMediaType(result.mediaType), result.year, searchResultBackendLabel(result)].filter(Boolean).join(" · ") || t("common.unknown")}</span>
                    {result.presentation?.rating && (
                      <span className="title-result-rating">
                        {formatSearchRating(result)}
                      </span>
                    )}
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
            <ReleaseInlineFact label={t("common.reason")} value={item.match?.reason ?? t("overview.inspector.noMatchReason")} />
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
  downloaders,
  mediaId,
  onClose,
  runAction
}: {
  busy: boolean;
  downloaders: DownloaderDto[];
  mediaId: string;
  onClose: () => void;
  runAction: RunAction;
}) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<MediaDetailDto | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    api<MediaDetailDto>(`/api/media-titles/${mediaId}/detail`, { signal: controller.signal })
      .then((nextDetail) => {
        if (!controller.signal.aborted) setDetail(nextDetail);
      })
      .catch(() => {
        if (!controller.signal.aborted) setDetail(null);
      });
    return () => controller.abort();
  }, [mediaId]);

  const media = detail?.media;
  const title = media?.title ?? t("overview.inspector.loadingMedia");
  const backdropUrl = media?.backdropUrl ?? undefined;
  const posterUrl = media?.posterUrl ?? undefined;
  const releases = detail?.releases ?? [];

  return (
    <AppDialog className="release-dialog cinema-dialog" description={t("overview.inspector.groupedReleases")} onClose={onClose} title={title}>
      <section
        className="release-dialog-hero"
        style={heroBackdropStyle(backdropUrl, [0.96, 0.76, 0.42])}
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
              <div className="media-release-copy">
                <div>
                  <strong>{releaseTitle(release)}</strong>
                  <span>{release.feed?.name ?? t("common.feed")} · {relativeTime(release.firstSeenAt)}</span>
                </div>
                <details className="media-release-origin">
                  <summary>{t("overview.inspector.originalRssTitle")}</summary>
                  <p>{release.rawTitle}</p>
                </details>
              </div>
              <div className="token-row">
                {releaseEpisodeLabel(release) && <Pill>{releaseEpisodeLabel(release)}</Pill>}
                {release.parsedRelease?.releaseGroup && <Pill>{release.parsedRelease.releaseGroup}</Pill>}
                {release.parsedRelease?.quality && <Pill>{release.parsedRelease.quality}</Pill>}
                {release.parsedRelease?.source && <Pill>{release.parsedRelease.source}</Pill>}
                {release.parsedRelease?.codec && <Pill>{release.parsedRelease.codec}</Pill>}
                {release.parsedRelease?.audio && <Pill>{release.parsedRelease.audio}</Pill>}
                {release.sizeBytes && <Pill>{formatBytes(release.sizeBytes)}</Pill>}
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

function releaseEpisodeLabel(item: ItemDto) {
  const parsed = item.parsedRelease;
  if (parsed?.kind !== "TV") return undefined;

  const season = parsed.season == null ? "?" : String(parsed.season).padStart(2, "0");
  const episode = parsed.episode == null ? "?" : String(parsed.episode).padStart(2, "0");
  const episodeEnd = parsed.episodeEnd == null ? undefined : String(parsed.episodeEnd).padStart(2, "0");
  return episodeEnd && episodeEnd !== episode
    ? `S${season}E${episode}-E${episodeEnd}`
    : `S${season}E${episode}`;
}

function formatSearchRating(result: MediaSearchResultDto) {
  const rating = result.presentation?.rating;
  if (!rating) return "";
  const source = searchResultSourceLabel(result);
  const votes = rating.voteCount
    ? ` · ${new Intl.NumberFormat(undefined, { notation: "compact" }).format(rating.voteCount)} votes`
    : "";
  return `${source ? `${source} ` : ""}${formatNativeRating(rating)}${votes}`;
}

function searchResultSourceLabel(result: MediaSearchResultDto) {
  if (result.provider === "ptgen") {
    return ptgenSourceLabel(result) ?? "PTGen";
  }
  return providerLabel(result.provider);
}

function searchResultBackendLabel(result: MediaSearchResultDto) {
  return result.provider === "ptgen" ? "via PTGen" : undefined;
}

function ptgenSourceLabel(result: MediaSearchResultDto) {
  const identity = `${result.providerEntityType ?? ""}:${result.providerId}`.toLowerCase();
  if (identity.includes("ptgen_douban") || result.providerId.toLowerCase().startsWith("douban-")) return "Douban";
  if (identity.includes("ptgen_imdb") || result.providerId.toLowerCase().startsWith("imdb-")) return "IMDb";
  return undefined;
}

function heroBackdropStyle(backdropUrl: string | undefined, alphas: [number, number, number]) {
  if (!backdropUrl) return undefined;
  const stops = alphas.map((alpha) => `rgba(7,10,18,${alpha})`).join(", ");
  return { backgroundImage: `linear-gradient(90deg, ${stops}), url(${backdropUrl})` };
}
