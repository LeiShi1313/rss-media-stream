import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Plus, Search, ServerCog } from "lucide-react";
import type { DownloaderDto, DownloaderTestDto } from "@rss-media/shared/apiContracts";
import { api } from "../api.js";
import type { ActionResult, RunAction } from "../types.js";
import { CheckboxField, FieldLabel, FormInput, SelectField, UiButton } from "../components/ui/index.js";
import { Empty } from "../components/common/feedback.js";
import { Modal } from "../components/common/surfaces.js";
import { filterByQuery, optionalText, stringListFromInput } from "../lib/forms.js";
import { errorMessage } from "../lib/format.js";

export function DownloadersPage({
  busy,
  downloaders,
  runAction
}: {
  busy: boolean;
  downloaders: DownloaderDto[];
  runAction: RunAction;
}) {
  const { t } = useTranslation();
  const [downloaderModal, setDownloaderModal] = useState<DownloaderDto | "new" | null>(null);
  const [query, setQuery] = useState("");
  const filteredDownloaders = useMemo(
    () => filterByQuery(downloaders, query, (downloader) => [
      downloader.name,
      downloader.type,
      downloader.baseUrl,
      downloader.category,
      ...(downloader.tags ?? [])
    ]),
    [downloaders, query]
  );

  return (
    <div className="management-workbench">
      <section className="management-command" aria-label={t("downloaders.endpoints")}>
        <div className="management-command-left">
          <FieldLabel className="search-control management-search">
            <span className="sr-only">{t("downloaders.searchDownloaders")}</span>
            <Search size={16} />
            <FormInput
              aria-label={t("downloaders.searchDownloaders")}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("downloaders.searchDownloaders")}
              type="search"
              value={query}
            />
          </FieldLabel>
          <span className="management-count">{t("downloaders.endpointCount", { count: downloaders.length })}</span>
        </div>
        <UiButton className="primary" disabled={busy} onClick={() => setDownloaderModal("new")}>
          <Plus size={17} />
          {t("downloaders.addDownloader")}
        </UiButton>
      </section>

      <section className="management-table" role="table" aria-label={t("downloaders.endpoints")}>
        <div className="management-table-head downloader-table-head" role="row">
          <span role="columnheader">{t("downloaders.endpoint")}</span>
          <span role="columnheader">{t("common.type")}</span>
          <span role="columnheader">{t("common.baseUrl")}</span>
          <span role="columnheader">{t("downloaders.jobsColumn")}</span>
          <span role="columnheader">{t("common.tags")}</span>
          <span role="columnheader">{t("downloaders.default")}</span>
          <span role="columnheader">{t("downloaders.actions")}</span>
        </div>
        {downloaders.length === 0 && <Empty label={t("downloaders.noEndpoints")} />}
        {downloaders.length > 0 && filteredDownloaders.length === 0 && <Empty label={t("downloaders.noMatchingEndpoints")} />}
        {filteredDownloaders.map((downloader) => (
          <article className="management-table-row downloader-table-row" key={downloader.id} role="row">
            <div className="management-primary-cell" role="cell">
              <strong>{downloader.name}</strong>
              <span>{[downloader.enabled ? t("common.enabled") : t("common.disabled"), downloader.category].filter(Boolean).join(" · ")}</span>
            </div>
            <span role="cell">{downloader.type}</span>
            <code role="cell">{downloader.baseUrl}</code>
            <strong role="cell">{downloader.jobCount ?? 0}</strong>
            <span role="cell">{downloader.tags?.length ? downloader.tags.join(", ") : t("downloaders.noTags")}</span>
            <span role="cell">{downloader.isDefault ? t("downloaders.default") : t("downloaders.notDefault")}</span>
            <div className="row-actions" role="cell">
              <UiButton
                aria-label={t("downloaders.editDownloaderNamed", { name: downloader.name })}
                className="icon-button"
                disabled={busy}
                onClick={() => setDownloaderModal(downloader)}
                title={t("common.edit")}
              >
                <Pencil size={16} />
              </UiButton>
              {!downloader.isDefault && (
                <UiButton
                  className="secondary compact-action"
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
                className="secondary compact-action"
                disabled={busy}
                onClick={() => runAction(() => api(`/api/downloaders/${downloader.id}/test`, { method: "POST" }))}
              >
                {t("common.test")}
              </UiButton>
            </div>
          </article>
        ))}
      </section>

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
  downloader?: DownloaderDto;
  onCancel: () => void;
  onSubmit: (body: string) => Promise<ActionResult>;
}) {
  const { t } = useTranslation();
  const editing = Boolean(downloader);
  const [type, setType] = useState<DownloaderDto["type"]>(downloader?.type ?? "QBITTORRENT");
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
      const result = await api<DownloaderTestDto>("/api/downloaders/test", {
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
            onValueChange={(value) => setType(value as DownloaderDto["type"])}
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
