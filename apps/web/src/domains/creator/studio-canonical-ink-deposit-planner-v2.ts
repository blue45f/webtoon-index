import type {
  StudioStrokeCurvePlanV2,
  StudioStrokeCurveStationV2,
} from "./brush/studio-stroke-curve-resampler-v2";

/**
 * Renderer-neutral analytic ink deposition for Studio stroke v2.
 *
 * The planner consumes only the deterministic curve stations and a complete ink recipe. Canvas,
 * WebGPU and replay backends can therefore share one deposit order, pressure response, footprint
 * and composite contract. Settled and replaceable preview deposits never share an output array.
 */

export const STUDIO_CANONICAL_INK_DEPOSIT_PLAN_V2_VERSION = 2 as const;

export const STUDIO_CANONICAL_INK_DEPOSIT_PLAN_V2_BUDGETS = Object.freeze({
  maxDeposits: 262_144,
  maxBrushSize: 65_536,
  maxSpacingRatio: 64,
  maxMinimumSpacing: 1_024,
} as const);

export interface StudioCanonicalInkResponseCurveV2 {
  readonly minimum: number;
  readonly maximum: number;
  readonly exponent: number;
}

export interface StudioCanonicalInkRecipeV2 {
  readonly version: typeof STUDIO_CANONICAL_INK_DEPOSIT_PLAN_V2_VERSION;
  readonly brushId: string;
  readonly size: number;
  readonly opacity: number;
  readonly flow: number;
  /** Arc-length step as a ratio of the pressure-resolved diameter. */
  readonly spacingRatio: number;
  /** Positive floor used by a zero-pressure or sub-pixel footprint. */
  readonly minimumSpacing: number;
  readonly roundness: number;
  /** Added to the local curve tangent. */
  readonly angleOffsetRadians: number;
  readonly pressure: Readonly<{
    size: StudioCanonicalInkResponseCurveV2;
    opacity: StudioCanonicalInkResponseCurveV2;
    flow: StudioCanonicalInkResponseCurveV2;
  }>;
  readonly composite: Readonly<{
    porterDuff: "source-over" | "destination-out";
    blendMode: "normal";
  }>;
}

export interface StudioCanonicalAnalyticInkDepositV2 {
  readonly ordinal: number;
  readonly distance: number;
  readonly source: "settled" | "preview";
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly diameter: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly roundness: number;
  readonly angleRadians: number;
  readonly tangentX: number;
  readonly tangentY: number;
  readonly opacity: number;
  readonly flow: number;
  /** Straight source alpha before a renderer applies tip coverage. */
  readonly sourceAlpha: number;
  readonly timeMilliseconds: number;
  readonly fromSequence: number;
  readonly toSequence: number;
  readonly composite: StudioCanonicalInkRecipeV2["composite"];
}

export interface StudioCanonicalInkDepositPlanV2 {
  readonly kind: "studio-canonical-ink-deposit-plan";
  readonly version: typeof STUDIO_CANONICAL_INK_DEPOSIT_PLAN_V2_VERSION;
  readonly strokeId: string;
  readonly brushId: string;
  readonly recipe: StudioCanonicalInkRecipeV2;
  readonly settledDeposits: readonly StudioCanonicalAnalyticInkDepositV2[];
  readonly previewDeposits: readonly StudioCanonicalAnalyticInkDepositV2[];
  readonly nextDepositDistance: number;
  readonly complete: true;
}

export type StudioCanonicalInkDepositPlanFailureReasonV2 =
  | "budget-exceeded"
  | "invalid-curve"
  | "invalid-options"
  | "invalid-recipe"
  | "numeric-overflow";

export type StudioCanonicalInkDepositPlanResultV2 =
  | Readonly<{ ok: true; value: StudioCanonicalInkDepositPlanV2 }>
  | Readonly<{
      ok: false;
      reason: StudioCanonicalInkDepositPlanFailureReasonV2;
    }>;

export interface StudioCanonicalInkDepositPlanOptionsV2 {
  readonly maximumDeposits?: number;
}

interface SampledCurve {
  readonly station: StudioStrokeCurveStationV2;
  readonly tangentX: number;
  readonly tangentY: number;
}

const EPSILON = 1e-9;
const TAU = Math.PI * 2;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function validResponse(value: StudioCanonicalInkResponseCurveV2): boolean {
  return finiteInRange(value?.minimum, 0, 4)
    && finiteInRange(value?.maximum, 0, 4)
    && value.maximum >= value.minimum
    && finiteInRange(value?.exponent, 0.01, 16);
}

function validRecipe(value: StudioCanonicalInkRecipeV2): boolean {
  return value?.version === STUDIO_CANONICAL_INK_DEPOSIT_PLAN_V2_VERSION
    && typeof value.brushId === "string"
    && value.brushId.length > 0
    && value.brushId.length <= 128
    && finiteInRange(
      value.size,
      0.01,
      STUDIO_CANONICAL_INK_DEPOSIT_PLAN_V2_BUDGETS.maxBrushSize,
    )
    && finiteInRange(value.opacity, 0, 1)
    && finiteInRange(value.flow, 0, 1)
    && finiteInRange(
      value.spacingRatio,
      0.001,
      STUDIO_CANONICAL_INK_DEPOSIT_PLAN_V2_BUDGETS.maxSpacingRatio,
    )
    && finiteInRange(
      value.minimumSpacing,
      0.001,
      STUDIO_CANONICAL_INK_DEPOSIT_PLAN_V2_BUDGETS.maxMinimumSpacing,
    )
    && finiteInRange(value.roundness, 0.01, 1)
    && finiteInRange(value.angleOffsetRadians, -TAU, TAU)
    && validResponse(value.pressure?.size)
    && validResponse(value.pressure?.opacity)
    && validResponse(value.pressure?.flow)
    && (
      value.composite?.porterDuff === "source-over"
      || value.composite?.porterDuff === "destination-out"
    )
    && value.composite.blendMode === "normal";
}

function stationIsValid(station: StudioStrokeCurveStationV2): boolean {
  return finiteInRange(station.distance, 0, Number.MAX_SAFE_INTEGER)
    && Number.isFinite(station.x)
    && Number.isFinite(station.y)
    && finiteInRange(station.pressure, 0, 1)
    && finiteInRange(station.timeMilliseconds, 0, Number.MAX_SAFE_INTEGER)
    && Number.isSafeInteger(station.fromSequence)
    && station.fromSequence >= 0
    && Number.isSafeInteger(station.toSequence)
    && station.toSequence >= station.fromSequence;
}

function stationsAreStrictlyOrdered(
  stations: readonly StudioStrokeCurveStationV2[],
): boolean {
  let previousDistance = -1;
  for (const station of stations) {
    if (!stationIsValid(station) || station.distance <= previousDistance) return false;
    previousDistance = station.distance;
  }
  return true;
}

function curveIsValid(curve: StudioStrokeCurvePlanV2): boolean {
  if (
    curve?.kind !== "studio-stroke-curve-plan"
    || curve.version !== 2
    || typeof curve.strokeId !== "string"
    || curve.strokeId.length === 0
    || !Array.isArray(curve.settledStations)
    || !Array.isArray(curve.previewStations)
    || curve.settledStations.length === 0
    || !stationsAreStrictlyOrdered(curve.settledStations)
    || !stationsAreStrictlyOrdered(curve.previewStations)
  ) return false;
  const settledLast = curve.settledStations.at(-1)!;
  const previewFirst = curve.previewStations[0];
  return !previewFirst || previewFirst.distance > settledLast.distance;
}

function response(
  curve: StudioCanonicalInkResponseCurveV2,
  pressure: number,
): number {
  return curve.minimum
    + (curve.maximum - curve.minimum) * Math.pow(pressure, curve.exponent);
}

function normalizeAngle(value: number): number {
  const wrapped = ((value + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

function interpolateStation(
  from: StudioStrokeCurveStationV2,
  to: StudioStrokeCurveStationV2,
  distance: number,
): StudioStrokeCurveStationV2 {
  const span = to.distance - from.distance;
  const amount = span <= EPSILON ? 0 : clamp((distance - from.distance) / span, 0, 1);
  const interpolate = (left: number, right: number): number =>
    left + (right - left) * amount;
  return Object.freeze({
    ...to,
    distance,
    parameter: interpolate(from.parameter, to.parameter),
    x: interpolate(from.x, to.x),
    y: interpolate(from.y, to.y),
    pressure: interpolate(from.pressure, to.pressure),
    tangentialPressure: interpolate(
      from.tangentialPressure,
      to.tangentialPressure,
    ),
    tiltX: interpolate(from.tiltX, to.tiltX),
    tiltY: interpolate(from.tiltY, to.tiltY),
    timeMilliseconds: interpolate(from.timeMilliseconds, to.timeMilliseconds),
    sourceTimeMilliseconds: interpolate(
      from.sourceTimeMilliseconds,
      to.sourceTimeMilliseconds,
    ),
    fromSequence: from.fromSequence,
    toSequence: to.toSequence,
  });
}

function sampledCurveAt(
  stations: readonly StudioStrokeCurveStationV2[],
  distance: number,
): SampledCurve | null {
  if (stations.length === 0) return null;
  if (stations.length === 1) {
    return { station: stations[0]!, tangentX: 1, tangentY: 0 };
  }
  let upper = 1;
  while (upper < stations.length && stations[upper]!.distance < distance) {
    upper += 1;
  }
  upper = Math.min(upper, stations.length - 1);
  let lower = upper - 1;
  if (distance >= stations.at(-1)!.distance) {
    lower = stations.length - 2;
    upper = stations.length - 1;
  }
  const from = stations[lower]!;
  const to = stations[upper]!;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const tangentX = length <= EPSILON ? 1 : dx / length;
  const tangentY = length <= EPSILON ? 0 : dy / length;
  return {
    station: interpolateStation(from, to, distance),
    tangentX,
    tangentY,
  };
}

function depositAt(
  sampled: SampledCurve,
  distance: number,
  ordinal: number,
  source: "settled" | "preview",
  recipe: StudioCanonicalInkRecipeV2,
): StudioCanonicalAnalyticInkDepositV2 | null {
  const pressure = sampled.station.pressure;
  const diameter = recipe.size * response(recipe.pressure.size, pressure);
  const opacity = recipe.opacity * response(recipe.pressure.opacity, pressure);
  const flow = recipe.flow * response(recipe.pressure.flow, pressure);
  const sourceAlpha = clamp(opacity * flow, 0, 1);
  const angleRadians = normalizeAngle(
    Math.atan2(sampled.tangentY, sampled.tangentX)
      + recipe.angleOffsetRadians,
  );
  const numeric = [
    distance,
    sampled.station.x,
    sampled.station.y,
    pressure,
    diameter,
    opacity,
    flow,
    sourceAlpha,
    angleRadians,
    sampled.tangentX,
    sampled.tangentY,
    sampled.station.timeMilliseconds,
  ];
  if (!numeric.every(Number.isFinite) || diameter < 0) return null;
  return Object.freeze({
    ordinal,
    distance,
    source,
    x: sampled.station.x,
    y: sampled.station.y,
    pressure,
    diameter,
    radiusX: diameter / 2,
    radiusY: diameter * recipe.roundness / 2,
    roundness: recipe.roundness,
    angleRadians,
    tangentX: sampled.tangentX,
    tangentY: sampled.tangentY,
    opacity,
    flow,
    sourceAlpha,
    timeMilliseconds: sampled.station.timeMilliseconds,
    fromSequence: sampled.station.fromSequence,
    toSequence: sampled.station.toSequence,
    composite: recipe.composite,
  });
}

function nextDistance(
  current: StudioCanonicalAnalyticInkDepositV2,
  recipe: StudioCanonicalInkRecipeV2,
): number {
  return current.distance + Math.max(
    recipe.minimumSpacing,
    current.diameter * recipe.spacingRatio,
  );
}

function failed(
  reason: StudioCanonicalInkDepositPlanFailureReasonV2,
): StudioCanonicalInkDepositPlanResultV2 {
  return Object.freeze({ ok: false, reason });
}

export function planStudioCanonicalInkDepositsV2(
  curve: StudioStrokeCurvePlanV2,
  recipe: StudioCanonicalInkRecipeV2,
  options: StudioCanonicalInkDepositPlanOptionsV2 = {},
): StudioCanonicalInkDepositPlanResultV2 {
  try {
    if (!curveIsValid(curve)) return failed("invalid-curve");
    if (!validRecipe(recipe)) return failed("invalid-recipe");
    const maximumDeposits = options.maximumDeposits
      ?? STUDIO_CANONICAL_INK_DEPOSIT_PLAN_V2_BUDGETS.maxDeposits;
    if (
      !Number.isInteger(maximumDeposits)
      || maximumDeposits < 1
      || maximumDeposits
        > STUDIO_CANONICAL_INK_DEPOSIT_PLAN_V2_BUDGETS.maxDeposits
    ) return failed("invalid-options");

    const settledStations = curve.settledStations;
    const allStations = curve.previewStations.length === 0
      ? settledStations
      : [...settledStations, ...curve.previewStations];
    const settledLimit = settledStations.at(-1)!.distance;
    const totalLimit = allStations.at(-1)!.distance;
    const settledDeposits: StudioCanonicalAnalyticInkDepositV2[] = [];
    const previewDeposits: StudioCanonicalAnalyticInkDepositV2[] = [];

    let distance = 0;
    let ordinal = 0;
    while (distance <= settledLimit + EPSILON) {
      if (ordinal >= maximumDeposits) return failed("budget-exceeded");
      const sampled = sampledCurveAt(settledStations, distance);
      if (!sampled) return failed("numeric-overflow");
      const deposit = depositAt(sampled, distance, ordinal, "settled", recipe);
      if (!deposit) return failed("numeric-overflow");
      settledDeposits.push(deposit);
      const next = nextDistance(deposit, recipe);
      if (!Number.isFinite(next) || next <= distance) {
        return failed("numeric-overflow");
      }
      distance = next;
      ordinal += 1;
    }

    while (distance <= totalLimit + EPSILON) {
      if (ordinal >= maximumDeposits) return failed("budget-exceeded");
      const sampled = sampledCurveAt(allStations, distance);
      if (!sampled) return failed("numeric-overflow");
      const deposit = depositAt(sampled, distance, ordinal, "preview", recipe);
      if (!deposit) return failed("numeric-overflow");
      previewDeposits.push(deposit);
      const next = nextDistance(deposit, recipe);
      if (!Number.isFinite(next) || next <= distance) {
        return failed("numeric-overflow");
      }
      distance = next;
      ordinal += 1;
    }

    const frozenRecipe = Object.freeze({
      ...recipe,
      pressure: Object.freeze({
        size: Object.freeze({ ...recipe.pressure.size }),
        opacity: Object.freeze({ ...recipe.pressure.opacity }),
        flow: Object.freeze({ ...recipe.pressure.flow }),
      }),
      composite: Object.freeze({ ...recipe.composite }),
    });
    const value: StudioCanonicalInkDepositPlanV2 = Object.freeze({
      kind: "studio-canonical-ink-deposit-plan",
      version: STUDIO_CANONICAL_INK_DEPOSIT_PLAN_V2_VERSION,
      strokeId: curve.strokeId,
      brushId: recipe.brushId,
      recipe: frozenRecipe,
      settledDeposits: Object.freeze(settledDeposits),
      previewDeposits: Object.freeze(previewDeposits),
      nextDepositDistance: distance,
      complete: true,
    });
    return Object.freeze({ ok: true, value });
  } catch {
    return failed("invalid-curve");
  }
}
