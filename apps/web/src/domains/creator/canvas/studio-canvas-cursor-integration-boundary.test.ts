import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const studioPageSource = readStudioCuttoonEditorSource();
const studioCanvasViewportSource = readFileSync(
  new URL("./StudioCanvasViewport.tsx", import.meta.url),
  "utf8",
);
const studioCanvasViewportInteractionSource = readFileSync(
  new URL("./studio-canvas-viewport-interaction.ts", import.meta.url),
  "utf8",
);
const studioCanvasViewportStageHostSource = readFileSync(
  new URL("./StudioCanvasViewportStageHost.tsx", import.meta.url),
  "utf8",
);
const studioCanvasViewportToolLayersSource = readFileSync(
  new URL("./StudioCanvasViewportToolLayers.tsx", import.meta.url),
  "utf8",
);
const studioCanvasViewportDocumentLayerSource = readFileSync(
  new URL("./StudioCanvasViewportDocumentLayer.tsx", import.meta.url),
  "utf8",
);
const studioCanvasViewportDomOverlaysSource = readFileSync(
  new URL("./StudioCanvasViewportDomOverlays.tsx", import.meta.url),
  "utf8",
);
const globalsSource = readFileSync(new URL("../../../styles/globals.css", import.meta.url), "utf8");
const perspectiveSource = readFileSync(new URL("../StudioPerspectiveOverlay.tsx", import.meta.url), "utf8");
const isometricSource = readFileSync(new URL("../StudioIsometricGridOverlay.tsx", import.meta.url), "utf8");
const guideSource = readFileSync(new URL("./StudioCanvasGuideLayers.tsx", import.meta.url), "utf8");

function studioPageSourceBetween(startMarker: string, endMarker: string): string {
  const start = studioPageSource.indexOf(startMarker);
  const end = studioPageSource.indexOf(endMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return studioPageSource.slice(start, end);
}

describe("Studio canvas cursor integration boundary", () => {
  it("projects pan cursors to the workspace and precision cursors only to the paper", () => {
    expect(studioCanvasViewportInteractionSource).toContain(
      "studioCanvasViewportCursorClassName(canvasCursorInput)",
    );
    expect(studioCanvasViewportInteractionSource).toContain("studioCanvasCursorClassName(canvasCursorInput)");
    expect(studioCanvasViewportStageHostSource).toContain(
      "data-studio-comment-placement-active={commentPinArmed",
    );
    expect(studioCanvasViewportSource).toContain(
      "data-studio-viewport-cursor={viewportCursorClassName",
    );
    expect(studioCanvasViewportStageHostSource).toContain(
      "data-studio-canvas-cursor={canvasCursorClassName",
    );
  });

  it("wires saved brush cursor preferences to a renderer-specific contact cursor", () => {
    const authoritativeMove = studioPageSourceBetween(
      "onAuthoritativeMove: (pointerEvent) => {",
      "onRawPreviewMove: (pointerEvent) => {",
    );
    const rawUpdate = studioPageSourceBetween(
      "onRawPreviewMove: (pointerEvent) => {",
      "onDiscard: () => {",
    );
    const cursorRenderer = studioPageSourceBetween(
      "function drawBrushCursorLayer(deferToFrame: boolean)",
      "function hideStrokeGuide(deferToFrame = false)",
    );
    const snapshot = authoritativeMove.indexOf(
      "const pointerMapperCache = stagePointerFrameMapperCacheRef.current;",
    );
    const mapper = authoritativeMove.indexOf(
      "pointerMapperCache.mapperFor(stage).pointFor(pointerEvent)",
    );
    const contactPoint = authoritativeMove.indexOf(
      "const contactPoint = pointerMapperCache.mapperFor(stage).pointFor(pointerEvent);",
    );
    const consume = authoritativeMove.indexOf("consumeFreehandPointerBatch(");
    const cursor = authoritativeMove.indexOf(
      "updateBrushCursor(stage, pointerEvent, contactPoint, true);",
    );

    expect(studioCanvasViewportInteractionSource).toContain(
      "const brushCursorStyle = appSettings.general.brushCursorStyle"
    );
    expect(studioCanvasViewportToolLayersSource).toContain('brushCursorStyle !== "none"');
    expect(studioCanvasViewportToolLayersSource).toContain("<StudioBrushCursor");
    expect(studioCanvasViewportToolLayersSource).toContain(
      "brushId={drawMode === \"eraser\" && !eraserPresetActive ? \"eraser\" : brush}",
    );
    expect(studioCanvasViewportToolLayersSource).toContain(
      'drawMode === "pen" || lowDensityEraserActive',
    );
    expect(studioCanvasViewportInteractionSource).toContain(
      'resolveStudioBrushPresetOperation(brush) === "erase"',
    );
    expect(studioCanvasViewportDocumentLayerSource).toContain(
      '!isStudioBrushEraserAliasId(liveEl.brush)',
    );
    expect(snapshot).toBeGreaterThanOrEqual(0);
    expect(consume).toBeGreaterThanOrEqual(0);
    expect(snapshot).toBeGreaterThan(consume);
    expect(mapper).toBeGreaterThanOrEqual(snapshot);
    expect(contactPoint).toBe(mapper - "const contactPoint = ".length);
    expect(cursor).toBeGreaterThan(mapper);
    expect(authoritativeMove).toContain("if (!consumeFreehandPointerBatch(");
    expect(authoritativeMove.match(/pointerMapperCache\.mapperFor\(stage\)/gu)).toHaveLength(1);
    expect(authoritativeMove.match(/\.pointFor\(pointerEvent\)/gu)).toHaveLength(1);
    expect(rawUpdate.match(/pointerMapperCache\.mapperFor\(stage\)/gu)).toHaveLength(1);
    expect(rawUpdate.match(/coordinateMapper\.pointFor\(pointerEvent\)/gu)).toHaveLength(1);
    expect(studioPageSource).toContain("acquireStudioStagePointerFrameMapperCache(");
    expect(studioPageSource).toContain("mapperCacheLease.release();");
    expect(studioPageSource).toContain("stagePointerFrameMapperCacheRef.current?.invalidate();");
    expect(studioPageSource).not.toContain("stagePointerFrameMapperCacheRef.current?.dispose();");
    expect(rawUpdate).toContain("replaceStudioRawPenInkPreview(rawState, {");
    expect(rawUpdate).toContain("rawTransition.predictionSurface");
    expect(rawUpdate).toContain("updateBrushCursor(stage, pointerEvent, contactPoint, true);");
    expect(rawUpdate).not.toContain("consumeFreehandPointerBatch(");
    expect(rawUpdate).not.toContain("drawingRef.current =");
    expect(rawUpdate).not.toContain("appendDrawingCrdtSampleSuffix(");
    expect(rawUpdate).not.toContain("scheduleDraft(");
    expect(studioCanvasViewportDomOverlaysSource).toContain(
      "transientPenInkSurfaceEnabled && webGpuViewportSurface",
    );
    expect(studioPageSource).toContain(
      "transientPenInkSurfaceEnabled={STUDIO_TRANSIENT_PEN_INK_SURFACE_ENABLED}",
    );
    expect(cursorRenderer).toContain("if (brushCursorDrawRafRef.current !== null) return;");
    expect(cursorRenderer).toContain("globalThis.requestAnimationFrame(() => {");
    expect(
      cursorRenderer.match(
        /\(brushCursorRef\.current\?\.getLayer\(\) \?\? strokeGuideRef\.current\?\.getLayer\(\)\)\?\.drawScene\(\)/gu,
      ),
    ).toHaveLength(2);
    expect(studioPageSource).toContain("drawBrushCursorLayer(deferToFrame);");
    expect(studioPageSource).toContain("if (nativeFreehandMoveOwnsStage) return;");
    expect(studioPageSource).not.toContain("nativeFreehandMoveOwnsCursor");
    expect(studioPageSource).not.toContain("Hide the hover-only size preview");
  });

  it("shows the comment cursor only while the resolved paper cursor is a usable crosshair", () => {
    expect(globalsSource).toContain('@media (pointer: fine)');
    expect(globalsSource).toContain(
      '[data-studio-comment-placement-active="true"][data-studio-canvas-cursor="crosshair"] canvas'
    );
    expect(globalsSource).toContain('9 9, crosshair !important');
  });

  it.each([
    ["tool-select", 'activatePrimaryCanvasTool("select");'],
    // Draw tools go through a thin wrapper that also surfaces properties.
    ["tool-pen", 'activateDrawToolWithProperties("pen");'],
    ["tool-eraser", 'activateDrawToolWithProperties("eraser");'],
    ["tool-pixel", 'activateDrawToolWithProperties("pixel");'],
  ])(
    "routes the %s shortcut through the stroke-safe primary tool transition",
    (shortcut, expectedTransition) => {
      const shortcutStart = studioPageSource.indexOf(`matchStudioShortcut(sc["${shortcut}"], e)`);
      expect(shortcutStart).toBeGreaterThan(-1);
      const shortcutBlock = studioPageSource.slice(shortcutStart, shortcutStart + 360);
      expect(shortcutBlock).toContain(expectedTransition);
      expect(shortcutBlock).not.toContain("setTool(");
    }
  );

  it("keeps transient disarm inside the shared primary tool transition", () => {
    const transition = studioPageSourceBetween(
      "function activatePrimaryCanvasTool(",
      "function activateDrawToolWithProperties(",
    );

    expect(transition).toContain("executeStudioPrimaryCanvasToolTransition(");
    expect(transition).toContain("cancelActiveStroke: discardDrawingPointerSession,");
    expect(transition).toContain("disarm: disarmAllPixelTools,");
    expect(transition).not.toContain("openInspectorRoute(");
    expect(studioPageSource).toContain(
      "activatePrimaryCanvasTool(\"draw\", nextDrawMode);",
    );
  });

  it("lets guide handles restore the inherited mode cursor after hover", () => {
    for (const source of [perspectiveSource, isometricSource, guideSource]) {
      expect(source).not.toContain('style.cursor = "default"');
      expect(source).toContain('style.cursor = ""');
    }
  });
});
