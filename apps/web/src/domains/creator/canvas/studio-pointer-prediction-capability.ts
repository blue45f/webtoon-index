export type StudioPointerPredictionPreference = "auto" | "off";

export interface StudioPointerPredictionEnvironment {
  readonly PointerEvent?: {
    readonly prototype?: {
      readonly getPredictedEvents?: unknown;
    };
  };
  readonly requestAnimationFrame?: unknown;
  readonly prefersReducedMotion?: boolean;
}

export interface StudioPointerPredictionSessionLike {
  readonly pointerType: "pen" | "touch" | "mouse" | "unknown";
}

/**
 * Unknown deployment values fail closed. This keeps a typo from silently enabling a transient
 * input path on every browser while still making the production default capability-driven.
 */
export function resolveStudioPointerPredictionPreference(
  value: unknown
): StudioPointerPredictionPreference {
  if (value === undefined || value === null || value === "" || value === "auto") return "auto";
  return "off";
}

/**
 * Pointer prediction is useful only when the browser exposes the native predicted-event API and
 * can present the replaceable tail on animation frames. Reduced-motion users retain the exact
 * hardware-only path because the speculative tip can visibly overshoot before correction.
 */
export function supportsStudioPointerPrediction(
  preference: StudioPointerPredictionPreference,
  environment: StudioPointerPredictionEnvironment
): boolean {
  return preference === "auto"
    && environment.prefersReducedMotion !== true
    && typeof environment.requestAnimationFrame === "function"
    && typeof environment.PointerEvent?.prototype?.getPredictedEvents === "function";
}

export function studioPointerPredictionEnvironment(): StudioPointerPredictionEnvironment {
  let prefersReducedMotion = false;
  try {
    prefersReducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    // Restricted webviews can throw while evaluating media queries. The capability checks below
    // still fail closed if their Pointer Events implementation is incomplete.
  }
  return {
    PointerEvent: globalThis.PointerEvent,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    prefersReducedMotion,
  };
}

/** Mouse/touch estimates are intentionally excluded until their palm/scroll behavior is gated. */
export function canUseStudioPointerPredictionForSession(
  capabilityEnabled: boolean,
  session: StudioPointerPredictionSessionLike | null | undefined
): boolean {
  return capabilityEnabled && session?.pointerType === "pen";
}

/**
 * Native predictions are worth collecting only after the stroke owns a replaceable presentation
 * tail. Without that surface the fallback preview clones the full authoritative prefix, adding
 * latency without presenting a prediction that can be safely corrected.
 */
export function canCollectStudioPointerPredictionsForActiveTail(
  capabilityEnabled: boolean,
  session: StudioPointerPredictionSessionLike | null | undefined,
  replaceableTailArmed: boolean
): boolean {
  return replaceableTailArmed
    && canUseStudioPointerPredictionForSession(capabilityEnabled, session);
}
