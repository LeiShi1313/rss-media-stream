import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ItemDto,
  ItemPageDto,
  MediaDetailDto,
  MediaTitleDto,
  TrendingMediaDto,
  TrendingMediaPageDto
} from "@rss-media/shared/apiContracts";
import { OverviewPage } from "../../src/client/pages/overview.js";
import type { RunAction } from "../../src/client/types.js";
import { renderWithUser } from "./render.js";
import { intersection } from "./setup.js";

const mocks = vi.hoisted(() => ({
  api: vi.fn()
}));

vi.mock("../../src/client/api.js", () => ({
  api: mocks.api
}));

describe("OverviewPage", () => {
  beforeEach(() => {
    mocks.api.mockReset();
  });

  it("replaces and aborts the initial release shelf when a filter becomes active", async () => {
    const initialPage = deferred<ItemPageDto>();
    let initialSignal: AbortSignal | undefined;
    mocks.api.mockImplementation(async (url: string, options?: { signal?: AbortSignal }) => {
      if (url === "/api/items?limit=24") {
        initialSignal = options?.signal;
        return initialPage.promise;
      }
      if (url === "/api/items?limit=24&q=matrix") return emptyItemPage();
      if (url.startsWith("/api/media-titles/trending?")) return emptyTrendingPage();
      throw new Error(`Unexpected API request: ${url}`);
    });
    renderWithUser(<OverviewPage {...pageProps()} />);

    await waitFor(() => {
      expect(initialSignal).toBeDefined();
      expect(mocks.api).toHaveBeenCalledWith(
        "/api/media-titles/trending?windowDays=7&limit=24&mediaType=MOVIE",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      expect(mocks.api).toHaveBeenCalledWith(
        "/api/media-titles/trending?windowDays=7&limit=24&mediaType=TV_SERIES",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    fireEvent.change(screen.getByPlaceholderText("Search title, feed, group, quality"), {
      target: { value: "matrix" }
    });

    await waitFor(() => {
      expect(mocks.api).toHaveBeenCalledWith(
        "/api/items?limit=24&q=matrix",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
    expect(initialSignal?.aborted).toBe(true);
    expect(screen.getByRole("heading", { name: "Filtered releases" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Newly added" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Trending movies" })).not.toBeInTheDocument();

    await act(async () => {
      initialPage.resolve({ items: [makeItem("stale-release", "Stale release")] });
      await initialPage.promise;
    });
    expect(screen.queryByText("Stale release")).not.toBeInTheDocument();
  });

  it("loads a cursor page from the observed sentinel and deduplicates release IDs", async () => {
    const first = makeItem("release-one", "Release One");
    const second = makeItem("release-two", "Release Two");
    mocks.api.mockImplementation(async (url: string) => {
      if (url === "/api/items?limit=24") {
        return { items: [first], nextCursor: "cursor-2" } satisfies ItemPageDto;
      }
      if (url === "/api/items?limit=24&cursor=cursor-2") {
        return { items: [first, second] } satisfies ItemPageDto;
      }
      if (url.startsWith("/api/media-titles/trending?")) return emptyTrendingPage();
      throw new Error(`Unexpected API request: ${url}`);
    });
    renderWithUser(<OverviewPage {...pageProps()} />);

    expect(await screen.findByText("Release One")).toBeInTheDocument();
    await waitFor(() => {
      expect(intersection.observedTargets()).toHaveLength(1);
    });
    const [sentinel] = intersection.observedTargets();
    if (!sentinel) throw new Error("Expected the release pagination sentinel");

    act(() => intersection.intersect(sentinel));

    expect(await screen.findByText("Release Two")).toBeInTheDocument();
    expect(screen.getAllByText("Release One")).toHaveLength(1);
    expect(mocks.api).toHaveBeenCalledWith(
      "/api/items?limit=24&cursor=cursor-2",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("keeps a resolved active download in both matched and downloading shelves", async () => {
    const active = makeResolvedDownloadingItem();
    mocks.api.mockImplementation(async (url: string) => {
      if (url === "/api/items?limit=24") return emptyItemPage();
      if (url.startsWith("/api/media-titles/trending?")) return emptyTrendingPage();
      throw new Error(`Unexpected API request: ${url}`);
    });
    renderWithUser(<OverviewPage {...pageProps({ items: [active] })} />);

    const matchedShelf = screen.getByRole("heading", { name: "Ready titles" }).closest("section");
    const downloadingShelf = screen.getByRole("heading", { name: "Downloading" }).closest("section");
    if (!matchedShelf || !downloadingShelf) throw new Error("Expected both static release shelves");

    expect(within(matchedShelf).getByText("Resolved Dune")).toBeInTheDocument();
    expect(within(downloadingShelf).getByText("Resolved Dune")).toBeInTheDocument();
  });

  it("retries a failed item shelf request", async () => {
    let itemRequests = 0;
    mocks.api.mockImplementation(async (url: string) => {
      if (url === "/api/items?limit=24") {
        itemRequests += 1;
        if (itemRequests === 1) throw new Error("Catalog unavailable");
        return { items: [makeItem("release-retry", "Recovered release")] } satisfies ItemPageDto;
      }
      if (url.startsWith("/api/media-titles/trending?")) return emptyTrendingPage();
      throw new Error(`Unexpected API request: ${url}`);
    });
    const { user } = renderWithUser(<OverviewPage {...pageProps()} />);

    expect(await screen.findByText("Catalog unavailable")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Recovered release")).toBeInTheDocument();
    expect(itemRequests).toBe(2);
  });

  it("loads grouped media detail when a trending card is inspected", async () => {
    const media = makeMedia();
    const trending = makeTrending(media);
    const detail: MediaDetailDto = {
      media: {
        ...media,
        overview: "A desert world caught in a struggle for power."
      },
      releases: [makeItem("release-dune", "Dune.2021.2160p.WEB-DL")]
    };
    mocks.api.mockImplementation(async (url: string) => {
      if (url === "/api/items?limit=24") return emptyItemPage();
      if (url.includes("mediaType=MOVIE")) {
        return { items: [trending] } satisfies TrendingMediaPageDto;
      }
      if (url.includes("mediaType=TV_SERIES")) return emptyTrendingPage();
      if (url === "/api/media-titles/media-dune/detail") return detail;
      throw new Error(`Unexpected API request: ${url}`);
    });
    const { user } = renderWithUser(<OverviewPage {...pageProps()} />);

    await user.click(await screen.findByRole("button", { name: /Dune/ }));

    expect(await screen.findByRole("dialog", { name: "Dune" })).toBeInTheDocument();
    expect(screen.getByText("A desert world caught in a struggle for power.")).toBeInTheDocument();
    expect(screen.getAllByText("Dune.2021.2160p.WEB-DL")).toHaveLength(2);
    expect(mocks.api).toHaveBeenCalledWith("/api/media-titles/media-dune/detail");
  });

  it("ignores a late media-detail response after the inspector closes", async () => {
    const media = makeMedia();
    const detailRequest = deferred<MediaDetailDto>();
    mocks.api.mockImplementation(async (url: string) => {
      if (url === "/api/items?limit=24") return emptyItemPage();
      if (url.includes("mediaType=MOVIE")) {
        return { items: [makeTrending(media)] } satisfies TrendingMediaPageDto;
      }
      if (url.includes("mediaType=TV_SERIES")) return emptyTrendingPage();
      if (url === "/api/media-titles/media-dune/detail") return detailRequest.promise;
      throw new Error(`Unexpected API request: ${url}`);
    });
    const { user } = renderWithUser(<OverviewPage {...pageProps()} />);

    await user.click(await screen.findByRole("button", { name: /Dune/ }));
    expect(await screen.findByRole("dialog", { name: "Loading media" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));

    await act(async () => {
      detailRequest.resolve({
        media: { ...media, overview: "This response arrived too late." },
        releases: []
      });
      await detailRequest.promise;
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("This response arrived too late.")).not.toBeInTheDocument();
  });
});

const successfulRunAction: RunAction = async (action) => {
  await action();
  return { ok: true };
};

function pageProps(overrides: Partial<{
  items: ItemDto[];
  stats: {
    totalItems: number;
    matched: number;
    feeds: number;
    failedJobs: number;
    subscriptions: number;
    downloaders: number;
  };
}> = {}) {
  return {
    busy: false,
    downloaders: [],
    items: [],
    stats: {
      totalItems: 0,
      matched: 0,
      feeds: 0,
      failedJobs: 0,
      subscriptions: 0,
      downloaders: 0
    },
    runAction: successfulRunAction,
    ...overrides
  };
}

function emptyItemPage(): ItemPageDto {
  return { items: [] };
}

function emptyTrendingPage(): TrendingMediaPageDto {
  return { items: [] };
}

function makeItem(id: string, rawTitle: string): ItemDto {
  return {
    id,
    feed: { id: "feed-primary", name: "Primary feed" },
    rawTitle,
    sourceUrl: `https://tracker.example/${id}`,
    sizeBytes: null,
    publishDate: "2026-08-10T10:00:00.000Z",
    firstSeenAt: "2026-08-10T10:00:00.000Z",
    dedupeKeyType: "RELEASE_SIGNATURE",
    enrichmentState: "UNMATCHED",
    downloadJobs: []
  };
}

function makeResolvedDownloadingItem(): ItemDto {
  return {
    ...makeItem("release-active", "Dune.2021.2160p.WEB-DL"),
    enrichmentState: "MATCHED",
    match: {
      id: "match-dune",
      status: "MATCHED",
      source: "AUTO",
      confidence: 1,
      presentation: {
        mediaTitleId: "media-dune",
        mediaType: "MOVIE",
        title: "Resolved Dune",
        releaseYear: 2021,
        hasCover: false
      },
      attention: { required: false, reasons: [] }
    },
    downloadJobs: [{
      id: "job-active",
      status: "DOWNLOADING",
      error: null,
      clientHash: "hash-active",
      createdAt: "2026-08-10T10:05:00.000Z"
    }]
  };
}

function makeMedia(): MediaTitleDto {
  return {
    id: "media-dune",
    kind: "MOVIE",
    mediaType: "MOVIE",
    title: "Dune",
    year: 2021,
    posterUrl: null,
    hasCover: false
  };
}

function makeTrending(media: MediaTitleDto): TrendingMediaDto {
  return {
    media,
    releaseCount: 3,
    latestReleaseAt: "2026-08-10T10:00:00.000Z",
    feedCount: 1,
    feeds: ["Primary feed"],
    qualities: ["2160p"],
    releaseGroups: ["ADWeb"]
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
