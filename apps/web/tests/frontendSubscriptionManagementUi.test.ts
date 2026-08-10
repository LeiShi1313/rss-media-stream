import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Subscription management UI", () => {
  it("uses a flat searchable subscription table instead of row cards", () => {
    const source = readFileSync(resolve(__dirname, "../src/client/pages/subscriptions.tsx"), "utf8");

    expect(source).toContain('className="management-command"');
    expect(source).toContain('className="management-table"');
    expect(source).toContain('className="management-table-row subscription-table-row"');
    expect(source).toContain("setQuery(event.target.value)");
    expect(source).toContain("subscriptionTarget(subscription, t)");
    expect(source).toContain("subscriptionMode(subscription, t)");
    expect(source).not.toContain("<Panel");
    expect(source).not.toContain("row-card subscription-card");
    expect(source).not.toContain("StatusPill");
    expect(source).not.toContain("<Pill");
  });

  it("keeps editor workflow behind the subscription editor dialog boundary", () => {
    const source = readFileSync(resolve(__dirname, "../src/client/pages/subscriptions.tsx"), "utf8");

    expect(source).toContain("components/subscriptions/subscription-editor-dialog.js");
    expect(source).toContain("useState<SubscriptionEditorSession | null>(null)");
    expect(source).toContain("<SubscriptionEditorDialog");
    expect(source).toContain('setEditorSession({ kind: "create" })');
    expect(source).toContain('setEditorSession({ kind: "edit", subscription })');
    expect(source).not.toContain('from "../api.js"');
    expect(source).not.toContain("/api/");
  });

  it("defines subscription table columns using the shared management styles", () => {
    const source = readFileSync(resolve(__dirname, "../src/client/styles/app.css"), "utf8");

    expect(source).toContain(".management-table-head,");
    expect(source).toContain(".management-table-row");
    expect(source).toContain(".subscription-table-head,");
    expect(source).toContain(".subscription-table-row");
    expect(source).toContain(".menu-content.subscription-multi-menu");
    expect(source).toContain("overflow-y: auto");
  });

});
