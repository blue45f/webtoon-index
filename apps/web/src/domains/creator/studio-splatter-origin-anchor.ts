/**
 * Deterministic minimum-visible deposit for the deliberately wide core splatter brush.
 *
 * A causal tap or short flick may contain only dab index zero. Splatter intentionally scatters
 * that dab farther than one nib width, so some persisted seeds can move its entire flake outside
 * the cursor neighbourhood. The ordinary scattered flake remains authoritative; this helper adds
 * one smaller copy of the same seeded irregular tip at the authored origin. Live append, retained
 * replay and export all consume the shared coverage planner, so the anchor never becomes a
 * preview-only round dot.
 */

import type { StudioDynamicBrushDab } from "./brush/studio-brush-dynamics";
import type { StudioDynamicBrushMaterialIdentity } from "./brush/studio-dry-media-dynamic-bridge";

export const STUDIO_SPLATTER_ORIGIN_ANCHOR_MARKS_PER_VARIATION = 1 as const;
export const STUDIO_SPLATTER_ORIGIN_ANCHOR_DIAMETER_RATIO = 0.32 as const;
export const STUDIO_SPLATTER_ORIGIN_ANCHOR_MIN_DIAMETER = 3 as const;
export const STUDIO_SPLATTER_ORIGIN_ANCHOR_MAX_DIAMETER = 18 as const;

/**
 * Brushes whose first dab lands farther than one nib RADIUS from the pointer.
 *
 * That is this module's own criterion - "scatters that dab farther than one nib width" - and it
 * was only ever applied to `splatter`, even though the same measurement finds nine more brushes
 * doing it. The brush gate caught two of them intermittently as "fast short stroke produced no
 * visible pixels", which is this defect seen from the outside: a flick short enough to be mostly
 * dab zero deposits its whole mark somewhere the artist did not press.
 *
 * Measured on a 37px flick at a 24px nib (first-dab offset in nib radii):
 *   flame-tongue-spark 7.99 · focus-ray-streak 4.11 · spray-noise-fine 1.54 · splatter 1.49 ·
 *   dust-mote-depth 1.43 · hair-curl-ribbon 1.32 · stage-safe-splatter 1.22 · fur-soft-clumps 1.18
 *   · flower-petal-scatter 1.13 · hatching-contour-rake 1.08
 *
 * Brushes below 1.0 keep their unanchored behaviour, so this is not a blanket change: the anchor
 * costs one small extra mark on the tap dab only, and every scattered flake stays authoritative.
 */
const STUDIO_ORIGIN_ANCHOR_BRUSH_IDS: ReadonlySet<string> = new Set([
  "splatter",
  "flame-tongue-spark",
  "focus-ray-streak",
  "spray-noise-fine",
  "dust-mote-depth",
  "hair-curl-ribbon",
  "stage-safe-splatter",
  "fur-soft-clumps",
  "flower-petal-scatter",
  "hatching-contour-rake",
]);

export function studioDynamicBrushUsesSplatterOriginAnchor(
  materialIdentity: StudioDynamicBrushMaterialIdentity | null | undefined,
): boolean {
  const brushId = materialIdentity?.brushId;
  return typeof brushId === "string" && STUDIO_ORIGIN_ANCHOR_BRUSH_IDS.has(brushId);
}

export function studioSplatterOriginAnchorMarkCount(
  materialIdentity: StudioDynamicBrushMaterialIdentity | null | undefined,
  includesInitialDab: boolean,
): 0 | typeof STUDIO_SPLATTER_ORIGIN_ANCHOR_MARKS_PER_VARIATION {
  return includesInitialDab
    && studioDynamicBrushUsesSplatterOriginAnchor(materialIdentity)
    ? STUDIO_SPLATTER_ORIGIN_ANCHOR_MARKS_PER_VARIATION
    : 0;
}

/**
 * Returns an immutable flake-tip input only for the global first dab.
 *
 * `angle`, `roundness`, opacity and flow remain the seeded dynamics result. Only the centre and
 * bounded diameter change, so low stylus pressure stays delicate and the anchor preserves the
 * selected splatter texture instead of degenerating into a generic circle.
 */
export function planStudioSplatterOriginAnchorDab(
  materialIdentity: StudioDynamicBrushMaterialIdentity | null | undefined,
  firstDab: StudioDynamicBrushDab | null | undefined,
): StudioDynamicBrushDab | null {
  if (
    !studioDynamicBrushUsesSplatterOriginAnchor(materialIdentity)
    || !firstDab
    || firstDab.index !== 0
  ) return null;
  const diameter = Math.max(
    STUDIO_SPLATTER_ORIGIN_ANCHOR_MIN_DIAMETER,
    Math.min(
      STUDIO_SPLATTER_ORIGIN_ANCHOR_MAX_DIAMETER,
      firstDab.size * STUDIO_SPLATTER_ORIGIN_ANCHOR_DIAMETER_RATIO,
    ),
  );
  if (
    !Number.isFinite(firstDab.sourceX)
    || !Number.isFinite(firstDab.sourceY)
    || !Number.isFinite(diameter)
  ) return null;
  return Object.freeze({
    ...firstDab,
    x: firstDab.sourceX,
    y: firstDab.sourceY,
    size: diameter,
    scatter: 0,
  });
}
