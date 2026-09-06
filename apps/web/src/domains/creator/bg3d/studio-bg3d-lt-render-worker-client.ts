import {
  STUDIO_BG3D_LT_RENDER_MAX_PIXELS,
  type StudioBg3dLtRasterInput,
  type StudioBg3dLtRasterLayer,
  type StudioBg3dLtRenderResult,
  type StudioBg3dLtRenderSettings,
} from "./studio-bg3d-lt-render";
import {
  STUDIO_BG3D_LT_RENDER_WORKER_PROTOCOL_VERSION,
  isStudioBg3dLtRenderWorkerRequestEnvelope,
  isStudioBg3dLtRenderWorkerResponse,
  studioBg3dLtRenderWorkerRequestTransfers,
  type StudioBg3dLtRenderWorkerRequest,
} from "./studio-bg3d-lt-render-worker-protocol";

export const STUDIO_BG3D_LT_RENDER_WORKER_TIMEOUT_MS = 120_000;

interface WorkerMessageEventLike { readonly data: unknown }
interface WorkerErrorEventLike { preventDefault?(): void }

export interface StudioBg3dLtRenderWorkerLike {
  postMessage(message: StudioBg3dLtRenderWorkerRequest, transfer: Transferable[]): void;
  addEventListener(type: "message", listener: (event: WorkerMessageEventLike) => void): void;
  addEventListener(
    type: "error" | "messageerror",
    listener: (event: WorkerErrorEventLike) => void,
  ): void;
  removeEventListener(type: "message", listener: (event: WorkerMessageEventLike) => void): void;
  removeEventListener(
    type: "error" | "messageerror",
    listener: (event: WorkerErrorEventLike) => void,
  ): void;
  terminate(): void;
}

export type StudioBg3dLtRenderWorkerFactory = () => StudioBg3dLtRenderWorkerLike | null;

export interface StudioBg3dLtRenderWorkerOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** Omitted creates one lazy Vite module Worker for exactly this request. */
  readonly workerFactory?: StudioBg3dLtRenderWorkerFactory;
}

export type StudioBg3dLtRenderWorkerErrorCode =
  | "aborted"
  | "invalid-request"
  | "protocol"
  | "render-failed"
  | "timeout"
  | "worker-failed"
  | "worker-unavailable";

export class StudioBg3dLtRenderWorkerError extends Error {
  constructor(readonly code: StudioBg3dLtRenderWorkerErrorCode) {
    super(`studio-bg3d-lt-render-worker:${code}`);
    this.name = code === "aborted" ? "AbortError" : "StudioBg3dLtRenderWorkerError";
  }
}

interface SnapshottedPayload {
  readonly input: StudioBg3dLtRenderWorkerRequest["input"];
  readonly settings: StudioBg3dLtRenderSettings;
}

function exactEnumerableKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    keys.length >= required.length && keys.length <= required.length + optional.length &&
    keys.every((key) => required.includes(key) || optional.includes(key));
}

function snapshotPayload(
  inputValue: StudioBg3dLtRasterInput,
  settingsValue: StudioBg3dLtRenderSettings,
): SnapshottedPayload | null {
  try {
    if (!exactEnumerableKeys(inputValue, ["width", "height", "rgba"], ["depth"])) return null;
    if (!exactEnumerableKeys(settingsValue, ["line", "tone"])) return null;
    const lineValue = settingsValue.line;
    const toneValue = settingsValue.tone;
    if (!exactEnumerableKeys(lineValue, [
      "enabled", "layerType", "color", "widthPx", "strength", "accuracy",
      "scaleAwareAccuracy", "exteriorOutlineStrength", "depthEnabled", "depthStrength",
      "depthOutlineOnly", "smoothing", "textureLineEnabled", "textureLineStrength",
      "creaseAngleDegrees", "hiddenLineRemoval",
    ])) return null;
    if (!exactEnumerableKeys(toneValue, [
      "mode", "type", "pattern", "levels", "opacity", "frequency", "angleDegrees",
    ])) return null;

    // Read each caller-owned field before constructing a Worker. ArrayBuffer-only backing rejects
    // SharedArrayBuffer and prevents concurrent mutation while these defensive copies are made.
    const width = inputValue.width;
    const height = inputValue.height;
    if (
      !Number.isSafeInteger(width) || width < 1 ||
      !Number.isSafeInteger(height) || height < 1
    ) return null;
    const pixels = width * height;
    if (!Number.isSafeInteger(pixels) || pixels > STUDIO_BG3D_LT_RENDER_MAX_PIXELS) return null;
    const sourceRgba = inputValue.rgba;
    if (
      (!(sourceRgba instanceof Uint8Array) && !(sourceRgba instanceof Uint8ClampedArray)) ||
      !(sourceRgba.buffer instanceof ArrayBuffer) || sourceRgba.length !== pixels * 4
    ) return null;
    const rgba = new Uint8Array(sourceRgba.length);
    rgba.set(sourceRgba);

    const sourceDepth = inputValue.depth;
    let depthBuffer: ArrayBuffer | undefined;
    if (sourceDepth !== undefined) {
      if (
        !(sourceDepth instanceof Float32Array) ||
        !(sourceDepth.buffer instanceof ArrayBuffer) ||
        sourceDepth.length !== pixels
      ) {
        return null;
      }
      const depth = new Float32Array(sourceDepth.length);
      depth.set(sourceDepth);
      depthBuffer = depth.buffer as ArrayBuffer;
    }

    const settings: StudioBg3dLtRenderSettings = Object.freeze({
      line: Object.freeze({
        enabled: lineValue.enabled,
        layerType: lineValue.layerType,
        color: lineValue.color,
        widthPx: lineValue.widthPx,
        strength: lineValue.strength,
        accuracy: lineValue.accuracy,
        scaleAwareAccuracy: lineValue.scaleAwareAccuracy,
        exteriorOutlineStrength: lineValue.exteriorOutlineStrength,
        depthEnabled: lineValue.depthEnabled,
        depthStrength: lineValue.depthStrength,
        depthOutlineOnly: lineValue.depthOutlineOnly,
        smoothing: lineValue.smoothing,
        textureLineEnabled: lineValue.textureLineEnabled,
        textureLineStrength: lineValue.textureLineStrength,
        creaseAngleDegrees: lineValue.creaseAngleDegrees,
        hiddenLineRemoval: lineValue.hiddenLineRemoval,
      }),
      tone: Object.freeze({
        mode: toneValue.mode,
        type: toneValue.type,
        pattern: toneValue.pattern,
        levels: toneValue.levels,
        opacity: toneValue.opacity,
        frequency: toneValue.frequency,
        angleDegrees: toneValue.angleDegrees,
      }),
    });
    return Object.freeze({
      input: Object.freeze({
        width,
        height,
        rgbaBuffer: rgba.buffer as ArrayBuffer,
        ...(depthBuffer ? { depthBuffer } : {}),
      }),
      settings,
    });
  } catch {
    return null;
  }
}

/** Vite discovers this exact URL expression and emits the CPU renderer only in the Worker graph. */
export function createStudioBg3dLtRenderModuleWorker(): StudioBg3dLtRenderWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(new URL("./studio-bg3d-lt-render.worker.ts", import.meta.url), {
    type: "module",
    name: "toonspectrum-bg3d-lt-render",
  });
}

let nextRequestId = 1;

function allocateRequestId(): number {
  const requestId = nextRequestId;
  nextRequestId = requestId >= Number.MAX_SAFE_INTEGER ? 1 : requestId + 1;
  return requestId;
}

function boundedTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return STUDIO_BG3D_LT_RENDER_WORKER_TIMEOUT_MS;
  return Math.max(100, Math.min(300_000, Math.floor(value ?? 0)));
}

function requestIdFrom(value: unknown): number | null {
  try {
    if (typeof value !== "object" || value === null) return null;
    const requestId = Reflect.get(value, "requestId");
    return typeof requestId === "number" && Number.isSafeInteger(requestId) && requestId > 0
      ? requestId
      : null;
  } catch {
    return null;
  }
}

function resultFromResponse(
  response: Extract<
    import("./studio-bg3d-lt-render-worker-protocol").StudioBg3dLtRenderWorkerResponse,
    { readonly kind: "result" }
  >,
  request: StudioBg3dLtRenderWorkerRequest,
): StudioBg3dLtRenderResult | null {
  if (response.width !== request.input.width || response.height !== request.input.height) return null;
  const allowedRoles = new Set<StudioBg3dLtRasterLayer["role"]>();
  const lineEnabled = request.settings.line.enabled && request.settings.line.strength > 0;
  const toneEnabled = request.settings.tone.mode !== "none" && request.settings.tone.opacity > 0;
  if (toneEnabled) {
    allowedRoles.add(request.settings.tone.type === "color" ? "color" : "tone");
  }
  if (lineEnabled) {
    if (
      request.settings.line.textureLineEnabled &&
      request.settings.line.textureLineStrength > 0
    ) allowedRoles.add("texture-line");
    allowedRoles.add("main-line");
  }
  const layers: StudioBg3dLtRasterLayer[] = [];
  for (const layer of response.layers) {
    if (!allowedRoles.has(layer.role)) return null;
    if (layer.width !== request.input.width || layer.height !== request.input.height) return null;
    const data = new Uint8ClampedArray(layer.dataBuffer);
    if (data.length !== layer.width * layer.height * 4) return null;
    layers.push(Object.freeze({
      role: layer.role,
      width: layer.width,
      height: layer.height,
      data,
    }));
  }
  return Object.freeze({
    width: response.width,
    height: response.height,
    layers: Object.freeze(layers),
  });
}

/**
 * Transfers one defensively snapshotted capture to one short-lived Worker. Caller buffers are never
 * detached; every success/failure path removes listeners and terminates the Worker.
 */
export function renderStudioBg3dLtLayersInWorker(
  input: StudioBg3dLtRasterInput,
  settings: StudioBg3dLtRenderSettings,
  options: StudioBg3dLtRenderWorkerOptions = {},
): Promise<StudioBg3dLtRenderResult> {
  if (options.signal?.aborted) {
    return Promise.reject(new StudioBg3dLtRenderWorkerError("aborted"));
  }
  const snapshot = snapshotPayload(input, settings);
  if (!snapshot) {
    return Promise.reject(new StudioBg3dLtRenderWorkerError("invalid-request"));
  }
  const request: StudioBg3dLtRenderWorkerRequest = Object.freeze({
    version: STUDIO_BG3D_LT_RENDER_WORKER_PROTOCOL_VERSION,
    kind: "render",
    requestId: allocateRequestId(),
    input: snapshot.input,
    settings: snapshot.settings,
  });
  if (!isStudioBg3dLtRenderWorkerRequestEnvelope(request)) {
    return Promise.reject(new StudioBg3dLtRenderWorkerError("invalid-request"));
  }
  if (options.signal?.aborted) {
    return Promise.reject(new StudioBg3dLtRenderWorkerError("aborted"));
  }

  return new Promise((resolve, reject) => {
    const signal = options.signal;
    let worker: StudioBg3dLtRenderWorkerLike | null = null;
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const safely = (callback: () => void) => {
      try {
        callback();
      } catch {
        // Cleanup is best-effort so a forged host implementation cannot prevent settlement.
      }
    };
    const cleanup = () => {
      if (timeout !== null) clearTimeout(timeout);
      signal?.removeEventListener("abort", handleAbort);
      if (worker) {
        safely(() => worker?.removeEventListener("message", handleMessage));
        safely(() => worker?.removeEventListener("error", handleWorkerFailure));
        safely(() => worker?.removeEventListener("messageerror", handleWorkerFailure));
        safely(() => worker?.terminate());
      }
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const fail = (code: StudioBg3dLtRenderWorkerErrorCode) => {
      finish(() => reject(new StudioBg3dLtRenderWorkerError(code)));
    };
    const handleAbort = () => fail("aborted");
    function handleWorkerFailure(event: WorkerErrorEventLike): void {
      event.preventDefault?.();
      fail("worker-failed");
    }
    function handleMessage(event: WorkerMessageEventLike): void {
      const responseRequestId = requestIdFrom(event.data);
      // One Worker serves one request; valid but stale IDs cannot affect this promise.
      if (responseRequestId !== null && responseRequestId !== request.requestId) return;
      if (!isStudioBg3dLtRenderWorkerResponse(event.data) || responseRequestId === null) {
        fail("protocol");
        return;
      }
      if (event.data.kind === "error") {
        fail(event.data.code);
        return;
      }
      const result = resultFromResponse(event.data, request);
      if (!result) {
        fail("protocol");
        return;
      }
      finish(() => resolve(result));
    }

    signal?.addEventListener("abort", handleAbort, { once: true });
    if (signal?.aborted) {
      handleAbort();
      return;
    }
    try {
      worker = (options.workerFactory ?? createStudioBg3dLtRenderModuleWorker)();
    } catch {
      fail("worker-unavailable");
      return;
    }
    if (!worker) {
      fail("worker-unavailable");
      return;
    }
    try {
      worker.addEventListener("message", handleMessage);
      worker.addEventListener("error", handleWorkerFailure);
      worker.addEventListener("messageerror", handleWorkerFailure);
      timeout = setTimeout(() => fail("timeout"), boundedTimeout(options.timeoutMs));
      worker.postMessage(request, studioBg3dLtRenderWorkerRequestTransfers(request));
    } catch {
      fail("worker-failed");
    }
  });
}
