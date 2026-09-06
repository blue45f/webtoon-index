import { describe, expect, it, vi } from "vitest";

import {
  fillStudioPixelPencilCells,
  isStudioPixelPencilRenderMode,
  packStudioPixelPencilCells,
  planStudioPixelPencilCells,
  shouldAppendStudioPixelPencilSample,
  studioPixelPencilCellAt,
  STUDIO_PIXEL_PENCIL_MAX_ABS_CELL,
  STUDIO_PIXEL_PENCIL_RENDER_MODE,
} from "./studio-pixel-pencil";

function expectEightConnected(cells: readonly { x: number; y: number }[]): void {
  for (let index = 1; index < cells.length; index += 1) {
    const previous = cells[index - 1]!;
    const current = cells[index]!;
    expect(Math.max(Math.abs(current.x - previous.x), Math.abs(current.y - previous.y))).toBe(1);
  }
}

describe("studio pixel pencil", () => {
  it("owns one exact versioned render-mode identifier", () => {
    expect(STUDIO_PIXEL_PENCIL_RENDER_MODE).toBe("pixel-grid-v1");
    expect(isStudioPixelPencilRenderMode("pixel-grid-v1")).toBe(true);
    expect(isStudioPixelPencilRenderMode("pixel-grid-v2")).toBe(false);
    expect(isStudioPixelPencilRenderMode({ mode: "pixel-grid-v1" })).toBe(false);
  });

  it("maps a document point to the containing integer cell", () => {
    expect(studioPixelPencilCellAt(4.99, 7.01)).toEqual({ x: 4, y: 7 });
    expect(studioPixelPencilCellAt(Number.NaN, 1)).toBeNull();
    expect(planStudioPixelPencilCells({ points: [4.99, 7.01] })).toMatchObject({
      complete: true,
      reason: null,
      sourcePointPairs: 1,
      cells: [{ x: 4, y: 7 }],
    });
    expect(planStudioPixelPencilCells({ points: [-0.01, -1] }).cells).toEqual([
      { x: -1, y: -1 },
    ]);
  });

  it("accepts short moves that cross a pixel boundary and rejects motion within one cell", () => {
    expect(shouldAppendStudioPixelPencilSample({
      lastX: 0.9,
      lastY: 2.1,
      nextX: 1.1,
      nextY: 2.1,
    })).toBe(true);
    expect(shouldAppendStudioPixelPencilSample({
      lastX: 0.1,
      lastY: 2.1,
      nextX: 0.9,
      nextY: 2.9,
    })).toBe(false);
  });

  it("fills horizontal and vertical gaps between sparse pointer samples", () => {
    expect(planStudioPixelPencilCells({ points: [1.1, 2.8, 5.9, 2.2] }).cells).toEqual([
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      { x: 5, y: 2 },
    ]);
    expect(planStudioPixelPencilCells({ points: [3, 3, 3, -1] }).cells).toEqual([
      { x: 3, y: 3 },
      { x: 3, y: 2 },
      { x: 3, y: 1 },
      { x: 3, y: 0 },
      { x: 3, y: -1 },
    ]);
  });

  it("uses a one-cell-weight, hole-free Bresenham staircase for diagonals", () => {
    const diagonal = planStudioPixelPencilCells({ points: [0.2, 0.7, 6.8, 6.1] });
    expect(diagonal.cells).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
      { x: 4, y: 4 },
      { x: 5, y: 5 },
      { x: 6, y: 6 },
    ]);
    expectEightConnected(diagonal.cells);

    const shallow = planStudioPixelPencilCells({ points: [0, 0, 6, 3] });
    expect(shallow.cells).toHaveLength(7);
    expectEightConnected(shallow.cells);
    expect(shallow.cells[0]).toEqual({ x: 0, y: 0 });
    expect(shallow.cells.at(-1)).toEqual({ x: 6, y: 3 });
  });

  it("globally removes duplicate cells while preserving first-visit order", () => {
    const plan = planStudioPixelPencilCells({
      points: [0.1, 0.1, 0.8, 0.9, 3.2, 0.2, 0.2, 0.7, 3.8, 0.3],
    });

    expect(plan.cells).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
    expect(new Set(plan.cells.map((cell) => `${cell.x},${cell.y}`)).size).toBe(plan.cells.length);
    expect(plan.cellVisits).toBeGreaterThan(plan.cells.length);
  });

  it("accepts numeric typed arrays and never mutates source samples", () => {
    const points = new Float32Array([0.25, 1.75, 2.75, 1.25]);
    const before = [...points];

    const first = planStudioPixelPencilCells({ points });
    const second = planStudioPixelPencilCells({ points });

    expect(first).toEqual(second);
    expect([...points]).toEqual(before);
    expect(first.cells).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ]);
  });

  it.each([
    { name: "non-array", points: { 0: 1, 1: 2, length: 2 }, reason: "invalid-points" },
    { name: "odd coordinate count", points: [0, 1, 2], reason: "invalid-points" },
    { name: "NaN", points: [0, 0, Number.NaN, 1], reason: "invalid-coordinate" },
    { name: "infinity", points: [0, 0, Number.POSITIVE_INFINITY, 1], reason: "invalid-coordinate" },
    {
      name: "unsafe WebGPU coordinate",
      points: [STUDIO_PIXEL_PENCIL_MAX_ABS_CELL + 1, 0],
      reason: "coordinate-out-of-range",
    },
  ])("fails closed for $name", ({ points, reason }) => {
    expect(planStudioPixelPencilCells({ points })).toMatchObject({
      complete: false,
      reason,
      cells: [],
    });
  });

  it("rejects malformed limits instead of silently accepting an unbounded job", () => {
    expect(planStudioPixelPencilCells({ points: [0, 0], maximumCells: Number.POSITIVE_INFINITY }))
      .toMatchObject({ complete: false, reason: "invalid-limits", cells: [] });
    expect(planStudioPixelPencilCells({ points: [0, 0], maximumPointPairs: -1 }))
      .toMatchObject({ complete: false, reason: "invalid-limits", cells: [] });
    expect(planStudioPixelPencilCells({ points: [0, 0], maximumCellVisits: 0.5 }))
      .toMatchObject({ complete: false, reason: "invalid-limits", cells: [] });
  });

  it("rejects oversized source streams before planning geometry", () => {
    expect(planStudioPixelPencilCells({
      points: [0, 0, 1, 1, 2, 2],
      maximumPointPairs: 2,
    })).toMatchObject({
      complete: false,
      reason: "point-budget-exceeded",
      cells: [],
      sourcePointPairs: 3,
      cellVisits: 0,
    });
  });

  it("stops at the unique-cell cap and exposes only a bounded safe prefix", () => {
    const plan = planStudioPixelPencilCells({
      points: [0, 0, 100_000, 0],
      maximumCells: 4,
    });

    expect(plan).toMatchObject({
      complete: false,
      reason: "cell-budget-exceeded",
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
      ],
    });
    expect(plan.cells).toHaveLength(4);
  });

  it("caps repeated overlapping work even when de-duplication keeps the output tiny", () => {
    const plan = planStudioPixelPencilCells({
      points: [0, 0, 50, 0, 0, 0, 50, 0, 0, 0],
      maximumCells: 1_000,
      maximumCellVisits: 60,
    });

    expect(plan.complete).toBe(false);
    expect(plan.reason).toBe("work-budget-exceeded");
    expect(plan.cellVisits).toBe(60);
    expect(plan.cells.length).toBeLessThanOrEqual(51);
  });

  it("emits direct fillRect cells and interleaved WebGPU coordinates", () => {
    const cells = [
      { x: -1, y: 2 },
      { x: 0, y: 2 },
      { x: 1, y: 3 },
    ] as const;
    const context = { fillRect: vi.fn() };

    fillStudioPixelPencilCells(context, cells);

    expect(context.fillRect.mock.calls).toEqual([
      [-1, 2, 1, 1],
      [0, 2, 1, 1],
      [1, 3, 1, 1],
    ]);
    expect(packStudioPixelPencilCells(cells)).toEqual(new Int32Array([-1, 2, 0, 2, 1, 3]));
  });
});
