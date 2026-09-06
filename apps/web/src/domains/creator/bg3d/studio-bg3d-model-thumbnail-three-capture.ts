/**
 * Isolated Three/WebGL view used by the model-thumbnail capture controller.
 *
 * This boundary never reparents the cache-owned root. It renders a structural clone that keeps
 * geometry/material/texture ownership with the model cache, and consequently never disposes those
 * shared resources. The caller still owns the editor-wide renderer lease: one handle represents
 * one queued thumbnail job and must be disposed after `captureAndStore` settles.
 */

import * as THREE from "three";

import {
  STUDIO_BG3D_MODEL_THUMBNAIL_HEIGHT,
  STUDIO_BG3D_MODEL_THUMBNAIL_MAX_DIMENSION,
  STUDIO_BG3D_MODEL_THUMBNAIL_MAX_PIXELS,
  STUDIO_BG3D_MODEL_THUMBNAIL_WIDTH,
} from "./studio-bg3d-model-thumbnail-data";
import { createStudioBg3dThreeWebglCaptureAdapter } from "./studio-bg3d-three-webgl-capture";

import type {
  StudioBg3dCaptureAdapter,
  StudioBg3dCapturedRaster,
  StudioBg3dCaptureRequest,
} from "./studio-bg3d-capture-adapter";

export const STUDIO_BG3D_MODEL_THUMBNAIL_CAMERA_FOV_DEGREES = 32;
export const STUDIO_BG3D_MODEL_THUMBNAIL_CAMERA_PADDING = 1.16;
const STUDIO_BG3D_MODEL_THUMBNAIL_MAX_WORLD_ABS = 1e12;

export type StudioBg3dModelThumbnailThreeCaptureErrorCode =
  | "aborted"
  | "clone-failed"
  | "disposed"
  | "invalid-bounds"
  | "invalid-dimensions"
  | "invalid-input"
  | "stale";

export class StudioBg3dModelThumbnailThreeCaptureError extends Error {
  constructor(
    readonly code: StudioBg3dModelThumbnailThreeCaptureErrorCode,
    options?: ErrorOptions,
  ) {
    super(`studio-bg3d-model-thumbnail-three-capture:${code}`, options);
    this.name = code === "aborted"
      ? "AbortError"
      : "StudioBg3dModelThumbnailThreeCaptureError";
  }
}

export interface StudioBg3dModelThumbnailThreeFraming {
  readonly width: number;
  readonly height: number;
  readonly aspect: number;
  readonly fovDegrees: number;
  readonly near: number;
  readonly far: number;
  readonly cameraPosition: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  /** World-space AABB sampled from the isolated clone before camera placement. */
  readonly worldBoundsMin: readonly [number, number, number];
  readonly worldBoundsMax: readonly [number, number, number];
}

export interface StudioBg3dModelThumbnailThreeCaptureHandle {
  readonly adapter: StudioBg3dCaptureAdapter;
  readonly framing: StudioBg3dModelThumbnailThreeFraming;
  readonly disposed: boolean;
  /**
   * Releases only the isolated Object3D graph. Shared model geometry/materials/textures remain
   * cache-owned. When GPU readback is active, structural release is deferred until it settles.
   */
  dispose(): void;
}

export interface StudioBg3dModelThumbnailThreeCaptureDependencies {
  readonly cloneRoot?: (root: THREE.Object3D) => Promise<THREE.Object3D>;
}

/**
 * The renderer surface a thumbnail job needs, satisfied by `WebGLRenderer` and `WebGPURenderer`.
 *
 * The editor's renderer is chosen per session by the engine-selection policy, and this module
 * borrows it rather than opening a second GPU context. Demanding `WebGLRenderer` here therefore
 * stopped being a type refinement the moment WebGPU could own the canvas: it turned every imported
 * model on a WebGPU session into a silent placeholder, because the caller treats thumbnail failure
 * as best-effort. Both renderers expose the same accessors, so the state fence below is written
 * against them rather than against one backend.
 */
export interface StudioBg3dModelThumbnailRenderer {
  readonly isWebGLRenderer?: boolean;
  readonly isWebGPURenderer?: boolean;
  autoClear: boolean;
  outputColorSpace: string;
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
  readonly xr?: { enabled: boolean };
  /**
   * The bound render target is opaque here: this module reads it only to hand the identical value
   * back afterwards. `WebGLRenderer` and `WebGPURenderer` declare incompatible target types, and
   * naming either one would make the other unassignable for a value neither is ever inspected as.
   */
  getRenderTarget(): unknown;
  getActiveCubeFace(): number;
  getActiveMipmapLevel(): number;
  getViewport(target: THREE.Vector4): THREE.Vector4;
  getScissor(target: THREE.Vector4): THREE.Vector4;
  getScissorTest(): boolean;
  getClearColor(target: THREE.Color): THREE.Color;
  getClearAlpha(): number;
  setRenderTarget(target: never, activeCubeFace?: number, activeMipmapLevel?: number): void;
  setViewport(viewport: THREE.Vector4): void;
  setScissor(scissor: THREE.Vector4): void;
  setScissorTest(enabled: boolean): void;
  setClearColor(color: THREE.Color, alpha?: number): void;
}

export interface CreateStudioBg3dModelThumbnailThreeCaptureInput {
  readonly renderer: StudioBg3dModelThumbnailRenderer;
  readonly cachedRoot: THREE.Object3D;
  readonly width?: number;
  readonly height?: number;
  readonly padding?: number;
  readonly signal?: AbortSignal;
  /** Modal/import epoch fence. Exceptions are treated as stale state. */
  readonly isCurrent?: () => boolean;
  readonly dependencies?: StudioBg3dModelThumbnailThreeCaptureDependencies;
}

interface RendererStateSnapshot {
  readonly renderTarget: unknown;
  readonly activeCubeFace: number;
  readonly activeMipmapLevel: number;
  readonly viewport: THREE.Vector4;
  readonly scissor: THREE.Vector4;
  readonly scissorTest: boolean;
  readonly clearColor: THREE.Color;
  readonly clearAlpha: number;
  readonly autoClear: boolean;
  /** `null` when the renderer exposes no XR manager; restoring then stays a no-op. */
  readonly xrEnabled: boolean | null;
  readonly outputColorSpace: THREE.WebGLRenderer["outputColorSpace"];
  readonly toneMapping: THREE.WebGLRenderer["toneMapping"];
  readonly toneMappingExposure: number;
}

function operationError(
  code: StudioBg3dModelThumbnailThreeCaptureErrorCode,
  cause?: unknown,
): StudioBg3dModelThumbnailThreeCaptureError {
  return new StudioBg3dModelThumbnailThreeCaptureError(
    code,
    cause === undefined ? undefined : { cause },
  );
}

function isCurrent(input: CreateStudioBg3dModelThumbnailThreeCaptureInput): boolean {
  try {
    return input.isCurrent?.() ?? true;
  } catch {
    return false;
  }
}

function throwIfUnauthorized(
  input: CreateStudioBg3dModelThumbnailThreeCaptureInput,
  disposed = false,
): void {
  if (disposed) throw operationError("disposed");
  if (input.signal?.aborted) throw operationError("aborted");
  if (!isCurrent(input)) throw operationError("stale");
}

function assertDimensions(width: number, height: number): void {
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width < 1
    || height < 1
    || width > STUDIO_BG3D_MODEL_THUMBNAIL_MAX_DIMENSION
    || height > STUDIO_BG3D_MODEL_THUMBNAIL_MAX_DIMENSION
  ) {
    throw operationError("invalid-dimensions");
  }
  const pixels = width * height;
  const rgbaBytes = pixels * 4;
  if (
    !Number.isSafeInteger(pixels)
    || pixels > STUDIO_BG3D_MODEL_THUMBNAIL_MAX_PIXELS
    || !Number.isSafeInteger(rgbaBytes)
    || rgbaBytes > STUDIO_BG3D_MODEL_THUMBNAIL_MAX_PIXELS * 4
  ) {
    throw operationError("invalid-dimensions");
  }
}

function tuple(vector: THREE.Vector3): readonly [number, number, number] {
  return Object.freeze([vector.x, vector.y, vector.z] as const);
}

function finiteBoundComponent(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= STUDIO_BG3D_MODEL_THUMBNAIL_MAX_WORLD_ABS;
}

function assertWorldBounds(bounds: THREE.Box3): void {
  if (
    bounds.isEmpty()
    || !finiteBoundComponent(bounds.min.x)
    || !finiteBoundComponent(bounds.min.y)
    || !finiteBoundComponent(bounds.min.z)
    || !finiteBoundComponent(bounds.max.x)
    || !finiteBoundComponent(bounds.max.y)
    || !finiteBoundComponent(bounds.max.z)
  ) throw operationError("invalid-bounds");
  const size = bounds.getSize(new THREE.Vector3());
  if (!Number.isFinite(size.lengthSq()) || size.lengthSq() <= Number.EPSILON) {
    throw operationError("invalid-bounds");
  }
}

function boundsCorners(bounds: THREE.Box3): readonly THREE.Vector3[] {
  const { min, max } = bounds;
  return [
    new THREE.Vector3(min.x, min.y, min.z),
    new THREE.Vector3(min.x, min.y, max.z),
    new THREE.Vector3(min.x, max.y, min.z),
    new THREE.Vector3(min.x, max.y, max.z),
    new THREE.Vector3(max.x, min.y, min.z),
    new THREE.Vector3(max.x, min.y, max.z),
    new THREE.Vector3(max.x, max.y, min.z),
    new THREE.Vector3(max.x, max.y, max.z),
  ];
}

function createFittedCamera(input: {
  readonly bounds: THREE.Box3;
  readonly width: number;
  readonly height: number;
  readonly padding: number;
}): { readonly camera: THREE.PerspectiveCamera; readonly framing: StudioBg3dModelThumbnailThreeFraming } {
  const { bounds, width, height, padding } = input;
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const aspect = width / height;
  const camera = new THREE.PerspectiveCamera(
    STUDIO_BG3D_MODEL_THUMBNAIL_CAMERA_FOV_DEGREES,
    aspect,
    0.01,
    10,
  );
  const toCamera = new THREE.Vector3(1.05, 0.72, 1.55).normalize();
  camera.position.copy(center).add(toCamera);
  camera.up.set(0, 1, 0);
  camera.lookAt(center);
  camera.updateMatrixWorld(true);

  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
  const verticalTangent = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
  const horizontalTangent = verticalTangent * aspect;
  let distance = 0;
  let minimumAlong = Number.POSITIVE_INFINITY;
  let maximumAlong = Number.NEGATIVE_INFINITY;
  for (const corner of boundsCorners(bounds)) {
    const relative = corner.sub(center);
    const along = relative.dot(forward);
    minimumAlong = Math.min(minimumAlong, along);
    maximumAlong = Math.max(maximumAlong, along);
    distance = Math.max(
      distance,
      Math.abs(relative.dot(right)) * padding / horizontalTangent - along,
      Math.abs(relative.dot(up)) * padding / verticalTangent - along,
    );
  }
  const radius = Math.max(size.length() * 0.5, 1e-4);
  distance = Math.max(distance + radius * 0.04, radius * 0.2, 1e-4);
  if (!Number.isFinite(distance) || distance > STUDIO_BG3D_MODEL_THUMBNAIL_MAX_WORLD_ABS) {
    throw operationError("invalid-bounds");
  }
  const minimumDepth = distance + minimumAlong;
  const maximumDepth = distance + maximumAlong;
  const near = Math.max(1e-5, minimumDepth - radius * 0.08);
  const far = Math.max(near + 1e-4, maximumDepth + radius * 0.2);
  if (!Number.isFinite(near) || !Number.isFinite(far) || far <= near) {
    throw operationError("invalid-bounds");
  }
  camera.near = near;
  camera.far = far;
  camera.position.copy(center).addScaledVector(toCamera, distance);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  return {
    camera,
    framing: Object.freeze({
      width,
      height,
      aspect,
      fovDegrees: camera.fov,
      near,
      far,
      cameraPosition: tuple(camera.position),
      target: tuple(center),
      worldBoundsMin: tuple(bounds.min),
      worldBoundsMax: tuple(bounds.max),
    }),
  };
}

function rendererState(renderer: StudioBg3dModelThumbnailRenderer): RendererStateSnapshot {
  return {
    renderTarget: renderer.getRenderTarget(),
    activeCubeFace: renderer.getActiveCubeFace(),
    activeMipmapLevel: renderer.getActiveMipmapLevel(),
    viewport: renderer.getViewport(new THREE.Vector4()),
    scissor: renderer.getScissor(new THREE.Vector4()),
    scissorTest: renderer.getScissorTest(),
    // WebGPU types this target as `Color4`, which only adds `a` on top of `Color`; the alpha the
    // snapshot needs comes from `getClearAlpha()` either way, so one `Color` serves both.
    clearColor: renderer.getClearColor(new THREE.Color()),
    clearAlpha: renderer.getClearAlpha(),
    autoClear: renderer.autoClear,
    xrEnabled: renderer.xr ? renderer.xr.enabled : null,
    outputColorSpace: renderer.outputColorSpace,
    toneMapping: renderer.toneMapping,
    toneMappingExposure: renderer.toneMappingExposure,
  };
}

function restoreRendererState(
  renderer: StudioBg3dModelThumbnailRenderer,
  previous: RendererStateSnapshot,
): void {
  let firstFailure: unknown;
  const restore = (operation: () => void) => {
    try {
      operation();
    } catch (error) {
      firstFailure ??= error;
    }
  };
  // Render-target restoration comes first because Three changes viewport/scissor with the target.
  restore(() => renderer.setRenderTarget(
    previous.renderTarget as never,
    previous.activeCubeFace,
    previous.activeMipmapLevel,
  ));
  restore(() => renderer.setViewport(previous.viewport));
  restore(() => renderer.setScissor(previous.scissor));
  restore(() => renderer.setScissorTest(previous.scissorTest));
  restore(() => renderer.setClearColor(previous.clearColor, previous.clearAlpha));
  restore(() => { renderer.autoClear = previous.autoClear; });
  restore(() => {
    if (renderer.xr && previous.xrEnabled !== null) renderer.xr.enabled = previous.xrEnabled;
  });
  restore(() => { renderer.outputColorSpace = previous.outputColorSpace; });
  restore(() => { renderer.toneMapping = previous.toneMapping; });
  restore(() => { renderer.toneMappingExposure = previous.toneMappingExposure; });
  if (firstFailure !== undefined) throw firstFailure;
}

function applyThumbnailRendererState(
  renderer: StudioBg3dModelThumbnailRenderer,
  width: number,
  height: number,
): void {
  if (renderer.xr) renderer.xr.enabled = false;
  renderer.autoClear = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.setViewport(new THREE.Vector4(0, 0, width, height));
  renderer.setScissor(new THREE.Vector4(0, 0, width, height));
  renderer.setScissorTest(false);
}

async function cloneCachedRoot(root: THREE.Object3D): Promise<THREE.Object3D> {
  const { cloneStudioBg3dThreeObject } = await import("../studio-background-3d-model");
  return cloneStudioBg3dThreeObject(root);
}

function assertCaptureRequest(
  request: StudioBg3dCaptureRequest,
  width: number,
  height: number,
): void {
  if (request.width !== width || request.height !== height || request.includeDepth) {
    throw operationError("invalid-dimensions");
  }
}

/**
 * Builds an isolated, world-AABB-fitted capture adapter around a cache-owned model root.
 *
 * The caller must already hold the editor's global renderer/capture lease. That lease also makes
 * the source transform snapshot atomic with respect to scene edits; this utility intentionally
 * does not invent a second global lock.
 */
/** Which capture adapter this renderer needs, or `null` when it is not a renderer we can drive. */
function thumbnailRendererBackend(
  renderer: StudioBg3dModelThumbnailRenderer | undefined,
): "webgl" | "webgpu" | null {
  if (renderer?.isWebGPURenderer === true) return "webgpu";
  if (renderer?.isWebGLRenderer === true) return "webgl";
  return null;
}

/**
 * Builds the capture adapter for the borrowed renderer.
 *
 * The WebGPU adapter is reached through the approved lazy entry and only when a WebGPU session is
 * actually running, so a WebGL editor never downloads Three's WebGPU build to render a thumbnail.
 */
async function createThumbnailAdapter(
  backend: "webgl" | "webgpu",
  renderer: StudioBg3dModelThumbnailRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): Promise<StudioBg3dCaptureAdapter> {
  if (backend === "webgl") {
    return createStudioBg3dThreeWebglCaptureAdapter({
      renderer: renderer as unknown as THREE.WebGLRenderer,
      scene,
      camera,
    });
  }
  const entry = await import("./studio-bg3d-three-webgpu-entry");
  return entry.createStudioBg3dThreeWebGpuCaptureAdapter({
    renderer: renderer as unknown as Parameters<
      typeof entry.createStudioBg3dThreeWebGpuCaptureAdapter
    >[0]["renderer"],
    scene,
    camera,
  });
}

export async function createStudioBg3dModelThumbnailThreeCapture(
  input: CreateStudioBg3dModelThumbnailThreeCaptureInput,
): Promise<StudioBg3dModelThumbnailThreeCaptureHandle> {
  const rendererBackend = thumbnailRendererBackend(input?.renderer);
  if (
    !input
    || typeof input !== "object"
    || rendererBackend === null
    || !input.cachedRoot?.isObject3D
    || (input.isCurrent !== undefined && typeof input.isCurrent !== "function")
  ) throw operationError("invalid-input");
  const width = input.width ?? STUDIO_BG3D_MODEL_THUMBNAIL_WIDTH;
  const height = input.height ?? STUDIO_BG3D_MODEL_THUMBNAIL_HEIGHT;
  assertDimensions(width, height);
  const padding = input.padding ?? STUDIO_BG3D_MODEL_THUMBNAIL_CAMERA_PADDING;
  if (!Number.isFinite(padding) || padding < 1.01 || padding > 2) {
    throw operationError("invalid-input");
  }
  throwIfUnauthorized(input);

  const sourceParent = input.cachedRoot.parent;
  input.cachedRoot.updateWorldMatrix(true, true);
  const sourceParentWorld = sourceParent?.matrixWorld.clone() ?? new THREE.Matrix4();
  let clonedRoot: THREE.Object3D;
  try {
    clonedRoot = await (input.dependencies?.cloneRoot ?? cloneCachedRoot)(input.cachedRoot);
  } catch (cause) {
    throw operationError("clone-failed", cause);
  }
  throwIfUnauthorized(input);
  if (
    !clonedRoot?.isObject3D
    || clonedRoot === input.cachedRoot
    || clonedRoot.parent !== null
    || input.cachedRoot.parent !== sourceParent
  ) throw operationError("clone-failed");

  // Preserve the source's full parent world matrix without flattening shear into a decomposition.
  const worldAnchor = new THREE.Group();
  worldAnchor.name = "Studio model thumbnail world anchor";
  worldAnchor.matrixAutoUpdate = false;
  worldAnchor.matrix.copy(sourceParentWorld);
  worldAnchor.add(clonedRoot);
  clonedRoot.traverse((object) => {
    // Imported lights would make identical materials produce unrelated thumbnails. This mutation
    // is clone-local; the cache-owned source graph remains untouched.
    if ((object as THREE.Light).isLight) object.visible = false;
  });

  const scene = new THREE.Scene();
  scene.name = "Studio isolated model thumbnail";
  scene.add(worldAnchor);
  scene.updateMatrixWorld(true);
  const worldBounds = new THREE.Box3().setFromObject(worldAnchor, true);
  try {
    assertWorldBounds(worldBounds);
  } catch (error) {
    scene.remove(worldAnchor);
    worldAnchor.remove(clonedRoot);
    throw error;
  }
  const { camera, framing } = createFittedCamera({ bounds: worldBounds, width, height, padding });
  const center = worldBounds.getCenter(new THREE.Vector3());
  const radius = Math.max(worldBounds.getSize(new THREE.Vector3()).length() * 0.5, 1);
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0xb9c1ce, 1.35);
  hemisphere.name = "Studio thumbnail neutral hemisphere";
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.name = "Studio thumbnail neutral key";
  key.position.copy(center).add(new THREE.Vector3(1.4, 2.1, 2.5).multiplyScalar(radius));
  key.target.position.copy(center);
  const fill = new THREE.DirectionalLight(0xdce8ff, 0.85);
  fill.name = "Studio thumbnail neutral fill";
  fill.position.copy(center).add(new THREE.Vector3(-2, 0.7, 1.2).multiplyScalar(radius));
  fill.target.position.copy(center);
  scene.add(hemisphere, key, key.target, fill, fill.target);
  scene.updateMatrixWorld(true);

  const renderer = input.renderer;
  const isolatedAdapter = await createThumbnailAdapter(rendererBackend, renderer, scene, camera);
  let disposed = false;
  let activeCaptures = 0;
  let releasePending = false;
  let released = false;
  const releaseOwnedGraph = () => {
    if (released || activeCaptures > 0) return;
    released = true;
    scene.clear();
    worldAnchor.remove(clonedRoot);
    // Do not call dispose on cloned geometry, materials, textures, skeleton resources, or images:
    // the structural clone deliberately shares all render resources with the model cache.
  };

  const adapter: StudioBg3dCaptureAdapter = Object.freeze({
    backend: isolatedAdapter.backend,
    engineId: isolatedAdapter.engineId,
    engineVersion: isolatedAdapter.engineVersion,
    implementationRevision: isolatedAdapter.implementationRevision,
    graphicsApi: isolatedAdapter.graphicsApi,
    profileId: isolatedAdapter.profileId,
    getSourceSize: () => Object.freeze({ width, height }),
    async capture(request: StudioBg3dCaptureRequest): Promise<StudioBg3dCapturedRaster> {
      throwIfUnauthorized(input, disposed);
      assertCaptureRequest(request, width, height);
      let pending: Promise<StudioBg3dCapturedRaster> | undefined;
      let primaryFailure: unknown;
      const previous = rendererState(renderer);
      activeCaptures += 1;
      try {
        try {
          applyThumbnailRendererState(renderer, width, height);
          // The Three adapter submits GPU readback before returning this Promise. Restore the live
          // renderer immediately, rather than holding thumbnail tone/viewport state across its fence.
          pending = isolatedAdapter.capture(request);
        } catch (error) {
          primaryFailure = error;
        }
      } finally {
        try {
          restoreRendererState(renderer, previous);
        } catch (restoreFailure) {
          primaryFailure ??= restoreFailure;
        }
      }
      try {
        if (primaryFailure !== undefined) {
          if (pending) void pending.catch(() => undefined);
          throw primaryFailure;
        }
        const raster = await pending!;
        throwIfUnauthorized(input, disposed);
        return raster;
      } finally {
        activeCaptures -= 1;
        if (releasePending) releaseOwnedGraph();
      }
    },
  });

  return Object.freeze({
    adapter,
    framing,
    get disposed() {
      return disposed;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      releasePending = true;
      releaseOwnedGraph();
    },
  });
}
