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

export type ProviderCredentialSettings = {
  configured: boolean;
  source: "workspace" | "environment" | null;
  configuredAt?: string | null;
  lastValidatedAt?: string | null;
  lastError?: string | null;
};

export type WorkspaceSettings = {
  webLanguage?: string;
};

export type ProviderAuthField = {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
};

export type ProviderSettings = {
  id: "tmdb" | "tvdb";
  label: string;
  supportedMediaTypes: Array<"MOVIE" | "TV_SERIES">;
  authFields: ProviderAuthField[];
  supportsMetadataLanguage: boolean;
  supportsRegion: boolean;
  enabled: boolean;
  configured: boolean;
  credentialSource: "workspace" | "environment" | null;
  configuredAt?: string | null;
  lastValidatedAt?: string | null;
  lastError?: string | null;
  metadataLanguage?: string | null;
  region?: string | null;
};

export type ProviderSettingsResponse = {
  providers: ProviderSettings[];
};

export type MediaProviderPolicy = {
  provider: "tmdb" | "tvdb";
  label: string;
  mediaType: "MOVIE" | "TV_SERIES";
  enabledForMatching: boolean;
  enabledForPresentation: boolean;
  matchingPriority: number;
  presentationPriority: number;
};

export type MediaProviderPoliciesResponse = {
  mediaTypes: Array<{
    mediaType: "MOVIE" | "TV_SERIES";
    policies: MediaProviderPolicy[];
  }>;
};

export type ProviderEntityType = string;
export type MediaType = "MOVIE" | "TV_SERIES" | "UNKNOWN";
export type MatchStatus = "MATCHED" | "UNMATCHED" | "REJECTED";
export type MatchSource = "AUTO" | "MANUAL";

export type ProviderRefDto = {
  provider: string;
  providerEntityType: string;
  providerId: string;
};

export type RatingDto = ProviderRefDto & {
  value: number;
  scale: number;
  normalized: number;
  voteCount?: number;
  type: "user_score" | "critic_score" | "popularity";
};

export type ProviderIdentityFilter = {
  provider: string;
  providerEntityType?: ProviderEntityType;
  providerId: string;
};

export type ProviderRatingFilter = {
  provider: string;
  ratingType?: "user_score" | "critic_score" | "popularity";
  comparison: "gte" | "lte" | "gt" | "lt" | "eq";
  value: number;
  scale?: number;
  minVoteCount?: number;
};

export type MediaPresentationDto = {
  mediaTitleId?: string;
  mediaType: MediaType;
  title: string;
  originalTitle?: string | null;
  releaseYear?: number | null;
  overview?: string | null;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  displaySource?: ProviderRefDto;
  rating?: RatingDto;
  hasCover: boolean;
};

export type ReleaseMatchDto = {
  id?: string;
  status: MatchStatus;
  source?: MatchSource;
  confidence?: number | null;
  reason?: string | null;
  matchedAt?: string | null;
  providerTitle?: ProviderRefDto;
  presentation?: MediaPresentationDto;
  attention: {
    required: boolean;
    reasons: Array<"low_confidence" | "unmatched" | "provider_not_configured" | "no_result" | "unknown_media_type" | "no_cover" | "failed_download">;
  };
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
  mediaTitleId?: string;
  provider: string;
  providerEntityType?: ProviderEntityType;
  providerId: string;
  kind: "MOVIE" | "TV" | "UNKNOWN";
  mediaType?: MediaType;
  title: string;
  originalTitle?: string | null;
  year?: number;
  releaseYear?: number | null;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  overview?: string | null;
  displaySource?: ProviderRefDto;
  rating?: RatingDto;
  hasCover?: boolean;
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
  enrichmentState?: "MATCHED" | "UNMATCHED" | "PENDING" | "UNPARSED";
  match?: ReleaseMatchDto;
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
  provider: string;
  providerEntityType?: ProviderEntityType;
  providerId: string;
  mediaType: Exclude<MediaType, "UNKNOWN">;
  kind: "MOVIE" | "TV" | "UNKNOWN";
  title: string;
  originalTitle?: string;
  year?: number;
  posterUrl?: string | null;
  presentation?: MediaPresentationDto;
  hasCover?: boolean;
  score: number;
  attributionText?: string;
  externalUrl?: string;
};

export type Subscription = {
  id: string;
  title: string;
  createdByUserId: string;
  media?: {
    id: string;
    provider: string;
    providerEntityType?: ProviderEntityType;
    providerId: string;
    kind: "MOVIE" | "TV" | "UNKNOWN";
    title: string;
    year?: number;
    posterUrl?: string | null;
    hasCover?: boolean;
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
    mediaType?: MediaType;
    mediaTitleId?: string;
    selectedProvider?: ProviderIdentityFilter;
    linkedProviders?: ProviderIdentityFilter[];
    providerRatings?: ProviderRatingFilter[];
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
