import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DownloaderDto,
  ItemDto,
  MediaDetailDto,
  MediaSearchResultDto,
  MediaTitleDto,
  ParsedReleaseDto,
  ProviderSearchResponseDto
} from "@rss-media/shared/apiContracts";
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
          Inspect media
        </button>
      </section>
    );
  }
}));

describe("overview inspector behavior", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.catalogProps = null;
  });

  it("shows the correct release action and resets correction state when the release changes", async () => {
    const releaseA = makeRelease("release-a", "Mystery.Show.S02E03", {
      parsedRelease: makeParsedRelease({ title: "Mystery Show" })
    });
    const { user } = renderHarness({ items: [releaseA] });

    await user.click(screen.getByRole("button", { name: "Inspect release" }));
    expect(screen.getByRole("button", { name: "Choose title" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download anyway" })).toBeDisabled();
    expect(screen.getByText("Reason")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Choose title" }));
    await user.clear(screen.getByPlaceholderText("Search title or paste provider link"));
    await user.type(screen.getByPlaceholderText("Search title or paste provider link"), "stale query");

    act(() => mocks.catalogProps?.onInspectRelease(makeResolvedRelease("release-b", "Resolved Movie")));

    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Search title or paste provider link")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Wrong title?" })).toBeInTheDocument();

    act(() => mocks.catalogProps?.onInspectRelease(makeRelease("release-c", "Pending Release", {
      enrichmentState: "PENDING"
    })));
    expect(screen.queryByRole("button", { name: "Choose title" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Wrong title?" })).not.toBeInTheDocument();
  });

  it("searches with explicit filters, renders PTGen attribution, and applies a selected match", async () => {
    const release = makeRelease("release-search", "Mystery.Show.S02E03", {
      parsedRelease: makeParsedRelease({ title: "Mystery Show", year: 2026 })
    });
    const douban = makePtgenResult({
      providerEntityType: "ptgen_douban_movie",
      providerId: "douban-1291843",
      title: "Dune",
      year: 2026,
      externalUrl: "https://movie.douban.com/subject/1291843/",
      rating: true
    });
    const imdb = makePtgenResult({
      providerEntityType: "ptgen_imdb_movie",
      providerId: "imdb-tt1160419",
      title: "Dune: Part One",
      year: 2024,
      externalUrl: "https://www.imdb.com/title/tt1160419/"
    });
    mocks.api.mockImplementation(async (url: string) => {
      if (url === "/api/provider-titles/search") {
        return { results: [douban, imdb] } satisfies ProviderSearchResponseDto;
      }
      if (url === "/api/items/release-search/match/manual") return undefined;
      throw new Error(`Unexpected API request: ${url}`);
    });
    const runAction = successfulRunAction();
    const { user } = renderHarness({ items: [release], runAction });

    await user.click(screen.getByRole("button", { name: "Inspect release" }));
    await user.click(screen.getByRole("button", { name: "Choose title" }));
    await user.click(screen.getByText("Search options"));
    const correctionPanel = screen.getByText("Title correction").closest("section");
    if (!correctionPanel) throw new Error("Expected the title correction panel");
    const [providerSelect, mediaTypeSelect] = within(correctionPanel).getAllByRole("combobox");
    await user.click(providerSelect!);
    await user.click(screen.getByRole("option", { name: "PTGen" }));
    await user.click(mediaTypeSelect!);
    await user.click(screen.getByRole("option", { name: "Movie" }));
    const searchInput = within(correctionPanel).getByPlaceholderText("Search title or paste provider link");
    await user.clear(searchInput);
    await user.type(searchInput, "  Dune  ");
    await user.click(within(correctionPanel).getByRole("button", { name: "Search" }));

    expect(await screen.findByText("Douban · MOVIE · 2026 · via PTGen")).toBeInTheDocument();
    expect(screen.getByText("IMDb · MOVIE · 2024 · via PTGen")).toBeInTheDocument();
    expect(screen.getByText(/Douban 8\.8\/10 .* votes/)).toBeInTheDocument();
    expect(mocks.api).toHaveBeenCalledWith("/api/provider-titles/search", {
      method: "POST",
      body: JSON.stringify({
        input: "Dune",
        provider: "ptgen",
        mediaType: "MOVIE",
        year: 2026
      })
    });

    const duneResult = screen.getByText("Dune").closest("article");
    if (!duneResult) throw new Error("Expected the Dune result");
    const externalLink = within(duneResult).getByTitle("Source");
    expect(externalLink).toHaveAttribute("href", "https://movie.douban.com/subject/1291843/");
    expect(externalLink).toHaveAttribute("target", "_blank");
    expect(externalLink).toHaveAttribute("rel", "noreferrer");
    fireEvent.click(externalLink);
    expect(runAction).not.toHaveBeenCalled();

    await user.click(within(duneResult).getByRole("button", { name: "Select" }));

    await waitFor(() => expect(runAction).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenCalledWith("/api/items/release-search/match/manual", {
      method: "POST",
      body: JSON.stringify({
        provider: "ptgen",
        providerEntityType: "ptgen_douban_movie",
        providerId: "douban-1291843",
        mediaType: "MOVIE"
      })
    });
    expect(screen.queryByText("Title correction")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Mystery Show" })).toBeInTheDocument();
  });

  it("keeps correction open when manual matching fails", async () => {
    const result = makePtgenResult({ title: "Dune", providerId: "douban-1291843" });
    mocks.api.mockImplementation(async (url: string) => {
      if (url === "/api/provider-titles/search") {
        return { results: [result] } satisfies ProviderSearchResponseDto;
      }
      if (url === "/api/items/release-failed/match/manual") return undefined;
      throw new Error(`Unexpected API request: ${url}`);
    });
    const runAction = vi.fn(async (action: () => Promise<unknown>) => {
      await action();
      return { ok: false as const, message: "Match failed" };
    });
    const { user } = renderHarness({
      items: [makeRelease("release-failed", "Mystery Show", { parsedRelease: makeParsedRelease() })],
      runAction
    });

    await user.click(screen.getByRole("button", { name: "Inspect release" }));
    await user.click(screen.getByRole("button", { name: "Choose title" }));
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(await screen.findByRole("button", { name: "Select" }));

    expect(mocks.api).toHaveBeenCalledWith("/api/items/release-failed/match/manual", expect.any(Object));
    expect(screen.getByText("Title correction")).toBeInTheDocument();
  });

  it("renders both provider search errors and empty-result guidance", async () => {
    let searches = 0;
    mocks.api.mockImplementation(async (url: string) => {
      if (url !== "/api/provider-titles/search") throw new Error(`Unexpected API request: ${url}`);
      searches += 1;
      if (searches === 1) throw new Error("Search unavailable");
      return { results: [] } satisfies ProviderSearchResponseDto;
    });
    const { user } = renderHarness({
      items: [makeRelease("release-errors", "Mystery Show", { parsedRelease: makeParsedRelease() })]
    });

    await user.click(screen.getByRole("button", { name: "Inspect release" }));
    await user.click(screen.getByRole("button", { name: "Choose title" }));
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("Search unavailable")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText(/No matching titles found\./)).toBeInTheDocument();
    expect(screen.getByText(/Use tmdb:603/)).toBeInTheDocument();
  });

  it("downloads a release through runAction with the selected downloader", async () => {
    mocks.api.mockResolvedValue(undefined);
    const runAction = successfulRunAction();
    const { user } = renderHarness({
      downloaders: [makeDownloader()],
      items: [makeRelease("release-download", "Download Me")],
      runAction
    });

    await user.click(screen.getByRole("button", { name: "Inspect release" }));
    const downloadButton = screen.getByRole("button", { name: "Download anyway" });
    await waitFor(() => expect(downloadButton).toBeEnabled());
    await user.click(downloadButton);

    expect(runAction).toHaveBeenCalledTimes(1);
    expect(mocks.api).toHaveBeenCalledWith("/api/items/release-download/downloads", {
      method: "POST",
      body: JSON.stringify({ downloaderId: "downloader-main" })
    });
  });

  it("renders grouped release details without match status and downloads the selected row", async () => {
    const release = makeResolvedRelease("release-tv", "Mystery Show");
    release.rawTitle = "Mystery.Show.S02E03-E04.2160p.WEB-DL.H265.DDP5.1-GROUP";
    release.sizeBytes = "2147483648";
    release.parsedRelease = makeParsedRelease({
      title: "Mystery Show",
      season: 2,
      episode: 3,
      episodeEnd: 4,
      quality: "2160p",
      source: "WEB-DL",
      codec: "H265",
      audio: "DDP5.1",
      releaseGroup: "GROUP"
    });
    const detail: MediaDetailDto = {
      media: { ...makeMedia(), overview: "A grouped TV mystery." },
      releases: [release]
    };
    mocks.api.mockImplementation(async (url: string) => {
      if (url === "/api/media-titles/media-dune/detail") return detail;
      if (url === "/api/items/release-tv/downloads") return undefined;
      throw new Error(`Unexpected API request: ${url}`);
    });
    const runAction = successfulRunAction();
    const { user } = renderHarness({ downloaders: [makeDownloader()], runAction });

    await user.click(screen.getByRole("button", { name: "Inspect media" }));

    const dialog = await screen.findByRole("dialog", { name: "Mystery Show" });
    expect(within(dialog).getByText("A grouped TV mystery.")).toBeInTheDocument();
    expect(within(dialog).getByText("S02E03-E04")).toBeInTheDocument();
    expect(within(dialog).getByText("GROUP")).toBeInTheDocument();
    expect(within(dialog).getByText("2160p")).toBeInTheDocument();
    expect(within(dialog).getByText("WEB-DL")).toBeInTheDocument();
    expect(within(dialog).getByText("H265")).toBeInTheDocument();
    expect(within(dialog).getByText("DDP5.1")).toBeInTheDocument();
    expect(within(dialog).getByText("2.0 GB")).toBeInTheDocument();
    expect(within(dialog).getByText("Original RSS title")).toBeInTheDocument();
    expect(within(dialog).getByText(release.rawTitle)).toBeInTheDocument();
    expect(within(dialog).queryByText("Ready")).not.toBeInTheDocument();
    const sourceLink = within(dialog).getByTitle("Open source release");
    expect(sourceLink).toHaveAttribute("href", release.sourceUrl);

    const downloadButton = within(dialog).getByRole("button", { name: "Send" });
    await waitFor(() => expect(downloadButton).toBeEnabled());
    await user.click(downloadButton);

    expect(runAction).toHaveBeenCalledTimes(1);
    expect(mocks.api).toHaveBeenCalledWith("/api/items/release-tv/downloads", {
      method: "POST",
      body: JSON.stringify({ downloaderId: "downloader-main" })
    });
  });
});

function renderHarness({
  downloaders = [],
  items = [],
  runAction = successfulRunAction()
}: {
  downloaders?: DownloaderDto[];
  items?: ItemDto[];
  runAction?: RunAction;
} = {}) {
  return renderWithUser(
    <OverviewPage
      busy={false}
      downloaders={downloaders}
      items={items}
      runAction={runAction}
      stats={{
        totalItems: items.length,
        matched: 0,
        feeds: 0,
        failedJobs: 0,
        subscriptions: 0,
        downloaders: downloaders.length
      }}
    />
  );
}

function successfulRunAction() {
  return vi.fn(async (action: () => Promise<unknown>) => {
    await action();
    return { ok: true as const };
  });
}

function makeRelease(
  id: string,
  rawTitle: string,
  overrides: Partial<ItemDto> = {}
): ItemDto {
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
    downloadJobs: [],
    ...overrides
  };
}

function makeResolvedRelease(id: string, title: string): ItemDto {
  return makeRelease(id, `${title}.2026.2160p.WEB-DL`, {
    enrichmentState: "MATCHED",
    match: {
      id: `match-${id}`,
      status: "MATCHED",
      source: "AUTO",
      confidence: 1,
      presentation: {
        mediaTitleId: "media-dune",
        mediaType: "TV_SERIES",
        title,
        releaseYear: 2026,
        hasCover: false
      },
      attention: { required: false, reasons: [] }
    }
  });
}

function makeParsedRelease(overrides: Partial<ParsedReleaseDto> = {}): ParsedReleaseDto {
  return {
    id: "parsed-release",
    title: "Mystery Show",
    year: 2026,
    kind: "TV",
    mediaType: "TV_SERIES",
    tvUnitType: "EPISODE",
    season: 2,
    episode: 3,
    episodeEnd: null,
    specialNumber: null,
    episodePart: null,
    resolution: 2160,
    quality: "2160p",
    source: "WEB-DL",
    codec: "H265",
    audio: "DDP5.1",
    releaseGroup: "GROUP",
    variant: null,
    confidence: 1,
    parseConfidence: 1,
    parsedAt: "2026-08-10T10:00:00.000Z",
    ...overrides
  };
}

function makePtgenResult({
  providerEntityType = "ptgen_douban_movie",
  providerId,
  title,
  year = 2026,
  externalUrl,
  rating = false
}: {
  providerEntityType?: string;
  providerId: string;
  title: string;
  year?: number;
  externalUrl?: string;
  rating?: boolean;
}): MediaSearchResultDto {
  return {
    provider: "ptgen",
    providerSource: "ptgen",
    providerEntityType,
    providerId,
    mediaType: "MOVIE",
    kind: "MOVIE",
    title,
    year,
    posterUrl: null,
    presentation: {
      mediaType: "MOVIE",
      title,
      releaseYear: year,
      hasCover: false,
      rating: rating ? {
        provider: "douban",
        providerSource: "ptgen_douban",
        providerId: "1291843",
        providerLabel: "Douban",
        providerSourceLabel: "PTGen Douban",
        value: 8.8,
        scale: 10,
        voteCount: 912345,
        type: "user_score",
        fetchedAt: "2026-08-10T10:00:00.000Z"
      } : undefined
    },
    hasCover: false,
    score: 0.95,
    attributionText: "PTGen",
    externalUrl
  };
}

function makeMedia(): MediaTitleDto {
  return {
    id: "media-dune",
    kind: "TV",
    mediaType: "TV_SERIES",
    title: "Mystery Show",
    year: 2026,
    posterUrl: null,
    hasCover: false
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
