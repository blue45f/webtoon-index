/**
 * Studio-wide renderer failure policy.
 *
 * A provider is selected before work starts. Capability rejection, startup failure, device loss,
 * or presentation failure terminates that selection as unavailable; none of those events grant a
 * different provider pixel authority. Another engine may run only after an explicit user or
 * product-boundary selection on a later operation.
 */

export const STUDIO_ENGINE_FAILURE_POLICY_VERSION = 2 as const;

export const STUDIO_ENGINE_FAILURE_POLICY = Object.freeze({
  version: STUDIO_ENGINE_FAILURE_POLICY_VERSION,
  automaticCrossProviderFallbackAllowed: false as const,
  automaticExecutionBackendFallbackAllowed: false as const,
  retryDifferentProviderAllowed: false as const,
  workerDirectSubstitutionAllowed: false as const,
  wasmJsSubstitutionAllowed: false as const,
  gpuCpuSubstitutionAllowed: false as const,
  preserveLastPresentedFrame: true as const,
  cpuReferenceRole: "explicit-reference-or-export-only" as const,
  alternateEngineSelection: "explicit-next-operation-only" as const,
  legacyCompatibilityBoundary: "declared-before-operation" as const,
});

export type StudioEngineFailureStage =
  | "capability"
  | "initialization"
  | "worker-startup"
  | "wasm-load"
  | "inference"
  | "codec"
  | "export"
  | "render"
  | "presentation"
  | "device-loss";

export interface StudioEngineUnavailableDetail {
  readonly providerId: string;
  readonly stage: StudioEngineFailureStage;
  readonly message: string;
  readonly cause?: unknown;
}

/** Structured, user-presentable failure for one already-selected engine. */
export class StudioEngineUnavailableError extends Error {
  readonly providerId: string;
  readonly stage: StudioEngineFailureStage;
  override readonly cause?: unknown;

  constructor(detail: StudioEngineUnavailableDetail) {
    super(detail.message);
    this.name = "StudioEngineUnavailableError";
    this.providerId = detail.providerId;
    this.stage = detail.stage;
    this.cause = detail.cause;
  }
}

export interface StudioEngineAttemptAudit {
  readonly selectedProviderId: string;
  readonly attemptedProviderIds: readonly string[];
}

/**
 * Runtime guard for integration seams. Re-attempting the selected provider is allowed; attempting
 * any different provider within the same operation is an automatic fallback and throws.
 */
export function assertNoStudioEngineFallback(audit: StudioEngineAttemptAudit): void {
  const selected = audit.selectedProviderId.trim();
  if (selected.length === 0) {
    throw new Error("Studio engine selection requires a non-empty provider id.");
  }
  const substituted = audit.attemptedProviderIds.find(
    (providerId) => providerId.trim() !== selected,
  );
  if (substituted !== undefined) {
    throw new Error(
      `Automatic Studio engine fallback is disabled: selected ${selected}, attempted ${substituted}.`,
    );
  }
}
