import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const guards = {
    ADMIN: vi.fn(),
    MEMBER: vi.fn(),
    VIEWER: vi.fn()
  };

  return {
    guards,
    audit: vi.fn(),
    evaluateAutoDownloadsForItem: vi.fn(),
    parseBody: vi.fn((_schema: unknown, request: any) => request.body),
    parseParams: vi.fn((_schema: unknown, request: any) => request.params),
    parseQuery: vi.fn((_schema: unknown, request: any) => request.query),
    getMedia: vi.fn(),
    getMediaDetail: vi.fn(),
    listMediaItems: vi.fn(),
    listTrendingMedia: vi.fn(),
    manuallyMatchParsedReleaseWithProvider: vi.fn(),
    matchParsedReleaseForItem: vi.fn(),
    resolveProviderMediaTitle: vi.fn(),
    searchExternalMedia: vi.fn(),
    searchLocalMedia: vi.fn(),
    smartSearchExternalMedia: vi.fn()
  };
});

vi.mock("../src/server/core/audit.js", () => ({ audit: mocks.audit }));
vi.mock("../src/server/core/permissions.js", () => ({
  requireTenantRole: vi.fn((role: keyof typeof mocks.guards) => mocks.guards[role])
}));
vi.mock("../src/server/core/validation.js", () => ({
  parseBody: mocks.parseBody,
  parseParams: mocks.parseParams,
  parseQuery: mocks.parseQuery
}));
vi.mock("../src/server/modules/subscriptions/subscriptionAutomation.js", () => ({
  evaluateAutoDownloadsForItem: mocks.evaluateAutoDownloadsForItem
}));
vi.mock("../src/server/modules/media/media.service.js", () => ({
  getMedia: mocks.getMedia,
  getMediaDetail: mocks.getMediaDetail,
  listMediaItems: mocks.listMediaItems,
  listTrendingMedia: mocks.listTrendingMedia,
  manuallyMatchParsedReleaseWithProvider: mocks.manuallyMatchParsedReleaseWithProvider,
  matchParsedReleaseForItem: mocks.matchParsedReleaseForItem,
  resolveProviderMediaTitle: mocks.resolveProviderMediaTitle,
  searchExternalMedia: mocks.searchExternalMedia,
  searchLocalMedia: mocks.searchLocalMedia,
  smartSearchExternalMedia: mocks.smartSearchExternalMedia
}));

const { registerMediaRoutes } = await import("../src/server/modules/media/media.routes.js");

type RegisteredRoute = {
  options: { preHandler: unknown };
  handler: (request: any) => Promise<unknown>;
};

const config = { marker: "config" } as any;
let routes: Map<string, RegisteredRoute>;

beforeEach(async () => {
  vi.clearAllMocks();
  routes = new Map();
  const app = {
    get: vi.fn((path: string, options: RegisteredRoute["options"], handler: RegisteredRoute["handler"]) => {
      routes.set(`GET ${path}`, { options, handler });
    }),
    post: vi.fn((path: string, options: RegisteredRoute["options"], handler: RegisteredRoute["handler"]) => {
      routes.set(`POST ${path}`, { options, handler });
    })
  };
  await registerMediaRoutes(app as any, config);
});

describe("media route contracts", () => {
  it("keeps the existing authorization guards on every route", () => {
    expect(route("GET", "/api/media-titles").options.preHandler).toBe(mocks.guards.MEMBER);
    expect(route("GET", "/api/media-titles/trending").options.preHandler).toBe(mocks.guards.VIEWER);
    expect(route("GET", "/api/provider-titles/search").options.preHandler).toBe(mocks.guards.MEMBER);
    expect(route("POST", "/api/provider-titles/search").options.preHandler).toBe(mocks.guards.MEMBER);
    expect(route("POST", "/api/provider-titles/resolve").options.preHandler).toBe(mocks.guards.MEMBER);
    expect(route("GET", "/api/media-titles/:mediaId").options.preHandler).toBe(mocks.guards.MEMBER);
    expect(route("GET", "/api/media-titles/:mediaId/detail").options.preHandler).toBe(mocks.guards.MEMBER);
    expect(route("GET", "/api/media-titles/:mediaId/items").options.preHandler).toBe(mocks.guards.MEMBER);
    expect(route("POST", "/api/items/:itemId/match").options.preHandler).toBe(mocks.guards.ADMIN);
    expect(route("POST", "/api/items/:itemId/match/manual").options.preHandler).toBe(mocks.guards.ADMIN);
  });

  it("runs automatic match, audit, and subscription automation in order and projects the response", async () => {
    const events: string[] = [];
    mocks.matchParsedReleaseForItem.mockImplementation(async () => {
      events.push("match");
      return matchRecord();
    });
    mocks.audit.mockImplementation(async () => {
      events.push("audit");
    });
    mocks.evaluateAutoDownloadsForItem.mockImplementation(async () => {
      events.push("automation");
    });
    const request = matchRequest();

    const response = await route("POST", "/api/items/:itemId/match").handler(request);

    expect(events).toEqual(["match", "audit", "automation"]);
    expect(mocks.matchParsedReleaseForItem).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      itemId: "item-1",
      config
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      request,
      "media_match.run",
      "item",
      "item-1",
      {
        status: "MATCHED",
        mediaProviderIdentityId: "identity-1",
        providerMediaMetadataId: "metadata-1",
        mediaTitleId: "media-1",
        reason: "automatic_match"
      }
    );
    expect(mocks.evaluateAutoDownloadsForItem).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      itemId: "item-1",
      config
    });
    expect(response).toEqual({
      id: "match-1",
      status: "MATCHED",
      mediaTitleId: "media-1",
      mediaProviderIdentityId: "identity-1",
      providerMediaMetadataId: "metadata-1",
      reason: "automatic_match"
    });
  });

  it("runs manual match, audit, and subscription automation in order", async () => {
    const events: string[] = [];
    mocks.parseBody.mockImplementationOnce((_schema, request) => {
      events.push("validate");
      return request.body;
    });
    mocks.manuallyMatchParsedReleaseWithProvider.mockImplementation(async () => {
      events.push("match");
      return matchRecord();
    });
    mocks.audit.mockImplementation(async () => {
      events.push("audit");
    });
    mocks.evaluateAutoDownloadsForItem.mockImplementation(async () => {
      events.push("automation");
    });
    const request = matchRequest({
      body: {
        providerSource: "tmdb_api",
        providerId: "603",
        mediaType: "MOVIE"
      }
    });

    const response = await route("POST", "/api/items/:itemId/match/manual").handler(request);

    expect(events).toEqual(["validate", "match", "audit", "automation"]);
    expect(mocks.manuallyMatchParsedReleaseWithProvider).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      itemId: "item-1",
      config,
      providerSource: "tmdb_api",
      providerId: "603",
      mediaType: "MOVIE"
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      request,
      "media_match.manual_provider",
      "item",
      "item-1",
      expect.objectContaining({
        itemId: "item-1",
        providerSource: "tmdb_api",
        providerId: "603",
        mediaType: "MOVIE"
      })
    );
    expect(response).toEqual({
      id: "match-1",
      status: "MATCHED",
      mediaTitleId: "media-1",
      mediaProviderIdentityId: "identity-1",
      providerMediaMetadataId: "metadata-1",
      reason: "automatic_match"
    });
  });

  it("does not run automation when audit fails", async () => {
    mocks.matchParsedReleaseForItem.mockResolvedValue(matchRecord());
    mocks.audit.mockRejectedValue(new Error("audit failed"));

    await expect(route("POST", "/api/items/:itemId/match").handler(matchRequest()))
      .rejects.toThrow("audit failed");

    expect(mocks.evaluateAutoDownloadsForItem).not.toHaveBeenCalled();
  });

  it("does not audit or automate when matching fails", async () => {
    mocks.matchParsedReleaseForItem.mockRejectedValue(new Error("match failed"));

    await expect(route("POST", "/api/items/:itemId/match").handler(matchRequest()))
      .rejects.toThrow("match failed");

    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.evaluateAutoDownloadsForItem).not.toHaveBeenCalled();
  });
});

function route(method: "GET" | "POST", path: string) {
  const registered = routes.get(`${method} ${path}`);
  if (!registered) throw new Error(`Missing route ${method} ${path}`);
  return registered;
}

function matchRequest(input: { body?: unknown } = {}) {
  return {
    tenantId: "tenant-1",
    params: { itemId: "item-1" },
    body: input.body,
    log: {}
  };
}

function matchRecord() {
  return {
    id: "match-1",
    status: "MATCHED",
    mediaTitleId: "media-1",
    mediaProviderIdentityId: "identity-1",
    providerMediaMetadataId: "metadata-1",
    reason: "automatic_match",
    internal: "not exposed"
  };
}
