import { resolveStudioBg3dCameraUpVector } from "./studio-bg3d-camera-orientation";

import type { StudioBg3dCameraSettings } from "./studio-bg3d-scene-document";

export type StudioBg3dVanishingAxis = "world-x" | "world-y" | "world-z";

export interface StudioBg3dVanishingPoint {
  readonly axis: StudioBg3dVanishingAxis;
  readonly x: number;
  readonly y: number;
}

export interface StudioBg3dCanvasPlacement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
}

const WORLD_AXIS_DIRECTIONS: ReadonlyArray<{
  readonly axis: StudioBg3dVanishingAxis;
  readonly direction: readonly [number, number, number];
}> = Object.freeze([
  { axis: "world-x", direction: [1, 0, 0] },
  { axis: "world-y", direction: [0, 1, 0] },
  { axis: "world-z", direction: [0, 0, 1] },
]);

const MIN_CAMERA_DIRECTION_LENGTH_SQ = 1e-10;
const MIN_CLIP_W = 1e-7;
const MAX_NORMALIZED_VANISHING_DISTANCE = 1e5;

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finiteVec3(value: readonly number[]): value is readonly [number, number, number] {
  return value.length >= 3 && value.slice(0, 3).every(Number.isFinite);
}

type Vec3 = readonly [number, number, number];

function subtract(left: Vec3, right: Vec3): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function dot(left: Vec3, right: Vec3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left: Vec3, right: Vec3): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalize(value: Vec3): Vec3 | null {
  const lengthSquared = dot(value, value);
  if (!Number.isFinite(lengthSquared) || lengthSquared < MIN_CAMERA_DIRECTION_LENGTH_SQ) return null;
  const inverseLength = 1 / Math.sqrt(lengthSquared);
  return [value[0] * inverseLength, value[1] * inverseLength, value[2] * inverseLength];
}

/**
 * Projects the three canonical world directions through the same perspective and setViewOffset
 * convention used by the editor, without importing a renderer into Studio's eager bundle.
 * Directions parallel to the image plane have a point at mathematical infinity and are omitted,
 * so a front camera produces a useful one-point guide.
 */
export function deriveStudioBg3dVanishingPoints(
  cameraSettings: StudioBg3dCameraSettings,
  sourceWidth: number,
  sourceHeight: number,
): readonly StudioBg3dVanishingPoint[] {
  if (
    cameraSettings.projection === "orthographic" ||
    !finitePositive(sourceWidth) ||
    !finitePositive(sourceHeight) ||
    !finiteVec3(cameraSettings.position) ||
    !finiteVec3(cameraSettings.target) ||
    !Number.isFinite(cameraSettings.fovDegrees) ||
    !finitePositive(cameraSettings.zoom)
  ) {
    return [];
  }

  const forward = normalize(subtract(cameraSettings.target, cameraSettings.position));
  if (!forward) return [];
  // Use the same persisted up reference as the live Three camera so capture guides rotate with a
  // Dutch-angle render rather than silently reverting to world Y.
  const persistedUp = resolveStudioBg3dCameraUpVector(cameraSettings);
  const right = normalize(cross(forward, persistedUp));
  if (!right) return [];
  const cameraUp = normalize(cross(right, forward));
  if (!cameraUp) return [];
  const aspect = sourceWidth / sourceHeight;
  const fovDegrees = Math.min(179, Math.max(1, cameraSettings.fovDegrees));
  const tangentHalfFov = Math.tan((fovDegrees * Math.PI) / 360) / cameraSettings.zoom;
  if (!finitePositive(tangentHalfFov)) return [];
  const lensShift = cameraSettings.lensShift;
  const shiftX = lensShift && Number.isFinite(lensShift[0]) ? lensShift[0] : 0;
  const shiftY = lensShift && Number.isFinite(lensShift[1]) ? lensShift[1] : 0;
  const result: StudioBg3dVanishingPoint[] = [];
  for (const entry of WORLD_AXIS_DIRECTIONS) {
    const depth = dot(entry.direction, forward);
    if (!Number.isFinite(depth) || Math.abs(depth) < MIN_CLIP_W) continue;
    const ndcX = dot(entry.direction, right) / (depth * tangentHalfFov * aspect) - 2 * shiftX;
    const ndcY = dot(entry.direction, cameraUp) / (depth * tangentHalfFov) + 2 * shiftY;
    if (
      !Number.isFinite(ndcX) ||
      !Number.isFinite(ndcY) ||
      Math.abs(ndcX) > MAX_NORMALIZED_VANISHING_DISTANCE ||
      Math.abs(ndcY) > MAX_NORMALIZED_VANISHING_DISTANCE
    ) {
      continue;
    }
    result.push({
      axis: entry.axis,
      x: (ndcX * 0.5 + 0.5) * sourceWidth,
      y: (-ndcY * 0.5 + 0.5) * sourceHeight,
    });
  }
  return result;
}

/** Maps capture-pixel guide coordinates onto an unrotated Studio image placement. */
export function mapStudioBg3dVanishingPointsToCanvas(
  points: readonly StudioBg3dVanishingPoint[],
  placement: StudioBg3dCanvasPlacement,
): readonly StudioBg3dVanishingPoint[] {
  if (
    !finitePositive(placement.width) ||
    !finitePositive(placement.height) ||
    !finitePositive(placement.sourceWidth) ||
    !finitePositive(placement.sourceHeight) ||
    !Number.isFinite(placement.x) ||
    !Number.isFinite(placement.y)
  ) {
    return [];
  }
  const scaleX = placement.width / placement.sourceWidth;
  const scaleY = placement.height / placement.sourceHeight;
  return points.flatMap((point) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return [];
    return [{
      axis: point.axis,
      x: placement.x + point.x * scaleX,
      y: placement.y + point.y * scaleY,
    }];
  });
}
