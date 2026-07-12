import { describe, expect, it, vi } from "vitest";
import { ProviderSearchSession } from "../src/server/integrations/providers/searchSession.js";

describe("ProviderSearchSession", () => {
  it("shares an identical in-flight provider request", async () => {
    const operation = vi.fn(async () => [{ providerId: "603" }]) as any;
    const session = new ProviderSearchSession(operation);
    const runtime = { tenantId: "tenant-1", providerSource: "tmdb_api" } as any;
    const input = {
      title: "The Matrix",
      mediaType: "MOVIE",
      year: 1999
    } as const;

    const [matchingResults, ratingResults] = await Promise.all([
      session.search("tmdb_api", runtime, input),
      session.search("tmdb_api", runtime, input)
    ]);

    expect(matchingResults).toEqual([{ providerId: "603" }]);
    expect(ratingResults).toBe(matchingResults);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
