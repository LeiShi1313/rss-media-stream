import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Subscription management UI", () => {
  it("uses a flat searchable subscription table instead of row cards", () => {
    const source = readFileSync(resolve(__dirname, "../src/client/pages/subscriptions.tsx"), "utf8");
    const listSource = source.split("function SubscriptionEditorModal")[0];

    expect(listSource).toContain('className="management-command"');
    expect(listSource).toContain('className="management-table"');
    expect(listSource).toContain('className="management-table-row subscription-table-row"');
    expect(listSource).toContain("setQuery(event.target.value)");
    expect(listSource).toContain("subscriptionTarget(subscription, t)");
    expect(listSource).toContain("subscriptionMode(subscription, t)");
    expect(listSource).not.toContain("<Panel");
    expect(listSource).not.toContain("row-card subscription-card");
    expect(listSource).not.toContain("StatusPill");
    expect(listSource).not.toContain("<Pill");
  });

  it("preserves create and edit actions in the flat management surface", () => {
    const source = readFileSync(resolve(__dirname, "../src/client/pages/subscriptions.tsx"), "utf8");
    const listSource = source.split("function SubscriptionEditorModal")[0];

    expect(listSource).toContain("setCreateOpen(true)");
    expect(listSource).toContain("<SubscriptionEditorModal");
    expect(listSource).toContain("releaseGroupOptions={releaseGroupOptions}");
    expect(listSource).toContain('aria-label={t("subscriptions.editSubscriptionNamed", { name: subscription.title })}');
    expect(listSource).toContain("setEditingSubscription(subscription)");
  });

  it("defines subscription table columns using the shared management styles", () => {
    const source = readFileSync(resolve(__dirname, "../src/client/styles/app.css"), "utf8");

    expect(source).toContain(".management-table-head,");
    expect(source).toContain(".management-table-row");
    expect(source).toContain(".subscription-table-head,");
    expect(source).toContain(".subscription-table-row");
  });

  it("exposes Sonarr-style rule controls without nested cards", () => {
    const source = readFileSync(resolve(__dirname, "../src/client/pages/subscriptions.tsx"), "utf8");

    expect(source).toContain("RuleModeChooser");
    expect(source).toContain("feedIds");
    expect(source).toContain("preferredReleaseGroups");
    expect(source).toContain("upgradePolicy");
    expect(source).toContain("allowCrossSeed");
    expect(source).toContain("seasonPackAllowed");
    expect(source).toContain("subscription-multi-menu");
    expect(source).toContain("ReleaseGroupInput");
    expect(source).toContain("item.parsedRelease?.releaseGroup");
    expect(source).not.toContain("disabled={options.length === 0}");
    expect(source).not.toContain("subscription-rule-card");
  });

  it("searches provider media before showing media-title rule controls", () => {
    const source = readFileSync(resolve(__dirname, "../src/client/pages/subscriptions.tsx"), "utf8");

    expect(source).toContain("/api/provider-titles/search?");
    expect(source).toContain("/api/provider-titles/resolve");
    expect(source).toContain("mediaTitleId: selectedMedia.mediaTitleId");
    expect(source).toContain("subscription-result-list");
    expect(source).toContain("subscription-selected-media");
  });
});
