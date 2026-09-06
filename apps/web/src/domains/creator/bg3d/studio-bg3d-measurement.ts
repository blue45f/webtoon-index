/**
 * Renderer-independent SketchUp-style Tape Measure and inference-guide core.
 *
 * Viewport adapters own ray casting and line/label rendering. This module only accepts bounded
 * world points, performs deterministic vector math, and persists a small canonical guide document.
 * No Three.js/WebGPU/WebGL class, DOM value, runtime handle, URL, or asset identifier crosses this
 * boundary.
 */

import {
  STUDIO_BG3D_TRANSFORM_SNAP_MAX_WORLD_COORDINATE,
  type StudioBg3dTransformSnapVec3,
} from "./studio-bg3d-transform-snap-planner";

export type StudioBg3dMeasurementVec3 = StudioBg3dTransformSnapVec3;
export type StudioBg3dMeasurementUnit = "mm" | "cm" | "m";
export type StudioBg3dMeasurementAxis = "x" | "y" | "z";

export const STUDIO_BG3D_MEASUREMENT_DOCUMENT_KIND =
  "toonspectrum.bg3d-measurements" as const;
export const STUDIO_BG3D_MEASUREMENT_DOCUMENT_VERSION = 1 as const;
export const STUDIO_BG3D_MEASUREMENT_MAX_WORLD_COORDINATE =
  STUDIO_BG3D_TRANSFORM_SNAP_MAX_WORLD_COORDINATE;
export const STUDIO_BG3D_MEASUREMENT_MAX_GUIDES = 256;
export const STUDIO_BG3D_MEASUREMENT_MAX_REFERENCES = 128;
export const STUDIO_BG3D_MEASUREMENT_MAX_BYTES = 64 * 1024;
export const STUDIO_BG3D_MEASUREMENT_DEFAULT_TOLERANCE_DEGREES = 3;
export const STUDIO_BG3D_MEASUREMENT_MAX_TOLERANCE_DEGREES = 15;
export const STUDIO_BG3D_MEASUREMENT_GUIDE_ID_MAX_LENGTH = 80;

const MIN_DIRECTION_LENGTH = 1e-9;
const MIN_LOCKED_LENGTH_METERS = 1e-6;
const MAX_LOCKED_LENGTH_METERS =
  STUDIO_BG3D_MEASUREMENT_MAX_WORLD_COORDINATE * Math.sqrt(12);
const GUIDE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:~-]{0,79}$/u;
const FORBIDDEN_ID_SET = new Set(["__proto__", "constructor", "prototype"]);
const ALLOCATED_GUIDE_ID_PATTERN = /^measure-guide-(\d{4,10})$/u;
const MAX_ALLOCATED_GUIDE_SEQUENCE = 9_999_999_999;
const UTF8_ENCODER = new TextEncoder();
const UNIT_SCALE: Readonly<Record<StudioBg3dMeasurementUnit, number>> = Object.freeze({
  mm: 1_000,
  cm: 100,
  m: 1,
});
const DEFAULT_UNIT_PRECISION: Readonly<Record<StudioBg3dMeasurementUnit, number>> =
  Object.freeze({
    mm: 1,
    cm: 2,
    m: 3,
  });

export type StudioBg3dMeasurementFailureReason =
  | "degenerate-direction"
  | "duplicate-guide-id"
  | "duplicate-reference-id"
  | "guide-budget-exceeded"
  | "guide-not-found"
  | "id-space-exhausted"
  | "invalid-document"
  | "invalid-guide"
  | "invalid-guide-id"
  | "invalid-length"
  | "invalid-point"
  | "invalid-reference"
  | "invalid-tolerance"
  | "reference-budget-exceeded"
  | "result-out-of-bounds"
  | "serialized-budget-exceeded";

export interface StudioBg3dMeasurementFailure {
  readonly ok: false;
  readonly reason: StudioBg3dMeasurementFailureReason;
  readonly message: string;
}

export interface StudioBg3dWorldMeasurement {
  readonly startWorld: StudioBg3dMeasurementVec3;
  readonly endWorld: StudioBg3dMeasurementVec3;
  readonly deltaWorld: StudioBg3dMeasurementVec3;
  readonly absoluteDeltaWorld: StudioBg3dMeasurementVec3;
  readonly midpointWorld: StudioBg3dMeasurementVec3;
  readonly distanceMeters: number;
  readonly directionWorld: StudioBg3dMeasurementVec3 | null;
}

export interface StudioBg3dWorldMeasurementSuccess {
  readonly ok: true;
  readonly measurement: StudioBg3dWorldMeasurement;
}

export type StudioBg3dWorldMeasurementResult =
  | StudioBg3dWorldMeasurementSuccess
  | StudioBg3dMeasurementFailure;

export interface StudioBg3dMeasurementInferenceReference {
  readonly id: string;
  readonly directionWorld: StudioBg3dMeasurementVec3;
}

export type StudioBg3dMeasurementInferenceMatch =
  | {
      readonly kind: "axis";
      readonly axis: StudioBg3dMeasurementAxis;
      readonly sign: -1 | 1;
      readonly angularErrorDegrees: number;
    }
  | {
      readonly kind: "parallel";
      readonly referenceId: string;
      readonly sign: -1 | 1;
      readonly angularErrorDegrees: number;
    }
  | {
      readonly kind: "perpendicular";
      readonly referenceId: string;
      readonly angularErrorDegrees: number;
    };

export type StudioBg3dMeasurementPrimaryInference =
  | StudioBg3dMeasurementInferenceMatch
  | {
      readonly kind: "free";
      readonly angularErrorDegrees: null;
    };

export interface StudioBg3dMeasurementInferenceSuccess {
  readonly ok: true;
  readonly directionWorld: StudioBg3dMeasurementVec3;
  readonly toleranceDegrees: number;
  readonly primary: StudioBg3dMeasurementPrimaryInference;
  readonly matches: readonly StudioBg3dMeasurementInferenceMatch[];
  readonly evaluatedReferences: number;
}

export type StudioBg3dMeasurementInferenceResult =
  | StudioBg3dMeasurementInferenceSuccess
  | StudioBg3dMeasurementFailure;

export interface StudioBg3dMeasurementGuide {
  readonly id: string;
  readonly kind: "distance";
  readonly startWorld: StudioBg3dMeasurementVec3;
  readonly endWorld: StudioBg3dMeasurementVec3;
  /**
   * Null means the guide records a free measurement. A number means its segment was created from
   * an exact numeric length lock and must still agree with the measured endpoint distance.
   */
  readonly lockedLengthMeters: number | null;
  readonly visible: boolean;
}

export interface StudioBg3dMeasurementDocument {
  readonly kind: typeof STUDIO_BG3D_MEASUREMENT_DOCUMENT_KIND;
  readonly version: typeof STUDIO_BG3D_MEASUREMENT_DOCUMENT_VERSION;
  readonly unit: StudioBg3dMeasurementUnit;
  readonly guides: readonly StudioBg3dMeasurementGuide[];
}

export interface StudioBg3dResolvedMeasurementGuide {
  readonly guide: StudioBg3dMeasurementGuide;
  readonly measurement: StudioBg3dWorldMeasurement;
  /** Deterministic label derived from distance + document unit; never trusted from persistence. */
  readonly label: string;
}

export interface StudioBg3dMeasurementGuideSuccess {
  readonly ok: true;
  readonly guide: StudioBg3dMeasurementGuide;
}

export interface StudioBg3dResolvedMeasurementGuideSuccess {
  readonly ok: true;
  readonly resolved: StudioBg3dResolvedMeasurementGuide;
}

export interface StudioBg3dMeasurementDocumentMutationSuccess {
  readonly ok: true;
  readonly document: StudioBg3dMeasurementDocument;
  readonly guide?: StudioBg3dMeasurementGuide;
}

export type StudioBg3dMeasurementGuideResult =
  | StudioBg3dMeasurementGuideSuccess
  | StudioBg3dMeasurementFailure;

export type StudioBg3dResolvedMeasurementGuideResult =
  | StudioBg3dResolvedMeasurementGuideSuccess
  | StudioBg3dMeasurementFailure;

export type StudioBg3dMeasurementDocumentMutationResult =
  | StudioBg3dMeasurementDocumentMutationSuccess
  | StudioBg3dMeasurementFailure;

export interface StudioBg3dLengthLockSuccess {
  readonly ok: true;
  readonly lockedLengthMeters: number;
  readonly endWorld: StudioBg3dMeasurementVec3;
  readonly measurement: StudioBg3dWorldMeasurement;
}

export type StudioBg3dLengthLockResult =
  | StudioBg3dLengthLockSuccess
  | StudioBg3dMeasurementFailure;

type MutableVec3 = [number, number, number];

function failure(
  reason: StudioBg3dMeasurementFailureReason,
  message: string,
): StudioBg3dMeasurementFailure {
  return Object.freeze({ ok: false, reason, message });
}

function canonicalNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function canonicalAngle(value: number): number {
  return canonicalNumber(Math.round(value * 1e12) / 1e12);
}

function readVec3(
  value: unknown,
  maximumAbsoluteComponent = STUDIO_BG3D_MEASUREMENT_MAX_WORLD_COORDINATE,
): StudioBg3dMeasurementVec3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const result: MutableVec3 = [0, 0, 0];
  for (let index = 0; index < 3; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) return null;
    const component = descriptor.value;
    if (
      typeof component !== "number"
      || !Number.isFinite(component)
      || Math.abs(component) > maximumAbsoluteComponent
    ) return null;
    result[index as 0 | 1 | 2] = canonicalNumber(component);
  }
  return Object.freeze(result);
}

function tuple(value: MutableVec3): StudioBg3dMeasurementVec3 {
  return Object.freeze([
    canonicalNumber(value[0]),
    canonicalNumber(value[1]),
    canonicalNumber(value[2]),
  ] as const);
}

function subtract(
  left: StudioBg3dMeasurementVec3,
  right: StudioBg3dMeasurementVec3,
): MutableVec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function add(
  left: StudioBg3dMeasurementVec3,
  right: StudioBg3dMeasurementVec3,
): MutableVec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function multiply(value: StudioBg3dMeasurementVec3, scalar: number): MutableVec3 {
  return [value[0] * scalar, value[1] * scalar, value[2] * scalar];
}

function dot(
  left: StudioBg3dMeasurementVec3,
  right: StudioBg3dMeasurementVec3,
): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function vectorLength(value: StudioBg3dMeasurementVec3): number {
  return Math.hypot(value[0], value[1], value[2]);
}

function normalizeDirection(value: unknown): StudioBg3dMeasurementVec3 | null {
  const vector = readVec3(value, STUDIO_BG3D_MEASUREMENT_MAX_WORLD_COORDINATE * 2);
  if (!vector) return null;
  const length = vectorLength(vector);
  if (!Number.isFinite(length) || length < MIN_DIRECTION_LENGTH) return null;
  return tuple([vector[0] / length, vector[1] / length, vector[2] / length]);
}

function validGuideId(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= STUDIO_BG3D_MEASUREMENT_GUIDE_ID_MAX_LENGTH
    && GUIDE_ID_PATTERN.test(value)
    && !FORBIDDEN_ID_SET.has(value.toLowerCase());
}

function isUnit(value: unknown): value is StudioBg3dMeasurementUnit {
  return value === "mm" || value === "cm" || value === "m";
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return !!descriptor && "value" in descriptor && descriptor.enumerable;
  });
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length
    && actual.every((key, index) => key === sorted[index]);
}

function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
}

/** Computes exact world delta, midpoint, Euclidean distance, and a unit direction when non-zero. */
export function measureStudioBg3dWorldPoints(
  startWorld: unknown,
  endWorld: unknown,
): StudioBg3dWorldMeasurementResult {
  const start = readVec3(startWorld);
  const end = readVec3(endWorld);
  if (!start || !end) {
    return failure(
      "invalid-point",
      `측정점은 각 축이 ±${STUDIO_BG3D_MEASUREMENT_MAX_WORLD_COORDINATE.toLocaleString("ko-KR")}m 안인 유한한 XYZ 좌표여야 합니다.`,
    );
  }
  const delta = tuple(subtract(end, start));
  const distanceMeters = vectorLength(delta);
  if (!Number.isFinite(distanceMeters)) {
    return failure("result-out-of-bounds", "측정 거리가 안전한 계산 범위를 벗어났습니다.");
  }
  const midpoint = tuple(multiply(tuple(add(start, end)), 0.5));
  const directionWorld = distanceMeters < MIN_DIRECTION_LENGTH
    ? null
    : tuple([
        delta[0] / distanceMeters,
        delta[1] / distanceMeters,
        delta[2] / distanceMeters,
      ]);
  return Object.freeze({
    ok: true,
    measurement: deepFreeze({
      startWorld: start,
      endWorld: end,
      deltaWorld: delta,
      absoluteDeltaWorld: tuple([
        Math.abs(delta[0]),
        Math.abs(delta[1]),
        Math.abs(delta[2]),
      ]),
      midpointWorld: midpoint,
      distanceMeters: canonicalNumber(distanceMeters),
      directionWorld,
    }),
  });
}

function readTolerance(value: unknown): number | null {
  if (value === undefined) return STUDIO_BG3D_MEASUREMENT_DEFAULT_TOLERANCE_DEGREES;
  return typeof value === "number"
    && Number.isFinite(value)
    && value > 0
    && value <= STUDIO_BG3D_MEASUREMENT_MAX_TOLERANCE_DEGREES
    ? value
    : null;
}

function clampedAcosDegrees(value: number): number {
  return (Math.acos(Math.min(1, Math.max(-1, value))) * 180) / Math.PI;
}

const AXES: readonly {
  readonly axis: StudioBg3dMeasurementAxis;
  readonly direction: StudioBg3dMeasurementVec3;
}[] = Object.freeze([
  Object.freeze({ axis: "x" as const, direction: Object.freeze([1, 0, 0] as const) }),
  Object.freeze({ axis: "y" as const, direction: Object.freeze([0, 1, 0] as const) }),
  Object.freeze({ axis: "z" as const, direction: Object.freeze([0, 0, 1] as const) }),
]);

const INFERENCE_KIND_PRIORITY: Readonly<
  Record<StudioBg3dMeasurementInferenceMatch["kind"], number>
> = Object.freeze({
  axis: 0,
  parallel: 1,
  perpendicular: 2,
});

function inferenceTieKey(match: StudioBg3dMeasurementInferenceMatch): string {
  if (match.kind === "axis") return match.axis;
  return match.referenceId;
}

function compareDeterministicText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Classifies one measurement direction against world axes and bounded reference directions.
 *
 * Every match inside the angular tolerance is returned. `primary` is deterministic: smallest
 * angular error, then axis → parallel → perpendicular, then axis/reference ID.
 */
export function classifyStudioBg3dMeasurementInference(input: {
  readonly startWorld: unknown;
  readonly endWorld: unknown;
  readonly references?: readonly StudioBg3dMeasurementInferenceReference[];
  readonly toleranceDegrees?: number;
}): StudioBg3dMeasurementInferenceResult {
  const measured = measureStudioBg3dWorldPoints(input.startWorld, input.endWorld);
  if (!measured.ok) return measured;
  const direction = measured.measurement.directionWorld;
  if (!direction) {
    return failure("degenerate-direction", "같은 점 두 개로는 축·평행·수직 방향을 추론할 수 없습니다.");
  }
  const toleranceDegrees = readTolerance(input.toleranceDegrees);
  if (toleranceDegrees === null) {
    return failure(
      "invalid-tolerance",
      `추론 허용 각도는 0° 초과 ${STUDIO_BG3D_MEASUREMENT_MAX_TOLERANCE_DEGREES}° 이하여야 합니다.`,
    );
  }
  const references = input.references ?? [];
  if (!Array.isArray(references) || references.length > STUDIO_BG3D_MEASUREMENT_MAX_REFERENCES) {
    return failure(
      "reference-budget-exceeded",
      `추론 기준 방향은 최대 ${STUDIO_BG3D_MEASUREMENT_MAX_REFERENCES}개까지 사용할 수 있습니다.`,
    );
  }

  const matches: StudioBg3dMeasurementInferenceMatch[] = [];
  for (const entry of AXES) {
    const alignment = dot(direction, entry.direction);
    const error = clampedAcosDegrees(Math.abs(alignment));
    if (error <= toleranceDegrees) {
      matches.push(Object.freeze({
        kind: "axis",
        axis: entry.axis,
        sign: alignment < 0 ? -1 : 1,
        angularErrorDegrees: canonicalAngle(error),
      }));
    }
  }

  const referenceIds = new Set<string>();
  for (const reference of references) {
    if (!isPlainRecord(reference) || !validGuideId(reference.id)) {
      return failure("invalid-reference", "추론 기준 방향의 ID 또는 벡터가 올바르지 않습니다.");
    }
    if (referenceIds.has(reference.id)) {
      return failure(
        "duplicate-reference-id",
        `추론 기준 ID '${reference.id}'가 중복되었습니다.`,
      );
    }
    referenceIds.add(reference.id);
    const referenceDirection = normalizeDirection(reference.directionWorld);
    if (!referenceDirection) {
      return failure(
        "invalid-reference",
        `추론 기준 '${reference.id}'의 방향 벡터가 비어 있거나 유효 범위를 벗어났습니다.`,
      );
    }
    const alignment = dot(direction, referenceDirection);
    const parallelError = clampedAcosDegrees(Math.abs(alignment));
    if (parallelError <= toleranceDegrees) {
      matches.push(Object.freeze({
        kind: "parallel",
        referenceId: reference.id,
        sign: alignment < 0 ? -1 : 1,
        angularErrorDegrees: canonicalAngle(parallelError),
      }));
    }
    const perpendicularError = (Math.asin(Math.min(1, Math.abs(alignment))) * 180) / Math.PI;
    if (perpendicularError <= toleranceDegrees) {
      matches.push(Object.freeze({
        kind: "perpendicular",
        referenceId: reference.id,
        angularErrorDegrees: canonicalAngle(perpendicularError),
      }));
    }
  }

  matches.sort((left, right) =>
    left.angularErrorDegrees - right.angularErrorDegrees
    || INFERENCE_KIND_PRIORITY[left.kind] - INFERENCE_KIND_PRIORITY[right.kind]
    || compareDeterministicText(inferenceTieKey(left), inferenceTieKey(right))
  );
  const frozenMatches = Object.freeze(matches);
  return Object.freeze({
    ok: true,
    directionWorld: direction,
    toleranceDegrees,
    primary: frozenMatches[0] ?? Object.freeze({
      kind: "free" as const,
      angularErrorDegrees: null,
    }),
    matches: frozenMatches,
    evaluatedReferences: references.length,
  });
}

/**
 * Projects the proposed segment direction to an exact numeric length. A fallback direction lets a
 * numeric field establish length before the pointer has moved; a zero vector still fails closed.
 */
export function lockStudioBg3dMeasurementLength(input: {
  readonly startWorld: unknown;
  readonly proposedEndWorld: unknown;
  readonly lockedLengthMeters: number;
  readonly fallbackDirectionWorld?: unknown;
}): StudioBg3dLengthLockResult {
  const measured = measureStudioBg3dWorldPoints(input.startWorld, input.proposedEndWorld);
  if (!measured.ok) return measured;
  if (
    !Number.isFinite(input.lockedLengthMeters)
    || input.lockedLengthMeters < MIN_LOCKED_LENGTH_METERS
    || input.lockedLengthMeters > MAX_LOCKED_LENGTH_METERS
  ) {
    return failure(
      "invalid-length",
      `잠금 길이는 ${MIN_LOCKED_LENGTH_METERS}m 이상 ${Math.round(MAX_LOCKED_LENGTH_METERS).toLocaleString("ko-KR")}m 이하여야 합니다.`,
    );
  }
  const direction = measured.measurement.directionWorld
    ?? normalizeDirection(input.fallbackDirectionWorld);
  if (!direction) {
    return failure(
      "degenerate-direction",
      "길이를 잠그려면 포인터를 움직이거나 유효한 기준 방향을 제공해 주세요.",
    );
  }
  const end = tuple(add(
    measured.measurement.startWorld,
    tuple(multiply(direction, input.lockedLengthMeters)),
  ));
  if (end.some((component) =>
    Math.abs(component) > STUDIO_BG3D_MEASUREMENT_MAX_WORLD_COORDINATE
  )) {
    return failure(
      "result-out-of-bounds",
      "길이 잠금 결과가 3D 장면의 안전한 world 좌표 범위를 벗어났습니다.",
    );
  }
  const lockedMeasurement = measureStudioBg3dWorldPoints(
    measured.measurement.startWorld,
    end,
  );
  if (!lockedMeasurement.ok) return lockedMeasurement;
  return deepFreeze({
    ok: true,
    lockedLengthMeters: input.lockedLengthMeters,
    endWorld: end,
    measurement: lockedMeasurement.measurement,
  });
}

export function studioBg3dMeasurementValueInUnit(
  meters: number,
  unit: StudioBg3dMeasurementUnit,
): number | null {
  if (!Number.isFinite(meters) || !isUnit(unit)) return null;
  return canonicalNumber(meters * UNIT_SCALE[unit]);
}

export function studioBg3dMeasurementValueToMeters(
  value: number,
  unit: StudioBg3dMeasurementUnit,
): number | null {
  if (!Number.isFinite(value) || !isUnit(unit)) return null;
  return canonicalNumber(value / UNIT_SCALE[unit]);
}

function formatDecimal(value: number, precision: number): string {
  const scale = 10 ** precision;
  const rounded = canonicalNumber(Math.round((value + Number.EPSILON) * scale) / scale);
  if (precision === 0) return String(rounded);
  return rounded.toFixed(precision).replace(/(?:\.0+|(\.\d+?)0+)$/u, "$1");
}

/** Locale-independent numeric formatting keeps serialized labels and snapshots deterministic. */
export function formatStudioBg3dMeasurementLength(
  distanceMeters: number,
  unit: StudioBg3dMeasurementUnit,
  precision = DEFAULT_UNIT_PRECISION[unit],
): string | null {
  if (
    !Number.isFinite(distanceMeters)
    || distanceMeters < 0
    || !isUnit(unit)
    || !Number.isSafeInteger(precision)
    || precision < 0
    || precision > 6
  ) return null;
  const value = studioBg3dMeasurementValueInUnit(distanceMeters, unit);
  if (value === null) return null;
  return `${formatDecimal(value, precision)} ${unit}`;
}

export function chooseStudioBg3dMeasurementUnit(
  distanceMeters: number,
): StudioBg3dMeasurementUnit | null {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return null;
  if (distanceMeters < 0.01) return "mm";
  if (distanceMeters < 1) return "cm";
  return "m";
}

export function createStudioBg3dMeasurementGuide(input: {
  readonly id: string;
  readonly startWorld: unknown;
  readonly endWorld: unknown;
  readonly lockedLengthMeters?: number | null;
  readonly visible?: boolean;
}): StudioBg3dMeasurementGuideResult {
  if (!validGuideId(input.id)) {
    return failure(
      "invalid-guide-id",
      "측정 가이드 ID는 영문·숫자로 시작하는 80자 이하의 안정 ID여야 합니다.",
    );
  }
  const measured = measureStudioBg3dWorldPoints(input.startWorld, input.endWorld);
  if (!measured.ok) return measured;
  if (!measured.measurement.directionWorld) {
    return failure("invalid-guide", "길이가 0인 측정 가이드는 만들 수 없습니다.");
  }
  const lockedLengthMeters = input.lockedLengthMeters ?? null;
  if (lockedLengthMeters !== null) {
    if (
      !Number.isFinite(lockedLengthMeters)
      || lockedLengthMeters < MIN_LOCKED_LENGTH_METERS
      || lockedLengthMeters > MAX_LOCKED_LENGTH_METERS
    ) {
      return failure("invalid-length", "측정 가이드의 잠금 길이가 유효 범위를 벗어났습니다.");
    }
    const tolerance = Math.max(1e-9, measured.measurement.distanceMeters * 1e-9);
    if (Math.abs(lockedLengthMeters - measured.measurement.distanceMeters) > tolerance) {
      return failure(
        "invalid-length",
        "잠금 길이와 가이드의 실제 두 점 거리가 일치하지 않습니다.",
      );
    }
  }
  if (input.visible !== undefined && typeof input.visible !== "boolean") {
    return failure("invalid-guide", "측정 가이드 표시 상태가 올바르지 않습니다.");
  }
  return Object.freeze({
    ok: true,
    guide: deepFreeze({
      id: input.id,
      kind: "distance" as const,
      startWorld: measured.measurement.startWorld,
      endWorld: measured.measurement.endWorld,
      lockedLengthMeters,
      visible: input.visible ?? true,
    }),
  });
}

export function resolveStudioBg3dMeasurementGuide(
  guide: unknown,
  unit: StudioBg3dMeasurementUnit,
): StudioBg3dResolvedMeasurementGuideResult {
  const canonical = canonicalGuide(guide);
  if (!canonical || !isUnit(unit)) {
    return failure("invalid-guide", "측정 가이드 또는 표시 단위가 올바르지 않습니다.");
  }
  const measured = measureStudioBg3dWorldPoints(canonical.startWorld, canonical.endWorld);
  if (!measured.ok) return measured;
  const label = formatStudioBg3dMeasurementLength(measured.measurement.distanceMeters, unit);
  if (!label) return failure("invalid-guide", "측정 거리 라벨을 만들 수 없습니다.");
  return deepFreeze({
    ok: true,
    resolved: {
      guide: canonical,
      measurement: measured.measurement,
      label,
    },
  });
}

export function allocateStudioBg3dMeasurementGuideId(
  guides: readonly Pick<StudioBg3dMeasurementGuide, "id">[],
): string | null {
  if (!Array.isArray(guides) || guides.length > STUDIO_BG3D_MEASUREMENT_MAX_GUIDES) return null;
  const existing = new Set<string>();
  let maximumSequence = 0;
  for (const guide of guides) {
    if (!isPlainRecord(guide) || !validGuideId(guide.id) || existing.has(guide.id)) return null;
    existing.add(guide.id);
    const match = ALLOCATED_GUIDE_ID_PATTERN.exec(guide.id);
    if (!match) continue;
    const sequence = Number(match[1]);
    if (Number.isSafeInteger(sequence)) maximumSequence = Math.max(maximumSequence, sequence);
  }
  for (
    let sequence = maximumSequence + 1;
    sequence <= MAX_ALLOCATED_GUIDE_SEQUENCE;
    sequence += 1
  ) {
    const id = `measure-guide-${String(sequence).padStart(4, "0")}`;
    if (!existing.has(id)) return id;
  }
  return null;
}

export function createStudioBg3dMeasurementDocument(
  unit: StudioBg3dMeasurementUnit = "m",
): StudioBg3dMeasurementDocument {
  const safeUnit = isUnit(unit) ? unit : "m";
  return deepFreeze({
    kind: STUDIO_BG3D_MEASUREMENT_DOCUMENT_KIND,
    version: STUDIO_BG3D_MEASUREMENT_DOCUMENT_VERSION,
    unit: safeUnit,
    guides: [],
  });
}

export const DEFAULT_STUDIO_BG3D_MEASUREMENT_DOCUMENT =
  createStudioBg3dMeasurementDocument();

function canonicalGuide(value: unknown): StudioBg3dMeasurementGuide | null {
  if (
    !isPlainRecord(value)
    || !hasExactKeys(value, [
      "endWorld",
      "id",
      "kind",
      "lockedLengthMeters",
      "startWorld",
      "visible",
    ])
    || value.kind !== "distance"
    || typeof value.visible !== "boolean"
  ) return null;
  const created = createStudioBg3dMeasurementGuide({
    id: typeof value.id === "string" ? value.id : "",
    startWorld: value.startWorld,
    endWorld: value.endWorld,
    lockedLengthMeters:
      value.lockedLengthMeters === null || typeof value.lockedLengthMeters === "number"
        ? value.lockedLengthMeters
        : Number.NaN,
    visible: value.visible,
  });
  return created.ok ? created.guide : null;
}

function canonicalDocument(value: unknown): StudioBg3dMeasurementDocument | null {
  if (
    !isPlainRecord(value)
    || !hasExactKeys(value, ["guides", "kind", "unit", "version"])
    || value.kind !== STUDIO_BG3D_MEASUREMENT_DOCUMENT_KIND
    || value.version !== STUDIO_BG3D_MEASUREMENT_DOCUMENT_VERSION
    || !isUnit(value.unit)
    || !Array.isArray(value.guides)
    || value.guides.length > STUDIO_BG3D_MEASUREMENT_MAX_GUIDES
  ) return null;
  const guides: StudioBg3dMeasurementGuide[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < value.guides.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value.guides, String(index));
    if (!descriptor || !("value" in descriptor)) return null;
    const guide = canonicalGuide(descriptor.value);
    if (!guide || ids.has(guide.id)) return null;
    ids.add(guide.id);
    guides.push(guide);
  }
  return deepFreeze({
    kind: STUDIO_BG3D_MEASUREMENT_DOCUMENT_KIND,
    version: STUDIO_BG3D_MEASUREMENT_DOCUMENT_VERSION,
    unit: value.unit,
    guides,
  });
}

function withinSerializedBudget(document: StudioBg3dMeasurementDocument): boolean {
  return utf8ByteLength(JSON.stringify(document)) <= STUDIO_BG3D_MEASUREMENT_MAX_BYTES;
}

export function addStudioBg3dMeasurementGuide(
  document: unknown,
  input: {
    readonly startWorld: unknown;
    readonly endWorld: unknown;
    readonly lockedLengthMeters?: number | null;
    readonly visible?: boolean;
  },
): StudioBg3dMeasurementDocumentMutationResult {
  const canonical = canonicalDocument(document);
  if (!canonical) return failure("invalid-document", "측정 가이드 문서가 올바르지 않습니다.");
  if (canonical.guides.length >= STUDIO_BG3D_MEASUREMENT_MAX_GUIDES) {
    return failure(
      "guide-budget-exceeded",
      `영구 측정 가이드는 장면당 최대 ${STUDIO_BG3D_MEASUREMENT_MAX_GUIDES}개까지 저장할 수 있습니다.`,
    );
  }
  const id = allocateStudioBg3dMeasurementGuideId(canonical.guides);
  if (!id) return failure("id-space-exhausted", "새 측정 가이드의 안정 ID를 만들 수 없습니다.");
  const created = createStudioBg3dMeasurementGuide({ id, ...input });
  if (!created.ok) return created;
  const next = deepFreeze({
    ...canonical,
    guides: [...canonical.guides, created.guide],
  });
  if (!withinSerializedBudget(next)) {
    return failure(
      "serialized-budget-exceeded",
      `측정 가이드 문서가 저장 한도 ${STUDIO_BG3D_MEASUREMENT_MAX_BYTES / 1024}KiB를 넘습니다.`,
    );
  }
  return Object.freeze({ ok: true, document: next, guide: created.guide });
}

export function deleteStudioBg3dMeasurementGuide(
  document: unknown,
  guideId: string,
): StudioBg3dMeasurementDocumentMutationResult {
  const canonical = canonicalDocument(document);
  if (!canonical) return failure("invalid-document", "측정 가이드 문서가 올바르지 않습니다.");
  if (!validGuideId(guideId)) {
    return failure("invalid-guide-id", "삭제할 측정 가이드 ID가 올바르지 않습니다.");
  }
  const index = canonical.guides.findIndex((guide) => guide.id === guideId);
  if (index < 0) {
    return failure("guide-not-found", `측정 가이드 '${guideId}'를 찾지 못했습니다.`);
  }
  return Object.freeze({
    ok: true,
    document: deepFreeze({
      ...canonical,
      guides: canonical.guides.filter((guide) => guide.id !== guideId),
    }),
  });
}

export function setStudioBg3dMeasurementGuideVisibility(
  document: unknown,
  guideId: string,
  visible: boolean,
): StudioBg3dMeasurementDocumentMutationResult {
  const canonical = canonicalDocument(document);
  if (!canonical) return failure("invalid-document", "측정 가이드 문서가 올바르지 않습니다.");
  if (!validGuideId(guideId) || typeof visible !== "boolean") {
    return failure("invalid-guide", "측정 가이드 ID 또는 표시 상태가 올바르지 않습니다.");
  }
  const index = canonical.guides.findIndex((guide) => guide.id === guideId);
  if (index < 0) {
    return failure("guide-not-found", `측정 가이드 '${guideId}'를 찾지 못했습니다.`);
  }
  if (canonical.guides[index].visible === visible) {
    return Object.freeze({ ok: true, document: canonical });
  }
  return Object.freeze({
    ok: true,
    document: deepFreeze({
      ...canonical,
      guides: canonical.guides.map((guide, guideIndex) =>
        guideIndex === index ? { ...guide, visible } : guide
      ),
    }),
  });
}

export function setStudioBg3dMeasurementUnit(
  document: unknown,
  unit: StudioBg3dMeasurementUnit,
): StudioBg3dMeasurementDocumentMutationResult {
  const canonical = canonicalDocument(document);
  if (!canonical) return failure("invalid-document", "측정 가이드 문서가 올바르지 않습니다.");
  if (!isUnit(unit)) return failure("invalid-document", "측정 표시 단위가 올바르지 않습니다.");
  if (canonical.unit === unit) return Object.freeze({ ok: true, document: canonical });
  return Object.freeze({
    ok: true,
    document: deepFreeze({ ...canonical, unit }),
  });
}

/** Strict canonical persistence: unsupported fields, duplicate IDs, and lossy repair are rejected. */
export function parseStudioBg3dMeasurementDocument(
  raw: string,
): StudioBg3dMeasurementDocument | null {
  if (typeof raw !== "string" || utf8ByteLength(raw) > STUDIO_BG3D_MEASUREMENT_MAX_BYTES) {
    return null;
  }
  try {
    const document = canonicalDocument(JSON.parse(raw) as unknown);
    return document && withinSerializedBudget(document) ? document : null;
  } catch {
    return null;
  }
}

export function serializeStudioBg3dMeasurementDocument(raw: unknown): string | null {
  const document = canonicalDocument(raw);
  if (!document) return null;
  try {
    const serialized = JSON.stringify(document);
    return utf8ByteLength(serialized) <= STUDIO_BG3D_MEASUREMENT_MAX_BYTES
      ? serialized
      : null;
  } catch {
    return null;
  }
}
