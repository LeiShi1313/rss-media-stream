export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    },
    ...options
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

export type ParsedRelease = {
  title: string;
  year?: number;
  kind: "MOVIE" | "TV" | "UNKNOWN";
  season?: number;
  episode?: number;
  quality?: string;
  source?: string;
  codec?: string;
  confidence: number;
};

export type Item = {
  id: string;
  feed?: { id: string; name: string };
  rawTitle: string;
  firstSeenAt: string;
  sizeBytes?: string;
  parseConfidence: number;
  parsedRelease?: ParsedRelease;
  mediaMatch?: {
    id: string;
    provider: string;
    providerId: string;
    kind: "MOVIE" | "TV" | "UNKNOWN";
    title: string;
    year?: number;
    posterPath?: string;
    score: number;
    status: string;
  };
  downloadJobs?: Array<{ id: string; status: string; error?: string; createdAt: string }>;
};

export type Downloader = {
  id: string;
  name: string;
  type: "QBITTORRENT" | "TRANSMISSION";
  baseUrl: string;
  username?: string;
  defaultSavePath?: string;
  category?: string;
  tags?: string;
  enabled: boolean;
  jobCount: number;
};

export type MediaSearchResult = {
  provider: "tmdb";
  providerId: string;
  kind: "MOVIE" | "TV";
  title: string;
  year?: number;
  posterPath?: string;
  score: number;
};
