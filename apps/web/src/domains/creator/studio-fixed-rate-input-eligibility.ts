/**
 * Pure policy boundary for the Studio fixed-rate pointer sampler.
 *
 * This module deliberately knows nothing about React, Konva, brush preset ids, or persisted draw
 * elements. Callers resolve those richer values into one render family and two versioned causal
 * capability flags. Keeping the decision here prevents a new specialty brush from accidentally
 * entering the 5ms sampler while its renderer still replans an already-visible prefix.
 *
 * Magma's processed-input path has two distinct clocks: eligible brushes consume quantized
 * coalesced samples immediately at strength zero, while a positive strength adds the 5ms
 * zero-order-hold cascade. Keeping both decisions here prevents the zero-strength path from
 * accidentally acquiring one logical tick of latency again.
 */

export interface StudioFixedRateInputEligibility {
  readonly stabilizerMode: unknown;
  /** A finite value above zero enables the fixed-rate stabilizer after causal eligibility. */
  readonly stabilizerStrength?: unknown;
  readonly drawMode: unknown;
  readonly brushFamily: unknown;
  /** True when the selected brush has a whole-stroke dynamics planner. */
  readonly hasBrushDynamics?: boolean;
  /** True only for the append-only, versioned stamp walker. */
  readonly causalStampV2?: boolean;
  /** True only for the append-only, versioned watercolor walker. */
  readonly causalWatercolorV2?: boolean;
}

export type StudioCausalInkInputMode = "legacy" | "immediate" | "fixed-rate";

export interface StudioCausalInkInputPlan {
  readonly mode: StudioCausalInkInputMode;
  /** Causal walkers consume every distinct quantized sample and own their own spatial spacing. */
  readonly sampleSpacing: 0 | null;
  readonly usesFixedRateClock: boolean;
  readonly quantizeImmediately: boolean;
}

/**
 * Whether authoritative samples may use the causal, quantized input path.
 *
 * Adaptive and precision modes retain their dedicated raw-cadence algorithms. Shape-like tools
 * replace an endpoint rather than append a freehand suffix, and legacy/specialty planners remain
 * outside both immediate and fixed-rate paths until they have an explicit causal version flag.
 */
export function isStudioCausalInkInputEligible(
  input: StudioFixedRateInputEligibility
): boolean {
  if (input.stabilizerMode !== "standard") return false;
  if (input.hasBrushDynamics === true) return false;

  if (input.drawMode === "eraser") return true;
  if (input.drawMode !== "pen") return false;

  if (input.causalStampV2 === true) return true;
  if (
    input.brushFamily === "pen"
    || input.brushFamily === "marker"
    || input.brushFamily === "gpen"
  ) return true;
  return input.brushFamily === "watercolor" && input.causalWatercolorV2 === true;
}

/** Whether an eligible causal brush also needs Magma's 5ms stabilizer clock. */
export function isStudioFixedRateInputEligible(
  input: StudioFixedRateInputEligibility
): boolean {
  if (!isStudioCausalInkInputEligible(input)) return false;
  return typeof input.stabilizerStrength === "number"
    && Number.isFinite(input.stabilizerStrength)
    && input.stabilizerStrength > 0;
}

/** One shared routing contract for StudioPage, tests, and future GPU input backends. */
export function resolveStudioCausalInkInputPlan(
  input: StudioFixedRateInputEligibility
): StudioCausalInkInputPlan {
  if (!isStudioCausalInkInputEligible(input)) {
    return {
      mode: "legacy",
      sampleSpacing: null,
      usesFixedRateClock: false,
      quantizeImmediately: false,
    };
  }
  if (isStudioFixedRateInputEligible(input)) {
    return {
      mode: "fixed-rate",
      sampleSpacing: 0,
      usesFixedRateClock: true,
      quantizeImmediately: false,
    };
  }
  return {
    mode: "immediate",
    sampleSpacing: 0,
    usesFixedRateClock: false,
    quantizeImmediately: true,
  };
}
