/** Production WebGPU admission without allocating a GPUDevice or importing a renderer. */
export interface StudioBg3dGpuAdapterLike {
  readonly features?: Iterable<string>;
  /** WebIDL getters need not be enumerable. */
  readonly limits?: {
    readonly maxBufferSize?: number;
    readonly maxStorageBufferBindingSize?: number;
    readonly maxComputeWorkgroupSizeX?: number;
  };
}

export interface StudioBg3dGpuLike {
  requestAdapter(options?: { readonly powerPreference?: "low-power" | "high-performance" }):
    Promise<StudioBg3dGpuAdapterLike | null>;
}

export interface StudioBg3dWebGpuProbeSignals {
  readonly secureContext: boolean;
  readonly gpu?: StudioBg3dGpuLike;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /**
   * The response deadline controls how long the UI waits, not whether the browser's pending
   * request may finish. Observe that SAME request after a timeout; never allocate another adapter.
   * Notification is suppressed after abort. Consumers must fence their own session/storage state.
   */
  readonly onLateResult?: (result: StudioBg3dWebGpuProbeResult) => void;
}

export type StudioBg3dWebGpuProbeReason =
  | "available"
  | "insecure-context"
  | "api-unavailable"
  | "adapter-unavailable"
  | "insufficient-limits"
  | "timeout"
  | "aborted";

export interface StudioBg3dWebGpuProbeResult {
  readonly supported: boolean;
  readonly reason: StudioBg3dWebGpuProbeReason;
  readonly computeSupported: boolean;
  readonly timestampQuerySupported: boolean;
  readonly limits: Readonly<Record<string, number>>;
}

export const STUDIO_BG3D_WEBGPU_MIN_BUFFER_SIZE = 128 * 1024 * 1024;
export const STUDIO_BG3D_WEBGPU_MIN_STORAGE_BINDING_SIZE = 32 * 1024 * 1024;
const PROBED_LIMIT_NAMES = [
  "maxBufferSize", "maxStorageBufferBindingSize", "maxComputeWorkgroupSizeX",
] as const;

function readKnownGpuLimits(
  source: StudioBg3dGpuAdapterLike["limits"],
): Readonly<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const name of PROBED_LIMIT_NAMES) {
    const value = source?.[name];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) result[name] = value;
  }
  return result;
}

function probeResult(
  supported: boolean,
  reason: StudioBg3dWebGpuProbeReason,
  features: ReadonlySet<string> = new Set(),
  limits: Readonly<Record<string, number>> = {},
): StudioBg3dWebGpuProbeResult {
  return Object.freeze({
    supported,
    reason,
    computeSupported: supported && (limits.maxComputeWorkgroupSizeX ?? 0) > 0,
    timestampQuerySupported: supported && features.has("timestamp-query"),
    limits: Object.freeze({ ...limits }),
  });
}

function classifyAdapter(adapter: StudioBg3dGpuAdapterLike | null): StudioBg3dWebGpuProbeResult {
  if (!adapter) return probeResult(false, "adapter-unavailable");
  const features = new Set(adapter.features ?? []);
  const limits = readKnownGpuLimits(adapter.limits);
  if (
    (limits.maxBufferSize ?? 0) < STUDIO_BG3D_WEBGPU_MIN_BUFFER_SIZE
    || (limits.maxStorageBufferBindingSize ?? 0) < STUDIO_BG3D_WEBGPU_MIN_STORAGE_BINDING_SIZE
  ) {
    return probeResult(false, "insufficient-limits", features, limits);
  }
  return probeResult(true, "available", features, limits);
}

export async function probeStudioBg3dWebGpuCapability(
  signals: StudioBg3dWebGpuProbeSignals,
): Promise<StudioBg3dWebGpuProbeResult> {
  if (signals.signal?.aborted) return probeResult(false, "aborted");
  if (!signals.secureContext) return probeResult(false, "insecure-context");
  if (!signals.gpu) return probeResult(false, "api-unavailable");
  const timeoutMs = Number.isFinite(signals.timeoutMs)
    ? Math.min(10_000, Math.max(250, Math.floor(signals.timeoutMs ?? 3_000)))
    : 3_000;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const timeoutResult = new Promise<"timeout">((resolve) => {
    timeout = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const abortResult = new Promise<"aborted">((resolve) => {
    if (!signals.signal) return;
    abortListener = () => resolve("aborted");
    signals.signal.addEventListener("abort", abortListener, { once: true });
  });
  try {
    // Preserve the native receiver and request options. Classify once, including rejection, so a
    // late native rejection is observed and never escapes as an unhandled promise rejection.
    const adapterResult = signals.gpu.requestAdapter({ powerPreference: "high-performance" })
      .then(classifyAdapter)
      .catch(() => probeResult(false, "adapter-unavailable"));
    const outcome = await Promise.race([adapterResult, timeoutResult, abortResult]);
    if (outcome === "timeout") {
      if (signals.onLateResult) {
        void adapterResult.then((result) => {
          if (!signals.signal?.aborted) signals.onLateResult?.(result);
        }).catch((error: unknown) => {
          console.warn("[bg3d-webgpu-probe] Late capability observer failed", error);
        });
      }
      return probeResult(false, "timeout");
    }
    if (outcome === "aborted" || signals.signal?.aborted) return probeResult(false, "aborted");
    return outcome;
  } catch {
    return signals.signal?.aborted
      ? probeResult(false, "aborted")
      : probeResult(false, "adapter-unavailable");
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (abortListener) signals.signal?.removeEventListener("abort", abortListener);
  }
}
