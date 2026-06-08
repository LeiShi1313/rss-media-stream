import { FormEvent, useEffect, useState } from "react";
import { Globe2, KeyRound, SlidersHorizontal } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  api,
  type MediaProviderPoliciesResponse,
  type MediaProviderPolicy,
  type ProviderSettings,
  type ProviderSettingsResponse,
  type Workspace,
  type WorkspaceSettings
} from "../api.js";
import { Pill, StatusPill } from "../components/common/feedback.js";
import { Panel } from "../components/common/surfaces.js";
import { FieldLabel, FormInput, SelectField, UiButton } from "../components/ui/index.js";
import type { RunAction } from "../types.js";
import { applyUiLanguage, normalizeUiLanguage } from "../i18n.js";

type ProviderDraft = {
  enabled: boolean;
  metadataLanguage: string;
  region: string;
  secrets: Record<string, string>;
};

export function SettingsPage({
  busy,
  runAction,
  workspace
}: {
  busy: boolean;
  runAction: RunAction;
  workspace: Workspace | null;
}) {
  const { t } = useTranslation();
  const mediaLanguageOptions = languageOptions(t);
  const webLanguageOptions = [
    { value: "en-US", label: t("settings.languages.enUS") },
    { value: "zh-CN", label: t("settings.languages.zhCN") }
  ];
  const [workspaceSettings, setWorkspaceSettings] = useState<WorkspaceSettings | null>(null);
  const [providerSettings, setProviderSettings] = useState<ProviderSettings[]>([]);
  const [providerDrafts, setProviderDrafts] = useState<Record<string, ProviderDraft>>({});
  const [policies, setPolicies] = useState<MediaProviderPoliciesResponse["mediaTypes"]>([]);
  const [webLanguage, setWebLanguage] = useState("en-US");

  async function loadSettings() {
    const [nextWorkspaceSettings, nextProviders, nextPolicies] = await Promise.all([
      api<WorkspaceSettings>("/api/settings"),
      api<ProviderSettingsResponse>("/api/settings/providers"),
      api<MediaProviderPoliciesResponse>("/api/settings/media-provider-policies")
    ]);
    setWorkspaceSettings(nextWorkspaceSettings);
    setProviderSettings(nextProviders.providers);
    setProviderDrafts(Object.fromEntries(nextProviders.providers.map((provider) => [
      provider.id,
      {
        enabled: provider.enabled,
        metadataLanguage: provider.metadataLanguage ?? "en-US",
        region: provider.region ?? "",
        secrets: {}
      }
    ])));
    setPolicies(nextPolicies.mediaTypes);
    const nextWebLanguage = await applyUiLanguage(nextWorkspaceSettings.webLanguage);
    setWebLanguage(nextWebLanguage);
  }

  useEffect(() => {
    void loadSettings();
  }, []);

  async function saveWorkspaceSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await runAction(() =>
      api<WorkspaceSettings>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ webLanguage })
      })
    );
    if (result.ok) {
      await applyUiLanguage(webLanguage);
      await loadSettings();
    }
  }

  async function saveProviderSettings(provider: ProviderSettings) {
    const draft = providerDrafts[provider.id];
    const secrets = Object.fromEntries(
      Object.entries(draft?.secrets ?? {}).filter(([, value]) => value.trim())
    );
    const result = await runAction(() =>
      api<ProviderSettingsResponse>(`/api/settings/providers/${provider.id}`, {
        method: "PUT",
        body: JSON.stringify({
          enabled: draft.enabled,
          ...(provider.supportsMetadataLanguage ? { metadataLanguage: draft.metadataLanguage || null } : {}),
          ...(provider.supportsRegion ? { region: draft.region || null } : {}),
          ...(Object.keys(secrets).length > 0 ? { secrets } : {})
        })
      })
    );
    if (result.ok) await loadSettings();
  }

  async function clearProviderCredential(provider: ProviderSettings) {
    const draft = providerDrafts[provider.id];
    const result = await runAction(() =>
      api<ProviderSettingsResponse>(`/api/settings/providers/${provider.id}`, {
        method: "PUT",
        body: JSON.stringify({
          enabled: draft.enabled,
          clearSecrets: true,
          ...(provider.supportsMetadataLanguage ? { metadataLanguage: draft.metadataLanguage || null } : {}),
          ...(provider.supportsRegion ? { region: draft.region || null } : {})
        })
      })
    );
    if (result.ok) await loadSettings();
  }

  async function savePolicies(mediaType: "MOVIE" | "TV_SERIES", rows: MediaProviderPolicy[]) {
    const result = await runAction(() =>
      api<MediaProviderPoliciesResponse>("/api/settings/media-provider-policies", {
        method: "PUT",
        body: JSON.stringify({ mediaType, policies: rows })
      })
    );
    if (result.ok) await loadSettings();
  }

  const ownerOnly = workspace?.role !== "OWNER";

  return (
    <div className="page-stack">
      <Panel title={t("settings.workspaceLanguage")} icon={<Globe2 size={19} />}>
        <form className="settings-form settings-form-compact" onSubmit={saveWorkspaceSettings}>
          <FieldLabel>
            {t("settings.webLanguage")}
            <SelectField disabled={busy || ownerOnly} onValueChange={(value) => setWebLanguage(normalizeUiLanguage(value))} options={webLanguageOptions} value={webLanguage} />
          </FieldLabel>
          <div className="form-actions">
            <UiButton className="primary" disabled={busy || ownerOnly}>
              {t("settings.saveSettings")}
            </UiButton>
          </div>
        </form>
        <div className="integration-meta">
          <Pill>{languageLabel(webLanguage, t)} {t("common.webUi")}</Pill>
        </div>
      </Panel>

      <Panel title={t("settings.providerCredentials")} icon={<KeyRound size={19} />}>
        <div className="provider-card-grid">
          {providerSettings.map((provider) => (
            <ProviderCard
              busy={busy}
              draft={providerDrafts[provider.id]}
              key={provider.id}
              onClearCredential={() => void clearProviderCredential(provider)}
              onDraftChange={(draft) => setProviderDrafts((current) => ({ ...current, [provider.id]: draft }))}
              onSave={() => void saveProviderSettings(provider)}
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
              onSave={() => void savePolicies(group.mediaType, group.policies)}
              ownerOnly={ownerOnly}
              t={t}
            />
          ))}
        </div>
      </Panel>

      <Panel title={t("settings.languageBehavior")} icon={<Globe2 size={19} />}>
        <div className="settings-note">
          <strong>{t("settings.providerLanguageBehaviorTitle")}</strong>
          <span>{t("settings.providerLanguageBehaviorBody")}</span>
          <strong>{t("settings.webBehaviorTitle")}</strong>
          <span>{t("settings.webBehaviorBody")}</span>
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
  provider: ProviderSettings;
  t: TFunction;
}) {
  const current = draft ?? {
    enabled: provider.enabled,
    metadataLanguage: provider.metadataLanguage ?? "en-US",
    region: provider.region ?? "",
    secrets: {}
  };

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
  onSave,
  ownerOnly,
  t
}: {
  busy: boolean;
  group: MediaProviderPoliciesResponse["mediaTypes"][number];
  onChange: (policies: MediaProviderPolicy[]) => void;
  onSave: () => void;
  ownerOnly: boolean;
  t: TFunction;
}) {
  function update(provider: string, patch: Partial<MediaProviderPolicy>) {
    onChange(group.policies.map((policy) => policy.provider === provider ? { ...policy, ...patch } : policy));
  }

  return (
    <div className="policy-group">
      <div className="policy-heading">
        <strong>{mediaTypeLabel(group.mediaType, t)}</strong>
        <UiButton className="secondary" disabled={busy || ownerOnly} onClick={onSave} type="button">
          {t("settings.savePolicy")}
        </UiButton>
      </div>
      <div className="policy-rows">
        {group.policies.map((policy) => (
          <div className="policy-row" key={policy.provider}>
            <strong>{policy.label}</strong>
            <label>
              <input
                checked={policy.enabledForMatching}
                disabled={busy || ownerOnly}
                onChange={(event) => update(policy.provider, { enabledForMatching: event.target.checked })}
                type="checkbox"
              />
              <span>{t("settings.matching")}</span>
            </label>
            <FormInput
              disabled={busy || ownerOnly}
              min={1}
              onChange={(event) => update(policy.provider, { matchingPriority: Number(event.target.value) })}
              type="number"
              value={String(policy.matchingPriority)}
            />
            <label>
              <input
                checked={policy.enabledForPresentation}
                disabled={busy || ownerOnly}
                onChange={(event) => update(policy.provider, { enabledForPresentation: event.target.checked })}
                type="checkbox"
              />
              <span>{t("settings.presentation")}</span>
            </label>
            <FormInput
              disabled={busy || ownerOnly}
              min={1}
              onChange={(event) => update(policy.provider, { presentationPriority: Number(event.target.value) })}
              type="number"
              value={String(policy.presentationPriority)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function providerCredentialText(status: ProviderSettings, t: TFunction) {
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

function languageLabel(value: string, t: TFunction) {
  return languageOptions(t).find((option) => option.value === value)?.label ?? value;
}

function mediaTypeLabel(mediaType: "MOVIE" | "TV_SERIES", t: TFunction) {
  return mediaType === "TV_SERIES" ? t("common.series") : t("common.movie");
}
