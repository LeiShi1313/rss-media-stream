import { FormEvent, useEffect, useState } from "react";
import { Globe2, KeyRound } from "lucide-react";
import { api, type TmdbSettings, type Workspace } from "../api.js";
import { Pill, StatusPill } from "../components/common/feedback.js";
import { Panel } from "../components/common/surfaces.js";
import { FieldLabel, FormInput, SelectField, UiButton } from "../components/ui/index.js";
import type { RunAction } from "../types.js";

const languageOptions = [
  { value: "en-US", label: "English (US)" },
  { value: "zh-CN", label: "Chinese Simplified" },
  { value: "zh-TW", label: "Chinese Traditional" },
  { value: "ja-JP", label: "Japanese" },
  { value: "ko-KR", label: "Korean" },
  { value: "fr-FR", label: "French" },
  { value: "de-DE", label: "German" },
  { value: "es-ES", label: "Spanish" }
];

export function SettingsPage({
  busy,
  runAction,
  workspace
}: {
  busy: boolean;
  runAction: RunAction;
  workspace: Workspace | null;
}) {
  const [settings, setSettings] = useState<TmdbSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [tmdbLanguage, setTmdbLanguage] = useState("en-US");
  const [webLanguage, setWebLanguage] = useState("en-US");

  async function loadSettings() {
    const nextSettings = await api<TmdbSettings>("/api/settings");
    setSettings(nextSettings);
    setTmdbLanguage(nextSettings.tmdbLanguage ?? "en-US");
    setWebLanguage(nextSettings.webLanguage ?? "en-US");
    document.documentElement.lang = nextSettings.webLanguage ?? "en-US";
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
      <Panel title="TMDB integration" icon={<KeyRound size={19} />}>
        <div className="integration-panel">
          <div className="integration-status">
            <div>
              <strong>{settings?.configured ? "TMDB is connected" : "TMDB is not connected"}</strong>
              <span>
                {settings?.source === "workspace"
                  ? "Using this workspace's encrypted TMDB credential"
                  : settings?.source === "environment"
                    ? "Using the server environment TMDB credential"
                    : "Add a TMDB key or read access token to enable real media matching"}
              </span>
            </div>
            <StatusPill ok={Boolean(settings?.configured)}>
              {settings?.configured ? "Configured" : "Missing"}
            </StatusPill>
          </div>
          <form className="settings-form" onSubmit={saveSettings}>
            <FieldLabel>
              TMDB API key or read access token
              <FormInput
                autoComplete="off"
                disabled={busy || ownerOnly}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={settings?.configured ? "Paste a new key to replace the current one" : "Paste TMDB key or read access token"}
                type="password"
                value={apiKey}
              />
            </FieldLabel>
            <FieldLabel>
              TMDB media language
              <SelectField disabled={busy || ownerOnly} onValueChange={setTmdbLanguage} options={languageOptions} value={tmdbLanguage} />
            </FieldLabel>
            <FieldLabel>
              Web language
              <SelectField disabled={busy || ownerOnly} onValueChange={setWebLanguage} options={languageOptions} value={webLanguage} />
            </FieldLabel>
            <div className="form-actions">
              <UiButton className="primary" disabled={busy || ownerOnly}>
                Save settings
              </UiButton>
              <UiButton
                className="secondary"
                disabled={busy || ownerOnly || settings?.source !== "workspace"}
                onClick={() => void removeTmdbKey()}
                type="button"
              >
                Remove TMDB key
              </UiButton>
            </div>
          </form>
          <div className="integration-meta">
            <Pill>{languageLabel(tmdbLanguage)} TMDB metadata</Pill>
            <Pill>{languageLabel(webLanguage)} web UI</Pill>
            {settings?.lastValidatedAt && <span>Validated {new Date(settings.lastValidatedAt).toLocaleString()}</span>}
            {settings?.lastError && <span>{settings.lastError}</span>}
          </div>
        </div>
      </Panel>
      <Panel title="Language behavior" icon={<Globe2 size={19} />}>
        <div className="settings-note">
          <strong>TMDB media language changes future TMDB searches and cached metadata.</strong>
          <span>Changing it clears this workspace's TMDB cache so new searches use the selected language.</span>
          <strong>Web language is saved as the workspace UI preference.</strong>
          <span>The document language updates immediately; translated copy can be layered onto this setting later.</span>
        </div>
      </Panel>
    </div>
  );
}

function languageLabel(value: string) {
  return languageOptions.find((option) => option.value === value)?.label ?? value;
}
