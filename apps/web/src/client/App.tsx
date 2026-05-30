import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Activity,
  DownloadCloud,
  Flame,
  Film,
  HardDrive,
  LogOut,
  Plus,
  RefreshCw,
  Rss,
  Search,
  Shield,
  Tv
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { api, type Downloader, type Feed, type Item, type MediaSearchResult } from "./api.js";

type User = { id: string; email: string; name: string; role: string };
type HeatItem = { title: string; count: number; posterPath?: string; latest: string };
type PosterItem = { id: string; title: string; year?: number; kind: string; posterUrl: string; score: number };
type TimelinePoint = { time: string; count: number };

export function App() {
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void bootstrap();
  }, []);

  async function bootstrap() {
    try {
      const setup = await api<{ required: boolean }>("/api/setup/status");
      setSetupRequired(setup.required);
      if (!setup.required) {
        setUser(await api<User>("/api/me"));
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
        onDone={(nextUser) => {
          setUser(nextUser);
          setSetupRequired(false);
          setError("");
        }}
      />
    );
  }

  return (
    <Dashboard
      user={user}
      onLogout={async () => {
        await api("/api/logout", { method: "POST" });
        setUser(null);
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
  onDone: (user: User) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const user = await api<User>(setupRequired ? "/api/setup" : "/api/login", {
        method: "POST",
        body: JSON.stringify(setupRequired ? { email, name, password } : { email, password })
      });
      onDone(user);
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

function Dashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [downloaders, setDownloaders] = useState<Downloader[]>([]);
  const [heat, setHeat] = useState<HeatItem[]>([]);
  const [posters, setPosters] = useState<PosterItem[]>([]);
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [nextFeeds, nextItems, nextDownloaders, nextHeat, nextPosters, nextTimeline] = await Promise.all([
        api<Feed[]>("/api/feeds"),
        api<Item[]>("/api/items?limit=80"),
        api<Downloader[]>("/api/downloaders"),
        api<HeatItem[]>("/api/dashboard/heat"),
        api<PosterItem[]>("/api/dashboard/posters"),
        api<TimelinePoint[]>("/api/dashboard/timeline")
      ]);
      setFeeds(nextFeeds);
      setItems(nextItems);
      setDownloaders(nextDownloaders);
      setHeat(nextHeat);
      setPosters(nextPosters);
      setTimeline(nextTimeline);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void load();
    const events = new EventSource("/events", { withCredentials: true });
    events.addEventListener("feed.refresh", () => void load());
    events.addEventListener("download.sent", () => void load());
    events.addEventListener("download.failed", () => void load());
    return () => events.close();
  }, []);

  const stats = useMemo(
    () => ({
      totalItems: items.length,
      matched: items.filter((item) => item.mediaMatch?.status === "MATCHED").length,
      jobs: items.flatMap((item) => item.downloadJobs ?? []).length
    }),
    [items]
  );

  async function runAction(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
            <p>{user.name}</p>
          </div>
        </div>
        <nav>
          <a href="#stream"><Activity size={18} />Stream</a>
          <a href="#feeds"><Rss size={18} />Feeds</a>
          <a href="#subscriptions"><Film size={18} />Subscriptions</a>
          <a href="#downloaders"><HardDrive size={18} />Downloaders</a>
        </nav>
        <button className="ghost" onClick={onLogout}>
          <LogOut size={18} />
          Sign Out
        </button>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <h2>Live Stream</h2>
            <p>TMDB-first matching with rule-based downloader automation</p>
          </div>
          <button className="icon-button" onClick={() => void load()} title="Refresh dashboard">
            <RefreshCw size={18} />
          </button>
        </header>

        {error && <div className="notice">{error}</div>}

        <section className="metric-grid" id="stream">
          <Metric label="Items" value={stats.totalItems} icon={<Activity size={19} />} />
          <Metric label="Matched" value={stats.matched} icon={<Film size={19} />} />
          <Metric label="Jobs" value={stats.jobs} icon={<DownloadCloud size={19} />} />
          <Metric label="Feeds" value={feeds.length} icon={<Rss size={19} />} />
        </section>

        <section className="two-column">
          <Panel title="Heat" icon={<Flame size={19} />}>
            <div className="heat-list">
              {heat.length === 0 && <Empty label="No feed activity yet" />}
              {heat.map((entry) => (
                <div className="heat-row" key={entry.title}>
                  <strong>{entry.title}</strong>
                  <span>{entry.count} releases</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Timeline" icon={<Activity size={19} />}>
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
          </Panel>
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

        <section className="two-column">
          <Panel title="RSS Feeds" icon={<Rss size={19} />} id="feeds">
            <FeedForm onCreate={(body) => runAction(() => api("/api/feeds", { method: "POST", body }))} />
            <div className="list">
              {feeds.map((feed) => (
                <article className="row-card" key={feed.id}>
                  <div>
                    <strong>{feed.name}</strong>
                    <code>{feed.urlPreview}</code>
                    {feed.lastError && <p className="error">{feed.lastError}</p>}
                  </div>
                  <button
                    className="icon-button"
                    disabled={busy}
                    onClick={() => runAction(() => api(`/api/feeds/${feed.id}/refresh`, { method: "POST" }))}
                    title="Refresh feed"
                  >
                    <RefreshCw size={17} />
                  </button>
                </article>
              ))}
            </div>
          </Panel>

          <Panel title="Downloaders" icon={<HardDrive size={19} />} id="downloaders">
            <DownloaderForm onCreate={(body) => runAction(() => api("/api/downloaders", { method: "POST", body }))} />
            <div className="list">
              {downloaders.map((downloader) => (
                <article className="row-card" key={downloader.id}>
                  <div>
                    <strong>{downloader.name}</strong>
                    <span>{downloader.type} · {downloader.baseUrl}</span>
                  </div>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => runAction(() => api(`/api/downloaders/${downloader.id}/test`, { method: "POST" }))}
                  >
                    Test
                  </button>
                </article>
              ))}
            </div>
          </Panel>
        </section>

        <Panel title="Subscriptions" icon={<Search size={19} />} id="subscriptions">
          <SubscriptionSearch
            downloaders={downloaders}
            onSubscribe={(body) => runAction(() => api("/api/subscriptions", { method: "POST", body }))}
          />
        </Panel>

        <Panel title="Recent RSS Items" icon={<Activity size={19} />}>
          <div className="item-list">
            {items.length === 0 && <Empty label="Add a feed and refresh it to start tracking releases" />}
            {items.map((item) => (
              <article className="item-row" key={item.id}>
                <div className="item-main">
                  <strong>{item.mediaMatch?.title ?? item.parsedRelease?.title ?? item.rawTitle}</strong>
                  <span>{item.rawTitle}</span>
                  <small>
                    {item.feed?.name ?? "Feed"} · {formatDistanceToNow(new Date(item.firstSeenAt), { addSuffix: true })}
                  </small>
                </div>
                <div className="item-meta">
                  <Pill>{item.parsedRelease?.kind ?? "UNKNOWN"}</Pill>
                  {item.parsedRelease?.quality && <Pill>{item.parsedRelease.quality}</Pill>}
                  {item.parsedRelease?.kind === "TV" && (
                    <Pill>
                      <Tv size={13} />
                      S{item.parsedRelease.season}E{item.parsedRelease.episode}
                    </Pill>
                  )}
                  {item.mediaMatch ? <Pill>{Math.round(item.mediaMatch.score * 100)}%</Pill> : <Pill>Unmatched</Pill>}
                </div>
                <div className="item-actions">
                  <button className="secondary" disabled={busy} onClick={() => runAction(() => api(`/api/items/${item.id}/match`, { method: "POST" }))}>
                    Match
                  </button>
                  <ManualDownload
                    disabled={busy || downloaders.length === 0}
                    downloaders={downloaders}
                    onDownload={(downloaderId) =>
                      runAction(() =>
                        api(`/api/items/${item.id}/download`, {
                          method: "POST",
                          body: JSON.stringify({ downloaderId })
                        })
                      )
                    }
                  />
                </div>
              </article>
            ))}
          </div>
        </Panel>
      </section>
    </main>
  );
}

function Metric({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
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
  id,
  children
}: {
  title: string;
  icon: React.ReactNode;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel" id={id}>
      <header>
        <h3>{icon}{title}</h3>
      </header>
      {children}
    </section>
  );
}

function FeedForm({ onCreate }: { onCreate: (body: string) => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [pollIntervalSeconds, setPollIntervalSeconds] = useState(300);
  return (
    <form
      className="inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        onCreate(JSON.stringify({ name, url, pollIntervalSeconds, enabled: true }));
        setName("");
        setUrl("");
      }}
    >
      <input placeholder="Feed name" value={name} onChange={(event) => setName(event.target.value)} required />
      <input placeholder="Private RSS URL" value={url} onChange={(event) => setUrl(event.target.value)} required />
      <input
        aria-label="Poll interval"
        type="number"
        min={60}
        value={pollIntervalSeconds}
        onChange={(event) => setPollIntervalSeconds(Number(event.target.value))}
      />
      <button className="primary" type="submit"><Plus size={17} />Add</button>
    </form>
  );
}

function DownloaderForm({ onCreate }: { onCreate: (body: string) => void }) {
  const [type, setType] = useState<"QBITTORRENT" | "TRANSMISSION">("QBITTORRENT");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  return (
    <form
      className="inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        onCreate(JSON.stringify({ type, name, baseUrl, username, password, enabled: true }));
        setName("");
        setBaseUrl("");
        setUsername("");
        setPassword("");
      }}
    >
      <select value={type} onChange={(event) => setType(event.target.value as "QBITTORRENT" | "TRANSMISSION")}>
        <option value="QBITTORRENT">qBittorrent</option>
        <option value="TRANSMISSION">Transmission</option>
      </select>
      <input placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} required />
      <input placeholder="http://localhost:8080" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required />
      <input placeholder="Username" value={username} onChange={(event) => setUsername(event.target.value)} />
      <input placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
      <button className="primary" type="submit"><Plus size={17} />Add</button>
    </form>
  );
}

function SubscriptionSearch({
  downloaders,
  onSubscribe
}: {
  downloaders: Downloader[];
  onSubscribe: (body: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"MOVIE" | "TV">("MOVIE");
  const [results, setResults] = useState<MediaSearchResult[]>([]);
  const [downloaderId, setDownloaderId] = useState("");
  const [includeRegex, setIncludeRegex] = useState("");
  const [minQuality, setMinQuality] = useState("1080p");

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
        <select value={minQuality} onChange={(event) => setMinQuality(event.target.value)}>
          <option value="720p">720p+</option>
          <option value="1080p">1080p+</option>
          <option value="2160p">2160p+</option>
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
              <img src={`https://image.tmdb.org/t/p/w185${result.posterPath}`} alt={result.title} />
            ) : (
              <div className="poster-placeholder"><Film size={24} /></div>
            )}
            <strong>{result.title}</strong>
            <span>{result.year ?? "Unknown"} · {Math.round(result.score * 100)}%</span>
            <button
              className="secondary"
              onClick={() =>
                onSubscribe(
                  JSON.stringify({
                    downloaderId: downloaderId || undefined,
                    mediaProvider: result.provider,
                    mediaProviderId: result.providerId,
                    mediaKind: result.kind,
                    title: result.title,
                    year: result.year,
                    includeRegex: includeRegex || undefined,
                    minQuality,
                    autoDownload: true,
                    enabled: true
                  })
                )
              }
            >
              Subscribe
            </button>
          </article>
        ))}
      </div>
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

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="pill">{children}</span>;
}

function Empty({ label }: { label: string }) {
  return <p className="empty">{label}</p>;
}
