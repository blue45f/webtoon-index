/**
 * WebGPU partial-upload foundation for VRM surface-paint RGBA8 textures.
 *
 * This module deliberately uses small structural interfaces instead of DOM WebGPU globals so the
 * planner and lifetime rules remain testable in Node. It does not choose the CanvasTexture
 * fallback; callers receive an explicit unsupported/rejected result and retain that authority.
 */

export const STUDIO_VRM_TEXTURE_PAINT_GPU_UPLOAD_LIMITS = Object.freeze({
  maxDimension: 4_096,
  maxPixels: 16_777_216,
  maxSourceBytes: 67_108_864,
  maxStagingBytes: 67_108_864,
});

export const STUDIO_VRM_TEXTURE_PAINT_GPU_BYTES_PER_PIXEL = 4;
export const STUDIO_VRM_TEXTURE_PAINT_GPU_ROW_ALIGNMENT = 256;
export const DEFAULT_STUDIO_VRM_TEXTURE_PAINT_FULL_UPLOAD_THRESHOLD = 0.6;

export interface StudioVrmTexturePaintGpuUploadLimits {
  readonly maxDimension: number;
  readonly maxPixels: number;
  readonly maxSourceBytes: number;
  readonly maxStagingBytes: number;
}

export interface StudioVrmTexturePaintGpuDirtyRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioVrmTexturePaintGpuUploadPlan {
  readonly generation: number;
  readonly textureWidth: number;
  readonly textureHeight: number;
  readonly requestedRect: StudioVrmTexturePaintGpuDirtyRect;
  readonly uploadRect: StudioVrmTexturePaintGpuDirtyRect;
  readonly mode: "partial" | "full";
  readonly bytesPerRow: number;
  readonly rowsPerImage: number;
  readonly byteLength: number;
  readonly dirtyPixelRatio: number;
  readonly stagingByteRatio: number;
  readonly fullUploadThreshold: number;
}

export interface StudioVrmTexturePaintGpuUploadPlanInput {
  /** Full, tightly packed, straight-alpha RGBA8 texture snapshot. */
  readonly rgba: Uint8Array | Uint8ClampedArray;
  readonly textureWidth: number;
  readonly textureHeight: number;
  readonly dirtyRect: StudioVrmTexturePaintGpuDirtyRect;
  readonly generation: number;
}

export interface StudioVrmTexturePaintGpuUploadPlanOptions {
  /** Full upload is selected when dirty coverage or aligned staging cost reaches this ratio. */
  readonly fullUploadThreshold?: number;
  /** Callers may lower, but never raise, the hard texture and staging budgets. */
  readonly limits?: Partial<StudioVrmTexturePaintGpuUploadLimits>;
}

export interface StudioVrmTexturePaintGpuTextureLike {
  /** Nominal marker for embedding adapters. No WebGPU global type is required. */
  readonly label?: string;
}

export interface StudioVrmTexturePaintGpuTextureDestination {
  readonly texture: StudioVrmTexturePaintGpuTextureLike;
  readonly mipLevel: 0;
  readonly origin: Readonly<{ x: number; y: number; z: 0 }>;
  readonly aspect: "all";
}

export interface StudioVrmTexturePaintGpuDataLayout {
  readonly offset: 0;
  readonly bytesPerRow: number;
  readonly rowsPerImage: number;
}

export interface StudioVrmTexturePaintGpuExtent {
  readonly width: number;
  readonly height: number;
  readonly depthOrArrayLayers: 1;
}

export interface StudioVrmTexturePaintGpuQueueLike {
  writeTexture(
    destination: StudioVrmTexturePaintGpuTextureDestination,
    data: Uint8Array,
    dataLayout: StudioVrmTexturePaintGpuDataLayout,
    size: StudioVrmTexturePaintGpuExtent,
  ): void;
  /** Optional completion seam used to detect device loss/stale generations after enqueue. */
  onSubmittedWorkDone?(): PromiseLike<void>;
}

export interface StudioVrmTexturePaintGpuDeviceLike {
  readonly queue: StudioVrmTexturePaintGpuQueueLike;
  /** WebGPU's device-lost promise, expressed structurally for Node tests. */
  readonly lost?: PromiseLike<unknown>;
}

export interface StudioVrmTexturePaintGpuUploadExecution {
  readonly device: StudioVrmTexturePaintGpuDeviceLike | null | undefined;
  readonly texture: StudioVrmTexturePaintGpuTextureLike;
  readonly getCurrentGeneration: () => number;
  readonly signal?: AbortSignal;
}

export type StudioVrmTexturePaintGpuUploadExecutionResult =
  | Readonly<{
      status: "uploaded";
      mode: "partial" | "full";
      generation: number;
      byteLength: number;
      uploadRect: StudioVrmTexturePaintGpuDirtyRect;
    }>
  | Readonly<{
      status: "unsupported";
      reason: "webgpu-unavailable";
    }>
  | Readonly<{
      status: "rejected";
      reason:
        | "aborted"
        | "device-lost"
        | "generation-check-failed"
        | "invalid-plan"
        | "stale-generation"
        | "upload-failed";
    }>;

export type StudioVrmTexturePaintGpuUploadErrorCode =
  | "BYTE_LENGTH_INVALID"
  | "DIMENSION_INVALID"
  | "DIRTY_RECT_INVALID"
  | "GENERATION_INVALID"
  | "LIMIT_EXCEEDED"
  | "LIMIT_INVALID"
  | "SOURCE_INVALID"
  | "THRESHOLD_INVALID";

const ERROR_MESSAGES: Readonly<
  Record<StudioVrmTexturePaintGpuUploadErrorCode, string>
> = Object.freeze({
  BYTE_LENGTH_INVALID: "VRM 표면 페인팅 RGBA8 바이트 길이가 텍스처 크기와 다릅니다.",
  DIMENSION_INVALID: "VRM 표면 페인팅 GPU 텍스처 크기가 올바르지 않습니다.",
  DIRTY_RECT_INVALID: "VRM 표면 페인팅 GPU dirty rect가 텍스처 범위를 벗어났습니다.",
  GENERATION_INVALID: "VRM 표면 페인팅 GPU generation이 올바르지 않습니다.",
  LIMIT_EXCEEDED: "VRM 표면 페인팅 GPU 업로드가 안전 예산을 초과했습니다.",
  LIMIT_INVALID: "VRM 표면 페인팅 GPU 업로드 안전 한도가 올바르지 않습니다.",
  SOURCE_INVALID: "VRM 표면 페인팅 GPU 원본은 RGBA8 typed array여야 합니다.",
  THRESHOLD_INVALID: "VRM 표면 페인팅 full-upload 임계값이 올바르지 않습니다.",
});

export class StudioVrmTexturePaintGpuUploadError extends Error {
  constructor(readonly code: StudioVrmTexturePaintGpuUploadErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "StudioVrmTexturePaintGpuUploadError";
  }
}

interface DeviceLossState {
  lost: boolean;
  readonly completion: Promise<"device-lost">;
}

const stagingByPlan = new WeakMap<
  StudioVrmTexturePaintGpuUploadPlan,
  Uint8Array<ArrayBuffer>
>();
const deviceLossByDevice = new WeakMap<object, DeviceLossState>();

function fail(code: StudioVrmTexturePaintGpuUploadErrorCode): never {
  throw new StudioVrmTexturePaintGpuUploadError(code);
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function exactDataRecord(
  value: unknown,
  keys: readonly string[],
): value is Readonly<Record<string, unknown>> {
  if (!isPlainRecord(value)) return false;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return false;
  }
  const actual = Object.keys(descriptors).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
    && actual.every((key) => {
      const descriptor = descriptors[key];
      return descriptor !== undefined && "value" in descriptor;
    });
}

function safeProduct(left: number, right: number): number | null {
  const result = left * right;
  return Number.isSafeInteger(result) ? result : null;
}

function resolveLimit(value: number | undefined, maximum: number): number {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail("LIMIT_INVALID");
  }
  return value;
}

function resolveLimits(
  value: Partial<StudioVrmTexturePaintGpuUploadLimits> | undefined,
): StudioVrmTexturePaintGpuUploadLimits {
  if (value !== undefined && !isPlainRecord(value)) fail("LIMIT_INVALID");
  return Object.freeze({
    maxDimension: resolveLimit(
      value?.maxDimension,
      STUDIO_VRM_TEXTURE_PAINT_GPU_UPLOAD_LIMITS.maxDimension,
    ),
    maxPixels: resolveLimit(
      value?.maxPixels,
      STUDIO_VRM_TEXTURE_PAINT_GPU_UPLOAD_LIMITS.maxPixels,
    ),
    maxSourceBytes: resolveLimit(
      value?.maxSourceBytes,
      STUDIO_VRM_TEXTURE_PAINT_GPU_UPLOAD_LIMITS.maxSourceBytes,
    ),
    maxStagingBytes: resolveLimit(
      value?.maxStagingBytes,
      STUDIO_VRM_TEXTURE_PAINT_GPU_UPLOAD_LIMITS.maxStagingBytes,
    ),
  });
}

function resolveThreshold(value: number | undefined): number {
  const threshold = value ?? DEFAULT_STUDIO_VRM_TEXTURE_PAINT_FULL_UPLOAD_THRESHOLD;
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    fail("THRESHOLD_INVALID");
  }
  return threshold;
}

function assertGeneration(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) fail("GENERATION_INVALID");
}

function canonicalDirtyRect(
  value: unknown,
  textureWidth: number,
  textureHeight: number,
): StudioVrmTexturePaintGpuDirtyRect {
  if (!exactDataRecord(value, ["height", "width", "x", "y"])) {
    fail("DIRTY_RECT_INVALID");
  }
  const { x, y, width, height } = value;
  if (
    !Number.isSafeInteger(x)
    || !Number.isSafeInteger(y)
    || !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || (x as number) < 0
    || (y as number) < 0
    || (width as number) < 1
    || (height as number) < 1
    || (x as number) > textureWidth - (width as number)
    || (y as number) > textureHeight - (height as number)
  ) {
    fail("DIRTY_RECT_INVALID");
  }
  return Object.freeze({
    x: x as number,
    y: y as number,
    width: width as number,
    height: height as number,
  });
}

function alignedBytesPerRow(width: number): number {
  const unaligned = safeProduct(
    width,
    STUDIO_VRM_TEXTURE_PAINT_GPU_BYTES_PER_PIXEL,
  );
  if (unaligned === null) fail("LIMIT_EXCEEDED");
  const aligned = Math.ceil(
    unaligned / STUDIO_VRM_TEXTURE_PAINT_GPU_ROW_ALIGNMENT,
  ) * STUDIO_VRM_TEXTURE_PAINT_GPU_ROW_ALIGNMENT;
  if (!Number.isSafeInteger(aligned)) fail("LIMIT_EXCEEDED");
  return aligned;
}

function copyAlignedRect(
  source: Uint8Array | Uint8ClampedArray,
  textureWidth: number,
  rect: StudioVrmTexturePaintGpuDirtyRect,
  bytesPerRow: number,
  byteLength: number,
): Uint8Array<ArrayBuffer> {
  const staging = new Uint8Array(byteLength);
  const tightRowBytes = rect.width * STUDIO_VRM_TEXTURE_PAINT_GPU_BYTES_PER_PIXEL;
  for (let row = 0; row < rect.height; row += 1) {
    const sourceOffset = (
      (rect.y + row) * textureWidth + rect.x
    ) * STUDIO_VRM_TEXTURE_PAINT_GPU_BYTES_PER_PIXEL;
    staging.set(
      source.subarray(sourceOffset, sourceOffset + tightRowBytes),
      row * bytesPerRow,
    );
  }
  return staging;
}

function planResult(
  input: StudioVrmTexturePaintGpuUploadPlanInput,
  options: StudioVrmTexturePaintGpuUploadPlanOptions,
): StudioVrmTexturePaintGpuUploadPlan {
  if (
    !isPlainRecord(input)
    || !(
      input.rgba instanceof Uint8Array
      || input.rgba instanceof Uint8ClampedArray
    )
    || (
      typeof SharedArrayBuffer !== "undefined"
      && input.rgba.buffer instanceof SharedArrayBuffer
    )
  ) {
    fail("SOURCE_INVALID");
  }
  const limits = resolveLimits(options.limits);
  const threshold = resolveThreshold(options.fullUploadThreshold);
  const { textureWidth, textureHeight } = input;
  if (
    !Number.isSafeInteger(textureWidth)
    || !Number.isSafeInteger(textureHeight)
    || textureWidth < 1
    || textureHeight < 1
    || textureWidth > limits.maxDimension
    || textureHeight > limits.maxDimension
  ) {
    fail("DIMENSION_INVALID");
  }
  const pixels = safeProduct(textureWidth, textureHeight);
  if (pixels === null || pixels > limits.maxPixels) fail("LIMIT_EXCEEDED");
  const sourceBytes = safeProduct(
    pixels,
    STUDIO_VRM_TEXTURE_PAINT_GPU_BYTES_PER_PIXEL,
  );
  if (
    sourceBytes === null
    || sourceBytes > limits.maxSourceBytes
    || input.rgba.byteLength !== sourceBytes
  ) {
    fail(
      sourceBytes !== null && input.rgba.byteLength !== sourceBytes
        ? "BYTE_LENGTH_INVALID"
        : "LIMIT_EXCEEDED",
    );
  }
  assertGeneration(input.generation);
  const requestedRect = canonicalDirtyRect(
    input.dirtyRect,
    textureWidth,
    textureHeight,
  );
  const fullRect = Object.freeze({
    x: 0,
    y: 0,
    width: textureWidth,
    height: textureHeight,
  });
  const partialBytesPerRow = alignedBytesPerRow(requestedRect.width);
  const partialByteLength = safeProduct(
    partialBytesPerRow,
    requestedRect.height,
  );
  const fullBytesPerRow = alignedBytesPerRow(textureWidth);
  const fullByteLength = safeProduct(fullBytesPerRow, textureHeight);
  if (partialByteLength === null || fullByteLength === null) {
    fail("LIMIT_EXCEEDED");
  }
  const dirtyPixels = requestedRect.width * requestedRect.height;
  const dirtyPixelRatio = dirtyPixels / pixels;
  const stagingByteRatio = partialByteLength / fullByteLength;
  const mode = (
    dirtyPixelRatio >= threshold
    || stagingByteRatio >= threshold
  )
    ? "full"
    : "partial";
  const uploadRect = mode === "full" ? fullRect : requestedRect;
  const bytesPerRow = mode === "full" ? fullBytesPerRow : partialBytesPerRow;
  const byteLength = mode === "full" ? fullByteLength : partialByteLength;
  if (byteLength > limits.maxStagingBytes) fail("LIMIT_EXCEEDED");
  const staging = copyAlignedRect(
    input.rgba,
    textureWidth,
    uploadRect,
    bytesPerRow,
    byteLength,
  );
  const plan: StudioVrmTexturePaintGpuUploadPlan = Object.freeze({
    generation: input.generation,
    textureWidth,
    textureHeight,
    requestedRect,
    uploadRect,
    mode,
    bytesPerRow,
    rowsPerImage: uploadRect.height,
    byteLength,
    dirtyPixelRatio,
    stagingByteRatio,
    fullUploadThreshold: threshold,
  });
  stagingByPlan.set(plan, staging);
  return plan;
}

/**
 * Validates and snapshots a tightly packed RGBA8 source into a 256-byte-row-aligned private
 * staging allocation. The returned immutable plan never exposes mutable pixel bytes.
 */
export function createStudioVrmTexturePaintGpuUploadPlan(
  input: StudioVrmTexturePaintGpuUploadPlanInput,
  options: StudioVrmTexturePaintGpuUploadPlanOptions = {},
): StudioVrmTexturePaintGpuUploadPlan {
  return planResult(input, options);
}

function unsupported(): StudioVrmTexturePaintGpuUploadExecutionResult {
  return Object.freeze({
    status: "unsupported",
    reason: "webgpu-unavailable",
  });
}

function rejected(
  reason: Extract<
    StudioVrmTexturePaintGpuUploadExecutionResult,
    { status: "rejected" }
  >["reason"],
): StudioVrmTexturePaintGpuUploadExecutionResult {
  return Object.freeze({ status: "rejected", reason });
}

function readGeneration(
  getCurrentGeneration: () => number,
): number | null {
  try {
    const value = getCurrentGeneration();
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function deviceLossState(
  device: StudioVrmTexturePaintGpuDeviceLike,
): DeviceLossState {
  const key = device as object;
  const existing = deviceLossByDevice.get(key);
  if (existing) return existing;
  let lostPromise: PromiseLike<unknown> | undefined;
  try {
    lostPromise = device.lost;
  } catch {
    lostPromise = Promise.reject(new Error("device-lost"));
  }
  const state = { lost: false } as DeviceLossState;
  Object.defineProperty(state, "completion", {
    enumerable: true,
    configurable: false,
    writable: false,
    value: lostPromise === undefined
      ? new Promise<"device-lost">(() => undefined)
      : Promise.resolve(lostPromise).then(
          () => {
            state.lost = true;
            return "device-lost";
          },
          () => {
            state.lost = true;
            return "device-lost";
          },
        ),
  });
  deviceLossByDevice.set(key, state);
  return state;
}

function abortCompletion(
  signal: AbortSignal | undefined,
): Readonly<{
  completion: Promise<"aborted">;
  cleanup: () => void;
}> {
  if (!signal) {
    return {
      completion: new Promise<"aborted">(() => undefined),
      cleanup: () => undefined,
    };
  }
  let listener: (() => void) | null = null;
  const completion = new Promise<"aborted">((resolve) => {
    if (signal.aborted) {
      resolve("aborted");
      return;
    }
    listener = () => resolve("aborted");
    signal.addEventListener("abort", listener, { once: true });
  });
  return {
    completion,
    cleanup: () => {
      if (listener) signal.removeEventListener("abort", listener);
      listener = null;
    },
  };
}

function structuralDevice(
  value: StudioVrmTexturePaintGpuDeviceLike | null | undefined,
): StudioVrmTexturePaintGpuDeviceLike | null {
  if (typeof value !== "object" || value === null) return null;
  try {
    if (
      typeof value.queue !== "object"
      || value.queue === null
      || typeof value.queue.writeTexture !== "function"
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return value;
}

function structuralTexture(
  value: StudioVrmTexturePaintGpuTextureLike,
): value is StudioVrmTexturePaintGpuTextureLike {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

/**
 * Executes one private staging plan through queue.writeTexture. Any stale generation, abort,
 * device loss, or queue failure is reported as rejected so the caller can keep CanvasTexture
 * authoritative. A missing structural device is reported separately as unsupported.
 */
export async function executeStudioVrmTexturePaintGpuUpload(
  plan: StudioVrmTexturePaintGpuUploadPlan,
  execution: StudioVrmTexturePaintGpuUploadExecution,
): Promise<StudioVrmTexturePaintGpuUploadExecutionResult> {
  const staging = (
    typeof plan === "object" && plan !== null
      ? stagingByPlan.get(plan)
      : undefined
  );
  if (!staging || !Object.isFrozen(plan)) return rejected("invalid-plan");
  const device = structuralDevice(execution.device);
  if (!device) return unsupported();
  if (!structuralTexture(execution.texture)) return rejected("upload-failed");
  if (typeof execution.getCurrentGeneration !== "function") {
    return rejected("generation-check-failed");
  }
  const loss = deviceLossState(device);
  // Allow an already-settled device.lost promise to publish its state before enqueue.
  await Promise.resolve();
  if (loss.lost) return rejected("device-lost");
  if (execution.signal?.aborted) return rejected("aborted");
  const generation = readGeneration(execution.getCurrentGeneration);
  if (generation === null) return rejected("generation-check-failed");
  if (generation !== plan.generation) return rejected("stale-generation");

  try {
    device.queue.writeTexture(
      {
        texture: execution.texture,
        mipLevel: 0,
        origin: {
          x: plan.uploadRect.x,
          y: plan.uploadRect.y,
          z: 0,
        },
        aspect: "all",
      },
      staging,
      {
        offset: 0,
        bytesPerRow: plan.bytesPerRow,
        rowsPerImage: plan.rowsPerImage,
      },
      {
        width: plan.uploadRect.width,
        height: plan.uploadRect.height,
        depthOrArrayLayers: 1,
      },
    );
  } catch {
    return loss.lost
      ? rejected("device-lost")
      : rejected("upload-failed");
  }

  const abort = abortCompletion(execution.signal);
  try {
    const queueCompletion = typeof device.queue.onSubmittedWorkDone === "function"
      ? Promise.resolve().then(() => device.queue.onSubmittedWorkDone!()).then(
          () => "queue-complete" as const,
          () => "queue-failed" as const,
        )
      : Promise.resolve("queue-complete" as const);
    const outcome = await Promise.race([
      queueCompletion,
      loss.completion,
      abort.completion,
    ]);
    if (outcome === "aborted") return rejected("aborted");
    if (outcome === "device-lost" || loss.lost) return rejected("device-lost");
    if (outcome === "queue-failed") return rejected("upload-failed");
    if (execution.signal?.aborted) return rejected("aborted");
    const currentGeneration = readGeneration(execution.getCurrentGeneration);
    if (currentGeneration === null) return rejected("generation-check-failed");
    if (currentGeneration !== plan.generation) return rejected("stale-generation");
    return Object.freeze({
      status: "uploaded",
      mode: plan.mode,
      generation: plan.generation,
      byteLength: plan.byteLength,
      uploadRect: plan.uploadRect,
    });
  } catch {
    return loss.lost
      ? rejected("device-lost")
      : rejected("upload-failed");
  } finally {
    abort.cleanup();
  }
}
