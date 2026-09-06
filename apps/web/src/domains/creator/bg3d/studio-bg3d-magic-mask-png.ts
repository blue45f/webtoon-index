import { STUDIO_BG3D_LT_RENDER_MAX_PIXELS } from "./studio-bg3d-lt-render";
import { STUDIO_BG3D_SHOT_BATCH_MAX_DIMENSION } from "./studio-bg3d-shot-batch-limits";
import {
  encodeStudioBg3dShotPngInWorker,
  type StudioBg3dShotPngWorkerOptions,
} from "./studio-bg3d-shot-png-worker-client";
import { STUDIO_BG3D_SHOT_PNG_WORKER_MAX_OUTPUT_BYTES } from "./studio-bg3d-shot-png-worker-protocol";

import type { StudioBg3dLtRasterLayer } from "./studio-bg3d-lt-render";

export const STUDIO_BG3D_MAGIC_MASK_PNG_DATA_URL_PREFIX =
  "data:image/png;base64," as const;
export const STUDIO_BG3D_MAGIC_MASK_MAIN_THREAD_MAX_PIXELS = 1_048_576;

export type StudioBg3dMagicMaskPngEncoderBackend = "worker" | "main-thread";

export interface StudioBg3dMagicMaskPngInput {
  readonly width: number;
  readonly height: number;
  /**
   * Fresh, tightly packed RGBA8 storage. Both Uint8Array variants are accepted so the canonical
   * object-ID mask can cross this boundary without a caller-side conversion.
   */
  readonly data: Uint8Array | Uint8ClampedArray;
}

type EncodePngInWorker = typeof encodeStudioBg3dShotPngInWorker;
type ReadBlobAsDataUrl = (blob: Blob, signal?: AbortSignal) => Promise<string>;

export interface StudioBg3dMagicMaskPngOptions extends StudioBg3dShotPngWorkerOptions {
  /** Selected once before encoding starts. Omission selects the product Worker backend. */
  readonly encoderBackend?: StudioBg3dMagicMaskPngEncoderBackend;
  /** Test/runtime seam; production callers omit it and use the shared short-lived PNG Worker. */
  readonly encodePngInWorker?: EncodePngInWorker;
  /** Test/runtime seam for the explicitly selected main-thread backend. */
  readonly createCanvas?: () => HTMLCanvasElement | null;
  /** Test/runtime seam; production callers omit it and use an abort-aware FileReader. */
  readonly readBlobAsDataUrl?: ReadBlobAsDataUrl;
}

export type StudioBg3dMagicMaskPngErrorCode =
  | "aborted"
  | "data-url-failed"
  | "encode-failed"
  | "invalid-backend"
  | "invalid-input"
  | "invalid-png"
  | "main-thread-too-large"
  | "main-thread-unavailable";

export class StudioBg3dMagicMaskPngError extends Error {
  constructor(
    readonly code: StudioBg3dMagicMaskPngErrorCode,
    cause?: unknown,
  ) {
    super(
      `Studio 3D Magic mask PNG encoding failed: ${code}`,
      cause === undefined ? undefined : { cause },
    );
    this.name = code === "aborted" ? "AbortError" : "StudioBg3dMagicMaskPngError";
  }
}

interface StudioBg3dMagicMaskPngSnapshot {
  readonly width: number;
  readonly height: number;
  readonly pixels: number;
  readonly data: Uint8ClampedArray;
}

function fail(
  code: StudioBg3dMagicMaskPngErrorCode,
  cause?: unknown,
): never {
  throw new StudioBg3dMagicMaskPngError(code, cause);
}

function abortIfRequested(signal: AbortSignal | undefined): void {
  if (signal?.aborted) fail("aborted");
}

function isFixedExclusiveRgbaStorage(
  value: unknown,
  expectedByteLength: number,
): value is Uint8Array | Uint8ClampedArray {
  if (
    !(
      value instanceof Uint8Array &&
      Object.getPrototypeOf(value) === Uint8Array.prototype
    ) &&
    !(
      value instanceof Uint8ClampedArray &&
      Object.getPrototypeOf(value) === Uint8ClampedArray.prototype
    )
  ) {
    return false;
  }
  const buffer = value.buffer;
  if (
    !(buffer instanceof ArrayBuffer) ||
    Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype ||
    value.byteOffset !== 0 ||
    value.byteLength !== expectedByteLength ||
    value.length !== expectedByteLength ||
    buffer.byteLength !== expectedByteLength
  ) {
    return false;
  }
  const state = buffer as ArrayBuffer & {
    readonly detached?: unknown;
    readonly maxByteLength?: unknown;
    readonly resizable?: unknown;
  };
  return state.detached !== true &&
    state.resizable !== true &&
    (
      typeof state.maxByteLength !== "number" ||
      state.maxByteLength === buffer.byteLength
    );
}

function snapshotMask(input: StudioBg3dMagicMaskPngInput): StudioBg3dMagicMaskPngSnapshot {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return fail("invalid-input");
  }
  const { width, height, data } = input;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > STUDIO_BG3D_SHOT_BATCH_MAX_DIMENSION ||
    height > STUDIO_BG3D_SHOT_BATCH_MAX_DIMENSION
  ) {
    return fail("invalid-input");
  }
  const pixels = width * height;
  const byteLength = pixels * 4;
  if (
    !Number.isSafeInteger(pixels) ||
    pixels > STUDIO_BG3D_LT_RENDER_MAX_PIXELS ||
    !Number.isSafeInteger(byteLength) ||
    !isFixedExclusiveRgbaStorage(data, byteLength)
  ) {
    return fail("invalid-input");
  }
  const snapshot = new Uint8ClampedArray(byteLength);
  snapshot.set(data);
  return Object.freeze({ width, height, pixels, data: snapshot });
}

function snapshotMaskFailClosed(
  input: StudioBg3dMagicMaskPngInput,
): StudioBg3dMagicMaskPngSnapshot {
  try {
    return snapshotMask(input);
  } catch (error) {
    if (error instanceof StudioBg3dMagicMaskPngError) throw error;
    return fail("invalid-input", error);
  }
}

function createDefaultCanvas(): HTMLCanvasElement | null {
  if (typeof document !== "object" || typeof document.createElement !== "function") return null;
  return document.createElement("canvas");
}

function encodeOnMainThread(
  snapshot: StudioBg3dMagicMaskPngSnapshot,
  createCanvas: () => HTMLCanvasElement | null,
  signal: AbortSignal | undefined,
): Promise<Blob> {
  abortIfRequested(signal);
  if (snapshot.pixels > STUDIO_BG3D_MAGIC_MASK_MAIN_THREAD_MAX_PIXELS) {
    return Promise.reject(new StudioBg3dMagicMaskPngError("main-thread-too-large"));
  }

  let canvas: HTMLCanvasElement | null;
  try {
    canvas = createCanvas();
  } catch (error) {
    return Promise.reject(new StudioBg3dMagicMaskPngError(
      "main-thread-unavailable",
      error,
    ));
  }
  if (!canvas || typeof canvas.getContext !== "function" || typeof canvas.toBlob !== "function") {
    return Promise.reject(new StudioBg3dMagicMaskPngError("main-thread-unavailable"));
  }

  canvas.width = snapshot.width;
  canvas.height = snapshot.height;
  const ownedCanvas = canvas;
  let context: CanvasRenderingContext2D | null;
  try {
    context = ownedCanvas.getContext("2d");
  } catch (error) {
    ownedCanvas.width = 1;
    ownedCanvas.height = 1;
    return Promise.reject(new StudioBg3dMagicMaskPngError(
      "main-thread-unavailable",
      error,
    ));
  }
  if (!context) {
    ownedCanvas.width = 1;
    ownedCanvas.height = 1;
    return Promise.reject(new StudioBg3dMagicMaskPngError("main-thread-unavailable"));
  }

  try {
    const imageData = context.createImageData(snapshot.width, snapshot.height);
    imageData.data.set(snapshot.data);
    context.putImageData(imageData, 0, 0);
  } catch (error) {
    ownedCanvas.width = 1;
    ownedCanvas.height = 1;
    return Promise.reject(new StudioBg3dMagicMaskPngError("encode-failed", error));
  }

  return new Promise<Blob>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      signal?.removeEventListener("abort", handleAbort);
      ownedCanvas.width = 1;
      ownedCanvas.height = 1;
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const handleAbort = () => finish(() => reject(
      new StudioBg3dMagicMaskPngError("aborted"),
    ));
    signal?.addEventListener("abort", handleAbort, { once: true });
    if (signal?.aborted) {
      handleAbort();
      return;
    }
    try {
      ownedCanvas.toBlob((blob) => {
        if (
          !blob ||
          blob.type !== "image/png" ||
          blob.size < 24 ||
          blob.size > STUDIO_BG3D_SHOT_PNG_WORKER_MAX_OUTPUT_BYTES
        ) {
          finish(() => reject(new StudioBg3dMagicMaskPngError("encode-failed")));
          return;
        }
        finish(() => resolve(blob));
      }, "image/png");
    } catch (error) {
      finish(() => reject(new StudioBg3dMagicMaskPngError("encode-failed", error)));
    }
  });
}

function readBlobAsDataUrl(blob: Blob, signal: AbortSignal | undefined): Promise<string> {
  abortIfRequested(signal);
  if (typeof FileReader !== "function") {
    return Promise.reject(new StudioBg3dMagicMaskPngError("data-url-failed"));
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;
    const cleanup = () => signal?.removeEventListener("abort", handleAbort);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const handleAbort = () => finish(() => {
      try {
        reader.abort();
      } catch {
        // A host FileReader shim may reject abort after it has already completed.
      }
      reject(new StudioBg3dMagicMaskPngError("aborted"));
    });
    reader.onerror = () => finish(() => reject(
      new StudioBg3dMagicMaskPngError("data-url-failed", reader.error),
    ));
    reader.onabort = handleAbort;
    reader.onload = () => finish(() => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new StudioBg3dMagicMaskPngError("data-url-failed"));
    });
    signal?.addEventListener("abort", handleAbort, { once: true });
    if (signal?.aborted) {
      handleAbort();
      return;
    }
    try {
      reader.readAsDataURL(blob);
    } catch (error) {
      finish(() => reject(new StudioBg3dMagicMaskPngError("data-url-failed", error)));
    }
  });
}

async function validatePngBlob(
  blob: unknown,
  width: number,
  height: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  abortIfRequested(signal);
  if (
    !(blob instanceof Blob) ||
    blob.type !== "image/png" ||
    blob.size < 24 ||
    blob.size > STUDIO_BG3D_SHOT_PNG_WORKER_MAX_OUTPUT_BYTES
  ) {
    return fail("invalid-png");
  }
  let header: Uint8Array;
  try {
    header = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
  } catch (error) {
    return fail("invalid-png", error);
  }
  abortIfRequested(signal);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10] as const;
  if (
    header.length !== 24 ||
    !signature.every((byte, index) => header[index] === byte)
  ) {
    return fail("invalid-png");
  }
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (
    view.getUint32(8, false) !== 13 ||
    header[12] !== 0x49 ||
    header[13] !== 0x48 ||
    header[14] !== 0x44 ||
    header[15] !== 0x52 ||
    view.getUint32(16, false) !== width ||
    view.getUint32(20, false) !== height
  ) {
    return fail("invalid-png");
  }
}

function validateDataUrl(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith(STUDIO_BG3D_MAGIC_MASK_PNG_DATA_URL_PREFIX)
  ) {
    return fail("data-url-failed");
  }
  const payload = value.slice(STUDIO_BG3D_MAGIC_MASK_PNG_DATA_URL_PREFIX.length);
  if (
    payload.length < 12 ||
    payload.length % 4 !== 0 ||
    !payload.startsWith("iVBORw0KGgo") ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(payload)
  ) {
    return fail("data-url-failed");
  }
  return value;
}

/**
 * Encodes one canonical Magic Layer RGBA mask without ever transferring or detaching caller-owned
 * storage. The backend is selected exactly once before execution; a Worker failure never reruns
 * the request on the main thread. Product callers omit `encoderBackend` and therefore use Worker.
 */
export async function encodeStudioBg3dMagicMaskPngDataUrl(
  input: StudioBg3dMagicMaskPngInput,
  options: StudioBg3dMagicMaskPngOptions = {},
): Promise<string> {
  abortIfRequested(options.signal);
  const snapshot = snapshotMaskFailClosed(input);
  const encoderBackend = options.encoderBackend ?? "worker";
  if (encoderBackend !== "worker" && encoderBackend !== "main-thread") {
    return fail("invalid-backend");
  }
  const layer: StudioBg3dLtRasterLayer = Object.freeze({
    role: "color",
    width: snapshot.width,
    height: snapshot.height,
    data: snapshot.data,
  });
  const png = encoderBackend === "main-thread"
    ? await encodeOnMainThread(
      snapshot,
      options.createCanvas ?? createDefaultCanvas,
      options.signal,
    )
    : await (options.encodePngInWorker ?? encodeStudioBg3dShotPngInWorker)([layer], {
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      startupTimeoutMs: options.startupTimeoutMs,
      workerFactory: options.workerFactory,
    });
  await validatePngBlob(png, snapshot.width, snapshot.height, options.signal);
  const dataUrl = await (options.readBlobAsDataUrl ?? readBlobAsDataUrl)(
    png,
    options.signal,
  );
  abortIfRequested(options.signal);
  return validateDataUrl(dataUrl);
}
