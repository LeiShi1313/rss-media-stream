import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, Film, HardDrive, ListFilter, LogOut, RefreshCw, Rss, Settings, Shield, Users } from "lucide-react";
import {
  api,
  type AuthResponse,
  type Downloader,
  type DownloadJob,
  type Feed,
  type Item,
  type Subscription,
  type TrendingMedia,
  type User,
  type Workspace,
  type WorkspaceMember
} from "./api.js";
import { FieldLabel, FormInput, UiButton } from "./ui.js";
import { ActivityPage } from "./pages/activity.js";
import { DownloadersPage } from "./pages/downloaders.js";
import { OverviewPage } from "./pages/overview.js";
import { RssPage } from "./pages/rss.js";
import { SettingsPage } from "./pages/settings.js";
import { SubscriptionsPage } from "./pages/subscriptions.js";
import { WorkspacePage } from "./pages/workspace.js";
import { pageIds, type ActionResult, type PageId, type RunAction, type TimelinePoint } from "./types.js";
import { relativeTime } from "./lib/format.js";

export function App() {
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
      }
    } catch (err) {
      setSetupRequired(false);
      setUser(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (setupRequired === null) return <div className="boot">Loading</div>;

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
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="brand-row">
          <Rss size={28} />
          <div>
            <h1>RSS Media Stream</h1>
            <p>{setupRequired ? "Create the owner account" : "Sign in"}</p>
          </div>
        </div>
        <form onSubmit={submit} className="stack">
          <FieldLabel>
            Email
            <FormInput value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
          </FieldLabel>
          {setupRequired && (
            <FieldLabel>
              Name
              <FormInput value={name} onChange={(event) => setName(event.target.value)} required />
            </FieldLabel>
          )}
          <FieldLabel>
            Password
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
            {setupRequired ? "Create Owner" : "Sign In"}
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
  const [page, setPage] = useState<PageId>(() => readPageFromHash());
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [downloaders, setDownloaders] = useState<Downloader[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [trendingMedia, setTrendingMedia] = useState<TrendingMedia[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  useEffect(() => {
    const syncPage = () => setPage(readPageFromHash());
    window.addEventListener("hashchange", syncPage);
    syncPage();
    return () => window.removeEventListener("hashchange", syncPage);
  }, []);

  async function load() {
    const results = await Promise.allSettled([
      api<Feed[]>("/api/feeds"),
      api<Item[]>("/api/items?limit=120"),
      api<Downloader[]>("/api/downloaders"),
      api<TimelinePoint[]>("/api/dashboard/timeline"),
      loadSubscriptions(),
      api<DownloadJob[]>("/api/download-jobs"),
      api<WorkspaceMember[]>("/api/workspace/members"),
      api<TrendingMedia[]>("/api/media/trending?windowDays=7&limit=18")
    ]);

    applyResult(results[0], setFeeds);
    applyResult(results[1], setItems);
    applyResult(results[2], setDownloaders);
    applyResult(results[3], setTimeline);
    applyResult(results[4], setSubscriptions);
    applyResult(results[5], setJobs);
    applyResult(results[6], setMembers);
    applyResult(results[7], setTrendingMedia);

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
      matched: items.filter((item) => item.mediaMatch?.status === "MATCHED").length,
      feeds: feeds.filter((feed) => feed.enabled).length,
      jobs: jobs.length,
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

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <Rss size={26} />
          <div>
            <h1>RSS Media</h1>
            <p>{workspace ? `${workspace.name} · ${workspace.role}` : user.name}</p>
          </div>
        </div>
        <nav>
          <PageLink page="overview" active={page} icon={<Activity size={18} />} label="Overview" />
          <PageLink page="rss" active={page} icon={<Rss size={18} />} label="RSS" />
          <PageLink page="downloaders" active={page} icon={<HardDrive size={18} />} label="Downloaders" />
          <PageLink page="subscriptions" active={page} icon={<Film size={18} />} label="Subscriptions" />
          <PageLink page="activity" active={page} icon={<ListFilter size={18} />} label="Activity" />
          <PageLink page="workspace" active={page} icon={<Users size={18} />} label="Workspace" />
          <PageLink page="settings" active={page} icon={<Settings size={18} />} label="Settings" />
        </nav>
        <div className="sidebar-footer">
          <span>{user.email}</span>
          <UiButton className="ghost" onClick={onLogout}>
            <LogOut size={18} />
            Sign Out
          </UiButton>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <h2>{pageTitle(page)}</h2>
            <p>{pageSummary(page)}</p>
          </div>
          <div className="topbar-actions">
            {lastLoadedAt && <span>{relativeTime(lastLoadedAt)}</span>}
            <UiButton className="icon-button" onClick={() => void load()} title="Refresh dashboard">
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
            trendingMedia={trendingMedia}
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

function PageLink({
  page,
  active,
  icon,
  label
}: {
  page: PageId;
  active: PageId;
  icon: ReactNode;
  label: string;
}) {
  return (
    <a className={active === page ? "active" : undefined} href={`#${page}`}>
      {icon}
      {label}
    </a>
  );
}

function readPageFromHash(): PageId {
  const value = window.location.hash.replace(/^#/, "");
  return pageIds.includes(value as PageId) ? (value as PageId) : "overview";
}

function pageTitle(page: PageId) {
  return {
    overview: "Overview",
    rss: "RSS Management",
    downloaders: "Downloader Management",
    subscriptions: "Subscription Management",
    activity: "Activity",
    workspace: "Workspace",
    settings: "Settings"
  }[page];
}

function pageSummary(page: PageId) {
  return {
    overview: "Review new releases, verify matches, and dispatch downloads",
    rss: "Private tracker feeds, polling cadence, and refresh status",
    downloaders: "Tenant-level qBittorrent and Transmission endpoints",
    subscriptions: "Rule-based media subscriptions and auto-download criteria",
    activity: "Download jobs, ingestion rate, and failure visibility",
    workspace: "Tenant context, members, and workspace-level status",
    settings: "TMDB credentials, media language, and web language"
  }[page];
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
