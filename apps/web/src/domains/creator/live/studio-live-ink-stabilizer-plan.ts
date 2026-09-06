import { applyStabilizer } from "@toonspectrum/studio-brush-platform";

import { selectStabilizerBackend } from "../../../../../../packages/studio-brush-platform/src/stabilizer-provider";
import { studioStrokeRouteBrushFamilyKey } from "../brush/studio-stroke-route-tournament";

import type { StudioLiveInkBackendDecision } from "./studio-live-ink-backend";
import type { StudioLiveInkRolloutDecision } from "./studio-live-ink-rollout";
import type {
  SelectStabilizerBackendOptions,
  StabilizerBackendId,
  StabilizerProcessParams,
} from "../../../../../../packages/studio-brush-platform/src/stabilizer-provider";
import type { ModeledSampleIR, StabilizerGraphIR } from "@toonspectrum/studio-project-model";

/**
 * Live-ink stabilizer backend plan — observation-only seam (ADR-0011 lane 3 prep).
 *
 * Connects the un-wired stabilizer provider seam
 * (packages/studio-brush-platform/src/stabilizer-provider.ts, imported by its
 * documented direct path — it is intentionally NOT in the package barrel) to
 * the live-ink contract family without touching any production call site:
 *
 * - Pristine default reproduces the shipped selection logic verbatim. The
 *   current path is `applyStabilizer(samples, program.stabilizer)`
 *   (packages/studio-brush-platform/src/compile.ts:47) whose dispatch is:
 *   `config.kind === "none" || config.strength === 0 || samples.length < 3`
 *   → verbatim copy, otherwise
 *   `config.kind === "ema" ? emaStabilize(...) : springStabilize(...)`
 *   (packages/studio-brush-platform/src/stabilizer.ts). The graph itself comes
 *   from `brushProgramIRSchema.stabilizer` with schema default
 *   `{ kind: "ema", strength: 0.35, predictionMs: 0 }`
 *   (packages/studio-project-model/src/ir/brush.ts). The `< 3 samples` clause
 *   is sample-scoped, not plan-scoped: both the legacy path and the provider
 *   seam route through the same `applyStabilizer` kernel, so the plan does not
 *   restate it.
 * - The quarantined "ink-stroke-modeler" lane stays opt-in (ADR-0009 admission
 *   principle, mirroring `allowInk !== true` in selectStabilizerBackend) and
 *   additionally sits behind the live-ink fleet rollout gate
 *   (studio-live-ink-rollout.ts), the optional stroke-scoped live-ink backend
 *   decision (studio-live-ink-backend.ts), and the renderer-tournament kill
 *   switch (RemoteKillSwitch.isKilled, consumed structurally like
 *   selectFilterLane in studio-renderer-tournament-runtime.ts).
 * - The kill switch applies to the exact provider selected by the existing
 *   admission rules. A killed provider makes the plan unavailable; it never
 *   selects or executes another stabilizer provider.
 *
 * Hot-path contract: pure functions only. No I/O, no awaits, no module state.
 */

/* ------------------------------------------------------------------ */
/* Provider identity + workload bucket                                 */
/* ------------------------------------------------------------------ */

export const STUDIO_LIVE_INK_STABILIZER_PROVIDER_PREFIX = "stabilizer-lane-";

/**
 * Provider id under which a stabilizer lane would race in the tournament and
 * kill switch — same naming pattern as studioStrokeRouteProviderId
 * ("stroke-route-*") so kill/winner state stays one flat provider id space.
 */
export function studioLiveInkStabilizerProviderId(lane: StabilizerBackendId): string {
  return `${STUDIO_LIVE_INK_STABILIZER_PROVIDER_PREFIX}${lane}`;
}

export type StudioLiveInkStabilizerRateBand = "low" | "standard" | "high";

/**
 * Band edges anchored to shipped constants: the neutral pointer cadence
 * estimate is 120Hz (STUDIO_POINTER_DEFAULT_SAMPLE_INTERVAL_MS = 1000/120 in
 * studio-stroke-stabilizer.ts) and the ink lane's default minimum output rate
 * is 180Hz (INK_DEFAULT_PARAMS.minOutputRate). 60Hz-class mice/touch fall
 * below 90Hz; 120Hz pens land in "standard"; 180Hz+ styluses read "high".
 */
export const STUDIO_LIVE_INK_STABILIZER_STANDARD_RATE_MIN_HZ = 90;
export const STUDIO_LIVE_INK_STABILIZER_HIGH_RATE_MIN_HZ = 180;

/**
 * Point-rate band. Degenerate rates (non-finite, zero, negative) map to the
 * standard band — a broken cadence read must not mint a fresh bucket
 * (same policy as studioStrokeRouteScaleBand's degenerate handling).
 */
export function studioLiveInkStabilizerRateBand(
  pointRateHz: number,
): StudioLiveInkStabilizerRateBand {
  if (!Number.isFinite(pointRateHz) || pointRateHz <= 0) return "standard";
  if (pointRateHz < STUDIO_LIVE_INK_STABILIZER_STANDARD_RATE_MIN_HZ) return "low";
  if (pointRateHz < STUDIO_LIVE_INK_STABILIZER_HIGH_RATE_MIN_HZ) return "standard";
  return "high";
}

export type StudioLiveInkStabilizerPointerType = "mouse" | "pen" | "touch" | "unknown";

/** Mirrors normalizeBridgePointerType in studio-stroke-stabilizer.ts. */
export function studioLiveInkStabilizerPointerType(
  value: unknown,
): StudioLiveInkStabilizerPointerType {
  return value === "mouse" || value === "pen" || value === "touch" ? value : "unknown";
}

export const STUDIO_LIVE_INK_STABILIZER_BUCKET_PREFIX = "studio-live-ink-stabilizer";

/**
 * Deterministic workload bucket (brush family × point-rate band × pointer
 * class). Brush family normalization is shared with the stroke-route
 * tournament so the same free-form family label always keys the same way.
 */
export function studioLiveInkStabilizerBucket(input: {
  readonly brushFamily: string;
  readonly pointRateHz: number;
  readonly pointerType?: unknown;
}): string {
  return [
    STUDIO_LIVE_INK_STABILIZER_BUCKET_PREFIX,
    studioStrokeRouteBrushFamilyKey(input.brushFamily),
    `rate:${studioLiveInkStabilizerRateBand(input.pointRateHz)}`,
    `ptr:${studioLiveInkStabilizerPointerType(input.pointerType)}`,
  ].join("|");
}

/* ------------------------------------------------------------------ */
/* Plan contract                                                       */
/* ------------------------------------------------------------------ */

export type StudioLiveInkStabilizerLane = "none" | StabilizerBackendId;

export type StudioLiveInkStabilizerPlanReason =
  /** Graph kind "none" or strength 0 — applyStabilizer's verbatim-copy path. */
  | "stabilizer-disabled"
  /** Pristine outcome: the shipped ema/spring lane with graph params verbatim. */
  | "first-party-current"
  /** Quarantined ink lane admitted through opt-in + rollout + backend gates. */
  | "ink-opt-in";

export type StudioLiveInkStabilizerInkExclusion =
  /** ADR-0009 quarantine default — mirrors `allowInk !== true` in the seam. */
  | "not-opted-in"
  /** Ink must not resurrect smoothing an artist disabled (kind none / strength 0). */
  | "stabilizer-disabled"
  /** Observation caller had no fleet rollout decision — fail closed. */
  | "rollout-missing"
  /** Fleet rollout did not admit this exact ink provider (killed, disabled, excluded, …). */
  | "rollout-not-admitted"
  /** Stroke-scoped live-ink backend decision did not select WebGPU. */
  | "backend-not-webgpu";

/** Structurally satisfied by RemoteKillSwitch (@toonspectrum/studio-engine-registry). */
export interface StudioLiveInkStabilizerKillSwitchLike {
  isKilled(providerId: string): boolean;
}

export interface StudioLiveInkStabilizerPlanInput {
  /** Brush program stabilizer graph — the authoritative current selector. */
  readonly stabilizer: StabilizerGraphIR;
  /** Brush family/category identity (free-form; normalized for the bucket). */
  readonly brushFamily: string;
  /** Device pointer cadence in Hz (coalesced samples per second). */
  readonly pointRateHz: number;
  /** Device pointer class; unknown values normalize to "unknown". */
  readonly pointerType?: unknown;
  /** ADR-0009 quarantined opt-in for the ink lane. Absent means first-party. */
  readonly inkOptIn?: boolean;
  /** Fleet-level live-ink rollout decision (resolveStudioLiveInkRollout). */
  readonly rollout?: StudioLiveInkRolloutDecision | null;
  /** Optional stroke-scoped backend decision (decideStudioLiveInkBackend). */
  readonly liveInkBackend?: StudioLiveInkBackendDecision | null;
  /** Tournament kill switch applied to the exact selected provider. */
  readonly killSwitch?: StudioLiveInkStabilizerKillSwitchLike | null;
}

export interface StudioLiveInkStabilizerPlan {
  readonly lane: StudioLiveInkStabilizerLane;
  /** Provider-seam backend id; null on the disabled/passthrough lane. */
  readonly backendId: StabilizerBackendId | null;
  /** Params for StabilizerBackend.process; null on the disabled lane. */
  readonly params: StabilizerProcessParams | null;
  /** Tournament provider id of the planned lane; null on the disabled lane. */
  readonly providerId: string | null;
  readonly bucket: string;
  readonly reason: StudioLiveInkStabilizerPlanReason;
  /** A killed selected provider is terminal; no alternate provider is selected. */
  readonly status: "selected" | "unavailable";
  readonly unavailableReason: "selected-provider-killed" | null;
  /** First failed ink gate, or null when the ink lane was selected. */
  readonly inkExclusion: StudioLiveInkStabilizerInkExclusion | null;
}

/* ------------------------------------------------------------------ */
/* Parameter derivation                                                */
/* ------------------------------------------------------------------ */

/** Mirrors stabilizerGraphIRSchema defaults (strength 0.35, predictionMs 0). */
const DEFAULT_GRAPH_STRENGTH = 0.35;
const DEFAULT_GRAPH_PREDICTION_MS = 0;

/** Mirrors INK_DEFAULT_PARAMS.minOutputRate (upstream stroke-modeler default). */
export const STUDIO_LIVE_INK_STABILIZER_INK_MIN_OUTPUT_RATE_FLOOR_HZ = 180;
/**
 * Cadence ceiling: studio-stroke-stabilizer clamps sample spacing to
 * MIN_SAMPLE_MS = 1ms, i.e. 1000Hz is the fastest cadence the input model
 * trusts, so the modeler is never asked to out-run that.
 */
export const STUDIO_LIVE_INK_STABILIZER_INK_MIN_OUTPUT_RATE_CEILING_HZ = 1000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Out-of-model numbers cannot reach the legacy path through zod-validated
 * brush programs (stabilizerGraphIRSchema). The plan clamps into the exact
 * range the provider seam asserts (assertRange in stabilizer-provider.ts) so
 * a planned lane can never make the seam throw; non-finite input falls back
 * to the schema default rather than propagating NaN geometry.
 */
function normalizeGraphStrength(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, 1) : DEFAULT_GRAPH_STRENGTH;
}

function normalizeGraphPredictionMs(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, 50) : DEFAULT_GRAPH_PREDICTION_MS;
}

/**
 * Ink lane minimum modeled output rate: never below the upstream default
 * (180Hz), never below the observed device cadence (a modeler emitting fewer
 * points per second than the pen delivers would decimate the stroke), and
 * never beyond the 1000Hz cadence ceiling the input model trusts.
 */
export function studioLiveInkStabilizerInkMinOutputRate(pointRateHz: number): number {
  if (!Number.isFinite(pointRateHz) || pointRateHz <= 0) {
    return STUDIO_LIVE_INK_STABILIZER_INK_MIN_OUTPUT_RATE_FLOOR_HZ;
  }
  return clamp(
    Math.ceil(pointRateHz),
    STUDIO_LIVE_INK_STABILIZER_INK_MIN_OUTPUT_RATE_FLOOR_HZ,
    STUDIO_LIVE_INK_STABILIZER_INK_MIN_OUTPUT_RATE_CEILING_HZ,
  );
}

/* ------------------------------------------------------------------ */
/* Plan derivation                                                     */
/* ------------------------------------------------------------------ */

const INK_LANE: StabilizerBackendId = "ink-stroke-modeler";

function resolveInkExclusion(
  input: StudioLiveInkStabilizerPlanInput,
  disabled: boolean,
): StudioLiveInkStabilizerInkExclusion | null {
  if (input.inkOptIn !== true) return "not-opted-in";
  if (disabled) return "stabilizer-disabled";
  const rollout = input.rollout;
  if (rollout === undefined || rollout === null) return "rollout-missing";
  if (rollout.status !== "selected" || rollout.preference !== "webgpu") {
    return "rollout-not-admitted";
  }
  const backend = input.liveInkBackend;
  if (
    backend !== undefined
    && backend !== null
    && (backend.status !== "ready" || backend.backend !== "webgpu")
  ) {
    return "backend-not-webgpu";
  }
  return null;
}

function selectedProviderAvailability(
  input: StudioLiveInkStabilizerPlanInput,
  providerId: string,
): Pick<StudioLiveInkStabilizerPlan, "status" | "unavailableReason"> {
  const killed = input.killSwitch?.isKilled(providerId) === true;
  return killed
    ? { status: "unavailable", unavailableReason: "selected-provider-killed" }
    : { status: "selected", unavailableReason: null };
}

/**
 * Deterministically derives the stabilizer backend id + params for one stroke
 * workload. Pristine input (no opt-in / no gates) reproduces the shipped
 * behavior exactly; see the module doc for the quoted legacy dispatch.
 */
export function planLiveInkStabilizer(
  input: StudioLiveInkStabilizerPlanInput,
): StudioLiveInkStabilizerPlan {
  const bucket = studioLiveInkStabilizerBucket(input);
  const strength = normalizeGraphStrength(input.stabilizer.strength);
  const predictionMs = normalizeGraphPredictionMs(input.stabilizer.predictionMs);
  // Legacy passthrough condition, quoted from applyStabilizer:
  // `config.kind === "none" || config.strength === 0` → `[...samples]`.
  const disabled = input.stabilizer.kind === "none" || strength === 0;
  const inkExclusion = resolveInkExclusion(input, disabled);

  if (disabled) {
    return {
      lane: "none",
      backendId: null,
      params: null,
      providerId: null,
      bucket,
      reason: "stabilizer-disabled",
      status: "selected",
      unavailableReason: null,
      inkExclusion,
    };
  }

  if (inkExclusion === null) {
    const providerId = studioLiveInkStabilizerProviderId(INK_LANE);
    return {
      lane: INK_LANE,
      backendId: INK_LANE,
      params: { ink: { minOutputRate: studioLiveInkStabilizerInkMinOutputRate(input.pointRateHz) } },
      providerId,
      bucket,
      reason: "ink-opt-in",
      ...selectedProviderAvailability(input, providerId),
      inkExclusion: null,
    };
  }

  // Legacy first-party dispatch, quoted from applyStabilizer:
  // `config.kind === "ema" ? emaStabilize(...) : springStabilize(...)`.
  const lane: StabilizerBackendId = input.stabilizer.kind === "ema" ? "ema" : "spring";
  const providerId = studioLiveInkStabilizerProviderId(lane);
  return {
    lane,
    backendId: lane,
    params: { strength, predictionMs },
    providerId,
    bucket,
    reason: "first-party-current",
    ...selectedProviderAvailability(input, providerId),
    inkExclusion,
  };
}

/* ------------------------------------------------------------------ */
/* Observation-only execution + parity                                 */
/* ------------------------------------------------------------------ */

/**
 * Executes a plan through the real provider seam (selectStabilizerBackend →
 * StabilizerBackend.process). The disabled lane reproduces applyStabilizer's
 * verbatim-copy contract (fresh array, same sample objects). The ink lane
 * keeps the seam's fail-loud behavior: without a preloaded wasm modeler,
 * `process` throws the seam's explicit error instead of silently degrading.
 * An unavailable selected provider also throws before processing; execution
 * never substitutes another backend.
 */
export function runStudioLiveInkStabilizerPlan(
  plan: StudioLiveInkStabilizerPlan,
  samples: readonly ModeledSampleIR[],
  options?: Pick<SelectStabilizerBackendOptions, "inkModeler">,
): ModeledSampleIR[] {
  if (plan.status === "unavailable") {
    throw new Error(
      `Selected Studio stabilizer provider is unavailable (${plan.providerId ?? "unknown"}): ${plan.unavailableReason ?? "unknown"}`,
    );
  }
  if (plan.backendId === null || plan.params === null) {
    return [...samples];
  }
  const backend = selectStabilizerBackend(plan.backendId, {
    allowInk: plan.backendId === INK_LANE,
    inkModeler: options?.inkModeler,
  });
  return backend.process(samples, plan.params);
}

export interface StudioLiveInkPlanParityInput {
  readonly plan: StudioLiveInkStabilizerPlan;
  /** The graph the legacy path would consume (usually the plan's own input graph). */
  readonly graph: StabilizerGraphIR;
  readonly samples: readonly ModeledSampleIR[];
}

export type StudioLiveInkPlanParityReport =
  | {
      readonly comparable: true;
      readonly matched: boolean;
      /** First mismatching sample index; null when the outputs are identical. */
      readonly mismatchIndex: number | null;
      readonly sampleCount: number;
    }
  | {
      readonly comparable: false;
      readonly reason:
        | "ink-lane-has-no-legacy-baseline"
        | "selected-provider-unavailable";
      readonly sampleCount: number;
    };

function samplesDiffer(left: ModeledSampleIR, right: ModeledSampleIR): boolean {
  const keys = new Set<string>([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    const a = (left as Record<string, unknown>)[key];
    const b = (right as Record<string, unknown>)[key];
    if (!Object.is(a, b)) return true;
  }
  return false;
}

/**
 * Compares the plan's provider-seam output against the shipped
 * `applyStabilizer` path for the same graph and samples — the zero-mismatch
 * contract of this observation slice. The opt-in ink lane has no legacy
 * counterpart and is reported as non-comparable instead of vacuously green.
 */
export function observeLiveInkPlanParity(
  input: StudioLiveInkPlanParityInput,
): StudioLiveInkPlanParityReport {
  if (input.plan.status === "unavailable") {
    return {
      comparable: false,
      reason: "selected-provider-unavailable",
      sampleCount: input.samples.length,
    };
  }
  if (input.plan.lane === INK_LANE) {
    return {
      comparable: false,
      reason: "ink-lane-has-no-legacy-baseline",
      sampleCount: input.samples.length,
    };
  }
  const legacy = applyStabilizer(input.samples, input.graph);
  const planned = runStudioLiveInkStabilizerPlan(input.plan, input.samples);
  let mismatchIndex: number | null = null;
  if (legacy.length !== planned.length) {
    mismatchIndex = Math.min(legacy.length, planned.length);
  } else {
    for (let index = 0; index < legacy.length; index += 1) {
      if (samplesDiffer(legacy[index]!, planned[index]!)) {
        mismatchIndex = index;
        break;
      }
    }
  }
  return {
    comparable: true,
    matched: mismatchIndex === null,
    mismatchIndex,
    sampleCount: input.samples.length,
  };
}
