import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Film, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { api, type Downloader, type Feed, type MediaSearchResult, type ProviderIdentityFilter, type ProviderRatingFilter, type Subscription } from "../api.js";
import type { ActionResult, RunAction } from "../types.js";
import { CheckboxField, FieldLabel, FormInput, SelectField, UiButton } from "../components/ui/index.js";
import { Empty } from "../components/common/feedback.js";
import { Modal } from "../components/common/surfaces.js";
import { numberOrUndefined, optionalText, providerValue, ruleSummary, stringListFromInput } from "../lib/forms.js";

export function SubscriptionsPage({
  busy,
  downloaders,
  feeds,
  subscriptions,
  runAction
}: {
  busy: boolean;
  downloaders: Downloader[];
  feeds: Feed[];
  subscriptions: Subscription[];
  runAction: RunAction;
}) {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null);
  const [query, setQuery] = useState("");
  const filteredSubscriptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return subscriptions;
    return subscriptions.filter((subscription) =>
      [
        subscription.title,
        subscriptionTarget(subscription, t),
        ruleSummary(subscription, t),
        subscription.downloader?.name,
        subscriptionMode(subscription, t)
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery))
    );
  }, [query, subscriptions, t]);

  return (
    <div className="management-workbench">
      <section className="management-command" aria-label={t("subscriptions.rules")}>
        <div className="management-command-left">
          <FieldLabel className="search-control management-search">
            <span className="sr-only">{t("subscriptions.searchSubscriptions")}</span>
            <Search size={16} />
            <FormInput
              aria-label={t("subscriptions.searchSubscriptions")}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("subscriptions.searchSubscriptions")}
              type="search"
              value={query}
            />
          </FieldLabel>
          <span className="management-count">{t("subscriptions.subscriptionCount", { count: subscriptions.length })}</span>
        </div>
        <UiButton className="primary" disabled={busy} onClick={() => setCreateOpen(true)}>
          <Plus size={17} />
          {t("subscriptions.create")}
        </UiButton>
      </section>

      <section className="management-table" role="table" aria-label={t("subscriptions.rules")}>
        <div className="management-table-head subscription-table-head" role="row">
          <span role="columnheader">{t("subscriptions.subscription")}</span>
          <span role="columnheader">{t("subscriptions.target")}</span>
          <span role="columnheader">{t("subscriptions.rule")}</span>
          <span role="columnheader">{t("common.downloader")}</span>
          <span role="columnheader">{t("subscriptions.mode")}</span>
          <span role="columnheader">{t("subscriptions.actions")}</span>
        </div>
        {subscriptions.length === 0 && <Empty label={t("subscriptions.none")} />}
        {subscriptions.length > 0 && filteredSubscriptions.length === 0 && <Empty label={t("subscriptions.noMatchingSubscriptions")} />}
        {filteredSubscriptions.map((subscription) => (
          <article className="management-table-row subscription-table-row" key={subscription.id} role="row">
            <div className="management-primary-cell" role="cell">
              <strong>{subscription.title}</strong>
              <span>{subscription.enabled ? t("common.enabled") : t("common.disabled")}</span>
            </div>
            <span role="cell">{subscriptionTarget(subscription, t)}</span>
            <span role="cell">{ruleSummary(subscription, t)}</span>
            <span role="cell">{subscription.downloader?.name ?? t("common.defaultDownloader")}</span>
            <span role="cell">{subscriptionMode(subscription, t)}</span>
            <div className="row-actions" role="cell">
              <UiButton
                aria-label={t("subscriptions.editSubscriptionNamed", { name: subscription.title })}
                className="icon-button"
                disabled={busy}
                onClick={() => setEditingSubscription(subscription)}
                title={t("common.edit")}
              >
                <Pencil size={16} />
              </UiButton>
            </div>
          </article>
        ))}
      </section>

      {createOpen && (
        <Modal title={t("subscriptions.create")} onClose={() => setCreateOpen(false)}>
          <SubscriptionSearch
            downloaders={downloaders}
            feeds={feeds}
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
            feeds={feeds}
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

function subscriptionTarget(subscription: Subscription, t: (key: string) => string) {
  return subscription.media?.title ??
    subscription.rule?.selectedProvider?.providerId ??
    subscription.rule?.titleRegex ??
    t("subscriptions.ruleOnly");
}

function subscriptionMode(subscription: Subscription, t: (key: string) => string) {
  const ruleMode = subscription.rule?.mode === "REGEX"
    ? t("subscriptions.regexMode")
    : t("subscriptions.mediaTitleMode");
  return `${ruleMode} · ${subscription.autoDownload ? t("common.auto") : t("common.manual")}`;
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

type RuleMode = "MEDIA_TITLE" | "REGEX";
type UpgradePolicy = "none" | "better_quality" | "preferred_release_group";

let filterRowId = 0;

function nextFilterRowId(prefix: string) {
  filterRowId += 1;
  return `${prefix}-${filterRowId}`;
}

function SubscriptionEditForm({
  busy,
  downloaders,
  feeds,
  subscription,
  onCancel,
  onSubmit
}: {
  busy: boolean;
  downloaders: Downloader[];
  feeds: Feed[];
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
  const [mode, setMode] = useState<RuleMode>(rule?.mode ?? "MEDIA_TITLE");
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
  const [preferredReleaseGroups, setPreferredReleaseGroups] = useState((rule?.preferredReleaseGroups ?? []).join(", "));
  const [feedIds, setFeedIds] = useState<string[]>(rule?.feedIds ?? []);
  const [minSizeBytes, setMinSizeBytes] = useState(rule?.minSizeBytes ?? "");
  const [maxSizeBytes, setMaxSizeBytes] = useState(rule?.maxSizeBytes ?? "");
  const [season, setSeason] = useState(rule?.season?.toString() ?? "");
  const [episodeStart, setEpisodeStart] = useState(rule?.episodeStart?.toString() ?? "");
  const [episodeEnd, setEpisodeEnd] = useState(rule?.episodeEnd?.toString() ?? "");
  const [upgradePolicy, setUpgradePolicy] = useState<UpgradePolicy>(rule?.upgradePolicy ?? "none");
  const [allowCrossSeed, setAllowCrossSeed] = useState(rule?.allowCrossSeed ?? false);
  const [seasonPackAllowed, setSeasonPackAllowed] = useState(rule?.seasonPackAllowed ?? true);
  const [submitError, setSubmitError] = useState("");
  const providerOptionList = providerOptions(t);
  const identityMode = mode === "MEDIA_TITLE";
  const toggleFeed = (feedId: string, checked: boolean) => {
    setFeedIds((current) =>
      checked ? [...new Set([...current, feedId])] : current.filter((id) => id !== feedId)
    );
  };
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
            mediaTitleId: identityMode ? undefined : null,
            downloaderId: downloaderId || null,
            autoDownload,
            enabled
          }),
          JSON.stringify({
            mode,
            mediaType: mediaType || undefined,
            selectedProvider: identityMode
              ? providerIdentityFromFields(
                selectedProvider,
                selectedProviderEntityType || providerEntityTypeFor(selectedProvider, mediaType),
                selectedProviderId
              )
              : undefined,
            linkedProviders: identityMode
              ? linkedProviders
                .map((filter) => providerIdentityFromFields(filter.provider, filter.providerEntityType, filter.providerId))
                .filter(isDefined)
              : [],
            providerRatings: identityMode
              ? providerRatings
                .map((filter) => providerRatingFromFields(filter))
                .filter(isDefined)
              : [],
            feedIds,
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
            preferredReleaseGroups: stringListFromInput(preferredReleaseGroups),
            minSizeBytes: optionalText(minSizeBytes),
            maxSizeBytes: optionalText(maxSizeBytes),
            season: numberOrUndefined(season),
            episodeStart: numberOrUndefined(episodeStart),
            episodeEnd: numberOrUndefined(episodeEnd),
            upgradePolicy,
            allowCrossSeed,
            seasonPackAllowed
          })
        );
        if (!result.ok) setSubmitError(result.message);
      }}
    >
      <FieldLabel>
        {t("subscriptions.subscriptionTitle")}
        <FormInput value={title} onChange={(event) => setTitle(event.target.value)} required />
      </FieldLabel>
      <div className="form-grid three">
        <div className="field">
          <span>{t("subscriptions.ruleMode")}</span>
          <SelectField
            value={mode}
            onValueChange={(value) => setMode(value as RuleMode)}
            options={ruleModeOptions(t)}
          />
        </div>
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
      {identityMode && (
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
      )}
      {identityMode && (
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
      )}
      {identityMode && (
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
      )}
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
      <FieldLabel>
        {t("subscriptions.preferredReleaseGroups")}
        <FormInput value={preferredReleaseGroups} onChange={(event) => setPreferredReleaseGroups(event.target.value)} />
      </FieldLabel>
      <div className="form-grid three">
        <div className="field">
          <span>{t("subscriptions.upgradePolicy")}</span>
          <SelectField
            value={upgradePolicy}
            onValueChange={(value) => setUpgradePolicy(value as UpgradePolicy)}
            options={upgradePolicyOptions(t)}
          />
        </div>
        <CheckboxField
          className="checkbox-row"
          checked={allowCrossSeed}
          onCheckedChange={setAllowCrossSeed}
          label={t("subscriptions.allowCrossSeed")}
        />
        <CheckboxField
          className="checkbox-row"
          checked={seasonPackAllowed}
          onCheckedChange={setSeasonPackAllowed}
          label={t("subscriptions.seasonPackAllowed")}
        />
      </div>
      <div className="subscription-filter-section">
        <div className="subscription-filter-heading">
          <span>{t("subscriptions.fixedFeeds")}</span>
        </div>
        <div className="subscription-feed-list">
          {feeds.length === 0 && <span className="subscription-feed-empty">{t("subscriptions.noFeeds")}</span>}
          {feeds.map((feed) => (
            <CheckboxField
              key={feed.id}
              checked={feedIds.includes(feed.id)}
              onCheckedChange={(checked) => toggleFeed(feed.id, checked)}
              label={feed.name}
            />
          ))}
        </div>
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
    { value: "ptgen", label: "PTGen" },
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

function ruleModeOptions(t: (key: string) => string) {
  return [
    { value: "MEDIA_TITLE", label: t("subscriptions.mediaTitleMode") },
    { value: "REGEX", label: t("subscriptions.regexMode") }
  ];
}

function upgradePolicyOptions(t: (key: string) => string) {
  return [
    { value: "none", label: t("subscriptions.noUpgrades") },
    { value: "better_quality", label: t("subscriptions.betterQuality") },
    { value: "preferred_release_group", label: t("subscriptions.preferredGroupUpgrade") }
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

function subscriptionRulePayload(input: {
  mode: RuleMode;
  mediaType: "MOVIE" | "TV_SERIES";
  selectedProvider?: ProviderIdentityFilter;
  titleRegex?: string;
  includeRegex: string;
  minResolution: number;
  season: string;
  releaseGroupsInclude: string;
  preferredReleaseGroups: string;
  feedIds: string[];
  upgradePolicy: UpgradePolicy;
  allowCrossSeed: boolean;
  seasonPackAllowed: boolean;
}) {
  return {
    mode: input.mode,
    mediaType: input.mediaType,
    selectedProvider: input.mode === "MEDIA_TITLE" ? input.selectedProvider : undefined,
    titleRegex: input.mode === "REGEX" ? optionalText(input.titleRegex ?? "") : undefined,
    includeRegex: optionalText(input.includeRegex),
    minResolution: input.minResolution,
    season: numberOrUndefined(input.season),
    releaseGroupsInclude: stringListFromInput(input.releaseGroupsInclude),
    preferredReleaseGroups: stringListFromInput(input.preferredReleaseGroups),
    feedIds: input.feedIds,
    upgradePolicy: input.upgradePolicy,
    allowCrossSeed: input.allowCrossSeed,
    seasonPackAllowed: input.seasonPackAllowed
  };
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function SubscriptionSearch({
  downloaders,
  feeds,
  onSubscribe
}: {
  downloaders: Downloader[];
  feeds: Feed[];
  onSubscribe: (body: string) => void | ActionResult | Promise<void | ActionResult>;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<RuleMode>("MEDIA_TITLE");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"MOVIE" | "TV">("MOVIE");
  const [results, setResults] = useState<MediaSearchResult[]>([]);
  const [downloaderId, setDownloaderId] = useState("");
  const [includeRegex, setIncludeRegex] = useState("");
  const [minResolution, setMinResolution] = useState(2160);
  const [season, setSeason] = useState("");
  const [releaseGroupsInclude, setReleaseGroupsInclude] = useState("");
  const [preferredReleaseGroups, setPreferredReleaseGroups] = useState("");
  const [feedIds, setFeedIds] = useState<string[]>([]);
  const [upgradePolicy, setUpgradePolicy] = useState<UpgradePolicy>("none");
  const [allowCrossSeed, setAllowCrossSeed] = useState(false);
  const [seasonPackAllowed, setSeasonPackAllowed] = useState(true);
  const [subscribeError, setSubscribeError] = useState("");
  const mediaType = kind === "TV" ? "TV_SERIES" : "MOVIE";
  const toggleFeed = (feedId: string, checked: boolean) => {
    setFeedIds((current) =>
      checked ? [...new Set([...current, feedId])] : current.filter((id) => id !== feedId)
    );
  };

  async function search(event: FormEvent) {
    event.preventDefault();
    if (mode === "REGEX") {
      setSubscribeError("");
      const subscribeResult = await onSubscribe(
        JSON.stringify({
          downloaderId: downloaderId || undefined,
          title: query.trim(),
          autoDownload: true,
          enabled: true,
          rule: subscriptionRulePayload({
            mode,
            mediaType,
            titleRegex: query,
            includeRegex,
            minResolution,
            season,
            releaseGroupsInclude,
            preferredReleaseGroups,
            feedIds,
            upgradePolicy,
            allowCrossSeed,
            seasonPackAllowed
          })
        })
      );
      if (subscribeResult && !subscribeResult.ok) setSubscribeError(subscribeResult.message);
      return;
    }

    const params = new URLSearchParams({ q: query, kind });
    setResults(await api<MediaSearchResult[]>(`/api/provider-titles/search?${params}`));
  }

  return (
    <div className="subscription-tool">
      <form className="search-form" onSubmit={search}>
        <SelectField
          value={mode}
          onValueChange={(value) => {
            setMode(value as RuleMode);
            setResults([]);
          }}
          options={ruleModeOptions(t)}
        />
        <SelectField
          value={kind}
          onValueChange={(value) => setKind(value as "MOVIE" | "TV")}
          options={[
            { value: "MOVIE", label: t("common.movie") },
            { value: "TV", label: t("common.series") }
          ]}
        />
        <FormInput
          placeholder={mode === "REGEX" ? t("subscriptions.titleRegex") : t("subscriptions.searchMetadata")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          required
        />
        <FormInput placeholder={t("common.includeRegex")} value={includeRegex} onChange={(event) => setIncludeRegex(event.target.value)} />
        <FormInput min={1} placeholder={t("subscriptions.season")} type="number" value={season} onChange={(event) => setSeason(event.target.value)} />
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
        <UiButton className="primary" type="submit">
          {mode === "REGEX" ? <Plus size={17} /> : <Search size={17} />}
          {mode === "REGEX" ? t("subscriptions.create") : t("common.search")}
        </UiButton>
      </form>
      <div className="subscription-filter-section">
        <div className="form-grid three">
          <FieldLabel>
            {t("subscriptions.includeReleaseGroups")}
            <FormInput value={releaseGroupsInclude} onChange={(event) => setReleaseGroupsInclude(event.target.value)} />
          </FieldLabel>
          <FieldLabel>
            {t("subscriptions.preferredReleaseGroups")}
            <FormInput value={preferredReleaseGroups} onChange={(event) => setPreferredReleaseGroups(event.target.value)} />
          </FieldLabel>
          <div className="field">
            <span>{t("subscriptions.upgradePolicy")}</span>
            <SelectField
              value={upgradePolicy}
              onValueChange={(value) => setUpgradePolicy(value as UpgradePolicy)}
              options={upgradePolicyOptions(t)}
            />
          </div>
        </div>
        <div className="form-grid">
          <CheckboxField
            className="checkbox-row"
            checked={allowCrossSeed}
            onCheckedChange={setAllowCrossSeed}
            label={t("subscriptions.allowCrossSeed")}
          />
          <CheckboxField
            className="checkbox-row"
            checked={seasonPackAllowed}
            onCheckedChange={setSeasonPackAllowed}
            label={t("subscriptions.seasonPackAllowed")}
          />
        </div>
      </div>
      <div className="subscription-filter-section">
        <div className="subscription-filter-heading">
          <span>{t("subscriptions.fixedFeeds")}</span>
        </div>
        <div className="subscription-feed-list">
          {feeds.length === 0 && <span className="subscription-feed-empty">{t("subscriptions.noFeeds")}</span>}
          {feeds.map((feed) => (
            <CheckboxField
              key={feed.id}
              checked={feedIds.includes(feed.id)}
              onCheckedChange={(checked) => toggleFeed(feed.id, checked)}
              label={feed.name}
            />
          ))}
        </div>
      </div>
      <div className="result-grid">
        {mode === "MEDIA_TITLE" && results.map((result) => (
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
                    rule: subscriptionRulePayload({
                      mode: "MEDIA_TITLE",
                      mediaType: result.mediaType,
                      selectedProvider: {
                        provider: result.provider,
                        providerEntityType: result.providerEntityType,
                        providerId: result.providerId
                      },
                      includeRegex,
                      minResolution,
                      season,
                      releaseGroupsInclude,
                      preferredReleaseGroups,
                      feedIds,
                      upgradePolicy,
                      allowCrossSeed,
                      seasonPackAllowed
                    })
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
