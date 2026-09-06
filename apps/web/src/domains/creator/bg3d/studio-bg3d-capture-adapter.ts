/**
 * Renderer-neutral asynchronous capture boundary for Studio's 3D line-and-tone pipeline.
 *
 * Engine adapters own rendering and GPU/DOM readback. This module owns the bounded request/result
 * contract so WebGL and a future WebGPU adapter must produce the same top-down RGBA/depth raster.
 */

import { STUDIO_BG3D_LT_RENDER_MAX_PIXELS } from "./studio-bg3d-lt-render";

export type StudioBg3dCaptureEngineId =
  | "three"
  | "babylon"
  | "playcanvas"
  | "filament"
  | "cesium";
export type StudioBg3dCaptureGraphicsApi = "webgl2" | "webgpu";
export type StudioBg3dCaptureBackend =
  | "three-webgl"
  | "three-webgpu"
  | "babylon-webgl"
  | "babylon-webgpu"
  | "playcanvas-webgl"
  | "playcanvas-webgpu"
  | "filament-webgl"
  | "filament-webgpu"
  | "cesium-webgl"
  | "cesium-webgpu";

/**
 * Portable capture semantics used by batch-plan identity and engine conformance tests.
 * Increment the profile when color transfer, alpha ownership, depth meaning, or row order changes.
 */
export const STUDIO_BG3D_CAPTURE_PROFILE_RGBA8_DEPTH_V1 =
  "studio-rgba8-straight-srgb-topdown-depth-f32-v1";
/** App-owned revision; bump when adapter orchestration/shaders/readback change independently. */
export const STUDIO_BG3D_THREE_WEBGL_CAPTURE_IMPLEMENTATION_V1 =
  "studio-three-webgl-capture-adapter-v1";

export interface StudioBg3dCaptureSize {
  readonly width: number;
  readonly height: number;
}

export interface StudioBg3dCaptureRequest extends StudioBg3dCaptureSize {
  readonly background: {
    readonly color: string;
    readonly alpha: number;
  };
  readonly includeDepth: boolean;
}

export interface StudioBg3dCapturedRaster extends StudioBg3dCaptureSize {
  /** Fresh, tightly packed, top-down, non-premultiplied RGBA bytes. */
  readonly rgba: Uint8Array | Uint8ClampedArray;
  /** Fresh top-down normalized depth samples. Required when includeDepth is true. */
  readonly depth?: Float32Array;
}

export interface StudioBg3dCaptureAdapter {
  readonly backend: StudioBg3dCaptureBackend;
  readonly engineId: StudioBg3dCaptureEngineId;
  readonly engineVersion: string;
  readonly implementationRevision: string;
  readonly graphicsApi: StudioBg3dCaptureGraphicsApi;
  readonly profileId: typeof STUDIO_BG3D_CAPTURE_PROFILE_RGBA8_DEPTH_V1;
  getSourceSize(): StudioBg3dCaptureSize;
  capture(request: StudioBg3dCaptureRequest): Promise<StudioBg3dCapturedRaster>;
}

export interface StudioBg3dCaptureOperationOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface AcquireStudioBg3dCaptureAdapterAfterViewTransitionInput {
  /** Reads the adapter owned by the View that is current after React commits the transition. */
  readonly readAdapter: () => StudioBg3dCaptureAdapter | null;
  /** Returns false when the editor session closed while the transition was settling. */
  readonly isActive: () => boolean;
  /** One browser paint boundary; two are required for R3F View teardown and passive effects. */
  readonly waitForPaintFrame: () => Promise<void>;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/iu;
function frozenBackendIdentity(
  engineId: StudioBg3dCaptureEngineId,
  graphicsApi: StudioBg3dCaptureGraphicsApi,
): readonly [StudioBg3dCaptureEngineId, StudioBg3dCaptureGraphicsApi] {
  return Object.freeze([engineId, graphicsApi]);
}

const BACKEND_IDENTITY = new Map<StudioBg3dCaptureBackend, readonly [
  StudioBg3dCaptureEngineId,
  StudioBg3dCaptureGraphicsApi,
]>([
  ["three-webgl", frozenBackendIdentity("three", "webgl2")],
  ["three-webgpu", frozenBackendIdentity("three", "webgpu")],
  ["babylon-webgl", frozenBackendIdentity("babylon", "webgl2")],
  ["babylon-webgpu", frozenBackendIdentity("babylon", "webgpu")],
  ["playcanvas-webgl", frozenBackendIdentity("playcanvas", "webgl2")],
  ["playcanvas-webgpu", frozenBackendIdentity("playcanvas", "webgpu")],
  ["filament-webgl", frozenBackendIdentity("filament", "webgl2")],
  ["filament-webgpu", frozenBackendIdentity("filament", "webgpu")],
  ["cesium-webgl", frozenBackendIdentity("cesium", "webgl2")],
  ["cesium-webgpu", frozenBackendIdentity("cesium", "webgpu")],
]);
const PROFILE_SET = new Set([STUDIO_BG3D_CAPTURE_PROFILE_RGBA8_DEPTH_V1]);
const IDENTITY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,159}$/u;
const CAPTURE_ADAPTER_STABLE_SAMPLES = 3;
const CAPTURE_ADAPTER_MAX_SETTLE_SAMPLES = 12;

export function getStudioBg3dCaptureBackendIdentity(
  backend: StudioBg3dCaptureBackend,
): readonly [StudioBg3dCaptureEngineId, StudioBg3dCaptureGraphicsApi] | null {
  return BACKEND_IDENTITY.get(backend) ?? null;
}

function captureOperationError(name: "AbortError" | "TimeoutError"): Error {
  const error = new Error(
    name === "AbortError" ? "3D 캡처를 취소했습니다." : "3D 캡처 제한 시간이 초과되었습니다.",
  );
  error.name = name;
  return error;
}

function throwIfCaptureOperationAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw captureOperationError("AbortError");
}

/** Stops waiting on a paint/GPU/encoding phase so the editor can always release its capture lease. */
export function waitForStudioBg3dCapturePhase<Value>(
  phase: PromiseLike<Value>,
  options: StudioBg3dCaptureOperationOptions = {},
): Promise<Value> {
  if (options.signal?.aborted) return Promise.reject(captureOperationError("AbortError"));
  const timeoutMs = options.timeoutMs === undefined
    ? null
    : Math.max(250, Math.min(120_000, Math.floor(options.timeoutMs)));
  return new Promise<Value>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (timeout !== null) clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const abort = () => finish(() => reject(captureOperationError("AbortError")));
    options.signal?.addEventListener("abort", abort, { once: true });
    if (timeoutMs !== null) {
      timeout = setTimeout(
        () => finish(() => reject(captureOperationError("TimeoutError"))),
        timeoutMs,
      );
    }
    void Promise.resolve(phase).then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

function assertSize(size: unknown, label: string, enforcePixelBudget: boolean): asserts size is StudioBg3dCaptureSize {
  if (!size || typeof size !== "object") throw new TypeError(`${label} must be an object.`);
  const { width, height } = size as Partial<StudioBg3dCaptureSize>;
  if (!Number.isSafeInteger(width) || (width ?? 0) < 1) {
    throw new RangeError(`${label} width must be a positive safe integer.`);
  }
  if (!Number.isSafeInteger(height) || (height ?? 0) < 1) {
    throw new RangeError(`${label} height must be a positive safe integer.`);
  }
  const pixels = width! * height!;
  if (!Number.isSafeInteger(pixels)) throw new RangeError(`${label} pixel count is unsafe.`);
  if (enforcePixelBudget && pixels > STUDIO_BG3D_LT_RENDER_MAX_PIXELS) {
    throw new RangeError(`${label} exceeds the raster pixel budget.`);
  }
}

function assertAdapter(adapter: unknown): asserts adapter is StudioBg3dCaptureAdapter {
  if (!adapter || typeof adapter !== "object") {
    throw new TypeError("3D capture adapter must be an object.");
  }
  const candidate = adapter as Partial<StudioBg3dCaptureAdapter>;
  const expectedIdentity = BACKEND_IDENTITY.get(candidate.backend as StudioBg3dCaptureBackend);
  if (!expectedIdentity) {
    throw new TypeError("3D capture adapter backend is unsupported.");
  }
  if (candidate.engineId !== expectedIdentity[0] || candidate.graphicsApi !== expectedIdentity[1] ||
    typeof candidate.engineVersion !== "string" ||
    !IDENTITY_PATTERN.test(candidate.engineVersion) ||
    typeof candidate.implementationRevision !== "string" ||
    !IDENTITY_PATTERN.test(candidate.implementationRevision)) {
    throw new TypeError("3D capture adapter engine identity is unsupported or inconsistent.");
  }
  if (!PROFILE_SET.has(candidate.profileId as typeof STUDIO_BG3D_CAPTURE_PROFILE_RGBA8_DEPTH_V1)) {
    throw new TypeError("3D capture adapter profile is unsupported.");
  }
  if (typeof candidate.getSourceSize !== "function" || typeof candidate.capture !== "function") {
    throw new TypeError("3D capture adapter methods are unavailable.");
  }
}

/**
 * A quad-to-single capture transition replaces every R3F View and therefore its capture adapter.
 * Never retain the pre-transition adapter: wait for the replacement View to commit, then require
 * the same adapter and framebuffer dimensions across consecutive paints. ResizeObserver and R3F's
 * renderer resize can trail the React commit by more than two frames on a first lazy mount.
 */
export async function acquireStudioBg3dCaptureAdapterAfterViewTransition(
  input: AcquireStudioBg3dCaptureAdapterAfterViewTransitionInput
): Promise<StudioBg3dCaptureAdapter | null> {
  if (
    !input ||
    typeof input !== "object" ||
    typeof input.readAdapter !== "function" ||
    typeof input.isActive !== "function" ||
    typeof input.waitForPaintFrame !== "function"
  ) {
    throw new TypeError("3D capture View transition callbacks are required.");
  }
  throwIfCaptureOperationAborted(input.signal);
  await waitForStudioBg3dCapturePhase(input.waitForPaintFrame(), input);
  throwIfCaptureOperationAborted(input.signal);
  await waitForStudioBg3dCapturePhase(input.waitForPaintFrame(), input);
  let previousAdapter: StudioBg3dCaptureAdapter | null = null;
  let previousSize: StudioBg3dCaptureSize | null = null;
  let stableSamples = 0;
  for (let sample = 0; sample < CAPTURE_ADAPTER_MAX_SETTLE_SAMPLES; sample += 1) {
    throwIfCaptureOperationAborted(input.signal);
    if (!input.isActive()) return null;
    const adapter = input.readAdapter();
    if (adapter) {
      assertAdapter(adapter);
      const size = adapter.getSourceSize();
      assertSize(size, "3D capture source", false);
      if (
        adapter === previousAdapter &&
        previousSize?.width === size.width &&
        previousSize.height === size.height
      ) {
        stableSamples += 1;
      } else {
        previousAdapter = adapter;
        previousSize = { width: size.width, height: size.height };
        stableSamples = 1;
      }
      if (stableSamples >= CAPTURE_ADAPTER_STABLE_SAMPLES) return adapter;
    } else {
      previousAdapter = null;
      previousSize = null;
      stableSamples = 0;
    }
    if (sample + 1 < CAPTURE_ADAPTER_MAX_SETTLE_SAMPLES) {
      await waitForStudioBg3dCapturePhase(input.waitForPaintFrame(), input);
    }
  }
  return null;
}

function assertRequest(request: unknown): asserts request is StudioBg3dCaptureRequest {
  assertSize(request, "3D capture request", true);
  const candidate = request as Partial<StudioBg3dCaptureRequest>;
  if (typeof candidate.includeDepth !== "boolean") {
    throw new TypeError("3D capture includeDepth must be a boolean.");
  }
  if (!candidate.background || typeof candidate.background !== "object") {
    throw new TypeError("3D capture background must be an object.");
  }
  if (typeof candidate.background.color !== "string" || !HEX_COLOR_PATTERN.test(candidate.background.color)) {
    throw new TypeError("3D capture background color must be a six-digit hex color.");
  }
  if (
    typeof candidate.background.alpha !== "number" ||
    !Number.isFinite(candidate.background.alpha) ||
    candidate.background.alpha < 0 ||
    candidate.background.alpha > 1
  ) {
    throw new RangeError("3D capture background alpha must be in [0, 1].");
  }
}

function assertCapturedRaster(
  raster: unknown,
  request: StudioBg3dCaptureRequest
): asserts raster is StudioBg3dCapturedRaster {
  assertSize(raster, "3D captured raster", true);
  const candidate = raster as Partial<StudioBg3dCapturedRaster>;
  if (candidate.width !== request.width || candidate.height !== request.height) {
    throw new RangeError("3D captured raster dimensions must match the request.");
  }
  if (!(candidate.rgba instanceof Uint8Array || candidate.rgba instanceof Uint8ClampedArray)) {
    throw new TypeError("3D captured raster RGBA must be an 8-bit typed array.");
  }
  const pixels = request.width * request.height;
  if (candidate.rgba.length !== pixels * 4) {
    throw new RangeError("3D captured raster RGBA length must equal width * height * 4.");
  }
  if (request.includeDepth && !(candidate.depth instanceof Float32Array)) {
    throw new TypeError("3D captured raster depth is required when requested.");
  }
  if (!request.includeDepth && candidate.depth !== undefined) {
    throw new TypeError("3D captured raster returned unrequested depth.");
  }
  if (candidate.depth) {
    if (candidate.depth.length !== pixels) {
      throw new RangeError("3D captured raster depth length must equal width * height.");
    }
    for (const value of candidate.depth) {
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new RangeError("3D captured raster depth values must be finite and normalized.");
      }
    }
  }
}

export function getStudioBg3dCaptureSourceSize(adapter: StudioBg3dCaptureAdapter): StudioBg3dCaptureSize {
  assertAdapter(adapter);
  const size = adapter.getSourceSize();
  assertSize(size, "3D capture source", false);
  return Object.freeze({ width: size.width, height: size.height });
}

export async function captureStudioBg3dRaster(
  adapter: StudioBg3dCaptureAdapter,
  request: StudioBg3dCaptureRequest,
  options: StudioBg3dCaptureOperationOptions = {},
): Promise<StudioBg3dCapturedRaster> {
  assertAdapter(adapter);
  assertRequest(request);
  const requestSnapshot = Object.freeze({
    width: request.width,
    height: request.height,
    includeDepth: request.includeDepth,
    background: Object.freeze({ ...request.background }),
  });
  throwIfCaptureOperationAborted(options.signal);
  const captured = await waitForStudioBg3dCapturePhase(
    adapter.capture(requestSnapshot),
    options,
  );
  assertCapturedRaster(captured, requestSnapshot);

  // WebGPU mapped buffers and renderer pools may be recycled after the adapter Promise settles.
  // Own both arrays at this boundary so later engine work cannot mutate LT input behind Studio.
  return Object.freeze({
    width: captured.width,
    height: captured.height,
    rgba: new Uint8ClampedArray(captured.rgba),
    ...(captured.depth ? { depth: new Float32Array(captured.depth) } : {}),
  });
}
