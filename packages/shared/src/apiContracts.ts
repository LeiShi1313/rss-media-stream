import type {
  MediaProvider,
  MediaType,
  ParsedMediaType,
  ProviderSource,
  RatingComparison,
  RatingType,
  SubscriptionMode,
  SubscriptionUpgradePolicy
} from "./types.js";

export type TenantRoleDto = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

export type SetupStatusDto = {
  required: boolean;
};

export type UserDto = {
  id: string;
  email: string;
  name: string;
};

export type WorkspaceDto = {
  id: string;
  name: string;
  role: TenantRoleDto;
  createdAt?: string;
  updatedAt?: string;
};

export type AuthResponseDto = {
  user: UserDto;
  workspace?: WorkspaceDto;
  activeWorkspace?: WorkspaceDto;
  workspaces?: WorkspaceDto[];
};

export type WorkspaceSettingsDto = {
  webLanguage: string;
};

export type WorkspaceMemberDto = {
  userId: string;
  email: string;
  name: string;
  role: TenantRoleDto;
  createdAt: string;
  updatedAt: string;
};

export type TimelinePointDto = {
  time: string;
  count: number;
};

export type ProviderAuthFieldDto = {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
};

export type ProviderBaseUrlOptionDto = {
  label: string;
  value: string;
};

export type ProviderSettingsDto = {
  id: ProviderSource;
  provider: MediaProvider;
  label: string;
  supportedMediaTypes: MediaType[];
  ratingSupportedMediaTypes: MediaType[];
  authFields: ProviderAuthFieldDto[];
  supportsMetadataLanguage: boolean;
  supportsRegion: boolean;
  baseUrlOptions: ProviderBaseUrlOptionDto[];
  enabled: boolean;
  configured: boolean;
  credentialSource: "workspace" | "environment" | null;
  configuredAt: string | null;
  lastValidatedAt: string | null;
  lastError: string | null;
  metadataLanguage: string | null;
  region: string | null;
  baseUrl: string | null;
};

export type ProviderSettingsResponseDto = {
  providers: ProviderSettingsDto[];
};

export type MediaProviderPolicyDto = {
  providerSource: ProviderSource;
  provider: MediaProvider;
  label: string;
  mediaType: MediaType;
  enabledForMatching: boolean;
  enabledForPresentation: boolean;
  matchingPriority: number;
  presentationPriority: number;
};

export type MediaProviderPoliciesResponseDto = {
  mediaTypes: Array<{
    mediaType: MediaType;
    ratingProviderSource: ProviderSource;
    policies: MediaProviderPolicyDto[];
  }>;
};

export type ProviderRefDto = {
  provider: string;
  providerSource?: string;
  providerEntityType?: string;
  providerId: string;
};

export type RatingDto = ProviderRefDto & {
  providerSource: string;
  providerLabel: string;
  providerSourceLabel: string;
  value: number;
  scale: number;
  voteCount?: number | null;
  type: RatingType;
  fetchedAt?: string;
};

export type MediaPresentationDto = {
  mediaTitleId?: string;
  mediaType: ParsedMediaType;
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

export type AttentionReasonDto =
  | "low_confidence"
  | "unmatched"
  | "provider_not_configured"
  | "no_result"
  | "unknown_media_type"
  | "no_cover"
  | "failed_download";

export type ReleaseMatchDto = {
  id?: string;
  status: "MATCHED" | "UNMATCHED" | "REJECTED";
  source?: "AUTO" | "MANUAL";
  confidence?: number | null;
  reason?: string | null;
  matchedAt?: string | null;
  providerTitle?: ProviderRefDto;
  providerMetadata?: ProviderRefDto;
  presentation?: MediaPresentationDto;
  attention: {
    required: boolean;
    reasons: AttentionReasonDto[];
  };
};

export type FeedDto = {
  id: string;
  name: string;
  urlPreview: string | null;
  hasRequestHeaders: boolean;
  pollIntervalSeconds: number;
  enabled: boolean;
  lastPolledAt: string | null;
  lastError: string | null;
  deletedAt: string | null;
  itemCount: number;
};

export type ParsedReleaseDto = {
  id: string;
  title: string;
  year: number | null;
  kind: "MOVIE" | "TV" | "UNKNOWN";
  mediaType: ParsedMediaType;
  tvUnitType: string | null;
  season: number | null;
  episode: number | null;
  episodeEnd: number | null;
  specialNumber: number | null;
  episodePart: string | null;
  resolution: number | null;
  quality: string | null;
  source: string | null;
  codec: string | null;
  audio: string | null;
  releaseGroup: string | null;
  variant: string | null;
  confidence: number;
  parseConfidence: number;
  parsedAt: string;
};

export type ItemDownloadSummaryDto = {
  id: string;
  status: string;
  error: string | null;
  clientHash: string | null;
  createdAt: string;
};

export type ItemDto = {
  id: string;
  feed: { id: string; name: string };
  rawTitle: string;
  sourceUrl: string | null;
  sizeBytes: string | null;
  publishDate: string | null;
  firstSeenAt: string;
  dedupeKeyType: "INFO_HASH" | "RELEASE_SIGNATURE" | "LINK_HASH";
  parsedRelease?: ParsedReleaseDto;
  enrichmentState: "MATCHED" | "UNMATCHED" | "PENDING" | "UNPARSED";
  match?: ReleaseMatchDto;
  downloadJobs: ItemDownloadSummaryDto[];
};

export type ItemPageDto = {
  items: ItemDto[];
  nextCursor?: string;
};

export type MediaTitleDto = {
  id: string;
  mediaTitleId?: string;
  kind: "MOVIE" | "TV" | "UNKNOWN";
  mediaType: ParsedMediaType;
  title: string;
  originalTitle?: string | null;
  year?: number | null;
  releaseYear?: number | null;
  overview?: string | null;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  displaySource?: ProviderRefDto;
  rating?: RatingDto;
  hasCover: boolean;
  createdAt?: string;
  updatedAt?: string;
  matchCount?: number;
  subscriptionCount?: number;
};

export type TrendingMediaDto = {
  media: MediaTitleDto;
  releaseCount: number;
  latestReleaseAt: string;
  feedCount: number;
  feeds: string[];
  qualities: string[];
  releaseGroups: string[];
};

export type TrendingMediaPageDto = {
  items: TrendingMediaDto[];
  nextCursor?: string;
};

export type MediaDetailDto = {
  media: MediaTitleDto;
  releases: ItemDto[];
};

export type MediaSearchResultDto = {
  provider: string;
  providerSource?: string;
  providerEntityType?: string;
  providerId: string;
  mediaType: MediaType;
  kind: "MOVIE" | "TV" | "UNKNOWN";
  title: string;
  originalTitle?: string;
  year?: number;
  posterUrl?: string | null;
  presentation: MediaPresentationDto;
  hasCover: boolean;
  score: number;
  attributionText?: string;
  externalUrl?: string;
};

export type ProviderSearchResponseDto = {
  results: MediaSearchResultDto[];
};

export type ResolvedMediaTitleDto = {
  mediaTitleId: string;
  mediaType: MediaType;
  title: string;
  originalTitle?: string | null;
  year?: number | null;
  posterUrl?: string | null;
  hasCover: boolean;
  provider: string;
  providerSource?: string;
  providerEntityType?: string;
  providerId: string;
  presentation: MediaPresentationDto;
};

export type DownloaderDto = {
  id: string;
  name: string;
  type: "QBITTORRENT" | "TRANSMISSION";
  baseUrl: string;
  username: string | null;
  defaultSavePath: string | null;
  category: string | null;
  tags: string[];
  enabled: boolean;
  isDefault: boolean;
  jobCount: number;
  createdAt: string;
  updatedAt: string;
};

export type DownloaderTestDto = {
  ok: true;
  version?: string;
};

export type ProviderIdentityFilterDto = {
  provider: string;
  mediaType?: MediaType;
  providerEntityType?: string;
  providerId: string;
};

export type ProviderRatingFilterDto = {
  provider: string;
  ratingType?: RatingType;
  comparison: RatingComparison;
  value: number;
  scale?: number;
  minVoteCount?: number;
};

export type SubscriptionRuleDto = {
  id: string;
  mode: SubscriptionMode;
  mediaType: ParsedMediaType | null;
  mediaTitleId?: string;
  selectedProvider?: ProviderIdentityFilterDto;
  linkedProviders: ProviderIdentityFilterDto[];
  providerRatings: ProviderRatingFilterDto[];
  feedIds: string[];
  titleRegex: string | null;
  includeRegex: string | null;
  excludeRegex: string | null;
  minResolution: number | null;
  maxResolution: number | null;
  sources: string[];
  codecs: string[];
  audio: string[];
  releaseGroupsInclude: string[];
  releaseGroupsExclude: string[];
  variantsInclude: string[];
  variantsExclude: string[];
  preferredReleaseGroups: string[];
  minSizeBytes?: string;
  maxSizeBytes?: string;
  season: number | null;
  episodeStart: number | null;
  episodeEnd: number | null;
  upgradePolicy: SubscriptionUpgradePolicy;
  allowCrossSeed: boolean;
  separateVariants: boolean;
  seasonPackAllowed: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SubscriptionDto = {
  id: string;
  title: string;
  createdByUserId: string;
  media?: {
    id: string;
    provider: string;
    providerSource?: string;
    providerEntityType?: string;
    providerId: string;
    kind: "MOVIE" | "TV" | "UNKNOWN";
    mediaType: MediaType;
    title: string;
    year?: number | null;
    posterUrl?: string | null;
    hasCover: boolean;
  };
  downloader?: {
    id: string;
    name: string;
    type: "QBITTORRENT" | "TRANSMISSION";
    enabled: boolean;
  };
  autoDownload: boolean;
  enabled: boolean;
  rule?: SubscriptionRuleDto;
  createdAt: string;
  updatedAt: string;
};

export type DownloadJobDto = {
  id: string;
  itemId: string;
  subscriptionId: string | null;
  downloaderId: string;
  createdByUserId: string | null;
  source: "MANUAL" | "SUBSCRIPTION" | "RETRY";
  status:
    | "QUEUED"
    | "SENDING"
    | "SENT"
    | "FAILED"
    | "SKIPPED"
    | "DOWNLOADING"
    | "COMPLETE";
  clientHash: string | null;
  attemptCount: number;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  sentAt: string | null;
  completedAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  item: {
    id: string;
    rawTitle: string;
    feed: { id: string; name: string } | null;
  };
  downloader: { id: string; name: string; type: string };
  subscription: { id: string; title: string } | null;
};
