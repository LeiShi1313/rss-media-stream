import { Activity, Clock3, Pencil, Plus, RefreshCw, ServerCog } from "lucide-react";
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
  const [feedModal, setFeedModal] = useState<Feed | "new" | null>(null);

  return (
    <div className="page-stack">
      <section className="overview-insight-grid">
        <Panel title="Feed volume" icon={<Activity size={19} />}>
          <DistributionBars
            entries={feeds.map((feed) => ({
              label: feed.name,
              value: feed.itemCount,
              detail: feed.enabled ? "enabled" : "disabled",
              tone: feed.lastError ? "danger" : feed.enabled ? "good" : "neutral"
            }))}
            emptyLabel="Add feeds to see item volume"
          />
        </Panel>
        <Panel title="Polling cadence" icon={<Clock3 size={19} />}>
          <DistributionBars
            entries={feeds.map((feed) => ({
              label: feed.name,
              value: Math.round(feed.pollIntervalSeconds / 60),
              detail: feed.lastPolledAt ? `last polled ${relativeTime(feed.lastPolledAt)}` : "not polled yet",
              tone: feed.lastError ? "danger" : "accent"
            }))}
            suffix="m"
            emptyLabel="Polling cadence appears after feeds are configured"
          />
        </Panel>
      </section>
      <Panel
        title="Feed Sources"
        icon={<ServerCog size={19} />}
        actions={
          <UiButton className="primary" disabled={busy} onClick={() => setFeedModal("new")}>
            <Plus size={17} />
            Add Feed
          </UiButton>
        }
      >
        <div className="list">
          {feeds.length === 0 && <Empty label="No RSS feeds configured" />}
          {feeds.map((feed) => (
            <article className="row-card feed-card" key={feed.id}>
              <div>
                <strong>{feed.name}</strong>
                <code>{feed.urlPreview}</code>
                <span>{feed.itemCount} items · poll every {feed.pollIntervalSeconds}s</span>
                {feed.lastError && <p className="error">{feed.lastError}</p>}
              </div>
              <div className="row-actions">
                <StatusPill ok={feed.enabled}>{feed.enabled ? "Enabled" : "Disabled"}</StatusPill>
                <UiButton className="secondary" disabled={busy} onClick={() => setFeedModal(feed)}>
                  <Pencil size={16} />
                  Edit
                </UiButton>
                <UiButton
                  className="icon-button"
                  disabled={busy}
                  onClick={() => runAction(() => api(`/api/feeds/${feed.id}/refresh`, { method: "POST" }))}
                  title="Refresh feed"
                >
                  <RefreshCw size={17} />
                </UiButton>
              </div>
            </article>
          ))}
        </div>
      </Panel>
      {feedModal && (
        <Modal
          title={feedModal === "new" ? "Add RSS Feed" : "Edit RSS Feed"}
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
        Feed name
        <FormInput value={name} onChange={(event) => setName(event.target.value)} required />
      </FieldLabel>
      <FieldLabel>
        Private RSS URL
        <FormInput
          placeholder={editing ? "Leave blank to keep current URL" : "https://tracker.example/rss"}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          required={!editing}
        />
      </FieldLabel>
      <div className="form-grid">
        <FieldLabel>
          Poll interval
          <FormInput
            type="number"
            min={60}
            value={pollIntervalSeconds}
            onChange={(event) => setPollIntervalSeconds(event.target.value)}
            required
          />
        </FieldLabel>
        <CheckboxField className="checkbox-row" checked={enabled} onCheckedChange={setEnabled} label="Enabled" />
      </div>
      {submitError && <p className="modal-feedback error">{submitError}</p>}
      <div className="modal-actions">
        <UiButton className="secondary" onClick={onCancel} type="button">
          Cancel
        </UiButton>
        <UiButton className="primary" disabled={busy} type="submit">
          {editing ? <Pencil size={17} /> : <Plus size={17} />}
          {editing ? "Save Feed" : "Add Feed"}
        </UiButton>
      </div>
    </form>
  );
}

