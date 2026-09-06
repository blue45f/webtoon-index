/** Three/WebGL implementation of the renderer-neutral Studio 3D capture contract. */

import * as THREE from "three";

import {
  STUDIO_BG3D_CAPTURE_PROFILE_RGBA8_DEPTH_V1,
  STUDIO_BG3D_THREE_WEBGL_CAPTURE_IMPLEMENTATION_V1,
} from "./studio-bg3d-capture-adapter";
import { hideStudioBg3dCaptureExcludedObjects } from "./studio-bg3d-capture-exclusion";
import { captureStudioBg3dThreeDepth } from "./studio-bg3d-lt-three-depth";
import { normalizeStudioBg3dRgbaReadback } from "./studio-bg3d-readback-normalize";
import { createStudioBg3dStraightAlphaOutputPass } from "./studio-bg3d-straight-alpha-output-pass";

import type {
  StudioBg3dCaptureAdapter,
  StudioBg3dCapturedRaster,
  StudioBg3dCaptureRequest,
} from "./studio-bg3d-capture-adapter";

export {
  registerStudioBg3dCaptureExcludedObject,
  registerStudioBg3dDepthExcludedObject,
} from "./studio-bg3d-capture-exclusion";
export {
  acquireStudioBg3dCaptureAdapterAfterViewTransition,
  captureStudioBg3dRaster,
  getStudioBg3dCaptureSourceSize,
} from "./studio-bg3d-capture-adapter";

export interface CreateStudioBg3dThreeWebglCaptureAdapterInput {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
}

/**
 * Captures the same display-color result as the canvas without requiring
 * `preserveDrawingBuffer`. The first target holds Three's linear scene pass; OutputPass then
 * applies the renderer's active tone mapping and output color-space conversion into an RGBA8
 * target suitable for readback. Keeping these passes separate is important: WebGLRenderer skips
 * material tone mapping when a normal render target is active.
 *
 * Submission happens before the first await. The live R3F state is consequently restored while
 * the GPU fence is pending, just like the depth adapter, and the temporary targets stay alive
 * until the asynchronous readback settles.
 */
async function captureStudioBg3dThreeWebglColor(input: {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  readonly request: StudioBg3dCaptureRequest;
}): Promise<Uint8ClampedArray> {
  const { renderer, scene, camera, request } = input;
  const previousTarget = renderer.getRenderTarget();
  const previousActiveCubeFace = renderer.getActiveCubeFace();
  const previousActiveMipmapLevel = renderer.getActiveMipmapLevel();
  const previousClearColor = renderer.getClearColor(new THREE.Color());
  const previousClearAlpha = renderer.getClearAlpha();
  const previousAutoClear = renderer.autoClear;
  const previousXrEnabled = renderer.xr.enabled;
  const previousViewport = renderer.getViewport(new THREE.Vector4());
  const previousScissor = renderer.getScissor(new THREE.Vector4());
  const previousScissorTest = renderer.getScissorTest();
  const capturedSceneBackground = scene.background;
  const capturedSceneBackgroundRotation = scene.backgroundRotation.clone();
  const suppressSceneBackground = request.background.alpha === 0;
  const sceneTarget = new THREE.WebGLRenderTarget(request.width, request.height, {
    depthBuffer: true,
    stencilBuffer: false,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
  });
  // This is an intermediate working-color buffer. The straight-alpha output pass unpremultiplies
  // linear RGB before owning the one explicit tone-map/sRGB transfer.
  sceneTarget.texture.colorSpace = THREE.NoColorSpace;
  const outputTarget = new THREE.WebGLRenderTarget(request.width, request.height, {
    depthBuffer: false,
    stencilBuffer: false,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
  });
  outputTarget.texture.colorSpace = THREE.NoColorSpace;
  const outputPass = createStudioBg3dStraightAlphaOutputPass();
  const packed = new Uint8Array(request.width * request.height * 4);

  try {
    let readback: Promise<THREE.TypedArray>;
    try {
      renderer.xr.enabled = false;
      renderer.autoClear = true;
      renderer.setClearColor(request.background.color, request.background.alpha);
      renderer.setRenderTarget(sceneTarget);
      renderer.clear(true, true, true);
      // Pin the background reference and yaw sampled at transaction entry. R3F effects or input
      // drafts that commit around this call cannot make the raster disagree with its document.
      scene.background = suppressSceneBackground ? null : capturedSceneBackground;
      scene.backgroundRotation.copy(capturedSceneBackgroundRotation);
      renderer.render(scene, camera);

      // Rendering to a normal WebGLRenderTarget deliberately bypasses Three's final canvas output
      // transform. The output pass first restores straight linear RGB, then recreates tone mapping
      // and output color space before RGBA8 readback so transparency and viewport color both agree.
      outputPass.render(renderer, outputTarget, sceneTarget, 0, false);
      readback = renderer.readRenderTargetPixelsAsync(
        outputTarget,
        0,
        0,
        request.width,
        request.height,
        packed,
      );
    } finally {
      // `readRenderTargetPixelsAsync` has already submitted its copy/fence work. Never leave a
      // live R3F frame pointed at a temporary capture target while the Promise waits for the GPU.
      renderer.setRenderTarget(previousTarget, previousActiveCubeFace, previousActiveMipmapLevel);
      renderer.setClearColor(previousClearColor, previousClearAlpha);
      renderer.autoClear = previousAutoClear;
      renderer.xr.enabled = previousXrEnabled;
      renderer.setViewport(previousViewport);
      renderer.setScissor(previousScissor);
      renderer.setScissorTest(previousScissorTest);
      scene.background = capturedSceneBackground;
      scene.backgroundRotation.copy(capturedSceneBackgroundRotation);
    }
    await readback;
    return normalizeStudioBg3dRgbaReadback({
      width: request.width,
      height: request.height,
      rgba: packed,
      // WebGL framebuffer readback starts at its bottom row; the capture contract is top-down.
      flipY: true,
    });
  } finally {
    // OutputPass owns a module-shared fullscreen geometry, so dispose only its per-capture
    // material. Its public dispose() would also dispose that shared geometry.
    outputPass.material.dispose();
    sceneTarget.dispose();
    outputTarget.dispose();
  }
}

export function createStudioBg3dThreeWebglCaptureAdapter(
  input: CreateStudioBg3dThreeWebglCaptureAdapterInput
): StudioBg3dCaptureAdapter {
  const { renderer, scene, camera } = input;
  const isWebglRenderer =
    (renderer as THREE.WebGLRenderer & { readonly isWebGLRenderer?: boolean } | null)
      ?.isWebGLRenderer === true;
  if (!isWebglRenderer || !scene?.isScene || !camera?.isCamera) {
    throw new TypeError("Three WebGL capture requires a renderer, scene, and camera.");
  }

  async function capture(request: StudioBg3dCaptureRequest): Promise<StudioBg3dCapturedRaster> {
    const restoreCaptureExcludedObjects = hideStudioBg3dCaptureExcludedObjects(scene);
    let colorReadback: Promise<Uint8ClampedArray>;
    let depthReadback: Promise<Float32Array> | undefined;
    try {
      colorReadback = captureStudioBg3dThreeWebglColor({ camera, renderer, request, scene });
      if (request.includeDepth) {
        depthReadback = captureStudioBg3dThreeDepth({
          renderer,
          scene,
          camera,
          width: request.width,
          height: request.height,
        });
      }
    } finally {
      // Both GPU passes submit their readback work before their first await and restore renderer
      // state themselves. Keep viewport-only objects hidden through both submissions, then restore
      // their exact original visibility while the GPU fence(s) are pending.
      restoreCaptureExcludedObjects();
    }
    const [rgba, depth] = await Promise.all([
      colorReadback!,
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
    backend: "three-webgl" as const,
    engineId: "three" as const,
    engineVersion: String(THREE.REVISION).toLowerCase(),
    implementationRevision: STUDIO_BG3D_THREE_WEBGL_CAPTURE_IMPLEMENTATION_V1,
    graphicsApi: "webgl2" as const,
    profileId: STUDIO_BG3D_CAPTURE_PROFILE_RGBA8_DEPTH_V1,
    getSourceSize: () => ({
      width: renderer.domElement.width,
      height: renderer.domElement.height,
    }),
    capture,
  });
}
