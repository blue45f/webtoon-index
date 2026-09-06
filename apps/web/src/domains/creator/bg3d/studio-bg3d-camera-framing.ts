/**
 * Renderer-neutral camera framing math for Studio's 3D background editor.
 *
 * The live R3F controller owns camera mutation. This module only validates one immutable camera
 * snapshot and returns a complete replacement view, so failed fit calculations cannot partially
 * move a mounted Three camera.
 */

import {
  isStudioBg3dCameraNearClip,
  isStudioBg3dCameraUpVectorValid,
  resolveStudioBg3dCameraNearClip,
} from "./studio-bg3d-camera-orientation";

import type { StudioBg3dCameraSettings } from "./studio-bg3d-scene-document";

export type StudioBg3dCameraFramingVec3 = readonly [number, number, number];

export interface StudioBg3dCameraFramingBounds {
  readonly min: StudioBg3dCameraFramingVec3;
  readonly max: StudioBg3dCameraFramingVec3;
}

export interface StudioBg3dOrthographicFrustumAtZoomOne {
  readonly width: number;
  readonly height: number;
}

export interface FitStudioBg3dCameraToBoundsInput {
  readonly camera: StudioBg3dCameraSettings;
  readonly bounds: StudioBg3dCameraFramingBounds;
  /** CSS-pixel viewport width / height. */
  readonly viewportAspect: number;
  /** Required only for an orthographic camera. Values are measured before camera.zoom. */
  readonly orthographicFrustumAtZoomOne?: StudioBg3dOrthographicFrustumAtZoomOne;
  /** Multiplicative subject margin. One means the bounding sphere may touch the limiting edge. */
  readonly padding?: number;
  /** Degenerate point-like bounds frame as a subject with at least this world-space radius. */
  readonly minimumRadius?: number;
  readonly minDistance?: number;
  readonly maxDistance?: number;
  readonly minZoom?: number;
  readonly maxZoom?: number;
}

export interface ResolveStudioBg3dOrthographicZoomInput {
  readonly currentZoom: number;
  /** Matches the current viewport API: values below one zoom in, values above one zoom out. */
  readonly distanceFactor: number;
  readonly minZoom?: number;
  readonly maxZoom?: number;
}

export const STUDIO_BG3D_CAMERA_MIN_ZOOM = 0.1;
export const STUDIO_BG3D_CAMERA_MAX_ZOOM = 100;
export const STUDIO_BG3D_CAMERA_MAX_WORLD_COORDINATE = 10_000;

const MIN_FOV_DEGREES = 10;
const MAX_FOV_DEGREES = 120;
const MIN_VIEWPORT_ASPECT = 0.1;
const MAX_VIEWPORT_ASPECT = 10;
const MIN_PADDING = 1;
const MAX_PADDING = 4;
const DEFAULT_MINIMUM_RADIUS = 0.25;
const MIN_MINIMUM_RADIUS = 0.001;
const MAX_MINIMUM_RADIUS = 1_000;
const DEFAULT_MIN_DISTANCE = 0.01;
const DEFAULT_MAX_DISTANCE = 10_000;
const MAX_ORTHOGRAPHIC_FRUSTUM_SPAN = 100_000;
const MIN_DIRECTION_LENGTH = 1e-6;
const MIN_LENS_MARGIN = 1e-6;
const MIN_ZOOM_FACTOR = 0.05;
const MAX_ZOOM_FACTOR = 20;

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function finiteVec3InWorld(value: unknown): value is StudioBg3dCameraFramingVec3 {
  return Array.isArray(value) && value.length === 3 && value.every((component) => (
    finiteInRange(
      component,
      -STUDIO_BG3D_CAMERA_MAX_WORLD_COORDINATE,
      STUDIO_BG3D_CAMERA_MAX_WORLD_COORDINATE,
    )
  ));
}

function readBounds(bounds: StudioBg3dCameraFramingBounds): {
  readonly center: StudioBg3dCameraFramingVec3;
  readonly radius: number;
} | null {
  if (
    typeof bounds !== "object" || bounds === null ||
    !finiteVec3InWorld(bounds.min) || !finiteVec3InWorld(bounds.max)
  ) return null;
  for (let index = 0; index < 3; index += 1) {
    if (bounds.min[index] > bounds.max[index]) return null;
  }
  const center: StudioBg3dCameraFramingVec3 = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  const radius = Math.hypot(
    (bounds.max[0] - bounds.min[0]) / 2,
    (bounds.max[1] - bounds.min[1]) / 2,
    (bounds.max[2] - bounds.min[2]) / 2,
  );
  if (!Number.isFinite(radius)) return null;
  return { center, radius };
}

function readLensMargins(
  lensShift: StudioBg3dCameraSettings["lensShift"],
): { readonly horizontal: number; readonly vertical: number } | null {
  if (lensShift === undefined) return { horizontal: 1, vertical: 1 };
  if (
    !Array.isArray(lensShift) || lensShift.length !== 2 ||
    !finiteInRange(lensShift[0], -2, 2) || !finiteInRange(lensShift[1], -2, 2)
  ) return null;
  // setViewOffset shifts the optical centre by two NDC units per normalized shift unit. A target
  // centred on camera.target has no symmetric fit region once either shift reaches half a frame.
  const horizontal = 1 - Math.abs(lensShift[0]) * 2;
  const vertical = 1 - Math.abs(lensShift[1]) * 2;
  return horizontal > MIN_LENS_MARGIN && vertical > MIN_LENS_MARGIN
    ? { horizontal, vertical }
    : null;
}

function readDirection(
  position: StudioBg3dCameraFramingVec3,
  target: StudioBg3dCameraFramingVec3,
): { readonly unit: StudioBg3dCameraFramingVec3; readonly distance: number } | null {
  const x = position[0] - target[0];
  const y = position[1] - target[1];
  const z = position[2] - target[2];
  const distance = Math.hypot(x, y, z);
  if (!Number.isFinite(distance) || distance < MIN_DIRECTION_LENGTH) return null;
  return { unit: [x / distance, y / distance, z / distance], distance };
}

function positionedAlongDirection(
  center: StudioBg3dCameraFramingVec3,
  direction: StudioBg3dCameraFramingVec3,
  distance: number,
): StudioBg3dCameraFramingVec3 | null {
  const position: StudioBg3dCameraFramingVec3 = [
    center[0] + direction[0] * distance,
    center[1] + direction[1] * distance,
    center[2] + direction[2] * distance,
  ];
  return finiteVec3InWorld(position) ? position : null;
}

function freezeView(
  camera: StudioBg3dCameraSettings,
  position: StudioBg3dCameraFramingVec3,
  target: StudioBg3dCameraFramingVec3,
  zoom: number,
): StudioBg3dCameraSettings {
  const lensShift = camera.lensShift
    ? Object.freeze([camera.lensShift[0], camera.lensShift[1]] as const)
    : undefined;
  const up = camera.up
    ? Object.freeze([camera.up[0], camera.up[1], camera.up[2]] as const)
    : undefined;
  return Object.freeze({
    position: Object.freeze([...position] as [number, number, number]),
    target: Object.freeze([...target] as [number, number, number]),
    fovDegrees: camera.fovDegrees,
    projection: camera.projection === "orthographic" ? "orthographic" : "perspective",
    zoom,
    ...(lensShift ? { lensShift } : {}),
    ...(camera.nearClip !== undefined ? { nearClip: camera.nearClip } : {}),
    ...(up ? { up } : {}),
  });
}

function readZoomBounds(
  minZoomValue: number | undefined,
  maxZoomValue: number | undefined,
): { readonly minZoom: number; readonly maxZoom: number } | null {
  const minZoom = minZoomValue ?? STUDIO_BG3D_CAMERA_MIN_ZOOM;
  const maxZoom = maxZoomValue ?? STUDIO_BG3D_CAMERA_MAX_ZOOM;
  if (
    !finiteInRange(minZoom, STUDIO_BG3D_CAMERA_MIN_ZOOM, STUDIO_BG3D_CAMERA_MAX_ZOOM) ||
    !finiteInRange(maxZoom, STUDIO_BG3D_CAMERA_MIN_ZOOM, STUDIO_BG3D_CAMERA_MAX_ZOOM) ||
    minZoom > maxZoom
  ) return null;
  return { minZoom, maxZoom };
}

/**
 * Converts the distance-factor convention used by the current perspective dolly buttons into an
 * orthographic camera.zoom value. Invalid snapshots fail closed; valid results are bounded.
 */
export function resolveStudioBg3dOrthographicZoom(
  input: ResolveStudioBg3dOrthographicZoomInput,
): number | null {
  if (typeof input !== "object" || input === null) return null;
  const zoomBounds = readZoomBounds(input.minZoom, input.maxZoom);
  if (
    !zoomBounds ||
    !finiteInRange(input.currentZoom, zoomBounds.minZoom, zoomBounds.maxZoom) ||
    !finiteInRange(input.distanceFactor, MIN_ZOOM_FACTOR, MAX_ZOOM_FACTOR)
  ) return null;
  const zoom = input.currentZoom / input.distanceFactor;
  if (!Number.isFinite(zoom) || zoom <= 0) return null;
  return Math.min(zoomBounds.maxZoom, Math.max(zoomBounds.minZoom, zoom));
}

/**
 * Fits one world-space AABB without changing view direction, projection, FOV, or lens shift.
 * A bounding sphere is used deliberately: it is conservative for an AABB but remains correct for
 * any persisted camera roll/up-vector orientation.
 */
export function fitStudioBg3dCameraToBounds(
  input: FitStudioBg3dCameraToBoundsInput,
): StudioBg3dCameraSettings | null {
  if (typeof input !== "object" || input === null) return null;
  const camera = input.camera;
  if (
    typeof camera !== "object" || camera === null ||
    !finiteVec3InWorld(camera.position) || !finiteVec3InWorld(camera.target) ||
    !finiteInRange(camera.fovDegrees, MIN_FOV_DEGREES, MAX_FOV_DEGREES) ||
    (camera.projection !== undefined &&
      camera.projection !== "perspective" && camera.projection !== "orthographic") ||
    !finiteInRange(
      camera.zoom ?? 1,
      STUDIO_BG3D_CAMERA_MIN_ZOOM,
      STUDIO_BG3D_CAMERA_MAX_ZOOM,
    ) ||
    (camera.nearClip !== undefined && !isStudioBg3dCameraNearClip(camera.nearClip)) ||
    (camera.up !== undefined && !isStudioBg3dCameraUpVectorValid(camera.up, camera)) ||
    !finiteInRange(input.viewportAspect, MIN_VIEWPORT_ASPECT, MAX_VIEWPORT_ASPECT)
  ) return null;

  const bounds = readBounds(input.bounds);
  const direction = readDirection(camera.position, camera.target);
  const lensMargins = readLensMargins(camera.lensShift);
  const zoomBounds = readZoomBounds(input.minZoom, input.maxZoom);
  const padding = input.padding ?? 1.15;
  const minimumRadius = input.minimumRadius ?? DEFAULT_MINIMUM_RADIUS;
  const minDistance = input.minDistance ?? DEFAULT_MIN_DISTANCE;
  const maxDistance = input.maxDistance ?? DEFAULT_MAX_DISTANCE;
  if (
    !bounds || !direction || !lensMargins || !zoomBounds ||
    !finiteInRange(padding, MIN_PADDING, MAX_PADDING) ||
    !finiteInRange(minimumRadius, MIN_MINIMUM_RADIUS, MAX_MINIMUM_RADIUS) ||
    !finiteInRange(minDistance, DEFAULT_MIN_DISTANCE, DEFAULT_MAX_DISTANCE) ||
    !finiteInRange(maxDistance, DEFAULT_MIN_DISTANCE, DEFAULT_MAX_DISTANCE) ||
    minDistance > maxDistance
  ) return null;

  const paddedRadius = Math.max(bounds.radius, minimumRadius) * padding;
  if (!Number.isFinite(paddedRadius) || paddedRadius <= 0) return null;
  const nearSafeDistance = resolveStudioBg3dCameraNearClip(camera.nearClip) + paddedRadius;
  if (!Number.isFinite(nearSafeDistance) || nearSafeDistance > maxDistance) return null;
  const projection = camera.projection === "orthographic" ? "orthographic" : "perspective";
  const currentZoom = camera.zoom ?? 1;

  if (projection === "perspective") {
    const verticalTangent = Math.tan((camera.fovDegrees * Math.PI) / 360) / currentZoom;
    const limitingTangent = Math.min(
      verticalTangent * lensMargins.vertical,
      verticalTangent * input.viewportAspect * lensMargins.horizontal,
    );
    const limitingHalfAngle = Math.atan(limitingTangent);
    const sine = Math.sin(limitingHalfAngle);
    if (!Number.isFinite(sine) || sine <= 0) return null;
    const requiredDistance = Math.max(paddedRadius / sine, nearSafeDistance);
    if (!Number.isFinite(requiredDistance) || requiredDistance > maxDistance) return null;
    const distance = Math.max(minDistance, requiredDistance);
    const position = positionedAlongDirection(bounds.center, direction.unit, distance);
    return position
      ? freezeView(camera, position, bounds.center, currentZoom)
      : null;
  }

  const frustum = input.orthographicFrustumAtZoomOne;
  if (
    typeof frustum !== "object" || frustum === null ||
    !finiteInRange(frustum.width, MIN_DIRECTION_LENGTH, MAX_ORTHOGRAPHIC_FRUSTUM_SPAN) ||
    !finiteInRange(frustum.height, MIN_DIRECTION_LENGTH, MAX_ORTHOGRAPHIC_FRUSTUM_SPAN)
  ) return null;
  const requiredZoom = Math.min(
    (frustum.width * lensMargins.horizontal) / (paddedRadius * 2),
    (frustum.height * lensMargins.vertical) / (paddedRadius * 2),
  );
  // Zooming farther out than the supported minimum is the only bounded case that cannot fit.
  if (!Number.isFinite(requiredZoom) || requiredZoom < zoomBounds.minZoom) return null;
  const zoom = Math.min(requiredZoom, zoomBounds.maxZoom);
  const distance = Math.max(direction.distance, minDistance, nearSafeDistance);
  if (!Number.isFinite(distance) || distance > maxDistance) return null;
  const position = positionedAlongDirection(bounds.center, direction.unit, distance);
  return position ? freezeView(camera, position, bounds.center, zoom) : null;
}
