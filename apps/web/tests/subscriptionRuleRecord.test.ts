import { describe, expect, it } from "vitest";
import {
  normalizeSubscriptionRuleRecord,
  serializeSubscriptionRuleRecord,
  subscriptionRulePersistenceData
} from "../src/server/modules/subscriptions/subscriptionRuleRecord.js";

describe("subscription rule records", () => {
  it("normalizes the column and criteria representations into one rule", () => {
    const normalized = normalizeSubscriptionRuleRecord(ruleRecord({
      mediaType: "TV_SERIES",
      minSizeBytes: 1_000n,
      criteriaJson: {
        selectedProvider: {
          provider: "tmdb",
          providerId: "123",
          providerEntityType: "tmdb_tv"
        },
        linkedProviders: [{ provider: "tvdb", providerId: "456" }],
        providerRatings: [{
          provider: "douban",
          comparison: "gte",
          value: 8,
          scale: 10
        }],
        variantsInclude: ["PURE"],
        variantsExclude: ["REPACK"],
        separateVariants: true
      }
    }), "media-1");

    expect(normalized).toMatchObject({
      mode: "MEDIA_TITLE",
      mediaType: "TV_SERIES",
      mediaTitleId: "media-1",
      selectedProvider: {
        provider: "tmdb",
        providerId: "123",
        providerEntityType: "tmdb_tv",
        mediaType: "TV_SERIES"
      },
      linkedProviders: [{
        provider: "tvdb",
        providerId: "456",
        mediaType: "TV_SERIES"
      }],
      providerRatings: [{
        provider: "douban",
        comparison: "gte",
        value: 8,
        scale: 10
      }],
      variantsInclude: ["PURE"],
      variantsExclude: ["REPACK"],
      minSizeBytes: 1_000n,
      separateVariants: true
    });
  });

  it("writes normalized rules back to columns and compact criteria JSON", () => {
    const normalized = normalizeSubscriptionRuleRecord(ruleRecord({
      mediaType: "TV_SERIES",
      criteriaJson: {
        mediaTitleId: "media-1",
        selectedProvider: { provider: "tmdb", providerId: "123" },
        variantsInclude: ["PURE"],
        separateVariants: true
      }
    }));

    expect(subscriptionRulePersistenceData(normalized)).toMatchObject({
      mode: "MEDIA_TITLE",
      mediaType: "TV_SERIES",
      criteriaJson: {
        mediaTitleId: "media-1",
        selectedProvider: {
          provider: "tmdb",
          providerId: "123",
          mediaType: "TV_SERIES"
        },
        variantsInclude: ["PURE"],
        separateVariants: true
      }
    });
  });

  it("serializes wire nulls without inventing omitted criteria defaults", () => {
    const serialized = serializeSubscriptionRuleRecord(ruleRecord({
      mode: "REGEX",
      titleRegex: "Stand-up",
      minSizeBytes: 1_000n,
      criteriaJson: null
    }), null);

    expect(JSON.parse(JSON.stringify(serialized))).toEqual({
      id: "rule-1",
      mode: "REGEX",
      mediaType: null,
      linkedProviders: [],
      providerRatings: [],
      feedIds: [],
      titleRegex: "Stand-up",
      includeRegex: null,
      excludeRegex: null,
      minResolution: null,
      maxResolution: null,
      sources: [],
      codecs: [],
      audio: [],
      releaseGroupsInclude: [],
      releaseGroupsExclude: [],
      variantsInclude: [],
      variantsExclude: [],
      preferredReleaseGroups: [],
      minSizeBytes: "1000",
      season: null,
      episodeStart: null,
      episodeEnd: null,
      upgradePolicy: "none",
      allowCrossSeed: false,
      seasonPackAllowed: true,
      createdAt: "2026-08-10T12:00:00.000Z",
      updatedAt: "2026-08-10T13:00:00.000Z"
    });
  });

  it("rejects malformed structured criteria", () => {
    expect(() => normalizeSubscriptionRuleRecord(ruleRecord({
      criteriaJson: { linkedProviders: "not-an-array" }
    }))).toThrow("subscription criteria are invalid");
  });
});

function ruleRecord(input: Record<string, unknown> = {}) {
  return {
    id: "rule-1",
    tenantId: "tenant-1",
    subscriptionId: "subscription-1",
    mode: "MEDIA_TITLE",
    mediaType: null,
    provider: null,
    providerEntityType: null,
    providerId: null,
    imdbId: null,
    doubanId: null,
    titleRegex: null,
    includeRegex: null,
    excludeRegex: null,
    minResolution: null,
    maxResolution: null,
    sources: [],
    codecs: [],
    audio: [],
    feedIds: [],
    releaseGroupsInclude: [],
    releaseGroupsExclude: [],
    preferredReleaseGroups: [],
    minSizeBytes: null,
    maxSizeBytes: null,
    season: null,
    episodeStart: null,
    episodeEnd: null,
    upgradePolicy: "none",
    allowCrossSeed: false,
    seasonPackAllowed: true,
    criteriaJson: null,
    createdAt: new Date("2026-08-10T12:00:00.000Z"),
    updatedAt: new Date("2026-08-10T13:00:00.000Z"),
    ...input
  };
}
