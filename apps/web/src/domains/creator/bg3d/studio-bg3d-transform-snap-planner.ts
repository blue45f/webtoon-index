/**
 * Renderer-neutral 3D translation constraint and snap planner.
 *
 * Scene adapters own ray casting and screen projection. This boundary accepts their bounded
 * vertex/surface candidates, resolves Global/Local axis constraints, and returns one immutable
 * translation plan. It never mutates a Three.js object, scene graph, history, or caller-owned data.
 */

export type StudioBg3dTransformSnapVec3 = readonly [number, number, number];
export type StudioBg3dTransformSnapAxis = "x" | "y" | "z";
export type StudioBg3dTransformSnapKind = "increment" | "vertex" | "surface";

export type StudioBg3dTransformConstraint =
  | { readonly kind: "free" }
  | { readonly kind: "axis"; readonly axis: StudioBg3dTransformSnapAxis }
  | { readonly kind: "plane"; readonly excludedAxis: StudioBg3dTransformSnapAxis };

export type StudioBg3dTransformOrientation =
  | { readonly space: "global" }
  | {
      readonly space: "local";
      /**
       * Right-handed orthonormal local axes expressed in world space.
       * Adapters may derive these columns from a verified world quaternion/matrix.
       */
      readonly axes: {
        readonly x: StudioBg3dTransformSnapVec3;
        readonly y: StudioBg3dTransformSnapVec3;
        readonly z: StudioBg3dTransformSnapVec3;
      };
    };

export interface StudioBg3dTransformIncrementSnap {
  /**
   * Relative quantizes the transform delta from its start, matching DCC incremental movement.
   * Absolute quantizes the translated snap base against `gridOriginWorld`, matching a CAD grid.
   */
  readonly mode: "relative" | "absolute";
  readonly step: number | StudioBg3dTransformSnapVec3;
  readonly gridOriginWorld?: StudioBg3dTransformSnapVec3;
}

export interface StudioBg3dTransformSnapSettings {
  readonly enabled: boolean;
  readonly modes: readonly StudioBg3dTransformSnapKind[];
  readonly increment?: StudioBg3dTransformIncrementSnap;
  /** Geometry candidates beyond this projected cursor distance are ignored. Default 12 CSS px. */
  readonly geometryActivationRadiusPx?: number;
}

export interface StudioBg3dTransformSnapModifiers {
  /** Semantic Ctrl-style override: invert the persistent magnet state for this modal sample. */
  readonly invertSnapping?: boolean;
  /** Semantic Shift-style override: hide vertex/surface candidates but preserve increment snap. */
  readonly suppressGeometrySnaps?: boolean;
}

export type StudioBg3dTransformSnapCandidate =
  | {
      readonly kind: "vertex";
      readonly id: string;
      readonly pointWorld: StudioBg3dTransformSnapVec3;
      readonly screenDistancePx: number;
    }
  | {
      readonly kind: "surface";
      readonly id: string;
      readonly pointWorld: StudioBg3dTransformSnapVec3;
      readonly normalWorld: StudioBg3dTransformSnapVec3;
      readonly screenDistancePx: number;
    };

export interface StudioBg3dTransformSnapBudgets {
  readonly maxCandidates: number;
  readonly maxEvaluations: number;
}

export interface PlanStudioBg3dTransformSnapInput {
  /** Object/pivot world position when the modal transform began. */
  readonly startWorldPosition: StudioBg3dTransformSnapVec3;
  /** Unsnapped object/pivot world position proposed by the current pointer sample. */
  readonly proposedWorldPosition: StudioBg3dTransformSnapVec3;
  /**
   * Selection point that should meet a geometry/grid target. Defaults to startWorldPosition.
   * This supports object origins, active vertices, median points, and custom pivots uniformly.
   */
  readonly snapBaseWorldPosition?: StudioBg3dTransformSnapVec3;
  readonly orientation: StudioBg3dTransformOrientation;
  readonly constraint: StudioBg3dTransformConstraint;
  readonly snap: StudioBg3dTransformSnapSettings;
  readonly modifiers?: StudioBg3dTransformSnapModifiers;
  readonly candidates: readonly StudioBg3dTransformSnapCandidate[];
  readonly budgets?: StudioBg3dTransformSnapBudgets;
}

export type StudioBg3dTransformSnapFailureReason =
  | "invalid-input"
  | "invalid-orientation"
  | "candidate-budget-exceeded"
  | "evaluation-budget-exceeded"
  | "duplicate-candidate-id"
  | "result-out-of-bounds";

export interface StudioBg3dTransformSnapSelection {
  readonly kind: "none" | StudioBg3dTransformSnapKind;
  readonly candidateId: string | null;
  /** Exact geometry target or resolved increment grid point. */
  readonly targetWorld: StudioBg3dTransformSnapVec3 | null;
  readonly normalWorld: StudioBg3dTransformSnapVec3 | null;
  /**
   * Distance between a constrained snap base and the geometry target. Non-zero means an axis or
   * plane constraint intentionally projected the target onto the allowed degrees of freedom.
   */
  readonly constraintResidualWorld: number;
  readonly distance: number | null;
  readonly distanceSpace: "none" | "screen-px" | "world";
}

export interface StudioBg3dTransformSnapSuccess {
  readonly ok: true;
  readonly positionWorld: StudioBg3dTransformSnapVec3;
  readonly worldDelta: StudioBg3dTransformSnapVec3;
  readonly snapBaseWorld: StudioBg3dTransformSnapVec3;
  readonly constrainedPositionWorld: StudioBg3dTransformSnapVec3;
  readonly constrainedSnapBaseWorld: StudioBg3dTransformSnapVec3;
  readonly coordinateSpace: "global" | "local";
  readonly constraint: StudioBg3dTransformConstraint;
  readonly effectiveSnappingEnabled: boolean;
  readonly evaluatedCandidates: number;
  readonly snap: StudioBg3dTransformSnapSelection;
}

export interface StudioBg3dTransformSnapFailure {
  readonly ok: false;
  readonly reason: StudioBg3dTransformSnapFailureReason;
}

export type StudioBg3dTransformSnapResult =
  | StudioBg3dTransformSnapSuccess
  | StudioBg3dTransformSnapFailure;

export const STUDIO_BG3D_TRANSFORM_SNAP_MAX_WORLD_COORDINATE = 10_000;
export const STUDIO_BG3D_TRANSFORM_SNAP_HARD_MAX_CANDIDATES = 16_384;
export const STUDIO_BG3D_TRANSFORM_SNAP_HARD_MAX_EVALUATIONS = 16_385;
export const DEFAULT_STUDIO_BG3D_TRANSFORM_SNAP_BUDGETS: StudioBg3dTransformSnapBudgets =
  Object.freeze({
    maxCandidates: 2_048,
    maxEvaluations: 2_049,
  });

const DEFAULT_GEOMETRY_ACTIVATION_RADIUS_PX = 12;
const MAX_GEOMETRY_ACTIVATION_RADIUS_PX = 512;
const MAX_SCREEN_DISTANCE_PX = 1_000_000;
const MIN_INCREMENT_STEP = 1e-6;
const MAX_INCREMENT_STEP = STUDIO_BG3D_TRANSFORM_SNAP_MAX_WORLD_COORDINATE * 2;
const BASIS_LENGTH_TOLERANCE = 1e-4;
const BASIS_ORTHOGONAL_TOLERANCE = 1e-4;
const BASIS_HANDEDNESS_TOLERANCE = 2e-4;
const CANDIDATE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:~-]{0,159}$/u;

type MutableVec3 = [number, number, number];
type AxisMask = readonly [boolean, boolean, boolean];

interface CanonicalBasis {
  readonly x: StudioBg3dTransformSnapVec3;
  readonly y: StudioBg3dTransformSnapVec3;
  readonly z: StudioBg3dTransformSnapVec3;
}

interface CanonicalCandidate {
  readonly kind: "vertex" | "surface";
  readonly id: string;
  readonly pointWorld: StudioBg3dTransformSnapVec3;
  readonly normalWorld: StudioBg3dTransformSnapVec3 | null;
  readonly screenDistancePx: number;
}

interface RankedGeometryCandidate {
  readonly candidate: CanonicalCandidate;
  readonly positionWorld: StudioBg3dTransformSnapVec3;
  readonly snapBaseWorld: StudioBg3dTransformSnapVec3;
  readonly worldDelta: StudioBg3dTransformSnapVec3;
  readonly constraintResidualWorld: number;
  readonly movementDistanceSquared: number;
}

function failure(reason: StudioBg3dTransformSnapFailureReason): StudioBg3dTransformSnapFailure {
  return Object.freeze({ ok: false, reason });
}

function canonicalNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum;
}

function nonNegativeSafeInteger(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && finiteInRange(value, 0, maximum);
}

function readVec3(
  value: unknown,
  maximumAbsoluteComponent = STUDIO_BG3D_TRANSFORM_SNAP_MAX_WORLD_COORDINATE,
): StudioBg3dTransformSnapVec3 | null {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((component) => (
      finiteInRange(component, -maximumAbsoluteComponent, maximumAbsoluteComponent)
    ))
  ) return null;
  return Object.freeze([
    canonicalNumber(value[0]),
    canonicalNumber(value[1]),
    canonicalNumber(value[2]),
  ] as const);
}

function tuple(value: MutableVec3): StudioBg3dTransformSnapVec3 {
  return Object.freeze([
    canonicalNumber(value[0]),
    canonicalNumber(value[1]),
    canonicalNumber(value[2]),
  ] as const);
}

function add(left: StudioBg3dTransformSnapVec3, right: StudioBg3dTransformSnapVec3): MutableVec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function subtract(
  left: StudioBg3dTransformSnapVec3,
  right: StudioBg3dTransformSnapVec3,
): MutableVec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function multiply(value: StudioBg3dTransformSnapVec3, scalar: number): MutableVec3 {
  return [value[0] * scalar, value[1] * scalar, value[2] * scalar];
}

function dot(left: StudioBg3dTransformSnapVec3, right: StudioBg3dTransformSnapVec3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(
  left: StudioBg3dTransformSnapVec3,
  right: StudioBg3dTransformSnapVec3,
): MutableVec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function length(value: StudioBg3dTransformSnapVec3): number {
  return Math.hypot(value[0], value[1], value[2]);
}

function distanceSquared(
  left: StudioBg3dTransformSnapVec3,
  right: StudioBg3dTransformSnapVec3,
): number {
  const delta = subtract(left, right);
  return dot(delta, delta);
}

function normalizeUnitVector(value: unknown): StudioBg3dTransformSnapVec3 | null {
  const vector = readVec3(value, 1_000_000);
  if (!vector) return null;
  const vectorLength = length(vector);
  if (
    !Number.isFinite(vectorLength) ||
    Math.abs(vectorLength - 1) > BASIS_LENGTH_TOLERANCE
  ) return null;
  return tuple([
    vector[0] / vectorLength,
    vector[1] / vectorLength,
    vector[2] / vectorLength,
  ]);
}

function readSurfaceNormal(value: unknown): StudioBg3dTransformSnapVec3 | null {
  const vector = readVec3(value, 1_000_000);
  if (!vector) return null;
  const vectorLength = length(vector);
  if (!Number.isFinite(vectorLength) || vectorLength < 1e-8) return null;
  return tuple([
    vector[0] / vectorLength,
    vector[1] / vectorLength,
    vector[2] / vectorLength,
  ]);
}

const GLOBAL_BASIS: CanonicalBasis = Object.freeze({
  x: Object.freeze([1, 0, 0] as const),
  y: Object.freeze([0, 1, 0] as const),
  z: Object.freeze([0, 0, 1] as const),
});

function readOrientation(value: unknown): {
  readonly space: "global" | "local";
  readonly basis: CanonicalBasis;
} | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Partial<StudioBg3dTransformOrientation>;
  if (candidate.space === "global") {
    return Object.freeze({ space: "global" as const, basis: GLOBAL_BASIS });
  }
  if (candidate.space !== "local" || !("axes" in candidate)) return null;
  const axes = candidate.axes;
  if (typeof axes !== "object" || axes === null || Array.isArray(axes)) return null;
  const x = normalizeUnitVector(axes.x);
  const y = normalizeUnitVector(axes.y);
  const z = normalizeUnitVector(axes.z);
  if (!x || !y || !z) return null;
  if (
    Math.abs(dot(x, y)) > BASIS_ORTHOGONAL_TOLERANCE ||
    Math.abs(dot(x, z)) > BASIS_ORTHOGONAL_TOLERANCE ||
    Math.abs(dot(y, z)) > BASIS_ORTHOGONAL_TOLERANCE
  ) return null;
  const handedness = dot(cross(x, y), z);
  if (
    !Number.isFinite(handedness) ||
    Math.abs(handedness - 1) > BASIS_HANDEDNESS_TOLERANCE
  ) return null;
  return Object.freeze({
    space: "local" as const,
    basis: Object.freeze({ x, y, z }),
  });
}

function readConstraint(value: unknown): StudioBg3dTransformConstraint | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Partial<StudioBg3dTransformConstraint>;
  if (candidate.kind === "free") return Object.freeze({ kind: "free" as const });
  if (
    candidate.kind === "axis" &&
    (candidate.axis === "x" || candidate.axis === "y" || candidate.axis === "z")
  ) {
    return Object.freeze({ kind: "axis" as const, axis: candidate.axis });
  }
  if (
    candidate.kind === "plane" &&
    (
      candidate.excludedAxis === "x" ||
      candidate.excludedAxis === "y" ||
      candidate.excludedAxis === "z"
    )
  ) {
    return Object.freeze({
      kind: "plane" as const,
      excludedAxis: candidate.excludedAxis,
    });
  }
  return null;
}

function constraintMask(constraint: StudioBg3dTransformConstraint): AxisMask {
  if (constraint.kind === "free") return [true, true, true];
  if (constraint.kind === "axis") {
    return [
      constraint.axis === "x",
      constraint.axis === "y",
      constraint.axis === "z",
    ];
  }
  return [
    constraint.excludedAxis !== "x",
    constraint.excludedAxis !== "y",
    constraint.excludedAxis !== "z",
  ];
}

function toBasisCoordinates(
  value: StudioBg3dTransformSnapVec3,
  basis: CanonicalBasis,
): MutableVec3 {
  return [dot(value, basis.x), dot(value, basis.y), dot(value, basis.z)];
}

function fromBasisCoordinates(value: StudioBg3dTransformSnapVec3, basis: CanonicalBasis): MutableVec3 {
  const x = multiply(basis.x, value[0]);
  const y = multiply(basis.y, value[1]);
  const z = multiply(basis.z, value[2]);
  return [x[0] + y[0] + z[0], x[1] + y[1] + z[1], x[2] + y[2] + z[2]];
}

function constrainDelta(
  deltaWorld: StudioBg3dTransformSnapVec3,
  basis: CanonicalBasis,
  mask: AxisMask,
): StudioBg3dTransformSnapVec3 {
  const coordinates = toBasisCoordinates(deltaWorld, basis);
  return tuple(fromBasisCoordinates([
    mask[0] ? coordinates[0] : 0,
    mask[1] ? coordinates[1] : 0,
    mask[2] ? coordinates[2] : 0,
  ], basis));
}

function readModes(value: unknown): ReadonlySet<StudioBg3dTransformSnapKind> | null {
  if (!Array.isArray(value) || value.length > 3) return null;
  const modes = new Set<StudioBg3dTransformSnapKind>();
  for (const mode of value) {
    if (mode !== "increment" && mode !== "vertex" && mode !== "surface") return null;
    if (modes.has(mode)) return null;
    modes.add(mode);
  }
  return modes;
}

function readStep(value: unknown): StudioBg3dTransformSnapVec3 | null {
  if (typeof value === "number") {
    if (!finiteInRange(value, MIN_INCREMENT_STEP, MAX_INCREMENT_STEP)) return null;
    return Object.freeze([value, value, value] as const);
  }
  const step = readVec3(value, MAX_INCREMENT_STEP);
  if (!step || !step.every((component) => component > 0)) return null;
  return step;
}

function readIncrement(value: unknown): {
  readonly mode: "relative" | "absolute";
  readonly step: StudioBg3dTransformSnapVec3;
  readonly gridOriginWorld: StudioBg3dTransformSnapVec3;
} | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Partial<StudioBg3dTransformIncrementSnap>;
  if (candidate.mode !== "relative" && candidate.mode !== "absolute") return null;
  const step = readStep(candidate.step);
  if (!step) return null;
  const gridOriginWorld = candidate.gridOriginWorld === undefined
    ? Object.freeze([0, 0, 0] as const)
    : readVec3(candidate.gridOriginWorld);
  if (!gridOriginWorld) return null;
  return Object.freeze({ mode: candidate.mode, step, gridOriginWorld });
}

function readModifiers(value: unknown): {
  readonly invertSnapping: boolean;
  readonly suppressGeometrySnaps: boolean;
} | null {
  if (value === undefined) {
    return Object.freeze({ invertSnapping: false, suppressGeometrySnaps: false });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Partial<StudioBg3dTransformSnapModifiers>;
  if (
    candidate.invertSnapping !== undefined &&
    typeof candidate.invertSnapping !== "boolean"
  ) return null;
  if (
    candidate.suppressGeometrySnaps !== undefined &&
    typeof candidate.suppressGeometrySnaps !== "boolean"
  ) return null;
  return Object.freeze({
    invertSnapping: candidate.invertSnapping ?? false,
    suppressGeometrySnaps: candidate.suppressGeometrySnaps ?? false,
  });
}

function readBudgets(value: unknown): StudioBg3dTransformSnapBudgets | null {
  if (value === undefined) return DEFAULT_STUDIO_BG3D_TRANSFORM_SNAP_BUDGETS;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Partial<StudioBg3dTransformSnapBudgets>;
  if (
    !nonNegativeSafeInteger(
      candidate.maxCandidates,
      STUDIO_BG3D_TRANSFORM_SNAP_HARD_MAX_CANDIDATES,
    ) ||
    !nonNegativeSafeInteger(
      candidate.maxEvaluations,
      STUDIO_BG3D_TRANSFORM_SNAP_HARD_MAX_EVALUATIONS,
    )
  ) return null;
  return Object.freeze({
    maxCandidates: candidate.maxCandidates,
    maxEvaluations: candidate.maxEvaluations,
  });
}

function readCandidate(value: unknown): CanonicalCandidate | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Partial<StudioBg3dTransformSnapCandidate>;
  if (
    (candidate.kind !== "vertex" && candidate.kind !== "surface") ||
    typeof candidate.id !== "string" ||
    !CANDIDATE_ID_PATTERN.test(candidate.id) ||
    !finiteInRange(candidate.screenDistancePx, 0, MAX_SCREEN_DISTANCE_PX)
  ) return null;
  const pointWorld = readVec3(candidate.pointWorld);
  if (!pointWorld) return null;
  if (candidate.kind === "vertex") {
    return Object.freeze({
      kind: "vertex" as const,
      id: candidate.id,
      pointWorld,
      normalWorld: null,
      screenDistancePx: candidate.screenDistancePx,
    });
  }
  const normalWorld = readSurfaceNormal(
    "normalWorld" in candidate ? candidate.normalWorld : undefined,
  );
  if (!normalWorld) return null;
  return Object.freeze({
    kind: "surface" as const,
    id: candidate.id,
    pointWorld,
    normalWorld,
    screenDistancePx: candidate.screenDistancePx,
  });
}

function withinWorldBounds(value: StudioBg3dTransformSnapVec3): boolean {
  return value.every((component) => (
    finiteInRange(
      component,
      -STUDIO_BG3D_TRANSFORM_SNAP_MAX_WORLD_COORDINATE,
      STUDIO_BG3D_TRANSFORM_SNAP_MAX_WORLD_COORDINATE,
    )
  ));
}

function snapScalar(value: number, step: number): number {
  return canonicalNumber(Math.round(value / step) * step);
}

function resolveIncrement(
  increment: {
    readonly mode: "relative" | "absolute";
    readonly step: StudioBg3dTransformSnapVec3;
    readonly gridOriginWorld: StudioBg3dTransformSnapVec3;
  },
  startWorldPosition: StudioBg3dTransformSnapVec3,
  snapBaseWorldPosition: StudioBg3dTransformSnapVec3,
  constrainedDeltaWorld: StudioBg3dTransformSnapVec3,
  basis: CanonicalBasis,
  mask: AxisMask,
): {
  readonly positionWorld: StudioBg3dTransformSnapVec3;
  readonly snapBaseWorld: StudioBg3dTransformSnapVec3;
  readonly worldDelta: StudioBg3dTransformSnapVec3;
  readonly distanceWorld: number;
} {
  let snappedDeltaWorld: StudioBg3dTransformSnapVec3;
  if (increment.mode === "relative") {
    const coordinates = toBasisCoordinates(constrainedDeltaWorld, basis);
    const snappedCoordinates: MutableVec3 = [
      mask[0] ? snapScalar(coordinates[0], increment.step[0]) : 0,
      mask[1] ? snapScalar(coordinates[1], increment.step[1]) : 0,
      mask[2] ? snapScalar(coordinates[2], increment.step[2]) : 0,
    ];
    snappedDeltaWorld = tuple(fromBasisCoordinates(snappedCoordinates, basis));
  } else {
    const constrainedSnapBase = tuple(add(snapBaseWorldPosition, constrainedDeltaWorld));
    const gridRelative = tuple(subtract(constrainedSnapBase, increment.gridOriginWorld));
    const coordinates = toBasisCoordinates(gridRelative, basis);
    const snappedCoordinates: MutableVec3 = [
      mask[0] ? snapScalar(coordinates[0], increment.step[0]) : coordinates[0],
      mask[1] ? snapScalar(coordinates[1], increment.step[1]) : coordinates[1],
      mask[2] ? snapScalar(coordinates[2], increment.step[2]) : coordinates[2],
    ];
    const snappedSnapBase = tuple(add(
      increment.gridOriginWorld,
      tuple(fromBasisCoordinates(snappedCoordinates, basis)),
    ));
    snappedDeltaWorld = constrainDelta(
      tuple(subtract(snappedSnapBase, snapBaseWorldPosition)),
      basis,
      mask,
    );
  }
  const positionWorld = tuple(add(startWorldPosition, snappedDeltaWorld));
  const snapBaseWorld = tuple(add(snapBaseWorldPosition, snappedDeltaWorld));
  const constrainedPositionWorld = tuple(add(startWorldPosition, constrainedDeltaWorld));
  return Object.freeze({
    positionWorld,
    snapBaseWorld,
    worldDelta: snappedDeltaWorld,
    distanceWorld: Math.sqrt(distanceSquared(positionWorld, constrainedPositionWorld)),
  });
}

function compareCandidateIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareRankedGeometry(
  left: RankedGeometryCandidate,
  right: RankedGeometryCandidate,
): number {
  if (left.candidate.screenDistancePx !== right.candidate.screenDistancePx) {
    return left.candidate.screenDistancePx - right.candidate.screenDistancePx;
  }
  if (left.candidate.kind !== right.candidate.kind) {
    return left.candidate.kind === "vertex" ? -1 : 1;
  }
  if (left.movementDistanceSquared !== right.movementDistanceSquared) {
    return left.movementDistanceSquared - right.movementDistanceSquared;
  }
  return compareCandidateIds(left.candidate.id, right.candidate.id);
}

function frozenSelection(
  value: StudioBg3dTransformSnapSelection,
): StudioBg3dTransformSnapSelection {
  return Object.freeze(value);
}

/**
 * Builds one deterministic translation plan.
 *
 * Geometry ranking is input-order independent: projected cursor distance, then vertex before
 * surface, then smallest movement from the constrained pointer, then ASCII candidate ID.
 * Increment is a fallback when no admitted geometry target wins.
 */
export function planStudioBg3dTransformSnap(
  input: PlanStudioBg3dTransformSnapInput,
): StudioBg3dTransformSnapResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return failure("invalid-input");
  }
  const startWorldPosition = readVec3(input.startWorldPosition);
  const proposedWorldPosition = readVec3(input.proposedWorldPosition);
  const snapBaseWorldPosition = input.snapBaseWorldPosition === undefined
    ? startWorldPosition
    : readVec3(input.snapBaseWorldPosition);
  const orientation = readOrientation(input.orientation);
  if (!orientation) return failure("invalid-orientation");
  const constraint = readConstraint(input.constraint);
  const modes = readModes(input.snap?.modes);
  const modifiers = readModifiers(input.modifiers);
  const budgets = readBudgets(input.budgets);
  if (
    !startWorldPosition ||
    !proposedWorldPosition ||
    !snapBaseWorldPosition ||
    !constraint ||
    !modes ||
    !modifiers ||
    !budgets ||
    typeof input.snap?.enabled !== "boolean" ||
    !Array.isArray(input.candidates)
  ) return failure("invalid-input");

  const activationRadiusPx = input.snap.geometryActivationRadiusPx === undefined
    ? DEFAULT_GEOMETRY_ACTIVATION_RADIUS_PX
    : input.snap.geometryActivationRadiusPx;
  if (
    !finiteInRange(
      activationRadiusPx,
      Number.MIN_VALUE,
      MAX_GEOMETRY_ACTIVATION_RADIUS_PX,
    )
  ) return failure("invalid-input");

  let increment: ReturnType<typeof readIncrement> = null;
  if (input.snap.increment !== undefined) {
    increment = readIncrement(input.snap.increment);
    if (!increment) return failure("invalid-input");
  }
  if (modes.has("increment") && !increment) return failure("invalid-input");

  if (
    input.candidates.length > STUDIO_BG3D_TRANSFORM_SNAP_HARD_MAX_CANDIDATES ||
    input.candidates.length > budgets.maxCandidates
  ) return failure("candidate-budget-exceeded");

  const candidates: CanonicalCandidate[] = [];
  const candidateIds = new Set<string>();
  for (const value of input.candidates) {
    const candidate = readCandidate(value);
    if (!candidate) return failure("invalid-input");
    if (candidateIds.has(candidate.id)) return failure("duplicate-candidate-id");
    candidateIds.add(candidate.id);
    candidates.push(candidate);
  }

  const effectiveSnappingEnabled = input.snap.enabled !== modifiers.invertSnapping;
  const geometryEnabled = effectiveSnappingEnabled && !modifiers.suppressGeometrySnaps;
  const geometryEvaluationCount = geometryEnabled
    ? candidates.filter((candidate) => modes.has(candidate.kind)).length
    : 0;
  const incrementEvaluationCount = effectiveSnappingEnabled && modes.has("increment") ? 1 : 0;
  const potentialEvaluations = geometryEvaluationCount + incrementEvaluationCount;
  if (potentialEvaluations > budgets.maxEvaluations) {
    return failure("evaluation-budget-exceeded");
  }

  const mask = constraintMask(constraint);
  const proposedDelta = tuple(subtract(proposedWorldPosition, startWorldPosition));
  const constrainedDelta = constrainDelta(proposedDelta, orientation.basis, mask);
  const constrainedPositionWorld = tuple(add(startWorldPosition, constrainedDelta));
  const constrainedSnapBaseWorld = tuple(add(snapBaseWorldPosition, constrainedDelta));
  let evaluatedCandidates = 0;

  if (geometryEnabled) {
    let winner: RankedGeometryCandidate | null = null;
    for (const candidate of candidates) {
      if (!modes.has(candidate.kind)) continue;
      evaluatedCandidates += 1;
      if (candidate.screenDistancePx > activationRadiusPx) continue;
      const desiredDelta = tuple(subtract(candidate.pointWorld, snapBaseWorldPosition));
      const worldDelta = constrainDelta(desiredDelta, orientation.basis, mask);
      const positionWorld = tuple(add(startWorldPosition, worldDelta));
      const snapBaseWorld = tuple(add(snapBaseWorldPosition, worldDelta));
      const ranked: RankedGeometryCandidate = {
        candidate,
        positionWorld,
        snapBaseWorld,
        worldDelta,
        constraintResidualWorld: Math.sqrt(distanceSquared(
          snapBaseWorld,
          candidate.pointWorld,
        )),
        movementDistanceSquared: distanceSquared(positionWorld, constrainedPositionWorld),
      };
      if (!winner || compareRankedGeometry(ranked, winner) < 0) winner = ranked;
    }
    if (winner) {
      if (!withinWorldBounds(winner.positionWorld) || !withinWorldBounds(winner.snapBaseWorld)) {
        return failure("result-out-of-bounds");
      }
      return Object.freeze({
        ok: true as const,
        positionWorld: winner.positionWorld,
        worldDelta: winner.worldDelta,
        snapBaseWorld: winner.snapBaseWorld,
        constrainedPositionWorld,
        constrainedSnapBaseWorld,
        coordinateSpace: orientation.space,
        constraint,
        effectiveSnappingEnabled,
        evaluatedCandidates,
        snap: frozenSelection({
          kind: winner.candidate.kind,
          candidateId: winner.candidate.id,
          targetWorld: winner.candidate.pointWorld,
          normalWorld: winner.candidate.normalWorld,
          constraintResidualWorld: winner.constraintResidualWorld,
          distance: winner.candidate.screenDistancePx,
          distanceSpace: "screen-px",
        }),
      });
    }
  }

  if (effectiveSnappingEnabled && modes.has("increment") && increment) {
    evaluatedCandidates += 1;
    const resolved = resolveIncrement(
      increment,
      startWorldPosition,
      snapBaseWorldPosition,
      constrainedDelta,
      orientation.basis,
      mask,
    );
    if (!withinWorldBounds(resolved.positionWorld) || !withinWorldBounds(resolved.snapBaseWorld)) {
      return failure("result-out-of-bounds");
    }
    return Object.freeze({
      ok: true as const,
      positionWorld: resolved.positionWorld,
      worldDelta: resolved.worldDelta,
      snapBaseWorld: resolved.snapBaseWorld,
      constrainedPositionWorld,
      constrainedSnapBaseWorld,
      coordinateSpace: orientation.space,
      constraint,
      effectiveSnappingEnabled,
      evaluatedCandidates,
      snap: frozenSelection({
        kind: "increment",
        candidateId: null,
        targetWorld: resolved.snapBaseWorld,
        normalWorld: null,
        constraintResidualWorld: 0,
        distance: resolved.distanceWorld,
        distanceSpace: "world",
      }),
    });
  }

  if (!withinWorldBounds(constrainedPositionWorld) || !withinWorldBounds(constrainedSnapBaseWorld)) {
    return failure("result-out-of-bounds");
  }
  return Object.freeze({
    ok: true as const,
    positionWorld: constrainedPositionWorld,
    worldDelta: constrainedDelta,
    snapBaseWorld: constrainedSnapBaseWorld,
    constrainedPositionWorld,
    constrainedSnapBaseWorld,
    coordinateSpace: orientation.space,
    constraint,
    effectiveSnappingEnabled,
    evaluatedCandidates,
    snap: frozenSelection({
      kind: "none",
      candidateId: null,
      targetWorld: null,
      normalWorld: null,
      constraintResidualWorld: 0,
      distance: null,
      distanceSpace: "none",
    }),
  });
}
