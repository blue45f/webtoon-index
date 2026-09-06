import {
  STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS,
  STUDIO_CANONICAL_BRUSH_PLAN_VERSION,
} from "./studio-canonical-brush-plan";
import {
  STUDIO_PROFESSIONAL_BRUSH_DYNAMICS_VERSION,
  parseStudioProfessionalBrushDynamicsPlan,
  resolveStudioProfessionalBrushDynamics,
} from "./studio-professional-brush-dynamics";

import type {
  StudioEngineWebGpuBrushPlan,
} from "./render/studio-engine-webgpu-brush-runtime";
import type {
  StudioCanonicalBrushPlan,
} from "./studio-canonical-brush-plan";
import type {
  StudioCanonicalWebGpuAnalyticBatch,
  StudioCanonicalWebGpuAnalyticDab,
  StudioCanonicalWebGpuComposite,
} from "./studio-canonical-brush-webgpu-lowering";
import type {
  StudioProfessionalBrushDynamicsPlan,
  StudioProfessionalBrushResolveProgress,
} from "./studio-professional-brush-dynamics";

/**
 * Clean lowering boundary between the independently implemented professional dynamics plan and
 * the current rich RGBA16F analytic WebGPU runtime. It never approximates specialist texture,
 * grain, wet-media, gamut or blend paths.
 */
export const STUDIO_PROFESSIONAL_BRUSH_WEBGPU_LOWERING_VERSION = 1 as const;
export const STUDIO_PROFESSIONAL_BRUSH_WEBGPU_DEFAULT_MAX_DABS = 65_536;
export const STUDIO_PROFESSIONAL_BRUSH_WEBGPU_DEFAULT_MAX_COORDINATE_ABSOLUTE =
  STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxCoordinateAbsolute;

export interface StudioProfessionalBrushWebGpuLoweringOptions {
  readonly mode?: "append" | "rebuild";
  readonly maximumDabs?: number;
  readonly maximumCoordinateAbsolute?: number;
  readonly signal?: AbortSignal;
  readonly shouldCancel?: (progress: StudioProfessionalBrushResolveProgress) => boolean;
}

export type StudioProfessionalBrushWebGpuUnsupportedReason =
  | "texture-tip"
  | "grain"
  | "wet-media"
  | "texture-depth"
  | "unsupported-blend-mode"
  | "unsupported-color-space";

export type StudioProfessionalBrushWebGpuRejectionReason =
  | "invalid-options"
  | "invalid-canonical-plan"
  | "invalid-dynamics-plan"
  | "sample-clock-mismatch"
  | "dynamics-rejected"
  | "dab-limit-exceeded"
  | "coordinate-budget-exceeded"
  | "numeric-overflow";

export type StudioProfessionalBrushWebGpuLoweringResult =
  | Readonly<{
      status: "ready";
      plan: StudioEngineWebGpuBrushPlan;
    }>
  | Readonly<{
      status: "unsupported";
      reason: StudioProfessionalBrushWebGpuUnsupportedReason;
      detail?: string;
    }>
  | Readonly<{
      status: "rejected";
      reason: StudioProfessionalBrushWebGpuRejectionReason;
      path?: string;
    }>
  | Readonly<{
      status: "cancelled";
      processedSamples: number;
      emittedEvents: number;
    }>;

const UINT32_MAX = 0xffff_ffff;
const SCATTER_ANGLE_SALT = 0xa341_316c;
const SCATTER_RADIUS_SALT = 0xc801_3ea4;
const TAU = Math.PI * 2;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function inRange(value: unknown, minimum: number, maximum: number): value is number {
  return finite(value) && value >= minimum && value <= maximum;
}

function unsignedSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function uint32(value: unknown): value is number {
  return unsignedSafeInteger(value) && (value as number) <= UINT32_MAX;
}

function gpuNumber(value: number): number | null {
  const rounded = Math.fround(value);
  if (!Number.isFinite(value) || !Number.isFinite(rounded)) return null;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

type StrictRecord = Readonly<Record<string, unknown>>;

function strictFrozenRecord(
  input: unknown,
  expectedKeys: readonly string[],
): StrictRecord | null {
  try {
    if (
      typeof input !== "object"
      || input === null
      || Array.isArray(input)
      || !Object.isFrozen(input)
    ) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(input).length !== 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input) as unknown as Record<
      string,
      PropertyDescriptor
    >;
    const actualKeys = Object.keys(descriptors);
    if (
      actualKeys.length !== expectedKeys.length
      || actualKeys.some((key) => !expectedKeys.includes(key))
    ) return null;
    const result: Record<string, unknown> = {};
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

function strictFrozenArray(input: unknown, maximumLength: number): readonly unknown[] | null {
  try {
    if (
      !Array.isArray(input)
      || !Object.isFrozen(input)
      || Object.getPrototypeOf(input) !== Array.prototype
      || input.length > maximumLength
      || Object.getOwnPropertySymbols(input).length !== 0
    ) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input) as unknown as Record<
      string,
      PropertyDescriptor
    >;
    if (
      Object.keys(descriptors).some(
        (key) => key !== "length" && !/^(0|[1-9]\d*)$/.test(key),
      )
    ) return null;
    const result: unknown[] = [];
    for (let index = 0; index < input.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
      result.push(descriptor.value);
    }
    return result;
  } catch {
    return null;
  }
}

function identifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxIdentifierCharacters;
}

function contentHash(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 12
    && value.length <= 128
    && /^[A-Za-z0-9:+_-]+$/.test(value);
}

function validResponseCurve(input: unknown): boolean {
  const curve = strictFrozenRecord(input, ["minimum", "maximum", "exponent"]);
  return curve !== null
    && inRange(curve.minimum, 0, 4)
    && inRange(curve.maximum, 0, 4)
    && curve.maximum >= curve.minimum
    && inRange(curve.exponent, 0.01, 16);
}

function validPressure(input: unknown): boolean {
  const pressure = strictFrozenRecord(input, ["size", "opacity", "flow"]);
  return pressure !== null
    && validResponseCurve(pressure.size)
    && validResponseCurve(pressure.opacity)
    && validResponseCurve(pressure.flow);
}

function validTip(input: unknown): boolean {
  const analytic = strictFrozenRecord(input, ["kind", "shape", "edgeSoftness"]);
  if (analytic?.kind === "analytic") {
    return (
      analytic.shape === "round"
      || analytic.shape === "ellipse"
      || analytic.shape === "square"
    ) && inRange(analytic.edgeSoftness, 0, 1);
  }
  const texture = strictFrozenRecord(
    input,
    ["kind", "assetId", "contentHash", "channel", "width", "height"],
  );
  return texture?.kind === "texture"
    && identifier(texture.assetId)
    && contentHash(texture.contentHash)
    && (texture.channel === "alpha" || texture.channel === "luminance")
    && positiveSafeInteger(texture.width)
    && texture.width <= STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxTextureDimension
    && positiveSafeInteger(texture.height)
    && texture.height <= STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxTextureDimension;
}

function validGrain(input: unknown): boolean {
  if (input === null) return true;
  const grain = strictFrozenRecord(input, [
    "kind",
    "assetId",
    "contentHash",
    "space",
    "scale",
    "depth",
    "contrast",
    "seed",
  ]);
  if (!grain) return false;
  const validIdentity = grain.kind === "texture"
    ? identifier(grain.assetId) && contentHash(grain.contentHash)
    : grain.kind === "procedural-noise"
      && grain.assetId === null
      && grain.contentHash === null;
  return validIdentity
    && (grain.space === "document" || grain.space === "stroke")
    && inRange(grain.scale, 0.01, 65_536)
    && inRange(grain.depth, 0, 1)
    && inRange(grain.contrast, 0, 1)
    && uint32(grain.seed);
}

const WET_MEDIA_KEYS = [
  "model",
  "fieldScale",
  "fixedRateHz",
  "simulationSteps",
  "absorption",
  "bleed",
  "dryingRate",
  "edgeDarkening",
  "fixationRate",
  "granulation",
  "paperRoughness",
  "pigmentLoad",
  "waterLoad",
  "wetnessLoad",
] as const;

function validWetMedia(input: unknown): boolean {
  if (input === null) return true;
  const wet = strictFrozenRecord(input, WET_MEDIA_KEYS);
  return wet !== null
    && wet.model === "pigment-water-v1"
    && positiveSafeInteger(wet.fieldScale)
    && wet.fieldScale <= STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxWetFieldScale
    && inRange(wet.fixedRateHz, 1, 2_000)
    && positiveSafeInteger(wet.simulationSteps)
    && wet.simulationSteps <= STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxWetSimulationSteps
    && WET_MEDIA_KEYS.slice(4).every((key) => inRange(wet[key], 0, 4));
}

function validRecipe(input: unknown): boolean {
  const recipe = strictFrozenRecord(input, [
    "version",
    "brushId",
    "engine",
    "material",
    "tip",
    "size",
    "flow",
    "hardness",
    "spacingRatio",
    "scatter",
    "angleRadians",
    "roundness",
    "pressure",
    "grain",
    "wetMedia",
  ]);
  if (!recipe) return false;
  const scatter = strictFrozenRecord(recipe.scatter, ["radiusRatio", "distribution"]);
  const wetRelationship =
    (recipe.engine === "wet-media-v1") === (recipe.wetMedia !== null)
    && (recipe.wetMedia === null || recipe.material === "pigment");
  return recipe.version === 1
    && identifier(recipe.brushId)
    && (recipe.engine === "dab-v1" || recipe.engine === "wet-media-v1")
    && (
      recipe.material === "ink"
      || recipe.material === "graphite"
      || recipe.material === "marker"
      || recipe.material === "air"
      || recipe.material === "pigment"
      || recipe.material === "eraser"
    )
    && validTip(recipe.tip)
    && inRange(recipe.size, 0.01, STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxBrushSize)
    && inRange(recipe.flow, 0, 1)
    && inRange(recipe.hardness, 0, 1)
    && inRange(
      recipe.spacingRatio,
      0.001,
      STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxSpacingRatio,
    )
    && scatter !== null
    && inRange(
      scatter.radiusRatio,
      0,
      STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxScatterRatio,
    )
    && scatter.distribution === "uniform-disk"
    && inRange(recipe.angleRadians, -TAU, TAU)
    && inRange(recipe.roundness, 0.01, 1)
    && validPressure(recipe.pressure)
    && validGrain(recipe.grain)
    && validWetMedia(recipe.wetMedia)
    && wetRelationship;
}

function validSource(input: unknown): boolean {
  const source = strictFrozenRecord(input, [
    "encoding",
    "firstSequence",
    "lastSequence",
    "samples",
  ]);
  if (
    !source
    || source.encoding !== "accepted-authoritative-samples-v1"
    || !unsignedSafeInteger(source.firstSequence)
    || !unsignedSafeInteger(source.lastSequence)
  ) return false;
  const samples = strictFrozenArray(
    source.samples,
    STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxSamples,
  );
  if (!samples || samples.length === 0) return false;
  let previousSequence = -1;
  let previousTime = -1;
  for (const inputSample of samples) {
    const sample = strictFrozenRecord(inputSample, [
      "sequence",
      "x",
      "y",
      "pressure",
      "tangentialPressure",
      "tiltX",
      "tiltY",
      "twist",
      "timeMilliseconds",
      "pointerId",
      "flags",
    ]);
    if (
      !sample
      || !unsignedSafeInteger(sample.sequence)
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
      || !inRange(
        sample.timeMilliseconds,
        0,
        STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxTimeMilliseconds,
      )
      || sample.timeMilliseconds < previousTime
      || !unsignedSafeInteger(sample.pointerId)
      || !uint32(sample.flags)
    ) return false;
    previousSequence = sample.sequence;
    previousTime = sample.timeMilliseconds;
  }
  const first = strictFrozenRecord(samples[0], [
    "sequence",
    "x",
    "y",
    "pressure",
    "tangentialPressure",
    "tiltX",
    "tiltY",
    "twist",
    "timeMilliseconds",
    "pointerId",
    "flags",
  ]);
  const last = strictFrozenRecord(samples.at(-1), [
    "sequence",
    "x",
    "y",
    "pressure",
    "tangentialPressure",
    "tiltX",
    "tiltY",
    "twist",
    "timeMilliseconds",
    "pointerId",
    "flags",
  ]);
  return first?.sequence === source.firstSequence && last?.sequence === source.lastSequence;
}

/**
 * The candidate parser's `role` field is intentionally absent from the durable plan, so this
 * lowering boundary performs a complete descriptor-based validation of that durable schema. It
 * requires the parser's deep-frozen authority shape, rejects unknown fields and accessors without
 * invoking them, and validates every recipe field even when a specialist backend would consume it.
 */
function isValidatedCanonicalPlan(input: StudioCanonicalBrushPlan): boolean {
  const plan = strictFrozenRecord(input, [
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
    !plan
    || plan.kind !== "studio-canonical-brush-plan"
    || plan.version !== STUDIO_CANONICAL_BRUSH_PLAN_VERSION
    || !positiveSafeInteger(plan.sessionEpoch)
    || !positiveSafeInteger(plan.strokeEpoch)
    || !positiveSafeInteger(plan.commandSequence)
    || !identifier(plan.strokeId)
    || !uint32(plan.seed)
    || plan.coordinateSpace !== "document-css-px"
  ) return false;
  const transform = strictFrozenRecord(plan.transform, [
    "encoding",
    "m11",
    "m12",
    "m21",
    "m22",
    "translateX",
    "translateY",
  ]);
  if (
    !transform
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
  ) return false;
  const determinant =
    (transform.m11 as number) * (transform.m22 as number)
      - (transform.m12 as number) * (transform.m21 as number);
  if (!finite(determinant) || Math.abs(determinant) < 1e-12) return false;

  const color = strictFrozenRecord(plan.color, ["space", "alphaMode", "components"]);
  const components = color
    ? strictFrozenArray(color.components, 4)
    : null;
  if (
    !color
    || (color.space !== "linear-srgb" && color.space !== "linear-display-p3")
    || color.alphaMode !== "straight"
    || !components
    || components.length !== 4
    || !components.every((component) => inRange(component, 0, 1))
  ) return false;

  const composite = strictFrozenRecord(
    plan.composite,
    ["porterDuff", "blendMode", "opacity"],
  );
  if (
    !composite
    || (
      composite.porterDuff !== "source-over"
      && composite.porterDuff !== "destination-out"
    )
    || (
      composite.blendMode !== "normal"
      && composite.blendMode !== "multiply"
      && composite.blendMode !== "screen"
      && composite.blendMode !== "overlay"
      && composite.blendMode !== "darken"
      && composite.blendMode !== "lighten"
    )
    || (composite.porterDuff === "destination-out" && composite.blendMode !== "normal")
    || !inRange(composite.opacity, 0, 1)
  ) return false;
  return validRecipe(plan.recipe) && validSource(plan.source);
}

function specialistRejection(
  plan: StudioCanonicalBrushPlan,
): Extract<StudioProfessionalBrushWebGpuLoweringResult, { status: "unsupported" }> | null {
  if (plan.recipe.tip.kind === "texture") {
    return Object.freeze({ status: "unsupported", reason: "texture-tip" });
  }
  if (plan.recipe.grain !== null) {
    return Object.freeze({ status: "unsupported", reason: "grain" });
  }
  if (plan.recipe.engine === "wet-media-v1" || plan.recipe.wetMedia !== null) {
    return Object.freeze({ status: "unsupported", reason: "wet-media" });
  }
  if (plan.color.space !== "linear-srgb") {
    return Object.freeze({
      status: "unsupported",
      reason: "unsupported-color-space",
      detail: plan.color.space,
    });
  }
  if (plan.composite.blendMode !== "normal") {
    return Object.freeze({
      status: "unsupported",
      reason: "unsupported-blend-mode",
      detail: plan.composite.blendMode,
    });
  }
  return null;
}

function acceptedSamples(
  canonical: StudioCanonicalBrushPlan,
  dynamics: StudioProfessionalBrushDynamicsPlan,
): readonly Readonly<{
  sequence: number;
  timeTick: number;
  x: number;
  y: number;
  pressure: number;
  tiltXDegrees: number;
  tiltYDegrees: number;
  tangentialPressure: number;
  twistDegrees: number;
}>[] | null {
  const samples = [];
  for (const sample of canonical.source.samples) {
    const tick = sample.timeMilliseconds / dynamics.clock.tickMilliseconds;
    if (!Number.isSafeInteger(tick) || tick < 0) return null;
    samples.push({
      sequence: sample.sequence,
      timeTick: tick,
      x: sample.x,
      y: sample.y,
      pressure: sample.pressure,
      tiltXDegrees: sample.tiltX,
      tiltYDegrees: sample.tiltY,
      tangentialPressure: sample.tangentialPressure,
      twistDegrees: sample.twist,
    });
  }
  return samples;
}

function transformPoint(
  plan: StudioCanonicalBrushPlan,
  x: number,
  y: number,
): readonly [number, number] {
  return [
    plan.transform.m11 * x + plan.transform.m21 * y + plan.transform.translateX,
    plan.transform.m12 * x + plan.transform.m22 * y + plan.transform.translateY,
  ];
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

function mixUint32(value: number): number {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb_352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846c_a68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

function seededUnit(eventSeed: number, canonicalSeed: number, salt: number): number {
  return mixUint32(eventSeed ^ canonicalSeed ^ salt) / 0x1_0000_0000;
}

function checkedGpuValues(
  values: readonly number[],
  maximumCoordinateAbsolute: number,
): readonly number[] | null {
  const rounded = values.map(gpuNumber);
  if (
    rounded.some(
      (value) => value === null || Math.abs(value) > maximumCoordinateAbsolute,
    )
  ) return null;
  return rounded as number[];
}

function parseOptions(
  options: StudioProfessionalBrushWebGpuLoweringOptions,
): Readonly<{
  mode: "append" | "rebuild";
  maximumDabs: number;
  maximumCoordinateAbsolute: number;
}> | null {
  const mode = options.mode ?? "rebuild";
  const maximumDabs =
    options.maximumDabs ?? STUDIO_PROFESSIONAL_BRUSH_WEBGPU_DEFAULT_MAX_DABS;
  const maximumCoordinateAbsolute = options.maximumCoordinateAbsolute
    ?? STUDIO_PROFESSIONAL_BRUSH_WEBGPU_DEFAULT_MAX_COORDINATE_ABSOLUTE;
  if (
    (mode !== "append" && mode !== "rebuild")
    || !positiveSafeInteger(maximumDabs)
    || maximumDabs > STUDIO_PROFESSIONAL_BRUSH_WEBGPU_DEFAULT_MAX_DABS
    || !inRange(
      maximumCoordinateAbsolute,
      1,
      STUDIO_PROFESSIONAL_BRUSH_WEBGPU_DEFAULT_MAX_COORDINATE_ABSOLUTE,
    )
  ) return null;
  return { mode, maximumDabs, maximumCoordinateAbsolute };
}

/**
 * Resolves one complete authoritative sample prefix and produces one complete append/rebuild
 * payload. There is no hidden chunk cursor: identical plans and accepted samples produce identical
 * dabs and batches, with `mode` being the only append/rebuild difference.
 */
export function lowerStudioProfessionalBrushToWebGpu(
  canonicalInput: StudioCanonicalBrushPlan,
  dynamicsInput: StudioProfessionalBrushDynamicsPlan,
  options: StudioProfessionalBrushWebGpuLoweringOptions = {},
): StudioProfessionalBrushWebGpuLoweringResult {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    return Object.freeze({ status: "rejected", reason: "invalid-options" });
  }
  const parsedOptions = parseOptions(options);
  if (!parsedOptions) {
    return Object.freeze({ status: "rejected", reason: "invalid-options" });
  }
  if (!isValidatedCanonicalPlan(canonicalInput)) {
    return Object.freeze({ status: "rejected", reason: "invalid-canonical-plan" });
  }
  const dynamics = parseStudioProfessionalBrushDynamicsPlan(dynamicsInput);
  if (!dynamics.ok || dynamics.plan.version !== STUDIO_PROFESSIONAL_BRUSH_DYNAMICS_VERSION) {
    return Object.freeze({
      status: "rejected",
      reason: "invalid-dynamics-plan",
      path: dynamics.ok ? "$.version" : dynamics.path,
    });
  }
  const specialist = specialistRejection(canonicalInput);
  if (specialist) return specialist;
  if (canonicalInput.recipe.tip.kind !== "analytic") {
    return Object.freeze({ status: "rejected", reason: "invalid-canonical-plan" });
  }
  const samples = acceptedSamples(canonicalInput, dynamics.plan);
  if (!samples) {
    return Object.freeze({ status: "rejected", reason: "sample-clock-mismatch" });
  }
  const resolved = resolveStudioProfessionalBrushDynamics(
    dynamics.plan,
    samples,
    {
      signal: options.signal,
      shouldCancel: options.shouldCancel,
    },
  );
  if (resolved.status === "cancelled") return resolved;
  if (resolved.status === "rejected") {
    return Object.freeze({
      status: "rejected",
      reason: "dynamics-rejected",
      path: resolved.path,
    });
  }
  if (resolved.depositions.length > parsedOptions.maximumDabs) {
    return Object.freeze({ status: "rejected", reason: "dab-limit-exceeded" });
  }
  if (resolved.depositions.some((event) => event.channels.textureDepth !== 0)) {
    return Object.freeze({ status: "unsupported", reason: "texture-depth" });
  }

  const composite: StudioCanonicalWebGpuComposite = {
    porterDuff: canonicalInput.composite.porterDuff,
    blendMode: canonicalInput.composite.blendMode,
  };
  const dabs: StudioCanonicalWebGpuAnalyticDab[] = [];
  for (const event of resolved.depositions) {
    if (options.signal?.aborted) {
      return Object.freeze({
        status: "cancelled",
        processedSamples: resolved.states.length,
        emittedEvents: dabs.length,
      });
    }
    const station = transformPoint(canonicalInput, event.x, event.y);
    const scatterAngle = seededUnit(
      event.randomUint32,
      canonicalInput.seed,
      SCATTER_ANGLE_SALT,
    ) * TAU;
    const scatterRadius = Math.sqrt(seededUnit(
      event.randomUint32,
      canonicalInput.seed,
      SCATTER_RADIUS_SALT,
    )) * event.channels.scatter;
    const scatter = transformVector(
      canonicalInput,
      Math.cos(scatterAngle) * scatterRadius,
      Math.sin(scatterAngle) * scatterRadius,
    );
    const centerX = station[0] + scatter[0];
    const centerY = station[1] + scatter[1];

    const radius = event.channels.size / 2;
    const cosine = Math.cos(event.channels.angle);
    const sine = Math.sin(event.channels.angle);
    const basisX = transformVector(
      canonicalInput,
      cosine * radius,
      sine * radius,
    );
    const basisY = transformVector(
      canonicalInput,
      -sine * radius * event.channels.roundness,
      cosine * radius * event.channels.roundness,
    );
    const geometry = checkedGpuValues(
      [
        station[0],
        station[1],
        centerX,
        centerY,
        event.channels.size,
        basisX[0],
        basisX[1],
        basisY[0],
        basisY[1],
      ],
      parsedOptions.maximumCoordinateAbsolute,
    );
    if (!geometry) {
      return Object.freeze({
        status: "rejected",
        reason: "coordinate-budget-exceeded",
      });
    }
    const [
      stationX,
      stationY,
      x,
      y,
      diameter,
      xx,
      xy,
      yx,
      yy,
    ] = geometry;
    const determinant = Math.fround(xx! * yy! - xy! * yx!);
    const opacity = gpuNumber(
      canonicalInput.composite.opacity * event.channels.opacity,
    );
    const flow = gpuNumber(event.channels.flow);
    const pressure = gpuNumber(event.sources.pressure);
    const angleRadians = gpuNumber(event.channels.angle);
    const roundness = gpuNumber(event.channels.roundness);
    const hardness = gpuNumber(canonicalInput.recipe.hardness);
    const edgeSoftness = gpuNumber(canonicalInput.recipe.tip.edgeSoftness);
    const alpha = gpuNumber(
      canonicalInput.color.components[3]
        * canonicalInput.composite.opacity
        * event.channels.opacity
        * event.channels.flow,
    );
    const red = gpuNumber(canonicalInput.color.components[0]);
    const green = gpuNumber(canonicalInput.color.components[1]);
    const blue = gpuNumber(canonicalInput.color.components[2]);
    if (
      !Number.isFinite(determinant)
      || determinant === 0
      || diameter! <= 0
      || opacity === null
      || flow === null
      || pressure === null
      || angleRadians === null
      || roundness === null
      || roundness <= 0
      || hardness === null
      || edgeSoftness === null
      || alpha === null
      || red === null
      || green === null
      || blue === null
    ) {
      return Object.freeze({ status: "rejected", reason: "numeric-overflow" });
    }
    dabs.push({
      index: dabs.length,
      stationX: stationX!,
      stationY: stationY!,
      x: x!,
      y: y!,
      pressure,
      diameter: diameter!,
      opacity,
      flow,
      color: {
        space: "linear-srgb",
        alphaMode: "straight",
        components: [red, green, blue, alpha],
      },
      composite,
      tip: {
        shape: canonicalInput.recipe.tip.shape,
        hardness,
        edgeSoftness,
        roundness,
        angleRadians,
        localToDocument: [xx!, xy!, yx!, yy!],
      },
    });
  }

  const batches: StudioCanonicalWebGpuAnalyticBatch[] = dabs.length === 0
    ? []
    : [{
        composite,
        colorSpace: "linear-srgb",
        firstInstance: 0,
        instanceCount: dabs.length,
      }];
  const plan: StudioEngineWebGpuBrushPlan = {
    kind: "studio-engine-webgpu-canonical-plan",
    mode: parsedOptions.mode,
    loweringVersion: STUDIO_PROFESSIONAL_BRUSH_WEBGPU_LOWERING_VERSION,
    strokeId: canonicalInput.strokeId,
    dabs,
    batches,
  };
  return deepFreeze({ status: "ready", plan });
}
