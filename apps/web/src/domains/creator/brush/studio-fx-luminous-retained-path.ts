/**
 * Retained-path painting for the luminous ribbon families (neon / glow / soft-glow).
 *
 * A luminous brush draws one compound fill per halo pass, and glow expands its three declared
 * rings into 48 composited shells. Re-tracing every shell's whole polygon list on every pointer
 * move is what made a single radius-150 circle cost 34.8 s of planning and tracing (measured with
 * no canvas, node 24); the incremental ribbon builder makes all but the stroke's tail append-only,
 * and this module is what turns that promise into retained device work.
 */
import {
  traceStudioFxLuminousRibbonPass,
  traceStudioFxLuminousRibbonPassRange,
  type StudioFxLuminousRibbonPassPlan,
  type StudioIncrementalFxLuminousRibbonBuilder,
} from "../studio-fx-brush";

import { STUDIO_BRUSH_RETAINED_DRAFT_SYMMETRY_VARIATIONS } from "./studio-brush-symmetry";

/**
 * Retained luminous state for one (symmetry variation, pass) pair of a live draft.
 *
 * `builder` plans the pass incrementally; `stablePath` holds the polygons it has promised never to
 * rewrite. `Path2D` stores user-space coordinates, so the retained prefix survives pan and zoom.
 */
export interface StudioFxLuminousRetainedPass {
  readonly builder: StudioIncrementalFxLuminousRibbonBuilder;
  generation: number;
  stablePolygonCount: number;
  stablePath: Path2D | null;
}

/** The subset of a Konva/Canvas 2D context this painter touches. */
export interface StudioFxLuminousRibbonFillContext {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(fillRule?: CanvasFillRule): void;
  fill(path: Path2D, fillRule?: CanvasFillRule): void;
}

export function createStudioFxLuminousRetainedPass(
  builder: StudioIncrementalFxLuminousRibbonBuilder,
): StudioFxLuminousRetainedPass {
  return {
    builder,
    generation: -1,
    stablePolygonCount: 0,
    stablePath: null,
  };
}

/**
 * Retained draft budget for the luminous families, in section-passes.
 *
 * A retained plan keeps every polygon it has emitted alive for the length of the stroke, where the
 * per-frame rebuild it replaces let each pass be collected the moment it was traced. Measured with
 * `--expose-gc` on node 24, one 48-shell glow draft holds 32.8 MB of JS heap at 359 sections per
 * shell and 145 MB at 3199 — most of it the round joins, whose 24-gon point arrays are frozen and
 * therefore box every coordinate. Denominating the budget in section-passes is what makes the
 * symmetry fan pay for itself: 160000 covers a full-page single-copy sweep (3200 samples x 48
 * shells, ~150 MB) and caps a 16-way kaleidoscope at ~200 samples per copy for the same memory.
 *
 * Past the budget a pass falls back to the batch planner and pays the per-move rebuild it always
 * did — no worse than before this work, and bounded. Raise the number here and pay the memory
 * knowingly; the alternative it buys is not small (measured 1394 ms per pointer move for a
 * 3200-sample glow stroke with no retention).
 */
export const STUDIO_FX_LUMINOUS_RETAINED_DRAFT_SECTION_PASSES = 160_000;

/**
 * Whether a live draft may retain its luminous passes.
 *
 * A symmetry fan wider than the retained-planner limit is the cyclic worst case the oil bed
 * documents — every copy evicted just before its next use — and the section-pass budget above is
 * what keeps the retained polygons from growing without a ceiling. Flattening emits one section
 * per accepted sample for a line command, so the render path's sample count is the honest proxy
 * here, and it is available before any pass is planned.
 */
export function studioFxLuminousDraftRetentionFits(
  activeDraft: boolean,
  renderPointCount: number,
  passCount: number,
  variationCount: number,
): boolean {
  return activeDraft
    && variationCount <= STUDIO_BRUSH_RETAINED_DRAFT_SYMMETRY_VARIATIONS
    && (renderPointCount / 2) * passCount * variationCount
      <= STUDIO_FX_LUMINOUS_RETAINED_DRAFT_SECTION_PASSES;
}

/**
 * Fills one luminous pass as a single non-zero compound path.
 *
 * With a retained entry the append-only prefix lives in a kept `Path2D` and only the volatile tail
 * is traced each frame. The frame path MUST be a copy that is filled ONCE: filling the retained
 * prefix and the tail separately composites their overlap twice — `a + a(1-a)` instead of `a` —
 * which is exactly the seam the single-fill coverage contract exists to prevent. Environments
 * without `Path2D`, and mock contexts that reject a path argument to `fill`, take the same
 * beginPath/trace/fill route the renderer has always used.
 */
export function fillStudioFxLuminousRibbonPass(
  context: StudioFxLuminousRibbonFillContext,
  plan: StudioFxLuminousRibbonPassPlan,
  retained: StudioFxLuminousRetainedPass | null,
): void {
  if (retained && typeof Path2D !== "undefined") {
    const generation = retained.builder.generation();
    const stable = retained.builder.stablePolygonCount();
    if (
      retained.stablePath === null
      || retained.generation !== generation
      || retained.stablePolygonCount > stable
    ) {
      retained.stablePath = new Path2D();
      retained.stablePolygonCount = 0;
      retained.generation = generation;
    }
    if (stable > retained.stablePolygonCount) {
      traceStudioFxLuminousRibbonPassRange(
        retained.stablePath,
        plan,
        retained.stablePolygonCount,
        stable,
      );
      retained.stablePolygonCount = stable;
    }
    try {
      const frame = new Path2D();
      frame.addPath(retained.stablePath);
      traceStudioFxLuminousRibbonPassRange(
        frame,
        plan,
        stable,
        plan.polygons.length,
      );
      context.fill(frame, "nonzero");
      return;
    } catch {
      // Fallback for mock contexts that do not accept Path2D in fill()
    }
  }
  context.beginPath();
  traceStudioFxLuminousRibbonPass(context, plan);
  context.fill();
}
