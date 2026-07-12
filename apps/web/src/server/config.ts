import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

loadDotenv();
loadDotenv({
  path: join(dirname(fileURLToPath(import.meta.url)), "../../../../.env")
});

export type AppConfig = {
  databaseUrl: string;
  appSecret: string;
  jwtSecret: string;
  tmdbApiKey?: string;
  tvdbApiKey?: string;
  tvdbPin?: string;
  apiHost: string;
  apiPort: number;
  clientOrigins: string[];
  pollIntervalSeconds: number;
  nodeEnv: string;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    databaseUrl: required(environment, "DATABASE_URL"),
    appSecret: requiredSecret(environment, "APP_SECRET", "dev-app-secret-change-me-please-32chars"),
    jwtSecret: requiredSecret(environment, "JWT_SECRET", "dev-jwt-secret-change-me-please-32chars"),
    tmdbApiKey: environment.TMDB_API_KEY || undefined,
    tvdbApiKey: environment.TVDB_API_KEY || undefined,
    tvdbPin: environment.TVDB_PIN || undefined,
    apiHost: environment.API_HOST ?? "0.0.0.0",
    apiPort: Number(environment.API_PORT ?? 4000),
    clientOrigins: (environment.CLIENT_ORIGINS ?? "http://rss.localhost:5173")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    pollIntervalSeconds: Number(environment.POLL_INTERVAL_SECONDS ?? 600),
    nodeEnv: environment.NODE_ENV ?? "development"
  };
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function requiredSecret(environment: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = environment[name];
  if (value) return value;
  if (environment.NODE_ENV === "production") {
    throw new Error(`${name} is required in production`);
  }
  return fallback;
}
