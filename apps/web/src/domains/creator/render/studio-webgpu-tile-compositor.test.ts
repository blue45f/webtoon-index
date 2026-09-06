import { describe, expect, it } from "vitest";

import { STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1 } from "../brush/studio-ink-pressure-model";
import { studioHighBitSrgbToLinear } from "../studio-highbit-transfer";

import {
  planStudioGpuDabs,
  planStudioGpuDabsInRect,
  planStudioGpuStrokeExtensionInRect,
} from "./studio-webgpu-dab-planner";
import {
  STUDIO_GPU_STROKE_FEED_REVISION,
  type StudioGpuStroke,
} from "./studio-webgpu-stroke";
import {
  advanceStudioGpuStrokeFeedCompact,
  createStudioGpuStrokeFeedCompactBaseline,
} from "./studio-webgpu-stroke-feed";
import {
  packStudioGpuTileDabs,
  planStudioGpuTilePresentation,
  planStudioGpuVisibleTileFrame,
  resolveStudioGpuTileTasks,
  STUDIO_GPU_DAB_INSTANCE_FLOATS,
  studioGpuLogicalViewBox,
} from "./studio-webgpu-tile-compositor";
import {
  diffStudioGpuTileStates,
  fingerprintStudioGpuStroke,
  planStudioGpuTileStates,
  signatureStudioGpuStroke,
  type StudioGpuTile,
} from "./studio-webgpu-tile-plan";

import type {
  StudioGpuTileCompositeFrame,
  StudioGpuTileRenderTask,
  StudioGpuTileTextureDescriptor,
} from "./studio-webgpu-tile-runtime";

const VIEWPORT = {
  logicalWidth: 1_024,
  logicalHeight: 4_096,
  scaleX: 1,
  scaleY: 2,
  offsetX: 0,
  offsetY: -2_048,
  flipX: false,
} as const;

function stroke(overrides: Partial<StudioGpuStroke> = {}): StudioGpuStroke {
  return {
    id: "ink",
    points: [500, 1_200, 540, 1_200],
    pressures: [0.5, 1],
    color: "#ff3366",
    size: 12,
    opacity: 0.8,
    ...overrides,
  };
}

function tile(): StudioGpuTile {
  return { id: "0:2", column: 0, row: 2, x: 0, y: 1_024, width: 512, height: 512 };
}

function descriptor(): StudioGpuTileTextureDescriptor {
  return {
    id: "0:2",
    label: "tile",
    width: 516,
    height: 516,
    contentX: 2,
    contentY: 2,
    contentWidth: 512,
    contentHeight: 512,
    byteLength: 516 * 516 * 4,
    renderX: -2,
    renderY: 1_022,
    renderWidth: 516,
    renderHeight: 516,
  };
}

function task(
  current: StudioGpuStroke,
  overrides: Partial<StudioGpuTileRenderTask<{ id: string }>> = {}
): StudioGpuTileRenderTask<{ id: string }> {
  return {
    id: "frame:0:2:1",
    frameId: "frame",
    deviceGeneration: 1,
    tile: tile(),
    descriptor: descriptor(),
    resource: { id: "texture" },
    mode: "rebuild",
    operations: [{
      id: current.id,
      fingerprint: fingerprintStudioGpuStroke(current),
      signature: signatureStudioGpuStroke(current),
    }],
    previousOperationCount: 0,
    nextOperationCount: 1,
    ...overrides,
  };
}

describe("studio WebGPU tile compositor planning", () => {
  it("inverts zoom, pan, and horizontal flip into a bounded logical viewport", () => {
    expect(studioGpuLogicalViewBox(VIEWPORT)).toEqual({
      x: 0,
      y: 1_024,
      width: 1_024,
      height: 2_048,
    });
    expect(studioGpuLogicalViewBox({
      ...VIEWPORT,
      scaleX: 2,
      offsetX: -512,
      flipX: true,
    })).toEqual({
      x: 256,
      y: 1_024,
      width: 512,
      height: 2_048,
    });
  });

  it("plans only viewport tiles plus bounded overscan for a tall document", () => {
    const planned = planStudioGpuVisibleTileFrame([
      stroke(),
      stroke({ id: "far-offscreen", points: [20, 3_900, 80, 3_900] }),
    ], VIEWPORT);

    expect(planned.viewBox).toEqual({ x: 0, y: 1_024, width: 1_024, height: 2_048 });
    expect(planned.visibleTiles[0]).toMatchObject({ id: "0:1", row: 1 });
    expect(planned.visibleTiles.at(-1)).toMatchObject({ id: "1:6", row: 6 });
    expect(planned.visibleTiles.some(({ row }) => row === 0 || row === 7)).toBe(false);
    expect(planned.tileStates.map(({ id }) => id)).toEqual(["0:2", "1:2"]);
    expect(planned.tileStates.flatMap(({ operations }) => operations.map(({ id }) => id)))
      .not.toContain("far-offscreen");
  });

  it("resolves exact immutable operations and packs dabs in tile-local bleed coordinates", () => {
    const current = stroke();
    const resolved = resolveStudioGpuTileTasks(
      [task(current)],
      [current],
      planStudioGpuDabsInRect,
      100_000
    );

    expect(resolved).not.toBeNull();
    expect(resolved!.dabCount).toBeGreaterThan(2);
    const packed = packStudioGpuTileDabs(resolved!);
    expect(packed).toHaveLength(resolved!.dabCount * STUDIO_GPU_DAB_INSTANCE_FLOATS);
    expect(packed[0]).toBeCloseTo(((500 - (-2)) / 516) * 2 - 1);
    expect(packed[1]).toBeCloseTo(1 - ((1_200 - 1_022) / 516) * 2);
    expect(packed[2]).toBeGreaterThan(0);
    expect(packed[7]).toBeCloseTo(0.8);
    expect(packed[4]).toBeCloseTo(studioHighBitSrgbToLinear(1) * 0.8);
    expect(packed[5]).toBeCloseTo(studioHighBitSrgbToLinear(0x33 / 255) * 0.8);
    expect(packed[6]).toBeCloseTo(studioHighBitSrgbToLinear(0x66 / 255) * 0.8);
    // The tile fixture's descriptor is 516 physical px over a 516-unit render rect, so one
    // physical texel is exactly one logical unit -- the quad radius packed at slot 2 must exceed
    // the analytic (nominal) radius recovered from slot 8's ratio by exactly that one-texel margin.
    const quadRadius = (packed[2]! * 516) / 2;
    const nominalRadiusRatio = packed[8]!;
    expect(nominalRadiusRatio).toBeGreaterThan(0);
    expect(nominalRadiusRatio).toBeLessThan(1);
    const nominalRadius = nominalRadiusRatio * quadRadius;
    expect(quadRadius - nominalRadius).toBeCloseTo(1);
  });

  it("resolves compact feed extensions by revision count instead of root-array length", () => {
    const initial = stroke({ points: [500, 1_200], pressures: [0.5] });
    const baseline = createStudioGpuStrokeFeedCompactBaseline([initial], "compact-tile")!;
    const advanced = advanceStudioGpuStrokeFeedCompact(baseline, {
      strokeIndex: 0,
      previousPointCount: 1,
      previousRevisionToken: baseline[0]![STUDIO_GPU_STROKE_FEED_REVISION]!.token,
      suffixPoints: [540, 1_200],
      suffixPressures: [1],
    });
    expect(advanced.status).toBe("appended");
    expect(advanced.strokes[0]!.points).toHaveLength(2);

    const options = { logicalWidth: 1_024, logicalHeight: 4_096 };
    const previousStates = planStudioGpuTileStates(baseline, options);
    const nextStates = planStudioGpuTileStates(advanced.strokes, options);
    const update = diffStudioGpuTileStates(previousStates, nextStates)
      .find(({ tile: candidate, mode }) => candidate.id === tile().id && mode === "append");
    expect(update?.strokeExtension).toBeDefined();
    const current = advanced.strokes[0]!;
    let observedPreviousRevisionToken: string | undefined;
    const resolved = resolveStudioGpuTileTasks(
      [task(current, {
        mode: "append",
        operations: update!.operations,
        strokeExtension: update!.strokeExtension,
        previousOperationCount: update!.previousOperationCount,
        nextOperationCount: update!.nextOperationCount,
      })],
      [current],
      planStudioGpuDabsInRect,
      100_000,
      (candidate, previousPointCount, clipRect, maximumDabs, previousRevisionToken) => {
        observedPreviousRevisionToken = previousRevisionToken;
        return planStudioGpuStrokeExtensionInRect(
          candidate,
          previousPointCount,
          clipRect,
          maximumDabs,
          previousRevisionToken
        );
      }
    );

    expect(resolved).not.toBeNull();
    expect(observedPreviousRevisionToken).toBe(
      baseline[0]![STUDIO_GPU_STROKE_FEED_REVISION]!.token
    );
    expect(resolved!.tasks[0]!.plan).toEqual(planStudioGpuStrokeExtensionInRect(
      current,
      1,
      {
        x: descriptor().renderX,
        y: descriptor().renderY,
        width: descriptor().renderWidth,
        height: descriptor().renderHeight,
      },
      100_000
    ));
  });

  it("keeps a newer live operation terminal when its random UUID sorts before pending ink", () => {
    const pending = stroke({
      id: "z-pending-uuid",
      orderKey: "\uffffstudio-live:0000000000000001",
    });
    const active = stroke({
      id: "a-active-uuid",
      orderKey: "\uffffstudio-live:0000000000000002",
      points: [500, 1_220],
      pressures: [0.5],
    });
    const baseline = createStudioGpuStrokeFeedCompactBaseline(
      [pending, active],
      "reverse-uuid-live-order",
    )!;
    const activeRevision = baseline[1]![STUDIO_GPU_STROKE_FEED_REVISION]!;
    const advanced = advanceStudioGpuStrokeFeedCompact(baseline, {
      strokeIndex: 1,
      previousPointCount: 1,
      previousRevisionToken: activeRevision.token,
      suffixPoints: [540, 1_220],
      suffixPressures: [0.8],
    });

    expect(advanced.status).toBe("appended");
    const options = { logicalWidth: 1_024, logicalHeight: 4_096 };
    const previousStates = planStudioGpuTileStates(baseline, options);
    const nextStates = planStudioGpuTileStates(advanced.strokes, options);
    const updates = diffStudioGpuTileStates(previousStates, nextStates);
    const activeTileUpdates = updates.filter(({ operations }) =>
      operations.some(({ id }) => id === active.id)
    );

    expect(activeTileUpdates.length).toBeGreaterThan(0);
    expect(activeTileUpdates.every(({ mode }) => mode === "append")).toBe(true);
    const overlappingNextStates = nextStates.filter(({ operations }) =>
      operations.some(({ id }) => id === pending.id)
      && operations.some(({ id }) => id === active.id)
    );
    expect(overlappingNextStates.length).toBeGreaterThan(0);
    expect(overlappingNextStates.every(({ operations }) =>
      operations.map(({ id }) => id).join(",") === `${pending.id},${active.id}`
    )).toBe(true);
  });

  it("packs a zero-radius dab as zero quad geometry instead of a phantom AA-guard dot", () => {
    const current = stroke({
      pressures: [0, 0],
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
    });
    const resolved = resolveStudioGpuTileTasks(
      [task(current)],
      [current],
      planStudioGpuDabsInRect,
      100_000
    );

    expect(resolved).not.toBeNull();
    const packed = packStudioGpuTileDabs(resolved!);
    expect(packed[2]).toBe(0);
    expect(packed[3]).toBe(0);
    expect(packed[8]).toBe(0);
  });

  it("packs identically into a caller-owned scratch and keeps consecutive packs independent", () => {
    const current = stroke();
    const resolved = resolveStudioGpuTileTasks(
      [task(current)],
      [current],
      planStudioGpuDabsInRect,
      100_000
    )!;
    const fresh = packStudioGpuTileDabs(resolved);
    const other = stroke({ id: "other", points: [520, 1_300, 470, 1_260], pressures: [1, 0.5] });
    const otherResolved = resolveStudioGpuTileTasks(
      [task(other)],
      [other],
      planStudioGpuDabsInRect,
      100_000
    )!;
    const otherFresh = packStudioGpuTileDabs(otherResolved);

    // A large-enough scratch is reused: same values, exact-length view, tail bytes untouched.
    const scratch = new Float32Array(Math.max(fresh.length, otherFresh.length) + 32).fill(123);
    const packed = packStudioGpuTileDabs(resolved, scratch);
    expect(packed.buffer).toBe(scratch.buffer);
    expect(packed).toHaveLength(fresh.length);
    expect(Array.from(packed)).toEqual(Array.from(fresh));
    expect(scratch[Math.max(fresh.length, otherFresh.length)]).toBe(123);

    // A second, different stroke packed into the same scratch is byte-for-byte the fresh pack:
    // no value from the previous stroke survives inside the returned view.
    const otherPacked = packStudioGpuTileDabs(otherResolved, scratch);
    expect(otherPacked.buffer).toBe(scratch.buffer);
    expect(Array.from(otherPacked)).toEqual(Array.from(otherFresh));

    // A too-small scratch is never partially written; the pack allocates a fresh exact array.
    const tooSmall = new Float32Array(4).fill(77);
    const grown = packStudioGpuTileDabs(resolved, tooSmall);
    expect(grown.buffer).not.toBe(tooSmall.buffer);
    expect(Array.from(grown)).toEqual(Array.from(fresh));
    expect(Array.from(tooSmall)).toEqual([77, 77, 77, 77]);
  });

  it("clips a globally oversized crossing stroke to visible dabs with exact spacing", () => {
    const crossing = stroke({
      id: "crossing",
      points: [-100_000, 1_200, 100_000, 1_200],
      pressures: [1, 1],
      size: 1,
    });
    expect(planStudioGpuDabs([crossing])).toMatchObject({ complete: false });

    const resolved = resolveStudioGpuTileTasks(
      [task(crossing)],
      [crossing],
      planStudioGpuDabsInRect,
      100_000
    );

    expect(resolved).not.toBeNull();
    expect(resolved!.dabCount).toBeGreaterThan(1_000);
    expect(resolved!.dabCount).toBeLessThan(1_100);
    expect(resolved!.tasks[0]!.plan.complete).toBe(true);
    expect(resolved!.tasks[0]!.plan.dabs.every((dab) => (
      dab.x + dab.radius >= descriptor().renderX
      && dab.x - dab.radius <= descriptor().renderX + descriptor().renderWidth
      && dab.y + dab.radius >= descriptor().renderY
      && dab.y - dab.radius <= descriptor().renderY + descriptor().renderHeight
    ))).toBe(true);
    expect(resolved!.tasks[0]!.plan.dabs.some(({ x }) => Math.abs(x) > 1_000)).toBe(false);

    const bounded = stroke({
      id: "bounded-crossing",
      points: [-20, 1_200, 530, 1_200],
      pressures: [0.5, 1],
      size: 12,
    });
    const full = planStudioGpuDabs([bounded]);
    const clipped = planStudioGpuDabsInRect([bounded], {
      x: descriptor().renderX,
      y: descriptor().renderY,
      width: descriptor().renderWidth,
      height: descriptor().renderHeight,
    });
    const expected = full.dabs.filter((dab) => {
      const nearestX = Math.min(
        descriptor().renderX + descriptor().renderWidth,
        Math.max(descriptor().renderX, dab.x)
      );
      const nearestY = Math.min(
        descriptor().renderY + descriptor().renderHeight,
        Math.max(descriptor().renderY, dab.y)
      );
      return Math.hypot(dab.x - nearestX, dab.y - nearestY) <= dab.radius;
    });
    expect(clipped).toMatchObject({ complete: true, dabs: expected });
  });

  it("retains boundary bleed while omitting non-intersecting dabs", () => {
    const boundary = stroke({
      id: "boundary",
      points: [514.75, 1_200],
      pressures: [1],
      size: 1,
    });
    const outside = stroke({
      id: "outside",
      points: [515, 1_200],
      pressures: [1],
      size: 1,
    });
    const planned = planStudioGpuDabsInRect([boundary, outside], {
      x: descriptor().renderX,
      y: descriptor().renderY,
      width: descriptor().renderWidth,
      height: descriptor().renderHeight,
    });

    expect(planned.complete).toBe(true);
    expect(planned.dabs.map(({ x }) => x)).toEqual([514.75]);
    expect(planned.dabs[0]!.x).toBeGreaterThan(
      descriptor().renderX + descriptor().renderWidth
    );
  });

  it("fails closed for a missing exact operation, invalid input, or aggregate dab cap", () => {
    const current = stroke();
    const mismatched = task(current, {
      operations: [{
        id: current.id,
        fingerprint: fingerprintStudioGpuStroke(current),
        signature: `${signatureStudioGpuStroke(current)}corrupt`,
      }],
    });
    const invalid = stroke({
      id: "invalid",
      points: [10_000, 10_000, Number.NaN, 10_000],
    });

    expect(resolveStudioGpuTileTasks(
      [mismatched],
      [current],
      planStudioGpuDabsInRect,
      100_000
    )).toBeNull();
    expect(resolveStudioGpuTileTasks(
      [task(invalid)],
      [invalid],
      planStudioGpuDabsInRect,
      100_000
    )).toBeNull();
    expect(resolveStudioGpuTileTasks(
      [task(current)],
      [current],
      planStudioGpuDabsInRect,
      1
    )).toBeNull();
  });

  it("builds cropped presentation quads and mirrors positions without swapping texture content", () => {
    const resource = { id: "texture" };
    const frame: StudioGpuTileCompositeFrame<typeof resource> = {
      kind: "tile-resource-frame",
      frameId: "frame",
      token: {} as StudioGpuTileCompositeFrame<typeof resource>["token"],
      deviceGeneration: 1,
      items: [
        { tile: tile(), descriptor: descriptor(), resource },
        {
          tile: { id: "1:2", column: 1, row: 2, x: 512, y: 1_024, width: 512, height: 512 },
          descriptor: null,
          resource: null,
        },
      ],
      residentBytes: descriptor().byteLength,
      residentEntries: 1,
    };
    const planned = planStudioGpuTilePresentation(frame, { ...VIEWPORT, flipX: true });

    expect(planned.draws).toEqual([{
      resource,
      firstVertex: 0,
      vertexCount: 6,
      tileId: "0:2",
    }]);
    expect(planned.vertices[0]).toBe(1);
    expect(planned.vertices[1]).toBe(1);
    expect(planned.vertices[2]).toBeCloseTo(2 / 516);
    expect(planned.vertices[3]).toBeCloseTo(2 / 516);
    expect(planned.vertices[4]).toBe(0);
    expect(planned.vertices[6]).toBeCloseTo(514 / 516);
  });
});
