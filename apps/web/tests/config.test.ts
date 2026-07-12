import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/server/config.js";

const validEnvironment = {
  DATABASE_URL: "postgresql://rss:media@localhost:5432/rss_media",
  APP_SECRET: "test-app-secret-32-characters-long",
  JWT_SECRET: "test-jwt-secret-32-characters-long"
};

describe("application configuration", () => {
  it("loads each configured client origin", () => {
    const config = loadConfig({
      ...validEnvironment,
      CLIENT_ORIGINS: "http://rss.localhost:18084, https://rsszug.leishi.xyz"
    });

    expect(config.clientOrigins).toEqual([
      "http://rss.localhost:18084",
      "https://rsszug.leishi.xyz"
    ]);
  });
});
