import { describe, expect, it } from "vitest";

import {
  isStudioVectorEraseTarget,
  planStudioVectorEraseToIntersectionApply,
} from "./studio-vector-erase-to-intersection-apply";

import type { DrawEl, El } from "./studio-element-model";

function pen(id: string, points: number[], strokeWidth = 4, pressures?: number[]): DrawEl {
  return {
    id,
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points,
    stroke: "#111111",
    strokeWidth,
    opacity: 1,
    ...(pressures ? { pressures } : {}),
  };
}

function allocateIds(prefix = "n"): () => string {
  let i = 0;
  return () => `${prefix}${++i}`;
}

describe("isStudioVectorEraseTarget", () => {
  it("accepts freehand pens and rejects eraser / short / shape strokes", () => {
    expect(isStudioVectorEraseTarget(pen("a", [0, 0, 10, 0]))).toBe(true);
    expect(isStudioVectorEraseTarget({ ...pen("a", [0, 0, 10, 0]), mode: "eraser" })).toBe(false);
    expect(isStudioVectorEraseTarget({ ...pen("a", [0, 0, 10, 0]), kind: "rect" as DrawEl["kind"] })).toBe(
      false
    );
    expect(isStudioVectorEraseTarget(pen("a", [0, 0]))).toBe(false);
  });
});

describe("planStudioVectorEraseToIntersectionApply", () => {
  it("erases the middle of a crossed freehand stroke and keeps style on both pieces", () => {
    const horizontal = pen(
      "h",
      [0, 0, 20, 0, 40, 0, 60, 0, 80, 0, 100, 0],
      6,
      [0.2, 0.3, 0.4, 0.5, 0.6, 0.7]
    );
    const vertical = pen("v", [50, -40, 50, 0, 50, 40], 4);
    const elements: El[] = [horizontal, vertical];

    const result = planStudioVectorEraseToIntersectionApply({
      elements,
      point: { x: 80, y: 0 },
      allocateId: allocateIds(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.targetId).toBe("h");
    expect(result.pieceCount).toBe(1);
    const nextH = result.nextElements.find((el) => el.id === "h");
    expect(nextH?.type).toBe("draw");
    if (nextH?.type !== "draw") return;
    expect(nextH.strokeWidth).toBe(6);
    expect(nextH.stroke).toBe("#111111");
    // Overhang past the vertical crossing is gone; left segment remains.
    expect(nextH.points[0]).toBe(0);
    expect(nextH.points[nextH.points.length - 2]).toBeCloseTo(50, 5);
    expect(result.nextElements.some((el) => el.id === "v")).toBe(true);
  });

  it("splits a stroke when the hit sits between two intersections", () => {
    const target = pen("t", [0, 0, 30, 0, 50, 0, 70, 0, 100, 0], 4);
    const left = pen("l", [30, -20, 30, 20], 2);
    const right = pen("r", [70, -20, 70, 20], 2);

    const result = planStudioVectorEraseToIntersectionApply({
      elements: [target, left, right],
      point: { x: 50, y: 0 },
      allocateId: allocateIds("split"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pieceCount).toBe(2);
    const ids = result.nextElements.filter((el) => el.type === "draw").map((el) => el.id);
    expect(ids).toContain("t");
    expect(ids).toContain("split1");
    expect(ids).toContain("l");
    expect(ids).toContain("r");
  });

  it("deletes the whole stroke when there are no intersections", () => {
    const lonely = pen("solo", [0, 0, 40, 0, 80, 0], 5);
    const result = planStudioVectorEraseToIntersectionApply({
      elements: [lonely],
      point: { x: 40, y: 0 },
      allocateId: allocateIds(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pieceCount).toBe(0);
    expect(result.nextElements).toEqual([]);
  });

  it("respects isEditable and still uses non-editable strokes as cut geometry", () => {
    const target = pen("h", [0, 0, 50, 0, 100, 0], 4);
    const lockedCross = pen("lock", [50, -30, 50, 30], 4);
    const result = planStudioVectorEraseToIntersectionApply({
      elements: [target, lockedCross],
      point: { x: 80, y: 0 },
      allocateId: allocateIds(),
      isEditable: (el) => el.id !== "lock",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.targetId).toBe("h");
    const next = result.nextElements.find((el) => el.id === "h");
    expect(next?.type).toBe("draw");
    if (next?.type !== "draw") return;
    expect(next.points[next.points.length - 2]).toBeCloseTo(50, 5);
    expect(result.nextElements.some((el) => el.id === "lock")).toBe(true);
  });

  it("fails closed when the pointer misses every freehand pen", () => {
    const result = planStudioVectorEraseToIntersectionApply({
      elements: [pen("h", [0, 0, 100, 0], 2)],
      point: { x: 50, y: 40 },
      allocateId: allocateIds(),
      hitPaddingPx: 0,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/선/);
  });
});
