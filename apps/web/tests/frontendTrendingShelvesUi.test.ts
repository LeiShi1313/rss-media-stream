import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("trending media shelves UI", () => {
  it("keeps trending pagination state local to the overview page", () => {
    const appSource = readFileSync(resolve(__dirname, "../src/client/App.tsx"), "utf8");
    const overviewSource = readFileSync(resolve(__dirname, "../src/client/pages/overview.tsx"), "utf8");

    expect(appSource).not.toContain("trendingMedia");
    expect(appSource).not.toContain("/api/media-titles/trending");
    expect(overviewSource).toContain('useTrendingMediaShelf("MOVIE")');
    expect(overviewSource).toContain('useTrendingMediaShelf("TV_SERIES")');
  });

  it("renders separate movie and TV trending shelves", () => {
    const source = readFileSync(resolve(__dirname, "../src/client/pages/overview.tsx"), "utf8");

    expect(source).toContain('title={t("overview.shelves.trendingMovies")}');
    expect(source).toContain('title={t("overview.shelves.trendingTv")}');
    expect(source).toContain('root: railRef.current');
  });
});
