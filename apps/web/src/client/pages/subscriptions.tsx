import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Film, ListFilter, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { api, type Downloader, type MediaSearchResult, type ProviderIdentityFilter, type ProviderRatingFilter, type Subscription } from "../api.js";
import type { ActionResult, RunAction } from "../types.js";
import { CheckboxField, FieldLabel, FormInput, SelectField, UiButton } from "../components/ui/index.js";
import { Empty, Pill, StatusPill } from "../components/common/feedback.js";
import { Modal, Panel } from "../components/common/surfaces.js";
import { numberOrUndefined, optionalText, providerValue, ruleSummary, stringListFromInput } from "../lib/forms.js";

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
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null);

  return (
    <div className="page-stack">
      <Panel
        title={t("subscriptions.rules")}
        icon={<ListFilter size={19} />}
        actions={
          <UiButton className="primary" disabled={busy} onClick={() => setCreateOpen(true)}>
            <Plus size={17} />
            {t("subscriptions.create")}
          </UiButton>
        }
      >
        <div className="list">
          {subscriptions.length === 0 && <Empty label={t("subscriptions.none")} />}
          {subscriptions.map((subscription) => (
            <article className="row-card subscription-card" key={subscription.id}>
              <div>
                <strong>{subscription.title}</strong>
                <span>{subscription.media?.title ?? subscription.rule?.selectedProvider?.providerId ?? t("subscriptions.ruleOnly")}</span>
                <small>{ruleSummary(subscription, t)}</small>
              </div>
              <div className="row-actions">
                <StatusPill ok={subscription.enabled}>{subscription.enabled ? t("common.enabled") : t("common.disabled")}</StatusPill>
                <StatusPill ok={subscription.autoDownload}>{subscription.autoDownload ? t("common.auto") : t("common.manual")}</StatusPill>
                {subscription.downloader ? <Pill>{subscription.downloader.name}</Pill> : <Pill>{t("common.defaultDownloader")}</Pill>}
                <UiButton className="secondary" disabled={busy} onClick={() => setEditingSubscription(subscription)}>
                  <Pencil size={16} />
                  {t("common.edit")}
                </UiButton>
              </div>
            </article>
          ))}
        </div>
      </Panel>
      {createOpen && (
        <Modal title={t("subscriptions.create")} onClose={() => setCreateOpen(false)}>
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
        <Modal title={t("subscriptions.edit")} onClose={() => setEditingSubscription(null)}>
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

type LinkedProviderRow = {
  id: string;
  provider: string;
  providerEntityType: string;
  providerId: string;
};

type ProviderRatingRow = {
  id: string;
  provider: string;
  ratingType: string;
  comparison: ProviderRatingFilter["comparison"];
  value: string;
  scale: string;
  minVoteCount: string;
};

let filterRowId = 0;

function nextFilterRowId(prefix: string) {
  filterRowId += 1;
  return `${prefix}-${filterRowId}`;
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
  const { t } = useTranslation();
  const rule = subscription.rule;
  const [title, setTitle] = useState(subscription.title);
  const [downloaderId, setDownloaderId] = useState(subscription.downloader?.id ?? "");
  const [autoDownload, setAutoDownload] = useState(subscription.autoDownload);
  const [enabled, setEnabled] = useState(subscription.enabled);
  const [mediaType, setMediaType] = useState<"" | "MOVIE" | "TV_SERIES" | "UNKNOWN">(
    rule?.mediaType ?? mediaTypeFromKind(subscription.media?.kind) ?? ""
  );
  const selectedProviderRule = rule?.selectedProvider;
  const [selectedProvider, setSelectedProvider] = useState<string>(
    providerValue(selectedProviderRule?.provider ?? subscription.media?.provider)
  );
  const [selectedProviderEntityType, setSelectedProviderEntityType] = useState(
    selectedProviderRule?.providerEntityType ?? subscription.media?.providerEntityType ?? ""
  );
  const [selectedProviderId, setSelectedProviderId] = useState(
    selectedProviderRule?.providerId ?? subscription.media?.providerId ?? ""
  );
  const [linkedProviders, setLinkedProviders] = useState<LinkedProviderRow[]>(() =>
    (rule?.linkedProviders ?? []).map((filter, index) => linkedProviderRowFromFilter(filter, index))
  );
  const [providerRatings, setProviderRatings] = useState<ProviderRatingRow[]>(() =>
    (rule?.providerRatings ?? []).map((filter, index) => providerRatingRowFromFilter(filter, index))
  );
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
  const providerOptionList = providerOptions(t);
  const addLinkedProvider = () => {
    setLinkedProviders((current) => [
      ...current,
      {
        id: nextFilterRowId("linked"),
        provider: "",
        providerEntityType: "",
        providerId: ""
      }
    ]);
  };
  const updateLinkedProvider = (id: string, patch: Partial<LinkedProviderRow>) => {
    setLinkedProviders((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  };
  const removeLinkedProvider = (id: string) => {
    setLinkedProviders((current) => current.filter((row) => row.id !== id));
  };
  const addProviderRating = () => {
    setProviderRatings((current) => [
      ...current,
      {
        id: nextFilterRowId("rating"),
        provider: "",
        ratingType: "",
        comparison: "gte",
        value: "",
        scale: "",
        minVoteCount: ""
      }
    ]);
  };
  const updateProviderRating = (id: string, patch: Partial<ProviderRatingRow>) => {
    setProviderRatings((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  };
  const removeProviderRating = (id: string) => {
    setProviderRatings((current) => current.filter((row) => row.id !== id));
  };

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
            mediaType: mediaType || undefined,
            selectedProvider: providerIdentityFromFields(
              selectedProvider,
              selectedProviderEntityType || providerEntityTypeFor(selectedProvider, mediaType),
              selectedProviderId
            ),
            linkedProviders: linkedProviders
              .map((filter) => providerIdentityFromFields(filter.provider, filter.providerEntityType, filter.providerId))
              .filter(isDefined),
            providerRatings: providerRatings
              .map((filter) => providerRatingFromFields(filter))
              .filter(isDefined),
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
        {t("subscriptions.subscriptionTitle")}
        <FormInput value={title} onChange={(event) => setTitle(event.target.value)} required />
      </FieldLabel>
      <div className="form-grid">
        <div className="field">
          <span>{t("common.downloader")}</span>
          <SelectField
            value={downloaderId}
            onValueChange={setDownloaderId}
            options={[
              { value: "", label: t("common.defaultDownloader") },
              ...downloaders.map((downloader) => ({ value: downloader.id, label: downloader.name }))
            ]}
          />
        </div>
        <div className="field">
          <span>{t("subscriptions.mediaKind")}</span>
          <SelectField
            value={mediaType}
            onValueChange={(value) => {
              const nextType = value as typeof mediaType;
              setMediaType(nextType);
              if (nextType !== "TV_SERIES" && selectedProvider === "tvdb") {
                setSelectedProvider("");
                setSelectedProviderId("");
                setSelectedProviderEntityType("");
              }
            }}
            options={[
              { value: "", label: t("common.anyKind") },
              { value: "MOVIE", label: t("common.movie") },
              { value: "TV_SERIES", label: t("common.series") },
              { value: "UNKNOWN", label: t("common.unknown") }
            ]}
          />
        </div>
      </div>
      <div className="form-grid three">
        <div className="field">
          <span>{t("subscriptions.selectedProvider")}</span>
          <SelectField
            value={selectedProvider}
            onValueChange={setSelectedProvider}
            options={providerOptionList}
          />
        </div>
        <FieldLabel>
          {t("subscriptions.providerEntityType")}
          <FormInput value={selectedProviderEntityType} onChange={(event) => setSelectedProviderEntityType(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          {t("common.providerId")}
          <FormInput value={selectedProviderId} onChange={(event) => setSelectedProviderId(event.target.value)} />
        </FieldLabel>
      </div>
      <div className="subscription-filter-section">
        <div className="subscription-filter-heading">
          <span>{t("subscriptions.linkedProvider")}</span>
          <UiButton className="secondary" onClick={addLinkedProvider} type="button">
            <Plus size={15} />
            {t("common.add")}
          </UiButton>
        </div>
        {linkedProviders.map((filter) => (
          <div className="subscription-filter-row linked" key={filter.id}>
            <div className="field">
              <span>{t("subscriptions.linkedProvider")}</span>
              <SelectField
                value={filter.provider}
                onValueChange={(provider) => updateLinkedProvider(filter.id, { provider })}
                options={providerOptionsWithCurrent(filter.provider, providerOptionList)}
              />
            </div>
            <FieldLabel>
              {t("subscriptions.providerEntityType")}
              <FormInput
                value={filter.providerEntityType}
                onChange={(event) => updateLinkedProvider(filter.id, { providerEntityType: event.target.value })}
              />
            </FieldLabel>
            <FieldLabel>
              {t("common.providerId")}
              <FormInput value={filter.providerId} onChange={(event) => updateLinkedProvider(filter.id, { providerId: event.target.value })} />
            </FieldLabel>
            <UiButton
              className="icon-button"
              onClick={() => removeLinkedProvider(filter.id)}
              title={t("subscriptions.removeLinkedProvider")}
              type="button"
            >
              <Trash2 size={15} />
            </UiButton>
          </div>
        ))}
      </div>
      <div className="subscription-filter-section">
        <div className="subscription-filter-heading">
          <span>{t("subscriptions.ratingProvider")}</span>
          <UiButton className="secondary" onClick={addProviderRating} type="button">
            <Plus size={15} />
            {t("common.add")}
          </UiButton>
        </div>
        {providerRatings.map((filter) => (
          <div className="subscription-filter-row rating" key={filter.id}>
            <div className="form-grid three">
              <div className="field">
                <span>{t("subscriptions.ratingProvider")}</span>
                <SelectField
                  value={filter.provider}
                  onValueChange={(provider) => updateProviderRating(filter.id, { provider })}
                  options={providerOptionsWithCurrent(filter.provider, providerOptionList)}
                />
              </div>
              <div className="field">
                <span>{t("subscriptions.ratingType")}</span>
                <SelectField
                  value={filter.ratingType}
                  onValueChange={(ratingType) => updateProviderRating(filter.id, { ratingType })}
                  options={ratingTypeOptions(t)}
                />
              </div>
              <div className="field">
                <span>{t("subscriptions.comparison")}</span>
                <SelectField
                  value={filter.comparison}
                  onValueChange={(comparison) => updateProviderRating(filter.id, { comparison: comparison as ProviderRatingRow["comparison"] })}
                  options={ratingComparisonOptions}
                />
              </div>
            </div>
            <div className="form-grid three rating-values">
              <FieldLabel>
                {t("subscriptions.ratingValue")}
                <FormInput
                  min={0}
                  step="0.1"
                  type="number"
                  value={filter.value}
                  onChange={(event) => updateProviderRating(filter.id, { value: event.target.value })}
                />
              </FieldLabel>
              <FieldLabel>
                {t("subscriptions.ratingScale")}
                <FormInput
                  min={0.1}
                  step="0.1"
                  type="number"
                  value={filter.scale}
                  onChange={(event) => updateProviderRating(filter.id, { scale: event.target.value })}
                />
              </FieldLabel>
              <FieldLabel>
                {t("subscriptions.minVotes")}
                <FormInput
                  min={0}
                  step="1"
                  type="number"
                  value={filter.minVoteCount}
                  onChange={(event) => updateProviderRating(filter.id, { minVoteCount: event.target.value })}
                />
              </FieldLabel>
            </div>
            <UiButton
              className="icon-button"
              onClick={() => removeProviderRating(filter.id)}
              title={t("subscriptions.removeRatingFilter")}
              type="button"
            >
              <Trash2 size={15} />
            </UiButton>
          </div>
        ))}
      </div>
      <div className="form-grid">
        <FieldLabel>
          {t("subscriptions.titleRegex")}
          <FormInput value={titleRegex} onChange={(event) => setTitleRegex(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          {t("common.includeRegex")}
          <FormInput value={includeRegex} onChange={(event) => setIncludeRegex(event.target.value)} />
        </FieldLabel>
      </div>
      <FieldLabel>
        {t("subscriptions.excludeRegex")}
        <FormInput value={excludeRegex} onChange={(event) => setExcludeRegex(event.target.value)} />
      </FieldLabel>
      <div className="form-grid">
        <FieldLabel>
          {t("subscriptions.minResolution")}
          <FormInput min={1} type="number" value={minResolution} onChange={(event) => setMinResolution(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          {t("subscriptions.maxResolution")}
          <FormInput min={1} type="number" value={maxResolution} onChange={(event) => setMaxResolution(event.target.value)} />
        </FieldLabel>
      </div>
      <div className="form-grid">
        <FieldLabel>
          {t("subscriptions.sources")}
          <FormInput placeholder="WEB-DL, BluRay" value={sources} onChange={(event) => setSources(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          {t("common.codecs")}
          <FormInput placeholder="x264, x265" value={codecs} onChange={(event) => setCodecs(event.target.value)} />
        </FieldLabel>
      </div>
      <FieldLabel>
        {t("common.audio")}
        <FormInput placeholder="Atmos, TrueHD" value={audio} onChange={(event) => setAudio(event.target.value)} />
      </FieldLabel>
      <div className="form-grid">
        <FieldLabel>
          {t("subscriptions.includeReleaseGroups")}
          <FormInput value={releaseGroupsInclude} onChange={(event) => setReleaseGroupsInclude(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          {t("subscriptions.excludeReleaseGroups")}
          <FormInput value={releaseGroupsExclude} onChange={(event) => setReleaseGroupsExclude(event.target.value)} />
        </FieldLabel>
      </div>
      <div className="form-grid">
        <FieldLabel>
          {t("subscriptions.minSizeBytes")}
          <FormInput min={1} type="number" value={minSizeBytes} onChange={(event) => setMinSizeBytes(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          {t("subscriptions.maxSizeBytes")}
          <FormInput min={1} type="number" value={maxSizeBytes} onChange={(event) => setMaxSizeBytes(event.target.value)} />
        </FieldLabel>
      </div>
      <div className="form-grid three">
        <FieldLabel>
          {t("subscriptions.season")}
          <FormInput min={1} type="number" value={season} onChange={(event) => setSeason(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          {t("subscriptions.episodeStart")}
          <FormInput min={1} type="number" value={episodeStart} onChange={(event) => setEpisodeStart(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          {t("subscriptions.episodeEnd")}
          <FormInput min={1} type="number" value={episodeEnd} onChange={(event) => setEpisodeEnd(event.target.value)} />
        </FieldLabel>
      </div>
      <div className="form-grid">
        <CheckboxField className="checkbox-row" checked={autoDownload} onCheckedChange={setAutoDownload} label={t("common.autoDownload")} />
        <CheckboxField className="checkbox-row" checked={enabled} onCheckedChange={setEnabled} label={t("common.enabled")} />
      </div>
      {submitError && <p className="modal-feedback error">{submitError}</p>}
      <div className="modal-actions">
        <UiButton className="secondary" onClick={onCancel} type="button">
          {t("common.cancel")}
        </UiButton>
        <UiButton className="primary" disabled={busy} type="submit">
          <Pencil size={17} />
          {t("subscriptions.saveSubscription")}
        </UiButton>
      </div>
    </form>
  );
}

function providerEntityTypeFor(provider: string, mediaType: string) {
  if (provider === "tmdb" && mediaType === "MOVIE") return "tmdb_movie";
  if (provider === "tmdb" && mediaType === "TV_SERIES") return "tmdb_tv";
  if (provider === "tvdb" && mediaType === "MOVIE") return "tvdb_movie";
  if (provider === "tvdb" && mediaType === "TV_SERIES") return "tvdb_series";
  if (provider === "ptgen") return undefined;
  return undefined;
}

function mediaTypeFromKind(kind?: string) {
  if (kind === "TV") return "TV_SERIES";
  if (kind === "MOVIE" || kind === "UNKNOWN") return kind;
  return undefined;
}

function providerOptions(t: (key: string) => string) {
  return [
    { value: "", label: t("common.anyProvider") },
    { value: "tmdb", label: "TMDB" },
    { value: "tvdb", label: "TVDB" },
    { value: "ptgen", label: "PtGen" },
    { value: "imdb", label: "IMDb" },
    { value: "douban", label: "Douban" },
    { value: "wikidata", label: "Wikidata" },
    { value: "trakt", label: "Trakt" },
    { value: "musicbrainz", label: "MusicBrainz" }
  ];
}

function providerOptionsWithCurrent(currentProvider: string, options: ReturnType<typeof providerOptions>) {
  const normalizedProvider = optionalText(currentProvider);
  if (!normalizedProvider || options.some((option) => option.value === normalizedProvider)) return options;
  return [
    ...options,
    { value: normalizedProvider, label: normalizedProvider }
  ];
}

function ratingTypeOptions(t: (key: string) => string) {
  return [
    { value: "", label: t("common.anyType") },
    { value: "user_score", label: t("subscriptions.userScore") },
    { value: "critic_score", label: t("subscriptions.criticScore") },
    { value: "popularity", label: t("subscriptions.popularity") }
  ];
}

const ratingComparisonOptions = [
  { value: "gte", label: ">=" },
  { value: "lte", label: "<=" },
  { value: "gt", label: ">" },
  { value: "lt", label: "<" },
  { value: "eq", label: "=" }
];

function linkedProviderRowFromFilter(filter: ProviderIdentityFilter, index: number): LinkedProviderRow {
  return {
    id: `linked-existing-${index}`,
    provider: filter.provider,
    providerEntityType: filter.providerEntityType ?? "",
    providerId: filter.providerId
  };
}

function providerRatingRowFromFilter(filter: ProviderRatingFilter, index: number): ProviderRatingRow {
  return {
    id: `rating-existing-${index}`,
    provider: filter.provider,
    ratingType: filter.ratingType ?? "",
    comparison: filter.comparison,
    value: filter.value.toString(),
    scale: filter.scale?.toString() ?? "",
    minVoteCount: filter.minVoteCount?.toString() ?? ""
  };
}

function providerIdentityFromFields(provider: string, providerEntityType: string | undefined, providerId: string) {
  const normalizedProvider = optionalText(provider);
  const normalizedProviderId = optionalText(providerId);
  if (!normalizedProvider || !normalizedProviderId) return undefined;
  return {
    provider: normalizedProvider,
    providerEntityType: optionalText(providerEntityType ?? ""),
    providerId: normalizedProviderId
  };
}

function providerRatingFromFields(input: ProviderRatingRow) {
  const provider = optionalText(input.provider);
  const value = numberOrUndefined(input.value);
  if (!provider || value === undefined) return undefined;
  return {
    provider,
    ratingType: optionalText(input.ratingType),
    comparison: input.comparison,
    value,
    scale: numberOrUndefined(input.scale),
    minVoteCount: numberOrUndefined(input.minVoteCount)
  };
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function SubscriptionSearch({
  downloaders,
  onSubscribe
}: {
  downloaders: Downloader[];
  onSubscribe: (body: string) => void | ActionResult | Promise<void | ActionResult>;
}) {
  const { t } = useTranslation();
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
    setResults(await api<MediaSearchResult[]>(`/api/provider-titles/search?${params}`));
  }

  return (
    <div className="subscription-tool">
      <form className="search-form" onSubmit={search}>
        <SelectField
          value={kind}
          onValueChange={(value) => setKind(value as "MOVIE" | "TV")}
          options={[
            { value: "MOVIE", label: t("common.movie") },
            { value: "TV", label: t("common.series") }
          ]}
        />
        <FormInput placeholder={t("subscriptions.searchMetadata")} value={query} onChange={(event) => setQuery(event.target.value)} required />
        <FormInput placeholder={t("common.includeRegex")} value={includeRegex} onChange={(event) => setIncludeRegex(event.target.value)} />
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
            { value: "", label: t("common.defaultDownloader") },
            ...downloaders.map((downloader) => ({ value: downloader.id, label: downloader.name }))
          ]}
        />
        <UiButton className="primary" type="submit"><Search size={17} />{t("common.search")}</UiButton>
      </form>
      <div className="result-grid">
        {results.map((result) => (
          <article className="result" key={`${result.provider}-${result.providerEntityType ?? result.kind}-${result.providerId}`}>
            {result.posterUrl ? (
              <img src={result.posterUrl} alt={result.title} />
            ) : (
              <div className="poster-placeholder"><Film size={24} /></div>
            )}
            <strong>{result.title}</strong>
            <span>{[result.year ?? t("common.unknown"), `${Math.round(result.score * 100)}%`, result.attributionText].filter(Boolean).join(" · ")}</span>
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
                      mediaType: result.mediaType,
                      selectedProvider: {
                        provider: result.provider,
                        providerEntityType: result.providerEntityType,
                        providerId: result.providerId
                      },
                      includeRegex: includeRegex || undefined,
                      minResolution
                    }
                  })
                );
                if (subscribeResult && !subscribeResult.ok) setSubscribeError(subscribeResult.message);
              }}
            >
              {t("subscriptions.subscribe")}
            </UiButton>
          </article>
        ))}
      </div>
      {subscribeError && <p className="modal-feedback error">{subscribeError}</p>}
    </div>
  );
}
