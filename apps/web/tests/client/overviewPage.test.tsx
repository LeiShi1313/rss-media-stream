import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloaderDto, ItemDto } from "@rss-media/shared/apiContracts";
import type { OverviewCatalogProps } from "../../src/client/components/overview/overview-catalog.js";
import type { OverviewInspectorProps } from "../../src/client/components/overview/overview-inspector.js";
import { OverviewPage } from "../../src/client/pages/overview.js";
import type { RunAction } from "../../src/client/types.js";
import { renderWithUser } from "./render.js";

const mocks = vi.hoisted(() => ({
  catalogProps: null as OverviewCatalogProps | null,
  inspectorProps: null as OverviewInspectorProps | null
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

vi.mock("../../src/client/components/overview/overview-inspector.js", () => ({
  OverviewInspector: (props: OverviewInspectorProps) => {
    mocks.inspectorProps = props;
    const label = props.target.type === "release"
      ? `Release ${props.target.item.id}`
      : `Media ${props.target.mediaId}`;
    return (
      <section aria-label="Inspector seam">
        <span>{label}</span>
        <button onClick={props.onClose} type="button">Close inspector</button>
      </section>
    );
  }
}));

describe("OverviewPage", () => {
  beforeEach(() => {
    mocks.catalogProps = null;
    mocks.inspectorProps = null;
  });

  it("forwards page data and maps a release inspection to the inspector target", async () => {
    const release = makeItem("release-inspect", "Release to inspect");
    const items = [release];
    const downloaders = [makeDownloader()];
    const runAction = successfulRunAction;
    const { user } = renderWithUser(
      <OverviewPage {...pageProps({ busy: true, downloaders, items, runAction })} />
    );

    expect(mocks.catalogProps?.items).toBe(items);
    await user.click(screen.getByRole("button", { name: "Inspect release" }));

    expect(mocks.inspectorProps?.target).toEqual({ type: "release", item: release });
    expect(mocks.inspectorProps?.busy).toBe(true);
    expect(mocks.inspectorProps?.downloaders).toBe(downloaders);
    expect(mocks.inspectorProps?.runAction).toBe(runAction);
    expect(screen.getByText("Release release-inspect")).toBeInTheDocument();
  });

  it("replaces the active target with media selections and clears it on close", async () => {
    const release = makeItem("release-inspect", "Release to inspect");
    const { user } = renderWithUser(<OverviewPage {...pageProps({ items: [release] })} />);

    await user.click(screen.getByRole("button", { name: "Inspect release" }));
    expect(screen.getByText("Release release-inspect")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Inspect Dune" }));
    expect(mocks.inspectorProps?.target).toEqual({ type: "media", mediaId: "media-dune" });
    expect(screen.queryByText("Release release-inspect")).not.toBeInTheDocument();
    expect(screen.getByText("Media media-dune")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Inspect Arrakis" }));
    expect(mocks.inspectorProps?.target).toEqual({ type: "media", mediaId: "media-arrakis" });
    expect(screen.getAllByLabelText("Inspector seam")).toHaveLength(1);
    expect(screen.getByText("Media media-arrakis")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close inspector" }));
    expect(screen.queryByLabelText("Inspector seam")).not.toBeInTheDocument();
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
  busy: boolean;
  downloaders: DownloaderDto[];
  items: ItemDto[];
  runAction: RunAction;
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

function makeDownloader(): DownloaderDto {
  return {
    id: "downloader-main",
    name: "Main downloader",
    type: "QBITTORRENT",
    baseUrl: "https://downloader.example",
    username: null,
    defaultSavePath: null,
    category: null,
    tags: [],
    enabled: true,
    isDefault: true,
    jobCount: 0,
    createdAt: "2026-08-10T10:00:00.000Z",
    updatedAt: "2026-08-10T10:00:00.000Z"
  };
}
