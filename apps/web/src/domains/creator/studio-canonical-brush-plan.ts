/**
 * Durable, renderer-neutral brush command consumed by live, recovery and tile-commit backends.
 *
 * This is intentionally a source plan, not a Canvas or GPU draw list. A backend-specific planner
 * may lower it to analytic dabs, texture stamps or wet-media deposits, but every backend starts
 * from the same accepted samples and the same fully specified recipe. Predicted pointer samples
 * are transport-only and are rejected at this boundary.
 */

import {
  normalizeStudioBrushDynamicsSettings,
  type NormalizedStudioBrushDynamicsSettings,
} from "./brush/studio-brush-dynamics";
import {
  normalizeStudioBrushDualBrushSettings,
  normalizeStudioBrushTipLayers,
  type NormalizedStudioBrushDualBrushSettings,
  type NormalizedStudioBrushTipLayerSettings,
} from "./brush/studio-brush-tip-composition";
import {
  normalizeStudioBrushTipSettings,
  type NormalizedStudioBrushTipSettings,
} from "./brush/studio-brush-tip-stamp";
import { canonicalStudioCommandJson } from "./studio-command-journal";

export const STUDIO_CANONICAL_BRUSH_PLAN_VERSION = 1 as const;
export const STUDIO_CANONICAL_BRUSH_RECIPE_LEGACY_VERSION = 1 as const;
export const STUDIO_CANONICAL_BRUSH_RECIPE_PAINT_VERSION = 2 as const;

export const STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS = Object.freeze({
  maxSamples: 65_536,
  maxIdentifierCharacters: 128,
  maxCoordinateAbsolute: 1_000_000,
  maxTimeMilliseconds: Number.MAX_SAFE_INTEGER,
  maxBrushSize: 65_536,
  maxSpacingRatio: 64,
  maxScatterRatio: 64,
  maxTextureDimension: 16_384,
  maxWetSimulationSteps: 4_096,
  maxWetFieldScale: 16,
  maxRetainedDynamicsBytes: 512 * 1024,
} as const);

export type StudioCanonicalSampleRole = "authoritative" | "predicted";

export interface StudioCanonicalBrushSourceSampleCandidate {
  readonly role: StudioCanonicalSampleRole;
  readonly sequence: number;
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly tangentialPressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly twist: number;
  readonly timeMilliseconds: number;
  readonly pointerId: number;
  readonly flags: number;
}

/** The role is absent because every durable sample is authoritative by construction. */
export interface StudioCanonicalBrushSourceSample {
  readonly sequence: number;
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly tangentialPressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly twist: number;
  readonly timeMilliseconds: number;
  readonly pointerId: number;
  readonly flags: number;
}

export interface StudioCanonicalBrushSource {
  readonly encoding: "accepted-authoritative-samples-v1";
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly samples: readonly StudioCanonicalBrushSourceSample[];
}

export interface StudioCanonicalBrushAffineTransform {
  readonly encoding: "affine-f64-v1";
  readonly m11: number;
  readonly m12: number;
  readonly m21: number;
  readonly m22: number;
  readonly translateX: number;
  readonly translateY: number;
}

export interface StudioCanonicalBrushColor {
  /**
   * Components are straight-alpha, scene-linear values. A renderer must not reinterpret them as
   * gamma-encoded CSS channels or premultiply them before applying the declared composite.
   */
  readonly space: "linear-srgb" | "linear-display-p3";
  readonly alphaMode: "straight";
  readonly components: readonly [number, number, number, number];
}

export type StudioCanonicalBrushBlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten";

export interface StudioCanonicalBrushComposite {
  readonly porterDuff: "source-over" | "destination-out";
  readonly blendMode: StudioCanonicalBrushBlendMode;
  readonly opacity: number;
}

export interface StudioCanonicalBrushAnalyticTip {
  readonly kind: "analytic";
  readonly shape: "round" | "ellipse" | "square";
  readonly edgeSoftness: number;
}

export interface StudioCanonicalBrushTextureTip {
  readonly kind: "texture";
  readonly assetId: string;
  /** Content-addressed identity; asset names or URLs are never sufficient for deterministic replay. */
  readonly contentHash: string;
  readonly channel: "alpha" | "luminance";
  readonly width: number;
  readonly height: number;
}

export type StudioCanonicalBrushTip =
  | StudioCanonicalBrushAnalyticTip
  | StudioCanonicalBrushTextureTip;

export interface StudioCanonicalBrushResponseCurve {
  readonly minimum: number;
  readonly maximum: number;
  readonly exponent: number;
}

export interface StudioCanonicalBrushPressureResponse {
  readonly size: StudioCanonicalBrushResponseCurve;
  readonly opacity: StudioCanonicalBrushResponseCurve;
  readonly flow: StudioCanonicalBrushResponseCurve;
}

export interface StudioCanonicalBrushScatter {
  readonly radiusRatio: number;
  readonly distribution: "uniform-disk";
}

export interface StudioCanonicalBrushGrain {
  readonly kind: "procedural-noise" | "texture";
  readonly assetId: string | null;
  readonly contentHash: string | null;
  readonly space: "document" | "stroke";
  readonly scale: number;
  readonly depth: number;
  readonly contrast: number;
  readonly seed: number;
}

export interface StudioCanonicalWetMedia {
  readonly model: "pigment-water-v1";
  readonly fieldScale: number;
  readonly fixedRateHz: number;
  readonly simulationSteps: number;
  readonly absorption: number;
  readonly bleed: number;
  readonly dryingRate: number;
  readonly edgeDarkening: number;
  readonly fixationRate: number;
  readonly granulation: number;
  readonly paperRoughness: number;
  readonly pigmentLoad: number;
  readonly waterLoad: number;
  readonly wetnessLoad: number;
}

interface StudioCanonicalBrushRecipeBase {
  readonly brushId: string;
  readonly engine: "dab-v1" | "wet-media-v1";
  readonly material: "ink" | "graphite" | "marker" | "air" | "pigment" | "eraser";
  readonly tip: StudioCanonicalBrushTip;
  readonly size: number;
  readonly flow: number;
  readonly hardness: number;
  /** Arc-length distance expressed as a ratio of the resolved tip diameter. */
  readonly spacingRatio: number;
  readonly scatter: StudioCanonicalBrushScatter;
  readonly angleRadians: number;
  readonly roundness: number;
  readonly pressure: StudioCanonicalBrushPressureResponse;
  readonly grain: StudioCanonicalBrushGrain | null;
  readonly wetMedia: StudioCanonicalWetMedia | null;
}

/**
 * Historical canonical recipe. Composite opacity is multiplied into every lowered dab before it
 * reaches the destination. The exact field set remains frozen for old files and provider proofs.
 */
export interface StudioCanonicalBrushRecipeV1 extends StudioCanonicalBrushRecipeBase {
  readonly version: typeof STUDIO_CANONICAL_BRUSH_RECIPE_LEGACY_VERSION;
}

export interface StudioCanonicalBrushPaintContractV2 {
  readonly model: "layered-flow-v1" | "bounded-flow-v2";
  readonly depositionAlpha: "flow-times-dab-opacity";
  readonly accumulation: "source-over-stroke-local-rgba";
  readonly finalCompositeOpacity: "plan-composite-opacity-once";
  readonly surface: "stroke-local-rgba" | "bounded-sparse-rgba-tiles";
}

/**
 * Exact, renderer-neutral tip-composition program for paint-aware recipes.
 *
 * `tip` on the recipe remains the effective primary carrier (and is therefore directly usable by
 * a single-tip texture lowerer). This contract keeps the non-destructive source composition that
 * produced it: the primary tip, ordered transformed layers and optional dual-tip modulation. The
 * same values also live in `retainedDynamics`; validation requires byte-identical agreement so a
 * consumer can never choose between two conflicting visual authorities.
 */
export interface StudioCanonicalBrushTipCompositionV2 {
  readonly model: "normalized-multi-tip-v1";
  readonly primary: NormalizedStudioBrushTipSettings;
  readonly layers: readonly NormalizedStudioBrushTipLayerSettings[];
  readonly dualBrush: NormalizedStudioBrushDualBrushSettings | null;
}

/**
 * Paint-aware recipe. `retainedDynamics` is the complete normalized per-stroke program, including
 * causal deposit version, taper, pressure/speed/tilt/twist mappings, seeded jitter, grain and tip
 * settings. Summary fields in the base recipe aid classification only; a v2 consumer must execute
 * both the paint contract and the retained program or fail closed.
 */
export interface StudioCanonicalBrushRecipeV2 extends StudioCanonicalBrushRecipeBase {
  readonly version: typeof STUDIO_CANONICAL_BRUSH_RECIPE_PAINT_VERSION;
  readonly paint: StudioCanonicalBrushPaintContractV2;
  readonly retainedDynamics: NormalizedStudioBrushDynamicsSettings | null;
  /** Absent on historical v2 recipes and on recipes with a single unmodulated primary tip. */
  readonly tipComposition?: StudioCanonicalBrushTipCompositionV2;
}

export type StudioCanonicalBrushRecipe =
  | StudioCanonicalBrushRecipeV1
  | StudioCanonicalBrushRecipeV2;

export interface StudioCanonicalBrushPlan {
  readonly kind: "studio-canonical-brush-plan";
  readonly version: typeof STUDIO_CANONICAL_BRUSH_PLAN_VERSION;
  readonly sessionEpoch: number;
  readonly strokeEpoch: number;
  readonly commandSequence: number;
  readonly strokeId: string;
  readonly seed: number;
  readonly coordinateSpace: "document-css-px";
  readonly transform: StudioCanonicalBrushAffineTransform;
  readonly color: StudioCanonicalBrushColor;
  readonly composite: StudioCanonicalBrushComposite;
  readonly recipe: StudioCanonicalBrushRecipe;
  readonly source: StudioCanonicalBrushSource;
}

export interface StudioCanonicalBrushPlanValidationState {
  readonly sessionEpoch: number;
  readonly strokeEpoch: number;
  readonly lastAcceptedCommandSequence: number;
}

export interface StudioCanonicalBrushPlanAcceptance {
  readonly plan: StudioCanonicalBrushPlan;
  readonly nextState: StudioCanonicalBrushPlanValidationState;
}

export type StudioCanonicalBrushPlanFailureReason =
  | "not-plain-data"
  | "unknown-field"
  | "invalid-field"
  | "unsupported-version"
  | "budget-exceeded"
  | "predicted-sample"
  | "session-epoch-mismatch"
  | "stroke-epoch-mismatch"
  | "duplicate-command-sequence"
  | "command-sequence-gap"
  | "duplicate-sample-sequence"
  | "sample-sequence-order"
  | "accepted-prefix-mismatch";

export type StudioCanonicalBrushPlanParseResult =
  | {
      readonly ok: true;
      readonly value: StudioCanonicalBrushPlanAcceptance;
    }
  | {
      readonly ok: false;
      readonly reason: StudioCanonicalBrushPlanFailureReason;
      readonly path: string;
    };

type UnknownRecord = Record<string, unknown>;
type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly reason: StudioCanonicalBrushPlanFailureReason;
      readonly path: string;
    };

function fail<T>(
  reason: StudioCanonicalBrushPlanFailureReason,
  path: string,
): ValidationResult<T> {
  return { ok: false, reason, path };
}

/**
 * Inspects property descriptors before reading values. This rejects accessors without invoking
 * hostile getters and also excludes class instances, symbols and hidden metadata.
 */
function inspectRecord(
  input: unknown,
  allowedKeys: readonly string[],
  path: string,
): ValidationResult<UnknownRecord> {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return fail("not-plain-data", path);
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      return fail("not-plain-data", path);
    }
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key === "symbol")) {
      return fail("not-plain-data", path);
    }
    const allowed = new Set(allowedKeys);
    const values: UnknownRecord = {};
    for (const key of keys as string[]) {
      const descriptor = descriptors[key]!;
      if (!descriptor.enumerable || !("value" in descriptor)) {
        return fail("not-plain-data", `${path}.${key}`);
      }
      if (!allowed.has(key)) return fail("unknown-field", `${path}.${key}`);
      values[key] = descriptor.value;
    }
    for (const key of allowedKeys) {
      if (!(key in descriptors)) return fail("invalid-field", `${path}.${key}`);
    }
    return { ok: true, value: values };
  } catch {
    return fail("not-plain-data", path);
  }
}

function inspectArray(
  input: unknown,
  maximumLength: number,
  path: string,
): ValidationResult<readonly unknown[]> {
  try {
    if (!Array.isArray(input)) return fail("not-plain-data", path);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
    if (!lengthDescriptor || !("value" in lengthDescriptor)) {
      return fail("not-plain-data", `${path}.length`);
    }
    const length = lengthDescriptor.value as unknown;
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 1) {
      return fail("invalid-field", `${path}.length`);
    }
    const arrayLength = length;
    if (arrayLength > maximumLength) return fail("budget-exceeded", `${path}.length`);
    const values: unknown[] = [];
    const keys = Reflect.ownKeys(descriptors);
    for (const key of keys) {
      if (key === "length") continue;
      if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) {
        return fail("not-plain-data", path);
      }
      const index = Number(key);
      const descriptor = descriptors[key]!;
      if (
        index >= arrayLength
        || !descriptor.enumerable
        || !("value" in descriptor)
      ) {
        return fail("not-plain-data", `${path}[${key}]`);
      }
      values[index] = descriptor.value;
    }
    if (values.length !== arrayLength) return fail("invalid-field", path);
    for (let index = 0; index < arrayLength; index += 1) {
      if (!(index in values)) return fail("invalid-field", `${path}[${index}]`);
    }
    return { ok: true, value: values };
  } catch {
    return fail("not-plain-data", path);
  }
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function safeUnsignedInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function uint32(value: unknown): value is number {
  return safeUnsignedInteger(value) && (value as number) <= 0xffff_ffff;
}

function identifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxIdentifierCharacters
    && /^[A-Za-z0-9._:/+-]+$/.test(value);
}

function contentHash(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 12
    && value.length <= 128
    && /^[A-Za-z0-9:+_-]+$/.test(value);
}

function canonicalNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function validateCurve(input: unknown, path: string): ValidationResult<StudioCanonicalBrushResponseCurve> {
  const record = inspectRecord(input, ["minimum", "maximum", "exponent"], path);
  if (!record.ok) return record;
  const { minimum, maximum, exponent } = record.value;
  if (
    !finiteInRange(minimum, 0, 4)
    || !finiteInRange(maximum, 0, 4)
    || maximum < minimum
    || !finiteInRange(exponent, 0.01, 16)
  ) {
    return fail("invalid-field", path);
  }
  return {
    ok: true,
    value: {
      minimum: canonicalNumber(minimum),
      maximum: canonicalNumber(maximum),
      exponent: canonicalNumber(exponent),
    },
  };
}

function validatePressure(
  input: unknown,
  path: string,
): ValidationResult<StudioCanonicalBrushPressureResponse> {
  const record = inspectRecord(input, ["size", "opacity", "flow"], path);
  if (!record.ok) return record;
  const size = validateCurve(record.value.size, `${path}.size`);
  if (!size.ok) return size;
  const opacity = validateCurve(record.value.opacity, `${path}.opacity`);
  if (!opacity.ok) return opacity;
  const flow = validateCurve(record.value.flow, `${path}.flow`);
  if (!flow.ok) return flow;
  return { ok: true, value: { size: size.value, opacity: opacity.value, flow: flow.value } };
}

function validateTip(input: unknown, path: string): ValidationResult<StudioCanonicalBrushTip> {
  const kindRecord = inspectRecordByDiscriminator(input, "kind", path);
  if (!kindRecord.ok) return kindRecord;
  if (kindRecord.value === "analytic") {
    const record = inspectRecord(input, ["kind", "shape", "edgeSoftness"], path);
    if (!record.ok) return record;
    if (
      record.value.kind !== "analytic"
      || (
        record.value.shape !== "round"
        && record.value.shape !== "ellipse"
        && record.value.shape !== "square"
      )
      || !finiteInRange(record.value.edgeSoftness, 0, 1)
    ) return fail("invalid-field", path);
    return {
      ok: true,
      value: {
        kind: "analytic",
        shape: record.value.shape,
        edgeSoftness: canonicalNumber(record.value.edgeSoftness),
      },
    };
  }
  if (kindRecord.value === "texture") {
    const record = inspectRecord(
      input,
      ["kind", "assetId", "contentHash", "channel", "width", "height"],
      path,
    );
    if (!record.ok) return record;
    if (
      record.value.kind !== "texture"
      || !identifier(record.value.assetId)
      || !contentHash(record.value.contentHash)
      || (record.value.channel !== "alpha" && record.value.channel !== "luminance")
      || !positiveSafeInteger(record.value.width)
      || record.value.width > STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxTextureDimension
      || !positiveSafeInteger(record.value.height)
      || record.value.height > STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxTextureDimension
    ) return fail("invalid-field", path);
    return {
      ok: true,
      value: {
        kind: "texture",
        assetId: record.value.assetId,
        contentHash: record.value.contentHash,
        channel: record.value.channel,
        width: record.value.width,
        height: record.value.height,
      },
    };
  }
  return fail("invalid-field", `${path}.kind`);
}

function inspectRecordByDiscriminator(
  input: unknown,
  discriminator: string,
  path: string,
): ValidationResult<unknown> {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return fail("not-plain-data", path);
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      return fail("not-plain-data", path);
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, discriminator);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      return fail("not-plain-data", `${path}.${discriminator}`);
    }
    return { ok: true, value: descriptor.value };
  } catch {
    return fail("not-plain-data", path);
  }
}

function validateGrain(
  input: unknown,
  path: string,
): ValidationResult<StudioCanonicalBrushGrain | null> {
  if (input === null) return { ok: true, value: null };
  const record = inspectRecord(
    input,
    [
      "kind",
      "assetId",
      "contentHash",
      "space",
      "scale",
      "depth",
      "contrast",
      "seed",
    ],
    path,
  );
  if (!record.ok) return record;
  const kind = record.value.kind;
  const assetId = record.value.assetId;
  const hash = record.value.contentHash;
  if (
    (kind !== "procedural-noise" && kind !== "texture")
    || (
      kind === "texture"
        ? !identifier(assetId) || !contentHash(hash)
        : assetId !== null || hash !== null
    )
    || (record.value.space !== "document" && record.value.space !== "stroke")
    || !finiteInRange(record.value.scale, 0.01, 65_536)
    || !finiteInRange(record.value.depth, 0, 1)
    || !finiteInRange(record.value.contrast, 0, 1)
    || !uint32(record.value.seed)
  ) return fail("invalid-field", path);
  return {
    ok: true,
    value: {
      kind,
      assetId: assetId as string | null,
      contentHash: hash as string | null,
      space: record.value.space,
      scale: canonicalNumber(record.value.scale),
      depth: canonicalNumber(record.value.depth),
      contrast: canonicalNumber(record.value.contrast),
      seed: record.value.seed,
    },
  };
}

function validateWetMedia(
  input: unknown,
  path: string,
): ValidationResult<StudioCanonicalWetMedia | null> {
  if (input === null) return { ok: true, value: null };
  const keys = [
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
  const record = inspectRecord(input, keys, path);
  if (!record.ok) return record;
  if (
    record.value.model !== "pigment-water-v1"
    || !positiveSafeInteger(record.value.fieldScale)
    || record.value.fieldScale > STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxWetFieldScale
    || !finiteInRange(record.value.fixedRateHz, 1, 2_000)
    || !positiveSafeInteger(record.value.simulationSteps)
    || record.value.simulationSteps
      > STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxWetSimulationSteps
    || keys.slice(4).some((key) => !finiteInRange(record.value[key], 0, 4))
  ) return fail("invalid-field", path);
  return {
    ok: true,
    value: {
      model: "pigment-water-v1",
      fieldScale: record.value.fieldScale,
      fixedRateHz: canonicalNumber(record.value.fixedRateHz),
      simulationSteps: record.value.simulationSteps,
      absorption: canonicalNumber(record.value.absorption as number),
      bleed: canonicalNumber(record.value.bleed as number),
      dryingRate: canonicalNumber(record.value.dryingRate as number),
      edgeDarkening: canonicalNumber(record.value.edgeDarkening as number),
      fixationRate: canonicalNumber(record.value.fixationRate as number),
      granulation: canonicalNumber(record.value.granulation as number),
      paperRoughness: canonicalNumber(record.value.paperRoughness as number),
      pigmentLoad: canonicalNumber(record.value.pigmentLoad as number),
      waterLoad: canonicalNumber(record.value.waterLoad as number),
      wetnessLoad: canonicalNumber(record.value.wetnessLoad as number),
    },
  };
}

function validatePaintContractV2(
  input: unknown,
  path: string,
): ValidationResult<StudioCanonicalBrushPaintContractV2> {
  const record = inspectRecord(
    input,
    [
      "model",
      "depositionAlpha",
      "accumulation",
      "finalCompositeOpacity",
      "surface",
    ],
    path,
  );
  if (!record.ok) return record;
  const model = record.value.model;
  if (
    (model !== "layered-flow-v1" && model !== "bounded-flow-v2")
    || record.value.depositionAlpha !== "flow-times-dab-opacity"
    || record.value.accumulation !== "source-over-stroke-local-rgba"
    || record.value.finalCompositeOpacity !== "plan-composite-opacity-once"
    || (
      model === "layered-flow-v1"
      && record.value.surface !== "stroke-local-rgba"
    )
    || (
      model === "bounded-flow-v2"
      && record.value.surface !== "bounded-sparse-rgba-tiles"
    )
  ) return fail("invalid-field", path);
  return {
    ok: true,
    value: {
      model,
      depositionAlpha: "flow-times-dab-opacity",
      accumulation: "source-over-stroke-local-rgba",
      finalCompositeOpacity: "plan-composite-opacity-once",
      surface: model === "bounded-flow-v2"
        ? "bounded-sparse-rgba-tiles"
        : "stroke-local-rgba",
    },
  };
}

function validateRetainedDynamics(
  input: unknown,
  path: string,
): ValidationResult<NormalizedStudioBrushDynamicsSettings | null> {
  if (input === null) return { ok: true, value: null };
  try {
    const canonical = canonicalStudioCommandJson(
      input,
      STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxRetainedDynamicsBytes,
    );
    const detached = JSON.parse(canonical) as unknown;
    const normalized = normalizeStudioBrushDynamicsSettings(detached);
    const normalizedCanonical = canonicalStudioCommandJson(
      normalized,
      STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxRetainedDynamicsBytes,
    );
    if (normalizedCanonical !== canonical) return fail("invalid-field", path);
    return { ok: true, value: normalized };
  } catch (error) {
    return fail(
      (
        typeof error === "object"
        && error !== null
        && Object.getOwnPropertyDescriptor(error, "code")?.value === "PAYLOAD_TOO_LARGE"
      )
        ? "budget-exceeded"
        : "not-plain-data",
      path,
    );
  }
}

function validateTipCompositionV2(
  input: unknown,
  path: string,
): ValidationResult<StudioCanonicalBrushTipCompositionV2> {
  try {
    const canonical = canonicalStudioCommandJson(
      input,
      STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxRetainedDynamicsBytes,
    );
    const detached = JSON.parse(canonical) as unknown;
    const record = inspectRecord(
      detached,
      ["model", "primary", "layers", "dualBrush"],
      path,
    );
    if (!record.ok) return record;
    if (record.value.model !== "normalized-multi-tip-v1") {
      return fail("invalid-field", `${path}.model`);
    }
    const primary = normalizeStudioBrushTipSettings(record.value.primary);
    const layers = normalizeStudioBrushTipLayers(record.value.layers, primary);
    const dualBrush = record.value.dualBrush === null
      ? null
      : normalizeStudioBrushDualBrushSettings(record.value.dualBrush, primary);
    const normalized: StudioCanonicalBrushTipCompositionV2 = {
      model: "normalized-multi-tip-v1",
      primary,
      layers,
      dualBrush,
    };
    const normalizedCanonical = canonicalStudioCommandJson(
      normalized,
      STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxRetainedDynamicsBytes,
    );
    if (normalizedCanonical !== canonical) return fail("invalid-field", path);
    if (layers.length === 0 && dualBrush === null) return fail("invalid-field", path);
    return { ok: true, value: normalized };
  } catch (error) {
    return fail(
      (
        typeof error === "object"
        && error !== null
        && Object.getOwnPropertyDescriptor(error, "code")?.value === "PAYLOAD_TOO_LARGE"
      )
        ? "budget-exceeded"
        : "not-plain-data",
      path,
    );
  }
}

function validateRecipe(
  input: unknown,
  path: string,
): ValidationResult<StudioCanonicalBrushRecipe> {
  const version = inspectRecordByDiscriminator(input, "version", path);
  if (!version.ok) return version;
  if (
    version.value !== STUDIO_CANONICAL_BRUSH_RECIPE_LEGACY_VERSION
    && version.value !== STUDIO_CANONICAL_BRUSH_RECIPE_PAINT_VERSION
  ) return fail("unsupported-version", `${path}.version`);
  const versionTwo = version.value === STUDIO_CANONICAL_BRUSH_RECIPE_PAINT_VERSION;
  const tipCompositionDescriptor = Object.getOwnPropertyDescriptor(input, "tipComposition");
  if (
    tipCompositionDescriptor
    && (!tipCompositionDescriptor.enumerable || !("value" in tipCompositionDescriptor))
  ) return fail("not-plain-data", `${path}.tipComposition`);
  const hasTipComposition = tipCompositionDescriptor !== undefined;
  const record = inspectRecord(
    input,
    [
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
      ...(versionTwo ? [
        "paint",
        "retainedDynamics",
        ...(hasTipComposition ? ["tipComposition"] : []),
      ] : []),
    ],
    path,
  );
  if (!record.ok) return record;
  if (
    !identifier(record.value.brushId)
    || (record.value.engine !== "dab-v1" && record.value.engine !== "wet-media-v1")
    || (
      record.value.material !== "ink"
      && record.value.material !== "graphite"
      && record.value.material !== "marker"
      && record.value.material !== "air"
      && record.value.material !== "pigment"
      && record.value.material !== "eraser"
    )
    || !finiteInRange(
      record.value.size,
      0.01,
      STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxBrushSize,
    )
    || !finiteInRange(record.value.flow, 0, 1)
    || !finiteInRange(record.value.hardness, 0, 1)
    || !finiteInRange(
      record.value.spacingRatio,
      0.001,
      STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxSpacingRatio,
    )
    || !finiteInRange(record.value.angleRadians, -Math.PI * 2, Math.PI * 2)
    || !finiteInRange(record.value.roundness, 0.01, 1)
  ) return fail("invalid-field", path);
  const tip = validateTip(record.value.tip, `${path}.tip`);
  if (!tip.ok) return tip;
  const scatterRecord = inspectRecord(
    record.value.scatter,
    ["radiusRatio", "distribution"],
    `${path}.scatter`,
  );
  if (!scatterRecord.ok) return scatterRecord;
  if (
    !finiteInRange(
      scatterRecord.value.radiusRatio,
      0,
      STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxScatterRatio,
    )
    || scatterRecord.value.distribution !== "uniform-disk"
  ) return fail("invalid-field", `${path}.scatter`);
  const pressure = validatePressure(record.value.pressure, `${path}.pressure`);
  if (!pressure.ok) return pressure;
  const grain = validateGrain(record.value.grain, `${path}.grain`);
  if (!grain.ok) return grain;
  const wetMedia = validateWetMedia(record.value.wetMedia, `${path}.wetMedia`);
  if (!wetMedia.ok) return wetMedia;
  if (
    (record.value.engine === "wet-media-v1") !== (wetMedia.value !== null)
    || (wetMedia.value !== null && record.value.material !== "pigment")
  ) return fail("invalid-field", `${path}.wetMedia`);
  const base: Omit<StudioCanonicalBrushRecipeV1, "version"> = {
    brushId: record.value.brushId,
    engine: record.value.engine as StudioCanonicalBrushRecipeV1["engine"],
    material: record.value.material as StudioCanonicalBrushRecipeV1["material"],
    tip: tip.value,
    size: canonicalNumber(record.value.size),
    flow: canonicalNumber(record.value.flow),
    hardness: canonicalNumber(record.value.hardness),
    spacingRatio: canonicalNumber(record.value.spacingRatio),
    scatter: {
      radiusRatio: canonicalNumber(scatterRecord.value.radiusRatio),
      distribution: "uniform-disk" as const,
    },
    angleRadians: canonicalNumber(record.value.angleRadians),
    roundness: canonicalNumber(record.value.roundness),
    pressure: pressure.value,
    grain: grain.value,
    wetMedia: wetMedia.value,
  };
  if (!versionTwo) {
    return {
      ok: true,
      value: {
        version: STUDIO_CANONICAL_BRUSH_RECIPE_LEGACY_VERSION,
        ...base,
      },
    };
  }
  const paint = validatePaintContractV2(record.value.paint, `${path}.paint`);
  if (!paint.ok) return paint;
  const retainedDynamics = validateRetainedDynamics(
    record.value.retainedDynamics,
    `${path}.retainedDynamics`,
  );
  if (!retainedDynamics.ok) return retainedDynamics;
  const tipComposition = hasTipComposition
    ? validateTipCompositionV2(record.value.tipComposition, `${path}.tipComposition`)
    : null;
  if (tipComposition && !tipComposition.ok) return tipComposition;
  if (
    (paint.value.model === "bounded-flow-v2") !== (retainedDynamics.value !== null)
    || (
      paint.value.model === "layered-flow-v1"
      && retainedDynamics.value !== null
    )
    || record.value.engine !== "dab-v1"
    || record.value.material === "pigment"
    || (
      record.value.material === "eraser"
      && paint.value.model !== "layered-flow-v1"
    )
    || (
      tipComposition !== null
      && (
        retainedDynamics.value === null
        || canonicalStudioCommandJson({
          model: "normalized-multi-tip-v1",
          primary: retainedDynamics.value.tip,
          layers: retainedDynamics.value.tipLayers,
          dualBrush: retainedDynamics.value.dualBrush ?? null,
        }) !== canonicalStudioCommandJson(tipComposition.value)
      )
    )
  ) return fail("invalid-field", path);
  return {
    ok: true,
    value: {
      version: STUDIO_CANONICAL_BRUSH_RECIPE_PAINT_VERSION,
      ...base,
      paint: paint.value,
      retainedDynamics: retainedDynamics.value,
      ...(tipComposition ? { tipComposition: tipComposition.value } : {}),
    },
  };
}

function validateTransform(
  input: unknown,
  path: string,
): ValidationResult<StudioCanonicalBrushAffineTransform> {
  const record = inspectRecord(
    input,
    ["encoding", "m11", "m12", "m21", "m22", "translateX", "translateY"],
    path,
  );
  if (!record.ok) return record;
  const values = [
    record.value.m11,
    record.value.m12,
    record.value.m21,
    record.value.m22,
    record.value.translateX,
    record.value.translateY,
  ];
  if (
    record.value.encoding !== "affine-f64-v1"
    || !values.every((value) => finiteInRange(
      value,
      -STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxCoordinateAbsolute,
      STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxCoordinateAbsolute,
    ))
  ) return fail("invalid-field", path);
  const [m11, m12, m21, m22, translateX, translateY] = values as number[];
  const determinant = m11 * m22 - m12 * m21;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    return fail("invalid-field", path);
  }
  return {
    ok: true,
    value: {
      encoding: "affine-f64-v1",
      m11: canonicalNumber(m11),
      m12: canonicalNumber(m12),
      m21: canonicalNumber(m21),
      m22: canonicalNumber(m22),
      translateX: canonicalNumber(translateX),
      translateY: canonicalNumber(translateY),
    },
  };
}

function validateColor(
  input: unknown,
  path: string,
): ValidationResult<StudioCanonicalBrushColor> {
  const record = inspectRecord(input, ["space", "alphaMode", "components"], path);
  if (!record.ok) return record;
  const components = inspectArray(record.value.components, 4, `${path}.components`);
  if (!components.ok) return components;
  if (
    components.value.length !== 4
    || !components.value.every((value) => finiteInRange(value, 0, 1))
    || (
      record.value.space !== "linear-srgb"
      && record.value.space !== "linear-display-p3"
    )
    || record.value.alphaMode !== "straight"
  ) return fail("invalid-field", path);
  return {
    ok: true,
    value: {
      space: record.value.space,
      alphaMode: "straight",
      components: components.value.map(
        (value) => canonicalNumber(value as number),
      ) as unknown as readonly [number, number, number, number],
    },
  };
}

function validateComposite(
  input: unknown,
  path: string,
): ValidationResult<StudioCanonicalBrushComposite> {
  const record = inspectRecord(input, ["porterDuff", "blendMode", "opacity"], path);
  if (!record.ok) return record;
  const blendModes: readonly StudioCanonicalBrushBlendMode[] = [
    "normal",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
  ];
  if (
    (record.value.porterDuff !== "source-over"
      && record.value.porterDuff !== "destination-out")
    || !blendModes.includes(record.value.blendMode as StudioCanonicalBrushBlendMode)
    || !finiteInRange(record.value.opacity, 0, 1)
    || (
      record.value.porterDuff === "destination-out"
      && record.value.blendMode !== "normal"
    )
  ) return fail("invalid-field", path);
  return {
    ok: true,
    value: {
      porterDuff: record.value.porterDuff,
      blendMode: record.value.blendMode as StudioCanonicalBrushBlendMode,
      opacity: canonicalNumber(record.value.opacity),
    },
  };
}

function validateSourceSample(
  input: unknown,
  path: string,
): ValidationResult<StudioCanonicalBrushSourceSample> {
  const record = inspectRecord(
    input,
    [
      "role",
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
    ],
    path,
  );
  if (!record.ok) return record;
  if (record.value.role === "predicted") return fail("predicted-sample", `${path}.role`);
  if (
    record.value.role !== "authoritative"
    || !safeUnsignedInteger(record.value.sequence)
    || !finiteInRange(
      record.value.x,
      -STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxCoordinateAbsolute,
      STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxCoordinateAbsolute,
    )
    || !finiteInRange(
      record.value.y,
      -STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxCoordinateAbsolute,
      STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxCoordinateAbsolute,
    )
    || !finiteInRange(record.value.pressure, 0, 1)
    || !finiteInRange(record.value.tangentialPressure, -1, 1)
    || !finiteInRange(record.value.tiltX, -90, 90)
    || !finiteInRange(record.value.tiltY, -90, 90)
    || !finiteInRange(record.value.twist, 0, 360 - Number.EPSILON)
    || !finiteInRange(
      record.value.timeMilliseconds,
      0,
      STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxTimeMilliseconds,
    )
    || !safeUnsignedInteger(record.value.pointerId)
    || !uint32(record.value.flags)
  ) return fail("invalid-field", path);
  return {
    ok: true,
    value: {
      sequence: record.value.sequence,
      x: canonicalNumber(record.value.x),
      y: canonicalNumber(record.value.y),
      pressure: canonicalNumber(record.value.pressure),
      tangentialPressure: canonicalNumber(record.value.tangentialPressure),
      tiltX: canonicalNumber(record.value.tiltX),
      tiltY: canonicalNumber(record.value.tiltY),
      twist: canonicalNumber(record.value.twist),
      timeMilliseconds: canonicalNumber(record.value.timeMilliseconds),
      pointerId: record.value.pointerId,
      flags: record.value.flags,
    },
  };
}

function validateSource(
  input: unknown,
  path: string,
): ValidationResult<StudioCanonicalBrushSource> {
  const record = inspectRecord(
    input,
    ["encoding", "firstSequence", "lastSequence", "samples"],
    path,
  );
  if (!record.ok) return record;
  if (
    record.value.encoding !== "accepted-authoritative-samples-v1"
    || !safeUnsignedInteger(record.value.firstSequence)
    || !safeUnsignedInteger(record.value.lastSequence)
  ) return fail("invalid-field", path);
  const samples = inspectArray(
    record.value.samples,
    STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxSamples,
    `${path}.samples`,
  );
  if (!samples.ok) return samples;
  const accepted: StudioCanonicalBrushSourceSample[] = [];
  let previousSequence = -1;
  let previousTime = -1;
  for (let index = 0; index < samples.value.length; index += 1) {
    const sample = validateSourceSample(samples.value[index], `${path}.samples[${index}]`);
    if (!sample.ok) return sample;
    if (sample.value.sequence === previousSequence) {
      return fail("duplicate-sample-sequence", `${path}.samples[${index}].sequence`);
    }
    if (sample.value.sequence < previousSequence) {
      return fail("sample-sequence-order", `${path}.samples[${index}].sequence`);
    }
    if (sample.value.timeMilliseconds < previousTime) {
      return fail("sample-sequence-order", `${path}.samples[${index}].timeMilliseconds`);
    }
    previousSequence = sample.value.sequence;
    previousTime = sample.value.timeMilliseconds;
    accepted.push(sample.value);
  }
  if (
    record.value.firstSequence !== accepted[0]!.sequence
    || record.value.lastSequence !== accepted.at(-1)!.sequence
  ) return fail("accepted-prefix-mismatch", path);
  return {
    ok: true,
    value: {
      encoding: "accepted-authoritative-samples-v1",
      firstSequence: record.value.firstSequence,
      lastSequence: record.value.lastSequence,
      samples: accepted,
    },
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Validates an untrusted durable candidate, detaches it from caller-owned objects and deep-freezes
 * the result. Invalid data is never repaired, clamped, filtered or partially accepted.
 */
export function parseStudioCanonicalBrushPlan(
  input: unknown,
  state: StudioCanonicalBrushPlanValidationState,
): StudioCanonicalBrushPlanParseResult {
  if (
    !positiveSafeInteger(state.sessionEpoch)
    || !positiveSafeInteger(state.strokeEpoch)
    || !safeUnsignedInteger(state.lastAcceptedCommandSequence)
  ) return fail("invalid-field", "state");
  const record = inspectRecord(
    input,
    [
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
    ],
    "$",
  );
  if (!record.ok) return record;
  if (record.value.kind !== "studio-canonical-brush-plan") {
    return fail("invalid-field", "$.kind");
  }
  if (record.value.version !== STUDIO_CANONICAL_BRUSH_PLAN_VERSION) {
    return fail("unsupported-version", "$.version");
  }
  if (record.value.sessionEpoch !== state.sessionEpoch) {
    return fail("session-epoch-mismatch", "$.sessionEpoch");
  }
  if (record.value.strokeEpoch !== state.strokeEpoch) {
    return fail("stroke-epoch-mismatch", "$.strokeEpoch");
  }
  if (!positiveSafeInteger(record.value.commandSequence)) {
    return fail("invalid-field", "$.commandSequence");
  }
  if (record.value.commandSequence <= state.lastAcceptedCommandSequence) {
    return fail("duplicate-command-sequence", "$.commandSequence");
  }
  if (record.value.commandSequence !== state.lastAcceptedCommandSequence + 1) {
    return fail("command-sequence-gap", "$.commandSequence");
  }
  if (
    !identifier(record.value.strokeId)
    || !uint32(record.value.seed)
    || record.value.coordinateSpace !== "document-css-px"
  ) return fail("invalid-field", "$");
  const transform = validateTransform(record.value.transform, "$.transform");
  if (!transform.ok) return transform;
  const color = validateColor(record.value.color, "$.color");
  if (!color.ok) return color;
  const composite = validateComposite(record.value.composite, "$.composite");
  if (!composite.ok) return composite;
  const recipe = validateRecipe(record.value.recipe, "$.recipe");
  if (!recipe.ok) return recipe;
  const source = validateSource(record.value.source, "$.source");
  if (!source.ok) return source;
  const plan: StudioCanonicalBrushPlan = {
    kind: "studio-canonical-brush-plan",
    version: STUDIO_CANONICAL_BRUSH_PLAN_VERSION,
    sessionEpoch: state.sessionEpoch,
    strokeEpoch: state.strokeEpoch,
    commandSequence: record.value.commandSequence,
    strokeId: record.value.strokeId,
    seed: record.value.seed,
    coordinateSpace: "document-css-px",
    transform: transform.value,
    color: color.value,
    composite: composite.value,
    recipe: recipe.value,
    source: source.value,
  };
  return {
    ok: true,
    value: {
      plan: deepFreeze(plan),
      nextState: Object.freeze({
        sessionEpoch: state.sessionEpoch,
        strokeEpoch: state.strokeEpoch,
        lastAcceptedCommandSequence: plan.commandSequence,
      }),
    },
  };
}

/** Stable canonical JSON. Object order is schema order, never caller insertion order. */
export function encodeStudioCanonicalBrushPlan(plan: StudioCanonicalBrushPlan): string {
  return JSON.stringify(plan);
}

/**
 * Fast deterministic content identity over the canonical UTF-16 encoding. This is a replay/cache
 * identity, not a cryptographic integrity proof.
 */
export function hashStudioCanonicalBrushPlan(plan: StudioCanonicalBrushPlan): string {
  const encoded = encodeStudioCanonicalBrushPlan(plan);
  let hash = 0x811c9dc5;
  for (let index = 0; index < encoded.length; index += 1) {
    const code = encoded.charCodeAt(index);
    hash = Math.imul(hash ^ (code & 0xff), 0x01000193) >>> 0;
    hash = Math.imul(hash ^ (code >>> 8), 0x01000193) >>> 0;
  }
  return `fnv1a32-utf16:${hash.toString(16).padStart(8, "0")}`;
}
