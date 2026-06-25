import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Downloader management UI", () => {
  it("uses a flat searchable endpoint table instead of charts or row cards", () => {
    const source = readFileSync(resolve(__dirname, "../src/client/pages/downloaders.tsx"), "utf8");

    expect(source).toContain('className="management-command"');
    expect(source).toContain('className="management-table"');
    expect(source).toContain('className="management-table-row downloader-table-row"');
    expect(source).toContain("setQuery(event.target.value)");
    expect(source).toContain("downloader.baseUrl");
    expect(source).toContain("...(downloader.tags ?? [])");
    expect(source).not.toContain("DistributionBars");
    expect(source).not.toContain("EndpointStatusGrid");
    expect(source).not.toContain("<Panel");
    expect(source).not.toContain("row-card downloader-card");
    expect(source).not.toContain("StatusPill");
    expect(source).not.toContain("<Pill");
  });

  it("preserves downloader actions in the flat action column", () => {
    const source = readFileSync(resolve(__dirname, "../src/client/pages/downloaders.tsx"), "utf8");

    expect(source).toContain('aria-label={t("downloaders.editDownloaderNamed", { name: downloader.name })}');
    expect(source).toContain('api("/api/downloaders/default"');
    expect(source).toContain('api(`/api/downloaders/${downloader.id}/test`, { method: "POST" })');
    expect(source).toContain('onClick={() => setDownloaderModal("new")}');
  });

  it("defines reusable management table styles and downloader columns", () => {
    const source = readFileSync(resolve(__dirname, "../src/client/styles/app.css"), "utf8");

    expect(source).toContain(".management-command");
    expect(source).toContain(".management-table-head,");
    expect(source).toContain(".management-table-row");
    expect(source).toContain(".downloader-table-head,");
    expect(source).toContain(".downloader-table-row");
  });
});
