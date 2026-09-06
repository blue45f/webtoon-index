import { describe, expect, it } from "vitest";

import { planStudioDrawObjectTransform } from "./studio-draw-object-transform";

import type { DrawEl } from "../studio-element-model";

/**
 * The live resize/rotate preview drives the stroke's Konva wrapper with
 * T(target)·R(θ)·S(scale)·T(-source) attrs while the gesture runs; the release-time bake maps
 * every point through `planStudioDrawObjectTransform`. This test pins the two formulations to the
 * same geometry, so what the user watches during the gesture is exactly what gets committed.
 */
function applyKonvaPreviewAttrs(
  point: readonly [number, number],
  sourceBounds: { x: number; y: number },
  targetBounds: { x: number; y: number },
  scaleX: number,
  scaleY: number,
  rotationDeg: number
): [number, number] {
  const offsetX = sourceBounds.x;
  const offsetY = sourceBounds.y;
  const u = (point[0] - offsetX) * scaleX;
  const v = (point[1] - offsetY) * scaleY;
  const radians = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    targetBounds.x + u * cos - v * sin,
    targetBounds.y + u * sin + v * cos,
  ];
}

function drawElementWithPoints(points: number[]): DrawEl {
  return {
    type: "draw",
    id: "preview-parity-stroke",
    kind: "freehand",
    points,
    strokeWidth: 4,
    stroke: "#16100c",
    opacity: 1,
    hidden: false,
  } as unknown as DrawEl;
}

describe("single-draw live transform preview parity", () => {
  it("Konva wrapper preview attrs land on the exact points the commit bakes", () => {
    const sourceBounds = { x: 100, y: 60, width: 200, height: 80 };
    const targetBounds = { x: 140, y: 90, width: 300, height: 120 };
    const rotationDeg = 27.5;
    const points = [110, 70, 180, 95, 290, 130, 240, 66];

    const baked = planStudioDrawObjectTransform({
      el: drawElementWithPoints(points),
      sourceBounds,
      targetBounds,
      rotationDeg,
    });
    expect(baked).not.toBeNull();

    const scaleX = targetBounds.width / sourceBounds.width;
    const scaleY = targetBounds.height / sourceBounds.height;
    for (let index = 0; index < points.length; index += 2) {
      const previewed = applyKonvaPreviewAttrs(
        [points[index]!, points[index + 1]!],
        sourceBounds,
        targetBounds,
        scaleX,
        scaleY,
        rotationDeg,
      );
      expect(previewed[0]).toBeCloseTo(baked!.points[index]!, 9);
      expect(previewed[1]).toBeCloseTo(baked!.points[index + 1]!, 9);
    }
  });

  it("stays consistent for the identity and pure-drag-like uniform cases", () => {
    const sourceBounds = { x: 0, y: 0, width: 120, height: 40 };
    const points = [10, 5, 60, 30, 110, 35];
    const cases: Array<{
      targetBounds: typeof sourceBounds;
      rotationDeg: number;
    }> = [
      { targetBounds: sourceBounds, rotationDeg: 0 },
      {
        targetBounds: { x: 25, y: -12, width: 240, height: 80 },
        rotationDeg: 0,
      },
      {
        targetBounds: { x: 0, y: 0, width: 60, height: 20 },
        rotationDeg: 0,
      },
    ];
    for (const { targetBounds, rotationDeg } of cases) {
      const baked = planStudioDrawObjectTransform({
        el: drawElementWithPoints(points),
        sourceBounds,
        targetBounds,
        rotationDeg,
      });
      expect(baked).not.toBeNull();
      const scaleX = targetBounds.width / sourceBounds.width;
      const scaleY = targetBounds.height / sourceBounds.height;
      for (let index = 0; index < points.length; index += 2) {
        const previewed = applyKonvaPreviewAttrs(
          [points[index]!, points[index + 1]!],
          sourceBounds,
          targetBounds,
          scaleX,
          scaleY,
          rotationDeg,
        );
        expect(previewed[0]).toBeCloseTo(baked!.points[index]!, 9);
        expect(previewed[1]).toBeCloseTo(baked!.points[index + 1]!, 9);
      }
    }
  });
});
