import { FormEvent, useEffect, useState } from "react";
import { Globe2, KeyRound } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { api, type TmdbSettings, type Workspace } from "../api.js";
import { Pill, StatusPill } from "../components/common/feedback.js";
import { Panel } from "../components/common/surfaces.js";
import { FieldLabel, FormInput, SelectField, UiButton } from "../components/ui/index.js";
import type { RunAction } from "../types.js";
import { applyUiLanguage, normalizeUiLanguage } from "../i18n.js";

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
  const tmdbLanguageOptions = languageOptions(t);
  const webLanguageOptions = [
    { value: "en-US", label: t("settings.languages.enUS") },
    { value: "zh-CN", label: t("settings.languages.zhCN") }
  ];
  const [settings, setSettings] = useState<TmdbSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [tmdbLanguage, setTmdbLanguage] = useState("en-US");
  const [webLanguage, setWebLanguage] = useState("en-US");

  async function loadSettings() {
    const nextSettings = await api<TmdbSettings>("/api/settings");
    setSettings(nextSettings);
    setTmdbLanguage(nextSettings.tmdbLanguage ?? "en-US");
    const nextWebLanguage = await applyUiLanguage(nextSettings.webLanguage);
    setWebLanguage(nextWebLanguage);
  }

  useEffect(() => {
    void loadSettings();
  }, []);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await runAction(() =>
      api<TmdbSettings>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          ...(apiKey.trim() ? { apiKey } : {}),
          tmdbLanguage,
          webLanguage
        })
      })
    );
    if (result.ok) {
      await applyUiLanguage(webLanguage);
      setApiKey("");
      await loadSettings();
    }
  }

  async function removeTmdbKey() {
    const result = await runAction(() =>
      api<TmdbSettings>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ apiKey: "", tmdbLanguage, webLanguage })
      })
    );
    if (result.ok) {
      setApiKey("");
      await loadSettings();
    }
  }

  const ownerOnly = workspace?.role !== "OWNER";

  return (
    <div className="page-stack">
      <Panel title={t("settings.tmdbIntegration")} icon={<KeyRound size={19} />}>
        <div className="integration-panel">
          <div className="integration-status">
            <div>
              <strong>{settings?.configured ? t("settings.connected") : t("settings.notConnected")}</strong>
              <span>
                {settings?.source === "workspace"
                  ? t("settings.workspaceCredential")
                  : settings?.source === "environment"
                    ? t("settings.environmentCredential")
                    : t("settings.addCredential")}
              </span>
            </div>
            <StatusPill ok={Boolean(settings?.configured)}>
              {settings?.configured ? t("common.configured") : t("common.missing")}
            </StatusPill>
          </div>
          <form className="settings-form" onSubmit={saveSettings}>
            <FieldLabel>
              {t("settings.credentialLabel")}
              <FormInput
                autoComplete="off"
                disabled={busy || ownerOnly}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={settings?.configured ? t("settings.replaceCredential") : t("settings.credentialPlaceholder")}
                type="password"
                value={apiKey}
              />
            </FieldLabel>
            <FieldLabel>
              {t("settings.tmdbLanguage")}
              <SelectField disabled={busy || ownerOnly} onValueChange={setTmdbLanguage} options={tmdbLanguageOptions} value={tmdbLanguage} />
            </FieldLabel>
            <FieldLabel>
              {t("settings.webLanguage")}
              <SelectField disabled={busy || ownerOnly} onValueChange={(value) => setWebLanguage(normalizeUiLanguage(value))} options={webLanguageOptions} value={webLanguage} />
            </FieldLabel>
            <div className="form-actions">
              <UiButton className="primary" disabled={busy || ownerOnly}>
                {t("settings.saveSettings")}
              </UiButton>
              <UiButton
                className="secondary"
                disabled={busy || ownerOnly || settings?.source !== "workspace"}
                onClick={() => void removeTmdbKey()}
                type="button"
              >
                {t("settings.removeKey")}
              </UiButton>
            </div>
          </form>
          <div className="integration-meta">
            <Pill>{languageLabel(tmdbLanguage, t)} {t("settings.metadata")}</Pill>
            <Pill>{languageLabel(webLanguage, t)} {t("common.webUi")}</Pill>
            {settings?.lastValidatedAt && <span>{t("common.validatedAt", { date: new Date(settings.lastValidatedAt).toLocaleString() })}</span>}
            {settings?.lastError && <span>{settings.lastError}</span>}
          </div>
        </div>
      </Panel>
      <Panel title={t("settings.languageBehavior")} icon={<Globe2 size={19} />}>
        <div className="settings-note">
          <strong>{t("settings.tmdbBehaviorTitle")}</strong>
          <span>{t("settings.tmdbBehaviorBody")}</span>
          <strong>{t("settings.webBehaviorTitle")}</strong>
          <span>{t("settings.webBehaviorBody")}</span>
        </div>
      </Panel>
    </div>
  );
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
