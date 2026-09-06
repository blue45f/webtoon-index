import {
  parseStudioCanonicalBrushPlan,
  STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS,
} from "./studio-canonical-brush-plan";

import type {
  StudioCanonicalBrushPlan,
  StudioCanonicalBrushResponseCurve,
  StudioCanonicalBrushSourceSample,
} from "./studio-canonical-brush-plan";

/**
 * Provider-neutral, clean-room bristle/rake dynamics.
 *
 * The model is based only on publicly documented artist-facing behaviour: bristle density,
 * fanning, contact angle, feature scaling, pressure/tilt spread, turn displacement and softened
 * outer bristles. It deliberately contains no vendor file format, preset serialization or source
 * implementation.
 */
export const STUDIO_PROFESSIONAL_BRISTLE_DYNAMICS_VERSION = 1 as const;

export const STUDIO_PROFESSIONAL_BRISTLE_DYNAMICS_BUDGETS = Object.freeze({
  maxBristles: 512,
  maxStations: 65_536,
  maxDepositions: 262_144,
  maxIdentifierCharacters: 128,
  maxCoordinateAbsolute: STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxCoordinateAbsolute,
} as const);

export type StudioProfessionalBristleOrientation =
  | "stroke-direction"
  | "stylus-rotation"
  | "hybrid";

export interface StudioProfessionalBristleDynamicsPlan {
  readonly kind: "studio-professional-bristle-dynamics";
  readonly version: typeof STUDIO_PROFESSIONAL_BRISTLE_DYNAMICS_VERSION;
  readonly brushId: string;
  readonly seed: number;
  readonly bristleCount: number;
  /** Fraction of canonical brush diameter used by one bristle. */
  readonly bristleRadiusRatio: number;
  /** Fixed CSS-pixel feature diameter used when feature scaling is disabled. */
  readonly featureReferenceDiameter: number;
  /** Arc-length interval as a fraction of canonical brush diameter. */
  readonly spacingRatio: number;
  readonly spread: number;
  readonly fanning: number;
  readonly rigidity: number;
  readonly friction: number;
  /** Zero contacts the centre bristle only; PI makes the full head contact the surface. */
  readonly contactAngleRadians: number;
  readonly turnAmount: number;
  readonly softenEdge: number;
  readonly pressureSpread: number;
  readonly tiltSpread: number;
  readonly lengthVariation: number;
  readonly colorVariation: number;
  readonly orientation: StudioProfessionalBristleOrientation;
  readonly scaleFeatureWithBrushSize: boolean;
}

export interface StudioProfessionalBristleResolveOptions {
  readonly maximumStations?: number;
  readonly maximumDepositions?: number;
  readonly signal?: AbortSignal;
  readonly shouldCancel?: (progress: Readonly<{
    processedStations: number;
    emittedDepositions: number;
  }>) => boolean;
}

export interface StudioProfessionalBristleStation {
  readonly index: number;
  readonly distance: number;
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly tiltMagnitude: number;
  readonly headingRadians: number;
  readonly diameter: number;
  readonly activeBristles: number;
}

export interface StudioProfessionalBristleDeposition {
  readonly stationIndex: number;
  readonly bristleIndex: number;
  readonly x: number;
  readonly y: number;
  /** Column-major unit-circle basis preserving affine scale, reflection and shear. */
  readonly localToDocument: readonly [number, number, number, number];
  /** Geometric-mean radius retained for UI diagnostics and budget estimates. */
  readonly radius: number;
  readonly opacity: number;
  /** Stable, zero-centred scalar for a later colour-variation provider. */
  readonly colorVariation: number;
  /** Stable, zero-centred scalar for diagnostics and later material loading. */
  readonly lengthVariation: number;
  readonly lateralOffset: number;
  readonly longitudinalOffset: number;
  readonly headingRadians: number;
}

export type StudioProfessionalBristleResolveResult =
  | Readonly<{
      status: "resolved";
      version: typeof STUDIO_PROFESSIONAL_BRISTLE_DYNAMICS_VERSION;
      strokeId: string;
      stations: readonly StudioProfessionalBristleStation[];
      depositions: readonly StudioProfessionalBristleDeposition[];
    }>
  | Readonly<{
      status: "rejected";
      reason:
        | "invalid-canonical-plan"
        | "invalid-dynamics-plan"
        | "invalid-options"
        | "station-limit-exceeded"
        | "deposition-limit-exceeded"
        | "numeric-overflow";
      path?: string;
    }>
  | Readonly<{
      status: "cancelled";
      processedStations: number;
      emittedDepositions: number;
    }>;

export type StudioProfessionalBristlePlanParseResult =
  | Readonly<{ ok: true; plan: StudioProfessionalBristleDynamicsPlan }>
  | Readonly<{ ok: false; path: string }>;

interface InterpolatedSample {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly twist: number;
  readonly tangentX: number;
  readonly tangentY: number;
}

interface BristleFeature {
  readonly index: number;
  readonly normalizedOffset: number;
  readonly radiusVariation: number;
  readonly lengthVariation: number;
  readonly colorVariation: number;
}

const UINT32_MAX = 0xffff_ffff;
const TAU = Math.PI * 2;
const PLAN_KEYS = [
  "kind",
  "version",
  "brushId",
  "seed",
  "bristleCount",
  "bristleRadiusRatio",
  "featureReferenceDiameter",
  "spacingRatio",
  "spread",
  "fanning",
  "rigidity",
  "friction",
  "contactAngleRadians",
  "turnAmount",
  "softenEdge",
  "pressureSpread",
  "tiltSpread",
  "lengthVariation",
  "colorVariation",
  "orientation",
  "scaleFeatureWithBrushSize",
] as const;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function inRange(value: unknown, minimum: number, maximum: number): value is number {
  return finite(value) && value >= minimum && value <= maximum;
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function uint32(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= UINT32_MAX;
}

function exactDataRecord(
  input: unknown,
  keys: readonly string[],
): Readonly<Record<string, unknown>> | null {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== keys.length
      || actualKeys.some((key) => typeof key !== "string" || !keys.includes(key))
    ) return null;
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (
        !descriptor
        || descriptor.enumerable !== true
        || !Object.prototype.hasOwnProperty.call(descriptor, "value")
      ) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function parseStudioProfessionalBristleDynamicsPlan(
  input: unknown,
): StudioProfessionalBristlePlanParseResult {
  const value = exactDataRecord(input, PLAN_KEYS);
  if (!value) return Object.freeze({ ok: false, path: "$" });
  if (value.kind !== "studio-professional-bristle-dynamics") {
    return Object.freeze({ ok: false, path: "$.kind" });
  }
  if (value.version !== STUDIO_PROFESSIONAL_BRISTLE_DYNAMICS_VERSION) {
    return Object.freeze({ ok: false, path: "$.version" });
  }
  if (
    typeof value.brushId !== "string"
    || value.brushId.length < 1
    || value.brushId.length > STUDIO_PROFESSIONAL_BRISTLE_DYNAMICS_BUDGETS
      .maxIdentifierCharacters
  ) return Object.freeze({ ok: false, path: "$.brushId" });
  if (!uint32(value.seed)) return Object.freeze({ ok: false, path: "$.seed" });
  if (
    !positiveSafeInteger(value.bristleCount)
    || value.bristleCount > STUDIO_PROFESSIONAL_BRISTLE_DYNAMICS_BUDGETS.maxBristles
  ) return Object.freeze({ ok: false, path: "$.bristleCount" });
  const ranges = [
    ["bristleRadiusRatio", value.bristleRadiusRatio, 0.000_25, 0.5],
    [
      "featureReferenceDiameter",
      value.featureReferenceDiameter,
      0.01,
      STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxBrushSize,
    ],
    ["spacingRatio", value.spacingRatio, 0.000_5, 4],
    ["spread", value.spread, 0, 1],
    ["fanning", value.fanning, 0, 1],
    ["rigidity", value.rigidity, 0, 1],
    ["friction", value.friction, 0, 1],
    ["contactAngleRadians", value.contactAngleRadians, 0, Math.PI],
    ["turnAmount", value.turnAmount, 0, 4],
    ["softenEdge", value.softenEdge, 0, 1],
    ["pressureSpread", value.pressureSpread, 0, 2],
    ["tiltSpread", value.tiltSpread, 0, 2],
    ["lengthVariation", value.lengthVariation, 0, 1],
    ["colorVariation", value.colorVariation, 0, 1],
  ] as const;
  for (const [field, candidate, minimum, maximum] of ranges) {
    if (!inRange(candidate, minimum, maximum)) {
      return Object.freeze({ ok: false, path: `$.${field}` });
    }
  }
  if (
    value.orientation !== "stroke-direction"
    && value.orientation !== "stylus-rotation"
    && value.orientation !== "hybrid"
  ) return Object.freeze({ ok: false, path: "$.orientation" });
  if (typeof value.scaleFeatureWithBrushSize !== "boolean") {
    return Object.freeze({ ok: false, path: "$.scaleFeatureWithBrushSize" });
  }
  return Object.freeze({
    ok: true,
    plan: deepFreeze({
      kind: value.kind,
      version: value.version,
      brushId: value.brushId,
      seed: value.seed,
      bristleCount: value.bristleCount,
      bristleRadiusRatio: value.bristleRadiusRatio as number,
      featureReferenceDiameter: value.featureReferenceDiameter as number,
      spacingRatio: value.spacingRatio as number,
      spread: value.spread as number,
      fanning: value.fanning as number,
      rigidity: value.rigidity as number,
      friction: value.friction as number,
      contactAngleRadians: value.contactAngleRadians as number,
      turnAmount: value.turnAmount as number,
      softenEdge: value.softenEdge as number,
      pressureSpread: value.pressureSpread as number,
      tiltSpread: value.tiltSpread as number,
      lengthVariation: value.lengthVariation as number,
      colorVariation: value.colorVariation as number,
      orientation: value.orientation,
      scaleFeatureWithBrushSize: value.scaleFeatureWithBrushSize,
    } satisfies StudioProfessionalBristleDynamicsPlan),
  });
}

function canonicalEpochs(input: unknown): Readonly<{
  sessionEpoch: number;
  strokeEpoch: number;
  commandSequence: number;
}> | null {
  const value = exactDataRecord(input, [
    "kind",
    "version",
    "sessionEpoch",
    "strokeEpoch",
    "commandSequence",
    "strokeId",
    "seed",
    "coordinateSpace",
    "transform",
    "color",
    "composite",
    "recipe",
    "source",
  ]);
  if (
    !value
    || !positiveSafeInteger(value.sessionEpoch)
    || !positiveSafeInteger(value.strokeEpoch)
    || !positiveSafeInteger(value.commandSequence)
  ) return null;
  return Object.freeze({
    sessionEpoch: value.sessionEpoch,
    strokeEpoch: value.strokeEpoch,
    commandSequence: value.commandSequence,
  });
}

function parseCanonical(input: unknown): StudioCanonicalBrushPlan | null {
  const epochs = canonicalEpochs(input);
  if (!epochs) return null;
  const parsed = parseStudioCanonicalBrushPlan(input, {
    sessionEpoch: epochs.sessionEpoch,
    strokeEpoch: epochs.strokeEpoch,
    lastAcceptedCommandSequence: epochs.commandSequence - 1,
  });
  return parsed.ok ? parsed.value.plan : null;
}

function parseOptions(input: StudioProfessionalBristleResolveOptions): Readonly<{
  maximumStations: number;
  maximumDepositions: number;
  signal: AbortSignal | undefined;
  shouldCancel: StudioProfessionalBristleResolveOptions["shouldCancel"];
}> | null {
  const allowed = ["maximumStations", "maximumDepositions", "signal", "shouldCancel"] as const;
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.some((key) => (
        typeof key !== "string"
        || !(allowed as readonly string[]).includes(key)
      ))
    ) return null;
    const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (
        !descriptor
        || descriptor.enumerable !== true
        || !Object.prototype.hasOwnProperty.call(descriptor, "value")
      ) return null;
      values[key] = descriptor.value;
    }
    const maximumStations = values.maximumStations
      ?? STUDIO_PROFESSIONAL_BRISTLE_DYNAMICS_BUDGETS.maxStations;
    const maximumDepositions = values.maximumDepositions
      ?? STUDIO_PROFESSIONAL_BRISTLE_DYNAMICS_BUDGETS.maxDepositions;
    if (
      !positiveSafeInteger(maximumStations)
      || maximumStations > STUDIO_PROFESSIONAL_BRISTLE_DYNAMICS_BUDGETS.maxStations
      || !positiveSafeInteger(maximumDepositions)
      || maximumDepositions > STUDIO_PROFESSIONAL_BRISTLE_DYNAMICS_BUDGETS.maxDepositions
      || (
        values.shouldCancel !== undefined
        && typeof values.shouldCancel !== "function"
      )
      || (
        values.signal !== undefined
        && (
          typeof AbortSignal === "undefined"
          || !(values.signal instanceof AbortSignal)
        )
      )
    ) return null;
    return Object.freeze({
      maximumStations,
      maximumDepositions,
      signal: values.signal as AbortSignal | undefined,
      shouldCancel: values.shouldCancel as StudioProfessionalBristleResolveOptions[
      "shouldCancel"
      ],
    });
  } catch {
    return null;
  }
}

function mix(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function shortestAngleDelta(start: number, end: number): number {
  let delta = (end - start) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return delta;
}

function normalizeAngle(value: number): number {
  let normalized = value % TAU;
  if (normalized > Math.PI) normalized -= TAU;
  if (normalized <= -Math.PI) normalized += TAU;
  return normalized;
}

function mixDegrees(start: number, end: number, amount: number): number {
  const startRadians = start * Math.PI / 180;
  const endRadians = end * Math.PI / 180;
  const result = startRadians + shortestAngleDelta(startRadians, endRadians) * amount;
  return ((result * 180 / Math.PI) % 360 + 360) % 360;
}

function response(curve: StudioCanonicalBrushResponseCurve, input: number): number {
  return curve.minimum
    + (curve.maximum - curve.minimum) * Math.pow(Math.max(0, Math.min(1, input)), curve.exponent);
}

function transformSample(
  plan: StudioCanonicalBrushPlan,
  sample: StudioCanonicalBrushSourceSample,
): StudioCanonicalBrushSourceSample {
  const transform = plan.transform;
  return {
    ...sample,
    x: transform.m11 * sample.x + transform.m21 * sample.y + transform.translateX,
    y: transform.m12 * sample.x + transform.m22 * sample.y + transform.translateY,
  };
}

function cumulativeDistances(
  samples: readonly StudioCanonicalBrushSourceSample[],
): Float64Array | null {
  const distances = new Float64Array(samples.length);
  let sum = 0;
  let correction = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1]!;
    const current = samples[index]!;
    const segment = Math.hypot(current.x - previous.x, current.y - previous.y);
    if (!Number.isFinite(segment)) return null;
    const corrected = segment - correction;
    const next = sum + corrected;
    correction = (next - sum) - corrected;
    sum = next;
    if (!Number.isFinite(sum)) return null;
    distances[index] = sum;
  }
  return distances;
}

function interpolatedAt(
  samples: readonly StudioCanonicalBrushSourceSample[],
  cumulative: Float64Array,
  distance: number,
  cursor: { index: number },
): InterpolatedSample {
  while (
    cursor.index < cumulative.length - 1
    && cumulative[cursor.index]! < distance
  ) cursor.index += 1;
  const upper = Math.max(1, cursor.index);
  const lower = upper - 1;
  const start = samples[lower]!;
  const end = samples[upper] ?? start;
  const span = cumulative[upper]! - cumulative[lower]!;
  const amount = span > 0 ? Math.max(0, Math.min(1, (distance - cumulative[lower]!) / span)) : 0;
  const tangentLength = Math.hypot(end.x - start.x, end.y - start.y);
  const fallbackBefore = samples[Math.max(0, lower - 1)]!;
  const fallbackAfter = samples[Math.min(samples.length - 1, upper + 1)]!;
  const fallbackLength = Math.hypot(
    fallbackAfter.x - fallbackBefore.x,
    fallbackAfter.y - fallbackBefore.y,
  );
  const tangentX = tangentLength > 0
    ? (end.x - start.x) / tangentLength
    : fallbackLength > 0
      ? (fallbackAfter.x - fallbackBefore.x) / fallbackLength
      : 1;
  const tangentY = tangentLength > 0
    ? (end.y - start.y) / tangentLength
    : fallbackLength > 0
      ? (fallbackAfter.y - fallbackBefore.y) / fallbackLength
      : 0;
  return {
    x: mix(start.x, end.x, amount),
    y: mix(start.y, end.y, amount),
    pressure: mix(start.pressure, end.pressure, amount),
    tiltX: mix(start.tiltX, end.tiltX, amount),
    tiltY: mix(start.tiltY, end.tiltY, amount),
    twist: mixDegrees(start.twist, end.twist, amount),
    tangentX,
    tangentY,
  };
}

function hashUint32(value: number): number {
  let result = value >>> 0;
  result ^= result >>> 16;
  result = Math.imul(result, 0x7feb_352d);
  result ^= result >>> 15;
  result = Math.imul(result, 0x846c_a68b);
  result ^= result >>> 16;
  return result >>> 0;
}

function randomSigned(seed: number, index: number, salt: number): number {
  const value = hashUint32((seed ^ Math.imul(index + 1, salt)) >>> 0);
  return value / 0x8000_0000 - 1;
}

function features(plan: StudioProfessionalBristleDynamicsPlan): readonly BristleFeature[] {
  const result: BristleFeature[] = [];
  for (let index = 0; index < plan.bristleCount; index += 1) {
    const regular = plan.bristleCount === 1
      ? 0
      : index / (plan.bristleCount - 1) * 2 - 1;
    const cellWidth = plan.bristleCount === 1 ? 0 : 2 / (plan.bristleCount - 1);
    // Odd bundles retain a true centre bristle. That keeps a predictable centre line while the
    // remaining hairs still receive deterministic anti-banding jitter.
    const isCentre = plan.bristleCount % 2 === 1 && index === Math.floor(plan.bristleCount / 2);
    const jitter = isCentre
      ? 0
      : randomSigned(plan.seed, index, 0x9e37_79b1) * cellWidth * 0.22;
    result.push(Object.freeze({
      index,
      normalizedOffset: Math.max(-1, Math.min(1, regular + jitter)),
      radiusVariation: randomSigned(plan.seed, index, 0x85eb_ca77),
      lengthVariation: randomSigned(plan.seed, index, 0xc2b2_ae3d),
      colorVariation: randomSigned(plan.seed, index, 0x27d4_eb2f),
    }));
  }
  return Object.freeze(result.sort((left, right) => (
    left.normalizedOffset - right.normalizedOffset
    || left.index - right.index
  )));
}

function targetHeading(
  sample: InterpolatedSample,
  orientation: StudioProfessionalBristleOrientation,
): number {
  const stroke = Math.atan2(sample.tangentY, sample.tangentX);
  const stylus = sample.twist * Math.PI / 180;
  if (orientation === "stroke-direction") return stroke;
  if (orientation === "stylus-rotation") return stylus;
  return stroke + shortestAngleDelta(stroke, stylus) * 0.5;
}

function shouldCancel(
  options: Readonly<{
    signal: AbortSignal | undefined;
    shouldCancel: StudioProfessionalBristleResolveOptions["shouldCancel"];
  }>,
  processedStations: number,
  emittedDepositions: number,
): boolean {
  if (options.signal?.aborted) return true;
  try {
    return options.shouldCancel?.(Object.freeze({
      processedStations,
      emittedDepositions,
    })) === true;
  } catch {
    return true;
  }
}

function transformedBrushAxes(
  plan: StudioCanonicalBrushPlan,
  heading: number,
): Readonly<{
  tangentX: number;
  tangentY: number;
  lateralX: number;
  lateralY: number;
  tangentScale: number;
  lateralScale: number;
}> | null {
  const transform = plan.transform;
  const determinant = transform.m11 * transform.m22 - transform.m21 * transform.m12;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  const documentTangentX = Math.cos(heading);
  const documentTangentY = Math.sin(heading);
  const inverseX = (
    transform.m22 * documentTangentX - transform.m21 * documentTangentY
  ) / determinant;
  const inverseY = (
    -transform.m12 * documentTangentX + transform.m11 * documentTangentY
  ) / determinant;
  const inverseLength = Math.hypot(inverseX, inverseY);
  if (!Number.isFinite(inverseLength) || inverseLength <= 0) return null;
  const localTangentX = inverseX / inverseLength;
  const localTangentY = inverseY / inverseLength;
  const localNormalX = -localTangentY;
  const localNormalY = localTangentX;
  const tangentX = transform.m11 * localTangentX + transform.m21 * localTangentY;
  const tangentY = transform.m12 * localTangentX + transform.m22 * localTangentY;
  const lateralX = transform.m11 * localNormalX + transform.m21 * localNormalY;
  const lateralY = transform.m12 * localNormalX + transform.m22 * localNormalY;
  const tangentScale = Math.hypot(tangentX, tangentY);
  const lateralScale = Math.hypot(lateralX, lateralY);
  if (
    ![tangentScale, lateralScale].every(Number.isFinite)
    || tangentScale <= 0
    || lateralScale <= 0
  ) return null;
  return Object.freeze({
    tangentX: tangentX / tangentScale,
    tangentY: tangentY / tangentScale,
    lateralX: lateralX / lateralScale,
    lateralY: lateralY / lateralScale,
    tangentScale,
    lateralScale,
  });
}

export function resolveStudioProfessionalBristleDynamics(
  canonicalInput: unknown,
  dynamicsInput: unknown,
  options: StudioProfessionalBristleResolveOptions = {},
): StudioProfessionalBristleResolveResult {
  const parsedOptions = parseOptions(options);
  if (!parsedOptions) {
    return Object.freeze({ status: "rejected", reason: "invalid-options" });
  }
  const canonical = parseCanonical(canonicalInput);
  if (!canonical) {
    return Object.freeze({ status: "rejected", reason: "invalid-canonical-plan" });
  }
  const parsedDynamics = parseStudioProfessionalBristleDynamicsPlan(dynamicsInput);
  if (!parsedDynamics.ok) {
    return Object.freeze({
      status: "rejected",
      reason: "invalid-dynamics-plan",
      path: parsedDynamics.path,
    });
  }
  if (shouldCancel(parsedOptions, 0, 0)) {
    return Object.freeze({
      status: "cancelled",
      processedStations: 0,
      emittedDepositions: 0,
    });
  }
  const plan = parsedDynamics.plan;
  const transformed = canonical.source.samples.map((sample) => transformSample(canonical, sample));
  const cumulative = cumulativeDistances(transformed);
  if (!cumulative) {
    return Object.freeze({ status: "rejected", reason: "numeric-overflow" });
  }
  const totalLength = cumulative.at(-1) ?? 0;
  const minimumDiameter = canonical.recipe.size * Math.max(
    canonical.recipe.pressure.size.minimum,
    0.01,
  );
  const minimumSpacing = Math.max(0.01, minimumDiameter * plan.spacingRatio);
  const expectedStations = totalLength === 0
    ? 1
    : Math.floor(totalLength / minimumSpacing) + 2;
  if (expectedStations > parsedOptions.maximumStations) {
    return Object.freeze({ status: "rejected", reason: "station-limit-exceeded" });
  }

  const bristleFeatures = features(plan);
  const stations: StudioProfessionalBristleStation[] = [];
  const depositions: StudioProfessionalBristleDeposition[] = [];
  const cursor = { index: 1 };
  let distance = 0;
  let previousHeading: number | null = null;
  let guard = 0;
  while (true) {
    if (stations.length >= parsedOptions.maximumStations) {
      return Object.freeze({ status: "rejected", reason: "station-limit-exceeded" });
    }
    if (shouldCancel(parsedOptions, stations.length, depositions.length)) {
      return Object.freeze({
        status: "cancelled",
        processedStations: stations.length,
        emittedDepositions: depositions.length,
      });
    }
    const sample = interpolatedAt(transformed, cumulative, Math.min(distance, totalLength), cursor);
    const pressure = Math.max(0, Math.min(1, sample.pressure));
    const diameter = canonical.recipe.size * response(canonical.recipe.pressure.size, pressure);
    const tiltMagnitude = Math.min(1, Math.hypot(sample.tiltX, sample.tiltY) / 90);
    const desiredHeading = targetHeading(sample, plan.orientation);
    const travel = stations.length === 0
      ? Math.max(0.01, diameter * plan.spacingRatio)
      : distance - stations.at(-1)!.distance;
    const responseLength = Math.max(
      0.01,
      diameter * (0.05 + plan.friction * 0.8 + (1 - plan.rigidity) * 0.4),
    );
    const follow = 1 - Math.exp(-travel / responseLength);
    const heading = normalizeAngle(previousHeading === null
      ? desiredHeading
      : previousHeading + shortestAngleDelta(previousHeading, desiredHeading) * follow);
    const headingDelta = previousHeading === null
      ? 0
      : shortestAngleDelta(previousHeading, heading);
    previousHeading = heading;

    const contactFraction = plan.bristleCount === 1
      ? 1
      : Math.max(1 / plan.bristleCount, plan.contactAngleRadians / Math.PI);
    let active = bristleFeatures.filter(
      (feature) => Math.abs(feature.normalizedOffset) <= contactFraction + 1e-12,
    );
    if (active.length === 0) {
      active = [bristleFeatures.reduce((nearest, feature) => (
        Math.abs(feature.normalizedOffset) < Math.abs(nearest.normalizedOffset)
          ? feature
          : nearest
      ))];
    }
    const axes = transformedBrushAxes(canonical, heading);
    if (!axes) return Object.freeze({ status: "rejected", reason: "numeric-overflow" });
    const documentDiameter = diameter * axes.lateralScale;
    const station: StudioProfessionalBristleStation = Object.freeze({
      index: stations.length,
      distance: Math.min(distance, totalLength),
      x: sample.x,
      y: sample.y,
      pressure,
      tiltMagnitude,
      headingRadians: heading,
      diameter: documentDiameter,
      activeBristles: active.length,
    });
    stations.push(station);
    if (depositions.length + active.length > parsedOptions.maximumDepositions) {
      return Object.freeze({ status: "rejected", reason: "deposition-limit-exceeded" });
    }

    const featureScaleLocal = plan.scaleFeatureWithBrushSize
      ? diameter
      : plan.featureReferenceDiameter;
    const lateralFeatureScale = featureScaleLocal * axes.lateralScale;
    const longitudinalFeatureScale = featureScaleLocal * axes.tangentScale;
    const pressureFan = 1 + plan.pressureSpread * pressure;
    const tiltFan = 1 + plan.tiltSpread * tiltMagnitude;
    const halfSpread = lateralFeatureScale * 0.5 * plan.spread * pressureFan * tiltFan;
    for (const feature of active) {
      const edge = Math.abs(feature.normalizedOffset);
      const fannedOffset = Math.sign(feature.normalizedOffset)
        * Math.pow(edge, Math.max(0.2, 1 - plan.fanning * 0.8));
      const lateralOffset = fannedOffset * halfSpread;
      const longitudinalOffset = (
        feature.lengthVariation
        * plan.lengthVariation
        * longitudinalFeatureScale
        * 0.25
      ) + (
        headingDelta
        * plan.turnAmount
        * feature.normalizedOffset
        * longitudinalFeatureScale
      );
      const radiusVariation = (
        1 + feature.radiusVariation * plan.lengthVariation * 0.35
      );
      const localRadius = Math.max(
        0.125,
        featureScaleLocal * plan.bristleRadiusRatio * radiusVariation,
      );
      const tangentRadius = localRadius * axes.tangentScale;
      const lateralRadius = localRadius * axes.lateralScale;
      const radius = Math.sqrt(tangentRadius * lateralRadius);
      const localToDocument = Object.freeze([
        axes.tangentX * tangentRadius,
        axes.tangentY * tangentRadius,
        axes.lateralX * lateralRadius,
        axes.lateralY * lateralRadius,
      ] as const);
      const edgeOpacity = 1 - plan.softenEdge * Math.pow(edge, 1.5);
      const opacity = Math.max(0, Math.min(
        1,
        canonical.composite.opacity
          * response(canonical.recipe.pressure.opacity, pressure)
          * canonical.recipe.flow
          * response(canonical.recipe.pressure.flow, pressure)
          * edgeOpacity,
      ));
      const x = sample.x
        + axes.lateralX * lateralOffset
        + axes.tangentX * longitudinalOffset;
      const y = sample.y
        + axes.lateralY * lateralOffset
        + axes.tangentY * longitudinalOffset;
      if (
        ![
          x,
          y,
          radius,
          ...localToDocument,
          opacity,
          lateralOffset,
          longitudinalOffset,
          heading,
        ].every(Number.isFinite)
        || Math.abs(x) > STUDIO_PROFESSIONAL_BRISTLE_DYNAMICS_BUDGETS.maxCoordinateAbsolute
        || Math.abs(y) > STUDIO_PROFESSIONAL_BRISTLE_DYNAMICS_BUDGETS.maxCoordinateAbsolute
      ) return Object.freeze({ status: "rejected", reason: "numeric-overflow" });
      depositions.push(Object.freeze({
        stationIndex: station.index,
        bristleIndex: feature.index,
        x,
        y,
        localToDocument,
        radius,
        opacity,
        colorVariation: feature.colorVariation * plan.colorVariation,
        lengthVariation: feature.lengthVariation * plan.lengthVariation,
        lateralOffset,
        longitudinalOffset,
        headingRadians: heading,
      }));
    }

    if (distance >= totalLength) break;
    const spacing = Math.max(0.01, diameter * axes.tangentScale * plan.spacingRatio);
    const next = Math.min(totalLength, distance + spacing);
    if (!Number.isFinite(next) || next <= distance) {
      return Object.freeze({ status: "rejected", reason: "numeric-overflow" });
    }
    distance = next;
    guard += 1;
    if (guard > parsedOptions.maximumStations) {
      return Object.freeze({ status: "rejected", reason: "station-limit-exceeded" });
    }
  }

  return deepFreeze({
    status: "resolved",
    version: STUDIO_PROFESSIONAL_BRISTLE_DYNAMICS_VERSION,
    strokeId: canonical.strokeId,
    stations,
    depositions,
  } satisfies Extract<StudioProfessionalBristleResolveResult, { status: "resolved" }>);
}
