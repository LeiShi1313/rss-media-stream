import { getProviderSourceDefinition } from "../../integrations/providers/sources.js";
import { LOW_CONFIDENCE_THRESHOLD } from "./matchingPolicy.js";

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
  type: "user_score" | "critic_score" | "popularity";
  fetchedAt?: string;
};

export type PresentationOptions = {
  providerOrder?: string[];
  ratingProviderSource?: string;
};

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

export function serializeProviderRef(providerMetadata: any): ProviderRefDto | undefined {
  if (!providerMetadata) return undefined;
  const identity = providerMetadata.mediaProviderIdentity;
  const provider = identity?.provider ?? providerMetadata.provider;
  const providerId = identity?.providerId ?? providerMetadata.providerId;
  if (!provider || !providerId) {
    return undefined;
  }
  return {
    provider,
    ...(providerMetadata.providerSource ? { providerSource: providerMetadata.providerSource } : {}),
    ...(providerMetadata.providerEntityType ? { providerEntityType: providerMetadata.providerEntityType } : {}),
    providerId
  };
}

export function serializeMediaPresentation(input: {
  mediaTitle?: any;
  providerMetadata?: any;
  providerTitle?: any;
  providerIdentities?: Array<{ metadata?: any[] }>;
  providerLinks?: Array<{ providerTitle?: any }>;
  release?: any;
  rawTitle?: string;
}, options: PresentationOptions = {}): MediaPresentationDto {
  const mediaTitle = input.mediaTitle;
  const release = input.release;
  const providerMetadata = selectPresentationProviderMetadata({
    mediaTitle,
    selectedProviderMetadata: input.providerMetadata ?? providerTitleToMetadata(input.providerTitle),
    providerIdentities: input.providerIdentities ?? mediaTitle?.providerIdentities,
    providerLinks: input.providerLinks ?? mediaTitle?.providerLinks,
    release,
    providerOrder: options.providerOrder
  });
  const ratingMetadata = selectRatingProviderMetadata({
    mediaTitle,
    selectedProviderMetadata: input.providerMetadata ?? providerTitleToMetadata(input.providerTitle),
    providerIdentities: input.providerIdentities ?? mediaTitle?.providerIdentities,
    providerLinks: input.providerLinks ?? mediaTitle?.providerLinks,
    release,
    ratingProviderSource: options.ratingProviderSource
  });
  const payload = providerPayload(providerMetadata?.payload);
  const mediaType = mediaTitle?.mediaType ?? providerMetadata?.mediaType ?? release?.mediaType ?? "UNKNOWN";
  const title = providerMetadata?.title ?? mediaTitle?.title ?? mediaTitle?.canonicalTitle ?? release?.title ?? input.rawTitle ?? "Unknown";
  const source = serializeProviderRef(providerMetadata);
  const posterUrl = providerImageUrl(source?.provider ?? providerMetadata?.provider, payload.posterPath, "w342");
  const backdropUrl = providerImageUrl(source?.provider ?? providerMetadata?.provider, payload.backdropPath, "w342");

  return {
    mediaTitleId: mediaTitle?.id,
    mediaType,
    title,
    originalTitle: providerMetadata?.originalTitle ?? undefined,
    releaseYear: mediaTitle?.releaseYear ?? providerMetadata?.releaseYear ?? release?.year ?? undefined,
    overview: payload.overview,
    posterUrl,
    backdropUrl,
    displaySource: source,
    rating: serializeRating(ratingMetadata),
    hasCover: Boolean(posterUrl)
  };
}

export function selectPresentationProviderMetadata(input: {
  mediaTitle?: any;
  selectedProviderMetadata?: any;
  selectedProviderTitle?: any;
  providerIdentities?: Array<{ metadata?: any[]; provider?: string; providerId?: string }>;
  providerLinks?: Array<{ providerTitle?: any; updatedAt?: unknown; createdAt?: unknown }>;
  release?: any;
  providerOrder?: string[];
}) {
  const selectedProviderMetadata = input.selectedProviderMetadata ?? providerTitleToMetadata(input.selectedProviderTitle);
  const mediaType = input.mediaTitle?.mediaType ?? selectedProviderMetadata?.mediaType ?? input.release?.mediaType;
  const choices = collectProviderChoices({ ...input, selectedProviderMetadata });

  const filtered = input.providerOrder
    ? choices.filter((choice) =>
        input.providerOrder!.includes(choice.providerMetadata?.providerSource)
      )
    : choices;

  const ordered = filtered.sort((a, b) =>
    compareProviderChoices(a, b, mediaType, input.providerOrder)
  );
  return ordered.find((choice) =>
    providerMetadataHasPresentationContent(choice.providerMetadata)
  )?.providerMetadata ?? ordered[0]?.providerMetadata;
}

export function selectRatingProviderMetadata(input: {
  mediaTitle?: any;
  selectedProviderMetadata?: any;
  providerIdentities?: Array<{ metadata?: any[]; provider?: string; providerId?: string }>;
  providerLinks?: Array<{ providerTitle?: any; updatedAt?: unknown; createdAt?: unknown }>;
  release?: any;
  ratingProviderSource?: string;
}) {
  if (!input.ratingProviderSource) return undefined;
  const mediaType = input.mediaTitle?.mediaType ?? input.selectedProviderMetadata?.mediaType ?? input.release?.mediaType;
  return collectProviderChoices(input)
    .filter((choice) =>
      choice.providerMetadata?.providerSource === input.ratingProviderSource &&
      providerMatchesMediaType(choice.providerMetadata, mediaType) &&
      serializeRating(choice.providerMetadata)
    )
    .sort((a, b) =>
      providerPayloadTime(b) - providerPayloadTime(a) ||
      stableProviderKey(a.providerMetadata).localeCompare(stableProviderKey(b.providerMetadata))
    )[0]?.providerMetadata;
}

export const selectPresentationProviderTitle = selectPresentationProviderMetadata;

export function selectReleaseMatchForPresentation(matches?: any[], providerOrder?: string[]) {
  const active = (matches ?? []).filter(Boolean);
  const matched = active.filter((match) => match.status === "MATCHED");
  if (matched.length > 0) {
    return matched.sort((a, b) => compareReleaseMatchChoices(a, b, providerOrder))[0];
  }
  return active.sort((a, b) => releaseMatchTime(b) - releaseMatchTime(a))[0];
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
    providerMetadata: match.providerMediaMetadata ?? providerTitleToMetadata(match.providerTitle),
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
    providerTitle: serializeProviderRef(match.providerMediaMetadata ?? match.providerTitle),
    providerMetadata: serializeProviderRef(match.providerMediaMetadata ?? match.providerTitle),
    presentation,
    attention: {
      required: attentionReasons.length > 0,
      reasons: attentionReasons
    }
  };
}

export function serializeProviderTitleSearchResult(result: {
  provider: string;
  providerSource?: string;
  providerEntityType?: string;
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
  }, {
    ratingProviderSource: result.providerSource
  });
  return {
    provider: result.provider,
    providerSource: result.providerSource,
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

function compareReleaseMatchChoices(a: any, b: any, providerOrder?: string[]) {
  const providerPriorityDelta = providerPriority(releaseMatchProviderSource(a), providerOrder) -
    providerPriority(releaseMatchProviderSource(b), providerOrder);
  if (providerPriorityDelta !== 0) return providerPriorityDelta;

  const timeDelta = releaseMatchTime(b) - releaseMatchTime(a);
  if (timeDelta !== 0) return timeDelta;

  return String(a.id ?? "").localeCompare(String(b.id ?? ""));
}

function releaseMatchProviderSource(match: any) {
  return match.providerMediaMetadata?.providerSource ?? match.providerTitle?.providerSource;
}

function releaseMatchTime(match: any) {
  return Math.max(
    timeValue(match?.matchedAt),
    timeValue(match?.updatedAt),
    timeValue(match?.createdAt)
  );
}

type ProviderChoice = {
  providerMetadata: any;
  selected: boolean;
  linkUpdatedAt?: unknown;
  linkCreatedAt?: unknown;
};

function collectProviderChoices(input: {
  selectedProviderMetadata?: any;
  providerIdentities?: Array<{ metadata?: any[]; provider?: string; providerId?: string }>;
  providerLinks?: Array<{ providerTitle?: any; updatedAt?: unknown; createdAt?: unknown }>;
}) {
  const choices: ProviderChoice[] = [];
  const seen = new Set<string>();

  // Active release matches keep their selected provider as metadata provenance.
  addProviderChoice(choices, seen, input.selectedProviderMetadata, true);
  for (const identity of input.providerIdentities ?? []) {
    for (const metadata of identity.metadata ?? []) {
      addProviderChoice(choices, seen, attachIdentity(metadata, identity), false);
    }
  }
  for (const link of input.providerLinks ?? []) {
    addProviderChoice(choices, seen, providerTitleToMetadata(link.providerTitle), false, link);
  }
  return choices;
}

function addProviderChoice(
  choices: ProviderChoice[],
  seen: Set<string>,
  providerMetadata: any,
  selected: boolean,
  link?: { updatedAt?: unknown; createdAt?: unknown }
) {
  if (!providerMetadata) return;
  const ref = serializeProviderRef(providerMetadata);
  const key = providerMetadata.id
    ? `id:${providerMetadata.id}`
    : `${providerMetadata.providerSource ?? ""}:${ref?.provider ?? ""}:${ref?.providerId ?? ""}`;
  if (seen.has(key)) return;
  seen.add(key);
  choices.push({
    providerMetadata,
    selected,
    linkUpdatedAt: link?.updatedAt,
    linkCreatedAt: link?.createdAt
  });
}

function compareProviderChoices(
  a: ProviderChoice,
  b: ProviderChoice,
  mediaType?: string | null,
  providerOrder?: string[]
) {
  if (a.selected !== b.selected) return a.selected ? -1 : 1;

  const aMediaTypeMatch = providerMatchesMediaType(a.providerMetadata, mediaType);
  const bMediaTypeMatch = providerMatchesMediaType(b.providerMetadata, mediaType);
  if (aMediaTypeMatch !== bMediaTypeMatch) return aMediaTypeMatch ? -1 : 1;

  const providerPriorityDelta = providerPriority(a.providerMetadata.providerSource, providerOrder) -
    providerPriority(b.providerMetadata.providerSource, providerOrder);
  if (providerPriorityDelta !== 0) return providerPriorityDelta;

  const now = Date.now();
  const aFresh = providerPayloadFresh(a.providerMetadata, now);
  const bFresh = providerPayloadFresh(b.providerMetadata, now);
  if (aFresh !== bFresh) return aFresh ? -1 : 1;

  const payloadTimeDelta = providerPayloadTime(b) - providerPayloadTime(a);
  if (payloadTimeDelta !== 0) return payloadTimeDelta;

  return stableProviderKey(a.providerMetadata).localeCompare(stableProviderKey(b.providerMetadata));
}

function providerMatchesMediaType(providerTitle: any, mediaType?: string | null) {
  if (!mediaType || mediaType === "UNKNOWN") return true;
  return (providerTitle.mediaType ?? providerTitle.mediaProviderIdentity?.mediaType) === mediaType;
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
  providerMetadata: any;
  linkUpdatedAt?: unknown;
  linkCreatedAt?: unknown;
}) {
  return Math.max(
    timeValue(input.providerMetadata?.fetchedAt),
    timeValue(input.providerMetadata?.updatedAt),
    timeValue(input.linkUpdatedAt),
    timeValue(input.providerMetadata?.createdAt),
    timeValue(input.linkCreatedAt)
  );
}

function timeValue(value: unknown) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const time = new Date(String(value)).getTime();
  return Number.isFinite(time) ? time : 0;
}

function stableProviderKey(providerMetadata: any) {
  const ref = serializeProviderRef(providerMetadata);
  return [
    providerMetadata.providerSource ?? "",
    ref?.provider ?? "",
    providerMetadata.providerEntityType ?? "",
    ref?.providerId ?? "",
    providerMetadata.id ?? ""
  ].join(":");
}

function serializeRating(providerMetadata: any): RatingDto | undefined {
  const source = serializeProviderRef(providerMetadata);
  const type = ratingType(providerMetadata?.ratingType);
  if (!source || !type) return undefined;
  if (typeof providerMetadata.ratingValue !== "number" || typeof providerMetadata.ratingScale !== "number") {
    return undefined;
  }
  if (providerMetadata.ratingScale <= 0) return undefined;
  const definition = getProviderSourceDefinition(providerMetadata.providerSource);
  const fetchedAt = providerMetadata.fetchedAt instanceof Date
    ? providerMetadata.fetchedAt.toISOString()
    : typeof providerMetadata.fetchedAt === "string"
      ? providerMetadata.fetchedAt
      : undefined;
  return {
    ...source,
    providerSource: definition.id,
    providerLabel: definition.providerLabel,
    providerSourceLabel: definition.label,
    value: providerMetadata.ratingValue,
    scale: providerMetadata.ratingScale,
    voteCount: providerMetadata.ratingVoteCount,
    type,
    fetchedAt
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

function providerMetadataHasPresentationContent(providerMetadata: any) {
  const payload = providerPayload(providerMetadata?.payload);
  return [payload.overview, payload.posterPath, payload.backdropPath].some(
    (value) => typeof value === "string" && value.trim().length > 0
  );
}

function providerImageUrl(provider: string | undefined, path: string | null | undefined, size: "w185" | "w342") {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  if (provider === "tmdb") return `https://image.tmdb.org/t/p/${size}${path}`;
  return path;
}

function attachIdentity(metadata: any, identity: any) {
  return metadata?.mediaProviderIdentity ? metadata : {
    ...metadata,
    mediaProviderIdentity: identity
  };
}

function providerTitleToMetadata(providerTitle: any) {
  if (!providerTitle) return undefined;
  return {
    ...providerTitle,
    providerSource: providerTitle.providerSource ?? providerTitle.provider,
    mediaProviderIdentity: {
      provider: providerTitle.provider,
      providerId: providerTitle.providerId,
      mediaType: providerTitle.mediaType
    }
  };
}

export function legacyKindFromMediaType(mediaType?: string | null) {
  if (!mediaType) return undefined;
  return mediaType === "TV_SERIES" ? "TV" : mediaType;
}
