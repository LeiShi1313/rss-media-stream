import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("overview item infinite scroll UI", () => {
  it("loads overview items in App and forwards the collection to OverviewPage", () => {
    const appSource = readFileSync(resolve(__dirname, "../src/client/App.tsx"), "utf8");
    const overviewCall = appSource.slice(
      appSource.indexOf("<OverviewPage"),
      appSource.indexOf("{page === \"rss\"")
    );

    expect(appSource).toContain('api<ItemPageDto>("/api/items?');
    expect(overviewCall).toContain("items={items}");
  });
});
