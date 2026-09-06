import {
  STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
  STUDIO_BG3D_STABLE_ID_PROFILE,
  normalizeStudioBg3dArtifactCaptureResultV2,
  type StudioBg3dStableIdLegendEntry,
} from "./studio-bg3d-artifact-capture-v2";
import {
  runStudioBg3dAtomicSpecialist,
  StudioBg3dAtomicSpecialistError,
  type StudioBg3dAtomicSpecialistAttempt,
} from "./studio-bg3d-atomic-specialist-failover";
import {
  StudioBg3dRuntimeAdapterRegistry,
  type StudioBg3dRuntimeAdapter,
  type StudioBg3dRuntimeSnapshot,
} from "./studio-bg3d-runtime-adapter";

export type StudioBg3dMagicBabylonBackend = "webgpu" | "webgl2";

/** Capabilities every Magic object-ID runtime must advertise at the registry boundary. */
export const STUDIO_BG3D_MAGIC_OBJECT_ID_RUNTIME_CAPABILITIES = Object.freeze([
  "capture-rgba-depth",
  "multi-artifact-capture",
] as const);

export interface StudioBg3dMagicObjectIdCanvas {
  width: number;
  height: number;
}

export interface StudioBg3dMagicObjectIdRuntimeFactoryInput {
  readonly backend: StudioBg3dMagicBabylonBackend;
  readonly canvas: StudioBg3dMagicObjectIdCanvas;
  readonly capabilities: typeof STUDIO_BG3D_MAGIC_OBJECT_ID_RUNTIME_CAPABILITIES;
  readonly settings: {
    readonly failIfMajorPerformanceCaveat: boolean;
  };
}

export interface CaptureStudioBg3dMagicObjectIdsInput {
  readonly snapshot: StudioBg3dRuntimeSnapshot;
  readonly width: number;
  readonly height: number;
  readonly jobId: string;
  readonly backends: readonly StudioBg3dMagicBabylonBackend[];
  readonly createCanvas: () => StudioBg3dMagicObjectIdCanvas;
  readonly createRuntime: (
    input: StudioBg3dMagicObjectIdRuntimeFactoryInput,
  ) => StudioBg3dRuntimeAdapter;
  readonly signal?: AbortSignal;
}

export interface StudioBg3dMagicObjectIdCaptureResult {
  readonly width: number;
  readonly height: number;
  readonly objectIds: Uint32Array;
  readonly legend: readonly StudioBg3dStableIdLegendEntry[];
  readonly backend: StudioBg3dMagicBabylonBackend;
  readonly attempts: readonly StudioBg3dAtomicSpecialistAttempt[];
}

export type StudioBg3dMagicObjectIdCaptureErrorCode =
  | "aborted"
  | "capture-failed"
  | "invalid-input"
  | "invalid-result";

export class StudioBg3dMagicObjectIdCaptureError extends Error {
  constructor(
    readonly code: StudioBg3dMagicObjectIdCaptureErrorCode,
    cause?: unknown,
  ) {
    super(
      `studio-bg3d-magic-object-id-capture:${code}`,
      cause === undefined ? undefined : { cause },
    );
    this.name = code === "aborted"
      ? "AbortError"
      : "StudioBg3dMagicObjectIdCaptureError";
  }
}

function captureError(
  code: StudioBg3dMagicObjectIdCaptureErrorCode,
  cause?: unknown,
): StudioBg3dMagicObjectIdCaptureError {
  return new StudioBg3dMagicObjectIdCaptureError(code, cause);
}

function validateBackends(
  backends: readonly StudioBg3dMagicBabylonBackend[],
): readonly StudioBg3dMagicBabylonBackend[] {
  if (
    !Array.isArray(backends) ||
    backends.length !== 1 ||
    backends.some((backend) => backend !== "webgpu" && backend !== "webgl2") ||
    new Set(backends).size !== backends.length
  ) {
    throw captureError("invalid-input");
  }
  return Object.freeze([...backends]);
}

function runtimeIdFor(
  backend: StudioBg3dMagicBabylonBackend,
): "babylon-webgpu-lab" | "babylon-webgl-lab" {
  return backend === "webgpu" ? "babylon-webgpu-lab" : "babylon-webgl-lab";
}

function backendForRuntimeId(
  runtimeId: string,
): StudioBg3dMagicBabylonBackend | null {
  if (runtimeId === "babylon-webgpu-lab") return "webgpu";
  if (runtimeId === "babylon-webgl-lab") return "webgl2";
  return null;
}

function validateInput(
  input: CaptureStudioBg3dMagicObjectIdsInput,
): readonly StudioBg3dMagicBabylonBackend[] {
  if (
    !input ||
    typeof input !== "object" ||
    !Number.isSafeInteger(input.width) ||
    input.width < 1 ||
    !Number.isSafeInteger(input.height) ||
    input.height < 1 ||
    input.width * input.height > 16_777_216 ||
    typeof input.jobId !== "string" ||
    input.jobId.length < 1 ||
    input.jobId.length > 96 ||
    typeof input.createCanvas !== "function" ||
    typeof input.createRuntime !== "function"
  ) {
    throw captureError("invalid-input");
  }
  return validateBackends(input.backends);
}

/**
 * Captures one authoritative object-ID plane from an isolated Babylon specialist transaction.
 *
 * The function owns the one runtime it creates. Its backend is an explicit product choice; runtime
 * failure is terminal and never advances to another engine. The generic atomic coordinator remains
 * reusable by diagnostics that intentionally run engines as separate, manually selected jobs.
 */
export async function captureStudioBg3dMagicObjectIds(
  input: CaptureStudioBg3dMagicObjectIdsInput,
): Promise<StudioBg3dMagicObjectIdCaptureResult> {
  const backends = validateInput(input);
  if (input.signal?.aborted) throw captureError("aborted");

  const registry = new StudioBg3dRuntimeAdapterRegistry();
  try {
    for (const backend of backends) {
      const canvas = input.createCanvas();
      if (!canvas || typeof canvas !== "object") throw captureError("invalid-input");
      canvas.width = input.width;
      canvas.height = input.height;
      registry.register(input.createRuntime({
        backend,
        canvas,
        capabilities: STUDIO_BG3D_MAGIC_OBJECT_ID_RUNTIME_CAPABILITIES,
        settings: { failIfMajorPerformanceCaveat: false },
      }));
    }

    const captured = await runStudioBg3dAtomicSpecialist({
      registry,
      jobId: input.jobId,
      snapshot: input.snapshot,
      request: {
        kind: "artifact-capture-v2",
        version: STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
        width: input.width,
        height: input.height,
        artifacts: [{
          kind: "object-id",
          profile: STUDIO_BG3D_STABLE_ID_PROFILE,
        }],
      },
      candidates: backends.map((backend) => ({
        runtimeId: runtimeIdFor(backend),
      })),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const normalized = normalizeStudioBg3dArtifactCaptureResultV2(captured.result);
    const artifact = normalized?.artifacts[0];
    const backend = backendForRuntimeId(captured.runtimeId);
    if (
      !normalized ||
      normalized.width !== input.width ||
      normalized.height !== input.height ||
      normalized.artifacts.length !== 1 ||
      artifact?.kind !== "object-id" ||
      artifact.profile !== STUDIO_BG3D_STABLE_ID_PROFILE ||
      artifact.width !== input.width ||
      artifact.height !== input.height ||
      artifact.data.length !== input.width * input.height ||
      !backend
    ) {
      throw captureError("invalid-result");
    }
    return Object.freeze({
      width: normalized.width,
      height: normalized.height,
      objectIds: Uint32Array.from(artifact.data),
      legend: Object.freeze(artifact.legend.map((entry) =>
        Object.freeze({ ...entry })
      )),
      backend,
      attempts: Object.freeze(captured.attempts.map((attempt) =>
        Object.freeze({ ...attempt })
      )),
    });
  } catch (error) {
    if (error instanceof StudioBg3dMagicObjectIdCaptureError) throw error;
    if (
      input.signal?.aborted ||
      (
        error instanceof StudioBg3dAtomicSpecialistError &&
        error.code === "aborted"
      )
    ) {
      throw captureError("aborted", error);
    }
    throw captureError("capture-failed", error);
  } finally {
    await registry.dispose();
  }
}
