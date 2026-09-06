/**
 * Renderer-neutral, fail-closed specialist transaction.
 *
 * A capture attempt is authoritative only after one registered runtime returns a fully validated
 * result through the runtime registry. Exactly one runtime is selected before execution; a failed
 * attempt is surfaced and is never replayed through another engine.
 */

import {
  snapshotStudioBg3dSpecialistRequest,
  type StudioBg3dRuntimeAdapterRegistry,
  type StudioBg3dRuntimeSnapshot,
  type StudioBg3dSpecialistRequest,
  type StudioBg3dSpecialistResult,
} from "./studio-bg3d-runtime-adapter";
import {
  STUDIO_BG3D_RUNTIME_CATALOG,
  type StudioBg3dRuntimeId,
} from "./studio-bg3d-runtime-topology";

export const STUDIO_BG3D_ATOMIC_SELECTED_RUNTIME_COUNT = 1;

export type StudioBg3dAtomicAttemptErrorCode =
  | "adapter-not-registered"
  | "binding-load-failed"
  | "capability-unavailable"
  | "context-lost"
  | "device-lost"
  | "engine-init-failed"
  | "renderer-unavailable"
  | "unsupported-artifact"
  | "unsupported-scene-feature"
  | "unknown";

export interface StudioBg3dAtomicSpecialistCandidate {
  readonly runtimeId: StudioBg3dRuntimeId;
}

export interface StudioBg3dAtomicSpecialistAttempt {
  readonly runtimeId: StudioBg3dRuntimeId;
  readonly outcome: "aborted" | "failed" | "succeeded";
  readonly errorCode?: StudioBg3dAtomicAttemptErrorCode;
}

export interface StudioBg3dAtomicSpecialistSuccess {
  readonly runtimeId: StudioBg3dRuntimeId;
  readonly result: StudioBg3dSpecialistResult;
  readonly attempts: readonly StudioBg3dAtomicSpecialistAttempt[];
}

export type StudioBg3dAtomicSpecialistErrorCode =
  | "aborted"
  | "invalid-candidates"
  | "terminal-attempt-failed";

export class StudioBg3dAtomicSpecialistError extends Error {
  readonly code: StudioBg3dAtomicSpecialistErrorCode;
  readonly attempts: readonly StudioBg3dAtomicSpecialistAttempt[];

  constructor(
    code: StudioBg3dAtomicSpecialistErrorCode,
    attempts: readonly StudioBg3dAtomicSpecialistAttempt[] = [],
    cause?: unknown,
  ) {
    super(
      `Studio 3D atomic specialist transaction failed: ${code}`,
      cause === undefined ? undefined : { cause },
    );
    this.name = "StudioBg3dAtomicSpecialistError";
    this.code = code;
    this.attempts = freezeAttempts(attempts);
  }
}

export interface RunStudioBg3dAtomicSpecialistInput {
  readonly registry: StudioBg3dRuntimeAdapterRegistry;
  readonly jobId: string;
  readonly snapshot: StudioBg3dRuntimeSnapshot;
  readonly request: StudioBg3dSpecialistRequest;
  readonly candidates: readonly StudioBg3dAtomicSpecialistCandidate[];
  readonly signal?: AbortSignal;
}

const KNOWN_ATTEMPT_ERROR_CODES = new Set<StudioBg3dAtomicAttemptErrorCode>([
  "adapter-not-registered",
  "binding-load-failed",
  "capability-unavailable",
  "context-lost",
  "device-lost",
  "engine-init-failed",
  "renderer-unavailable",
  "unsupported-artifact",
  "unsupported-scene-feature",
]);

function freezeAttempts(
  attempts: readonly StudioBg3dAtomicSpecialistAttempt[],
): readonly StudioBg3dAtomicSpecialistAttempt[] {
  return Object.freeze(attempts.map((attempt) => Object.freeze({ ...attempt })));
}

function errorCodeOf(error: unknown): string | null {
  try {
    if (!error || typeof error !== "object") return null;
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    if (!descriptor || !("value" in descriptor)) return null;
    return typeof descriptor.value === "string" ? descriptor.value : null;
  } catch {
    return null;
  }
}

function receiptCodeOf(error: unknown): StudioBg3dAtomicAttemptErrorCode {
  const code = errorCodeOf(error);
  return code && KNOWN_ATTEMPT_ERROR_CODES.has(code as StudioBg3dAtomicAttemptErrorCode)
    ? code as StudioBg3dAtomicAttemptErrorCode
    : "unknown";
}

function validateCandidates(
  candidates: readonly StudioBg3dAtomicSpecialistCandidate[],
): readonly StudioBg3dAtomicSpecialistCandidate[] {
  if (
    !Array.isArray(candidates) ||
    candidates.length !== STUDIO_BG3D_ATOMIC_SELECTED_RUNTIME_COUNT
  ) {
    throw new StudioBg3dAtomicSpecialistError("invalid-candidates");
  }
  const runtimeIds = new Set<StudioBg3dRuntimeId>();
  const normalized = candidates.map((candidate) => {
    let runtimeId: unknown;
    try {
      if (!candidate || typeof candidate !== "object") {
        throw new StudioBg3dAtomicSpecialistError("invalid-candidates");
      }
      const descriptor = Object.getOwnPropertyDescriptor(candidate, "runtimeId");
      runtimeId = descriptor && "value" in descriptor ? descriptor.value : null;
    } catch {
      throw new StudioBg3dAtomicSpecialistError("invalid-candidates");
    }
    if (
      typeof runtimeId !== "string" ||
      !Object.hasOwn(STUDIO_BG3D_RUNTIME_CATALOG, runtimeId) ||
      runtimeIds.has(runtimeId as StudioBg3dRuntimeId)
    ) {
      throw new StudioBg3dAtomicSpecialistError("invalid-candidates");
    }
    runtimeIds.add(runtimeId as StudioBg3dRuntimeId);
    return Object.freeze({ runtimeId: runtimeId as StudioBg3dRuntimeId });
  });
  return Object.freeze(normalized);
}

/**
 * Runs one immutable request against the single runtime chosen before the transaction starts.
 * Every failure is terminal for that transaction, including availability and device loss.
 */
export async function runStudioBg3dAtomicSpecialist(
  input: RunStudioBg3dAtomicSpecialistInput,
): Promise<StudioBg3dAtomicSpecialistSuccess> {
  const candidates = validateCandidates(input.candidates);
  const request = snapshotStudioBg3dSpecialistRequest(input.request, input.snapshot);
  if (!request) {
    throw new StudioBg3dAtomicSpecialistError("terminal-attempt-failed");
  }
  const attempts: StudioBg3dAtomicSpecialistAttempt[] = [];
  const signal = input.signal ?? new AbortController().signal;

  const candidate = candidates[0]!;
  if (signal.aborted) {
    throw new StudioBg3dAtomicSpecialistError("aborted", attempts);
  }
  try {
    const result = await input.registry.run(
      candidate.runtimeId,
      input.jobId,
      input.snapshot,
      request,
      signal,
    );
    if (signal.aborted) {
      attempts.push(Object.freeze({
        runtimeId: candidate.runtimeId,
        outcome: "aborted",
      }));
      throw new StudioBg3dAtomicSpecialistError("aborted", attempts);
    }
    attempts.push(Object.freeze({
      runtimeId: candidate.runtimeId,
      outcome: "succeeded",
    }));
    return Object.freeze({
      runtimeId: candidate.runtimeId,
      result,
      attempts: freezeAttempts(attempts),
    });
  } catch (error) {
    if (
      error instanceof StudioBg3dAtomicSpecialistError
      && error.code === "aborted"
    ) throw error;
    const rawCode = errorCodeOf(error);
    if (signal.aborted || rawCode === "aborted") {
      attempts.push(Object.freeze({
        runtimeId: candidate.runtimeId,
        outcome: "aborted",
      }));
      throw new StudioBg3dAtomicSpecialistError("aborted", attempts, error);
    }
    attempts.push(Object.freeze({
      runtimeId: candidate.runtimeId,
      outcome: "failed",
      errorCode: receiptCodeOf(error),
    }));
    throw new StudioBg3dAtomicSpecialistError(
      "terminal-attempt-failed",
      attempts,
      error,
    );
  }
}
