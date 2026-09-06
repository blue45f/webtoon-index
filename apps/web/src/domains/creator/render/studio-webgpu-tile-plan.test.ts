import { describe, expect, it } from "vitest";

import {
  STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
  STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3,
  STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2,
} from "../brush/studio-ink-pressure-model";

import {
  boundsForStudioGpuStroke,
  diffStudioGpuTileStates,
  fingerprintStudioGpuStroke,
  planStudioGpuTileStates,
  planVisibleStudioGpuTiles,
} from "./studio-webgpu-tile-plan";

import type { StudioGpuStroke } from "./studio-webgpu-stroke";

function stroke(overrides: Partial<StudioGpuStroke> = {}): StudioGpuStroke {
  return {
    id: "stroke-1",
    points: [40, 40, 120, 40],
    pressures: [0.5, 0.8],
    color: "#7c5cff",
    size: 12,
    opacity: 1,
    composite: "normal",
    ...overrides,
  };
}

const DOCUMENT = { logicalWidth: 800, logicalHeight: 4_000 } as const;

describe("studio WebGPU tile planning", () => {
  it("covers boundary-crossing pressure dabs with stable 512px partial tiles", () => {
    const crossing = stroke({
      points: [500, 120, 520, 120],
      pressures: [1, 1],
      size: 20,
    });
    const bounds = boundsForStudioGpuStroke(crossing);
    const states = planStudioGpuTileStates([crossing], DOCUMENT);

    expect(bounds).toMatchObject({ x: 481, y: 101, width: 58, height: 38 });
    expect(states.map((state) => state.id)).toEqual(["0:0", "1:0"]);
    expect(states[0]).toMatchObject({ width: 512, height: 512 });
    expect(states[1]).toMatchObject({ x: 512, width: 288, height: 512 });
    expect(states.every((state) => state.operations[0]?.id === crossing.id)).toBe(true);
  });

  it("uses zero-radius linear pressure in bounds and operation identity", () => {
    const linear = stroke({
      points: [40, 40],
      pressures: [0],
      size: 10,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
    });
    const legacy = { ...linear, pressureModel: undefined };

    expect(boundsForStudioGpuStroke(linear)).toEqual({
      x: 38,
      y: 38,
      width: 4,
      height: 4,
    });
    expect(boundsForStudioGpuStroke(legacy)).toEqual({
      x: 36.5,
      y: 36.5,
      width: 7,
      height: 7,
    });
    expect(fingerprintStudioGpuStroke(linear)).not.toBe(fingerprintStudioGpuStroke(legacy));
    expect(diffStudioGpuTileStates(
      planStudioGpuTileStates([legacy], DOCUMENT),
      planStudioGpuTileStates([linear], DOCUMENT)
    )[0]?.mode).toBe("rebuild");
  });

  it("includes residual V2 backtrack overshoot in adjacent tile coverage", () => {
    const residual = stroke({
      points: [522, 120, 527, 120, 522, 120],
      pressures: [1, 1, 1],
      size: 16,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2,
    });
    const bounds = boundsForStudioGpuStroke(residual);
    const states = planStudioGpuTileStates([residual], DOCUMENT);

    expect(bounds?.x).toBeCloseTo(508.8, 12);
    expect(bounds?.width).toBeCloseTo(26.4, 12);
    expect(bounds).toMatchObject({ y: 110, height: 20 });
    expect(states.map(({ id }) => id)).toEqual(["0:0", "1:0"]);
  });

  it("binds V3 path-phase geometry to distinct tile identity without chord overshoot", () => {
    const common = {
      points: [500, 120, 504, 120, 504, 124, 508, 124],
      pressures: [1, 1, 1, 1],
      size: 16,
    } as const;
    const v2 = stroke({
      ...common,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2,
    });
    const v3 = stroke({
      ...common,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3,
    });
    const bounds = boundsForStudioGpuStroke(v3)!;

    expect(fingerprintStudioGpuStroke(v3)).not.toBe(fingerprintStudioGpuStroke(v2));
    expect(bounds.x).toBe(490);
    expect(bounds.y).toBe(110);
    expect(bounds.x + bounds.width).toBeCloseTo(515.6, 12);
    expect(bounds.y + bounds.height).toBe(134);
    expect(diffStudioGpuTileStates(
      planStudioGpuTileStates([v2], DOCUMENT),
      planStudioGpuTileStates([v3], DOCUMENT)
    ).every(({ mode }) => mode === "rebuild")).toBe(true);
  });

  it("keeps cap-exceeding residual V2 strokes in tile tasks for fail-closed rendering", () => {
    const oversized = stroke({
      points: [0, 120, 50_001, 120],
      pressures: [1, 1],
      size: 1,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2,
    });
    const bounds = boundsForStudioGpuStroke(oversized);
    const states = planStudioGpuTileStates([oversized], DOCUMENT);

    expect(bounds).not.toBeNull();
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((state) => state.operations.some(({ id }) => id === oversized.id))).toBe(true);
  });

  it("selects only viewport tiles and one-row overscan for a very tall document", () => {
    const visible = planVisibleStudioGpuTiles({
      ...DOCUMENT,
      viewBox: { x: 0, y: 1_200, width: 800, height: 600 },
      overscanRows: 1,
      overscanColumns: 0,
    });

    expect(visible.map((tile) => tile.id)).toEqual([
      "0:1", "1:1",
      "0:2", "1:2",
      "0:3", "1:3",
      "0:4", "1:4",
    ]);
    expect(visible).toHaveLength(8);
    expect(visible.every((tile) => tile.y < 2_560)).toBe(true);
    expect(visible.some((tile) => tile.row === 0)).toBe(false);
  });

  it("keeps exact logs clean and appends an immutable per-tile suffix", () => {
    const first = stroke({ id: "first", orderKey: "a" });
    const second = stroke({
      id: "second",
      orderKey: "b",
      points: [180, 40, 220, 40],
    });
    const previous = planStudioGpuTileStates([first], DOCUMENT);
    const unchanged = diffStudioGpuTileStates(
      previous,
      planStudioGpuTileStates([{ ...first }], DOCUMENT)
    );
    const appended = diffStudioGpuTileStates(
      previous,
      planStudioGpuTileStates([first, second], DOCUMENT)
    );

    expect(unchanged).toEqual([
      expect.objectContaining({ mode: "clean", operations: [] }),
    ]);
    expect(appended).toEqual([
      expect.objectContaining({
        mode: "append",
        previousOperationCount: 1,
        nextOperationCount: 2,
        operations: [expect.objectContaining({ id: "second" })],
      }),
    ]);
  });

  it("treats an exact terminal live-stroke point suffix as an append", () => {
    const initial = stroke({
      points: [20, 40, 80, 40],
      pressures: [0.4, 0.6],
    });
    const extended = stroke({
      points: [20, 40, 80, 40, 140, 42],
      pressures: [0.4, 0.6, 0.8],
    });
    const previous = planStudioGpuTileStates([initial], DOCUMENT);
    const [update] = diffStudioGpuTileStates(
      previous,
      planStudioGpuTileStates([extended], DOCUMENT)
    );

    expect(update).toMatchObject({
      mode: "append",
      previousOperationCount: 1,
      nextOperationCount: 1,
      operations: [expect.objectContaining({ id: initial.id, pointCount: 3 })],
      strokeExtension: {
        previous: expect.objectContaining({ pointCount: 2 }),
        next: expect.objectContaining({ pointCount: 3 }),
      },
    });

    const changedPressurePrefix = stroke({
      ...extended,
      pressures: [0.4, 0.65, 0.8],
    });
    const changedPressureUpdate = diffStudioGpuTileStates(
      previous,
      planStudioGpuTileStates([changedPressurePrefix], DOCUMENT)
    )[0]!;
    expect(changedPressureUpdate.mode).toBe("rebuild");
    expect(changedPressureUpdate.strokeExtension).toBeUndefined();
  });

  it("rebuilds changed, deleted, and reordered old/new tile coverage without touching other tiles", () => {
    const stationary = stroke({ id: "stationary", orderKey: "a", points: [40, 700, 80, 700] });
    const moving = stroke({ id: "moving", orderKey: "b", points: [40, 40, 80, 40] });
    const previous = planStudioGpuTileStates([stationary, moving], DOCUMENT);
    const moved = stroke({
      ...moving,
      color: "#ff3366",
      points: [40, 1_100, 80, 1_100],
    });
    const updates = diffStudioGpuTileStates(
      previous,
      planStudioGpuTileStates([stationary, moved], DOCUMENT)
    );

    expect(updates.map(({ tile, mode }) => [tile.id, mode])).toEqual([
      ["0:0", "rebuild"],
      ["0:1", "clean"],
      ["0:2", "append"],
    ]);
    expect(updates.find((update) => update.tile.id === "0:0")?.operations).toEqual([]);

    const front = stroke({ id: "front", orderKey: "a", points: [40, 40, 80, 40] });
    const back = stroke({ id: "back", orderKey: "b", points: [90, 40, 130, 40] });
    const beforeReorder = planStudioGpuTileStates([front, back], DOCUMENT);
    const afterReorder = planStudioGpuTileStates([
      { ...front, orderKey: "z" },
      { ...back, orderKey: "a" },
    ], DOCUMENT);
    expect(diffStudioGpuTileStates(beforeReorder, afterReorder)[0]).toMatchObject({
      mode: "rebuild",
      previousOperationCount: 2,
      nextOperationCount: 2,
    });
  });

  it("fingerprints every render-affecting value deterministically", () => {
    const base = stroke();
    expect(fingerprintStudioGpuStroke(base)).toBe(fingerprintStudioGpuStroke({ ...base }));
    expect(fingerprintStudioGpuStroke({ ...base, opacity: 0.5 })).not.toBe(
      fingerprintStudioGpuStroke(base)
    );
    expect(fingerprintStudioGpuStroke({ ...base, pressures: [0.5, 0.9] })).not.toBe(
      fingerprintStudioGpuStroke(base)
    );
    expect(fingerprintStudioGpuStroke({ ...base, orderKey: "after" })).not.toBe(
      fingerprintStudioGpuStroke(base)
    );
    expect(fingerprintStudioGpuStroke({
      ...base,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
    })).not.toBe(fingerprintStudioGpuStroke(base));
  });

  it("rebuilds when document, partial-tile, tile-size, or bleed geometry changes", () => {
    const edge = stroke({ points: [700, 40, 760, 40] });
    const previous = planStudioGpuTileStates([edge], {
      logicalWidth: 800,
      logicalHeight: 1_200,
    });
    const wider = planStudioGpuTileStates([edge], {
      logicalWidth: 900,
      logicalHeight: 1_200,
    });
    const differentBleed = planStudioGpuTileStates([edge], {
      logicalWidth: 800,
      logicalHeight: 1_200,
      bleed: 4,
    });
    const differentTileSize = planStudioGpuTileStates([edge], {
      logicalWidth: 800,
      logicalHeight: 1_200,
      tileSize: 400,
    });

    expect(diffStudioGpuTileStates(previous, wider)).toEqual([
      expect.objectContaining({ mode: "rebuild", tile: expect.objectContaining({ width: 388 }) }),
    ]);
    expect(diffStudioGpuTileStates(previous, differentBleed)[0]?.mode).toBe("rebuild");
    expect(diffStudioGpuTileStates(previous, differentTileSize).some(
      (update) => update.mode === "rebuild"
    )).toBe(true);
  });

  it("uses an exact signature when two different operations collide in the fast hash", () => {
    const previousStroke: StudioGpuStroke = {
      id: "same-id",
      points: [0, 0, 138, 254],
      pressures: [0.5, 0.5],
      color: "#d1972e",
      size: 19,
    };
    const collidingStroke: StudioGpuStroke = {
      id: "same-id",
      points: [0, 0, 601, 158],
      pressures: [0.5, 0.43],
      color: "#805a9e",
      size: 2,
    };
    expect(fingerprintStudioGpuStroke(previousStroke)).toBe(
      fingerprintStudioGpuStroke(collidingStroke)
    );

    const updates = diffStudioGpuTileStates(
      planStudioGpuTileStates([previousStroke], DOCUMENT),
      planStudioGpuTileStates([collidingStroke], DOCUMENT)
    );
    expect(updates.find((update) => update.tile.id === "0:0")?.mode).toBe("rebuild");
  });
});
