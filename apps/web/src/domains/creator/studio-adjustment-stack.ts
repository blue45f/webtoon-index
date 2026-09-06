/**
 * Non-destructive smart-filter / adjustment stack (Photopea-style), pure model.
 *
 * Entries map onto existing Studio filter engines (curves, levels, blur, …).
 * Can live on image elements as `smartFilters` or on a dedicated adjustment layer record.
 */

import { studioFilterCatalogEntry } from "./filter/studio-filter-catalog";
import {
  STUDIO_FILTER_UNION_WAVE_KINDS,
  type StudioFilterUnionWaveKind,
} from "./filter/studio-filter-pack-registry";

import type { InkWash } from "./brush/studio-ink-wash";
import type { StudioFilterUnionWave } from "./filter/studio-filter-union-wave";
import type {
  StudioFieldIrisBlurOptions,
  StudioLensBlurOptions,
  StudioSelectiveGaussianBlurOptions,
  StudioTiltShiftBlurOptions,
} from "./studio-advanced-blur-filter-kernels";
import type {
  StudioClouds,
  StudioConvolution,
  StudioExposureAdjustment,
  StudioMorphology,
  StudioPixelOffset,
  StudioUnsharpMask,
} from "./studio-advanced-pixel-filters";
import type { ChannelMixer } from "./studio-channel-mixer";
import type { ColorBalance } from "./studio-color-balance";
import type { ColorToAlpha } from "./studio-color-to-alpha";
import type { CurvePoint } from "./studio-curves";
import type { Detail } from "./studio-detail";
import type { Glow } from "./studio-glow";
import type { GradientMap } from "./studio-gradient-map";
import type { Grain } from "./studio-grain";
import type { Halftone } from "./studio-halftone";
import type { LineArtCleanupOptions } from "./studio-line-cleanup";
import type {
  StudioDifferenceOfGaussiansOptions,
  StudioDustScratchesOptions,
  StudioTileableBlurOptions,
} from "./studio-professional-filter-kernels";
import type { ShadowHighlight } from "./studio-shadow-highlight";
import type { Sketch } from "./studio-sketch";
import type { Stylize } from "./studio-stylize";
import type {
  StudioEdgeAwareDenoiseOptions,
  StudioJpegArtifactReductionOptions,
  StudioScreentoneRemovalOptions,
} from "./studio-tone-artifact-filter-kernels";

export const STUDIO_ADJUSTMENT_STACK_VERSION = 1 as const;
/** Canonical metadata budget; filter pixels and other heavy payloads never enter this document. */
export const STUDIO_ADJUSTMENT_STACK_MAX_SERIALIZED_BYTES = 1 * 1_024 * 1_024;

const TEXT_ENCODER = new TextEncoder();
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const SERIALIZED_STACK_PREFIX_BYTES = TEXT_ENCODER.encode("{\"entries\":[").byteLength;
const SERIALIZED_STACK_SUFFIX_BYTES = TEXT_ENCODER.encode(
  `],"version":${STUDIO_ADJUSTMENT_STACK_VERSION}}`
).byteLength;

export const STUDIO_ADJUSTMENT_ENGINE_IDS = [
  "curves",
  "levels",
  "brightness-contrast",
  "shadow-highlight",
  "hue-saturation",
  "color-balance",
  "channel-mixer",
  "gradient-map",
  "blur",
  /** Blur gallery engines (map onto blurFx). */
  "gaussian-blur",
  "motion-blur",
  "spin-blur",
  "zoom-blur",
  "lens-blur",
  "field-iris-blur",
  "tilt-shift-blur",
  "selective-gaussian-blur",
  "tileable-blur",
  "sharpen",
  "smart-sharpen",
  "median-despeckle",
  "high-pass",
  "noise",
  "invert",
  "grayscale",
  "sepia",
  "pixelate",
  "posterize",
  "ink-threshold",
  "line-extraction",
  "line-cleanup",
  "screentone-removal",
  "jpeg-artifact-reduction",
  "edge-aware-denoise",
  "dust-scratches",
  "difference-of-gaussians",
  "color-to-alpha",
  "screentone",
  "color-halftone",
  "chromatic-aberration",
  "edge-detect",
  "emboss",
  "solarize",
  "oil-paint",
  "exposure",
  "unsharp-mask",
  "morphology",
  "offset",
  "custom-convolution",
  "clouds",
  /** Bounded Filter Gallery composites built from the shared Worker pixel engines. */
  "surface-blur",
  "crystal-mosaic",
  "pencil-sketch",
  "crosshatch",
  "ordered-dither",
  "glowing-edges",
  "cutout",
  "retro-film",
  "watercolor",
  "diffuse-glow",
  /** Deterministic geometry, material, print and light filters shared with the full Filter Gallery. */
  ...STUDIO_FILTER_UNION_WAVE_KINDS,
] as const;

export type StudioAdjustmentEngineId = (typeof STUDIO_ADJUSTMENT_ENGINE_IDS)[number];

const STUDIO_ADJUSTMENT_UNION_WAVE_ENGINE_SET = new Set<string>(
  STUDIO_FILTER_UNION_WAVE_KINDS,
);

function isStudioAdjustmentUnionWaveEngine(
  engine: StudioAdjustmentEngineId,
): engine is StudioFilterUnionWaveKind {
  return STUDIO_ADJUSTMENT_UNION_WAVE_ENGINE_SET.has(engine);
}

const STUDIO_ADJUSTMENT_UNION_WAVE_DEFAULT_PARAMS: Readonly<
  Record<StudioFilterUnionWaveKind, Readonly<Record<string, number | string | boolean>>>
> = Object.freeze({
  "wave-warp": { amount: 42, scale: 28, detail: 50, seed: 1_337, centerX: 50, centerY: 50, angle: 0, interpolation: "bilinear" },
  "ripple-warp": { amount: 38, scale: 22, detail: 50, seed: 1_337, centerX: 50, centerY: 50, angle: 0, interpolation: "bilinear" },
  fisheye: { amount: 52, scale: 24, detail: 50, seed: 1_337, centerX: 50, centerY: 50, angle: 0, interpolation: "bilinear" },
  twirl: { amount: 46, scale: 24, detail: 50, seed: 1_337, centerX: 50, centerY: 50, angle: 0, interpolation: "bilinear" },
  "pinch-bloat": { amount: 44, scale: 24, detail: 50, seed: 1_337, centerX: 50, centerY: 50, angle: 0, interpolation: "bilinear" },
  "lens-distortion": { amount: 34, scale: 100, detail: 50, seed: 1_337, centerX: 50, centerY: 50, angle: 0, interpolation: "bilinear" },
  "film-grain-pro": { amount: 34, scale: 1, detail: 50, seed: 1_337, centerX: 50, centerY: 50, angle: 0 },
  "salt-pepper": { amount: 22, scale: 24, detail: 50, seed: 7_331, centerX: 50, centerY: 50, angle: 0 },
  "rgb-noise": { amount: 30, scale: 1, detail: 50, seed: 2_048, centerX: 50, centerY: 50, angle: 0 },
  "perlin-texture": { amount: 42, scale: 32, detail: 153, seed: 404, centerX: 50, centerY: 50, angle: 0 },
  pointillize: { amount: 86, scale: 9, detail: 50, seed: 1_886, centerX: 50, centerY: 50, angle: 0 },
  "stained-glass": { amount: 88, scale: 12, detail: 96, seed: 1_440, centerX: 50, centerY: 50, angle: 0 },
  "poster-edges": { amount: 82, scale: 6, detail: 92, seed: 1_337, centerX: 50, centerY: 50, angle: 0 },
  photocopy: { amount: 94, scale: 2, detail: 148, seed: 1_337, centerX: 50, centerY: 50, angle: 0 },
  "normal-map": { amount: 100, scale: 1, detail: 110, seed: 1_337, centerX: 50, centerY: 50, angle: 0 },
  "god-rays": { amount: 68, scale: 7, detail: 152, seed: 1_337, centerX: 28, centerY: 20, angle: 0 },
  "polar-coordinates": { amount: 100, scale: 24, detail: 50, seed: 1_337, centerX: 50, centerY: 50, angle: 0, mode: "rectangular-to-polar", interpolation: "bilinear" },
});

/** Every recognized engine is discoverable; legacy stacks and the add catalog cannot drift. */
export const STUDIO_ADJUSTMENT_ADDABLE_ENGINE_IDS = STUDIO_ADJUSTMENT_ENGINE_IDS;

/** All catalog engines now project into the shared Konva/Worker filter chain. */
export function studioAdjustmentEngineHasLivePreview(engine: StudioAdjustmentEngineId): boolean {
  return STUDIO_ADJUSTMENT_ENGINE_IDS.includes(engine);
}

/** Defaults used only for newly added entries; old empty entries remain visual no-ops. */
export function studioAdjustmentDefaultParams(
  engine: StudioAdjustmentEngineId,
): Record<string, number | string | boolean> {
  if (isStudioAdjustmentUnionWaveEngine(engine)) {
    return { ...STUDIO_ADJUSTMENT_UNION_WAVE_DEFAULT_PARAMS[engine] };
  }
  switch (engine) {
    case "curves":
      return { preset: "soft-contrast" };
    case "color-balance":
      return { preset: "cinematic" };
    case "channel-mixer":
      return { preset: "mono-balanced" };
    case "gradient-map":
      return { preset: "teal-orange" };
    case "blur":
      return { radius: 2 };
    case "gaussian-blur":
      return { radius: 8, strength: 70 };
    case "motion-blur":
      return { radius: 18, strength: 85, angle: 0 };
    case "spin-blur":
      return { radius: 18, strength: 85 };
    case "zoom-blur":
      return { radius: 20, strength: 85 };
    case "lens-blur":
      return { radius: 4, sampleCount: 21, apertureBlades: 6, apertureRotationRadians: 0 };
    case "field-iris-blur":
      return {
        focusCenterX: 0.5,
        focusCenterY: 0.5,
        focusRadius: 0.16,
        feather: 0.24,
        maximumBlurRadius: 7,
        sampleCount: 21,
        apertureBlades: 8,
      };
    case "tilt-shift-blur":
      return {
        axisRadians: 0,
        focusWidth: 0.2,
        feather: 0.22,
        maximumBlurRadius: 7,
        sampleCount: 19,
      };
    case "selective-gaussian-blur":
      return { radius: 3, spatialSigma: 2, edgeThreshold: 20, edgeSoftness: 0.35 };
    case "tileable-blur":
      return { radius: 5, sigma: 2.2, strength: 1 };
    case "brightness-contrast":
      return { brightness: 0.12, contrast: 10 };
    case "shadow-highlight":
      return { shadows: 35, shadowsWidth: 50, highlights: 20, highlightsWidth: 50, midtoneContrast: 0 };
    case "hue-saturation":
      return { hue: 0, saturation: 0.2 };
    case "levels":
      return { black: 0, white: 255, gamma: 1, outBlack: 0, outWhite: 255 };
    case "sharpen":
      return { amount: 0.3 };
    case "smart-sharpen":
      return { amount: 65, radius: 2 };
    case "median-despeckle":
      return { amount: 100, radius: 1 };
    case "high-pass":
      return {};
    case "noise":
      return { amount: 15, seed: 1_337 };
    case "invert":
      return {};
    case "grayscale":
    case "sepia":
    case "line-extraction":
      return {};
    case "line-cleanup":
      return { threshold: 0.6, strength: 0.5 };
    case "screentone-removal":
      return { radius: 2, strength: 0.88, inkLumaThreshold: 72 };
    case "jpeg-artifact-reduction":
      return {
        deblockStrength: 0.72,
        deringStrength: 0.45,
        boundaryThreshold: 6,
        protectedEdgeThreshold: 88,
        ringingThreshold: 18,
        inkLumaThreshold: 64,
      };
    case "edge-aware-denoise":
      return { radius: 1, strength: 0.78, rangeThreshold: 72 };
    case "dust-scratches":
      return { radius: 2, threshold: 24, strength: 1 };
    case "difference-of-gaussians":
      return { smallSigma: 0.8, largeSigma: 2, threshold: 1.5, strength: 12 };
    case "color-to-alpha":
      return { keyColor: "#ffffff", strength: 85 };
    case "screentone":
      return {};
    case "pixelate":
      return { size: 8 };
    case "posterize":
      return { levels: 5 };
    case "ink-threshold":
      return { level: 0.5 };
    case "color-halftone":
      return { dotSize: 4, angle: 15, mode: "cmyk", strength: 100 };
    case "chromatic-aberration":
      return { offset: 4 };
    case "edge-detect":
      return { strength: 100, detail: 1 };
    case "emboss":
      return { strength: 100, detail: 1 };
    case "solarize":
      return { strength: 100, detail: 3 };
    case "oil-paint":
      return { strength: 100, detail: 3 };
    case "exposure":
      return { exposure: 0.5, gamma: 1, offset: 0 };
    case "unsharp-mask":
      return { amount: 0.8, radius: 2, threshold: 8 };
    case "morphology":
      return { mode: "erode", radius: 1 };
    case "offset":
      return { x: 12, y: 12, edge: "transparent" };
    case "custom-convolution":
      return {
        k0: 0, k1: -1, k2: 0,
        k3: -1, k4: 5, k5: -1,
        k6: 0, k7: -1, k8: 0,
        divisor: 1,
        bias: 0,
      };
    case "clouds":
      return { amount: 0.35, scale: 96, seed: 1_337, mode: "overlay" };
    case "surface-blur":
      return { strength: 78, radius: 3 };
    case "crystal-mosaic":
      return { size: 3, strength: 72 };
    case "pencil-sketch":
      return { strength: 88, detail: 4 };
    case "crosshatch":
      return { strength: 82, detail: 5 };
    case "ordered-dither":
      return { strength: 100, detail: 4 };
    case "glowing-edges":
      return { strength: 86, detail: 2, glow: 72, radius: 5, threshold: 18 };
    case "cutout":
      return { strength: 100, levels: 4, smoothing: 82, radius: 2, contrast: 18 };
    case "retro-film":
      return { strength: 100, grain: 24, grainSize: 2, fade: 14, chromatic: 2, seed: 1_337 };
    case "watercolor":
      return { strength: 78, spread: 4, bleed: 62, granulation: 52, paper: 46, seed: 112 };
    case "diffuse-glow":
      return { strength: 55, radius: 10, threshold: 58, grain: 8, seed: 1_337 };
  }
}

export interface StudioAdjustmentEntry {
  id: string;
  engine: StudioAdjustmentEngineId;
  enabled: boolean;
  /** Engine-specific params; normalized loosely (finite numbers only). */
  params: Record<string, number | string | boolean>;
}

/** Clone-safe, ordered operation sent to the Konva/Worker compositor. */
export type StudioAdjustmentFilterOperation = Readonly<StudioAdjustmentEntry>;

export interface StudioAdjustmentStack {
  version: typeof STUDIO_ADJUSTMENT_STACK_VERSION;
  entries: readonly StudioAdjustmentEntry[];
}

export type StudioAdjustmentStackAdmissionReceipt = Readonly<{
  status: "accepted" | "invalid-structure" | "serialized-byte-budget-exceeded";
  stack: StudioAdjustmentStack;
  serializedBytes: number;
  maximumSerializedBytes: number;
  rejectedIndex: number | null;
}>;

const ENGINE_SET = new Set<string>(STUDIO_ADJUSTMENT_ENGINE_IDS);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string" || DANGEROUS_KEYS.has(key)) return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
    }
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

type DenseDataArrayResult =
  | Readonly<{ status: "accepted"; values: readonly unknown[] }>
  | Readonly<{ status: "invalid-structure" | "serialized-byte-budget-exceeded" }>;

function denseDataArray(value: unknown): DenseDataArrayResult {
  if (!Array.isArray(value)) return { status: "invalid-structure" };
  const values: unknown[] = [];
  try {
    const minimumSerializedBytes = value.length === 0 ? 2 : value.length * 2 + 1;
    if (minimumSerializedBytes > STUDIO_ADJUSTMENT_STACK_MAX_SERIALIZED_BYTES) {
      return { status: "serialized-byte-budget-exceeded" };
    }
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue;
      if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length) {
        return { status: "invalid-structure" };
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        return { status: "invalid-structure" };
      }
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        return { status: "invalid-structure" };
      }
      values.push(descriptor.value);
    }
  } catch {
    return { status: "invalid-structure" };
  }
  return { status: "accepted", values };
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeParams(value: unknown): Record<string, number | string | boolean> {
  const source = asRecord(value);
  if (!source) return {};
  const out: Record<string, number | string | boolean> = {};
  for (const key of Object.keys(source).sort()) {
    const raw = source[key];
    if (key.length > 48) continue;
    if (typeof raw === "number" && Number.isFinite(raw)) out[key] = raw;
    else if (typeof raw === "boolean") out[key] = raw;
    else if (typeof raw === "string" && raw.length <= 128) out[key] = raw;
  }
  return out;
}

function normalizeEntry(value: unknown, index: number): StudioAdjustmentEntry | null {
  const source = asRecord(value);
  if (!source) return null;
  const engine = typeof source.engine === "string" && ENGINE_SET.has(source.engine)
    ? (source.engine as StudioAdjustmentEngineId)
    : null;
  if (!engine) return null;
  const id = typeof source.id === "string" && source.id.trim().length > 0
    ? source.id.trim().slice(0, 80)
    : `adj-${index + 1}`;
  return {
    id,
    engine,
    enabled: source.enabled !== false,
    params: normalizeParams(source.params),
  };
}

function serializeCanonicalParams(params: Readonly<Record<string, number | string | boolean>>): string {
  return `{${Object.keys(params)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(params[key])}`)
    .join(",")}}`;
}

function serializeCanonicalEntry(entry: StudioAdjustmentEntry): string {
  return `{"enabled":${entry.enabled},"engine":${JSON.stringify(entry.engine)},"id":${JSON.stringify(entry.id)},"params":${serializeCanonicalParams(entry.params)}}`;
}

/** Stable-key-order JSON used by byte admission and equality checks. */
export function serializeStudioAdjustmentStack(stack: StudioAdjustmentStack): string {
  return `{"entries":[${stack.entries.map(serializeCanonicalEntry).join(",")}],"version":${STUDIO_ADJUSTMENT_STACK_VERSION}}`;
}

export function studioAdjustmentStackSerializedByteLength(stack: StudioAdjustmentStack): number {
  return TEXT_ENCODER.encode(serializeStudioAdjustmentStack(stack)).byteLength;
}

function serializedStackBytesFromEntries(entryBytes: number, entryCount: number): number {
  return SERIALIZED_STACK_PREFIX_BYTES
    + entryBytes
    + Math.max(0, entryCount - 1)
    + SERIALIZED_STACK_SUFFIX_BYTES;
}

export function createEmptyStudioAdjustmentStack(): StudioAdjustmentStack {
  return { version: STUDIO_ADJUSTMENT_STACK_VERSION, entries: [] };
}

/**
 * Iteratively admits normalized entries against the canonical UTF-8 budget. On failure, callers
 * receive their supplied fallback unchanged; no count-based prefix is silently persisted.
 */
export function admitStudioAdjustmentStack(
  value: unknown,
  fallback: StudioAdjustmentStack = createEmptyStudioAdjustmentStack()
): StudioAdjustmentStackAdmissionReceipt {
  const source = asRecord(value);
  if (!source) {
    const stack = value === null || value === undefined ? createEmptyStudioAdjustmentStack() : fallback;
    return {
      status: value === null || value === undefined ? "accepted" : "invalid-structure",
      stack,
      serializedBytes: studioAdjustmentStackSerializedByteLength(stack),
      maximumSerializedBytes: STUDIO_ADJUSTMENT_STACK_MAX_SERIALIZED_BYTES,
      rejectedIndex: null,
    };
  }
  const entriesValue = Object.hasOwn(source, "entries") ? source.entries : [];
  const arrayReceipt = denseDataArray(entriesValue);
  if (arrayReceipt.status !== "accepted") {
    return {
      status: arrayReceipt.status,
      stack: fallback,
      serializedBytes: studioAdjustmentStackSerializedByteLength(fallback),
      maximumSerializedBytes: STUDIO_ADJUSTMENT_STACK_MAX_SERIALIZED_BYTES,
      rejectedIndex: null,
    };
  }
  const list = arrayReceipt.values;
  const entries: StudioAdjustmentEntry[] = [];
  const seen = new Set<string>();
  let entryBytes = 0;
  for (let index = 0; index < list.length; index += 1) {
    const entry = normalizeEntry(list[index], index);
    if (!entry) continue;
    let id = entry.id;
    if (seen.has(id)) id = `${id}-${index}`;
    const admittedEntry = { ...entry, id };
    const nextEntryBytes = entryBytes
      + TEXT_ENCODER.encode(serializeCanonicalEntry(admittedEntry)).byteLength;
    const nextSerializedBytes = serializedStackBytesFromEntries(nextEntryBytes, entries.length + 1);
    if (nextSerializedBytes > STUDIO_ADJUSTMENT_STACK_MAX_SERIALIZED_BYTES) {
      return {
        status: "serialized-byte-budget-exceeded",
        stack: fallback,
        serializedBytes: studioAdjustmentStackSerializedByteLength(fallback),
        maximumSerializedBytes: STUDIO_ADJUSTMENT_STACK_MAX_SERIALIZED_BYTES,
        rejectedIndex: index,
      };
    }
    seen.add(id);
    entries.push(admittedEntry);
    entryBytes = nextEntryBytes;
  }
  const stack = { version: STUDIO_ADJUSTMENT_STACK_VERSION, entries } as const;
  return {
    status: "accepted",
    stack,
    serializedBytes: serializedStackBytesFromEntries(entryBytes, entries.length),
    maximumSerializedBytes: STUDIO_ADJUSTMENT_STACK_MAX_SERIALIZED_BYTES,
    rejectedIndex: null,
  };
}

export function normalizeStudioAdjustmentStack(value?: unknown): StudioAdjustmentStack {
  return admitStudioAdjustmentStack(value).stack;
}

export function studioAdjustmentStackEqual(left?: unknown, right?: unknown): boolean {
  return serializeStudioAdjustmentStack(normalizeStudioAdjustmentStack(left))
    === serializeStudioAdjustmentStack(normalizeStudioAdjustmentStack(right));
}

export function appendStudioAdjustmentEntry(
  stack: unknown,
  entry: Partial<StudioAdjustmentEntry> & { engine: StudioAdjustmentEngineId }
): StudioAdjustmentStack {
  const current = normalizeStudioAdjustmentStack(stack);
  const next = normalizeEntry(
    {
      id: entry.id,
      engine: entry.engine,
      enabled: entry.enabled,
      params: entry.params,
    },
    current.entries.length
  );
  if (!next) return current;
  return admitStudioAdjustmentStack({
    entries: [...current.entries, next],
  }, current).stack;
}

export function reorderStudioAdjustmentEntry(
  stack: unknown,
  fromIndex: number,
  toIndex: number
): StudioAdjustmentStack {
  const current = normalizeStudioAdjustmentStack(stack);
  const from = Math.trunc(finiteNumber(fromIndex, -1));
  const to = Math.trunc(finiteNumber(toIndex, -1));
  if (from < 0 || to < 0 || from >= current.entries.length || to >= current.entries.length) {
    return current;
  }
  if (from === to) return current;
  const entries = [...current.entries];
  const [moved] = entries.splice(from, 1);
  if (!moved) return current;
  entries.splice(to, 0, moved);
  return { version: STUDIO_ADJUSTMENT_STACK_VERSION, entries };
}

export function setStudioAdjustmentEntryEnabled(
  stack: unknown,
  entryId: string,
  enabled: boolean
): StudioAdjustmentStack {
  const current = normalizeStudioAdjustmentStack(stack);
  return {
    version: STUDIO_ADJUSTMENT_STACK_VERSION,
    entries: current.entries.map((entry) =>
      entry.id === entryId ? { ...entry, enabled: Boolean(enabled) } : entry
    ),
  };
}

export function removeStudioAdjustmentEntry(stack: unknown, entryId: string): StudioAdjustmentStack {
  const current = normalizeStudioAdjustmentStack(stack);
  return {
    version: STUDIO_ADJUSTMENT_STACK_VERSION,
    entries: current.entries.filter((entry) => entry.id !== entryId),
  };
}

/** Enabled engines in paint order (bottom → top). */
export function listEnabledStudioAdjustmentEngines(
  stack: unknown
): readonly StudioAdjustmentEngineId[] {
  return normalizeStudioAdjustmentStack(stack).entries
    .filter((entry) => entry.enabled)
    .map((entry) => entry.engine);
}

/** Enabled entries in exact paint order. Duplicates are intentionally retained. */
export function listEnabledStudioAdjustmentOperations(
  stack: unknown
): readonly StudioAdjustmentFilterOperation[] {
  return normalizeStudioAdjustmentStack(stack).entries
    .filter((entry) => entry.enabled)
    .map((entry) => ({ ...entry, params: { ...entry.params } }));
}

/** Runtime boundary for a Worker-projected operation array. */
export function normalizeStudioAdjustmentFilterOperations(
  value: unknown
): readonly StudioAdjustmentFilterOperation[] {
  return listEnabledStudioAdjustmentOperations({
    version: STUDIO_ADJUSTMENT_STACK_VERSION,
    entries: Array.isArray(value) ? value : [],
  });
}

/**
 * Chip and aria-label wording for a stack entry. Read from the shared filter catalogue so the
 * entry never disagrees with the add-list row it came from — #771 (c9ef0ff7) renamed twelve
 * filters there (JPEG 아티팩트 감소 → JPEG 압축 깨짐 제거, 필드 아이리스 블러 → 영역 초점 블러, …) and a
 * hand-written copy here kept the old names inside the same panel. The engine id is the fallback
 * only for an engine the catalogue has not described yet.
 */
export function studioAdjustmentEngineLabel(engine: StudioAdjustmentEngineId): string {
  return studioFilterCatalogEntry(engine)?.title ?? engine;
}

export type StudioAdjustmentEntryFilterFields = {
  blur?: number;
  brightness?: number;
  contrast?: number;
  hue?: number;
  saturation?: number;
  levelsBlack?: number;
  levelsWhite?: number;
  levelsGamma?: number;
  levelsOutBlack?: number;
  levelsOutWhite?: number;
  sharpen?: number;
  noise?: number;
  noiseSeed?: number;
  invert?: boolean;
  grayscale?: boolean;
  sepia?: boolean;
  screentone?: boolean;
  lineart?: boolean;
  lineCleanup?: LineArtCleanupOptions;
  screentoneRemoval?: StudioScreentoneRemovalOptions;
  jpegArtifactReduction?: StudioJpegArtifactReductionOptions;
  edgeAwareDenoise?: StudioEdgeAwareDenoiseOptions;
  lensBlur?: StudioLensBlurOptions;
  fieldIrisBlur?: StudioFieldIrisBlurOptions;
  tiltShiftBlur?: StudioTiltShiftBlurOptions;
  selectiveGaussianBlur?: StudioSelectiveGaussianBlurOptions;
  tileableBlur?: StudioTileableBlurOptions;
  dustScratches?: StudioDustScratchesOptions;
  differenceOfGaussians?: StudioDifferenceOfGaussiansOptions;
  colorToAlpha?: ColorToAlpha;
  chromatic?: number;
  posterize?: number;
  pixelate?: number;
  inkThreshold?: number;
  /** Gaussian/motion blur gallery — applied via studio-blur Konva filter. */
  blurFx?: {
    type: "gaussian" | "motion" | "spin" | "zoom";
    strength: number;
    radius: number;
    angle: number;
  };
  curve?: CurvePoint[];
  colorBalance?: ColorBalance;
  channelMixer?: ChannelMixer;
  gradientMap?: GradientMap;
  shadowHighlight?: ShadowHighlight;
  exposureAdjustment?: StudioExposureAdjustment;
  unsharpMask?: StudioUnsharpMask;
  morphology?: StudioMorphology;
  pixelOffset?: StudioPixelOffset;
  convolution?: StudioConvolution;
  clouds?: StudioClouds;
  halftone?: Halftone;
  glow?: Glow;
  grain?: Grain;
  inkWash?: InkWash;
  sketch?: Sketch;
  stylize?: Stylize;
  detail?: Detail;
  filterUnionWave?: StudioFilterUnionWave;
};

/** Projection spread onto an image element without flattening away order or duplicate engines. */
export type StudioAdjustmentFilterFields = StudioAdjustmentEntryFilterFields & {
  smartFilterOperations?: readonly StudioAdjustmentFilterOperation[];
};

function stringParam(
  value: string | number | boolean | undefined,
  allowed: readonly string[],
): string | null {
  return typeof value === "string" && allowed.includes(value) ? value : null;
}

function curvePreset(preset: string | null): CurvePoint[] | undefined {
  switch (preset) {
    case "soft-contrast":
      return [{ x: 0, y: 0 }, { x: 64, y: 52 }, { x: 192, y: 206 }, { x: 255, y: 255 }];
    case "matte":
      return [{ x: 0, y: 20 }, { x: 72, y: 68 }, { x: 190, y: 195 }, { x: 255, y: 240 }];
    case "fade":
      return [{ x: 0, y: 30 }, { x: 128, y: 136 }, { x: 255, y: 235 }];
    default:
      return undefined;
  }
}

function colorBalancePreset(preset: string | null): ColorBalance | undefined {
  switch (preset) {
    case "warm":
      return { shadows: [12, 0, -6], midtones: [8, 3, -6], highlights: [18, 8, -12] };
    case "cool":
      return { shadows: [-10, 0, 18], midtones: [-4, 0, 10], highlights: [-8, -2, 14] };
    case "cinematic":
      return { shadows: [-8, 2, 16], midtones: [4, 0, -4], highlights: [16, 6, -12] };
    case "sunset":
      return { shadows: [14, 2, -6], midtones: [10, 4, -8], highlights: [22, 14, -16] };
    default:
      return undefined;
  }
}

function channelMixerPreset(preset: string | null): ChannelMixer | undefined {
  const identity = {
    red: { r: 1, g: 0, b: 0, constant: 0 },
    green: { r: 0, g: 1, b: 0, constant: 0 },
    blue: { r: 0, g: 0, b: 1, constant: 0 },
  };
  switch (preset) {
    case "mono-balanced":
      return {
        ...identity,
        red: { r: 0.33, g: 0.33, b: 0.33, constant: 0 },
        monochrome: true,
      };
    case "red-boost":
      return { ...identity, red: { r: 1.2, g: 0, b: 0, constant: 0 }, monochrome: false };
    case "swap-gbr":
      return {
        red: { r: 0, g: 1, b: 0, constant: 0 },
        green: { r: 0, g: 0, b: 1, constant: 0 },
        blue: { r: 1, g: 0, b: 0, constant: 0 },
        monochrome: false,
      };
    default:
      return undefined;
  }
}

function gradientMapPreset(preset: string | null): GradientMap | undefined {
  switch (preset) {
    case "mono":
      return { stops: [{ pos: 0, color: "#000000" }, { pos: 1, color: "#ffffff" }] };
    case "sepia":
      return { stops: [{ pos: 0, color: "#1a0f00" }, { pos: 1, color: "#fff1cf" }] };
    case "teal-orange":
      return {
        stops: [
          { pos: 0, color: "#06243a" },
          { pos: 0.5, color: "#3a6b7a" },
          { pos: 1, color: "#ffb066" },
        ],
      };
    case "sunset":
      return {
        stops: [
          { pos: 0, color: "#000000" },
          { pos: 0.35, color: "#5a1a4a" },
          { pos: 0.7, color: "#e0662a" },
          { pos: 1, color: "#ffe07a" },
        ],
      };
    default:
      return undefined;
  }
}

function stableOperationSeed(id: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/** Convert one operation only. Keeping this unit isolated lets duplicate engines retain attrs. */
export function studioAdjustmentOperationToFilterFields(
  value: StudioAdjustmentFilterOperation,
): StudioAdjustmentEntryFilterFields {
  const entry = normalizeEntry(value, 0);
  if (!entry?.enabled) return {};
  const out: StudioAdjustmentEntryFilterFields = {};
  const p = entry.params;
  if (isStudioAdjustmentUnionWaveEngine(entry.engine)) {
    const defaults = STUDIO_ADJUSTMENT_UNION_WAVE_DEFAULT_PARAMS[entry.engine];
    const number = (
      key: "amount" | "scale" | "detail" | "seed" | "centerX" | "centerY" | "angle",
      fallback: number,
      min: number,
      max: number,
    ) => Math.min(max, Math.max(min, finiteNumber(p[key], fallback)));
    out.filterUnionWave = {
      kind: entry.engine,
      amount: number("amount", Number(defaults.amount), -100, 100),
      scale: number("scale", Number(defaults.scale), 1, 200),
      detail: number("detail", Number(defaults.detail), 0, 255),
      seed: Math.round(number("seed", Number(defaults.seed), 0, 9_999)),
      centerX: number("centerX", Number(defaults.centerX), 0, 100),
      centerY: number("centerY", Number(defaults.centerY), 0, 100),
      angle: number("angle", Number(defaults.angle), -180, 180),
      mode: p.mode === "polar-to-rectangular"
        ? "polar-to-rectangular"
        : "rectangular-to-polar",
      interpolation: p.interpolation === "nearest" ? "nearest" : "bilinear",
    };
    return out;
  }
  switch (entry.engine) {
      case "blur":
        out.blur = finiteNumber(p.radius ?? p.blur, 0);
        break;
      case "gaussian-blur": {
        const radius = finiteNumber(p.radius, 8);
        const strength = finiteNumber(p.strength, 70);
        out.blurFx = {
          type: "gaussian",
          strength: Math.min(100, Math.max(0, strength)),
          radius: Math.min(40, Math.max(1, radius)),
          angle: 0,
        };
        break;
      }
      case "motion-blur": {
        const radius = finiteNumber(p.radius ?? p.distance, 18);
        const strength = finiteNumber(p.strength, 85);
        const angle = finiteNumber(p.angle, 0);
        out.blurFx = {
          type: "motion",
          strength: Math.min(100, Math.max(0, strength)),
          radius: Math.min(40, Math.max(1, radius)),
          angle: ((angle % 360) + 360) % 360,
        };
        break;
      }
      case "spin-blur": {
        const radius = finiteNumber(p.radius, 18);
        const strength = finiteNumber(p.strength, 85);
        out.blurFx = {
          type: "spin",
          strength: Math.min(100, Math.max(0, strength)),
          radius: Math.min(40, Math.max(1, radius)),
          angle: 0,
        };
        break;
      }
      case "zoom-blur": {
        const radius = finiteNumber(p.radius, 20);
        const strength = finiteNumber(p.strength, 85);
        out.blurFx = {
          type: "zoom",
          strength: Math.min(100, Math.max(0, strength)),
          radius: Math.min(40, Math.max(1, radius)),
          angle: 0,
        };
        break;
      }
      case "lens-blur":
        out.lensBlur = {
          radius: Math.min(18, Math.max(0.25, finiteNumber(p.radius, 4))),
          sampleCount: Math.min(64, Math.max(5, Math.round(finiteNumber(p.sampleCount, 21)))),
          apertureBlades: Math.min(
            12,
            Math.max(3, Math.round(finiteNumber(p.apertureBlades, 6))),
          ),
          apertureRotationRadians: finiteNumber(p.apertureRotationRadians, 0),
        };
        break;
      case "field-iris-blur":
        out.fieldIrisBlur = {
          focusCenterX: Math.min(1, Math.max(0, finiteNumber(p.focusCenterX, 0.5))),
          focusCenterY: Math.min(1, Math.max(0, finiteNumber(p.focusCenterY, 0.5))),
          focusRadius: Math.min(Math.SQRT2, Math.max(0, finiteNumber(p.focusRadius, 0.16))),
          feather: Math.min(Math.SQRT2, Math.max(0.001, finiteNumber(p.feather, 0.24))),
          maximumBlurRadius: Math.min(
            18,
            Math.max(0.25, finiteNumber(p.maximumBlurRadius, 7)),
          ),
          sampleCount: Math.min(64, Math.max(5, Math.round(finiteNumber(p.sampleCount, 21)))),
          apertureBlades: Math.min(
            12,
            Math.max(3, Math.round(finiteNumber(p.apertureBlades, 8))),
          ),
        };
        break;
      case "tilt-shift-blur":
        out.tiltShiftBlur = {
          axisRadians: finiteNumber(p.axisRadians, 0),
          focusWidth: Math.min(
            Math.SQRT2 * 2,
            Math.max(0, finiteNumber(p.focusWidth, 0.2)),
          ),
          feather: Math.min(Math.SQRT2, Math.max(0.001, finiteNumber(p.feather, 0.22))),
          maximumBlurRadius: Math.min(
            18,
            Math.max(0.25, finiteNumber(p.maximumBlurRadius, 7)),
          ),
          sampleCount: Math.min(64, Math.max(5, Math.round(finiteNumber(p.sampleCount, 19)))),
        };
        break;
      case "selective-gaussian-blur":
        out.selectiveGaussianBlur = {
          radius: Math.min(10, Math.max(1, Math.round(finiteNumber(p.radius, 3)))),
          spatialSigma: Math.min(20, Math.max(0.1, finiteNumber(p.spatialSigma, 2))),
          edgeThreshold: Math.min(255, Math.max(0, finiteNumber(p.edgeThreshold, 20))),
          edgeSoftness: Math.min(2, Math.max(0, finiteNumber(p.edgeSoftness, 0.35))),
        };
        break;
      case "tileable-blur":
        out.tileableBlur = {
          radius: Math.min(20, Math.max(1, Math.round(finiteNumber(p.radius, 5)))),
          sigma: Math.min(20, Math.max(0.1, finiteNumber(p.sigma, 2.2))),
          strength: Math.min(1, Math.max(0, finiteNumber(p.strength, 1))),
        };
        break;
      case "brightness-contrast":
        out.brightness = finiteNumber(p.brightness, 0);
        out.contrast = finiteNumber(p.contrast, 0);
        break;
      case "shadow-highlight":
        out.shadowHighlight = {
          shadows: finiteNumber(p.shadows, 0),
          shadowsWidth: finiteNumber(p.shadowsWidth, 50),
          highlights: finiteNumber(p.highlights, 0),
          highlightsWidth: finiteNumber(p.highlightsWidth, 50),
          midtoneContrast: finiteNumber(p.midtoneContrast, 0),
        };
        break;
      case "hue-saturation":
        out.hue = finiteNumber(p.hue, 0);
        out.saturation = finiteNumber(p.saturation, 0);
        break;
      case "levels":
        out.levelsBlack = finiteNumber(p.black ?? p.blackPoint, 0);
        out.levelsWhite = finiteNumber(p.white ?? p.whitePoint, 255);
        out.levelsGamma = finiteNumber(p.gamma, 1);
        out.levelsOutBlack = finiteNumber(p.outBlack, 0);
        out.levelsOutWhite = finiteNumber(p.outWhite, 255);
        break;
      case "sharpen":
        out.sharpen = finiteNumber(p.amount ?? p.sharpen, 0);
        break;
      case "smart-sharpen":
        out.detail = {
          type: "smartSharpen",
          amount: finiteNumber(p.amount, 65),
          radius: finiteNumber(p.radius, 2),
        };
        break;
      case "median-despeckle":
        out.detail = {
          type: "median",
          amount: finiteNumber(p.amount, 100),
          radius: finiteNumber(p.radius, 1),
        };
        break;
      case "high-pass":
        out.convolution = {
          kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
          divisor: 1,
          bias: 128,
        };
        break;
      case "noise":
        out.noise = finiteNumber(p.amount ?? p.noise, 0);
        out.noiseSeed = finiteNumber(p.seed, stableOperationSeed(entry.id));
        break;
      case "invert":
        out.invert = p.invert === false ? false : true;
        break;
      case "grayscale":
        out.grayscale = true;
        break;
      case "sepia":
        out.sepia = true;
        break;
      case "pixelate":
        out.pixelate = Math.min(40, Math.max(1, Math.round(finiteNumber(p.size, 8))));
        break;
      case "posterize":
        out.posterize = Math.min(8, Math.max(2, Math.round(finiteNumber(p.levels, 5))));
        break;
      case "ink-threshold":
        out.inkThreshold = Math.min(1, Math.max(0, finiteNumber(p.level, 0.5)));
        break;
      case "line-extraction":
        out.lineart = true;
        break;
      case "line-cleanup":
        out.lineCleanup = {
          threshold: Math.min(1, Math.max(0, finiteNumber(p.threshold, 0.6))),
          strength: Math.min(1, Math.max(0, finiteNumber(p.strength, 0.5))),
        };
        break;
      case "screentone-removal":
        out.screentoneRemoval = {
          radius: Math.min(3, Math.max(1, Math.round(finiteNumber(p.radius, 2)))),
          strength: Math.min(1, Math.max(0, finiteNumber(p.strength, 0.88))),
          inkLumaThreshold: Math.min(160, Math.max(0, finiteNumber(p.inkLumaThreshold, 72))),
        };
        break;
      case "jpeg-artifact-reduction":
        out.jpegArtifactReduction = {
          deblockStrength: Math.min(1, Math.max(0, finiteNumber(p.deblockStrength, 0.72))),
          deringStrength: Math.min(1, Math.max(0, finiteNumber(p.deringStrength, 0.45))),
          boundaryThreshold: Math.min(64, Math.max(1, finiteNumber(p.boundaryThreshold, 6))),
          protectedEdgeThreshold: Math.min(
            224,
            Math.max(32, finiteNumber(p.protectedEdgeThreshold, 88)),
          ),
          ringingThreshold: Math.min(96, Math.max(1, finiteNumber(p.ringingThreshold, 18))),
          inkLumaThreshold: Math.min(160, Math.max(0, finiteNumber(p.inkLumaThreshold, 64))),
        };
        break;
      case "edge-aware-denoise":
        out.edgeAwareDenoise = {
          radius: Math.min(3, Math.max(1, Math.round(finiteNumber(p.radius, 1)))),
          strength: Math.min(1, Math.max(0, finiteNumber(p.strength, 0.78))),
          rangeThreshold: Math.min(192, Math.max(4, finiteNumber(p.rangeThreshold, 72))),
        };
        break;
      case "dust-scratches":
        out.dustScratches = {
          radius: Math.min(5, Math.max(1, Math.round(finiteNumber(p.radius, 2)))),
          threshold: Math.min(255, Math.max(0, finiteNumber(p.threshold, 24))),
          strength: Math.min(1, Math.max(0, finiteNumber(p.strength, 1))),
        };
        break;
      case "difference-of-gaussians": {
        const smallSigma = Math.min(6, Math.max(0.25, finiteNumber(p.smallSigma, 0.8)));
        out.differenceOfGaussians = {
          smallSigma,
          largeSigma: Math.min(
            12,
            Math.max(smallSigma + 0.1, finiteNumber(p.largeSigma, 2)),
          ),
          threshold: Math.min(64, Math.max(0, finiteNumber(p.threshold, 1.5))),
          strength: Math.min(32, Math.max(0, finiteNumber(p.strength, 12))),
        };
        break;
      }
      case "color-to-alpha":
        out.colorToAlpha = {
          keyColor: typeof p.keyColor === "string" && /^#[0-9a-f]{6}$/i.test(p.keyColor)
            ? p.keyColor
            : "#ffffff",
          strength: Math.min(100, Math.max(0, finiteNumber(p.strength, 85))),
        };
        break;
      case "screentone":
        out.screentone = true;
        break;
      case "color-halftone":
        out.halftone = {
          dotSize: finiteNumber(p.dotSize, 4),
          angle: finiteNumber(p.angle, 15),
          mode: p.mode === "mono" ? "mono" : "cmyk",
          strength: finiteNumber(p.strength, 100),
        };
        break;
      case "chromatic-aberration":
        out.chromatic = Math.min(12, Math.max(1, Math.round(finiteNumber(p.offset, 4))));
        break;
      case "edge-detect":
        out.stylize = {
          type: "findEdges",
          strength: finiteNumber(p.strength, 100),
          detail: finiteNumber(p.detail, 1),
        };
        break;
      case "emboss":
        out.stylize = {
          type: "emboss",
          strength: finiteNumber(p.strength, 100),
          detail: finiteNumber(p.detail, 1),
        };
        break;
      case "solarize":
        out.stylize = {
          type: "solarize",
          strength: finiteNumber(p.strength, 100),
          detail: finiteNumber(p.detail, 3),
        };
        break;
      case "oil-paint":
        out.stylize = {
          type: "oilPaint",
          strength: finiteNumber(p.strength, 100),
          detail: finiteNumber(p.detail, 3),
        };
        break;
      case "curves": {
        const curve = curvePreset(stringParam(p.preset, ["soft-contrast", "matte", "fade"]));
        if (curve) out.curve = curve;
        break;
      }
      case "color-balance": {
        const balance = colorBalancePreset(stringParam(p.preset, ["warm", "cool", "cinematic", "sunset"]));
        if (balance) out.colorBalance = balance;
        break;
      }
      case "channel-mixer": {
        const mixer = channelMixerPreset(stringParam(p.preset, ["mono-balanced", "red-boost", "swap-gbr"]));
        if (mixer) out.channelMixer = mixer;
        break;
      }
      case "gradient-map": {
        const map = gradientMapPreset(stringParam(p.preset, ["mono", "sepia", "teal-orange", "sunset"]));
        if (map) out.gradientMap = map;
        break;
      }
      case "exposure":
        out.exposureAdjustment = {
          exposure: finiteNumber(p.exposure, 0),
          gamma: finiteNumber(p.gamma, 1),
          offset: finiteNumber(p.offset, 0),
        };
        break;
      case "unsharp-mask":
        out.unsharpMask = {
          amount: finiteNumber(p.amount, 0),
          radius: finiteNumber(p.radius, 1),
          threshold: finiteNumber(p.threshold, 0),
        };
        break;
      case "morphology":
        out.morphology = {
          mode: p.mode === "erode" ? "erode" : "dilate",
          radius: finiteNumber(p.radius, 0),
        };
        break;
      case "offset":
        out.pixelOffset = {
          x: finiteNumber(p.x, 0),
          y: finiteNumber(p.y, 0),
          edge: p.edge === "wrap" || p.edge === "clamp" ? p.edge : "transparent",
        };
        break;
      case "custom-convolution":
        out.convolution = {
          kernel: Array.from({ length: 9 }, (_, index) => finiteNumber(p[`k${index}`], index === 4 ? 1 : 0)),
          divisor: finiteNumber(p.divisor, 1),
          bias: finiteNumber(p.bias, 0),
        };
        break;
      case "clouds":
        out.clouds = {
          amount: finiteNumber(p.amount, 0),
          scale: finiteNumber(p.scale, 96),
          seed: finiteNumber(p.seed, 1_337),
          mode: p.mode === "multiply" || p.mode === "screen" ? p.mode : "overlay",
        };
        break;
      case "surface-blur":
        // A bounded median pass removes small variations while retaining hard transitions.
        out.detail = {
          type: "median",
          amount: finiteNumber(p.strength, 78),
          radius: finiteNumber(p.radius, 3),
        };
        break;
      case "crystal-mosaic":
        // The bounded local representative-colour pass creates faceted islands without averaging
        // alpha support (the native block pixelizer intentionally averages alpha for mosaics).
        out.stylize = {
          type: "oilPaint",
          strength: finiteNumber(p.strength, 72),
          detail: finiteNumber(p.size, 3),
        };
        break;
      case "pencil-sketch":
        out.sketch = {
          type: "photocopy",
          strength: finiteNumber(p.strength, 88),
          detail: finiteNumber(p.detail, 4),
        };
        break;
      case "crosshatch":
        out.sketch = {
          type: "crosshatch",
          strength: finiteNumber(p.strength, 82),
          detail: finiteNumber(p.detail, 5),
        };
        break;
      case "ordered-dither":
        out.sketch = {
          type: "mezzotint",
          strength: finiteNumber(p.strength, 100),
          detail: finiteNumber(p.detail, 4),
        };
        break;
      case "glowing-edges": {
        const strength = finiteNumber(p.strength, 86);
        out.stylize = { type: "findEdges", strength, detail: finiteNumber(p.detail, 2) };
        out.glow = {
          strength: strength > 0 ? finiteNumber(p.glow, 72) : 0,
          size: finiteNumber(p.radius, 5),
          threshold: finiteNumber(p.threshold, 18),
          color: "auto",
        };
        break;
      }
      case "cutout":
        if (finiteNumber(p.strength, 100) <= 0) break;
        out.detail = {
          type: "median",
          amount: finiteNumber(p.smoothing, 82),
          radius: finiteNumber(p.radius, 2),
        };
        out.posterize = Math.min(8, Math.max(2, Math.round(finiteNumber(p.levels, 4))));
        out.contrast = Math.min(80, Math.max(-80, finiteNumber(p.contrast, 18)));
        break;
      case "retro-film":
        if (finiteNumber(p.strength, 100) <= 0) break;
        out.sepia = true;
        out.brightness = Math.min(0.8, Math.max(-0.8, finiteNumber(p.fade, 14) / 100));
        out.chromatic = Math.min(12, Math.max(1, Math.round(finiteNumber(p.chromatic, 2))));
        out.grain = {
          type: "film",
          amount: finiteNumber(p.grain, 24),
          size: finiteNumber(p.grainSize, 2),
          seed: finiteNumber(p.seed, stableOperationSeed(entry.id)) % 10_000,
        };
        break;
      case "watercolor":
        out.inkWash = {
          strength: finiteNumber(p.strength, 78),
          spread: finiteNumber(p.spread, 4),
          edgeBleed: finiteNumber(p.bleed, 62),
          granulation: finiteNumber(p.granulation, 52),
          paper: finiteNumber(p.paper, 46),
          inkColor: "#264c70",
          seed: finiteNumber(p.seed, stableOperationSeed(entry.id)) % 10_000,
        };
        break;
      case "diffuse-glow": {
        const strength = finiteNumber(p.strength, 55);
        out.glow = {
          strength,
          size: finiteNumber(p.radius, 10),
          threshold: finiteNumber(p.threshold, 58),
          color: "auto",
        };
        out.grain = {
          type: "film",
          amount: strength > 0 ? finiteNumber(p.grain, 8) : 0,
          size: 1,
          seed: finiteNumber(p.seed, stableOperationSeed(entry.id)) % 10_000,
        };
        break;
      }
      default:
        break;
  }
  return out;
}

/**
 * Preserve the enabled smart-filter program as an ordered clone-safe operation array. Flattening
 * into one field bag made later duplicate engines overwrite earlier ones and let the fixed Konva
 * category order silently replace the user's stack order.
 */
export function studioAdjustmentStackToFilterFields(
  stack: unknown
): StudioAdjustmentFilterFields {
  const smartFilterOperations = listEnabledStudioAdjustmentOperations(stack);
  if (smartFilterOperations.length === 0) return {};
  const projection: StudioAdjustmentFilterFields = { smartFilterOperations };
  const legacyFlatFields = smartFilterOperations.reduce<StudioAdjustmentEntryFilterFields>(
    (fields, operation) => Object.assign(
      fields,
      studioAdjustmentOperationToFilterFields(operation)
    ),
    {}
  );
  // Old direct API consumers still read `fields.blur`/`fields.brightness`. Keep those getters as
  // non-enumerable compatibility fields: StudioPage spreads this projection onto an image, so
  // enumerating the legacy bag would apply every adjustment twice before the ordered program.
  for (const [key, value] of Object.entries(legacyFlatFields)) {
    Object.defineProperty(projection, key, {
      configurable: false,
      enumerable: false,
      value,
      writable: false,
    });
  }
  return projection;
}

/** True when the stack has at least one enabled entry that maps to live filter fields. */
export function studioAdjustmentStackHasLivePreview(stack: unknown): boolean {
  return listEnabledStudioAdjustmentEngines(stack).some(studioAdjustmentEngineHasLivePreview);
}
