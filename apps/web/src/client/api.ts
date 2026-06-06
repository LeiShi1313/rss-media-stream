export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { headers: inputHeaders, body, ...rest } = options;
  const method = (rest.method ?? "GET").toUpperCase();
  const headers = new Headers(inputHeaders);
  const normalizedBody = (body === undefined && ["POST", "PUT", "PATCH", "DELETE"].includes(method))
    ? "{}"
    : body;
  const effectiveBody = normalizedBody;

  if (effectiveBody !== undefined && effectiveBody !== null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    credentials: "include",
    ...rest,
    method: rest.method,
    body: effectiveBody,
    headers
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export type Feed = {
  id: string;
  name: string;
  urlPreview: string;
  pollIntervalSeconds: number;
  enabled: boolean;
  lastPolledAt?: string;
  lastError?: string;
  itemCount: number;
};

export type User = {
  id: string;
  email: string;
  name: string;
};

export type Workspace = {
  id: string;
  name: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
};

export type TmdbSettings = {
  configured: boolean;
  source: "workspace" | "environment" | null;
  configuredAt?: string | null;
  lastValidatedAt?: string | null;
  lastError?: string | null;
  tmdbLanguage?: string;
  webLanguage?: string;
};

export type AuthResponse = {
  user: User;
  workspace?: Workspace;
  activeWorkspace?: Workspace;
  workspaces?: Workspace[];
};

export type ParsedRelease = {
  id?: string;
  title: string;
  year?: number;
  kind: "MOVIE" | "TV" | "UNKNOWN";
  season?: number;
  episode?: number;
  episodeEnd?: number;
  resolution?: number;
  quality?: string;
  source?: string;
  codec?: string;
  audio?: string;
  releaseGroup?: string;
  confidence: number;
};

export type Media = {
  id: string;
  provider: string;
  providerId: string;
  kind: "MOVIE" | "TV" | "UNKNOWN";
  title: string;
  originalTitle?: string;
  year?: number;
  posterPath?: string;
  backdropPath?: string;
  overview?: string;
  searchTitle?: string;
  tmdbFetchedAt?: string;
  metadataJson?: unknown;
  createdAt?: string;
  updatedAt?: string;
  matchCount?: number;
  subscriptionCount?: number;
};

export type Item = {
  id: string;
  feed?: { id: string; name: string };
  rawTitle: string;
  sourceUrl?: string | null;
  firstSeenAt: string;
  sizeBytes?: string;
  parseConfidence?: number;
  parsedRelease?: ParsedRelease;
  mediaMatch?: {
    id: string;
    mediaId?: string;
    provider: string;
    providerId: string;
    kind: "MOVIE" | "TV" | "UNKNOWN";
    title: string;
    originalTitle?: string;
    year?: number;
    posterPath?: string;
    backdropPath?: string;
    overview?: string;
    score: number;
    status: string;
    reason?: string;
    matchedAt?: string;
    media?: Media;
    updatedAt?: string;
  };
  downloadJobs?: Array<{ id: string; status: string; error?: string; createdAt: string }>;
};

export type TrendingMedia = {
  media: Media;
  releaseCount: number;
  latestReleaseAt: string;
  feedCount: number;
  feeds: string[];
  qualities: string[];
  releaseGroups: string[];
};

export type MediaDetail = {
  media: Media;
  releases: Item[];
};

export type Downloader = {
  id: string;
  name: string;
  type: "QBITTORRENT" | "TRANSMISSION";
  baseUrl: string;
  username?: string;
  defaultSavePath?: string;
  category?: string;
  tags?: string[];
  enabled: boolean;
  isDefault?: boolean;
  jobCount: number;
};

export type MediaSearchResult = {
  provider: "tmdb" | "imdb" | "douban";
  providerId: string;
  kind: "MOVIE" | "TV" | "UNKNOWN";
  title: string;
  year?: number;
  posterPath?: string;
  score: number;
};

export type Subscription = {
  id: string;
  title: string;
  createdByUserId: string;
  media?: {
    id: string;
    provider: string;
    providerId: string;
    kind: "MOVIE" | "TV" | "UNKNOWN";
    title: string;
    year?: number;
    posterPath?: string;
  };
  downloader?: {
    id: string;
    name: string;
    type: "QBITTORRENT" | "TRANSMISSION";
    enabled: boolean;
  };
  autoDownload: boolean;
  enabled: boolean;
  rule?: {
    mediaKind?: "MOVIE" | "TV" | "UNKNOWN";
    provider?: string;
    providerId?: string;
    imdbId?: string;
    doubanId?: string;
    titleRegex?: string;
    includeRegex?: string;
    excludeRegex?: string;
    minResolution?: number;
    maxResolution?: number;
    sources?: string[];
    codecs?: string[];
    audio?: string[];
    releaseGroupsInclude?: string[];
    releaseGroupsExclude?: string[];
    minSizeBytes?: string;
    maxSizeBytes?: string;
    season?: number;
    episodeStart?: number;
    episodeEnd?: number;
  };
  createdAt: string;
  updatedAt: string;
};

export type DownloadJob = {
  id: string;
  itemId: string;
  subscriptionId?: string;
  downloaderId: string;
  createdByUserId?: string;
  source: "MANUAL" | "SUBSCRIPTION" | "RETRY";
  status: string;
  clientHash?: string;
  attemptCount?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
  item?: {
    id: string;
    rawTitle: string;
    feed?: { id: string; name: string };
  };
  downloader?: { id: string; name: string; type: string };
  subscription?: { id: string; title: string };
};

export type WorkspaceMember = {
  userId: string;
  email: string;
  name: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  createdAt: string;
  updatedAt: string;
};
