/**
 * Versioned paper-substrate semantics for persisted strokes.
 *
 * An omitted model is intentionally the historical ToonSpectrum contract. Never reinterpret an
 * existing stroke as a newer model merely because a renderer learned about one: ToonSpectrum
 * strokes are **re-planned from stored points and pressures on every render**, not rasterized at
 * commit time, so a substrate change without a key is a retroactive repaint of finished artwork.
 *
 * The legacy (key-less) substrate is `resolveStudioPaperGranulationAlphaMultiplierAt` over a
 * mean-only height field: every coupled family deposits into the VALLEYS, with no pressure input
 * and an exact 128-texel tile repeat. That is byte-frozen and stays the path for every stroke that
 * predates this module.
 *
 * `contact-tooth-v2` is the corrected model, and it corrects four things at once:
 *
 * 1. **Polarity per medium.** `docs/candidates/brush-catalog-v17/design.md` specifies
 *    "건식=peak-catch, 수채=valley-settle, 유화=weave-reveal". Dry pigment is abraded off the stick
 *    by the tooth that stands PROUD of the sheet, so it lands on peaks; only water carries pigment
 *    down into the valleys. The legacy field ran valley-settle for every medium — the exact
 *    opposite of its own specification for dry media.
 * 2. **Pressure enters the coupling.** A contact plane descends with pressure: a light pass rides
 *    the peaks and skips the pits (much bare substrate), a heavy pass lowers the plane until the
 *    tooth fills in. This is the single most legible real-paper behaviour and was structurally
 *    impossible before, because the response function took no pressure argument.
 * 3. **Contrast that matches the declared amplitude** (see `createPaperHeightField`'s
 *    `contrast: "shaped-v2"`).
 * 4. **De-tiling** — see `STUDIO_PAPER_SUBSTRATE_DETILE_RATIO_V2` below.
 *
 * The deposit math itself is NOT written here. It is delegated to
 * `resolveStudioPaperDepositScaleForHeightV1`, so the granulation runtime and the stamp engine's
 * W7 lane share one deposit authority instead of contradicting each other on one canvas.
 */

import { resolveStudioBrushRenderFamily } from "../studio-brush";

import {
  resolveStudioPaperMediumForBrushFamilyV1,
  type StudioPaperMediumV1,
} from "./studio-paper-media-profile-v1";

/**
 * Contact-plane substrate with per-medium polarity, pressure coupling, normalized contrast and a
 * de-tiled field. Stamped on new strokes at pointer-down; absent on every stroke authored before.
 */
export const STUDIO_PAPER_SUBSTRATE_MODEL_CONTACT_TOOTH_V2 = "contact-tooth-v2" as const;

export type StudioPaperSubstrateModel =
  typeof STUDIO_PAPER_SUBSTRATE_MODEL_CONTACT_TOOTH_V2;

export function isStudioPaperSubstrateModel(
  value: unknown,
): value is StudioPaperSubstrateModel {
  return value === STUDIO_PAPER_SUBSTRATE_MODEL_CONTACT_TOOTH_V2;
}

/**
 * Whether this stroke renders through the corrected substrate.
 *
 * `undefined` is FALSE and must stay false — that is the whole point of the key.
 */
export function studioPaperUsesContactTooth(
  model?: StudioPaperSubstrateModel,
): boolean {
  return model === STUDIO_PAPER_SUBSTRATE_MODEL_CONTACT_TOOTH_V2;
}

export function normalizeStudioPaperSubstrateModel(
  value: unknown,
): StudioPaperSubstrateModel | undefined {
  return isStudioPaperSubstrateModel(value) ? value : undefined;
}

// ---------------------------------------------------------------------------
// De-tiling
// ---------------------------------------------------------------------------

/**
 * Second-lookup scale ratio — the reciprocal golden ratio.
 *
 * The legacy substrate is a single `PAPER_REFERENCE_TILE`(128) periodic tile, so the sheet repeats
 * bit-identically every `128 * scale` document px (192px on dry-media scale 1.5, 240px on charcoal
 * 1.875). An A4 300dpi export is 2480px wide and tiles that ~10-13 times, which reads as wallpaper
 * rather than paper.
 *
 * v2 sums two lookups into the SAME baked tile at incommensurate scales. Because φ⁻¹ is irrational,
 * `128·s` and `128·s·φ` share no common multiple, so the sum has no exact period at all — while
 * every sample is still a bilinear read of a baked tile. That last property is deliberate: it is
 * why a future WebGPU substrate lane (cloned from the r8unorm grain native path) can reproduce
 * this field bit-for-bit on the GPU. A shader-synthesized noise would have made GPU/CPU float
 * reproducibility a problem we then had to solve; baked tile samples never create it.
 *
 * The second lookup is also rotated, so the two lattices do not align their axes and produce a
 * visible plaid.
 */
export const STUDIO_PAPER_SUBSTRATE_DETILE_RATIO_V2 = 0.618_033_988_749_895;

/** Weight of the second (finer, rotated) lookup. Chosen so the sum keeps unit-ish variance. */
export const STUDIO_PAPER_SUBSTRATE_DETILE_WEIGHT_V2 = 0.38;

/**
 * Rotation of the FIRST lattice, in radians (15°).
 *
 * Rotating the primary lookup is what removes the exact repeat rather than merely masking it. An
 * axis-aligned tile repeats whenever the offset is a whole number of tiles along x. Once the
 * lattice is rotated by θ, an x-offset T only repeats if `T·cosθ` AND `T·sinθ` are both whole
 * multiples of the tile — impossible for irrational `tanθ`. Measured: leaving the primary
 * axis-aligned still left visible correlation at the legacy 240px period even with a second
 * lookup layered on top, because only one of the two terms was breaking.
 */
export const STUDIO_PAPER_SUBSTRATE_DETILE_PRIMARY_ROTATION_V2 = 0.261_799_387_799_149_4;

/** Rotation of the second lattice, in radians. ~37° avoids axis- and diagonal-alignment alike. */
export const STUDIO_PAPER_SUBSTRATE_DETILE_ROTATION_V2 = 0.645_772_5;

/** Precomputed rotation bases — the sampler is a per-texel hot path and allocates nothing. */
export const STUDIO_PAPER_SUBSTRATE_DETILE_PRIMARY_COS_V2 = Math.cos(
  STUDIO_PAPER_SUBSTRATE_DETILE_PRIMARY_ROTATION_V2,
);
export const STUDIO_PAPER_SUBSTRATE_DETILE_PRIMARY_SIN_V2 = Math.sin(
  STUDIO_PAPER_SUBSTRATE_DETILE_PRIMARY_ROTATION_V2,
);
export const STUDIO_PAPER_SUBSTRATE_DETILE_COS_V2 = Math.cos(
  STUDIO_PAPER_SUBSTRATE_DETILE_ROTATION_V2,
);
export const STUDIO_PAPER_SUBSTRATE_DETILE_SIN_V2 = Math.sin(
  STUDIO_PAPER_SUBSTRATE_DETILE_ROTATION_V2,
);

/**
 * Document-space offset of the second lattice.
 *
 * Without it both lookups agree exactly at the origin, which would put one perfectly reproducible
 * "seam point" at the top-left corner of every page.
 */
export const STUDIO_PAPER_SUBSTRATE_DETILE_OFFSET_V2 = 53.7;

// ---------------------------------------------------------------------------
// Medium resolution
// ---------------------------------------------------------------------------

/**
 * Brush id → interaction medium, via the render family.
 *
 * This deliberately reuses `STUDIO_PAPER_MEDIUM_BY_BRUSH_FAMILY_V1` rather than restating the
 * taxonomy. `null` means the tool does not read the sheet at all (technical pen, screentone,
 * pixel) and must stay exact identity.
 */
export function resolveStudioPaperSubstrateMediumForBrush(
  brushId: unknown,
): StudioPaperMediumV1 | null {
  return resolveStudioPaperMediumForBrushFamilyV1(
    resolveStudioBrushRenderFamily(brushId),
  );
}

/**
 * Pressure used when a caller has none.
 *
 * A mid-pressure plane is the honest neutral: it is the pressure at which a contact-tooth pass
 * neither rides only the peaks nor floods the sheet. Callers that DO know their pressure always
 * pass it; this value exists so a 2-argument legacy call site keeps type-checking and produces a
 * sane sheet rather than an accidental full-flood one.
 */
export const STUDIO_PAPER_SUBSTRATE_FALLBACK_PRESSURE = 0.5;
