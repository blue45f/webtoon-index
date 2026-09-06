import * as THREE from "three";

import { resolveStudioBg3dOrthographicZoom } from "./studio-bg3d-camera-framing";
import {
  isStudioBg3dCameraNearClip,
  isStudioBg3dCameraUpVectorValid,
  resolveStudioBg3dCameraNearClip,
  resolveStudioBg3dCameraUpVector,
} from "./studio-bg3d-camera-orientation";
import { waitForStudioBg3dCapturePhase } from "./studio-bg3d-capture-adapter";

import type { StudioBg3dCameraSettings } from "./studio-bg3d-scene-document";

type OrbitLike = { target?: THREE.Vector3; update?: () => void } | null;

export interface BgViewportApi {
  /** Applies a projection-aware zoom command and reports whether a complete view was published. */
  zoomBy(factor: number): boolean;
  applyPreset(presetId: string): boolean;
  /** Returns false when React has not mounted the requested projection camera yet. */
  applyView(view: StudioBg3dCameraSettings): boolean;
  readView(): StudioBg3dCameraSettings;
  readFramingState(): StudioBg3dViewportFramingState | null;
  focusOn(position: [number, number, number]): void;
}

export interface StudioBg3dViewportFramingState {
  readonly view: StudioBg3dCameraSettings;
  readonly viewportAspect: number;
  readonly orthographicFrustumAtZoomOne?: {
    readonly width: number;
    readonly height: number;
  };
}

export interface StudioBg3dWorldBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface StudioBg3dSurfaceIntersectionLike {
  readonly object: THREE.Object3D;
  readonly point: THREE.Vector3;
  readonly normal?: THREE.Vector3;
  readonly face?: { readonly normal: THREE.Vector3 } | null;
  readonly instanceId?: number;
}

export interface StudioBg3dWorldSurfaceHit {
  readonly point: readonly [number, number, number];
  readonly normal: readonly [number, number, number];
}

const STUDIO_BG3D_CAMERA_APPLICATION_MAX_COORDINATE = 10_000;
const STUDIO_BG3D_CAMERA_APPLICATION_MIN_NORMAL_LENGTH = 1e-6;
const STUDIO_BG3D_CAMERA_APPLICATION_MIN_VIEW_DISTANCE = 0.01;
const STUDIO_BG3D_VIEWPORT_CONTROL_SELECTOR = '[data-bg3d-viewport-control="true"]';

/**
 * R3F listens for misses on the viewport event source, which also contains our floating controls.
 * A toolbar click is not a scene miss and must never clear the active selection before a camera or
 * surface command runs. Keep this structural so the helper stays testable without a DOM runtime.
 */
export function isStudioBg3dViewportControlTarget(target: EventTarget | null): boolean {
  const candidate = target as { closest?: (selector: string) => unknown } | null;
  return typeof candidate?.closest === "function" &&
    candidate.closest(STUDIO_BG3D_VIEWPORT_CONTROL_SELECTOR) !== null;
}

function finiteWorldVector(vector: THREE.Vector3): boolean {
  return vector.toArray().every((component) => (
    Number.isFinite(component) &&
    Math.abs(component) <= STUDIO_BG3D_CAMERA_APPLICATION_MAX_COORDINATE
  ));
}

function finiteCameraTuple(value: unknown): value is readonly [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((component) => (
    typeof component === "number" &&
    Number.isFinite(component) &&
    Math.abs(component) <= STUDIO_BG3D_CAMERA_APPLICATION_MAX_COORDINATE
  ));
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function validStudioBg3dCameraView(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  view: StudioBg3dCameraSettings,
): boolean {
  if (
    typeof view !== "object" || view === null ||
    !finiteCameraTuple(view.position) ||
    !finiteCameraTuple(view.target) ||
    Math.hypot(
      view.position[0] - view.target[0],
      view.position[1] - view.target[1],
      view.position[2] - view.target[2],
    ) < STUDIO_BG3D_CAMERA_APPLICATION_MIN_VIEW_DISTANCE ||
    !finiteInRange(view.fovDegrees, 10, 120) ||
    !finiteInRange(view.zoom ?? 1, 0.1, 100) ||
    (view.projection !== undefined &&
      view.projection !== "perspective" && view.projection !== "orthographic") ||
    (view.lensShift !== undefined && (
      !Array.isArray(view.lensShift) ||
      view.lensShift.length !== 2 ||
      !finiteInRange(view.lensShift[0], -2, 2) ||
      !finiteInRange(view.lensShift[1], -2, 2)
    )) ||
    (view.nearClip !== undefined && !isStudioBg3dCameraNearClip(view.nearClip)) ||
    (view.up !== undefined && !isStudioBg3dCameraUpVectorValid(view.up, view))
  ) {
    return false;
  }
  const nearClip = resolveStudioBg3dCameraNearClip(view.nearClip);
  return Number.isFinite(camera.far) && nearClip < camera.far;
}

/** Reads the precise rendered world AABB. Empty, detached, and non-finite geometry fails closed. */
export function readStudioBg3dObjectWorldBounds(
  object: THREE.Object3D | null | undefined,
): StudioBg3dWorldBounds | null {
  if (!object?.isObject3D) return null;
  object.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(object, true);
  if (bounds.isEmpty() || !finiteWorldVector(bounds.min) || !finiteWorldVector(bounds.max)) {
    return null;
  }
  return Object.freeze({
    min: Object.freeze(bounds.min.toArray() as [number, number, number]),
    max: Object.freeze(bounds.max.toArray() as [number, number, number]),
  });
}

/**
 * Converts a Three raycast's geometry-local normal into a normalized world normal. InstancedMesh
 * intersections need their instance transform in addition to object.matrixWorld.
 */
export function readStudioBg3dWorldSurfaceHit(
  intersection: StudioBg3dSurfaceIntersectionLike,
): StudioBg3dWorldSurfaceHit | null {
  const object = intersection?.object;
  const point = intersection?.point;
  const sourceNormal = intersection?.normal ?? intersection?.face?.normal;
  if (!object?.isObject3D || !point?.isVector3 || !sourceNormal?.isVector3) return null;
  if (!finiteWorldVector(point) || !sourceNormal.toArray().every(Number.isFinite)) return null;

  object.updateWorldMatrix(true, false);
  const worldMatrix = object.matrixWorld.clone();
  const instanced = object as THREE.InstancedMesh;
  if (instanced.isInstancedMesh) {
    if (
      !Number.isSafeInteger(intersection.instanceId) ||
      intersection.instanceId! < 0 ||
      intersection.instanceId! >= instanced.count
    ) return null;
    const instanceMatrix = new THREE.Matrix4();
    instanced.getMatrixAt(intersection.instanceId!, instanceMatrix);
    worldMatrix.multiply(instanceMatrix);
  }
  if (!worldMatrix.elements.every(Number.isFinite)) return null;
  const determinant = worldMatrix.determinant();
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;

  const normal = sourceNormal.clone().applyNormalMatrix(
    new THREE.Matrix3().getNormalMatrix(worldMatrix),
  );
  const normalLength = normal.length();
  if (!Number.isFinite(normalLength) || normalLength < STUDIO_BG3D_CAMERA_APPLICATION_MIN_NORMAL_LENGTH) {
    return null;
  }
  normal.multiplyScalar(1 / normalLength);
  if (!normal.toArray().every(Number.isFinite)) return null;
  return Object.freeze({
    point: Object.freeze(point.toArray() as [number, number, number]),
    normal: Object.freeze(normal.toArray() as [number, number, number]),
  });
}

/** Applies the existing distance-factor convention to the active Three projection. */
export function applyStudioBg3dProjectionAwareZoom(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  controls: OrbitLike,
  distanceFactor: number,
  fallbackTarget: readonly [number, number, number],
): boolean {
  if (!Number.isFinite(distanceFactor) || distanceFactor < 0.05 || distanceFactor > 20) {
    return false;
  }
  if (camera instanceof THREE.OrthographicCamera) {
    const zoom = resolveStudioBg3dOrthographicZoom({
      currentZoom: camera.zoom,
      distanceFactor,
    });
    if (zoom === null) return false;
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    controls?.update?.();
    return true;
  }

  const target = controls?.target ?? new THREE.Vector3(...fallbackTarget);
  if (!finiteWorldVector(target)) return false;
  const offset = camera.position.clone().sub(target);
  const distance = offset.length();
  if (!Number.isFinite(distance) || distance < 1e-6) return false;
  const nextDistance = THREE.MathUtils.clamp(distance * distanceFactor, 2, 60);
  offset.setLength(nextDistance);
  camera.position.copy(target).add(offset);
  camera.updateMatrixWorld();
  controls?.update?.();
  return finiteWorldVector(camera.position);
}

/** Applies every persisted composition field without replacing Three's live camera identity. */
export function applyStudioBg3dViewToThreeCamera(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  controls: OrbitLike,
  view: StudioBg3dCameraSettings,
): boolean {
  const projectionMatches = view.projection === "orthographic"
    ? camera instanceof THREE.OrthographicCamera
    : camera instanceof THREE.PerspectiveCamera;
  if (!projectionMatches || !validStudioBg3dCameraView(camera, view)) return false;

  if (camera instanceof THREE.PerspectiveCamera) camera.fov = view.fovDegrees;
  camera.zoom = view.zoom ?? 1;
  camera.near = resolveStudioBg3dCameraNearClip(view.nearClip);
  if (view.lensShift) {
    const [shiftX, shiftY] = view.lensShift;
    if (shiftX === 0 && shiftY === 0) camera.clearViewOffset();
    else camera.setViewOffset(1_000, 1_000, shiftX * 1_000, shiftY * 1_000, 1_000, 1_000);
  } else if (camera.view !== null) {
    camera.clearViewOffset();
  }
  camera.updateProjectionMatrix();
  camera.position.set(view.position[0], view.position[1], view.position[2]);
  const up = resolveStudioBg3dCameraUpVector(view);
  camera.up.set(up[0], up[1], up[2]);
  if (controls?.target) {
    controls.target.set(view.target[0], view.target[1], view.target[2]);
    controls.update?.();
  } else {
    camera.lookAt(view.target[0], view.target[1], view.target[2]);
  }
  camera.updateMatrixWorld();
  return true;
}

export interface ApplyStudioBg3dViewportAfterTransitionInput {
  readonly view: StudioBg3dCameraSettings;
  readonly previousApi: BgViewportApi | null;
  readonly requireReplacement: boolean;
  readonly readApi: () => BgViewportApi | null;
  readonly isActive: () => boolean;
  readonly waitForPaintFrame: () => Promise<void>;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

function studioBg3dViewportTransitionError(name: "AbortError" | "TimeoutError"): Error {
  const error = new Error(
    name === "AbortError"
      ? "3D 컷 카메라 전환을 취소했습니다."
      : "3D 컷 카메라 전환 준비 시간이 초과되었습니다.",
  );
  error.name = name;
  return error;
}

/**
 * A perspective/orthographic switch remounts R3F's default camera. Wait for that new viewport API
 * identity, then apply the complete persisted view only after React's camera props have painted.
 * Applying earlier can target the unmounted camera, while applying only before paint lets R3F reset
 * OrbitControls.target and overwrite the requested shot composition.
 */
export async function applyStudioBg3dViewportAfterTransition(
  input: ApplyStudioBg3dViewportAfterTransitionInput,
): Promise<BgViewportApi | null> {
  const timeoutMs = Math.max(250, Math.min(30_000, Math.floor(input.timeoutMs ?? 15_000)));
  const deadline = Date.now() + timeoutMs;
  if (input.signal?.aborted) throw studioBg3dViewportTransitionError("AbortError");

  await waitForStudioBg3dCapturePhase(input.waitForPaintFrame(), {
    ...(input.signal ? { signal: input.signal } : {}),
    timeoutMs,
  });

  let api = input.readApi();
  while (
    input.isActive()
    && (!api || (input.requireReplacement && api === input.previousApi))
  ) {
    if (input.signal?.aborted) throw studioBg3dViewportTransitionError("AbortError");
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw studioBg3dViewportTransitionError("TimeoutError");
    await waitForStudioBg3dCapturePhase(
      new Promise<void>((resolve) => globalThis.setTimeout(resolve, Math.min(16, remainingMs))),
      {
        ...(input.signal ? { signal: input.signal } : {}),
        timeoutMs: remainingMs,
      },
    );
    api = input.readApi();
  }
  if (!input.isActive() || !api) return null;
  if (!api.applyView(input.view)) return null;

  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw studioBg3dViewportTransitionError("TimeoutError");
  await waitForStudioBg3dCapturePhase(input.waitForPaintFrame(), {
    ...(input.signal ? { signal: input.signal } : {}),
    timeoutMs: remainingMs,
  });
  return input.isActive() ? api : null;
}
