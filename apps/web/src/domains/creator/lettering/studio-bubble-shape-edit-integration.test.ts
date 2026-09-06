import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioInspectorAsideSurface } from "../read-studio-inspector-aside-source";
import { readStudioCuttoonEditorSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const pageSource = readStudioCuttoonEditorSource();
const panelSource = readFileSync(new URL("./StudioBubbleShapePanel.tsx", import.meta.url), "utf8");
const inspectorSource = readStudioInspectorAsideSurface();

describe("Studio bubble shape point editing integration", () => {
  it("connects point insertion, movement, and removal to the canvas gesture lifecycle", () => {
    expect(pageSource).toContain("insertBubbleShapePointAtClosestSegment");
    expect(pageSource).toContain("moveBubbleShapePoint");
    expect(pageSource).toContain("removeBubbleShapePoint");
    expect(pageSource).toContain("e.evt.shiftKey");
    expect(pageSource).toContain("e.evt.altKey");
    expect(pageSource).toContain("bubbleShapeSelectedPointIndex");
  });

  it("fences touch and pen point drags to their owning pointer and clears cancelled drafts", () => {
    expect(pageSource).toContain("bubbleShapeDragRef.current.pointerId !== pointerId");
    expect(pageSource).toContain("if (bubbleShapeDragRef.current) return;");
    expect(pageSource).toContain("nativeTarget.setPointerCapture(pointerId)");
    expect(pageSource).toContain("releaseBubbleShapePointerCapture(bubbleShapeDragRef.current)");
    expect(pageSource).toContain('globalThis.addEventListener("pointerup", cancelBubbleShapeDragOutsideStage)');
    expect(pageSource).toContain('globalThis.addEventListener("pointercancel", cancelBubbleShapeDragOutsideStage)');
    expect(pageSource).toContain("pendingBubbleShapeDraftRef.current = null");
    expect(pageSource).toContain("globalThis.cancelAnimationFrame(bubbleShapeRafRef.current)");

    const cancelStart = pageSource.indexOf("function onStagePointerCancel");
    const upStart = pageSource.indexOf("function onStageUp", cancelStart);
    const cancelSource = pageSource.slice(cancelStart, upStart);
    expect(cancelSource).toContain("if (bubbleShapeDragRef.current)");
    expect(cancelSource).toContain("setBubbleShapeDraft(null)");
  });

  it("teaches the discoverable point editing gestures in the inspector", () => {
    expect(panelSource).toContain("Shift+외곽선 클릭");
    expect(panelSource).toContain("Alt+점 클릭");
    expect(panelSource).toContain("Delete로 삭제");
  });

  it("없는 키보드를 가정해 선택 점·중점 추가·최소 3점 삭제를 Inspector에 연결한다", () => {
    expect(pageSource).toContain("function addBubbleShapePointFromInspector");
    expect(pageSource).toContain("function removeBubbleShapePointFromInspector");
    expect(pageSource).toContain("lengthSquared > longestSquared");
    expect(pageSource).toContain("insertBubbleShapePointAtClosestSegment(points, midpointX, midpointY)");
    expect(pageSource).toContain("setBubbleShapeSelectedPointIndex(inserted.pointIndex)");
    expect(pageSource).toContain("bubbleShapeSelectedPointIndex={bubbleShapeSelectedPointIndex}");
    expect(inspectorSource).toContain("onAddPoint={addBubbleShapePointFromInspector}");
    expect(inspectorSource).toContain("onRemovePoint={removeBubbleShapePointFromInspector}");
    expect(panelSource).toContain("가장 긴 외곽선 선분에 점 추가");
    expect(panelSource).toContain("선택 점 삭제");
    expect(panelSource).toContain("min-h-11");
  });
});
