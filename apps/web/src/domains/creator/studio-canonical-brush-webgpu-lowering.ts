import {
  STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS,
  STUDIO_CANONICAL_BRUSH_PLAN_VERSION,
} from "./studio-canonical-brush-plan";

import type {
  StudioCanonicalBrushBlendMode,
  StudioCanonicalBrushPlan,
  StudioCanonicalBrushResponseCurve,
} from "./studio-canonical-brush-plan";

/**
 * Provider-neutral analytic instance contract. It deliberately does not reuse the legacy
 * `StudioGpuDab`: the legacy type cannot carry linear colour space, hardness, non-round tips or an
 * affine footprint without silently degrading the canonical recipe.
 */
export const STUDIO_CANONICAL_BRUSH_WEBGPU_LOWERING_VERSION = 1 as const;
export const STUDIO_CANONICAL_BRUSH_WEBGPU_DEFAULT_MAX_DABS = 65_536;

export type StudioCanonicalWebGpuAnalyticShape = "round" | "ellipse" | "square";
export type StudioCanonicalWebGpuPorterDuff = "source-over" | "destination-out";
export type StudioCanonicalWebGpuLinearColorSpace = "linear-srgb" | "linear-display-p3";

export interface StudioCanonicalWebGpuLinearStraightColor {
  readonly space: StudioCanonicalWebGpuLinearColorSpace;
  readonly alphaMode: "straight";
  /**
   * Scene-linear, straight RGBA. Alpha already includes colour alpha, composite opacity, the
   * pressure opacity response, base flow and the pressure flow response. A renderer premultiplies
   * this tuple exactly once immediately before source-over/destination-out compositing.
   */
  readonly components: readonly [number, number, number, number];
}

export interface StudioCanonicalWebGpuComposite {
  readonly porterDuff: StudioCanonicalWebGpuPorterDuff;
  readonly blendMode: StudioCanonicalBrushBlendMode;
}

export interface StudioCanonicalWebGpuAnalyticTip {
  readonly shape: StudioCanonicalWebGpuAnalyticShape;
  readonly hardness: number;
  readonly edgeSoftness: number;
  readonly roundness: number;
  readonly angleRadians: number;
  /**
   * Column-major local-to-document half-extent basis `[xx, xy, yx, yy]`.
   * `documentDelta = basisX * local.x + basisY * local.y` for local coordinates in `[-1, 1]`.
   * Keeping both columns preserves rotation, reflection, non-uniform scale and shear.
   */
  readonly localToDocument: readonly [number, number, number, number];
}

export interface StudioCanonicalWebGpuAnalyticDab {
  readonly index: number;
  /** Exact unscattered station after the canonical affine transform. */
  readonly stationX: number;
  readonly stationY: number;
  /** Render centre after deterministic uniform-disk scatter. */
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  /** Resolved pre-affine tip diameter, retained for diagnostics and future specialist adapters. */
  readonly diameter: number;
  readonly opacity: number;
  readonly flow: number;
  readonly color: StudioCanonicalWebGpuLinearStraightColor;
  readonly composite: StudioCanonicalWebGpuComposite;
  readonly tip: StudioCanonicalWebGpuAnalyticTip;
}

export interface StudioCanonicalWebGpuAnalyticBatch {
  readonly composite: StudioCanonicalWebGpuComposite;
  readonly colorSpace: StudioCanonicalWebGpuLinearColorSpace;
  readonly firstInstance: number;
  readonly instanceCount: number;
}

export interface LoweredStudioCanonicalBrushWebGpuDabs {
  readonly status: "lowered";
  readonly version: typeof STUDIO_CANONICAL_BRUSH_WEBGPU_LOWERING_VERSION;
  readonly strokeId: string;
  readonly dabs: readonly StudioCanonicalWebGpuAnalyticDab[];
  /** One canonical plan has one composite, so successful non-empty plans have one batch. */
  readonly batches: readonly StudioCanonicalWebGpuAnalyticBatch[];
}

export type StudioCanonicalBrushSpecialistLoweringRequirement =
  | "texture-tip"
  | "grain"
  | "wet-media"
  | "retained-dynamics"
  | "stroke-local-compositor";

export interface StudioCanonicalBrushWebGpuLoweringRequired {
  readonly status: "lowering-required";
  readonly strokeId: string;
  readonly requirements: readonly StudioCanonicalBrushSpecialistLoweringRequirement[];
}

export type StudioCanonicalBrushWebGpuLoweringRejectionReason =
  | "dab-limit-exceeded"
  | "invalid-options"
  | "invalid-plan"
  | "numeric-overflow";

export interface RejectedStudioCanonicalBrushWebGpuLowering {
  readonly status: "rejected";
  readonly reason: StudioCanonicalBrushWebGpuLoweringRejectionReason;
}

export type StudioCanonicalBrushWebGpuLoweringResult =
  | LoweredStudioCanonicalBrushWebGpuDabs
  | StudioCanonicalBrushWebGpuLoweringRequired
  | RejectedStudioCanonicalBrushWebGpuLowering;

export interface StudioCanonicalBrushWebGpuLoweringOptions {
  readonly maximumDabs?: number;
}

interface TransformedPoint {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
}

interface Station {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly tangentX: number;
  readonly tangentY: number;
}

interface Footprint {
  readonly diameter: number;
  readonly xx: number;
  readonly xy: number;
  readonly yx: number;
  readonly yy: number;
}

const TAU = Math.PI * 2;
const SCATTER_ANGLE_SALT = 0x243f_6a88;
const SCATTER_RADIUS_SALT = 0x85a3_08d3;
const MAX_CURVE_VALUE = 4;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function inRange(value: unknown, minimum: number, maximum: number): value is number {
  return finite(value) && value >= minimum && value <= maximum;
}

function unsignedSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function uint32(value: unknown): value is number {
  return unsignedSafeInteger(value) && (value as number) <= 0xffff_ffff;
}

function canonicalNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function gpuNumber(value: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) return null;
  return canonicalNumber(Math.fround(value));
}

function validCurve(value: StudioCanonicalBrushResponseCurve): boolean {
  return inRange(value?.minimum, 0, MAX_CURVE_VALUE)
    && inRange(value?.maximum, 0, MAX_CURVE_VALUE)
    && value.maximum >= value.minimum
    && inRange(value?.exponent, 0.01, 16);
}

function validPlan(plan: StudioCanonicalBrushPlan): boolean {
  try {
    const transform = plan.transform;
    const recipe = plan.recipe;
    const source = plan.source;
    const color = plan.color;
    const composite = plan.composite;
    if (
      plan.kind !== "studio-canonical-brush-plan"
      || plan.version !== STUDIO_CANONICAL_BRUSH_PLAN_VERSION
      || plan.coordinateSpace !== "document-css-px"
      || typeof plan.strokeId !== "string"
      || plan.strokeId.length === 0
      || !uint32(plan.seed)
      || transform.encoding !== "affine-f64-v1"
      || ![
        transform.m11,
        transform.m12,
        transform.m21,
        transform.m22,
        transform.translateX,
        transform.translateY,
      ].every((value) => inRange(
        value,
        -STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxCoordinateAbsolute,
        STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxCoordinateAbsolute,
      ))
      || !finite(transform.m11 * transform.m22 - transform.m12 * transform.m21)
      || Math.abs(transform.m11 * transform.m22 - transform.m12 * transform.m21) < 1e-12
      || (recipe.version !== 1 && recipe.version !== 2)
      || (recipe.engine !== "dab-v1" && recipe.engine !== "wet-media-v1")
      || !inRange(recipe.size, 0.01, STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxBrushSize)
      || !inRange(recipe.flow, 0, 1)
      || !inRange(recipe.hardness, 0, 1)
      || !inRange(
        recipe.spacingRatio,
        0.001,
        STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxSpacingRatio,
      )
      || !inRange(
        recipe.scatter?.radiusRatio,
        0,
        STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxScatterRatio,
      )
      || recipe.scatter.distribution !== "uniform-disk"
      || !inRange(recipe.angleRadians, -TAU, TAU)
      || !inRange(recipe.roundness, 0.01, 1)
      || !validCurve(recipe.pressure?.size)
      || !validCurve(recipe.pressure?.opacity)
      || !validCurve(recipe.pressure?.flow)
      || (recipe.tip.kind !== "analytic" && recipe.tip.kind !== "texture")
      || (
        recipe.tip.kind === "analytic"
        && (
          (
            recipe.tip.shape !== "round"
            && recipe.tip.shape !== "ellipse"
            && recipe.tip.shape !== "square"
          )
          || !inRange(recipe.tip.edgeSoftness, 0, 1)
        )
      )
      || (
        color.space !== "linear-srgb"
        && color.space !== "linear-display-p3"
      )
      || color.alphaMode !== "straight"
      || !Array.isArray(color.components)
      || color.components.length !== 4
      || !color.components.every((component) => inRange(component, 0, 1))
      || (
        composite.porterDuff !== "source-over"
        && composite.porterDuff !== "destination-out"
      )
      || ![
        "normal",
        "multiply",
        "screen",
        "overlay",
        "darken",
        "lighten",
      ].includes(composite.blendMode)
      || (
        composite.porterDuff === "destination-out"
        && composite.blendMode !== "normal"
      )
      || !inRange(composite.opacity, 0, 1)
      || source.encoding !== "accepted-authoritative-samples-v1"
      || !Array.isArray(source.samples)
      || source.samples.length < 1
      || source.samples.length > STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxSamples
      || !unsignedSafeInteger(source.firstSequence)
      || !unsignedSafeInteger(source.lastSequence)
    ) return false;
    if (
      recipe.version === 2
      && (
        recipe.engine !== "dab-v1"
        || (
          recipe.paint.model !== "layered-flow-v1"
          && recipe.paint.model !== "bounded-flow-v2"
        )
        || recipe.paint.depositionAlpha !== "flow-times-dab-opacity"
        || recipe.paint.accumulation !== "source-over-stroke-local-rgba"
        || recipe.paint.finalCompositeOpacity !== "plan-composite-opacity-once"
        || (
          recipe.paint.model === "layered-flow-v1"
          && (
            recipe.paint.surface !== "stroke-local-rgba"
            || recipe.retainedDynamics !== null
          )
        )
        || (
          recipe.paint.model === "bounded-flow-v2"
          && (
            recipe.paint.surface !== "bounded-sparse-rgba-tiles"
            || recipe.retainedDynamics === null
          )
        )
      )
    ) return false;

    let previousSequence = -1;
    let previousTime = -1;
    for (const sample of source.samples) {
      if (
        !unsignedSafeInteger(sample.sequence)
        || sample.sequence <= previousSequence
        || !inRange(
          sample.x,
          -STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxCoordinateAbsolute,
          STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxCoordinateAbsolute,
        )
        || !inRange(
          sample.y,
          -STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxCoordinateAbsolute,
          STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxCoordinateAbsolute,
        )
        || !inRange(sample.pressure, 0, 1)
        || !inRange(sample.tangentialPressure, -1, 1)
        || !inRange(sample.tiltX, -90, 90)
        || !inRange(sample.tiltY, -90, 90)
        || !inRange(sample.twist, 0, 360 - Number.EPSILON)
        || !inRange(sample.timeMilliseconds, 0, Number.MAX_SAFE_INTEGER)
        || sample.timeMilliseconds < previousTime
        || !unsignedSafeInteger(sample.pointerId)
        || !uint32(sample.flags)
      ) return false;
      previousSequence = sample.sequence;
      previousTime = sample.timeMilliseconds;
    }
    return source.firstSequence === source.samples[0]!.sequence
      && source.lastSequence === source.samples.at(-1)!.sequence;
  } catch {
    return false;
  }
}

function specialistRequirements(
  plan: StudioCanonicalBrushPlan,
): StudioCanonicalBrushSpecialistLoweringRequirement[] {
  const requirements: StudioCanonicalBrushSpecialistLoweringRequirement[] = [];
  if (plan.recipe.tip.kind === "texture") requirements.push("texture-tip");
  if (plan.recipe.grain !== null) requirements.push("grain");
  if (plan.recipe.engine === "wet-media-v1" || plan.recipe.wetMedia !== null) {
    requirements.push("wet-media");
  }
  if (plan.recipe.version === 2) {
    if (plan.recipe.retainedDynamics !== null) requirements.push("retained-dynamics");
    requirements.push("stroke-local-compositor");
  }
  return requirements;
}

function transformVector(
  plan: StudioCanonicalBrushPlan,
  x: number,
  y: number,
): readonly [number, number] {
  return [
    plan.transform.m11 * x + plan.transform.m21 * y,
    plan.transform.m12 * x + plan.transform.m22 * y,
  ];
}

function transformPoints(plan: StudioCanonicalBrushPlan): TransformedPoint[] | null {
  const points: TransformedPoint[] = [];
  for (const sample of plan.source.samples) {
    const [linearX, linearY] = transformVector(plan, sample.x, sample.y);
    const x = linearX + plan.transform.translateX;
    const y = linearY + plan.transform.translateY;
    if (gpuNumber(x) === null || gpuNumber(y) === null) return null;
    const previous = points.at(-1);
    if (previous && x === previous.x && y === previous.y) {
      points[points.length - 1] = { x, y, pressure: sample.pressure };
    } else {
      points.push({ x, y, pressure: sample.pressure });
    }
  }
  return points;
}

function response(curve: StudioCanonicalBrushResponseCurve, pressure: number): number {
  return curve.minimum
    + (curve.maximum - curve.minimum) * Math.pow(pressure, curve.exponent);
}

function footprint(
  plan: StudioCanonicalBrushPlan,
  pressure: number,
): Footprint | null {
  const diameter = plan.recipe.size * response(plan.recipe.pressure.size, pressure);
  const radius = diameter / 2;
  const cosine = Math.cos(plan.recipe.angleRadians);
  const sine = Math.sin(plan.recipe.angleRadians);
  const [xx, xy] = transformVector(plan, cosine * radius, sine * radius);
  const [yx, yy] = transformVector(
    plan,
    -sine * radius * plan.recipe.roundness,
    cosine * radius * plan.recipe.roundness,
  );
  if (![diameter, xx, xy, yx, yy].every(finite)) return null;
  return { diameter, xx, xy, yx, yy };
}

function seededUnit(seed: number, dabIndex: number, salt: number): number {
  let value = (
    seed
    ^ Math.imul((dabIndex + 1) >>> 0, 0x9e37_79b1)
    ^ salt
  ) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb_352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846c_a68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}

function spacingFor(
  shape: StudioCanonicalWebGpuAnalyticShape,
  footprintValue: Footprint,
  tangentX: number,
  tangentY: number,
  spacingRatio: number,
): number {
  const alongX = tangentX * footprintValue.xx + tangentY * footprintValue.xy;
  const alongY = tangentX * footprintValue.yx + tangentY * footprintValue.yy;
  const halfExtent = shape === "square"
    ? Math.abs(alongX) + Math.abs(alongY)
    : Math.hypot(alongX, alongY);
  return halfExtent * 2 * spacingRatio;
}

function makeStation(
  points: readonly TransformedPoint[],
  cumulative: Float64Array,
  totalLength: number,
  distance: number,
  cursor: { upper: number },
): Station {
  if (points.length === 1 || totalLength === 0) {
    return {
      x: points[0]!.x,
      y: points[0]!.y,
      pressure: points[0]!.pressure,
      tangentX: 1,
      tangentY: 0,
    };
  }
  if (distance === totalLength) cursor.upper = points.length - 1;
  else {
    while (
      cursor.upper < points.length - 1
      && cumulative[cursor.upper]! < distance
    ) cursor.upper += 1;
  }
  const lower = cursor.upper - 1;
  const start = points[lower]!;
  const end = points[cursor.upper]!;
  const segmentStart = cumulative[lower]!;
  const segmentLength = cumulative[cursor.upper]! - segmentStart;
  const amount = segmentLength === 0 ? 0 : (distance - segmentStart) / segmentLength;
  return {
    x: distance === totalLength ? points.at(-1)!.x : start.x + (end.x - start.x) * amount,
    y: distance === totalLength ? points.at(-1)!.y : start.y + (end.y - start.y) * amount,
    pressure: distance === totalLength
      ? points.at(-1)!.pressure
      : start.pressure + (end.pressure - start.pressure) * amount,
    tangentX: (end.x - start.x) / segmentLength,
    tangentY: (end.y - start.y) / segmentLength,
  };
}

function freezeResult<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeResult(child);
  return Object.freeze(value);
}

/**
 * Deterministically lowers one complete canonical plan. The function owns no append/chunk state:
 * live, commit, recovery and replay callers passing the same plan receive the same instance order.
 */
export function lowerStudioCanonicalBrushPlanToWebGpuDabs(
  plan: StudioCanonicalBrushPlan,
  options: StudioCanonicalBrushWebGpuLoweringOptions = {},
): StudioCanonicalBrushWebGpuLoweringResult {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    return { status: "rejected", reason: "invalid-options" };
  }
  const maximumDabs = options.maximumDabs
    ?? STUDIO_CANONICAL_BRUSH_WEBGPU_DEFAULT_MAX_DABS;
  if (
    !Number.isSafeInteger(maximumDabs)
    || maximumDabs < 1
    || maximumDabs > STUDIO_CANONICAL_BRUSH_WEBGPU_DEFAULT_MAX_DABS
  ) {
    return { status: "rejected", reason: "invalid-options" };
  }
  if (!validPlan(plan)) return { status: "rejected", reason: "invalid-plan" };

  const requirements = specialistRequirements(plan);
  if (requirements.length > 0) {
    return freezeResult({
      status: "lowering-required",
      strokeId: plan.strokeId,
      requirements,
    });
  }
  if (plan.recipe.tip.kind !== "analytic") {
    return { status: "rejected", reason: "invalid-plan" };
  }

  const points = transformPoints(plan);
  if (!points || points.length === 0) {
    return { status: "rejected", reason: "numeric-overflow" };
  }
  const cumulative = new Float64Array(points.length);
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const segmentLength = Math.hypot(current.x - previous.x, current.y - previous.y);
    const next = cumulative[index - 1]! + segmentLength;
    if (!Number.isFinite(segmentLength) || !Number.isFinite(next) || next <= cumulative[index - 1]!) {
      return { status: "rejected", reason: "numeric-overflow" };
    }
    cumulative[index] = next;
  }
  const totalLength = cumulative.at(-1) ?? 0;
  const distances: number[] = [0];
  const cursor = { upper: 1 };
  while (totalLength > 0 && distances.at(-1)! < totalLength) {
    const currentDistance = distances.at(-1)!;
    const station = makeStation(points, cumulative, totalLength, currentDistance, cursor);
    const currentFootprint = footprint(plan, station.pressure);
    if (!currentFootprint) return { status: "rejected", reason: "numeric-overflow" };
    const spacing = spacingFor(
      plan.recipe.tip.shape,
      currentFootprint,
      station.tangentX,
      station.tangentY,
      plan.recipe.spacingRatio,
    );
    if (!Number.isFinite(spacing) || spacing <= 0) {
      return { status: "rejected", reason: "numeric-overflow" };
    }
    const naturalNext = currentDistance + spacing;
    if (!Number.isFinite(naturalNext) || naturalNext <= currentDistance) {
      return { status: "rejected", reason: "numeric-overflow" };
    }
    if (distances.length >= maximumDabs) {
      return { status: "rejected", reason: "dab-limit-exceeded" };
    }
    distances.push(naturalNext >= totalLength ? totalLength : naturalNext);
  }

  cursor.upper = 1;
  const composite: StudioCanonicalWebGpuComposite = {
    porterDuff: plan.composite.porterDuff,
    blendMode: plan.composite.blendMode,
  };
  const dabs: StudioCanonicalWebGpuAnalyticDab[] = [];
  for (let index = 0; index < distances.length; index += 1) {
    const station = makeStation(points, cumulative, totalLength, distances[index]!, cursor);
    const resolvedFootprint = footprint(plan, station.pressure);
    if (!resolvedFootprint) return { status: "rejected", reason: "numeric-overflow" };

    const scatterAngle = seededUnit(plan.seed, index, SCATTER_ANGLE_SALT) * TAU;
    const scatterDistance = Math.sqrt(
      seededUnit(plan.seed, index, SCATTER_RADIUS_SALT),
    ) * resolvedFootprint.diameter * plan.recipe.scatter.radiusRatio;
    const [scatterX, scatterY] = transformVector(
      plan,
      Math.cos(scatterAngle) * scatterDistance,
      Math.sin(scatterAngle) * scatterDistance,
    );
    const opacity = plan.composite.opacity
      * response(plan.recipe.pressure.opacity, station.pressure);
    const flow = plan.recipe.flow
      * response(plan.recipe.pressure.flow, station.pressure);
    const sourceAlpha = Math.min(1, Math.max(
      0,
      plan.color.components[3] * opacity * flow,
    ));
    const numericValues = [
      station.x,
      station.y,
      station.x + scatterX,
      station.y + scatterY,
      station.pressure,
      resolvedFootprint.diameter,
      opacity,
      flow,
      resolvedFootprint.xx,
      resolvedFootprint.xy,
      resolvedFootprint.yx,
      resolvedFootprint.yy,
      sourceAlpha,
    ].map(gpuNumber);
    if (numericValues.some((value) => value === null)) {
      return { status: "rejected", reason: "numeric-overflow" };
    }
    const [
      stationX,
      stationY,
      x,
      y,
      pressure,
      diameter,
      gpuOpacity,
      gpuFlow,
      xx,
      xy,
      yx,
      yy,
      alpha,
    ] = numericValues as number[];
    dabs.push({
      index,
      stationX,
      stationY,
      x,
      y,
      pressure,
      diameter,
      opacity: gpuOpacity,
      flow: gpuFlow,
      color: {
        space: plan.color.space,
        alphaMode: "straight",
        components: [
          gpuNumber(plan.color.components[0])!,
          gpuNumber(plan.color.components[1])!,
          gpuNumber(plan.color.components[2])!,
          alpha,
        ],
      },
      composite,
      tip: {
        shape: plan.recipe.tip.shape,
        hardness: gpuNumber(plan.recipe.hardness)!,
        edgeSoftness: gpuNumber(plan.recipe.tip.edgeSoftness)!,
        roundness: gpuNumber(plan.recipe.roundness)!,
        angleRadians: gpuNumber(plan.recipe.angleRadians)!,
        localToDocument: [xx, xy, yx, yy],
      },
    });
  }

  return freezeResult({
    status: "lowered",
    version: STUDIO_CANONICAL_BRUSH_WEBGPU_LOWERING_VERSION,
    strokeId: plan.strokeId,
    dabs,
    batches: dabs.length === 0
      ? []
      : [{
          composite,
          colorSpace: plan.color.space,
          firstInstance: 0,
          instanceCount: dabs.length,
        }],
  });
}
