import { FormEvent, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Rss, Shield } from "lucide-react";
import {
  api,
  type AuthResponse,
  type Downloader,
  type DownloadJob,
  type Feed,
  type Item,
  type ItemPage,
  type Subscription,
  type User,
  type Workspace,
  type WorkspaceSettings,
  type WorkspaceMember
} from "./api.js";
import { FieldLabel, FormInput, UiButton } from "./components/ui/index.js";
import { ActivityPage } from "./pages/activity.js";
import { DownloadersPage } from "./pages/downloaders.js";
import { OverviewPage } from "./pages/overview.js";
import { RssPage } from "./pages/rss.js";
import { SettingsPage } from "./pages/settings.js";
import { SubscriptionsPage } from "./pages/subscriptions.js";
import { WorkspacePage } from "./pages/workspace.js";
import { pageIds, type ActionResult, type PageId, type RunAction, type TimelinePoint } from "./types.js";
import { errorMessage, relativeTime } from "./lib/format.js";
import { applyUiLanguage, normalizeUiLanguage } from "./i18n.js";
import { AppSidebar } from "./components/layout/app-sidebar.js";

export function App() {
  const { t } = useTranslation();
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void bootstrap();
  }, []);

  async function bootstrap() {
    try {
      const setup = await api<{ required: boolean }>("/api/setup/status");
      setSetupRequired(setup.required);
      if (!setup.required) {
        const session = await api<AuthResponse>("/api/me");
        setUser(session.user);
        setWorkspace(session.activeWorkspace ?? session.workspace ?? session.workspaces?.[0] ?? null);
        void syncUiLanguageFromSettings();
      }
    } catch (err) {
      setSetupRequired(false);
      setUser(null);
      setError(errorMessage(err));
    }
  }

  if (setupRequired === null) return <div className="boot">{t("common.loading")}</div>;

  if (setupRequired || !user) {
    return (
      <AuthScreen
        setupRequired={setupRequired}
        error={error}
        onError={setError}
        onDone={(session) => {
          setUser(session.user);
          setWorkspace(session.activeWorkspace ?? session.workspace ?? session.workspaces?.[0] ?? null);
          setSetupRequired(false);
          setError("");
          void syncUiLanguageFromSettings();
        }}
      />
    );
  }

  return (
    <Dashboard
      user={user}
      workspace={workspace}
      onLogout={async () => {
        await api("/api/logout", { method: "POST" });
        setUser(null);
        setWorkspace(null);
      }}
    />
  );
}

function AuthScreen({
  setupRequired,
  error,
  onError,
  onDone
}: {
  setupRequired: boolean;
  error: string;
  onError: (value: string) => void;
  onDone: (session: AuthResponse) => void;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const session = await api<AuthResponse>(setupRequired ? "/api/setup" : "/api/login", {
        method: "POST",
        body: JSON.stringify(setupRequired ? { email, name, password } : { email, password })
      });
      onDone(session);
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="brand-row">
          <Rss size={28} />
          <div>
            <h1>{t("app.brandFull")}</h1>
            <p>{setupRequired ? t("app.createOwnerAccount") : t("app.signIn")}</p>
          </div>
        </div>
        <form onSubmit={submit} className="stack">
          <FieldLabel>
            {t("app.email")}
            <FormInput value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
          </FieldLabel>
          {setupRequired && (
            <FieldLabel>
              {t("app.ownerName")}
              <FormInput value={name} onChange={(event) => setName(event.target.value)} required />
            </FieldLabel>
          )}
          <FieldLabel>
            {t("common.password")}
            <FormInput
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              minLength={setupRequired ? 10 : 1}
              required
            />
          </FieldLabel>
          {error && <p className="error">{error}</p>}
          <UiButton className="primary" type="submit">
            <Shield size={18} />
            {setupRequired ? t("app.createOwner") : t("app.signIn")}
          </UiButton>
        </form>
      </section>
    </main>
  );
}

function Dashboard({
  user,
  workspace,
  onLogout
}: {
  user: User;
  workspace: Workspace | null;
  onLogout: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState<PageId>(() => readPageFromHash());
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [downloaders, setDownloaders] = useState<Downloader[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const uiLanguage = normalizeUiLanguage(i18n.language);
  const pageCopy = {
    title: t(`page.${page}.title`),
    summary: t(`page.${page}.summary`)
  };

  useEffect(() => {
    const syncPage = () => setPage(readPageFromHash());
    window.addEventListener("hashchange", syncPage);
    syncPage();
    return () => window.removeEventListener("hashchange", syncPage);
  }, []);

  async function load() {
    const results = await Promise.allSettled([
      api<Feed[]>("/api/feeds"),
      api<ItemPage>("/api/items?limit=120"),
      api<Downloader[]>("/api/downloaders"),
      api<TimelinePoint[]>("/api/dashboard/timeline"),
      loadSubscriptions(),
      api<DownloadJob[]>("/api/download-jobs"),
      api<WorkspaceMember[]>("/api/workspace/members")
    ] as const);

    applyResult(results[0], setFeeds);
    if (results[1].status === "fulfilled") setItems(results[1].value.items);
    applyResult(results[2], setDownloaders);
    applyResult(results[3], setTimeline);
    applyResult(results[4], setSubscriptions);
    applyResult(results[5], setJobs);
    applyResult(results[6], setMembers);

    const firstError = results.find((result) => result.status === "rejected");
    setError(firstError?.status === "rejected" ? errorMessage(firstError.reason) : "");
    setLastLoadedAt(new Date());
  }

  useEffect(() => {
    void load();
    const events = new EventSource("/events", { withCredentials: true });
    events.addEventListener("feed.refresh", () => void load());
    events.addEventListener("download.sent", () => void load());
    events.addEventListener("download.failed", () => void load());
    events.addEventListener("download.skipped", () => void load());
    return () => events.close();
  }, []);

  const stats = useMemo(
    () => ({
      totalItems: items.length,
      matched: items.filter((item) => item.match?.status === "MATCHED" && !item.match.attention.required).length,
      feeds: feeds.filter((feed) => feed.enabled).length,
      failedJobs: jobs.filter((job) => job.status === "FAILED").length,
      subscriptions: subscriptions.filter((subscription) => subscription.enabled).length,
      downloaders: downloaders.filter((downloader) => downloader.enabled).length
    }),
    [downloaders, feeds, items, jobs, subscriptions]
  );

  async function runAction(action: () => Promise<unknown>): Promise<ActionResult> {
    setBusy(true);
    try {
      await action();
      await load();
      return { ok: true };
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      return { ok: false, message };
    } finally {
      setBusy(false);
    }
  }

  async function changeUiLanguage(value: string) {
    const language = await applyUiLanguage(value);
    if (workspace?.role !== "OWNER") return;
    try {
      await api<WorkspaceSettings>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ webLanguage: language })
      });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <main className="app-shell">
      <AppSidebar
        accountEmail={user.email}
        activePage={page}
        contextLabel={workspace ? `${workspace.name} · ${workspace.role}` : user.name}
        language={uiLanguage}
        onLanguageChange={(value) => void changeUiLanguage(value)}
        onLogout={onLogout}
      />

      <section className="app-content">
        <header className="app-topbar">
          <div>
            <h1>{pageCopy.title}</h1>
            <p>{pageCopy.summary}</p>
          </div>
          <div className="app-topbar-actions">
            {lastLoadedAt && <span>{relativeTime(lastLoadedAt)}</span>}
            <UiButton className="icon-button" onClick={() => void load()} title={t("app.refreshDashboard")}>
              <RefreshCw size={18} />
            </UiButton>
          </div>
        </header>

        {error && <div className="notice">{error}</div>}

        {page === "overview" && (
          <OverviewPage
            busy={busy}
            downloaders={downloaders}
            items={items}
            stats={stats}
            runAction={runAction}
          />
        )}
        {page === "rss" && <RssPage busy={busy} feeds={feeds} runAction={runAction} />}
        {page === "downloaders" && (
          <DownloadersPage busy={busy} downloaders={downloaders} runAction={runAction} />
        )}
        {page === "subscriptions" && (
          <SubscriptionsPage
            busy={busy}
            downloaders={downloaders}
            feeds={feeds}
            items={items}
            subscriptions={subscriptions}
            runAction={runAction}
          />
        )}
        {page === "activity" && <ActivityPage jobs={jobs} timeline={timeline} />}
        {page === "workspace" && (
          <WorkspacePage
            user={user}
            workspace={workspace}
            members={members}
            stats={stats}
          />
        )}
        {page === "settings" && (
          <SettingsPage busy={busy} runAction={runAction} workspace={workspace} />
        )}
      </section>
    </main>
  );
}

function readPageFromHash(): PageId {
  const value = window.location.hash.replace(/^#/, "");
  return pageIds.includes(value as PageId) ? (value as PageId) : "overview";
}

async function syncUiLanguageFromSettings() {
  try {
    const settings = await api<WorkspaceSettings>("/api/settings");
    await applyUiLanguage(settings.webLanguage);
  } catch {
    // Keep the locally detected language if settings are unavailable.
  }
}

async function loadSubscriptions() {
  try {
    return await api<Subscription[]>("/api/subscriptions?scope=all");
  } catch {
    return api<Subscription[]>("/api/subscriptions");
  }
}

function applyResult<T>(
  result: PromiseSettledResult<T>,
  setter: (value: T) => void
) {
  if (result.status === "fulfilled") setter(result.value);
}

