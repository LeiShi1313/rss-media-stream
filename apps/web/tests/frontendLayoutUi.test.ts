import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("dashboard layout UI", () => {
  it("keeps navigation and account controls in a focused accessible sidebar component", () => {
    const appSource = readFileSync(
      resolve(__dirname, "../src/client/App.tsx"),
      "utf8"
    );
    const sidebarSource = readFileSync(
      resolve(__dirname, "../src/client/components/layout/app-sidebar.tsx"),
      "utf8"
    );
    const overlaySource = readFileSync(
      resolve(__dirname, "../src/client/components/ui/overlays.tsx"),
      "utf8"
    );

    expect(appSource).toContain("<AppSidebar");
    expect(appSource).toContain("<h1>{pageCopy.title}</h1>");
    expect(appSource).toContain('title: t(`page.${page}.title`)');
    expect(appSource).toContain('summary: t(`page.${page}.summary`)');
    expect(appSource).toContain("changeUiLanguage(value)");
    expect(appSource).toContain('api<WorkspaceSettingsDto>("/api/settings"');
    expect(sidebarSource).toContain('className="app-sidebar"');
    expect(sidebarSource).toContain('className="app-sidebar-nav"');
    expect(sidebarSource).not.toContain("<h1>");
    expect(sidebarSource).toContain('aria-current={active ? "page" : undefined}');
    expect(sidebarSource).toContain("<IconSelectMenu");
    expect(sidebarSource).toContain('className="ghost app-sidebar-signout"');
    expect(sidebarSource).not.toContain("document.addEventListener");
    expect(overlaySource).toContain("DropdownMenuPrimitive.RadioGroup");
    expect(overlaySource).toContain("DropdownMenuPrimitive.RadioItem");
  });

  it("keeps the shell layout in one stylesheet with sticky-compatible root overflow", () => {
    const mainSource = readFileSync(
      resolve(__dirname, "../src/client/main.tsx"),
      "utf8"
    );
    const appStyles = readFileSync(
      resolve(__dirname, "../src/client/styles/app.css"),
      "utf8"
    );
    const shellStyles = readFileSync(
      resolve(__dirname, "../src/client/styles/shell.css"),
      "utf8"
    );

    expect(mainSource.indexOf('import "./styles/app.css"')).toBeLessThan(
      mainSource.indexOf('import "./styles/shell.css"')
    );
    expect(appStyles).toContain("overflow-x: clip");
    expect(appStyles).not.toMatch(/\.sidebar(?:\s|\{|:)/);
    expect(shellStyles).toContain(".app-sidebar {");
    expect(shellStyles).toContain("position: sticky");
    expect(shellStyles).toContain("height: 100dvh");
    expect(shellStyles).not.toContain("position: static");
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
