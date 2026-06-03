import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  CheckCircle2,
  Clock3,
  DownloadCloud,
  Eye,
  Film,
  HardDrive,
  ListFilter,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Rss,
  Search,
  ServerCog,
  Settings,
  Shield,
  SlidersHorizontal,
  Tv,
  Users,
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
import {
  AppDialog,
  FieldLabel,
  CheckboxField,
  MenuButton,
  FormInput,
  UiButton,
  SegmentedTabs,
  SelectField,
  StatTile,
  Tooltip
} from "./ui.js";

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
      api<WorkspaceMember[]>("/api/workspace/members")
    ]);

    applyResult(results[0], setFeeds);
    applyResult(results[1], setItems);
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
  items,
  stats,
  timeline,
  runAction
}: {
  busy: boolean;
  downloaders: Downloader[];
  items: Item[];
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
  const [selectedRelease, setSelectedRelease] = useState<Item | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [queueView, setQueueView] = useState("review");
  const [query, setQuery] = useState("");
  const [feedFilter, setFeedFilter] = useState("");
  const [matchFilter, setMatchFilter] = useState("all");

  const feedOptions = useMemo(
    () => [
      { value: "", label: "All feeds" },
      ...Array.from(new Map(items.flatMap((item) => item.feed ? [[item.feed.id, item.feed.name]] : [])).entries())
        .map(([value, label]) => ({ value, label }))
    ],
    [items]
  );
  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      const status = releaseStatus(item);
      const matchesQueue =
        queueView === "review" ||
        (queueView === "matched" && Boolean(item.mediaMatch)) ||
        (queueView === "downloaded" && status.group === "downloaded") ||
        (queueView === "failed" && status.group === "failed");
      const matchesSearch =
        !normalizedQuery ||
        [
          item.rawTitle,
          item.parsedRelease?.title,
          item.mediaMatch?.title,
          item.feed?.name,
          item.parsedRelease?.quality,
          item.parsedRelease?.source,
          item.parsedRelease?.codec
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedQuery));
      const matchesFeed = !feedFilter || item.feed?.id === feedFilter;
      const matchesMatch =
        matchFilter === "all" ||
        (matchFilter === "matched" && Boolean(item.mediaMatch)) ||
        (matchFilter === "unmatched" && !item.mediaMatch);
      return matchesQueue && matchesSearch && matchesFeed && matchesMatch;
    });
  }, [feedFilter, items, matchFilter, query, queueView]);
  const visibleIds = visibleItems.map((item) => item.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const selectedItems = items.filter((item) => selectedIds.includes(item.id));
  const queueTabs = [
    { value: "review", label: "Review Queue", count: items.length },
    { value: "matched", label: "Matched", count: stats.matched },
    {
      value: "downloaded",
      label: "Downloaded",
      count: items.filter((item) => releaseStatus(item).group === "downloaded").length
    },
    {
      value: "failed",
      label: "Failed",
      count: items.filter((item) => releaseStatus(item).group === "failed").length
    }
  ];

  function toggleVisibleSelection(checked: boolean) {
    setSelectedIds((current) => {
      const withoutVisible = current.filter((id) => !visibleIds.includes(id));
      return checked ? [...withoutVisible, ...visibleIds] : withoutVisible;
    });
  }

  return (
    <div className="page-stack">
      <section className="stat-grid">
        <StatTile label="RSS feeds" value={stats.feeds} detail={`${stats.totalItems} recent items`} icon={<Rss size={20} />} />
        <StatTile label="Downloaders" value={stats.downloaders} detail="enabled endpoints" icon={<HardDrive size={20} />} />
        <StatTile label="Matching rules" value={stats.subscriptions} detail="active subscriptions" icon={<SlidersHorizontal size={20} />} />
        <StatTile label="Matched releases" value={stats.matched} detail={`${matchRate(stats.matched, stats.totalItems)} match rate`} icon={<Film size={20} />} tone="accent" />
        <StatTile label="Failed jobs" value={stats.failedJobs} detail={stats.failedJobs > 0 ? "needs review" : "all clear"} icon={<XCircle size={20} />} tone={stats.failedJobs > 0 ? "danger" : "good"} />
      </section>

      <section className="release-workbench">
        <header className="workbench-header">
          <div>
            <span className="section-kicker">Release review</span>
            <h3>New releases from your feeds</h3>
            <p>Verify matches, inspect parsed metadata, and send releases to the right downloader.</p>
          </div>
          <div className="workbench-actions">
            <MenuButton
              className="secondary"
              label={selectedIds.length ? `${selectedIds.length} selected` : "Bulk actions"}
              icon={<ListFilter size={16} />}
              items={[
                {
                  label: "Match selected",
                  icon: <Film size={15} />,
                  disabled: selectedItems.length === 0 || busy,
                  onSelect: () =>
                    void runAction(() =>
                      Promise.all(selectedItems.map((item) => api(`/api/items/${item.id}/match`, { method: "POST" })))
                    )
                },
                {
                  label: "Clear selection",
                  icon: <XCircle size={15} />,
                  disabled: selectedIds.length === 0,
                  onSelect: () => setSelectedIds([])
                }
              ]}
            />
          </div>
        </header>

        <SegmentedTabs value={queueView} onValueChange={setQueueView} tabs={queueTabs} />

        <div className="filter-bar">
          <FieldLabel className="search-control">
            <Search size={16} />
            <FormInput
              placeholder="Search title, feed, or release tag"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </FieldLabel>
          <SelectField value={feedFilter} onValueChange={setFeedFilter} options={feedOptions} placeholder="Feed" />
          <SelectField
            value={matchFilter}
            onValueChange={setMatchFilter}
            options={[
              { value: "all", label: "All matches" },
              { value: "matched", label: "Matched only" },
              { value: "unmatched", label: "Unmatched only" }
            ]}
            placeholder="Match"
          />
          <Tooltip content="Filters are applied locally to the loaded RSS items.">
            <UiButton className="icon-button" type="button" aria-label="Filter details">
              <SlidersHorizontal size={17} />
            </UiButton>
          </Tooltip>
        </div>

        <Panel title="Review queue" icon={<Activity size={19} />}>
          <div className="release-table">
            <div className="release-table-head">
              <CheckboxField checked={allVisibleSelected} onCheckedChange={toggleVisibleSelection} />
              <span>Release</span>
              <span>Feed</span>
              <span>Quality</span>
              <span>Match</span>
              <span>Status</span>
              <span>Actions</span>
            </div>
            {visibleItems.length === 0 && <Empty label="No releases match the current filters" />}
            {visibleItems.map((item) => (
              <ReleaseReviewRow
                busy={busy}
                checked={selectedIds.includes(item.id)}
                downloaders={downloaders}
                item={item}
                key={item.id}
                onCheckedChange={(checked) =>
                  setSelectedIds((current) =>
                    checked ? [...new Set([...current, item.id])] : current.filter((id) => id !== item.id)
                  )
                }
                onInspect={() => setSelectedRelease(item)}
                runAction={runAction}
              />
            ))}
          </div>
          <footer className="table-footer">
            <span>{visibleItems.length} of {items.length} releases</span>
            <span>TMDB metadata and images are used when a match is available.</span>
          </footer>
        </Panel>
      </section>

      <section className="overview-insight-grid">
        <Panel title="Feed intake" icon={<Clock3 size={19} />}>
          <TimelineBars timeline={timeline} compact />
        </Panel>
        <Panel title="Queue health" icon={<CheckCircle2 size={19} />}>
          <StatusSummary items={items} />
        </Panel>
      </section>

      {selectedRelease && (
        <ReleaseInspectorModal
          busy={busy}
          downloaders={downloaders}
          item={selectedRelease}
          onClose={() => setSelectedRelease(null)}
          runAction={runAction}
        />
      )}
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
      <section className="overview-insight-grid">
        <Panel title="Feed volume" icon={<Activity size={19} />}>
          <DistributionBars
            entries={feeds.map((feed) => ({
              label: feed.name,
              value: feed.itemCount,
              detail: feed.enabled ? "enabled" : "disabled",
              tone: feed.lastError ? "danger" : feed.enabled ? "good" : "neutral"
            }))}
            emptyLabel="Add feeds to see item volume"
          />
        </Panel>
        <Panel title="Polling cadence" icon={<Clock3 size={19} />}>
          <DistributionBars
            entries={feeds.map((feed) => ({
              label: feed.name,
              value: Math.round(feed.pollIntervalSeconds / 60),
              detail: feed.lastPolledAt ? `last polled ${relativeTime(feed.lastPolledAt)}` : "not polled yet",
              tone: feed.lastError ? "danger" : "accent"
            }))}
            suffix="m"
            emptyLabel="Polling cadence appears after feeds are configured"
          />
        </Panel>
      </section>
      <Panel
        title="Feed Sources"
        icon={<ServerCog size={19} />}
        actions={
          <UiButton className="primary" disabled={busy} onClick={() => setFeedModal("new")}>
            <Plus size={17} />
            Add Feed
          </UiButton>
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
                <UiButton className="secondary" disabled={busy} onClick={() => setFeedModal(feed)}>
                  <Pencil size={16} />
                  Edit
                </UiButton>
                <UiButton
                  className="icon-button"
                  disabled={busy}
                  onClick={() => runAction(() => api(`/api/feeds/${feed.id}/refresh`, { method: "POST" }))}
                  title="Refresh feed"
                >
                  <RefreshCw size={17} />
                </UiButton>
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
          <UiButton className="primary" disabled={busy} onClick={() => setCreateOpen(true)}>
            <Plus size={17} />
            Create Subscription
          </UiButton>
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
                <UiButton className="secondary" disabled={busy} onClick={() => setEditingSubscription(subscription)}>
                  <Pencil size={16} />
                  Edit
                </UiButton>
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

function ReleaseReviewRow({
  busy,
  checked,
  downloaders,
  item,
  onCheckedChange,
  onInspect,
  runAction
}: {
  busy: boolean;
  checked: boolean;
  downloaders: Downloader[];
  item: Item;
  onCheckedChange: (checked: boolean) => void;
  onInspect: () => void;
  runAction: RunAction;
}) {
  const title = releaseTitle(item);
  const status = releaseStatus(item);
  const confidence = item.mediaMatch?.score ?? item.parseConfidence ?? 0;

  return (
    <article className="release-table-row">
      <CheckboxField checked={checked} onCheckedChange={onCheckedChange} />
      <div className="release-title-cell">
        <div className="release-poster">
          {item.mediaMatch?.posterPath ? (
            <img src={tmdbImage(item.mediaMatch.posterPath, "w185")} alt={title} />
          ) : (
            <Film size={24} />
          )}
        </div>
        <div className="release-copy">
          <UiButton className="release-title-button" onClick={onInspect} type="button">
            {title}
          </UiButton>
          <span>{item.rawTitle}</span>
          <small>{relativeTime(item.firstSeenAt)}{item.sizeBytes ? ` · ${formatBytes(item.sizeBytes)}` : ""}</small>
        </div>
      </div>
      <div className="release-feed-cell">
        <strong>{item.feed?.name ?? "Feed"}</strong>
        <span>{item.parsedRelease?.kind ?? item.mediaMatch?.kind ?? "UNKNOWN"}</span>
      </div>
      <div className="token-row quality-cell">
        {item.parsedRelease?.quality && <Pill>{item.parsedRelease.quality}</Pill>}
        {item.parsedRelease?.source && <Pill>{item.parsedRelease.source}</Pill>}
        {item.parsedRelease?.codec && <Pill>{item.parsedRelease.codec}</Pill>}
        {item.parsedRelease?.kind === "TV" && (
          <Pill>
            <Tv size={13} />
            S{item.parsedRelease.season ?? "?"}E{item.parsedRelease.episode ?? "?"}
          </Pill>
        )}
      </div>
      <div className="confidence-cell">
        <strong>{confidencePercent(confidence)}</strong>
        <span><i style={{ width: confidenceBarWidth(confidence) }} /></span>
        <small>{item.mediaMatch ? "TMDB match" : "Parse confidence"}</small>
      </div>
      <div className="status-cell">
        <StatusPill ok={status.ok}>{status.label}</StatusPill>
        <small>{status.detail}</small>
      </div>
      <div className="item-actions">
        <UiButton
          className="secondary"
          disabled={busy}
          onClick={() => runAction(() => api(`/api/items/${item.id}/match`, { method: "POST" }))}
        >
          Match
        </UiButton>
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
        <MenuButton
          className="icon-button"
          label={<span className="sr-only">Release actions</span>}
          icon={<MoreHorizontal size={17} />}
          items={[
            { label: "Open details", icon: <Eye size={15} />, onSelect: onInspect },
            {
              label: "Match release",
              icon: <Film size={15} />,
              disabled: busy,
              onSelect: () => void runAction(() => api(`/api/items/${item.id}/match`, { method: "POST" }))
            }
          ]}
        />
      </div>
    </article>
  );
}

function ReleaseInspectorModal({
  busy,
  downloaders,
  item,
  onClose,
  runAction
}: {
  busy: boolean;
  downloaders: Downloader[];
  item: Item;
  onClose: () => void;
  runAction: RunAction;
}) {
  const title = releaseTitle(item);
  const status = releaseStatus(item);
  const backdropUrl = item.mediaMatch?.backdropPath ? tmdbImage(item.mediaMatch.backdropPath, "w342") : undefined;

  return (
    <AppDialog
      className="release-dialog"
      description={item.rawTitle}
      onClose={onClose}
      title={title}
    >
      <section
        className="release-dialog-hero"
        style={backdropUrl ? { backgroundImage: `linear-gradient(90deg, rgba(255,255,255,0.96), rgba(255,255,255,0.78)), url(${backdropUrl})` } : undefined}
      >
        <div className="release-dialog-poster">
          {item.mediaMatch?.posterPath ? (
            <img src={tmdbImage(item.mediaMatch.posterPath, "w342")} alt={title} />
          ) : (
            <Film size={34} />
          )}
        </div>
        <div className="release-dialog-summary">
          <div className="token-row">
            <StatusPill ok={status.ok}>{status.label}</StatusPill>
            {item.mediaMatch?.year && <Pill>{item.mediaMatch.year}</Pill>}
            {item.mediaMatch?.kind && <Pill>{item.mediaMatch.kind}</Pill>}
            {item.mediaMatch?.score !== undefined && <Pill>{confidencePercent(item.mediaMatch.score)} match</Pill>}
          </div>
          <p>{item.mediaMatch?.overview ?? "No TMDB overview is available for this release yet."}</p>
          <div className="release-dialog-actions">
            <UiButton
              className="secondary"
              disabled={busy}
              onClick={() => runAction(() => api(`/api/items/${item.id}/match`, { method: "POST" }))}
            >
              <Film size={17} />
              Match
            </UiButton>
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
      </section>
      <section className="release-dialog-grid">
        <DetailGroup
          title="Parsed release"
          rows={[
            ["Kind", item.parsedRelease?.kind ?? item.mediaMatch?.kind ?? "Unknown"],
            ["Quality", item.parsedRelease?.quality ?? "Unknown"],
            ["Source", item.parsedRelease?.source ?? "Unknown"],
            ["Codec", item.parsedRelease?.codec ?? "Unknown"],
            ["Size", item.sizeBytes ? formatBytes(item.sizeBytes) : "Unknown"]
          ]}
        />
        <DetailGroup
          title="Match detail"
          rows={[
            ["Provider", item.mediaMatch?.provider ?? "Not matched"],
            ["Provider ID", item.mediaMatch?.providerId ?? "Not matched"],
            ["Confidence", confidencePercent(item.mediaMatch?.score ?? item.parseConfidence ?? 0)],
            ["Reason", item.mediaMatch?.reason ?? "No match reason provided"]
          ]}
        />
        <DetailGroup
          title="Source and target"
          rows={[
            ["Feed", item.feed?.name ?? "Feed"],
            ["First seen", new Date(item.firstSeenAt).toLocaleString()],
            ["Downloader", downloaders.find((downloader) => downloader.isDefault)?.name ?? downloaders[0]?.name ?? "No downloader"],
            ["Job status", status.detail]
          ]}
        />
      </section>
    </AppDialog>
  );
}

function DetailGroup({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <article className="detail-group">
      <h4>{title}</h4>
      {rows.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </article>
  );
}

function StatusSummary({ items }: { items: Item[] }) {
  const summary = [
    { label: "Matched", count: items.filter((item) => item.mediaMatch).length, tone: "good" },
    { label: "Unmatched", count: items.filter((item) => !item.mediaMatch).length, tone: "neutral" },
    { label: "Downloaded", count: items.filter((item) => releaseStatus(item).group === "downloaded").length, tone: "accent" },
    { label: "Failed", count: items.filter((item) => releaseStatus(item).group === "failed").length, tone: "danger" }
  ];
  const total = Math.max(items.length, 1);

  return (
    <div className="summary-bars">
      {summary.map((entry) => (
        <div className="summary-bar" key={entry.label}>
          <div>
            <span>{entry.label}</span>
            <strong>{entry.count}</strong>
          </div>
          <span className={`bar-track ${entry.tone}`}>
            <i style={{ width: `${Math.round((entry.count / total) * 100)}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

function DistributionBars({
  entries,
  emptyLabel,
  suffix = ""
}: {
  entries: Array<{ label: string; value: number; detail: string; tone?: string }>;
  emptyLabel: string;
  suffix?: string;
}) {
  const maxValue = Math.max(1, ...entries.map((entry) => entry.value));

  return (
    <div className="summary-bars">
      {entries.length === 0 && <Empty label={emptyLabel} />}
      {entries.map((entry) => (
        <div className="summary-bar" key={entry.label}>
          <div>
            <span>{entry.label}</span>
            <strong>{entry.value}{suffix}</strong>
          </div>
          <span className={`bar-track ${entry.tone ?? "neutral"}`}>
            <i style={{ width: `${Math.max(4, Math.round((entry.value / maxValue) * 100))}%` }} />
          </span>
          <small>{entry.detail}</small>
        </div>
      ))}
    </div>
  );
}

function EndpointStatusGrid({ downloaders }: { downloaders: Downloader[] }) {
  if (downloaders.length === 0) return <Empty label="No downloader endpoints configured" />;

  return (
    <div className="endpoint-grid">
      {downloaders.map((downloader) => (
        <article className="endpoint-tile" key={downloader.id}>
          <div>
            <strong>{downloader.name}</strong>
            <span>{downloader.type}</span>
          </div>
          <div className="token-row">
            {downloader.isDefault && <Pill>Default</Pill>}
            <StatusPill ok={downloader.enabled}>{downloader.enabled ? "Enabled" : "Disabled"}</StatusPill>
          </div>
          <small>{downloader.jobCount ?? 0} jobs{downloader.category ? ` · ${downloader.category}` : ""}</small>
        </article>
      ))}
    </div>
  );
}

function TimelineBars({ timeline, compact = false }: { timeline: TimelinePoint[]; compact?: boolean }) {
  const maxCount = Math.max(1, ...timeline.map((point) => point.count));
  return (
    <div className={compact ? "timeline compact" : "timeline"}>
      {timeline.length === 0 && <Empty label="No timeline data yet" />}
      {timeline.map((point) => (
        <div className="bar-row" key={point.time}>
          <span>{new Date(point.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          <div><i style={{ width: `${Math.max(6, Math.round((point.count / maxCount) * 100))}%` }} /></div>
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
  return (
    <AppDialog description={title} title={title} onClose={onClose}>
      {children}
    </AppDialog>
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
      <FieldLabel>
        Feed name
        <FormInput value={name} onChange={(event) => setName(event.target.value)} required />
      </FieldLabel>
      <FieldLabel>
        Private RSS URL
        <FormInput
          placeholder={editing ? "Leave blank to keep current URL" : "https://tracker.example/rss"}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          required={!editing}
        />
      </FieldLabel>
      <div className="form-grid">
        <FieldLabel>
          Poll interval
          <FormInput
            type="number"
            min={60}
            value={pollIntervalSeconds}
            onChange={(event) => setPollIntervalSeconds(event.target.value)}
            required
          />
        </FieldLabel>
        <CheckboxField className="checkbox-row" checked={enabled} onCheckedChange={setEnabled} label="Enabled" />
      </div>
      {submitError && <p className="modal-feedback error">{submitError}</p>}
      <div className="modal-actions">
        <UiButton className="secondary" onClick={onCancel} type="button">
          Cancel
        </UiButton>
        <UiButton className="primary" disabled={busy} type="submit">
          {editing ? <Pencil size={17} /> : <Plus size={17} />}
          {editing ? "Save Feed" : "Add Feed"}
        </UiButton>
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
      <FieldLabel>
        Subscription title
        <FormInput value={title} onChange={(event) => setTitle(event.target.value)} required />
      </FieldLabel>
      <div className="form-grid">
        <div className="field">
          <span>Downloader</span>
          <SelectField
            value={downloaderId}
            onValueChange={setDownloaderId}
            options={[
              { value: "", label: "Default downloader" },
              ...downloaders.map((downloader) => ({ value: downloader.id, label: downloader.name }))
            ]}
          />
        </div>
        <div className="field">
          <span>Media kind</span>
          <SelectField
            value={mediaKind}
            onValueChange={(value) => setMediaKind(value as typeof mediaKind)}
            options={[
              { value: "", label: "Any kind" },
              { value: "MOVIE", label: "Movie" },
              { value: "TV", label: "Series" },
              { value: "UNKNOWN", label: "Unknown" }
            ]}
          />
        </div>
      </div>
      <div className="form-grid">
        <div className="field">
          <span>Provider</span>
          <SelectField
            value={provider}
            onValueChange={(value) => setProvider(value as typeof provider)}
            options={[
              { value: "", label: "Any provider" },
              { value: "tmdb", label: "TMDB" },
              { value: "imdb", label: "IMDb" },
              { value: "douban", label: "Douban" }
            ]}
          />
        </div>
        <FieldLabel>
          Provider ID
          <FormInput value={providerId} onChange={(event) => setProviderId(event.target.value)} />
        </FieldLabel>
      </div>
      <div className="form-grid">
        <FieldLabel>
          IMDb ID
          <FormInput placeholder="tt1234567" value={imdbId} onChange={(event) => setImdbId(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          Douban ID
          <FormInput value={doubanId} onChange={(event) => setDoubanId(event.target.value)} />
        </FieldLabel>
      </div>
      <div className="form-grid">
        <FieldLabel>
          Title regex
          <FormInput value={titleRegex} onChange={(event) => setTitleRegex(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          Include regex
          <FormInput value={includeRegex} onChange={(event) => setIncludeRegex(event.target.value)} />
        </FieldLabel>
      </div>
      <FieldLabel>
        Exclude regex
        <FormInput value={excludeRegex} onChange={(event) => setExcludeRegex(event.target.value)} />
      </FieldLabel>
      <div className="form-grid">
        <FieldLabel>
          Min resolution
          <FormInput min={1} type="number" value={minResolution} onChange={(event) => setMinResolution(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          Max resolution
          <FormInput min={1} type="number" value={maxResolution} onChange={(event) => setMaxResolution(event.target.value)} />
        </FieldLabel>
      </div>
      <div className="form-grid">
        <FieldLabel>
          Sources
          <FormInput placeholder="WEB-DL, BluRay" value={sources} onChange={(event) => setSources(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          Codecs
          <FormInput placeholder="x264, x265" value={codecs} onChange={(event) => setCodecs(event.target.value)} />
        </FieldLabel>
      </div>
      <FieldLabel>
        Audio
        <FormInput placeholder="Atmos, TrueHD" value={audio} onChange={(event) => setAudio(event.target.value)} />
      </FieldLabel>
      <div className="form-grid">
        <FieldLabel>
          Include release groups
          <FormInput value={releaseGroupsInclude} onChange={(event) => setReleaseGroupsInclude(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          Exclude release groups
          <FormInput value={releaseGroupsExclude} onChange={(event) => setReleaseGroupsExclude(event.target.value)} />
        </FieldLabel>
      </div>
      <div className="form-grid">
        <FieldLabel>
          Min size bytes
          <FormInput min={1} type="number" value={minSizeBytes} onChange={(event) => setMinSizeBytes(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          Max size bytes
          <FormInput min={1} type="number" value={maxSizeBytes} onChange={(event) => setMaxSizeBytes(event.target.value)} />
        </FieldLabel>
      </div>
      <div className="form-grid three">
        <FieldLabel>
          Season
          <FormInput min={1} type="number" value={season} onChange={(event) => setSeason(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          Episode start
          <FormInput min={1} type="number" value={episodeStart} onChange={(event) => setEpisodeStart(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          Episode end
          <FormInput min={1} type="number" value={episodeEnd} onChange={(event) => setEpisodeEnd(event.target.value)} />
        </FieldLabel>
      </div>
      <div className="form-grid">
        <CheckboxField className="checkbox-row" checked={autoDownload} onCheckedChange={setAutoDownload} label="Auto download" />
        <CheckboxField className="checkbox-row" checked={enabled} onCheckedChange={setEnabled} label="Enabled" />
      </div>
      {submitError && <p className="modal-feedback error">{submitError}</p>}
      <div className="modal-actions">
        <UiButton className="secondary" onClick={onCancel} type="button">
          Cancel
        </UiButton>
        <UiButton className="primary" disabled={busy} type="submit">
          <Pencil size={17} />
          Save Subscription
        </UiButton>
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
        <SelectField
          value={kind}
          onValueChange={(value) => setKind(value as "MOVIE" | "TV")}
          options={[
            { value: "MOVIE", label: "Movie" },
            { value: "TV", label: "Series" }
          ]}
        />
        <FormInput placeholder="Search TMDB" value={query} onChange={(event) => setQuery(event.target.value)} required />
        <FormInput placeholder="Include regex" value={includeRegex} onChange={(event) => setIncludeRegex(event.target.value)} />
        <SelectField
          value={String(minResolution)}
          onValueChange={(value) => setMinResolution(Number(value))}
          options={[
            { value: "720", label: "720p+" },
            { value: "1080", label: "1080p+" },
            { value: "2160", label: "2160p+" }
          ]}
        />
        <SelectField
          value={downloaderId}
          onValueChange={setDownloaderId}
          options={[
            { value: "", label: "Default downloader" },
            ...downloaders.map((downloader) => ({ value: downloader.id, label: downloader.name }))
          ]}
        />
        <UiButton className="primary" type="submit"><Search size={17} />Search</UiButton>
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
            <UiButton
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
            </UiButton>
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
      <SelectField
        value={downloaderId}
        onValueChange={setDownloaderId}
        disabled={disabled}
        options={downloaders.map((downloader) => ({ value: downloader.id, label: downloader.name }))}
        placeholder="Downloader"
      />
      <UiButton className="primary" disabled={disabled || !downloaderId} onClick={() => onDownload(downloaderId)}>
        <DownloadCloud size={17} />
        Send
      </UiButton>
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
    overview: "Review new releases, verify matches, and dispatch downloads",
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

function releaseTitle(item: Item) {
  return item.mediaMatch?.title ?? item.parsedRelease?.title ?? item.rawTitle;
}

function releaseStatus(item: Item): {
  label: string;
  detail: string;
  ok: boolean;
  group: "review" | "downloaded" | "failed";
} {
  const latestJob = [...(item.downloadJobs ?? [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0];
  if (latestJob?.status === "FAILED") {
    return { label: "Failed", detail: latestJob.error ?? "Download error", ok: false, group: "failed" };
  }
  if (latestJob && ["SENT", "COMPLETED"].includes(latestJob.status)) {
    return { label: "Downloaded", detail: "Sent to downloader", ok: true, group: "downloaded" };
  }
  if (latestJob) {
    return { label: latestJob.status, detail: "Download job active", ok: true, group: "review" };
  }
  if (item.mediaMatch) return { label: "Pending review", detail: "New match", ok: true, group: "review" };
  return { label: "Unmatched", detail: "Needs matching", ok: false, group: "review" };
}

function confidencePercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function confidenceBarWidth(value: number) {
  return `${Math.min(100, Math.max(6, Math.round(value * 100)))}%`;
}

function matchRate(matched: number, total: number) {
  if (total <= 0) return "0%";
  return `${Math.round((matched / total) * 100)}%`;
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
