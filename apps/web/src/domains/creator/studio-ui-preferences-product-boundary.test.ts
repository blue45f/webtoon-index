import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { readStudioCanvasViewportStack } from "./canvas/read-studio-canvas-viewport-stack";

const PRODUCT_PREFERENCE_CONSUMERS = [
  "StudioBackgroundPanel.tsx",
  "filter/StudioFilterDialog.tsx",
  "StudioElementsPanel.tsx",
  "StudioPageListPane.tsx",
] as const;

describe("Studio product UI preference authority", () => {
  it.each(PRODUCT_PREFERENCE_CONSUMERS)(
    "%s selects the SQLite/OPFS repository and has no browser Storage fallback",
    (filename) => {
      const source = readFileSync(resolve(process.cwd(), "apps/web/src/domains/creator", filename), "utf8");
      expect(source).toContain("acquireProductStudioUiPreferencesRepository");
      expect(source).toContain("data-studio-ui-preferences-authority");
      expect(source).toContain("memory-only");
      expect(source).not.toMatch(/\b(?:localStorage|sessionStorage)\b/u);
    },
  );

  it("hydrates page-owned UI preferences from SQLite/OPFS with late-load fences", () => {
    // Preferences hydration moved into its runtime hook when the routes were layered; the
    // boundary is unchanged, so read the host together with that hook.
    const page = [
      "apps/web/src/domains/creator/StudioCuttoonEditorHost.tsx",
      "apps/web/src/domains/creator/studio-cuttoon-editor/runtime/useStudioPreferencesRuntime.ts",
    ]
      .map((relativePath) => readFileSync(resolve(process.cwd(), relativePath), "utf8"))
      .join("\n");
    const viewport = readStudioCanvasViewportStack(import.meta.url, "./canvas/");

    expect(page).toContain("acquireProductStudioUiPreferencesRepository");
    expect(page).toContain("repository.loadAppSettings()");
    expect(page).toContain("repository.loadEffectFavorites()");
    expect(page).toContain("repository.loadAdvancedFillSettings()");
    expect(page).toContain("repository.loadAssetFavorites(studioAuthUserId)");
    // Intentional change (B-08 extraction): boolean-preference hydration moved, revision
    // fence intact, into studio-page-workspace-persistence.ts beside the page.
    const workspacePersistence = readFileSync(
      resolve(
        process.cwd(),
        "apps/web/src/domains/creator/studio-page-workspace-persistence.ts",
      ),
      "utf8",
    );
    expect(workspacePersistence).toContain(
      'repository.loadBooleanPreference("ai-notice-acknowledged")',
    );
    expect(page).toContain("repository.loadRecentColors()");
    expect(page).toContain("repository.loadServerAiProvider()");
    expect(page).toContain("appSettingsUserRevisionRef.current === settingsRevisionAtStart");
    expect(page).toContain("advancedFillUserRevisionRef.current === revisionAtStart");
    expect(page).toContain("assetFavoriteUserRevisionRef.current === 0");
    expect(page).toContain("serverAiProviderUserRevisionRef.current === revisionAtStart");
    expect(page).toContain("uiBooleanPreferencesReady");
    expect(page).not.toContain("loadStudioAppSettings(");
    expect(page).not.toContain("saveStudioAppSettings(");
    expect(page).not.toContain("studioAppSettingsStorage(");
    expect(page).not.toContain("loadStudioUiDensityState(");
    expect(page).not.toContain("saveStudioUiDensityState(");
    expect(page).not.toContain("loadStudioAdvancedFillSettings(");
    expect(page).not.toContain("saveStudioAdvancedFillSettings(");
    expect(page).not.toContain("studioAdvancedFillStorage(");
    expect(page).not.toContain('"toonspectrum-studio-server-ai-provider"');
    expect(viewport).toContain("commitAppSettings(defaultStudioAppSettings())");
    expect(viewport).not.toContain("studioAppSettingsStorage(");
  });
});
