import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// 2026-08-21 intentional change: the R3F scene-node components (BgViewportController,
// BgGroundHelper, BgPrimitiveMesh, BgCustomModelMesh, …) moved out of StudioBackground3D.tsx
// into StudioBg3dSceneNodes.tsx during the editor split. Their markers resolve there now.
import { readStudioBg3dEditorSource } from "./read-studio-bg3d-editor-source";

const source = [
  readStudioBg3dEditorSource(),
  ...[
    "./StudioBg3dSceneNodes.tsx",
    "./StudioBg3dShapesPanel.tsx",
    "./StudioBg3dViewPanelContent.tsx",
    "./StudioBg3dLtPanel.tsx",
    "./studio-bg3d-control-fields.tsx",
  ].map((fileName) => readFileSync(new URL(fileName, import.meta.url), "utf8")),
].join("\n");

function sourceBetween(startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function expectInOrder(haystack: string, needles: readonly string[]): void {
  let cursor = -1;
  for (const needle of needles) {
    const index = haystack.indexOf(needle, cursor + 1);
    expect(index, `Expected ${JSON.stringify(needle)} after ${cursor}`).toBeGreaterThan(cursor);
    cursor = index;
  }
}

describe("Studio BG3D Camera vNext and surface snap integration", () => {
  it("round-trips near clipping and Dutch up through the live camera and React camera nodes", () => {
    const viewport = sourceBetween("function BgViewportController(", "function BgGroundHelper(");
    expect(viewport).toContain("nearClip: resolveStudioBg3dCameraNearClip(camera.near)");
    expect(viewport).toContain("up: camera.up.toArray()");
    expect(viewport).toContain("createStudioBg3dCameraUpForDutchRoll({");
    expect(viewport).toContain("applyStudioBg3dViewToThreeCamera(camera, controls");

    expect(source).toContain("const mainCameraNearClip = resolveStudioBg3dCameraNearClip(");
    expect(source).toContain("const mainCameraUp = resolveStudioBg3dCameraUpVector(");
    expect(source.match(/near=\{mainCameraNearClip\}/gu)).toHaveLength(2);
    expect(source).toContain("up: [...mainCameraUp]");
    expect(source).toContain('id="bg3d-camera-near-clip"');
    expect(source).toContain('id="bg3d-camera-dutch-roll"');
    expect(source).toContain("Math.log10(STUDIO_BG3D_CAMERA_MIN_NEAR_CLIP)");
  });

  it("coalesces each lens slider gesture into one exact before/after history command", () => {
    const preview = sourceBetween(
      "function previewCameraLens(",
      "function updateCameraLens(",
    );
    const finish = sourceBetween(
      "function finishCameraLensGesture()",
      "function previewCameraLens(",
    );
    expect(preview).toContain("cameraLensGestureBeforeViewRef.current ??= liveView");
    expect(preview).toContain("cameraLensGestureLatestViewRef.current = nextDocument.camera");
    expect(preview).toContain("setTimeout(finishCameraLensGesture, 800)");
    expect(finish).toContain("resolveStudioBg3dCameraGestureCommitView(");
    expectInOrder(finish, [
      "resolveStudioBg3dCameraGestureCommitView(",
      "latestView",
      "viewportApiRef.current",
      "sceneBaseDocument.camera",
    ]);
    expect(finish).toContain("cameraLensGestureLatestViewRef.current = null");
    expect(finish).toContain("commitCameraLensView(beforeView, nextDocument)");
    expect(source).toContain("if (cameraLensGestureBeforeViewRef.current) return;");
    expect(source.match(/onChangeEnd=\{finishCameraLensGesture\}/gu)).toHaveLength(3);
    expect(source).toContain("onPointerUp={onChangeEnd}");
    expect(source).toContain("{ preserveBeforeCamera: true }");
  });

  it("fits one registered Object3D AABB through the live projection and records one camera command", () => {
    const fit = sourceBetween(
      "function focusSelectedEntity()",
      "const registerPrimitiveRef",
    );
    const commit = sourceBetween(
      "function commitCameraViewCommand(",
      "function zoomCameraBy(",
    );

    expect(fit).toContain("selectedIds.size !== 1");
    expect(fit).toContain("readStudioBg3dObjectWorldBounds(object)");
    expect(fit).toContain("viewportApiRef.current?.readFramingState()");
    expect(fit).toContain("fitStudioBg3dCameraToBounds({");
    expect(fit).toContain("orthographicFrustumAtZoomOne");
    expect(fit.match(/commitCameraViewCommand/gu)).toHaveLength(1);
    expect(fit).toContain("선택한 객체의 실제 경계 또는 카메라 화면을 아직 준비하지 못했습니다.");

    expect(commit.match(/commitImmediateHistoryTransition/gu)).toHaveLength(1);
    expect(commit).toContain("{ preserveBeforeCamera: true }");
    expectInOrder(commit, [
      "viewport.applyView(nextDocument.camera)",
      "commitImmediateHistoryTransition(",
      "setSceneBaseDocument(nextDocument)",
    ]);
  });

  it("routes every zoom button through one projection-aware, undoable command", () => {
    const zoom = sourceBetween("function zoomCameraBy(", "function applyCameraPreset(");
    expect(zoom).toContain("const beforeView = viewport.readView()");
    expect(zoom).toContain("viewport.zoomBy(distanceFactor)");
    expect(zoom).toContain("commitCameraViewCommand(beforeView, nextView)");
    expect(source.match(/onClick=\{\(\) => zoomCameraBy\(0\.82\)\}/gu)).toHaveLength(2);
    expect(source.match(/onClick=\{\(\) => zoomCameraBy\(1\.22\)\}/gu)).toHaveLength(2);
  });

  it("keeps selection while resolving a real world hit and publishes one history step with optional normal-align rotation", () => {
    const handler = sourceBetween(
      "function handleSurfaceSnapPick(",
      "h.handleSurfaceSnapPick = handleSurfaceSnapPick;",
    );
    expect(handler).toContain("collectStudioBg3dSurfaceSelectionSubtreeIds(");
    expect(handler).toContain("collectStudioBg3dSurfaceTargetPathIds(");
    expect(handler).toContain("readStudioBg3dObjectWorldBounds(selectionObject)");
    expect(handler).toContain("readStudioBg3dWorldSurfaceHit(event)");
    expect(handler).toContain("parentWorldMatrix: [...selectionObject.parent.matrixWorld.elements]");
    expect(handler).toContain("planStudioBg3dMultiSurfaceSnap(snapInputs)");
    expect(handler).toContain("alignRotationToNormal: surfaceSnapAlignNormal");
    expect(handler).toContain("[...result.rotation]");
    expect(handler).toContain("...(nextRotation ? { rotation: nextRotation } : {})");
    expect(handler).toContain("표면에 붙이고 법선에 맞춰 회전했어요.");
    expect(handler).toContain('reason === "self-hit"');
    expect(handler).toContain("selectedIds: [entity.id]");
    expect(handler.match(/commitImmediateHistoryTransition/gu)).toHaveLength(1);
    expect(handler).not.toContain("setSelectedIds");
    expectInOrder(handler, [
      "surfaceSnapArmedRef.current = false",
      "commitImmediateHistoryTransition(nextPrimitives, nextCustomModels, sceneBaseDocument)",
      "setPrimitives(nextPrimitives)",
      "setCustomModels(nextCustomModels)",
    ]);
  });

  it("wires normal-align toggle and multi-select one-click model placement recipe", () => {
    expect(source).toContain('from "./studio-bg3d-placement-recipe"');
    expect(source).toContain("planStudioBg3dModelPlacementRecipe");
    expect(source).toContain("function placeSelectedModelRecipe()");
    expect(source).toContain("alignRotationToNormal");
    expect(source).toContain("surfaceSnapAlignNormal");
    expect(source).toContain('data-testid="bg3d-surface-snap-align-normal"');
    expect(source).toContain('aria-label="법선 정렬"');
    expect(source).toContain('aria-label="배치 정리"');
    expect(source).toContain("STUDIO_BG3D_SURFACE_SNAP_MAX_MULTI_INPUTS");
    expect(source).toContain("planStudioBg3dMultiSurfaceSnap");
    expect(source).toContain("canPlaceSelectedModelRecipe");
    const recipe = sourceBetween(
      "function placeSelectedModelRecipe()",
      "function centerAndGroundSelectedEntity()",
    );
    // Multi path: iterate selection (cap 64), not single-id early return.
    expect(recipe).toContain("for (const id of selectedIds)");
    expect(recipe).toContain("selectedIds.size > STUDIO_BG3D_SURFACE_SNAP_MAX_MULTI_INPUTS");
    expect(recipe).toContain("배치 정리는 한 번에 최대 ${STUDIO_BG3D_SURFACE_SNAP_MAX_MULTI_INPUTS}개까지 지원합니다.");
    expect(recipe).toContain("planStudioBg3dModelPlacementRecipe({");
    expect(recipe).toContain("autoFitTargetSize: 2");
    expect(recipe).toContain("STUDIO_BG3D_SURFACE_SNAP_MAX_MULTI_INPUTS");
    expect(recipe).toContain("commitImmediateHistoryTransition(primitives, nextCustomModels, sceneBaseDocument)");
    expect(recipe).toContain("${successCount}개 배치를 정리했어요");
    expect(recipe).not.toContain("selectedIds.size !== 1");
    expect(recipe).not.toContain("updateCustomModelTransform(");
    expectInOrder(recipe, [
      "for (const id of selectedIds)",
      "for (const model of models)",
      "planStudioBg3dModelPlacementRecipe({",
      "commitImmediateHistoryTransition(primitives, nextCustomModels, sceneBaseDocument)",
      "${successCount}개 배치를 정리했어요",
    ]);
  });

  it("does not leak an armed tool across Escape, close, scene, selection, or transient changes", () => {
    expect(source).toContain("onDismiss: requestModalDismiss");
    expect(sourceBetween("function requestModalDismiss()", "function requestUserClose()")).toContain(
      "cancelSurfaceSnap",
    );
    expect(sourceBetween("function requestUserClose()", "async function handleSaveToLibrary()")).toContain(
      "cancelSurfaceSnap()",
    );
    expect(source).toContain('[customModels, primitives, sceneBaseDocument]');
    expect(source).toContain('[selectedIds]');
    expect(source).toContain("surfaceSnapArmedRef.current");
    expect(source).toContain('aria-pressed={surfaceSnapArmed}');
    expect(source).toContain('data-testid="bg3d-surface-snap-toggle"');
    expect(source).toContain('"min-h-11 min-w-11 sm:size-11"');
  });

  it("consumes armed surface clicks before normal selection for all render paths", () => {
    expect(source.match(/if \(onSurfacePick\([^\n]+\)\) return;/gu)).toHaveLength(3);
    expect(source.match(/onSurfacePick=\{handleSurfaceSnapPick\}/gu)).toHaveLength(3);
    expect(source).toContain("if (surfaceSnapArmedRef.current)");
    expect(source).toContain("붙일 수 있는 3D 객체의 표면을 클릭해 주세요.");
  });

  it("does not reinterpret floating camera or surface controls as empty-scene clicks", () => {
    expect(source.match(/data-bg3d-viewport-control="true"/gu)).toHaveLength(3);
    expect(source).toContain('placementSession.phase === "preview"');
    const missed = sourceBetween("onPointerMissed={(event) => {", "</Canvas>");
    expectInOrder(missed, [
      "isStudioBg3dViewportControlTarget(event.target)",
      "surfaceSnapArmedRef.current",
      "setSelectedIds(new Set())",
    ]);
  });
});
