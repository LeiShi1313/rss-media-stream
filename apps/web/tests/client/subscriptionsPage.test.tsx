import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ItemDto,
  MediaPresentationDto,
  MediaSearchResultDto,
  ResolvedMediaTitleDto,
  SubscriptionDto,
  SubscriptionRuleDto
} from "@rss-media/shared/apiContracts";
import { SubscriptionsPage } from "../../src/client/pages/subscriptions.js";
import type { RunAction } from "../../src/client/types.js";
import { renderWithUser } from "./render.js";

const mocks = vi.hoisted(() => ({
  api: vi.fn()
}));

vi.mock("../../src/client/api.js", () => ({
  api: mocks.api
}));

const presentation: MediaPresentationDto = {
  mediaType: "MOVIE",
  title: "Dune",
  releaseYear: 2021,
  displaySource: {
    provider: "tmdb",
    providerId: "438631"
  },
  hasCover: true
};

const searchResult: MediaSearchResultDto = {
  provider: "tmdb",
  providerSource: "tmdb_api",
  providerEntityType: "movie",
  providerId: "438631",
  mediaType: "MOVIE",
  kind: "MOVIE",
  title: "Dune",
  year: 2021,
  posterUrl: "https://images.example/dune.jpg",
  presentation,
  hasCover: true,
  score: 0.92,
  attributionText: "TMDB"
};

const resolvedMedia: ResolvedMediaTitleDto = {
  mediaTitleId: "media-dune",
  mediaType: "MOVIE",
  title: "Dune",
  year: 2021,
  posterUrl: "https://images.example/dune.jpg",
  hasCover: true,
  provider: "tmdb",
  providerSource: "tmdb_api",
  providerEntityType: "movie",
  providerId: "438631",
  presentation
};

describe("SubscriptionsPage", () => {
  beforeEach(() => {
    mocks.api.mockReset();
  });

  it("filters subscriptions across their displayed management fields", async () => {
    const subscriptions = [
      makeSubscription({
        id: "subscription-dune",
        title: "Dune 2160p+",
        downloader: {
          id: "downloader-primary",
          name: "Primary qBittorrent",
          type: "QBITTORRENT",
          enabled: true
        }
      }),
      makeSubscription({
        id: "subscription-foundation",
        title: "Foundation S03",
        media: {
          id: "media-foundation",
          provider: "tmdb",
          providerId: "93740",
          kind: "TV",
          mediaType: "TV_SERIES",
          title: "Foundation",
          year: 2021,
          hasCover: false
        },
        downloader: {
          id: "downloader-archive",
          name: "Archive Transmission",
          type: "TRANSMISSION",
          enabled: true
        }
      })
    ];
    const { user } = renderWithUser(<SubscriptionsPage {...pageProps(subscriptions)} />);

    await user.type(screen.getByRole("searchbox", { name: "Search subscriptions" }), "Archive Transmission");

    expect(screen.getByText("Foundation S03")).toBeInTheDocument();
    expect(screen.queryByText("Dune 2160p+")).not.toBeInTheDocument();
  });

  it("distinguishes an empty collection from a query with no matches", async () => {
    const empty = renderWithUser(<SubscriptionsPage {...pageProps([])} />);
    expect(screen.getByText("No subscription rules yet")).toBeInTheDocument();
    empty.unmount();

    const { user } = renderWithUser(<SubscriptionsPage {...pageProps([makeSubscription()])} />);
    await user.type(screen.getByRole("searchbox", { name: "Search subscriptions" }), "missing title");

    expect(screen.getByText("No subscriptions match the current search")).toBeInTheDocument();
    expect(screen.queryByText("No subscription rules yet")).not.toBeInTheDocument();
  });

  it("creates a media-title subscription from provider search and resolution", async () => {
    mocks.api.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/provider-titles/search?")) return [searchResult];
      if (url === "/api/provider-titles/resolve") return resolvedMedia;
      if (url === "/api/subscriptions") return undefined;
      throw new Error(`Unexpected API request: ${url}`);
    });
    const { user } = renderWithUser(
      <SubscriptionsPage {...pageProps([], runActionThroughApi)} />
    );

    await user.click(screen.getByRole("button", { name: "Create Subscription" }));
    await user.type(screen.getByPlaceholderText("Search metadata"), "Dune");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(await screen.findByRole("button", { name: /Dune.*2021.*TMDB.*92%/ }));
    await user.click(screen.getByRole("button", { name: "Save Subscription" }));

    expect(mocks.api).toHaveBeenCalledWith(
      "/api/provider-titles/search?q=Dune&mediaType=MOVIE"
    );
    expect(mocks.api).toHaveBeenCalledWith("/api/provider-titles/resolve", {
      method: "POST",
      body: JSON.stringify({
        providerSource: "tmdb_api",
        providerEntityType: "movie",
        providerId: "438631",
        mediaType: "MOVIE"
      })
    });
    const createCall = apiCall("/api/subscriptions");
    expect(createCall?.[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(createCall?.[1]?.body as string)).toEqual({
      title: "Dune 2160p+",
      mediaTitleId: "media-dune",
      autoDownload: true,
      enabled: true,
      rule: {
        mode: "MEDIA_TITLE",
        mediaType: "MOVIE",
        mediaTitleId: "media-dune",
        selectedProvider: {
          provider: "tmdb",
          mediaType: "MOVIE",
          providerId: "438631"
        },
        minResolution: 2160,
        sources: [],
        codecs: [],
        audio: [],
        releaseGroupsInclude: [],
        releaseGroupsExclude: [],
        preferredReleaseGroups: [],
        feedIds: [],
        upgradePolicy: "none",
        allowCrossSeed: false,
        separateVariants: false,
        seasonPackAllowed: true
      }
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Create Subscription" })).not.toBeInTheDocument();
    });
  });

  it("keeps a failed regex subscription open with its error and identity-free payload", async () => {
    mocks.api.mockImplementation(async (url: string) => {
      if (url === "/api/subscriptions") throw new Error("Subscription was rejected");
      throw new Error(`Unexpected API request: ${url}`);
    });
    const { user } = renderWithUser(
      <SubscriptionsPage {...pageProps([], runActionThroughApi)} />
    );

    await user.click(screen.getByRole("button", { name: "Create Subscription" }));
    await user.click(screen.getByRole("button", { name: "Raw regex rule" }));
    await user.type(screen.getByLabelText("Title regex"), "Stand-Up.*S03");
    await user.click(screen.getByRole("button", { name: "Save Subscription" }));

    const createCall = apiCall("/api/subscriptions");
    const payload = JSON.parse(createCall?.[1]?.body as string);
    expect(payload).toMatchObject({
      title: "Stand-Up.*S03",
      autoDownload: true,
      enabled: true,
      rule: {
        mode: "REGEX",
        mediaType: "MOVIE",
        titleRegex: "Stand-Up.*S03",
        minResolution: 2160
      }
    });
    expect(payload).not.toHaveProperty("mediaTitleId");
    expect(payload.rule).not.toHaveProperty("mediaTitleId");
    expect(payload.rule).not.toHaveProperty("selectedProvider");
    expect(await screen.findByText("Subscription was rejected")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Create Subscription" })).toBeInTheDocument();
  });

  it("derives sorted release-group suggestions and excludes the selected value", async () => {
    const subscription = makeSubscription({
      rule: makeRule({
        releaseGroupsInclude: ["Gamma", " Alpha "],
        releaseGroupsExclude: ["beta", ""],
        preferredReleaseGroups: ["Delta"]
      })
    });
    const items = [
      makeItem("item-beta", " Beta "),
      makeItem("item-blank", " ")
    ];
    const { user } = renderWithUser(
      <SubscriptionsPage {...pageProps([subscription], runActionThroughApi, items)} />
    );

    await user.click(screen.getByRole("button", { name: "Create Subscription" }));
    await user.click(screen.getByRole("button", { name: "Raw regex rule" }));
    const suggestions = screen.getByRole("button", { name: "Release group suggestions" });
    await user.click(suggestions);

    expect((await screen.findAllByRole("menuitem")).map((item) => item.textContent)).toEqual([
      "Alpha",
      "Beta",
      "Delta",
      "Gamma"
    ]);

    await user.keyboard("{Escape}");
    await user.type(screen.getByLabelText("Include release groups"), "alpha");
    await user.click(suggestions);

    expect(screen.queryByRole("menuitem", { name: "Alpha" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Beta",
      "Delta",
      "Gamma"
    ]);
  });

  it("keeps an edit open when its rule update fails after a null-downloader patch", async () => {
    const subscription = makeSubscription({ downloader: undefined });
    mocks.api.mockImplementation(async (url: string) => {
      if (url === `/api/subscriptions/${subscription.id}`) return undefined;
      if (url === `/api/subscriptions/${subscription.id}/rule`) {
        throw new Error("Rule update was rejected");
      }
      throw new Error(`Unexpected API request: ${url}`);
    });
    const { user } = renderWithUser(
      <SubscriptionsPage {...pageProps([subscription], runActionThroughApi)} />
    );

    await user.click(screen.getByRole("button", { name: `Edit ${subscription.title}` }));
    await user.click(screen.getByRole("button", { name: "Save Subscription" }));

    const mutationCalls = mocks.api.mock.calls.filter(([url]) =>
      String(url).startsWith(`/api/subscriptions/${subscription.id}`)
    );
    expect(mutationCalls.map(([url]) => url)).toEqual([
      `/api/subscriptions/${subscription.id}`,
      `/api/subscriptions/${subscription.id}/rule`
    ]);
    expect(JSON.parse(mutationCalls[0]?.[1]?.body as string)).toMatchObject({
      mediaTitleId: "media-dune",
      downloaderId: null
    });
    expect(await screen.findByText("Rule update was rejected")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Edit Subscription" })).toBeInTheDocument();
  });

  it("updates subscription metadata before its existing media rule and closes on success", async () => {
    const subscription = makeSubscription();
    mocks.api.mockResolvedValue(undefined);
    const { user } = renderWithUser(
      <SubscriptionsPage {...pageProps([subscription], runActionThroughApi)} />
    );

    await user.click(screen.getByRole("button", { name: `Edit ${subscription.title}` }));
    expect(screen.getByText("Selected media")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Search metadata")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save Subscription" }));

    const mutationCalls = mocks.api.mock.calls.filter(([url]) =>
      String(url).startsWith(`/api/subscriptions/${subscription.id}`)
    );
    expect(mutationCalls.map(([url]) => url)).toEqual([
      `/api/subscriptions/${subscription.id}`,
      `/api/subscriptions/${subscription.id}/rule`
    ]);
    expect(JSON.parse(mutationCalls[0]?.[1]?.body as string)).toEqual({
      title: "Dune 2160p+",
      mediaTitleId: "media-dune",
      downloaderId: "downloader-primary",
      autoDownload: true,
      enabled: true
    });
    expect(JSON.parse(mutationCalls[1]?.[1]?.body as string)).toMatchObject({
      mode: "MEDIA_TITLE",
      mediaType: "MOVIE",
      mediaTitleId: "media-dune",
      selectedProvider: {
        provider: "tmdb",
        mediaType: "MOVIE",
        providerId: "438631"
      },
      feedIds: ["feed-primary"],
      minResolution: 2160,
      sources: ["WEB-DL"],
      preferredReleaseGroups: ["ADWeb"]
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Edit Subscription" })).not.toBeInTheDocument();
    });
  });
});

function pageProps(
  subscriptions: SubscriptionDto[],
  runAction: RunAction = runActionThroughApi,
  items: ItemDto[] = []
) {
  return {
    busy: false,
    downloaders: [],
    feeds: [],
    items,
    subscriptions,
    runAction
  };
}

const runActionThroughApi: RunAction = async (action) => {
  try {
    await action();
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
};

function apiCall(url: string) {
  return mocks.api.mock.calls.find(([candidate]) => candidate === url);
}

function makeSubscription(overrides: Partial<SubscriptionDto> = {}): SubscriptionDto {
  return {
    id: "subscription-dune",
    title: "Dune 2160p+",
    createdByUserId: "user-owner",
    media: {
      id: "media-dune",
      provider: "tmdb",
      providerSource: "tmdb_api",
      providerEntityType: "movie",
      providerId: "438631",
      kind: "MOVIE",
      mediaType: "MOVIE",
      title: "Dune",
      year: 2021,
      hasCover: true
    },
    downloader: {
      id: "downloader-primary",
      name: "Primary qBittorrent",
      type: "QBITTORRENT",
      enabled: true
    },
    autoDownload: true,
    enabled: true,
    rule: makeRule(),
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides
  };
}

function makeRule(overrides: Partial<SubscriptionRuleDto> = {}): SubscriptionRuleDto {
  return {
    id: "rule-dune",
    mode: "MEDIA_TITLE",
    mediaType: "MOVIE",
    mediaTitleId: "media-dune",
    selectedProvider: {
      provider: "tmdb",
      mediaType: "MOVIE",
      providerEntityType: "movie",
      providerId: "438631"
    },
    linkedProviders: [],
    providerRatings: [],
    feedIds: ["feed-primary"],
    titleRegex: null,
    includeRegex: null,
    excludeRegex: null,
    minResolution: 2160,
    maxResolution: null,
    sources: ["WEB-DL"],
    codecs: [],
    audio: [],
    releaseGroupsInclude: [],
    releaseGroupsExclude: [],
    variantsInclude: [],
    variantsExclude: [],
    preferredReleaseGroups: ["ADWeb"],
    season: null,
    episodeStart: null,
    episodeEnd: null,
    upgradePolicy: "none",
    allowCrossSeed: false,
    separateVariants: false,
    seasonPackAllowed: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides
  };
}

function makeItem(id: string, releaseGroup: string): ItemDto {
  return {
    id,
    feed: { id: "feed-primary", name: "Primary feed" },
    rawTitle: `Release ${id}`,
    sourceUrl: null,
    sizeBytes: null,
    publishDate: "2026-08-01T00:00:00.000Z",
    firstSeenAt: "2026-08-01T00:00:00.000Z",
    dedupeKeyType: "RELEASE_SIGNATURE",
    parsedRelease: {
      id: `parsed-${id}`,
      title: `Release ${id}`,
      year: null,
      kind: "MOVIE",
      mediaType: "MOVIE",
      tvUnitType: null,
      season: null,
      episode: null,
      episodeEnd: null,
      specialNumber: null,
      episodePart: null,
      resolution: 2160,
      quality: "WEB-DL",
      source: "WEB-DL",
      codec: "H265",
      audio: null,
      releaseGroup,
      variant: null,
      confidence: 1,
      parseConfidence: 1,
      parsedAt: "2026-08-01T00:00:00.000Z"
    },
    enrichmentState: "UNMATCHED",
    downloadJobs: []
  };
}
