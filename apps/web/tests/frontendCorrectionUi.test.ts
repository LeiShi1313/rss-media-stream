import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("correction search result UI", () => {
  it("renders provider external URLs as a non-selecting action", () => {
    const source = readFileSync(
      resolve(__dirname, "../src/client/pages/overview.tsx"),
      "utf8"
    );

    expect(source).toContain("result.externalUrl &&");
    expect(source).toContain('href={result.externalUrl}');
    expect(source).toContain("event.stopPropagation()");
    expect(source).toContain("<ExternalLink size={16} />");
  });

  it("renders PTGen candidates with source labels instead of only backend labels", () => {
    const source = readFileSync(
      resolve(__dirname, "../src/client/pages/overview.tsx"),
      "utf8"
    );

    expect(source).toContain("searchResultSourceLabel(result)");
    expect(source).toContain("via PTGen");
    expect(source).toContain("ptgen_douban");
    expect(source).toContain("Douban");
    expect(source).toContain("ptgen_imdb");
    expect(source).toContain("IMDb");
  });

  it("lets correction search narrow results to one provider", () => {
    const source = readFileSync(
      resolve(__dirname, "../src/client/pages/overview.tsx"),
      "utf8"
    );

    expect(source).toContain("titleSearchProvider");
    expect(source).toContain('className="title-search-options-row"');
    expect(source).toContain('label: t("common.anyProvider")');
    expect(source).toContain('{ value: "tmdb", label: "TMDB" }');
    expect(source).toContain('{ value: "tvdb", label: "TVDB" }');
    expect(source).toContain('{ value: "ptgen", label: "PTGen" }');
    expect(source).toContain("provider: titleSearchProvider || undefined");
  });

  it("uses translated common labels in advanced match details", () => {
    const source = readFileSync(
      resolve(__dirname, "../src/client/pages/overview.tsx"),
      "utf8"
    );

    expect(source).toContain('label={t("common.reason")}');
    expect(source).not.toContain("overview.inspector.reason");
  });
});
