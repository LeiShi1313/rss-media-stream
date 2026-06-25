import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { api, type Feed } from "../api.js";
import type { ActionResult, RunAction } from "../types.js";
import { CheckboxField, FieldLabel, FormInput, UiButton } from "../components/ui/index.js";
import { Empty } from "../components/common/feedback.js";
import { Modal } from "../components/common/surfaces.js";
import { relativeTime } from "../lib/format.js";

const defaultPollIntervalSeconds = 600;

export function RssPage({
  busy,
  feeds,
  runAction
}: {
  busy: boolean;
  feeds: Feed[];
  runAction: RunAction;
}) {
  const { t } = useTranslation();
  const [feedModal, setFeedModal] = useState<Feed | "new" | null>(null);
  const [deleteFeed, setDeleteFeed] = useState<Feed | null>(null);
  const [query, setQuery] = useState("");
  const filteredFeeds = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return feeds;
    return feeds.filter((feed) =>
      [feed.name, feed.urlPreview]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery))
    );
  }, [feeds, query]);

  return (
    <div className="rss-feed-workbench">
      <section className="rss-feed-command" aria-label={t("rss.feedSources")}>
        <div className="rss-feed-command-left">
          <FieldLabel className="search-control rss-feed-search">
            <span className="sr-only">{t("rss.searchFeeds")}</span>
            <Search size={16} />
            <FormInput
              aria-label={t("rss.searchFeeds")}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("rss.searchFeeds")}
              type="search"
              value={query}
            />
          </FieldLabel>
          <span className="rss-feed-count">{t("rss.feedCount", { count: feeds.length })}</span>
        </div>
        <UiButton className="primary" disabled={busy} onClick={() => setFeedModal("new")}>
          <Plus size={17} />
          {t("rss.addFeed")}
        </UiButton>
      </section>

      <section className="rss-feed-table" role="table" aria-label={t("rss.feedSources")}>
        <div className="rss-feed-table-head" role="row">
          <span role="columnheader">{t("common.feed")}</span>
          <span role="columnheader">{t("rss.lastPoll")}</span>
          <span role="columnheader">{t("rss.cadence")}</span>
          <span role="columnheader">{t("rss.items")}</span>
          <span role="columnheader">{t("rss.urlPreview")}</span>
          <span role="columnheader">{t("rss.actions")}</span>
        </div>
        {feeds.length === 0 && <Empty label={t("rss.noFeeds")} />}
        {feeds.length > 0 && filteredFeeds.length === 0 && <Empty label={t("rss.noMatchingFeeds")} />}
        {filteredFeeds.map((feed) => (
          <article className={feed.lastError ? "rss-feed-row error" : "rss-feed-row"} key={feed.id} role="row">
            <div className="rss-feed-copy" role="cell">
              <strong>{feed.name}</strong>
              {feed.lastError ? (
                <span className="rss-feed-error">{feed.lastError}</span>
              ) : (
                <span>{feed.hasRequestHeaders ? t("rss.headersConfigured") : t("rss.noRequestHeaders")}</span>
              )}
            </div>
            <span role="cell">{feed.lastPolledAt ? relativeTime(feed.lastPolledAt) : t("rss.notPolledShort")}</span>
            <span role="cell">{formatPollInterval(feed.pollIntervalSeconds)}</span>
            <strong role="cell">{feed.itemCount.toLocaleString()}</strong>
            <code role="cell">{feed.urlPreview ?? t("rss.removedUrl")}</code>
            <div className="row-actions" role="cell">
              <UiButton
                aria-label={t("rss.refreshFeedNamed", { name: feed.name })}
                className="icon-button"
                disabled={busy}
                onClick={() => runAction(() => api(`/api/feeds/${feed.id}/refresh`, { method: "POST" }))}
                title={t("rss.refreshFeed")}
              >
                <RefreshCw size={17} />
              </UiButton>
              <UiButton
                aria-label={t("rss.editFeedNamed", { name: feed.name })}
                className="icon-button"
                disabled={busy}
                onClick={() => setFeedModal(feed)}
                title={t("common.edit")}
              >
                <Pencil size={16} />
              </UiButton>
              <UiButton
                aria-label={t("rss.deleteFeedNamed", { name: feed.name })}
                className="icon-button danger"
                disabled={busy}
                onClick={() => setDeleteFeed(feed)}
                title={t("rss.deleteFeed")}
              >
                <Trash2 size={17} />
              </UiButton>
            </div>
          </article>
        ))}
      </section>

      {feedModal && (
        <Modal
          title={feedModal === "new" ? t("rss.addRssFeed") : t("rss.editRssFeed")}
          onClose={() => setFeedModal(null)}
        >
          <FeedModalForm
            busy={busy}
            feed={feedModal === "new" ? undefined : feedModal}
            onCancel={() => setFeedModal(null)}
            onSubmit={async (body) => {
              const result = await runAction(async () => {
                if (feedModal === "new") {
                  await api("/api/feeds", { method: "POST", body });
                } else {
                  await api(`/api/feeds/${feedModal.id}`, { method: "PATCH", body });
                }
              });
              if (result.ok) setFeedModal(null);
              return result;
            }}
          />
        </Modal>
      )}
      {deleteFeed && (
        <Modal
          title={t("rss.deleteFeedTitle", { name: deleteFeed.name })}
          onClose={() => setDeleteFeed(null)}
        >
          <DeleteFeedConfirmation
            busy={busy}
            feed={deleteFeed}
            onCancel={() => setDeleteFeed(null)}
            onConfirm={async () => {
              const result = await runAction(() => api(`/api/feeds/${deleteFeed.id}`, { method: "DELETE" }));
              if (result.ok) setDeleteFeed(null);
              return result;
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function formatPollInterval(seconds: number) {
  if (seconds < 120) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function DeleteFeedConfirmation({
  busy,
  feed,
  onCancel,
  onConfirm
}: {
  busy: boolean;
  feed: Feed;
  onCancel: () => void;
  onConfirm: () => Promise<ActionResult>;
}) {
  const { t } = useTranslation();
  const [submitError, setSubmitError] = useState("");

  return (
    <div className="modal-form">
      <p className="modal-copy">{t("rss.deleteFeedBody", { name: feed.name })}</p>
      <p className="modal-copy muted">{t("rss.deleteFeedKeepsItems", { count: feed.itemCount })}</p>
      {submitError && <p className="modal-feedback error">{submitError}</p>}
      <div className="modal-actions">
        <UiButton className="secondary" onClick={onCancel} type="button">
          {t("common.cancel")}
        </UiButton>
        <UiButton
          className="primary danger"
          disabled={busy}
          onClick={async () => {
            setSubmitError("");
            const result = await onConfirm();
            if (!result.ok) setSubmitError(result.message);
          }}
          type="button"
        >
          <Trash2 size={17} />
          {t("rss.confirmDeleteFeed")}
        </UiButton>
      </div>
    </div>
  );
}

function FeedModalForm({
  busy,
  feed,
  onCancel,
  onSubmit
}: {
  busy: boolean;
  feed?: Feed;
  onCancel: () => void;
  onSubmit: (body: string) => Promise<ActionResult>;
}) {
  const { t } = useTranslation();
  const editing = Boolean(feed);
  const [name, setName] = useState(feed?.name ?? "");
  const [url, setUrl] = useState("");
  const [pollIntervalSeconds, setPollIntervalSeconds] = useState(
    String(feed?.pollIntervalSeconds ?? defaultPollIntervalSeconds)
  );
  const [enabled, setEnabled] = useState(feed?.enabled ?? true);
  const [submitError, setSubmitError] = useState("");

  return (
    <form
      className="modal-form"
      onSubmit={async (event) => {
        event.preventDefault();
        const nextUrl = url.trim();
        setSubmitError("");
        const result = await onSubmit(
          JSON.stringify({
            name: name.trim(),
            pollIntervalSeconds: Number(pollIntervalSeconds),
            enabled,
            ...(!editing || nextUrl ? { url: nextUrl } : {})
          })
        );
        if (!result.ok) setSubmitError(result.message);
      }}
    >
      <FieldLabel>
        {t("rss.feedName")}
        <FormInput value={name} onChange={(event) => setName(event.target.value)} required />
      </FieldLabel>
      <FieldLabel>
        {t("rss.privateUrl")}
        <FormInput
          placeholder={editing ? t("rss.keepCurrentUrl") : t("rss.urlPlaceholder")}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          required={!editing}
        />
      </FieldLabel>
      <div className="form-grid">
        <FieldLabel>
          {t("rss.pollInterval")}
          <FormInput
            type="number"
            min={60}
            value={pollIntervalSeconds}
            onChange={(event) => setPollIntervalSeconds(event.target.value)}
            required
          />
        </FieldLabel>
        <CheckboxField className="checkbox-row" checked={enabled} onCheckedChange={setEnabled} label={t("common.enabled")} />
      </div>
      {submitError && <p className="modal-feedback error">{submitError}</p>}
      <div className="modal-actions">
        <UiButton className="secondary" onClick={onCancel} type="button">
          {t("common.cancel")}
        </UiButton>
        <UiButton className="primary" disabled={busy} type="submit">
          {editing ? <Pencil size={17} /> : <Plus size={17} />}
          {editing ? t("rss.saveFeed") : t("rss.addFeed")}
        </UiButton>
      </div>
    </form>
  );
}
