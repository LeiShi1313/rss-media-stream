import { describe, expect, it } from "vitest";
import {
  buildSeedUserUpsertArgs,
  loadSeedConfig
} from "../prisma/seedConfig.js";

const validEnvironment = {
  NODE_ENV: "development",
  APP_SECRET: "test-app-secret-32-characters-long",
  SEED_USER_EMAIL: "admin@example.com",
  SEED_USER_PASSWORD: "a-secure-development-password"
};

describe("seed configuration", () => {
  it("refuses to seed a production database", () => {
    expect(() => loadSeedConfig({ ...validEnvironment, NODE_ENV: "production" }))
      .toThrow("Database seeding is disabled in production");
  });

  it("requires development mode to be explicit", () => {
    expect(() => loadSeedConfig({ ...validEnvironment, NODE_ENV: undefined }))
      .toThrow("Database seeding requires NODE_ENV=development");
  });

  it("requires explicit credentials and an encryption secret", () => {
    expect(() => loadSeedConfig({
      ...validEnvironment,
      SEED_USER_EMAIL: undefined
    })).toThrow("SEED_USER_EMAIL is required");

    expect(() => loadSeedConfig({
      ...validEnvironment,
      SEED_USER_PASSWORD: undefined
    })).toThrow("SEED_USER_PASSWORD is required");

    expect(() => loadSeedConfig({
      ...validEnvironment,
      APP_SECRET: undefined
    })).toThrow("APP_SECRET is required");
  });

  it("rejects seed passwords that the setup flow would reject", () => {
    expect(() => loadSeedConfig({
      ...validEnvironment,
      SEED_USER_PASSWORD: "too-short"
    })).toThrow("SEED_USER_PASSWORD must contain at least 10 characters");
  });

  it("creates missing users without changing existing accounts", () => {
    const config = loadSeedConfig({
      ...validEnvironment,
      SEED_USER_EMAIL: "  Admin@Example.COM ",
      SEED_USER_NAME: "  Local Administrator  ",
      SEED_WORKSPACE_NAME: "  Local Media  "
    });

    expect(config).toEqual({
      email: "admin@example.com",
      password: validEnvironment.SEED_USER_PASSWORD,
      name: "Local Administrator",
      workspaceName: "Local Media",
      appSecret: validEnvironment.APP_SECRET
    });
    expect(buildSeedUserUpsertArgs(config, "hashed-password")).toEqual({
      where: { email: "admin@example.com" },
      create: {
        email: "admin@example.com",
        name: "Local Administrator",
        passwordHash: "hashed-password"
      },
      update: {},
      select: { id: true }
    });
  });
});
