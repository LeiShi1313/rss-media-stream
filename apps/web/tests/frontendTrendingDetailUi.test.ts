import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("trending media detail UI", () => {
  it("shows TV episode chips and hides raw titles in per-release disclosures", () => {
    const source = readFileSync(
      resolve(__dirname, "../src/client/pages/overview.tsx"),
      "utf8"
    );

    expect(source).toContain("releaseEpisodeLabel(release)");
    expect(source).toContain('className="media-release-origin"');
    expect(source).toContain('t("overview.inspector.originalRssTitle")');
    expect(source).toContain("{release.rawTitle}");
  });

  it("does not render match status badges in grouped trending release rows", () => {
    const source = readFileSync(
      resolve(__dirname, "../src/client/pages/overview.tsx"),
      "utf8"
    );
    const modalBody = source.slice(
      source.indexOf("function MediaInspectorModal"),
      source.indexOf("function DetailGroup")
    );

    expect(modalBody).toContain("media-release-row");
    expect(modalBody).not.toContain("StatusPill");
    expect(modalBody).not.toContain("releaseStatus(release)");
  });
});
