/**
 * Causal velocity-to-pressure response for pointer journals.
 *
 * This module deliberately owns no DOM events, renderer, document state or mutable singleton.
 * A caller advances an immutable state with one already-admitted pointer sample at a time. The
 * same transition can therefore be used by live input, replay, collaboration and export without
 * looking at a future point.
 *
 * The existing hybrid pressure profile remains the product-level brush-family authority. This
 * lower-level response supplies the missing Atrament-style, low-pass velocity signal and an
 * explicit stylus composition policy for a later integration step.
 */

import {
  studioBrushPressureWithMinSize,
  type NormalizedCalligraphyPointerType,
} from "./studio-brush";

export const STUDIO_VELOCITY_PRESSURE_RESPONSE_VERSION =
  "velocity-pressure-response-v1" as const;

export type StudioPenVelocityPressurePolicy =
  | "hardware-precedence"
  | "velocity-modulated";

export type StudioVelocityPressureSource =
  | "nominal"
  | "velocity"
  | "hardware"
  | "hardware-velocity";

export type StudioVelocityPressureTimestampKind =
  | "initial"
  | "observed"
  | "duplicate"
  | "regressed"
  | "synthetic";

export interface StudioVelocityPressureConfig {
  /** Causal pressure used for the first non-hardware contact. */
  readonly nominalPressure: number;
  /** 0 disables speed response; 1 permits the full velocity pressure range. */
  readonly velocitySensitivity: number;
  /** CSS px/ms where the normalized velocity response reaches one. */
  readonly velocityForMinimumPressure: number;
  /** Hard ceiling applied before velocity enters the low-pass state. */
  readonly maximumVelocity: number;
  /** One-pole low-pass time constant in milliseconds. Zero means no smoothing. */
  readonly velocitySmoothingMs: number;
  /** CSP-compatible residual diameter at canonical pressure zero. */
  readonly minimumWidthRatio: number;
  /** Pressure response exponent applied after hardware/velocity composition. */
  readonly pressureExponent: number;
  /** Determines whether velocity may modulate a valid pen/touch pressure sample. */
  readonly penPolicy: StudioPenVelocityPressurePolicy;
  /** Multiplicative velocity attenuation used only by `velocity-modulated`. */
  readonly penVelocityBlend: number;
  /** Lower bound for a valid inter-sample duration. */
  readonly minimumElapsedMs: number;
  /** Upper bound for a valid inter-sample duration. */
  readonly maximumElapsedMs: number;
  /** Deterministic duration substituted for a duplicate/regressed timestamp. */
  readonly duplicateTimestampElapsedMs: number;
  /** Deterministic duration substituted when no finite timestamp pair exists. */
  readonly syntheticElapsedMs: number;
  /** Bounds corrupt/overflowing coordinate deltas before velocity calculation. */
  readonly maximumDistancePx: number;
}

export const DEFAULT_STUDIO_VELOCITY_PRESSURE_CONFIG: StudioVelocityPressureConfig =
  Object.freeze({
    nominalPressure: 0.72,
    velocitySensitivity: 0.65,
    velocityForMinimumPressure: 1.6,
    maximumVelocity: 8,
    velocitySmoothingMs: 12,
    minimumWidthRatio: 0.12,
    pressureExponent: 1,
    penPolicy: "hardware-precedence",
    penVelocityBlend: 0.24,
    minimumElapsedMs: 0.25,
    maximumElapsedMs: 100,
    duplicateTimestampElapsedMs: 1,
    syntheticElapsedMs: 1000 / 60,
    maximumDistancePx: 1_000_000,
  });

export interface StudioVelocityPressureState {
  readonly version: typeof STUDIO_VELOCITY_PRESSURE_RESPONSE_VERSION;
  readonly sequence: number;
  readonly hasPosition: boolean;
  readonly x: number;
  readonly y: number;
  /**
   * Last finite native timestamp used as the next comparison baseline. A regressed clock is
   * deliberately re-anchored so the following valid native delta can recover immediately.
   */
  readonly observedTimeMs: number | null;
  readonly filteredVelocity: number;
  /** Canonical non-hardware pressure carried across samples to prevent first-move width jumps. */
  readonly filteredPressure: number;
}

export interface StudioVelocityPressurePointerSample {
  readonly x?: unknown;
  readonly y?: unknown;
  readonly timeMs?: unknown;
  readonly pointerType?: unknown;
  readonly pressure?: unknown;
}

export interface StudioVelocityPressureSample {
  readonly version: typeof STUDIO_VELOCITY_PRESSURE_RESPONSE_VERSION;
  readonly sequence: number;
  readonly source: StudioVelocityPressureSource;
  readonly pointerType: NormalizedCalligraphyPointerType;
  readonly timestampKind: StudioVelocityPressureTimestampKind;
  readonly x: number;
  readonly y: number;
  readonly distancePx: number;
  readonly elapsedMs: number;
  readonly rawVelocity: number;
  readonly filteredVelocity: number;
  readonly velocityRatio: number;
  /** Pre-curve pressure generated solely from causal velocity. */
  readonly simulatedPressure: number;
  /** Valid hardware pressure before an optional multiplicative velocity composition. */
  readonly hardwarePressure: number | null;
  /** Canonical post-policy/post-curve pressure. */
  readonly pressure: number;
  /** Canonical pressure with the configured minimum-size floor applied exactly once. */
  readonly widthRatio: number;
}

export interface StudioVelocityPressureTransition {
  readonly state: StudioVelocityPressureState;
  readonly sample: StudioVelocityPressureSample;
}

export interface StudioVelocityPressureSeries {
  readonly state: StudioVelocityPressureState;
  readonly samples: readonly StudioVelocityPressureSample[];
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function positiveFinite(value: unknown, fallback: number, minimum: number): number {
  const finite = finiteOr(value, fallback);
  return finite > 0 ? Math.max(minimum, finite) : Math.max(minimum, fallback);
}

function pointerTypeOf(value: unknown): NormalizedCalligraphyPointerType {
  if (typeof value !== "string") return "unknown";
  const normalized = value.toLowerCase();
  return normalized === "pen" || normalized === "touch" || normalized === "mouse"
    ? normalized
    : "unknown";
}

function hardwarePressureOf(
  pointerType: NormalizedCalligraphyPointerType,
  pressure: unknown
): number | null {
  const finite = finiteOr(pressure, Number.NaN);
  if (finite < 0 || finite > 1) return null;
  if (pointerType === "pen") return finite;
  // Pointer Events conventionally reports exactly 0.5 for force-incapable active touch.
  if (pointerType === "touch" && finite !== 0.5) return finite;
  return null;
}

/** Sanitizes persisted or user-provided tuning into a finite renderer-safe contract. */
export function normalizeStudioVelocityPressureConfig(
  config: Partial<StudioVelocityPressureConfig> | null | undefined = {}
): StudioVelocityPressureConfig {
  const defaults = DEFAULT_STUDIO_VELOCITY_PRESSURE_CONFIG;
  const minimumElapsedMs = clamp(
    positiveFinite(config?.minimumElapsedMs, defaults.minimumElapsedMs, 0.01),
    0.01,
    100
  );
  const maximumElapsedMs = clamp(
    positiveFinite(config?.maximumElapsedMs, defaults.maximumElapsedMs, minimumElapsedMs),
    minimumElapsedMs,
    10_000
  );
  const velocityForMinimumPressure = clamp(
    positiveFinite(
      config?.velocityForMinimumPressure,
      defaults.velocityForMinimumPressure,
      0.001
    ),
    0.001,
    10_000
  );
  const maximumVelocity = clamp(
    positiveFinite(config?.maximumVelocity, defaults.maximumVelocity, 0.001),
    velocityForMinimumPressure,
    100_000
  );
  return Object.freeze({
    nominalPressure: clamp01(finiteOr(config?.nominalPressure, defaults.nominalPressure)),
    velocitySensitivity: clamp01(
      finiteOr(config?.velocitySensitivity, defaults.velocitySensitivity)
    ),
    velocityForMinimumPressure,
    maximumVelocity,
    velocitySmoothingMs: clamp(
      finiteOr(config?.velocitySmoothingMs, defaults.velocitySmoothingMs),
      0,
      10_000
    ),
    minimumWidthRatio: clamp01(
      finiteOr(config?.minimumWidthRatio, defaults.minimumWidthRatio)
    ),
    pressureExponent: clamp(
      finiteOr(config?.pressureExponent, defaults.pressureExponent),
      0.05,
      8
    ),
    penPolicy: config?.penPolicy === "velocity-modulated"
      ? "velocity-modulated"
      : "hardware-precedence",
    penVelocityBlend: clamp01(
      finiteOr(config?.penVelocityBlend, defaults.penVelocityBlend)
    ),
    minimumElapsedMs,
    maximumElapsedMs,
    duplicateTimestampElapsedMs: clamp(
      positiveFinite(
        config?.duplicateTimestampElapsedMs,
        defaults.duplicateTimestampElapsedMs,
        minimumElapsedMs
      ),
      minimumElapsedMs,
      maximumElapsedMs
    ),
    syntheticElapsedMs: clamp(
      positiveFinite(
        config?.syntheticElapsedMs,
        defaults.syntheticElapsedMs,
        minimumElapsedMs
      ),
      minimumElapsedMs,
      maximumElapsedMs
    ),
    maximumDistancePx: clamp(
      positiveFinite(config?.maximumDistancePx, defaults.maximumDistancePx, 1),
      1,
      Number.MAX_SAFE_INTEGER
    ),
  });
}

/** Creates a finite, immutable initial state. */
export function createStudioVelocityPressureState(): StudioVelocityPressureState {
  return Object.freeze({
    version: STUDIO_VELOCITY_PRESSURE_RESPONSE_VERSION,
    sequence: 0,
    hasPosition: false,
    x: 0,
    y: 0,
    observedTimeMs: null,
    filteredVelocity: 0,
    filteredPressure: DEFAULT_STUDIO_VELOCITY_PRESSURE_CONFIG.nominalPressure,
  });
}

function sanitizeState(
  state: StudioVelocityPressureState | null | undefined,
  config: StudioVelocityPressureConfig
): StudioVelocityPressureState {
  if (!state || state.version !== STUDIO_VELOCITY_PRESSURE_RESPONSE_VERSION) {
    return createStudioVelocityPressureState();
  }
  const observed = state.observedTimeMs;
  return {
    version: STUDIO_VELOCITY_PRESSURE_RESPONSE_VERSION,
    sequence: clamp(
      Math.floor(finiteOr(state.sequence, 0)),
      0,
      Number.MAX_SAFE_INTEGER - 1
    ),
    hasPosition: state.hasPosition === true,
    x: finiteOr(state.x, 0),
    y: finiteOr(state.y, 0),
    observedTimeMs:
      typeof observed === "number" && Number.isFinite(observed) ? observed : null,
    filteredVelocity: clamp(
      finiteOr(state.filteredVelocity, 0),
      0,
      config.maximumVelocity
    ),
    filteredPressure: clamp01(
      finiteOr(state.filteredPressure, config.nominalPressure)
    ),
  };
}

interface NormalizedTiming {
  readonly elapsedMs: number;
  readonly timestampKind: StudioVelocityPressureTimestampKind;
  readonly observedTimeMs: number | null;
}

function normalizeTiming(
  state: StudioVelocityPressureState,
  timeMs: unknown,
  config: StudioVelocityPressureConfig
): NormalizedTiming {
  const current = finiteOr(timeMs, Number.NaN);
  if (!state.hasPosition) {
    return {
      elapsedMs: 0,
      timestampKind: "initial",
      observedTimeMs: Number.isFinite(current) ? current : null,
    };
  }
  if (!Number.isFinite(current) || state.observedTimeMs === null) {
    return {
      elapsedMs: config.syntheticElapsedMs,
      timestampKind: "synthetic",
      observedTimeMs: Number.isFinite(current) ? current : state.observedTimeMs,
    };
  }
  const delta = current - state.observedTimeMs;
  if (delta === 0) {
    return {
      elapsedMs: config.duplicateTimestampElapsedMs,
      timestampKind: "duplicate",
      observedTimeMs: state.observedTimeMs,
    };
  }
  if (delta < 0) {
    return {
      elapsedMs: config.duplicateTimestampElapsedMs,
      timestampKind: "regressed",
      observedTimeMs: current,
    };
  }
  return {
    elapsedMs: clamp(delta, config.minimumElapsedMs, config.maximumElapsedMs),
    timestampKind: "observed",
    observedTimeMs: current,
  };
}

function lowPassVelocity(
  previousVelocity: number,
  rawVelocity: number,
  elapsedMs: number,
  smoothingMs: number
): number {
  if (smoothingMs <= 0) return rawVelocity;
  const alpha = 1 - Math.exp(-Math.max(0, elapsedMs) / smoothingMs);
  return previousVelocity + (rawVelocity - previousVelocity) * clamp01(alpha);
}

/**
 * Advances one pointer sample. The transition is causal: only the previous state and current
 * sample are observed, and all returned objects are immutable.
 */
export function advanceStudioVelocityPressure(
  state: StudioVelocityPressureState | null | undefined,
  input: StudioVelocityPressurePointerSample,
  partialConfig: Partial<StudioVelocityPressureConfig> | null | undefined = {}
): StudioVelocityPressureTransition {
  const config = normalizeStudioVelocityPressureConfig(partialConfig);
  const previous = sanitizeState(state, config);
  const x = finiteOr(input.x, previous.hasPosition ? previous.x : 0);
  const y = finiteOr(input.y, previous.hasPosition ? previous.y : 0);
  const timing = normalizeTiming(previous, input.timeMs, config);
  const distancePx = previous.hasPosition
    ? clamp(Math.hypot(x - previous.x, y - previous.y), 0, config.maximumDistancePx)
    : 0;
  const rawVelocity = previous.hasPosition
    ? clamp(
        distancePx / Math.max(config.minimumElapsedMs, timing.elapsedMs),
        0,
        config.maximumVelocity
      )
    : 0;
  const filteredVelocity = previous.hasPosition
    ? clamp(
        lowPassVelocity(
          previous.filteredVelocity,
          rawVelocity,
          timing.elapsedMs,
          config.velocitySmoothingMs
        ),
        0,
        config.maximumVelocity
      )
    : 0;
  const velocityRatio = clamp01(
    filteredVelocity / config.velocityForMinimumPressure
  );
  const instantaneousVelocityRatio = clamp01(
    rawVelocity / config.velocityForMinimumPressure
  );
  const velocityAttenuation = config.velocitySensitivity * velocityRatio;
  const simulatedPressure = clamp01(
    1 - config.velocitySensitivity * instantaneousVelocityRatio
  );
  const pointerType = pointerTypeOf(input.pointerType);
  const hardwarePressure = hardwarePressureOf(pointerType, input.pressure);

  let source: StudioVelocityPressureSource;
  let pressure: number;
  if (hardwarePressure !== null) {
    let basePressure: number;
    if (
      config.penPolicy === "velocity-modulated"
      && config.penVelocityBlend > 0
      && previous.hasPosition
    ) {
      // Multiplication preserves a pen's zero, ordering and expressive dynamic range. A weighted
      // replacement would incorrectly thicken a deliberately light/zero-pressure stylus sample.
      basePressure = hardwarePressure
        * (1 - velocityAttenuation * config.penVelocityBlend);
      source = "hardware-velocity";
    } else {
      basePressure = hardwarePressure;
      source = "hardware";
    }
    pressure = clamp01(Math.pow(clamp01(basePressure), config.pressureExponent));
  } else if (previous.hasPosition) {
    source = "velocity";
    const curvedSimulatedPressure = clamp01(
      Math.pow(simulatedPressure, config.pressureExponent)
    );
    // Velocity pressure is already a canonical product response. Smooth it from the exact nominal
    // first-contact value instead of smoothing velocity from zero and then applying a second
    // pressure response at the output. The configured curve is applied to the instantaneous target
    // before low-pass filtering, so mouse/touch retain the same curve control as stylus pressure.
    // The old ordering made a 1 px first move jump pencils/ribbon brushes close to full pressure.
    // A slightly longer pressure time constant keeps the transition within roughly one frame while
    // still allowing sustained slow/fast motion to reach its calibrated target.
    // The target itself uses instantaneous velocity: smoothing velocity and then pressure would
    // make recovery lag behind the pointer for two independent filters.
    // A duplicate position carries no new geometric evidence. Letting elapsed time alone pull
    // pressure toward the zero-velocity target makes a stationary mouse contact change diameter
    // between its first and second event. Hold the last canonical pressure until the pointer
    // actually moves; the next non-zero segment still receives the full causal velocity response.
    pressure = distancePx === 0
      ? previous.filteredPressure
      : lowPassVelocity(
          previous.filteredPressure,
          curvedSimulatedPressure,
          timing.elapsedMs,
          config.velocitySmoothingMs * 1.9
        );
  } else {
    source = "nominal";
    pressure = config.nominalPressure;
  }

  pressure = clamp01(pressure);
  const sequence = previous.sequence + 1;
  const sample = Object.freeze({
    version: STUDIO_VELOCITY_PRESSURE_RESPONSE_VERSION,
    sequence,
    source,
    pointerType,
    timestampKind: timing.timestampKind,
    x,
    y,
    distancePx,
    elapsedMs: timing.elapsedMs,
    rawVelocity,
    filteredVelocity,
    velocityRatio,
    simulatedPressure,
    hardwarePressure,
    pressure,
    widthRatio: studioBrushPressureWithMinSize(
      pressure,
      config.minimumWidthRatio
    ),
  } satisfies StudioVelocityPressureSample);
  const nextState = Object.freeze({
    version: STUDIO_VELOCITY_PRESSURE_RESPONSE_VERSION,
    sequence,
    hasPosition: true,
    x,
    y,
    observedTimeMs: timing.observedTimeMs,
    filteredVelocity,
    filteredPressure: pressure,
  } satisfies StudioVelocityPressureState);

  return Object.freeze({ state: nextState, sample });
}

/**
 * Batch convenience wrapper over the exact streaming transition. Prefixes and final state must
 * remain byte-for-byte equivalent to repeatedly calling `advanceStudioVelocityPressure`.
 */
export function resolveStudioVelocityPressureSeries(
  samples: readonly StudioVelocityPressurePointerSample[],
  partialConfig: Partial<StudioVelocityPressureConfig> | null | undefined = {},
  initialState: StudioVelocityPressureState | null | undefined =
    createStudioVelocityPressureState()
): StudioVelocityPressureSeries {
  let state = initialState;
  const result: StudioVelocityPressureSample[] = [];
  for (const input of samples) {
    const transition = advanceStudioVelocityPressure(state, input, partialConfig);
    state = transition.state;
    result.push(transition.sample);
  }
  const finalState = Object.freeze(sanitizeState(
    state ?? createStudioVelocityPressureState(),
    normalizeStudioVelocityPressureConfig(partialConfig)
  ));
  return Object.freeze({
    state: finalState,
    samples: Object.freeze(result),
  });
}
