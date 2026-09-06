import { describe, expect, it } from "vitest";

import {
  STUDIO_STROKE_POSTPROCESS_DEFAULT_PLANNER_POLICY,
  STUDIO_STROKE_POSTPROCESS_WORKER_MIN_COORDINATE_BYTES,
  STUDIO_STROKE_POSTPROCESS_WORKER_MIN_ESTIMATED_KERNEL_SAMPLES,
  STUDIO_STROKE_POSTPROCESS_WORKER_MIN_POINTS,
  planStudioStrokePostprocess,
} from "./studio-stroke-postprocess-worker-planner";

describe("planStudioStrokePostprocess", () => {
  it("keeps small strokes on the direct path without starting a Worker", () => {
    const plan = planStudioStrokePostprocess({
      coordinateCount: (STUDIO_STROKE_POSTPROCESS_WORKER_MIN_POINTS - 1) * 2,
      strength: 10,
      workerAvailable: true,
    });

    expect(plan).toMatchObject({
      kind: "direct",
      reason: "below-worker-threshold",
      pointCount: STUDIO_STROKE_POSTPROCESS_WORKER_MIN_POINTS - 1,
    });
  });

  it("documents the 32 KiB plus 32K-kernel-sample offload threshold", () => {
    const strong = planStudioStrokePostprocess({
      coordinateCount: STUDIO_STROKE_POSTPROCESS_WORKER_MIN_POINTS * 2,
      strength: 10,
      workerAvailable: true,
    });

    expect(STUDIO_STROKE_POSTPROCESS_WORKER_MIN_COORDINATE_BYTES).toBe(32 * 1024);
    expect(STUDIO_STROKE_POSTPROCESS_WORKER_MIN_ESTIMATED_KERNEL_SAMPLES).toBe(32_768);
    expect(strong).toMatchObject({
      kind: "worker",
      reason: "worker-worthy",
      pointCount: 2_048,
      coordinateByteLength: 32 * 1024,
      radius: 4,
      passes: 2,
      estimatedKernelSamples: 36_864,
    });

    const weakAtSameLength = planStudioStrokePostprocess({
      coordinateCount: STUDIO_STROKE_POSTPROCESS_WORKER_MIN_POINTS * 2,
      strength: 1,
      workerAvailable: true,
    });
    expect(weakAtSameLength).toMatchObject({
      kind: "direct",
      reason: "below-worker-threshold",
      radius: 1,
      passes: 1,
      estimatedKernelSamples: 6_144,
    });

    const weakButLong = planStudioStrokePostprocess({
      coordinateCount: 10_923 * 2,
      strength: 1,
      workerAvailable: true,
    });
    expect(weakButLong).toMatchObject({
      kind: "worker",
      estimatedKernelSamples: 32_769,
    });
  });

  it("makes Worker absence and zero-strength work explicit direct fallbacks", () => {
    expect(planStudioStrokePostprocess({
      coordinateCount: 20_000,
      strength: 10,
      workerAvailable: false,
    })).toMatchObject({ kind: "direct", reason: "worker-unavailable" });

    expect(planStudioStrokePostprocess({
      coordinateCount: 20_000,
      strength: Number.NaN,
      workerAvailable: true,
    })).toMatchObject({ kind: "direct", reason: "no-op", normalizedStrength: 0 });
  });

  it("rejects odd coordinate arrays before any execution path is selected", () => {
    expect(planStudioStrokePostprocess({
      coordinateCount: 7,
      strength: 8,
      workerAvailable: true,
    })).toMatchObject({ kind: "reject", reason: "invalid-coordinate-count" });
  });

  it("enforces point and byte budgets independently", () => {
    expect(planStudioStrokePostprocess(
      { coordinateCount: 202, strength: 8, workerAvailable: true },
      {
        ...STUDIO_STROKE_POSTPROCESS_DEFAULT_PLANNER_POLICY,
        maxPoints: 100,
        maxCoordinateBytes: 100_000,
      },
    )).toMatchObject({ kind: "reject", reason: "point-budget-exceeded" });

    expect(planStudioStrokePostprocess(
      { coordinateCount: 200, strength: 8, workerAvailable: true },
      {
        ...STUDIO_STROKE_POSTPROCESS_DEFAULT_PLANNER_POLICY,
        maxPoints: 1_000,
        maxCoordinateBytes: 1_000,
      },
    )).toMatchObject({
      kind: "reject",
      reason: "byte-budget-exceeded",
      coordinateByteLength: 1_600,
    });
  });
});
