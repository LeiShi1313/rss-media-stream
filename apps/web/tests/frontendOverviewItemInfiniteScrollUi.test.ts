import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("overview item infinite scroll UI", () => {
  it("keeps item pagination local to the overview page", () => {
    const appSource = readFileSync(resolve(__dirname, "../src/client/App.tsx"), "utf8");
    const overviewSource = readFileSync(resolve(__dirname, "../src/client/pages/overview.tsx"), "utf8");

    expect(appSource).toContain("api<ItemPageDto>(\"/api/items?limit=120\")");
    expect(overviewSource).toContain("useItemShelf({");
    expect(overviewSource).toContain("api<ItemPageDto>(`/api/items?");
  });

  it("uses sentinels for both newly added and filtered release loading", () => {
    const source = readFileSync(resolve(__dirname, "../src/client/pages/overview.tsx"), "utf8");

    expect(source).toContain("newlyAddedShelf.sentinelRef");
    expect(source).toContain("filteredShelf.sentinelRef");
    expect(source).toContain('root: railRef.current');
  });
});
