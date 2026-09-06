import { describe, expect, it } from "vitest";

import {
  planStudioGpuDabSpatialBins,
  STUDIO_GPU_DAB_SPATIAL_FLOATS,
  type PlannedStudioGpuDabSpatialBins,
  type StudioGpuDabSpatialTile,
} from "./studio-webgpu-dab-spatial-bins";

import type { StudioGpuDab } from "./studio-webgpu-dab-plan-contract";

function dab(overrides: Partial<StudioGpuDab> = {}): StudioGpuDab {
  return {
    x: 5,
    y: 5,
    radius: 1,
    red: 0.2,
    green: 0.4,
    blue: 0.8,
    alpha: 0.6,
    composite: "normal",
    ...overrides,
  };
}

function tile(
  id: string,
  x: number,
  y: number,
  width = 10,
  height = 10
): StudioGpuDabSpatialTile {
  return { id, x, y, width, height };
}

function expectPlanned(
  result: ReturnType<typeof planStudioGpuDabSpatialBins>
): asserts result is PlannedStudioGpuDabSpatialBins {
  expect(result.status).toBe("planned");
}

function membersFor(
  plan: PlannedStudioGpuDabSpatialBins,
  tileIndex: number
): number[] {
  return Array.from(plan.members.slice(
    plan.tileOffsets[tileIndex],
    plan.tileOffsets[tileIndex + 1]
  ));
}

function intersects(dabValue: StudioGpuDab, tileValue: StudioGpuDabSpatialTile): boolean {
  const nearestX = Math.min(
    tileValue.x + tileValue.width,
    Math.max(tileValue.x, dabValue.x)
  );
  const nearestY = Math.min(
    tileValue.y + tileValue.height,
    Math.max(tileValue.y, dabValue.y)
  );
  const dx = dabValue.x - nearestX;
  const dy = dabValue.y - nearestY;
  return Math.hypot(dx, dy) <= dabValue.radius;
}

describe("Studio WebGPU frame-level dab spatial bins", () => {
  it("packs dabs once and preserves stable duplicate/composite order in every touching tile", () => {
    const dabs = [
      dab({ x: 5, y: 5, composite: "normal" }),
      dab({ x: 10, y: 5, radius: 0, alpha: 0.75 }),
      dab({ x: 15, y: 5 }),
      dab({ x: 5, y: 5, composite: "erase" }),
    ];
    const result = planStudioGpuDabSpatialBins(
      dabs,
      [tile("left", 0, 0), tile("right", 10, 0)]
    );
    expectPlanned(result);

    expect(result.tileIds).toEqual(["left", "right"]);
    expect(Array.from(result.tileOffsets)).toEqual([0, 3, 5]);
    expect(Array.from(result.members)).toEqual([0, 1, 3, 1, 2]);
    expect(membersFor(result, 0)).toEqual([0, 1, 3]);
    expect(membersFor(result, 1)).toEqual([1, 2]);
    expect(result.packedDabs).toHaveLength(dabs.length * STUDIO_GPU_DAB_SPATIAL_FLOATS);
    expect(result.packedDabs[0]).toBe(Math.fround(dabs[0]!.x));
    expect(result.packedDabs[6]).toBeCloseTo(Math.fround(dabs[0]!.alpha));
    expect(result.packedDabs[7]).toBe(0);
    expect(result.packedDabs[3 * STUDIO_GPU_DAB_SPATIAL_FLOATS + 7]).toBe(1);
  });

  it("uses an exact closed circle/rectangle test at edges and diagonal tangency", () => {
    const target = tile("target", 0, 0);
    const tangent = dab({ x: 13, y: 14, radius: 5 });
    const outside = dab({ x: 13, y: 14.000_001, radius: 5 });
    const zeroRadiusCorner = dab({ x: 10, y: 10, radius: 0 });
    const result = planStudioGpuDabSpatialBins(
      [tangent, outside, zeroRadiusCorner],
      [target]
    );
    expectPlanned(result);

    expect(membersFor(result, 0)).toEqual([0, 2]);
  });

  it("reuses one caller scratch with deterministic typed offsets and exact byte accounting", () => {
    const dabs = [dab(), dab({ x: 15 })];
    const tiles = [tile("left", 0, 0), tile("right", 10, 0)];
    const first = planStudioGpuDabSpatialBins(dabs, tiles);
    expectPlanned(first);
    const scratch = new ArrayBuffer(first.byteLength + 256);
    const second = planStudioGpuDabSpatialBins(dabs, tiles, { scratch });
    expectPlanned(second);

    expect(second.buffer).toBe(scratch);
    expect(second.packedDabs.buffer).toBe(scratch);
    expect(second.tileOffsets.buffer).toBe(scratch);
    expect(second.members.buffer).toBe(scratch);
    expect(second.byteLength).toBe(
      second.packedDabs.byteLength
      + second.tileOffsets.byteLength
      + second.members.byteLength
    );
    expect(Array.from(second.packedDabs)).toEqual(Array.from(first.packedDabs));
    expect(Array.from(second.tileOffsets)).toEqual(Array.from(first.tileOffsets));
    expect(Array.from(second.members)).toEqual(Array.from(first.members));
  });

  it("fails closed at every public budget without mutating rejected caller scratch", () => {
    const dabs = [dab({ x: 5 }), dab({ x: 10, radius: 2 })];
    const tiles = [tile("left", 0, 0), tile("right", 10, 0)];
    const accepted = planStudioGpuDabSpatialBins(dabs, tiles);
    expectPlanned(accepted);
    expect(planStudioGpuDabSpatialBins(dabs, tiles, {
      maximumMembers: accepted.memberCount,
      maximumBytes: accepted.byteLength,
    }).status).toBe("planned");

    expect(planStudioGpuDabSpatialBins(dabs, tiles, { maximumDabs: 1 })).toEqual({
      status: "rejected",
      reason: "dab-budget-exceeded",
    });
    expect(planStudioGpuDabSpatialBins(dabs, tiles, { maximumTiles: 1 })).toEqual({
      status: "rejected",
      reason: "tile-budget-exceeded",
    });
    expect(planStudioGpuDabSpatialBins(dabs, tiles, { maximumMembers: 1 })).toEqual({
      status: "rejected",
      reason: "member-budget-exceeded",
    });
    expect(planStudioGpuDabSpatialBins(dabs, tiles, {
      maximumBytes: accepted.byteLength - 1,
    })).toEqual({
      status: "rejected",
      reason: "byte-budget-exceeded",
    });
    expect(planStudioGpuDabSpatialBins(dabs, tiles, {
      maximumDabs: -1,
    })).toEqual({
      status: "rejected",
      reason: "invalid-options",
    });
    expect(planStudioGpuDabSpatialBins(dabs, tiles, {
      maximumMembers: 0x1_0000_0000,
    })).toEqual({
      status: "rejected",
      reason: "invalid-options",
    });

    const scratch = new ArrayBuffer(accepted.byteLength);
    new Uint8Array(scratch).fill(0x7b);
    expect(planStudioGpuDabSpatialBins(dabs, tiles, {
      maximumMembers: 0,
      scratch,
    })).toEqual({
      status: "rejected",
      reason: "member-budget-exceeded",
    });
    expect(new Uint8Array(scratch).every((value) => value === 0x7b)).toBe(true);
  });

  it("rejects malformed dabs, rectangles, composites, and duplicate tile identities", () => {
    expect(planStudioGpuDabSpatialBins([
      dab({ radius: Number.NaN }),
    ], [tile("tile", 0, 0)])).toEqual({
      status: "rejected",
      reason: "invalid-input",
    });
    expect(planStudioGpuDabSpatialBins([dab()], [
      tile("tile", 0, 0, 0),
    ])).toEqual({
      status: "rejected",
      reason: "invalid-input",
    });
    expect(planStudioGpuDabSpatialBins([dab()], [
      tile("duplicate", 0, 0),
      tile("duplicate", 10, 0),
    ])).toEqual({
      status: "rejected",
      reason: "invalid-input",
    });
    expect(planStudioGpuDabSpatialBins([{
      ...dab(),
      composite: "source-over",
    } as unknown as StudioGpuDab], [tile("tile", 0, 0)])).toEqual({
      status: "rejected",
      reason: "invalid-input",
    });
    const hostileScratch = new Proxy({} as ArrayBufferLike, {
      get() {
        throw new Error("detached or hostile scratch");
      },
    });
    expect(planStudioGpuDabSpatialBins([dab()], [tile("tile", 0, 0)], {
      scratch: hostileScratch,
    })).toEqual({
      status: "rejected",
      reason: "allocation-failed",
    });
  });

  it("bins a 50k corpus exactly in source order without scanning every dab for every tile", () => {
    const dabCount = 50_000;
    const tileCount = 64;
    const dabs = Array.from({ length: dabCount }, (_, index) => dab({
      x: index * 0.6,
      y: 32 + Math.sin(index / 31) * 12,
      radius: 2 + (index % 5) * 0.2,
      alpha: 0.3 + (index % 7) * 0.07,
      composite: index % 97 === 0 ? "erase" : "normal",
    }));
    const tiles = Array.from({ length: tileCount }, (_, index) => tile(
      `tile:${index}`,
      index * 512,
      0,
      516,
      128
    ));

    const startedAt = performance.now();
    const result = planStudioGpuDabSpatialBins(dabs, tiles);
    const elapsedMs = performance.now() - startedAt;
    expectPlanned(result);

    for (let tileIndex = 0; tileIndex < tiles.length; tileIndex += 1) {
      const expected: number[] = [];
      for (let dabIndex = 0; dabIndex < dabs.length; dabIndex += 1) {
        if (intersects(dabs[dabIndex]!, tiles[tileIndex]!)) expected.push(dabIndex);
      }
      expect(membersFor(result, tileIndex)).toEqual(expected);
    }
    expect(result.sourceDabCount).toBe(dabCount);
    expect(result.memberCount).toBeGreaterThan(dabCount);
    expect(result.memberCount).toBeLessThan(dabCount * 1.1);
    expect(result.members.every((dabIndex) => dabIndex < dabCount)).toBe(true);
    // Loose guard: exact membership/order above is normative; this only catches an accidental
    // regression to an obviously quadratic all-dab × all-tile hot path.
    expect(elapsedMs).toBeLessThan(1_500);
  });
});
