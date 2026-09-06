import { STUDIO_BG3D_LT_RENDER_MAX_PIXELS } from "./studio-bg3d-lt-render";
import { STUDIO_BG3D_SHOT_BATCH_MAX_DIMENSION } from "./studio-bg3d-shot-batch-limits";
import {
  STUDIO_BG3D_SHOT_PNG_WORKER_PROTOCOL_VERSION,
  STUDIO_BG3D_SHOT_PNG_WORKER_MAX_LAYERS,
  isStudioBg3dShotPngWorkerRequest,
  isStudioBg3dShotPngWorkerResponse,
  studioBg3dShotPngWorkerRequestTransfers,
  type StudioBg3dShotPngWorkerRequest,
} from "./studio-bg3d-shot-png-worker-protocol";

import type { StudioBg3dLtRasterLayer } from "./studio-bg3d-lt-render";

export const STUDIO_BG3D_SHOT_PNG_WORKER_TIMEOUT_MS = 20_000;
export const STUDIO_BG3D_SHOT_PNG_WORKER_STARTUP_TIMEOUT_MS = 5_000;

interface WorkerMessageLike { readonly data: unknown }
interface WorkerErrorLike { preventDefault?(): void }

export interface StudioBg3dShotPngWorkerLike {
  postMessage(message: StudioBg3dShotPngWorkerRequest, transfer: Transferable[]): void;
  addEventListener(type: "message", listener: (event: WorkerMessageLike) => void): void;
  addEventListener(type: "error" | "messageerror", listener: (event: WorkerErrorLike) => void): void;
  removeEventListener(type: "message", listener: (event: WorkerMessageLike) => void): void;
  removeEventListener(type: "error" | "messageerror", listener: (event: WorkerErrorLike) => void): void;
  terminate(): void;
}

export type StudioBg3dShotPngWorkerFactory = () => StudioBg3dShotPngWorkerLike | null;

export interface StudioBg3dShotPngWorkerOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly startupTimeoutMs?: number;
  /** Omitted creates one lazy Vite module Worker for exactly this encode request. */
  readonly workerFactory?: StudioBg3dShotPngWorkerFactory;
}

export type StudioBg3dShotPngWorkerErrorCode =
  | "aborted"
  | "invalid-request"
  | "worker-unavailable"
  | "offscreen-unavailable"
  | "protocol"
  | "encode-failed"
  | "timeout"
  | "worker-failed";

export class StudioBg3dShotPngWorkerError extends Error {
  constructor(readonly code: StudioBg3dShotPngWorkerErrorCode) {
    super(`studio-bg3d-shot-png-worker:${code}`);
    this.name = code === "aborted"
      ? "AbortError"
      : code === "timeout"
        ? "TimeoutError"
        : code === "worker-unavailable" || code === "offscreen-unavailable"
          ? "WorkerUnavailableError"
          : code === "protocol" || code === "invalid-request"
            ? "ProtocolError"
            : "WorkerError";
  }
}

export function createStudioBg3dShotPngModuleWorker(): StudioBg3dShotPngWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(new URL("./studio-bg3d-shot-png.worker.ts", import.meta.url), {
    type: "module",
    name: "toonspectrum-bg3d-shot-png",
  });
}

let nextRequestId = 1;

function allocateRequestId(): number {
  const requestId = nextRequestId;
  nextRequestId = requestId >= Number.MAX_SAFE_INTEGER ? 1 : requestId + 1;
  return requestId;
}

function boundedTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return STUDIO_BG3D_SHOT_PNG_WORKER_TIMEOUT_MS;
  return Math.max(100, Math.min(120_000, Math.floor(value ?? 0)));
}

function boundedStartupTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return STUDIO_BG3D_SHOT_PNG_WORKER_STARTUP_TIMEOUT_MS;
  return Math.max(100, Math.min(30_000, Math.floor(value ?? 0)));
}

function exactEnumerableKeys(value: unknown, keys: readonly string[]): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isRuntimeArray(value: unknown): boolean {
  return Array.isArray(value);
}

const ROLE_ORDER: Readonly<Record<StudioBg3dLtRasterLayer["role"], number>> = {
  color: 0,
  tone: 0,
  "texture-line": 1,
  "main-line": 2,
};

function snapshotRequest(
  layersValue: readonly StudioBg3dLtRasterLayer[],
): StudioBg3dShotPngWorkerRequest | null {
  try {
    if (
      !isRuntimeArray(layersValue) || layersValue.length < 1 ||
      layersValue.length > STUDIO_BG3D_SHOT_PNG_WORKER_MAX_LAYERS
    ) return null;
    const first = layersValue[0];
    if (!first || !exactEnumerableKeys(first, ["role", "width", "height", "data"])) return null;
    const width = first.width;
    const height = first.height;
    if (
      !Number.isSafeInteger(width) || width < 1 || width > STUDIO_BG3D_SHOT_BATCH_MAX_DIMENSION ||
      !Number.isSafeInteger(height) || height < 1 || height > STUDIO_BG3D_SHOT_BATCH_MAX_DIMENSION
    ) return null;
    const pixels = width * height;
    if (!Number.isSafeInteger(pixels) || pixels > STUDIO_BG3D_LT_RENDER_MAX_PIXELS) return null;

    const roles = new Set<StudioBg3dLtRasterLayer["role"]>();
    let previousRoleOrder = -1;
    const snapshots: StudioBg3dShotPngWorkerRequest["layers"] = layersValue.map((layer) => {
      if (!exactEnumerableKeys(layer, ["role", "width", "height", "data"])) {
        throw new TypeError("invalid layer shape");
      }
      const role = layer.role;
      const layerWidth = layer.width;
      const layerHeight = layer.height;
      const source = layer.data;
      if (
        typeof role !== "string" || !Object.prototype.hasOwnProperty.call(ROLE_ORDER, role) ||
        roles.has(role) || ROLE_ORDER[role] <= previousRoleOrder
      ) throw new TypeError("invalid layer order");
      if (
        layerWidth !== width || layerHeight !== height ||
        !(source instanceof Uint8ClampedArray) ||
        !(source.buffer instanceof ArrayBuffer) || source.length !== pixels * 4
      ) throw new TypeError("invalid layer storage");
      roles.add(role);
      previousRoleOrder = ROLE_ORDER[role];
      const data = new Uint8ClampedArray(source.length);
      data.set(source);
      return Object.freeze({
        role,
        width: layerWidth,
        height: layerHeight,
        dataBuffer: data.buffer as ArrayBuffer,
      });
    });
    const request: StudioBg3dShotPngWorkerRequest = Object.freeze({
      version: STUDIO_BG3D_SHOT_PNG_WORKER_PROTOCOL_VERSION,
      kind: "encode",
      requestId: allocateRequestId(),
      width,
      height,
      layers: Object.freeze(snapshots),
    });
    return isStudioBg3dShotPngWorkerRequest(request) ? request : null;
  } catch {
    return null;
  }
}

function isPngHeader(bytes: Uint8Array, width: number, height: number): boolean {
  if (bytes.length < 24) return false;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10] as const;
  if (!signature.every((value, index) => bytes[index] === value)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(8, false) === 13 &&
    bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52 &&
    view.getUint32(16, false) === width && view.getUint32(20, false) === height;
}

async function validatePng(
  png: Blob,
  width: number,
  height: number,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  if (signal?.aborted) return false;
  const bytes = new Uint8Array(await png.slice(0, 24).arrayBuffer());
  return !signal?.aborted && isPngHeader(bytes, width, height);
}

/**
 * Defensively snapshots and transfers pass pixels to one short-lived OffscreenCanvas Worker.
 * Caller buffers are never detached, and all terminal paths remove listeners and terminate it.
 */
export function encodeStudioBg3dShotPngInWorker(
  layers: readonly StudioBg3dLtRasterLayer[],
  options: StudioBg3dShotPngWorkerOptions = {},
): Promise<Blob> {
  if (options.signal?.aborted) {
    return Promise.reject(new StudioBg3dShotPngWorkerError("aborted"));
  }
  const snapshot = snapshotRequest(layers);
  if (!snapshot) return Promise.reject(new StudioBg3dShotPngWorkerError("invalid-request"));
  const request: StudioBg3dShotPngWorkerRequest = snapshot;
  if (options.signal?.aborted) {
    return Promise.reject(new StudioBg3dShotPngWorkerError("aborted"));
  }

  return new Promise<Blob>((resolve, reject) => {
    const signal = options.signal;
    let worker: StudioBg3dShotPngWorkerLike | null = null;
    let settled = false;
    let ready = false;
    let verifying = false;
    let startupTimeout: ReturnType<typeof setTimeout> | null = null;
    let encodeTimeout: ReturnType<typeof setTimeout> | null = null;
    const safely = (callback: () => void) => {
      try {
        callback();
      } catch {
        // Cleanup must not be held hostage by a host-provided Worker shim.
      }
    };
    const detachAndTerminateWorker = () => {
      if (!worker) return;
      safely(() => worker?.removeEventListener("message", handleMessage));
      safely(() => worker?.removeEventListener("error", handleWorkerFailure));
      safely(() => worker?.removeEventListener("messageerror", handleWorkerFailure));
      safely(() => worker?.terminate());
      worker = null;
    };
    const cleanup = () => {
      if (startupTimeout !== null) clearTimeout(startupTimeout);
      if (encodeTimeout !== null) clearTimeout(encodeTimeout);
      signal?.removeEventListener("abort", handleAbort);
      detachAndTerminateWorker();
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const fail = (code: StudioBg3dShotPngWorkerErrorCode) => {
      finish(() => reject(new StudioBg3dShotPngWorkerError(code)));
    };
    const handleAbort = () => fail("aborted");
    function handleWorkerFailure(event: WorkerErrorLike): void {
      event.preventDefault?.();
      fail("worker-failed");
    }
    function handleMessage(event: WorkerMessageLike): void {
      if (settled) return;
      const response = event.data;
      if (!isStudioBg3dShotPngWorkerResponse(response)) {
        fail("protocol");
        return;
      }
      if (response.kind === "unavailable") {
        if (ready || verifying) fail("protocol");
        else fail("offscreen-unavailable");
        return;
      }
      if (response.kind === "ready") {
        if (ready || verifying || !worker) {
          fail("protocol");
          return;
        }
        ready = true;
        if (startupTimeout !== null) clearTimeout(startupTimeout);
        startupTimeout = null;
        encodeTimeout = setTimeout(() => fail("timeout"), boundedTimeout(options.timeoutMs));
        try {
          worker.postMessage(request, studioBg3dShotPngWorkerRequestTransfers(request));
        } catch {
          fail("worker-failed");
        }
        return;
      }
      if (!ready || verifying || response.requestId !== request.requestId) {
        fail("protocol");
        return;
      }
      if (response.kind === "error") {
        fail(response.code);
        return;
      }
      if (response.width !== request.width || response.height !== request.height) {
        fail("protocol");
        return;
      }
      verifying = true;
      detachAndTerminateWorker();
      void validatePng(response.png, request.width, request.height, signal).then((valid) => {
        if (signal?.aborted) fail("aborted");
        else if (!valid) fail("protocol");
        else finish(() => resolve(response.png));
      }).catch(() => fail("protocol"));
    }

    signal?.addEventListener("abort", handleAbort, { once: true });
    if (signal?.aborted) {
      handleAbort();
      return;
    }
    try {
      worker = (options.workerFactory ?? createStudioBg3dShotPngModuleWorker)();
    } catch {
      fail("worker-unavailable");
      return;
    }
    if (!worker) {
      fail("worker-unavailable");
      return;
    }
    if (settled) {
      detachAndTerminateWorker();
      return;
    }
    try {
      worker.addEventListener("message", handleMessage);
      worker.addEventListener("error", handleWorkerFailure);
      worker.addEventListener("messageerror", handleWorkerFailure);
      startupTimeout = setTimeout(
        () => fail("timeout"),
        boundedStartupTimeout(options.startupTimeoutMs),
      );
    } catch {
      fail("worker-failed");
    }
  });
}
