import { useEffect, useState } from "react";
import { KeyRound, SlidersHorizontal } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  type MediaProviderPoliciesResponseDto,
  type MediaProviderPolicyDto,
  type ProviderSettingsDto,
  type ProviderSettingsResponseDto,
  type WorkspaceDto
} from "@rss-media/shared/apiContracts";
import { api } from "../api.js";
import { Pill, StatusPill } from "../components/common/feedback.js";
import { Panel } from "../components/common/surfaces.js";
import { FieldLabel, FormInput, SelectField, UiButton } from "../components/ui/index.js";
import type { RunAction } from "../types.js";

type ProviderDraft = {
  enabled: boolean;
  metadataLanguage: string;
  region: string;
  baseUrl: string;
  secrets: Record<string, string>;
};

function draftFromProvider(provider: ProviderSettingsDto): ProviderDraft {
  return {
    enabled: provider.enabled,
    metadataLanguage: provider.metadataLanguage ?? "en-US",
    region: provider.region ?? "",
    baseUrl: provider.baseUrl ?? provider.baseUrlOptions[0]?.value ?? "",
    secrets: {}
  };
}

export function SettingsPage({
  busy,
  runAction,
  workspace
}: {
  busy: boolean;
  runAction: RunAction;
  workspace: WorkspaceDto | null;
}) {
  const { t } = useTranslation();
  const mediaLanguageOptions = languageOptions(t);
  const [providerSettings, setProviderSettings] = useState<ProviderSettingsDto[]>([]);
  const [providerDrafts, setProviderDrafts] = useState<Record<string, ProviderDraft>>({});
  const [policies, setPolicies] = useState<MediaProviderPoliciesResponseDto["mediaTypes"]>([]);

  async function loadSettings() {
    const [nextProviders, nextPolicies] = await Promise.all([
      api<ProviderSettingsResponseDto>("/api/settings/providers"),
      api<MediaProviderPoliciesResponseDto>("/api/settings/media-provider-policies")
    ]);
    setProviderSettings(nextProviders.providers);
    setProviderDrafts(Object.fromEntries(nextProviders.providers.map((provider) => [
      provider.id,
      draftFromProvider(provider)
    ])));
    setPolicies(nextPolicies.mediaTypes);
  }

  useEffect(() => {
    void loadSettings();
  }, []);

  async function saveProvider(provider: ProviderSettingsDto, { clearSecrets = false } = {}) {
    const draft = providerDrafts[provider.id];
    const secrets = Object.fromEntries(
      Object.entries(draft?.secrets ?? {}).filter(([, value]) => value.trim())
    );
    const result = await runAction(() =>
      api<ProviderSettingsResponseDto>(`/api/settings/providers/${provider.id}`, {
        method: "PUT",
        body: JSON.stringify({
          enabled: draft.enabled,
          ...(provider.supportsMetadataLanguage ? { metadataLanguage: draft.metadataLanguage || null } : {}),
          ...(provider.supportsRegion ? { region: draft.region || null } : {}),
          ...(provider.baseUrlOptions.length > 0 ? { baseUrl: draft.baseUrl || null } : {}),
          ...(clearSecrets
            ? { clearSecrets: true }
            : Object.keys(secrets).length > 0 ? { secrets } : {})
        })
      })
    );
    if (result.ok) await loadSettings();
  }

  async function savePolicies(group: MediaProviderPoliciesResponseDto["mediaTypes"][number]) {
    const result = await runAction(() =>
      api<MediaProviderPoliciesResponseDto>("/api/settings/media-provider-policies", {
        method: "PUT",
        body: JSON.stringify({
          mediaType: group.mediaType,
          policies: group.policies,
          ratingProviderSource: group.ratingProviderSource
        })
      })
    );
    if (result.ok) await loadSettings();
  }

  const ownerOnly = workspace?.role !== "OWNER";

  return (
    <div className="page-stack">
      <Panel title={t("settings.providerCredentials")} icon={<KeyRound size={19} />}>
        <div className="provider-card-grid">
          {providerSettings.map((provider) => (
            <ProviderCard
              busy={busy}
              draft={providerDrafts[provider.id]}
              key={provider.id}
              onClearCredential={() => void saveProvider(provider, { clearSecrets: true })}
              onDraftChange={(draft) => setProviderDrafts((current) => ({ ...current, [provider.id]: draft }))}
              onSave={() => void saveProvider(provider)}
              ownerOnly={ownerOnly}
              provider={provider}
              languageOptions={mediaLanguageOptions}
              t={t}
            />
          ))}
        </div>
      </Panel>

      <Panel title={t("settings.providerPriority")} icon={<SlidersHorizontal size={19} />}>
        <div className="policy-editor">
          {policies.map((group) => (
            <PolicyTable
              busy={busy}
              group={group}
              key={group.mediaType}
              onChange={(rows) => setPolicies((current) =>
                current.map((item) => item.mediaType === group.mediaType ? { ...item, policies: rows } : item)
              )}
              onRatingSourceChange={(ratingProviderSource) => setPolicies((current) =>
                current.map((item) => item.mediaType === group.mediaType
                  ? {
                      ...item,
                      ratingProviderSource
                    }
                  : item)
              )}
              onSave={() => void savePolicies(group)}
              ownerOnly={ownerOnly}
              providerSettings={providerSettings}
              t={t}
            />
          ))}
        </div>
      </Panel>
    </div>
  );
}

function ProviderCard({
  busy,
  draft,
  languageOptions,
  onClearCredential,
  onDraftChange,
  onSave,
  ownerOnly,
  provider,
  t
}: {
  busy: boolean;
  draft?: ProviderDraft;
  languageOptions: Array<{ value: string; label: string }>;
  onClearCredential: () => void;
  onDraftChange: (draft: ProviderDraft) => void;
  onSave: () => void;
  ownerOnly: boolean;
  provider: ProviderSettingsDto;
  t: TFunction;
}) {
  const current = draft ?? draftFromProvider(provider);

  function update(patch: Partial<ProviderDraft>) {
    onDraftChange({ ...current, ...patch });
  }

  return (
    <div className="provider-card">
      <div className="integration-status">
        <div>
          <strong>{provider.label}</strong>
          <span>{providerCredentialText(provider, t)}</span>
        </div>
        <StatusPill ok={provider.configured && provider.enabled}>
          {provider.configured ? t("common.configured") : t("common.missing")}
        </StatusPill>
      </div>
      <div className="integration-meta">
        {provider.supportedMediaTypes.map((mediaType) => <Pill key={mediaType}>{mediaTypeLabel(mediaType, t)}</Pill>)}
        {!provider.enabled && <Pill>{t("settings.providerDisabled")}</Pill>}
      </div>
      <form className="settings-form" onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}>
        <label className="toggle-row">
          <input
            checked={current.enabled}
            disabled={busy || ownerOnly}
            onChange={(event) => update({ enabled: event.target.checked })}
            type="checkbox"
          />
          <span>{t("settings.providerEnabled")}</span>
        </label>
        {provider.authFields.map((field) => (
          <FieldLabel key={field.key}>
            {field.label}
            <FormInput
              autoComplete="off"
              disabled={busy || ownerOnly}
              onChange={(event) => update({
                secrets: { ...current.secrets, [field.key]: event.target.value }
              })}
              placeholder={provider.configured ? t("settings.replaceCredential") : t("settings.credentialPlaceholder")}
              type={field.secret ? "password" : "text"}
              value={current.secrets[field.key] ?? ""}
            />
          </FieldLabel>
        ))}
        {provider.supportsMetadataLanguage && (
          <FieldLabel>
            {t("settings.metadataLanguage")}
            <SelectField disabled={busy || ownerOnly} onValueChange={(value) => update({ metadataLanguage: value })} options={languageOptions} value={current.metadataLanguage} />
          </FieldLabel>
        )}
        {provider.supportsRegion && (
          <FieldLabel>
            {t("settings.region")}
            <FormInput
              disabled={busy || ownerOnly}
              maxLength={20}
              onChange={(event) => update({ region: event.target.value })}
              placeholder={t("settings.regionPlaceholder")}
              value={current.region}
            />
          </FieldLabel>
        )}
        {provider.baseUrlOptions.length > 0 && (
          <FieldLabel>
            {t("settings.providerBaseUrl")}
            <SelectField
              disabled={busy || ownerOnly}
              onValueChange={(value) => update({ baseUrl: value })}
              options={provider.baseUrlOptions}
              value={current.baseUrl}
            />
          </FieldLabel>
        )}
        <div className="form-actions">
          <UiButton className="primary" disabled={busy || ownerOnly}>
            {t("settings.saveProvider")}
          </UiButton>
          <UiButton
            className="secondary"
            disabled={busy || ownerOnly || provider.credentialSource !== "workspace"}
            onClick={onClearCredential}
            type="button"
          >
            {t("settings.removeWorkspaceCredential")}
          </UiButton>
        </div>
      </form>
      <div className="integration-meta">
        {provider.lastValidatedAt && <span>{t("common.validatedAt", { date: new Date(provider.lastValidatedAt).toLocaleString() })}</span>}
        {provider.lastError && <span>{provider.lastError}</span>}
      </div>
    </div>
  );
}

function PolicyTable({
  busy,
  group,
  onChange,
  onRatingSourceChange,
  onSave,
  ownerOnly,
  providerSettings,
  t
}: {
  busy: boolean;
  group: MediaProviderPoliciesResponseDto["mediaTypes"][number];
  onChange: (policies: MediaProviderPolicyDto[]) => void;
  onRatingSourceChange: (providerSource: ProviderSettingsDto["id"]) => void;
  onSave: () => void;
  ownerOnly: boolean;
  providerSettings: ProviderSettingsDto[];
  t: TFunction;
}) {
  const ratingProviders = providerSettings.filter((provider) =>
    provider.ratingSupportedMediaTypes.includes(group.mediaType)
  );
  const selectedRatingProvider = providerSettings.find((provider) =>
    provider.id === group.ratingProviderSource
  );

  function update(providerSource: string, patch: Partial<MediaProviderPolicyDto>) {
    onChange(group.policies.map((policy) => policy.providerSource === providerSource ? { ...policy, ...patch } : policy));
  }

  return (
    <div className="policy-group">
      <div className="policy-heading">
        <strong>{mediaTypeLabel(group.mediaType, t)}</strong>
        <div className="policy-heading-actions">
          <FieldLabel className="rating-provider-field">
            <span>{t("settings.ratingProviderSource")}</span>
            <SelectField
              disabled={busy || ownerOnly}
              onValueChange={(value) => onRatingSourceChange(value as ProviderSettingsDto["id"])}
              options={ratingProviders.map((provider) => ({
                value: provider.id,
                label: provider.label
              }))}
              value={group.ratingProviderSource}
            />
          </FieldLabel>
          {selectedRatingProvider && !selectedRatingProvider.enabled && (
            <Pill>{t("settings.ratingProviderDisabled")}</Pill>
          )}
          <UiButton className="secondary" disabled={busy || ownerOnly} onClick={onSave} type="button">
            {t("settings.savePolicy")}
          </UiButton>
        </div>
      </div>
      <div className="policy-rows">
        {group.policies.map((policy) => (
          <div className="policy-row" key={policy.providerSource}>
            <strong>{policy.label}</strong>
            <label>
              <input
                checked={policy.enabledForMatching}
                disabled={busy || ownerOnly}
                onChange={(event) => update(policy.providerSource, { enabledForMatching: event.target.checked })}
                type="checkbox"
              />
              <span>{t("settings.matching")}</span>
            </label>
            <FormInput
              disabled={busy || ownerOnly}
              min={1}
              onChange={(event) => update(policy.providerSource, { matchingPriority: Number(event.target.value) })}
              type="number"
              value={String(policy.matchingPriority)}
            />
            <label>
              <input
                checked={policy.enabledForPresentation}
                disabled={busy || ownerOnly}
                onChange={(event) => update(policy.providerSource, { enabledForPresentation: event.target.checked })}
                type="checkbox"
              />
              <span>{t("settings.presentation")}</span>
            </label>
            <FormInput
              disabled={busy || ownerOnly}
              min={1}
              onChange={(event) => update(policy.providerSource, { presentationPriority: Number(event.target.value) })}
              type="number"
              value={String(policy.presentationPriority)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function providerCredentialText(status: ProviderSettingsDto, t: TFunction) {
  if (status.authFields.length === 0) return t("settings.noCredentialRequired");
  if (status.credentialSource === "workspace") return t("settings.workspaceCredential");
  if (status.credentialSource === "environment") return t("settings.environmentCredential");
  return t("settings.addCredential");
}

function languageOptions(t: TFunction) {
  return [
    { value: "en-US", label: t("settings.languages.enUS") },
    { value: "zh-CN", label: t("settings.languages.zhCN") },
    { value: "zh-TW", label: t("settings.languages.zhTW") },
    { value: "ja-JP", label: t("settings.languages.jaJP") },
    { value: "ko-KR", label: t("settings.languages.koKR") },
    { value: "fr-FR", label: t("settings.languages.frFR") },
    { value: "de-DE", label: t("settings.languages.deDE") },
    { value: "es-ES", label: t("settings.languages.esES") }
  ];
}

function mediaTypeLabel(mediaType: "MOVIE" | "TV_SERIES", t: TFunction) {
  return mediaType === "TV_SERIES" ? t("common.series") : t("common.movie");
}
