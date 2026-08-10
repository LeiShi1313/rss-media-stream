import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const prisma = {
    $transaction: vi.fn(async (callback: any) => callback(prisma)),
    $executeRaw: vi.fn(async () => 0),
    parsedReleaseMatch: {
      updateMany: vi.fn()
    }
  };
  return { prisma };
});

vi.mock("../src/server/db.js", () => ({ prisma: mocks.prisma }));

const { invalidateMatchesForParsedRelease } = await import(
  "../src/server/modules/media/releaseMatchLedger.js"
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.parsedReleaseMatch.updateMany.mockResolvedValue({ count: 2 });
});

describe("invalidateMatchesForParsedRelease", () => {
  it("locks the tenant release key before invalidating active decisions", async () => {
    await expect(invalidateMatchesForParsedRelease({
      tenantId: "tenant-1",
      parsedReleaseId: "release-1",
      staleReason: "parsed_release_changed"
    })).resolves.toEqual({ count: 2 });

    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.$executeRaw.mock.calls.map((call) => call[1]))
      .toContain("parsed-release-match:tenant-1:release-1");
    expect(mocks.prisma.parsedReleaseMatch.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-1",
        parsedReleaseId: "release-1",
        invalidatedAt: null,
        status: { in: ["MATCHED", "UNMATCHED"] }
      },
      data: {
        invalidatedAt: expect.any(Date),
        staleReason: "parsed_release_changed"
      }
    });
    expect(mocks.prisma.$executeRaw.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.prisma.parsedReleaseMatch.updateMany.mock.invocationCallOrder[0]);
  });
});
