/**
 * Symmetry a brush carries BY ITS OWN NATURE, rather than symmetry the artist switched on.
 *
 * Three catalogue presets promise a second mark in their name — `web-mirror-ink` mirrors,
 * `web-kaleido-ink` folds, `sketchpad-mirror` pairs — and on the committed and exported routes all
 * three render one plain ribbon. Their per-id dynamics only tune width, opacity, spacing, scatter
 * and roundness; nothing in that route emits a copy. The declaration and the paint disagree, which
 * is the honesty rule this repo holds brushes to.
 *
 * The fix needs no new renderer, because a carrier-neutral symmetry fan already exists and is
 * already wired to every surface: `studio-brush-symmetry.ts` (`studioBrushSymmetryTransforms`,
 * `studioDynamicBrushDabVariationsFromTransforms`, `transformStudioDynamicBrushDab`) is consumed by
 * the committed Konva plan, the SVG export, the live overlay, the WebGPU live planner and the GPU
 * journal identity. All of them read it off `DrawEl.symmetry`. So a brush that IS a mirror only has
 * to say so at stroke start and every surface follows, replay and collaboration included.
 *
 * This replaces a UI hack. `sketchpad-mirror` used to flip the document's GLOBAL symmetry toggle
 * when selected, which changes a setting the artist owns, leaks across to the next brush they pick,
 * and cannot be recorded on the stroke — so a saved document could not reproduce it. Intrinsic
 * symmetry is a property of the stroke instead: written once at pointer-down, carried in the
 * element, honoured identically everywhere.
 *
 * Deliberately a leaf module with no imports beyond the symmetry vocabulary, so the catalogue, the
 * pointer-start planner and the renderers can all consult it without a cycle.
 */

/** The symmetry vocabulary `DrawEl.symmetry` accepts. Kept local so this stays a leaf. */
export type StudioBrushIntrinsicSymmetryType =
  | "vertical"
  | "horizontal"
  | "radial"
  | "kaleidoscope";

export interface StudioBrushIntrinsicSymmetry {
  readonly type: StudioBrushIntrinsicSymmetryType;
  /** Folds, for radial and kaleidoscope. Ignored by the mirror types. */
  readonly radialCount?: number;
}

/**
 * One entry per preset whose NAME promises a second mark, with the fan that actually delivers it.
 *
 * Anything not listed has no intrinsic symmetry and is untouched — that is every other brush in the
 * catalogue, so this cannot change an existing stroke that did not already declare a fold.
 */
const INTRINSIC_SYMMETRY_BY_BRUSH_ID:
Readonly<Record<string, StudioBrushIntrinsicSymmetry>> = Object.freeze({
  // "mirror" in the name, a mirrored copy in the mark.
  "web-mirror-ink": Object.freeze({ type: "vertical" as const }),
  // The sketchpad pair, previously delivered by flipping the document toggle.
  "sketchpad-mirror": Object.freeze({ type: "vertical" as const }),
  // A kaleidoscope is folds about a centre; six is the fold count its own sample planner defaults
  // to (`DEFAULT_STUDIO_WEB_KALEIDO_INK_SPEC`), so the two agree on what the name means.
  "web-kaleido-ink": Object.freeze({ type: "kaleidoscope" as const, radialCount: 6 }),
});

/**
 * The symmetry this brush is, or null.
 *
 * Null for every brush that carries none, which keeps the pointer-start planner's existing
 * behaviour byte-identical for all of them.
 */
export function resolveStudioBrushIntrinsicSymmetry(
  brushId: unknown,
): StudioBrushIntrinsicSymmetry | null {
  return typeof brushId === "string"
    ? INTRINSIC_SYMMETRY_BY_BRUSH_ID[brushId] ?? null
    : null;
}

/** Ids that carry an intrinsic symmetry — for catalogue audits and governance tests. */
export const STUDIO_BRUSH_INTRINSIC_SYMMETRY_IDS: readonly string[] = Object.freeze(
  Object.keys(INTRINSIC_SYMMETRY_BY_BRUSH_ID),
);

/** The symmetry shape a stroke element carries. */
export interface StudioStrokeSymmetry {
  readonly type: "none" | "vertical" | "horizontal" | "radial" | "kaleidoscope" | "silk";
  readonly centerX: number;
  readonly centerY: number;
  readonly radialCount?: number;
}

/**
 * The symmetry to record on a stroke: the artist's page symmetry when they have switched one on,
 * otherwise the brush's own, otherwise none.
 *
 * An explicit choice is never overridden by a preset — a brush only supplies a fan where the page
 * has none. The fold is centred on the PAGE rather than the origin: the live route folds these
 * presets about the origin today, which drops every copy off-canvas, and that is half the reason
 * the promise looked unimplemented.
 *
 * Returns undefined when there is nothing to record, which is the value the planner already wrote
 * for a stroke with no symmetry — so every brush without one keeps a byte-identical element.
 */
export function resolveStudioStrokeSymmetry(
  page: StudioStrokeSymmetry,
  brushId: unknown,
): StudioStrokeSymmetry | undefined {
  if (page.type !== "none") {
    return {
      type: page.type,
      centerX: page.centerX,
      centerY: page.centerY,
      radialCount: page.radialCount,
    };
  }
  const intrinsic = resolveStudioBrushIntrinsicSymmetry(brushId);
  if (!intrinsic) return undefined;
  return {
    type: intrinsic.type,
    centerX: page.centerX,
    centerY: page.centerY,
    radialCount: intrinsic.radialCount ?? page.radialCount,
  };
}
