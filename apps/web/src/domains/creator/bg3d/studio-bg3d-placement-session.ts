/**
 * Renderer-neutral cursor-placement session for verified Studio BG3D models.
 *
 * Preview transitions are deliberately effect-free: callers may render the returned pose, but must
 * not mutate the scene or history until the sole `click-commit` transition returns a commit plan.
 */

export const STUDIO_BG3D_PLACEMENT_DEFAULT_ROTATION_STEP_DEGREES = 15;
export const STUDIO_BG3D_PLACEMENT_MAX_WORLD_COORDINATE = 10_000;

const STUDIO_BG3D_PLACEMENT_MAX_ID_LENGTH = 160;
const STUDIO_BG3D_PLACEMENT_MAX_TOKEN_LENGTH = 160;
const STUDIO_BG3D_PLACEMENT_MAX_NORMAL_COMPONENT = 1_000_000;
const STUDIO_BG3D_PLACEMENT_MIN_NORMAL_LENGTH = 1e-8;
const STUDIO_BG3D_PLACEMENT_MAX_ROTATION_STEP_DEGREES = 180;
const STUDIO_BG3D_PLACEMENT_AXIS_EPSILON = 1e-8;
const FORBIDDEN_IDENTIFIERS = new Set(["constructor", "prototype", "__proto__"]);

export type StudioBg3dPlacementVec3 = readonly [number, number, number];
export type StudioBg3dPlacementSourceKind = "asset-library" | "import";
export type StudioBg3dPlacementTargetKind = "surface" | "floor";
export type StudioBg3dPlacementAxisLock = "none" | "world-x" | "world-z";

export interface StudioBg3dPlacementSurfaceHit {
  readonly point: StudioBg3dPlacementVec3;
  readonly normal: StudioBg3dPlacementVec3;
}

export interface StudioBg3dPlacementPointerTarget {
  /** A present but invalid surface hit fails closed instead of silently falling back to the floor. */
  readonly surfaceHit?: StudioBg3dPlacementSurfaceHit | null;
  /** World X/Z under the pointer. Y is intentionally omitted and canonicalized to the y=0 floor. */
  readonly floorPoint?: readonly [number, number] | null;
}

export interface StudioBg3dPlacementIdentity {
  readonly assetId: string;
  readonly storageId: string;
  readonly placementToken: string;
  readonly sourceKind: StudioBg3dPlacementSourceKind;
}

export interface StudioBg3dPlacementPose {
  readonly targetKind: StudioBg3dPlacementTargetKind;
  readonly worldPosition: StudioBg3dPlacementVec3;
  readonly worldNormal: StudioBg3dPlacementVec3;
  /** Canonical degrees in [-180, 180). */
  readonly yawDegrees: number;
  /** Shift constrains pointer motion to the first dominant horizontal world axis. */
  readonly axisLock: StudioBg3dPlacementAxisLock;
}

export interface StudioBg3dPlacementIdleState {
  readonly phase: "idle";
}

export interface StudioBg3dPlacementPreviewState {
  readonly phase: "preview";
  readonly identity: StudioBg3dPlacementIdentity;
  readonly placement: StudioBg3dPlacementPose;
  readonly anchorWorldPosition: StudioBg3dPlacementVec3;
  readonly rotationStepDegrees: number;
}

export interface StudioBg3dPlacementCommittedState {
  readonly phase: "committed";
  readonly identity: StudioBg3dPlacementIdentity;
  readonly placement: StudioBg3dPlacementPose;
}

export interface StudioBg3dPlacementCancelledState {
  readonly phase: "cancelled";
  readonly identity: StudioBg3dPlacementIdentity;
}

export type StudioBg3dPlacementSessionState =
  | StudioBg3dPlacementIdleState
  | StudioBg3dPlacementPreviewState
  | StudioBg3dPlacementCommittedState
  | StudioBg3dPlacementCancelledState;

interface StudioBg3dPlacementBeginEvent extends StudioBg3dPlacementPointerTarget {
  readonly type: "begin";
  readonly assetId: string;
  readonly storageId: string;
  readonly placementToken: string;
  readonly sourceKind: StudioBg3dPlacementSourceKind;
  readonly yawDegrees?: number;
  readonly rotationStepDegrees?: number;
}

interface StudioBg3dPlacementPointerMoveEvent extends StudioBg3dPlacementPointerTarget {
  readonly type: "pointer-move";
  readonly placementToken: string;
  readonly shiftKey: boolean;
}

interface StudioBg3dPlacementRotateEvent {
  readonly type: "rotate";
  readonly placementToken: string;
  /** One session-defined rotation step per event. Positive is clockwise in the placement UI. */
  readonly direction: "clockwise" | "counter-clockwise";
}

interface StudioBg3dPlacementCommitEvent {
  readonly type: "click-commit";
  readonly placementToken: string;
}

interface StudioBg3dPlacementCancelEvent {
  readonly type: "escape";
  readonly placementToken: string;
}

export type StudioBg3dPlacementSessionEvent =
  | StudioBg3dPlacementBeginEvent
  | StudioBg3dPlacementPointerMoveEvent
  | StudioBg3dPlacementRotateEvent
  | StudioBg3dPlacementCommitEvent
  | StudioBg3dPlacementCancelEvent;

/** The caller applies this once as one scene/history transaction. */
export interface StudioBg3dPlacementCommitPlan extends StudioBg3dPlacementIdentity {
  readonly kind: "studio-bg3d-model-placement";
  readonly placement: StudioBg3dPlacementPose;
}

export type StudioBg3dPlacementFailureReason =
  | "invalid-input"
  | "invalid-state"
  | "invalid-transition"
  | "stale-token";

export type StudioBg3dPlacementTransitionResult =
  | {
      readonly ok: true;
      readonly state: StudioBg3dPlacementSessionState;
      /** Non-null only for the first valid preview -> committed transition. */
      readonly commitPlan: StudioBg3dPlacementCommitPlan | null;
    }
  | {
      readonly ok: false;
      readonly state: StudioBg3dPlacementSessionState;
      readonly commitPlan: null;
      readonly reason: StudioBg3dPlacementFailureReason;
    };

const IDLE_STATE: StudioBg3dPlacementIdleState = Object.freeze({ phase: "idle" });

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function isFiniteInRange(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= maximum;
}

function readWorldVec3(value: unknown): StudioBg3dPlacementVec3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  if (!value.every((component) => (
    isFiniteInRange(component, STUDIO_BG3D_PLACEMENT_MAX_WORLD_COORDINATE)
  ))) return null;
  return Object.freeze([
    canonicalNumber(value[0]),
    canonicalNumber(value[1]),
    canonicalNumber(value[2]),
  ] as const);
}

function readFloorPoint(value: unknown): StudioBg3dPlacementVec3 | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const x = value[0];
  const z = value[1];
  if (
    !isFiniteInRange(x, STUDIO_BG3D_PLACEMENT_MAX_WORLD_COORDINATE) ||
    !isFiniteInRange(z, STUDIO_BG3D_PLACEMENT_MAX_WORLD_COORDINATE)
  ) return null;
  return Object.freeze([canonicalNumber(x), 0, canonicalNumber(z)] as const);
}

function readWorldNormal(value: unknown): StudioBg3dPlacementVec3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  if (!value.every((component) => (
    isFiniteInRange(component, STUDIO_BG3D_PLACEMENT_MAX_NORMAL_COMPONENT)
  ))) return null;
  const length = Math.hypot(value[0], value[1], value[2]);
  if (!Number.isFinite(length) || length < STUDIO_BG3D_PLACEMENT_MIN_NORMAL_LENGTH) return null;
  return Object.freeze([
    canonicalNumber(value[0] / length),
    canonicalNumber(value[1] / length),
    canonicalNumber(value[2] / length),
  ] as const);
}

function isSafeIdentifier(value: unknown, maximumLength: number): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.trim() !== value ||
    FORBIDDEN_IDENTIFIERS.has(value.toLowerCase())
  ) return false;
  return !Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function readIdentity(value: {
  readonly assetId?: unknown;
  readonly storageId?: unknown;
  readonly placementToken?: unknown;
  readonly sourceKind?: unknown;
}): StudioBg3dPlacementIdentity | null {
  if (
    !isSafeIdentifier(value.assetId, STUDIO_BG3D_PLACEMENT_MAX_ID_LENGTH) ||
    !isSafeIdentifier(value.storageId, STUDIO_BG3D_PLACEMENT_MAX_ID_LENGTH) ||
    !isSafeIdentifier(value.placementToken, STUDIO_BG3D_PLACEMENT_MAX_TOKEN_LENGTH) ||
    (value.sourceKind !== "asset-library" && value.sourceKind !== "import")
  ) return null;
  return Object.freeze({
    assetId: value.assetId,
    storageId: value.storageId,
    placementToken: value.placementToken,
    sourceKind: value.sourceKind,
  });
}

function normalizeYawDegrees(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const wrapped = ((value % 360) + 360) % 360;
  return canonicalNumber(wrapped >= 180 ? wrapped - 360 : wrapped);
}

function readRotationStepDegrees(value: unknown): number | null {
  if (value === undefined) return STUDIO_BG3D_PLACEMENT_DEFAULT_ROTATION_STEP_DEGREES;
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= STUDIO_BG3D_PLACEMENT_MAX_ROTATION_STEP_DEGREES
    ? canonicalNumber(value)
    : null;
}

function resolvePointerTarget(value: StudioBg3dPlacementPointerTarget): {
  readonly targetKind: StudioBg3dPlacementTargetKind;
  readonly worldPosition: StudioBg3dPlacementVec3;
  readonly worldNormal: StudioBg3dPlacementVec3;
} | null {
  if (!isPlainRecord(value)) return null;
  if (value.surfaceHit !== undefined && value.surfaceHit !== null) {
    if (!isPlainRecord(value.surfaceHit)) return null;
    const worldPosition = readWorldVec3(value.surfaceHit.point);
    const worldNormal = readWorldNormal(value.surfaceHit.normal);
    return worldPosition && worldNormal
      ? Object.freeze({ targetKind: "surface" as const, worldPosition, worldNormal })
      : null;
  }
  const worldPosition = readFloorPoint(value.floorPoint);
  return worldPosition
    ? Object.freeze({
        targetKind: "floor" as const,
        worldPosition,
        worldNormal: Object.freeze([0, 1, 0] as const),
      })
    : null;
}

function createPlacementPose(input: {
  readonly targetKind: StudioBg3dPlacementTargetKind;
  readonly worldPosition: StudioBg3dPlacementVec3;
  readonly worldNormal: StudioBg3dPlacementVec3;
  readonly yawDegrees: number;
  readonly axisLock: StudioBg3dPlacementAxisLock;
}): StudioBg3dPlacementPose {
  return Object.freeze({ ...input });
}

function isCanonicalIdentity(value: unknown): value is StudioBg3dPlacementIdentity {
  return isPlainRecord(value) && readIdentity(value) !== null;
}

function isCanonicalPose(value: unknown): value is StudioBg3dPlacementPose {
  if (!isPlainRecord(value)) return false;
  const position = readWorldVec3(value.worldPosition);
  const normal = readWorldNormal(value.worldNormal);
  const yaw = normalizeYawDegrees(value.yawDegrees);
  const sourceNormal = Array.isArray(value.worldNormal) && value.worldNormal.length === 3
    ? value.worldNormal
    : null;
  const sourceNormalLength = sourceNormal && sourceNormal.every((component) => typeof component === "number")
    ? Math.hypot(sourceNormal[0], sourceNormal[1], sourceNormal[2])
    : 0;
  return Boolean(
    position &&
    normal &&
    Number.isFinite(sourceNormalLength) &&
    Math.abs(sourceNormalLength - 1) <= 1e-8 &&
    yaw === value.yawDegrees &&
    (value.targetKind === "surface" || value.targetKind === "floor") &&
    (value.axisLock === "none" || value.axisLock === "world-x" || value.axisLock === "world-z")
  );
}

function isCanonicalState(value: unknown): value is StudioBg3dPlacementSessionState {
  if (!isPlainRecord(value) || typeof value.phase !== "string") return false;
  if (value.phase === "idle") return true;
  if (value.phase === "cancelled") return isCanonicalIdentity(value.identity);
  if (value.phase === "committed") {
    return isCanonicalIdentity(value.identity) && isCanonicalPose(value.placement);
  }
  if (value.phase !== "preview") return false;
  return isCanonicalIdentity(value.identity) &&
    isCanonicalPose(value.placement) &&
    readWorldVec3(value.anchorWorldPosition) !== null &&
    readRotationStepDegrees(value.rotationStepDegrees) === value.rotationStepDegrees;
}

function success(
  state: StudioBg3dPlacementSessionState,
  commitPlan: StudioBg3dPlacementCommitPlan | null = null,
): StudioBg3dPlacementTransitionResult {
  return Object.freeze({ ok: true, state, commitPlan });
}

function failure(
  state: StudioBg3dPlacementSessionState,
  reason: StudioBg3dPlacementFailureReason,
): StudioBg3dPlacementTransitionResult {
  return Object.freeze({ ok: false, state, commitPlan: null, reason });
}

function readActiveToken(
  state: Exclude<StudioBg3dPlacementSessionState, StudioBg3dPlacementIdleState>,
  value: unknown,
): StudioBg3dPlacementFailureReason | null {
  if (!isSafeIdentifier(value, STUDIO_BG3D_PLACEMENT_MAX_TOKEN_LENGTH)) return "invalid-input";
  return state.identity.placementToken === value ? null : "stale-token";
}

function resolveAxisLockedPosition(
  anchor: StudioBg3dPlacementVec3,
  candidate: StudioBg3dPlacementVec3,
  previousLock: StudioBg3dPlacementAxisLock,
  shiftKey: boolean,
): { readonly position: StudioBg3dPlacementVec3; readonly axisLock: StudioBg3dPlacementAxisLock } {
  if (!shiftKey) return { position: candidate, axisLock: "none" };
  const deltaX = candidate[0] - anchor[0];
  const deltaZ = candidate[2] - anchor[2];
  let axisLock = previousLock;
  if (axisLock === "none") {
    if (Math.max(Math.abs(deltaX), Math.abs(deltaZ)) < STUDIO_BG3D_PLACEMENT_AXIS_EPSILON) {
      return { position: candidate, axisLock };
    }
    axisLock = Math.abs(deltaX) >= Math.abs(deltaZ) ? "world-x" : "world-z";
  }
  return axisLock === "world-x"
    ? {
        position: Object.freeze([candidate[0], candidate[1], anchor[2]] as const),
        axisLock,
      }
    : {
        position: Object.freeze([anchor[0], candidate[1], candidate[2]] as const),
        axisLock,
      };
}

export function createStudioBg3dPlacementSession(): StudioBg3dPlacementIdleState {
  return IDLE_STATE;
}

/**
 * Applies one placement event without touching a renderer, scene array, or undo stack.
 * Invalid/stale events retain the exact prior canonical state and never emit a commit plan.
 */
export function transitionStudioBg3dPlacementSession(
  state: StudioBg3dPlacementSessionState,
  event: StudioBg3dPlacementSessionEvent,
): StudioBg3dPlacementTransitionResult {
  try {
    if (!isCanonicalState(state)) return failure(IDLE_STATE, "invalid-state");
    if (!isPlainRecord(event) || typeof event.type !== "string") {
      return failure(state, "invalid-input");
    }

    if (event.type === "begin") {
      if (state.phase !== "idle") return failure(state, "invalid-transition");
      const identity = readIdentity(event);
      const target = resolvePointerTarget(event);
      const yawDegrees = normalizeYawDegrees(event.yawDegrees ?? 0);
      const rotationStepDegrees = readRotationStepDegrees(event.rotationStepDegrees);
      if (!identity || !target || yawDegrees === null || rotationStepDegrees === null) {
        return failure(state, "invalid-input");
      }
      const placement = createPlacementPose({
        ...target,
        yawDegrees,
        axisLock: "none",
      });
      const preview: StudioBg3dPlacementPreviewState = Object.freeze({
        phase: "preview",
        identity,
        placement,
        anchorWorldPosition: target.worldPosition,
        rotationStepDegrees,
      });
      return success(preview);
    }

    if (state.phase === "idle") return failure(state, "invalid-transition");
    const tokenFailure = readActiveToken(state, event.placementToken);
    if (tokenFailure) return failure(state, tokenFailure);
    if (state.phase !== "preview") return failure(state, "invalid-transition");

    if (event.type === "pointer-move") {
      if (typeof event.shiftKey !== "boolean") return failure(state, "invalid-input");
      const target = resolvePointerTarget(event);
      if (!target) return failure(state, "invalid-input");
      const locked = resolveAxisLockedPosition(
        state.anchorWorldPosition,
        target.worldPosition,
        state.placement.axisLock,
        event.shiftKey,
      );
      const preview: StudioBg3dPlacementPreviewState = Object.freeze({
        ...state,
        placement: createPlacementPose({
          ...target,
          worldPosition: locked.position,
          yawDegrees: state.placement.yawDegrees,
          axisLock: locked.axisLock,
        }),
      });
      return success(preview);
    }

    if (event.type === "rotate") {
      if (event.direction !== "clockwise" && event.direction !== "counter-clockwise") {
        return failure(state, "invalid-input");
      }
      const direction = event.direction === "clockwise" ? 1 : -1;
      const yawDegrees = normalizeYawDegrees(
        state.placement.yawDegrees + direction * state.rotationStepDegrees,
      );
      if (yawDegrees === null) return failure(state, "invalid-input");
      const preview: StudioBg3dPlacementPreviewState = Object.freeze({
        ...state,
        placement: createPlacementPose({ ...state.placement, yawDegrees }),
      });
      return success(preview);
    }

    if (event.type === "escape") {
      const cancelled: StudioBg3dPlacementCancelledState = Object.freeze({
        phase: "cancelled",
        identity: state.identity,
      });
      return success(cancelled);
    }

    if (event.type === "click-commit") {
      const committed: StudioBg3dPlacementCommittedState = Object.freeze({
        phase: "committed",
        identity: state.identity,
        placement: state.placement,
      });
      const commitPlan: StudioBg3dPlacementCommitPlan = Object.freeze({
        kind: "studio-bg3d-model-placement",
        ...state.identity,
        placement: state.placement,
      });
      return success(committed, commitPlan);
    }

    return failure(state, "invalid-input");
  } catch {
    return failure(isCanonicalState(state) ? state : IDLE_STATE, "invalid-input");
  }
}
