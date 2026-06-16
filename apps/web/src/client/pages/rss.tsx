import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Activity, Clock3, Pencil, Plus, RefreshCw, ServerCog, Trash2 } from "lucide-react";
import { api, type Feed } from "../api.js";
import type { ActionResult, RunAction } from "../types.js";
import { CheckboxField, FieldLabel, FormInput, UiButton } from "../components/ui/index.js";
import { Empty, StatusPill } from "../components/common/feedback.js";
import { DistributionBars } from "../components/common/charts.js";
import { Modal, Panel } from "../components/common/surfaces.js";
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

  return (
    <div className="page-stack">
      <section className="overview-insight-grid">
        <Panel title={t("rss.feedVolume")} icon={<Activity size={19} />}>
          <DistributionBars
            entries={feeds.map((feed) => ({
              label: feed.name,
              value: feed.itemCount,
              detail: feed.enabled ? t("rss.enabled") : t("rss.disabled"),
              tone: feed.lastError ? "danger" : feed.enabled ? "good" : "neutral"
            }))}
            emptyLabel={t("rss.addFeedsVolume")}
          />
        </Panel>
        <Panel title={t("rss.pollingCadence")} icon={<Clock3 size={19} />}>
          <DistributionBars
            entries={feeds.map((feed) => ({
              label: feed.name,
              value: Math.round(feed.pollIntervalSeconds / 60),
              detail: feed.lastPolledAt ? t("rss.lastPolled", { time: relativeTime(feed.lastPolledAt) }) : t("rss.notPolled"),
              tone: feed.lastError ? "danger" : "accent"
            }))}
            suffix="m"
            emptyLabel={t("rss.pollingEmpty")}
          />
        </Panel>
      </section>
      <Panel
        title={t("rss.feedSources")}
        icon={<ServerCog size={19} />}
        actions={
          <UiButton className="primary" disabled={busy} onClick={() => setFeedModal("new")}>
            <Plus size={17} />
            {t("rss.addFeed")}
          </UiButton>
        }
      >
        <div className="list">
          {feeds.length === 0 && <Empty label={t("rss.noFeeds")} />}
          {feeds.map((feed) => (
            <article className="row-card feed-card" key={feed.id}>
              <div>
                <strong>{feed.name}</strong>
                <code>{feed.urlPreview ?? t("rss.removedUrl")}</code>
                <span>{t("rss.itemPoll", { count: feed.itemCount, seconds: feed.pollIntervalSeconds })}</span>
                {feed.lastError && <p className="error">{feed.lastError}</p>}
              </div>
              <div className="row-actions">
                <StatusPill ok={feed.enabled}>{feed.enabled ? t("common.enabled") : t("common.disabled")}</StatusPill>
                <UiButton className="secondary" disabled={busy} onClick={() => setFeedModal(feed)}>
                  <Pencil size={16} />
                  Edit
                </UiButton>
                <UiButton
                  className="icon-button"
                  disabled={busy}
                  onClick={() => runAction(() => api(`/api/feeds/${feed.id}/refresh`, { method: "POST" }))}
                  title={t("rss.refreshFeed")}
                >
                  <RefreshCw size={17} />
                </UiButton>
                <UiButton
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
        </div>
      </Panel>
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
