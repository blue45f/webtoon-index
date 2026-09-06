/**
 * Three/WebGPU implementation of the renderer-neutral Studio 3D capture contract.
 *
 * The WebGL adapter and this one must produce the same raster for the same scene, because the
 * line-and-tone pipeline, shot batches, and the studio insert flow all consume the result as one
 * profile. Two differences between the renderers make that non-trivial, and both are handled here
 * rather than papered over:
 *
 * 1. `WebGPURenderer.readRenderTargetPixelsAsync()` returns a fresh buffer instead of filling a
 *    caller-owned one, so the adapter owns the copy into the contract's packed layout.
 * 2. WebGPURenderer applies tone mapping and the output transfer function only when drawing to the
 *    *output* target. Rendering into a capture target therefore lands in the linear working space,
 *    and this module runs the same straight-alpha → tone-map → sRGB transform the WebGL adapter
 *    gets from `OutputPass`, expressed in TSL.
 *
 * Depth uses Three's `RGBADepthPacking` byte layout so both backends decode through the one
 * `decodeStudioBg3dThreeRgbaDepth` implementation. `MeshDepthMaterial` has no node-material
 * equivalent, so the packing is transliterated from Three's `packing.glsl.js` into TSL and covered
 * by a pure round-trip test.
 */

import * as THREE from "three";
import {
  Fn,
  depth as fragmentDepth,
  float,
  screenUV,
  texture,
  vec3,
  vec4,
} from "three/tsl";
import { MeshBasicNodeMaterial, NodeMaterial, QuadMesh } from "three/webgpu";

import {
  STUDIO_BG3D_CAPTURE_PROFILE_RGBA8_DEPTH_V1,
} from "./studio-bg3d-capture-adapter";
import {
  hideStudioBg3dCaptureExcludedObjects,
  hideStudioBg3dDepthExcludedObjects,
} from "./studio-bg3d-capture-exclusion";
import {
  decodeStudioBg3dThreeRgbaDepth,
  STUDIO_BG3D_LT_RENDER_MAX_PIXELS,
} from "./studio-bg3d-lt-render";
import { normalizeStudioBg3dRgbaReadback } from "./studio-bg3d-readback-normalize";

import type {
  StudioBg3dCaptureAdapter,
  StudioBg3dCapturedRaster,
  StudioBg3dCaptureRequest,
} from "./studio-bg3d-capture-adapter";
import type { WebGPURenderer } from "three/webgpu";

/** App-owned revision; bump when adapter orchestration, shaders, or readback change. */
export const STUDIO_BG3D_THREE_WEBGPU_CAPTURE_IMPLEMENTATION_V1 =
  "studio-three-webgpu-capture-adapter-v1";

export interface CreateStudioBg3dThreeWebGpuCaptureAdapterInput {
  readonly renderer: WebGPURenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
}

/**
 * Three types the readback as a generic typed array. The capture contract is 8-bit, and a backend
 * that returned anything else would silently corrupt the raster, so this refuses instead.
 */
function toReadbackBytes(value: unknown): Uint8Array | Uint8ClampedArray {
  if (value instanceof Uint8Array || value instanceof Uint8ClampedArray) return value;
  throw new TypeError("3D WebGPU capture readback must be an 8-bit typed array.");
}

function assertCaptureDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw new RangeError("3D WebGPU capture dimensions must be positive safe integers.");
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > STUDIO_BG3D_LT_RENDER_MAX_PIXELS) {
    throw new RangeError("3D WebGPU capture exceeds the raster pixel budget.");
  }
}

function createCaptureTarget(width: number, height: number, depthBuffer: boolean): THREE.RenderTarget {
  const target = new THREE.RenderTarget(width, height, {
    depthBuffer,
    stencilBuffer: false,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
  });
  // Working-colour buffer: the explicit transfer happens in the output quad below, exactly once.
  target.texture.colorSpace = THREE.NoColorSpace;
  return target;
}

/**
 * Transliteration of Three's `packDepthToRGBA` (`packing.glsl.js`). `modf` has no TSL counterpart,
 * so each step is written as the `floor`/`fract` pair it decomposes to; depth is non-negative here,
 * so `floor` and truncation agree.
 */
type StudioTslFloatNode = ReturnType<typeof float>;

const packDepthToRgba = /*@__PURE__*/ Fn(([value]: readonly [StudioTslFloatNode]) => {
  const clamped = value.clamp(0, 1);
  const scaled = clamped.mul(16_777_216);
  const alphaFraction = scaled.fract();
  const afterAlpha = scaled.floor();
  const blueScaled = afterAlpha.div(256);
  const blueFraction = blueScaled.fract();
  const afterBlue = blueScaled.floor();
  const greenScaled = afterBlue.div(256);
  const greenFraction = greenScaled.fract();
  const red = greenScaled.floor();
  return vec4(
    red.div(255),
    greenFraction.mul(256 / 255),
    blueFraction.mul(256 / 255),
    alphaFraction,
  );
});

function createDepthNodeMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.name = "Studio BG3D WebGPU depth";
  material.blending = THREE.NoBlending;
  material.toneMapped = false;
  material.transparent = false;
  material.fog = false;
  // `fragmentDepth` is Three's window-space fragment depth — the same value `MeshDepthMaterial`
  // packs on the WebGL side, resolved per camera projection by the node graph.
  material.colorNode = packDepthToRgba(fragmentDepth as unknown as StudioTslFloatNode);
  return material;
}

/**
 * Applies the straight-alpha restore, tone mapping, and sRGB transfer that the WebGL adapter gets
 * from `OutputPass`. Three stores a premultiplied linear composite in a transparent target, and
 * Studio's raster contract is straight alpha.
 */
function createOutputQuad(
  sceneTexture: THREE.Texture,
  toneMapping: THREE.ToneMapping,
): QuadMesh {
  const material = new NodeMaterial();
  material.name = "Studio BG3D WebGPU straight-alpha output";
  material.fragmentNode = Fn(() => {
    const sampled = texture(sceneTexture, screenUV);
    const alpha = sampled.a;
    const straight = alpha.greaterThan(0).select(sampled.rgb.div(alpha), vec3(0));
    return vec4(straight, alpha).renderOutput(toneMapping, THREE.SRGBColorSpace);
  })();
  return new QuadMesh(material);
}

/** `Mesh.material` is typed as one-or-many; the capture quad always owns exactly one. */
function disposeQuadMaterial(quad: QuadMesh | null): void {
  const material = quad?.material;
  if (!material) return;
  for (const entry of Array.isArray(material) ? material : [material]) entry.dispose();
}

interface RendererCaptureState {
  readonly clearColorHex: number;
  readonly renderTarget: THREE.RenderTarget | null;
  readonly clearAlpha: number;
  readonly autoClear: boolean;
  readonly xrEnabled: boolean;
}

/** Three's WebGPU renderer reads its clear colour into a `Color4`; only RGB round-trips here. */
type StudioWebGpuClearColorTarget = Parameters<WebGPURenderer["getClearColor"]>[0];

function readRendererState(renderer: WebGPURenderer): RendererCaptureState {
  const clearColor = new THREE.Color() as unknown as StudioWebGpuClearColorTarget;
  renderer.getClearColor(clearColor);
  return {
    clearColorHex: (clearColor as unknown as THREE.Color).getHex(),
    renderTarget: renderer.getRenderTarget(),
    clearAlpha: renderer.getClearAlpha(),
    autoClear: renderer.autoClear,
    xrEnabled: renderer.xr.enabled,
  };
}

function restoreRendererState(renderer: WebGPURenderer, state: RendererCaptureState): void {
  renderer.setRenderTarget(state.renderTarget);
  renderer.setClearColor(state.clearColorHex, state.clearAlpha);
  renderer.autoClear = state.autoClear;
  renderer.xr.enabled = state.xrEnabled;
}

/**
 * Submits the colour passes and returns the pending readback. Renderer and scene state are handed
 * back before the first await, exactly like the WebGL adapter, so a live frame cannot render into
 * the capture target while the GPU fence is still pending. The temporary targets are owned by the
 * returned promise and disposed when it settles.
 */
function submitColorCapture(input: {
  readonly renderer: WebGPURenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  readonly request: StudioBg3dCaptureRequest;
}): Promise<Uint8ClampedArray> {
  const { renderer, scene, camera, request } = input;
  const state = readRendererState(renderer);
  const capturedBackground = scene.background;
  const capturedBackgroundRotation = scene.backgroundRotation.clone();
  const sceneTarget = createCaptureTarget(request.width, request.height, true);
  const outputTarget = createCaptureTarget(request.width, request.height, false);
  let outputQuad: QuadMesh | null = null;
  let readback: Promise<unknown>;
  try {
    renderer.xr.enabled = false;
    renderer.autoClear = true;
    // Equirectangular backgrounds are colour-only decoration; a transparent capture must not bake
    // one into the alpha channel.
    if (request.background.alpha === 0) scene.background = null;
    renderer.setRenderTarget(sceneTarget);
    renderer.setClearColor(
      new THREE.Color(request.background.color).getHex(),
      request.background.alpha,
    );
    renderer.render(scene, camera);

    outputQuad = createOutputQuad(sceneTarget.texture, renderer.toneMapping);
    renderer.setRenderTarget(outputTarget);
    renderer.setClearColor(0x000000, 0);
    outputQuad.render(renderer);

    readback = renderer.readRenderTargetPixelsAsync(
      outputTarget,
      0,
      0,
      request.width,
      request.height,
    );
  } catch (error) {
    scene.background = capturedBackground;
    scene.backgroundRotation.copy(capturedBackgroundRotation);
    restoreRendererState(renderer, state);
    disposeQuadMaterial(outputQuad);
    sceneTarget.dispose();
    outputTarget.dispose();
    throw error;
  }
  scene.background = capturedBackground;
  scene.backgroundRotation.copy(capturedBackgroundRotation);
  restoreRendererState(renderer, state);
  return readback.then(
    (raw) => normalizeStudioBg3dRgbaReadback({
      width: request.width,
      height: request.height,
      // WebGPU readback is already top-down; the WebGL adapter flips because GL is bottom-up. The
      // normalizer still resolves the 256-byte row alignment WebGPU buffer copies require.
      flipY: false,
      rgba: toReadbackBytes(raw),
    }),
  ).finally(() => {
    disposeQuadMaterial(outputQuad);
    sceneTarget.dispose();
    outputTarget.dispose();
  });
}

/** Submits the packed-depth pass; ownership and restore timing mirror the colour pass above. */
function submitDepthCapture(input: {
  readonly renderer: WebGPURenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  readonly width: number;
  readonly height: number;
}): Promise<Float32Array> {
  const { renderer, scene, camera, width, height } = input;
  assertCaptureDimensions(width, height);
  const state = readRendererState(renderer);
  const capturedOverride = scene.overrideMaterial;
  const capturedBackground = scene.background;
  const capturedBackgroundRotation = scene.backgroundRotation.clone();
  const target = createCaptureTarget(width, height, true);
  const depthMaterial = createDepthNodeMaterial();
  const restoreDepthExcludedObjects = hideStudioBg3dDepthExcludedObjects(scene);
  const restoreSceneAndRenderer = (): void => {
    scene.overrideMaterial = capturedOverride;
    scene.background = capturedBackground;
    scene.backgroundRotation.copy(capturedBackgroundRotation);
    restoreRendererState(renderer, state);
    // The submission already owns the draw, so beauty-only objects come back immediately rather
    // than staying hidden in the live viewport while the readback fence settles.
    restoreDepthExcludedObjects();
  };
  let readback: Promise<unknown>;
  try {
    renderer.xr.enabled = false;
    renderer.autoClear = true;
    scene.overrideMaterial = depthMaterial;
    // Equirectangular backgrounds are colour-only decoration; packing one would fake a full-frame
    // surface at the far plane.
    scene.background = null;
    renderer.setRenderTarget(target);
    // White is the packed far plane, matching the WebGL depth pass exactly.
    renderer.setClearColor(0xffffff, 1);
    renderer.render(scene, camera);
    readback = renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
  } catch (error) {
    restoreSceneAndRenderer();
    depthMaterial.dispose();
    target.dispose();
    throw error;
  }
  restoreSceneAndRenderer();
  return readback.then(
    (packed) => decodeStudioBg3dThreeRgbaDepth({
      width,
      height,
      // Row alignment padding is stripped first so the decoder sees one tightly packed raster.
      rgba: normalizeStudioBg3dRgbaReadback({
        width,
        height,
        flipY: false,
        rgba: toReadbackBytes(packed),
      }),
      flipY: false,
    }),
  ).finally(() => {
    depthMaterial.dispose();
    target.dispose();
  });
}

/**
 * Builds the WebGPU capture adapter for the live editor scene. Construction is fail-closed: a
 * renderer that is not an initialized WebGPU renderer is refused and the selected capture stays
 * unavailable instead of silently producing an empty raster or invoking another renderer.
 */
export function createStudioBg3dThreeWebGpuCaptureAdapter(
  input: CreateStudioBg3dThreeWebGpuCaptureAdapterInput,
): StudioBg3dCaptureAdapter {
  const { renderer, scene, camera } = input;
  const isWebgpuRenderer =
    (renderer as WebGPURenderer & { readonly isWebGPURenderer?: boolean } | null)
      ?.isWebGPURenderer === true;
  if (!isWebgpuRenderer || !scene?.isScene || !camera?.isCamera) {
    throw new TypeError("Three WebGPU capture requires a renderer, scene, and camera.");
  }

  async function capture(request: StudioBg3dCaptureRequest): Promise<StudioBg3dCapturedRaster> {
    assertCaptureDimensions(request.width, request.height);
    const restoreCaptureExcludedObjects = hideStudioBg3dCaptureExcludedObjects(scene);
    let colorReadback: Promise<Uint8ClampedArray>;
    let depthReadback: Promise<Float32Array> | undefined;
    try {
      colorReadback = submitColorCapture({ camera, renderer, request, scene });
      if (request.includeDepth) {
        depthReadback = submitDepthCapture({
          camera,
          renderer,
          scene,
          width: request.width,
          height: request.height,
        });
      }
    } finally {
      // Both passes submit before their first await, so viewport-only objects stay hidden across
      // the colour *and* depth draws — a gizmo restored between them would be packed into depth —
      // and are restored while the GPU fences are still pending.
      restoreCaptureExcludedObjects();
    }
    const [rgba, depth] = await Promise.all([
      colorReadback,
      depthReadback ?? Promise.resolve(undefined),
    ]);
    return {
      width: request.width,
      height: request.height,
      rgba,
      ...(depth ? { depth } : {}),
    };
  }

  return Object.freeze({
    backend: "three-webgpu" as const,
    engineId: "three" as const,
    engineVersion: String(THREE.REVISION).toLowerCase(),
    implementationRevision: STUDIO_BG3D_THREE_WEBGPU_CAPTURE_IMPLEMENTATION_V1,
    graphicsApi: "webgpu" as const,
    profileId: STUDIO_BG3D_CAPTURE_PROFILE_RGBA8_DEPTH_V1,
    getSourceSize: () => ({
      width: renderer.domElement.width,
      height: renderer.domElement.height,
    }),
    capture,
  });
}
