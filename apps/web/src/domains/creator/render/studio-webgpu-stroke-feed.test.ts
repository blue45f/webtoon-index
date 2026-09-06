import { describe, expect, it } from "vitest";

import {
  STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
  STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3,
  STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2,
} from "../brush/studio-ink-pressure-model";

import {
  planStudioGpuDabs,
  planStudioGpuDabsInRect,
  planStudioGpuStrokeExtensionInRect,
} from "./studio-webgpu-dab-planner";
import { STUDIO_GPU_STROKE_FEED_REVISION, type StudioGpuStroke } from "./studio-webgpu-stroke";
import {
  advanceStudioGpuStrokeFeed,
  advanceStudioGpuStrokeFeedBatch,
  advanceStudioGpuStrokeFeedBatchCompact,
  advanceStudioGpuStrokeFeedCompact,
  createStudioGpuStrokeFeedBaseline,
  createStudioGpuStrokeFeedCompactBaseline,
  isTrustedStudioGpuStrokeFeedDabExtensionReceipt,
  materializeStudioGpuStrokeFeedStroke,
  materializeStudioGpuStrokeFeedStrokes,
  planStudioGpuPinnedStrokeFeedUpdate,
  studioGpuStrokeFeedDabExtensionReceipt,
  studioGpuStrokeFeedDabExtensionReceiptBatch,
  studioGpuStrokeFeedRevisionAtPointCount,
  studioGpuStrokeFeedSuffixFromPointCount,
  STUDIO_GPU_STROKE_FEED_MAX_ADVANCE_POINTS,
  STUDIO_GPU_STROKE_FEED_MAX_BASELINE_TOTAL_POINTS,
  type StudioGpuStrokeSuffixPatch,
} from "./studio-webgpu-stroke-feed";

function stroke(overrides: Partial<StudioGpuStroke> = {}): StudioGpuStroke {
  return {
    id: "live",
    points: [2, 3],
    pressures: [0.5],
    color: "#7c5cff",
    size: 6,
    opacity: 1,
    composite: "normal",
    ...overrides,
  };
}

function inaccessiblePrefix(values: number[], inaccessibleLength: number): readonly number[] {
  return new Proxy(values, {
    get(target, property, receiver) {
      const index = typeof property === "string" && /^\d+$/.test(property)
        ? Number(property)
        : -1;
      if (index >= 0 && index < inaccessibleLength) {
        throw new Error(`historical sample ${index} was read`);
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

function patch(
  fallbackStrokes: readonly StudioGpuStroke[],
  previousPointCount: number,
  suffixPoints: readonly number[],
  suffixPressures: readonly number[]
): StudioGpuStrokeSuffixPatch {
  return {
    strokeIndex: 0,
    previousPointCount,
    suffixPoints,
    suffixPressures,
    nextStroke: fallbackStrokes[0]!,
    fallbackStrokes,
  };
}

describe("Studio WebGPU append-only stroke feed", () => {
  it("rejects an aggregate multi-stroke baseline before cloning any point array", () => {
    const pointCount = Math.floor(STUDIO_GPU_STROKE_FEED_MAX_BASELINE_TOTAL_POINTS / 2) + 1;
    let numericReads = 0;
    const guardedPoints = new Proxy(new Array<number>(pointCount * 2), {
      get(target, property, receiver) {
        if (typeof property === "string" && /^(?:0|[1-9]\d*)$/u.test(property)) {
          numericReads += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });

    expect(createStudioGpuStrokeFeedCompactBaseline([
      stroke({ id: "aggregate:1", points: guardedPoints, pressures: undefined }),
      stroke({
        id: "aggregate:2",
        points: new Array<number>(pointCount * 2),
        pressures: undefined,
      }),
    ], "aggregate-overflow")).toBeNull();
    expect(numericReads).toBe(0);
  });

  it("keeps a single-tap baseline and reconstructs only the appended bridge suffix", () => {
    const baseline = createStudioGpuStrokeFeedBaseline([stroke()], "tap-feed");
    expect(baseline).not.toBeNull();
    expect(baseline![0]?.[STUDIO_GPU_STROKE_FEED_REVISION]).toMatchObject({
      pointCount: 1,
      revision: 0,
    });

    const moved = [stroke({ points: [2, 3, 9, 7], pressures: [0.5, 0.8] })];
    const advanced = advanceStudioGpuStrokeFeed(
      baseline!,
      patch(moved, 1, [9, 7], [0.8])
    );

    expect(advanced.status).toBe("appended");
    expect(advanced.strokes[0]?.[STUDIO_GPU_STROKE_FEED_REVISION]).toMatchObject({
      pointCount: 2,
      revision: 1,
      parentPointCount: 1,
    });
    expect(studioGpuStrokeFeedSuffixFromPointCount(advanced.strokes[0]!, 1)).toMatchObject({
      points: [2, 3, 9, 7],
      pressures: [0.5, 0.8],
    });
  });

  it("keeps caller arrays mutable while retaining only feed-owned root and suffix copies", () => {
    const sourcePoints = [2, 3, 8, 4];
    const sourcePressures = [0.5, 0.65];
    const next = [stroke({ points: sourcePoints, pressures: sourcePressures })];
    const baseline = createStudioGpuStrokeFeedBaseline([stroke()], "immutable-child")!;
    const advanced = advanceStudioGpuStrokeFeed(
      baseline,
      patch(next, 1, [8, 4], [0.65])
    );

    expect(advanced.status).toBe("appended");
    expect(Object.isFrozen(sourcePoints)).toBe(false);
    expect(Object.isFrozen(sourcePressures)).toBe(false);
    sourcePoints[0] = 99;
    sourcePressures[0] = 1;
    expect(advanced.strokes[0]?.points).toEqual([2, 3]);
    expect(advanced.strokes[0]?.points[0]).toBe(2);
    expect(materializeStudioGpuStrokeFeedStroke(advanced.strokes[0]!)).toMatchObject({
      points: [2, 3, 8, 4],
      pressures: [0.5, 0.65],
    });
  });

  it("advances from suffix-only revision receipts without full strokes or fallback arrays", () => {
    const rootPoints = [2, 3];
    const rootPressures = [0.5];
    const baseline = createStudioGpuStrokeFeedCompactBaseline([
      stroke({ points: rootPoints, pressures: rootPressures }),
    ], "compact-feed")!;
    const rootRevision = baseline[0]![STUDIO_GPU_STROKE_FEED_REVISION]!;
    const suffixPoints = [8, 4, 13, 9];
    const suffixPressures = [0.65, 0.9];
    const advanced = advanceStudioGpuStrokeFeedCompact(baseline, {
      strokeIndex: 0,
      previousPointCount: 1,
      previousRevisionToken: rootRevision.token,
      suffixPoints,
      suffixPressures,
    });

    expect(advanced.status).toBe("appended");
    expect(Object.isFrozen(rootPoints)).toBe(false);
    expect(Object.isFrozen(rootPressures)).toBe(false);
    expect(Object.isFrozen(suffixPoints)).toBe(false);
    expect(Object.isFrozen(suffixPressures)).toBe(false);
    expect(advanced.strokes[0]?.points).toEqual([2, 3]);
    expect(advanced.strokes[0]?.[STUDIO_GPU_STROKE_FEED_REVISION]).toMatchObject({
      pointCount: 3,
      parentPointCount: 1,
    });

    suffixPoints[0] = 999;
    suffixPressures[0] = 0;
    expect(materializeStudioGpuStrokeFeedStroke(advanced.strokes[0]!)).toMatchObject({
      points: [2, 3, 8, 4, 13, 9],
      pressures: [0.5, 0.65, 0.9],
    });
    expect(advanceStudioGpuStrokeFeedCompact(baseline, {
      strokeIndex: 0,
      previousPointCount: 1,
      previousRevisionToken: "stale-token",
      suffixPoints: [8, 4],
      suffixPressures: [0.65],
    })).toEqual({ status: "rejected", strokes: baseline });
  });

  it("fails compact suffix inputs closed at the trusted provenance and accessor boundaries", () => {
    const baseline = createStudioGpuStrokeFeedCompactBaseline([stroke()], "compact-provenance")!;
    const token = baseline[0]![STUDIO_GPU_STROKE_FEED_REVISION]!.token;
    const hostilePoints = new Proxy([8, 4], {
      get(target, property, receiver) {
        if (property === "length") throw new Error("hostile suffix length");
        return Reflect.get(target, property, receiver);
      },
    });
    expect(() => advanceStudioGpuStrokeFeedCompact(baseline, {
      strokeIndex: 0,
      previousPointCount: 1,
      previousRevisionToken: token,
      suffixPoints: hostilePoints,
      suffixPressures: [0.65],
    })).not.toThrow();
    expect(advanceStudioGpuStrokeFeedCompact(baseline, {
      strokeIndex: 0,
      previousPointCount: 1,
      previousRevisionToken: token,
      suffixPoints: hostilePoints,
      suffixPressures: [0.65],
    })).toEqual({ status: "rejected", strokes: baseline });

    const ordinary = Object.freeze([stroke()]);
    expect(advanceStudioGpuStrokeFeedCompact(ordinary, {
      strokeIndex: 0,
      previousPointCount: 1,
      previousRevisionToken: token,
      suffixPoints: [8, 4],
      suffixPressures: [0.65],
    })).toEqual({ status: "rejected", strokes: ordinary });
  });

  it.each([
    STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2,
    STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3,
  ])("keeps compact %s suffix, full rebuild, and clipped tile geometry exact", (pressureModel) => {
    const initial = stroke({
      points: [0, 0],
      pressures: [0.35],
      size: 12,
      pressureModel,
    });
    const complete = stroke({
      points: [0, 0, 12, 3, 24, 9, 36, 18],
      pressures: [0.35, 0.55, 0.8, 0.65],
      size: 12,
      pressureModel,
    });
    const baseline = createStudioGpuStrokeFeedCompactBaseline([initial], `compact-${pressureModel}`)!;
    const advanced = advanceStudioGpuStrokeFeedCompact(baseline, {
      strokeIndex: 0,
      previousPointCount: 1,
      previousRevisionToken: baseline[0]![STUDIO_GPU_STROKE_FEED_REVISION]!.token,
      suffixPoints: complete.points.slice(2),
      suffixPressures: complete.pressures!.slice(1),
    });
    expect(advanced.status).toBe("appended");

    const compact = advanced.strokes[0]!;
    expect(planStudioGpuDabs([compact])).toEqual(planStudioGpuDabs([complete]));
    const clipRect = { x: -8, y: -8, width: 56, height: 42 };
    expect(planStudioGpuDabsInRect([compact], clipRect)).toEqual(
      planStudioGpuDabsInRect([complete], clipRect)
    );
    expect(planStudioGpuStrokeExtensionInRect(compact, 1, clipRect)).toEqual(
      planStudioGpuStrokeExtensionInRect(complete, 1, clipRect)
    );
  });

  it("coalesces skipped pointer frames from revision chunks without reading retained arrays", () => {
    const baseline = createStudioGpuStrokeFeedBaseline([stroke()], "no-history-read")!;
    const firstPoints = inaccessiblePrefix([2, 3, 8, 4], 2);
    const first = [stroke({ points: firstPoints, pressures: [0.5, 0.65] })];
    const advanced = advanceStudioGpuStrokeFeed(
      baseline,
      patch(first, 1, [8, 4], [0.65])
    );
    expect(advanced.status).toBe("appended");

    const secondPoints = inaccessiblePrefix([2, 3, 8, 4, 13, 9], 4);
    const second = [stroke({ points: secondPoints, pressures: [0.5, 0.65, 0.9] })];
    const sealed = advanceStudioGpuStrokeFeed(
      advanced.strokes,
      patch(second, 2, [13, 9], [0.9])
    );
    expect(sealed.status).toBe("appended");

    // A retained GPU frame may still contain only the tap. Reconstructing from point 1 walks the
    // two tiny revision chunks and never touches indices 0..3 of the latest source array.
    expect(studioGpuStrokeFeedSuffixFromPointCount(sealed.strokes[0]!, 1)).toMatchObject({
      points: [2, 3, 8, 4, 13, 9],
      pressures: [0.5, 0.65, 0.9],
    });
  });

  it("advances every terminal symmetry variation atomically without reading retained history", () => {
    const initial = [
      stroke({ id: "live", points: [2, 3], pressures: [0.5] }),
      stroke({ id: "live:gpu-symmetry:1", points: [98, 3], pressures: [0.5] }),
    ];
    const baseline = createStudioGpuStrokeFeedBaseline(initial, "symmetry-feed")!;
    const fallback = [
      stroke({
        id: "live",
        points: inaccessiblePrefix([2, 3, 9, 7], 2),
        pressures: [0.5, 0.8],
      }),
      stroke({
        id: "live:gpu-symmetry:1",
        points: inaccessiblePrefix([98, 3, 91, 7], 2),
        pressures: [0.5, 0.8],
      }),
    ];
    const advanced = advanceStudioGpuStrokeFeedBatch(baseline, {
      fallbackStrokes: fallback,
      patches: fallback.map((nextStroke, strokeIndex) => ({
        strokeIndex,
        previousPointCount: 1,
        suffixPoints: nextStroke.points.slice(2),
        suffixPressures: [0.8],
        nextStroke,
        fallbackStrokes: fallback,
      })),
    });

    expect(advanced.status).toBe("appended");
    expect(advanced.strokes).toHaveLength(2);
    expect(advanced.strokes.map((candidate) => (
      candidate[STUDIO_GPU_STROKE_FEED_REVISION]?.pointCount
    ))).toEqual([2, 2]);
    expect(studioGpuStrokeFeedSuffixFromPointCount(advanced.strokes[1]!, 1)).toMatchObject({
      points: [98, 3, 91, 7],
      pressures: [0.5, 0.8],
    });
  });

  it("advances a compact symmetry batch atomically from trusted wrappers alone", () => {
    const initial = [
      stroke({ id: "live", points: [2, 3], pressures: [0.5] }),
      stroke({ id: "live:gpu-symmetry:1", points: [98, 3], pressures: [0.5] }),
    ];
    const baseline = createStudioGpuStrokeFeedCompactBaseline(initial, "compact-symmetry-feed")!;
    const suffixes = [[9, 7], [91, 7]];
    const pressures = [0.8];
    const advanced = advanceStudioGpuStrokeFeedBatchCompact(baseline, {
      patches: baseline.map((candidate, strokeIndex) => ({
        strokeIndex,
        previousPointCount: 1,
        previousRevisionToken: candidate[STUDIO_GPU_STROKE_FEED_REVISION]!.token,
        suffixPoints: suffixes[strokeIndex]!,
        suffixPressures: pressures,
      })),
    });

    expect(advanced.status).toBe("appended");
    expect(advanced.strokes.map((candidate) => candidate.points.length)).toEqual([2, 2]);
    expect(advanced.strokes.map((candidate) => (
      candidate[STUDIO_GPU_STROKE_FEED_REVISION]?.pointCount
    ))).toEqual([2, 2]);
    expect(Object.isFrozen(suffixes[0])).toBe(false);
    expect(Object.isFrozen(suffixes[1])).toBe(false);
    expect(Object.isFrozen(pressures)).toBe(false);
    expect(materializeStudioGpuStrokeFeedStrokes(advanced.strokes)?.map(({ points }) => points)).toEqual([
      [2, 3, 9, 7],
      [98, 3, 91, 7],
    ]);
  });

  it("rejects a torn symmetry suffix batch without publishing a partial variation", () => {
    const initial = [
      stroke({ id: "live" }),
      stroke({ id: "live:gpu-symmetry:1", points: [98, 3] }),
    ];
    const baseline = createStudioGpuStrokeFeedBaseline(initial, "atomic-symmetry-feed")!;
    const fallback = [
      stroke({ id: "live", points: [2, 3, 9, 7], pressures: [0.5, 0.8] }),
      stroke({
        id: "live:gpu-symmetry:1",
        points: [98, 3, 91, 7],
        pressures: [0.5, 0.8],
      }),
    ];
    const advanced = advanceStudioGpuStrokeFeedBatch(baseline, {
      fallbackStrokes: fallback,
      patches: [
        {
          strokeIndex: 0,
          previousPointCount: 1,
          suffixPoints: [9, 7],
          suffixPressures: [0.8],
          nextStroke: fallback[0]!,
          fallbackStrokes: fallback,
        },
        {
          strokeIndex: 1,
          previousPointCount: 1,
          suffixPoints: [91, 7],
          suffixPressures: [0.2],
          nextStroke: fallback[1]!,
          fallbackStrokes: fallback,
        },
      ],
    });

    expect(advanced).toEqual({ status: "rejected", strokes: baseline });
    expect(baseline.map((candidate) => (
      candidate[STUDIO_GPU_STROKE_FEED_REVISION]?.pointCount
    ))).toEqual([1, 1]);
  });

  it("rejects symmetry variations with different sample counts even when each child is valid", () => {
    const baseline = createStudioGpuStrokeFeedBaseline([
      stroke({ id: "live" }),
      stroke({ id: "live:gpu-symmetry:1", points: [98, 3] }),
    ], "atomic-symmetry-count")!;
    const fallback = [
      stroke({ id: "live", points: [2, 3, 9, 7], pressures: [0.5, 0.8] }),
      stroke({
        id: "live:gpu-symmetry:1",
        points: [98, 3, 91, 7, 88, 9],
        pressures: [0.5, 0.8, 0.9],
      }),
    ];
    const result = advanceStudioGpuStrokeFeedBatch(baseline, {
      fallbackStrokes: fallback,
      patches: [
        {
          strokeIndex: 0,
          previousPointCount: 1,
          suffixPoints: [9, 7],
          suffixPressures: [0.8],
          nextStroke: fallback[0]!,
          fallbackStrokes: fallback,
        },
        {
          strokeIndex: 1,
          previousPointCount: 1,
          suffixPoints: [91, 7, 88, 9],
          suffixPressures: [0.8, 0.9],
          nextStroke: fallback[1]!,
          fallbackStrokes: fallback,
        },
      ],
    });

    expect(result).toEqual({ status: "rejected", strokes: baseline });
  });

  it("proves a settled prefix by its captured source reference without reading its point history", () => {
    let denyHistoricalReads = false;
    const settledPoints = new Proxy([0, 0, 10, 10], {
      get(target, property, receiver) {
        if (
          denyHistoricalReads
          && typeof property === "string"
          && /^(?:0|[1-9]\d*)$/u.test(property)
        ) throw new Error(`historical sample ${property} was read`);
        return Reflect.get(target, property, receiver);
      },
    });
    const settledSource = stroke({ id: "settled", points: settledPoints });
    const initial = [
      settledSource,
      stroke({ id: "live" }),
      stroke({ id: "live:gpu-symmetry:1", points: [98, 3] }),
    ];
    const baseline = createStudioGpuStrokeFeedBaseline(initial, "symmetry-prefix-receipt")!;
    denyHistoricalReads = true;
    const fallback = [
      settledSource,
      stroke({ id: "live", points: [2, 3, 9, 7], pressures: [0.5, 0.8] }),
      stroke({
        id: "live:gpu-symmetry:1",
        points: [98, 3, 91, 7],
        pressures: [0.5, 0.8],
      }),
    ];

    expect(() => advanceStudioGpuStrokeFeedBatch(baseline, {
      fallbackStrokes: fallback,
      patches: fallback.slice(1).map((nextStroke, variationIndex) => ({
        strokeIndex: variationIndex + 1,
        previousPointCount: 1,
        suffixPoints: nextStroke.points.slice(2),
        suffixPressures: [0.8],
        nextStroke,
        fallbackStrokes: fallback,
      })),
    })).not.toThrow();
    expect(advanceStudioGpuStrokeFeedBatch(baseline, {
      fallbackStrokes: fallback,
      patches: fallback.slice(1).map((nextStroke, variationIndex) => ({
        strokeIndex: variationIndex + 1,
        previousPointCount: 1,
        suffixPoints: nextStroke.points.slice(2),
        suffixPressures: [0.8],
        nextStroke,
        fallbackStrokes: fallback,
      })),
    }).status).toBe("appended");
  });

  it("rejects a settled-prefix source whose captured arrays or style were replaced", () => {
    const settledSource = stroke({ id: "settled", points: [0, 0, 10, 10] });
    const initial = [
      settledSource,
      stroke({ id: "live" }),
      stroke({ id: "live:gpu-symmetry:1", points: [98, 3] }),
    ];
    const baseline = createStudioGpuStrokeFeedBaseline(initial, "symmetry-prefix-mutation")!;
    Object.defineProperty(settledSource, "points", {
      value: [0, 0, 10, 10],
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(settledSource, "color", {
      value: "#ffffff",
      configurable: true,
      enumerable: true,
    });
    const fallback = [
      settledSource,
      stroke({ id: "live", points: [2, 3, 9, 7], pressures: [0.5, 0.8] }),
      stroke({
        id: "live:gpu-symmetry:1",
        points: [98, 3, 91, 7],
        pressures: [0.5, 0.8],
      }),
    ];
    const result = advanceStudioGpuStrokeFeedBatch(baseline, {
      fallbackStrokes: fallback,
      patches: fallback.slice(1).map((nextStroke, variationIndex) => ({
        strokeIndex: variationIndex + 1,
        previousPointCount: 1,
        suffixPoints: nextStroke.points.slice(2),
        suffixPressures: [0.8],
        nextStroke,
        fallbackStrokes: fallback,
      })),
    });

    expect(result).toEqual({ status: "rejected", strokes: baseline });
  });

  it("prepares every residual child before freezing any caller array", () => {
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2;
    const baseline = createStudioGpuStrokeFeedBaseline([
      stroke({ id: "left", points: [0, 0], pressureModel }),
      stroke({ id: "right", points: [0, 0], pressureModel }),
    ], "residual-batch-prepare")!;
    const leftPoints = [0, 0, 1, 0];
    const rightPoints = [0, 0, 1_000_010, 0];
    const leftPressures = [0.5, 0.5];
    const rightPressures = [0.5, 0.5];
    const fallback = [
      stroke({ id: "left", points: leftPoints, pressures: leftPressures, pressureModel }),
      stroke({ id: "right", points: rightPoints, pressures: rightPressures, pressureModel }),
    ];
    const result = advanceStudioGpuStrokeFeedBatch(baseline, {
      fallbackStrokes: fallback,
      patches: fallback.map((nextStroke, strokeIndex) => ({
        strokeIndex,
        previousPointCount: 1,
        suffixPoints: nextStroke.points.slice(2),
        suffixPressures: [0.5],
        nextStroke,
        fallbackStrokes: fallback,
      })),
    });

    expect(result).toEqual({ status: "rejected", strokes: baseline });
    expect(Object.isFrozen(leftPoints)).toBe(false);
    expect(Object.isFrozen(leftPressures)).toBe(false);
    expect(Object.isFrozen(rightPoints)).toBe(false);
    expect(Object.isFrozen(rightPressures)).toBe(false);
  });

  it("reconstructs a maximum-size catch-up suffix without engine argument-count limits", () => {
    // One accepted delivery may legally carry STUDIO_GPU_STROKE_FEED_MAX_ADVANCE_POINTS samples
    // (200k coordinates). The bridge reconstruction must fill by index: spreading that suffix
    // into `push(...)` throws RangeError on V8 (~124k call arguments) and JSC (~65k).
    const baseline = createStudioGpuStrokeFeedBaseline([stroke()], "max-advance-suffix")!;
    const suffixSampleCount = STUDIO_GPU_STROKE_FEED_MAX_ADVANCE_POINTS;
    const suffixPoints = new Array<number>(suffixSampleCount * 2);
    const suffixPressures = new Array<number>(suffixSampleCount);
    for (let index = 0; index < suffixSampleCount; index += 1) {
      suffixPoints[index * 2] = 2 + (index % 1_000) * 0.25;
      suffixPoints[index * 2 + 1] = 3 + Math.floor(index / 1_000) * 0.25;
      suffixPressures[index] = 0.25 + (index % 3) * 0.25;
    }
    const moved = [stroke({
      points: [2, 3].concat(suffixPoints),
      pressures: [0.5].concat(suffixPressures),
    })];
    const advanced = advanceStudioGpuStrokeFeed(
      baseline,
      patch(moved, 1, suffixPoints, suffixPressures)
    );
    expect(advanced.status).toBe("appended");

    const bridge = studioGpuStrokeFeedSuffixFromPointCount(advanced.strokes[0]!, 1);
    expect(bridge).not.toBeNull();
    expect(bridge!.points).toHaveLength((suffixSampleCount + 1) * 2);
    expect(bridge!.pressures).toHaveLength(suffixSampleCount + 1);
    // Bridge endpoint first, then the appended suffix in exact delivery order.
    expect(bridge!.points.slice(0, 4)).toEqual([2, 3, suffixPoints[0], suffixPoints[1]]);
    expect(bridge!.pressures!.slice(0, 2)).toEqual([0.5, suffixPressures[0]]);
    const middle = Math.floor(suffixSampleCount / 2);
    expect(bridge!.points[(middle + 1) * 2]).toBe(suffixPoints[middle * 2]);
    expect(bridge!.points[(middle + 1) * 2 + 1]).toBe(suffixPoints[middle * 2 + 1]);
    expect(bridge!.pressures![middle + 1]).toBe(suffixPressures[middle]);
    expect(bridge!.points.at(-2)).toBe(suffixPoints.at(-2));
    expect(bridge!.points.at(-1)).toBe(suffixPoints.at(-1));
    expect(bridge!.pressures!.at(-1)).toBe(suffixPressures.at(-1));
    // No sparse holes: the preallocated arrays are completely filled.
    expect(bridge!.points.every((value) => typeof value === "number")).toBe(true);
    expect(bridge!.pressures!.every((value) => typeof value === "number")).toBe(true);
  });

  it("bounds direct suffix work and rejects overlong pressure ownership", () => {
    const baseline = createStudioGpuStrokeFeedBaseline([stroke()], "bounded-direct-feed")!;
    const oversizedSuffix: number[] = [];
    oversizedSuffix.length = (STUDIO_GPU_STROKE_FEED_MAX_ADVANCE_POINTS + 1) * 2;
    const oversizedPoints = [2, 3];
    oversizedPoints.length += oversizedSuffix.length;
    const oversizedNext = [stroke({
      points: oversizedPoints,
      pressures: new Array(STUDIO_GPU_STROKE_FEED_MAX_ADVANCE_POINTS + 2).fill(0.5),
    })];
    expect(advanceStudioGpuStrokeFeed(
      baseline,
      patch(oversizedNext, 1, oversizedSuffix, oversizedNext[0]!.pressures!.slice(1))
    ).status).toBe("rejected");

    const overlong = [stroke({ points: [2, 3, 9, 7], pressures: [0.5, 0.8, 1] })];
    expect(advanceStudioGpuStrokeFeed(
      baseline,
      patch(overlong, 1, [9, 7], [0.8])
    ).status).toBe("rejected");
    expect(createStudioGpuStrokeFeedBaseline([
      stroke({ points: [2, 3], pressures: [0.5, 0.6] }),
    ], "overlong-root")).toBeNull();
  });

  it("accepts the bounded 64-copy kaleidoscope terminal group atomically", () => {
    const initial = Array.from({ length: 64 }, (_, index) => stroke({
      id: index === 0 ? "live" : `live:gpu-symmetry:${index}`,
      points: [index, 0],
    }));
    const baseline = createStudioGpuStrokeFeedBaseline(initial, "kaleidoscope-64")!;
    const fallback = initial.map((candidate, index) => stroke({
      ...candidate,
      points: [index, 0, index + 1, 1],
      pressures: [0.5, 0.8],
    }));
    const result = advanceStudioGpuStrokeFeedBatch(baseline, {
      fallbackStrokes: fallback,
      patches: fallback.map((nextStroke, strokeIndex) => ({
        strokeIndex,
        previousPointCount: 1,
        suffixPoints: nextStroke.points.slice(2),
        suffixPressures: [0.8],
        nextStroke,
        fallbackStrokes: fallback,
      })),
    });

    expect(result.status).toBe("appended");
    expect(result.strokes).toHaveLength(64);
    expect(result.strokes.every((candidate) => (
      candidate[STUDIO_GPU_STROKE_FEED_REVISION]?.pointCount === 2
    ))).toBe(true);
  });

  it("treats a final sealed endpoint as one ordinary append and rejects a stale count", () => {
    const initial = stroke({ points: [0, 0, 10, 0], pressures: [0.4, 0.6] });
    const baseline = createStudioGpuStrokeFeedBaseline([initial], "seal-feed")!;
    const final = [stroke({ points: [0, 0, 10, 0, 11, 1], pressures: [0.4, 0.6, 0.7] })];

    expect(advanceStudioGpuStrokeFeed(
      baseline,
      patch(final, 2, [11, 1], [0.7])
    ).status).toBe("appended");
    expect(advanceStudioGpuStrokeFeed(
      baseline,
      patch(final, 1, [11, 1], [0.7])
    )).toEqual({ status: "rejected", strokes: baseline });
  });

  it("adapts compatible full pinned arrays to append/retain and routes edits to replacement", () => {
    const tap = [stroke()];
    const moved = [stroke({ points: [2, 3, 9, 7], pressures: [0.5, 0.8] })];
    const append = planStudioGpuPinnedStrokeFeedUpdate(tap, moved);

    expect(append).toMatchObject({
      mode: "append",
      patch: {
        previousPointCount: 1,
        suffixPoints: [9, 7],
        suffixPressures: [0.8],
      },
    });
    expect(planStudioGpuPinnedStrokeFeedUpdate(moved, [stroke({
      points: [2, 3, 9, 7],
      pressures: [0.5, 0.8],
    })])).toMatchObject({ mode: "retain" });
    expect(planStudioGpuPinnedStrokeFeedUpdate(moved, [stroke({
      points: [2, 3, 9, 7, 12, 9],
      pressures: [0.5, 0.8, 1],
      color: "#ff0000",
    })])).toMatchObject({ mode: "replace" });
    expect(planStudioGpuPinnedStrokeFeedUpdate(moved, [])).toEqual({ mode: "reset" });

    const settled = moved[0]!;
    const nextOperation = stroke({ id: "next", points: [20, 20], pressures: [0.6] });
    expect(planStudioGpuPinnedStrokeFeedUpdate(
      [settled],
      [settled, nextOperation]
    )).toMatchObject({
      mode: "append-operations",
      patch: {
        previousStrokeCount: 1,
        suffixStrokes: [nextOperation],
      },
    });
  });

  it("binds linear pressure semantics into feed style, suffixes, and accumulated bounds", () => {
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1;
    const tap = stroke({
      points: [10, 20],
      pressures: [0],
      size: 10,
      pressureModel,
    });
    const baseline = createStudioGpuStrokeFeedBaseline([tap], "linear-feed")!;
    expect(baseline[0]?.[STUDIO_GPU_STROKE_FEED_REVISION]).toMatchObject({
      minimumX: 10,
      maximumX: 10,
      minimumY: 20,
      maximumY: 20,
    });

    const extended = [stroke({
      points: [10, 20, 30, 20],
      pressures: [0, 1],
      size: 10,
      pressureModel,
    })];
    const advanced = advanceStudioGpuStrokeFeed(
      baseline,
      patch(extended, 1, [30, 20], [1])
    );
    expect(advanced.status).toBe("appended");
    expect(advanced.strokes[0]?.[STUDIO_GPU_STROKE_FEED_REVISION]).toMatchObject({
      minimumX: 10,
      maximumX: 35,
      minimumY: 15,
      maximumY: 25,
    });
    expect(studioGpuStrokeFeedSuffixFromPointCount(advanced.strokes[0]!, 1))
      .toMatchObject({ pressureModel });
    expect(planStudioGpuPinnedStrokeFeedUpdate(baseline, [{ ...extended[0]!, pressureModel: undefined }]))
      .toMatchObject({ mode: "replace" });
  });

  it("records model-specific nominal pressure when a baseline sample is missing", () => {
    const linear = createStudioGpuStrokeFeedBaseline([stroke({
      pressures: [],
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1,
    })], "linear-missing")!;
    const legacy = createStudioGpuStrokeFeedBaseline([stroke({ pressures: [] })], "legacy-missing")!;

    expect(linear[0]?.[STUDIO_GPU_STROKE_FEED_REVISION]?.lastPressure).toBe(1);
    expect(legacy[0]?.[STUDIO_GPU_STROKE_FEED_REVISION]?.lastPressure).toBe(0.5);
  });

  it("carries the residual V2 brush phase on each immutable feed revision", () => {
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2;
    const tap = stroke({
      points: [0, 0],
      pressures: [1],
      size: 16,
      pressureModel,
    });
    const baseline = createStudioGpuStrokeFeedBaseline([tap], "residual-feed")!;
    expect(baseline[0]?.[STUDIO_GPU_STROKE_FEED_REVISION]).toMatchObject({
      residualDabCount: 1,
      residualInkState: { distanceRemainder: 0, lastDabX: 0, lastDabY: 0 },
    });

    const extended = [stroke({
      points: [0, 0, 4, 0],
      pressures: [1, 1],
      size: 16,
      pressureModel,
    })];
    const advanced = advanceStudioGpuStrokeFeed(
      baseline,
      patch(extended, 1, [4, 0], [1])
    );
    expect(advanced.status).toBe("appended");
    const revision = advanced.strokes[0]?.[STUDIO_GPU_STROKE_FEED_REVISION];
    expect(revision).toMatchObject({
      residualDabCount: 2,
      residualInkState: {
        previousX: 4,
        lastDabX: 3.2,
      },
    });
    expect(Object.isFrozen(revision?.residualInkState)).toBe(true);
    expect(revision?.residualInkState?.distanceRemainder).toBeCloseTo(0.8, 12);
  });

  it("carries V3 normalized phase through a stationary pressure-only feed suffix", () => {
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3;
    const moved = stroke({
      points: [0, 0, 9, 0],
      pressures: [1, 1],
      size: 50,
      pressureModel,
    });
    const baseline = createStudioGpuStrokeFeedBaseline([moved], "residual-v3-feed")!;
    expect(baseline[0]?.[STUDIO_GPU_STROKE_FEED_REVISION]).toMatchObject({
      residualDabCount: 1,
      residualInkState: {
        previousX: 9,
        previousPressure: 1,
        lastDabX: 0,
        distanceRemainder: 0,
        spacingPhase: 0.9,
      },
    });

    const pressureOnly = stroke({
      points: [0, 0, 9, 0, 9, 0],
      pressures: [1, 1, 0],
      size: 50,
      pressureModel,
    });
    const stationary = advanceStudioGpuStrokeFeed(
      baseline,
      patch([pressureOnly], 2, [9, 0], [0])
    );
    expect(stationary.status).toBe("appended");
    expect(stationary.strokes[0]?.[STUDIO_GPU_STROKE_FEED_REVISION]).toMatchObject({
      residualDabCount: 1,
      residualInkState: { previousPressure: 0, lastDabX: 0, spacingPhase: 0.9 },
    });

    const released = stroke({
      points: [0, 0, 9, 0, 9, 0, 10, 0],
      pressures: [1, 1, 0, 0],
      size: 50,
      pressureModel,
    });
    const advanced = advanceStudioGpuStrokeFeed(
      stationary.strokes,
      patch([released], 3, [10, 0], [0])
    );
    expect(advanced.status).toBe("appended");
    expect(advanced.strokes[0]?.[STUDIO_GPU_STROKE_FEED_REVISION]).toMatchObject({
      residualDabCount: 3,
      residualInkState: {
        previousX: 10,
        previousPressure: 0,
        lastDabX: 9.55,
      },
    });
    expect(
      advanced.strokes[0]?.[STUDIO_GPU_STROKE_FEED_REVISION]
        ?.residualInkState?.spacingPhase
    ).toBeCloseTo(0.9, 12);
  });

  it("expands feed bounds for residual V2 backtrack dabs outside source-point bounds", () => {
    const baseline = createStudioGpuStrokeFeedBaseline([stroke({
      points: [0, 0, 5, 0, 0, 0],
      pressures: [1, 1, 1],
      size: 16,
      pressureModel: STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_V2,
    })], "residual-bounds")!;
    const revision = baseline[0]?.[STUDIO_GPU_STROKE_FEED_REVISION];

    expect(revision?.minimumX).toBeCloseTo(-11.2, 12);
    expect(revision?.maximumX).toBeCloseTo(13, 12);
    expect(revision?.minimumY).toBe(-8);
    expect(revision?.maximumY).toBe(8);
  });

  it("materializes tap, multi-revision suffix, and final-seal geometry from one root checkpoint", () => {
    const baseline = createStudioGpuStrokeFeedBaseline([stroke()], "recovery-feed")!;
    const rootRevision = baseline[0]![STUDIO_GPU_STROKE_FEED_REVISION]!;
    expect(rootRevision.recoveryCheckpoint).toMatchObject({
      lineage: rootRevision.lineage,
      pointCount: 1,
      points: [2, 3],
      pressures: [0.5],
      trustedImmutable: true,
    });
    expect(rootRevision.recoveryCheckpoint?.points).toBe(baseline[0]!.points);
    expect(rootRevision.recoveryCheckpoint?.pressures).toBe(baseline[0]!.pressures);

    const tap = materializeStudioGpuStrokeFeedStroke(baseline[0]!);
    expect(tap).toMatchObject({ points: [2, 3], pressures: [0.5] });
    expect(tap?.points).toBe(rootRevision.recoveryCheckpoint?.points);
    expect(tap?.pressures).toBe(rootRevision.recoveryCheckpoint?.pressures);

    const moved = [stroke({ points: [2, 3, 8, 4], pressures: [0.5, 0.65] })];
    const first = advanceStudioGpuStrokeFeed(baseline, patch(moved, 1, [8, 4], [0.65]));
    expect(first.status).toBe("appended");
    const sealedSource = [stroke({
      points: [2, 3, 8, 4, 13, 9],
      pressures: [0.5, 0.65, 0.9],
    })];
    const sealed = advanceStudioGpuStrokeFeed(
      first.strokes,
      patch(sealedSource, 2, [13, 9], [0.9])
    );
    expect(sealed.status).toBe("appended");

    const recovered = materializeStudioGpuStrokeFeedStroke(sealed.strokes[0]!);
    expect(recovered).toMatchObject({
      id: "live",
      points: [2, 3, 8, 4, 13, 9],
      pressures: [0.5, 0.65, 0.9],
      color: "#7c5cff",
      size: 6,
    });
    expect(Object.isFrozen(recovered)).toBe(true);
    expect(Object.isFrozen(recovered?.points)).toBe(true);
    expect(Object.isFrozen(recovered?.pressures)).toBe(true);
    expect(materializeStudioGpuStrokeFeedStroke(sealed.strokes[0]!)).toBe(recovered);
  });

  it("normalizes unsafe root pressure arrays without duplicating already-canonical ones", () => {
    const baseline = createStudioGpuStrokeFeedBaseline([
      stroke({ points: [0, 0, 1, 1], pressures: [2] }),
    ], "normalized-recovery")!;
    const checkpoint = baseline[0]![STUDIO_GPU_STROKE_FEED_REVISION]!.recoveryCheckpoint!;

    expect(checkpoint.points).toBe(baseline[0]!.points);
    expect(checkpoint.pressures).not.toBe(baseline[0]!.pressures);
    expect(checkpoint.pressures).toEqual([1, 0.5]);
    expect(materializeStudioGpuStrokeFeedStroke(baseline[0]!)).toMatchObject({
      points: [0, 0, 1, 1],
      pressures: [1, 0.5],
    });
  });

  it("materializes multiple symmetry variations atomically", () => {
    const baseline = createStudioGpuStrokeFeedBaseline([
      stroke({ id: "live", points: [2, 3] }),
      stroke({ id: "live:gpu-symmetry:1", points: [98, 3] }),
    ], "recovery-symmetry")!;
    const fallback = [
      stroke({ id: "live", points: [2, 3, 9, 7], pressures: [0.5, 0.8] }),
      stroke({
        id: "live:gpu-symmetry:1",
        points: [98, 3, 91, 7],
        pressures: [0.5, 0.8],
      }),
    ];
    const advanced = advanceStudioGpuStrokeFeedBatch(baseline, {
      fallbackStrokes: fallback,
      patches: fallback.map((nextStroke, strokeIndex) => ({
        strokeIndex,
        previousPointCount: 1,
        suffixPoints: nextStroke.points.slice(2),
        suffixPressures: [0.8],
        nextStroke,
        fallbackStrokes: fallback,
      })),
    });
    expect(advanced.status).toBe("appended");

    const recovered = materializeStudioGpuStrokeFeedStrokes(advanced.strokes);
    expect(recovered?.map(({ id, points, pressures }) => ({ id, points, pressures }))).toEqual([
      { id: "live", points: [2, 3, 9, 7], pressures: [0.5, 0.8] },
      {
        id: "live:gpu-symmetry:1",
        points: [98, 3, 91, 7],
        pressures: [0.5, 0.8],
      },
    ]);
    expect(Object.isFrozen(recovered)).toBe(true);
  });

  it("preserves residual pressure samples while recovering across phase-bearing revisions", () => {
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_RESIDUAL_PATH_V3;
    const baseline = createStudioGpuStrokeFeedBaseline([stroke({
      points: [0, 0, 9, 0],
      pressures: [1, 1],
      size: 50,
      pressureModel,
    })], "recovery-residual-v3")!;
    const pressureOnly = [stroke({
      points: [0, 0, 9, 0, 9, 0],
      pressures: [1, 1, 0],
      size: 50,
      pressureModel,
    })];
    const stationary = advanceStudioGpuStrokeFeed(
      baseline,
      patch(pressureOnly, 2, [9, 0], [0])
    );
    expect(stationary.status).toBe("appended");
    expect(stationary.strokes[0]?.[STUDIO_GPU_STROKE_FEED_REVISION]).toMatchObject({
      residualInkState: { previousPressure: 0, spacingPhase: 0.9 },
    });

    expect(materializeStudioGpuStrokeFeedStroke(stationary.strokes[0]!)).toMatchObject({
      points: [0, 0, 9, 0, 9, 0],
      pressures: [1, 1, 0],
      pressureModel,
    });
  });

  it("fails closed for malformed lineage, point counts, and current style", () => {
    const baseline = createStudioGpuStrokeFeedBaseline([stroke()], "recovery-reject")!;
    const next = [stroke({ points: [2, 3, 8, 4], pressures: [0.5, 0.65] })];
    const advanced = advanceStudioGpuStrokeFeed(baseline, patch(next, 1, [8, 4], [0.65]));
    const candidate = advanced.strokes[0]!;
    const revision = candidate[STUDIO_GPU_STROKE_FEED_REVISION]!;
    const withRevision = (overrides: Partial<typeof revision>): StudioGpuStroke => Object.freeze({
      ...candidate,
      [STUDIO_GPU_STROKE_FEED_REVISION]: Object.freeze({ ...revision, ...overrides }),
    });

    expect(materializeStudioGpuStrokeFeedStroke(withRevision({ lineage: "forged" }))).toBeNull();
    expect(materializeStudioGpuStrokeFeedStroke(withRevision({ pointCount: 99 }))).toBeNull();
    expect(materializeStudioGpuStrokeFeedStroke({ ...candidate, color: "#ff0000" })).toBeNull();
    expect(materializeStudioGpuStrokeFeedStrokes([
      candidate,
      withRevision({ parentPointCount: 999 }),
    ])).toBeNull();
  });

  it("rejects copied or fabricated revision provenance across every traversal", () => {
    const baseline = createStudioGpuStrokeFeedBaseline([stroke()], "recovery-provenance")!;
    const next = [stroke({ points: [2, 3, 8, 4], pressures: [0.5, 0.65] })];
    const advanced = advanceStudioGpuStrokeFeed(baseline, patch(next, 1, [8, 4], [0.65]));
    const genuine = advanced.strokes[0]!;
    const copied = Object.freeze({
      ...genuine,
      [STUDIO_GPU_STROKE_FEED_REVISION]: genuine[STUDIO_GPU_STROKE_FEED_REVISION],
    });
    expect(materializeStudioGpuStrokeFeedStroke(copied)).toBeNull();
    expect(studioGpuStrokeFeedSuffixFromPointCount(copied, 1)).toBeNull();
    expect(studioGpuStrokeFeedRevisionAtPointCount(copied, 1)).toBeNull();

    const fakeRevision: Record<PropertyKey, unknown> = {
      lineage: "fake",
      revision: 1,
      token: "fake-token",
      pointCount: 2,
      parentPointCount: 1,
      suffixPoints: Object.freeze([1, 1]),
      suffixPressures: Object.freeze([0.5]),
      lastX: 1,
      lastY: 1,
      lastPressure: 0.5,
      minimumX: 0,
      minimumY: 0,
      maximumX: 1,
      maximumY: 1,
      styleSignature: "fake-style",
      recoveryCheckpoint: null,
      trustedImmutable: true,
    };
    fakeRevision.parent = fakeRevision;
    Object.freeze(fakeRevision);
    const fabricated = Object.freeze({
      ...stroke({ points: [0, 0, 1, 1] }),
      [STUDIO_GPU_STROKE_FEED_REVISION]: fakeRevision,
    }) as unknown as StudioGpuStroke;
    expect(materializeStudioGpuStrokeFeedStroke(fabricated)).toBeNull();
    expect(studioGpuStrokeFeedSuffixFromPointCount(fabricated, 1)).toBeNull();
    expect(studioGpuStrokeFeedRevisionAtPointCount(fabricated, 1)).toBeNull();
  });

  it("recovers exclusively from checkpoint and suffixes when the current prefix is inaccessible", () => {
    const baseline = createStudioGpuStrokeFeedBaseline([stroke()], "recovery-no-current-prefix")!;
    const firstSource = [stroke({
      points: inaccessiblePrefix([2, 3, 8, 4], 2),
      pressures: inaccessiblePrefix([0.5, 0.65], 1),
    })];
    const first = advanceStudioGpuStrokeFeed(
      baseline,
      patch(firstSource, 1, [8, 4], [0.65])
    );
    expect(first.status).toBe("appended");
    const finalSource = [stroke({
      points: inaccessiblePrefix([2, 3, 8, 4, 13, 9], 4),
      pressures: inaccessiblePrefix([0.5, 0.65, 0.9], 2),
    })];
    const sealed = advanceStudioGpuStrokeFeed(
      first.strokes,
      patch(finalSource, 2, [13, 9], [0.9])
    );
    expect(sealed.status).toBe("appended");

    expect(() => materializeStudioGpuStrokeFeedStroke(sealed.strokes[0]!)).not.toThrow();
    expect(materializeStudioGpuStrokeFeedStroke(sealed.strokes[0]!)).toMatchObject({
      points: [2, 3, 8, 4, 13, 9],
      pressures: [0.5, 0.65, 0.9],
    });
  });

  it("mints a zero-copy dab receipt from the retained endpoint and immutable revision chunks", () => {
    const baseline = createStudioGpuStrokeFeedCompactBaseline([stroke()], "dab-receipt")!;
    const first = advanceStudioGpuStrokeFeedCompact(baseline, {
      strokeIndex: 0,
      previousPointCount: 1,
      previousRevisionToken: baseline[0]![STUDIO_GPU_STROKE_FEED_REVISION]!.token,
      suffixPoints: [8, 4, 13, 9],
      suffixPressures: [0.65, 0.9],
    });
    expect(first.status).toBe("appended");
    const second = advanceStudioGpuStrokeFeedCompact(first.strokes, {
      strokeIndex: 0,
      previousPointCount: 3,
      previousRevisionToken: first.strokes[0]![STUDIO_GPU_STROKE_FEED_REVISION]!.token,
      suffixPoints: [18, 11],
      suffixPressures: [0.75],
    });
    expect(second.status).toBe("appended");

    const latest = second.strokes[0]![STUDIO_GPU_STROKE_FEED_REVISION]!;
    const firstChild = latest.parent!;
    const receipt = studioGpuStrokeFeedDabExtensionReceipt(second.strokes[0]!, 1);
    expect(receipt).toMatchObject({
      lineage: latest.lineage,
      previousPointCount: 1,
      pointCount: 4,
      suffixPointCount: 3,
      previousX: 2,
      previousY: 3,
      previousPressure: 0.5,
      toRevisionToken: latest.token,
    });
    expect(isTrustedStudioGpuStrokeFeedDabExtensionReceipt(receipt)).toBe(true);
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt?.suffixRevisions)).toBe(true);
    expect(receipt?.suffixRevisions).toEqual([firstChild, latest]);
    expect(receipt?.suffixRevisions[0]?.suffixPoints).toBe(firstChild.suffixPoints);
    expect(receipt?.suffixRevisions[1]?.suffixPoints).toBe(latest.suffixPoints);
    expect(studioGpuStrokeFeedDabExtensionReceipt(second.strokes[0]!, 1)).toBe(receipt);
    expect(isTrustedStudioGpuStrokeFeedDabExtensionReceipt({
      ...receipt,
    })).toBe(false);
  });

  it("fails dab receipts closed for stale count, style/provenance, and CPU admission overflow", () => {
    const baseline = createStudioGpuStrokeFeedCompactBaseline([stroke()], "dab-receipt-reject")!;
    const advanced = advanceStudioGpuStrokeFeedCompact(baseline, {
      strokeIndex: 0,
      previousPointCount: 1,
      previousRevisionToken: baseline[0]![STUDIO_GPU_STROKE_FEED_REVISION]!.token,
      suffixPoints: [8, 4, 13, 9],
      suffixPressures: [0.65, 0.9],
    });
    const candidate = advanced.strokes[0]!;

    expect(studioGpuStrokeFeedDabExtensionReceipt(candidate, 0)).toBeNull();
    expect(studioGpuStrokeFeedDabExtensionReceipt(candidate, 2)).toBeNull();
    expect(studioGpuStrokeFeedDabExtensionReceipt(candidate, 3)).toBeNull();
    expect(studioGpuStrokeFeedDabExtensionReceipt(candidate, 1, 1)).toBeNull();
    expect(studioGpuStrokeFeedDabExtensionReceipt({
      ...candidate,
      color: "#ffffff",
    }, 1)).toBeNull();
  });

  it("proves a symmetry receipt group atomically and rejects torn pressure/style/budget members", () => {
    const leftBaseline = createStudioGpuStrokeFeedCompactBaseline([
      stroke({ id: "left", points: [10, 10], pressures: [0.5] }),
    ], "dab-group-left")!;
    const rightBaseline = createStudioGpuStrokeFeedCompactBaseline([
      stroke({ id: "right", points: [90, 10], pressures: [0.5] }),
    ], "dab-group-right")!;
    const advanceOne = (
      baseline: readonly StudioGpuStroke[],
      suffixPoints: readonly number[],
      pressure: number
    ) => advanceStudioGpuStrokeFeedCompact(baseline, {
      strokeIndex: 0,
      previousPointCount: 1,
      previousRevisionToken: baseline[0]![STUDIO_GPU_STROKE_FEED_REVISION]!.token,
      suffixPoints,
      suffixPressures: [pressure],
    }).strokes[0]!;

    const left = advanceOne(leftBaseline, [20, 20], 0.8);
    const right = advanceOne(rightBaseline, [80, 20], 0.8);
    const tornPressure = advanceOne(rightBaseline, [80, 20], 0.7);
    const tornStyleBaseline = createStudioGpuStrokeFeedCompactBaseline([
      stroke({ id: "style", points: [90, 10], pressures: [0.5], size: 12 }),
    ], "dab-group-style")!;
    const tornStyle = advanceOne(tornStyleBaseline, [80, 20], 0.8);

    const group = studioGpuStrokeFeedDabExtensionReceiptBatch([left, right], 1);
    expect(group).toHaveLength(2);
    expect(Object.isFrozen(group)).toBe(true);
    expect(studioGpuStrokeFeedDabExtensionReceiptBatch([left, tornPressure], 1)).toBeNull();
    expect(studioGpuStrokeFeedDabExtensionReceiptBatch([left, tornStyle], 1)).toBeNull();
    expect(studioGpuStrokeFeedDabExtensionReceiptBatch([left, right], 1, 1)).toBeNull();
  });
});
