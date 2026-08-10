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
import {
  OverviewInspector,
  type OverviewInspectorProps,
  type OverviewInspectorTarget
} from "../../src/client/components/overview/overview-inspector.js";
import type { RunAction } from "../../src/client/types.js";
import { renderWithUser } from "./render.js";

const mocks = vi.hoisted(() => ({
  api: vi.fn()
}));

vi.mock("../../src/client/api.js", () => ({
  api: mocks.api
}));

describe("overview inspector behavior", () => {
  beforeEach(() => {
    mocks.api.mockReset();
  });

  it("shows the correct release action and resets correction state when the release changes", async () => {
    const releaseA = makeRelease("release-a", "Mystery.Show.S02E03", {
      parsedRelease: makeParsedRelease({ title: "Mystery Show" })
    });
    const { setTarget, user } = renderHarness({ target: { type: "release", item: releaseA } });

    expect(screen.getByRole("button", { name: "Choose title" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download anyway" })).toBeDisabled();
    expect(screen.getByText("Reason")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Choose title" }));
    await user.clear(screen.getByPlaceholderText("Search title or paste provider link"));
    await user.type(screen.getByPlaceholderText("Search title or paste provider link"), "stale query");

    setTarget({ type: "release", item: makeResolvedRelease("release-b", "Resolved Movie") });

    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Search title or paste provider link")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Wrong title?" })).toBeInTheDocument();

    setTarget({
      type: "release",
      item: makeRelease("release-c", "Pending Release", { enrichmentState: "PENDING" })
    });
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
    const { user } = renderHarness({ target: { type: "release", item: release }, runAction });

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
      target: {
        type: "release",
        item: makeRelease("release-failed", "Mystery Show", { parsedRelease: makeParsedRelease() })
      },
      runAction
    });

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
      target: {
        type: "release",
        item: makeRelease("release-errors", "Mystery Show", { parsedRelease: makeParsedRelease() })
      }
    });

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
      target: {
        type: "release",
        item: makeRelease("release-download", "Download Me")
      },
      runAction
    });

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
    const { user } = renderHarness({
      downloaders: [makeDownloader()],
      runAction,
      target: { type: "media", mediaId: "media-dune" }
    });

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

  it("fully resets a release session before a late search response arrives", async () => {
    const searchRequest = deferred<ProviderSearchResponseDto>();
    mocks.api.mockReturnValue(searchRequest.promise);
    const releaseA = makeRelease("release-a", "First Show", {
      parsedRelease: makeParsedRelease({ title: "First Show" })
    });
    const releaseB = makeRelease("release-b", "Second Show", {
      parsedRelease: makeParsedRelease({ title: "Second Show" })
    });
    const { setTarget, user } = renderHarness({ target: { type: "release", item: releaseA } });

    await user.click(screen.getByRole("button", { name: "Choose title" }));
    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));

    setTarget({ type: "release", item: releaseB });
    expect(screen.getByRole("dialog", { name: "Second Show" })).toBeInTheDocument();
    await act(async () => {
      searchRequest.resolve({
        results: [makePtgenResult({ title: "Late First Result", providerId: "douban-late" })]
      });
      await searchRequest.promise;
    });
    await user.click(screen.getByRole("button", { name: "Choose title" }));

    expect(screen.getByPlaceholderText("Search title or paste provider link")).toHaveValue("Second Show");
    expect(screen.queryByText("Late First Result")).not.toBeInTheDocument();
  });

  it("aborts the previous media request and never renders its late response", async () => {
    const duneRequest = deferred<MediaDetailDto>();
    const arrakisRequest = deferred<MediaDetailDto>();
    let duneSignal: AbortSignal | undefined;
    let arrakisSignal: AbortSignal | undefined;
    mocks.api.mockImplementation(async (url: string, options?: { signal?: AbortSignal }) => {
      if (url === "/api/media-titles/media-dune/detail") {
        duneSignal = options?.signal;
        return duneRequest.promise;
      }
      if (url === "/api/media-titles/media-arrakis/detail") {
        arrakisSignal = options?.signal;
        return arrakisRequest.promise;
      }
      throw new Error(`Unexpected API request: ${url}`);
    });
    const { setTarget } = renderHarness({ target: { type: "media", mediaId: "media-dune" } });

    await waitFor(() => expect(duneSignal).toBeDefined());
    expect(screen.getByRole("dialog", { name: "Loading media" })).toBeInTheDocument();
    setTarget({ type: "media", mediaId: "media-arrakis" });
    expect(duneSignal?.aborted).toBe(true);
    expect(screen.getByRole("dialog", { name: "Loading media" })).toBeInTheDocument();
    await waitFor(() => expect(arrakisSignal).toBeDefined());

    await act(async () => {
      arrakisRequest.resolve({
        media: { ...makeMedia("media-arrakis", "Arrakis"), overview: "The current selection." },
        releases: []
      });
      await arrakisRequest.promise;
    });
    expect(screen.getByRole("dialog", { name: "Arrakis" })).toBeInTheDocument();

    await act(async () => {
      duneRequest.resolve({
        media: { ...makeMedia("media-dune", "Dune"), overview: "This response arrived too late." },
        releases: []
      });
      await duneRequest.promise;
    });
    expect(screen.getByRole("dialog", { name: "Arrakis" })).toBeInTheDocument();
    expect(screen.queryByText("This response arrived too late.")).not.toBeInTheDocument();
  });

  it("aborts media detail loading when the inspector unmounts", async () => {
    const detailRequest = deferred<MediaDetailDto>();
    let signal: AbortSignal | undefined;
    mocks.api.mockImplementation(async (_url: string, options?: { signal?: AbortSignal }) => {
      signal = options?.signal;
      return detailRequest.promise;
    });
    const { unmount } = renderHarness({ target: { type: "media", mediaId: "media-dune" } });

    await waitFor(() => expect(signal).toBeDefined());
    unmount();

    expect(signal?.aborted).toBe(true);
    await act(async () => {
      detailRequest.resolve({ media: makeMedia(), releases: [] });
      await detailRequest.promise;
    });
  });

  it("retains the loading and empty-release presentation when media detail fails", async () => {
    mocks.api.mockRejectedValue(new Error("Detail unavailable"));
    renderHarness({ target: { type: "media", mediaId: "media-dune" } });

    expect(await screen.findByRole("dialog", { name: "Loading media" })).toBeInTheDocument();
    expect(screen.getByText("Loading media detail and release versions.")).toBeInTheDocument();
    expect(screen.getByText("No release versions loaded yet")).toBeInTheDocument();
    expect(mocks.api).toHaveBeenCalledWith(
      "/api/media-titles/media-dune/detail",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});

function renderHarness({
  busy = false,
  downloaders = [],
  onClose = vi.fn(),
  target,
  runAction = successfulRunAction()
}: {
  busy?: boolean;
  downloaders?: DownloaderDto[];
  onClose?: () => void;
  target: OverviewInspectorTarget;
  runAction?: RunAction;
}) {
  const props: Omit<OverviewInspectorProps, "target"> = {
    busy,
    downloaders,
    onClose,
    runAction
  };
  const rendered = renderWithUser(<OverviewInspector {...props} target={target} />);
  return {
    ...rendered,
    setTarget: (nextTarget: OverviewInspectorTarget) => {
      rendered.rerender(<OverviewInspector {...props} target={nextTarget} />);
    }
  };
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

function makeMedia(id = "media-dune", title = "Mystery Show"): MediaTitleDto {
  return {
    id,
    kind: "TV",
    mediaType: "TV_SERIES",
    title,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
