/**
 * Deterministic, renderer-neutral vector-ink fitting boundary.
 *
 * The three permissive specialist libraries are deliberately kept behind this file:
 *
 * - simplify-js performs high-quality adaptive pre-simplification.
 * - fit-curve performs deterministic cubic fitting.
 * - bezier-js supplies curve length, exact extrema bounds, projection and arc-length resampling.
 *
 * History, collaboration and persistence only receive the frozen plain-data artifact below.
 * No vendor instance or vendor-owned point is ever returned or serialized.
 */

import { Bezier } from "bezier-js";
import fitCurve from "fit-curve";
import simplify from "simplify-js";

export const STUDIO_VECTOR_INK_GEOMETRY_VERSION = 1 as const;

export const STUDIO_VECTOR_INK_GEOMETRY_LIMITS = Object.freeze({
  maxInputSamples: 65_536,
  maxCoordinateAbsolute: 1_000_000,
  maxSegments: 65_536,
  maxResampledPoints: 262_144,
  maxWorkUnits: 12_000_000,
  maxFitSpanPoints: 1_024,
  maxSerializedCharacters: 32 * 1_024 * 1_024,
} as const);

export interface StudioVectorInkSampleCandidate {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
}

export interface StudioVectorInkSample {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
}

export interface StudioVectorInkSettingsCandidate {
  /** Maximum admitted source-to-curve deviation in document CSS pixels. */
  readonly maxCurveError?: number;
  /** A local turn at or above this angle is preserved as an explicit cubic boundary. */
  readonly cornerAngleRadians?: number;
  /** Maximum distance between persisted arc-length resamples in document CSS pixels. */
  readonly resampleSpacing?: number;
}

export interface StudioVectorInkSettings {
  readonly maxCurveError: number;
  readonly cornerAngleRadians: number;
  readonly resampleSpacing: number;
  readonly simplification: "adaptive-high-quality-v1";
  readonly curveFitting: "schneider-cubic-v1";
  readonly resampling: "bezier-arc-length-v1";
}

export interface StudioVectorInkGeometryRequest {
  readonly samples: readonly StudioVectorInkSampleCandidate[];
  readonly settings?: StudioVectorInkSettingsCandidate;
}

export interface StudioVectorInkExecutionLimits {
  readonly maxInputSamples?: number;
  readonly maxSegments?: number;
  readonly maxResampledPoints?: number;
  readonly maxWorkUnits?: number;
  readonly maxFitSpanPoints?: number;
}

export interface StudioVectorInkExecutionControl {
  readonly signal?: AbortSignal;
  readonly limits?: StudioVectorInkExecutionLimits;
}

export interface StudioVectorInkPoint {
  readonly x: number;
  readonly y: number;
}

export interface StudioVectorInkBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioVectorInkPressureRange {
  readonly minimum: number;
  readonly maximum: number;
}

export interface StudioVectorInkPressureSample {
  readonly sourceIndex: number;
  readonly t: number;
  readonly pressure: number;
}

export interface StudioVectorInkArcSample {
  readonly distance: number;
  readonly t: number;
  readonly x: number;
  readonly y: number;
}

export interface StudioVectorInkCubicSegment {
  readonly kind: "cubic";
  readonly segmentIndex: number;
  readonly fittingMode: "fit-curve-cubic" | "owned-linear-exact";
  readonly controls: readonly [
    StudioVectorInkPoint,
    StudioVectorInkPoint,
    StudioVectorInkPoint,
    StudioVectorInkPoint,
  ];
  /** Inclusive original sample range whose geometry is represented by this segment. */
  readonly sourceRange: readonly [number, number];
  /** Non-overlapping original sample range attached to this segment's pressure channel. */
  readonly pressureSourceRange: readonly [number, number];
  readonly pressureRange: StudioVectorInkPressureRange;
  readonly pressureSamples: readonly StudioVectorInkPressureSample[];
  readonly arcLength: number;
  readonly bounds: StudioVectorInkBounds;
  readonly maxSourceDeviation: number;
  readonly arcSamples: readonly StudioVectorInkArcSample[];
}

export interface StudioVectorInkTap {
  readonly point: StudioVectorInkPoint;
  readonly pressureRange: StudioVectorInkPressureRange;
}

export interface StudioVectorInkProviderReceipt {
  readonly vendorTypesPersisted: false;
  readonly libraries: readonly [
    {
      readonly packageName: "fit-curve";
      readonly packageVersion: "0.2.0";
      readonly licenseSpdx: "MIT";
      readonly role: "deterministic-cubic-fit";
    },
    {
      readonly packageName: "bezier-js";
      readonly packageVersion: "6.1.4";
      readonly licenseSpdx: "MIT";
      readonly role: "curve-metrics-projection-resampling";
    },
    {
      readonly packageName: "simplify-js";
      readonly packageVersion: "1.2.4";
      readonly licenseSpdx: "BSD-2-Clause";
      readonly role: "adaptive-high-quality-simplification";
    },
  ];
}

export interface StudioVectorInkGeometryArtifact {
  readonly kind: "studio-vector-ink-geometry";
  readonly version: typeof STUDIO_VECTOR_INK_GEOMETRY_VERSION;
  readonly contentHash: `fnv1a32:${string}`;
  readonly provider: StudioVectorInkProviderReceipt;
  readonly settings: StudioVectorInkSettings;
  readonly source: {
    readonly encoding: "canonical-point-pressure-v1";
    readonly samples: readonly StudioVectorInkSample[];
  };
  readonly geometryKind: "tap" | "path";
  readonly tap: StudioVectorInkTap | null;
  readonly segments: readonly StudioVectorInkCubicSegment[];
  readonly detectedCornerSourceIndices: readonly number[];
  readonly sourceSampleCount: number;
  readonly workingPointCount: number;
  readonly simplifiedPointCount: number;
  readonly totalArcLength: number;
  readonly bounds: StudioVectorInkBounds;
  readonly pressureRange: StudioVectorInkPressureRange;
  readonly maxSourceDeviation: number;
}

export type StudioVectorInkGeometryFailureReason =
  | "invalid-input"
  | "budget-exceeded"
  | "cancelled"
  | "provider-failure"
  | "quality-gate-failed"
  | "replay-mismatch";

export type StudioVectorInkGeometryResult =
  | {
    readonly ok: true;
    readonly artifact: StudioVectorInkGeometryArtifact;
  }
  | {
    readonly ok: false;
    readonly reason: StudioVectorInkGeometryFailureReason;
    readonly detail: string;
  };

interface ResolvedExecutionLimits {
  readonly maxInputSamples: number;
  readonly maxSegments: number;
  readonly maxResampledPoints: number;
  readonly maxWorkUnits: number;
  readonly maxFitSpanPoints: number;
}

interface WorkingPoint {
  readonly x: number;
  readonly y: number;
  readonly sourceStart: number;
  readonly sourceEnd: number;
}

interface SimplifyPoint {
  readonly x: number;
  readonly y: number;
  readonly workIndex: number;
}

interface InternalCurve {
  readonly controls: readonly [
    StudioVectorInkPoint,
    StudioVectorInkPoint,
    StudioVectorInkPoint,
    StudioVectorInkPoint,
  ];
  readonly workStart: number;
  readonly workEnd: number;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly fittingMode: "fit-curve-cubic" | "owned-linear-exact";
}

class StudioVectorInkStop extends Error {
  constructor(
    readonly reason: StudioVectorInkGeometryFailureReason,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "StudioVectorInkStop";
  }
}

class StudioVectorInkBudgetGuard {
  private workUnits = 0;
  private segmentCount = 0;
  private resampledPointCount = 0;

  constructor(
    private readonly limits: ResolvedExecutionLimits,
    private readonly signal: AbortSignal | undefined,
  ) {}

  checkpoint(units = 1): void {
    if (this.signal?.aborted) {
      throw new StudioVectorInkStop("cancelled", "Vector-ink geometry execution was cancelled");
    }
    this.workUnits += units;
    if (this.workUnits > this.limits.maxWorkUnits) {
      throw new StudioVectorInkStop("budget-exceeded", "Vector-ink work-unit budget exceeded");
    }
  }

  admitSegments(count: number): void {
    this.checkpoint(count);
    this.segmentCount += count;
    if (this.segmentCount > this.limits.maxSegments) {
      throw new StudioVectorInkStop("budget-exceeded", "Vector-ink segment budget exceeded");
    }
  }

  admitResampledPoints(count: number): void {
    this.checkpoint(count);
    this.resampledPointCount += count;
    if (this.resampledPointCount > this.limits.maxResampledPoints) {
      throw new StudioVectorInkStop(
        "budget-exceeded",
        "Vector-ink arc-resample budget exceeded",
      );
    }
  }
}

const DEFAULT_SETTINGS: StudioVectorInkSettings = Object.freeze({
  maxCurveError: 0.75,
  cornerAngleRadians: Math.PI * (55 / 180),
  resampleSpacing: 2,
  simplification: "adaptive-high-quality-v1",
  curveFitting: "schneider-cubic-v1",
  resampling: "bezier-arc-length-v1",
});

const PROVIDER_RECEIPT: StudioVectorInkProviderReceipt = Object.freeze({
  vendorTypesPersisted: false,
  libraries: Object.freeze([
    Object.freeze({
      packageName: "fit-curve",
      packageVersion: "0.2.0",
      licenseSpdx: "MIT",
      role: "deterministic-cubic-fit",
    }),
    Object.freeze({
      packageName: "bezier-js",
      packageVersion: "6.1.4",
      licenseSpdx: "MIT",
      role: "curve-metrics-projection-resampling",
    }),
    Object.freeze({
      packageName: "simplify-js",
      packageVersion: "1.2.4",
      licenseSpdx: "BSD-2-Clause",
      role: "adaptive-high-quality-simplification",
    }),
  ] as const),
});

const EMPTY_BOUNDS: StudioVectorInkBounds = Object.freeze({
  minX: 0,
  minY: 0,
  maxX: 0,
  maxY: 0,
  width: 0,
  height: 0,
});

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function canonicalNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function integerLimit(
  candidate: number | undefined,
  fallback: number,
  hardMaximum: number,
  label: string,
  minimum = 1,
): number {
  const value = candidate ?? fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > hardMaximum) {
    throw new StudioVectorInkStop("invalid-input", `${label} is outside its supported range`);
  }
  return value;
}

function resolveExecutionLimits(
  candidate: StudioVectorInkExecutionLimits | undefined,
): ResolvedExecutionLimits {
  return Object.freeze({
    maxInputSamples: integerLimit(
      candidate?.maxInputSamples,
      STUDIO_VECTOR_INK_GEOMETRY_LIMITS.maxInputSamples,
      STUDIO_VECTOR_INK_GEOMETRY_LIMITS.maxInputSamples,
      "maxInputSamples",
    ),
    maxSegments: integerLimit(
      candidate?.maxSegments,
      STUDIO_VECTOR_INK_GEOMETRY_LIMITS.maxSegments,
      STUDIO_VECTOR_INK_GEOMETRY_LIMITS.maxSegments,
      "maxSegments",
    ),
    maxResampledPoints: integerLimit(
      candidate?.maxResampledPoints,
      STUDIO_VECTOR_INK_GEOMETRY_LIMITS.maxResampledPoints,
      STUDIO_VECTOR_INK_GEOMETRY_LIMITS.maxResampledPoints,
      "maxResampledPoints",
    ),
    maxWorkUnits: integerLimit(
      candidate?.maxWorkUnits,
      STUDIO_VECTOR_INK_GEOMETRY_LIMITS.maxWorkUnits,
      STUDIO_VECTOR_INK_GEOMETRY_LIMITS.maxWorkUnits,
      "maxWorkUnits",
    ),
    maxFitSpanPoints: integerLimit(
      candidate?.maxFitSpanPoints,
      STUDIO_VECTOR_INK_GEOMETRY_LIMITS.maxFitSpanPoints,
      4_096,
      "maxFitSpanPoints",
      2,
    ),
  });
}

function resolveSettings(
  candidate: StudioVectorInkSettingsCandidate | undefined,
): StudioVectorInkSettings {
  const maxCurveError = candidate?.maxCurveError ?? DEFAULT_SETTINGS.maxCurveError;
  const cornerAngleRadians =
    candidate?.cornerAngleRadians ?? DEFAULT_SETTINGS.cornerAngleRadians;
  const resampleSpacing = candidate?.resampleSpacing ?? DEFAULT_SETTINGS.resampleSpacing;

  if (!finiteNumber(maxCurveError) || maxCurveError < 0.01 || maxCurveError > 64) {
    throw new StudioVectorInkStop(
      "invalid-input",
      "maxCurveError must be finite and between 0.01 and 64",
    );
  }
  if (
    !finiteNumber(cornerAngleRadians) ||
    cornerAngleRadians < Math.PI / 12 ||
    cornerAngleRadians > Math.PI * (17 / 18)
  ) {
    throw new StudioVectorInkStop(
      "invalid-input",
      "cornerAngleRadians must be finite and between 15 and 170 degrees",
    );
  }
  if (!finiteNumber(resampleSpacing) || resampleSpacing < 0.125 || resampleSpacing > 4_096) {
    throw new StudioVectorInkStop(
      "invalid-input",
      "resampleSpacing must be finite and between 0.125 and 4096",
    );
  }

  return Object.freeze({
    maxCurveError: canonicalNumber(maxCurveError),
    cornerAngleRadians: canonicalNumber(cornerAngleRadians),
    resampleSpacing: canonicalNumber(resampleSpacing),
    simplification: "adaptive-high-quality-v1",
    curveFitting: "schneider-cubic-v1",
    resampling: "bezier-arc-length-v1",
  });
}

function freezePoint(x: number, y: number): StudioVectorInkPoint {
  return Object.freeze({ x: canonicalNumber(x), y: canonicalNumber(y) });
}

function validateSamples(
  candidates: readonly StudioVectorInkSampleCandidate[],
  limits: ResolvedExecutionLimits,
  guard: StudioVectorInkBudgetGuard,
): readonly StudioVectorInkSample[] {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new StudioVectorInkStop("invalid-input", "At least one point-pressure sample is required");
  }
  if (candidates.length > limits.maxInputSamples) {
    throw new StudioVectorInkStop("budget-exceeded", "Vector-ink input sample budget exceeded");
  }

  const samples = candidates.map((candidate, index) => {
    guard.checkpoint();
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      !finiteNumber(candidate.x) ||
      !finiteNumber(candidate.y) ||
      !finiteNumber(candidate.pressure)
    ) {
      throw new StudioVectorInkStop(
        "invalid-input",
        `Sample ${index} must contain finite x, y and pressure values`,
      );
    }
    if (
      Math.abs(candidate.x) > STUDIO_VECTOR_INK_GEOMETRY_LIMITS.maxCoordinateAbsolute ||
      Math.abs(candidate.y) > STUDIO_VECTOR_INK_GEOMETRY_LIMITS.maxCoordinateAbsolute
    ) {
      throw new StudioVectorInkStop(
        "invalid-input",
        `Sample ${index} exceeds the coordinate budget`,
      );
    }
    if (candidate.pressure < 0 || candidate.pressure > 1) {
      throw new StudioVectorInkStop(
        "invalid-input",
        `Sample ${index} pressure must be between zero and one`,
      );
    }
    return Object.freeze({
      x: canonicalNumber(candidate.x),
      y: canonicalNumber(candidate.y),
      pressure: canonicalNumber(candidate.pressure),
    });
  });

  return Object.freeze(samples);
}

function createWorkingPoints(
  samples: readonly StudioVectorInkSample[],
  guard: StudioVectorInkBudgetGuard,
): readonly WorkingPoint[] {
  const points: WorkingPoint[] = [];
  for (let index = 0; index < samples.length; index += 1) {
    guard.checkpoint();
    const sample = samples[index]!;
    const previous = points.at(-1);
    if (previous && previous.x === sample.x && previous.y === sample.y) {
      points[points.length - 1] = Object.freeze({
        ...previous,
        sourceEnd: index,
      });
      continue;
    }
    points.push(Object.freeze({
      x: sample.x,
      y: sample.y,
      sourceStart: index,
      sourceEnd: index,
    }));
  }
  return Object.freeze(points);
}

function distance(left: StudioVectorInkPoint, right: StudioVectorInkPoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function detectCornerWorkIndices(
  points: readonly WorkingPoint[],
  settings: StudioVectorInkSettings,
  guard: StudioVectorInkBudgetGuard,
): readonly number[] {
  const corners: number[] = [];
  const minimumLeg = Math.max(0.05, settings.maxCurveError * 0.25);
  for (let index = 1; index < points.length - 1; index += 1) {
    guard.checkpoint();
    const previous = points[index - 1]!;
    const current = points[index]!;
    const next = points[index + 1]!;
    const incomingX = current.x - previous.x;
    const incomingY = current.y - previous.y;
    const outgoingX = next.x - current.x;
    const outgoingY = next.y - current.y;
    const incomingLength = Math.hypot(incomingX, incomingY);
    const outgoingLength = Math.hypot(outgoingX, outgoingY);
    if (incomingLength < minimumLeg || outgoingLength < minimumLeg) continue;
    const cosine = Math.max(
      -1,
      Math.min(
        1,
        (incomingX * outgoingX + incomingY * outgoingY) /
          (incomingLength * outgoingLength),
      ),
    );
    if (Math.acos(cosine) >= settings.cornerAngleRadians) corners.push(index);
  }
  return Object.freeze(corners);
}

function createFitRanges(
  pointCount: number,
  cornerIndices: readonly number[],
  maxFitSpanPoints: number,
): readonly (readonly [number, number])[] {
  const boundaries = [0, ...cornerIndices, pointCount - 1];
  const ranges: Array<readonly [number, number]> = [];
  for (let boundaryIndex = 0; boundaryIndex < boundaries.length - 1; boundaryIndex += 1) {
    const boundaryEnd = boundaries[boundaryIndex + 1]!;
    let rangeStart = boundaries[boundaryIndex]!;
    while (rangeStart < boundaryEnd) {
      const rangeEnd = Math.min(boundaryEnd, rangeStart + maxFitSpanPoints - 1);
      ranges.push(Object.freeze([rangeStart, rangeEnd] as const));
      rangeStart = rangeEnd;
    }
  }
  return Object.freeze(ranges);
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
}

function adaptiveSimplificationTolerance(
  points: readonly WorkingPoint[],
  range: readonly [number, number],
  maxCurveError: number,
  guard: StudioVectorInkBudgetGuard,
): number {
  const distances: number[] = [];
  let accumulatedTurn = 0;
  let turnCount = 0;
  for (let index = range[0] + 1; index <= range[1]; index += 1) {
    guard.checkpoint();
    distances.push(distance(points[index - 1]!, points[index]!));
    if (index >= range[1]) continue;
    const left = points[index - 1]!;
    const center = points[index]!;
    const right = points[index + 1]!;
    const ax = center.x - left.x;
    const ay = center.y - left.y;
    const bx = right.x - center.x;
    const by = right.y - center.y;
    const denominator = Math.hypot(ax, ay) * Math.hypot(bx, by);
    if (denominator <= Number.EPSILON) continue;
    const cosine = Math.max(-1, Math.min(1, (ax * bx + ay * by) / denominator));
    accumulatedTurn += Math.acos(cosine);
    turnCount += 1;
  }
  const spacingBound = Math.max(0.000_001, median(distances) * 0.2);
  const curvaturePenalty = 1 + (turnCount === 0 ? 0 : (accumulatedTurn / turnCount) * 1.5);
  return Math.max(
    0.000_001,
    Math.min(maxCurveError * 0.3, spacingBound) / curvaturePenalty,
  );
}

function simplifyRange(
  points: readonly WorkingPoint[],
  range: readonly [number, number],
  maxCurveError: number,
  guard: StudioVectorInkBudgetGuard,
): readonly SimplifyPoint[] {
  const vendorInput: SimplifyPoint[] = [];
  for (let index = range[0]; index <= range[1]; index += 1) {
    guard.checkpoint();
    const point = points[index]!;
    vendorInput.push({ x: point.x, y: point.y, workIndex: index });
  }
  if (vendorInput.length <= 2) {
    return Object.freeze(vendorInput.map((point) => Object.freeze(point)));
  }

  const tolerance = adaptiveSimplificationTolerance(points, range, maxCurveError, guard);
  const vendorOutput = simplify(vendorInput, tolerance, true) as SimplifyPoint[];
  if (
    vendorOutput.length < 2 ||
    vendorOutput[0]?.workIndex !== range[0] ||
    vendorOutput.at(-1)?.workIndex !== range[1]
  ) {
    throw new StudioVectorInkStop(
      "provider-failure",
      "simplify-js did not preserve the admitted span endpoints",
    );
  }
  return Object.freeze(vendorOutput.map((point) => Object.freeze({
    x: canonicalNumber(point.x),
    y: canonicalNumber(point.y),
    workIndex: point.workIndex,
  })));
}

function samePoint(left: readonly number[], right: SimplifyPoint): boolean {
  return left[0] === right.x && left[1] === right.y;
}

function validateVendorControlPoint(point: readonly number[]): StudioVectorInkPoint {
  if (
    point.length < 2 ||
    !finiteNumber(point[0]) ||
    !finiteNumber(point[1]) ||
    Math.abs(point[0]) > STUDIO_VECTOR_INK_GEOMETRY_LIMITS.maxCoordinateAbsolute * 4 ||
    Math.abs(point[1]) > STUDIO_VECTOR_INK_GEOMETRY_LIMITS.maxCoordinateAbsolute * 4
  ) {
    throw new StudioVectorInkStop(
      "provider-failure",
      "fit-curve returned a non-finite or unbounded control point",
    );
  }
  return freezePoint(point[0], point[1]);
}

function fitSimplifiedPoints(
  simplified: readonly SimplifyPoint[],
  points: readonly WorkingPoint[],
  error: number,
  guard: StudioVectorInkBudgetGuard,
): readonly InternalCurve[] {
  if (simplified.length === 2) {
    guard.admitSegments(1);
    return Object.freeze([
      createLinearCurve(simplified[0]!.workIndex, simplified[1]!.workIndex, points),
    ]);
  }

  guard.checkpoint(simplified.length);
  const vendorInput = simplified.map((point) => [point.x, point.y] as [number, number]);
  const fitted = fitCurve(vendorInput, error * error);
  if (!Array.isArray(fitted) || fitted.length === 0) {
    throw new StudioVectorInkStop("provider-failure", "fit-curve returned no cubic segments");
  }
  guard.admitSegments(fitted.length);

  const curves: InternalCurve[] = [];
  let simplifiedCursor = 0;
  for (const vendorCurve of fitted) {
    guard.checkpoint();
    if (!Array.isArray(vendorCurve) || vendorCurve.length !== 4) {
      throw new StudioVectorInkStop(
        "provider-failure",
        "fit-curve returned an invalid cubic segment",
      );
    }
    if (!samePoint(vendorCurve[0]!, simplified[simplifiedCursor]!)) {
      throw new StudioVectorInkStop(
        "provider-failure",
        "fit-curve returned a discontinuous segment start",
      );
    }
    let endpointIndex = simplifiedCursor + 1;
    while (
      endpointIndex < simplified.length &&
      !samePoint(vendorCurve[3]!, simplified[endpointIndex]!)
    ) {
      endpointIndex += 1;
    }
    if (endpointIndex >= simplified.length) {
      throw new StudioVectorInkStop(
        "provider-failure",
        "fit-curve returned an endpoint outside the admitted source span",
      );
    }
    const workStart = simplified[simplifiedCursor]!.workIndex;
    const workEnd = simplified[endpointIndex]!.workIndex;
    const controls = Object.freeze([
      validateVendorControlPoint(vendorCurve[0]!),
      validateVendorControlPoint(vendorCurve[1]!),
      validateVendorControlPoint(vendorCurve[2]!),
      validateVendorControlPoint(vendorCurve[3]!),
    ]) as InternalCurve["controls"];
    curves.push(Object.freeze({
      controls,
      workStart,
      workEnd,
      sourceStart: points[workStart]!.sourceStart,
      sourceEnd: points[workEnd]!.sourceEnd,
      fittingMode: "fit-curve-cubic",
    }));
    simplifiedCursor = endpointIndex;
  }
  if (simplifiedCursor !== simplified.length - 1) {
    throw new StudioVectorInkStop(
      "provider-failure",
      "fit-curve did not consume the complete admitted source span",
    );
  }
  return Object.freeze(curves);
}

function createLinearCurve(
  workStart: number,
  workEnd: number,
  points: readonly WorkingPoint[],
): InternalCurve {
  const start = points[workStart]!;
  const end = points[workEnd]!;
  const oneThird = freezePoint(
    start.x + (end.x - start.x) / 3,
    start.y + (end.y - start.y) / 3,
  );
  const twoThirds = freezePoint(
    start.x + ((end.x - start.x) * 2) / 3,
    start.y + ((end.y - start.y) * 2) / 3,
  );
  return Object.freeze({
    controls: Object.freeze([
      freezePoint(start.x, start.y),
      oneThird,
      twoThirds,
      freezePoint(end.x, end.y),
    ]) as InternalCurve["controls"],
    workStart,
    workEnd,
    sourceStart: start.sourceStart,
    sourceEnd: end.sourceEnd,
    fittingMode: "owned-linear-exact",
  });
}

function createExactPolylineCurves(
  points: readonly WorkingPoint[],
  range: readonly [number, number],
  guard: StudioVectorInkBudgetGuard,
): readonly InternalCurve[] {
  const curves: InternalCurve[] = [];
  const count = range[1] - range[0];
  guard.admitSegments(count);
  for (let index = range[0]; index < range[1]; index += 1) {
    guard.checkpoint();
    curves.push(createLinearCurve(index, index + 1, points));
  }
  return Object.freeze(curves);
}

function createBezier(curve: InternalCurve): Bezier {
  return new Bezier(curve.controls.map(({ x, y }) => ({ x, y })));
}

function projectDistance(bezier: Bezier, point: StudioVectorInkPoint): number {
  const projection = bezier.project(point);
  if (
    !finiteNumber(projection.x) ||
    !finiteNumber(projection.y) ||
    !finiteNumber(projection.t)
  ) {
    throw new StudioVectorInkStop(
      "provider-failure",
      "bezier-js returned a non-finite projection",
    );
  }
  return Math.hypot(projection.x - point.x, projection.y - point.y);
}

function measureMaxDeviation(
  curves: readonly InternalCurve[],
  samples: readonly StudioVectorInkSample[],
  guard: StudioVectorInkBudgetGuard,
): number {
  let maximum = 0;
  for (const curve of curves) {
    const bezier = createBezier(curve);
    for (let sourceIndex = curve.sourceStart; sourceIndex <= curve.sourceEnd; sourceIndex += 1) {
      guard.checkpoint();
      maximum = Math.max(maximum, projectDistance(bezier, samples[sourceIndex]!));
    }
  }
  return canonicalNumber(maximum);
}

function fitRangeWithQualityGate(
  points: readonly WorkingPoint[],
  samples: readonly StudioVectorInkSample[],
  range: readonly [number, number],
  settings: StudioVectorInkSettings,
  guard: StudioVectorInkBudgetGuard,
): {
  readonly curves: readonly InternalCurve[];
  readonly simplifiedPointCount: number;
} {
  const simplified = simplifyRange(points, range, settings.maxCurveError, guard);
  let curves = fitSimplifiedPoints(
    simplified,
    points,
    settings.maxCurveError * 0.55,
    guard,
  );
  let deviation = measureMaxDeviation(curves, samples, guard);

  if (deviation > settings.maxCurveError) {
    const raw = Object.freeze(
      points.slice(range[0], range[1] + 1).map((point, offset) => Object.freeze({
        x: point.x,
        y: point.y,
        workIndex: range[0] + offset,
      })),
    );
    curves = fitSimplifiedPoints(raw, points, settings.maxCurveError * 0.45, guard);
    deviation = measureMaxDeviation(curves, samples, guard);
  }

  if (deviation > settings.maxCurveError) {
    curves = createExactPolylineCurves(points, range, guard);
    deviation = measureMaxDeviation(curves, samples, guard);
  }

  if (deviation > settings.maxCurveError + 1e-7) {
    throw new StudioVectorInkStop(
      "quality-gate-failed",
      "Fitted vector ink exceeded the admitted source-deviation budget",
    );
  }

  return Object.freeze({
    curves,
    simplifiedPointCount: simplified.length,
  });
}

function freezeBounds(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): StudioVectorInkBounds {
  return Object.freeze({
    minX: canonicalNumber(minX),
    minY: canonicalNumber(minY),
    maxX: canonicalNumber(maxX),
    maxY: canonicalNumber(maxY),
    width: canonicalNumber(maxX - minX),
    height: canonicalNumber(maxY - minY),
  });
}

function boundsFromBezier(bezier: Bezier): StudioVectorInkBounds {
  const bounds = bezier.bbox();
  if (
    !finiteNumber(bounds.x.min) ||
    !finiteNumber(bounds.x.max) ||
    !finiteNumber(bounds.y.min) ||
    !finiteNumber(bounds.y.max)
  ) {
    throw new StudioVectorInkStop(
      "provider-failure",
      "bezier-js returned non-finite curve bounds",
    );
  }
  return freezeBounds(bounds.x.min, bounds.y.min, bounds.x.max, bounds.y.max);
}

function unionBounds(bounds: readonly StudioVectorInkBounds[]): StudioVectorInkBounds {
  if (bounds.length === 0) return EMPTY_BOUNDS;
  let minX = bounds[0]!.minX;
  let minY = bounds[0]!.minY;
  let maxX = bounds[0]!.maxX;
  let maxY = bounds[0]!.maxY;
  for (let index = 1; index < bounds.length; index += 1) {
    const current = bounds[index]!;
    minX = Math.min(minX, current.minX);
    minY = Math.min(minY, current.minY);
    maxX = Math.max(maxX, current.maxX);
    maxY = Math.max(maxY, current.maxY);
  }
  return freezeBounds(minX, minY, maxX, maxY);
}

function tAtArcDistance(
  bezier: Bezier,
  arcLength: number,
  targetDistance: number,
  guard: StudioVectorInkBudgetGuard,
): number {
  if (targetDistance <= 0) return 0;
  if (targetDistance >= arcLength) return 1;

  const lut = bezier.getLUT(64);
  guard.checkpoint(lut.length);
  let lutLength = 0;
  const cumulative = [0];
  for (let index = 1; index < lut.length; index += 1) {
    lutLength += distance(lut[index - 1]!, lut[index]!);
    cumulative.push(lutLength);
  }
  const approximateTarget = lutLength * (targetDistance / arcLength);
  let lutIndex = 1;
  while (lutIndex < cumulative.length && cumulative[lutIndex]! < approximateTarget) {
    lutIndex += 1;
  }
  let low = lut[Math.max(0, lutIndex - 1)]?.t ?? 0;
  let high = lut[Math.min(lut.length - 1, lutIndex)]?.t ?? 1;
  if (!(low < high)) {
    low = 0;
    high = 1;
  }

  for (let iteration = 0; iteration < 18; iteration += 1) {
    guard.checkpoint();
    const middle = (low + high) / 2;
    const partialLength = bezier.split(0, middle).length();
    if (!finiteNumber(partialLength)) {
      throw new StudioVectorInkStop(
        "provider-failure",
        "bezier-js returned a non-finite partial arc length",
      );
    }
    if (partialLength < targetDistance) low = middle;
    else high = middle;
  }
  return canonicalNumber((low + high) / 2);
}

function createArcSamples(
  bezier: Bezier,
  arcLength: number,
  spacing: number,
  guard: StudioVectorInkBudgetGuard,
): readonly StudioVectorInkArcSample[] {
  const intervalCount = Math.max(1, Math.ceil(arcLength / spacing - 1e-12));
  guard.admitResampledPoints(intervalCount + 1);
  const output: StudioVectorInkArcSample[] = [];
  for (let index = 0; index <= intervalCount; index += 1) {
    guard.checkpoint();
    const distanceAlong =
      index === intervalCount ? arcLength : (arcLength * index) / intervalCount;
    const t =
      index === 0
        ? 0
        : index === intervalCount
          ? 1
          : tAtArcDistance(bezier, arcLength, distanceAlong, guard);
    const point = bezier.get(t);
    if (!finiteNumber(point.x) || !finiteNumber(point.y)) {
      throw new StudioVectorInkStop(
        "provider-failure",
        "bezier-js returned a non-finite arc sample",
      );
    }
    output.push(Object.freeze({
      distance: canonicalNumber(distanceAlong),
      t,
      x: canonicalNumber(point.x),
      y: canonicalNumber(point.y),
    }));
  }
  return Object.freeze(output);
}

function createPressureRange(
  values: readonly number[],
): StudioVectorInkPressureRange {
  let minimum = values[0]!;
  let maximum = values[0]!;
  for (let index = 1; index < values.length; index += 1) {
    minimum = Math.min(minimum, values[index]!);
    maximum = Math.max(maximum, values[index]!);
  }
  return Object.freeze({
    minimum: canonicalNumber(minimum),
    maximum: canonicalNumber(maximum),
  });
}

function createPressureSamples(
  bezier: Bezier,
  samples: readonly StudioVectorInkSample[],
  sourceStart: number,
  sourceEnd: number,
  forceEndpoint: boolean,
  guard: StudioVectorInkBudgetGuard,
): readonly StudioVectorInkPressureSample[] {
  const pressureSamples: StudioVectorInkPressureSample[] = [];
  let previousT = 0;
  for (let sourceIndex = sourceStart; sourceIndex <= sourceEnd; sourceIndex += 1) {
    guard.checkpoint();
    const sample = samples[sourceIndex]!;
    const projection = bezier.project(sample);
    if (!finiteNumber(projection.t)) {
      throw new StudioVectorInkStop(
        "provider-failure",
        "bezier-js returned a non-finite pressure projection",
      );
    }
    const projectedT =
      sourceIndex === sourceStart
        ? 0
        : forceEndpoint && sourceIndex === sourceEnd
          ? 1
          : Math.max(previousT, Math.min(1, Math.max(0, projection.t)));
    previousT = projectedT;
    pressureSamples.push(Object.freeze({
      sourceIndex,
      t: canonicalNumber(projectedT),
      pressure: sample.pressure,
    }));
  }
  return Object.freeze(pressureSamples);
}

function buildSegments(
  curves: readonly InternalCurve[],
  samples: readonly StudioVectorInkSample[],
  settings: StudioVectorInkSettings,
  guard: StudioVectorInkBudgetGuard,
): readonly StudioVectorInkCubicSegment[] {
  const output: StudioVectorInkCubicSegment[] = [];
  for (let segmentIndex = 0; segmentIndex < curves.length; segmentIndex += 1) {
    guard.checkpoint();
    const curve = curves[segmentIndex]!;
    const next = curves[segmentIndex + 1];
    const pressureEnd = next
      ? Math.min(curve.sourceEnd, Math.max(curve.sourceStart, next.sourceStart - 1))
      : curve.sourceEnd;
    const bezier = createBezier(curve);
    const arcLength = bezier.length();
    if (!finiteNumber(arcLength) || arcLength < 0) {
      throw new StudioVectorInkStop(
        "provider-failure",
        "bezier-js returned an invalid curve length",
      );
    }
    const pressureSamples = createPressureSamples(
      bezier,
      samples,
      curve.sourceStart,
      pressureEnd,
      pressureEnd === curve.sourceEnd,
      guard,
    );
    const maxSourceDeviation = measureMaxDeviation([curve], samples, guard);
    output.push(Object.freeze({
      kind: "cubic",
      segmentIndex,
      fittingMode: curve.fittingMode,
      controls: curve.controls,
      sourceRange: Object.freeze([curve.sourceStart, curve.sourceEnd] as const),
      pressureSourceRange: Object.freeze([curve.sourceStart, pressureEnd] as const),
      pressureRange: createPressureRange(
        pressureSamples.map(({ pressure }) => pressure),
      ),
      pressureSamples,
      arcLength: canonicalNumber(arcLength),
      bounds: boundsFromBezier(bezier),
      maxSourceDeviation,
      arcSamples: createArcSamples(bezier, arcLength, settings.resampleSpacing, guard),
    }));
  }
  return Object.freeze(output);
}

function fnv1a32(text: string): `fnv1a32:${string}` {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

type ArtifactWithoutHash = Omit<StudioVectorInkGeometryArtifact, "contentHash">;

function finalizeArtifact(content: ArtifactWithoutHash): StudioVectorInkGeometryArtifact {
  const serializedContent = JSON.stringify(content);
  if (serializedContent.length > STUDIO_VECTOR_INK_GEOMETRY_LIMITS.maxSerializedCharacters) {
    throw new StudioVectorInkStop(
      "budget-exceeded",
      "Vector-ink canonical artifact exceeds its serialization budget",
    );
  }
  const contentHash = fnv1a32(serializedContent);
  return Object.freeze({
    kind: content.kind,
    version: content.version,
    contentHash,
    provider: content.provider,
    settings: content.settings,
    source: content.source,
    geometryKind: content.geometryKind,
    tap: content.tap,
    segments: content.segments,
    detectedCornerSourceIndices: content.detectedCornerSourceIndices,
    sourceSampleCount: content.sourceSampleCount,
    workingPointCount: content.workingPointCount,
    simplifiedPointCount: content.simplifiedPointCount,
    totalArcLength: content.totalArcLength,
    bounds: content.bounds,
    pressureRange: content.pressureRange,
    maxSourceDeviation: content.maxSourceDeviation,
  });
}

function createTapArtifact(
  samples: readonly StudioVectorInkSample[],
  working: readonly WorkingPoint[],
  settings: StudioVectorInkSettings,
): StudioVectorInkGeometryArtifact {
  const point = freezePoint(working[0]!.x, working[0]!.y);
  const pressureRange = createPressureRange(samples.map(({ pressure }) => pressure));
  return finalizeArtifact({
    kind: "studio-vector-ink-geometry",
    version: STUDIO_VECTOR_INK_GEOMETRY_VERSION,
    provider: PROVIDER_RECEIPT,
    settings,
    source: Object.freeze({
      encoding: "canonical-point-pressure-v1",
      samples,
    }),
    geometryKind: "tap",
    tap: Object.freeze({ point, pressureRange }),
    segments: Object.freeze([]),
    detectedCornerSourceIndices: Object.freeze([]),
    sourceSampleCount: samples.length,
    workingPointCount: 1,
    simplifiedPointCount: 1,
    totalArcLength: 0,
    bounds: freezeBounds(point.x, point.y, point.x, point.y),
    pressureRange,
    maxSourceDeviation: 0,
  });
}

function createPathArtifact(
  samples: readonly StudioVectorInkSample[],
  working: readonly WorkingPoint[],
  settings: StudioVectorInkSettings,
  limits: ResolvedExecutionLimits,
  guard: StudioVectorInkBudgetGuard,
): StudioVectorInkGeometryArtifact {
  const cornerWorkIndices = detectCornerWorkIndices(working, settings, guard);
  const ranges = createFitRanges(working.length, cornerWorkIndices, limits.maxFitSpanPoints);
  const internalCurves: InternalCurve[] = [];
  let simplifiedPointCount = 0;
  for (const range of ranges) {
    guard.checkpoint();
    const fitted = fitRangeWithQualityGate(working, samples, range, settings, guard);
    internalCurves.push(...fitted.curves);
    simplifiedPointCount += fitted.simplifiedPointCount;
  }
  if (internalCurves.length === 0) {
    throw new StudioVectorInkStop(
      "quality-gate-failed",
      "Vector-ink fitting produced no path geometry",
    );
  }

  const segments = buildSegments(Object.freeze(internalCurves), samples, settings, guard);
  const pressureRange = createPressureRange(samples.map(({ pressure }) => pressure));
  let maxSourceDeviation = 0;
  for (const segment of segments) {
    maxSourceDeviation = Math.max(maxSourceDeviation, segment.maxSourceDeviation);
  }
  return finalizeArtifact({
    kind: "studio-vector-ink-geometry",
    version: STUDIO_VECTOR_INK_GEOMETRY_VERSION,
    provider: PROVIDER_RECEIPT,
    settings,
    source: Object.freeze({
      encoding: "canonical-point-pressure-v1",
      samples,
    }),
    geometryKind: "path",
    tap: null,
    segments,
    detectedCornerSourceIndices: Object.freeze(
      cornerWorkIndices.map((index) => working[index]!.sourceStart),
    ),
    sourceSampleCount: samples.length,
    workingPointCount: working.length,
    simplifiedPointCount,
    totalArcLength: canonicalNumber(
      segments.reduce((total, segment) => total + segment.arcLength, 0),
    ),
    bounds: unionBounds(segments.map(({ bounds }) => bounds)),
    pressureRange,
    maxSourceDeviation: canonicalNumber(maxSourceDeviation),
  });
}

export function createStudioVectorInkGeometry(
  request: StudioVectorInkGeometryRequest,
  control: StudioVectorInkExecutionControl = {},
): StudioVectorInkGeometryResult {
  try {
    if (request === null || typeof request !== "object") {
      throw new StudioVectorInkStop("invalid-input", "Vector-ink request must be an object");
    }
    const limits = resolveExecutionLimits(control.limits);
    const guard = new StudioVectorInkBudgetGuard(limits, control.signal);
    guard.checkpoint();
    const settings = resolveSettings(request.settings);
    const samples = validateSamples(request.samples, limits, guard);
    const working = createWorkingPoints(samples, guard);
    const artifact =
      working.length === 1
        ? createTapArtifact(samples, working, settings)
        : createPathArtifact(samples, working, settings, limits, guard);
    return Object.freeze({ ok: true, artifact });
  } catch (error) {
    if (error instanceof StudioVectorInkStop) {
      return Object.freeze({
        ok: false,
        reason: error.reason,
        detail: error.detail,
      });
    }
    return Object.freeze({
      ok: false,
      reason: "provider-failure",
      detail: "A vector-ink geometry provider failed closed",
    });
  }
}

export function serializeStudioVectorInkGeometryArtifact(
  artifact: StudioVectorInkGeometryArtifact,
): string {
  return JSON.stringify(artifact);
}

function replayCandidateFromUnknown(value: unknown): {
  readonly request: StudioVectorInkGeometryRequest;
  readonly expectedHash: string;
} {
  if (value === null || typeof value !== "object") {
    throw new StudioVectorInkStop("replay-mismatch", "Serialized vector ink must be an object");
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.kind !== "studio-vector-ink-geometry" ||
    candidate.version !== STUDIO_VECTOR_INK_GEOMETRY_VERSION ||
    typeof candidate.contentHash !== "string"
  ) {
    throw new StudioVectorInkStop(
      "replay-mismatch",
      "Serialized vector ink has an unsupported identity",
    );
  }
  const source = candidate.source;
  const settings = candidate.settings;
  if (
    source === null ||
    typeof source !== "object" ||
    !Array.isArray((source as Record<string, unknown>).samples) ||
    settings === null ||
    typeof settings !== "object"
  ) {
    throw new StudioVectorInkStop(
      "replay-mismatch",
      "Serialized vector ink is missing its canonical replay source",
    );
  }
  const settingsRecord = settings as Record<string, unknown>;
  return Object.freeze({
    request: Object.freeze({
      samples: (source as { readonly samples: readonly StudioVectorInkSampleCandidate[] }).samples,
      settings: Object.freeze({
        maxCurveError: settingsRecord.maxCurveError as number,
        cornerAngleRadians: settingsRecord.cornerAngleRadians as number,
        resampleSpacing: settingsRecord.resampleSpacing as number,
      }),
    }),
    expectedHash: candidate.contentHash,
  });
}

/**
 * Replays only from canonical point+pressure samples and settings, then requires a byte-identical
 * canonical artifact. Persisted cubics are evidence, never trusted execution input.
 */
export function replayStudioVectorInkGeometryArtifact(
  serialized: string,
  control: StudioVectorInkExecutionControl = {},
): StudioVectorInkGeometryResult {
  try {
    if (
      typeof serialized !== "string" ||
      serialized.length === 0 ||
      serialized.length > STUDIO_VECTOR_INK_GEOMETRY_LIMITS.maxSerializedCharacters
    ) {
      throw new StudioVectorInkStop(
        "replay-mismatch",
        "Serialized vector ink exceeds its admission boundary",
      );
    }
    const parsed: unknown = JSON.parse(serialized);
    const replay = replayCandidateFromUnknown(parsed);
    const rebuilt = createStudioVectorInkGeometry(replay.request, control);
    if (!rebuilt.ok) return rebuilt;
    if (
      rebuilt.artifact.contentHash !== replay.expectedHash ||
      serializeStudioVectorInkGeometryArtifact(rebuilt.artifact) !== serialized
    ) {
      throw new StudioVectorInkStop(
        "replay-mismatch",
        "Serialized vector ink does not match deterministic canonical replay",
      );
    }
    return rebuilt;
  } catch (error) {
    if (error instanceof StudioVectorInkStop) {
      return Object.freeze({
        ok: false,
        reason: error.reason,
        detail: error.detail,
      });
    }
    return Object.freeze({
      ok: false,
      reason: "replay-mismatch",
      detail: "Serialized vector ink could not be replayed",
    });
  }
}
