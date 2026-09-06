import type { StudioVrmVec3 } from "./studio-vrm-scene-document";

export const STUDIO_VRM_CONTACT_DEFAULT_MAX_CORRECTION = 0.75;
export const STUDIO_VRM_CONTACT_MAX_CORRECTION = 10;
export const STUDIO_VRM_CONTACT_DEFAULT_TOLERANCE = 0.002;
export const STUDIO_VRM_CONTACT_MAX_TOLERANCE = 0.1;

const MAX_ABSOLUTE_COORDINATE = 1_000_000;
const DEGENERATE_DISTANCE_SQUARED = 1e-12;

export type StudioVrmFootSide = "left" | "right";

export interface StudioVrmFootContactInput {
  readonly positionWorld: StudioVrmVec3;
  /** Requests a floor plant while still allowing horizontal travel with the hips. */
  readonly planted?: boolean;
  /** Pins horizontal position to `lockTargetWorld` (or the current foot position when omitted). */
  readonly locked?: boolean;
  readonly lockTargetWorld?: StudioVrmVec3;
}

export interface StudioVrmFloorContactInput {
  readonly floorHeight: number;
  readonly hipsWorld: StudioVrmVec3;
  readonly leftFoot: StudioVrmFootContactInput;
  readonly rightFoot: StudioVrmFootContactInput;
  /** Maximum length of the global hips correction vector. */
  readonly maxCorrection?: number;
  /** An unplanted foot this close to or below the floor participates in contact. */
  readonly contactTolerance?: number;
}

export interface NormalizedStudioVrmFootContactInput {
  readonly positionWorld: StudioVrmVec3;
  readonly planted: boolean;
  readonly locked: boolean;
  readonly lockTargetWorld: StudioVrmVec3 | null;
}

export interface NormalizedStudioVrmFloorContactInput {
  readonly floorHeight: number;
  readonly hipsWorld: StudioVrmVec3;
  readonly leftFoot: NormalizedStudioVrmFootContactInput;
  readonly rightFoot: NormalizedStudioVrmFootContactInput;
  readonly maxCorrection: number;
  readonly contactTolerance: number;
}

export interface StudioVrmFootContactResult {
  readonly side: StudioVrmFootSide;
  readonly contact: boolean;
  readonly planted: boolean;
  readonly locked: boolean;
  readonly penetrating: boolean;
  readonly sourceWorld: StudioVrmVec3;
  /** Position after applying only the shared hips translation. */
  readonly movedWithHipsWorld: StudioVrmVec3;
  /** Exact floor/lock target for a later leg IK pass. */
  readonly targetWorld: StudioVrmVec3;
  /** Remaining target delta after the shared hips translation. */
  readonly residualIkTranslation: StudioVrmVec3;
}

export interface StudioVrmFloorContactResult {
  readonly floorHeight: number;
  readonly activeContactCount: number;
  readonly hipsTranslation: StudioVrmVec3;
  readonly correctedHipsWorld: StudioVrmVec3;
  readonly clamped: boolean;
  readonly leftFoot: StudioVrmFootContactResult;
  readonly rightFoot: StudioVrmFootContactResult;
}

const ROOT_KEYS = new Set([
  "floorHeight",
  "hipsWorld",
  "leftFoot",
  "rightFoot",
  "maxCorrection",
  "contactTolerance",
]);
const FOOT_KEYS = new Set(["positionWorld", "planted", "locked", "lockTargetWorld"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function boundedFinite(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function vector(value: unknown): StudioVrmVec3 | null {
  if (
    !Array.isArray(value)
    || value.length !== 3
    || value.some((entry) => !boundedFinite(
      entry,
      -MAX_ABSOLUTE_COORDINATE,
      MAX_ABSOLUTE_COORDINATE,
    ))
  ) return null;
  return tuple(value[0], value[1], value[2]);
}

function tuple(x: number, y: number, z: number): StudioVrmVec3 {
  return Object.freeze([canonicalZero(x), canonicalZero(y), canonicalZero(z)]);
}

function canonicalZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function squaredDistance(left: StudioVrmVec3, right: StudioVrmVec3): number {
  const x = left[0] - right[0];
  const y = left[1] - right[1];
  const z = left[2] - right[2];
  return x * x + y * y + z * z;
}

function normalizeFoot(value: unknown): NormalizedStudioVrmFootContactInput | null {
  if (!isRecord(value) || !hasOnlyKeys(value, FOOT_KEYS)) return null;
  const positionWorld = vector(value.positionWorld);
  if (!positionWorld) return null;
  if (value.planted !== undefined && typeof value.planted !== "boolean") return null;
  if (value.locked !== undefined && typeof value.locked !== "boolean") return null;
  const locked = value.locked === true;
  if (locked && value.planted === false) return null;
  if (!locked && value.lockTargetWorld !== undefined) return null;
  const lockTargetWorld = value.lockTargetWorld === undefined
    ? null
    : vector(value.lockTargetWorld);
  if (value.lockTargetWorld !== undefined && !lockTargetWorld) return null;
  return Object.freeze({
    positionWorld,
    planted: locked || value.planted === true,
    locked,
    lockTargetWorld,
  });
}

/** Strictly validates and copies an untrusted floor-contact request. */
export function normalizeStudioVrmFloorContactInput(
  value: unknown,
): NormalizedStudioVrmFloorContactInput | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ROOT_KEYS)) return null;
  const floorHeight = value.floorHeight;
  if (!boundedFinite(floorHeight, -MAX_ABSOLUTE_COORDINATE, MAX_ABSOLUTE_COORDINATE)) {
    return null;
  }
  const hipsWorld = vector(value.hipsWorld);
  const leftFoot = normalizeFoot(value.leftFoot);
  const rightFoot = normalizeFoot(value.rightFoot);
  if (!hipsWorld || !leftFoot || !rightFoot) return null;
  if (
    squaredDistance(hipsWorld, leftFoot.positionWorld) <= DEGENERATE_DISTANCE_SQUARED
    || squaredDistance(hipsWorld, rightFoot.positionWorld) <= DEGENERATE_DISTANCE_SQUARED
    || squaredDistance(leftFoot.positionWorld, rightFoot.positionWorld)
      <= DEGENERATE_DISTANCE_SQUARED
  ) return null;
  const maxCorrection = value.maxCorrection
    ?? STUDIO_VRM_CONTACT_DEFAULT_MAX_CORRECTION;
  const contactTolerance = value.contactTolerance
    ?? STUDIO_VRM_CONTACT_DEFAULT_TOLERANCE;
  if (!boundedFinite(maxCorrection, Number.MIN_VALUE, STUDIO_VRM_CONTACT_MAX_CORRECTION)) {
    return null;
  }
  if (!boundedFinite(contactTolerance, 0, STUDIO_VRM_CONTACT_MAX_TOLERANCE)) return null;
  return Object.freeze({
    floorHeight,
    hipsWorld,
    leftFoot,
    rightFoot,
    maxCorrection,
    contactTolerance,
  });
}

interface PlannedFootContact {
  readonly side: StudioVrmFootSide;
  readonly source: NormalizedStudioVrmFootContactInput;
  readonly contact: boolean;
  readonly penetrating: boolean;
  readonly desiredHipsTranslation: StudioVrmVec3 | null;
  readonly horizontalLockTarget: StudioVrmVec3 | null;
}

function planFoot(
  side: StudioVrmFootSide,
  source: NormalizedStudioVrmFootContactInput,
  floorHeight: number,
  tolerance: number,
): PlannedFootContact {
  const penetrating = source.positionWorld[1] < floorHeight - tolerance;
  const contact = source.planted || source.positionWorld[1] <= floorHeight + tolerance;
  const horizontalLockTarget = source.locked
    ? source.lockTargetWorld ?? source.positionWorld
    : null;
  const desiredHipsTranslation = !contact
    ? null
    : source.locked
      ? tuple(
          horizontalLockTarget![0] - source.positionWorld[0],
          floorHeight - source.positionWorld[1],
          horizontalLockTarget![2] - source.positionWorld[2],
        )
      : tuple(0, floorHeight - source.positionWorld[1], 0);
  return { side, source, contact, penetrating, desiredHipsTranslation, horizontalLockTarget };
}

function meanTranslation(plans: readonly PlannedFootContact[]): StudioVrmVec3 {
  const active = plans.filter((plan) => plan.desiredHipsTranslation !== null);
  if (active.length === 0) return tuple(0, 0, 0);
  let x = 0;
  let y = 0;
  let z = 0;
  for (const plan of active) {
    const translation = plan.desiredHipsTranslation!;
    x += translation[0];
    y += translation[1];
    z += translation[2];
  }
  return tuple(x / active.length, y / active.length, z / active.length);
}

function clampTranslation(
  value: StudioVrmVec3,
  maximum: number,
): { readonly value: StudioVrmVec3; readonly clamped: boolean } {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length <= maximum) return { value, clamped: false };
  const scale = maximum / length;
  return {
    value: tuple(value[0] * scale, value[1] * scale, value[2] * scale),
    clamped: true,
  };
}

function add(left: StudioVrmVec3, right: StudioVrmVec3): StudioVrmVec3 {
  return tuple(left[0] + right[0], left[1] + right[1], left[2] + right[2]);
}

function subtract(left: StudioVrmVec3, right: StudioVrmVec3): StudioVrmVec3 {
  return tuple(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function footResult(
  plan: PlannedFootContact,
  hipsTranslation: StudioVrmVec3,
  floorHeight: number,
): StudioVrmFootContactResult {
  const movedWithHipsWorld = add(plan.source.positionWorld, hipsTranslation);
  const targetWorld = !plan.contact
    ? movedWithHipsWorld
    : plan.source.locked
      ? tuple(
          plan.horizontalLockTarget![0],
          floorHeight,
          plan.horizontalLockTarget![2],
        )
      : tuple(movedWithHipsWorld[0], floorHeight, movedWithHipsWorld[2]);
  return Object.freeze({
    side: plan.side,
    contact: plan.contact,
    planted: plan.source.planted,
    locked: plan.source.locked,
    penetrating: plan.penetrating,
    sourceWorld: plan.source.positionWorld,
    movedWithHipsWorld,
    targetWorld,
    residualIkTranslation: subtract(targetWorld, movedWithHipsWorld),
  });
}

/**
 * Computes one deterministic static-pose correction against the horizontal plane `y=floorHeight`.
 *
 * The shared hips translation is the least-squares mean of active foot constraints and is capped
 * by `maxCorrection`. Each foot result then exposes its remaining delta for a later two-bone IK
 * pass. The solver is pure: it never writes to Three objects or mutates caller-owned tuples.
 */
export function solveStudioVrmFloorContact(
  input: StudioVrmFloorContactInput | unknown,
): StudioVrmFloorContactResult | null {
  const normalized = normalizeStudioVrmFloorContactInput(input);
  if (!normalized) return null;
  const plans = [
    planFoot(
      "left",
      normalized.leftFoot,
      normalized.floorHeight,
      normalized.contactTolerance,
    ),
    planFoot(
      "right",
      normalized.rightFoot,
      normalized.floorHeight,
      normalized.contactTolerance,
    ),
  ] as const;
  const correction = clampTranslation(
    meanTranslation(plans),
    normalized.maxCorrection,
  );
  const result = {
    floorHeight: normalized.floorHeight,
    activeContactCount: plans.filter((plan) => plan.contact).length,
    hipsTranslation: correction.value,
    correctedHipsWorld: add(normalized.hipsWorld, correction.value),
    clamped: correction.clamped,
    leftFoot: footResult(plans[0], correction.value, normalized.floorHeight),
    rightFoot: footResult(plans[1], correction.value, normalized.floorHeight),
  } satisfies StudioVrmFloorContactResult;
  return Object.freeze(result);
}
