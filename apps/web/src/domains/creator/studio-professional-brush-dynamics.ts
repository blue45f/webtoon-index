/**
 * Renderer-neutral professional brush dynamics.
 *
 * This is a clean-room implementation based only on publicly observable brush-engine behaviour
 * (input dynamics, tapering and continuous deposition). It contains no vendor code, vendor object,
 * DOM, Canvas or GPU dependency. The strict plan and resolved output are plain, versioned data so
 * the same accepted samples can be replayed by a Worker, collaboration peer or future WebGPU
 * lowering stage without changing their meaning.
 */

export const STUDIO_PROFESSIONAL_BRUSH_DYNAMICS_VERSION = 1 as const;
export const STUDIO_PROFESSIONAL_BRUSH_CURVE_INTERPOLATION = "monotone-cubic" as const;

export const STUDIO_PROFESSIONAL_BRUSH_HARD_BUDGETS = Object.freeze({
  maxSamples: 262_144,
  maxEvents: 1_048_576,
  maxMappings: 128,
  maxCurvePoints: 128,
  maxStationaryEventsPerGap: 16_384,
  maxCoordinateMagnitude: 16_777_216,
  maxTickMilliseconds: 1_000,
} as const);

export type StudioProfessionalBrushSource =
  | "pressure"
  | "tilt"
  | "velocity"
  | "tangential-pressure"
  | "twist"
  | "progress"
  | "deterministic-random";

export type StudioProfessionalBrushChannelName =
  | "size"
  | "opacity"
  | "flow"
  | "spacing"
  | "angle"
  | "roundness"
  | "scatter"
  | "textureDepth";

export type StudioProfessionalBrushMappingCombine = "replace" | "multiply" | "add";

export interface StudioProfessionalBrushCurvePoint {
  readonly x: number;
  readonly y: number;
}

export interface StudioProfessionalBrushResponseCurve {
  readonly interpolation: typeof STUDIO_PROFESSIONAL_BRUSH_CURVE_INTERPOLATION;
  readonly points: readonly StudioProfessionalBrushCurvePoint[];
}

export interface StudioProfessionalBrushMapping {
  readonly source: StudioProfessionalBrushSource;
  readonly combine: StudioProfessionalBrushMappingCombine;
  readonly outputMin: number;
  readonly outputMax: number;
  readonly curve: StudioProfessionalBrushResponseCurve;
}

export interface StudioProfessionalBrushChannel {
  readonly base: number;
  readonly min: number;
  readonly max: number;
  readonly mappings: readonly StudioProfessionalBrushMapping[];
}

export interface StudioProfessionalBrushChannels {
  readonly size: StudioProfessionalBrushChannel;
  readonly opacity: StudioProfessionalBrushChannel;
  readonly flow: StudioProfessionalBrushChannel;
  readonly spacing: StudioProfessionalBrushChannel;
  readonly angle: StudioProfessionalBrushChannel;
  readonly roundness: StudioProfessionalBrushChannel;
  readonly scatter: StudioProfessionalBrushChannel;
  readonly textureDepth: StudioProfessionalBrushChannel;
}

/**
 * Physical meaning of every resolved output channel. These literals are durable schema, not
 * documentation defaults, so another replay implementation cannot reinterpret radians as degrees
 * or physical document distance as a tip-relative ratio.
 */
export interface StudioProfessionalBrushUnits {
  readonly size: "document-css-px";
  readonly opacity: "unit-interval";
  readonly flow: "unit-interval";
  readonly spacing: "document-css-px";
  readonly angle: "radians";
  readonly roundness: "unit-interval";
  readonly scatter: "document-css-px";
  readonly textureDepth: "unit-interval";
}

export interface StudioProfessionalBrushClock {
  readonly timeUnit: "milliseconds";
  /** Every accepted sample time is an integer tick; no wall clock is read by the resolver. */
  readonly tickMilliseconds: number;
}

export interface StudioProfessionalBrushBudgets {
  readonly maxSamples: number;
  readonly maxEvents: number;
  readonly maxMappings: number;
  readonly maxCurvePoints: number;
  readonly maxStationaryEventsPerGap: number;
}

export interface StudioProfessionalBrushVelocity {
  readonly normalizationPixelsPerMillisecond: number;
  readonly smoothingTimeMilliseconds: number;
  readonly initialPixelsPerMillisecond: number;
  readonly maximumPixelsPerMillisecond: number;
}

export interface StudioProfessionalBrushTaperExtent {
  readonly mode: "length-pixels" | "stroke-percentage";
  readonly value: number;
}

export interface StudioProfessionalBrushTaper {
  readonly start: StudioProfessionalBrushTaperExtent;
  readonly end: StudioProfessionalBrushTaperExtent;
  readonly minimumSizeRatio: number;
  readonly minimumOpacityRatio: number;
  /**
   * 0 disables speed shaping. Higher values retain a mathematically closed tip while making fast
   * gestures recover from taper more quickly than slow gestures.
   */
  readonly speedInfluence: number;
}

export interface StudioProfessionalBrushStationaryDeposition {
  readonly mode: "disabled" | "continuous";
  readonly intervalTicks: number;
  readonly movementEpsilonPixels: number;
}

export interface StudioProfessionalBrushDynamicsPlan {
  readonly kind: "studio-professional-brush-dynamics";
  readonly version: typeof STUDIO_PROFESSIONAL_BRUSH_DYNAMICS_VERSION;
  readonly planId: string;
  readonly revision: number;
  readonly seed: number;
  readonly units: StudioProfessionalBrushUnits;
  readonly clock: StudioProfessionalBrushClock;
  readonly budgets: StudioProfessionalBrushBudgets;
  readonly velocity: StudioProfessionalBrushVelocity;
  readonly taper: StudioProfessionalBrushTaper;
  readonly stationary: StudioProfessionalBrushStationaryDeposition;
  readonly channels: StudioProfessionalBrushChannels;
}

export interface StudioProfessionalBrushAcceptedSample {
  readonly sequence: number;
  readonly timeTick: number;
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly tiltXDegrees: number;
  readonly tiltYDegrees: number;
  readonly tangentialPressure: number;
  readonly twistDegrees: number;
}

export interface StudioProfessionalBrushResolvedSources {
  readonly pressure: number;
  readonly tilt: number;
  readonly velocity: number;
  readonly tangentialPressure: number;
  readonly twist: number;
  readonly progress: number;
  readonly deterministicRandom: number;
}

export interface StudioProfessionalBrushResolvedChannels {
  readonly size: number;
  readonly opacity: number;
  readonly flow: number;
  readonly spacing: number;
  readonly angle: number;
  readonly roundness: number;
  readonly scatter: number;
  readonly textureDepth: number;
}

export interface StudioProfessionalBrushResolvedState {
  readonly sequence: number;
  readonly timeTick: number;
  readonly x: number;
  readonly y: number;
  readonly arcLength: number;
  readonly progress: number;
  readonly velocityPixelsPerMillisecond: number;
  readonly sources: StudioProfessionalBrushResolvedSources;
  readonly channels: StudioProfessionalBrushResolvedChannels;
}

export interface StudioProfessionalBrushDepositionEvent {
  readonly eventIndex: number;
  readonly cause: "initial" | "motion" | "stationary";
  readonly sourceSequence: number;
  readonly timeTick: number;
  readonly x: number;
  readonly y: number;
  readonly arcLength: number;
  readonly progress: number;
  readonly velocityPixelsPerMillisecond: number;
  /** Domain-separated event seed for later scatter, texture and particle lowering. */
  readonly randomUint32: number;
  readonly sources: StudioProfessionalBrushResolvedSources;
  readonly channels: StudioProfessionalBrushResolvedChannels;
}

export type StudioProfessionalBrushParseFailureReason =
  | "not-plain-data"
  | "unknown-field"
  | "invalid-field"
  | "unsupported-version"
  | "budget-exceeded";

export type StudioProfessionalBrushParseResult =
  | Readonly<{ ok: true; plan: StudioProfessionalBrushDynamicsPlan }>
  | Readonly<{
      ok: false;
      reason: StudioProfessionalBrushParseFailureReason;
      path: string;
    }>;

export interface StudioProfessionalBrushResolveProgress {
  readonly processedSamples: number;
  readonly emittedEvents: number;
}

export interface StudioProfessionalBrushResolveOptions {
  readonly signal?: AbortSignal;
  /** Worker/job schedulers can cooperatively cancel long synchronous replay at deterministic gates. */
  readonly shouldCancel?: (progress: StudioProfessionalBrushResolveProgress) => boolean;
}

export type StudioProfessionalBrushResolveResult =
  | Readonly<{
      status: "resolved";
      totalArcLength: number;
      states: readonly StudioProfessionalBrushResolvedState[];
      depositions: readonly StudioProfessionalBrushDepositionEvent[];
    }>
  | Readonly<{
      status: "cancelled";
      processedSamples: number;
      emittedEvents: number;
    }>
  | Readonly<{
      status: "rejected";
      reason: "invalid-samples" | "budget-exceeded";
      path: string;
    }>;

type Failure = Extract<StudioProfessionalBrushParseResult, { ok: false }>;
type PlainRecord = Readonly<Record<string, unknown>>;

const CHANNEL_NAMES = [
  "size",
  "opacity",
  "flow",
  "spacing",
  "angle",
  "roundness",
  "scatter",
  "textureDepth",
] as const satisfies readonly StudioProfessionalBrushChannelName[];

const CHANNEL_BOUNDS: Readonly<
  Record<StudioProfessionalBrushChannelName, Readonly<{ min: number; max: number }>>
> = Object.freeze({
  size: Object.freeze({ min: 0.01, max: 8_192 }),
  opacity: Object.freeze({ min: 0, max: 1 }),
  flow: Object.freeze({ min: 0, max: 1 }),
  spacing: Object.freeze({ min: 0.05, max: 4_096 }),
  angle: Object.freeze({ min: -Math.PI * 2, max: Math.PI * 2 }),
  roundness: Object.freeze({ min: 0.01, max: 1 }),
  scatter: Object.freeze({ min: 0, max: 8_192 }),
  textureDepth: Object.freeze({ min: 0, max: 1 }),
});

const PLAN_KEYS = [
  "kind",
  "version",
  "planId",
  "revision",
  "seed",
  "units",
  "clock",
  "budgets",
  "velocity",
  "taper",
  "stationary",
  "channels",
] as const;
const UNITS_KEYS = [
  "size",
  "opacity",
  "flow",
  "spacing",
  "angle",
  "roundness",
  "scatter",
  "textureDepth",
] as const;
const CLOCK_KEYS = ["timeUnit", "tickMilliseconds"] as const;
const BUDGET_KEYS = [
  "maxSamples",
  "maxEvents",
  "maxMappings",
  "maxCurvePoints",
  "maxStationaryEventsPerGap",
] as const;
const VELOCITY_KEYS = [
  "normalizationPixelsPerMillisecond",
  "smoothingTimeMilliseconds",
  "initialPixelsPerMillisecond",
  "maximumPixelsPerMillisecond",
] as const;
const TAPER_KEYS = [
  "start",
  "end",
  "minimumSizeRatio",
  "minimumOpacityRatio",
  "speedInfluence",
] as const;
const TAPER_EXTENT_KEYS = ["mode", "value"] as const;
const STATIONARY_KEYS = ["mode", "intervalTicks", "movementEpsilonPixels"] as const;
const CHANNEL_KEYS = ["base", "min", "max", "mappings"] as const;
const MAPPING_KEYS = ["source", "combine", "outputMin", "outputMax", "curve"] as const;
const CURVE_KEYS = ["interpolation", "points"] as const;
const CURVE_POINT_KEYS = ["x", "y"] as const;
const SAMPLE_KEYS = [
  "sequence",
  "timeTick",
  "x",
  "y",
  "pressure",
  "tiltXDegrees",
  "tiltYDegrees",
  "tangentialPressure",
  "twistDegrees",
] as const;

const UINT32_MAX = 0xffff_ffff;
const IDENTIFIER_MAX_CHARACTERS = 128;
const MAPPING_OUTPUT_MAGNITUDE = 16_777_216;
const ARC_EPSILON = 1e-9;
const CURVE_TANGENT_CACHE = new WeakMap<
  StudioProfessionalBrushResponseCurve,
  readonly number[]
>();

function fail(
  reason: StudioProfessionalBrushParseFailureReason,
  path: string,
): Failure {
  return Object.freeze({ ok: false, reason, path });
}

function exactRecord(
  input: unknown,
  expectedKeys: readonly string[],
  path: string,
): Readonly<{ ok: true; value: PlainRecord }> | Failure {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return fail("not-plain-data", path);
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      return fail("not-plain-data", path);
    }
    if (Object.getOwnPropertySymbols(input).length !== 0) {
      return fail("not-plain-data", path);
    }
    const descriptors = Object.getOwnPropertyDescriptors(input) as unknown as Record<
      string,
      PropertyDescriptor
    >;
    const actualKeys = Object.keys(descriptors);
    const expected = new Set(expectedKeys);
    for (const key of actualKeys) {
      if (!expected.has(key)) return fail("unknown-field", `${path}.${key}`);
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return fail("not-plain-data", `${path}.${key}`);
      }
    }
    const detached: Record<string, unknown> = {};
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return fail("invalid-field", `${path}.${key}`);
      }
      detached[key] = descriptor.value;
    }
    return { ok: true, value: detached };
  } catch {
    return fail("not-plain-data", path);
  }
}

function exactArray(
  input: unknown,
  path: string,
): Readonly<{ ok: true; value: readonly unknown[] }> | Failure {
  try {
    if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) {
      return fail("not-plain-data", path);
    }
    if (Object.getOwnPropertySymbols(input).length !== 0) {
      return fail("not-plain-data", path);
    }
    const descriptors = Object.getOwnPropertyDescriptors(input) as unknown as Record<
      string,
      PropertyDescriptor
    >;
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor || !("value" in lengthDescriptor)) {
      return fail("not-plain-data", path);
    }
    const length = lengthDescriptor.value;
    if (!Number.isSafeInteger(length) || length < 0) return fail("invalid-field", path);
    const result: unknown[] = [];
    for (const key of Object.keys(descriptors)) {
      if (key === "length") continue;
      if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length) {
        return fail("unknown-field", `${path}.${key}`);
      }
    }
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return fail("not-plain-data", `${path}[${index}]`);
      }
      result.push(descriptor.value);
    }
    return { ok: true, value: result };
  } catch {
    return fail("not-plain-data", path);
  }
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function integerInRange(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

function numberInRange(value: unknown, min: number, max: number): value is number {
  return finite(value) && value >= min && value <= max;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function parseCurve(
  input: unknown,
  path: string,
  maxCurvePoints: number,
): Readonly<{ ok: true; value: StudioProfessionalBrushResponseCurve; pointCount: number }> | Failure {
  const record = exactRecord(input, CURVE_KEYS, path);
  if (!record.ok) return record;
  if (record.value.interpolation !== STUDIO_PROFESSIONAL_BRUSH_CURVE_INTERPOLATION) {
    return fail("invalid-field", `${path}.interpolation`);
  }
  const points = exactArray(record.value.points, `${path}.points`);
  if (!points.ok) return points;
  if (points.value.length < 2 || points.value.length > maxCurvePoints) {
    return fail("budget-exceeded", `${path}.points`);
  }
  const detached: StudioProfessionalBrushCurvePoint[] = [];
  let previousX = -1;
  let previousY = -1;
  for (let index = 0; index < points.value.length; index += 1) {
    const pointPath = `${path}.points[${index}]`;
    const point = exactRecord(points.value[index], CURVE_POINT_KEYS, pointPath);
    if (!point.ok) return point;
    if (
      !numberInRange(point.value.x, 0, 1)
      || !numberInRange(point.value.y, 0, 1)
      || point.value.x <= previousX
      || point.value.y < previousY
    ) return fail("invalid-field", pointPath);
    previousX = point.value.x;
    previousY = point.value.y;
    detached.push({ x: point.value.x, y: point.value.y });
  }
  if (detached[0]?.x !== 0 || detached.at(-1)?.x !== 1) {
    return fail("invalid-field", `${path}.points`);
  }
  return {
    ok: true,
    value: {
      interpolation: STUDIO_PROFESSIONAL_BRUSH_CURVE_INTERPOLATION,
      points: detached,
    },
    pointCount: detached.length,
  };
}

function isSource(value: unknown): value is StudioProfessionalBrushSource {
  return value === "pressure"
    || value === "tilt"
    || value === "velocity"
    || value === "tangential-pressure"
    || value === "twist"
    || value === "progress"
    || value === "deterministic-random";
}

function isCombine(value: unknown): value is StudioProfessionalBrushMappingCombine {
  return value === "replace" || value === "multiply" || value === "add";
}

function parseChannel(
  input: unknown,
  name: StudioProfessionalBrushChannelName,
  path: string,
  budgets: StudioProfessionalBrushBudgets,
): Readonly<{
  ok: true;
  value: StudioProfessionalBrushChannel;
  mappingCount: number;
  pointCount: number;
}> | Failure {
  const record = exactRecord(input, CHANNEL_KEYS, path);
  if (!record.ok) return record;
  const bounds = CHANNEL_BOUNDS[name];
  if (
    !numberInRange(record.value.min, bounds.min, bounds.max)
    || !numberInRange(record.value.max, bounds.min, bounds.max)
    || record.value.min > record.value.max
    || !numberInRange(record.value.base, record.value.min, record.value.max)
  ) return fail("invalid-field", path);
  const mappings = exactArray(record.value.mappings, `${path}.mappings`);
  if (!mappings.ok) return mappings;
  if (mappings.value.length > budgets.maxMappings) {
    return fail("budget-exceeded", `${path}.mappings`);
  }
  const detached: StudioProfessionalBrushMapping[] = [];
  let pointCount = 0;
  for (let index = 0; index < mappings.value.length; index += 1) {
    const mappingPath = `${path}.mappings[${index}]`;
    const mapping = exactRecord(mappings.value[index], MAPPING_KEYS, mappingPath);
    if (!mapping.ok) return mapping;
    if (
      !isSource(mapping.value.source)
      || !isCombine(mapping.value.combine)
      || !numberInRange(
        mapping.value.outputMin,
        -MAPPING_OUTPUT_MAGNITUDE,
        MAPPING_OUTPUT_MAGNITUDE,
      )
      || !numberInRange(
        mapping.value.outputMax,
        -MAPPING_OUTPUT_MAGNITUDE,
        MAPPING_OUTPUT_MAGNITUDE,
      )
    ) return fail("invalid-field", mappingPath);
    const curve = parseCurve(
      mapping.value.curve,
      `${mappingPath}.curve`,
      budgets.maxCurvePoints,
    );
    if (!curve.ok) return curve;
    pointCount += curve.pointCount;
    if (pointCount > budgets.maxCurvePoints) {
      return fail("budget-exceeded", `${path}.mappings`);
    }
    detached.push({
      source: mapping.value.source,
      combine: mapping.value.combine,
      outputMin: mapping.value.outputMin,
      outputMax: mapping.value.outputMax,
      curve: curve.value,
    });
  }
  return {
    ok: true,
    value: {
      base: record.value.base,
      min: record.value.min,
      max: record.value.max,
      mappings: detached,
    },
    mappingCount: detached.length,
    pointCount,
  };
}

function parseBudgets(
  input: unknown,
  path: string,
): Readonly<{ ok: true; value: StudioProfessionalBrushBudgets }> | Failure {
  const record = exactRecord(input, BUDGET_KEYS, path);
  if (!record.ok) return record;
  const hard = STUDIO_PROFESSIONAL_BRUSH_HARD_BUDGETS;
  if (
    !integerInRange(record.value.maxSamples, 1, hard.maxSamples)
    || !integerInRange(record.value.maxEvents, 1, hard.maxEvents)
    || !integerInRange(record.value.maxMappings, 0, hard.maxMappings)
    || !integerInRange(record.value.maxCurvePoints, 2, hard.maxCurvePoints)
    || !integerInRange(
      record.value.maxStationaryEventsPerGap,
      0,
      hard.maxStationaryEventsPerGap,
    )
  ) return fail("budget-exceeded", path);
  return {
    ok: true,
    value: {
      maxSamples: record.value.maxSamples,
      maxEvents: record.value.maxEvents,
      maxMappings: record.value.maxMappings,
      maxCurvePoints: record.value.maxCurvePoints,
      maxStationaryEventsPerGap: record.value.maxStationaryEventsPerGap,
    },
  };
}

function parseTaperExtent(
  input: unknown,
  path: string,
): Readonly<{ ok: true; value: StudioProfessionalBrushTaperExtent }> | Failure {
  const record = exactRecord(input, TAPER_EXTENT_KEYS, path);
  if (!record.ok) return record;
  if (record.value.mode === "length-pixels") {
    if (!numberInRange(record.value.value, 0, 1_000_000)) {
      return fail("invalid-field", `${path}.value`);
    }
    return { ok: true, value: { mode: "length-pixels", value: record.value.value } };
  }
  if (record.value.mode === "stroke-percentage") {
    if (!numberInRange(record.value.value, 0, 0.5)) {
      return fail("invalid-field", `${path}.value`);
    }
    return { ok: true, value: { mode: "stroke-percentage", value: record.value.value } };
  }
  return fail("invalid-field", `${path}.mode`);
}

/**
 * Strictly validates untrusted durable data, copies every accepted value into schema order and
 * deep-freezes the detached result. Unknown fields, accessors and class/vendor instances fail
 * closed; values are never silently clamped or repaired.
 */
export function parseStudioProfessionalBrushDynamicsPlan(
  input: unknown,
): StudioProfessionalBrushParseResult {
  const record = exactRecord(input, PLAN_KEYS, "$");
  if (!record.ok) return record;
  if (record.value.kind !== "studio-professional-brush-dynamics") {
    return fail("invalid-field", "$.kind");
  }
  if (record.value.version !== STUDIO_PROFESSIONAL_BRUSH_DYNAMICS_VERSION) {
    return fail("unsupported-version", "$.version");
  }
  if (
    typeof record.value.planId !== "string"
    || record.value.planId.length === 0
    || record.value.planId.length > IDENTIFIER_MAX_CHARACTERS
    || !integerInRange(record.value.revision, 0, Number.MAX_SAFE_INTEGER)
    || !integerInRange(record.value.seed, 0, UINT32_MAX)
  ) return fail("invalid-field", "$");

  const units = exactRecord(record.value.units, UNITS_KEYS, "$.units");
  if (!units.ok) return units;
  if (
    units.value.size !== "document-css-px"
    || units.value.opacity !== "unit-interval"
    || units.value.flow !== "unit-interval"
    || units.value.spacing !== "document-css-px"
    || units.value.angle !== "radians"
    || units.value.roundness !== "unit-interval"
    || units.value.scatter !== "document-css-px"
    || units.value.textureDepth !== "unit-interval"
  ) return fail("invalid-field", "$.units");

  const clock = exactRecord(record.value.clock, CLOCK_KEYS, "$.clock");
  if (!clock.ok) return clock;
  if (
    clock.value.timeUnit !== "milliseconds"
    || !integerInRange(
      clock.value.tickMilliseconds,
      1,
      STUDIO_PROFESSIONAL_BRUSH_HARD_BUDGETS.maxTickMilliseconds,
    )
  ) return fail("invalid-field", "$.clock");

  const budgets = parseBudgets(record.value.budgets, "$.budgets");
  if (!budgets.ok) return budgets;

  const velocity = exactRecord(record.value.velocity, VELOCITY_KEYS, "$.velocity");
  if (!velocity.ok) return velocity;
  if (
    !numberInRange(velocity.value.normalizationPixelsPerMillisecond, 1e-6, 1_000_000)
    || !numberInRange(velocity.value.smoothingTimeMilliseconds, 1e-6, 60_000)
    || !numberInRange(velocity.value.maximumPixelsPerMillisecond, 1e-6, 1_000_000)
    || !numberInRange(
      velocity.value.initialPixelsPerMillisecond,
      0,
      velocity.value.maximumPixelsPerMillisecond,
    )
  ) return fail("invalid-field", "$.velocity");

  const taper = exactRecord(record.value.taper, TAPER_KEYS, "$.taper");
  if (!taper.ok) return taper;
  const taperStart = parseTaperExtent(taper.value.start, "$.taper.start");
  if (!taperStart.ok) return taperStart;
  const taperEnd = parseTaperExtent(taper.value.end, "$.taper.end");
  if (!taperEnd.ok) return taperEnd;
  if (
    !numberInRange(taper.value.minimumSizeRatio, 0, 1)
    || !numberInRange(taper.value.minimumOpacityRatio, 0, 1)
    || !numberInRange(taper.value.speedInfluence, 0, 1)
  ) return fail("invalid-field", "$.taper");

  const stationary = exactRecord(record.value.stationary, STATIONARY_KEYS, "$.stationary");
  if (!stationary.ok) return stationary;
  if (
    (stationary.value.mode !== "disabled" && stationary.value.mode !== "continuous")
    || !integerInRange(stationary.value.intervalTicks, 1, Number.MAX_SAFE_INTEGER)
    || !numberInRange(stationary.value.movementEpsilonPixels, 0, 64)
  ) return fail("invalid-field", "$.stationary");

  const channels = exactRecord(record.value.channels, CHANNEL_NAMES, "$.channels");
  if (!channels.ok) return channels;
  const detachedChannels = {} as Record<
    StudioProfessionalBrushChannelName,
    StudioProfessionalBrushChannel
  >;
  let mappingCount = 0;
  let curvePointCount = 0;
  for (const channelName of CHANNEL_NAMES) {
    const parsed = parseChannel(
      channels.value[channelName],
      channelName,
      `$.channels.${channelName}`,
      budgets.value,
    );
    if (!parsed.ok) return parsed;
    mappingCount += parsed.mappingCount;
    curvePointCount += parsed.pointCount;
    if (
      mappingCount > budgets.value.maxMappings
      || curvePointCount > budgets.value.maxCurvePoints
    ) return fail("budget-exceeded", "$.channels");
    detachedChannels[channelName] = parsed.value;
  }

  const plan: StudioProfessionalBrushDynamicsPlan = {
    kind: "studio-professional-brush-dynamics",
    version: STUDIO_PROFESSIONAL_BRUSH_DYNAMICS_VERSION,
    planId: record.value.planId,
    revision: record.value.revision,
    seed: record.value.seed,
    units: {
      size: "document-css-px",
      opacity: "unit-interval",
      flow: "unit-interval",
      spacing: "document-css-px",
      angle: "radians",
      roundness: "unit-interval",
      scatter: "document-css-px",
      textureDepth: "unit-interval",
    },
    clock: {
      timeUnit: "milliseconds",
      tickMilliseconds: clock.value.tickMilliseconds,
    },
    budgets: budgets.value,
    velocity: {
      normalizationPixelsPerMillisecond:
        velocity.value.normalizationPixelsPerMillisecond,
      smoothingTimeMilliseconds: velocity.value.smoothingTimeMilliseconds,
      initialPixelsPerMillisecond: velocity.value.initialPixelsPerMillisecond,
      maximumPixelsPerMillisecond: velocity.value.maximumPixelsPerMillisecond,
    },
    taper: {
      start: taperStart.value,
      end: taperEnd.value,
      minimumSizeRatio: taper.value.minimumSizeRatio,
      minimumOpacityRatio: taper.value.minimumOpacityRatio,
      speedInfluence: taper.value.speedInfluence,
    },
    stationary: {
      mode: stationary.value.mode,
      intervalTicks: stationary.value.intervalTicks,
      movementEpsilonPixels: stationary.value.movementEpsilonPixels,
    },
    channels: detachedChannels as unknown as StudioProfessionalBrushChannels,
  };
  return Object.freeze({ ok: true, plan: deepFreeze(plan) });
}

function monotoneTangents(points: readonly StudioProfessionalBrushCurvePoint[]): number[] {
  const count = points.length;
  const slopes = new Array<number>(count - 1);
  const tangents = new Array<number>(count);
  for (let index = 0; index < count - 1; index += 1) {
    const left = points[index]!;
    const right = points[index + 1]!;
    slopes[index] = (right.y - left.y) / (right.x - left.x);
  }
  tangents[0] = slopes[0]!;
  tangents[count - 1] = slopes[count - 2]!;
  for (let index = 1; index < count - 1; index += 1) {
    const before = slopes[index - 1]!;
    const after = slopes[index]!;
    if (before === 0 || after === 0) {
      tangents[index] = 0;
    } else {
      const leftWidth = points[index]!.x - points[index - 1]!.x;
      const rightWidth = points[index + 1]!.x - points[index]!.x;
      const weightA = 2 * rightWidth + leftWidth;
      const weightB = rightWidth + 2 * leftWidth;
      tangents[index] = (weightA + weightB) / (weightA / before + weightB / after);
    }
  }
  for (let index = 0; index < slopes.length; index += 1) {
    const slope = slopes[index]!;
    if (slope === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }
    const alpha = tangents[index]! / slope;
    const beta = tangents[index + 1]! / slope;
    const magnitude = Math.hypot(alpha, beta);
    if (magnitude > 3) {
      const scale = 3 / magnitude;
      tangents[index] = scale * alpha * slope;
      tangents[index + 1] = scale * beta * slope;
    }
  }
  return tangents;
}

function cachedMonotoneTangents(
  curve: StudioProfessionalBrushResponseCurve,
): readonly number[] {
  const cached = CURVE_TANGENT_CACHE.get(curve);
  if (cached) return cached;
  const tangents = Object.freeze(monotoneTangents(curve.points));
  CURVE_TANGENT_CACHE.set(curve, tangents);
  return tangents;
}

/** Fritsch-Carlson/Hyman-limited cubic Hermite evaluation with no segment overshoot. */
export function evaluateStudioProfessionalBrushResponseCurve(
  curve: StudioProfessionalBrushResponseCurve,
  input: number,
): number {
  const x = Math.min(1, Math.max(0, finite(input) ? input : 0));
  const points = curve.points;
  if (x <= points[0]!.x) return points[0]!.y;
  if (x >= points.at(-1)!.x) return points.at(-1)!.y;
  let low = 0;
  let high = points.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >>> 1;
    if (x < points[middle]!.x) high = middle;
    else low = middle;
  }
  const left = points[low]!;
  const right = points[high]!;
  const width = right.x - left.x;
  const t = (x - left.x) / width;
  const t2 = t * t;
  const t3 = t2 * t;
  const tangents = cachedMonotoneTangents(curve);
  const value =
    (2 * t3 - 3 * t2 + 1) * left.y
    + (t3 - 2 * t2 + t) * width * tangents[low]!
    + (-2 * t3 + 3 * t2) * right.y
    + (t3 - t2) * width * tangents[high]!;
  return Math.min(right.y, Math.max(left.y, value));
}

function clamp(value: number, minimum: number, maximum: number): number {
  const clamped = Math.min(maximum, Math.max(minimum, value));
  return Object.is(clamped, -0) ? 0 : clamped;
}

function mixUint32(value: number): number {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb_352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846c_a68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

function foldSafeInteger(value: number): number {
  const low = value >>> 0;
  const high = Math.floor(value / 0x1_0000_0000) >>> 0;
  return mixUint32(low ^ Math.imul(high, 0x9e37_79b9));
}

function randomUint32(seed: number, identity: number, domain: number): number {
  return mixUint32(
    seed
    ^ foldSafeInteger(identity)
    ^ Math.imul((domain + 1) >>> 0, 0x85eb_ca6b),
  );
}

function randomUnit(seed: number, identity: number, domain: number): number {
  return randomUint32(seed, identity, domain) / 0x1_0000_0000;
}

interface InternalMetric {
  readonly sample: StudioProfessionalBrushAcceptedSample;
  readonly arcLength: number;
  readonly distanceFromPrevious: number;
  readonly velocityPixelsPerMillisecond: number;
}

interface DynamicsPoint {
  readonly sequence: number;
  readonly timeTick: number;
  readonly x: number;
  readonly y: number;
  readonly arcLength: number;
  readonly progress: number;
  readonly velocityPixelsPerMillisecond: number;
  readonly pressure: number;
  readonly tilt: number;
  readonly tangentialPressure: number;
  readonly twist: number;
}

function sourceValue(
  source: StudioProfessionalBrushSource,
  point: DynamicsPoint,
  seed: number,
  identity: number,
  domain: number,
  normalizationSpeed: number,
): number {
  if (source === "pressure") return point.pressure;
  if (source === "tilt") return point.tilt;
  if (source === "velocity") {
    return clamp(point.velocityPixelsPerMillisecond / normalizationSpeed, 0, 1);
  }
  if (source === "tangential-pressure") return point.tangentialPressure;
  if (source === "twist") return point.twist;
  if (source === "progress") return point.progress;
  return randomUnit(seed, identity, domain);
}

function taperExtentPixels(
  extent: StudioProfessionalBrushTaperExtent,
  totalArcLength: number,
): number {
  return extent.mode === "length-pixels" ? extent.value : extent.value * totalArcLength;
}

function taperFactor(
  plan: StudioProfessionalBrushDynamicsPlan,
  point: DynamicsPoint,
  totalArcLength: number,
): number {
  if (totalArcLength <= ARC_EPSILON) return 1;
  const startPixels = taperExtentPixels(plan.taper.start, totalArcLength);
  const endPixels = taperExtentPixels(plan.taper.end, totalArcLength);
  const startFactor = startPixels <= ARC_EPSILON ? 1 : clamp(point.arcLength / startPixels, 0, 1);
  const endFactor = endPixels <= ARC_EPSILON
    ? 1
    : clamp((totalArcLength - point.arcLength) / endPixels, 0, 1);
  const raw = Math.min(startFactor, endFactor);
  const normalizedSpeed = clamp(
    point.velocityPixelsPerMillisecond
      / plan.velocity.normalizationPixelsPerMillisecond,
    0,
    1,
  );
  const exponent = clamp(
    1 + plan.taper.speedInfluence * (1 - 2 * normalizedSpeed),
    0.25,
    2,
  );
  return raw <= 0 ? 0 : Math.pow(raw, exponent);
}

function evaluateChannels(
  plan: StudioProfessionalBrushDynamicsPlan,
  point: DynamicsPoint,
  identity: number,
  totalArcLength: number,
): StudioProfessionalBrushResolvedChannels {
  const values = {} as Record<StudioProfessionalBrushChannelName, number>;
  for (let channelIndex = 0; channelIndex < CHANNEL_NAMES.length; channelIndex += 1) {
    const name = CHANNEL_NAMES[channelIndex]!;
    const channel = plan.channels[name];
    let value = channel.base;
    for (let mappingIndex = 0; mappingIndex < channel.mappings.length; mappingIndex += 1) {
      const mapping = channel.mappings[mappingIndex]!;
      const source = sourceValue(
        mapping.source,
        point,
        plan.seed,
        identity,
        channelIndex * STUDIO_PROFESSIONAL_BRUSH_HARD_BUDGETS.maxMappings + mappingIndex,
        plan.velocity.normalizationPixelsPerMillisecond,
      );
      const response = evaluateStudioProfessionalBrushResponseCurve(mapping.curve, source);
      const mapped = mapping.outputMin + (mapping.outputMax - mapping.outputMin) * response;
      if (mapping.combine === "replace") value = mapped;
      else if (mapping.combine === "multiply") value *= mapped;
      else value += mapped;
      value = clamp(value, channel.min, channel.max);
    }
    values[name] = clamp(value, channel.min, channel.max);
  }
  const taper = taperFactor(plan, point, totalArcLength);
  values.size = clamp(
    values.size
      * (plan.taper.minimumSizeRatio + (1 - plan.taper.minimumSizeRatio) * taper),
    plan.channels.size.min,
    plan.channels.size.max,
  );
  values.opacity = clamp(
    values.opacity
      * (plan.taper.minimumOpacityRatio + (1 - plan.taper.minimumOpacityRatio) * taper),
    plan.channels.opacity.min,
    plan.channels.opacity.max,
  );
  return {
    size: values.size,
    opacity: values.opacity,
    flow: values.flow,
    spacing: values.spacing,
    angle: values.angle,
    roundness: values.roundness,
    scatter: values.scatter,
    textureDepth: values.textureDepth,
  };
}

function resolveSources(
  plan: StudioProfessionalBrushDynamicsPlan,
  point: DynamicsPoint,
  identity: number,
): StudioProfessionalBrushResolvedSources {
  return {
    pressure: point.pressure,
    tilt: point.tilt,
    velocity: clamp(
      point.velocityPixelsPerMillisecond
        / plan.velocity.normalizationPixelsPerMillisecond,
      0,
      1,
    ),
    tangentialPressure: point.tangentialPressure,
    twist: point.twist,
    progress: point.progress,
    deterministicRandom: randomUnit(plan.seed, identity, 0x5354_4154),
  };
}

function toDynamicsPoint(
  metric: InternalMetric,
  totalArcLength: number,
): DynamicsPoint {
  const sample = metric.sample;
  return {
    sequence: sample.sequence,
    timeTick: sample.timeTick,
    x: sample.x,
    y: sample.y,
    arcLength: metric.arcLength,
    progress: totalArcLength <= ARC_EPSILON
      ? 0.5
      : clamp(metric.arcLength / totalArcLength, 0, 1),
    velocityPixelsPerMillisecond: metric.velocityPixelsPerMillisecond,
    pressure: sample.pressure,
    tilt: clamp(Math.hypot(sample.tiltXDegrees, sample.tiltYDegrees) / 90, 0, 1),
    tangentialPressure: (sample.tangentialPressure + 1) / 2,
    twist: sample.twistDegrees / 360,
  };
}

function interpolatePoint(
  left: DynamicsPoint,
  right: DynamicsPoint,
  ratio: number,
  arcLength: number,
  totalArcLength: number,
): DynamicsPoint {
  const mix = (a: number, b: number): number => a + (b - a) * ratio;
  return {
    sequence: right.sequence,
    timeTick: Math.round(mix(left.timeTick, right.timeTick)),
    x: mix(left.x, right.x),
    y: mix(left.y, right.y),
    arcLength,
    progress: totalArcLength <= ARC_EPSILON ? 0.5 : clamp(arcLength / totalArcLength, 0, 1),
    velocityPixelsPerMillisecond: mix(
      left.velocityPixelsPerMillisecond,
      right.velocityPixelsPerMillisecond,
    ),
    pressure: mix(left.pressure, right.pressure),
    tilt: mix(left.tilt, right.tilt),
    tangentialPressure: mix(left.tangentialPressure, right.tangentialPressure),
    twist: mix(left.twist, right.twist),
  };
}

function parseAcceptedSamples(
  input: unknown,
  plan: StudioProfessionalBrushDynamicsPlan,
): Readonly<{ ok: true; value: readonly StudioProfessionalBrushAcceptedSample[] }>
  | Readonly<{ ok: false; path: string }> {
  const array = exactArray(input, "$.samples");
  if (!array.ok) return { ok: false, path: array.path };
  if (array.value.length === 0 || array.value.length > plan.budgets.maxSamples) {
    return { ok: false, path: "$.samples" };
  }
  const detached: StudioProfessionalBrushAcceptedSample[] = [];
  let previousSequence = -1;
  let previousTimeTick = -1;
  for (let index = 0; index < array.value.length; index += 1) {
    const path = `$.samples[${index}]`;
    const sample = exactRecord(array.value[index], SAMPLE_KEYS, path);
    if (!sample.ok) return { ok: false, path: sample.path };
    if (
      !integerInRange(sample.value.sequence, 0, Number.MAX_SAFE_INTEGER)
      || sample.value.sequence <= previousSequence
      || !integerInRange(sample.value.timeTick, 0, Number.MAX_SAFE_INTEGER)
      || sample.value.timeTick < previousTimeTick
      || !numberInRange(
        sample.value.x,
        -STUDIO_PROFESSIONAL_BRUSH_HARD_BUDGETS.maxCoordinateMagnitude,
        STUDIO_PROFESSIONAL_BRUSH_HARD_BUDGETS.maxCoordinateMagnitude,
      )
      || !numberInRange(
        sample.value.y,
        -STUDIO_PROFESSIONAL_BRUSH_HARD_BUDGETS.maxCoordinateMagnitude,
        STUDIO_PROFESSIONAL_BRUSH_HARD_BUDGETS.maxCoordinateMagnitude,
      )
      || !numberInRange(sample.value.pressure, 0, 1)
      || !numberInRange(sample.value.tiltXDegrees, -90, 90)
      || !numberInRange(sample.value.tiltYDegrees, -90, 90)
      || !numberInRange(sample.value.tangentialPressure, -1, 1)
      || !numberInRange(sample.value.twistDegrees, 0, 360)
      || sample.value.twistDegrees === 360
      || sample.value.timeTick * plan.clock.tickMilliseconds > Number.MAX_SAFE_INTEGER
    ) return { ok: false, path };
    previousSequence = sample.value.sequence;
    previousTimeTick = sample.value.timeTick;
    detached.push({
      sequence: sample.value.sequence,
      timeTick: sample.value.timeTick,
      x: sample.value.x,
      y: sample.value.y,
      pressure: sample.value.pressure,
      tiltXDegrees: sample.value.tiltXDegrees,
      tiltYDegrees: sample.value.tiltYDegrees,
      tangentialPressure: sample.value.tangentialPressure,
      twistDegrees: sample.value.twistDegrees,
    });
  }
  return { ok: true, value: detached };
}

function cancellationResult(
  options: StudioProfessionalBrushResolveOptions,
  processedSamples: number,
  emittedEvents: number,
): Extract<StudioProfessionalBrushResolveResult, { status: "cancelled" }> | null {
  const progress = Object.freeze({ processedSamples, emittedEvents });
  if (options.signal?.aborted || options.shouldCancel?.(progress) === true) {
    return Object.freeze({ status: "cancelled", processedSamples, emittedEvents });
  }
  return null;
}

function makeEvent(
  plan: StudioProfessionalBrushDynamicsPlan,
  point: DynamicsPoint,
  eventIndex: number,
  cause: StudioProfessionalBrushDepositionEvent["cause"],
  totalArcLength: number,
): StudioProfessionalBrushDepositionEvent {
  return {
    eventIndex,
    cause,
    sourceSequence: point.sequence,
    timeTick: point.timeTick,
    x: point.x,
    y: point.y,
    arcLength: point.arcLength,
    progress: point.progress,
    velocityPixelsPerMillisecond: point.velocityPixelsPerMillisecond,
    randomUint32: randomUint32(plan.seed, eventIndex, 0x4252_5553),
    sources: resolveSources(plan, point, eventIndex),
    channels: evaluateChannels(plan, point, eventIndex, totalArcLength),
  };
}

/**
 * Resolves accepted canonical samples into deterministic sample states and deposition events.
 *
 * Velocity uses an `expm1` one-pole estimator to remain stable for tiny time deltas. Arc length is
 * Kahan-summed. Motion deposition is spacing-driven, while stationary deposition is anchored to
 * integer clock ticks and therefore cannot depend on animation frames or wall-clock scheduling.
 */
export function resolveStudioProfessionalBrushDynamics(
  plan: StudioProfessionalBrushDynamicsPlan,
  samplesInput: unknown,
  options: StudioProfessionalBrushResolveOptions = {},
): StudioProfessionalBrushResolveResult {
  const parsedSamples = parseAcceptedSamples(samplesInput, plan);
  if (!parsedSamples.ok) {
    return Object.freeze({
      status: "rejected",
      reason: parsedSamples.path === "$.samples" ? "budget-exceeded" : "invalid-samples",
      path: parsedSamples.path,
    });
  }
  const samples = parsedSamples.value;
  const metrics: InternalMetric[] = [];
  let arcLength = 0;
  let arcCompensation = 0;
  let velocity = plan.velocity.initialPixelsPerMillisecond;
  for (let index = 0; index < samples.length; index += 1) {
    const cancelled = cancellationResult(options, index, 0);
    if (cancelled) return cancelled;
    const sample = samples[index]!;
    const previous = samples[index - 1];
    const distance = previous ? Math.hypot(sample.x - previous.x, sample.y - previous.y) : 0;
    if (previous) {
      const corrected = distance - arcCompensation;
      const next = arcLength + corrected;
      arcCompensation = (next - arcLength) - corrected;
      arcLength = next;
      const deltaMilliseconds =
        (sample.timeTick - previous.timeTick) * plan.clock.tickMilliseconds;
      if (deltaMilliseconds > 0) {
        const instantaneous = clamp(
          distance / deltaMilliseconds,
          0,
          plan.velocity.maximumPixelsPerMillisecond,
        );
        const exponent = -deltaMilliseconds / plan.velocity.smoothingTimeMilliseconds;
        const alpha = exponent < -745 ? 1 : -Math.expm1(exponent);
        velocity = clamp(
          velocity + alpha * (instantaneous - velocity),
          0,
          plan.velocity.maximumPixelsPerMillisecond,
        );
      }
    }
    metrics.push({
      sample,
      arcLength,
      distanceFromPrevious: distance,
      velocityPixelsPerMillisecond: velocity,
    });
  }
  const totalArcLength = arcLength;
  const points = metrics.map((metric) => toDynamicsPoint(metric, totalArcLength));
  const states: StudioProfessionalBrushResolvedState[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const cancelled = cancellationResult(options, index, 0);
    if (cancelled) return cancelled;
    const point = points[index]!;
    states.push({
      sequence: point.sequence,
      timeTick: point.timeTick,
      x: point.x,
      y: point.y,
      arcLength: point.arcLength,
      progress: point.progress,
      velocityPixelsPerMillisecond: point.velocityPixelsPerMillisecond,
      sources: resolveSources(plan, point, point.sequence),
      channels: evaluateChannels(plan, point, point.sequence, totalArcLength),
    });
  }

  const depositions: StudioProfessionalBrushDepositionEvent[] = [];
  const initial = makeEvent(plan, points[0]!, 0, "initial", totalArcLength);
  depositions.push(initial);
  if (depositions.length > plan.budgets.maxEvents) {
    return Object.freeze({
      status: "rejected",
      reason: "budget-exceeded",
      path: "$.depositions",
    });
  }
  let distanceUntilNext = Math.max(plan.channels.spacing.min, initial.channels.spacing);

  for (let index = 1; index < points.length; index += 1) {
    const cancelled = cancellationResult(options, index, depositions.length);
    if (cancelled) return cancelled;
    const left = points[index - 1]!;
    const right = points[index]!;
    const distance = metrics[index]!.distanceFromPrevious;
    if (
      plan.stationary.mode === "continuous"
      && distance <= plan.stationary.movementEpsilonPixels
      && right.timeTick > left.timeTick
    ) {
      const interval = plan.stationary.intervalTicks;
      let eventTick = (Math.floor(left.timeTick / interval) + 1) * interval;
      let gapEvents = 0;
      while (eventTick <= right.timeTick) {
        if (
          gapEvents >= plan.budgets.maxStationaryEventsPerGap
          || depositions.length >= plan.budgets.maxEvents
        ) {
          return Object.freeze({
            status: "rejected",
            reason: "budget-exceeded",
            path: `$.samples[${index}]`,
          });
        }
        const ratio = (eventTick - left.timeTick) / (right.timeTick - left.timeTick);
        const point = interpolatePoint(
          left,
          right,
          ratio,
          left.arcLength + distance * ratio,
          totalArcLength,
        );
        const timedPoint: DynamicsPoint = { ...point, timeTick: eventTick };
        depositions.push(
          makeEvent(
            plan,
            timedPoint,
            depositions.length,
            "stationary",
            totalArcLength,
          ),
        );
        gapEvents += 1;
        const eventCancellation = cancellationResult(options, index, depositions.length);
        if (eventCancellation) return eventCancellation;
        eventTick += interval;
      }
      continue;
    }
    if (distance <= ARC_EPSILON) continue;
    let traversed = 0;
    while (distance - traversed + ARC_EPSILON >= distanceUntilNext) {
      if (depositions.length >= plan.budgets.maxEvents) {
        return Object.freeze({
          status: "rejected",
          reason: "budget-exceeded",
          path: `$.samples[${index}]`,
        });
      }
      traversed += distanceUntilNext;
      const ratio = clamp(traversed / distance, 0, 1);
      const point = interpolatePoint(
        left,
        right,
        ratio,
        left.arcLength + traversed,
        totalArcLength,
      );
      const event = makeEvent(plan, point, depositions.length, "motion", totalArcLength);
      depositions.push(event);
      distanceUntilNext = Math.max(plan.channels.spacing.min, event.channels.spacing);
      const eventCancellation = cancellationResult(options, index, depositions.length);
      if (eventCancellation) return eventCancellation;
    }
    distanceUntilNext = Math.max(
      ARC_EPSILON,
      distanceUntilNext - (distance - traversed),
    );
  }

  return deepFreeze({
    status: "resolved",
    totalArcLength,
    states,
    depositions,
  });
}
