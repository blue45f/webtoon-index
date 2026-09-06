/**
 * Production Three WebGPU renderer factory for the Studio 3D background editor.
 *
 * This is the next-generation counterpart to the editor's long-standing `THREE.WebGLRenderer`
 * path. Callers reach it only through `studio-bg3d-three-webgpu-entry`, which is imported
 * dynamically after {@link probeStudioBg3dWebGpuCapability} admits the host and the
 * engine-selection policy chooses `webgpu`. The `three/webgpu` import is therefore static on
 * purpose: it belongs to that lazy entry's closure, where the bundle audit can prove the WebGL
 * editor never downloads it, and a nested dynamic import would only add a round trip.
 *
 * Three's `WebGPURenderer` silently installs a WebGL2 fallback when device creation fails. That is
 * the wrong behaviour for an editor that reports its selected engine to the artist: a renderer
 * advertised as WebGPU must either be WebGPU or fail. The factory therefore removes the fallback
 * hook, bounds `init()`, asserts the backend brand, and tears down any partially constructed device
 * before rethrowing.
 */

import { WebGPURenderer } from "three/webgpu";

import {
  STUDIO_BG3D_WEBGPU_MIN_BUFFER_SIZE,
  STUDIO_BG3D_WEBGPU_MIN_STORAGE_BINDING_SIZE,
} from "./studio-bg3d-webgpu-capability";

export type StudioBg3dWebGpuRendererErrorCode =
  | "invalid-canvas"
  | "version-contract-unsupported"
  | "initialization-failed"
  | "backend-unavailable";

export const STUDIO_BG3D_WEBGPU_RENDERER_INIT_TIMEOUT_MS = 10_000;
const STUDIO_BG3D_WEBGPU_RENDERER_INIT_TIMEOUT_MAX_MS = 60_000;

export class StudioBg3dWebGpuRendererError extends Error {
  readonly code: StudioBg3dWebGpuRendererErrorCode;

  constructor(code: StudioBg3dWebGpuRendererErrorCode, cause?: unknown) {
    super(`Studio BG3D WebGPU renderer failed: ${code}`, cause === undefined ? undefined : { cause });
    this.name = "StudioBg3dWebGpuRendererError";
    this.code = code;
  }
}

export type StudioBg3dWebGpuDeviceLossReason = "destroyed" | "unknown";

export interface StudioBg3dWebGpuDeviceLoss {
  readonly reason: StudioBg3dWebGpuDeviceLossReason;
  readonly message: string;
}

export interface CreateStudioBg3dThreeWebGpuRendererOptions {
  readonly antialias?: boolean;
  readonly alpha?: boolean;
  /** Testable upper bound for Three's adapter/device initialization. */
  readonly initializationTimeoutMs?: number;
  /**
   * Called once if the GPU device is lost while the renderer is alive. The editor uses this to
   * mark the selected WebGPU engine failed without waiting for the next frame to throw.
   * A device destroyed by our own `dispose()` never reports.
   */
  readonly onDeviceLost?: (loss: StudioBg3dWebGpuDeviceLoss) => void;
}

export interface StudioBg3dThreeWebGpuRuntime {
  readonly renderer: WebGPURenderer;
  dispose(): Promise<void>;
}

interface ThreeWebGpuBackendLifecycle {
  readonly isWebGPUBackend?: unknown;
  readonly parameters?: { readonly device?: unknown };
  readonly device?: {
    destroy?: () => void;
    readonly lost?: PromiseLike<{ readonly reason?: unknown; readonly message?: unknown }>;
  } | null;
  dispose?: () => void;
}

interface ThreeWebGpuRendererLifecycle {
  /** Three r184's WebGPURenderer installs a WebGL fallback internally. Production forbids it. */
  _getFallback: null | ((error: unknown) => unknown);
  readonly backend: ThreeWebGpuBackendLifecycle;
}

function disposeRejectedThreeWebGpuInitialization(backend: ThreeWebGpuBackendLifecycle): void {
  try {
    backend.dispose?.();
  } catch {
    // Three's public Renderer.dispose() calls async setAnimationLoop(), which retries a rejected
    // init promise when initialization never completed. Tear the owned backend down directly.
    if (backend.parameters?.device === undefined) {
      try {
        backend.device?.destroy?.();
      } catch {
        // Best-effort cleanup must not replace the original initialization error.
      }
    }
  }
}

function normalizeDeviceLoss(info: {
  readonly reason?: unknown;
  readonly message?: unknown;
}): StudioBg3dWebGpuDeviceLoss {
  const reason: StudioBg3dWebGpuDeviceLossReason = info?.reason === "destroyed" ? "destroyed" : "unknown";
  const message = typeof info?.message === "string" && info.message.length > 0
    ? info.message.slice(0, 240)
    : "WebGPU 디바이스 연결이 끊어졌습니다.";
  return Object.freeze({ reason, message });
}

function normalizeInitializationTimeoutMs(value: number | undefined): number {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) {
    return STUDIO_BG3D_WEBGPU_RENDERER_INIT_TIMEOUT_MS;
  }
  return Math.min(
    STUDIO_BG3D_WEBGPU_RENDERER_INIT_TIMEOUT_MAX_MS,
    Math.floor(value ?? STUDIO_BG3D_WEBGPU_RENDERER_INIT_TIMEOUT_MS),
  );
}

async function initializeRendererWithTimeout(
  renderer: WebGPURenderer,
  backend: ThreeWebGpuBackendLifecycle,
  timeoutMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const initialization = Promise.resolve(renderer.init());
  const timeoutError = new Error(`WebGPU renderer initialization timed out after ${timeoutMs}ms.`);
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(timeoutError);
    }, timeoutMs);
  });
  try {
    await Promise.race([initialization, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // A timed-out init can still settle after its partial backend was torn down. Clean up again at
    // that boundary so a late-created device cannot survive outside the editor's ownership.
    if (timedOut) {
      void initialization.then(
        () => disposeRejectedThreeWebGpuInitialization(backend),
        () => disposeRejectedThreeWebGpuInitialization(backend),
      );
    }
  }
}

/**
 * Observes `GPUDevice.lost` without letting a rejected or never-settling promise leak. `lost`
 * resolves (it does not reject) on every conforming implementation, but the editor must not depend
 * on that for correctness.
 */
function observeDeviceLoss(
  backend: ThreeWebGpuBackendLifecycle,
  isDisposed: () => boolean,
  onDeviceLost: (loss: StudioBg3dWebGpuDeviceLoss) => void,
): void {
  const lost = backend.device?.lost;
  if (!lost || typeof lost.then !== "function") return;
  void Promise.resolve(lost).then(
    (info) => {
      if (isDisposed()) return;
      onDeviceLost(normalizeDeviceLoss(info ?? {}));
    },
    () => {
      if (isDisposed()) return;
      onDeviceLost(normalizeDeviceLoss({}));
    },
  );
}

const canvasRuntimes = new WeakMap<HTMLCanvasElement, Promise<StudioBg3dThreeWebGpuRuntime>>();

/**
 * Own one initialized renderer per canvas, including while init is pending. R3F 9.6.1 may invoke
 * an async gl factory again before its first configure call stores state.gl (upstream #3782).
 * Two renderers then configure the same GPUCanvasContext with different devices; only one receives
 * resize updates and the other's depth buffer remains 300x150. Sharing just the final renderer is
 * too late: publish the promise before construction/import side effects can re-enter the factory.
 *
 * The first invocation owns options and device-loss reporting until disposal. Failed targets stay
 * failed: a timed-out native init can still touch that canvas later. Explicit retry remounts a new
 * Canvas in useStudioBg3dEngineRuntime, never races a replacement device on the failed DOM node.
 */
export function createStudioBg3dThreeWebGpuRenderer(
  canvas: HTMLCanvasElement,
  options: CreateStudioBg3dThreeWebGpuRendererOptions = {},
): Promise<StudioBg3dThreeWebGpuRuntime> {
  if (!(canvas instanceof HTMLCanvasElement)) {
    return Promise.reject(new StudioBg3dWebGpuRendererError("invalid-canvas"));
  }
  const existing = canvasRuntimes.get(canvas);
  if (existing) return existing;
  const initialOptions = { ...options };
  const pending = Promise.resolve().then(() => initializeStudioBg3dThreeWebGpuRenderer(
    canvas,
    initialOptions,
    () => {
      if (canvasRuntimes.get(canvas) === pending) canvasRuntimes.delete(canvas);
    },
  ));
  canvasRuntimes.set(canvas, pending);
  return pending;
}

/** Callers probe first. Initialization does not re-probe or permit Three's hidden WebGL fallback. */
async function initializeStudioBg3dThreeWebGpuRenderer(
  canvas: HTMLCanvasElement,
  options: CreateStudioBg3dThreeWebGpuRendererOptions,
  releaseCanvas: () => void,
): Promise<StudioBg3dThreeWebGpuRuntime> {
  const renderer = new WebGPURenderer({
    canvas,
    antialias: options.antialias ?? true,
    alpha: options.alpha ?? true,
    powerPreference: "high-performance",
    requiredLimits: {
      maxBufferSize: STUDIO_BG3D_WEBGPU_MIN_BUFFER_SIZE,
      maxStorageBufferBindingSize: STUDIO_BG3D_WEBGPU_MIN_STORAGE_BINDING_SIZE,
    },
  });
  const lifecycle = renderer as unknown as ThreeWebGpuRendererLifecycle;
  const initializationBackend = lifecycle.backend;
  if (typeof lifecycle._getFallback !== "function") {
    disposeRejectedThreeWebGpuInitialization(initializationBackend);
    throw new StudioBg3dWebGpuRendererError("version-contract-unsupported");
  }
  lifecycle._getFallback = null;
  try {
    await initializeRendererWithTimeout(
      renderer,
      initializationBackend,
      normalizeInitializationTimeoutMs(options.initializationTimeoutMs),
    );
  } catch (error) {
    disposeRejectedThreeWebGpuInitialization(initializationBackend);
    throw new StudioBg3dWebGpuRendererError("initialization-failed", error);
  }
  if (lifecycle.backend.isWebGPUBackend !== true) {
    await renderer.dispose();
    throw new StudioBg3dWebGpuRendererError("backend-unavailable");
  }
  let disposed = false;
  // R3F disposes the renderer directly. Cover that path as well as the runtime handle and release
  // only this ownership entry; an old handle must never erase a newer runtime for the same node.
  const rendererDispose = renderer.dispose.bind(renderer);
  Object.defineProperty(renderer, "dispose", {
    configurable: true,
    writable: true,
    value: (): unknown => {
      if (disposed) return;
      disposed = true;
      try {
        return rendererDispose();
      } finally {
        releaseCanvas();
      }
    },
  });
  if (options.onDeviceLost) {
    observeDeviceLoss(lifecycle.backend, () => disposed, options.onDeviceLost);
  }
  return Object.freeze({
    renderer,
    async dispose() {
      if (disposed) return;
      await renderer.dispose();
    },
  });
}
