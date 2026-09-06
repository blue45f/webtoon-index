import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const studioPageSource = readStudioCuttoonEditorSource();
const modalBoundariesSource = readFileSync(
  new URL("./studio-page-modal-lazy-boundaries.ts", import.meta.url),
  "utf8",
);
const integrationSource = readFileSync(
  new URL("./studio-quick-access-integration.ts", import.meta.url),
  "utf8",
);
const mainMenuCatalogueSource = readFileSync(
  new URL("./studio-main-menu-items-workspace.ts", import.meta.url),
  "utf8",
);

describe("Studio Quick Access live boundary", () => {
  it("keeps optional UI and persistence code behind the explicit user intent boundary", () => {
    expect(studioPageSource).toContain(
      'import("./studio-quick-access-integration")',
    );
    expect(modalBoundariesSource).toContain(
      'import("./StudioQuickAccessSurface")',
    );
    expect(studioPageSource).not.toMatch(
      /^import\s+\{[^}]*loadStudioQuickAccessState[^}]*\}\s+from\s+"\.\/studio-quick-access-integration";/mu,
    );
    expect(studioPageSource).toContain("quickAccessPaletteOpen && quickAccessState");
  });

  it("exposes one CLIP-familiar menu/shortcut entry and reuses trusted editor actions", () => {
    expect(mainMenuCatalogueSource.match(/id: "quick-access-palette"/gu)).toHaveLength(1);
    expect(mainMenuCatalogueSource).toContain('shortcut: "⇧Q"');
    expect(mainMenuCatalogueSource).toContain("onSelect: ui.toggleQuickAccessPalette");
    expect(studioPageSource).not.toContain('id: "quick-access-palette"');
    expect(studioPageSource).toContain(
      "toggleQuickAccessPalette: studioMainMenuActions.toggleStudioQuickAccessPalette",
    );
    expect(studioPageSource).toContain('e.code === "KeyQ"');
    expect(studioPageSource).toContain(
      "resolveStudioQuickAccessExecutionIntent(commandId)",
    );
    expect(studioPageSource).toContain("executeQuickAction(intent.action)");
    expect(studioPageSource).toContain('handleSave("draft")');
    expect(studioPageSource).toContain("openPixelSelectionTransform()");
  });

  it("persists only the bounded owner-scoped local model without a network path", () => {
    expect(integrationSource).toContain("encodeStudioQuickAccessState(state)");
    expect(integrationSource).toContain("VALID_OWNER_SCOPE");
    expect(integrationSource).toContain('authority: "sqlite-opfs" as const');
    expect(integrationSource).toContain("await store.set(ownerScope, encoded)");
    expect(integrationSource).toContain("await store.get(ownerScope) !== encoded");
    expect(integrationSource).not.toMatch(/\b(?:localStorage|sessionStorage)\s*\./u);
    expect(integrationSource).not.toMatch(/\bfetch\s*\(/u);
    expect(integrationSource).not.toMatch(/\bWebSocket\b/u);
  });
});
