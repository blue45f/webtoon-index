/**
 * Renderer-neutral Camera vNext orientation helpers.
 *
 * A persisted camera stores an up reference instead of an engine quaternion. Three.js projects
 * that reference onto the image plane when it performs lookAt(), which keeps the document portable
 * while still representing Dutch roll. All public helpers are finite, deterministic, and bounded.
 */

export type StudioBg3dCameraOrientationVec3 = readonly [number, number, number];

export interface StudioBg3dCameraOrientationLike {
  readonly position: StudioBg3dCameraOrientationVec3;
  readonly target: StudioBg3dCameraOrientationVec3;
  readonly up?: StudioBg3dCameraOrientationVec3;
}

export const STUDIO_BG3D_CAMERA_DEFAULT_NEAR_CLIP = 0.1;
export const STUDIO_BG3D_CAMERA_MIN_NEAR_CLIP = 0.01;
export const STUDIO_BG3D_CAMERA_MAX_NEAR_CLIP = 50;

/** Bounded depth/orbit limits derived from the authored camera instead of a small fixed scene. */
export function resolveStudioBg3dCameraDistanceLimits(
  position: StudioBg3dCameraOrientationVec3,
  target: StudioBg3dCameraOrientationVec3,
) {
  const distance = Math.hypot(
    position[0] - target[0],
    position[1] - target[1],
    position[2] - target[2],
  );
  return Object.freeze({
    farClip: Math.min(20_000, Math.max(200, distance * 8)),
    maxOrbitDistance: Math.min(10_000, Math.max(60, distance * 4)),
  });
}

export const STUDIO_BG3D_CAMERA_DEFAULT_UP = Object.freeze(
  [0, 1, 0] as const,
) satisfies StudioBg3dCameraOrientationVec3;
export const STUDIO_BG3D_CAMERA_MIN_DUTCH_ROLL_DEGREES = -180;
export const STUDIO_BG3D_CAMERA_MAX_DUTCH_ROLL_DEGREES = 180;

const MIN_VECTOR_LENGTH = 1e-6;
const UNIT_TOLERANCE = 1e-6;
const PARALLEL_DOT_LIMIT = 0.999_999;
const MAX_INPUT_COMPONENT = 10_000;
const CANONICAL_DECIMALS = 14;

function finiteVec3(value: unknown): StudioBg3dCameraOrientationVec3 | null {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((component) => (
      typeof component !== "number" ||
      !Number.isFinite(component) ||
      Math.abs(component) > MAX_INPUT_COMPONENT
    ))
  ) {
    return null;
  }
  return value as unknown as StudioBg3dCameraOrientationVec3;
}

function dot(
  left: StudioBg3dCameraOrientationVec3,
  right: StudioBg3dCameraOrientationVec3,
): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(
  left: StudioBg3dCameraOrientationVec3,
  right: StudioBg3dCameraOrientationVec3,
): StudioBg3dCameraOrientationVec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function canonicalComponent(value: number): number {
  if (Math.abs(value) < 10 ** -CANONICAL_DECIMALS) return 0;
  return Number(value.toFixed(CANONICAL_DECIMALS));
}

function normalize(
  value: StudioBg3dCameraOrientationVec3,
): StudioBg3dCameraOrientationVec3 | null {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (!Number.isFinite(length) || length < MIN_VECTOR_LENGTH) return null;
  if (Math.abs(length - 1) <= 1e-12 && !value.some((component) => Object.is(component, -0))) {
    return value;
  }
  return [
    canonicalComponent(value[0] / length),
    canonicalComponent(value[1] / length),
    canonicalComponent(value[2] / length),
  ];
}

function readForward(
  camera: Pick<StudioBg3dCameraOrientationLike, "position" | "target">,
): StudioBg3dCameraOrientationVec3 | null {
  const position = finiteVec3(camera.position);
  const target = finiteVec3(camera.target);
  if (!position || !target) return null;
  return normalize([
    target[0] - position[0],
    target[1] - position[1],
    target[2] - position[2],
  ]);
}

function projectOntoImagePlane(
  up: StudioBg3dCameraOrientationVec3,
  forward: StudioBg3dCameraOrientationVec3,
): StudioBg3dCameraOrientationVec3 | null {
  const alongForward = dot(up, forward);
  return normalize([
    up[0] - forward[0] * alongForward,
    up[1] - forward[1] * alongForward,
    up[2] - forward[2] * alongForward,
  ]);
}

function referenceUp(
  forward: StudioBg3dCameraOrientationVec3,
): StudioBg3dCameraOrientationVec3 {
  return projectOntoImagePlane(STUDIO_BG3D_CAMERA_DEFAULT_UP, forward)
    ?? projectOntoImagePlane([0, 0, 1], forward)
    ?? projectOntoImagePlane([1, 0, 0], forward)
    ?? STUDIO_BG3D_CAMERA_DEFAULT_UP;
}

export function isStudioBg3dCameraNearClip(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= STUDIO_BG3D_CAMERA_MIN_NEAR_CLIP &&
    value <= STUDIO_BG3D_CAMERA_MAX_NEAR_CLIP
  );
}

/** Returns the runtime default for an absent legacy value, never a lossy clamp. */
export function resolveStudioBg3dCameraNearClip(value: unknown): number {
  return isStudioBg3dCameraNearClip(value)
    ? value
    : STUDIO_BG3D_CAMERA_DEFAULT_NEAR_CLIP;
}

/**
 * Produces a canonical unit up reference. This intentionally does not project against a view ray:
 * partial shot overrides may carry `up` without also overriding position/target.
 */
export function normalizeStudioBg3dCameraUpVector(
  value: unknown,
  fallback: StudioBg3dCameraOrientationVec3 = STUDIO_BG3D_CAMERA_DEFAULT_UP,
): StudioBg3dCameraOrientationVec3 {
  return normalize(finiteVec3(value) ?? fallback)
    ?? normalize(fallback)
    ?? STUDIO_BG3D_CAMERA_DEFAULT_UP;
}

export function isStudioBg3dCameraUpVectorValid(
  value: unknown,
  camera: Pick<StudioBg3dCameraOrientationLike, "position" | "target">,
): value is StudioBg3dCameraOrientationVec3 {
  const up = finiteVec3(value);
  const forward = readForward(camera);
  if (!up || !forward) return false;
  const length = Math.hypot(up[0], up[1], up[2]);
  if (!Number.isFinite(length) || Math.abs(length - 1) > UNIT_TOLERANCE) return false;
  return Math.abs(dot([up[0] / length, up[1] / length, up[2] / length], forward))
    < PARALLEL_DOT_LIMIT;
}

/**
 * Resolves an application-safe up reference. Legacy cameras with no up vector use world Y; a
 * vertical view receives a deterministic Z/X fallback rather than Three.js' singular lookAt case.
 */
export function resolveStudioBg3dCameraUpVector(
  camera: StudioBg3dCameraOrientationLike,
): StudioBg3dCameraOrientationVec3 {
  const forward = readForward(camera);
  if (!forward) return STUDIO_BG3D_CAMERA_DEFAULT_UP;
  const normalizedUp = normalizeStudioBg3dCameraUpVector(camera.up);
  return Math.abs(dot(normalizedUp, forward)) < PARALLEL_DOT_LIMIT
    ? normalizedUp
    : referenceUp(forward);
}

/** Creates the up vector for an absolute Dutch-roll angle around the current view ray. */
export function createStudioBg3dCameraUpForDutchRoll(
  camera: Pick<StudioBg3dCameraOrientationLike, "position" | "target">,
  degrees: number,
): StudioBg3dCameraOrientationVec3 | null {
  const forward = readForward(camera);
  if (
    !forward ||
    !Number.isFinite(degrees) ||
    degrees < STUDIO_BG3D_CAMERA_MIN_DUTCH_ROLL_DEGREES ||
    degrees > STUDIO_BG3D_CAMERA_MAX_DUTCH_ROLL_DEGREES
  ) {
    return null;
  }
  const baseUp = referenceUp(forward);
  const radians = degrees * Math.PI / 180;
  const sine = Math.sin(radians);
  const cosine = Math.cos(radians);
  const perpendicular = cross(forward, baseUp);
  return normalize([
    baseUp[0] * cosine + perpendicular[0] * sine,
    baseUp[1] * cosine + perpendicular[1] * sine,
    baseUp[2] * cosine + perpendicular[2] * sine,
  ]);
}

/** Reads the signed Dutch-roll angle represented by a camera's up reference. */
export function readStudioBg3dCameraDutchRollDegrees(
  camera: StudioBg3dCameraOrientationLike,
): number {
  const forward = readForward(camera);
  if (!forward) return 0;
  const baseUp = referenceUp(forward);
  const currentUp = projectOntoImagePlane(
    resolveStudioBg3dCameraUpVector(camera),
    forward,
  );
  if (!currentUp) return 0;
  const sine = dot(forward, cross(baseUp, currentUp));
  const cosine = dot(baseUp, currentUp);
  const degrees = Math.atan2(sine, cosine) * 180 / Math.PI;
  return Number.isFinite(degrees) ? degrees : 0;
}
