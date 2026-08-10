import { act, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemDto, MediaDetailDto, MediaTitleDto } from "@rss-media/shared/apiContracts";
import type { OverviewCatalogProps } from "../../src/client/components/overview/overview-catalog.js";
import { OverviewPage } from "../../src/client/pages/overview.js";
import type { RunAction } from "../../src/client/types.js";
import { renderWithUser } from "./render.js";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  catalogProps: null as OverviewCatalogProps | null
}));

vi.mock("../../src/client/api.js", () => ({
  api: mocks.api
}));

vi.mock("../../src/client/components/overview/overview-catalog.js", () => ({
  OverviewCatalog: (props: OverviewCatalogProps) => {
    mocks.catalogProps = props;
    return (
      <section aria-label="Catalog seam">
        {props.items[0] && (
          <button onClick={() => props.onInspectRelease(props.items[0]!)} type="button">
            Inspect release
          </button>
        )}
        <button onClick={() => props.onInspectMedia("media-dune")} type="button">
          Inspect Dune
        </button>
        <button onClick={() => props.onInspectMedia("media-arrakis")} type="button">
          Inspect Arrakis
        </button>
      </section>
    );
  }
}));

describe("OverviewPage", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.catalogProps = null;
  });

  it("forwards items and opens the release inspector from the catalog callback", async () => {
    const release = makeItem("release-inspect", "Release to inspect");
    const items = [release];
    const { user } = renderWithUser(<OverviewPage {...pageProps({ items })} />);

    expect(mocks.catalogProps?.items).toBe(items);
    await user.click(screen.getByRole("button", { name: "Inspect release" }));

    expect(await screen.findByRole("dialog", { name: "Release to inspect" })).toBeInTheDocument();
  });

  it("loads grouped media detail from the catalog callback", async () => {
    const detail = mediaDetail(makeMedia("media-dune", "Dune"), "A desert world caught in a struggle for power.");
    mocks.api.mockResolvedValue(detail);
    const { user } = renderWithUser(<OverviewPage {...pageProps()} />);

    await user.click(screen.getByRole("button", { name: "Inspect Dune" }));

    expect(await screen.findByRole("dialog", { name: "Dune" })).toBeInTheDocument();
    expect(screen.getByText("A desert world caught in a struggle for power.")).toBeInTheDocument();
    expect(mocks.api).toHaveBeenCalledWith("/api/media-titles/media-dune/detail");
  });

  it("ignores a late media-detail response after selecting another title", async () => {
    const duneRequest = deferred<MediaDetailDto>();
    const arrakisDetail = mediaDetail(makeMedia("media-arrakis", "Arrakis"), "The current selection.");
    mocks.api.mockImplementation(async (url: string) => {
      if (url === "/api/media-titles/media-dune/detail") return duneRequest.promise;
      if (url === "/api/media-titles/media-arrakis/detail") return arrakisDetail;
      throw new Error(`Unexpected API request: ${url}`);
    });
    const { user } = renderWithUser(<OverviewPage {...pageProps()} />);

    await user.click(screen.getByRole("button", { name: "Inspect Dune" }));
    expect(await screen.findByRole("dialog", { name: "Loading media" })).toBeInTheDocument();
    act(() => mocks.catalogProps?.onInspectMedia("media-arrakis"));
    expect(await screen.findByRole("dialog", { name: "Arrakis" })).toBeInTheDocument();

    await act(async () => {
      duneRequest.resolve(mediaDetail(makeMedia("media-dune", "Dune"), "This response arrived too late."));
      await duneRequest.promise;
    });
    expect(screen.getByRole("dialog", { name: "Arrakis" })).toBeInTheDocument();
    expect(screen.queryByText("This response arrived too late.")).not.toBeInTheDocument();
  });

  it("ignores a late media-detail response after the inspector closes", async () => {
    const detailRequest = deferred<MediaDetailDto>();
    mocks.api.mockReturnValue(detailRequest.promise);
    const { user } = renderWithUser(<OverviewPage {...pageProps()} />);

    await user.click(screen.getByRole("button", { name: "Inspect Dune" }));
    expect(await screen.findByRole("dialog", { name: "Loading media" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));

    await act(async () => {
      detailRequest.resolve(mediaDetail(makeMedia("media-dune", "Dune"), "This response arrived too late."));
      await detailRequest.promise;
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("This response arrived too late.")).not.toBeInTheDocument();
  });

  it("combines unresolved releases and failed jobs in the attention stat", () => {
    renderWithUser(<OverviewPage {...pageProps({
      items: [makeItem("release-unresolved", "Unresolved release")],
      stats: { ...emptyStats(), failedJobs: 2 }
    })} />);

    const attentionTile = screen.getByText("Attention").closest("article");
    if (!attentionTile) throw new Error("Expected the attention stat tile");
    expect(within(attentionTile).getByText("3")).toBeInTheDocument();
  });
});

const successfulRunAction: RunAction = async (action) => {
  await action();
  return { ok: true };
};

function pageProps(overrides: Partial<{
  items: ItemDto[];
  stats: ReturnType<typeof emptyStats>;
}> = {}) {
  return {
    busy: false,
    downloaders: [],
    items: [],
    stats: emptyStats(),
    runAction: successfulRunAction,
    ...overrides
  };
}

function emptyStats() {
  return {
    totalItems: 0,
    matched: 0,
    feeds: 0,
    failedJobs: 0,
    subscriptions: 0,
    downloaders: 0
  };
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

function makeMedia(id: string, title: string): MediaTitleDto {
  return {
    id,
    kind: "MOVIE",
    mediaType: "MOVIE",
    title,
    year: 2021,
    posterUrl: null,
    hasCover: false
  };
}

function mediaDetail(media: MediaTitleDto, overview: string): MediaDetailDto {
  return {
    media: { ...media, overview },
    releases: []
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
