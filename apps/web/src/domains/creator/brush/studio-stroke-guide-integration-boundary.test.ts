import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioCanvasViewportStack } from "../canvas/read-studio-canvas-viewport-stack";
import { readStudioCuttoonEditorSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const pageSource = readStudioCuttoonEditorSource();
const viewportSource = readStudioCanvasViewportStack(import.meta.url, "../canvas/");
const cursorSource = readFileSync(new URL("./StudioBrushCursor.tsx", import.meta.url), "utf8");

function between(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("studio stroke guide integration boundary", () => {
  it("wires one transient Konva line from the editor through the viewport cursor layer", () => {
    expect(pageSource).toContain("const strokeGuideRef = useRef<Konva.Line>(null);");
    expect(pageSource).toContain("strokeGuideRef={strokeGuideRef}");
    expect(viewportSource).toContain(
      'strokeGuideRef: import("react").RefObject<import("konva/lib/shapes/Line").Line | null>;',
    );
    expect(viewportSource).toContain("guideRef={");
    expect(viewportSource).toContain("? strokeGuideRef");
    expect(cursorSource).toContain('name="studio-stroke-guide"');
    expect(cursorSource).toContain("listening={false}");
    expect(cursorSource).toContain("visible={false}");
  });

  it("updates only from current raw contact and authoritative ink refs without React state", () => {
    const authoritativeMove = between(
      pageSource,
      "onAuthoritativeMove: (pointerEvent) => {",
      "onRawPreviewMove: (pointerEvent) => {",
    );
    const rawMove = between(
      pageSource,
      "onRawPreviewMove: (pointerEvent) => {",
      "onDiscard: () => {",
    );
    const updater = between(
      pageSource,
      "function updateStrokeGuide(",
      "function updateBrushCursor(",
    );

    expect(authoritativeMove.indexOf("consumeFreehandPointerBatch(")).toBeLessThan(
      authoritativeMove.indexOf("updateStrokeGuide("),
    );
    expect(authoritativeMove).toContain("contactPoint?.x ?? Number.NaN");
    expect(authoritativeMove).toContain("contactPoint?.y ?? Number.NaN");
    expect(rawMove).toContain("updateStrokeGuide(");
    expect(rawMove).toContain("contactPoint?.x ?? Number.NaN");
    expect(rawMove).toContain("contactPoint?.y ?? Number.NaN");
    expect(rawMove).not.toContain("setState");
    expect(updater).toContain("const drawing = drawingRef.current;");
    expect(updater).toContain("pointerX: number");
    expect(updater).toContain("pointerY: number");
    expect(updater).toContain("const inputSettings = drawingInputSettingsRef.current;");
    expect(updater).toContain("shouldShowStudioStrokeGuide(");
    expect(updater).toContain("const geometry = guideNode.points();");
    expect(updater).toContain("geometry[0] = inkX;");
    expect(updater).toContain("guideNode.visible(true);");
    expect(updater).toContain("if (changed) drawBrushCursorLayer(deferToFrame);");
    expect(updater).not.toContain("planStudioStrokeGuide({");
    expect(updater).not.toContain("inkPoint:");
    expect(updater).not.toContain("setElements");
    expect(updater).not.toContain("commit(");
    expect(updater).not.toContain("Crdt");
  });

  it("preserves cursor-none semantics while retaining the independently enabled guide", () => {
    expect(viewportSource).toContain('brushCursorStyle !== "none"');
    expect(viewportSource).toContain(
      "|| (appSettings.general.showStrokeGuide && stabilizer > 0)",
    );
    expect(cursorSource).toContain("style: StudioBrushCursorStyle;");

    const cursorUpdate = between(
      pageSource,
      "function updateBrushCursor(",
      "function hideSmudgeCursor()",
    );
    expect(cursorUpdate).toContain(
      'appSettingsRef.current.general.brushCursorStyle === "none"',
    );
    expect(cursorUpdate).toContain("hideBrushCursorVisual(deferToFrame);");
    expect(cursorUpdate).not.toContain(
      'appSettingsRef.current.general.brushCursorStyle === "none"\n    ) {\n      hideBrushCursor(',
    );
  });

  it("hides the guide on contact release, cancel, tool transition, hover exit, and export", () => {
    const release = between(
      pageSource,
      "function releaseDrawingPointerSession()",
      "function discardDrawingPointerSession()",
    );
    const primaryToolTransition = between(
      pageSource,
      "function activatePrimaryCanvasTool(",
      "function readActiveStrokeLifecycleRecovery()",
    );
    const viewportCursor = between(
      viewportSource,
      "/* 브러시 렌더 종류와 실제 범위를 반영하는 고대비 포인터. */",
      "{!isExporting && (smudgeArmed",
    );

    expect(release).toContain("hideStrokeGuide();");
    expect(primaryToolTransition).toContain(
      "cancelActiveStroke: discardDrawingPointerSession,",
    );
    expect(pageSource).toContain("function onStagePointerCancel(");
    expect(pageSource).toContain("hideBrushCursor();");
    expect(viewportSource).toContain("onMouseLeave={() => {");
    expect(viewportSource).toContain("hideBrushCursor();");
    expect(viewportCursor).toContain("!isExporting");
    expect(viewportCursor).toContain("!canvasInteractionBlocked");
    expect(viewportCursor).toContain("!isSpacePressed");
    expect(viewportCursor).toContain("!isPanning");
    expect(pageSource.match(/hideStrokeGuide\(\);\s+setIsExporting\(true\);/gu)).toHaveLength(2);
  });

  it("keeps the presentation line outside export, document, history, CRDT, and hit-test models", () => {
    // The layer carries a ref only to tag its own canvas element for evidence tooling; it stays
    // non-listening presentation chrome outside every document model.
    expect(cursorSource).toContain('listening={false} name="studio-brush-cursor-layer">');
    expect(cursorSource).toContain('data-studio-brush-cursor-canvas');
    expect(cursorSource).toContain("perfectDrawEnabled={false}");
    expect(pageSource).not.toContain("elements.push(strokeGuideRef");
    expect(pageSource).not.toContain("commit(strokeGuideRef");
    expect(pageSource).not.toContain("beginStroke(strokeGuideRef");
    expect(pageSource).not.toContain("toDataURL(strokeGuideRef");
  });
});
