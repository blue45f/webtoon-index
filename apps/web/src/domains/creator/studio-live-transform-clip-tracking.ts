/**
 * Which panel clip a stroke will render under AFTER the gesture commits — computed per frame.
 *
 * A stroke that belongs to a panel renders inside a clipping `Group` whose rect comes from
 * `containingPanel`. That verdict is GEOMETRY-derived (centre inside the frame, plus a 1.4x size
 * cutoff), so a scale or rotation can move a stroke out of its panel, or pull an unclipped stroke
 * into one. The live preview transforms the already-rendered subtree, which carries whatever clip
 * the stroke had when the gesture began, while the commit re-derives the verdict from the new
 * geometry — so the clip popped at release.
 *
 * The fix is not a scene-graph reparent. Konva expresses a clip as ATTRS on the group
 * (`clipX/clipY/clipWidth/clipHeight`), so the clip a stroke renders under can be re-pointed by
 * writing four numbers, imperatively, on one node per frame — the same discipline the chrome
 * mirror already uses, with no React commit and no change of parentage. That last part matters:
 * `restoreStudioSingleDrawTransformLayer` skips nodes an external owner has reparented, and the
 * parked-chrome bookkeeping keys off the wrapper's parent, so both stay untouched.
 *
 * This module is the renderer-free half: it answers "what rect, if any" from the gesture's target
 * bounds. Applying it to a Konva node lives in `studio-live-transform-clip-tracking-konva.ts`.
 */
import { studioDrawObjectTransformScale } from "./brush/studio-draw-object-transform";
import { panelContainingBounds } from "./studio-element-geometry";

import type { StudioDrawObjectTransformBounds } from "./brush/studio-draw-object-transform";
import type { El } from "./studio-element-model";

/** The clip rect Konva wants, in the same shape `StudioCanvasViewportDocumentLayer` builds. */
export interface StudioLiveTransformClipRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The axis-aligned bounds a gesture frame will commit, from the same decomposition the preview
 * projects and the commit planner bakes.
 *
 * Rotation is deliberately folded into the AABB rather than ignored: `containingPanel` reads
 * `elBounds`, which is axis-aligned, so a rotated stroke's panel verdict is decided by the box
 * around the rotated ink — exactly what this returns. A 45-degree turn genuinely can push a stroke
 * past the 1.4x cutoff, and pretending otherwise would put the preview back out of step with the
 * commit for the one case this module exists to fix.
 */
export function studioLiveTransformTargetBounds(
  targetBounds: StudioDrawObjectTransformBounds,
  rotationDeg: number,
): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null {
  const { x, y, width, height } = targetBounds;
  if (![x, y, width, height, rotationDeg].every((value) => Number.isFinite(value))) return null;
  if (width <= 0 || height <= 0) return null;
  const radians = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  // The AABB of the rotated rectangle, about the target box's ORIGIN — not its centre.
  //
  // The preview and the commit share one decomposition,
  // translate(target) ∘ rotate(θ) ∘ scale ∘ translate(−source), under which the source box's
  // origin maps to (target.x, target.y) for EVERY θ. So the pivot is the corner, and rotating
  // about the centre instead displaces the box by up to half its diagonal — enough, near a panel
  // edge, to pick a different panel from the one the commit will pick, which is precisely the
  // clip pop this module exists to remove.
  //
  // Local corners are (u, v) for u ∈ {0, width}, v ∈ {0, height}; each maps to
  // (target.x + u·cos − v·sin, target.y + u·sin + v·cos), so the extents are the sums of the
  // per-axis minima and maxima of those two independent terms.
  const minX = x + Math.min(0, width * cos) + Math.min(0, -height * sin);
  const minY = y + Math.min(0, width * sin) + Math.min(0, height * cos);
  const w = width * Math.abs(cos) + height * Math.abs(sin);
  const h = width * Math.abs(sin) + height * Math.abs(cos);
  return { x: minX, y: minY, w, h };
}

/**
 * The bounds the COMMIT will read for this frame, from the stroke's own transformed points.
 *
 * The box AABB is not a stand-in for this. `planStudioDrawObjectTransform` maps the POINT ARRAY,
 * and `containingPanel` then takes `elBounds` of those points — and a stroke's points need not
 * touch all four corners of its selection box. A two-point diagonal in a 100x100 box turned 45
 * degrees collapses to a zero-width vertical line, where the box AABB is still 141.4 wide: beside
 * a 100-wide panel the box reading fails the 1.4x cutoff and drops the clip, while the committed
 * stroke passes it and is clipped again at release — the pop, back again.
 *
 * Falls back to the box AABB when there are no usable points, which is the honest answer for a
 * caller that cannot supply them: same reading as before, no worse.
 */
function transformedPointBounds(
  sourceBounds: StudioDrawObjectTransformBounds,
  targetBounds: StudioDrawObjectTransformBounds,
  rotationDeg: number,
  points: readonly number[],
): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null {
  if (points.length < 2) return null;
  const scale = studioDrawObjectTransformScale(sourceBounds, targetBounds);
  if (!scale) return null;
  const radians = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < points.length; i += 2) {
    const px = points[i];
    const py = points[i + 1];
    if (px === undefined || py === undefined) return null;
    // The commit planner's own point mapping, so the two cannot read different geometry.
    const u = (px - sourceBounds.x) * scale.scaleX;
    const v = (py - sourceBounds.y) * scale.scaleY;
    const x = targetBounds.x + u * cos - v * sin;
    const y = targetBounds.y + u * sin + v * cos;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (minX > maxX) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * The clip the COMMIT will give this stroke for the supplied gesture frame, or `null` for none.
 *
 * @param points the stroke's document-space point array. Supply it wherever it is available: the
 *   commit reads the transformed points, and only that reading is guaranteed to agree with it.
 * @param noClip the element's own `noClip` flag — the document layer honours it before consulting
 *   `containingPanel`, so this must too or the preview would clip a stroke the commit leaves free.
 */
export function studioLiveTransformCommittedClip(input: {
  readonly sourceBounds?: StudioDrawObjectTransformBounds;
  readonly targetBounds: StudioDrawObjectTransformBounds;
  readonly rotationDeg: number;
  readonly points?: readonly number[];
  /** Exact planner-produced point bounds avoid a second O(points) traversal. */
  readonly transformedBounds?: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  };
  readonly elements: readonly El[];
  readonly noClip?: boolean;
}): StudioLiveTransformClipRect | null {
  if (input.noClip === true) return null;
  const bounds =
    (input.transformedBounds
      && [
        input.transformedBounds.x,
        input.transformedBounds.y,
        input.transformedBounds.w,
        input.transformedBounds.h,
      ].every((value) => Number.isFinite(value))
      && input.transformedBounds.w >= 0
      && input.transformedBounds.h >= 0
      ? input.transformedBounds
      : null)
    ?? (input.sourceBounds && input.points
      ? transformedPointBounds(
        input.sourceBounds,
        input.targetBounds,
        input.rotationDeg,
        input.points,
      )
      : null)
    ?? studioLiveTransformTargetBounds(input.targetBounds, input.rotationDeg);
  if (!bounds) return null;
  const panel = panelContainingBounds(bounds, input.elements);
  return panel
    ? { x: panel.x, y: panel.y, width: panel.width, height: panel.height }
    : null;
}

/** True when two clip verdicts differ — the only frames that need a scene-graph write. */
export function studioLiveTransformClipChanged(
  a: StudioLiveTransformClipRect | null,
  b: StudioLiveTransformClipRect | null,
): boolean {
  if (a === null || b === null) return a !== b;
  return a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height;
}
