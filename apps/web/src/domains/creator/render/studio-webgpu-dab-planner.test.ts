import { describe, expect, it } from "vitest";

import {
  STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
  STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3,
  STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2,
} from "../brush/studio-ink-pressure-model";

import {
  planStudioGpuDabs,
  planStudioGpuDabUpdate,
  planStudioGpuStrokeExtensionInRect,
} from "./studio-webgpu-dab-planner";
import { STUDIO_GPU_STROKE_FEED_REVISION } from "./studio-webgpu-stroke";
import {
  advanceStudioGpuStrokeFeedCompact,
  createStudioGpuStrokeFeedCompactBaseline,
} from "./studio-webgpu-stroke-feed";

import type { PlannedStudioGpuDabs } from "./studio-webgpu-dab-plan-contract";
import type { StudioGpuStroke } from "./studio-webgpu-stroke";

function expectContiguousBatches(plan: PlannedStudioGpuDabs): void {
  let cursor = 0;
  for (const batch of plan.batches) {
    expect(batch.firstInstance).toBe(cursor);
    expect(batch.instanceCount).toBeGreaterThan(0);
    cursor += batch.instanceCount;
  }
  expect(cursor).toBe(plan.dabs.length);
}

describe("studio WebGPU dab planner incremental concatenation", () => {
  it("keeps a long legacy live extension plus a new eraser byte-for-byte with the full plan", () => {
    const sharedPrefix = [0, 0, 10, 0];
    const previousTerminal: StudioGpuStroke = {
      id: "live",
      points: sharedPrefix,
      pressures: [0.5, 0.6],
      color: "#204080",
      size: 8,
      opacity: 0.9,
    };
    // The appended 2,000px segment expands to well over a thousand dabs, exercising the indexed
    // (non-spread) concatenation used by the append-mode planner.
    const nextTerminal: StudioGpuStroke = {
      ...previousTerminal,
      points: [...sharedPrefix, 2_000, 0],
      pressures: [0.5, 0.6, 1],
    };
    const appendedEraser: StudioGpuStroke = {
      id: "eraser",
      points: [100, 5, 300, 5],
      pressures: [0.7, 0.7],
      color: "#000000",
      size: 12,
      composite: "erase",
    };

    const update = planStudioGpuDabUpdate(
      [previousTerminal],
      [nextTerminal, appendedEraser]
    );
    expect(update.mode).toBe("append");
    expect(update.complete).toBe(true);
    expect(update.dabs.length).toBeGreaterThan(1_000);

    // Applying the append over the previous full plan reproduces the next full plan exactly.
    const previousFull = planStudioGpuDabs([previousTerminal]);
    const nextFull = planStudioGpuDabs([nextTerminal, appendedEraser]);
    expect(previousFull.complete).toBe(true);
    expect(nextFull.complete).toBe(true);
    expect([...previousFull.dabs, ...update.dabs]).toEqual(nextFull.dabs);

    // Batches must tile the concatenated dab list contiguously and split at the erase boundary.
    expectContiguousBatches(update);
    expect(update.batches.map(({ composite }) => composite)).toEqual(["normal", "erase"]);
  });

  it("keeps a residual V2 extension identical to replanning the whole stroke", () => {
    const sharedPrefix = [0, 0, 40, 0, 40, 30];
    const previousTerminal: StudioGpuStroke = {
      id: "residual",
      points: sharedPrefix,
      pressures: [0.4, 0.6, 0.8],
      color: "#113355",
      size: 10,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2,
    };
    const nextTerminal: StudioGpuStroke = {
      ...previousTerminal,
      points: [...sharedPrefix, 400, 30, 400, 200],
      pressures: [0.4, 0.6, 0.8, 0.9, 0.5],
    };

    const update = planStudioGpuDabUpdate([previousTerminal], [nextTerminal]);
    expect(update.mode).toBe("append");
    expect(update.complete).toBe(true);
    expect(update.dabs.length).toBeGreaterThan(10);

    const previousFull = planStudioGpuDabs([previousTerminal]);
    const nextFull = planStudioGpuDabs([nextTerminal]);
    expect([...previousFull.dabs, ...update.dabs]).toEqual(nextFull.dabs);
    expectContiguousBatches(update);
  });
});

function buildCompactFeed(
  source: StudioGpuStroke,
  baselinePointCount: number,
  chunkPointCount: number,
  lineage: string
): {
  readonly baseline: StudioGpuStroke;
  readonly latest: StudioGpuStroke;
} {
  const baseline = createStudioGpuStrokeFeedCompactBaseline([{
    ...source,
    points: source.points.slice(0, baselinePointCount * 2),
    pressures: source.pressures?.slice(0, baselinePointCount),
  }], lineage)![0]!;
  let latest = baseline;
  for (
    let pointOffset = baselinePointCount;
    pointOffset < source.points.length / 2;
    pointOffset += chunkPointCount
  ) {
    const nextPointCount = Math.min(
      source.points.length / 2,
      pointOffset + chunkPointCount
    );
    const advanced = advanceStudioGpuStrokeFeedCompact([latest], {
      strokeIndex: 0,
      previousPointCount: pointOffset,
      previousRevisionToken: latest[STUDIO_GPU_STROKE_FEED_REVISION]!.token,
      suffixPoints: source.points.slice(pointOffset * 2, nextPointCount * 2),
      suffixPressures: source.pressures!.slice(pointOffset, nextPointCount),
    });
    expect(advanced.status).toBe("appended");
    latest = advanced.strokes[0]!;
  }
  return { baseline, latest };
}

describe("studio WebGPU append-only dab receipt planning", () => {
  it.each([
    ["legacy", undefined],
    ["linear V1", STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1],
    ["residual V2", STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2],
    ["path residual V3", STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3],
  ] as const)("matches full-plan numeric geometry across multi-revision %s input", (
    name,
    pressureModel
  ) => {
    const pointCount = 640;
    const points = new Array<number>(pointCount * 2);
    const pressures = new Array<number>(pointCount);
    for (let index = 0; index < pointCount; index += 1) {
      points[index * 2] = index * 0.9;
      points[index * 2 + 1] = Math.sin(index / 11) * 18 + (index % 7) * 0.07;
      pressures[index] = 0.15 + ((index * 37) % 83) / 100;
    }
    const full: StudioGpuStroke = {
      id: `corpus:${name}`,
      points,
      pressures,
      color: "#3164a8cc",
      size: 11,
      opacity: 0.82,
      ...(pressureModel === undefined ? {} : { pressureModel }),
    };
    const baselinePointCount = 97;
    const { baseline, latest } = buildCompactFeed(
      full,
      baselinePointCount,
      73,
      `corpus:${name}`
    );

    const update = planStudioGpuDabUpdate([baseline], [latest]);
    const baselinePlan = planStudioGpuDabs([{
      ...full,
      points: full.points.slice(0, baselinePointCount * 2),
      pressures: full.pressures?.slice(0, baselinePointCount),
    }]);
    const fullPlan = planStudioGpuDabs([full]);
    expect(update.mode).toBe("append");
    expect(update.complete).toBe(true);
    expect([...baselinePlan.dabs, ...update.dabs]).toEqual(fullPlan.dabs);

    const clipRect = { x: 180, y: -6, width: 190, height: 36 };
    const incrementalClip = planStudioGpuStrokeExtensionInRect(
      latest,
      baselinePointCount,
      clipRect
    );
    const ordinaryClip = planStudioGpuStrokeExtensionInRect(
      full,
      baselinePointCount,
      clipRect
    );
    expect(incrementalClip).toEqual(ordinaryClip);
    expectContiguousBatches(incrementalClip);
  });

  it("rejects a stale same-lineage branch receipt and requests a deterministic rebuild", () => {
    const root = createStudioGpuStrokeFeedCompactBaseline([{
      id: "branch",
      points: [0, 0],
      pressures: [0.5],
      color: "#123456",
      size: 6,
    }], "branch-lineage")!;
    const append = (
      previous: readonly StudioGpuStroke[],
      x: number,
      pressure: number
    ) => advanceStudioGpuStrokeFeedCompact(previous, {
      strokeIndex: 0,
      previousPointCount: previous[0]![STUDIO_GPU_STROKE_FEED_REVISION]!.pointCount,
      previousRevisionToken: previous[0]![STUDIO_GPU_STROKE_FEED_REVISION]!.token,
      suffixPoints: [x, 0],
      suffixPressures: [pressure],
    }).strokes;
    const retainedBranch = append(root, 10, 0.6);
    const competingBranch = append(root, 20, 0.7);
    const competingTail = append(competingBranch, 30, 0.8);

    const update = planStudioGpuDabUpdate(retainedBranch, competingTail);
    expect(update.mode).toBe("rebuild");
    expect(update).toEqual({
      mode: "rebuild",
      ...planStudioGpuDabs(competingTail),
    });

    const staleToken = retainedBranch[0]![STUDIO_GPU_STROKE_FEED_REVISION]!.token;
    expect(planStudioGpuStrokeExtensionInRect(
      competingTail[0]!,
      2,
      { x: -10, y: -10, width: 60, height: 20 },
      100_000,
      staleToken
    )).toEqual({ dabs: [], batches: [], complete: false });
  });

  it("routes an over-budget skipped receipt to a bounded full rebuild signal", () => {
    const root = createStudioGpuStrokeFeedCompactBaseline([{
      id: "catch-up-budget",
      points: [4, 4],
      pressures: [0.5],
      color: "#334455",
      size: 4,
    }], "catch-up-budget")!;
    const appendStationary = (
      previous: readonly StudioGpuStroke[],
      suffixPointCount: number
    ) => advanceStudioGpuStrokeFeedCompact(previous, {
      strokeIndex: 0,
      previousPointCount: previous[0]![STUDIO_GPU_STROKE_FEED_REVISION]!.pointCount,
      previousRevisionToken: previous[0]![STUDIO_GPU_STROKE_FEED_REVISION]!.token,
      suffixPoints: new Array<number>(suffixPointCount * 2).fill(4),
      suffixPressures: new Array<number>(suffixPointCount).fill(0.5),
    }).strokes;
    const first = appendStationary(root, 60_000);
    const latest = appendStationary(first, 40_001);

    const update = planStudioGpuDabUpdate(root, latest);
    expect(update.mode).toBe("rebuild");
    expect(update.complete).toBe(true);
    expect(update.dabs).toHaveLength(1);
    expect(update).toEqual({ mode: "rebuild", ...planStudioGpuDabs(latest) });
  });

  it("keeps a 50k-point retained suffix linear, exact, and independent of full source storage", () => {
    const suffixPointCount = 50_000;
    const pointCount = suffixPointCount + 1;
    const points = new Array<number>(pointCount * 2);
    const pressures = new Array<number>(pointCount);
    for (let index = 0; index < pointCount; index += 1) {
      points[index * 2] = index * 0.55;
      points[index * 2 + 1] = (index % 9) * 0.03;
      pressures[index] = 0.55 + (index % 5) * 0.08;
    }
    const full: StudioGpuStroke = {
      id: "long-receipt",
      points,
      pressures,
      color: "#203040",
      size: 5,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
    };
    const { latest } = buildCompactFeed(full, 1, 10_000, "long-receipt");
    // The trusted wrapper retains only its one-point root. Historical/suffix source arrays are not
    // rebuilt on the stroke object before planning.
    expect(latest.points).toHaveLength(2);
    expect(latest.pressures).toHaveLength(1);

    const startedAt = performance.now();
    const incremental = planStudioGpuStrokeExtensionInRect(
      latest,
      1,
      { x: -10, y: -10, width: points.at(-2)! + 20, height: 30 }
    );
    const elapsedMs = performance.now() - startedAt;
    const fullExtension = planStudioGpuStrokeExtensionInRect(
      full,
      1,
      { x: -10, y: -10, width: points.at(-2)! + 20, height: 30 }
    );

    expect(incremental.complete).toBe(true);
    expect(incremental.dabs).toHaveLength(suffixPointCount);
    expect(incremental).toEqual(fullExtension);
    // A deliberately loose guard catches accidental quadratic history walks without making
    // scheduler noise a product contract. Exact geometry above remains the normative assertion.
    expect(elapsedMs).toBeLessThan(2_500);
  });
});
