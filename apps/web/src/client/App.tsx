import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  CalendarClock,
  CheckCircle2,
  Clock3,
  DownloadCloud,
  Film,
  HardDrive,
  ListFilter,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Rss,
  Search,
  ServerCog,
  Settings,
  Shield,
  Tv,
  Users,
  X,
  XCircle
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  api,
  type AuthResponse,
  type Downloader,
  type DownloadJob,
  type Feed,
  type Item,
  type MediaSearchResult,
  type Subscription,
  type User,
  type Workspace,
  type WorkspaceMember
} from "./api.js";

type HeatItem = { title: string; count: number; posterPath?: string; latest: string };
type PosterItem = { id: string; title: string; year?: number; kind: string; posterUrl: string; score: number };
type TimelinePoint = { time: string; count: number };
type PageId = "overview" | "rss" | "downloaders" | "subscriptions" | "activity" | "workspace";
type ActionResult = { ok: true } | { ok: false; message: string };
type RunAction = (action: () => Promise<unknown>) => Promise<ActionResult>;

const pageIds: PageId[] = ["overview", "rss", "downloaders", "subscriptions", "activity", "workspace"];
const defaultPollIntervalSeconds = 600;

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
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
          </label>
          {setupRequired && (
            <label>
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
          )}
          <label>
            Password
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              minLength={setupRequired ? 10 : 1}
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="primary" type="submit">
            <Shield size={18} />
            {setupRequired ? "Create Owner" : "Sign In"}
          </button>
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
  const [heat, setHeat] = useState<HeatItem[]>([]);
  const [posters, setPosters] = useState<PosterItem[]>([]);
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
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
      api<HeatItem[]>("/api/dashboard/heat"),
      api<PosterItem[]>("/api/dashboard/posters"),
      api<TimelinePoint[]>("/api/dashboard/timeline"),
      loadSubscriptions(),
      api<DownloadJob[]>("/api/download-jobs"),
      api<WorkspaceMember[]>("/api/workspace/members")
    ]);

    applyResult(results[0], setFeeds);
    applyResult(results[1], setItems);
    applyResult(results[2], setDownloaders);
    applyResult(results[3], setHeat);
    applyResult(results[4], setPosters);
    applyResult(results[5], setTimeline);
    applyResult(results[6], setSubscriptions);
    applyResult(results[7], setJobs);
    applyResult(results[8], setMembers);

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
          <PageLink page="workspace" active={page} icon={<Settings size={18} />} label="Workspace" />
        </nav>
        <div className="sidebar-footer">
          <span>{user.email}</span>
          <button className="ghost" onClick={onLogout}>
            <LogOut size={18} />
            Sign Out
          </button>
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
            <button className="icon-button" onClick={() => void load()} title="Refresh dashboard">
              <RefreshCw size={18} />
            </button>
          </div>
        </header>

        {error && <div className="notice">{error}</div>}

        {page === "overview" && (
          <OverviewPage
            busy={busy}
            downloaders={downloaders}
            heat={heat}
            items={items}
            posters={posters}
            stats={stats}
            timeline={timeline}
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
      </section>
    </main>
  );
}

function OverviewPage({
  busy,
  downloaders,
  heat,
  items,
  posters,
  stats,
  timeline,
  runAction
}: {
  busy: boolean;
  downloaders: Downloader[];
  heat: HeatItem[];
  items: Item[];
  posters: PosterItem[];
  stats: {
    totalItems: number;
    matched: number;
    feeds: number;
    jobs: number;
    failedJobs: number;
    subscriptions: number;
    downloaders: number;
  };
  timeline: TimelinePoint[];
  runAction: RunAction;
}) {
  const focusItem = items.find((item) => item.mediaMatch?.posterPath || item.mediaMatch?.backdropPath) ?? items[0];

  return (
    <div className="page-stack">
      <section className="overview-focus">
        {focusItem?.mediaMatch?.posterPath ? (
          <img src={tmdbImage(focusItem.mediaMatch.posterPath, "w342")} alt={focusItem.mediaMatch.title} />
        ) : (
          <div className="poster-placeholder"><Film size={34} /></div>
        )}
        <div>
          <span className="section-kicker">Latest matched release</span>
          <h3>{focusItem?.mediaMatch?.title ?? focusItem?.parsedRelease?.title ?? focusItem?.rawTitle ?? "No RSS items yet"}</h3>
          <p>{focusItem?.mediaMatch?.overview ?? focusItem?.rawTitle ?? "Add a private RSS feed and refresh it to populate the release timeline."}</p>
          <div className="token-row">
            {focusItem?.mediaMatch?.kind && <Pill>{focusItem.mediaMatch.kind}</Pill>}
            {focusItem?.mediaMatch?.year && <Pill>{focusItem.mediaMatch.year}</Pill>}
            {focusItem?.feed?.name && <Pill>{focusItem.feed.name}</Pill>}
            {focusItem?.mediaMatch?.score !== undefined && <Pill>{Math.round(focusItem.mediaMatch.score * 100)}%</Pill>}
          </div>
        </div>
      </section>

      <section className="metric-grid">
        <Metric label="RSS Items" value={stats.totalItems} icon={<Activity size={19} />} />
        <Metric label="Matched" value={stats.matched} icon={<Film size={19} />} />
        <Metric label="Feeds" value={stats.feeds} icon={<Rss size={19} />} />
        <Metric label="Jobs" value={stats.jobs} icon={<DownloadCloud size={19} />} />
      </section>

      <section className="overview-grid">
        <Panel title="RSS Title Timeline" icon={<CalendarClock size={19} />}>
          <ReleaseTimeline
            busy={busy}
            downloaders={downloaders}
            items={items}
            runAction={runAction}
          />
        </Panel>
        <div className="side-stack">
          <Panel title="Release Heat" icon={<Activity size={19} />}>
            <HeatList heat={heat} />
          </Panel>
          <Panel title="Hourly Intake" icon={<Clock3 size={19} />}>
            <TimelineBars timeline={timeline} />
          </Panel>
        </div>
      </section>

      <Panel title="Poster Wall" icon={<Film size={19} />}>
        <div className="poster-wall">
          {posters.length === 0 && <Empty label="Matched posters will appear here" />}
          {posters.map((poster) => (
            <article className="poster" key={poster.id}>
              <img src={poster.posterUrl} alt={poster.title} />
              <strong>{poster.title}</strong>
              <span>{poster.year ?? "Unknown"} · {Math.round(poster.score * 100)}%</span>
            </article>
          ))}
        </div>
        <p className="tmdb">Metadata and images are provided by TMDB.</p>
      </Panel>
    </div>
  );
}

function RssPage({
  busy,
  feeds,
  runAction
}: {
  busy: boolean;
  feeds: Feed[];
  runAction: RunAction;
}) {
  const [feedModal, setFeedModal] = useState<Feed | "new" | null>(null);

  return (
    <div className="page-stack">
      <Panel
        title="Feed Sources"
        icon={<ServerCog size={19} />}
        actions={
          <button className="primary" disabled={busy} onClick={() => setFeedModal("new")}>
            <Plus size={17} />
            Add Feed
          </button>
        }
      >
        <div className="list">
          {feeds.length === 0 && <Empty label="No RSS feeds configured" />}
          {feeds.map((feed) => (
            <article className="row-card feed-card" key={feed.id}>
              <div>
                <strong>{feed.name}</strong>
                <code>{feed.urlPreview}</code>
                <span>{feed.itemCount} items · poll every {feed.pollIntervalSeconds}s</span>
                {feed.lastError && <p className="error">{feed.lastError}</p>}
              </div>
              <div className="row-actions">
                <StatusPill ok={feed.enabled}>{feed.enabled ? "Enabled" : "Disabled"}</StatusPill>
                <button className="secondary" disabled={busy} onClick={() => setFeedModal(feed)}>
                  <Pencil size={16} />
                  Edit
                </button>
                <button
                  className="icon-button"
                  disabled={busy}
                  onClick={() => runAction(() => api(`/api/feeds/${feed.id}/refresh`, { method: "POST" }))}
                  title="Refresh feed"
                >
                  <RefreshCw size={17} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </Panel>
      {feedModal && (
        <Modal
          title={feedModal === "new" ? "Add RSS Feed" : "Edit RSS Feed"}
          onClose={() => setFeedModal(null)}
        >
          <FeedModalForm
            busy={busy}
            feed={feedModal === "new" ? undefined : feedModal}
            onCancel={() => setFeedModal(null)}
            onSubmit={async (body) => {
              const result = await runAction(async () => {
                if (feedModal === "new") {
                  await api("/api/feeds", { method: "POST", body });
                } else {
                  await api(`/api/feeds/${feedModal.id}`, { method: "PATCH", body });
                }
              });
              if (result.ok) setFeedModal(null);
              return result;
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function DownloadersPage({
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
      <Panel
        title="Downloader Endpoints"
        icon={<ServerCog size={19} />}
        actions={
          <button className="primary" disabled={busy} onClick={() => setDownloaderModal("new")}>
            <Plus size={17} />
            Add Downloader
          </button>
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
                <button className="secondary" disabled={busy} onClick={() => setDownloaderModal(downloader)}>
                  <Pencil size={16} />
                  Edit
                </button>
                {!downloader.isDefault && (
                  <button
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
                  </button>
                )}
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => runAction(() => api(`/api/downloaders/${downloader.id}/test`, { method: "POST" }))}
                >
                  Test
                </button>
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

function SubscriptionsPage({
  busy,
  downloaders,
  subscriptions,
  runAction
}: {
  busy: boolean;
  downloaders: Downloader[];
  subscriptions: Subscription[];
  runAction: RunAction;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null);

  return (
    <div className="page-stack">
      <Panel
        title="Subscription Rules"
        icon={<ListFilter size={19} />}
        actions={
          <button className="primary" disabled={busy} onClick={() => setCreateOpen(true)}>
            <Plus size={17} />
            Create Subscription
          </button>
        }
      >
        <div className="list">
          {subscriptions.length === 0 && <Empty label="No subscription rules yet" />}
          {subscriptions.map((subscription) => (
            <article className="row-card subscription-card" key={subscription.id}>
              <div>
                <strong>{subscription.title}</strong>
                <span>{subscription.media?.title ?? subscription.rule?.providerId ?? "Rule-only subscription"}</span>
                <small>{ruleSummary(subscription)}</small>
              </div>
              <div className="row-actions">
                <StatusPill ok={subscription.enabled}>{subscription.enabled ? "Enabled" : "Disabled"}</StatusPill>
                <StatusPill ok={subscription.autoDownload}>{subscription.autoDownload ? "Auto" : "Manual"}</StatusPill>
                {subscription.downloader ? <Pill>{subscription.downloader.name}</Pill> : <Pill>Default downloader</Pill>}
                <button className="secondary" disabled={busy} onClick={() => setEditingSubscription(subscription)}>
                  <Pencil size={16} />
                  Edit
                </button>
              </div>
            </article>
          ))}
        </div>
      </Panel>
      {createOpen && (
        <Modal title="Create Subscription" onClose={() => setCreateOpen(false)}>
          <SubscriptionSearch
            downloaders={downloaders}
            onSubscribe={async (body) => {
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
        <Modal title="Edit Subscription" onClose={() => setEditingSubscription(null)}>
          <SubscriptionEditForm
            busy={busy}
            downloaders={downloaders}
            subscription={editingSubscription}
            onCancel={() => setEditingSubscription(null)}
            onSubmit={async (patchBody, ruleBody) => {
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

function ActivityPage({
  jobs,
  timeline
}: {
  jobs: DownloadJob[];
  timeline: TimelinePoint[];
}) {
  return (
    <div className="page-stack">
      <section className="two-column">
        <Panel title="Hourly Intake" icon={<Clock3 size={19} />}>
          <TimelineBars timeline={timeline} />
        </Panel>
        <Panel title="Job Status" icon={<DownloadCloud size={19} />}>
          <div className="status-grid">
            <Metric label="Queued" value={jobs.filter((job) => job.status === "QUEUED").length} icon={<Clock3 size={18} />} />
            <Metric label="Sent" value={jobs.filter((job) => job.status === "SENT").length} icon={<CheckCircle2 size={18} />} />
            <Metric label="Failed" value={jobs.filter((job) => job.status === "FAILED").length} icon={<XCircle size={18} />} />
          </div>
        </Panel>
      </section>
      <Panel title="Download Jobs" icon={<ListFilter size={19} />}>
        <div className="list">
          {jobs.length === 0 && <Empty label="No download jobs yet" />}
          {jobs.map((job) => (
            <article className="row-card job-card" key={job.id}>
              <div>
                <strong>{job.item?.rawTitle ?? job.id}</strong>
                <span>{job.downloader?.name ?? "Downloader"} · {job.source}</span>
                {job.error && <p className="error">{job.error}</p>}
              </div>
              <div className="row-actions">
                <StatusPill ok={!["FAILED", "SKIPPED"].includes(job.status)}>{job.status}</StatusPill>
                <small>{relativeTime(job.createdAt)}</small>
              </div>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function WorkspacePage({
  user,
  workspace,
  members,
  stats
}: {
  user: User;
  workspace: Workspace | null;
  members: WorkspaceMember[];
  stats: {
    feeds: number;
    subscriptions: number;
    downloaders: number;
    failedJobs: number;
  };
}) {
  return (
    <div className="page-stack">
      <section className="workspace-band">
        <div>
          <span className="section-kicker">Current workspace</span>
          <h3>{workspace?.name ?? "Workspace"}</h3>
          <p>{user.name} · {user.email}</p>
        </div>
        <div className="workspace-stats">
          <Pill>{workspace?.role ?? "MEMBER"}</Pill>
          <Pill>{stats.feeds} feeds</Pill>
          <Pill>{stats.subscriptions} subscriptions</Pill>
          <Pill>{stats.downloaders} downloaders</Pill>
          {stats.failedJobs > 0 && <Pill>{stats.failedJobs} failed jobs</Pill>}
        </div>
      </section>
      <Panel title="Members" icon={<Users size={19} />}>
        <div className="list">
          {members.length === 0 && <Empty label="No members loaded" />}
          {members.map((member) => (
            <article className="row-card member-card" key={member.userId}>
              <div>
                <strong>{member.name}</strong>
                <span>{member.email}</span>
              </div>
              <Pill>{member.role}</Pill>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function ReleaseTimeline({
  busy,
  downloaders,
  items,
  runAction
}: {
  busy: boolean;
  downloaders: Downloader[];
  items: Item[];
  runAction: RunAction;
}) {
  if (items.length === 0) return <Empty label="Add a feed and refresh it to start tracking releases" />;

  return (
    <div className="release-timeline">
      {items.map((item) => (
        <article className="release-row" key={item.id}>
          <div className="release-poster">
            {item.mediaMatch?.posterPath ? (
              <img src={tmdbImage(item.mediaMatch.posterPath, "w185")} alt={item.mediaMatch.title} />
            ) : (
              <Film size={24} />
            )}
          </div>
          <div className="release-copy">
            <strong>{item.mediaMatch?.title ?? item.parsedRelease?.title ?? item.rawTitle}</strong>
            <span>{item.rawTitle}</span>
            {item.mediaMatch?.overview && <p>{item.mediaMatch.overview}</p>}
            <small>{item.feed?.name ?? "Feed"} · {relativeTime(item.firstSeenAt)}{item.sizeBytes ? ` · ${formatBytes(item.sizeBytes)}` : ""}</small>
          </div>
          <div className="release-meta">
            <div className="token-row">
              <Pill>{item.parsedRelease?.kind ?? item.mediaMatch?.kind ?? "UNKNOWN"}</Pill>
              {item.mediaMatch?.year && <Pill>{item.mediaMatch.year}</Pill>}
              {item.parsedRelease?.quality && <Pill>{item.parsedRelease.quality}</Pill>}
              {item.parsedRelease?.kind === "TV" && (
                <Pill>
                  <Tv size={13} />
                  S{item.parsedRelease.season ?? "?"}E{item.parsedRelease.episode ?? "?"}
                </Pill>
              )}
              {item.mediaMatch ? <Pill>{Math.round(item.mediaMatch.score * 100)}%</Pill> : <Pill>Unmatched</Pill>}
            </div>
            <div className="item-actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => runAction(() => api(`/api/items/${item.id}/match`, { method: "POST" }))}
              >
                Match
              </button>
              <ManualDownload
                disabled={busy || downloaders.length === 0}
                downloaders={downloaders}
                onDownload={(downloaderId) =>
                  runAction(() =>
                    api(`/api/items/${item.id}/downloads`, {
                      method: "POST",
                      body: JSON.stringify({ downloaderId })
                    })
                  )
                }
              />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function HeatList({ heat }: { heat: HeatItem[] }) {
  return (
    <div className="heat-list">
      {heat.length === 0 && <Empty label="No feed activity yet" />}
      {heat.map((entry) => (
        <div className="heat-row" key={entry.title}>
          <strong>{entry.title}</strong>
          <span>{entry.count} releases</span>
        </div>
      ))}
    </div>
  );
}

function TimelineBars({ timeline }: { timeline: TimelinePoint[] }) {
  return (
    <div className="timeline">
      {timeline.length === 0 && <Empty label="No timeline data yet" />}
      {timeline.map((point) => (
        <div className="bar-row" key={point.time}>
          <span>{new Date(point.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          <div><i style={{ width: `${Math.max(8, point.count * 12)}px` }} /></div>
          <b>{point.count}</b>
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <div className="metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Panel({
  title,
  icon,
  actions,
  children
}: {
  title: string;
  icon: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <header>
        <h3>{icon}{title}</h3>
        {actions && <div className="panel-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

function Modal({
  title,
  children,
  onClose
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <section aria-label={title} aria-modal="true" className="modal-dialog" role="dialog">
        <header className="modal-header">
          <h3>{title}</h3>
          <button className="icon-button" onClick={onClose} title="Close" type="button">
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function FeedModalForm({
  busy,
  feed,
  onCancel,
  onSubmit
}: {
  busy: boolean;
  feed?: Feed;
  onCancel: () => void;
  onSubmit: (body: string) => Promise<ActionResult>;
}) {
  const editing = Boolean(feed);
  const [name, setName] = useState(feed?.name ?? "");
  const [url, setUrl] = useState("");
  const [pollIntervalSeconds, setPollIntervalSeconds] = useState(
    String(feed?.pollIntervalSeconds ?? defaultPollIntervalSeconds)
  );
  const [enabled, setEnabled] = useState(feed?.enabled ?? true);
  const [submitError, setSubmitError] = useState("");

  return (
    <form
      className="modal-form"
      onSubmit={async (event) => {
        event.preventDefault();
        const nextUrl = url.trim();
        setSubmitError("");
        const result = await onSubmit(
          JSON.stringify({
            name: name.trim(),
            pollIntervalSeconds: Number(pollIntervalSeconds),
            enabled,
            ...(!editing || nextUrl ? { url: nextUrl } : {})
          })
        );
        if (!result.ok) setSubmitError(result.message);
      }}
    >
      <label>
        Feed name
        <input value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      <label>
        Private RSS URL
        <input
          placeholder={editing ? "Leave blank to keep current URL" : "https://tracker.example/rss"}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          required={!editing}
        />
      </label>
      <div className="form-grid">
        <label>
          Poll interval
          <input
            type="number"
            min={60}
            value={pollIntervalSeconds}
            onChange={(event) => setPollIntervalSeconds(event.target.value)}
            required
          />
        </label>
        <label className="checkbox-row">
          <input checked={enabled} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" />
          Enabled
        </label>
      </div>
      {submitError && <p className="modal-feedback error">{submitError}</p>}
      <div className="modal-actions">
        <button className="secondary" onClick={onCancel} type="button">
          Cancel
        </button>
        <button className="primary" disabled={busy} type="submit">
          {editing ? <Pencil size={17} /> : <Plus size={17} />}
          {editing ? "Save Feed" : "Add Feed"}
        </button>
      </div>
    </form>
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
        <label>
          Type
          <select value={type} onChange={(event) => setType(event.target.value as Downloader["type"])}>
            <option value="QBITTORRENT">qBittorrent</option>
            <option value="TRANSMISSION">Transmission</option>
          </select>
        </label>
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
      </div>
      <label>
        Base URL
        <input placeholder="http://localhost:8080" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required />
      </label>
      <div className="form-grid">
        <label>
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label>
          Password
          <input
            placeholder={editing ? "Leave blank to keep current password" : ""}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
          />
        </label>
      </div>
      <div className="form-grid">
        <label>
          Save path
          <input value={defaultSavePath} onChange={(event) => setDefaultSavePath(event.target.value)} />
        </label>
        <label>
          Category
          <input value={category} onChange={(event) => setCategory(event.target.value)} />
        </label>
      </div>
      <label>
        Tags
        <input placeholder="movies, private" value={tags} onChange={(event) => setTags(event.target.value)} />
      </label>
      <label className="checkbox-row">
        <input checked={enabled} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" />
        Enabled
      </label>
      {testResult && (
        <p className={testResult.ok ? "modal-feedback success" : "modal-feedback error"}>
          {testResult.message}
        </p>
      )}
      {submitError && <p className="modal-feedback error">{submitError}</p>}
      <div className="modal-actions">
        <button className="secondary" onClick={onCancel} type="button">
          Cancel
        </button>
        <button className="secondary" disabled={busy || testBusy} onClick={() => void testConnection()} type="button">
          <ServerCog size={17} />
          {testBusy ? "Testing" : "Test Connection"}
        </button>
        <button className="primary" disabled={busy} type="submit">
          {editing ? <Pencil size={17} /> : <Plus size={17} />}
          {editing ? "Save Downloader" : "Add Downloader"}
        </button>
      </div>
    </form>
  );
}

function SubscriptionEditForm({
  busy,
  downloaders,
  subscription,
  onCancel,
  onSubmit
}: {
  busy: boolean;
  downloaders: Downloader[];
  subscription: Subscription;
  onCancel: () => void;
  onSubmit: (patchBody: string, ruleBody: string) => Promise<ActionResult>;
}) {
  const rule = subscription.rule;
  const [title, setTitle] = useState(subscription.title);
  const [downloaderId, setDownloaderId] = useState(subscription.downloader?.id ?? "");
  const [autoDownload, setAutoDownload] = useState(subscription.autoDownload);
  const [enabled, setEnabled] = useState(subscription.enabled);
  const [mediaKind, setMediaKind] = useState<"" | "MOVIE" | "TV" | "UNKNOWN">(
    rule?.mediaKind ?? subscription.media?.kind ?? ""
  );
  const [provider, setProvider] = useState<"" | "tmdb" | "imdb" | "douban">(
    providerValue(rule?.provider ?? subscription.media?.provider)
  );
  const [providerId, setProviderId] = useState(rule?.providerId ?? subscription.media?.providerId ?? "");
  const [imdbId, setImdbId] = useState(rule?.imdbId ?? "");
  const [doubanId, setDoubanId] = useState(rule?.doubanId ?? "");
  const [titleRegex, setTitleRegex] = useState(rule?.titleRegex ?? "");
  const [includeRegex, setIncludeRegex] = useState(rule?.includeRegex ?? "");
  const [excludeRegex, setExcludeRegex] = useState(rule?.excludeRegex ?? "");
  const [minResolution, setMinResolution] = useState(rule?.minResolution?.toString() ?? "");
  const [maxResolution, setMaxResolution] = useState(rule?.maxResolution?.toString() ?? "");
  const [sources, setSources] = useState((rule?.sources ?? []).join(", "));
  const [codecs, setCodecs] = useState((rule?.codecs ?? []).join(", "));
  const [audio, setAudio] = useState((rule?.audio ?? []).join(", "));
  const [releaseGroupsInclude, setReleaseGroupsInclude] = useState((rule?.releaseGroupsInclude ?? []).join(", "));
  const [releaseGroupsExclude, setReleaseGroupsExclude] = useState((rule?.releaseGroupsExclude ?? []).join(", "));
  const [minSizeBytes, setMinSizeBytes] = useState(rule?.minSizeBytes ?? "");
  const [maxSizeBytes, setMaxSizeBytes] = useState(rule?.maxSizeBytes ?? "");
  const [season, setSeason] = useState(rule?.season?.toString() ?? "");
  const [episodeStart, setEpisodeStart] = useState(rule?.episodeStart?.toString() ?? "");
  const [episodeEnd, setEpisodeEnd] = useState(rule?.episodeEnd?.toString() ?? "");
  const [submitError, setSubmitError] = useState("");

  return (
    <form
      className="modal-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setSubmitError("");
        const result = await onSubmit(
          JSON.stringify({
            title: title.trim(),
            downloaderId: downloaderId || null,
            autoDownload,
            enabled
          }),
          JSON.stringify({
            mediaKind: mediaKind || undefined,
            provider: provider || undefined,
            providerId: optionalText(providerId),
            imdbId: optionalText(imdbId),
            doubanId: optionalText(doubanId),
            titleRegex: optionalText(titleRegex),
            includeRegex: optionalText(includeRegex),
            excludeRegex: optionalText(excludeRegex),
            minResolution: numberOrUndefined(minResolution),
            maxResolution: numberOrUndefined(maxResolution),
            sources: stringListFromInput(sources),
            codecs: stringListFromInput(codecs),
            audio: stringListFromInput(audio),
            releaseGroupsInclude: stringListFromInput(releaseGroupsInclude),
            releaseGroupsExclude: stringListFromInput(releaseGroupsExclude),
            minSizeBytes: optionalText(minSizeBytes),
            maxSizeBytes: optionalText(maxSizeBytes),
            season: numberOrUndefined(season),
            episodeStart: numberOrUndefined(episodeStart),
            episodeEnd: numberOrUndefined(episodeEnd)
          })
        );
        if (!result.ok) setSubmitError(result.message);
      }}
    >
      <label>
        Subscription title
        <input value={title} onChange={(event) => setTitle(event.target.value)} required />
      </label>
      <div className="form-grid">
        <label>
          Downloader
          <select value={downloaderId} onChange={(event) => setDownloaderId(event.target.value)}>
            <option value="">Default downloader</option>
            {downloaders.map((downloader) => (
              <option value={downloader.id} key={downloader.id}>{downloader.name}</option>
            ))}
          </select>
        </label>
        <label>
          Media kind
          <select value={mediaKind} onChange={(event) => setMediaKind(event.target.value as typeof mediaKind)}>
            <option value="">Any kind</option>
            <option value="MOVIE">Movie</option>
            <option value="TV">Series</option>
            <option value="UNKNOWN">Unknown</option>
          </select>
        </label>
      </div>
      <div className="form-grid">
        <label>
          Provider
          <select value={provider} onChange={(event) => setProvider(event.target.value as typeof provider)}>
            <option value="">Any provider</option>
            <option value="tmdb">TMDB</option>
            <option value="imdb">IMDb</option>
            <option value="douban">Douban</option>
          </select>
        </label>
        <label>
          Provider ID
          <input value={providerId} onChange={(event) => setProviderId(event.target.value)} />
        </label>
      </div>
      <div className="form-grid">
        <label>
          IMDb ID
          <input placeholder="tt1234567" value={imdbId} onChange={(event) => setImdbId(event.target.value)} />
        </label>
        <label>
          Douban ID
          <input value={doubanId} onChange={(event) => setDoubanId(event.target.value)} />
        </label>
      </div>
      <div className="form-grid">
        <label>
          Title regex
          <input value={titleRegex} onChange={(event) => setTitleRegex(event.target.value)} />
        </label>
        <label>
          Include regex
          <input value={includeRegex} onChange={(event) => setIncludeRegex(event.target.value)} />
        </label>
      </div>
      <label>
        Exclude regex
        <input value={excludeRegex} onChange={(event) => setExcludeRegex(event.target.value)} />
      </label>
      <div className="form-grid">
        <label>
          Min resolution
          <input min={1} type="number" value={minResolution} onChange={(event) => setMinResolution(event.target.value)} />
        </label>
        <label>
          Max resolution
          <input min={1} type="number" value={maxResolution} onChange={(event) => setMaxResolution(event.target.value)} />
        </label>
      </div>
      <div className="form-grid">
        <label>
          Sources
          <input placeholder="WEB-DL, BluRay" value={sources} onChange={(event) => setSources(event.target.value)} />
        </label>
        <label>
          Codecs
          <input placeholder="x264, x265" value={codecs} onChange={(event) => setCodecs(event.target.value)} />
        </label>
      </div>
      <label>
        Audio
        <input placeholder="Atmos, TrueHD" value={audio} onChange={(event) => setAudio(event.target.value)} />
      </label>
      <div className="form-grid">
        <label>
          Include release groups
          <input value={releaseGroupsInclude} onChange={(event) => setReleaseGroupsInclude(event.target.value)} />
        </label>
        <label>
          Exclude release groups
          <input value={releaseGroupsExclude} onChange={(event) => setReleaseGroupsExclude(event.target.value)} />
        </label>
      </div>
      <div className="form-grid">
        <label>
          Min size bytes
          <input min={1} type="number" value={minSizeBytes} onChange={(event) => setMinSizeBytes(event.target.value)} />
        </label>
        <label>
          Max size bytes
          <input min={1} type="number" value={maxSizeBytes} onChange={(event) => setMaxSizeBytes(event.target.value)} />
        </label>
      </div>
      <div className="form-grid three">
        <label>
          Season
          <input min={1} type="number" value={season} onChange={(event) => setSeason(event.target.value)} />
        </label>
        <label>
          Episode start
          <input min={1} type="number" value={episodeStart} onChange={(event) => setEpisodeStart(event.target.value)} />
        </label>
        <label>
          Episode end
          <input min={1} type="number" value={episodeEnd} onChange={(event) => setEpisodeEnd(event.target.value)} />
        </label>
      </div>
      <div className="form-grid">
        <label className="checkbox-row">
          <input checked={autoDownload} onChange={(event) => setAutoDownload(event.target.checked)} type="checkbox" />
          Auto download
        </label>
        <label className="checkbox-row">
          <input checked={enabled} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" />
          Enabled
        </label>
      </div>
      {submitError && <p className="modal-feedback error">{submitError}</p>}
      <div className="modal-actions">
        <button className="secondary" onClick={onCancel} type="button">
          Cancel
        </button>
        <button className="primary" disabled={busy} type="submit">
          <Pencil size={17} />
          Save Subscription
        </button>
      </div>
    </form>
  );
}

function SubscriptionSearch({
  downloaders,
  onSubscribe
}: {
  downloaders: Downloader[];
  onSubscribe: (body: string) => void | ActionResult | Promise<void | ActionResult>;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"MOVIE" | "TV">("MOVIE");
  const [results, setResults] = useState<MediaSearchResult[]>([]);
  const [downloaderId, setDownloaderId] = useState("");
  const [includeRegex, setIncludeRegex] = useState("");
  const [minResolution, setMinResolution] = useState(1080);
  const [subscribeError, setSubscribeError] = useState("");

  async function search(event: FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams({ q: query, kind });
    setResults(await api<MediaSearchResult[]>(`/api/media/search?${params}`));
  }

  return (
    <div className="subscription-tool">
      <form className="search-form" onSubmit={search}>
        <select value={kind} onChange={(event) => setKind(event.target.value as "MOVIE" | "TV")}>
          <option value="MOVIE">Movie</option>
          <option value="TV">Series</option>
        </select>
        <input placeholder="Search TMDB" value={query} onChange={(event) => setQuery(event.target.value)} required />
        <input placeholder="Include regex" value={includeRegex} onChange={(event) => setIncludeRegex(event.target.value)} />
        <select value={minResolution} onChange={(event) => setMinResolution(Number(event.target.value))}>
          <option value={720}>720p+</option>
          <option value={1080}>1080p+</option>
          <option value={2160}>2160p+</option>
        </select>
        <select value={downloaderId} onChange={(event) => setDownloaderId(event.target.value)}>
          <option value="">Default downloader</option>
          {downloaders.map((downloader) => (
            <option value={downloader.id} key={downloader.id}>{downloader.name}</option>
          ))}
        </select>
        <button className="primary" type="submit"><Search size={17} />Search</button>
      </form>
      <div className="result-grid">
        {results.map((result) => (
          <article className="result" key={result.providerId}>
            {result.posterPath ? (
              <img src={tmdbImage(result.posterPath, "w185")} alt={result.title} />
            ) : (
              <div className="poster-placeholder"><Film size={24} /></div>
            )}
            <strong>{result.title}</strong>
            <span>{result.year ?? "Unknown"} · {Math.round(result.score * 100)}%</span>
            <button
              className="secondary"
              onClick={async () => {
                setSubscribeError("");
                const subscribeResult = await onSubscribe(
                  JSON.stringify({
                    downloaderId: downloaderId || undefined,
                    title: result.title,
                    autoDownload: true,
                    enabled: true,
                    rule: {
                      mediaKind: result.kind,
                      provider: result.provider,
                      providerId: result.providerId,
                      includeRegex: includeRegex || undefined,
                      minResolution
                    }
                  })
                );
                if (subscribeResult && !subscribeResult.ok) setSubscribeError(subscribeResult.message);
              }}
            >
              Subscribe
            </button>
          </article>
        ))}
      </div>
      {subscribeError && <p className="modal-feedback error">{subscribeError}</p>}
    </div>
  );
}

function ManualDownload({
  disabled,
  downloaders,
  onDownload
}: {
  disabled: boolean;
  downloaders: Downloader[];
  onDownload: (downloaderId: string) => void;
}) {
  const [downloaderId, setDownloaderId] = useState("");
  useEffect(() => {
    if (!downloaderId && downloaders[0]) setDownloaderId(downloaders[0].id);
  }, [downloaders, downloaderId]);
  return (
    <div className="download-control">
      <select value={downloaderId} onChange={(event) => setDownloaderId(event.target.value)} disabled={disabled}>
        {downloaders.map((downloader) => (
          <option key={downloader.id} value={downloader.id}>{downloader.name}</option>
        ))}
      </select>
      <button className="primary" disabled={disabled || !downloaderId} onClick={() => onDownload(downloaderId)}>
        <DownloadCloud size={17} />
        Send
      </button>
    </div>
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

function Pill({ children }: { children: ReactNode }) {
  return <span className="pill">{children}</span>;
}

function StatusPill({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <span className={ok ? "status-pill ok" : "status-pill warn"}>{children}</span>;
}

function Empty({ label }: { label: string }) {
  return <p className="empty">{label}</p>;
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
    workspace: "Workspace"
  }[page];
}

function pageSummary(page: PageId) {
  return {
    overview: "RSS title timeline with TMDB posters, match detail, and downloader actions",
    rss: "Private tracker feeds, polling cadence, and refresh status",
    downloaders: "Tenant-level qBittorrent and Transmission endpoints",
    subscriptions: "Rule-based media subscriptions and auto-download criteria",
    activity: "Download jobs, ingestion rate, and failure visibility",
    workspace: "Tenant context, members, and workspace-level status"
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

function tmdbImage(path: string, size: "w185" | "w342") {
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

function relativeTime(value: string | Date) {
  return formatDistanceToNow(new Date(value), { addSuffix: true });
}

function formatBytes(value: string) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return value;
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(1)} TB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${bytes} B`;
}

function optionalText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function numberOrUndefined(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringListFromInput(value: string) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function providerValue(value?: string): "" | "tmdb" | "imdb" | "douban" {
  return value === "tmdb" || value === "imdb" || value === "douban" ? value : "";
}

function ruleSummary(subscription: Subscription) {
  const rule = subscription.rule;
  if (!rule) return "No rule configured";
  const parts = [
    rule.mediaKind,
    rule.provider && rule.providerId ? `${rule.provider}:${rule.providerId}` : undefined,
    rule.minResolution ? `${rule.minResolution}p+` : undefined,
    rule.includeRegex ? `include /${rule.includeRegex}/` : undefined,
    rule.excludeRegex ? `exclude /${rule.excludeRegex}/` : undefined,
    rule.season ? `season ${rule.season}` : undefined
  ].filter(Boolean);
  return parts.join(" · ") || "Broad match rule";
}
