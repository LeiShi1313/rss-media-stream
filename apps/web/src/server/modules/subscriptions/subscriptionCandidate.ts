import type { Prisma } from "@prisma/client";
import type {
  CandidateInput,
  MediaType,
  ProviderTitleRuleView
} from "@rss-media/shared/types";
import {
  parsedReleaseMatchInclude,
  type ActiveParsedReleaseMatch
} from "../media/parsedReleaseMatchInclude.js";

export const subscriptionCandidateInclude = {
  parsedRelease: {
    include: {
      matches: {
        where: { status: "MATCHED", invalidatedAt: null },
        take: 1,
        include: parsedReleaseMatchInclude,
        orderBy: [{ matchedAt: "desc" }, { updatedAt: "desc" }]
      }
    }
  }
} satisfies Prisma.RssItemInclude;

export type SubscriptionCandidateRecord = Prisma.RssItemGetPayload<{
  include: typeof subscriptionCandidateInclude;
}>;

type ModernMetadata = NonNullable<ActiveParsedReleaseMatch["providerMediaMetadata"]>;
type LegacyProviderTitle = NonNullable<ActiveParsedReleaseMatch["providerTitle"]>;
type MatchedMediaTitle = NonNullable<ActiveParsedReleaseMatch["mediaTitle"]>;
type LinkedIdentity = MatchedMediaTitle["providerIdentities"][number];
type LinkedMetadata = LinkedIdentity["metadata"][number];

export function candidateFromSubscriptionItem(
  item: SubscriptionCandidateRecord
): CandidateInput | null {
  const release = item.parsedRelease;
  if (!release) return null;

  return {
    feedId: item.feedId,
    rawTitle: item.rawTitle,
    sizeBytes: item.sizeBytes,
    release: {
      title: release.title,
      year: release.year ?? undefined,
      mediaType: release.mediaType,
      tvUnitType: release.tvUnitType === "EPISODE" || release.tvUnitType === "SPECIAL"
        ? release.tvUnitType
        : undefined,
      season: release.season ?? undefined,
      episode: release.episode ?? undefined,
      episodeEnd: release.episodeEnd ?? undefined,
      specialNumber: release.specialNumber ?? undefined,
      episodePart: release.episodePart ?? undefined,
      resolution: release.resolution ?? undefined,
      quality: release.quality ?? undefined,
      source: release.source ?? undefined,
      codec: release.codec ?? undefined,
      audio: release.audio ?? undefined,
      releaseGroup: release.releaseGroup ?? undefined,
      variant: release.variant ?? undefined,
      parseConfidence: release.parseConfidence
    },
    activeMatch: activeMatchFromRow(release.matches[0])
  };
}

function activeMatchFromRow(
  match: ActiveParsedReleaseMatch | undefined
): CandidateInput["activeMatch"] {
  if (!match?.mediaTitle || !isConcreteMediaType(match.mediaTitle.mediaType)) {
    return null;
  }

  const selectedProviderTitle = selectedProviderRuleView(match);
  if (!selectedProviderTitle) return null;

  return {
    id: match.id,
    status: match.status,
    source: match.source,
    confidence: match.confidence ?? 0,
    mediaTitle: {
      id: match.mediaTitle.id,
      mediaType: match.mediaTitle.mediaType,
      canonicalTitle: match.mediaTitle.title,
      releaseYear: match.mediaTitle.releaseYear ?? null
    },
    selectedProviderTitle,
    linkedProviderTitles: linkedProviderRuleViews(match.mediaTitle)
  };
}

function selectedProviderRuleView(
  match: ActiveParsedReleaseMatch
): ProviderTitleRuleView | null {
  if (match.providerMediaMetadata) {
    return modernProviderRuleView(match.providerMediaMetadata);
  }
  if (match.providerTitle) {
    return legacyProviderRuleView(match.providerTitle);
  }
  return null;
}

function modernProviderRuleView(
  metadata: ModernMetadata
): ProviderTitleRuleView | null {
  const identity = metadata.mediaProviderIdentity;
  if (!isConcreteMediaType(identity.mediaType)) return null;
  return {
    providerTitleId: metadata.id,
    provider: identity.provider,
    providerSource: metadata.providerSource,
    providerId: identity.providerId,
    mediaType: identity.mediaType,
    ratingValue: metadata.ratingValue ?? null,
    ratingScale: metadata.ratingScale ?? null,
    ratingVoteCount: metadata.ratingVoteCount ?? null,
    ratingType: providerRatingType(metadata.ratingType)
  };
}

function legacyProviderRuleView(
  providerTitle: LegacyProviderTitle
): ProviderTitleRuleView | null {
  if (!isConcreteMediaType(providerTitle.mediaType)) return null;
  return {
    providerTitleId: providerTitle.id,
    provider: providerTitle.provider,
    providerEntityType: providerTitle.providerEntityType,
    providerId: providerTitle.providerId,
    mediaType: providerTitle.mediaType,
    ratingValue: providerTitle.ratingValue ?? null,
    ratingScale: providerTitle.ratingScale ?? null,
    ratingVoteCount: providerTitle.ratingVoteCount ?? null,
    ratingType: providerRatingType(providerTitle.ratingType)
  };
}

function linkedProviderRuleViews(mediaTitle: MatchedMediaTitle): ProviderTitleRuleView[] {
  const views: ProviderTitleRuleView[] = [];
  for (const identity of mediaTitle.providerIdentities) {
    for (const metadata of identity.metadata) {
      const view = linkedProviderRuleView(metadata, identity);
      if (view) views.push(view);
    }
  }
  return views;
}

function linkedProviderRuleView(
  metadata: LinkedMetadata,
  identity: LinkedIdentity
): ProviderTitleRuleView | null {
  if (!isConcreteMediaType(identity.mediaType)) return null;
  return {
    providerTitleId: metadata.id,
    provider: identity.provider,
    providerSource: metadata.providerSource,
    providerId: identity.providerId,
    mediaType: identity.mediaType,
    ratingValue: metadata.ratingValue ?? null,
    ratingScale: metadata.ratingScale ?? null,
    ratingVoteCount: metadata.ratingVoteCount ?? null,
    ratingType: providerRatingType(metadata.ratingType)
  };
}

function providerRatingType(value?: string | null): ProviderTitleRuleView["ratingType"] {
  if (value === "USER_SCORE") return "user_score";
  if (value === "CRITIC_SCORE") return "critic_score";
  if (value === "POPULARITY") return "popularity";
  return null;
}

function isConcreteMediaType(value: string): value is MediaType {
  return value === "MOVIE" || value === "TV_SERIES";
}
