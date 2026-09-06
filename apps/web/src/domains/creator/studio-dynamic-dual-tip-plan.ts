import {
  buildStudioEngineWebGpuTexturedBrushPlan,
  STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS,
} from "./render/studio-engine-webgpu-textured-brush-plan";
import {
  STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS,
  STUDIO_CANONICAL_BRUSH_PLAN_VERSION,
} from "./studio-canonical-brush-plan";
import {
  parseStudioProfessionalBrushDynamicsPlan,
} from "./studio-professional-brush-dynamics";
import { sha256HexPortable } from "./studio-sha256";

import type {
  StudioEngineWebGpuTexturedBrushAssetRequest,
  StudioEngineWebGpuTexturedBrushAssetResolver,
  StudioEngineWebGpuTexturedBrushPlan,
  StudioEngineWebGpuTexturedBrushResolvedAsset,
} from "./render/studio-engine-webgpu-textured-brush-plan";
import type {
  StudioCanonicalBrushPlan,
} from "./studio-canonical-brush-plan";
import type {
  StudioProfessionalBrushAcceptedSample,
  StudioProfessionalBrushDynamicsPlan,
} from "./studio-professional-brush-dynamics";

/**
 * Provider-neutral clean-room dynamic dual-tip planner.
 *
 * This module models only publicly documented artist-facing controls. It does not parse or emit a
 * vendor preset format. Version 1 preserves independently scheduled primary/secondary streams for
 * an aggregate preview only; that representation cannot encode exact per-deposition pairing.
 * Exact product rendering must use the versioned v2 deposition stream.
 */
export const STUDIO_DYNAMIC_DUAL_TIP_PLAN_VERSION = 1 as const;
export const STUDIO_DYNAMIC_DUAL_TIP_EXTENSION_VERSION = 1 as const;
export const STUDIO_DYNAMIC_DUAL_TIP_CAPABILITY_RECEIPT_VERSION = 1 as const;

export const STUDIO_DYNAMIC_DUAL_TIP_BUDGETS = Object.freeze({
  maxSecondaryStations: 65_536,
  maxSecondaryInstances: 65_536,
  maxCount: 64,
  maxAssetDimension: STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS.maxAssetDimension,
  maxAssetBytes: STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS.maxAssetBytes,
  maxTotalAssetBytes: STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS.maxTotalAssetBytes,
  maxCoordinateAbsolute: STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxCoordinateAbsolute,
  maxIdentifierCharacters: STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxIdentifierCharacters,
} as const);

export type StudioDynamicDualTipBlendFamily =
  | "intersect"
  | "darken"
  | "lighten"
  | "multiply"
  | "screen"
  | "add"
  | "subtract"
  | "difference";

export type StudioDynamicDualTipScatterAxes = "perpendicular-axis" | "both-axes";

export interface StudioDynamicDualTipR8AssetReference {
  readonly kind: "studio-dynamic-dual-tip-r8-reference";
  readonly version: 1;
  readonly assetId: string;
  readonly contentHash: `sha256:${string}`;
  readonly width: number;
  readonly height: number;
  readonly channel: "alpha" | "luminance";
}

export interface StudioDynamicDualTipUnits {
  readonly diameter: "canonical-local-css-px";
  readonly spacing: "document-css-px";
  readonly scatter: "document-css-px";
  readonly angle: "radians-relative-to-stroke";
}

export interface StudioDynamicDualTipExtension {
  readonly kind: "studio-dynamic-dual-tip-extension";
  readonly version: typeof STUDIO_DYNAMIC_DUAL_TIP_EXTENSION_VERSION;
  readonly secondaryTip: StudioDynamicDualTipR8AssetReference;
  readonly units: StudioDynamicDualTipUnits;
  readonly secondaryDiameter: number;
  readonly secondarySpacing: number;
  readonly scatterAxes: StudioDynamicDualTipScatterAxes;
  readonly scatterDistance: number;
  readonly count: number;
  readonly countJitter: number;
  readonly angleRadians: number;
  readonly roundness: number;
  readonly seed: number;
  readonly blendFamily: StudioDynamicDualTipBlendFamily;
  readonly secondaryOpacity: number;
}

export interface StudioDynamicDualTipProgress {
  readonly phase:
    | "primary"
    | "secondary-asset"
    | "secondary-stations"
    | "secondary-instances";
  readonly completed: number;
  readonly total: number;
}

export interface StudioDynamicDualTipPlanOptions {
  readonly mode?: "append" | "rebuild";
  readonly maximumPrimaryDabs?: number;
  readonly maximumSecondaryStations?: number;
  readonly maximumSecondaryInstances?: number;
  readonly maximumAssetBytes?: number;
  readonly maximumTotalAssetBytes?: number;
  readonly maximumCoordinateAbsolute?: number;
  readonly signal?: AbortSignal;
  readonly shouldCancel?: (progress: StudioDynamicDualTipProgress) => boolean;
}

export interface StudioDynamicDualTipSecondaryStation {
  readonly index: number;
  readonly arcLength: number;
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly localTangentX: number;
  readonly localTangentY: number;
  readonly documentTangentX: number;
  readonly documentTangentY: number;
  readonly documentNormalX: number;
  readonly documentNormalY: number;
  readonly instanceCount: number;
}

export interface StudioDynamicDualTipSecondaryInstance {
  readonly index: number;
  readonly stationIndex: number;
  readonly countIndex: number;
  readonly randomUint32: number;
  readonly assetIndex: number;
  readonly x: number;
  readonly y: number;
  readonly sourceDiameter: number;
  readonly opacity: number;
  readonly angleRadians: number;
  readonly roundness: number;
  /** Column-major unit-circle half-extent basis after the canonical affine transform. */
  readonly localToDocument: readonly [number, number, number, number];
}

export interface StudioDynamicDualTipPlan {
  readonly kind: "studio-dynamic-dual-tip-plan";
  readonly version: typeof STUDIO_DYNAMIC_DUAL_TIP_PLAN_VERSION;
  readonly mode: "append" | "rebuild";
  readonly strokeId: string;
  readonly commandSequence: number;
  readonly providerCapability: "dynamic-dual-tip-r8-aggregate-preview-v1";
  readonly executionRoute: "experimental-webgpu-aggregate-preview-v1";
  readonly exactExecutionRoute: "webgpu-exact-packed-deposition-v2";
  readonly fidelity: "aggregate-mask-preview-only";
  readonly singleTipFallback: "forbidden";
  readonly textureFormat: "rgba16float";
  readonly maskFormat: "r8-unorm";
  readonly primary: StudioEngineWebGpuTexturedBrushPlan;
  readonly secondaryAsset: StudioEngineWebGpuTexturedBrushResolvedAsset;
  readonly extension: StudioDynamicDualTipExtension;
  readonly secondaryStations: readonly StudioDynamicDualTipSecondaryStation[];
  readonly secondaryInstances: readonly StudioDynamicDualTipSecondaryInstance[];
  readonly fingerprint: `sha256:${string}`;
}

export interface StudioDynamicDualTipCapabilityReceipt {
  readonly kind: "studio-dynamic-dual-tip-capability-receipt";
  readonly version: typeof STUDIO_DYNAMIC_DUAL_TIP_CAPABILITY_RECEIPT_VERSION;
  readonly plannerVersion: typeof STUDIO_DYNAMIC_DUAL_TIP_PLAN_VERSION;
  readonly extensionVersion: typeof STUDIO_DYNAMIC_DUAL_TIP_EXTENSION_VERSION;
  readonly providerCapability: "dynamic-dual-tip-r8-aggregate-preview-v1";
  readonly executionRoute: "experimental-webgpu-aggregate-preview-v1";
  readonly exactExecutionRoute: "webgpu-exact-packed-deposition-v2";
  readonly fidelity: "aggregate-mask-preview-only";
  readonly singleTipFallback: "forbidden";
  readonly textureFormat: "rgba16float";
  readonly maskFormat: "r8-unorm";
  readonly mode: "append" | "rebuild";
  readonly strokeId: string;
  readonly commandSequence: number;
  readonly blendFamily: StudioDynamicDualTipBlendFamily;
  readonly primaryEventCount: number;
  readonly secondaryStationCount: number;
  readonly secondaryInstanceCount: number;
  readonly assetCount: number;
  readonly assetBytes: number;
  readonly fingerprint: `sha256:${string}`;
  readonly complete: false;
}

export type StudioDynamicDualTipUnsupportedReason =
  | "texture-primary-required"
  | "wet-media"
  | "unsupported-color-space"
  | "unsupported-blend-mode"
  | "primary-combination-unsupported";

export type StudioDynamicDualTipRejectionReason =
  | "invalid-options"
  | "invalid-canonical-plan"
  | "invalid-dynamics-plan"
  | "invalid-accepted-prefix"
  | "accepted-prefix-mismatch"
  | "invalid-extension"
  | "invalid-resolver"
  | "primary-plan-rejected"
  | "secondary-asset-unavailable"
  | "secondary-asset-payload-invalid"
  | "secondary-asset-identity-mismatch"
  | "secondary-asset-dimension-mismatch"
  | "secondary-asset-channel-mismatch"
  | "secondary-asset-byte-length-mismatch"
  | "secondary-asset-content-hash-mismatch"
  | "asset-budget-exceeded"
  | "station-limit-exceeded"
  | "instance-limit-exceeded"
  | "coordinate-budget-exceeded"
  | "numeric-overflow";

export type StudioDynamicDualTipPlanResult =
  | Readonly<{
      status: "ready";
      plan: StudioDynamicDualTipPlan;
      receipt: StudioDynamicDualTipCapabilityReceipt;
    }>
  | Readonly<{
      status: "unsupported";
      reason: StudioDynamicDualTipUnsupportedReason;
      path?: string;
      detail?: string;
    }>
  | Readonly<{
      status: "rejected";
      reason: StudioDynamicDualTipRejectionReason;
      path?: string;
      detail?: string;
    }>
  | Readonly<{
      status: "cancelled";
      phase: StudioDynamicDualTipProgress["phase"];
      completed: number;
      total: number;
    }>;

interface ParsedOptions {
  readonly mode: "append" | "rebuild";
  readonly maximumPrimaryDabs: number;
  readonly maximumSecondaryStations: number;
  readonly maximumSecondaryInstances: number;
  readonly maximumAssetBytes: number;
  readonly maximumTotalAssetBytes: number;
  readonly maximumCoordinateAbsolute: number;
  readonly signal: AbortSignal;
  readonly shouldCancel?: (progress: StudioDynamicDualTipProgress) => boolean;
}

interface CanonicalEnvelope {
  readonly plan: StudioCanonicalBrushPlan;
  readonly sourceSamples: readonly Readonly<Record<string, unknown>>[];
}

interface SecondaryPathPoint {
  readonly localX: number;
  readonly localY: number;
  readonly documentX: number;
  readonly documentY: number;
  readonly pressure: number;
}

interface MutableStation {
  readonly index: number;
  readonly arcLength: number;
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly localTangentX: number;
  readonly localTangentY: number;
  readonly documentTangentX: number;
  readonly documentTangentY: number;
  readonly documentNormalX: number;
  readonly documentNormalY: number;
  instanceCount: number;
}

const UINT32_MAX = 0xffff_ffff;
const TAU = Math.PI * 2;
const COUNT_SALT = 0x9e37_79b1;
const SCATTER_A_SALT = 0x85eb_ca77;
const SCATTER_B_SALT = 0xc2b2_ae3d;
const CANONICAL_KEYS = [
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
] as const;
const SOURCE_KEYS = ["encoding", "firstSequence", "lastSequence", "samples"] as const;
const CANONICAL_SAMPLE_KEYS = [
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
] as const;
const ACCEPTED_SAMPLE_KEYS = [
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
const TRANSFORM_KEYS = [
  "encoding",
  "m11",
  "m12",
  "m21",
  "m22",
  "translateX",
  "translateY",
] as const;
const COLOR_KEYS = ["space", "alphaMode", "components"] as const;
const COMPOSITE_KEYS = ["porterDuff", "blendMode", "opacity"] as const;
const RECIPE_KEYS = [
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
] as const;
const TEXTURE_TIP_KEYS = [
  "kind",
  "assetId",
  "contentHash",
  "channel",
  "width",
  "height",
] as const;
const ANALYTIC_TIP_KEYS = ["kind", "shape", "edgeSoftness"] as const;
const EXTENSION_KEYS = [
  "kind",
  "version",
  "secondaryTip",
  "units",
  "secondaryDiameter",
  "secondarySpacing",
  "scatterAxes",
  "scatterDistance",
  "count",
  "countJitter",
  "angleRadians",
  "roundness",
  "seed",
  "blendFamily",
  "secondaryOpacity",
] as const;
const SECONDARY_TIP_KEYS = [
  "kind",
  "version",
  "assetId",
  "contentHash",
  "width",
  "height",
  "channel",
] as const;
const UNIT_KEYS = ["diameter", "spacing", "scatter", "angle"] as const;
const OPTION_KEYS = [
  "mode",
  "maximumPrimaryDabs",
  "maximumSecondaryStations",
  "maximumSecondaryInstances",
  "maximumAssetBytes",
  "maximumTotalAssetBytes",
  "maximumCoordinateAbsolute",
  "signal",
  "shouldCancel",
] as const;
const PAYLOAD_KEYS = [
  "kind",
  "version",
  "assetId",
  "contentHash",
  "width",
  "height",
  "channel",
  "format",
  "byteLength",
  "bytes",
] as const;
const BLENDS: readonly StudioDynamicDualTipBlendFamily[] = [
  "intersect",
  "darken",
  "lighten",
  "multiply",
  "screen",
  "add",
  "subtract",
  "difference",
];

function finite(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && Number.isFinite(Math.fround(value));
}

function inRange(value: unknown, minimum: number, maximum: number): value is number {
  return finite(value) && value >= minimum && value <= maximum;
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function unsignedSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function uint32(value: unknown): value is number {
  return unsignedSafeInteger(value) && value <= UINT32_MAX;
}

function identifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxIdentifierCharacters
    && /^[A-Za-z0-9._:/+~-]+$/u.test(value);
}

function sha256Address(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function deepFreeze<T>(value: T): T {
  if (
    typeof value !== "object"
    || value === null
    || Object.isFrozen(value)
    || ArrayBuffer.isView(value)
  ) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function strictFrozenRecord(
  input: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> | null {
  try {
    if (
      typeof input !== "object"
      || input === null
      || Array.isArray(input)
      || !Object.isFrozen(input)
    ) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== expectedKeys.length
      || keys.some(
        (key) => typeof key !== "string" || !expectedKeys.includes(key),
      )
    ) return null;
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
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

function strictFrozenArray(input: unknown, maximum: number): readonly unknown[] | null {
  try {
    if (
      !Array.isArray(input)
      || !Object.isFrozen(input)
      || Object.getPrototypeOf(input) !== Array.prototype
      || input.length < 1
      || input.length > maximum
      || Object.getOwnPropertySymbols(input).length !== 0
    ) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Object.keys(descriptors);
    if (
      keys.length !== input.length + 1
      || keys.some((key) => key !== "length" && !/^(0|[1-9]\d*)$/u.test(key))
    ) return null;
    const result: unknown[] = [];
    for (let index = 0; index < input.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        !descriptor
        || descriptor.enumerable !== true
        || !Object.prototype.hasOwnProperty.call(descriptor, "value")
      ) return null;
      result.push(descriptor.value);
    }
    return result;
  } catch {
    return null;
  }
}

function optionalDataRecord(
  input: unknown,
  allowedKeys: readonly string[],
): Readonly<Record<string, unknown>> | null {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.some(
        (key) => typeof key !== "string" || !allowedKeys.includes(key),
      )
    ) return null;
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
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

function resolverBoundary(input: unknown): StudioEngineWebGpuTexturedBrushAssetResolver | null {
  const record = optionalDataRecord(input, ["resolve"]);
  if (
    !record
    || Reflect.ownKeys(record).length !== 1
    || typeof record.resolve !== "function"
  ) return null;
  const resolve = record.resolve as StudioEngineWebGpuTexturedBrushAssetResolver["resolve"];
  return Object.freeze({
    resolve(
      request: StudioEngineWebGpuTexturedBrushAssetRequest,
      signal: AbortSignal,
    ) {
      return Reflect.apply(resolve, undefined, [request, signal]) as Promise<unknown>;
    },
  });
}

function canonicalEnvelope(input: unknown): CanonicalEnvelope | null {
  const plan = strictFrozenRecord(input, CANONICAL_KEYS);
  if (
    !plan
    || plan.kind !== "studio-canonical-brush-plan"
    || plan.version !== STUDIO_CANONICAL_BRUSH_PLAN_VERSION
  ) return null;
  const source = strictFrozenRecord(plan.source, SOURCE_KEYS);
  const samples = source
    ? strictFrozenArray(
        source.samples,
        STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxSamples,
      )
    : null;
  if (!source || !samples) return null;
  const sourceSamples: Readonly<Record<string, unknown>>[] = [];
  for (const sample of samples) {
    const record = strictFrozenRecord(sample, CANONICAL_SAMPLE_KEYS);
    if (!record) return null;
    sourceSamples.push(record);
  }
  const transform = strictFrozenRecord(plan.transform, TRANSFORM_KEYS);
  const color = strictFrozenRecord(plan.color, COLOR_KEYS);
  const composite = strictFrozenRecord(plan.composite, COMPOSITE_KEYS);
  const recipe = strictFrozenRecord(plan.recipe, RECIPE_KEYS);
  if (!transform || !color || !composite || !recipe) return null;
  const textureTip = strictFrozenRecord(recipe.tip, TEXTURE_TIP_KEYS);
  const analyticTip = strictFrozenRecord(recipe.tip, ANALYTIC_TIP_KEYS);
  if (
    textureTip?.kind !== "texture"
    && analyticTip?.kind !== "analytic"
  ) return null;
  return Object.freeze({
    plan: input as StudioCanonicalBrushPlan,
    sourceSamples: Object.freeze(sourceSamples),
  });
}

function earlyUnsupported(
  envelope: CanonicalEnvelope,
): Extract<StudioDynamicDualTipPlanResult, { status: "unsupported" }> | null {
  const canonical = strictFrozenRecord(envelope.plan, CANONICAL_KEYS)!;
  const color = strictFrozenRecord(canonical.color, COLOR_KEYS)!;
  const composite = strictFrozenRecord(canonical.composite, COMPOSITE_KEYS)!;
  const recipe = strictFrozenRecord(canonical.recipe, RECIPE_KEYS)!;
  const textureTip = strictFrozenRecord(recipe.tip, TEXTURE_TIP_KEYS);
  if (textureTip?.kind !== "texture") {
    return Object.freeze({
      status: "unsupported",
      reason: "texture-primary-required",
      path: "$.recipe.tip",
    });
  }
  if (recipe.engine === "wet-media-v1" || recipe.wetMedia !== null) {
    return Object.freeze({ status: "unsupported", reason: "wet-media" });
  }
  if (color.space !== "linear-srgb") {
    return Object.freeze({
      status: "unsupported",
      reason: "unsupported-color-space",
      path: "$.color.space",
      detail: String(color.space),
    });
  }
  if (composite.blendMode !== "normal") {
    return Object.freeze({
      status: "unsupported",
      reason: "unsupported-blend-mode",
      path: "$.composite.blendMode",
      detail: String(composite.blendMode),
    });
  }
  return null;
}

function parseAcceptedPrefix(
  input: unknown,
): readonly StudioProfessionalBrushAcceptedSample[] | null {
  const values = strictFrozenArray(
    input,
    STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxSamples,
  );
  if (!values) return null;
  const result: StudioProfessionalBrushAcceptedSample[] = [];
  let previousSequence = -1;
  let previousTick = -1;
  for (const inputSample of values) {
    const sample = strictFrozenRecord(inputSample, ACCEPTED_SAMPLE_KEYS);
    if (
      !sample
      || !unsignedSafeInteger(sample.sequence)
      || sample.sequence <= previousSequence
      || !unsignedSafeInteger(sample.timeTick)
      || sample.timeTick < previousTick
      || !inRange(
        sample.x,
        -STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxCoordinateAbsolute,
        STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxCoordinateAbsolute,
      )
      || !inRange(
        sample.y,
        -STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxCoordinateAbsolute,
        STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxCoordinateAbsolute,
      )
      || !inRange(sample.pressure, 0, 1)
      || !inRange(sample.tiltXDegrees, -90, 90)
      || !inRange(sample.tiltYDegrees, -90, 90)
      || !inRange(sample.tangentialPressure, -1, 1)
      || !inRange(sample.twistDegrees, 0, 360 - Number.EPSILON)
    ) return null;
    result.push(Object.freeze({
      sequence: sample.sequence,
      timeTick: sample.timeTick,
      x: sample.x,
      y: sample.y,
      pressure: sample.pressure,
      tiltXDegrees: sample.tiltXDegrees,
      tiltYDegrees: sample.tiltYDegrees,
      tangentialPressure: sample.tangentialPressure,
      twistDegrees: sample.twistDegrees,
    }));
    previousSequence = sample.sequence;
    previousTick = sample.timeTick;
  }
  return Object.freeze(result);
}

function prefixMatchesCanonical(
  prefix: readonly StudioProfessionalBrushAcceptedSample[],
  canonicalSamples: readonly Readonly<Record<string, unknown>>[],
  dynamics: StudioProfessionalBrushDynamicsPlan,
): boolean {
  if (prefix.length !== canonicalSamples.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    const accepted = prefix[index]!;
    const canonical = canonicalSamples[index]!;
    if (
      accepted.sequence !== canonical.sequence
      || accepted.x !== canonical.x
      || accepted.y !== canonical.y
      || accepted.pressure !== canonical.pressure
      || accepted.tiltXDegrees !== canonical.tiltX
      || accepted.tiltYDegrees !== canonical.tiltY
      || accepted.tangentialPressure !== canonical.tangentialPressure
      || accepted.twistDegrees !== canonical.twist
      || accepted.timeTick * dynamics.clock.tickMilliseconds
        !== canonical.timeMilliseconds
    ) return false;
  }
  return true;
}

function parseExtension(input: unknown): StudioDynamicDualTipExtension | null {
  const value = strictFrozenRecord(input, EXTENSION_KEYS);
  if (
    !value
    || value.kind !== "studio-dynamic-dual-tip-extension"
    || value.version !== STUDIO_DYNAMIC_DUAL_TIP_EXTENSION_VERSION
    || !inRange(value.secondaryDiameter, 0.01, 65_536)
    || !inRange(value.secondarySpacing, 0.01, 1_000_000)
    || (
      value.scatterAxes !== "perpendicular-axis"
      && value.scatterAxes !== "both-axes"
    )
    || !inRange(value.scatterDistance, 0, 1_000_000)
    || !positiveSafeInteger(value.count)
    || value.count > STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxCount
    || !unsignedSafeInteger(value.countJitter)
    || value.countJitter >= value.count
    || value.count + value.countJitter > STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxCount
    || !inRange(value.angleRadians, -TAU, TAU)
    || !inRange(value.roundness, 0.01, 1)
    || !uint32(value.seed)
    || !BLENDS.includes(value.blendFamily as StudioDynamicDualTipBlendFamily)
    || !inRange(value.secondaryOpacity, 0, 1)
  ) return null;
  const tip = strictFrozenRecord(value.secondaryTip, SECONDARY_TIP_KEYS);
  const units = strictFrozenRecord(value.units, UNIT_KEYS);
  if (
    !tip
    || tip.kind !== "studio-dynamic-dual-tip-r8-reference"
    || tip.version !== 1
    || !identifier(tip.assetId)
    || !sha256Address(tip.contentHash)
    || !positiveSafeInteger(tip.width)
    || tip.width > STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxAssetDimension
    || !positiveSafeInteger(tip.height)
    || tip.height > STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxAssetDimension
    || (tip.channel !== "alpha" && tip.channel !== "luminance")
    || !units
    || units.diameter !== "canonical-local-css-px"
    || units.spacing !== "document-css-px"
    || units.scatter !== "document-css-px"
    || units.angle !== "radians-relative-to-stroke"
  ) return null;
  return deepFreeze({
    kind: "studio-dynamic-dual-tip-extension",
    version: STUDIO_DYNAMIC_DUAL_TIP_EXTENSION_VERSION,
    secondaryTip: {
      kind: "studio-dynamic-dual-tip-r8-reference",
      version: 1,
      assetId: tip.assetId,
      contentHash: tip.contentHash,
      width: tip.width,
      height: tip.height,
      channel: tip.channel,
    },
    units: {
      diameter: "canonical-local-css-px",
      spacing: "document-css-px",
      scatter: "document-css-px",
      angle: "radians-relative-to-stroke",
    },
    secondaryDiameter: value.secondaryDiameter,
    secondarySpacing: value.secondarySpacing,
    scatterAxes: value.scatterAxes,
    scatterDistance: value.scatterDistance,
    count: value.count,
    countJitter: value.countJitter,
    angleRadians: value.angleRadians,
    roundness: value.roundness,
    seed: value.seed,
    blendFamily: value.blendFamily as StudioDynamicDualTipBlendFamily,
    secondaryOpacity: value.secondaryOpacity,
  } satisfies StudioDynamicDualTipExtension);
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof AbortSignal !== "undefined" && value instanceof AbortSignal;
}

function parseOptions(input: unknown): ParsedOptions | null {
  const value = optionalDataRecord(input, OPTION_KEYS);
  if (!value) return null;
  const mode = value.mode ?? "rebuild";
  const maximumPrimaryDabs = value.maximumPrimaryDabs
    ?? STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS.maxDabs;
  const maximumSecondaryStations = value.maximumSecondaryStations
    ?? STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxSecondaryStations;
  const maximumSecondaryInstances = value.maximumSecondaryInstances
    ?? STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxSecondaryInstances;
  const maximumAssetBytes = value.maximumAssetBytes
    ?? STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxAssetBytes;
  const maximumTotalAssetBytes = value.maximumTotalAssetBytes
    ?? STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxTotalAssetBytes;
  const maximumCoordinateAbsolute = value.maximumCoordinateAbsolute
    ?? STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxCoordinateAbsolute;
  const ownController = new AbortController();
  const signal = value.signal ?? ownController.signal;
  if (
    (mode !== "append" && mode !== "rebuild")
    || !positiveSafeInteger(maximumPrimaryDabs)
    || maximumPrimaryDabs > STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS.maxDabs
    || !positiveSafeInteger(maximumSecondaryStations)
    || maximumSecondaryStations
      > STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxSecondaryStations
    || !positiveSafeInteger(maximumSecondaryInstances)
    || maximumSecondaryInstances
      > STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxSecondaryInstances
    || !positiveSafeInteger(maximumAssetBytes)
    || maximumAssetBytes > STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxAssetBytes
    || !positiveSafeInteger(maximumTotalAssetBytes)
    || maximumTotalAssetBytes > STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxTotalAssetBytes
    || !inRange(
      maximumCoordinateAbsolute,
      1,
      STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxCoordinateAbsolute,
    )
    || !isAbortSignal(signal)
    || (
      value.shouldCancel !== undefined
      && typeof value.shouldCancel !== "function"
    )
  ) return null;
  return Object.freeze({
    mode,
    maximumPrimaryDabs,
    maximumSecondaryStations,
    maximumSecondaryInstances,
    maximumAssetBytes,
    maximumTotalAssetBytes,
    maximumCoordinateAbsolute,
    signal,
    ...(value.shouldCancel === undefined
      ? {}
      : {
          shouldCancel: value.shouldCancel as (
            progress: StudioDynamicDualTipProgress,
          ) => boolean,
        }),
  });
}

function isCancelled(
  options: ParsedOptions,
  progress: StudioDynamicDualTipProgress,
): boolean {
  if (options.signal.aborted) return true;
  try {
    return options.shouldCancel?.(Object.freeze(progress)) === true;
  } catch {
    return true;
  }
}

function cancelledResult(
  phase: StudioDynamicDualTipProgress["phase"],
  completed: number,
  total: number,
): Extract<StudioDynamicDualTipPlanResult, { status: "cancelled" }> {
  return Object.freeze({ status: "cancelled", phase, completed, total });
}

function payloadRecord(input: unknown): Readonly<Record<string, unknown>> | null {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
    if (Object.getPrototypeOf(input) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== PAYLOAD_KEYS.length
      || keys.some(
        (key) => (
          typeof key !== "string"
          || !(PAYLOAD_KEYS as readonly string[]).includes(key)
        ),
      )
    ) return null;
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of PAYLOAD_KEYS) {
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

async function resolveSecondaryAsset(
  resolver: StudioEngineWebGpuTexturedBrushAssetResolver,
  extension: StudioDynamicDualTipExtension,
  assetIndex: number,
  options: ParsedOptions,
): Promise<
  | Readonly<{ status: "ready"; asset: StudioEngineWebGpuTexturedBrushResolvedAsset }>
  | Extract<StudioDynamicDualTipPlanResult, { status: "rejected" | "cancelled" }>
> {
  const reference = extension.secondaryTip;
  const request: StudioEngineWebGpuTexturedBrushAssetRequest = Object.freeze({
    kind: "studio-textured-brush-asset-request",
    version: 1,
    role: "tip",
    assetId: reference.assetId,
    contentHash: reference.contentHash,
    expectedWidth: reference.width,
    expectedHeight: reference.height,
    expectedChannel: reference.channel,
    maximumByteLength: options.maximumAssetBytes,
  });
  if (isCancelled(options, { phase: "secondary-asset", completed: 0, total: 1 })) {
    return cancelledResult("secondary-asset", 0, 1);
  }
  let payload: unknown;
  try {
    payload = await resolver.resolve(request, options.signal);
  } catch {
    return options.signal.aborted
      ? cancelledResult("secondary-asset", 0, 1)
      : Object.freeze({
          status: "rejected",
          reason: "secondary-asset-unavailable",
        });
  }
  if (isCancelled(options, { phase: "secondary-asset", completed: 1, total: 1 })) {
    return cancelledResult("secondary-asset", 1, 1);
  }
  const record = payloadRecord(payload);
  if (
    !record
    || record.kind !== "studio-textured-brush-r8-asset"
    || record.version !== 1
    || record.format !== "r8-unorm"
    || !positiveSafeInteger(record.width)
    || !positiveSafeInteger(record.height)
    || !positiveSafeInteger(record.byteLength)
    || !(record.bytes instanceof Uint8Array)
    || Object.getPrototypeOf(record.bytes) !== Uint8Array.prototype
    || (
      typeof SharedArrayBuffer !== "undefined"
      && record.bytes.buffer instanceof SharedArrayBuffer
    )
  ) {
    return Object.freeze({
      status: "rejected",
      reason: "secondary-asset-payload-invalid",
    });
  }
  if (record.assetId !== reference.assetId || record.contentHash !== reference.contentHash) {
    return Object.freeze({
      status: "rejected",
      reason: "secondary-asset-identity-mismatch",
    });
  }
  if (record.width !== reference.width || record.height !== reference.height) {
    return Object.freeze({
      status: "rejected",
      reason: "secondary-asset-dimension-mismatch",
    });
  }
  if (record.channel !== reference.channel) {
    return Object.freeze({
      status: "rejected",
      reason: "secondary-asset-channel-mismatch",
    });
  }
  const expectedBytes = record.width * record.height;
  if (
    !Number.isSafeInteger(expectedBytes)
    || expectedBytes > options.maximumAssetBytes
    || record.byteLength !== expectedBytes
    || record.bytes.byteLength !== expectedBytes
  ) {
    return Object.freeze({
      status: "rejected",
      reason: expectedBytes > options.maximumAssetBytes
        ? "asset-budget-exceeded"
        : "secondary-asset-byte-length-mismatch",
    });
  }
  const bytes = new Uint8Array(record.bytes);
  if (
    !sha256Address(record.contentHash)
    || record.contentHash !== `sha256:${sha256HexPortable(bytes)}`
  ) {
    return Object.freeze({
      status: "rejected",
      reason: "secondary-asset-content-hash-mismatch",
    });
  }
  return {
    status: "ready",
    asset: Object.freeze({
      assetIndex,
      role: "tip",
      assetId: reference.assetId,
      contentHash: reference.contentHash,
      width: reference.width,
      height: reference.height,
      channel: reference.channel,
      format: "r8-unorm",
      byteLength: bytes.byteLength,
      bytes,
    }),
  };
}

function transformPoint(
  canonical: StudioCanonicalBrushPlan,
  x: number,
  y: number,
): readonly [number, number] {
  return [
    canonical.transform.m11 * x
      + canonical.transform.m21 * y
      + canonical.transform.translateX,
    canonical.transform.m12 * x
      + canonical.transform.m22 * y
      + canonical.transform.translateY,
  ];
}

function transformVector(
  canonical: StudioCanonicalBrushPlan,
  x: number,
  y: number,
): readonly [number, number] {
  return [
    canonical.transform.m11 * x + canonical.transform.m21 * y,
    canonical.transform.m12 * x + canonical.transform.m22 * y,
  ];
}

function gpuCoordinate(value: number, maximum: number): number | null {
  const rounded = Math.fround(value);
  return Number.isFinite(value)
    && Number.isFinite(rounded)
    && Math.abs(rounded) <= maximum
    ? (Object.is(rounded, -0) ? 0 : rounded)
    : null;
}

function gpuNumber(value: number): number | null {
  const rounded = Math.fround(value);
  return Number.isFinite(value) && Number.isFinite(rounded)
    ? (Object.is(rounded, -0) ? 0 : rounded)
    : null;
}

function pathPoints(
  canonical: StudioCanonicalBrushPlan,
  prefix: readonly StudioProfessionalBrushAcceptedSample[],
  maximumCoordinateAbsolute: number,
): readonly SecondaryPathPoint[] | null {
  const result: SecondaryPathPoint[] = [];
  for (const accepted of prefix) {
    const document = transformPoint(canonical, accepted.x, accepted.y);
    const documentX = gpuCoordinate(document[0], maximumCoordinateAbsolute);
    const documentY = gpuCoordinate(document[1], maximumCoordinateAbsolute);
    if (documentX === null || documentY === null) return null;
    result.push(Object.freeze({
      localX: accepted.x,
      localY: accepted.y,
      documentX,
      documentY,
      pressure: accepted.pressure,
    }));
  }
  return Object.freeze(result);
}

function cumulativeDistances(points: readonly SecondaryPathPoint[]): Float64Array | null {
  const cumulative = new Float64Array(points.length);
  let total = 0;
  let compensation = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const length = Math.hypot(
      current.documentX - previous.documentX,
      current.documentY - previous.documentY,
    );
    if (!Number.isFinite(length)) return null;
    const corrected = length - compensation;
    const next = total + corrected;
    compensation = (next - total) - corrected;
    total = next;
    if (!Number.isFinite(total)) return null;
    cumulative[index] = total;
  }
  return cumulative;
}

function nonZeroSegment(
  points: readonly SecondaryPathPoint[],
  cumulative: Float64Array,
  preferredUpper: number,
): number | null {
  for (let upper = preferredUpper; upper < points.length; upper += 1) {
    if (cumulative[upper]! > cumulative[upper - 1]!) return upper;
  }
  for (let upper = preferredUpper - 1; upper >= 1; upper -= 1) {
    if (cumulative[upper]! > cumulative[upper - 1]!) return upper;
  }
  return null;
}

function stationAt(
  canonical: StudioCanonicalBrushPlan,
  points: readonly SecondaryPathPoint[],
  cumulative: Float64Array,
  distance: number,
  index: number,
): MutableStation | null {
  let upper = 1;
  while (upper < cumulative.length - 1 && cumulative[upper]! < distance) {
    upper += 1;
  }
  const segmentUpper = nonZeroSegment(points, cumulative, upper);
  const first = points[0]!;
  if (segmentUpper === null) {
    let localTangentX = 1;
    let localTangentY = 0;
    let transformed = transformVector(canonical, localTangentX, localTangentY);
    let transformedLength = Math.hypot(transformed[0], transformed[1]);
    if (!Number.isFinite(transformedLength) || transformedLength <= 0) {
      localTangentX = 0;
      localTangentY = 1;
      transformed = transformVector(canonical, localTangentX, localTangentY);
      transformedLength = Math.hypot(transformed[0], transformed[1]);
    }
    if (!Number.isFinite(transformedLength) || transformedLength <= 0) return null;
    const documentTangentX = transformed[0] / transformedLength;
    const documentTangentY = transformed[1] / transformedLength;
    return {
      index,
      arcLength: 0,
      x: first.documentX,
      y: first.documentY,
      pressure: first.pressure,
      localTangentX,
      localTangentY,
      documentTangentX,
      documentTangentY,
      documentNormalX: -documentTangentY,
      documentNormalY: documentTangentX,
      instanceCount: 0,
    };
  }
  const lower = segmentUpper - 1;
  const start = points[lower]!;
  const end = points[segmentUpper]!;
  const span = cumulative[segmentUpper]! - cumulative[lower]!;
  const amount = Math.max(
    0,
    Math.min(1, (distance - cumulative[lower]!) / span),
  );
  const localDeltaX = end.localX - start.localX;
  const localDeltaY = end.localY - start.localY;
  const localLength = Math.hypot(localDeltaX, localDeltaY);
  const documentDeltaX = end.documentX - start.documentX;
  const documentDeltaY = end.documentY - start.documentY;
  const documentLength = Math.hypot(documentDeltaX, documentDeltaY);
  if (
    !Number.isFinite(localLength)
    || !Number.isFinite(documentLength)
    || localLength <= 0
    || documentLength <= 0
  ) return null;
  const documentTangentX = documentDeltaX / documentLength;
  const documentTangentY = documentDeltaY / documentLength;
  return {
    index,
    arcLength: distance,
    x: start.documentX + documentDeltaX * amount,
    y: start.documentY + documentDeltaY * amount,
    pressure: start.pressure + (end.pressure - start.pressure) * amount,
    localTangentX: localDeltaX / localLength,
    localTangentY: localDeltaY / localLength,
    documentTangentX,
    documentTangentY,
    documentNormalX: -documentTangentY,
    documentNormalY: documentTangentX,
    instanceCount: 0,
  };
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

function instanceRandom(
  seed: number,
  stationIndex: number,
  countIndex: number,
  salt: number,
): number {
  return mixUint32(
    seed
      ^ Math.imul(stationIndex + 1, 0x27d4_eb2f)
      ^ Math.imul(countIndex + 1, 0x1656_67b1)
      ^ salt,
  );
}

function unitFromUint32(value: number): number {
  return value / 0x1_0000_0000;
}

function countForStation(
  extension: StudioDynamicDualTipExtension,
  stationIndex: number,
): number {
  if (extension.countJitter === 0) return extension.count;
  const range = extension.countJitter * 2 + 1;
  const delta = (
    instanceRandom(extension.seed, stationIndex, 0, COUNT_SALT) % range
  ) - extension.countJitter;
  return extension.count + delta;
}

function secondaryDistances(
  totalLength: number,
  spacing: number,
  maximumStations: number,
): readonly number[] | null {
  if (totalLength === 0) return Object.freeze([0]);
  const expected = Math.floor(totalLength / spacing) + 2;
  if (expected > maximumStations) return null;
  const distances = [0];
  while (distances.at(-1)! < totalLength) {
    const next = distances.at(-1)! + spacing;
    if (!Number.isFinite(next) || next <= distances.at(-1)!) return null;
    if (distances.length >= maximumStations) return null;
    distances.push(next >= totalLength ? totalLength : next);
  }
  return Object.freeze(distances);
}

function buildSecondaryGeometry(
  canonical: StudioCanonicalBrushPlan,
  prefix: readonly StudioProfessionalBrushAcceptedSample[],
  extension: StudioDynamicDualTipExtension,
  assetIndex: number,
  options: ParsedOptions,
):
  | Readonly<{
      status: "ready";
      stations: readonly StudioDynamicDualTipSecondaryStation[];
      instances: readonly StudioDynamicDualTipSecondaryInstance[];
    }>
  | Extract<StudioDynamicDualTipPlanResult, { status: "rejected" | "cancelled" }> {
  const points = pathPoints(canonical, prefix, options.maximumCoordinateAbsolute);
  if (!points) {
    return Object.freeze({
      status: "rejected",
      reason: "coordinate-budget-exceeded",
    });
  }
  const cumulative = cumulativeDistances(points);
  if (!cumulative) {
    return Object.freeze({ status: "rejected", reason: "numeric-overflow" });
  }
  const totalLength = cumulative.at(-1) ?? 0;
  const distances = secondaryDistances(
    totalLength,
    extension.secondarySpacing,
    options.maximumSecondaryStations,
  );
  if (!distances) {
    return Object.freeze({
      status: "rejected",
      reason: "station-limit-exceeded",
    });
  }
  const mutableStations: MutableStation[] = [];
  for (let index = 0; index < distances.length; index += 1) {
    if (isCancelled(options, {
      phase: "secondary-stations",
      completed: index,
      total: distances.length,
    })) return cancelledResult("secondary-stations", index, distances.length);
    const station = stationAt(
      canonical,
      points,
      cumulative,
      distances[index]!,
      index,
    );
    if (!station) {
      return Object.freeze({ status: "rejected", reason: "numeric-overflow" });
    }
    mutableStations.push(station);
  }

  let totalInstances = 0;
  for (const station of mutableStations) {
    const stationCount = countForStation(extension, station.index);
    if (
      stationCount < 1
      || stationCount > STUDIO_DYNAMIC_DUAL_TIP_BUDGETS.maxCount
      || totalInstances + stationCount > options.maximumSecondaryInstances
    ) {
      return Object.freeze({
        status: "rejected",
        reason: "instance-limit-exceeded",
      });
    }
    station.instanceCount = stationCount;
    totalInstances += stationCount;
  }

  const instances: StudioDynamicDualTipSecondaryInstance[] = [];
  for (const station of mutableStations) {
    const stationCount = station.instanceCount;
    for (let countIndex = 0; countIndex < stationCount; countIndex += 1) {
      if (isCancelled(options, {
        phase: "secondary-instances",
        completed: instances.length,
        total: totalInstances,
      })) {
        return cancelledResult(
          "secondary-instances",
          instances.length,
          totalInstances,
        );
      }
      const randomA = instanceRandom(
        extension.seed,
        station.index,
        countIndex,
        SCATTER_A_SALT,
      );
      const randomB = instanceRandom(
        extension.seed,
        station.index,
        countIndex,
        SCATTER_B_SALT,
      );
      const unitA = unitFromUint32(randomA);
      const unitB = unitFromUint32(randomB);
      let tangentOffset = 0;
      let normalOffset: number;
      if (extension.scatterAxes === "perpendicular-axis") {
        normalOffset = (unitA * 2 - 1) * extension.scatterDistance;
      } else {
        const radius = Math.sqrt(unitA) * extension.scatterDistance;
        const angle = unitB * TAU;
        tangentOffset = Math.cos(angle) * radius;
        normalOffset = Math.sin(angle) * radius;
      }
      const x = station.x
        + station.documentTangentX * tangentOffset
        + station.documentNormalX * normalOffset;
      const y = station.y
        + station.documentTangentY * tangentOffset
        + station.documentNormalY * normalOffset;
      const localCosine = Math.cos(extension.angleRadians);
      const localSine = Math.sin(extension.angleRadians);
      const directionX = station.localTangentX * localCosine
        - station.localTangentY * localSine;
      const directionY = station.localTangentX * localSine
        + station.localTangentY * localCosine;
      const normalX = -directionY;
      const normalY = directionX;
      const radius = extension.secondaryDiameter * 0.5;
      const basisX = transformVector(
        canonical,
        directionX * radius,
        directionY * radius,
      );
      const basisY = transformVector(
        canonical,
        normalX * radius * extension.roundness,
        normalY * radius * extension.roundness,
      );
      const numeric = [
        x,
        y,
        extension.secondaryDiameter,
        basisX[0],
        basisX[1],
        basisY[0],
        basisY[1],
      ].map((value) => gpuCoordinate(value, options.maximumCoordinateAbsolute));
      if (numeric.some((value) => value === null)) {
        return Object.freeze({
          status: "rejected",
          reason: "coordinate-budget-exceeded",
        });
      }
      const [
        gpuX,
        gpuY,
        diameter,
        xx,
        xy,
        yx,
        yy,
      ] = numeric as number[];
      const determinant = Math.fround(xx! * yy! - xy! * yx!);
      const opacity = gpuNumber(extension.secondaryOpacity);
      const angleRadians = gpuNumber(Math.atan2(xy!, xx!));
      const roundness = gpuNumber(extension.roundness);
      if (
        !Number.isFinite(determinant)
        || determinant === 0
        || diameter! <= 0
        || opacity === null
        || angleRadians === null
        || roundness === null
      ) {
        return Object.freeze({ status: "rejected", reason: "numeric-overflow" });
      }
      instances.push(Object.freeze({
        index: instances.length,
        stationIndex: station.index,
        countIndex,
        randomUint32: randomA,
        assetIndex,
        x: gpuX!,
        y: gpuY!,
        sourceDiameter: diameter!,
        opacity,
        angleRadians,
        roundness,
        localToDocument: Object.freeze([xx!, xy!, yx!, yy!] as const),
      }));
    }
  }
  const stations = mutableStations.map((station) => Object.freeze({
    index: station.index,
    arcLength: Math.fround(station.arcLength),
    x: Math.fround(station.x),
    y: Math.fround(station.y),
    pressure: Math.fround(station.pressure),
    localTangentX: Math.fround(station.localTangentX),
    localTangentY: Math.fround(station.localTangentY),
    documentTangentX: Math.fround(station.documentTangentX),
    documentTangentY: Math.fround(station.documentTangentY),
    documentNormalX: Math.fround(station.documentNormalX),
    documentNormalY: Math.fround(station.documentNormalY),
    instanceCount: station.instanceCount,
  }));
  return Object.freeze({
    status: "ready",
    stations: Object.freeze(stations),
    instances: Object.freeze(instances),
  });
}

function fingerprint(
  mode: "append" | "rebuild",
  primary: StudioEngineWebGpuTexturedBrushPlan,
  secondaryAsset: StudioEngineWebGpuTexturedBrushResolvedAsset,
  extension: StudioDynamicDualTipExtension,
  stations: readonly StudioDynamicDualTipSecondaryStation[],
  instances: readonly StudioDynamicDualTipSecondaryInstance[],
): `sha256:${string}` {
  const primaryIdentity = {
    version: primary.version,
    loweringVersion: primary.loweringVersion,
    mode: primary.mode,
    strokeId: primary.strokeId,
    commandSequence: primary.commandSequence,
    assets: primary.assets.map((asset) => [
      asset.assetIndex,
      asset.role,
      asset.assetId,
      asset.contentHash,
      asset.width,
      asset.height,
      asset.channel,
      asset.format,
      asset.byteLength,
    ]),
    dabs: primary.dabs.map((dab) => [
      dab.index,
      dab.stationX,
      dab.stationY,
      dab.x,
      dab.y,
      dab.pressure,
      dab.diameter,
      dab.opacity,
      dab.flow,
      dab.grainDepth,
      ...dab.color.components,
      dab.composite.porterDuff,
      dab.tip.hardness,
      dab.tip.roundness,
      dab.tip.angleRadians,
      ...dab.tip.localToDocument,
    ]),
    batches: primary.batches.map((batch) => [
      batch.key,
      batch.tipAssetIndex,
      batch.grainAssetIndex,
      batch.porterDuff,
      batch.firstInstance,
      batch.instanceCount,
    ]),
  };
  const payload = JSON.stringify({
    planner: "studio-dynamic-dual-tip-v1",
    mode,
    primary: primaryIdentity,
    secondaryAsset: [
      secondaryAsset.assetIndex,
      secondaryAsset.assetId,
      secondaryAsset.contentHash,
      secondaryAsset.width,
      secondaryAsset.height,
      secondaryAsset.channel,
      secondaryAsset.byteLength,
    ],
    extension,
    stations: stations.map((station) => [
      station.index,
      station.arcLength,
      station.x,
      station.y,
      station.pressure,
      station.localTangentX,
      station.localTangentY,
      station.documentTangentX,
      station.documentTangentY,
      station.documentNormalX,
      station.documentNormalY,
      station.instanceCount,
    ]),
    instances: instances.map((instance) => [
      instance.index,
      instance.stationIndex,
      instance.countIndex,
      instance.randomUint32,
      instance.assetIndex,
      instance.x,
      instance.y,
      instance.sourceDiameter,
      instance.opacity,
      instance.angleRadians,
      instance.roundness,
      ...instance.localToDocument,
    ]),
  });
  return `sha256:${sha256HexPortable(new TextEncoder().encode(payload))}`;
}

function mapPrimaryUnsupported(
  reason: string,
  detail?: string,
): Extract<StudioDynamicDualTipPlanResult, { status: "unsupported" }> {
  if (reason === "analytic-tip-provider-required") {
    return Object.freeze({ status: "unsupported", reason: "texture-primary-required" });
  }
  if (reason === "wet-media") {
    return Object.freeze({ status: "unsupported", reason: "wet-media" });
  }
  if (reason === "unsupported-color-space") {
    return Object.freeze({
      status: "unsupported",
      reason: "unsupported-color-space",
      ...(detail ? { detail } : {}),
    });
  }
  if (reason === "unsupported-blend-mode") {
    return Object.freeze({
      status: "unsupported",
      reason: "unsupported-blend-mode",
      ...(detail ? { detail } : {}),
    });
  }
  return Object.freeze({
    status: "unsupported",
    reason: "primary-combination-unsupported",
    detail: reason,
  });
}

/**
 * Builds a complete, immutable dynamic dual-tip plan. The current single-tip runtime is never
 * called: its plan is retained only as the primary event stream and mask description for the
 * aggregate-preview provider. Exact rendering requires a v2 stream that pairs both tips inside
 * each logical deposition before authority compositing.
 */
export async function buildStudioDynamicDualTipPlan(
  canonicalInput: unknown,
  dynamicsInput: unknown,
  acceptedPrefixInput: unknown,
  extensionInput: unknown,
  resolverInput: unknown,
  optionsInput: StudioDynamicDualTipPlanOptions = {},
): Promise<StudioDynamicDualTipPlanResult> {
  const options = parseOptions(optionsInput);
  if (!options) {
    return Object.freeze({ status: "rejected", reason: "invalid-options" });
  }
  const resolver = resolverBoundary(resolverInput);
  if (!resolver) {
    return Object.freeze({ status: "rejected", reason: "invalid-resolver" });
  }
  const envelope = canonicalEnvelope(canonicalInput);
  if (!envelope) {
    return Object.freeze({
      status: "rejected",
      reason: "invalid-canonical-plan",
    });
  }
  const unsupported = earlyUnsupported(envelope);
  if (unsupported) return unsupported;
  const dynamics = parseStudioProfessionalBrushDynamicsPlan(dynamicsInput);
  if (!dynamics.ok) {
    return Object.freeze({
      status: "rejected",
      reason: "invalid-dynamics-plan",
      path: dynamics.path,
    });
  }
  const acceptedPrefix = parseAcceptedPrefix(acceptedPrefixInput);
  if (!acceptedPrefix) {
    return Object.freeze({
      status: "rejected",
      reason: "invalid-accepted-prefix",
    });
  }
  if (!prefixMatchesCanonical(acceptedPrefix, envelope.sourceSamples, dynamics.plan)) {
    return Object.freeze({
      status: "rejected",
      reason: "accepted-prefix-mismatch",
    });
  }
  const extension = parseExtension(extensionInput);
  if (!extension) {
    return Object.freeze({ status: "rejected", reason: "invalid-extension" });
  }
  if (isCancelled(options, { phase: "primary", completed: 0, total: 1 })) {
    return cancelledResult("primary", 0, 1);
  }

  const primaryResult = await buildStudioEngineWebGpuTexturedBrushPlan(
    envelope.plan,
    dynamics.plan,
    resolver,
    {
      mode: options.mode,
      maximumDabs: options.maximumPrimaryDabs,
      maximumAssetBytes: options.maximumAssetBytes,
      maximumTotalAssetBytes: options.maximumTotalAssetBytes,
      maximumCoordinateAbsolute: options.maximumCoordinateAbsolute,
      signal: options.signal,
      ...(options.shouldCancel
        ? {
            shouldCancel: ({ processedSamples, emittedEvents }) => isCancelled(
              options,
              {
                phase: "primary",
                completed: processedSamples,
                total: Math.max(processedSamples, emittedEvents, 1),
              },
            ),
          }
        : {}),
    },
  );
  if (primaryResult.status === "cancelled") {
    return cancelledResult(
      "primary",
      primaryResult.processedSamples,
      Math.max(primaryResult.processedSamples, primaryResult.emittedEvents),
    );
  }
  if (primaryResult.status === "unsupported") {
    return mapPrimaryUnsupported(primaryResult.reason, primaryResult.detail);
  }
  if (primaryResult.status === "rejected") {
    return Object.freeze({
      status: "rejected",
      reason: "primary-plan-rejected",
      detail: primaryResult.reason,
      ...(primaryResult.path ? { path: primaryResult.path } : {}),
    });
  }
  const primary = primaryResult.plan;
  const secondaryAssetResult = await resolveSecondaryAsset(
    resolver,
    extension,
    primary.assets.length,
    options,
  );
  if (secondaryAssetResult.status !== "ready") return secondaryAssetResult;
  const secondaryAsset = secondaryAssetResult.asset;
  const assetBytes = primary.assets.reduce(
    (total, asset) => total + asset.byteLength,
    secondaryAsset.byteLength,
  );
  if (assetBytes > options.maximumTotalAssetBytes) {
    return Object.freeze({ status: "rejected", reason: "asset-budget-exceeded" });
  }

  const geometry = buildSecondaryGeometry(
    envelope.plan,
    acceptedPrefix,
    extension,
    secondaryAsset.assetIndex,
    options,
  );
  if (geometry.status !== "ready") return geometry;
  const planFingerprint = fingerprint(
    options.mode,
    primary,
    secondaryAsset,
    extension,
    geometry.stations,
    geometry.instances,
  );
  const plan: StudioDynamicDualTipPlan = deepFreeze({
    kind: "studio-dynamic-dual-tip-plan",
    version: STUDIO_DYNAMIC_DUAL_TIP_PLAN_VERSION,
    mode: options.mode,
    strokeId: primary.strokeId,
    commandSequence: primary.commandSequence,
    providerCapability: "dynamic-dual-tip-r8-aggregate-preview-v1",
    executionRoute: "experimental-webgpu-aggregate-preview-v1",
    exactExecutionRoute: "webgpu-exact-packed-deposition-v2",
    fidelity: "aggregate-mask-preview-only",
    singleTipFallback: "forbidden",
    textureFormat: "rgba16float",
    maskFormat: "r8-unorm",
    primary,
    secondaryAsset,
    extension,
    secondaryStations: geometry.stations,
    secondaryInstances: geometry.instances,
    fingerprint: planFingerprint,
  });
  const receipt: StudioDynamicDualTipCapabilityReceipt = deepFreeze({
    kind: "studio-dynamic-dual-tip-capability-receipt",
    version: STUDIO_DYNAMIC_DUAL_TIP_CAPABILITY_RECEIPT_VERSION,
    plannerVersion: STUDIO_DYNAMIC_DUAL_TIP_PLAN_VERSION,
    extensionVersion: STUDIO_DYNAMIC_DUAL_TIP_EXTENSION_VERSION,
    providerCapability: "dynamic-dual-tip-r8-aggregate-preview-v1",
    executionRoute: "experimental-webgpu-aggregate-preview-v1",
    exactExecutionRoute: "webgpu-exact-packed-deposition-v2",
    fidelity: "aggregate-mask-preview-only",
    singleTipFallback: "forbidden",
    textureFormat: "rgba16float",
    maskFormat: "r8-unorm",
    mode: options.mode,
    strokeId: primary.strokeId,
    commandSequence: primary.commandSequence,
    blendFamily: extension.blendFamily,
    primaryEventCount: primary.dabs.length,
    secondaryStationCount: geometry.stations.length,
    secondaryInstanceCount: geometry.instances.length,
    assetCount: primary.assets.length + 1,
    assetBytes,
    fingerprint: planFingerprint,
    complete: false,
  });
  return deepFreeze({ status: "ready", plan, receipt });
}
