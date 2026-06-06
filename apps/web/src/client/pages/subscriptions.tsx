import { useState, type FormEvent } from "react";
import { Film, ListFilter, Pencil, Plus, Search } from "lucide-react";
import { api, type Downloader, type MediaSearchResult, type Subscription } from "../api.js";
import type { ActionResult, RunAction } from "../types.js";
import { CheckboxField, FieldLabel, FormInput, SelectField, UiButton } from "../components/ui/index.js";
import { Empty, Pill, StatusPill } from "../components/common/feedback.js";
import { Modal, Panel } from "../components/common/surfaces.js";
import { numberOrUndefined, optionalText, providerValue, ruleSummary, stringListFromInput } from "../lib/forms.js";
import { tmdbImage } from "../lib/format.js";

export function SubscriptionsPage({
  busy,
  downloaders,
  subscriptions,
  runAction
}: {
  busy: boolean;
  downloaders: Downloader[];
  subscriptions: Subscription[];
  runAction: RunAction;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null);

  return (
    <div className="page-stack">
      <Panel
        title="Subscription Rules"
        icon={<ListFilter size={19} />}
        actions={
          <UiButton className="primary" disabled={busy} onClick={() => setCreateOpen(true)}>
            <Plus size={17} />
            Create Subscription
          </UiButton>
        }
      >
        <div className="list">
          {subscriptions.length === 0 && <Empty label="No subscription rules yet" />}
          {subscriptions.map((subscription) => (
            <article className="row-card subscription-card" key={subscription.id}>
              <div>
                <strong>{subscription.title}</strong>
                <span>{subscription.media?.title ?? subscription.rule?.providerId ?? "Rule-only subscription"}</span>
                <small>{ruleSummary(subscription)}</small>
              </div>
              <div className="row-actions">
                <StatusPill ok={subscription.enabled}>{subscription.enabled ? "Enabled" : "Disabled"}</StatusPill>
                <StatusPill ok={subscription.autoDownload}>{subscription.autoDownload ? "Auto" : "Manual"}</StatusPill>
                {subscription.downloader ? <Pill>{subscription.downloader.name}</Pill> : <Pill>Default downloader</Pill>}
                <UiButton className="secondary" disabled={busy} onClick={() => setEditingSubscription(subscription)}>
                  <Pencil size={16} />
                  Edit
                </UiButton>
              </div>
            </article>
          ))}
        </div>
      </Panel>
      {createOpen && (
        <Modal title="Create Subscription" onClose={() => setCreateOpen(false)}>
          <SubscriptionSearch
            downloaders={downloaders}
            onSubscribe={async (body) => {
              const result = await runAction(async () => {
                await api("/api/subscriptions", { method: "POST", body });
              });
              if (result.ok) setCreateOpen(false);
              return result;
            }}
          />
        </Modal>
      )}
      {editingSubscription && (
        <Modal title="Edit Subscription" onClose={() => setEditingSubscription(null)}>
          <SubscriptionEditForm
            busy={busy}
            downloaders={downloaders}
            subscription={editingSubscription}
            onCancel={() => setEditingSubscription(null)}
            onSubmit={async (patchBody, ruleBody) => {
              const result = await runAction(async () => {
                await api(`/api/subscriptions/${editingSubscription.id}`, {
                  method: "PATCH",
                  body: patchBody
                });
                await api(`/api/subscriptions/${editingSubscription.id}/rule`, {
                  method: "PUT",
                  body: ruleBody
                });
              });
              if (result.ok) setEditingSubscription(null);
              return result;
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function SubscriptionEditForm({
  busy,
  downloaders,
  subscription,
  onCancel,
  onSubmit
}: {
  busy: boolean;
  downloaders: Downloader[];
  subscription: Subscription;
  onCancel: () => void;
  onSubmit: (patchBody: string, ruleBody: string) => Promise<ActionResult>;
}) {
  const rule = subscription.rule;
  const [title, setTitle] = useState(subscription.title);
  const [downloaderId, setDownloaderId] = useState(subscription.downloader?.id ?? "");
  const [autoDownload, setAutoDownload] = useState(subscription.autoDownload);
  const [enabled, setEnabled] = useState(subscription.enabled);
  const [mediaKind, setMediaKind] = useState<"" | "MOVIE" | "TV" | "UNKNOWN">(
    rule?.mediaKind ?? subscription.media?.kind ?? ""
  );
  const [provider, setProvider] = useState<"" | "tmdb" | "imdb" | "douban">(
    providerValue(rule?.provider ?? subscription.media?.provider)
  );
  const [providerId, setProviderId] = useState(rule?.providerId ?? subscription.media?.providerId ?? "");
  const [imdbId, setImdbId] = useState(rule?.imdbId ?? "");
  const [doubanId, setDoubanId] = useState(rule?.doubanId ?? "");
  const [titleRegex, setTitleRegex] = useState(rule?.titleRegex ?? "");
  const [includeRegex, setIncludeRegex] = useState(rule?.includeRegex ?? "");
  const [excludeRegex, setExcludeRegex] = useState(rule?.excludeRegex ?? "");
  const [minResolution, setMinResolution] = useState(rule?.minResolution?.toString() ?? "");
  const [maxResolution, setMaxResolution] = useState(rule?.maxResolution?.toString() ?? "");
  const [sources, setSources] = useState((rule?.sources ?? []).join(", "));
  const [codecs, setCodecs] = useState((rule?.codecs ?? []).join(", "));
  const [audio, setAudio] = useState((rule?.audio ?? []).join(", "));
  const [releaseGroupsInclude, setReleaseGroupsInclude] = useState((rule?.releaseGroupsInclude ?? []).join(", "));
  const [releaseGroupsExclude, setReleaseGroupsExclude] = useState((rule?.releaseGroupsExclude ?? []).join(", "));
  const [minSizeBytes, setMinSizeBytes] = useState(rule?.minSizeBytes ?? "");
  const [maxSizeBytes, setMaxSizeBytes] = useState(rule?.maxSizeBytes ?? "");
  const [season, setSeason] = useState(rule?.season?.toString() ?? "");
  const [episodeStart, setEpisodeStart] = useState(rule?.episodeStart?.toString() ?? "");
  const [episodeEnd, setEpisodeEnd] = useState(rule?.episodeEnd?.toString() ?? "");
  const [submitError, setSubmitError] = useState("");

  return (
    <form
      className="modal-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setSubmitError("");
        const result = await onSubmit(
          JSON.stringify({
            title: title.trim(),
            downloaderId: downloaderId || null,
            autoDownload,
            enabled
          }),
          JSON.stringify({
            mediaKind: mediaKind || undefined,
            provider: provider || undefined,
            providerId: optionalText(providerId),
            imdbId: optionalText(imdbId),
            doubanId: optionalText(doubanId),
            titleRegex: optionalText(titleRegex),
            includeRegex: optionalText(includeRegex),
            excludeRegex: optionalText(excludeRegex),
            minResolution: numberOrUndefined(minResolution),
            maxResolution: numberOrUndefined(maxResolution),
            sources: stringListFromInput(sources),
            codecs: stringListFromInput(codecs),
            audio: stringListFromInput(audio),
            releaseGroupsInclude: stringListFromInput(releaseGroupsInclude),
            releaseGroupsExclude: stringListFromInput(releaseGroupsExclude),
            minSizeBytes: optionalText(minSizeBytes),
            maxSizeBytes: optionalText(maxSizeBytes),
            season: numberOrUndefined(season),
            episodeStart: numberOrUndefined(episodeStart),
            episodeEnd: numberOrUndefined(episodeEnd)
          })
        );
        if (!result.ok) setSubmitError(result.message);
      }}
    >
      <FieldLabel>
        Subscription title
        <FormInput value={title} onChange={(event) => setTitle(event.target.value)} required />
      </FieldLabel>
      <div className="form-grid">
        <div className="field">
          <span>Downloader</span>
          <SelectField
            value={downloaderId}
            onValueChange={setDownloaderId}
            options={[
              { value: "", label: "Default downloader" },
              ...downloaders.map((downloader) => ({ value: downloader.id, label: downloader.name }))
            ]}
          />
        </div>
        <div className="field">
          <span>Media kind</span>
          <SelectField
            value={mediaKind}
            onValueChange={(value) => setMediaKind(value as typeof mediaKind)}
            options={[
              { value: "", label: "Any kind" },
              { value: "MOVIE", label: "Movie" },
              { value: "TV", label: "Series" },
              { value: "UNKNOWN", label: "Unknown" }
            ]}
          />
        </div>
      </div>
      <div className="form-grid">
        <div className="field">
          <span>Provider</span>
          <SelectField
            value={provider}
            onValueChange={(value) => setProvider(value as typeof provider)}
            options={[
              { value: "", label: "Any provider" },
              { value: "tmdb", label: "TMDB" },
              { value: "imdb", label: "IMDb" },
              { value: "douban", label: "Douban" }
            ]}
          />
        </div>
        <FieldLabel>
          Provider ID
          <FormInput value={providerId} onChange={(event) => setProviderId(event.target.value)} />
        </FieldLabel>
      </div>
      <div className="form-grid">
        <FieldLabel>
          IMDb ID
          <FormInput placeholder="tt1234567" value={imdbId} onChange={(event) => setImdbId(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          Douban ID
          <FormInput value={doubanId} onChange={(event) => setDoubanId(event.target.value)} />
        </FieldLabel>
      </div>
      <div className="form-grid">
        <FieldLabel>
          Title regex
          <FormInput value={titleRegex} onChange={(event) => setTitleRegex(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          Include regex
          <FormInput value={includeRegex} onChange={(event) => setIncludeRegex(event.target.value)} />
        </FieldLabel>
      </div>
      <FieldLabel>
        Exclude regex
        <FormInput value={excludeRegex} onChange={(event) => setExcludeRegex(event.target.value)} />
      </FieldLabel>
      <div className="form-grid">
        <FieldLabel>
          Min resolution
          <FormInput min={1} type="number" value={minResolution} onChange={(event) => setMinResolution(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          Max resolution
          <FormInput min={1} type="number" value={maxResolution} onChange={(event) => setMaxResolution(event.target.value)} />
        </FieldLabel>
      </div>
      <div className="form-grid">
        <FieldLabel>
          Sources
          <FormInput placeholder="WEB-DL, BluRay" value={sources} onChange={(event) => setSources(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          Codecs
          <FormInput placeholder="x264, x265" value={codecs} onChange={(event) => setCodecs(event.target.value)} />
        </FieldLabel>
      </div>
      <FieldLabel>
        Audio
        <FormInput placeholder="Atmos, TrueHD" value={audio} onChange={(event) => setAudio(event.target.value)} />
      </FieldLabel>
      <div className="form-grid">
        <FieldLabel>
          Include release groups
          <FormInput value={releaseGroupsInclude} onChange={(event) => setReleaseGroupsInclude(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          Exclude release groups
          <FormInput value={releaseGroupsExclude} onChange={(event) => setReleaseGroupsExclude(event.target.value)} />
        </FieldLabel>
      </div>
      <div className="form-grid">
        <FieldLabel>
          Min size bytes
          <FormInput min={1} type="number" value={minSizeBytes} onChange={(event) => setMinSizeBytes(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          Max size bytes
          <FormInput min={1} type="number" value={maxSizeBytes} onChange={(event) => setMaxSizeBytes(event.target.value)} />
        </FieldLabel>
      </div>
      <div className="form-grid three">
        <FieldLabel>
          Season
          <FormInput min={1} type="number" value={season} onChange={(event) => setSeason(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          Episode start
          <FormInput min={1} type="number" value={episodeStart} onChange={(event) => setEpisodeStart(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          Episode end
          <FormInput min={1} type="number" value={episodeEnd} onChange={(event) => setEpisodeEnd(event.target.value)} />
        </FieldLabel>
      </div>
      <div className="form-grid">
        <CheckboxField className="checkbox-row" checked={autoDownload} onCheckedChange={setAutoDownload} label="Auto download" />
        <CheckboxField className="checkbox-row" checked={enabled} onCheckedChange={setEnabled} label="Enabled" />
      </div>
      {submitError && <p className="modal-feedback error">{submitError}</p>}
      <div className="modal-actions">
        <UiButton className="secondary" onClick={onCancel} type="button">
          Cancel
        </UiButton>
        <UiButton className="primary" disabled={busy} type="submit">
          <Pencil size={17} />
          Save Subscription
        </UiButton>
      </div>
    </form>
  );
}

function SubscriptionSearch({
  downloaders,
  onSubscribe
}: {
  downloaders: Downloader[];
  onSubscribe: (body: string) => void | ActionResult | Promise<void | ActionResult>;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"MOVIE" | "TV">("MOVIE");
  const [results, setResults] = useState<MediaSearchResult[]>([]);
  const [downloaderId, setDownloaderId] = useState("");
  const [includeRegex, setIncludeRegex] = useState("");
  const [minResolution, setMinResolution] = useState(1080);
  const [subscribeError, setSubscribeError] = useState("");

  async function search(event: FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams({ q: query, kind });
    setResults(await api<MediaSearchResult[]>(`/api/media/search?${params}`));
  }

  return (
    <div className="subscription-tool">
      <form className="search-form" onSubmit={search}>
        <SelectField
          value={kind}
          onValueChange={(value) => setKind(value as "MOVIE" | "TV")}
          options={[
            { value: "MOVIE", label: "Movie" },
            { value: "TV", label: "Series" }
          ]}
        />
        <FormInput placeholder="Search TMDB" value={query} onChange={(event) => setQuery(event.target.value)} required />
        <FormInput placeholder="Include regex" value={includeRegex} onChange={(event) => setIncludeRegex(event.target.value)} />
        <SelectField
          value={String(minResolution)}
          onValueChange={(value) => setMinResolution(Number(value))}
          options={[
            { value: "720", label: "720p+" },
            { value: "1080", label: "1080p+" },
            { value: "2160", label: "2160p+" }
          ]}
        />
        <SelectField
          value={downloaderId}
          onValueChange={setDownloaderId}
          options={[
            { value: "", label: "Default downloader" },
            ...downloaders.map((downloader) => ({ value: downloader.id, label: downloader.name }))
          ]}
        />
        <UiButton className="primary" type="submit"><Search size={17} />Search</UiButton>
      </form>
      <div className="result-grid">
        {results.map((result) => (
          <article className="result" key={result.providerId}>
            {result.posterPath ? (
              <img src={tmdbImage(result.posterPath, "w185")} alt={result.title} />
            ) : (
              <div className="poster-placeholder"><Film size={24} /></div>
            )}
            <strong>{result.title}</strong>
            <span>{result.year ?? "Unknown"} · {Math.round(result.score * 100)}%</span>
            <UiButton
              className="secondary"
              onClick={async () => {
                setSubscribeError("");
                const subscribeResult = await onSubscribe(
                  JSON.stringify({
                    downloaderId: downloaderId || undefined,
                    title: result.title,
                    autoDownload: true,
                    enabled: true,
                    rule: {
                      mediaKind: result.kind,
                      provider: result.provider,
                      providerId: result.providerId,
                      includeRegex: includeRegex || undefined,
                      minResolution
                    }
                  })
                );
                if (subscribeResult && !subscribeResult.ok) setSubscribeError(subscribeResult.message);
              }}
            >
              Subscribe
            </UiButton>
          </article>
        ))}
      </div>
      {subscribeError && <p className="modal-feedback error">{subscribeError}</p>}
    </div>
  );
}
