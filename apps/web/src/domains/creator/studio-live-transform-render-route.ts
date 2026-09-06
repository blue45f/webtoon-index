/**
 * Whether a stroke's RENDER ROUTE survives a scale — the check an engine allowlist cannot make.
 *
 * Classifying renderers as affine-safe was still too coarse, and review found why twice over. The
 * safest engines in the catalogue still pass their geometry through fixed thresholds and clamps
 * measured in absolute pixels, and a scale moves the geometry across them:
 *
 *   - `StudioDrawNode` renders every draw element at `Math.max(1, el.strokeWidth)`. Halving a 1px
 *     stroke previews a 0.5px nib and commits `strokeWidth: 0.5`, which the renderer immediately
 *     floors back to 1px.
 *   - The perfect-freehand family picks its route from `strokeDistance`: under 16px with few
 *     points it draws a compact dot fallback; a degenerate outline under 120px falls back to a
 *     Line; and at 180px or more with sparse spacing it takes the sparse-long branch. A scale can
 *     therefore change topology even when the engine identity stays unchanged.
 *
 * Neither is a property of the engine, and no list of engines can express either. Both are
 * properties of the (element, scale) PAIR, which is exactly what a per-frame check can see: the
 * preview shows `route(element) transformed by s`, the commit shows `route(element transformed by
 * s)`, and those agree precisely when the scale does not carry the element across a threshold.
 *
 * So the gate is stated once, generally: every scale-sensitive predicate the renderer branches on
 * must evaluate the same before and after. A stroke well inside its route keeps its live preview —
 * the common case, by a wide margin — and one sitting on a boundary stands down for that gesture
 * and keeps commit-at-release. Adding a threshold to the renderer means adding it here; the
 * alternative is discovering it as a snap.
 */

/** The scale-sensitive quantities `StudioDrawNode` branches on, read off the source element. */
export interface StudioLiveTransformRenderRoute {
  /**
   * Some renderers are pure model functions but still contain enough absolute clamps/floors that
   * a retained subtree cannot be proven affine-equivalent. They remain eligible for the isolated
   * exact draft; this flag merely refuses the O(1) retained shortcut.
   */
  readonly retainedAffinePolicy?: "route-checked" | "model-draft-only";
  /** `el.strokeWidth` as stored, before the renderer's floor. */
  readonly strokeWidth: number;
  /** `Math.hypot` of the point-bounds span — the renderer's `strokeDistance`. */
  readonly strokeDistance: number;
  /** Source point count (pairs), for the sparse-spacing predicate. */
  readonly pointCount: number;
  /** Gesture-start centreline length, compiled once for exact-draft work admission. */
  readonly pathLength?: number;
  /** True when the renderer draws an arrowhead for this stroke (`kind` line/arrow with a head). */
  readonly drawsArrowHead?: boolean;
  /**
   * True when the stroke renders through the perfect-freehand family.
   *
   * The distance cutoffs, the sparse-spacing predicate, the compact-dot floors and the 400px
   * outline cap ALL live inside that branch in `StudioDrawNode` — gated there on
   * `isPerfectAliasBrush`, `brushFamily === "perfect"` and `perfectProfile.id`. Applying them to
   * every allowlisted stroke rejected previews that had nothing to cross: a causal-ink pen stroke
   * spanning 10px lost its live preview at 2x for a 16px cutoff its renderer never consults.
   * Only the 1px diameter floor is universal (`StudioDrawNode` floors every draw element).
   */
  readonly isPerfectFamily?: boolean;
  /** True for the `perfect-ink` profile, whose compact-dot floor is 3px rather than 1.4px. */
  readonly isPerfectInk?: boolean;
  /**
   * Clockwise rotation in degrees the gesture applies.
   *
   * `strokeDistance` is the span of an AXIS-ALIGNED bounding box, so rotation moves it even at
   * scale 1: a 10x10 square spans 14.1px upright and 20px at 45 degrees, which is enough to cross
   * the 16px compact-dot cutoff on its own. Omitted means no rotation.
   */
  readonly rotationDeg?: number;
}

/**
 * How far rotation can move `strokeDistance`, as a multiplicative bound.
 *
 * `strokeDistance` is the DIAGONAL of an axis-aligned bounding box, so it is not rotation
 * invariant: a 10x10 square spans 14.1px upright and 20px at 45 degrees. The exact rotated span
 * needs the rotated points, which this module deliberately does not hold (it is called per frame
 * with a rotation that changes every frame). What it can do is bound the answer.
 *
 * For a point set of diameter D, every AABB containing it has a diagonal in `[D, D * sqrt(2)]` --
 * at least D because the two farthest points sit inside the box, at most `D * sqrt(2)` because the
 * set fits in a D-circle whose bounding square has that diagonal. `strokeDistance` is one such
 * diagonal, so the rotated one lies within `sqrt(2)` either way of it. Requiring the WHOLE interval
 * to stay on one side of a threshold is conservative: a stroke well inside its route keeps its
 * preview, and one anywhere near a boundary stands down for the rotated gesture.
 */
const STUDIO_RENDER_ROUTE_ROTATION_SPAN = Math.SQRT2;

/** Absolute px thresholds `StudioDrawNode` compares `strokeDistance` against. */
const STUDIO_RENDER_ROUTE_DISTANCE_THRESHOLDS = [16, 120, 180] as const;

/** The renderer's minimum drawn diameter, from `StudioDrawNode`. */
const STUDIO_RENDER_ROUTE_MIN_DIAMETER = 1;

/**
 * `studioPerfectFreehandStrokeOptions` clamps the committed outline size to `[0.5, 400]`, so a
 * 300px stroke scaled 2x previews a 600px affine outline and re-renders at 400px on commit. The
 * floor is below the 1px diameter floor above, so only the cap adds a distinct crossing.
 */
const STUDIO_RENDER_ROUTE_MAX_OUTLINE_WIDTH = 400;

/**
 * Arrowheads are sized `Math.max(8, strokeWidth * 2)` in `StudioDrawNode`, an absolute floor that
 * does not scale: a 2px arrow scaled 2x previews its existing 8px head at 16px while the commit
 * stores width 4 and regenerates the head at 8px. Only strokes that draw a head care, so callers
 * say so rather than every stroke paying for it.
 */
const STUDIO_RENDER_ROUTE_MIN_ARROW_HEAD = 8;

/**
 * Compact perfect-dot radius floors, from `StudioDrawNode`: `perfect-ink` never draws a dot under
 * 3px radius, other perfect profiles never under 1.4px. A stroke can stay ON the compact-dot route
 * across a scale and still be non-affine, because the preview scales the dot already drawn while
 * the commit regenerates it against the same absolute floor.
 */
const STUDIO_RENDER_ROUTE_MIN_DOT_RADIUS_INK = 3;
const STUDIO_RENDER_ROUTE_MIN_DOT_RADIUS_OTHER = 1.4;

/** The compact-dot route's own gate, from `StudioDrawNode`: few points and a short span. */
const STUDIO_RENDER_ROUTE_COMPACT_MAX_POINTS = 4;

/** Sparse-long-stroke spacing floor: `Math.max(20, strokeWidth * 4)`. */
function sparseSpacingFloor(strokeWidth: number): number {
  return Math.max(20, strokeWidth * 4);
}

/**
 * True when scaling by `scale` leaves every render-route decision unchanged.
 *
 * Conservative by construction: anything not finite, not positive, or not describable answers
 * false, because an unreadable route is not a licence to preview one.
 */
export function studioLiveTransformRouteSurvivesScale(
  route: StudioLiveTransformRenderRoute,
  scale: number,
): boolean {
  if (route.retainedAffinePolicy === "model-draft-only") return false;
  const { strokeWidth, strokeDistance, pointCount } = route;
  if (!Number.isFinite(scale) || scale <= 0) return false;
  if (!Number.isFinite(strokeWidth) || strokeWidth < 0) return false;
  if (!Number.isFinite(strokeDistance) || strokeDistance < 0) return false;
  if (!Number.isFinite(pointCount) || pointCount < 0) return false;

  // The width floor. The preview scales what the renderer already drew — `max(1, w) * s` — while
  // the commit stores `w * s` and the renderer floors that. They agree only away from the floor.
  const previewDiameter = Math.max(STUDIO_RENDER_ROUTE_MIN_DIAMETER, strokeWidth) * scale;
  const committedDiameter = Math.max(STUDIO_RENDER_ROUTE_MIN_DIAMETER, strokeWidth * scale);
  if (Math.abs(previewDiameter - committedDiameter) > 1e-9) return false;

  const perfectFamily = route.isPerfectFamily === true;

  // The perfect-freehand outline cap, which the preview scales straight past.
  if (perfectFamily) {
    const previewOutline = Math.min(STUDIO_RENDER_ROUTE_MAX_OUTLINE_WIDTH, strokeWidth) * scale;
    const committedOutline = Math.min(STUDIO_RENDER_ROUTE_MAX_OUTLINE_WIDTH, strokeWidth * scale);
    if (Math.abs(previewOutline - committedOutline) > 1e-9) return false;
  }

  // The arrowhead floor, for strokes that draw one.
  if (route.drawsArrowHead === true) {
    const previewHead = Math.max(STUDIO_RENDER_ROUTE_MIN_ARROW_HEAD, strokeWidth * 2) * scale;
    const committedHead = Math.max(STUDIO_RENDER_ROUTE_MIN_ARROW_HEAD, strokeWidth * scale * 2);
    if (Math.abs(previewHead - committedHead) > 1e-9) return false;
  }

  // The compact perfect-dot radius floor. A stroke can stay ON the compact-dot route across a
  // scale and still be non-affine: the preview scales the dot already drawn while the commit
  // regenerates it against the same absolute floor.
  if (
    perfectFamily
    && pointCount <= STUDIO_RENDER_ROUTE_COMPACT_MAX_POINTS
    && strokeDistance < STUDIO_RENDER_ROUTE_DISTANCE_THRESHOLDS[0]
  ) {
    const floor = route.isPerfectInk === true
      ? STUDIO_RENDER_ROUTE_MIN_DOT_RADIUS_INK
      : STUDIO_RENDER_ROUTE_MIN_DOT_RADIUS_OTHER;
    // `dotWidth = Math.max(Math.max(strokeWidth, 2), width)`, radius `Math.max(floor, dotWidth/2)`.
    const dotRadius = (dotWidth: number) => Math.max(floor, Math.max(dotWidth, 2) / 2);
    const previewRadius = dotRadius(strokeWidth) * scale;
    const committedRadius = dotRadius(strokeWidth * scale);
    if (Math.abs(previewRadius - committedRadius) > 1e-9) return false;
  }

  // The distance-keyed route branches. Rotation moves `strokeDistance` too -- it is an AABB
  // diagonal, not a rotation invariant -- so a rotated frame is graded against the whole interval
  // rotation can reach rather than the upright reading alone.
  const rotated = route.rotationDeg !== undefined && route.rotationDeg % 360 !== 0;
  if (rotated && !Number.isFinite(route.rotationDeg)) return false;
  const lowDistance = rotated
    ? (strokeDistance / STUDIO_RENDER_ROUTE_ROTATION_SPAN) * scale
    : strokeDistance * scale;
  const highDistance = rotated
    ? strokeDistance * STUDIO_RENDER_ROUTE_ROTATION_SPAN * scale
    : strokeDistance * scale;
  if (perfectFamily) {
    for (const threshold of STUDIO_RENDER_ROUTE_DISTANCE_THRESHOLDS) {
      // Both the source reading and every reachable post-transform reading must agree.
      if ((strokeDistance < threshold) !== (lowDistance < threshold)) return false;
      if ((strokeDistance < threshold) !== (highDistance < threshold)) return false;
    }
  }
  // The sparse-long branch compares a scaled spacing against a floor that is NOT linear in scale
  // (`Math.max(20, w * 4)`), so it can flip even when both distance thresholds hold.
  // Graded across the rotation interval as well: the renderer derives this spacing from the
  // ROTATED points' AABB distance, so a turn can flip the predicate without crossing either
  // distance cutoff -- an 11-point diamond at 300px and width 7 is sparse upright (30 >= 28) and
  // not sparse at 45 degrees (21.2 < 28).
  if (perfectFamily) {
    const divisor = Math.max(1, pointCount - 1);
    const sparseBefore = strokeDistance / divisor >= sparseSpacingFloor(strokeWidth);
    const floorAfter = sparseSpacingFloor(strokeWidth * scale);
    if ((lowDistance / divisor >= floorAfter) !== sparseBefore) return false;
    if ((highDistance / divisor >= floorAfter) !== sparseBefore) return false;
  }

  return true;
}

/** Reads the route inputs off a stroke's stored geometry. */
export function studioLiveTransformRouteOfPoints(
  points: readonly number[],
  strokeWidth: number,
): StudioLiveTransformRenderRoute {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let pathLength = 0;
  let previousX: number | null = null;
  let previousY: number | null = null;
  for (let index = 0; index + 1 < points.length; index += 2) {
    const x = points[index]!;
    const y = points[index + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (previousX !== null && previousY !== null) {
      pathLength += Math.hypot(x - previousX, y - previousY);
    }
    previousX = x;
    previousY = y;
  }
  const pointCount = Math.floor(points.length / 2);
  const strokeDistance = pointCount === 0
    ? 0
    : Math.hypot(maxX - minX, maxY - minY);
  return { strokeWidth, strokeDistance, pointCount, pathLength };
}
