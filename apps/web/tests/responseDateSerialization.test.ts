import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/server/config.js";

const mocks = vi.hoisted(() => ({
  prisma: {
    tenantMembership: { findMany: vi.fn() },
    tenantProviderSourceConfig: { findUnique: vi.fn() },
    tenantProviderConfig: { findUnique: vi.fn() }
  }
}));

vi.mock("../src/server/db.js", () => ({ prisma: mocks.prisma }));

const { listUserWorkspaces } = await import("../src/server/core/context.js");
const { listProviderSettings } = await import(
  "../src/server/integrations/providers/runtime.js"
);

const config = {
  databaseUrl: "postgresql://example.invalid/rss",
  appSecret: "test-app-secret-32-characters-long",
  jwtSecret: "test-jwt-secret-32-characters-long",
  apiHost: "127.0.0.1",
  apiPort: 4000,
  clientOrigins: ["http://rss.localhost:5173"],
  pollIntervalSeconds: 600,
  nodeEnv: "test"
} satisfies AppConfig;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.tenantProviderConfig.findUnique.mockResolvedValue(null);
});

describe("response-edge date serialization", () => {
  it("returns workspace dates as ISO strings", async () => {
    mocks.prisma.tenantMembership.findMany.mockResolvedValue([{
      role: "OWNER",
      tenant: {
        id: "tenant-1",
        name: "Workspace",
        createdAt: new Date("2026-08-10T12:00:00.000Z"),
        updatedAt: new Date("2026-08-10T13:00:00.000Z")
      }
    }]);

    await expect(listUserWorkspaces("user-1")).resolves.toEqual([{
      id: "tenant-1",
      name: "Workspace",
      role: "OWNER",
      createdAt: "2026-08-10T12:00:00.000Z",
      updatedAt: "2026-08-10T13:00:00.000Z"
    }]);
  });

  it("returns provider status dates as ISO strings", async () => {
    mocks.prisma.tenantProviderSourceConfig.findUnique.mockResolvedValue({
      enabled: true,
      encryptedSecretsJson: null,
      configuredAt: new Date("2026-08-10T12:00:00.000Z"),
      lastValidatedAt: new Date("2026-08-10T13:00:00.000Z"),
      lastError: null,
      metadataLanguage: null,
      region: null,
      baseUrl: null
    });

    const response = await listProviderSettings(config, "tenant-1");

    expect(response.providers[0]?.configuredAt).toBe("2026-08-10T12:00:00.000Z");
    expect(response.providers[0]?.lastValidatedAt).toBe("2026-08-10T13:00:00.000Z");
  });
});
