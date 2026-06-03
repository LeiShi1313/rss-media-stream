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
  const [downloaderModal, setDownloaderModal] = useState<Downloader | "new" | null>(null);

  return (
    <div className="page-stack">
      <section className="overview-insight-grid">
        <Panel title="Dispatch volume" icon={<DownloadCloud size={19} />}>
          <DistributionBars
            entries={downloaders.map((downloader) => ({
              label: downloader.name,
              value: downloader.jobCount ?? 0,
              detail: downloader.type,
              tone: downloader.enabled ? "accent" : "neutral"
            }))}
            emptyLabel="No downloader jobs yet"
          />
        </Panel>
        <Panel title="Endpoint status" icon={<ServerCog size={19} />}>
          <EndpointStatusGrid downloaders={downloaders} />
        </Panel>
      </section>
      <Panel
        title="Downloader Endpoints"
        icon={<ServerCog size={19} />}
        actions={
          <UiButton className="primary" disabled={busy} onClick={() => setDownloaderModal("new")}>
            <Plus size={17} />
            Add Downloader
          </UiButton>
        }
      >
        <div className="list">
          {downloaders.length === 0 && <Empty label="No downloader endpoints configured" />}
          {downloaders.map((downloader) => (
            <article className="row-card downloader-card" key={downloader.id}>
              <div>
                <strong>{downloader.name}</strong>
                <span>{downloader.type} · {downloader.baseUrl}</span>
                <small>{downloader.jobCount ?? 0} jobs{downloader.tags?.length ? ` · ${downloader.tags.join(", ")}` : ""}</small>
              </div>
              <div className="row-actions">
                {downloader.isDefault && <Pill>Default</Pill>}
                <StatusPill ok={downloader.enabled}>{downloader.enabled ? "Enabled" : "Disabled"}</StatusPill>
                <UiButton className="secondary" disabled={busy} onClick={() => setDownloaderModal(downloader)}>
                  <Pencil size={16} />
                  Edit
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
                    Make Default
                  </UiButton>
                )}
                <UiButton
                  className="secondary"
                  disabled={busy}
                  onClick={() => runAction(() => api(`/api/downloaders/${downloader.id}/test`, { method: "POST" }))}
                >
                  Test
                </UiButton>
              </div>
            </article>
          ))}
        </div>
      </Panel>
      {downloaderModal && (
        <Modal
          title={downloaderModal === "new" ? "Add Downloader" : "Edit Downloader"}
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
      setTestResult({ ok: false, message: "Name and base URL are required before testing." });
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
        message: result.version ? `Connection succeeded: ${result.version}` : "Connection succeeded."
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
          <span>Type</span>
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
          Name
          <FormInput value={name} onChange={(event) => setName(event.target.value)} required />
        </FieldLabel>
      </div>
      <FieldLabel>
        Base URL
        <FormInput placeholder="http://localhost:8080" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required />
      </FieldLabel>
      <div className="form-grid">
        <FieldLabel>
          Username
          <FormInput value={username} onChange={(event) => setUsername(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          Password
          <FormInput
            placeholder={editing ? "Leave blank to keep current password" : ""}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
          />
        </FieldLabel>
      </div>
      <div className="form-grid">
        <FieldLabel>
          Save path
          <FormInput value={defaultSavePath} onChange={(event) => setDefaultSavePath(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          Category
          <FormInput value={category} onChange={(event) => setCategory(event.target.value)} />
        </FieldLabel>
      </div>
      <FieldLabel>
        Tags
        <FormInput placeholder="movies, private" value={tags} onChange={(event) => setTags(event.target.value)} />
      </FieldLabel>
      <CheckboxField className="checkbox-row" checked={enabled} onCheckedChange={setEnabled} label="Enabled" />
      {testResult && (
        <p className={testResult.ok ? "modal-feedback success" : "modal-feedback error"}>
          {testResult.message}
        </p>
      )}
      {submitError && <p className="modal-feedback error">{submitError}</p>}
      <div className="modal-actions">
        <UiButton className="secondary" onClick={onCancel} type="button">
          Cancel
        </UiButton>
        <UiButton className="secondary" disabled={busy || testBusy} onClick={() => void testConnection()} type="button">
          <ServerCog size={17} />
          {testBusy ? "Testing" : "Test Connection"}
        </UiButton>
        <UiButton className="primary" disabled={busy} type="submit">
          {editing ? <Pencil size={17} /> : <Plus size={17} />}
          {editing ? "Save Downloader" : "Add Downloader"}
        </UiButton>
      </div>
    </form>
  );
}

