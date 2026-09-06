/**
 * Bounded dual/multi-tip composition for dynamic dabs.
 *
 * The legacy `tip` remains the primary tip. `tipLayers` adds at most two transformed tips, which
 * gives a three-tip renderer while bounding Canvas/SVG work and inline CRDT metadata. Imported
 * alpha maps share one encoded-byte budget; overflow falls back to that layer's procedural shape.
 */

import {
  buildStudioBrushTipAlphaMap,
  normalizeStudioBrushTipSettings,
  sampleStudioBrushTipAlphaMap,
  studioBrushTipUsesSolidEllipse,
  type NormalizedStudioBrushTipSettings,
  type StudioBrushTipAlphaMap,
  type StudioBrushTipSettings,
} from "./studio-brush-tip-stamp";

export const STUDIO_BRUSH_TIP_LAYER_MAX_COUNT = 2;
export const STUDIO_BRUSH_TIP_COMBINED_ALPHA_MAP_BASE64_MAX_CHARS = 8 * 1024;

export const STUDIO_BRUSH_DUAL_BRUSH_BLEND_MODES = ["multiply", "screen"] as const;
export type StudioBrushDualBrushBlendMode =
  (typeof STUDIO_BRUSH_DUAL_BRUSH_BLEND_MODES)[number];
export const STUDIO_BRUSH_DUAL_BRUSH_SIZE_RATIO_LIMITS = { min: 0.25, max: 2 } as const;
/** Bounds retained composed dual-tip textures (each entry is one Float32Array tip map). */
const STUDIO_BRUSH_DUAL_TIP_ALPHA_MAP_CACHE_LIMIT = 32;

/**
 * Photoshop/CSP-style dual brush: a secondary tip texture modulates the PRIMARY tip alpha at
 * composition time. Spacing, scatter and jitter intentionally follow the primary brush — the
 * secondary tip changes texture only, never dab placement, so enabling it costs nothing per dab.
 */
export interface StudioBrushDualBrushSettings {
  enabled?: boolean;
  /** Secondary tip from the same shape catalog / PNG import payloads as the primary `tip`. */
  tip?: StudioBrushTipSettings | null;
  /** multiply erodes the primary by the secondary; screen lightens/unions coverage. */
  blendMode?: StudioBrushDualBrushBlendMode;
  /** Secondary tip diameter relative to the primary tip (0.25..2). */
  sizeRatio?: number;
}

export interface NormalizedStudioBrushDualBrushSettings {
  enabled: boolean;
  tip: NormalizedStudioBrushTipSettings;
  blendMode: StudioBrushDualBrushBlendMode;
  sizeRatio: number;
}

export const STUDIO_BRUSH_TIP_LAYER_LIMITS = {
  scale: { min: 0.1, max: 4 },
  opacity: { min: 0, max: 1 },
  offset: { min: -2, max: 2 },
  roundness: { min: 0.08, max: 2 },
} as const;

export interface StudioBrushTipLayerSettings {
  tip?: StudioBrushTipSettings | null;
  /** Multiplier applied to the primary dab diameter. */
  scale?: number;
  /** Multiplier applied after the primary dab opacity. */
  opacity?: number;
  /** Tip-local offset measured in primary-tip radii. */
  offsetX?: number;
  /** Tip-local offset measured in primary-tip radii. */
  offsetY?: number;
  /** Signed rotation relative to the primary tip. */
  angle?: number;
  /** Multiplier applied to the primary dab roundness. */
  roundness?: number;
}

export interface NormalizedStudioBrushTipLayerSettings {
  tip: NormalizedStudioBrushTipSettings;
  scale: number;
  opacity: number;
  offsetX: number;
  offsetY: number;
  angle: number;
  roundness: number;
}

export interface StudioBrushComposableDab {
  x: number;
  y: number;
  size: number;
  angle: number;
  roundness: number;
  opacity: number;
  flow: number;
}

export interface StudioBrushComposedTipDab {
  role: "primary" | "layer";
  layerIndex: number;
  tip: NormalizedStudioBrushTipSettings;
  dab: StudioBrushComposableDab;
}

/** Builds one normalized secondary-tip dab without allocating a composition result array. */
export function composeNormalizedStudioBrushTipLayerDab(
  dab: StudioBrushComposableDab,
  layer: NormalizedStudioBrushTipLayerSettings
): StudioBrushComposableDab | null {
  if (layer.opacity <= 0) return null;
  const angleRadians = dab.angle * Math.PI / 180;
  const cos = Math.cos(angleRadians);
  const sin = Math.sin(angleRadians);
  const radius = Math.max(0.025, finiteNumber(dab.size, 1) / 2);
  const localX = layer.offsetX * radius;
  const localY = layer.offsetY * radius;
  return {
    x: dab.x + localX * cos - localY * sin,
    y: dab.y + localX * sin + localY * cos,
    size: clamp(
      finiteNumber(dab.size, 1) * layer.scale,
      0.05,
      16_384
    ),
    angle: normalizeSignedDegrees(finiteNumber(dab.angle, 0) + layer.angle),
    roundness: clamp(
      finiteNumber(dab.roundness, 1) * layer.roundness,
      0.08,
      1
    ),
    opacity: clamp(finiteNumber(dab.opacity, 1) * layer.opacity, 0, 1),
    flow: clamp(finiteNumber(dab.flow, 1), 0, 1),
  };
}

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

function normalizeSignedDegrees(value: number): number {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function alphaMapCharacterCount(tip: NormalizedStudioBrushTipSettings): number {
  return tip.alphaMapBase64?.length ?? 0;
}

/** Normalizes extra tip layers and enforces the aggregate inline-alpha budget. */
export function normalizeStudioBrushTipLayers(
  value?: unknown,
  primaryTipValue?: unknown
): readonly NormalizedStudioBrushTipLayerSettings[] {
  if (!Array.isArray(value)) return [];
  const primaryTip = normalizeStudioBrushTipSettings(primaryTipValue);
  let remainingAlphaCharacters = Math.max(
    0,
    STUDIO_BRUSH_TIP_COMBINED_ALPHA_MAP_BASE64_MAX_CHARS
      - alphaMapCharacterCount(primaryTip)
  );
  const layers: NormalizedStudioBrushTipLayerSettings[] = [];
  for (const candidate of value.slice(0, STUDIO_BRUSH_TIP_LAYER_MAX_COUNT)) {
    const source = asRecord(candidate);
    if (!source) continue;
    let tip = normalizeStudioBrushTipSettings(source.tip);
    const alphaCharacters = alphaMapCharacterCount(tip);
    if (alphaCharacters > remainingAlphaCharacters) {
      // Preserve the declared procedural shape/softness while dropping only the oversized payload.
      tip = { ...tip, alphaMapBase64: null };
    } else {
      remainingAlphaCharacters -= alphaCharacters;
    }
    layers.push({
      tip,
      scale: clamp(
        finiteNumber(source.scale, 1),
        STUDIO_BRUSH_TIP_LAYER_LIMITS.scale.min,
        STUDIO_BRUSH_TIP_LAYER_LIMITS.scale.max
      ),
      opacity: clamp(
        finiteNumber(source.opacity, 1),
        STUDIO_BRUSH_TIP_LAYER_LIMITS.opacity.min,
        STUDIO_BRUSH_TIP_LAYER_LIMITS.opacity.max
      ),
      offsetX: clamp(
        finiteNumber(source.offsetX, 0),
        STUDIO_BRUSH_TIP_LAYER_LIMITS.offset.min,
        STUDIO_BRUSH_TIP_LAYER_LIMITS.offset.max
      ),
      offsetY: clamp(
        finiteNumber(source.offsetY, 0),
        STUDIO_BRUSH_TIP_LAYER_LIMITS.offset.min,
        STUDIO_BRUSH_TIP_LAYER_LIMITS.offset.max
      ),
      angle: normalizeSignedDegrees(finiteNumber(source.angle, 0)),
      roundness: clamp(
        finiteNumber(source.roundness, 1),
        STUDIO_BRUSH_TIP_LAYER_LIMITS.roundness.min,
        STUDIO_BRUSH_TIP_LAYER_LIMITS.roundness.max
      ),
    });
  }
  return layers;
}

/**
 * Normalizes dual-brush settings. Missing/unknown input yields identity defaults (disabled,
 * multiply, ratio 1), so pre-dual-brush snapshots keep byte-stable rendering. A custom secondary
 * alpha payload shares the same aggregate inline budget contract as tip layers: when the primary
 * plus secondary encoded bytes exceed it, only the secondary payload is dropped while its
 * declared procedural shape/softness survive.
 */
export function normalizeStudioBrushDualBrushSettings(
  value?: unknown,
  primaryTipValue?: unknown
): NormalizedStudioBrushDualBrushSettings {
  const source = asRecord(value);
  let tip = normalizeStudioBrushTipSettings(source?.tip);
  if (tip.alphaMapBase64) {
    const primaryTip = normalizeStudioBrushTipSettings(primaryTipValue);
    const remainingAlphaCharacters = Math.max(
      0,
      STUDIO_BRUSH_TIP_COMBINED_ALPHA_MAP_BASE64_MAX_CHARS
        - alphaMapCharacterCount(primaryTip)
    );
    if (alphaMapCharacterCount(tip) > remainingAlphaCharacters) {
      tip = { ...tip, alphaMapBase64: null };
    }
  }
  return {
    enabled: source?.enabled === true,
    tip,
    blendMode: source?.blendMode === "screen" ? "screen" : "multiply",
    sizeRatio: clamp(
      finiteNumber(source?.sizeRatio, 1),
      STUDIO_BRUSH_DUAL_BRUSH_SIZE_RATIO_LIMITS.min,
      STUDIO_BRUSH_DUAL_BRUSH_SIZE_RATIO_LIMITS.max
    ),
  };
}

/**
 * True when normalized dual settings are the exact no-op identity (disabled with an untouched
 * default secondary tip). The dynamics normalizer omits identity dual settings entirely, so
 * pre-dual-brush snapshots keep a byte-stable canonical serialization and never read as repaired.
 */
export function studioBrushDualBrushSettingsAreIdentity(
  value: NormalizedStudioBrushDualBrushSettings
): boolean {
  if (value.enabled || value.blendMode !== "multiply" || value.sizeRatio !== 1) return false;
  const defaultTip = normalizeStudioBrushTipSettings();
  return value.tip.shape === defaultTip.shape
    && value.tip.softness === defaultTip.softness
    && value.tip.alphaMapBase64 === defaultTip.alphaMapBase64
    && value.tip.alphaMapSize === defaultTip.alphaMapSize;
}

/** True only when an enabled dual brush actually changes the primary tip texture. */
export function studioBrushDualBrushIsActive(value?: unknown): boolean {
  // Mirrors the normalization contract (`enabled === true`) without paying for tip base64
  // canonicalization on the disabled fast path.
  return asRecord(value)?.enabled === true;
}

/**
 * Dual-aware variant of `studioBrushTipUsesSolidEllipse` for the primary-tip fast path: an
 * active dual brush always needs the composed alpha-map stamp path.
 */
export function studioBrushDualTipUsesSolidEllipse(
  primaryTipValue?: unknown,
  dualValue?: unknown
): boolean {
  return !studioBrushDualBrushIsActive(dualValue)
    && studioBrushTipUsesSolidEllipse(primaryTipValue);
}

const dualTipAlphaMapCache = new Map<string, StudioBrushTipAlphaMap>();

/** Raw-input tip key part, mirroring the alpha-map cache key contract in the tip stamp module. */
function rawTipCacheKeyPart(value: unknown): string {
  const source = asRecord(value);
  if (!source) return "default";
  const alphaMapBase64 = typeof source.alphaMapBase64 === "string"
    ? source.alphaMapBase64.length <= STUDIO_BRUSH_TIP_COMBINED_ALPHA_MAP_BASE64_MAX_CHARS
      ? source.alphaMapBase64
      : `oversized:${source.alphaMapBase64.length}`
    : source.alphaMapBase64 === null ? "null" : "";
  return [
    typeof source.shape === "string" ? source.shape : "",
    typeof source.softness === "number" ? source.softness : "",
    typeof source.alphaMapSize === "number" ? source.alphaMapSize : "",
    alphaMapBase64,
  ].join("\u0000");
}

/**
 * Composes the dual-brush secondary tip into the primary tip alpha map.
 *
 * Runs once per unique brush-settings value (LRU-cached on the raw inputs, mirroring
 * `buildStudioBrushTipAlphaMap`), never per dab — renderers keep sampling one prebuilt map.
 * Disabled or absent dual settings return the primary's own cached map unchanged, guaranteeing
 * byte-identical output to a non-dual composition.
 */
export function composeStudioBrushDualTipAlphaMap(
  primaryTipValue?: unknown,
  dualValue?: unknown
): StudioBrushTipAlphaMap {
  if (!studioBrushDualBrushIsActive(dualValue)) {
    return buildStudioBrushTipAlphaMap(primaryTipValue);
  }
  const dualSource = asRecord(dualValue);
  const cacheKey = [
    rawTipCacheKeyPart(primaryTipValue),
    rawTipCacheKeyPart(dualSource?.tip),
    String(dualSource?.blendMode),
    String(dualSource?.sizeRatio),
  ].join("\u0000");
  const cached = dualTipAlphaMapCache.get(cacheKey);
  if (cached) {
    // Map insertion order is the LRU queue; composed maps are immutable renderer inputs.
    dualTipAlphaMapCache.delete(cacheKey);
    dualTipAlphaMapCache.set(cacheKey, cached);
    return cached;
  }

  const dual = normalizeStudioBrushDualBrushSettings(dualValue, primaryTipValue);
  const primaryMap = buildStudioBrushTipAlphaMap(primaryTipValue);
  const secondaryMap = buildStudioBrushTipAlphaMap(dual.tip);
  const size = primaryMap.size;
  const centre = (size - 1) / 2;
  const secondaryMax = secondaryMap.size - 1;
  const alphas = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = y * size + x;
      const primaryAlpha = primaryMap.alphas[index] ?? 0;
      const nx = centre === 0 ? 0 : (x - centre) / centre;
      const ny = centre === 0 ? 0 : (y - centre) / centre;
      // sizeRatio scales the secondary tip footprint: sampling coordinates shrink by the ratio,
      // and anything outside the secondary's own [-1, 1] square reads as fully transparent.
      const sx = nx / dual.sizeRatio;
      const sy = ny / dual.sizeRatio;
      let secondaryAlpha = 0;
      if (sx >= -1 && sx <= 1 && sy >= -1 && sy <= 1) {
        secondaryAlpha = sampleStudioBrushTipAlphaMap(
          secondaryMap,
          (sx * 0.5 + 0.5) * secondaryMax,
          (sy * 0.5 + 0.5) * secondaryMax
        );
      }
      alphas[index] = clamp(
        dual.blendMode === "screen"
          ? primaryAlpha + secondaryAlpha - primaryAlpha * secondaryAlpha
          : primaryAlpha * secondaryAlpha,
        0,
        1
      );
    }
  }

  const composed: StudioBrushTipAlphaMap = {
    size,
    alphas,
    shape: primaryMap.shape,
    softness: primaryMap.softness,
    custom: true,
    revision: cacheKey,
  };
  if (dualTipAlphaMapCache.size >= STUDIO_BRUSH_DUAL_TIP_ALPHA_MAP_CACHE_LIMIT) {
    const oldestKey = dualTipAlphaMapCache.keys().next().value;
    if (oldestKey !== undefined) dualTipAlphaMapCache.delete(oldestKey);
  }
  dualTipAlphaMapCache.set(cacheKey, composed);
  return composed;
}

/** Expands one base dab into its primary and bounded transformed secondary tips. */
export function planStudioBrushTipComposition(
  dab: StudioBrushComposableDab,
  primaryTipValue?: unknown,
  layerValues?: readonly NormalizedStudioBrushTipLayerSettings[] | unknown
): readonly StudioBrushComposedTipDab[] {
  const primaryTip = normalizeStudioBrushTipSettings(primaryTipValue);
  const layers = Array.isArray(layerValues)
    ? normalizeStudioBrushTipLayers(layerValues, primaryTip)
    : [];
  return planNormalizedStudioBrushTipComposition(dab, primaryTip, layers);
}

/** Renderer fast path for settings that already crossed the dynamics normalization boundary. */
export function planNormalizedStudioBrushTipComposition(
  dab: StudioBrushComposableDab,
  primaryTip: NormalizedStudioBrushTipSettings,
  layers: readonly NormalizedStudioBrushTipLayerSettings[]
): readonly StudioBrushComposedTipDab[] {
  const result: StudioBrushComposedTipDab[] = [{
    role: "primary",
    layerIndex: -1,
    tip: primaryTip,
    dab: { ...dab },
  }];

  for (const [layerIndex, layer] of layers.entries()) {
    const composedDab = composeNormalizedStudioBrushTipLayerDab(dab, layer);
    if (!composedDab) continue;
    result.push({
      role: "layer",
      layerIndex,
      tip: layer.tip,
      dab: composedDab,
    });
  }
  return result;
}
