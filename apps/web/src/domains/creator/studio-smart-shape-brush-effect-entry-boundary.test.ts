import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const page = readStudioCuttoonEditorSource();

function functionSlice(name: string, nextName: string): string {
  const start = page.indexOf(`function ${name}`);
  const end = page.indexOf(`function ${nextName}`, start + 1);
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0);
  expect(end, `${nextName} must follow ${name}`).toBeGreaterThan(start);
  return page.slice(start, end);
}

function expectOrder(source: string, tokens: readonly string[]): void {
  let cursor = -1;
  for (const token of tokens) {
    const index = source.indexOf(token, cursor + 1);
    expect(index, `missing or out-of-order token: ${token}`).toBeGreaterThan(cursor);
    cursor = index;
  }
}

describe("StudioPage smart-shape selected-brush entry boundary", () => {
  it("owns one source snapshot ref and resets it at both gesture boundaries", () => {
    expect(page.match(/quickShapeBrushEffectSourceRef = useRef<DrawEl \| null>\(null\)/gu)).toHaveLength(1);

    const start = functionSlice("startQuickShapeTracking", "stopQuickShapeTracking");
    expectOrder(start, [
      "quickShapeConvertedRef.current = false",
      "quickShapeLockedRef.current = false",
      "quickShapeBrushEffectSourceRef.current = null",
      "quickShapeStillAnchorRef.current = pos",
    ]);

    const stop = functionSlice("stopQuickShapeTracking", "snapshotQuickShapeTracking");
    expect(stop).toContain("quickShapeBrushEffectSourceRef.current = null");
  });

  it("rejects unavailable selected effects before live conversion can remove brush channels", () => {
    const tick = functionSlice("runQuickShapeTick", "handleBubbleShapePointerDown");

    expectOrder(tick, [
      "if (!quickShapeConvertedRef.current)",
      "if (!match) return",
      "resolveStudioSmartShapeBrushEffectAvailability(current).status === \"unavailable\"",
      "quickShapeBrushEffectSourceRef.current = structuredClone(current)",
      "let next: DrawEl = {",
      "brush: undefined",
      "pressures: undefined",
      "drawingRef.current = next",
    ]);
    expect(tick.match(/resolveStudioSmartShapeBrushEffectAvailability\(current\)/gu)).toHaveLength(1);
    expect(tick.match(/quickShapeBrushEffectSourceRef\.current = structuredClone\(current\)/gu)).toHaveLength(1);
  });

  it("enables selected-brush output in the immutable release snapshot before cleanup", () => {
    const snapshot = functionSlice("snapshotQuickShapeTracking", "fixedRateStrokePump");
    expect(snapshot).toContain('brushEffectMode: "selected-brush" as const');
    expect(snapshot).toContain("brushEffectSource: quickShapeBrushEffectSourceRef.current");

    const finish = functionSlice("finishDrawingPointer", "onStagePointerCancel");
    expectOrder(finish, [
      "const quickShapeSnapshot = snapshotQuickShapeTracking()",
      "planStudioDrawPointerRelease({",
      "active: quickShapeActive",
      "...quickShapeSnapshot",
      "stopQuickShapeTracking()",
    ]);
  });
});
