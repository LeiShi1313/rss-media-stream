import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(__dirname, "../../..");

describe("operational database safety", () => {
  it("starts the production application without changing the database schema", () => {
    const dockerfile = readFileSync(resolve(repositoryRoot, "Dockerfile"), "utf8");
    const productionStage = dockerfile.slice(dockerfile.indexOf(" AS app"));

    expect(productionStage).not.toMatch(/prisma:(?:push|reset)|prisma db push|accept-data-loss|force-reset/);
    expect(productionStage).toContain('CMD ["npm", "start"]');
  });

  it("keeps local data and nested worktrees out of Git and Docker contexts", () => {
    const gitPatterns = ignorePatterns(".gitignore");
    const dockerPatterns = ignorePatterns(".dockerignore");

    expect(gitPatterns).toEqual(expect.arrayContaining([".local", ".worktrees", "backups"]));
    expect(dockerPatterns).toEqual(
      expect.arrayContaining([".local", ".superpowers", ".worktrees", "backups"])
    );
  });

  it("provides a non-destructive migration deployment path", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(repositoryRoot, "package.json"), "utf8")
    ) as { scripts?: Record<string, string> };
    const migrationsDirectory = resolve(repositoryRoot, "apps/web/prisma/migrations");

    expect(packageJson.scripts?.["prisma:migrate:deploy"]).toBe(
      "prisma migrate deploy --schema apps/web/prisma/schema.prisma"
    );
    expect(existsSync(migrationsDirectory)).toBe(true);
    if (!existsSync(migrationsDirectory)) return;

    const migrationSql = readdirSync(migrationsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => resolve(migrationsDirectory, entry.name, "migration.sql"))
      .filter(existsSync)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(migrationSql).toContain('CREATE TABLE "RssFeed"');
    expect(migrationSql).toContain('CREATE TABLE "RssItem"');
    expect(migrationSql).not.toMatch(/\b(?:DROP|TRUNCATE)\b/i);
  });
});

function ignorePatterns(filename: string) {
  return readFileSync(resolve(repositoryRoot, filename), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.replace(/^\//, "").replace(/\/$/, ""));
}
