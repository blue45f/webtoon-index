import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// 2026-08-21 intentional change: the render-settings/sky controllers and mesh nodes moved out of
// StudioBackground3D.tsx into StudioBg3dSceneNodes.tsx during the editor split.
import { readStudioBg3dEditorSource } from "./read-studio-bg3d-editor-source";

const background3dSource = [
  readStudioBg3dEditorSource(),
  ...[
    "./StudioBg3dSceneNodes.tsx",
    "./StudioBg3dDirectionalShadowLight.tsx",
    "./StudioBg3dShapesPanel.tsx",
    "./StudioBg3dViewPanelContent.tsx",
    "./StudioBg3dLtPanel.tsx",
  ].map((fileName) => readFileSync(new URL(fileName, import.meta.url), "utf8")),
].join("\n");

describe("Studio BG3D mood/render integration boundary", () => {
  it("applies a mood only from the explicit preset command and records one immediate transition", () => {
    const handlerStart = background3dSource.indexOf("function applyMoodRig(");
    const handlerEnd = background3dSource.indexOf(
      "function applySunRigConfig",
      handlerStart,
    );
    const handler = background3dSource.slice(handlerStart, handlerEnd);
    const applyIndex = handler.indexOf("applyStudioBg3dMoodRig(sceneBaseDocument, rigId)");
    const historyIndex = handler.indexOf(
      "commitImmediateHistoryTransition(primitives, customModels, applied)",
    );
    const stateIndex = handler.indexOf("setSceneBaseDocument(applied)");

    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    expect(applyIndex).toBeGreaterThanOrEqual(0);
    expect(historyIndex).toBeGreaterThan(applyIndex);
    expect(stateIndex).toBeGreaterThan(historyIndex);
    expect(handler.match(/commitImmediateHistoryTransition/gu)).toHaveLength(1);
    expect(background3dSource).toContain("onClick={() => applyMoodRig(rig.id)}");
  });

  it("projects saved render settings on creation and on later document updates", () => {
    const controllerStart = background3dSource.indexOf(
      "function StudioBg3dThreeRenderSettingsController",
    );
    const controllerEnd = background3dSource.indexOf(
      "function SkyClearColorController",
      controllerStart,
    );
    const controller = background3dSource.slice(controllerStart, controllerEnd);
    const canvasStart = background3dSource.indexOf("<Canvas");
    const canvasEnd = background3dSource.indexOf("<BgAdaptiveDprController", canvasStart);
    const canvas = background3dSource.slice(canvasStart, canvasEnd);

    expect(controller).toContain("applyStudioBg3dThreeRenderSettings(gl, render)");
    expect(controller).toContain("[gl, render]");
    expect(background3dSource).toContain(
      "<StudioBg3dThreeRenderSettingsController render={sceneBaseDocument.render} />",
    );
    expect(canvas).toContain(
      "applyStudioBg3dThreeRenderSettings(gl, sceneBaseDocument.render)",
    );
  });

  it("uses the radius-softened PCF path with dynamically fitted, acne-resistant shadows", () => {
    expect(background3dSource).toContain("type: THREE.PCFShadowMap");
    expect(background3dSource).not.toContain("type: THREE.PCFSoftShadowMap");
    expect(background3dSource).toContain("fitStudioBg3dDirectionalShadowFrustum({");
    expect(background3dSource).toContain("shadow-normalBias={fit.normalBias}");
    expect(background3dSource).toContain("shadow-radius={radius}");
    expect(background3dSource).toContain("shadow-camera-far={fit.far}");
    expect(background3dSource).toContain("far={mainCameraFarClip}");
    expect(background3dSource).toContain("maxDistance={mainCameraMaxOrbitDistance}");
    expect(background3dSource).toContain("shadow-camera-left={fit.left}");
    expect(background3dSource).toContain("readStudioBg3dShadowModelLocalBounds(");
    expect(background3dSource).toContain("<mesh receiveShadow rotation-x={-Math.PI / 2}");
    expect(background3dSource).toContain("<meshStandardMaterial");
  });
});
