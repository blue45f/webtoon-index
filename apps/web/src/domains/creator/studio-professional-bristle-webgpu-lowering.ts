import {
  STUDIO_ENGINE_WEBGPU_BRUSH_COLOR_MODEL,
  STUDIO_ENGINE_WEBGPU_BRUSH_DEFAULT_MAX_DABS,
  STUDIO_ENGINE_WEBGPU_BRUSH_INPUT_COLOR_ENCODING,
  STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT,
  validateStudioEngineWebGpuBrushPlan,
} from "./render/studio-engine-webgpu-brush-runtime";
import {
  parseStudioCanonicalBrushPlan,
  STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS,
} from "./studio-canonical-brush-plan";
import {
  parseStudioProfessionalBristleDynamicsPlan,
  resolveStudioProfessionalBristleDynamics,
  STUDIO_PROFESSIONAL_BRISTLE_DYNAMICS_BUDGETS,
  STUDIO_PROFESSIONAL_BRISTLE_DYNAMICS_VERSION,
} from "./studio-professional-bristle-dynamics";

import type {
  StudioEngineWebGpuBrushPlan,
} from "./render/studio-engine-webgpu-brush-runtime";
import type {
  StudioCanonicalBrushPlan,
  StudioCanonicalBrushResponseCurve,
} from "./studio-canonical-brush-plan";
import type {
  StudioCanonicalWebGpuAnalyticBatch,
  StudioCanonicalWebGpuAnalyticDab,
  StudioCanonicalWebGpuComposite,
} from "./studio-canonical-brush-webgpu-lowering";
import type { StudioProfessionalBristleResolveOptions } from "./studio-professional-bristle-dynamics";

/**
 * Clean-room bridge from provider-neutral bristle depositions into the existing RGBA16F analytic
 * WebGPU contract. The version is intentionally independent from both the dynamics and canonical
 * lowering versions so a future provider router can select this capability without inference.
 */
export const STUDIO_PROFESSIONAL_BRISTLE_WEBGPU_LOWERING_VERSION = 1 as const;
export const STUDIO_PROFESSIONAL_BRISTLE_WEBGPU_EXTENSION_VERSION = 1 as const;
export const STUDIO_PROFESSIONAL_BRISTLE_WEBGPU_CAPABILITY_RECEIPT_VERSION = 1 as const;
export const STUDIO_PROFESSIONAL_BRISTLE_WEBGPU_DEFAULT_MAX_DABS =
  STUDIO_ENGINE_WEBGPU_BRUSH_DEFAULT_MAX_DABS;

export interface StudioProfessionalBristleWebGpuExtension {
  readonly kind: "studio-professional-bristle-webgpu-extension";
  readonly version: typeof STUDIO_PROFESSIONAL_BRISTLE_WEBGPU_EXTENSION_VERSION;
  readonly tipMapping: "canonical-round-ellipse-v1";
  readonly colorVariation: "oklch-gamut-safe-v1";
  readonly ordering: "station-major-bristle-index-v1";
}

export const STUDIO_PROFESSIONAL_BRISTLE_WEBGPU_EXTENSION_V1 =
  Object.freeze({
    kind: "studio-professional-bristle-webgpu-extension",
    version: STUDIO_PROFESSIONAL_BRISTLE_WEBGPU_EXTENSION_VERSION,
    tipMapping: "canonical-round-ellipse-v1",
    colorVariation: "oklch-gamut-safe-v1",
    ordering: "station-major-bristle-index-v1",
  } satisfies StudioProfessionalBristleWebGpuExtension);

export interface StudioProfessionalBristleWebGpuLoweringProgress {
  readonly phase: "resolve" | "lower";
  readonly processedStations: number;
  readonly emittedDabs: number;
}

export interface StudioProfessionalBristleWebGpuLoweringOptions {
  readonly mode?: "append" | "rebuild";
  readonly maximumStations?: number;
  readonly maximumDepositions?: number;
  readonly maximumDabs?: number;
  readonly maximumCoordinateAbsolute?: number;
  readonly signal?: AbortSignal;
  readonly shouldCancel?: (
    progress: StudioProfessionalBristleWebGpuLoweringProgress,
  ) => boolean;
}

export interface StudioProfessionalBristleWebGpuCapabilityReceipt {
  readonly kind: "studio-professional-bristle-webgpu-capability-receipt";
  readonly version:
    typeof STUDIO_PROFESSIONAL_BRISTLE_WEBGPU_CAPABILITY_RECEIPT_VERSION;
  readonly loweringVersion:
    typeof STUDIO_PROFESSIONAL_BRISTLE_WEBGPU_LOWERING_VERSION;
  readonly dynamicsVersion:
    typeof STUDIO_PROFESSIONAL_BRISTLE_DYNAMICS_VERSION;
  readonly extensionVersion:
    typeof STUDIO_PROFESSIONAL_BRISTLE_WEBGPU_EXTENSION_VERSION;
  readonly providerCapability: "rgba16float-analytic-bristle-v1";
  readonly textureFormat: typeof STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT;
  readonly surfaceColorModel: typeof STUDIO_ENGINE_WEBGPU_BRUSH_COLOR_MODEL;
  readonly inputColorEncoding:
    typeof STUDIO_ENGINE_WEBGPU_BRUSH_INPUT_COLOR_ENCODING;
  readonly workingColorSpace: "linear-srgb";
  readonly colorVariation: "oklch-gamut-safe-v1";
  readonly tipMapping: "canonical-round-ellipse-v1";
  readonly ordering: "station-major-bristle-index-v1";
  readonly mode: "append" | "rebuild";
  readonly strokeId: string;
  readonly stationCount: number;
  readonly depositionCount: number;
  readonly bristleCount: number;
  /** Includes mode and therefore distinguishes append from rebuild commands. */
  readonly planFingerprint: string;
  /** Excludes mode so append/rebuild payload equality can be audited directly. */
  readonly contentFingerprint: string;
  readonly complete: true;
}

export type StudioProfessionalBristleWebGpuUnsupportedReason =
  | "display-p3"
  | "non-normal-blend"
  | "texture-tip"
  | "grain"
  | "wet-media"
  | "unsupported-tip-shape";

export type StudioProfessionalBristleWebGpuRejectionReason =
  | "invalid-options"
  | "invalid-canonical-plan"
  | "invalid-dynamics-plan"
  | "invalid-extension"
  | "station-limit-exceeded"
  | "deposition-limit-exceeded"
  | "dab-limit-exceeded"
  | "coordinate-budget-exceeded"
  | "numeric-overflow"
  | "invalid-deposition-order"
  | "invalid-runtime-plan";

export type StudioProfessionalBristleWebGpuLoweringResult =
  | Readonly<{
      status: "ready";
      plan: StudioEngineWebGpuBrushPlan;
      receipt: StudioProfessionalBristleWebGpuCapabilityReceipt;
    }>
  | Readonly<{
      status: "unsupported";
      reason: StudioProfessionalBristleWebGpuUnsupportedReason;
      path: string;
    }>
  | Readonly<{
      status: "rejected";
      reason: StudioProfessionalBristleWebGpuRejectionReason;
      path?: string;
    }>
  | Readonly<{
      status: "cancelled";
      phase: "resolve" | "lower";
      processedStations: number;
      emittedDabs: number;
    }>;

interface ParsedOptions {
  readonly mode: "append" | "rebuild";
  readonly maximumStations: number;
  readonly maximumDepositions: number;
  readonly maximumDabs: number;
  readonly maximumCoordinateAbsolute: number;
  readonly signal?: AbortSignal;
  readonly shouldCancel?: (
    progress: StudioProfessionalBristleWebGpuLoweringProgress,
  ) => boolean;
}

interface Oklab {
  readonly lightness: number;
  readonly a: number;
  readonly b: number;
}

const TOP_LEVEL_CANONICAL_KEYS = [
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
const EXTENSION_KEYS = [
  "kind",
  "version",
  "tipMapping",
  "colorVariation",
  "ordering",
] as const;
const OPTION_KEYS = [
  "mode",
  "maximumStations",
  "maximumDepositions",
  "maximumDabs",
  "maximumCoordinateAbsolute",
  "signal",
  "shouldCancel",
] as const;
const SCATTER_ANGLE_SALT = 0x9e37_79b9;
const SCATTER_RADIUS_SALT = 0x7f4a_7c15;
const UINT32_MAX = 0xffff_ffff;
const TAU = Math.PI * 2;
const OKLCH_GAMUT_ITERATIONS = 18;

function finite(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && Number.isFinite(Math.fround(value));
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function inRange(value: unknown, minimum: number, maximum: number): value is number {
  return finite(value) && value >= minimum && value <= maximum;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Copies descriptor values without evaluating accessors. Both unknown fields and symbol metadata
 * are rejected so a successfully parsed object is an exact data-only contract.
 */
function exactDataRecord(
  input: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> | null {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.length !== expectedKeys.length
      || actualKeys.some(
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

function optionDataRecord(input: unknown): Readonly<Record<string, unknown>> | null {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const actualKeys = Reflect.ownKeys(descriptors);
    if (
      actualKeys.some(
        (key) => (
          typeof key !== "string"
          || !(OPTION_KEYS as readonly string[]).includes(key)
        ),
      )
    ) return null;
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of actualKeys as string[]) {
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

function parseCanonical(input: unknown):
  | Readonly<{ ok: true; plan: StudioCanonicalBrushPlan }>
  | Readonly<{ ok: false; path: string }> {
  const value = exactDataRecord(input, TOP_LEVEL_CANONICAL_KEYS);
  if (
    !value
    || !positiveSafeInteger(value.sessionEpoch)
    || !positiveSafeInteger(value.strokeEpoch)
    || !positiveSafeInteger(value.commandSequence)
  ) return Object.freeze({ ok: false, path: "$" });
  const parsed = parseStudioCanonicalBrushPlan(input, {
    sessionEpoch: value.sessionEpoch,
    strokeEpoch: value.strokeEpoch,
    lastAcceptedCommandSequence: value.commandSequence - 1,
  });
  return parsed.ok
    ? Object.freeze({ ok: true, plan: parsed.value.plan })
    : Object.freeze({ ok: false, path: parsed.path });
}

function parseExtension(
  input: unknown,
): StudioProfessionalBristleWebGpuExtension | null {
  const value = exactDataRecord(input, EXTENSION_KEYS);
  if (
    !value
    || value.kind !== "studio-professional-bristle-webgpu-extension"
    || value.version !== STUDIO_PROFESSIONAL_BRISTLE_WEBGPU_EXTENSION_VERSION
    || value.tipMapping !== "canonical-round-ellipse-v1"
    || value.colorVariation !== "oklch-gamut-safe-v1"
    || value.ordering !== "station-major-bristle-index-v1"
  ) return null;
  return STUDIO_PROFESSIONAL_BRISTLE_WEBGPU_EXTENSION_V1;
}

/**
 * The canonical parser intentionally removes the transport-only authoritative role from its
 * durable source samples. The dynamics boundary accepts the candidate form, so reconstruct an
 * immutable candidate from the already validated snapshot instead of re-reading caller data.
 */
function canonicalCandidateForDynamics(plan: StudioCanonicalBrushPlan): unknown {
  return deepFreeze({
    ...plan,
    source: {
      ...plan.source,
      samples: plan.source.samples.map((sourceSample) => ({
        role: "authoritative",
        ...sourceSample,
      })),
    },
  });
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof AbortSignal !== "undefined" && value instanceof AbortSignal;
}

function parseOptions(input: unknown): ParsedOptions | null {
  const value = optionDataRecord(input);
  if (!value) return null;
  const mode = value.mode ?? "rebuild";
  const maximumStations = value.maximumStations
    ?? STUDIO_PROFESSIONAL_BRISTLE_DYNAMICS_BUDGETS.maxStations;
  const maximumDepositions = value.maximumDepositions
    ?? STUDIO_PROFESSIONAL_BRISTLE_DYNAMICS_BUDGETS.maxDepositions;
  const maximumDabs = value.maximumDabs
    ?? STUDIO_PROFESSIONAL_BRISTLE_WEBGPU_DEFAULT_MAX_DABS;
  const maximumCoordinateAbsolute = value.maximumCoordinateAbsolute
    ?? STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxCoordinateAbsolute;
  const signal = value.signal;
  const shouldCancel = value.shouldCancel;
  if (
    (mode !== "append" && mode !== "rebuild")
    || !positiveSafeInteger(maximumStations)
    || maximumStations > STUDIO_PROFESSIONAL_BRISTLE_DYNAMICS_BUDGETS.maxStations
    || !positiveSafeInteger(maximumDepositions)
    || maximumDepositions
      > STUDIO_PROFESSIONAL_BRISTLE_DYNAMICS_BUDGETS.maxDepositions
    || !positiveSafeInteger(maximumDabs)
    || maximumDabs > STUDIO_PROFESSIONAL_BRISTLE_WEBGPU_DEFAULT_MAX_DABS
    || !inRange(
      maximumCoordinateAbsolute,
      1,
      STUDIO_CANONICAL_BRUSH_PLAN_BUDGETS.maxCoordinateAbsolute,
    )
    || (signal !== undefined && !isAbortSignal(signal))
    || (shouldCancel !== undefined && typeof shouldCancel !== "function")
  ) return null;
  return Object.freeze({
    mode,
    maximumStations,
    maximumDepositions,
    maximumDabs,
    maximumCoordinateAbsolute,
    ...(signal === undefined ? {} : { signal }),
    ...(shouldCancel === undefined
      ? {}
      : {
          shouldCancel: shouldCancel as (
            progress: StudioProfessionalBristleWebGpuLoweringProgress,
          ) => boolean,
        }),
  });
}

function specialistRequirement(
  plan: StudioCanonicalBrushPlan,
): Readonly<{
  reason: StudioProfessionalBristleWebGpuUnsupportedReason;
  path: string;
}> | null {
  if (plan.color.space !== "linear-srgb") {
    return Object.freeze({ reason: "display-p3", path: "$.color.space" });
  }
  if (plan.composite.blendMode !== "normal") {
    return Object.freeze({
      reason: "non-normal-blend",
      path: "$.composite.blendMode",
    });
  }
  if (plan.recipe.tip.kind === "texture") {
    return Object.freeze({ reason: "texture-tip", path: "$.recipe.tip" });
  }
  if (plan.recipe.grain !== null) {
    return Object.freeze({ reason: "grain", path: "$.recipe.grain" });
  }
  if (plan.recipe.wetMedia !== null || plan.recipe.engine === "wet-media-v1") {
    return Object.freeze({ reason: "wet-media", path: "$.recipe.wetMedia" });
  }
  if (plan.recipe.tip.shape === "square") {
    return Object.freeze({
      reason: "unsupported-tip-shape",
      path: "$.recipe.tip.shape",
    });
  }
  return null;
}

function response(curve: StudioCanonicalBrushResponseCurve, pressure: number): number {
  return curve.minimum
    + (curve.maximum - curve.minimum) * Math.pow(pressure, curve.exponent);
}

function uint32(value: number): number {
  return value >>> 0;
}

function mix32(value: number): number {
  let mixed = uint32(value);
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb_352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846c_a68b);
  mixed ^= mixed >>> 16;
  return uint32(mixed);
}

function seededUnit(
  canonicalSeed: number,
  dynamicsSeed: number,
  stationIndex: number,
  bristleIndex: number,
  salt: number,
): number {
  const identity = uint32(
    canonicalSeed
      ^ Math.imul(dynamicsSeed, 0x85eb_ca6b)
      ^ Math.imul(stationIndex + 1, 0xc2b2_ae35)
      ^ Math.imul(bristleIndex + 1, 0x27d4_eb2f)
      ^ salt,
  );
  return mix32(identity) / (UINT32_MAX + 1);
}

function linearSrgbToOklab(
  red: number,
  green: number,
  blue: number,
): Oklab {
  const l = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue;
  const m = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue;
  const s = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue;
  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);
  return {
    lightness: 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    a: 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  };
}

function oklabToLinearSrgb(
  lightness: number,
  a: number,
  b: number,
): readonly [number, number, number] {
  const lRoot = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lRoot * lRoot * lRoot;
  const m = mRoot * mRoot * mRoot;
  const s = sRoot * sRoot * sRoot;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function inLinearSrgbGamut(rgb: readonly number[]): boolean {
  return rgb.every(
    (component) => Number.isFinite(component) && component >= 0 && component <= 1,
  );
}

/**
 * Applies the stable per-bristle scalar in OKLCH, then reduces chroma at fixed lightness/hue until
 * the result is inside scene-linear sRGB. Neutral colours stay neutral and zero variation is an
 * exact f32 copy of the canonical colour.
 */
function variedLinearSrgb(
  base: readonly [number, number, number],
  variation: number,
): readonly [number, number, number] | null {
  if (!finite(variation) || Math.abs(variation) > 1) return null;
  if (variation === 0) {
    return [
      Math.fround(base[0]),
      Math.fround(base[1]),
      Math.fround(base[2]),
    ];
  }
  const lab = linearSrgbToOklab(base[0], base[1], base[2]);
  const baseChroma = Math.hypot(lab.a, lab.b);
  const baseHue = baseChroma > 1e-12 ? Math.atan2(lab.b, lab.a) : 0;
  const lightness = clamp01(lab.lightness + variation * 0.08);
  const targetChroma = Math.max(
    0,
    baseChroma * (1 + variation * 0.35),
  );
  const hue = baseHue + variation * 0.12;
  const cosine = Math.cos(hue);
  const sine = Math.sin(hue);
  const candidate = oklabToLinearSrgb(
    lightness,
    targetChroma * cosine,
    targetChroma * sine,
  );
  let mapped = candidate;
  if (!inLinearSrgbGamut(candidate)) {
    let lower = 0;
    let upper = targetChroma;
    mapped = oklabToLinearSrgb(lightness, 0, 0);
    for (let iteration = 0; iteration < OKLCH_GAMUT_ITERATIONS; iteration += 1) {
      const chroma = (lower + upper) * 0.5;
      const attempt = oklabToLinearSrgb(
        lightness,
        chroma * cosine,
        chroma * sine,
      );
      if (inLinearSrgbGamut(attempt)) {
        lower = chroma;
        mapped = attempt;
      } else {
        upper = chroma;
      }
    }
  }
  const rounded = mapped.map((component) => Math.fround(clamp01(component)));
  return rounded.every(finite)
    ? rounded as [number, number, number]
    : null;
}

function gpuCoordinate(
  value: number,
  maximumCoordinateAbsolute: number,
): number | null {
  const rounded = Math.fround(value);
  return Number.isFinite(value)
    && Number.isFinite(rounded)
    && Math.abs(rounded) <= maximumCoordinateAbsolute
    ? (Object.is(rounded, -0) ? 0 : rounded)
    : null;
}

function gpuNumber(value: number): number | null {
  const rounded = Math.fround(value);
  return Number.isFinite(value) && Number.isFinite(rounded)
    ? (Object.is(rounded, -0) ? 0 : rounded)
    : null;
}

function gpuUnit(value: number): number | null {
  const rounded = Math.fround(value);
  return Number.isFinite(rounded) && rounded >= 0 && rounded <= 1
    ? (Object.is(rounded, -0) ? 0 : rounded)
    : null;
}

function basisRoundness(
  basis: readonly [number, number, number, number],
): number | null {
  const [xx, xy, yx, yy] = basis;
  const firstLengthSquared = xx * xx + xy * xy;
  const secondLengthSquared = yx * yx + yy * yy;
  const dot = xx * yx + xy * yy;
  const trace = firstLengthSquared + secondLengthSquared;
  const discriminant = Math.hypot(
    firstLengthSquared - secondLengthSquared,
    2 * dot,
  );
  const largest = Math.sqrt(Math.max(0, (trace + discriminant) * 0.5));
  const smallest = Math.sqrt(Math.max(0, (trace - discriminant) * 0.5));
  if (
    !Number.isFinite(largest)
    || !Number.isFinite(smallest)
    || largest <= 0
    || smallest <= 0
  ) return null;
  return Math.fround(Math.min(1, smallest / largest));
}

function cancelled(
  options: ParsedOptions,
  progress: StudioProfessionalBristleWebGpuLoweringProgress,
): boolean {
  if (options.signal?.aborted) return true;
  try {
    return options.shouldCancel?.(Object.freeze(progress)) === true;
  } catch {
    return true;
  }
}

function dynamicsResolveOptions(
  options: ParsedOptions,
): StudioProfessionalBristleResolveOptions {
  return {
    maximumStations: options.maximumStations,
    maximumDepositions: options.maximumDepositions,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.shouldCancel
      ? {
          shouldCancel: ({ processedStations, emittedDepositions }) => cancelled(
            options,
            {
              phase: "resolve",
              processedStations,
              emittedDabs: emittedDepositions,
            },
          ),
        }
      : {}),
  };
}

function hashBytes(
  state: readonly [number, number],
  bytes: Uint8Array,
): readonly [number, number] {
  let first = state[0];
  let second = state[1];
  for (const byte of bytes) {
    first ^= byte;
    first = Math.imul(first, 0x0100_0193);
    second ^= byte;
    second = Math.imul(second, 0x5bd1_e995);
    second ^= second >>> 13;
  }
  return [first >>> 0, second >>> 0];
}

function planFingerprint(
  plan: StudioEngineWebGpuBrushPlan,
  includeMode: boolean,
): string {
  let state: readonly [number, number] = [0x811c_9dc5, 0x9747_b28c];
  const numberBuffer = new ArrayBuffer(Float64Array.BYTES_PER_ELEMENT);
  const numberView = new DataView(numberBuffer);
  const hashString = (value: string): void => {
    const bytes = new Uint8Array(value.length * Uint16Array.BYTES_PER_ELEMENT);
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      bytes[index * 2] = code & 0xff;
      bytes[index * 2 + 1] = code >>> 8;
    }
    state = hashBytes(state, bytes);
  };
  const hashNumber = (value: number): void => {
    numberView.setFloat64(0, value, true);
    state = hashBytes(state, new Uint8Array(numberBuffer));
  };
  hashString(plan.kind);
  if (includeMode) hashString(plan.mode);
  hashNumber(plan.loweringVersion);
  hashString(plan.strokeId);
  for (const dab of plan.dabs) {
    for (const value of [
      dab.index,
      dab.stationX,
      dab.stationY,
      dab.x,
      dab.y,
      dab.pressure,
      dab.diameter,
      dab.opacity,
      dab.flow,
      ...dab.color.components,
      dab.tip.hardness,
      dab.tip.edgeSoftness,
      dab.tip.roundness,
      dab.tip.angleRadians,
      ...dab.tip.localToDocument,
    ]) hashNumber(value);
    hashString(dab.color.space);
    hashString(dab.color.alphaMode);
    hashString(dab.composite.porterDuff);
    hashString(dab.composite.blendMode);
    hashString(dab.tip.shape);
  }
  for (const batch of plan.batches) {
    hashString(batch.composite.porterDuff);
    hashString(batch.composite.blendMode);
    hashString(batch.colorSpace);
    hashNumber(batch.firstInstance);
    hashNumber(batch.instanceCount);
  }
  return `bristle-wgpu-v1-${state[0].toString(16).padStart(8, "0")}${
    state[1].toString(16).padStart(8, "0")
  }`;
}

function rejectedDynamicsReason(
  reason: string,
): StudioProfessionalBristleWebGpuRejectionReason {
  if (reason === "station-limit-exceeded") return "station-limit-exceeded";
  if (reason === "deposition-limit-exceeded") return "deposition-limit-exceeded";
  if (reason === "numeric-overflow") return "numeric-overflow";
  if (reason === "invalid-canonical-plan") return "invalid-canonical-plan";
  if (reason === "invalid-dynamics-plan") return "invalid-dynamics-plan";
  return "invalid-options";
}

/**
 * Resolves the complete accepted canonical prefix and emits a complete append/rebuild payload.
 * There is no hidden cursor or provider state: identical validated inputs produce byte-identical
 * analytic dabs, batches and fingerprints.
 */
export function lowerStudioProfessionalBristleToWebGpu(
  canonicalInput: unknown,
  dynamicsInput: unknown,
  extensionInput: unknown,
  optionsInput: StudioProfessionalBristleWebGpuLoweringOptions = {},
): StudioProfessionalBristleWebGpuLoweringResult {
  const options = parseOptions(optionsInput);
  if (!options) {
    return Object.freeze({ status: "rejected", reason: "invalid-options" });
  }
  const parsedCanonical = parseCanonical(canonicalInput);
  if (!parsedCanonical.ok) {
    return Object.freeze({
      status: "rejected",
      reason: "invalid-canonical-plan",
      path: parsedCanonical.path,
    });
  }
  const canonical = parsedCanonical.plan;
  const parsedDynamics = parseStudioProfessionalBristleDynamicsPlan(dynamicsInput);
  if (!parsedDynamics.ok) {
    return Object.freeze({
      status: "rejected",
      reason: "invalid-dynamics-plan",
      path: parsedDynamics.path,
    });
  }
  const extension = parseExtension(extensionInput);
  if (!extension) {
    return Object.freeze({
      status: "rejected",
      reason: "invalid-extension",
      path: "$",
    });
  }
  const specialist = specialistRequirement(canonical);
  if (specialist) {
    return Object.freeze({
      status: "unsupported",
      reason: specialist.reason,
      path: specialist.path,
    });
  }
  if (canonical.recipe.tip.kind !== "analytic") {
    return Object.freeze({
      status: "unsupported",
      reason: "texture-tip",
      path: "$.recipe.tip",
    });
  }
  const analyticTip = canonical.recipe.tip;
  if (cancelled(options, {
    phase: "resolve",
    processedStations: 0,
    emittedDabs: 0,
  })) {
    return Object.freeze({
      status: "cancelled",
      phase: "resolve",
      processedStations: 0,
      emittedDabs: 0,
    });
  }

  const dynamics = parsedDynamics.plan;
  const resolved = resolveStudioProfessionalBristleDynamics(
    canonicalCandidateForDynamics(canonical),
    dynamics,
    dynamicsResolveOptions(options),
  );
  if (resolved.status === "cancelled") {
    return Object.freeze({
      status: "cancelled",
      phase: "resolve",
      processedStations: resolved.processedStations,
      emittedDabs: resolved.emittedDepositions,
    });
  }
  if (resolved.status === "rejected") {
    return Object.freeze({
      status: "rejected",
      reason: rejectedDynamicsReason(resolved.reason),
      ...(resolved.path ? { path: resolved.path } : {}),
    });
  }
  if (resolved.depositions.length > options.maximumDabs) {
    return Object.freeze({ status: "rejected", reason: "dab-limit-exceeded" });
  }

  const composite: StudioCanonicalWebGpuComposite = Object.freeze({
    porterDuff: canonical.composite.porterDuff,
    blendMode: canonical.composite.blendMode,
  });
  const dabs: StudioCanonicalWebGpuAnalyticDab[] = [];
  let previousStation = -1;
  let previousBristle = -1;
  for (const deposition of resolved.depositions) {
    if (
      deposition.stationIndex < previousStation
      || (
        deposition.stationIndex === previousStation
        && deposition.bristleIndex <= previousBristle
      )
    ) {
      return Object.freeze({
        status: "rejected",
        reason: "invalid-deposition-order",
      });
    }
    if (deposition.stationIndex !== previousStation) {
      previousStation = deposition.stationIndex;
    }
    previousBristle = deposition.bristleIndex;
    if (cancelled(options, {
      phase: "lower",
      processedStations: deposition.stationIndex,
      emittedDabs: dabs.length,
    })) {
      return Object.freeze({
        status: "cancelled",
        phase: "lower",
        processedStations: deposition.stationIndex,
        emittedDabs: dabs.length,
      });
    }
    const station = resolved.stations[deposition.stationIndex];
    if (!station) {
      return Object.freeze({
        status: "rejected",
        reason: "invalid-deposition-order",
      });
    }
    const diameter = deposition.radius * 2;
    const scatterRadius = Math.sqrt(seededUnit(
      canonical.seed,
      dynamics.seed,
      deposition.stationIndex,
      deposition.bristleIndex,
      SCATTER_RADIUS_SALT,
    )) * 2 * canonical.recipe.scatter.radiusRatio;
    const scatterAngle = seededUnit(
      canonical.seed,
      dynamics.seed,
      deposition.stationIndex,
      deposition.bristleIndex,
      SCATTER_ANGLE_SALT,
    ) * TAU;
    const localToDocument = deposition.localToDocument;
    const scatterLocalX = Math.cos(scatterAngle) * scatterRadius;
    const scatterLocalY = Math.sin(scatterAngle) * scatterRadius;
    // Scatter is defined in the analytic tip's local unit disk. Mapping that disk through the
    // authoritative bristle basis preserves non-uniform scale, shear and reflection; applying a
    // document-space radius would silently collapse every transformed brush back to a circle.
    const x = deposition.x
      + localToDocument[0] * scatterLocalX
      + localToDocument[2] * scatterLocalY;
    const y = deposition.y
      + localToDocument[1] * scatterLocalX
      + localToDocument[3] * scatterLocalY;
    const numeric = [
      deposition.x,
      deposition.y,
      x,
      y,
      diameter,
      ...localToDocument,
    ].map((value) => gpuCoordinate(value, options.maximumCoordinateAbsolute));
    if (numeric.some((value) => value === null)) {
      return Object.freeze({
        status: "rejected",
        reason: "coordinate-budget-exceeded",
      });
    }
    const [
      stationX,
      stationY,
      centerX,
      centerY,
      gpuDiameter,
      xx,
      xy,
      yx,
      yy,
    ] = numeric as number[];
    const gpuOpacity = gpuNumber(deposition.opacity);
    const pressure = gpuUnit(station.pressure);
    const angleRadians = gpuNumber(deposition.headingRadians);
    const determinant = Math.fround(xx! * yy! - xy! * yx!);
    const flow = Math.fround(
      canonical.recipe.flow
        * response(canonical.recipe.pressure.flow, station.pressure),
    );
    const resolvedRoundness = basisRoundness([xx!, xy!, yx!, yy!]);
    const variedColor = variedLinearSrgb(
      [
        canonical.color.components[0],
        canonical.color.components[1],
        canonical.color.components[2],
      ],
      deposition.colorVariation,
    );
    const alpha = gpuUnit(clamp01(
      canonical.color.components[3] * deposition.opacity,
    ));
    const hardness = gpuUnit(canonical.recipe.hardness);
    const edgeSoftness = gpuUnit(analyticTip.edgeSoftness);
    if (
      !variedColor
      || !Number.isFinite(flow)
      || !Number.isFinite(determinant)
      || determinant === 0
      || gpuDiameter! <= 0
      || gpuOpacity === null
      || pressure === null
      || angleRadians === null
      || alpha === null
      || hardness === null
      || edgeSoftness === null
      || resolvedRoundness === null
      || resolvedRoundness <= 0
    ) {
      return Object.freeze({ status: "rejected", reason: "numeric-overflow" });
    }
    dabs.push({
      index: dabs.length,
      stationX: stationX!,
      stationY: stationY!,
      x: centerX!,
      y: centerY!,
      pressure,
      diameter: gpuDiameter!,
      opacity: gpuOpacity,
      flow,
      color: {
        space: "linear-srgb",
        alphaMode: "straight",
        components: [
          variedColor[0],
          variedColor[1],
          variedColor[2],
          alpha,
        ],
      },
      composite,
      tip: {
        shape: analyticTip.shape === "round" && resolvedRoundness === 1
          ? "round"
          : "ellipse",
        hardness,
        edgeSoftness,
        roundness: resolvedRoundness,
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
    mode: options.mode,
    loweringVersion: STUDIO_PROFESSIONAL_BRISTLE_WEBGPU_LOWERING_VERSION,
    strokeId: canonical.strokeId,
    dabs,
    batches,
  };
  if (!validateStudioEngineWebGpuBrushPlan(plan, options.maximumDabs)) {
    return Object.freeze({ status: "rejected", reason: "invalid-runtime-plan" });
  }
  const frozenPlan = deepFreeze(plan);
  const receipt: StudioProfessionalBristleWebGpuCapabilityReceipt = deepFreeze({
    kind: "studio-professional-bristle-webgpu-capability-receipt",
    version: STUDIO_PROFESSIONAL_BRISTLE_WEBGPU_CAPABILITY_RECEIPT_VERSION,
    loweringVersion: STUDIO_PROFESSIONAL_BRISTLE_WEBGPU_LOWERING_VERSION,
    dynamicsVersion: STUDIO_PROFESSIONAL_BRISTLE_DYNAMICS_VERSION,
    extensionVersion: extension.version,
    providerCapability: "rgba16float-analytic-bristle-v1",
    textureFormat: STUDIO_ENGINE_WEBGPU_BRUSH_TEXTURE_FORMAT,
    surfaceColorModel: STUDIO_ENGINE_WEBGPU_BRUSH_COLOR_MODEL,
    inputColorEncoding: STUDIO_ENGINE_WEBGPU_BRUSH_INPUT_COLOR_ENCODING,
    workingColorSpace: "linear-srgb",
    colorVariation: extension.colorVariation,
    tipMapping: extension.tipMapping,
    ordering: extension.ordering,
    mode: options.mode,
    strokeId: canonical.strokeId,
    stationCount: resolved.stations.length,
    depositionCount: resolved.depositions.length,
    bristleCount: dynamics.bristleCount,
    planFingerprint: planFingerprint(frozenPlan, true),
    contentFingerprint: planFingerprint(frozenPlan, false),
    complete: true,
  });
  return deepFreeze({
    status: "ready",
    plan: frozenPlan,
    receipt,
  });
}
