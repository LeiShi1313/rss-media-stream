import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(),
    subscription: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn()
    },
    subscriptionRule: {
      create: vi.fn(),
      upsert: vi.fn()
    },
    subscriptionMatchDecision: {
      findMany: vi.fn()
    },
    mediaTitle: {
      findUnique: vi.fn()
    },
    downloader: {
      findFirst: vi.fn()
    }
  },
  loadPresentationPreferences: vi.fn()
}));

vi.mock("../src/server/db.js", () => ({ prisma: mocks.prisma }));
vi.mock("../src/server/modules/media/presentationPreferences.js", () => ({
  EMPTY_PRESENTATION_PREFERENCES: {
    providerOrders: {},
    ratingProviderSources: {}
  },
  loadPresentationPreferences: mocks.loadPresentationPreferences,
  presentationOptionsForMediaType: vi.fn(() => ({}))
}));

const {
  createSubscriptionWithRule,
  deleteSubscription,
  getSubscription,
  listMatchHistory,
  listSubscriptionHistory,
  listSubscriptions,
  replaceSubscriptionRule,
  updateSubscription
} = await import(
  "../src/server/modules/subscriptions/subscriptionManagement.js"
);

const member = {
  tenantId: "tenant-1",
  userId: "user-1",
  role: "MEMBER" as const
};
const admin = {
  tenantId: "tenant-1",
  userId: "admin-1",
  role: "ADMIN" as const
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(async (operation) =>
    operation(mocks.prisma)
  );
  mocks.loadPresentationPreferences.mockResolvedValue({
    providerOrders: {},
    ratingProviderSources: {}
  });
  mocks.prisma.subscription.findMany.mockResolvedValue([]);
  mocks.prisma.subscriptionMatchDecision.findMany.mockResolvedValue([]);
  mocks.prisma.subscriptionRule.upsert.mockResolvedValue({});
  mocks.prisma.subscription.deleteMany.mockResolvedValue({ count: 1 });
});

describe("subscription management authorization", () => {
  it("returns 404 when a subscription is outside the actor tenant", async () => {
    mocks.prisma.subscription.findFirst.mockResolvedValue(null);

    await expect(getSubscription({ actor: member, id: "subscription-other-tenant" }))
      .rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });

    expect(mocks.prisma.subscription.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "subscription-other-tenant", tenantId: "tenant-1" }
    }));
  });

  it("returns 403 when a member accesses another owner's subscription", async () => {
    mocks.prisma.subscription.findFirst.mockResolvedValue(subscriptionRecord({
      createdByUserId: "user-2"
    }));

    await expect(getSubscription({ actor: member, id: "subscription-1" }))
      .rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
  });

  it("allows an admin to access another owner's subscription", async () => {
    mocks.prisma.subscription.findFirst.mockResolvedValue(subscriptionRecord({
      createdByUserId: "user-2"
    }));

    await expect(getSubscription({ actor: admin, id: "subscription-1" }))
      .resolves.toMatchObject({ id: "subscription-1", createdByUserId: "user-2" });
  });

  it("rejects scope=all for a member before querying", async () => {
    await expect(listSubscriptions({ actor: member, scope: "all" }))
      .rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });

    expect(mocks.prisma.subscription.findMany).not.toHaveBeenCalled();
  });

  it("scopes member lists to their own subscriptions and lets admins list all", async () => {
    await listSubscriptions({ actor: member, scope: "mine" });
    await listSubscriptions({ actor: admin, scope: "all" });

    expect(mocks.prisma.subscription.findMany).toHaveBeenNthCalledWith(1,
      expect.objectContaining({
        where: { tenantId: "tenant-1", createdByUserId: "user-1" }
      })
    );
    expect(mocks.prisma.subscription.findMany).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        where: { tenantId: "tenant-1", createdByUserId: undefined }
      })
    );
  });

  it("authorizes an update before validating references or writing", async () => {
    mocks.prisma.subscription.findFirst.mockResolvedValue(subscriptionRecord({
      createdByUserId: "user-2"
    }));

    await expect(updateSubscription({
      actor: member,
      id: "subscription-1",
      patch: { mediaTitleId: "missing-media" }
    })).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });

    expect(mocks.prisma.mediaTitle.findUnique).not.toHaveBeenCalled();
    expect(mocks.prisma.subscription.update).not.toHaveBeenCalled();
  });

  it("does not expose update validation details before authorization", async () => {
    mocks.prisma.subscription.findFirst.mockResolvedValue(subscriptionRecord({
      createdByUserId: "user-2"
    }));

    await expect(updateSubscription({
      actor: member,
      id: "subscription-1",
      patch: { title: "" }
    })).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
  });

  it("authorizes rule replacement before upserting", async () => {
    mocks.prisma.subscription.findFirst.mockResolvedValue(subscriptionRecord({
      createdByUserId: "user-2"
    }));

    await expect(replaceSubscriptionRule({
      actor: member,
      id: "subscription-1",
      rule: regexRule()
    })).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });

    expect(mocks.prisma.subscriptionRule.upsert).not.toHaveBeenCalled();
  });

  it("does not expose rule validation details before authorization", async () => {
    mocks.prisma.subscription.findFirst.mockResolvedValue(subscriptionRecord({
      createdByUserId: "user-2"
    }));

    await expect(replaceSubscriptionRule({
      actor: member,
      id: "subscription-1",
      rule: { mode: "NOT_A_MODE" }
    })).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
  });

  it("authorizes deletion before deleting", async () => {
    mocks.prisma.subscription.findFirst.mockResolvedValue(subscriptionRecord({
      createdByUserId: "user-2"
    }));

    await expect(deleteSubscription({ actor: member, id: "subscription-1" }))
      .rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });

    expect(mocks.prisma.subscription.deleteMany).not.toHaveBeenCalled();
  });

  it("authorizes subscription history before reading decisions", async () => {
    mocks.prisma.subscription.findFirst.mockResolvedValue(subscriptionRecord({
      createdByUserId: "user-2"
    }));

    await expect(listSubscriptionHistory({ actor: member, id: "subscription-1" }))
      .rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });

    expect(mocks.prisma.subscriptionMatchDecision.findMany).not.toHaveBeenCalled();
  });

  it("does not expose another owner's match history to a member", async () => {
    mocks.prisma.subscription.findFirst.mockResolvedValue(subscriptionRecord({
      createdByUserId: "user-2"
    }));

    await expect(listMatchHistory({
      actor: member,
      query: { subscriptionId: "subscription-1", limit: 100 }
    })).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });

    expect(mocks.prisma.subscriptionMatchDecision.findMany).not.toHaveBeenCalled();
  });
});

describe("subscription management commands", () => {
  it("creates the subscription and rule for the actor in one transaction", async () => {
    mocks.prisma.subscription.create.mockResolvedValue({ id: "subscription-new" });
    mocks.prisma.subscription.findUniqueOrThrow.mockResolvedValue(subscriptionRecord({
      id: "subscription-new"
    }));

    await expect(createSubscriptionWithRule({
      actor: member,
      input: {
        title: "Stand-up Comedy",
        autoDownload: true,
        enabled: true,
        rule: regexRule()
      }
    })).resolves.toMatchObject({ id: "subscription-new" });

    expect(mocks.prisma.subscription.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        createdByUserId: "user-1"
      })
    }));
    expect(mocks.prisma.subscriptionRule.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        subscriptionId: "subscription-new",
        mode: "REGEX"
      })
    }));
  });

  it("preserves subscription wire null and BigInt semantics", async () => {
    mocks.prisma.subscription.findMany.mockResolvedValue([
      subscriptionRecord({
        rule: {
          ...ruleRecord({ mode: "REGEX", titleRegex: "Stand-up" }),
          minSizeBytes: 1_000n
        }
      })
    ]);

    const [subscription] = await listSubscriptions({ actor: member, scope: "mine" });
    expect(JSON.parse(JSON.stringify(subscription))).toEqual({
      id: "subscription-1",
      title: "Stand-up Comedy",
      createdByUserId: "user-1",
      autoDownload: true,
      enabled: true,
      rule: {
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
      },
      createdAt: "2026-08-10T12:00:00.000Z",
      updatedAt: "2026-08-10T13:00:00.000Z"
    });
  });

  it("updates an owned subscription after authorization", async () => {
    mocks.prisma.subscription.findFirst.mockResolvedValue(subscriptionRecord());
    mocks.prisma.subscription.update.mockResolvedValue(subscriptionRecord({
      title: "Updated title"
    }));

    await expect(updateSubscription({
      actor: member,
      id: "subscription-1",
      patch: { title: "Updated title" }
    })).resolves.toMatchObject({ title: "Updated title" });

    expect(mocks.prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id_tenantId: { id: "subscription-1", tenantId: "tenant-1" }
        },
        data: expect.objectContaining({ title: "Updated title" })
      })
    );
  });

  it("replaces the rule of an owned subscription", async () => {
    mocks.prisma.subscription.findFirst.mockResolvedValue(subscriptionRecord());
    mocks.prisma.subscription.findUniqueOrThrow.mockResolvedValue(subscriptionRecord({
      rule: ruleRecord({ mode: "REGEX", titleRegex: "Stand-up" })
    }));

    await expect(replaceSubscriptionRule({
      actor: member,
      id: "subscription-1",
      rule: regexRule()
    })).resolves.toMatchObject({
      rule: { mode: "REGEX", titleRegex: "Stand-up" }
    });

    expect(mocks.prisma.subscriptionRule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ mode: "REGEX" }),
        update: expect.objectContaining({ mode: "REGEX" })
      })
    );
  });

  it("deletes an owned subscription", async () => {
    mocks.prisma.subscription.findFirst.mockResolvedValue(subscriptionRecord());

    await expect(deleteSubscription({ actor: member, id: "subscription-1" }))
      .resolves.toEqual({ ok: true });

    expect(mocks.prisma.subscription.deleteMany).toHaveBeenCalledWith({
      where: { id: "subscription-1", tenantId: "tenant-1" }
    });
  });

  it("does not update when an authorized reference is missing", async () => {
    mocks.prisma.subscription.findFirst.mockResolvedValue(subscriptionRecord());
    mocks.prisma.mediaTitle.findUnique.mockResolvedValue(null);

    await expect(updateSubscription({
      actor: member,
      id: "subscription-1",
      patch: { mediaTitleId: "missing-media" }
    })).rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });

    expect(mocks.prisma.subscription.update).not.toHaveBeenCalled();
  });
});

function subscriptionRecord(input: Record<string, unknown> = {}) {
  return {
    id: "subscription-1",
    tenantId: "tenant-1",
    createdByUserId: "user-1",
    downloaderId: null,
    mediaTitleId: null,
    title: "Stand-up Comedy",
    autoDownload: true,
    enabled: true,
    createdAt: new Date("2026-08-10T12:00:00.000Z"),
    updatedAt: new Date("2026-08-10T13:00:00.000Z"),
    rule: ruleRecord(),
    mediaTitle: null,
    downloader: null,
    ...input
  };
}

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

function regexRule() {
  return {
    mode: "REGEX" as const,
    linkedProviders: [],
    providerRatings: [],
    feedIds: [],
    titleRegex: "Stand-up",
    sources: [],
    codecs: [],
    audio: [],
    releaseGroupsInclude: [],
    releaseGroupsExclude: [],
    variantsInclude: [],
    variantsExclude: [],
    preferredReleaseGroups: [],
    upgradePolicy: "none" as const,
    allowCrossSeed: false,
    separateVariants: false,
    seasonPackAllowed: true
  };
}
