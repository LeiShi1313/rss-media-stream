import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Film, Pencil, Plus, Search } from "lucide-react";
import { api, type Downloader, type Feed, type Item, type MediaSearchResult, type ResolvedMediaTitle, type Subscription } from "../api.js";
import type { ActionResult, RunAction } from "../types.js";
import { CheckboxField, FieldLabel, FormInput, SelectField, UiButton } from "../components/ui/index.js";
import { Empty } from "../components/common/feedback.js";
import { Modal } from "../components/common/surfaces.js";
import { filterByQuery, numberOrUndefined, optionalText, ruleSummary, stringListFromInput } from "../lib/forms.js";
import { kindFromMediaType, mediaTypeFromKind, type MediaKind, type MediaRuleType } from "../lib/media.js";
import { errorMessage } from "../lib/format.js";

export function SubscriptionsPage({
  busy,
  downloaders,
  feeds,
  items,
  subscriptions,
  runAction
}: {
  busy: boolean;
  downloaders: Downloader[];
  feeds: Feed[];
  items: Item[];
  subscriptions: Subscription[];
  runAction: RunAction;
}) {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null);
  const [query, setQuery] = useState("");
  const releaseGroupOptions = useMemo(() => releaseGroupOptionsFromData(subscriptions, items), [items, subscriptions]);
  const filteredSubscriptions = useMemo(
    () => filterByQuery(subscriptions, query, (subscription) => [
      subscription.title,
      subscriptionTarget(subscription, t),
      ruleSummary(subscription, t),
      subscription.downloader?.name,
      subscriptionMode(subscription, t)
    ]),
    [query, subscriptions, t]
  );

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
          <SubscriptionEditorModal
            busy={busy}
            downloaders={downloaders}
            feeds={feeds}
            releaseGroupOptions={releaseGroupOptions}
            onCancel={() => setCreateOpen(false)}
            onCreate={async (body) => {
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
          <SubscriptionEditorModal
            busy={busy}
            downloaders={downloaders}
            feeds={feeds}
            releaseGroupOptions={releaseGroupOptions}
            subscription={editingSubscription}
            onCancel={() => setEditingSubscription(null)}
            onUpdate={async (patchBody, ruleBody) => {
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

function releaseGroupOptionsFromData(subscriptions: Subscription[], items: Item[]) {
  const seen = new Set<string>();
  const options: string[] = [];
  for (const item of items) {
    addReleaseGroupOption(options, seen, item.parsedRelease?.releaseGroup);
  }
  for (const subscription of subscriptions) {
    for (const group of [
      ...(subscription.rule?.releaseGroupsInclude ?? []),
      ...(subscription.rule?.releaseGroupsExclude ?? []),
      ...(subscription.rule?.preferredReleaseGroups ?? [])
    ]) {
      addReleaseGroupOption(options, seen, group);
    }
  }
  return options.sort((a, b) => a.localeCompare(b));
}

function addReleaseGroupOption(options: string[], seen: Set<string>, value?: string | null) {
  const normalized = value?.trim();
  const key = normalized?.toLowerCase();
  if (!normalized || !key || seen.has(key)) return;
  seen.add(key);
  options.push(normalized);
}

type RuleMode = "MEDIA_TITLE" | "REGEX";
type UpgradePolicy = "none" | "better_quality" | "preferred_release_group";
type EditorStep = "search" | "rule";

type SelectedMedia = {
  mediaTitleId: string;
  mediaType: MediaRuleType;
  kind: MediaKind;
  title: string;
  originalTitle?: string | null;
  year?: number | null;
  posterUrl?: string | null;
  hasCover?: boolean;
  provider: string;
  providerSource?: string;
  providerEntityType?: string;
  providerId: string;
  attributionText?: string;
  score?: number;
};

function SubscriptionEditorModal({
  busy,
  downloaders,
  feeds,
  releaseGroupOptions,
  subscription,
  onCancel,
  onCreate,
  onUpdate
}: {
  busy: boolean;
  downloaders: Downloader[];
  feeds: Feed[];
  releaseGroupOptions: string[];
  subscription?: Subscription;
  onCancel: () => void;
  onCreate?: (body: string) => Promise<ActionResult>;
  onUpdate?: (patchBody: string, ruleBody: string) => Promise<ActionResult>;
}) {
  const { t } = useTranslation();
  const rule = subscription?.rule;
  const initialMedia = selectedMediaFromSubscription(subscription);
  const initialMode: RuleMode = rule?.mode === "REGEX" ? "REGEX" : "MEDIA_TITLE";
  const [mode, setMode] = useState<RuleMode>(initialMode);
  const [step, setStep] = useState<EditorStep>(subscription && initialMode === "MEDIA_TITLE" ? "rule" : "search");
  const [selectedMedia, setSelectedMedia] = useState<SelectedMedia | null>(initialMedia);
  const [query, setQuery] = useState(initialMedia?.title ?? "");
  const [kind, setKind] = useState<MediaKind>(
    kindFromMediaType(rule?.mediaType) ?? initialMedia?.kind ?? "MOVIE"
  );
  const [results, setResults] = useState<MediaSearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const [resolveBusy, setResolveBusy] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [title, setTitle] = useState(subscription?.title ?? "");
  const [downloaderId, setDownloaderId] = useState(subscription?.downloader?.id ?? "");
  const [autoDownload, setAutoDownload] = useState(subscription?.autoDownload ?? true);
  const [enabled, setEnabled] = useState(subscription?.enabled ?? true);
  const [titleRegex, setTitleRegex] = useState(rule?.titleRegex ?? "");
  const [includeRegex, setIncludeRegex] = useState(rule?.includeRegex ?? "");
  const [excludeRegex, setExcludeRegex] = useState(rule?.excludeRegex ?? "");
  const [minResolution, setMinResolution] = useState(rule?.minResolution?.toString() ?? "2160");
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
  const [separateVariants, setSeparateVariants] = useState(rule?.separateVariants ?? false);
  const [seasonPackAllowed, setSeasonPackAllowed] = useState(rule?.seasonPackAllowed ?? true);
  const canChooseMode = !subscription;
  const selectedRuleType = selectedMedia?.mediaType ?? mediaTypeFromKind(kind);

  const toggleFeed = (feedId: string, checked: boolean) => {
    setFeedIds((current) =>
      checked ? [...new Set([...current, feedId])] : current.filter((id) => id !== feedId)
    );
  };

  const switchMode = (nextMode: RuleMode) => {
    setMode(nextMode);
    setSubmitError("");
    setSearchError("");
    if (nextMode === "MEDIA_TITLE") {
      setStep(selectedMedia ? "rule" : "search");
      return;
    }
    setStep("rule");
  };

  async function searchMedia(event: FormEvent) {
    event.preventDefault();
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    setSearchBusy(true);
    setSearchError("");
    setHasSearched(true);
    try {
      const params = new URLSearchParams({
        q: trimmedQuery,
        mediaType: mediaTypeFromKind(kind)
      });
      setResults(await api<MediaSearchResult[]>(`/api/provider-titles/search?${params}`));
    } catch (error) {
      setResults([]);
      setSearchError(errorMessage(error));
    } finally {
      setSearchBusy(false);
    }
  }

  async function selectMedia(result: MediaSearchResult) {
    setResolveBusy(true);
    setSearchError("");
    try {
      const resolved = await api<ResolvedMediaTitle>("/api/provider-titles/resolve", {
        method: "POST",
        body: JSON.stringify({
          providerSource: result.providerSource ?? result.provider,
          providerEntityType: result.providerEntityType,
          providerId: result.providerId,
          mediaType: result.mediaType
        })
      });
      const media = selectedMediaFromResolved(resolved, result);
      setSelectedMedia(media);
      setKind(media.kind);
      if (!title.trim()) setTitle(defaultMediaSubscriptionTitle(media, season, minResolution));
      setStep("rule");
      setSubmitError("");
    } catch (error) {
      setSearchError(errorMessage(error));
    } finally {
      setResolveBusy(false);
    }
  }

  async function submitMediaRule(event: FormEvent) {
    event.preventDefault();
    if (!selectedMedia) {
      setStep("search");
      setSubmitError(t("subscriptions.selectMediaFirst"));
      return;
    }

    setSubmitError("");
    const effectiveTitle = optionalText(title) ?? defaultMediaSubscriptionTitle(selectedMedia, season, minResolution);
    const ruleBody = JSON.stringify(subscriptionRulePayload({
      mode: "MEDIA_TITLE",
      mediaType: selectedMedia.mediaType,
      mediaTitleId: selectedMedia.mediaTitleId,
      selectedProvider: providerIdentityFromMedia(selectedMedia),
      feedIds,
      includeRegex,
      excludeRegex,
      minResolution,
      maxResolution,
      sources,
      codecs,
      audio,
      releaseGroupsInclude,
      releaseGroupsExclude,
      preferredReleaseGroups,
      minSizeBytes,
      maxSizeBytes,
      season,
      episodeStart,
      episodeEnd,
      upgradePolicy,
      allowCrossSeed,
      separateVariants,
      seasonPackAllowed
    }));

    const result = subscription
      ? await onUpdate?.(
        JSON.stringify({
          title: effectiveTitle,
          mediaTitleId: selectedMedia.mediaTitleId,
          downloaderId: downloaderId || null,
          autoDownload,
          enabled
        }),
        ruleBody
      )
      : await onCreate?.(JSON.stringify({
        title: effectiveTitle,
        mediaTitleId: selectedMedia.mediaTitleId,
        downloaderId: downloaderId || undefined,
        autoDownload,
        enabled,
        rule: JSON.parse(ruleBody)
      }));
    if (result && !result.ok) setSubmitError(result.message);
  }

  async function submitRegexRule(event: FormEvent) {
    event.preventDefault();
    setSubmitError("");
    const effectiveTitle = optionalText(title) ?? optionalText(titleRegex) ?? optionalText(includeRegex) ?? t("subscriptions.rawReleaseRule");
    const ruleBody = JSON.stringify(subscriptionRulePayload({
      mode: "REGEX",
      mediaType: mediaTypeFromKind(kind),
      feedIds,
      titleRegex,
      includeRegex,
      excludeRegex,
      minResolution,
      maxResolution,
      sources,
      codecs,
      audio,
      releaseGroupsInclude,
      releaseGroupsExclude,
      preferredReleaseGroups,
      minSizeBytes,
      maxSizeBytes,
      season,
      episodeStart,
      episodeEnd,
      upgradePolicy,
      allowCrossSeed,
      separateVariants,
      seasonPackAllowed
    }));

    const result = subscription
      ? await onUpdate?.(
        JSON.stringify({
          title: effectiveTitle,
          mediaTitleId: null,
          downloaderId: downloaderId || null,
          autoDownload,
          enabled
        }),
        ruleBody
      )
      : await onCreate?.(JSON.stringify({
        title: effectiveTitle,
        downloaderId: downloaderId || undefined,
        autoDownload,
        enabled,
        rule: JSON.parse(ruleBody)
      }));
    if (result && !result.ok) setSubmitError(result.message);
  }

  const commonAdvancedFields = (
    <details className="subscription-advanced">
      <summary>{t("subscriptions.advancedOptions")}</summary>
      <div className="subscription-advanced-body">
        <FieldLabel>
          {t("subscriptions.subscriptionTitle")}
          <FormInput value={title} onChange={(event) => setTitle(event.target.value)} />
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
            <span>{t("subscriptions.upgradePolicy")}</span>
            <SelectField
              value={upgradePolicy}
              onValueChange={(value) => setUpgradePolicy(value as UpgradePolicy)}
              options={upgradePolicyOptions(t)}
            />
          </div>
        </div>
        <FieldLabel>
          {t("subscriptions.preferredReleaseGroups")}
          <FormInput value={preferredReleaseGroups} onChange={(event) => setPreferredReleaseGroups(event.target.value)} />
        </FieldLabel>
        <div className="form-grid">
          <FieldLabel>
            {t("common.includeRegex")}
            <FormInput value={includeRegex} onChange={(event) => setIncludeRegex(event.target.value)} />
          </FieldLabel>
          <FieldLabel>
            {t("subscriptions.excludeRegex")}
            <FormInput value={excludeRegex} onChange={(event) => setExcludeRegex(event.target.value)} />
          </FieldLabel>
        </div>
        <div className="form-grid three">
          <FieldLabel>
            {t("subscriptions.sources")}
            <FormInput placeholder="WEB-DL, BluRay" value={sources} onChange={(event) => setSources(event.target.value)} />
          </FieldLabel>
          <FieldLabel>
            {t("common.codecs")}
            <FormInput placeholder="x264, x265" value={codecs} onChange={(event) => setCodecs(event.target.value)} />
          </FieldLabel>
          <FieldLabel>
            {t("common.audio")}
            <FormInput placeholder="Atmos, TrueHD" value={audio} onChange={(event) => setAudio(event.target.value)} />
          </FieldLabel>
        </div>
        <div className="form-grid three">
          <FieldLabel>
            {t("subscriptions.maxResolution")}
            <FormInput min={1} type="number" value={maxResolution} onChange={(event) => setMaxResolution(event.target.value)} />
          </FieldLabel>
          <FieldLabel>
            {t("subscriptions.minSizeBytes")}
            <FormInput min={1} type="number" value={minSizeBytes} onChange={(event) => setMinSizeBytes(event.target.value)} />
          </FieldLabel>
          <FieldLabel>
            {t("subscriptions.maxSizeBytes")}
            <FormInput min={1} type="number" value={maxSizeBytes} onChange={(event) => setMaxSizeBytes(event.target.value)} />
          </FieldLabel>
        </div>
        <div className="form-grid">
          <CheckboxField className="checkbox-row" checked={allowCrossSeed} onCheckedChange={setAllowCrossSeed} label={t("subscriptions.allowCrossSeed")} />
          <CheckboxField className="checkbox-row" checked={separateVariants} onCheckedChange={setSeparateVariants} label={t("subscriptions.separateVariants")} />
          <CheckboxField className="checkbox-row" checked={seasonPackAllowed} onCheckedChange={setSeasonPackAllowed} label={t("subscriptions.seasonPackAllowed")} />
          <CheckboxField className="checkbox-row" checked={autoDownload} onCheckedChange={setAutoDownload} label={t("common.autoDownload")} />
          <CheckboxField className="checkbox-row" checked={enabled} onCheckedChange={setEnabled} label={t("common.enabled")} />
        </div>
      </div>
    </details>
  );

  if (mode === "REGEX") {
    return (
      <form className="subscription-editor modal-form" onSubmit={submitRegexRule}>
        {canChooseMode && <RuleModeChooser mode={mode} onChange={switchMode} />}
        <div className="subscription-rule-primary">
          <div className="subscription-rule-grid">
            <FieldLabel className="subscription-wide-field">
              {t("subscriptions.titleRegex")}
              <FormInput value={titleRegex} onChange={(event) => setTitleRegex(event.target.value)} required />
            </FieldLabel>
            <div className="field">
              <span>{t("subscriptions.mediaKind")}</span>
              <SelectField
                value={kind}
                onValueChange={(value) => setKind(value as MediaKind)}
                options={mediaKindOptions(t)}
              />
            </div>
            <div className="field">
              <span>{t("subscriptions.minResolution")}</span>
              <QualitySelect value={minResolution} onValueChange={setMinResolution} />
            </div>
          </div>
          {kind === "TV" && (
            <EpisodeFields
              episodeEnd={episodeEnd}
              episodeStart={episodeStart}
              season={season}
              setEpisodeEnd={setEpisodeEnd}
              setEpisodeStart={setEpisodeStart}
              setSeason={setSeason}
            />
          )}
          <div className="subscription-rule-row">
            <ReleaseGroupInput
              label={t("subscriptions.includeReleaseGroups")}
              options={releaseGroupOptions}
              value={releaseGroupsInclude}
              onChange={setReleaseGroupsInclude}
            />
            <FeedPicker feeds={feeds} feedIds={feedIds} onClear={() => setFeedIds([])} onToggle={toggleFeed} />
          </div>
        </div>
        {commonAdvancedFields}
        {submitError && <p className="modal-feedback error">{submitError}</p>}
        <EditorActions busy={busy} onCancel={onCancel} />
      </form>
    );
  }

  if (step === "search" || !selectedMedia) {
    return (
      <div className="subscription-editor">
        {canChooseMode && <RuleModeChooser mode={mode} onChange={switchMode} />}
        <form className="subscription-search-step" onSubmit={searchMedia}>
          <div className="subscription-search-row">
            <div className="field">
              <span>{t("subscriptions.mediaKind")}</span>
              <SelectField
                value={kind}
                onValueChange={(value) => setKind(value as MediaKind)}
                options={mediaKindOptions(t)}
              />
            </div>
            <FieldLabel className="search-control subscription-search-input">
              <span className="sr-only">{t("subscriptions.searchMetadata")}</span>
              <Search size={16} />
              <FormInput
                autoFocus
                placeholder={t("subscriptions.searchMetadata")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                required
              />
            </FieldLabel>
            <UiButton className="primary" disabled={searchBusy || resolveBusy} type="submit">
              <Search size={17} />
              {searchBusy ? t("common.searching") : t("common.search")}
            </UiButton>
          </div>
        </form>
        <div className="subscription-result-shell">
          {searchError && <p className="modal-feedback error">{searchError}</p>}
          {hasSearched && !searchError && results.length === 0 && <Empty label={t("subscriptions.noMediaResults")} />}
          {results.length > 0 && (
            <ul className="subscription-result-list">
              {results.map((result) => (
                <li key={`${result.providerSource ?? result.provider}:${result.providerEntityType ?? result.kind}:${result.providerId}`}>
                  <UiButton
                    className="subscription-result-row"
                    disabled={resolveBusy}
                    onClick={() => selectMedia(result)}
                    type="button"
                  >
                    <MediaPoster media={result} />
                    <span className="subscription-result-copy">
                      <strong>{result.title}</strong>
                      <span>{resultMeta(result, t)}</span>
                    </span>
                  </UiButton>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return (
    <form className="subscription-editor modal-form" onSubmit={submitMediaRule}>
      <SelectedMediaHeader
        media={selectedMedia}
        onChange={() => {
          setStep("search");
          setSubmitError("");
        }}
      />
      <div className="subscription-rule-primary">
        {selectedRuleType === "TV_SERIES" && (
          <EpisodeFields
            episodeEnd={episodeEnd}
            episodeStart={episodeStart}
            season={season}
            setEpisodeEnd={setEpisodeEnd}
            setEpisodeStart={setEpisodeStart}
            setSeason={setSeason}
          />
        )}
        <div className="subscription-rule-grid">
          <div className="field">
            <span>{t("subscriptions.minResolution")}</span>
            <QualitySelect value={minResolution} onValueChange={setMinResolution} />
          </div>
          <ReleaseGroupInput
            label={t("subscriptions.includeReleaseGroups")}
            options={releaseGroupOptions}
            value={releaseGroupsInclude}
            onChange={setReleaseGroupsInclude}
          />
          <FeedPicker feeds={feeds} feedIds={feedIds} onClear={() => setFeedIds([])} onToggle={toggleFeed} />
        </div>
      </div>
      {commonAdvancedFields}
      {submitError && <p className="modal-feedback error">{submitError}</p>}
      <EditorActions busy={busy} onCancel={onCancel} />
    </form>
  );
}

function RuleModeChooser({
  mode,
  onChange
}: {
  mode: RuleMode;
  onChange: (mode: RuleMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="subscription-mode-chooser" role="group" aria-label={t("subscriptions.ruleMode")}>
      <UiButton
        className={mode === "MEDIA_TITLE" ? "segmented-tab active" : "segmented-tab"}
        onClick={() => onChange("MEDIA_TITLE")}
        type="button"
      >
        {t("subscriptions.mediaTitleMode")}
      </UiButton>
      <UiButton
        className={mode === "REGEX" ? "segmented-tab active" : "segmented-tab"}
        onClick={() => onChange("REGEX")}
        type="button"
      >
        {t("subscriptions.rawRegexRule")}
      </UiButton>
    </div>
  );
}

function SelectedMediaHeader({
  media,
  onChange
}: {
  media: SelectedMedia;
  onChange: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="subscription-selected-media">
      <MediaPoster media={media} />
      <div>
        <span>{t("subscriptions.selectedMedia")}</span>
        <strong>{media.title}</strong>
        <small>{mediaMeta(media, t)}</small>
      </div>
      <UiButton className="secondary" onClick={onChange} type="button">
        {t("subscriptions.changeMedia")}
      </UiButton>
    </div>
  );
}

function EpisodeFields({
  season,
  setSeason,
  episodeStart,
  setEpisodeStart,
  episodeEnd,
  setEpisodeEnd
}: {
  season: string;
  setSeason: (value: string) => void;
  episodeStart: string;
  setEpisodeStart: (value: string) => void;
  episodeEnd: string;
  setEpisodeEnd: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="subscription-episode-row">
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
  );
}

function QualitySelect({
  value,
  onValueChange
}: {
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <SelectField
      value={value}
      onValueChange={onValueChange}
      options={[
        { value: "720", label: "720p+" },
        { value: "1080", label: "1080p+" },
        { value: "2160", label: "2160p+" }
      ]}
    />
  );
}

function ReleaseGroupInput({
  label,
  options,
  value,
  onChange
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const selectedGroups = stringListFromInput(value);
  const availableOptions = options.filter((option) =>
    !selectedGroups.some((group) => group.toLowerCase() === option.toLowerCase())
  );

  const addGroup = (group: string) => {
    onChange([...selectedGroups, group].join(", "));
  };

  return (
    <div className="subscription-release-group-control">
      <FieldLabel className="subscription-wide-field">
        {label}
        <FormInput value={value} onChange={(event) => onChange(event.target.value)} />
      </FieldLabel>
      <DropdownMenuPrimitive.Root>
        <DropdownMenuPrimitive.Trigger
          aria-label={t("subscriptions.releaseGroupSuggestions")}
          className="secondary subscription-dropdown-icon"
          title={t("subscriptions.releaseGroupSuggestions")}
          type="button"
        >
          <ChevronDown size={16} />
        </DropdownMenuPrimitive.Trigger>
        <DropdownMenuPrimitive.Portal>
          <DropdownMenuPrimitive.Content className="menu-content subscription-compact-menu" align="end" sideOffset={6}>
            {availableOptions.length === 0 ? (
              <DropdownMenuPrimitive.Item className="menu-item" disabled>
                {t("subscriptions.noReleaseGroupSuggestions")}
              </DropdownMenuPrimitive.Item>
            ) : availableOptions.map((option) => (
              <DropdownMenuPrimitive.Item
                className="menu-item"
                key={option}
                onSelect={(event) => {
                  event.preventDefault();
                  addGroup(option);
                }}
              >
                {option}
              </DropdownMenuPrimitive.Item>
            ))}
          </DropdownMenuPrimitive.Content>
        </DropdownMenuPrimitive.Portal>
      </DropdownMenuPrimitive.Root>
    </div>
  );
}

function FeedPicker({
  feeds,
  feedIds,
  onClear,
  onToggle
}: {
  feeds: Feed[];
  feedIds: string[];
  onClear: () => void;
  onToggle: (feedId: string, checked: boolean) => void;
}) {
  const { t } = useTranslation();
  const label = feedIds.length === 0
    ? t("subscriptions.allFeeds")
    : t("subscriptions.feedRule", { count: feedIds.length });
  return (
    <div className="subscription-feed-picker">
      <span>{t("subscriptions.fixedFeeds")}</span>
      <DropdownMenuPrimitive.Root>
        <DropdownMenuPrimitive.Trigger className="secondary subscription-dropdown-trigger" disabled={feeds.length === 0} type="button">
          <span>{feeds.length === 0 ? t("subscriptions.noFeeds") : label}</span>
          <ChevronDown size={16} />
        </DropdownMenuPrimitive.Trigger>
        <DropdownMenuPrimitive.Portal>
          <DropdownMenuPrimitive.Content className="menu-content subscription-multi-menu" align="end" sideOffset={6}>
            <DropdownMenuPrimitive.Item
              className="menu-item subscription-check-item"
              onSelect={(event) => {
                event.preventDefault();
                onClear();
              }}
            >
              <span className="subscription-check-slot">{feedIds.length === 0 && <Check size={14} />}</span>
              {t("subscriptions.allFeeds")}
            </DropdownMenuPrimitive.Item>
            <DropdownMenuPrimitive.Separator className="subscription-menu-separator" />
            {feeds.map((feed) => (
              <DropdownMenuPrimitive.CheckboxItem
                checked={feedIds.includes(feed.id)}
                className="menu-item subscription-check-item"
                key={feed.id}
                onCheckedChange={(checked) => onToggle(feed.id, checked === true)}
                onSelect={(event) => event.preventDefault()}
              >
                <span className="subscription-check-slot">{feedIds.includes(feed.id) && <Check size={14} />}</span>
                <span>{feed.name}</span>
              </DropdownMenuPrimitive.CheckboxItem>
            ))}
          </DropdownMenuPrimitive.Content>
        </DropdownMenuPrimitive.Portal>
      </DropdownMenuPrimitive.Root>
    </div>
  );
}

function EditorActions({
  busy,
  onCancel
}: {
  busy: boolean;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="modal-actions">
      <UiButton className="secondary" onClick={onCancel} type="button">
        {t("common.cancel")}
      </UiButton>
      <UiButton className="primary" disabled={busy} type="submit">
        <Pencil size={17} />
        {t("subscriptions.saveSubscription")}
      </UiButton>
    </div>
  );
}

function MediaPoster({ media }: { media: { title: string; posterUrl?: string | null } }) {
  return media.posterUrl ? (
    <img className="subscription-media-poster" src={media.posterUrl} alt={media.title} />
  ) : (
    <div className="subscription-media-poster poster-placeholder"><Film size={22} /></div>
  );
}

function upgradePolicyOptions(t: (key: string) => string) {
  return [
    { value: "none", label: t("subscriptions.noUpgrades") },
    { value: "better_quality", label: t("subscriptions.betterQuality") },
    { value: "preferred_release_group", label: t("subscriptions.preferredGroupUpgrade") }
  ];
}

function subscriptionRulePayload(input: {
  mode: RuleMode;
  mediaType: MediaRuleType;
  mediaTitleId?: string;
  selectedProvider?: ReturnType<typeof providerIdentityFromMedia>;
  titleRegex?: string;
  includeRegex: string;
  excludeRegex: string;
  minResolution: string;
  maxResolution: string;
  sources: string;
  codecs: string;
  audio: string;
  season: string;
  episodeStart: string;
  episodeEnd: string;
  releaseGroupsInclude: string;
  releaseGroupsExclude: string;
  preferredReleaseGroups: string;
  minSizeBytes: string;
  maxSizeBytes: string;
  feedIds: string[];
  upgradePolicy: UpgradePolicy;
  allowCrossSeed: boolean;
  separateVariants: boolean;
  seasonPackAllowed: boolean;
}) {
  return {
    mode: input.mode,
    mediaType: input.mediaType,
    mediaTitleId: input.mode === "MEDIA_TITLE" ? input.mediaTitleId : undefined,
    selectedProvider: input.mode === "MEDIA_TITLE" ? input.selectedProvider : undefined,
    titleRegex: input.mode === "REGEX" ? optionalText(input.titleRegex ?? "") : undefined,
    includeRegex: optionalText(input.includeRegex),
    excludeRegex: optionalText(input.excludeRegex),
    minResolution: numberOrUndefined(input.minResolution),
    maxResolution: numberOrUndefined(input.maxResolution),
    sources: stringListFromInput(input.sources),
    codecs: stringListFromInput(input.codecs),
    audio: stringListFromInput(input.audio),
    season: numberOrUndefined(input.season),
    episodeStart: numberOrUndefined(input.episodeStart),
    episodeEnd: numberOrUndefined(input.episodeEnd),
    releaseGroupsInclude: stringListFromInput(input.releaseGroupsInclude),
    releaseGroupsExclude: stringListFromInput(input.releaseGroupsExclude),
    preferredReleaseGroups: stringListFromInput(input.preferredReleaseGroups),
    minSizeBytes: optionalText(input.minSizeBytes),
    maxSizeBytes: optionalText(input.maxSizeBytes),
    feedIds: input.feedIds,
    upgradePolicy: input.upgradePolicy,
    allowCrossSeed: input.allowCrossSeed,
    separateVariants: input.separateVariants,
    seasonPackAllowed: input.seasonPackAllowed
  };
}

function selectedMediaFromResolved(resolved: ResolvedMediaTitle, source: MediaSearchResult): SelectedMedia {
  return {
    mediaTitleId: resolved.mediaTitleId,
    mediaType: resolved.mediaType,
    kind: kindFromMediaType(resolved.mediaType) ?? (source.kind === "TV" ? "TV" : "MOVIE"),
    title: resolved.title,
    originalTitle: resolved.originalTitle,
    year: resolved.year,
    posterUrl: resolved.posterUrl,
    hasCover: resolved.hasCover,
    provider: resolved.provider,
    providerSource: resolved.providerSource,
    providerEntityType: resolved.providerEntityType,
    providerId: resolved.providerId,
    attributionText: source.attributionText,
    score: source.score
  };
}

function selectedMediaFromSubscription(subscription?: Subscription): SelectedMedia | null {
  if (!subscription?.media) return null;
  const mediaType = mediaTypeFromKind(subscription.media.kind);
  if (!mediaType) return null;
  return {
    mediaTitleId: subscription.media.id,
    mediaType,
    kind: kindFromMediaType(mediaType) ?? "MOVIE",
    title: subscription.media.title,
    year: subscription.media.year,
    posterUrl: subscription.media.posterUrl,
    hasCover: subscription.media.hasCover,
    provider: subscription.rule?.selectedProvider?.provider ?? subscription.media.provider,
    providerSource: subscription.media.providerSource,
    providerEntityType: subscription.rule?.selectedProvider?.providerEntityType ?? subscription.media.providerEntityType,
    providerId: subscription.rule?.selectedProvider?.providerId ?? subscription.media.providerId
  };
}

function providerIdentityFromMedia(media: SelectedMedia) {
  if (!media.provider || !media.providerId) return undefined;
  return {
    provider: media.provider,
    mediaType: media.mediaType,
    providerId: media.providerId
  };
}

function mediaKindOptions(t: (key: string) => string) {
  return [
    { value: "MOVIE", label: t("common.movie") },
    { value: "TV", label: t("common.series") }
  ];
}

function defaultMediaSubscriptionTitle(media: SelectedMedia, season: string, minResolution: string) {
  return [
    media.title,
    media.mediaType === "TV_SERIES" && season.trim() ? `S${season.trim().padStart(2, "0")}` : undefined,
    minResolution.trim() ? `${minResolution.trim()}p+` : undefined
  ].filter(Boolean).join(" ");
}

function resultMeta(result: MediaSearchResult, t: (key: string) => string) {
  return [
    result.year ?? t("common.unknown"),
    result.attributionText,
    `${Math.round(result.score * 100)}%`
  ].filter(Boolean).join(" · ");
}

function mediaMeta(media: SelectedMedia, t: (key: string) => string) {
  return [
    media.year ?? t("common.unknown"),
    providerDisplay(media)
  ].filter(Boolean).join(" · ");
}

function providerDisplay(media: Pick<SelectedMedia, "provider" | "providerSource">) {
  const raw = media.providerSource ?? media.provider;
  return raw.replace("_api", "").replace("ptgen_", "PTGen ").toUpperCase();
}
