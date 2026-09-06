import { processPencilPoints } from "../studio-brush";

import { resolveStudioBrushAliasPencilPasses } from "./studio-brush-alias-profile";

import type { StudioBrushAliasPencilPass } from "./studio-brush-alias-profile";

/**
 * The pencil family's per-pass geometry, shared by the live overlay and the committed renderer.
 *
 * These two used to disagree. The committed renderer walked the alias profile's passes — each with
 * its own width scale, opacity scale and grain jitter — while the live overlay drew a single
 * un-jittered ribbon at the base width. An artist therefore drew one thing and got another on
 * release. Measured on the shipped build with one stroke per brush (live frame vs the frame after
 * the deferred commit landed):
 *
 *   pencil              live 2890 px @ 82.4 darkness  ->  committed 2386 px @ 71.4
 *   pencil--side-shade  live 6824 px @ 95.0, 14 px tall  ->  committed 9779 px @ 32.0, 24 px tall
 *
 * The side-shade case is the plainest: its wide, pale skirt exists only after release, because the
 * skirt IS an alias pass. Keeping the pass list and the jitter in one module is what makes the two
 * renderers agree by construction rather than by review.
 */
export const STUDIO_PENCIL_DEFAULT_JITTER_RADIUS = 0.75;

/** The single pass a pencil-family brush without an alias profile draws. */
export const STUDIO_PENCIL_DEFAULT_ALIAS_PASS: StudioBrushAliasPencilPass = Object.freeze({
  role: "core",
  widthScale: 1,
  opacityScale: 1,
  jitterRadius: STUDIO_PENCIL_DEFAULT_JITTER_RADIUS,
});

const DEFAULT_PASSES: readonly StudioBrushAliasPencilPass[] = Object.freeze([
  STUDIO_PENCIL_DEFAULT_ALIAS_PASS,
]);

/** Every pass this brush paints, in paint order. Never empty. */
export function studioPencilAliasPasses(
  brushId: unknown,
): readonly StudioBrushAliasPencilPass[] {
  const passes = resolveStudioBrushAliasPencilPasses(brushId);
  return passes.length > 0 ? passes : DEFAULT_PASSES;
}

/**
 * One pass's jittered polyline.
 *
 * `processPencilPoints` is the frozen legacy 0.75 px graphite texture; a pass scales that same
 * deterministic offset so a skirt can whisper and a core can bite. The offset depends only on the
 * coordinate index, so appending points to a stroke never moves the ones already drawn — which is
 * what lets the live overlay build this incrementally and still land on the committed geometry.
 */
export function studioPencilAliasPassPoints(
  points: readonly number[],
  jitterRadius: number,
): number[] {
  const source = Array.isArray(points) ? points as number[] : [...points];
  const jittered = processPencilPoints(source);
  if (jitterRadius === STUDIO_PENCIL_DEFAULT_JITTER_RADIUS) return jittered;
  const scale = jitterRadius / STUDIO_PENCIL_DEFAULT_JITTER_RADIUS;
  return jittered.map((value, coordinateIndex) => {
    const origin = source[coordinateIndex];
    return origin === undefined ? value : origin + (value - origin) * scale;
  });
}

/** The alpha one pass paints a ribbon cell at, given that cell's own pressure response. */
export function studioPencilAliasPassAlpha(
  pass: StudioBrushAliasPencilPass,
  opacityScale: number,
  flowScale: number,
): number {
  return Math.min(1, pass.opacityScale * Math.sqrt(opacityScale * flowScale));
}

/**
 * Pencil ribbon cells are batched into one compound fill per quantized alpha level: a stroke costs
 * at most this many `fill()` calls per pass instead of one per cell, and — the part that matters
 * for fidelity — cells that overlap inside one bucket are UNIONED by that single fill instead of
 * compositing over each other. Painting them one at a time made the live overlay visibly darker
 * than the commit (measured: pencil live 88.1 mean darkness vs committed 71.7 at equal coverage).
 *
 * The ladder resolution is a fidelity contract, not a tuning knob. At 16 levels every cell under
 * 1/32 rounded into the empty bucket and was never drawn: soft-pencil's 0.18-scale skirt lost 40 of
 * its 45 cells at light pressure while the SVG export kept them. 128 levels keep the quantization
 * error under one 8-bit alpha step (1/256), so Canvas and SVG agree on every cell that can change a
 * pixel, while the fill count stays bounded by the ladder.
 */
export const STUDIO_PENCIL_RIBBON_ALPHA_BUCKET_COUNT = 128;

/** The ladder rung a cell alpha paints on. 0 means "below the floor — never drawn". */
export function studioPencilRibbonAlphaBucket(alpha: number): number {
  return Math.max(
    0,
    Math.min(
      STUDIO_PENCIL_RIBBON_ALPHA_BUCKET_COUNT,
      Math.round(alpha * STUDIO_PENCIL_RIBBON_ALPHA_BUCKET_COUNT),
    ),
  );
}
