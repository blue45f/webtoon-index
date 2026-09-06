import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(name: string): string {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

describe("sensitive Studio browser state stays session-scoped", () => {
  it("keeps Unsplash credentials in sessionStorage and discards the legacy persistent key", () => {
    const panel = source("./StudioIntegrationsSettingsPanel.tsx");
    const consumer = source("./StudioStockImagePanel.tsx");
    expect(panel).toContain('browserStorage("sessionStorage")');
    expect(panel).toContain(
      'discardLegacyStudioStockImageAccessKey(browserStorage("localStorage"))',
    );
    expect(panel).not.toContain(
      'saveStudioStockImageAccessKey(browserStorage("localStorage")',
    );
    expect(consumer).toContain(
      "loadStudioStockImageAccessKey(globalThis.sessionStorage)",
    );
    expect(consumer).not.toContain(
      "loadStudioStockImageAccessKey(globalThis.localStorage)",
    );
  });

  it("keeps recent AI prompts in the current tab and never imports the old durable value", () => {
    const page = source("./StudioCuttoonEditorHost.tsx");
    const toolPopover = source("./ai/StudioAiToolPopoverBody.tsx");
    expect(page).toContain(
      "loadStudioAiRecentPrompts(globalThis.sessionStorage)",
    );
    expect(page).toContain(
      "pushStudioAiRecentPrompt(globalThis.sessionStorage",
    );
    expect(page).toContain(
      "globalThis.localStorage.removeItem(STUDIO_AI_RECENT_PROMPTS_KEY)",
    );
    expect(page).not.toContain(
      "loadStudioAiRecentPrompts(globalThis.localStorage)",
    );
    expect(toolPopover.match(/pushStudioAiRecentPrompt\(globalThis\.sessionStorage/gu))
      // 6: the four original sites plus applyEpisodeBatchPrompt and applySuperSuitePrompt.
      .toHaveLength(6);
    expect(toolPopover).not.toContain(
      "pushStudioAiRecentPrompt(globalThis.localStorage",
    );
  });

  it("keeps fallback pose clipboards in sessionStorage and removes legacy copies", () => {
    const poser = [
      source("./vrm/useStudioVrmPoserState.ts"),
      source("./vrm/useStudioVrmPoserPoseLibrary.ts"),
      source("./vrm/useStudioVrmPoserPoseEdit.ts"),
      source("./vrm/StudioVrmPoserDialog.tsx"),
      source("./vrm/StudioVrmPoserPanelBodyD.tsx"),
    ].join("\n");
    for (const key of ["studio_pose_clipboard", "studio_vrm_full_clip"]) {
      expect(poser).toContain(`sessionStorage.setItem("${key}"`);
      expect(poser).toContain(`localStorage.removeItem("${key}")`);
      expect(poser).not.toContain(`localStorage.setItem("${key}"`);
    }
  });

  it("keeps webcam UI consent in the current tab and never reads or writes its legacy key", () => {
    const poser = [
      source("./vrm/useStudioVrmPoserState.ts"),
      source("./vrm/useStudioVrmPoserPoseLibrary.ts"),
      source("./vrm/useStudioVrmPoserPoseEdit.ts"),
      source("./vrm/StudioVrmPoserDialog.tsx"),
      source("./vrm/StudioVrmPoserPanelBodyD.tsx"),
    ].join("\n");
    const preferences = source("./vrm/studio-vrm-poser-preferences-sqlite.ts");

    expect(preferences).toContain(
      "globalThis.sessionStorage.getItem(STUDIO_VRM_WEBCAM_CONSENT_SESSION_KEY)",
    );
    expect(preferences).toContain(
      "globalThis.sessionStorage.setItem(STUDIO_VRM_WEBCAM_CONSENT_SESSION_KEY, \"true\")",
    );
    expect(poser).toContain("hasStudioVrmWebcamSessionConsent()");
    expect(poser).toContain("rememberStudioVrmWebcamSessionConsent()");
    expect(poser).not.toMatch(/localStorage\.(?:getItem|setItem)\(/u);
    expect(preferences).not.toContain("localStorage");
    expect(poser).not.toContain('localStorage.removeItem("studio_webcam_consent")');
  });

  it("routes VRM recents to SQLite/OPFS with observable memory-only recovery", () => {
    const poser = [
      source("./vrm/useStudioVrmPoserState.ts"),
      source("./vrm/useStudioVrmPoserPoseLibrary.ts"),
      source("./vrm/useStudioVrmPoserPoseEdit.ts"),
      source("./vrm/StudioVrmPoserDialog.tsx"),
      source("./vrm/StudioVrmPoserPanelBodyD.tsx"),
    ].join("\n");
    const preferences = source("./vrm/studio-vrm-poser-preferences-sqlite.ts");

    expect(poser).toContain("createStudioVrmPoserPreferencesRuntime");
    expect(poser).toContain("recentPreferencesRuntime.hydrate()");
    expect(poser).toContain("recentPreferencesRuntime.rememberPose(poseId)");
    expect(poser).toContain("recentPreferencesRuntime.rememberCharacter(modelId)");
    expect(poser).toContain('data-studio-vrm-recent-persistence-warning="memory-only"');
    expect(poser).toContain("SQLite/OPFS 다시 연결");
    expect(preferences).toContain("acquireStudioLocalDatabase");
    expect(preferences).toContain("database.asAsyncKeyValueStore(");
    expect(preferences).toContain('"studio-vrm-poser-preferences-v12"');
    expect(preferences).not.toContain("localStorage");
  });
});
