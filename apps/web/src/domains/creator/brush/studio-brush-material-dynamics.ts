/**
 * Deterministic colour and grain channels shared by Canvas, SVG and collaboration replay.
 *
 * The contract deliberately stores no Canvas objects, images or callbacks. A stroke seed, dab
 * index and document-space coordinates fully determine the result, so persisted brush snapshots
 * remain JSON-only and the renderer does not need another random stream.
 */

import {
  isStudioSpectralWgmColorMixProgramId,
  mixStudioSpectralWgm,
  STUDIO_SPECTRAL_WGM_COLOR_MIX_PAINT_MODE,
  STUDIO_SPECTRAL_WGM_COLOR_MIX_PROGRAM_ID,
  type StudioSpectralWgmColorMixProgramId,
} from "../studio-spectral-wgm-mix-v1";

import {
  normalizeStudioBrushR8TextureGrainSource,
  type StudioBrushR8TextureGrainSource,
} from "./studio-brush-r8-grain-asset-contract";

export type {
  StudioBrushR8GrainAssetReference,
  StudioBrushR8TextureGrainSource,
} from "./studio-brush-r8-grain-asset-contract";

export const STUDIO_BRUSH_COLOR_DYNAMICS_LIMITS = {
  foregroundBackgroundMix: { min: 0, max: 1 },
  foregroundBackgroundJitter: { min: 0, max: 1 },
  hueJitter: { min: 0, max: 180 },
  saturationJitter: { min: 0, max: 1 },
  valueJitter: { min: 0, max: 1 },
} as const;

export type StudioBrushGrainSpace = "canvas-fixed" | "stroke-fixed";

export const STUDIO_BRUSH_GRAIN_LIMITS = {
  amount: { min: 0, max: 1 },
  scale: { min: 0.25, max: 512 },
  contrast: { min: 0, max: 1 },
} as const;

export interface StudioBrushColorDynamicsSettings {
  /** Optional second colour captured in the brush snapshot. Invalid CSS colours normalize to null. */
  backgroundColor?: string | null;
  /** Constant foreground→background mix before HSV variation. */
  foregroundBackgroundMix?: number;
  /** Deterministic signed mix variation for each dab. */
  foregroundBackgroundJitter?: number;
  /** Maximum signed hue rotation in degrees for each dab. */
  hueJitter?: number;
  /** Maximum signed saturation delta (0..1) for each dab. */
  saturationJitter?: number;
  /** Maximum signed value/lightness delta (0..1) for each dab. */
  valueJitter?: number;
  /**
   * Opt-in pigment program for the foreground↔background mix (F3, 2026-08-13).
   * Only the exact `spectral-wgm-v1` id survives normalization; anything else —
   * including every legacy snapshot that omits the key — keeps the historical
   * linear-RGB lerp byte-for-byte. The pin is threaded from the engine-lane
   * catalogue tuning (studio-brush-engine-lane-catalog) exactly like
   * `wetEdgeBloomProgramId` / stamp `paperProgramId`.
   */
  pigmentMixProgramId?: string | null;
}

export interface NormalizedStudioBrushColorDynamicsSettings {
  backgroundColor: string | null;
  foregroundBackgroundMix: number;
  foregroundBackgroundJitter: number;
  hueJitter: number;
  saturationJitter: number;
  valueJitter: number;
  /** Present only for a strictly admitted pigment-mix program pin. */
  pigmentMixProgramId?: StudioSpectralWgmColorMixProgramId;
}

export interface StudioBrushGrainSettings {
  /** Canvas-fixed stays pinned to document coordinates; stroke-fixed follows the stroke origin. */
  space?: StudioBrushGrainSpace;
  /** Opacity modulation depth. Zero is a byte-for-byte legacy rendering identity. */
  amount?: number;
  /** Document-space size of one smooth noise cell. */
  scale?: number;
  /** Expands values around the midpoint without changing the deterministic phase. */
  contrast?: number;
  /** Independent grain phase mixed with the stroke seed. */
  seed?: number;
  /**
   * Immutable paper asset identity. Omission/null retains the historical procedural grain bytes.
   * Unknown or malformed sources fail closed to a disabled grain during normalization.
   */
  source?: StudioBrushR8TextureGrainSource | null;
}

export interface NormalizedStudioBrushGrainSettings {
  space: StudioBrushGrainSpace;
  amount: number;
  scale: number;
  contrast: number;
  seed: number;
  /** Present only for a strictly admitted content-addressed R8 paper source. */
  source?: Readonly<StudioBrushR8TextureGrainSource>;
}

export interface StudioBrushGrainSample {
  x: number;
  y: number;
  strokeOriginX?: number;
  strokeOriginY?: number;
  strokeSeed: number;
}

const DEFAULT_COLOR_DYNAMICS: NormalizedStudioBrushColorDynamicsSettings = {
  backgroundColor: null,
  foregroundBackgroundMix: 0,
  foregroundBackgroundJitter: 0,
  hueJitter: 0,
  saturationJitter: 0,
  valueJitter: 0,
};

const DEFAULT_GRAIN: NormalizedStudioBrushGrainSettings = {
  space: "canvas-fixed",
  amount: 0,
  scale: 8,
  contrast: 0.35,
  seed: 1,
};

const STUDIO_BRUSH_GRAIN_FOOTPRINT_SAMPLES = Object.freeze([
  [0, 0, 4],
  [-0.46, 0, 1],
  [0.46, 0, 1],
  [0, -0.46, 1],
  [0, 0.46, 1],
  [-0.32, -0.32, 0.75],
  [0.32, -0.32, 0.75],
  [-0.32, 0.32, 0.75],
  [0.32, 0.32, 0.75],
] as const);

const MAX_UINT32 = 0xffff_ffff;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function uint32(value: unknown, fallback: number): number {
  return Math.trunc(clamp(finiteNumber(value, fallback), 0, MAX_UINT32)) >>> 0;
}

function canonicalHexColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const short = /^#([0-9a-f]{3})$/iu.exec(trimmed);
  if (short) {
    const [r, g, b] = short[1]!.toLowerCase();
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  const full = /^#([0-9a-f]{6})$/iu.exec(trimmed);
  return full ? `#${full[1]!.toLowerCase()}` : null;
}

type OwnDataProperty =
  | Readonly<{ status: "absent" }>
  | Readonly<{ status: "data"; value: unknown }>
  | Readonly<{ status: "poisoned" }>;

/** Reads one optional own data property without invoking accessors or proxy traps outside a guard. */
function ownEnumerableDataProperty(
  source: Record<string, unknown>,
  key: string,
): OwnDataProperty {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor) return { status: "absent" };
    if (!("value" in descriptor) || descriptor.enumerable !== true) {
      return { status: "poisoned" };
    }
    return { status: "data", value: descriptor.value };
  } catch {
    return { status: "poisoned" };
  }
}

export function normalizeStudioBrushColorDynamicsSettings(
  value?: unknown
): NormalizedStudioBrushColorDynamicsSettings {
  const source = asRecord(value) ?? {};
  return {
    backgroundColor: source.backgroundColor === null
      ? null
      : canonicalHexColor(source.backgroundColor),
    foregroundBackgroundMix: clamp(
      finiteNumber(
        source.foregroundBackgroundMix,
        DEFAULT_COLOR_DYNAMICS.foregroundBackgroundMix
      ),
      STUDIO_BRUSH_COLOR_DYNAMICS_LIMITS.foregroundBackgroundMix.min,
      STUDIO_BRUSH_COLOR_DYNAMICS_LIMITS.foregroundBackgroundMix.max
    ),
    foregroundBackgroundJitter: clamp(
      finiteNumber(
        source.foregroundBackgroundJitter,
        DEFAULT_COLOR_DYNAMICS.foregroundBackgroundJitter
      ),
      STUDIO_BRUSH_COLOR_DYNAMICS_LIMITS.foregroundBackgroundJitter.min,
      STUDIO_BRUSH_COLOR_DYNAMICS_LIMITS.foregroundBackgroundJitter.max
    ),
    hueJitter: clamp(
      finiteNumber(source.hueJitter, DEFAULT_COLOR_DYNAMICS.hueJitter),
      STUDIO_BRUSH_COLOR_DYNAMICS_LIMITS.hueJitter.min,
      STUDIO_BRUSH_COLOR_DYNAMICS_LIMITS.hueJitter.max
    ),
    saturationJitter: clamp(
      finiteNumber(source.saturationJitter, DEFAULT_COLOR_DYNAMICS.saturationJitter),
      STUDIO_BRUSH_COLOR_DYNAMICS_LIMITS.saturationJitter.min,
      STUDIO_BRUSH_COLOR_DYNAMICS_LIMITS.saturationJitter.max
    ),
    valueJitter: clamp(
      finiteNumber(source.valueJitter, DEFAULT_COLOR_DYNAMICS.valueJitter),
      STUDIO_BRUSH_COLOR_DYNAMICS_LIMITS.valueJitter.min,
      STUDIO_BRUSH_COLOR_DYNAMICS_LIMITS.valueJitter.max
    ),
    // Fail-closed program admission appended last: legacy snapshots without the
    // key keep their exact canonical JSON (key set and order unchanged), and an
    // unknown/misspelled program id normalizes back to the linear path.
    ...(isStudioSpectralWgmColorMixProgramId(source.pigmentMixProgramId)
      ? { pigmentMixProgramId: source.pigmentMixProgramId }
      : {}),
  };
}

export function normalizeStudioBrushGrainSettings(
  value?: unknown
): NormalizedStudioBrushGrainSettings {
  const source = asRecord(value) ?? {};
  const procedural = {
    space: source.space === "stroke-fixed" ? "stroke-fixed" : "canvas-fixed",
    amount: clamp(
      finiteNumber(source.amount, DEFAULT_GRAIN.amount),
      STUDIO_BRUSH_GRAIN_LIMITS.amount.min,
      STUDIO_BRUSH_GRAIN_LIMITS.amount.max
    ),
    scale: clamp(
      finiteNumber(source.scale, DEFAULT_GRAIN.scale),
      STUDIO_BRUSH_GRAIN_LIMITS.scale.min,
      STUDIO_BRUSH_GRAIN_LIMITS.scale.max
    ),
    contrast: clamp(
      finiteNumber(source.contrast, DEFAULT_GRAIN.contrast),
      STUDIO_BRUSH_GRAIN_LIMITS.contrast.min,
      STUDIO_BRUSH_GRAIN_LIMITS.contrast.max
    ),
    seed: uint32(source.seed, DEFAULT_GRAIN.seed),
  } satisfies NormalizedStudioBrushGrainSettings;
  const sourceProperty = ownEnumerableDataProperty(source, "source");
  if (
    sourceProperty.status === "absent"
    || (sourceProperty.status === "data" && sourceProperty.value == null)
  ) {
    // Do not add a discriminator for legacy procedural grain. Its canonical JSON is persisted in
    // authored strokes and must stay byte-for-byte stable.
    return procedural;
  }
  if (sourceProperty.status === "poisoned") {
    return { ...procedural, amount: 0 };
  }
  const r8Source = normalizeStudioBrushR8TextureGrainSource(sourceProperty.value);
  return r8Source
    ? { ...procedural, source: r8Source }
    : { ...procedural, amount: 0 };
}

/** Stable standalone grain JSON. Existing procedural snapshots retain their historical key order. */
export function serializeStudioBrushGrainSettingsCanonical(value?: unknown): string {
  return JSON.stringify(normalizeStudioBrushGrainSettings(value));
}

export function studioBrushGrainUsesR8Texture(
  value?: unknown,
): boolean {
  return normalizeStudioBrushGrainSettings(value).source?.kind === "r8-texture-v1";
}

export function studioBrushColorDynamicsIsActive(value?: unknown): boolean {
  const settings = normalizeStudioBrushColorDynamicsSettings(value);
  return normalizedColorDynamicsIsActive(settings);
}

function normalizedColorDynamicsIsActive(
  settings: NormalizedStudioBrushColorDynamicsSettings
): boolean {
  return (
    (settings.backgroundColor !== null && (
      settings.foregroundBackgroundMix > 0
      || settings.foregroundBackgroundJitter > 0
    ))
    || settings.hueJitter > 0
    || settings.saturationJitter > 0
    || settings.valueJitter > 0
  );
}

export function studioBrushGrainIsActive(value?: unknown): boolean {
  return normalizeStudioBrushGrainSettings(value).amount > 0;
}

/** Stable unsigned hash converted to [0, 1); independent from Math.random. */
function seededUnit(seed: number, index: number, salt: number): number {
  let value = (seed ^ Math.imul((index + 1) >>> 0, 0x9e37_79b1) ^ salt) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb_352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846c_a68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}

function hexToRgb(value: string): [number, number, number] | null {
  const canonical = canonicalHexColor(value);
  if (!canonical) return null;
  return [
    Number.parseInt(canonical.slice(1, 3), 16) / 255,
    Number.parseInt(canonical.slice(3, 5), 16) / 255,
    Number.parseInt(canonical.slice(5, 7), 16) / 255,
  ];
}

function rgbToHsv([r, g, b]: readonly number[]): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > Number.EPSILON) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue = ((hue / 6) % 1 + 1) % 1;
  }
  return [hue, max <= Number.EPSILON ? 0 : delta / max, max];
}

function hsvToRgb(hue: number, saturation: number, value: number): [number, number, number] {
  const h = (((hue % 1) + 1) % 1) * 6;
  const sector = Math.floor(h);
  const fraction = h - sector;
  const p = value * (1 - saturation);
  const q = value * (1 - fraction * saturation);
  const t = value * (1 - (1 - fraction) * saturation);
  switch (sector % 6) {
    case 0: return [value, t, p];
    case 1: return [q, value, p];
    case 2: return [p, value, t];
    case 3: return [p, q, value];
    case 4: return [t, p, value];
    default: return [value, p, q];
  }
}

function rgbToHex(rgb: readonly number[]): string {
  return `#${rgb.map((channel) => (
    Math.round(clamp01(channel) * 255).toString(16).padStart(2, "0")
  )).join("")}`;
}

/** Resolves one dab colour from the persisted foreground/background and HSV contract. */
export function resolveStudioBrushDabColor(
  foregroundColor: string,
  dabIndex: number,
  strokeSeed: number,
  value?: unknown
): string {
  const settings = normalizeStudioBrushColorDynamicsSettings(value);
  return resolveNormalizedStudioBrushDabColor(foregroundColor, dabIndex, strokeSeed, settings);
}

/** Renderer fast path for a settings snapshot that already crossed normalization. */
export function resolveNormalizedStudioBrushDabColor(
  foregroundColor: string,
  dabIndex: number,
  strokeSeed: number,
  settings: NormalizedStudioBrushColorDynamicsSettings
): string {
  if (!normalizedColorDynamicsIsActive(settings)) return foregroundColor;
  const foreground = hexToRgb(foregroundColor);
  if (!foreground) return foregroundColor;

  let rgb = foreground;
  const background = settings.backgroundColor ? hexToRgb(settings.backgroundColor) : null;
  if (background) {
    const mixJitter = (seededUnit(strokeSeed, dabIndex, 0xa511_e9b3) * 2 - 1)
      * settings.foregroundBackgroundJitter;
    const mix = clamp01(settings.foregroundBackgroundMix + mixJitter);
    if (settings.pigmentMixProgramId === STUDIO_SPECTRAL_WGM_COLOR_MIX_PROGRAM_ID) {
      /*
       * libmypaint `mix_colors` semantics: `factor` weighs the FIRST colour
       * (upstream: the accumulated smudge bucket). Our `mix` measures progress
       * TOWARD the background pigment, so the foreground keeps weight
       * `1 - mix` — mix 0 stays the (10-band round-tripped) foreground exactly
       * like the linear branch below keeps the raw foreground. This is the same
       * per-dab seed stream as the linear branch, so the pinned lane replays,
       * exports and collaborates deterministically; unpinned snapshots never
       * reach this call and keep the historical lerp bytes.
       */
      const mixed = mixStudioSpectralWgm(
        { r: foreground[0], g: foreground[1], b: foreground[2] },
        { r: background[0], g: background[1], b: background[2] },
        1 - mix,
        STUDIO_SPECTRAL_WGM_COLOR_MIX_PAINT_MODE,
      );
      rgb = [mixed.r, mixed.g, mixed.b];
    } else {
      rgb = [
        foreground[0] + (background[0] - foreground[0]) * mix,
        foreground[1] + (background[1] - foreground[1]) * mix,
        foreground[2] + (background[2] - foreground[2]) * mix,
      ];
    }
  }

  if (
    settings.hueJitter <= 0
    && settings.saturationJitter <= 0
    && settings.valueJitter <= 0
  ) {
    return rgbToHex(rgb);
  }

  const hsv = rgbToHsv(rgb);
  hsv[0] += (seededUnit(strokeSeed, dabIndex, 0x63d8_35d5) * 2 - 1)
    * settings.hueJitter / 360;
  hsv[1] = clamp01(hsv[1] + (seededUnit(strokeSeed, dabIndex, 0x9e37_79b9) * 2 - 1)
    * settings.saturationJitter);
  hsv[2] = clamp01(hsv[2] + (seededUnit(strokeSeed, dabIndex, 0x243f_6a88) * 2 - 1)
    * settings.valueJitter);
  return rgbToHex(hsvToRgb(hsv[0], hsv[1], hsv[2]));
}

function coordinateHash(x: number, y: number, seed: number): number {
  let value = seed ^ Math.imul(x | 0, 0x1f12_3bb5) ^ Math.imul(y | 0, 0x5f35_6495);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb_352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846c_a68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}

function smoothstep(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);
  const top = coordinateHash(x0, y0, seed)
    + (coordinateHash(x0 + 1, y0, seed) - coordinateHash(x0, y0, seed)) * tx;
  const bottom = coordinateHash(x0, y0 + 1, seed)
    + (coordinateHash(x0 + 1, y0 + 1, seed) - coordinateHash(x0, y0 + 1, seed)) * tx;
  return top + (bottom - top) * ty;
}

/**
 * Opacity multiplier for a world-space tip sample. Stroke-fixed subtracts the first source station,
 * so translating a stroke preserves its grain; canvas-fixed intentionally resamples the canvas.
 */
export function resolveStudioBrushGrainAlphaMultiplier(
  sample: StudioBrushGrainSample,
  value?: unknown
): number {
  const settings = normalizeStudioBrushGrainSettings(value);
  return resolveNormalizedStudioBrushGrainAlphaMultiplier(sample, settings);
}

/** Renderer fast path for one of the many samples under a normalized grain snapshot. */
export function resolveNormalizedStudioBrushGrainAlphaMultiplier(
  sample: StudioBrushGrainSample,
  settings: NormalizedStudioBrushGrainSettings
): number {
  return resolveNormalizedStudioBrushGrainAlphaMultiplierAt(
    sample.x,
    sample.y,
    sample.strokeOriginX,
    sample.strokeOriginY,
    sample.strokeSeed,
    settings
  );
}

/**
 * Allocation-free renderer path for high-density tip samples. The object-based public helper
 * above delegates here so Canvas, SVG and collaboration replay retain one exact grain formula.
 */
export function resolveNormalizedStudioBrushGrainAlphaMultiplierAt(
  sampleX: number,
  sampleY: number,
  strokeOriginX: number | undefined,
  strokeOriginY: number | undefined,
  strokeSeed: number,
  settings: NormalizedStudioBrushGrainSettings
): number {
  // This helper is the historical procedural sampler. An admitted R8 source must be sampled by an
  // R8-aware renderer; falling back to unrelated noise would produce divergent replay pixels.
  if (settings.amount <= 0 || settings.source?.kind === "r8-texture-v1") return 1;
  const x = finiteNumber(sampleX, 0);
  const y = finiteNumber(sampleY, 0);
  const anchorX = settings.space === "stroke-fixed"
    ? finiteNumber(strokeOriginX, 0)
    : 0;
  const anchorY = settings.space === "stroke-fixed"
    ? finiteNumber(strokeOriginY, 0)
    : 0;
  const seed = (uint32(strokeSeed, 1) ^ settings.seed ^ 0xb7e1_5163) >>> 0;
  const noise = valueNoise((x - anchorX) / settings.scale, (y - anchorY) / settings.scale, seed);
  const contrasted = clamp01((noise - 0.5) * (1 + settings.contrast * 4) + 0.5);
  return clamp01(1 - settings.amount * (1 - contrasted));
}

/**
 * Integrates paper/canvas grain across one affine tip carrier instead of sampling only its centre.
 *
 * A centre-only scalar makes a complete charcoal/crayon stamp pulse bright/dark as it crosses a
 * noise cell, exposing the circular dab lattice during fast strokes. This deterministic quadrature
 * samples the centre, axial shoulders and diagonals in the rotated tip footprint. Canvas and SVG
 * can therefore share one mark alpha while the WebGPU path later evaluates the same grain per
 * fragment. The helper is allocation-free and preserves the exact disabled-grain identity.
 */
export function resolveNormalizedStudioBrushFootprintGrainAlphaMultiplierAt(
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  angleRadians: number,
  strokeOriginX: number | undefined,
  strokeOriginY: number | undefined,
  strokeSeed: number,
  settings: NormalizedStudioBrushGrainSettings,
): number {
  if (settings.amount <= 0 || settings.source?.kind === "r8-texture-v1") return 1;
  const x = finiteNumber(centerX, 0);
  const y = finiteNumber(centerY, 0);
  const rx = clamp(Math.abs(finiteNumber(radiusX, 0)), 0, 1_000_000);
  const ry = clamp(Math.abs(finiteNumber(radiusY, 0)), 0, 1_000_000);
  const angle = finiteNumber(angleRadians, 0);
  if (rx <= 1e-6 && ry <= 1e-6) {
    return resolveNormalizedStudioBrushGrainAlphaMultiplierAt(
      x,
      y,
      strokeOriginX,
      strokeOriginY,
      strokeSeed,
      settings,
    );
  }

  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  let weighted = 0;
  let totalWeight = 0;
  // Static affine quadrature: centre has extra weight, shoulders preserve directional paper tooth,
  // and diagonals suppress whole-carrier pulses without washing the material into a flat opacity.
  for (const [unitX, unitY, weight] of STUDIO_BRUSH_GRAIN_FOOTPRINT_SAMPLES) {
    const localX = unitX * rx;
    const localY = unitY * ry;
    const sampleX = x + localX * cosine - localY * sine;
    const sampleY = y + localX * sine + localY * cosine;
    weighted += resolveNormalizedStudioBrushGrainAlphaMultiplierAt(
      sampleX,
      sampleY,
      strokeOriginX,
      strokeOriginY,
      strokeSeed,
      settings,
    ) * weight;
    totalWeight += weight;
  }
  return clamp01(weighted / totalWeight);
}
