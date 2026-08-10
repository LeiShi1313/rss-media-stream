import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionDto } from "@rss-media/shared/apiContracts";
import type { SubscriptionEditorSession } from "../../src/client/components/subscriptions/subscription-editor-dialog.js";
import { SubscriptionsPage } from "../../src/client/pages/subscriptions.js";
import type { RunAction } from "../../src/client/types.js";
import { renderWithUser } from "./render.js";

const mocks = vi.hoisted(() => ({
  editorProps: vi.fn()
}));

vi.mock("../../src/client/components/subscriptions/subscription-editor-dialog.js", () => ({
  SubscriptionEditorDialog: (props: {
    session: SubscriptionEditorSession;
    onClose: () => void;
  }) => {
    mocks.editorProps(props);
    return (
      <div aria-label="Subscription editor test double" role="dialog">
        <span>{props.session.kind}</span>
        <button onClick={props.onClose} type="button">Close editor</button>
      </div>
    );
  }
}));

describe("SubscriptionsPage", () => {
  beforeEach(() => {
    mocks.editorProps.mockReset();
  });

  it("filters subscriptions across their displayed management fields", async () => {
    const subscriptions = [
      makeSubscription(),
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

  it("opens and clears explicit create and edit editor sessions", async () => {
    const subscription = makeSubscription();
    const { user } = renderWithUser(<SubscriptionsPage {...pageProps([subscription])} />);

    await user.click(screen.getByRole("button", { name: "Create Subscription" }));
    expect(latestSession()).toEqual({ kind: "create" });
    await user.click(screen.getByRole("button", { name: "Close editor" }));
    expect(screen.queryByRole("dialog", { name: "Subscription editor test double" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: `Edit ${subscription.title}` }));
    expect(latestSession()).toEqual({ kind: "edit", subscription });
    await user.click(screen.getByRole("button", { name: "Close editor" }));
    expect(screen.queryByRole("dialog", { name: "Subscription editor test double" })).not.toBeInTheDocument();
  });
});

function latestSession() {
  return mocks.editorProps.mock.lastCall?.[0]?.session as SubscriptionEditorSession | undefined;
}

const successfulRunAction: RunAction = async (action) => {
  await action();
  return { ok: true };
};

function pageProps(subscriptions: SubscriptionDto[]) {
  return {
    busy: false,
    downloaders: [],
    feeds: [],
    items: [],
    subscriptions,
    runAction: successfulRunAction
  };
}

function makeSubscription(overrides: Partial<SubscriptionDto> = {}): SubscriptionDto {
  return {
    id: "subscription-dune",
    title: "Dune 2160p+",
    createdByUserId: "user-owner",
    media: {
      id: "media-dune",
      provider: "tmdb",
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
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides
  };
}
