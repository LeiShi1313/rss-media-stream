import { describe, expect, it } from "vitest";
import { parsePtRssImportArgs } from "../src/server/modules/imports/ptRssImport.runner.js";

describe("parsePtRssImportArgs", () => {
  it("parses dry-run options with conservative defaults", () => {
    expect(parsePtRssImportArgs([
      "--tenant-id", "tenant-1",
      "--feed-id", "feed-1",
      "--mongo-uri", "mongodb://localhost:27017",
      "--site", "chdbits.co",
      "--start-after-id", "160093",
      "--limit", "25"
    ])).toEqual({
      tenantId: "tenant-1",
      feedId: "feed-1",
      mongoUri: "mongodb://localhost:27017",
      mongoDb: "pt",
      site: "chdbits.co",
      startAfterId: "160093",
      limit: 25,
      batchSize: 500,
      providerLimit: 100,
      write: false,
      resolveProviders: false
    });
  });

  it("requires write mode before provider metadata resolution", () => {
    expect(() => parsePtRssImportArgs([
      "--tenant-id", "tenant-1",
      "--feed-id", "feed-1",
      "--mongo-uri", "mongodb://localhost:27017",
      "--resolve-providers"
    ])).toThrow("--resolve-providers requires --write");
  });

  it("requires a site when resuming after an id", () => {
    expect(() => parsePtRssImportArgs([
      "--tenant-id", "tenant-1",
      "--feed-id", "feed-1",
      "--mongo-uri", "mongodb://localhost:27017",
      "--start-after-id", "999"
    ])).toThrow("--start-after-id requires --site");
  });
});
