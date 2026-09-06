/**
 * Deterministic fixed-rate filtering for live stroke channels.
 *
 * Browser pointer events are delivered in device- and browser-dependent batches. This module
 * separates event delivery from filtering by evaluating an immutable cascade on a 5ms logical
 * clock. Raw samples bracket a piecewise-linear input path, so irregular/coalesced delivery does
 * not turn a smooth move into a zero-order-hold staircase. Callers append the returned samples; a
 * later transition never revises an emitted prefix.
 *
 * The API is deliberately renderer-neutral. It has no DOM, React, Konva, brush, or persistence
 * dependency, so it can sit behind the current Studio stabilizer API or a future GPU input path.
 */

export const FIXED_RATE_STROKE_FILTER_TICK_MS = 5;
/**
 * A 1/32 CSS-pixel source grid keeps deterministic replay without stair-stepping low-speed detail.
 *
 * The former 1/16 grid was harmless on broad gestures, but a 2 CSS-pixel-radius circle sampled at
 * 240Hz collapsed roughly one in six consecutive positions and inflated polyline length by about
 * 11%. Halving the grid removes those collapsed steps while remaining far below a visible pixel.
 * Persisted strokes already contain their accepted coordinates, so this is a new-input precision
 * change rather than a reinterpretation of stored geometry.
 */
export const FIXED_RATE_STROKE_POSITION_QUANTUM = 1 / 32;
export const FIXED_RATE_STROKE_TILT_QUANTUM = 1 / 16;
export const FIXED_RATE_STROKE_PRESSURE_STEPS = 1_023;
export const FIXED_RATE_STROKE_RELEASE_POSITION_EPSILON = 1;
export const FIXED_RATE_STROKE_RELEASE_PRESSURE_EPSILON = 1 / FIXED_RATE_STROKE_PRESSURE_STEPS;
export const FIXED_RATE_STROKE_RELEASE_TILT_EPSILON = FIXED_RATE_STROKE_TILT_QUANTUM;
export const FIXED_RATE_STROKE_RELEASE_MAX_TICKS = 4_096;
/**
 * Maximum raw interval reconstructed as one linear move.
 *
 * Ordinary 120/240Hz input stays well below this bound. A suspended tab or driver clock jump first
 * advances the settled hold in O(1), then reconstructs only this constant-size suffix instead of
 * manufacturing minutes of intermediate work when the next sample arrives.
 */
export const FIXED_RATE_STROKE_INTERPOLATION_MAX_MS = 64;

const MIN_NORMALIZED_STRENGTH = 0.01;
const MIN_RESPONSE = 20;
const RESPONSE_RANGE = 60;
const RESPONSE_STAGE_WIDTH = 4;
/**
 * Never let the per-stage response fall below 0.55.
 *
 * The original traced cascade coupled a twenty-stage strength-10 filter with alpha 0.2. Its 90%
 * step response was roughly 535ms: useful as a forensic compatibility fixture, but far beyond a
 * professional inking latency budget and the main reason a high correction value felt as though
 * the pen were attached by a rubber band. More strength still adds stages (therefore removes more
 * high-frequency jitter), while this floor caps the slowest 90% response at roughly 125ms.
 */
const MAX_ALPHA_COMPLEMENT = 0.45;

export interface FixedRateStrokeRawSample {
  readonly x: number;
  readonly y: number;
  /** CSS surface pixels per document unit; positions retain a 1/32 CSS px input grid. */
  readonly positionScale?: number;
  readonly pressure?: number;
  readonly tiltX?: number;
  readonly tiltY?: number;
  readonly timeStamp?: number;
}

export interface FixedRateStrokeQuantizedSample {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly timeStamp: number;
}

export interface FixedRateStrokeFilteredSample {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  /** Timestamp on the fixed 5ms logical grid. */
  readonly timeStamp: number;
  /**
   * Timestamp of the newest authoritative raw sample consulted for this tick.
   *
   * It can be newer than `timeStamp` by less than one input interval when that sample closes a
   * piecewise-linear coalesced segment. Held/frame-pump ticks keep the historical <= relationship.
   */
  readonly sourceTimeStamp: number;
  /** Zero-based tick index. The initial sample is tick zero. */
  readonly logicalTick: number;
}

export interface FixedRateStrokeFilterParameters {
  /** Finite strength clamped to the public 0..10 range. */
  readonly strength: number;
  readonly normalizedStrength: number;
  readonly response: number;
  readonly stageCount: number;
  readonly alpha: number;
}

export interface FixedRateStrokeFilterStage {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
}

export interface FixedRateStrokeFilterState {
  readonly parameters: FixedRateStrokeFilterParameters;
  readonly originTimeStamp: number;
  readonly nextLogicalTick: number;
  readonly heldSample: FixedRateStrokeQuantizedSample;
  readonly stages: readonly FixedRateStrokeFilterStage[];
  readonly lastOutput: FixedRateStrokeFilteredSample;
  /** Sum of every stage's |dx| + |dy| on the most recently evaluated tick. */
  readonly lastStagePositionDelta: number;
  /** Sum of every stage's pressure change on the most recently evaluated tick. */
  readonly lastStagePressureDelta: number;
  /** Sum of every stage's |tiltX| + |tiltY| change on the most recently evaluated tick. */
  readonly lastStageTiltDelta: number;
  readonly closed: boolean;
}

export type FixedRateStrokeFilterCommand =
  | {
      readonly type: "append";
      readonly samples: readonly FixedRateStrokeRawSample[];
    }
  | {
      /** Advances the logical clock without changing the zero-order-held raw sample. */
      readonly type: "advance";
      /** Monotonic watermark: callers promise that no unsubmitted raw sample is at or before it. */
      readonly timeStamp: number;
    }
  | {
      readonly type: "release";
      /** Optional final pointer sample. Omit it when the last appended sample is the endpoint. */
      readonly sample?: FixedRateStrokeRawSample;
    };

export interface FixedRateStrokeFilterTransition {
  readonly state: FixedRateStrokeFilterState;
  /** New append-only suffix produced by this transition. */
  readonly emitted: readonly FixedRateStrokeFilteredSample[];
  /** Current filtered endpoint, including the final drained endpoint after release. */
  readonly endpoint: FixedRateStrokeFilteredSample;
  /** Synthetic post-release ticks, excluding ordinary ticks at or before the release time. */
  readonly releaseDrainTicks: number;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function quantize(value: number, quantum: number): number {
  const scaled = value / quantum;
  if (!Number.isFinite(scaled)) return value;
  const result = Math.round(scaled) * quantum;
  return Object.is(result, -0) ? 0 : result;
}

function quantizePressure(value: number): number {
  return Math.round(clamp(value, 0, 1) * FIXED_RATE_STROKE_PRESSURE_STEPS)
    / FIXED_RATE_STROKE_PRESSURE_STEPS;
}

function positionQuantum(positionScale: unknown): number {
  const finiteScale = finiteNumber(positionScale, 1);
  const normalizedScale = finiteScale === 0
    ? 1
    : clamp(Math.abs(finiteScale), 0.01, 64);
  return FIXED_RATE_STROKE_POSITION_QUANTUM / normalizedScale;
}

/**
 * Converts a public 0..10 strength into the fixed cascade parameters.
 *
 * Magma's public cascade runs `for (index = 0; index < response / 4; index += 1)`, so a fractional
 * quotient creates the same number of stages as `ceil(response / 4)`. Preserve that exact
 * discrete behavior rather than rounding to the nearest stage.
 */
export function resolveFixedRateStrokeFilterParameters(
  requestedStrength: number
): FixedRateStrokeFilterParameters {
  const strength = clamp(finiteNumber(requestedStrength, 0), 0, 10);
  const normalizedStrength = strength / 10;
  const normalizedResponse = (
    clamp(normalizedStrength, MIN_NORMALIZED_STRENGTH, 1) - MIN_NORMALIZED_STRENGTH
  ) / (1 - MIN_NORMALIZED_STRENGTH);
  const response = MIN_RESPONSE + RESPONSE_RANGE * normalizedResponse;
  const stageCount = Math.ceil(response / RESPONSE_STAGE_WIDTH);
  const alpha = 1 - clamp(response / 100, 0, MAX_ALPHA_COMPLEMENT);
  return { strength, normalizedStrength, response, stageCount, alpha };
}

/** Quantizes every input channel before it can enter the logical clock or stage cascade. */
export function quantizeFixedRateStrokeSample(
  sample: FixedRateStrokeRawSample,
  fallback?: FixedRateStrokeQuantizedSample
): FixedRateStrokeQuantizedSample {
  const fallbackX = fallback?.x ?? 0;
  const fallbackY = fallback?.y ?? 0;
  const fallbackPressure = fallback?.pressure ?? 0.5;
  const fallbackTiltX = fallback?.tiltX ?? 0;
  const fallbackTiltY = fallback?.tiltY ?? 0;
  const fallbackTimeStamp = fallback?.timeStamp ?? 0;
  const timeStamp = Math.max(0, finiteNumber(sample.timeStamp, fallbackTimeStamp));
  const documentPositionQuantum = positionQuantum(sample.positionScale);
  return {
    x: quantize(
      finiteNumber(sample.x, fallbackX),
      documentPositionQuantum
    ),
    y: quantize(
      finiteNumber(sample.y, fallbackY),
      documentPositionQuantum
    ),
    pressure: quantizePressure(finiteNumber(sample.pressure, fallbackPressure)),
    tiltX: quantize(
      finiteNumber(sample.tiltX, fallbackTiltX),
      FIXED_RATE_STROKE_TILT_QUANTUM
    ),
    tiltY: quantize(
      finiteNumber(sample.tiltY, fallbackTiltY),
      FIXED_RATE_STROKE_TILT_QUANTUM
    ),
    timeStamp,
  };
}

function stageFromSample(
  sample: FixedRateStrokeQuantizedSample
): FixedRateStrokeFilterStage {
  return {
    x: sample.x,
    y: sample.y,
    pressure: sample.pressure,
    tiltX: sample.tiltX,
    tiltY: sample.tiltY,
  };
}

function filteredSample(
  stage: FixedRateStrokeFilterStage,
  timeStamp: number,
  sourceTimeStamp: number,
  logicalTick: number
): FixedRateStrokeFilteredSample {
  return {
    ...stage,
    timeStamp,
    sourceTimeStamp,
    logicalTick,
  };
}

function createFixedRateStrokeFilterState(
  initialSample: FixedRateStrokeRawSample,
  parameters: FixedRateStrokeFilterParameters
): FixedRateStrokeFilterTransition {
  const heldSample = quantizeFixedRateStrokeSample(initialSample);
  const initialStage = stageFromSample(heldSample);
  const stages = Array.from(
    { length: parameters.stageCount },
    () => ({ ...initialStage })
  );
  const lastOutput = filteredSample(
    stages[stages.length - 1]!,
    heldSample.timeStamp,
    heldSample.timeStamp,
    0
  );
  const state: FixedRateStrokeFilterState = {
    parameters,
    originTimeStamp: heldSample.timeStamp,
    nextLogicalTick: 1,
    heldSample,
    stages,
    lastOutput,
    lastStagePositionDelta: 0,
    lastStagePressureDelta: 0,
    lastStageTiltDelta: 0,
    closed: false,
  };
  return { state, emitted: [lastOutput], endpoint: lastOutput, releaseDrainTicks: 0 };
}

/**
 * Starts a stroke with every stage pinned to the first quantized sample.
 *
 * The first pointerdown sample is the atomic stroke origin and is emitted immediately. Subsequent
 * equal-timestamp samples are supported by `transitionFixedRateStrokeFilter`; the caller should
 * pass all coalesced pointerdown candidates when choosing this origin if they differ.
 */
export function createFixedRateStrokeFilter(
  initialSample: FixedRateStrokeRawSample,
  strength: number
): FixedRateStrokeFilterTransition {
  const parameters = resolveFixedRateStrokeFilterParameters(strength);
  return createFixedRateStrokeFilterState(initialSample, parameters);
}

function logicalTickTime(state: FixedRateStrokeFilterState): number {
  return state.originTimeStamp + state.nextLogicalTick * FIXED_RATE_STROKE_FILTER_TICK_MS;
}

function weightedChannel(previous: number, input: number, alpha: number): number {
  // A convex weighted sum avoids overflow for large opposite-sign finite coordinates better than
  // `previous + (input - previous) * alpha` while preserving the same cascade response.
  return previous * (1 - alpha) + input * alpha;
}

function evaluateCascade(
  previousStages: readonly FixedRateStrokeFilterStage[],
  heldSample: FixedRateStrokeQuantizedSample,
  alpha: number
): {
  readonly stages: readonly FixedRateStrokeFilterStage[];
  readonly output: FixedRateStrokeFilterStage;
  readonly positionDelta: number;
  readonly pressureDelta: number;
  readonly tiltDelta: number;
} {
  let input: FixedRateStrokeFilterStage = stageFromSample(heldSample);
  let positionDelta = 0;
  let pressureDelta = 0;
  let tiltDelta = 0;
  const stages = previousStages.map((previous) => {
    const next: FixedRateStrokeFilterStage = {
      x: weightedChannel(previous.x, input.x, alpha),
      y: weightedChannel(previous.y, input.y, alpha),
      pressure: weightedChannel(previous.pressure, input.pressure, alpha),
      tiltX: weightedChannel(previous.tiltX, input.tiltX, alpha),
      tiltY: weightedChannel(previous.tiltY, input.tiltY, alpha),
    };
    positionDelta += Math.abs(next.x - previous.x) + Math.abs(next.y - previous.y);
    pressureDelta += Math.abs(next.pressure - previous.pressure);
    tiltDelta += Math.abs(next.tiltX - previous.tiltX) + Math.abs(next.tiltY - previous.tiltY);
    input = next;
    return next;
  });
  return {
    stages,
    output: stages[stages.length - 1]!,
    positionDelta,
    pressureDelta,
    tiltDelta,
  };
}

function evaluateLogicalTick(
  state: FixedRateStrokeFilterState,
  inputSample: FixedRateStrokeQuantizedSample = state.heldSample,
  sourceTimeStamp = inputSample.timeStamp
): {
  readonly state: FixedRateStrokeFilterState;
  readonly emitted: FixedRateStrokeFilteredSample;
} {
  const timeStamp = logicalTickTime(state);
  const cascade = evaluateCascade(
    state.stages,
    inputSample,
    state.parameters.alpha
  );
  const emitted = filteredSample(
    cascade.output,
    timeStamp,
    sourceTimeStamp,
    state.nextLogicalTick
  );
  return {
    state: {
      ...state,
      nextLogicalTick: state.nextLogicalTick + 1,
      stages: cascade.stages,
      lastOutput: emitted,
      lastStagePositionDelta: cascade.positionDelta,
      lastStagePressureDelta: cascade.pressureDelta,
      lastStageTiltDelta: cascade.tiltDelta,
    },
    emitted,
  };
}

/** True only when one more held-input tick can change a stage at JavaScript number precision. */
function cascadeWouldChange(state: FixedRateStrokeFilterState): boolean {
  let inputX = state.heldSample.x;
  let inputY = state.heldSample.y;
  let inputPressure = state.heldSample.pressure;
  let inputTiltX = state.heldSample.tiltX;
  let inputTiltY = state.heldSample.tiltY;
  const alpha = state.parameters.alpha;
  for (const previous of state.stages) {
    const nextX = weightedChannel(previous.x, inputX, alpha);
    const nextY = weightedChannel(previous.y, inputY, alpha);
    const nextPressure = weightedChannel(previous.pressure, inputPressure, alpha);
    const nextTiltX = weightedChannel(previous.tiltX, inputTiltX, alpha);
    const nextTiltY = weightedChannel(previous.tiltY, inputTiltY, alpha);
    if (
      nextX !== previous.x || nextY !== previous.y ||
      nextPressure !== previous.pressure ||
      nextTiltX !== previous.tiltX || nextTiltY !== previous.tiltY
    ) return true;
    inputX = nextX;
    inputY = nextY;
    inputPressure = nextPressure;
    inputTiltX = nextTiltX;
    inputTiltY = nextTiltY;
  }
  return false;
}

function advanceThrough(
  initialState: FixedRateStrokeFilterState,
  inclusiveTimeStamp: number
): {
  readonly state: FixedRateStrokeFilterState;
  readonly emitted: readonly FixedRateStrokeFilteredSample[];
} {
  let state = initialState;
  const emitted: FixedRateStrokeFilteredSample[] = [];
  while (logicalTickTime(state) <= inclusiveTimeStamp) {
    if (!cascadeWouldChange(state)) {
      state = {
        ...state,
        nextLogicalTick: Math.max(
          state.nextLogicalTick,
          Math.floor(
            (inclusiveTimeStamp - state.originTimeStamp)
              / FIXED_RATE_STROKE_FILTER_TICK_MS
          ) + 1
        ),
      };
      break;
    }
    const tick = evaluateLogicalTick(state);
    state = tick.state;
    emitted.push(tick.emitted);
  }
  return { state, emitted };
}

function interpolateSample(
  start: FixedRateStrokeQuantizedSample,
  end: FixedRateStrokeQuantizedSample,
  ratio: number,
  timeStamp: number
): FixedRateStrokeQuantizedSample {
  const progress = clamp(ratio, 0, 1);
  const interpolate = (from: number, to: number) => weightedChannel(from, to, progress);
  return {
    x: interpolate(start.x, end.x),
    y: interpolate(start.y, end.y),
    pressure: interpolate(start.pressure, end.pressure),
    tiltX: interpolate(start.tiltX, end.tiltX),
    tiltY: interpolate(start.tiltY, end.tiltY),
    timeStamp,
  };
}

/**
 * Advances ticks closed by one newly authoritative sample.
 *
 * A zero-order hold presents each tick with the preceding point and therefore adds up to one tick
 * of avoidable phase delay. Worse, uneven 120/240Hz samples become uneven spatial steps before the
 * cascade sees them. Reconstruct the quantized source segment at each still-unpublished tick.
 * This is causal at delivery time (the closing sample is already authoritative), preserves the
 * immutable emitted prefix, and remains batch-independent because samples are ingested in source
 * order.
 */
function advanceAlongSampleSegment(
  initialState: FixedRateStrokeFilterState,
  sample: FixedRateStrokeQuantizedSample
): {
  readonly state: FixedRateStrokeFilterState;
  readonly emitted: readonly FixedRateStrokeFilteredSample[];
} {
  const startSample = initialState.heldSample;
  const rawSpan = sample.timeStamp - startSample.timeStamp;
  if (!(rawSpan > 0)) return advanceThrough(initialState, sample.timeStamp);

  const interpolationSpan = Math.min(rawSpan, FIXED_RATE_STROKE_INTERPOLATION_MAX_MS);
  const interpolationStartTime = sample.timeStamp - interpolationSpan;
  const heldPrefix = advanceThrough(initialState, interpolationStartTime);
  let state = heldPrefix.state;
  const emitted = [...heldPrefix.emitted];

  while (logicalTickTime(state) <= sample.timeStamp) {
    const tickTimeStamp = logicalTickTime(state);
    const progress = (tickTimeStamp - interpolationStartTime) / interpolationSpan;
    const inputSample = interpolateSample(
      startSample,
      sample,
      progress,
      tickTimeStamp
    );
    const tick = evaluateLogicalTick(state, inputSample, sample.timeStamp);
    state = tick.state;
    emitted.push(tick.emitted);
  }

  return { state, emitted };
}

function ingestSample(
  initialState: FixedRateStrokeFilterState,
  rawSample: FixedRateStrokeRawSample
): {
  readonly state: FixedRateStrokeFilterState;
  readonly emitted: readonly FixedRateStrokeFilteredSample[];
} {
  const quantized = quantizeFixedRateStrokeSample(rawSample, initialState.heldSample);
  // Browser coalesced samples are ordered. Clamping a malformed/out-of-order timestamp keeps the
  // pure transition causal without allowing a late sample to revise an emitted logical tick.
  const sample = {
    ...quantized,
    timeStamp: Math.max(initialState.heldSample.timeStamp, quantized.timeStamp),
  };
  const advanced = advanceAlongSampleSegment(initialState, sample);
  return {
    state: { ...advanced.state, heldSample: sample },
    emitted: advanced.emitted,
  };
}

function appendSamples(
  initialState: FixedRateStrokeFilterState,
  samples: readonly FixedRateStrokeRawSample[]
): {
  readonly state: FixedRateStrokeFilterState;
  readonly emitted: readonly FixedRateStrokeFilteredSample[];
} {
  // The live pointer route submits one coalesced sample per transition. Reuse ingestSample's
  // append-only suffix directly so that hot path does not allocate a second array and copy every
  // emitted logical tick into it. Multi-sample callers retain the same deterministic aggregation.
  if (samples.length === 1) return ingestSample(initialState, samples[0]!);

  let state = initialState;
  const emitted: FixedRateStrokeFilteredSample[] = [];
  for (const sample of samples) {
    const transition = ingestSample(state, sample);
    state = transition.state;
    emitted.push(...transition.emitted);
  }
  return { state, emitted };
}

function channelsNeedDrain(state: FixedRateStrokeFilterState): boolean {
  const held = state.heldSample;
  return state.stages.some((stage) => (
    stage.x !== held.x
    || stage.y !== held.y
    || stage.pressure !== held.pressure
    || stage.tiltX !== held.tiltX
    || stage.tiltY !== held.tiltY
  ));
}

function releaseChannelsAreMoving(state: FixedRateStrokeFilterState): boolean {
  return state.lastStagePositionDelta > FIXED_RATE_STROKE_RELEASE_POSITION_EPSILON
    || state.lastStagePressureDelta > FIXED_RATE_STROKE_RELEASE_PRESSURE_EPSILON
    || state.lastStageTiltDelta > FIXED_RATE_STROKE_RELEASE_TILT_EPSILON;
}

/**
 * Seals the last sub-pixel remainder at one final logical tick.
 *
 * Stopping only when stage velocity falls below an epsilon does not imply that the visible output
 * equals the pointer endpoint. The old release path could therefore persist a slightly shortened
 * line and a stale pressure/tilt sample. Pinning every stage after the bounded drain preserves the
 * exact endpoint without revising an emitted prefix, keeps timestamps on the 5ms grid and makes a
 * deterministic replay independent from renderer-specific line caps.
 */
function pinReleaseEndpoint(
  state: FixedRateStrokeFilterState
): {
  readonly state: FixedRateStrokeFilterState;
  readonly emitted: FixedRateStrokeFilteredSample;
} {
  const endpointStage = stageFromSample(state.heldSample);
  const emitted = filteredSample(
    endpointStage,
    logicalTickTime(state),
    state.heldSample.timeStamp,
    state.nextLogicalTick
  );
  return {
    state: {
      ...state,
      nextLogicalTick: state.nextLogicalTick + 1,
      stages: Array.from(
        { length: state.stages.length },
        () => ({ ...endpointStage })
      ),
      lastOutput: emitted,
      lastStagePositionDelta: 0,
      lastStagePressureDelta: 0,
      lastStageTiltDelta: 0,
    },
    emitted,
  };
}

function releaseFilter(
  initialState: FixedRateStrokeFilterState,
  sample?: FixedRateStrokeRawSample
): FixedRateStrokeFilterTransition {
  const ingested = sample
    ? ingestSample(initialState, sample)
    : { state: initialState, emitted: [] as readonly FixedRateStrokeFilteredSample[] };
  const throughRelease = advanceThrough(ingested.state, ingested.state.heldSample.timeStamp);
  let state = throughRelease.state;
  const emitted = [...ingested.emitted, ...throughRelease.emitted];
  let releaseDrainTicks = 0;

  if (channelsNeedDrain(state)) {
    do {
      const tick = evaluateLogicalTick(state);
      state = tick.state;
      emitted.push(tick.emitted);
      releaseDrainTicks += 1;
    } while (
      channelsNeedDrain(state) &&
      releaseChannelsAreMoving(state) &&
      releaseDrainTicks < FIXED_RATE_STROKE_RELEASE_MAX_TICKS
    );
  }
  if (channelsNeedDrain(state)) {
    const pinned = pinReleaseEndpoint(state);
    state = pinned.state;
    emitted.push(pinned.emitted);
    releaseDrainTicks += 1;
  }

  state = { ...state, closed: true };
  return {
    state,
    emitted,
    endpoint: state.lastOutput,
    releaseDrainTicks,
  };
}

/**
 * Applies an input, logical-clock, or release command without mutating prior state or emissions.
 *
 * Append transitions reconstruct the quantized line segment closed by the newest raw sample at
 * each still-unpublished tick, then install the sample as the new hold. Equal-timestamp samples
 * still let the last source-order value win on the next tick. Frame-clock advances use the latest
 * hold, while ordinary coalesced input avoids the extra tick of ZOH phase delay.
 */
export function transitionFixedRateStrokeFilter(
  state: FixedRateStrokeFilterState,
  command: FixedRateStrokeFilterCommand
): FixedRateStrokeFilterTransition {
  if (state.closed) {
    return { state, emitted: [], endpoint: state.lastOutput, releaseDrainTicks: 0 };
  }
  if (command.type === "release") return releaseFilter(state, command.sample);
  if (command.type === "advance") {
    const timeStamp = Math.max(
      state.heldSample.timeStamp,
      finiteNumber(command.timeStamp, state.heldSample.timeStamp)
    );
    const advanced = advanceThrough(state, timeStamp);
    return {
      state: advanced.state,
      emitted: advanced.emitted,
      endpoint: advanced.state.lastOutput,
      releaseDrainTicks: 0,
    };
  }

  const appended = appendSamples(state, command.samples);
  return {
    state: appended.state,
    emitted: appended.emitted,
    endpoint: appended.state.lastOutput,
    releaseDrainTicks: 0,
  };
}
