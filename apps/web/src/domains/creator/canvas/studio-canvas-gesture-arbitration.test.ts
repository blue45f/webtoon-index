import { describe, expect, it } from "vitest";

import { readStudioPageCompositionSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";


import {
  resolveStudioCanvasGestureDisposition,
  type StudioCanvasGestureArbitrationInput,
  type StudioCanvasGestureDisposition,
} from "./studio-canvas-gesture-arbitration";

const studioPageSource = readStudioPageCompositionSource();

function sourceBetween(startMarker: string, endMarker: string): string {
  const start = studioPageSource.indexOf(startMarker);
  const end = studioPageSource.indexOf(endMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return studioPageSource.slice(start, end);
}

describe("studio canvas gesture arbitration", () => {
  it.each([
    {
      label: "owned edit over the View Tools HUD",
      input: { gestureOwned: true, viewTransformSuppressed: false, viewToolsHudTarget: true },
      expected: "consume-owned",
    },
    {
      label: "idle View Tools HUD interaction",
      input: { gestureOwned: false, viewTransformSuppressed: false, viewToolsHudTarget: true },
      expected: "pass-view-tools-hud",
    },
    {
      label: "owned edit over the canvas",
      input: { gestureOwned: true, viewTransformSuppressed: false, viewToolsHudTarget: false },
      expected: "consume-owned",
    },
    {
      label: "owned edit while view transforms are suppressed",
      input: { gestureOwned: true, viewTransformSuppressed: true, viewToolsHudTarget: false },
      expected: "consume-owned",
    },
    {
      label: "idle suppressed view",
      input: { gestureOwned: false, viewTransformSuppressed: true, viewToolsHudTarget: false },
      expected: "pass-suppressed",
    },
    {
      label: "idle canvas interaction",
      input: { gestureOwned: false, viewTransformSuppressed: false, viewToolsHudTarget: false },
      expected: "handle-canvas",
    },
  ] satisfies ReadonlyArray<{
    label: string;
    input: StudioCanvasGestureArbitrationInput;
    expected: StudioCanvasGestureDisposition;
  }>)("resolves $label as $expected", ({ input, expected }) => {
    expect(resolveStudioCanvasGestureDisposition(input)).toBe(expected);
  });

  it("routes wheel and touchmove through the shared ownership-first policy", () => {
    const wheel = sourceBetween("const onWheel = (e: WheelEvent) => {", "const prefs = appSettingsRef.current.mouse;");
    const touchMove = sourceBetween("const onTouchMove = (e: TouchEvent) => {", "if (e.touches.length !== 2) {");

    for (const handler of [wheel, touchMove]) {
      expect(handler).toContain("resolveStudioCanvasGestureDisposition({");
      expect(handler).toContain("gestureOwned: canvasPointerGestureIsOwned(),");
      expect(handler).toContain('if (gestureDisposition === "consume-owned") {');
      expect(handler).toContain("e.preventDefault();");
    }
    expect(wheel).toContain('if (gestureDisposition !== "handle-canvas") return;');
    expect(touchMove).toContain('if (gestureDisposition === "pass-suppressed") {');
    expect(touchMove).toContain('if (gestureDisposition === "pass-view-tools-hud") return;');
    const editingPreemption = touchMove.indexOf(
      "if (oneFingerPan && canvasEditingGestureIsOwned()) {"
    );
    const nativePan = touchMove.indexOf("if (oneFingerPan) {");
    expect(editingPreemption).toBeGreaterThanOrEqual(0);
    expect(nativePan).toBeGreaterThan(editingPreemption);
    expect(touchMove).toContain("clearOneFingerPan();");
  });
});
