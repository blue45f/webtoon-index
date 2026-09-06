import * as THREE from "three";

import { STUDIO_BG3D_LT_RENDER_MAX_PIXELS } from "../bg3d/studio-bg3d-lt-render";
import { STUDIO_BG3D_SHOT_BATCH_MAX_DIMENSION } from "../bg3d/studio-bg3d-shot-batch-limits";
import { encodeStudioBg3dShotPngInWorker } from "../bg3d/studio-bg3d-shot-png-worker-client";
import { STUDIO_BG3D_SHOT_PNG_WORKER_MAX_OUTPUT_BYTES } from "../bg3d/studio-bg3d-shot-png-worker-protocol";
import { createStudioBg3dStraightAlphaOutputPass } from "../bg3d/studio-bg3d-straight-alpha-output-pass";

import type { StudioBg3dLtRasterLayer } from "../bg3d/studio-bg3d-lt-render";

// The explicit main-thread encoder supports the full capture budget. It is never selected because
// a Worker request failed; callers must choose it before the encoding request starts.
const STUDIO_VRM_CAPTURE_MAIN_THREAD_MAX_PIXELS = STUDIO_BG3D_LT_RENDER_MAX_PIXELS;

export type StudioVrmRasterPngEncoderBackend = "worker" | "main-thread";

export interface StudioVrmRasterCaptureDimensions {
  readonly width: number;
  readonly height: number;
}

/** Optional clear intent for subject-only (alpha 0) vs opaque character inserts. */
export interface StudioVrmRasterCaptureBackground {
  /** CSS hex `#rrggbb` or CSS color accepted by THREE.Color. Defaults to black. */
  readonly color?: string;
  /** Clear alpha in [0, 1]. Defaults to 0 (transparent subject cutout). */
  readonly alpha?: number;
}

export interface StudioVrmRasterCaptureOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** Selected once before encoding starts. Omission selects the product Worker backend. */
  readonly encoderBackend?: StudioVrmRasterPngEncoderBackend;
}

export interface StudioVrmRasterCaptureDependencies {
  readonly encodePngInWorker: (
    layers: readonly StudioBg3dLtRasterLayer[],
    options: StudioVrmRasterCaptureOptions,
  ) => Promise<Blob>;
  readonly encodePngOnMainThread: (
    rgba: Uint8ClampedArray,
    dimensions: StudioVrmRasterCaptureDimensions,
    options: StudioVrmRasterCaptureOptions,
  ) => Promise<Blob>;
  readonly blobToDataUrl: (
    blob: Blob,
    options: StudioVrmRasterCaptureOptions,
  ) => Promise<string>;
}

function abortError(message = "VRM 캡처를 취소했습니다."): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function timeoutError(message: string): Error {
  const error = new Error(message);
  error.name = "TimeoutError";
  return error;
}

function boundedTimeoutMs(value: number | undefined): number {
  if (!Number.isFinite(value)) return 20_000;
  return Math.max(100, Math.min(120_000, Math.floor(value ?? 0)));
}

function assertDimensions(
  dimensions: StudioVrmRasterCaptureDimensions,
): StudioVrmRasterCaptureDimensions {
  const { width, height } = dimensions;
  if (
    !Number.isSafeInteger(width) || width < 1 || width > STUDIO_BG3D_SHOT_BATCH_MAX_DIMENSION ||
    !Number.isSafeInteger(height) || height < 1 || height > STUDIO_BG3D_SHOT_BATCH_MAX_DIMENSION
  ) {
    throw new RangeError("VRM 캡처 크기가 허용 범위를 벗어났습니다.");
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > STUDIO_BG3D_LT_RENDER_MAX_PIXELS) {
    throw new RangeError("VRM 캡처 픽셀 예산을 초과했습니다.");
  }
  return dimensions;
}

function assertRgba(
  rgba: Uint8ClampedArray,
  dimensions: StudioVrmRasterCaptureDimensions,
): void {
  assertDimensions(dimensions);
  if (
    !(rgba instanceof Uint8ClampedArray) ||
    !(rgba.buffer instanceof ArrayBuffer) ||
    rgba.byteLength !== dimensions.width * dimensions.height * 4
  ) {
    throw new TypeError("VRM 캡처 RGBA 저장소가 올바르지 않습니다.");
  }
}

/**
 * WebGL readback is bottom-up. Return a fresh, tightly packed top-down RGBA8 snapshot so the
 * caller can transfer/cancel the encoder without detaching or mutating renderer-owned storage.
 */
export function flipStudioVrmCaptureRows(
  source: Uint8Array,
  dimensions: StudioVrmRasterCaptureDimensions,
): Uint8ClampedArray {
  assertDimensions(dimensions);
  const { width, height } = dimensions;
  const rowBytes = width * 4;
  if (
    !(source instanceof Uint8Array) ||
    !(source.buffer instanceof ArrayBuffer) ||
    source.byteLength !== rowBytes * height
  ) {
    throw new TypeError("VRM WebGL readback 저장소가 올바르지 않습니다.");
  }

  const output = new Uint8ClampedArray(source.byteLength);
  for (let outputRow = 0; outputRow < height; outputRow += 1) {
    const sourceRow = height - outputRow - 1;
    output.set(
      source.subarray(sourceRow * rowBytes, (sourceRow + 1) * rowBytes),
      outputRow * rowBytes,
    );
  }
  return output;
}

/**
 * Render into explicit targets and synchronously read only the raw pixels. PNG compression
 * happens later in a Worker. Using render targets makes capture independent of the browser's
 * default-framebuffer preservation policy, so the interactive Canvas need not opt into
 * `preserveDrawingBuffer`.
 *
 * Two passes are required for color parity with the live viewport: WebGLRenderer deliberately
 * skips material tone mapping and the output color-space transfer when a normal render target is
 * active, so a single-target readback would return linear, un-tone-mapped (and premultiplied)
 * bytes that look dark and washed out next to the preview. The MSAA scene target holds Three's
 * linear pass; the straight-alpha OutputPass then unpremultiplies and recreates the renderer's
 * active tone mapping + output color space into an RGBA8 target suitable for readback — the same
 * contract as the bg3d capture adapter.
 */
export function captureStudioVrmRgba(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  dimensions: StudioVrmRasterCaptureDimensions,
  background: StudioVrmRasterCaptureBackground = {},
): Uint8ClampedArray {
  const { width, height } = assertDimensions(dimensions);
  const clearAlpha = typeof background.alpha === "number" && Number.isFinite(background.alpha)
    ? Math.min(1, Math.max(0, background.alpha))
    : 0;
  const clearColor = new THREE.Color(
    typeof background.color === "string" && background.color.length > 0
      ? background.color
      : 0x000000,
  );
  const previousRenderTarget = renderer.getRenderTarget();
  const previousActiveCubeFace = renderer.getActiveCubeFace();
  const previousActiveMipmapLevel = renderer.getActiveMipmapLevel();
  const previousClearColor = renderer.getClearColor(new THREE.Color()).clone();
  const previousClearAlpha = renderer.getClearAlpha();
  const previousSceneBackground = scene.background;
  const sceneTarget = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: true,
    format: THREE.RGBAFormat,
    generateMipmaps: false,
    magFilter: THREE.LinearFilter,
    minFilter: THREE.LinearFilter,
    samples: Math.min(4, Math.max(0, Math.floor(renderer.capabilities.maxSamples))),
    stencilBuffer: false,
    type: THREE.UnsignedByteType,
  });
  // Intermediate working-color buffer: the straight-alpha output pass owns the one explicit
  // tone-map/sRGB transfer, so this texture must not declare an output color space of its own.
  sceneTarget.texture.colorSpace = THREE.NoColorSpace;
  const outputTarget = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: false,
    format: THREE.RGBAFormat,
    generateMipmaps: false,
    magFilter: THREE.NearestFilter,
    minFilter: THREE.NearestFilter,
    stencilBuffer: false,
    type: THREE.UnsignedByteType,
  });
  outputTarget.texture.colorSpace = THREE.NoColorSpace;
  const outputPass = createStudioBg3dStraightAlphaOutputPass();
  const bottomUp = new Uint8Array(width * height * 4);

  try {
    renderer.setRenderTarget(sceneTarget);
    // Pass a numeric hex so engine adapters (and capture tests) can distinguish the capture
    // clear from the subsequent restore of the previous THREE.Color instance.
    renderer.setClearColor(clearColor.getHex(), clearAlpha);
    // Transparent subject cutouts must not inherit a solid scene.background from the viewport.
    if (clearAlpha === 0) scene.background = null;
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    // Sampling the MSAA scene texture resolves it; the pass writes display-ready straight-alpha
    // RGBA8 into the non-MSAA output target, which is then read back synchronously.
    outputPass.render(renderer, outputTarget, sceneTarget, 0, false);
    renderer.readRenderTargetPixels(outputTarget, 0, 0, width, height, bottomUp);
  } finally {
    renderer.setRenderTarget(
      previousRenderTarget,
      previousActiveCubeFace,
      previousActiveMipmapLevel,
    );
    renderer.setClearColor(previousClearColor, previousClearAlpha);
    scene.background = previousSceneBackground;
    // OutputPass owns a module-shared fullscreen geometry, so dispose only its per-capture
    // material. Its public dispose() would also dispose that shared geometry.
    outputPass.material.dispose();
    sceneTarget.dispose();
    outputTarget.dispose();
  }

  return flipStudioVrmCaptureRows(bottomUp, dimensions);
}

async function validatePngBlob(
  png: Blob,
  dimensions: StudioVrmRasterCaptureDimensions,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw abortError();
  if (
    png.type !== "image/png" || png.size < 24 ||
    png.size > STUDIO_BG3D_SHOT_PNG_WORKER_MAX_OUTPUT_BYTES
  ) {
    throw new TypeError("VRM PNG 결과가 올바르지 않습니다.");
  }
  const header = new Uint8Array(await png.slice(0, 24).arrayBuffer());
  if (signal?.aborted) throw abortError();
  const signature = [137, 80, 78, 71, 13, 10, 26, 10] as const;
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (
    !signature.every((value, index) => header[index] === value) ||
    view.getUint32(8, false) !== 13 ||
    header[12] !== 0x49 || header[13] !== 0x48 ||
    header[14] !== 0x44 || header[15] !== 0x52 ||
    view.getUint32(16, false) !== dimensions.width ||
    view.getUint32(20, false) !== dimensions.height
  ) {
    throw new TypeError("VRM PNG 헤더가 캡처 크기와 일치하지 않습니다.");
  }
}

/** Explicit main-thread PNG backend. Callers must select it before encoding starts. */
export async function encodeStudioVrmCapturePngOnMainThread(
  rgba: Uint8ClampedArray,
  dimensions: StudioVrmRasterCaptureDimensions,
  options: StudioVrmRasterCaptureOptions = {},
): Promise<Blob> {
  assertRgba(rgba, dimensions);
  if (options.signal?.aborted) throw abortError();
  if (dimensions.width * dimensions.height > STUDIO_VRM_CAPTURE_MAIN_THREAD_MAX_PIXELS) {
    throw new RangeError("VRM PNG 메인 스레드 인코더의 픽셀 예산을 초과했습니다.");
  }
  if (typeof document === "undefined") {
    throw new Error("VRM PNG 메인 스레드 인코더를 사용할 수 없습니다.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext("2d");
  if (!context || typeof canvas.toBlob !== "function") {
    canvas.width = 1;
    canvas.height = 1;
    throw new Error("VRM PNG 메인 스레드 인코더를 준비하지 못했습니다.");
  }

  try {
    const imageData = context.createImageData(dimensions.width, dimensions.height);
    imageData.data.set(rgba);
    context.putImageData(imageData, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) => {
      let settled = false;
      const timeoutMs = boundedTimeoutMs(options.timeoutMs);
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        options.signal?.removeEventListener("abort", handleAbort);
        callback();
      };
      const handleAbort = () => finish(() => reject(abortError()));
      const timeoutId = setTimeout(() => finish(() => reject(
        timeoutError("VRM PNG 메인 스레드 인코딩 시간이 초과되었습니다."),
      )), timeoutMs);
      options.signal?.addEventListener("abort", handleAbort, { once: true });
      canvas.toBlob((result) => {
        if (options.signal?.aborted) finish(() => reject(abortError()));
        else if (result) finish(() => resolve(result));
        else finish(() => reject(new Error("VRM PNG 메인 스레드 인코딩에 실패했습니다.")));
      }, "image/png");
    });
    await validatePngBlob(png, dimensions, options.signal);
    return png;
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}

export function readStudioVrmPngBlobAsDataUrl(
  png: Blob,
  options: StudioVrmRasterCaptureOptions = {},
): Promise<string> {
  const { signal } = options;
  if (signal?.aborted) return Promise.reject(abortError());
  if (
    png.type !== "image/png" || png.size < 24 ||
    png.size > STUDIO_BG3D_SHOT_PNG_WORKER_MAX_OUTPUT_BYTES
  ) {
    return Promise.reject(new TypeError("VRM PNG 결과가 올바르지 않습니다."));
  }
  if (typeof FileReader !== "function") {
    return Promise.reject(new Error("VRM PNG 직렬화를 지원하지 않는 브라우저입니다."));
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      signal?.removeEventListener("abort", handleAbort);
      reader.onload = null;
      reader.onerror = null;
      reader.onabort = null;
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const abortReader = () => {
      try {
        reader.abort();
      } catch {
        // Some host shims throw after the read has already completed.
      }
    };
    const handleAbort = () => finish(() => {
      abortReader();
      reject(abortError());
    });
    const handleTimeout = () => finish(() => {
      abortReader();
      reject(timeoutError("VRM PNG 직렬화 시간이 초과되었습니다."));
    });
    reader.onload = () => {
      const value = reader.result;
      if (typeof value !== "string" || !value.startsWith("data:image/png;base64,")) {
        finish(() => reject(new TypeError("VRM PNG data URL이 올바르지 않습니다.")));
        return;
      }
      finish(() => resolve(value));
    };
    reader.onerror = () => finish(() => reject(new Error("VRM PNG를 직렬화하지 못했습니다.")));
    reader.onabort = () => finish(() => reject(abortError()));
    signal?.addEventListener("abort", handleAbort, { once: true });
    if (signal?.aborted) handleAbort();
    else {
      timeoutId = setTimeout(handleTimeout, boundedTimeoutMs(options.timeoutMs));
      reader.readAsDataURL(png);
    }
  });
}

const DEFAULT_DEPENDENCIES: StudioVrmRasterCaptureDependencies = {
  encodePngInWorker: encodeStudioBg3dShotPngInWorker,
  encodePngOnMainThread: encodeStudioVrmCapturePngOnMainThread,
  blobToDataUrl: readStudioVrmPngBlobAsDataUrl,
};

/**
 * Encode a top-down RGBA snapshot off-main and retain the verified PNG Blob. Surface-paint
 * persistence uses this boundary so compressed bytes can be hashed and stored without first
 * inflating them into a data URL.
 * The backend is selected once before execution. Worker failures are terminal and never rerun on
 * the main thread. Product callers omit `encoderBackend`, selecting Worker.
 */
export async function encodeStudioVrmCapturePngBlob(
  rgba: Uint8ClampedArray,
  dimensions: StudioVrmRasterCaptureDimensions,
  options: StudioVrmRasterCaptureOptions = {},
  dependencies: StudioVrmRasterCaptureDependencies = DEFAULT_DEPENDENCIES,
): Promise<Blob> {
  assertRgba(rgba, dimensions);
  if (options.signal?.aborted) throw abortError();
  const layer: StudioBg3dLtRasterLayer = {
    role: "color",
    width: dimensions.width,
    height: dimensions.height,
    data: rgba,
  };
  const encoderBackend = options.encoderBackend ?? "worker";
  if (encoderBackend !== "worker" && encoderBackend !== "main-thread") {
    throw new TypeError("VRM PNG 인코더 백엔드가 올바르지 않습니다.");
  }
  const png = encoderBackend === "main-thread"
    ? await dependencies.encodePngOnMainThread(rgba, dimensions, options)
    : await dependencies.encodePngInWorker([layer], options);
  await validatePngBlob(png, dimensions, options.signal);
  return png;
}

/** Encode off-main, then serialize only the already-compressed and verified PNG Blob. */
export async function encodeStudioVrmCapturePngDataUrl(
  rgba: Uint8ClampedArray,
  dimensions: StudioVrmRasterCaptureDimensions,
  options: StudioVrmRasterCaptureOptions = {},
  dependencies: StudioVrmRasterCaptureDependencies = DEFAULT_DEPENDENCIES,
): Promise<string> {
  const png = await encodeStudioVrmCapturePngBlob(
    rgba,
    dimensions,
    options,
    dependencies,
  );
  return dependencies.blobToDataUrl(png, options);
}
