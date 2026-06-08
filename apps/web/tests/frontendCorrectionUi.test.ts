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
});
