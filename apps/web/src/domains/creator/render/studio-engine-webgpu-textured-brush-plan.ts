import {
  normalizeStudioBrushR8TextureGrainSource,
  serializeStudioBrushR8TextureGrainSourceCanonical,
  type StudioBrushR8TextureGrainSource,
} from "../brush/studio-brush-r8-grain-asset-contract";
import {
  STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS,
  STUDIO_CANONICAL_BRUSH_PLAN_VERSION,
} from "../studio-canonical-brush-plan";
import {
  parseStudioProfessionalBrushDynamicsPlan,
  resolveStudioProfessionalBrushDynamics,
} from "../studio-professional-brush-dynamics";
import { sha256HexPortable } from "../studio-sha256";

import type {
  StudioCanonicalBrushGrain,
  StudioCanonicalBrushPlan,
  StudioCanonicalBrushTextureTip,
} from "../studio-canonical-brush-plan";
import type {
  StudioProfessionalBrushDynamicsPlan,
  StudioProfessionalBrushResolveProgress,
} from "../studio-professional-brush-dynamics";

/**
 * Clean-room textured brush specialist plan.
 *
 * Publicly observable texture-tip and paper-grain behaviour is expressed as a provider-neutral,
 * content-addressed plan. No commercial implementation or serialized vendor object crosses this
 * boundary. Unsupported paths are explicit and never degrade to an analytic circle.
 */
export const STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_PLAN_VERSION = 1 as const;
export const STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_LOWERING_VERSION = 1 as const;
export const STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_DUAL_TIP_CAPABILITY =
  "extension-required" as const;

export const STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS = Object.freeze({
  maxDabs: 65_536,
  maxAssets: 2,
  maxAssetDimension: 16_384,
  maxAssetBytes: 64 * 1024 * 1024,
  maxTotalAssetBytes: 96 * 1024 * 1024,
  maxCoordinateAbsolute: STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxCoordinateAbsolute,
} as const);

export type StudioEngineWebGpuTexturedBrushAssetRole = "tip" | "grain";
export type StudioEngineWebGpuTexturedBrushAssetChannel = "alpha" | "luminance";

export interface StudioEngineWebGpuTexturedBrushAssetRequest {
  readonly kind: "studio-textured-brush-asset-request";
  readonly version: 1;
  readonly role: StudioEngineWebGpuTexturedBrushAssetRole;
  readonly assetId: string;
  readonly contentHash: string;
  readonly expectedWidth: number | null;
  readonly expectedHeight: number | null;
  readonly expectedChannel: StudioEngineWebGpuTexturedBrushAssetChannel | null;
  readonly maximumByteLength: number;
}

export interface StudioEngineWebGpuTexturedBrushAssetPayload {
  readonly kind: "studio-textured-brush-r8-asset";
  readonly version: 1;
  readonly assetId: string;
  readonly contentHash: string;
  readonly width: number;
  readonly height: number;
  readonly channel: StudioEngineWebGpuTexturedBrushAssetChannel;
  readonly format: "r8-unorm";
  readonly byteLength: number;
  readonly bytes: Uint8Array;
}

export interface StudioEngineWebGpuTexturedBrushAssetResolver {
  resolve(
    request: StudioEngineWebGpuTexturedBrushAssetRequest,
    signal: AbortSignal,
  ): Promise<unknown>;
}

export interface StudioEngineWebGpuTexturedBrushResolvedAsset {
  readonly assetIndex: number;
  readonly role: StudioEngineWebGpuTexturedBrushAssetRole;
  readonly assetId: string;
  readonly contentHash: string;
  readonly width: number;
  readonly height: number;
  readonly channel: StudioEngineWebGpuTexturedBrushAssetChannel;
  readonly format: "r8-unorm";
  readonly byteLength: number;
  /** Detached immutable-by-contract byte snapshot; runtime never receives the resolver's view. */
  readonly bytes: Uint8Array;
}

export interface StudioEngineWebGpuTexturedBrushTip {
  readonly assetIndex: number;
  readonly channel: StudioEngineWebGpuTexturedBrushAssetChannel;
  readonly filtering: "bilinear";
  readonly edgeMode: "transparent-zero-border";
  readonly hardnessTransfer: "zero-to-one-smoothstep";
}

export interface StudioEngineWebGpuTexturedBrushProceduralGrain {
  readonly kind: "procedural-integer-noise";
  readonly assetIndex: null;
  readonly space: "document" | "stroke";
  /** CSS pixels per integer-noise cell. */
  readonly scale: number;
  readonly depth: number;
  readonly contrast: number;
  /** Canonical v1 has no invert field; false is explicit instead of inferred. */
  readonly invert: false;
  readonly seed: number;
  readonly originX: number;
  readonly originY: number;
  readonly filtering: "integer-cell";
  readonly edgeMode: "infinite";
}

export interface StudioEngineWebGpuTexturedBrushAssetGrain {
  readonly kind: "asset-r8-repeat";
  readonly assetIndex: number;
  readonly space: "document" | "stroke";
  /** CSS pixels per complete texture repeat. */
  readonly scale: number;
  readonly depth: number;
  readonly contrast: number;
  /** Canonical v1 has no invert field; false is explicit instead of inferred. */
  readonly invert: false;
  readonly seed: number;
  readonly originX: number;
  readonly originY: number;
  readonly filtering: "bilinear";
  readonly edgeMode: "repeat";
}

export type StudioEngineWebGpuTexturedBrushGrain =
  | StudioEngineWebGpuTexturedBrushProceduralGrain
  | StudioEngineWebGpuTexturedBrushAssetGrain;

export interface StudioEngineWebGpuTexturedBrushLinearColor {
  readonly space: "linear-srgb";
  readonly alphaMode: "straight";
  readonly components: readonly [number, number, number, number];
}

export interface StudioEngineWebGpuTexturedBrushDab {
  readonly index: number;
  readonly stationX: number;
  readonly stationY: number;
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly diameter: number;
  readonly opacity: number;
  readonly flow: number;
  readonly grainDepth: number;
  readonly color: StudioEngineWebGpuTexturedBrushLinearColor;
  readonly composite: Readonly<{
    porterDuff: "source-over" | "destination-out";
    blendMode: "normal";
  }>;
  readonly tip: Readonly<{
    hardness: number;
    roundness: number;
    angleRadians: number;
    localToDocument: readonly [number, number, number, number];
  }>;
}

export interface StudioEngineWebGpuTexturedBrushBatch {
  readonly key: string;
  readonly tipAssetIndex: number;
  readonly grainAssetIndex: number | null;
  readonly porterDuff: "source-over" | "destination-out";
  readonly firstInstance: number;
  readonly instanceCount: number;
}

export interface StudioEngineWebGpuTexturedBrushPlan {
  readonly kind: "studio-engine-webgpu-textured-brush-plan";
  readonly version: typeof STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_PLAN_VERSION;
  readonly loweringVersion: typeof STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_LOWERING_VERSION;
  readonly mode: "append" | "rebuild";
  readonly strokeId: string;
  readonly commandSequence: number;
  readonly dualTip: typeof STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_DUAL_TIP_CAPABILITY;
  readonly textureFormat: "rgba16float";
  readonly colorModel: "scene-linear-premultiplied";
  readonly tip: StudioEngineWebGpuTexturedBrushTip;
  readonly grain: StudioEngineWebGpuTexturedBrushGrain | null;
  /**
   * Optional durable identity for `grain.kind === "asset-r8-repeat"`. When present it is bound to
   * the resolved grain asset and the canonical stroke seed; the runtime may replace the generic
   * upload with the verified registry-backed native R8 texture, but may not alter grain semantics.
   */
  readonly durableR8GrainSource?: Readonly<StudioBrushR8TextureGrainSource>;
  readonly grainPhaseStrokeSeed?: number;
  readonly grainSamplingSemantics?:
    | "specialist-texture-v1"
    | "durable-r8-cpu-parity-v1";
  /**
   * Renderer-plan identity, distinct from the canonical authoring-plan hash. Provider proofs must
   * bind this fingerprint because durable decoded-source identity changes pixel semantics without
   * changing the renderer-neutral canonical plan.
   */
  readonly semanticFingerprint?: `sha256:${string}`;
  readonly assets: readonly StudioEngineWebGpuTexturedBrushResolvedAsset[];
  readonly dabs: readonly StudioEngineWebGpuTexturedBrushDab[];
  readonly batches: readonly StudioEngineWebGpuTexturedBrushBatch[];
}

export interface StudioEngineWebGpuTexturedBrushPlanOptions {
  readonly mode?: "append" | "rebuild";
  readonly maximumDabs?: number;
  readonly maximumAssetBytes?: number;
  readonly maximumTotalAssetBytes?: number;
  readonly maximumCoordinateAbsolute?: number;
  readonly signal?: AbortSignal;
  readonly shouldCancel?: (progress: StudioProfessionalBrushResolveProgress) => boolean;
  /**
   * Strict persisted source identity for a texture grain. URLs and encoded payloads are not
   * accepted; the resolved decoded asset must match this source byte-for-byte.
   */
  readonly durableR8GrainSource?: unknown;
}

export type StudioEngineWebGpuTexturedBrushPlanUnsupportedReason =
  | "analytic-tip-provider-required"
  | "dual-tip-extension-required"
  | "wet-media"
  | "unsupported-blend-mode"
  | "unsupported-color-space"
  | "grain-required-for-texture-depth";

export type StudioEngineWebGpuTexturedBrushPlanRejectionReason =
  | "invalid-options"
  | "invalid-canonical-plan"
  | "invalid-dynamics-plan"
  | "sample-clock-mismatch"
  | "asset-unavailable"
  | "asset-payload-invalid"
  | "asset-identity-mismatch"
  | "asset-dimension-mismatch"
  | "asset-channel-mismatch"
  | "asset-byte-length-mismatch"
  | "asset-content-hash-mismatch"
  | "durable-r8-source-mismatch"
  | "asset-budget-exceeded"
  | "dab-limit-exceeded"
  | "coordinate-budget-exceeded"
  | "numeric-overflow"
  | "dynamics-rejected";

export type StudioEngineWebGpuTexturedBrushPlanResult =
  | Readonly<{ status: "ready"; plan: StudioEngineWebGpuTexturedBrushPlan }>
  | Readonly<{
      status: "unsupported";
      reason: StudioEngineWebGpuTexturedBrushPlanUnsupportedReason;
      detail?: string;
    }>
  | Readonly<{
      status: "rejected";
      reason: StudioEngineWebGpuTexturedBrushPlanRejectionReason;
      path?: string;
    }>
  | Readonly<{
      status: "cancelled";
      processedSamples: number;
      emittedEvents: number;
    }>;

export interface StudioEngineWebGpuTexturedBrushCpuAsset {
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
}

export interface StudioEngineWebGpuTexturedBrushCpuGrain {
  readonly kind: "procedural-integer-noise" | "asset-r8-repeat";
  readonly space: "document" | "stroke";
  readonly scale: number;
  readonly depth: number;
  readonly contrast: number;
  readonly invert: boolean;
  readonly seed: number;
  readonly originX: number;
  readonly originY: number;
}

const UINT32_MAX = 0xffff_ffff;
const TAU = Math.PI * 2;
const SCATTER_ANGLE_SALT = 0x6a09_e667;
const SCATTER_RADIUS_SALT = 0xbb67_ae85;
const ASSET_PAYLOAD_KEYS = [
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

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function inRange(value: unknown, minimum: number, maximum: number): value is number {
  return finite(value) && value >= minimum && value <= maximum;
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function uint32(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= UINT32_MAX;
}

function unsignedSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function gpuNumber(value: number): number | null {
  const rounded = Math.fround(value);
  if (!Number.isFinite(value) || !Number.isFinite(rounded)) return null;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function deepFreezePlan<T>(value: T): T {
  if (
    typeof value !== "object"
    || value === null
    || Object.isFrozen(value)
    || ArrayBuffer.isView(value)
  ) return value;
  for (const child of Object.values(value)) deepFreezePlan(child);
  return Object.freeze(value);
}

/**
 * Content identity for every field consumed by the textured runtime. Raw R8 bytes are represented
 * by their already-validated content hash, so the fingerprint stays compact while remaining
 * collision-resistant. This is intentionally separate from the renderer-neutral canonical hash.
 */
export function fingerprintStudioEngineWebGpuTexturedBrushPlanSemantics(
  plan: Omit<StudioEngineWebGpuTexturedBrushPlan, "semanticFingerprint">
    | StudioEngineWebGpuTexturedBrushPlan,
): `sha256:${string}` | null {
  try {
    const durableSource = plan.durableR8GrainSource === undefined
      ? null
      : serializeStudioBrushR8TextureGrainSourceCanonical(
        plan.durableR8GrainSource,
      );
    if (plan.durableR8GrainSource !== undefined && durableSource === null) return null;
    const canonical = JSON.stringify({
      kind: plan.kind,
      version: plan.version,
      loweringVersion: plan.loweringVersion,
      mode: plan.mode,
      strokeId: plan.strokeId,
      commandSequence: plan.commandSequence,
      dualTip: plan.dualTip,
      textureFormat: plan.textureFormat,
      colorModel: plan.colorModel,
      tip: plan.tip,
      grain: plan.grain,
      durableR8GrainSource: durableSource,
      grainPhaseStrokeSeed: plan.grainPhaseStrokeSeed ?? null,
      grainSamplingSemantics: plan.grainSamplingSemantics
        ?? "specialist-texture-v1",
      assets: plan.assets.map((asset) => ({
        assetIndex: asset.assetIndex,
        role: asset.role,
        assetId: asset.assetId,
        contentHash: asset.contentHash,
        width: asset.width,
        height: asset.height,
        channel: asset.channel,
        format: asset.format,
        byteLength: asset.byteLength,
      })),
      dabs: plan.dabs,
      batches: plan.batches,
    });
    return `sha256:${sha256HexPortable(new TextEncoder().encode(canonical))}`;
  } catch {
    return null;
  }
}

function exactPayloadRecord(input: unknown): Readonly<Record<string, unknown>> | null {
  try {
    if (
      typeof input !== "object"
      || input === null
      || Array.isArray(input)
      || Object.getPrototypeOf(input) !== Object.prototype
      || Object.getOwnPropertySymbols(input).length !== 0
    ) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input) as unknown as Record<
      string,
      PropertyDescriptor
    >;
    const actualKeys = Object.keys(descriptors);
    if (
      actualKeys.length !== ASSET_PAYLOAD_KEYS.length
      || actualKeys.some((key) => !ASSET_PAYLOAD_KEYS.includes(
        key as (typeof ASSET_PAYLOAD_KEYS)[number],
      ))
    ) return null;
    const result: Record<string, unknown> = {};
    for (const key of ASSET_PAYLOAD_KEYS) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

type StrictFrozenRecord = Readonly<Record<string, unknown>>;

/**
 * Reads only data descriptors from the canonical parser's deep-frozen authority shape. This
 * rejects accessors without invoking them, as well as symbols, prototypes and schema extensions
 * that this provider has not explicitly reviewed.
 */
function strictFrozenRecord(
  input: unknown,
  expectedKeys: readonly string[],
): StrictFrozenRecord | null {
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
    const record: Record<string, unknown> = {};
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
      record[key] = descriptor.value;
    }
    return record;
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
      || input.length < 1
      || input.length > maximumLength
      || Object.getOwnPropertySymbols(input).length !== 0
    ) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input) as unknown as Record<
      string,
      PropertyDescriptor
    >;
    const actualKeys = Object.keys(descriptors);
    if (
      actualKeys.length !== input.length + 1
      || actualKeys.some(
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

function canonicalIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxIdentifierCharacters
    && /^[A-Za-z0-9._:/+-]+$/.test(value);
}

function canonicalContentHash(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 12
    && value.length <= 128
    && /^[A-Za-z0-9:+_-]+$/.test(value);
}

function validCanonicalResponseCurve(input: unknown): boolean {
  const curve = strictFrozenRecord(input, ["minimum", "maximum", "exponent"]);
  return curve !== null
    && inRange(curve.minimum, 0, 4)
    && inRange(curve.maximum, 0, 4)
    && curve.maximum >= curve.minimum
    && inRange(curve.exponent, 0.01, 16);
}

function validCanonicalPressure(input: unknown): boolean {
  const pressure = strictFrozenRecord(input, ["size", "opacity", "flow"]);
  return pressure !== null
    && validCanonicalResponseCurve(pressure.size)
    && validCanonicalResponseCurve(pressure.opacity)
    && validCanonicalResponseCurve(pressure.flow);
}

function validCanonicalTip(input: unknown): boolean {
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
    && canonicalIdentifier(texture.assetId)
    && canonicalContentHash(texture.contentHash)
    && (texture.channel === "alpha" || texture.channel === "luminance")
    && positiveSafeInteger(texture.width)
    && texture.width <= STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxTextureDimension
    && positiveSafeInteger(texture.height)
    && texture.height <= STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxTextureDimension;
}

function validCanonicalGrain(input: unknown): boolean {
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
    ? canonicalIdentifier(grain.assetId) && canonicalContentHash(grain.contentHash)
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

const CANONICAL_WET_MEDIA_KEYS = [
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

function validCanonicalWetMedia(input: unknown): boolean {
  if (input === null) return true;
  const wet = strictFrozenRecord(input, CANONICAL_WET_MEDIA_KEYS);
  return wet !== null
    && wet.model === "pigment-water-v1"
    && positiveSafeInteger(wet.fieldScale)
    && wet.fieldScale <= STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxWetFieldScale
    && inRange(wet.fixedRateHz, 1, 2_000)
    && positiveSafeInteger(wet.simulationSteps)
    && wet.simulationSteps <= STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxWetSimulationSteps
    && CANONICAL_WET_MEDIA_KEYS.slice(4).every((key) => inRange(wet[key], 0, 4));
}

function validCanonicalRecipe(input: unknown): boolean {
  if (typeof input !== "object" || input === null) return false;
  const version = (input as { version?: unknown }).version;
  const hasTipComposition = Object.hasOwn(input, "tipComposition");
  const expectedKeys = version === 2
    ? hasTipComposition
      ? [
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
          "paint",
          "retainedDynamics",
          "tipComposition",
        ]
      : [
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
          "paint",
          "retainedDynamics",
        ]
    : [
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
      ];
  const recipe = strictFrozenRecord(input, expectedKeys);
  if (!recipe) return false;
  const scatter = strictFrozenRecord(recipe.scatter, ["radiusRatio", "distribution"]);
  const wetRelationship =
    (recipe.engine === "wet-media-v1") === (recipe.wetMedia !== null)
    && (recipe.wetMedia === null || recipe.material === "pigment");
  return (recipe.version === 1 || recipe.version === 2)
    && canonicalIdentifier(recipe.brushId)
    && (recipe.engine === "dab-v1" || recipe.engine === "wet-media-v1")
    && (
      recipe.material === "ink"
      || recipe.material === "graphite"
      || recipe.material === "marker"
      || recipe.material === "air"
      || recipe.material === "pigment"
      || recipe.material === "eraser"
    )
    && validCanonicalTip(recipe.tip)
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
    && validCanonicalPressure(recipe.pressure)
    && validCanonicalGrain(recipe.grain)
    && validCanonicalWetMedia(recipe.wetMedia)
    && wetRelationship;
}

function validCanonicalSource(input: unknown): boolean {
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
  if (!samples) return false;
  let previousSequence = -1;
  let previousTime = -1;
  let firstSequence: number | null = null;
  let lastSequence: number | null = null;
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
    firstSequence ??= sample.sequence;
    lastSequence = sample.sequence;
    previousSequence = sample.sequence;
    previousTime = sample.timeMilliseconds;
  }
  return firstSequence === source.firstSequence && lastSequence === source.lastSequence;
}

function canonicalPlanIsValidated(input: StudioCanonicalBrushPlan): boolean {
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
    || !canonicalIdentifier(plan.strokeId)
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
  const components = color ? strictFrozenArray(color.components, 4) : null;
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
  return validCanonicalRecipe(plan.recipe) && validCanonicalSource(plan.source);
}

function contentAddress(value: string): string | null {
  const match = /^sha256:([0-9a-f]{64})$/.exec(value);
  return match?.[1] ?? null;
}

function assetRequest(
  role: StudioEngineWebGpuTexturedBrushAssetRole,
  assetId: string,
  contentHash: string,
  maximumByteLength: number,
  expected: Readonly<{
    width: number | null;
    height: number | null;
    channel: StudioEngineWebGpuTexturedBrushAssetChannel | null;
  }>,
): StudioEngineWebGpuTexturedBrushAssetRequest {
  return Object.freeze({
    kind: "studio-textured-brush-asset-request",
    version: 1,
    role,
    assetId,
    contentHash,
    expectedWidth: expected.width,
    expectedHeight: expected.height,
    expectedChannel: expected.channel,
    maximumByteLength,
  });
}

type AssetValidationResult =
  | Readonly<{ ok: true; asset: StudioEngineWebGpuTexturedBrushResolvedAsset }>
  | Readonly<{
      ok: false;
      reason: StudioEngineWebGpuTexturedBrushPlanRejectionReason;
    }>;

function validateResolvedAsset(
  payload: unknown,
  request: StudioEngineWebGpuTexturedBrushAssetRequest,
  assetIndex: number,
  maximumByteLength: number,
): AssetValidationResult {
  const record = exactPayloadRecord(payload);
  if (
    !record
    || record.kind !== "studio-textured-brush-r8-asset"
    || record.version !== 1
    || record.format !== "r8-unorm"
    || (record.channel !== "alpha" && record.channel !== "luminance")
    || !positiveSafeInteger(record.width)
    || !positiveSafeInteger(record.height)
    || !positiveSafeInteger(record.byteLength)
    || !(record.bytes instanceof Uint8Array)
    || Object.getPrototypeOf(record.bytes) !== Uint8Array.prototype
  ) return { ok: false, reason: "asset-payload-invalid" };
  if (record.assetId !== request.assetId || record.contentHash !== request.contentHash) {
    return { ok: false, reason: "asset-identity-mismatch" };
  }
  if (
    request.expectedWidth !== null
    && (
      record.width !== request.expectedWidth
      || record.height !== request.expectedHeight
    )
  ) return { ok: false, reason: "asset-dimension-mismatch" };
  if (request.expectedChannel !== null && record.channel !== request.expectedChannel) {
    return { ok: false, reason: "asset-channel-mismatch" };
  }
  if (
    record.width > STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS.maxAssetDimension
    || record.height > STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS.maxAssetDimension
    || record.byteLength > maximumByteLength
  ) return { ok: false, reason: "asset-budget-exceeded" };
  const expectedByteLength = record.width * record.height;
  if (
    !Number.isSafeInteger(expectedByteLength)
    || record.byteLength !== expectedByteLength
    || record.bytes.byteLength !== expectedByteLength
  ) return { ok: false, reason: "asset-byte-length-mismatch" };
  const expectedDigest = contentAddress(request.contentHash);
  if (!expectedDigest || sha256HexPortable(record.bytes) !== expectedDigest) {
    return { ok: false, reason: "asset-content-hash-mismatch" };
  }
  const bytes = new Uint8Array(record.bytes);
  return {
    ok: true,
    asset: Object.freeze({
      assetIndex,
      role: request.role,
      assetId: request.assetId,
      contentHash: request.contentHash,
      width: record.width,
      height: record.height,
      channel: record.channel,
      format: "r8-unorm",
      byteLength: bytes.byteLength,
      bytes,
    }),
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

function seededUnit(eventSeed: number, planSeed: number, salt: number): number {
  return mixUint32(eventSeed ^ planSeed ^ salt) / 0x1_0000_0000;
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

function parseOptions(
  options: StudioEngineWebGpuTexturedBrushPlanOptions,
): Readonly<{
  mode: "append" | "rebuild";
  maximumDabs: number;
  maximumAssetBytes: number;
  maximumTotalAssetBytes: number;
  maximumCoordinateAbsolute: number;
}> | null {
  const mode = options.mode ?? "rebuild";
  const maximumDabs =
    options.maximumDabs ?? STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS.maxDabs;
  const maximumAssetBytes =
    options.maximumAssetBytes ?? STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS.maxAssetBytes;
  const maximumTotalAssetBytes = options.maximumTotalAssetBytes
    ?? STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS.maxTotalAssetBytes;
  const maximumCoordinateAbsolute = options.maximumCoordinateAbsolute
    ?? STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS.maxCoordinateAbsolute;
  if (
    (mode !== "append" && mode !== "rebuild")
    || !positiveSafeInteger(maximumDabs)
    || maximumDabs > STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS.maxDabs
    || !positiveSafeInteger(maximumAssetBytes)
    || maximumAssetBytes > STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS.maxAssetBytes
    || !positiveSafeInteger(maximumTotalAssetBytes)
    || maximumTotalAssetBytes > STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS.maxTotalAssetBytes
    || !inRange(
      maximumCoordinateAbsolute,
      1,
      STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_BUDGETS.maxCoordinateAbsolute,
    )
  ) return null;
  return {
    mode,
    maximumDabs,
    maximumAssetBytes,
    maximumTotalAssetBytes,
    maximumCoordinateAbsolute,
  };
}

async function resolveAsset(
  resolver: StudioEngineWebGpuTexturedBrushAssetResolver,
  request: StudioEngineWebGpuTexturedBrushAssetRequest,
  assetIndex: number,
  maximumByteLength: number,
  signal: AbortSignal,
): Promise<AssetValidationResult | "cancelled"> {
  if (signal.aborted) return "cancelled";
  let payload: unknown;
  try {
    payload = await resolver.resolve(request, signal);
  } catch {
    return signal.aborted ? "cancelled" : { ok: false, reason: "asset-unavailable" };
  }
  if (signal.aborted) return "cancelled";
  return validateResolvedAsset(payload, request, assetIndex, maximumByteLength);
}

function normalizedGrain(
  canonicalGrain: StudioCanonicalBrushGrain,
  assetIndex: number | null,
  strokeOrigin: readonly [number, number],
): StudioEngineWebGpuTexturedBrushGrain {
  const originX = canonicalGrain.space === "stroke" ? strokeOrigin[0] : 0;
  const originY = canonicalGrain.space === "stroke" ? strokeOrigin[1] : 0;
  if (canonicalGrain.kind === "texture") {
    return {
      kind: "asset-r8-repeat",
      assetIndex: assetIndex!,
      space: canonicalGrain.space,
      scale: canonicalGrain.scale,
      depth: canonicalGrain.depth,
      contrast: canonicalGrain.contrast,
      invert: false,
      seed: canonicalGrain.seed,
      originX,
      originY,
      filtering: "bilinear",
      edgeMode: "repeat",
    };
  }
  return {
    kind: "procedural-integer-noise",
    assetIndex: null,
    space: canonicalGrain.space,
    scale: canonicalGrain.scale,
    depth: canonicalGrain.depth,
    contrast: canonicalGrain.contrast,
    invert: false,
    seed: canonicalGrain.seed,
    originX,
    originY,
    filtering: "integer-cell",
    edgeMode: "infinite",
  };
}

function durableR8SourceMatchesResolvedAsset(
  source: Readonly<StudioBrushR8TextureGrainSource>,
  asset: StudioEngineWebGpuTexturedBrushResolvedAsset,
): boolean {
  const digest = contentAddress(asset.contentHash);
  return asset.role === "grain"
    && source.asset.assetId === asset.assetId
    && digest !== null
    && source.asset.decodedSha256 === `sha256:${digest}`
    && source.asset.width === asset.width
    && source.asset.height === asset.height
    && source.asset.channel === asset.channel
    && source.asset.encoding === asset.format
    && asset.byteLength === source.asset.width * source.asset.height;
}

function rejectUnsupported(
  canonical: StudioCanonicalBrushPlan,
): Extract<StudioEngineWebGpuTexturedBrushPlanResult, { status: "unsupported" }> | null {
  if (canonical.recipe.tip.kind !== "texture") {
    return Object.freeze({
      status: "unsupported",
      reason: "analytic-tip-provider-required",
    });
  }
  if (canonical.recipe.engine === "wet-media-v1" || canonical.recipe.wetMedia !== null) {
    return Object.freeze({ status: "unsupported", reason: "wet-media" });
  }
  if (canonical.composite.blendMode !== "normal") {
    return Object.freeze({
      status: "unsupported",
      reason: "unsupported-blend-mode",
      detail: canonical.composite.blendMode,
    });
  }
  if (canonical.color.space !== "linear-srgb") {
    return Object.freeze({
      status: "unsupported",
      reason: "unsupported-color-space",
      detail: canonical.color.space,
    });
  }
  return null;
}

/**
 * Resolves content-addressed assets and emits an immutable textured specialist plan. The resolver
 * is called at most once for the tip and once for an asset grain, in that stable order.
 */
export async function buildStudioEngineWebGpuTexturedBrushPlan(
  canonical: StudioCanonicalBrushPlan,
  dynamicsInput: StudioProfessionalBrushDynamicsPlan,
  resolver: StudioEngineWebGpuTexturedBrushAssetResolver,
  options: StudioEngineWebGpuTexturedBrushPlanOptions = {},
): Promise<StudioEngineWebGpuTexturedBrushPlanResult> {
  if (
    typeof options !== "object"
    || options === null
    || Array.isArray(options)
    || !resolver
    || typeof resolver.resolve !== "function"
  ) return Object.freeze({ status: "rejected", reason: "invalid-options" });
  const parsedOptions = parseOptions(options);
  if (!parsedOptions) return Object.freeze({ status: "rejected", reason: "invalid-options" });
  const durableR8GrainSource = options.durableR8GrainSource === undefined
    ? null
    : normalizeStudioBrushR8TextureGrainSource(options.durableR8GrainSource);
  if (
    options.durableR8GrainSource !== undefined
    && durableR8GrainSource === null
  ) {
    return Object.freeze({
      status: "rejected",
      reason: "durable-r8-source-mismatch",
    });
  }
  if (!canonicalPlanIsValidated(canonical)) {
    return Object.freeze({ status: "rejected", reason: "invalid-canonical-plan" });
  }
  const unsupported = rejectUnsupported(canonical);
  if (unsupported) return unsupported;
  if (canonical.recipe.tip.kind !== "texture") {
    return Object.freeze({ status: "rejected", reason: "invalid-canonical-plan" });
  }
  const dynamics = parseStudioProfessionalBrushDynamicsPlan(dynamicsInput);
  if (!dynamics.ok) {
    return Object.freeze({
      status: "rejected",
      reason: "invalid-dynamics-plan",
      path: dynamics.path,
    });
  }
  const ownController = new AbortController();
  const signal = options.signal ?? ownController.signal;
  if (signal.aborted) {
    return Object.freeze({ status: "cancelled", processedSamples: 0, emittedEvents: 0 });
  }

  const tip = canonical.recipe.tip as StudioCanonicalBrushTextureTip;
  const tipRequest = assetRequest(
    "tip",
    tip.assetId,
    tip.contentHash,
    parsedOptions.maximumAssetBytes,
    { width: tip.width, height: tip.height, channel: tip.channel },
  );
  const resolvedTip = await resolveAsset(
    resolver,
    tipRequest,
    0,
    parsedOptions.maximumAssetBytes,
    signal,
  );
  if (resolvedTip === "cancelled") {
    return Object.freeze({ status: "cancelled", processedSamples: 0, emittedEvents: 0 });
  }
  if (!resolvedTip.ok) return Object.freeze({ status: "rejected", reason: resolvedTip.reason });
  const assets: StudioEngineWebGpuTexturedBrushResolvedAsset[] = [resolvedTip.asset];

  const canonicalGrain = canonical.recipe.grain;
  if (durableR8GrainSource && canonicalGrain?.kind !== "texture") {
    return Object.freeze({
      status: "rejected",
      reason: "durable-r8-source-mismatch",
    });
  }
  let grainAssetIndex: number | null = null;
  if (canonicalGrain?.kind === "texture") {
    const grainRequest = assetRequest(
      "grain",
      canonicalGrain.assetId!,
      canonicalGrain.contentHash!,
      parsedOptions.maximumAssetBytes,
      { width: null, height: null, channel: null },
    );
    const resolvedGrain = await resolveAsset(
      resolver,
      grainRequest,
      1,
      parsedOptions.maximumAssetBytes,
      signal,
    );
    if (resolvedGrain === "cancelled") {
      return Object.freeze({ status: "cancelled", processedSamples: 0, emittedEvents: 0 });
    }
    if (!resolvedGrain.ok) {
      return Object.freeze({ status: "rejected", reason: resolvedGrain.reason });
    }
    grainAssetIndex = 1;
    assets.push(resolvedGrain.asset);
    if (
      durableR8GrainSource
      && !durableR8SourceMatchesResolvedAsset(
        durableR8GrainSource,
        resolvedGrain.asset,
      )
    ) {
      return Object.freeze({
        status: "rejected",
        reason: "durable-r8-source-mismatch",
      });
    }
  }
  const totalAssetBytes = assets.reduce((total, asset) => total + asset.byteLength, 0);
  if (totalAssetBytes > parsedOptions.maximumTotalAssetBytes) {
    return Object.freeze({ status: "rejected", reason: "asset-budget-exceeded" });
  }

  const samples = [];
  for (const sample of canonical.source.samples) {
    const timeTick = sample.timeMilliseconds / dynamics.plan.clock.tickMilliseconds;
    if (!Number.isSafeInteger(timeTick) || timeTick < 0) {
      return Object.freeze({ status: "rejected", reason: "sample-clock-mismatch" });
    }
    samples.push({
      sequence: sample.sequence,
      timeTick,
      x: sample.x,
      y: sample.y,
      pressure: sample.pressure,
      tiltXDegrees: sample.tiltX,
      tiltYDegrees: sample.tiltY,
      tangentialPressure: sample.tangentialPressure,
      twistDegrees: sample.twist,
    });
  }
  const resolved = resolveStudioProfessionalBrushDynamics(
    dynamics.plan,
    samples,
    { signal, shouldCancel: options.shouldCancel },
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
  if (
    canonicalGrain === null
    && resolved.depositions.some((event) => event.channels.textureDepth !== 0)
  ) {
    return Object.freeze({
      status: "unsupported",
      reason: "grain-required-for-texture-depth",
    });
  }

  const transformedOrigin = transformPoint(
    canonical,
    resolved.depositions[0]!.x,
    resolved.depositions[0]!.y,
  );
  const grain = canonicalGrain
    ? normalizedGrain(canonicalGrain, grainAssetIndex, transformedOrigin)
    : null;
  const composite = Object.freeze({
    porterDuff: canonical.composite.porterDuff,
    blendMode: "normal" as const,
  });
  const dabs: StudioEngineWebGpuTexturedBrushDab[] = [];
  for (const event of resolved.depositions) {
    if (signal.aborted) {
      return Object.freeze({
        status: "cancelled",
        processedSamples: resolved.states.length,
        emittedEvents: dabs.length,
      });
    }
    const station = transformPoint(canonical, event.x, event.y);
    const scatterAngle = seededUnit(
      event.randomUint32,
      canonical.seed,
      SCATTER_ANGLE_SALT,
    ) * TAU;
    const scatterRadius = Math.sqrt(seededUnit(
      event.randomUint32,
      canonical.seed,
      SCATTER_RADIUS_SALT,
    )) * event.channels.scatter;
    const scatter = transformVector(
      canonical,
      Math.cos(scatterAngle) * scatterRadius,
      Math.sin(scatterAngle) * scatterRadius,
    );
    const radius = event.channels.size / 2;
    const cosine = Math.cos(event.channels.angle);
    const sine = Math.sin(event.channels.angle);
    const basisX = transformVector(
      canonical,
      cosine * radius,
      sine * radius,
    );
    const basisY = transformVector(
      canonical,
      -sine * radius * event.channels.roundness,
      cosine * radius * event.channels.roundness,
    );
    const rawGeometry = [
      station[0],
      station[1],
      station[0] + scatter[0],
      station[1] + scatter[1],
      event.channels.size,
      basisX[0],
      basisX[1],
      basisY[0],
      basisY[1],
    ];
    const geometry = rawGeometry.map(gpuNumber);
    if (
      geometry.some(
        (value) => value === null
          || Math.abs(value) > parsedOptions.maximumCoordinateAbsolute,
      )
    ) {
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
    ] = geometry as number[];
    const determinant = Math.fround(xx! * yy! - xy! * yx!);
    const opacity = gpuNumber(canonical.composite.opacity * event.channels.opacity);
    const flow = gpuNumber(event.channels.flow);
    const pressure = gpuNumber(event.sources.pressure);
    const grainDepth = gpuNumber(
      grain === null ? 0 : grain.depth * event.channels.textureDepth,
    );
    const hardness = gpuNumber(canonical.recipe.hardness);
    const roundness = gpuNumber(event.channels.roundness);
    const angleRadians = gpuNumber(event.channels.angle);
    const alpha = gpuNumber(
      canonical.color.components[3]
        * canonical.composite.opacity
        * event.channels.opacity
        * event.channels.flow,
    );
    const red = gpuNumber(canonical.color.components[0]);
    const green = gpuNumber(canonical.color.components[1]);
    const blue = gpuNumber(canonical.color.components[2]);
    if (
      !Number.isFinite(determinant)
      || determinant === 0
      || diameter! <= 0
      || opacity === null
      || flow === null
      || pressure === null
      || grainDepth === null
      || hardness === null
      || roundness === null
      || angleRadians === null
      || alpha === null
      || red === null
      || green === null
      || blue === null
    ) return Object.freeze({ status: "rejected", reason: "numeric-overflow" });
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
      grainDepth,
      color: {
        space: "linear-srgb",
        alphaMode: "straight",
        components: [red, green, blue, alpha],
      },
      composite,
      tip: {
        hardness,
        roundness,
        angleRadians,
        localToDocument: [xx!, xy!, yx!, yy!],
      },
    });
  }

  const grainKey = grain?.kind === "asset-r8-repeat"
    ? assets[grain.assetIndex]!.contentHash
    : grain?.kind === "procedural-integer-noise"
      ? `noise:${grain.seed}:${grain.space}:${grain.scale}`
      : "none";
  const key = `${resolvedTip.asset.contentHash}|${grainKey}|${composite.porterDuff}`;
  const batches: StudioEngineWebGpuTexturedBrushBatch[] = dabs.length === 0
    ? []
    : [{
        key,
        tipAssetIndex: 0,
        grainAssetIndex,
        porterDuff: composite.porterDuff,
        firstInstance: 0,
        instanceCount: dabs.length,
      }];
  const planWithoutFingerprint: StudioEngineWebGpuTexturedBrushPlan = {
    kind: "studio-engine-webgpu-textured-brush-plan",
    version: STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_PLAN_VERSION,
    loweringVersion: STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_LOWERING_VERSION,
    mode: parsedOptions.mode,
    strokeId: canonical.strokeId,
    commandSequence: canonical.commandSequence,
    dualTip: STUDIO_ENGINE_WEBGPU_TEXTURED_BRUSH_DUAL_TIP_CAPABILITY,
    textureFormat: "rgba16float",
    colorModel: "scene-linear-premultiplied",
    tip: {
      assetIndex: 0,
      channel: tip.channel,
      filtering: "bilinear",
      edgeMode: "transparent-zero-border",
      hardnessTransfer: "zero-to-one-smoothstep",
    },
    grain,
    ...(durableR8GrainSource
      ? {
          durableR8GrainSource,
          grainPhaseStrokeSeed: canonical.seed,
          grainSamplingSemantics: "durable-r8-cpu-parity-v1" as const,
        }
      : { grainSamplingSemantics: "specialist-texture-v1" as const }),
    assets,
    dabs,
    batches,
  };
  const semanticFingerprint =
    fingerprintStudioEngineWebGpuTexturedBrushPlanSemantics(planWithoutFingerprint);
  if (!semanticFingerprint) {
    return Object.freeze({ status: "rejected", reason: "numeric-overflow" });
  }
  const plan: StudioEngineWebGpuTexturedBrushPlan = {
    ...planWithoutFingerprint,
    semanticFingerprint,
  };
  return deepFreezePlan({ status: "ready", plan });
}

function cpuTexelZeroBorder(
  asset: StudioEngineWebGpuTexturedBrushCpuAsset,
  x: number,
  y: number,
): number {
  if (x < 0 || y < 0 || x >= asset.width || y >= asset.height) return 0;
  return asset.bytes[y * asset.width + x]! / 255;
}

function cpuTexelRepeat(
  asset: StudioEngineWebGpuTexturedBrushCpuAsset,
  x: number,
  y: number,
): number {
  const wrappedX = ((x % asset.width) + asset.width) % asset.width;
  const wrappedY = ((y % asset.height) + asset.height) % asset.height;
  return asset.bytes[wrappedY * asset.width + wrappedX]! / 255;
}

function bilinear(
  x: number,
  y: number,
  texel: (x: number, y: number) => number,
): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const top = texel(x0, y0) * (1 - tx) + texel(x0 + 1, y0) * tx;
  const bottom = texel(x0, y0 + 1) * (1 - tx) + texel(x0 + 1, y0 + 1) * tx;
  return top * (1 - ty) + bottom * ty;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = clamp((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}

/**
 * CPU oracle for the WGSL tip sampler: R8 is bilinear-filtered at texel centres with an implicit
 * one-texel zero border, then hardness maps coverage through smoothstep(0, 1-hardness, value).
 */
export function sampleStudioEngineTexturedBrushTipCpu(
  asset: StudioEngineWebGpuTexturedBrushCpuAsset,
  u: number,
  v: number,
  hardness: number,
): number {
  if (
    !positiveSafeInteger(asset.width)
    || !positiveSafeInteger(asset.height)
    || asset.bytes.byteLength !== asset.width * asset.height
    || !finite(u)
    || !finite(v)
    || !inRange(hardness, 0, 1)
  ) return 0;
  const raw = bilinear(
    u * asset.width - 0.5,
    v * asset.height - 0.5,
    (x, y) => cpuTexelZeroBorder(asset, x, y),
  );
  return smoothstep(0, Math.max(1 / 65_535, 1 - hardness), raw);
}

function integerNoise(cellX: number, cellY: number, seed: number): number {
  const x = cellX | 0;
  const y = cellY | 0;
  return mixUint32(
    seed
      ^ Math.imul(x, 0x9e37_79b1)
      ^ Math.imul(y, 0x85eb_ca77),
  ) / 0x1_0000_0000;
}

function contrastGrain(value: number, contrast: number, invert: boolean): number {
  const contrasted = clamp(0.5 + (value - 0.5) * (1 + contrast * 3));
  return invert ? 1 - contrasted : contrasted;
}

/**
 * CPU oracle for document/stroke anchored grain. Asset grain repeats bilinearly; procedural grain
 * hashes signed integer cells. `depth` returns a multiplicative coverage factor in [0, 1].
 */
export function sampleStudioEngineTexturedBrushGrainCpu(
  grain: StudioEngineWebGpuTexturedBrushCpuGrain,
  documentX: number,
  documentY: number,
  asset: StudioEngineWebGpuTexturedBrushCpuAsset | null,
): number {
  if (
    !inRange(grain.scale, 0.01, 65_536)
    || !inRange(grain.depth, 0, 1)
    || !inRange(grain.contrast, 0, 1)
    || !uint32(grain.seed)
    || !finite(documentX)
    || !finite(documentY)
  ) return 0;
  const x = documentX - grain.originX;
  const y = documentY - grain.originY;
  let sample: number;
  if (grain.kind === "asset-r8-repeat") {
    if (
      !asset
      || asset.bytes.byteLength !== asset.width * asset.height
      || !positiveSafeInteger(asset.width)
      || !positiveSafeInteger(asset.height)
    ) return 0;
    sample = bilinear(
      (x / grain.scale) * asset.width - 0.5,
      (y / grain.scale) * asset.height - 0.5,
      (texelX, texelY) => cpuTexelRepeat(asset, texelX, texelY),
    );
  } else {
    sample = integerNoise(Math.floor(x / grain.scale), Math.floor(y / grain.scale), grain.seed);
  }
  const shaped = contrastGrain(sample, grain.contrast, grain.invert);
  return 1 - grain.depth + grain.depth * shaped;
}

/**
 * Straight scene-linear brush colour is premultiplied exactly once after texture/grain coverage.
 * The returned float32 tuple is the CPU reference immediately before rgba16float storage rounding.
 */
export function compositeStudioEngineTexturedBrushPixelCpu(
  destination: readonly [number, number, number, number],
  straightColor: readonly [number, number, number, number],
  coverage: number,
  porterDuff: "source-over" | "destination-out",
): readonly [number, number, number, number] {
  const sourceAlpha = clamp(straightColor[3] * coverage);
  const inverse = 1 - sourceAlpha;
  if (porterDuff === "destination-out") {
    return [
      Math.fround(destination[0] * inverse),
      Math.fround(destination[1] * inverse),
      Math.fround(destination[2] * inverse),
      Math.fround(destination[3] * inverse),
    ];
  }
  return [
    Math.fround(straightColor[0] * sourceAlpha + destination[0] * inverse),
    Math.fround(straightColor[1] * sourceAlpha + destination[1] * inverse),
    Math.fround(straightColor[2] * sourceAlpha + destination[2] * inverse),
    Math.fround(sourceAlpha + destination[3] * inverse),
  ];
}
