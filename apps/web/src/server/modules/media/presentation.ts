export type MediaPresentationDto = {
  mediaTitleId?: string;
  mediaType: "MOVIE" | "TV_SERIES" | "UNKNOWN";
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

export type ProviderRefDto = {
  provider: string;
  providerEntityType: string;
  providerId: string;
};

export type RatingDto = ProviderRefDto & {
  value: number;
  scale: number;
  normalized: number;
  voteCount?: number | null;
  type: "user_score" | "critic_score" | "popularity";
};

export type PresentationOptions = {
  providerOrder?: string[];
};

export type PresentationOrders = Partial<Record<"MOVIE" | "TV_SERIES", string[]>>;

export function providerOrderForMediaType(
  orders: PresentationOrders,
  mediaType?: string | null
) {
  return mediaType === "MOVIE" || mediaType === "TV_SERIES"
    ? orders[mediaType]
    : undefined;
}

export type ReleaseMatchDto = {
  id?: string;
  status: "MATCHED" | "UNMATCHED" | "REJECTED";
  source?: "AUTO" | "MANUAL";
  confidence?: number | null;
  reason?: string | null;
  matchedAt?: string | null;
  providerTitle?: ProviderRefDto;
  presentation?: MediaPresentationDto;
  attention: {
    required: boolean;
    reasons: AttentionReason[];
  };
};

export type AttentionReason =
  | "low_confidence"
  | "unmatched"
  | "provider_not_configured"
  | "no_result"
  | "unknown_media_type"
  | "no_cover"
  | "failed_download";

export const LOW_CONFIDENCE_THRESHOLD = 0.88;
export function serializeProviderRef(providerTitle: any): ProviderRefDto | undefined {
  if (!providerTitle?.provider || !providerTitle.providerEntityType || !providerTitle.providerId) {
    return undefined;
  }
  return {
    provider: providerTitle.provider,
    providerEntityType: providerTitle.providerEntityType,
    providerId: providerTitle.providerId
  };
}

export function serializeMediaPresentation(input: {
  mediaTitle?: any;
  providerTitle?: any;
  providerLinks?: Array<{ providerTitle?: any }>;
  release?: any;
  rawTitle?: string;
}, options: PresentationOptions = {}): MediaPresentationDto {
  const mediaTitle = input.mediaTitle;
  const release = input.release;
  const providerTitle = selectPresentationProviderTitle({
    mediaTitle,
    selectedProviderTitle: input.providerTitle,
    providerLinks: input.providerLinks ?? mediaTitle?.providerLinks,
    release,
    providerOrder: options.providerOrder
  });
  const payload = providerPayload(providerTitle?.payload);
  const mediaType = mediaTitle?.mediaType ?? providerTitle?.mediaType ?? release?.mediaType ?? "UNKNOWN";
  const title = providerTitle?.title ?? mediaTitle?.canonicalTitle ?? release?.title ?? input.rawTitle ?? "Unknown";
  const source = serializeProviderRef(providerTitle);
  const posterUrl = providerImageUrl(providerTitle?.provider, payload.posterPath, "w342");
  const backdropUrl = providerImageUrl(providerTitle?.provider, payload.backdropPath, "w342");

  return {
    mediaTitleId: mediaTitle?.id,
    mediaType,
    title,
    originalTitle: mediaTitle?.originalTitle ?? providerTitle?.originalTitle ?? undefined,
    releaseYear: mediaTitle?.releaseYear ?? providerTitle?.releaseYear ?? release?.year ?? undefined,
    overview: payload.overview,
    posterUrl,
    backdropUrl,
    displaySource: source,
    rating: serializeRating(providerTitle),
    hasCover: Boolean(posterUrl)
  };
}

export function selectPresentationProviderTitle(input: {
  mediaTitle?: any;
  selectedProviderTitle?: any;
  providerLinks?: Array<{ providerTitle?: any; updatedAt?: unknown; createdAt?: unknown }>;
  release?: any;
  providerOrder?: string[];
}) {
  const mediaType = input.mediaTitle?.mediaType ?? input.selectedProviderTitle?.mediaType ?? input.release?.mediaType;
  const choices: Array<{
    providerTitle: any;
    selected: boolean;
    linkUpdatedAt?: unknown;
    linkCreatedAt?: unknown;
  }> = [];
  const seen = new Set<string>();

  // Active release matches keep their selected provider as presentation provenance.
  addProviderChoice(choices, seen, input.selectedProviderTitle, true);
  for (const link of input.providerLinks ?? []) {
    addProviderChoice(choices, seen, link.providerTitle, false, link);
  }

  const filtered = input.providerOrder
    ? choices.filter((choice) =>
        input.providerOrder!.includes(choice.providerTitle?.provider)
      )
    : choices;

  return filtered.sort((a, b) => compareProviderChoices(a, b, mediaType, input.providerOrder))[0]?.providerTitle;
}

export function serializeReleaseMatch(input: {
  match?: any;
  release?: any;
  rawTitle?: string;
  downloadJobs?: Array<{ status?: string | null }>;
}, options: PresentationOptions = {}): ReleaseMatchDto | undefined {
  const { match, release, rawTitle } = input;
  if (!match) return undefined;

  const presentation = serializeMediaPresentation({
    mediaTitle: match.mediaTitle,
    providerTitle: match.providerTitle,
    release,
    rawTitle
  }, options);
  const attentionReasons = releaseAttentionReasons(match, presentation, input.downloadJobs);

  return {
    id: match.id,
    status: match.status,
    source: match.source,
    confidence: match.confidence,
    reason: match.reason,
    matchedAt: match.matchedAt?.toISOString?.() ?? match.matchedAt,
    providerTitle: serializeProviderRef(match.providerTitle),
    presentation,
    attention: {
      required: attentionReasons.length > 0,
      reasons: attentionReasons
    }
  };
}

export function serializeProviderTitleSearchResult(result: {
  provider: string;
  providerEntityType: string;
  providerId: string;
  mediaType: "MOVIE" | "TV_SERIES";
  title: string;
  originalTitle?: string;
  releaseYear?: number;
  payload: unknown;
  ratingValue?: number;
  ratingScale?: number;
  ratingVoteCount?: number;
  ratingType?: string;
  matchConfidence?: number;
  externalUrl?: string;
}) {
  const presentation = serializeMediaPresentation({
    providerTitle: result
  });
  return {
    provider: result.provider,
    providerEntityType: result.providerEntityType,
    providerId: result.providerId,
    mediaType: result.mediaType,
    kind: legacyKindFromMediaType(result.mediaType),
    title: result.title,
    originalTitle: result.originalTitle,
    year: result.releaseYear,
    score: result.matchConfidence ?? 0,
    attributionText: result.provider.toUpperCase(),
    externalUrl: result.externalUrl,
    presentation,
    posterUrl: presentation.posterUrl,
    hasCover: presentation.hasCover
  };
}

function releaseAttentionReasons(
  match: any,
  presentation: MediaPresentationDto,
  downloadJobs?: Array<{ status?: string | null }>
): AttentionReason[] {
  const reasons = new Set<AttentionReason>();
  if (downloadJobs?.some((job) => job.status === "FAILED")) reasons.add("failed_download");

  if (match.status === "UNMATCHED") {
    reasons.add("unmatched");
    if (match.reason === "provider_not_configured") reasons.add("provider_not_configured");
    if (match.reason === "no_result") reasons.add("no_result");
    if (match.reason === "unknown_media_type") reasons.add("unknown_media_type");
    reasons.add("no_cover");
  }

  if (
    match.status === "MATCHED" &&
    (match.reason === "automatic_low_confidence_match" ||
      (match.source === "AUTO" && typeof match.confidence === "number" && match.confidence < LOW_CONFIDENCE_THRESHOLD))
  ) {
    reasons.add("low_confidence");
  }

  if (match.status === "MATCHED" && !presentation.hasCover) reasons.add("no_cover");
  return [...reasons];
}

function addProviderChoice(
  choices: Array<{
    providerTitle: any;
    selected: boolean;
    linkUpdatedAt?: unknown;
    linkCreatedAt?: unknown;
  }>,
  seen: Set<string>,
  providerTitle: any,
  selected: boolean,
  link?: { updatedAt?: unknown; createdAt?: unknown }
) {
  if (!providerTitle) return;
  const key = providerTitle.id
    ? `id:${providerTitle.id}`
    : `${providerTitle.provider}:${providerTitle.providerEntityType}:${providerTitle.providerId}`;
  if (seen.has(key)) return;
  seen.add(key);
  choices.push({
    providerTitle,
    selected,
    linkUpdatedAt: link?.updatedAt,
    linkCreatedAt: link?.createdAt
  });
}

function compareProviderChoices(
  a: {
    providerTitle: any;
    selected: boolean;
    linkUpdatedAt?: unknown;
    linkCreatedAt?: unknown;
  },
  b: {
    providerTitle: any;
    selected: boolean;
    linkUpdatedAt?: unknown;
    linkCreatedAt?: unknown;
  },
  mediaType?: string | null,
  providerOrder?: string[]
) {
  if (a.selected !== b.selected) return a.selected ? -1 : 1;

  const aMediaTypeMatch = providerMatchesMediaType(a.providerTitle, mediaType);
  const bMediaTypeMatch = providerMatchesMediaType(b.providerTitle, mediaType);
  if (aMediaTypeMatch !== bMediaTypeMatch) return aMediaTypeMatch ? -1 : 1;

  const providerPriorityDelta = providerPriority(a.providerTitle.provider, providerOrder) -
    providerPriority(b.providerTitle.provider, providerOrder);
  if (providerPriorityDelta !== 0) return providerPriorityDelta;

  const now = Date.now();
  const aFresh = providerPayloadFresh(a.providerTitle, now);
  const bFresh = providerPayloadFresh(b.providerTitle, now);
  if (aFresh !== bFresh) return aFresh ? -1 : 1;

  const payloadTimeDelta = providerPayloadTime(b) - providerPayloadTime(a);
  if (payloadTimeDelta !== 0) return payloadTimeDelta;

  return stableProviderKey(a.providerTitle).localeCompare(stableProviderKey(b.providerTitle));
}

function providerMatchesMediaType(providerTitle: any, mediaType?: string | null) {
  if (!mediaType || mediaType === "UNKNOWN") return true;
  return providerTitle.mediaType === mediaType;
}

function providerPriority(provider?: string | null, providerOrder?: string[]) {
  const index = providerOrder?.indexOf(provider ?? "") ?? -1;
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function providerPayloadFresh(providerTitle: any, now: number) {
  const expiresAt = timeValue(providerTitle?.expiresAt);
  return expiresAt === 0 || expiresAt > now;
}

function providerPayloadTime(input: {
  providerTitle: any;
  linkUpdatedAt?: unknown;
  linkCreatedAt?: unknown;
}) {
  return Math.max(
    timeValue(input.providerTitle?.fetchedAt),
    timeValue(input.providerTitle?.updatedAt),
    timeValue(input.linkUpdatedAt),
    timeValue(input.providerTitle?.createdAt),
    timeValue(input.linkCreatedAt)
  );
}

function timeValue(value: unknown) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const time = new Date(String(value)).getTime();
  return Number.isFinite(time) ? time : 0;
}

function stableProviderKey(providerTitle: any) {
  return [
    providerTitle.provider ?? "",
    providerTitle.providerEntityType ?? "",
    providerTitle.providerId ?? "",
    providerTitle.id ?? ""
  ].join(":");
}

function serializeRating(providerTitle: any): RatingDto | undefined {
  const source = serializeProviderRef(providerTitle);
  const type = ratingType(providerTitle?.ratingType);
  if (!source || !type) return undefined;
  if (typeof providerTitle.ratingValue !== "number" || typeof providerTitle.ratingScale !== "number") {
    return undefined;
  }
  if (providerTitle.ratingScale <= 0) return undefined;
  return {
    ...source,
    value: providerTitle.ratingValue,
    scale: providerTitle.ratingScale,
    normalized: providerTitle.ratingValue / providerTitle.ratingScale,
    voteCount: providerTitle.ratingVoteCount,
    type
  };
}

function ratingType(value?: string | null) {
  if (value === "USER_SCORE" || value === "user_score") return "user_score";
  if (value === "CRITIC_SCORE" || value === "critic_score") return "critic_score";
  if (value === "POPULARITY" || value === "popularity") return "popularity";
  return undefined;
}

function providerPayload(payload: unknown): {
  posterPath?: string | null;
  backdropPath?: string | null;
  overview?: string | null;
} {
  return typeof payload === "object" && payload !== null
    ? payload as { posterPath?: string | null; backdropPath?: string | null; overview?: string | null }
    : {};
}

function providerImageUrl(provider: string | undefined, path: string | null | undefined, size: "w185" | "w342") {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  if (provider === "tmdb") return `https://image.tmdb.org/t/p/${size}${path}`;
  return path;
}

export function legacyKindFromMediaType(mediaType?: string | null) {
  if (!mediaType) return undefined;
  return mediaType === "TV_SERIES" ? "TV" : mediaType;
}
