import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioBg3dEditorSource } from "./read-studio-bg3d-editor-source";

const background3dSource = readStudioBg3dEditorSource();
const viewPanelSource = readFileSync(
  new URL("./StudioBg3dViewPanelContent.tsx", import.meta.url),
  "utf8",
);

describe("Studio BG3D staging-studio integration boundary", () => {
  it("keeps direct lighting and exposure edits canonical, undoable, and physics-safe", () => {
    const lightingStart = background3dSource.indexOf(
      "function updateLightingSettings(",
    );
    const exposureStart = background3dSource.indexOf(
      "function updateRenderExposure(",
      lightingStart,
    );
    const moodStart = background3dSource.indexOf(
      "function applyMoodRig(",
      exposureStart,
    );
    const lightingHandler = background3dSource.slice(lightingStart, exposureStart);
    const exposureHandler = background3dSource.slice(exposureStart, moodStart);

    expect(lightingStart).toBeGreaterThanOrEqual(0);
    expect(exposureStart).toBeGreaterThan(lightingStart);
    expect(moodStart).toBeGreaterThan(exposureStart);
    for (const handler of [lightingHandler, exposureHandler]) {
      expect(handler).toContain(
        "if (isStudioBg3dPhysicsTransientPhase(physicsPhaseRef.current)) return;",
      );
      expect(handler).toContain("setSceneBaseDocument((current) =>");
      expect(handler).toContain("canonicalSceneDocument(candidate) ?? current");
    }
    expect(lightingHandler).toContain(
      "key: { ...current.lighting.key, ...patch.key }",
    );
    expect(lightingHandler).toContain(
      "fill: { ...current.lighting.fill, ...patch.fill }",
    );
    expect(exposureHandler).toContain("render: { ...current.render, exposure }");
  });

  it("connects the scene-authoritative light values to one disabled-aware editor", () => {
    expect(background3dSource).toContain("updateLightingSettings,");
    expect(background3dSource).toContain("updateRenderExposure,");
    expect(viewPanelSource).toContain("<StudioBg3dLightingStudio");
    expect(viewPanelSource).toContain("lighting={sceneBaseDocument.lighting}");
    expect(viewPanelSource).toContain("exposure={sceneBaseDocument.render.exposure}");
    expect(viewPanelSource).toContain("onUpdateLighting={updateLightingSettings}");
    expect(viewPanelSource).toContain("onUpdateExposure={updateRenderExposure}");
    expect(viewPanelSource).toMatch(
      /disabled=\{\s*isCapturing \|\| isBatchRenderingShots \|\| isRestoringScene \|\|\s*physicsInteractionLocked\s*\}/u,
    );
  });

  it("passes authoritative imported-model classifications into the shared actor/prop library", () => {
    expect(background3dSource).toContain(
      "classificationByModelId={genericModelClassifications}",
    );
    expect(background3dSource).not.toMatch(
      /classificationByModelId=\{[^}]*entry\.name/iu,
    );
  });
});
