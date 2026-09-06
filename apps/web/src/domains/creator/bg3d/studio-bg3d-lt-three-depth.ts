/** Engine adapter for a resource-safe Three.js depth pass used by the pure LT raster stage. */

import * as THREE from "three";

import { hideStudioBg3dDepthExcludedObjects } from "./studio-bg3d-capture-exclusion";
import {
  decodeStudioBg3dThreeRgbaDepth,
  STUDIO_BG3D_LT_RENDER_MAX_PIXELS,
} from "./studio-bg3d-lt-render";

export interface CaptureStudioBg3dThreeDepthInput {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  readonly width: number;
  readonly height: number;
}

function assertCaptureDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw new RangeError("3D LT depth dimensions must be positive safe integers.");
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > STUDIO_BG3D_LT_RENDER_MAX_PIXELS) {
    throw new RangeError("3D LT depth capture exceeds the raster pixel budget.");
  }
}

/**
 * Renders visible geometry with Three's canonical RGBADepthPacking and returns top-down normalized
 * depth. Renderer target, clear state, XR state, scene override material, and allocations are
 * restored/disposed even when rendering or readback fails.
 */
export async function captureStudioBg3dThreeDepth(
  input: CaptureStudioBg3dThreeDepthInput
): Promise<Float32Array> {
  const { renderer, scene, camera, width, height } = input;
  assertCaptureDimensions(width, height);
  if (!renderer || !scene?.isScene || !camera?.isCamera) {
    throw new TypeError("3D LT depth capture requires a Three renderer, scene, and camera.");
  }

  const previousTarget = renderer.getRenderTarget();
  const previousOverrideMaterial = scene.overrideMaterial;
  const previousSceneBackground = scene.background;
  const previousSceneBackgroundRotation = scene.backgroundRotation.clone();
  const previousClearColor = renderer.getClearColor(new THREE.Color());
  const previousClearAlpha = renderer.getClearAlpha();
  const previousAutoClear = renderer.autoClear;
  const previousXrEnabled = renderer.xr.enabled;
  const target = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: true,
    stencilBuffer: false,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
  });
  target.texture.colorSpace = THREE.NoColorSpace;
  const depthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    blending: THREE.NoBlending,
  });
  depthMaterial.toneMapped = false;
  const packed = new Uint8Array(width * height * 4);
  const restoreDepthExcludedObjects = hideStudioBg3dDepthExcludedObjects(scene);

  try {
    let readback: Promise<THREE.TypedArray>;
    try {
      renderer.xr.enabled = false;
      renderer.autoClear = true;
      scene.overrideMaterial = depthMaterial;
      renderer.setRenderTarget(target);
      renderer.setClearColor(0xffffff, 1);
      renderer.clear(true, true, true);
      // Equirectangular scene backgrounds are color-only environment decoration. Pin a null
      // background immediately before submission so no full-frame fake depth surface is packed.
      scene.background = null;
      renderer.render(scene, camera);
      // Three submits readPixels/fence work synchronously before returning this Promise. Restore
      // the live R3F renderer immediately so subsequent frames cannot render into the depth target
      // or through MeshDepthMaterial while the GPU fence is pending.
      readback = renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height, packed);
    } finally {
      try {
        scene.overrideMaterial = previousOverrideMaterial;
        scene.background = previousSceneBackground;
        scene.backgroundRotation.copy(previousSceneBackgroundRotation);
        renderer.setRenderTarget(previousTarget);
        renderer.setClearColor(previousClearColor, previousClearAlpha);
        renderer.autoClear = previousAutoClear;
        renderer.xr.enabled = previousXrEnabled;
      } finally {
        // The GPU submission already owns the draw. Restore beauty-only objects immediately so a
        // live R3F frame cannot visibly lose its contact shadows while the readback fence settles.
        restoreDepthExcludedObjects();
      }
    }
    await readback;
    return decodeStudioBg3dThreeRgbaDepth({ width, height, rgba: packed, flipY: true });
  } finally {
    depthMaterial.dispose();
    target.dispose();
  }
}
