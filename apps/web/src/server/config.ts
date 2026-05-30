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
  apiHost: string;
  apiPort: number;
  clientOrigin: string;
  pollIntervalSeconds: number;
  nodeEnv: string;
};

export function loadConfig(): AppConfig {
  return {
    databaseUrl: required("DATABASE_URL"),
    appSecret: requiredSecret("APP_SECRET", "dev-app-secret-change-me-please-32chars"),
    jwtSecret: requiredSecret("JWT_SECRET", "dev-jwt-secret-change-me-please-32chars"),
    tmdbApiKey: process.env.TMDB_API_KEY || undefined,
    apiHost: process.env.API_HOST ?? "0.0.0.0",
    apiPort: Number(process.env.API_PORT ?? 4000),
    clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
    pollIntervalSeconds: Number(process.env.POLL_INTERVAL_SECONDS ?? 300),
    nodeEnv: process.env.NODE_ENV ?? "development"
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function requiredSecret(name: string, fallback: string): string {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`${name} is required in production`);
  }
  return fallback;
}
