import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("dashboard layout UI", () => {
  it("keeps account controls and the language switcher in the sidebar footer", () => {
    const source = readFileSync(
      resolve(__dirname, "../src/client/App.tsx"),
      "utf8"
    );

    expect(source).toContain('className="sidebar-footer"');
    expect(source).toContain("LanguageIconSelect");
    expect(source).toContain('className="icon-button sidebar-language-trigger"');
    expect(source).toContain('className="sidebar-language-content"');
    expect(source).toContain('className="sidebar-language-option"');
    expect(source).toContain("changeUiLanguage(value)");
    expect(source).toContain('api<WorkspaceSettings>("/api/settings"');
    expect(source).toContain('className="sidebar-account-row"');
    expect(source).toContain('className="sidebar-email"');
    expect(source).toContain("{user.email}");
    expect(source).not.toContain("sidebar-language-select");
    expect(source).not.toContain("<strong>{user.name}</strong>");
    expect(source).toContain('className="ghost sidebar-signout"');
  });

  it("removes web language settings from the settings page", () => {
    const source = readFileSync(
      resolve(__dirname, "../src/client/pages/settings.tsx"),
      "utf8"
    );

    expect(source).not.toContain("saveWorkspaceSettings");
    expect(source).not.toContain("settings.workspaceLanguage");
    expect(source).not.toContain("settings.webLanguage");
    expect(source).not.toContain("settings.languageBehavior");
    expect(source).toContain("settings.providerCredentials");
    expect(source).toContain("settings.metadataLanguage");
  });
});
