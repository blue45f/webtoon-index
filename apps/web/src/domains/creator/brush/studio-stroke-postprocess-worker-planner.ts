import { STABILIZER_MAX } from "../studio-brush";

import {
  STUDIO_STROKE_POSTPROCESS_MAX_COORDINATE_BYTES,
  STUDIO_STROKE_POSTPROCESS_MAX_POINTS,
} from "./studio-stroke-postprocess-worker-protocol";

/**
 * A transferred Float64 point is 16 bytes (x + y). 2,048 points therefore cross the boundary as
 * a 32 KiB buffer. Below that size, module-worker scheduling generally costs more than this
 * bounded-radius O(n) filter saves.
 */
export const STUDIO_STROKE_POSTPROCESS_WORKER_MIN_POINTS = 2_048;
export const STUDIO_STROKE_POSTPROCESS_WORKER_MIN_COORDINATE_BYTES =
  STUDIO_STROKE_POSTPROCESS_WORKER_MIN_POINTS * 2 * Float64Array.BYTES_PER_ELEMENT;

/**
 * The second threshold accounts for strength: weak smoothing performs one 3/5-tap pass, while
 * strong smoothing performs two 7/9-tap passes. A Worker is selected only after roughly 32K
 * weighted-neighborhood reads, keeping short/weak marks on the direct path.
 */
export const STUDIO_STROKE_POSTPROCESS_WORKER_MIN_ESTIMATED_KERNEL_SAMPLES = 32_768;

export interface StudioStrokePostprocessPlannerPolicy {
  readonly maxPoints: number;
  readonly maxCoordinateBytes: number;
  readonly minWorkerPoints: number;
  readonly minWorkerCoordinateBytes: number;
  readonly minEstimatedKernelSamples: number;
}

export const STUDIO_STROKE_POSTPROCESS_DEFAULT_PLANNER_POLICY:
  StudioStrokePostprocessPlannerPolicy = Object.freeze({
    maxPoints: STUDIO_STROKE_POSTPROCESS_MAX_POINTS,
    maxCoordinateBytes: STUDIO_STROKE_POSTPROCESS_MAX_COORDINATE_BYTES,
    minWorkerPoints: STUDIO_STROKE_POSTPROCESS_WORKER_MIN_POINTS,
    minWorkerCoordinateBytes: STUDIO_STROKE_POSTPROCESS_WORKER_MIN_COORDINATE_BYTES,
    minEstimatedKernelSamples: STUDIO_STROKE_POSTPROCESS_WORKER_MIN_ESTIMATED_KERNEL_SAMPLES,
  });

export type StudioStrokePostprocessPlanReason =
  | "below-worker-threshold"
  | "byte-budget-exceeded"
  | "invalid-coordinate-count"
  | "no-op"
  | "point-budget-exceeded"
  | "worker-unavailable"
  | "worker-worthy";

export interface StudioStrokePostprocessPlanInput {
  readonly coordinateCount: number;
  readonly strength: number;
  readonly workerAvailable: boolean;
}

export interface StudioStrokePostprocessPlan {
  readonly kind: "direct" | "reject" | "worker";
  readonly reason: StudioStrokePostprocessPlanReason;
  readonly coordinateCount: number;
  readonly pointCount: number;
  readonly coordinateByteLength: number;
  readonly normalizedStrength: number;
  readonly radius: number;
  readonly passes: number;
  readonly estimatedKernelSamples: number;
}

function normalizeStrength(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(STABILIZER_MAX, Math.max(0, value)));
}

function smoothingShape(strength: number): Readonly<{ radius: number; passes: number }> {
  if (strength === 0) return { radius: 0, passes: 0 };
  return {
    radius: Math.max(1, Math.ceil(strength / 3)),
    passes: strength >= 6 ? 2 : 1,
  };
}

function validPolicyValue(value: number, minimum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum;
}

function validatePolicy(policy: StudioStrokePostprocessPlannerPolicy): void {
  if (
    !validPolicyValue(policy.maxPoints, 1)
    || !validPolicyValue(policy.maxCoordinateBytes, Float64Array.BYTES_PER_ELEMENT * 2)
    || !validPolicyValue(policy.minWorkerPoints, 1)
    || !validPolicyValue(policy.minWorkerCoordinateBytes, Float64Array.BYTES_PER_ELEMENT * 2)
    || !validPolicyValue(policy.minEstimatedKernelSamples, 1)
  ) {
    throw new RangeError("Stroke postprocess planner policy values must be positive safe integers.");
  }
}

export function planStudioStrokePostprocess(
  input: StudioStrokePostprocessPlanInput,
  policy: StudioStrokePostprocessPlannerPolicy = STUDIO_STROKE_POSTPROCESS_DEFAULT_PLANNER_POLICY,
): StudioStrokePostprocessPlan {
  validatePolicy(policy);
  const normalizedStrength = normalizeStrength(input.strength);
  const shape = smoothingShape(normalizedStrength);
  const validCoordinateCount = Number.isSafeInteger(input.coordinateCount)
    && input.coordinateCount >= 0
    && input.coordinateCount % 2 === 0;
  const pointCount = validCoordinateCount ? input.coordinateCount / 2 : 0;
  const coordinateByteLength = validCoordinateCount
    ? input.coordinateCount * Float64Array.BYTES_PER_ELEMENT
    : 0;
  const estimatedKernelSamples = pointCount * shape.passes * (shape.radius * 2 + 1);
  const common = {
    coordinateCount: input.coordinateCount,
    pointCount,
    coordinateByteLength,
    normalizedStrength,
    radius: shape.radius,
    passes: shape.passes,
    estimatedKernelSamples,
  };

  if (!validCoordinateCount) {
    return { kind: "reject", reason: "invalid-coordinate-count", ...common };
  }
  if (pointCount > policy.maxPoints) {
    return { kind: "reject", reason: "point-budget-exceeded", ...common };
  }
  if (coordinateByteLength > policy.maxCoordinateBytes) {
    return { kind: "reject", reason: "byte-budget-exceeded", ...common };
  }
  if (normalizedStrength === 0 || pointCount < 3) {
    return { kind: "direct", reason: "no-op", ...common };
  }
  if (!input.workerAvailable) {
    return { kind: "direct", reason: "worker-unavailable", ...common };
  }
  if (
    pointCount < policy.minWorkerPoints
    || coordinateByteLength < policy.minWorkerCoordinateBytes
    || estimatedKernelSamples < policy.minEstimatedKernelSamples
  ) {
    return { kind: "direct", reason: "below-worker-threshold", ...common };
  }
  return { kind: "worker", reason: "worker-worthy", ...common };
}
