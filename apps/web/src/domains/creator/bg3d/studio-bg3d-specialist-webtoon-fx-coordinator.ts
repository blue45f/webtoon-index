/**
 * Renderer-neutral coordinator for the first production-safe specialist Webtoon FX slice.
 *
 * The coordinator snapshots one bounded FX recipe, derives one exact multi-artifact request, and
 * delegates the whole capture transaction to the preselected atomic runtime. It never mixes
 * artifacts from multiple engines or retries another engine. Only after that runtime returns a
 * complete canonical bundle does the bounded CPU compositor receive it.
 */

import {
  STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
  STUDIO_BG3D_BEAUTY_RGBA8_PROFILE,
  STUDIO_BG3D_DEPTH_FLOAT32_PROFILE,
  STUDIO_BG3D_EMISSION_RGBA8_PROFILE,
  STUDIO_BG3D_NORMAL_PROFILE,
  normalizeStudioBg3dArtifactCaptureResultV2,
  type StudioBg3dArtifactCaptureRequestV2,
  type StudioBg3dRequestedArtifactV2,
} from "./studio-bg3d-artifact-capture-v2";
import {
  STUDIO_BG3D_ARTIFACT_FX_CPU_MAX_PIXELS,
  StudioBg3dArtifactFxError,
  renderStudioBg3dArtifactWebtoonFx,
} from "./studio-bg3d-artifact-webtoon-fx";
import {
  StudioBg3dAtomicSpecialistError,
  runStudioBg3dAtomicSpecialist,
  type StudioBg3dAtomicSpecialistAttempt,
  type StudioBg3dAtomicSpecialistCandidate,
} from "./studio-bg3d-atomic-specialist-failover";
import {
  normalizeStudioBg3dWebtoonFxCaptureRequest,
  type StudioBg3dWebtoonFxCaptureRequest,
  type StudioBg3dWebtoonFxPass,
} from "./studio-bg3d-webtoon-fx";

import type {
  StudioBg3dRuntimeAdapterRegistry,
  StudioBg3dRuntimeSnapshot,
  StudioBg3dSpecialistResult,
} from "./studio-bg3d-runtime-adapter";
import type { StudioBg3dRuntimeId } from "./studio-bg3d-runtime-topology";

export const STUDIO_BG3D_SPECIALIST_WEBTOON_FX_CPU_PLAN_VERSION = 1 as const;
export const STUDIO_BG3D_SPECIALIST_WEBTOON_FX_CPU_EXECUTOR =
  "artifact-webtoon-fx-cpu-v1" as const;

type StudioBg3dCpuFxCaptureResult = Extract<
  StudioBg3dSpecialistResult,
  { readonly kind: "capture" }
>;

export interface StudioBg3dSpecialistWebtoonFxCpuPlan {
  readonly kind: typeof STUDIO_BG3D_SPECIALIST_WEBTOON_FX_CPU_EXECUTOR;
  readonly version: typeof STUDIO_BG3D_SPECIALIST_WEBTOON_FX_CPU_PLAN_VERSION;
  readonly width: number;
  readonly height: number;
  readonly quality: StudioBg3dWebtoonFxCaptureRequest["quality"];
  readonly outputIntent: StudioBg3dWebtoonFxCaptureRequest["outputIntent"];
  readonly outputProfile: StudioBg3dWebtoonFxCaptureRequest["outputProfile"];
  readonly includeDepth: boolean;
  readonly sourceArtifacts: readonly StudioBg3dRequestedArtifactV2[];
  readonly effects: readonly StudioBg3dWebtoonFxPass[];
}

export interface StudioBg3dSpecialistWebtoonFxProvenance {
  /** The runtime that produced every source artifact in this result. */
  readonly runtimeId: StudioBg3dRuntimeId;
  readonly attempts: readonly StudioBg3dAtomicSpecialistAttempt[];
  readonly cpuEffectPlan: StudioBg3dSpecialistWebtoonFxCpuPlan;
}

export interface StudioBg3dSpecialistWebtoonFxSuccess {
  readonly kind: "specialist-webtoon-fx-result";
  readonly result: StudioBg3dCpuFxCaptureResult;
  readonly provenance: StudioBg3dSpecialistWebtoonFxProvenance;
}

export type StudioBg3dSpecialistWebtoonFxCoordinatorErrorCode =
  | "aborted"
  | "artifact-capture-failed"
  | "effect-composition-failed"
  | "invalid-artifact-result"
  | "invalid-request"
  | "missing-artifact"
  | "pixel-budget-exceeded"
  | "unsupported-effect";

export class StudioBg3dSpecialistWebtoonFxCoordinatorError extends Error {
  readonly code: StudioBg3dSpecialistWebtoonFxCoordinatorErrorCode;
  readonly attempts: readonly StudioBg3dAtomicSpecialistAttempt[];

  constructor(
    code: StudioBg3dSpecialistWebtoonFxCoordinatorErrorCode,
    attempts: readonly StudioBg3dAtomicSpecialistAttempt[] = [],
    cause?: unknown,
  ) {
    super(
      `Studio 3D specialist Webtoon FX coordination failed: ${code}`,
      cause === undefined ? undefined : { cause },
    );
    this.name = "StudioBg3dSpecialistWebtoonFxCoordinatorError";
    this.code = code;
    this.attempts = freezeAttempts(attempts);
  }
}

export interface RunStudioBg3dSpecialistWebtoonFxCoordinatorInput {
  readonly registry: StudioBg3dRuntimeAdapterRegistry;
  readonly jobId: string;
  readonly snapshot: StudioBg3dRuntimeSnapshot;
  readonly request: StudioBg3dWebtoonFxCaptureRequest;
  readonly candidates: readonly StudioBg3dAtomicSpecialistCandidate[];
  readonly signal?: AbortSignal;
}

function freezeAttempts(
  attempts: readonly StudioBg3dAtomicSpecialistAttempt[],
): readonly StudioBg3dAtomicSpecialistAttempt[] {
  return Object.freeze(attempts.map((attempt) => Object.freeze({ ...attempt })));
}

function throwIfAborted(
  signal: AbortSignal,
  attempts: readonly StudioBg3dAtomicSpecialistAttempt[] = [],
): void {
  if (signal.aborted) {
    throw new StudioBg3dSpecialistWebtoonFxCoordinatorError(
      "aborted",
      attempts,
    );
  }
}

function validateCpuEffectPlan(
  request: StudioBg3dWebtoonFxCaptureRequest,
): void {
  for (const effect of request.effects) {
    switch (effect.kind) {
      case "toon-outline":
      case "depth-atmosphere":
      case "emissive-bloom":
        break;
      case "depth-of-field":
      case "weather-particles":
      case "speed-lines":
        throw new StudioBg3dSpecialistWebtoonFxCoordinatorError(
          "unsupported-effect",
        );
    }
  }
}

function buildArtifactCaptureRequest(
  request: StudioBg3dWebtoonFxCaptureRequest,
): StudioBg3dArtifactCaptureRequestV2 {
  const needsDepth =
    request.includeDepth ||
    request.effects.some((effect) =>
      effect.kind === "depth-atmosphere" || effect.kind === "toon-outline"
    );
  const needsNormal = request.effects.some(
    (effect) => effect.kind === "toon-outline",
  );
  const needsEmission = request.effects.some(
    (effect) => effect.kind === "emissive-bloom",
  );
  const artifacts: StudioBg3dRequestedArtifactV2[] = [{
    kind: "beauty",
    profile: STUDIO_BG3D_BEAUTY_RGBA8_PROFILE,
  }];
  if (needsDepth) {
    artifacts.push({
      kind: "depth",
      profile: STUDIO_BG3D_DEPTH_FLOAT32_PROFILE,
    });
  }
  if (needsNormal) {
    artifacts.push({
      kind: "normal",
      profile: STUDIO_BG3D_NORMAL_PROFILE,
    });
  }
  if (needsEmission) {
    artifacts.push({
      kind: "emission",
      profile: STUDIO_BG3D_EMISSION_RGBA8_PROFILE,
    });
  }
  return Object.freeze({
    kind: "artifact-capture-v2",
    version: STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
    width: request.width,
    height: request.height,
    artifacts: Object.freeze(artifacts.map((artifact) => Object.freeze(artifact))),
  });
}

function createCpuEffectPlan(
  request: StudioBg3dWebtoonFxCaptureRequest,
  captureRequest: StudioBg3dArtifactCaptureRequestV2,
): StudioBg3dSpecialistWebtoonFxCpuPlan {
  return Object.freeze({
    kind: STUDIO_BG3D_SPECIALIST_WEBTOON_FX_CPU_EXECUTOR,
    version: STUDIO_BG3D_SPECIALIST_WEBTOON_FX_CPU_PLAN_VERSION,
    width: request.width,
    height: request.height,
    quality: request.quality,
    outputIntent: request.outputIntent,
    outputProfile: request.outputProfile,
    includeDepth: request.includeDepth,
    sourceArtifacts: captureRequest.artifacts,
    effects: request.effects,
  });
}

function assertCompleteArtifactBundle(
  value: unknown,
  request: StudioBg3dArtifactCaptureRequestV2,
): NonNullable<ReturnType<typeof normalizeStudioBg3dArtifactCaptureResultV2>> {
  const capture = normalizeStudioBg3dArtifactCaptureResultV2(value);
  if (
    !capture ||
    capture.width !== request.width ||
    capture.height !== request.height ||
    capture.artifacts.length !== request.artifacts.length
  ) {
    throw new StudioBg3dSpecialistWebtoonFxCoordinatorError(
      "invalid-artifact-result",
    );
  }
  const profilesByKind = new Map(
    capture.artifacts.map((artifact) => [artifact.kind, artifact.profile] as const),
  );
  if (request.artifacts.some((artifact) =>
    profilesByKind.get(artifact.kind) !== artifact.profile
  )) {
    throw new StudioBg3dSpecialistWebtoonFxCoordinatorError(
      "missing-artifact",
    );
  }
  return capture;
}

function coordinatorErrorFromAtomic(
  error: StudioBg3dAtomicSpecialistError,
): StudioBg3dSpecialistWebtoonFxCoordinatorError {
  return new StudioBg3dSpecialistWebtoonFxCoordinatorError(
    error.code === "aborted" ? "aborted" : "artifact-capture-failed",
    error.attempts,
    error,
  );
}

function coordinatorErrorFromCpu(
  error: StudioBg3dArtifactFxError,
  attempts: readonly StudioBg3dAtomicSpecialistAttempt[],
): StudioBg3dSpecialistWebtoonFxCoordinatorError {
  const code: StudioBg3dSpecialistWebtoonFxCoordinatorErrorCode =
    error.code === "aborted"
      ? "aborted"
      : error.code === "pixel-budget-exceeded"
        ? "pixel-budget-exceeded"
        : error.code === "missing-artifact"
          ? "missing-artifact"
          : error.code === "unsupported-effect"
            ? "unsupported-effect"
            : "effect-composition-failed";
  return new StudioBg3dSpecialistWebtoonFxCoordinatorError(
    code,
    attempts,
    error,
  );
}

/**
 * Captures one all-or-nothing artifact bundle and applies one immutable CPU FX plan.
 *
 * Candidate runtimes are never run concurrently and their artifacts are never merged. A caller
 * abort, malformed request/result, unsupported pass, or missing required artifact fails without a
 * commit-worthy output.
 */
export async function runStudioBg3dSpecialistWebtoonFxCoordinator(
  input: RunStudioBg3dSpecialistWebtoonFxCoordinatorInput,
): Promise<StudioBg3dSpecialistWebtoonFxSuccess> {
  const signal = input.signal ?? new AbortController().signal;
  throwIfAborted(signal);
  const request = normalizeStudioBg3dWebtoonFxCaptureRequest(input.request);
  if (!request) {
    throw new StudioBg3dSpecialistWebtoonFxCoordinatorError("invalid-request");
  }
  if (
    request.width * request.height >
    STUDIO_BG3D_ARTIFACT_FX_CPU_MAX_PIXELS
  ) {
    throw new StudioBg3dSpecialistWebtoonFxCoordinatorError(
      "pixel-budget-exceeded",
    );
  }
  validateCpuEffectPlan(request);
  const captureRequest = buildArtifactCaptureRequest(request);
  const cpuEffectPlan = createCpuEffectPlan(request, captureRequest);

  let atomicResult;
  try {
    atomicResult = await runStudioBg3dAtomicSpecialist({
      registry: input.registry,
      jobId: input.jobId,
      snapshot: input.snapshot,
      request: captureRequest,
      candidates: input.candidates,
      signal,
    });
  } catch (error) {
    if (error instanceof StudioBg3dAtomicSpecialistError) {
      throw coordinatorErrorFromAtomic(error);
    }
    throw new StudioBg3dSpecialistWebtoonFxCoordinatorError(
      signal.aborted ? "aborted" : "artifact-capture-failed",
      [],
      error,
    );
  }

  throwIfAborted(signal, atomicResult.attempts);
  let capture;
  try {
    capture = assertCompleteArtifactBundle(atomicResult.result, captureRequest);
  } catch (error) {
    if (error instanceof StudioBg3dSpecialistWebtoonFxCoordinatorError) {
      throw new StudioBg3dSpecialistWebtoonFxCoordinatorError(
        error.code,
        atomicResult.attempts,
        error,
      );
    }
    throw new StudioBg3dSpecialistWebtoonFxCoordinatorError(
      "invalid-artifact-result",
      atomicResult.attempts,
      error,
    );
  }

  let result: StudioBg3dSpecialistResult;
  try {
    result = renderStudioBg3dArtifactWebtoonFx(capture, request, { signal });
  } catch (error) {
    if (error instanceof StudioBg3dArtifactFxError) {
      throw coordinatorErrorFromCpu(error, atomicResult.attempts);
    }
    throw new StudioBg3dSpecialistWebtoonFxCoordinatorError(
      signal.aborted ? "aborted" : "effect-composition-failed",
      atomicResult.attempts,
      error,
    );
  }
  if (result.kind !== "capture") {
    throw new StudioBg3dSpecialistWebtoonFxCoordinatorError(
      "effect-composition-failed",
      atomicResult.attempts,
    );
  }
  throwIfAborted(signal, atomicResult.attempts);

  return Object.freeze({
    kind: "specialist-webtoon-fx-result",
    result,
    provenance: Object.freeze({
      runtimeId: atomicResult.runtimeId,
      attempts: freezeAttempts(atomicResult.attempts),
      cpuEffectPlan,
    }),
  });
}
