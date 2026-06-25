import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("RSS management UI", () => {
  it("uses a flat searchable feed table instead of chart panels or row cards", () => {
    const source = readFileSync(resolve(__dirname, "../src/client/pages/rss.tsx"), "utf8");

    expect(source).toContain('className="rss-feed-command"');
    expect(source).toContain('className="rss-feed-table"');
    expect(source).toContain('feed.lastError ? "rss-feed-row error" : "rss-feed-row"');
    expect(source).toContain("setQuery(event.target.value)");
    expect(source).toContain("[feed.name, feed.urlPreview]");
    expect(source).not.toContain("DistributionBars");
    expect(source).not.toContain("<Panel");
    expect(source).not.toContain("row-card feed-card");
    expect(source).not.toContain("StatusPill");
  });

  it("does not render feed status as a table column, badge, or filter", () => {
    const source = readFileSync(resolve(__dirname, "../src/client/pages/rss.tsx"), "utf8");
    const tableSource = source.split("function FeedModalForm")[0];

    expect(tableSource).not.toContain('t("common.status")');
    expect(tableSource).not.toContain('t("common.enabled")');
    expect(tableSource).not.toContain('t("common.disabled")');
    expect(tableSource).not.toContain('t("rss.enabled")');
    expect(tableSource).not.toContain('t("rss.disabled")');
    expect(tableSource).not.toContain("status-pill");
  });

  it("keeps inline feed errors and accessible icon actions", () => {
    const source = readFileSync(resolve(__dirname, "../src/client/pages/rss.tsx"), "utf8");

    expect(source).toContain("feed.lastError");
    expect(source).toContain('className="rss-feed-error"');
    expect(source).toContain('aria-label={t("rss.refreshFeedNamed", { name: feed.name })}');
    expect(source).toContain('aria-label={t("rss.editFeedNamed", { name: feed.name })}');
    expect(source).toContain('aria-label={t("rss.deleteFeedNamed", { name: feed.name })}');
  });

  it("defines page-specific flat table styles", () => {
    const source = readFileSync(resolve(__dirname, "../src/client/styles/app.css"), "utf8");

    expect(source).toContain(".rss-feed-command");
    expect(source).toContain(".rss-feed-table-head,");
    expect(source).toContain(".rss-feed-row {");
    expect(source).toContain(".rss-feed-row.error");
  });
});
