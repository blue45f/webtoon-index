import { describe, expect, it } from "vitest";

import { renderStudioDynamicBrushCoverageMark } from "./studio-dynamic-brush-coverage-renderer";

import type { StudioDynamicBrushCoverageMark } from "./studio-dynamic-brush-coverage-renderer";

/**
 * Regression for the 2026-08-14 blank-stroke defect: carriers hand out deep-frozen ribbons, so a
 * Path2D memo stored ON the ribbon threw a TypeError under ES-module strict mode and aborted the
 * whole draw. Every unstyled ribbon (hard-airbrush, erodible-pencil, the pro flat/marker packs)
 * rendered zero pixels in the browser while their styled siblings kept working.
 */
class RecordingContext {
  globalAlpha = 1;
  fillStyle = "";
  readonly filledPaths: Path2D[] = [];
  readonly beginPathCalls: number[] = [];
  fill(path?: Path2D): void {
    if (path) this.filledPaths.push(path);
    else this.beginPathCalls.push(1);
  }
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
  save(): void {}
  restore(): void {}
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  ellipse(): void {}
  drawImage(): void {}
  setTransform(): void {}
  clearRect(): void {}
}

function frozenUnstyledRibbonMark(): StudioDynamicBrushCoverageMark {
  return Object.freeze({
    x: 20,
    y: 20,
    radiusX: 8,
    radiusY: 8,
    angleRadians: 0,
    alpha: 0.8,
    color: "#123456",
    ribbon: Object.freeze({
      kind: "competitor-specialty-ribbon-polygon",
      version: "competitor-specialty-ribbon-carrier-v1",
      role: "stroke-union",
      semanticProfile: "hard-airbrush-envelope",
      polygons: Object.freeze([
        Object.freeze([10, 10, 30, 10, 30, 30, 10, 30]),
      ]),
    }),
  }) as unknown as StudioDynamicBrushCoverageMark;
}

describe("frozen carrier ribbon painting", () => {
  it("fills an unstyled frozen ribbon instead of throwing on a cache write", () => {
    const mark = frozenUnstyledRibbonMark();
    const context = new RecordingContext();

    expect(() => renderStudioDynamicBrushCoverageMark(
      context as never,
      mark,
    )).not.toThrow();
    expect(context.filledPaths.length + context.beginPathCalls.length)
      .toBeGreaterThan(0);
    expect(context.fillStyle).toBe("#123456");
    // The frozen ribbon must remain frozen and untouched — no memo property may be attached.
    expect(Object.isFrozen(mark.ribbon)).toBe(true);
    expect(Object.hasOwn(mark.ribbon as object, "_cachedPath")).toBe(false);
  });

  it("reuses one cached path across repeated draws of the same ribbon", () => {
    const mark = frozenUnstyledRibbonMark();
    const first = new RecordingContext();
    const second = new RecordingContext();

    renderStudioDynamicBrushCoverageMark(first as never, mark);
    renderStudioDynamicBrushCoverageMark(second as never, mark);

    if (first.filledPaths.length > 0 && second.filledPaths.length > 0) {
      expect(second.filledPaths[0]).toBe(first.filledPaths[0]);
    }
  });
});
