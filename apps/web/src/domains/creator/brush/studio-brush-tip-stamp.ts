/**
 * PNG-alpha tip stamp engine for Studio dynamic brushes.
 *
 * Pure, DOM-free: tip alpha maps are square 0..1 grids (procedural built-ins or compact
 * base64 custom maps). Stamp footprints honor dab size / angle / roundness and are fully
 * deterministic for the same tip settings, so canvas, SVG and tests share one plan.
 */

import type { StudioDynamicBrushDab } from "./studio-brush-dynamics";

/**
 * Procedural renderer tips use a high-resolution R8 source so a large charcoal/crayon nib does
 * not expose 8px-wide source texels. Imported in-document payloads retain their separate 64²
 * boundary below; quality growth must not silently expand collaboration/document payload size.
 */
export const STUDIO_BRUSH_TIP_ALPHA_MAP_SIZE_RANGE = { min: 8, max: 256 } as const;
export const DEFAULT_STUDIO_BRUSH_TIP_ALPHA_MAP_SIZE = 128;
export const STUDIO_BRUSH_CUSTOM_TIP_ALPHA_MAP_MAX_SIZE = 64;
export const STUDIO_BRUSH_TIP_STAMP_GRID_RANGE = { min: 3, max: 17 } as const;
export const DEFAULT_STUDIO_BRUSH_TIP_STAMP_GRID = 9;
/** Largest decoded custom tip accepted at the document boundary (64 x 64 alpha bytes). */
export const STUDIO_BRUSH_TIP_ALPHA_MAP_MAX_BYTES =
  STUDIO_BRUSH_CUSTOM_TIP_ALPHA_MAP_MAX_SIZE ** 2;
/** Padded base64 character budget for the largest supported alpha map. */
export const STUDIO_BRUSH_TIP_ALPHA_MAP_BASE64_MAX_CHARS =
  Math.ceil(STUDIO_BRUSH_TIP_ALPHA_MAP_MAX_BYTES / 3) * 4;
/**
 * Raw input guard. A wrapped payload may contain whitespace, but it cannot make the decoder scan
 * an unbounded string before the compact encoded-length check runs.
 */
export const STUDIO_BRUSH_TIP_ALPHA_MAP_BASE64_SOURCE_MAX_CHARS =
  STUDIO_BRUSH_TIP_ALPHA_MAP_BASE64_MAX_CHARS * 2;
/**
 * Covers the complete bundled catalogue plus active dual/layer variants. At the 128² procedural
 * default this is about 16 MiB of R32 alpha data and avoids regenerating material maps while an
 * artist switches across the library; byte-heavy destination RGBA surfaces keep a separate budget.
 */
export const STUDIO_BRUSH_TIP_ALPHA_MAP_CACHE_LIMIT = 256;

export const STUDIO_BRUSH_TIP_SHAPE_IDS = [
  "round",
  "soft",
  "hard",
  "flake",
  "grain",
  "bristle",
  "sponge",
  "sumi",
  "halftone",
  "star",
] as const;

export type StudioBrushTipShapeId = (typeof STUDIO_BRUSH_TIP_SHAPE_IDS)[number];

export interface StudioBrushTipSettings {
  shape?: StudioBrushTipShapeId;
  /** Edge falloff for procedural and imported tips (0 = original/sharp, 1 = softest). */
  softness?: number;
  /**
   * Optional custom alpha channel: base64 of N×N bytes (0..255). When present and valid,
   * overrides the procedural shape — this is the in-document PNG-alpha tip payload.
   */
  alphaMapBase64?: string | null;
  alphaMapSize?: number;
}

export interface NormalizedStudioBrushTipSettings {
  shape: StudioBrushTipShapeId;
  softness: number;
  alphaMapBase64: string | null;
  alphaMapSize: number;
}

export interface StudioBrushTipAlphaMap {
  size: number;
  /** Row-major alpha samples in 0..1. Length is always size*size. */
  alphas: Float32Array;
  shape: StudioBrushTipShapeId;
  softness: number;
  custom: boolean;
  /**
   * Stable content revision for immutable renderer maps. Maps without a revision are treated as
   * editable external inputs and are resampled on every call; editors may increment this value
   * after an in-place update to retain caching safely.
   */
  readonly revision?: string | number;
}

export interface StudioBrushTipStampSample {
  /** Offset from dab centre after angle/roundness transform, in document px. */
  dx: number;
  dy: number;
  alpha: number;
  /** Local stamp radius for this sample (document px). */
  radius: number;
}

export interface StudioBrushTipStampPlan {
  samples: StudioBrushTipStampSample[];
  tip: NormalizedStudioBrushTipSettings;
  mapSize: number;
  grid: number;
}

export type StudioBrushTipStampSampleVisitor = (
  dx: number,
  dy: number,
  alpha: number,
  radius: number
) => void;

const DEFAULT_TIP: NormalizedStudioBrushTipSettings = {
  shape: "round",
  softness: 0.35,
  alphaMapBase64: null,
  alphaMapSize: DEFAULT_STUDIO_BRUSH_TIP_ALPHA_MAP_SIZE,
};

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const STUDIO_BRUSH_TIP_STAMP_ALPHA_THRESHOLD = 0.02;
const tipAlphaMapCache = new Map<string, StudioBrushTipAlphaMap>();
const normalizedTipSettingsCache = new Map<string, NormalizedStudioBrushTipSettings>();

interface StudioBrushTipStampUnitSample {
  readonly localX: number;
  readonly localY: number;
  readonly alpha: number;
  /** Per-sample multiplier on the shared sub-dab radius; 1 is the lattice cell's own size. */
  readonly radiusScale: number;
  readonly fallback?: true;
}

/**
 * How far a sub-dab is displaced from its lattice node, and how much its size varies.
 *
 * The stamp used to be a rigid `grid x grid` axis-aligned lattice - default 9x9, up to 81 nodes -
 * with ONE `sampleRadius` shared by every node, built once and rubber-stamped at every dab of every
 * stroke with nothing but the dab angle changing. Position came from a grid, size was constant, and
 * only alpha varied. A texture whose only variation is alpha over a regular lattice does not read
 * as grain; it reads as a printed screen, and this is the single tip path behind dry media, pencil,
 * spray, splatter, charcoal and chalk - the largest brush population in the product.
 *
 * Both values are hashed from the node's own lattice coordinates, so the whole sample set is still
 * a pure function of (map, grid) and stays in the existing cache. Nothing is computed per dab and
 * live, replay and SVG keep reading the identical sample list.
 *
 * The displacement is bounded well inside the cell. Nodes sit `1 / half` apart in unit coordinates
 * and each sub-dab has radius `0.72` of a cell, so neighbours overlap by 1.44 diameters against a
 * spacing of 1.0; a third of a cell of jitter breaks the alignment without opening holes.
 */
const TIP_SAMPLE_JITTER_CELLS = 0.34;
/**
 * Absolute ceiling on that displacement, in tip radii.
 *
 * A third of a CELL is modest at grid 9 (0.085 radii) and enormous at grid 3, where one cell is the
 * whole tip. The small grids are also the LOD the live budget falls back to on long strokes, and
 * unbounded jitter there moved samples into higher-alpha regions, raised the grid-3 sample count
 * 3 -> 5, and pushed the smallest grid past the live mark budget - so a long charcoal stroke could
 * no longer step down at all. There is no visible lattice at 9 nodes to break in the first place;
 * the artifact this fixes lives at 81.
 */
const TIP_SAMPLE_JITTER_MAX_RADII = 0.09;
const TIP_SAMPLE_RADIUS_VARIATION = 0.22;

/**
 * Alpha-map lookup coordinates only depend on the immutable map identity and stamp grid. Keeping
 * this bounded by the alpha-map LRU avoids repeating the same bilinear 9×9 texture scan for every
 * dab in an active stroke.
 */
interface StudioBrushTipStampUnitSampleCache {
  readonly revision: string | number;
  readonly samplesByGrid: Map<number, readonly StudioBrushTipStampUnitSample[]>;
}

const tipStampUnitSampleCache = new WeakMap<
  StudioBrushTipAlphaMap,
  StudioBrushTipStampUnitSampleCache
>();

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function studioBrushTipAlphaMapCacheKey(value: unknown): string {
  const source = asRecord(value);
  if (!source) return "default";
  const shape = typeof source.shape === "string" ? source.shape : null;
  const softness = typeof source.softness === "number" && Number.isFinite(source.softness)
    ? source.softness
    : null;
  const alphaMapSize = typeof source.alphaMapSize === "number" && Number.isFinite(source.alphaMapSize)
    ? source.alphaMapSize
    : null;
  const alphaMapBase64 = typeof source.alphaMapBase64 === "string"
    ? source.alphaMapBase64.length <= STUDIO_BRUSH_TIP_ALPHA_MAP_BASE64_SOURCE_MAX_CHARS
      ? source.alphaMapBase64
      : `oversized:${source.alphaMapBase64.length}`
    : null;
  // Structured encoding keeps arbitrary imported strings (including NUL separators) from
  // aliasing another document's normalized settings. Oversized payloads are intentionally keyed
  // only by length because every such payload normalizes to the same absent alpha map.
  return JSON.stringify([shape, softness, alphaMapSize, alphaMapBase64]);
}

function cachedStudioBrushTipAlphaMap(key: string): StudioBrushTipAlphaMap | null {
  const cached = tipAlphaMapCache.get(key);
  if (!cached) return null;
  // Map insertion order is the LRU queue. Alpha maps are immutable renderer inputs.
  tipAlphaMapCache.delete(key);
  tipAlphaMapCache.set(key, cached);
  return cached;
}

function cacheStudioBrushTipAlphaMap(
  key: string,
  map: StudioBrushTipAlphaMap
): StudioBrushTipAlphaMap {
  if (tipAlphaMapCache.size >= STUDIO_BRUSH_TIP_ALPHA_MAP_CACHE_LIMIT) {
    const oldestKey = tipAlphaMapCache.keys().next().value;
    if (oldestKey !== undefined) tipAlphaMapCache.delete(oldestKey);
  }
  tipAlphaMapCache.set(key, map);
  return map;
}

function normalizedStudioBrushTipSettingsForStamp(
  value: unknown
): NormalizedStudioBrushTipSettings {
  const key = studioBrushTipAlphaMapCacheKey(value);
  const cached = normalizedTipSettingsCache.get(key);
  if (cached) {
    normalizedTipSettingsCache.delete(key);
    normalizedTipSettingsCache.set(key, cached);
    // `plan.tip` has historically been detached. Never expose the cached canonical object.
    return { ...cached };
  }
  const normalized = normalizeStudioBrushTipSettings(value);
  if (normalizedTipSettingsCache.size >= STUDIO_BRUSH_TIP_ALPHA_MAP_CACHE_LIMIT) {
    const oldestKey = normalizedTipSettingsCache.keys().next().value;
    if (oldestKey !== undefined) normalizedTipSettingsCache.delete(oldestKey);
  }
  normalizedTipSettingsCache.set(key, normalized);
  return { ...normalized };
}

export function isStudioBrushTipShapeId(value: unknown): value is StudioBrushTipShapeId {
  return typeof value === "string"
    && (STUDIO_BRUSH_TIP_SHAPE_IDS as readonly string[]).includes(value);
}

/** Encode raw alpha bytes (0..255) into a URL-safe-enough standard base64 payload. */
export function encodeStudioBrushTipAlphaMapBase64(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = index + 1 < bytes.length ? bytes[index + 1]! : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2]! : 0;
    const triple = (a << 16) | (b << 8) | c;
    output += BASE64_ALPHABET[(triple >> 18) & 63];
    output += BASE64_ALPHABET[(triple >> 12) & 63];
    output += index + 1 < bytes.length ? BASE64_ALPHABET[(triple >> 6) & 63] : "=";
    output += index + 2 < bytes.length ? BASE64_ALPHABET[triple & 63] : "=";
  }
  return output;
}

/** Decode standard base64 (with or without padding) into raw bytes. Invalid input returns null. */
export function decodeStudioBrushTipAlphaMapBase64(value: unknown): Uint8Array | null {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > STUDIO_BRUSH_TIP_ALPHA_MAP_BASE64_SOURCE_MAX_CHARS
  ) return null;
  const cleaned = value.replace(/\s+/g, "");
  if (
    cleaned.length > STUDIO_BRUSH_TIP_ALPHA_MAP_BASE64_MAX_CHARS
    || !/^[A-Za-z0-9+/]+=*$/.test(cleaned)
    || cleaned.length % 4 !== 0
  ) return null;
  const firstPaddingIndex = cleaned.indexOf("=");
  const paddingLength = firstPaddingIndex < 0 ? 0 : cleaned.length - firstPaddingIndex;
  if (paddingLength > 2) return null;
  const decodedLength = (cleaned.length / 4) * 3 - paddingLength;
  if (decodedLength > STUDIO_BRUSH_TIP_ALPHA_MAP_MAX_BYTES) return null;
  const output = new Uint8Array(decodedLength);
  let write = 0;
  for (let index = 0; index < cleaned.length; index += 4) {
    const c0 = BASE64_ALPHABET.indexOf(cleaned[index]!);
    const c1 = BASE64_ALPHABET.indexOf(cleaned[index + 1]!);
    const c2 = cleaned[index + 2] === "=" ? -1 : BASE64_ALPHABET.indexOf(cleaned[index + 2]!);
    const c3 = cleaned[index + 3] === "=" ? -1 : BASE64_ALPHABET.indexOf(cleaned[index + 3]!);
    if (c0 < 0 || c1 < 0 || (cleaned[index + 2] !== "=" && c2 < 0) || (cleaned[index + 3] !== "=" && c3 < 0)) {
      return null;
    }
    const triple = (c0 << 18) | (c1 << 12) | ((c2 < 0 ? 0 : c2) << 6) | (c3 < 0 ? 0 : c3);
    output[write++] = (triple >> 16) & 255;
    if (c2 >= 0) output[write++] = (triple >> 8) & 255;
    if (c3 >= 0) output[write++] = triple & 255;
  }
  return write === output.length ? output : null;
}

export function normalizeStudioBrushTipSettings(value?: unknown): NormalizedStudioBrushTipSettings {
  const source = asRecord(value) ?? {};
  const shape = isStudioBrushTipShapeId(source.shape) ? source.shape : DEFAULT_TIP.shape;
  const softness = clamp01(finiteNumber(source.softness, DEFAULT_TIP.softness));
  const alphaMapSize = Math.trunc(clamp(
    finiteNumber(source.alphaMapSize, DEFAULT_TIP.alphaMapSize),
    STUDIO_BRUSH_TIP_ALPHA_MAP_SIZE_RANGE.min,
    STUDIO_BRUSH_TIP_ALPHA_MAP_SIZE_RANGE.max
  ));
  let alphaMapBase64: string | null = null;
  if (typeof source.alphaMapBase64 === "string" && source.alphaMapBase64.length > 0) {
    const decoded = decodeStudioBrushTipAlphaMapBase64(source.alphaMapBase64);
    const expected = alphaMapSize * alphaMapSize;
    if (decoded && decoded.length === expected) {
      alphaMapBase64 = encodeStudioBrushTipAlphaMapBase64(decoded);
    }
  } else if (source.alphaMapBase64 === null) {
    alphaMapBase64 = null;
  }
  return { shape, softness, alphaMapBase64, alphaMapSize };
}

function hashUnit(x: number, y: number, salt: number): number {
  let value = Math.imul(Math.floor(x * 4096) ^ salt, 0x9e37_79b1) >>> 0;
  value ^= Math.imul(Math.floor(y * 4096) + 1, 0x85eb_ca6b) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb_352d);
  value ^= value >>> 15;
  return (value >>> 0) / 0x1_0000_0000;
}

/**
 * Sample a procedural tip alpha at normalized coordinates in [-1, 1] × [-1, 1].
 * Outside the unit disk (or star arms) returns 0 — same contract as a PNG alpha channel.
 */
export function sampleStudioBrushTipProceduralAlpha(
  shape: StudioBrushTipShapeId,
  nx: number,
  ny: number,
  softness: number
): number {
  const soft = clamp01(softness);
  const radius = Math.hypot(nx, ny);
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return 0;

  switch (shape) {
    case "round": {
      if (radius >= 1) return 0;
      const edge = 1 - radius;
      const falloff = Math.pow(edge, 0.35 + soft * 1.8);
      return clamp01(falloff);
    }
    case "soft": {
      if (radius >= 1) return 0;
      const core = Math.pow(1 - radius, 1.4 + soft * 2.2);
      // Softness controls the radial falloff, not the paint valve. Attenuating the centre as well
      // made opacity and flow get multiplied by a hidden 0.55..1 factor, so an artist-visible 70%
      // airbrush could deposit only ~5.5% alpha on its strongest pixel. Keep the centre normalized
      // to one and let the serialized opacity/flow channels remain the single density controls.
      return clamp01(core);
    }
    case "hard": {
      if (radius >= 1) return 0;
      const edgeWidth = 0.04 + soft * 0.28;
      if (radius <= 1 - edgeWidth) return 1;
      return clamp01((1 - radius) / edgeWidth);
    }
    case "flake": {
      if (radius >= 1) return 0;
      const angle = Math.atan2(ny, nx);
      const ridges = 0.55 + 0.45 * Math.cos(angle * 3 + radius * 4);
      const body = Math.pow(1 - radius, 0.55 + soft);
      return clamp01(body * ridges);
    }
    case "grain": {
      if (radius >= 1) return 0;
      const grain = 0.35 + 0.65 * hashUnit(nx, ny, 0x51e0_03ab);
      const body = Math.pow(1 - radius, 0.7 + soft * 1.2);
      return clamp01(body * grain);
    }
    case "bristle": {
      // A fan of deterministic fibres: broad enough to join into a stroke, but with
      // lengthwise channels that stay visible at normal Webtoon inking sizes.
      const bodyRadius = Math.hypot(nx * 0.82, ny * 1.04);
      if (bodyRadius >= 1) return 0;
      const fibres = Math.abs(Math.sin((nx + 1.07) * Math.PI * 7.5));
      const brokenEdge = 0.72 + 0.28 * hashUnit(Math.round(nx * 13), Math.round(ny * 7), 0x2b7e_1516);
      const channel = 0.28 + 0.72 * Math.pow(fibres, 0.35 + soft * 0.9);
      return clamp01(Math.pow(1 - bodyRadius, 0.22 + soft * 0.9) * channel * brokenEdge);
    }
    case "sponge": {
      if (radius >= 1) return 0;
      // Coarse cellular pores remain deterministic across Canvas, SVG and collaboration replay.
      const cellX = Math.floor((nx + 1) * 6);
      const cellY = Math.floor((ny + 1) * 6);
      const pore = hashUnit(cellX, cellY, 0x76d4_4b91);
      const mottling = 0.18 + 0.82 * Math.pow(pore, 0.55 + soft * 0.8);
      const body = Math.pow(1 - radius, 0.28 + soft * 0.75);
      return clamp01(body * mottling);
    }
    case "sumi": {
      // Slightly asymmetric, ragged ink belly inspired by a loaded sumi brush.
      const warpedX = nx * (0.82 + 0.1 * Math.sin(ny * 7));
      const warpedY = (ny + 0.08 * Math.sin(nx * 5)) * 1.04;
      const inkRadius = Math.hypot(warpedX, warpedY);
      const fringe = 0.9 + 0.1 * hashUnit(Math.round(nx * 19), Math.round(ny * 19), 0x5a11_0b1e);
      if (inkRadius >= fringe) return 0;
      const belly = Math.pow(1 - inkRadius / fringe, 0.18 + soft * 0.95);
      const dryBreak = 0.58 + 0.42 * hashUnit(Math.round(nx * 17), Math.round(ny * 5), 0x11da_7a1f);
      return clamp01(belly * dryBreak);
    }
    case "halftone": {
      if (radius >= 1) return 0;
      const frequency = 5;
      const gridX = (nx + 1) * frequency;
      const gridY = (ny + 1) * frequency;
      const dotX = gridX - Math.round(gridX);
      const dotY = gridY - Math.round(gridY);
      const dotDistance = Math.hypot(dotX, dotY);
      const dotRadius = 0.26 + (1 - soft) * 0.08;
      if (dotDistance >= dotRadius) return 0;
      const dotEdge = 1 - dotDistance / dotRadius;
      const vignette = Math.pow(1 - radius, 0.08 + soft * 0.35);
      return clamp01(Math.pow(dotEdge, 0.35 + soft) * vignette);
    }
    case "star": {
      const angle = Math.atan2(ny, nx);
      const points = 5;
      const starRadius = 0.45 + 0.55 * Math.abs(Math.cos(angle * points / 2));
      const limit = starRadius * (0.92 + soft * 0.08);
      if (radius >= limit) return 0;
      const edge = 1 - radius / limit;
      return clamp01(Math.pow(edge, 0.5 + soft));
    }
    default:
      return 0;
  }
}

function buildProceduralAlphaMap(
  shape: StudioBrushTipShapeId,
  softness: number,
  size: number
): Float32Array {
  const alphas = new Float32Array(size * size);
  const centre = (size - 1) / 2;
  let peak = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = centre === 0 ? 0 : (x - centre) / centre;
      const ny = centre === 0 ? 0 : (y - centre) / centre;
      const alpha = sampleStudioBrushTipProceduralAlpha(shape, nx, ny, softness);
      alphas[y * size + x] = alpha;
      if (alpha > peak) peak = alpha;
    }
  }
  // Most canonical maps use an even resolution, so no texel sits exactly at (0, 0). Normalize the
  // sampled soft map back to its analytic unit-energy centre; otherwise changing 23→24 texels (or
  // importing the same brush on another grid) silently changes the strongest paint deposit.
  if (shape === "soft" && peak > 0 && peak < 1) {
    const scale = 1 / peak;
    for (let index = 0; index < alphas.length; index++) {
      alphas[index] = clamp01(alphas[index]! * scale);
    }
  }
  return alphas;
}

function softenCustomAlphaMap(
  source: Float32Array,
  size: number,
  softness: number
): Float32Array {
  const blend = clamp01(softness);
  if (blend <= 0 || size <= 1) return source;
  const maxRadius = Math.max(1, Math.min(4, Math.floor(size / 8)));
  const radius = Math.max(1, Math.ceil(maxRadius * blend));
  const horizontal = new Float32Array(source.length);
  const blurred = new Float32Array(source.length);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let total = 0;
      let weight = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        const sampleX = clamp(x + offset, 0, size - 1);
        const sampleWeight = radius + 1 - Math.abs(offset);
        total += (source[y * size + sampleX] ?? 0) * sampleWeight;
        weight += sampleWeight;
      }
      horizontal[y * size + x] = total / Math.max(1, weight);
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let total = 0;
      let weight = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        const sampleY = clamp(y + offset, 0, size - 1);
        const sampleWeight = radius + 1 - Math.abs(offset);
        total += (horizontal[sampleY * size + x] ?? 0) * sampleWeight;
        weight += sampleWeight;
      }
      const index = y * size + x;
      const softAlpha = total / Math.max(1, weight);
      blurred[index] = clamp01((source[index] ?? 0) * (1 - blend) + softAlpha * blend);
    }
  }
  return blurred;
}

function buildCustomAlphaMap(
  base64: string,
  size: number,
  softness: number
): Float32Array | null {
  const bytes = decodeStudioBrushTipAlphaMapBase64(base64);
  if (!bytes || bytes.length !== size * size) return null;
  const alphas = new Float32Array(size * size);
  for (let index = 0; index < bytes.length; index++) {
    alphas[index] = bytes[index]! / 255;
  }
  return softenCustomAlphaMap(alphas, size, softness);
}

/** Build a reusable tip alpha map (procedural or custom PNG-alpha payload). */
export function buildStudioBrushTipAlphaMap(value?: unknown): StudioBrushTipAlphaMap {
  // Check the raw, stable input before normalization: normalizing a custom payload validates and
  // canonicalizes base64, which was previously repeated for every live-draft React render.
  const cacheKey = studioBrushTipAlphaMapCacheKey(value);
  const cached = cachedStudioBrushTipAlphaMap(cacheKey);
  if (cached) return cached;
  const tip = normalizeStudioBrushTipSettings(value);
  if (tip.alphaMapBase64) {
    const custom = buildCustomAlphaMap(
      tip.alphaMapBase64,
      tip.alphaMapSize,
      tip.softness
    );
    if (custom) {
      return cacheStudioBrushTipAlphaMap(cacheKey, {
        size: tip.alphaMapSize,
        alphas: custom,
        shape: tip.shape,
        softness: tip.softness,
        custom: true,
        revision: cacheKey,
      });
    }
  }
  return cacheStudioBrushTipAlphaMap(cacheKey, {
    size: tip.alphaMapSize,
    alphas: buildProceduralAlphaMap(tip.shape, tip.softness, tip.alphaMapSize),
    shape: tip.shape,
    softness: tip.softness,
    custom: false,
    revision: cacheKey,
  });
}

/** Sample map alpha at continuous pixel coords with bilinear filtering. */
export function sampleStudioBrushTipAlphaMap(
  map: StudioBrushTipAlphaMap,
  px: number,
  py: number
): number {
  const max = map.size - 1;
  if (map.size <= 0) return 0;
  const x = clamp(px, 0, max);
  const y = clamp(py, 0, max);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(max, x0 + 1);
  const y1 = Math.min(max, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const a00 = map.alphas[y0 * map.size + x0] ?? 0;
  const a10 = map.alphas[y0 * map.size + x1] ?? 0;
  const a01 = map.alphas[y1 * map.size + x0] ?? 0;
  const a11 = map.alphas[y1 * map.size + x1] ?? 0;
  const top = a00 + (a10 - a00) * tx;
  const bottom = a01 + (a11 - a01) * tx;
  return clamp01(top + (bottom - top) * ty);
}

function normalizedStudioBrushTipStampGrid(value: unknown): number {
  const grid = Math.trunc(clamp(
    finiteNumber(value, DEFAULT_STUDIO_BRUSH_TIP_STAMP_GRID),
    STUDIO_BRUSH_TIP_STAMP_GRID_RANGE.min,
    STUDIO_BRUSH_TIP_STAMP_GRID_RANGE.max
  ));
  // Prefer odd grids so one sample sits on the tip centre.
  return grid % 2 === 0 ? grid + 1 : grid;
}

function studioBrushTipStampUnitSamples(
  map: StudioBrushTipAlphaMap,
  grid: number
): readonly StudioBrushTipStampUnitSample[] {
  const revision = map.revision;
  const cacheEntry = revision === undefined ? undefined : tipStampUnitSampleCache.get(map);
  const cached = (
    cacheEntry
    && Object.is(cacheEntry.revision, revision)
  )
    ? cacheEntry.samplesByGrid.get(grid)
    : undefined;
  if (cached) return cached;
  const half = (grid - 1) / 2;
  const samples: StudioBrushTipStampUnitSample[] = [];
  for (let gy = -half; gy <= half; gy++) {
    for (let gx = -half; gx <= half; gx++) {
      const nodeX = half === 0 ? 0 : gx / half;
      const nodeY = half === 0 ? 0 : gy / half;
      // Displace off the lattice node, then read the tip's alpha where the sub-dab actually lands
      // rather than where its node was - otherwise the silhouette keeps the grid's own edge.
      const spread = half === 0
        ? 0
        : Math.min(TIP_SAMPLE_JITTER_CELLS / half, TIP_SAMPLE_JITTER_MAX_RADII);
      const localX = clamp(
        nodeX + (hashUnit(gx, gy, 0x51ed_2701) - 0.5) * 2 * spread,
        -1,
        1,
      );
      const localY = clamp(
        nodeY + (hashUnit(gx, gy, 0x1b87_3f09) - 0.5) * 2 * spread,
        -1,
        1,
      );
      const mapX = (localX * 0.5 + 0.5) * (map.size - 1);
      const mapY = (localY * 0.5 + 0.5) * (map.size - 1);
      const alpha = sampleStudioBrushTipAlphaMap(map, mapX, mapY);
      if (alpha <= STUDIO_BRUSH_TIP_STAMP_ALPHA_THRESHOLD) continue;
      const radiusScale = 1
        + (hashUnit(gx, gy, 0x2f6d_9a13) - 0.5) * 2 * TIP_SAMPLE_RADIUS_VARIATION;
      samples.push({ localX, localY, alpha, radiusScale });
    }
  }
  // Degenerate empty tip: keep a single centre dab so strokes never vanish.
  if (samples.length === 0) {
    samples.push({ localX: 0, localY: 0, alpha: 1, radiusScale: 1, fallback: true });
  }
  if (revision !== undefined) {
    const samplesByGrid = (
      cacheEntry
      && Object.is(cacheEntry.revision, revision)
    )
      ? cacheEntry.samplesByGrid
      : new Map<number, readonly StudioBrushTipStampUnitSample[]>();
    samplesByGrid.set(grid, samples);
    tipStampUnitSampleCache.set(map, { revision, samplesByGrid });
  }
  return samples;
}

/** Counts alpha-tip render marks without allocating the stamp geometry used by each live dab. */
export function countStudioBrushTipStampSamples(
  tipSettings?: unknown,
  options?: { grid?: number; alphaMap?: StudioBrushTipAlphaMap | null }
): number {
  const map = options?.alphaMap ?? buildStudioBrushTipAlphaMap(tipSettings);
  const grid = normalizedStudioBrushTipStampGrid(options?.grid);
  return studioBrushTipStampUnitSamples(map, grid).length;
}

function visitStudioBrushTipStampSamplesOnGrid(
  dab: Pick<StudioDynamicBrushDab, "size" | "angle" | "roundness">,
  map: StudioBrushTipAlphaMap,
  oddGrid: number,
  visit: StudioBrushTipStampSampleVisitor
): number {
  const half = (oddGrid - 1) / 2;
  const radius = Math.max(0.25, finiteNumber(dab.size, 1) / 2);
  const roundness = clamp(finiteNumber(dab.roundness, 1), 0.08, 1);
  const angleRad = finiteNumber(dab.angle, 0) * Math.PI / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const cell = radius / Math.max(1, half);
  const unitSamples = studioBrushTipStampUnitSamples(map, oddGrid);
  const sampleRadius = unitSamples.length === 1 && unitSamples[0]!.fallback
    ? Math.max(0.25, radius * 0.35)
    : Math.max(0.2, cell * 0.72);
  for (const sample of unitSamples) {
    // Apply elliptical roundness on the tip Y axis before rotation (matches canvas ellipse path).
    const sx = sample.localX * radius;
    const sy = sample.localY * radius * roundness;
    visit(
      sx * cos - sy * sin,
      sx * sin + sy * cos,
      sample.alpha,
      sampleRadius * sample.radiusScale
    );
  }
  return unitSamples.length;
}

/**
 * Allocation-free renderer API for an already built alpha map. It emits the same primitive sample
 * sequence as `planStudioBrushTipStamp` without allocating a plan, detached tip or sample objects.
 */
export function visitStudioBrushTipStampSamples(
  dab: Pick<StudioDynamicBrushDab, "size" | "angle" | "roundness">,
  map: StudioBrushTipAlphaMap,
  visit: StudioBrushTipStampSampleVisitor,
  options?: { grid?: number }
): number {
  return visitStudioBrushTipStampSamplesOnGrid(
    dab,
    map,
    normalizedStudioBrushTipStampGrid(options?.grid),
    visit
  );
}

/**
 * Convert a planned dab into stamp samples that honor tip alpha, size, angle and roundness.
 * Spacing/scatter are already baked into dab.x/y by the dynamics planner.
 */
export function planStudioBrushTipStamp(
  dab: Pick<StudioDynamicBrushDab, "x" | "y" | "size" | "angle" | "roundness" | "opacity" | "flow">,
  tipSettings?: unknown,
  options?: { grid?: number; alphaMap?: StudioBrushTipAlphaMap | null }
): StudioBrushTipStampPlan {
  const tip = normalizedStudioBrushTipSettingsForStamp(tipSettings);
  const map = options?.alphaMap ?? buildStudioBrushTipAlphaMap(tip);
  const oddGrid = normalizedStudioBrushTipStampGrid(options?.grid);
  const samples: StudioBrushTipStampSample[] = [];

  visitStudioBrushTipStampSamplesOnGrid(dab, map, oddGrid, (dx, dy, alpha, radius) => {
    samples.push({
      dx,
      dy,
      alpha,
      radius,
    });
  });

  return {
    samples,
    tip,
    mapSize: map.size,
    grid: oddGrid,
  };
}

/** Absolute stamp centres for one dab — convenient for SVG multi-circle export. */
export function planStudioBrushTipStampWorldSamples(
  dab: Pick<StudioDynamicBrushDab, "x" | "y" | "size" | "angle" | "roundness" | "opacity" | "flow">,
  tipSettings?: unknown,
  options?: { grid?: number; alphaMap?: StudioBrushTipAlphaMap | null }
): Array<{ x: number; y: number; alpha: number; radius: number }> {
  const plan = planStudioBrushTipStamp(dab, tipSettings, options);
  return plan.samples.map((sample) => ({
    x: dab.x + sample.dx,
    y: dab.y + sample.dy,
    alpha: sample.alpha,
    radius: sample.radius,
  }));
}

/** Build a compact custom tip payload from a procedural shape (tests / default assets). */
export function studioBrushTipAlphaMapToBase64(
  shape: StudioBrushTipShapeId,
  softness = 0.35,
  size = STUDIO_BRUSH_CUSTOM_TIP_ALPHA_MAP_MAX_SIZE
): { alphaMapBase64: string; alphaMapSize: number } {
  const safeSize = Math.trunc(clamp(
    size,
    STUDIO_BRUSH_TIP_ALPHA_MAP_SIZE_RANGE.min,
    STUDIO_BRUSH_CUSTOM_TIP_ALPHA_MAP_MAX_SIZE
  ));
  const alphas = buildProceduralAlphaMap(shape, clamp01(softness), safeSize);
  const bytes = new Uint8Array(safeSize * safeSize);
  for (let index = 0; index < alphas.length; index++) {
    bytes[index] = Math.round(clamp01(alphas[index]!) * 255);
  }
  return {
    alphaMapBase64: encodeStudioBrushTipAlphaMapBase64(bytes),
    alphaMapSize: safeSize,
  };
}

export function studioBrushTipSettingsEqual(left?: unknown, right?: unknown): boolean {
  return JSON.stringify(normalizeStudioBrushTipSettings(left))
    === JSON.stringify(normalizeStudioBrushTipSettings(right));
}

/**
 * Round tips without a custom PNG-alpha map keep the fast solid-ellipse dab path
 * (Canvas/SVG parity with legacy particle brushes). Textured / custom tips stamp the alpha map.
 */
export function studioBrushTipUsesSolidEllipse(tip?: unknown): boolean {
  const normalized = normalizeStudioBrushTipSettings(tip);
  return normalized.shape === "round" && normalized.alphaMapBase64 === null;
}
