import { describe, expect, it } from "vitest";
import {
  candidateFromSubscriptionItem,
  subscriptionCandidateInclude,
  type SubscriptionCandidateRecord
} from "../src/server/modules/subscriptions/subscriptionCandidate.js";

describe("subscription candidates", () => {
  it("selects the latest active matched row deterministically", () => {
    expect(subscriptionCandidateInclude.parsedRelease.include.matches).toMatchObject({
      where: { status: "MATCHED", invalidatedAt: null },
      take: 1,
      orderBy: [{ matchedAt: "desc" }, { updatedAt: "desc" }]
    });
  });

  it("maps modern selected and linked provider metadata", () => {
    const candidate = candidateFromSubscriptionItem(itemRecord({
      matches: [modernMatch()]
    }));

    expect(candidate?.activeMatch).toMatchObject({
      mediaTitle: {
        id: "media-1",
        mediaType: "TV_SERIES",
        canonicalTitle: "Stand-up Comedy"
      },
      selectedProviderTitle: {
        providerTitleId: "metadata-selected",
        provider: "tmdb",
        providerSource: "tmdb_api",
        providerId: "123",
        mediaType: "TV_SERIES"
      },
      linkedProviderTitles: [{
        providerTitleId: "metadata-linked",
        provider: "tvdb",
        providerSource: "tvdb_api",
        providerId: "456",
        mediaType: "TV_SERIES"
      }]
    });
  });

  it("maps the persisted legacy provider-title representation", () => {
    const match = modernMatch();
    match.providerMediaMetadata = null;
    match.providerTitle = {
      id: "legacy-title",
      provider: "tmdb",
      providerEntityType: "tmdb_tv",
      providerId: "123",
      mediaType: "TV_SERIES",
      ratingValue: 8.5,
      ratingScale: 10,
      ratingVoteCount: 100,
      ratingType: "USER_SCORE"
    };

    expect(candidateFromSubscriptionItem(itemRecord({ matches: [match] }))?.activeMatch)
      .toMatchObject({
        selectedProviderTitle: {
          providerTitleId: "legacy-title",
          provider: "tmdb",
          providerEntityType: "tmdb_tv",
          providerId: "123",
          mediaType: "TV_SERIES",
          ratingType: "user_score"
        }
      });
  });

  it("treats a matched row without a concrete provider identity as unresolved", () => {
    const match = modernMatch();
    match.providerMediaMetadata.mediaProviderIdentity.mediaType = "UNKNOWN";

    expect(candidateFromSubscriptionItem(itemRecord({ matches: [match] }))?.activeMatch)
      .toBeNull();
  });

  it("returns null when the item has no parsed release", () => {
    expect(candidateFromSubscriptionItem({
      ...itemRecord(),
      parsedRelease: null
    })).toBeNull();
  });
});

function itemRecord(input: { matches?: any[] } = {}): SubscriptionCandidateRecord {
  return {
    id: "item-1",
    tenantId: "tenant-1",
    feedId: "feed-a",
    infoHash: null,
    guidHash: null,
    linkHash: "hash",
    dedupeKeyType: "LINK_HASH",
    dedupeKeyHash: "hash",
    releaseSignature: null,
    rawTitle: "Stand-up Comedy S03E01 2160p WEB-DL",
    encryptedTorrentUrl: "encrypted",
    encryptedSourceUrl: null,
    publishDate: null,
    sizeBytes: 1_000n,
    rawJsonEncrypted: null,
    rawJsonRedacted: null,
    parseStatus: "PARSED",
    parseConfidence: 0.95,
    firstSeenAt: new Date("2026-08-10T12:00:00.000Z"),
    updatedAt: new Date("2026-08-10T12:00:00.000Z"),
    parsedRelease: {
      id: "release-1",
      tenantId: "tenant-1",
      rssItemId: "item-1",
      title: "Stand-up Comedy",
      providerSearchTitles: [],
      year: 2026,
      mediaType: "TV_SERIES",
      tvUnitType: "EPISODE",
      season: 3,
      episode: 1,
      episodeEnd: null,
      specialNumber: null,
      episodePart: null,
      resolution: 2160,
      quality: "WEB-DL",
      source: "WEB-DL",
      codec: "H265",
      audio: null,
      releaseGroup: null,
      variant: null,
      parseConfidence: 0.95,
      parsedAt: new Date("2026-08-10T12:00:00.000Z"),
      matches: input.matches ?? []
    }
  } as SubscriptionCandidateRecord;
}

function modernMatch(): any {
  const linkedIdentity = {
    id: "identity-linked",
    mediaTitleId: "media-1",
    provider: "tvdb",
    providerId: "456",
    mediaType: "TV_SERIES",
    linkConfidence: 1,
    linkSource: "SEARCH_MATCH",
    confirmedAt: new Date("2026-08-10T12:00:00.000Z"),
    createdAt: new Date("2026-08-10T12:00:00.000Z"),
    updatedAt: new Date("2026-08-10T12:00:00.000Z"),
    metadata: [{
      id: "metadata-linked",
      providerSource: "tvdb_api",
      ratingValue: null,
      ratingScale: null,
      ratingVoteCount: null,
      ratingType: null
    }]
  };
  return {
    id: "match-1",
    status: "MATCHED",
    source: "AUTO",
    confidence: 0.96,
    mediaTitle: {
      id: "media-1",
      mediaType: "TV_SERIES",
      title: "Stand-up Comedy",
      releaseYear: 2026,
      providerIdentities: [linkedIdentity]
    },
    providerMediaMetadata: {
      id: "metadata-selected",
      providerSource: "tmdb_api",
      ratingValue: 8.8,
      ratingScale: 10,
      ratingVoteCount: 1000,
      ratingType: "USER_SCORE",
      mediaProviderIdentity: {
        provider: "tmdb",
        providerId: "123",
        mediaType: "TV_SERIES"
      }
    },
    providerTitle: null
  };
}
