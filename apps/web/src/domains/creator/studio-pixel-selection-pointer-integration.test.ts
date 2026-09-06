import { describe, expect, it } from "vitest";

import { readStudioPageCompositionSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";


const pageSource = readStudioPageCompositionSource();

describe("Studio pixel-selection pointer lifecycle", () => {
  it("captures the owning pointer and keeps global release/cancel safety nets", () => {
    expect(pageSource).toContain("captureTarget?.setPointerCapture(pointerId)");
    expect(pageSource).toContain('globalThis.addEventListener("pointerup", onPointerUp, true)');
    expect(pageSource).toContain('globalThis.addEventListener("pointercancel", onPointerCancel, true)');
    expect(pageSource).toContain('globalThis.addEventListener("lostpointercapture", onPointerCancel, true)');
    expect(pageSource).toContain("pixelSelectionHandledNativeEndEventsRef.current.add(event)");
  });

  it("commits only the owner release and cancels without mutating the selection", () => {
    expect(pageSource).toContain("session.pointerId !== pointerId");
    expect(pageSource).toContain("if (!cancelled) {");
    expect(pageSource).toContain("commitSelectionDragAtPoint(");
    expect(pageSource).toMatch(
      /commitSelectionDragAtPoint\(\s*selectionOperationBase\(previous, session\.operation\),\s*session\.drag,/u,
    );
    expect(pageSource).toMatch(
      /commitSelectionDrag\(\s*selectionOperationBase\(previous, session\.operation\),\s*session\.drag,/u,
    );
    expect(pageSource).not.toContain(
      "commitSelectionDrag(previous, session.drag)",
    );
    expect(pageSource).toContain('session.drag.tool === "lasso"');
    expect(pageSource).toContain("releasePixelSelectionPointerCapture(session)");
  });

  it("samples the owning pointerup coordinate before committing a rectangle or ellipse", () => {
    expect(pageSource).toContain("stage.setPointersPositions(pointerEvent)");
    expect(pageSource).toContain("stage.getRelativePointerPosition()");
    expect(pageSource).toContain("commitSelectionDragAtPoint(");
    expect(pageSource).toContain("canvasPointToNormalized(position.x, position.y, session.frame)");
  });
});
