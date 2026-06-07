import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, DownloadCloud, Pencil, Plus, ServerCog } from "lucide-react";
import { api, type Downloader } from "../api.js";
import type { ActionResult, RunAction } from "../types.js";
import { CheckboxField, FieldLabel, FormInput, SelectField, UiButton } from "../components/ui/index.js";
import { Empty, Pill, StatusPill } from "../components/common/feedback.js";
import { DistributionBars, EndpointStatusGrid } from "../components/common/charts.js";
import { Modal, Panel } from "../components/common/surfaces.js";
import { optionalText, stringListFromInput } from "../lib/forms.js";

export function DownloadersPage({
  busy,
  downloaders,
  runAction
}: {
  busy: boolean;
  downloaders: Downloader[];
  runAction: RunAction;
}) {
  const { t } = useTranslation();
  const [downloaderModal, setDownloaderModal] = useState<Downloader | "new" | null>(null);

  return (
    <div className="page-stack">
      <section className="overview-insight-grid">
        <Panel title={t("downloaders.dispatchVolume")} icon={<DownloadCloud size={19} />}>
          <DistributionBars
            entries={downloaders.map((downloader) => ({
              label: downloader.name,
              value: downloader.jobCount ?? 0,
              detail: downloader.type,
              tone: downloader.enabled ? "accent" : "neutral"
            }))}
            emptyLabel={t("downloaders.emptyJobs")}
          />
        </Panel>
        <Panel title={t("downloaders.endpointStatus")} icon={<ServerCog size={19} />}>
          <EndpointStatusGrid downloaders={downloaders} />
        </Panel>
      </section>
      <Panel
        title={t("downloaders.endpoints")}
        icon={<ServerCog size={19} />}
        actions={
          <UiButton className="primary" disabled={busy} onClick={() => setDownloaderModal("new")}>
            <Plus size={17} />
            {t("downloaders.addDownloader")}
          </UiButton>
        }
      >
        <div className="list">
          {downloaders.length === 0 && <Empty label={t("downloaders.noEndpoints")} />}
          {downloaders.map((downloader) => (
            <article className="row-card downloader-card" key={downloader.id}>
              <div>
                <strong>{downloader.name}</strong>
                <span>{downloader.type} · {downloader.baseUrl}</span>
                <small>{t("downloaders.jobs", { count: downloader.jobCount ?? 0 })}{downloader.tags?.length ? ` · ${downloader.tags.join(", ")}` : ""}</small>
              </div>
              <div className="row-actions">
                {downloader.isDefault && <Pill>{t("downloaders.default")}</Pill>}
                <StatusPill ok={downloader.enabled}>{downloader.enabled ? t("common.enabled") : t("common.disabled")}</StatusPill>
                <UiButton className="secondary" disabled={busy} onClick={() => setDownloaderModal(downloader)}>
                  <Pencil size={16} />
                  {t("common.edit")}
                </UiButton>
                {!downloader.isDefault && (
                  <UiButton
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      runAction(() =>
                        api("/api/downloaders/default", {
                          method: "PUT",
                          body: JSON.stringify({ downloaderId: downloader.id })
                        })
                      )
                    }
                  >
                    {t("downloaders.makeDefault")}
                  </UiButton>
                )}
                <UiButton
                  className="secondary"
                  disabled={busy}
                  onClick={() => runAction(() => api(`/api/downloaders/${downloader.id}/test`, { method: "POST" }))}
                >
                  {t("common.test")}
                </UiButton>
              </div>
            </article>
          ))}
        </div>
      </Panel>
      {downloaderModal && (
        <Modal
          title={downloaderModal === "new" ? t("downloaders.addDownloader") : t("downloaders.editDownloader")}
          onClose={() => setDownloaderModal(null)}
        >
          <DownloaderModalForm
            busy={busy}
            downloader={downloaderModal === "new" ? undefined : downloaderModal}
            onCancel={() => setDownloaderModal(null)}
            onSubmit={async (body) => {
              const result = await runAction(async () => {
                if (downloaderModal === "new") {
                  await api("/api/downloaders", { method: "POST", body });
                } else {
                  await api(`/api/downloaders/${downloaderModal.id}`, { method: "PATCH", body });
                }
              });
              if (result.ok) setDownloaderModal(null);
              return result;
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function DownloaderModalForm({
  busy,
  downloader,
  onCancel,
  onSubmit
}: {
  busy: boolean;
  downloader?: Downloader;
  onCancel: () => void;
  onSubmit: (body: string) => Promise<ActionResult>;
}) {
  const { t } = useTranslation();
  const editing = Boolean(downloader);
  const [type, setType] = useState<Downloader["type"]>(downloader?.type ?? "QBITTORRENT");
  const [name, setName] = useState(downloader?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(downloader?.baseUrl ?? "");
  const [username, setUsername] = useState(downloader?.username ?? "");
  const [password, setPassword] = useState("");
  const [defaultSavePath, setDefaultSavePath] = useState(downloader?.defaultSavePath ?? "");
  const [category, setCategory] = useState(downloader?.category ?? "");
  const [tags, setTags] = useState((downloader?.tags ?? []).join(", "));
  const [enabled, setEnabled] = useState(downloader?.enabled ?? true);
  const [submitError, setSubmitError] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    setTestResult(null);
  }, [baseUrl, category, defaultSavePath, enabled, name, password, tags, type, username]);

  function payload(includeId = false) {
    return {
      ...(includeId && downloader?.id ? { id: downloader.id } : {}),
      type,
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      username: optionalText(username),
      defaultSavePath: optionalText(defaultSavePath),
      category: optionalText(category),
      tags: stringListFromInput(tags),
      enabled,
      ...(password.trim() ? { password: password.trim() } : {})
    };
  }

  async function testConnection() {
    setTestResult(null);
    if (!name.trim() || !baseUrl.trim()) {
      setTestResult({ ok: false, message: t("downloaders.nameBaseRequired") });
      return;
    }

    setTestBusy(true);
    try {
      const result = await api<{ ok: true; version?: string }>("/api/downloaders/test", {
        method: "POST",
        body: JSON.stringify(payload(true))
      });
      setTestResult({
        ok: true,
        message: result.version ? t("downloaders.connectionSucceededVersion", { version: result.version }) : t("downloaders.connectionSucceeded")
      });
    } catch (err) {
      setTestResult({ ok: false, message: errorMessage(err) });
    } finally {
      setTestBusy(false);
    }
  }

  return (
    <form
      className="modal-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setSubmitError("");
        const result = await onSubmit(JSON.stringify(payload()));
        if (!result.ok) setSubmitError(result.message);
      }}
    >
      <div className="form-grid">
        <div className="field">
          <span>{t("common.type")}</span>
          <SelectField
            value={type}
            onValueChange={(value) => setType(value as Downloader["type"])}
            options={[
              { value: "QBITTORRENT", label: "qBittorrent" },
              { value: "TRANSMISSION", label: "Transmission" }
            ]}
          />
        </div>
        <FieldLabel>
          {t("common.name")}
          <FormInput value={name} onChange={(event) => setName(event.target.value)} required />
        </FieldLabel>
      </div>
      <FieldLabel>
        {t("common.baseUrl")}
        <FormInput placeholder="http://localhost:8080" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required />
      </FieldLabel>
      <div className="form-grid">
        <FieldLabel>
          {t("common.username")}
          <FormInput value={username} onChange={(event) => setUsername(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          {t("common.password")}
          <FormInput
            placeholder={editing ? t("downloaders.leavePassword") : ""}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
          />
        </FieldLabel>
      </div>
      <div className="form-grid">
        <FieldLabel>
          {t("downloaders.savePath")}
          <FormInput value={defaultSavePath} onChange={(event) => setDefaultSavePath(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          {t("common.category")}
          <FormInput value={category} onChange={(event) => setCategory(event.target.value)} />
        </FieldLabel>
      </div>
      <FieldLabel>
        {t("common.tags")}
        <FormInput placeholder={t("downloaders.tagPlaceholder")} value={tags} onChange={(event) => setTags(event.target.value)} />
      </FieldLabel>
      <CheckboxField className="checkbox-row" checked={enabled} onCheckedChange={setEnabled} label={t("common.enabled")} />
      {testResult && (
        <p className={testResult.ok ? "modal-feedback success" : "modal-feedback error"}>
          {testResult.message}
        </p>
      )}
      {submitError && <p className="modal-feedback error">{submitError}</p>}
      <div className="modal-actions">
        <UiButton className="secondary" onClick={onCancel} type="button">
          {t("common.cancel")}
        </UiButton>
        <UiButton className="secondary" disabled={busy || testBusy} onClick={() => void testConnection()} type="button">
          <ServerCog size={17} />
          {testBusy ? t("downloaders.testing") : t("downloaders.testConnection")}
        </UiButton>
        <UiButton className="primary" disabled={busy} type="submit">
          {editing ? <Pencil size={17} /> : <Plus size={17} />}
          {editing ? t("downloaders.saveDownloader") : t("downloaders.addDownloader")}
        </UiButton>
      </div>
    </form>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
