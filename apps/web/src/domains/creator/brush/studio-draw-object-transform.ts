/**
 * Free affine transform for a single draw(선화) element — rotation and non-uniform scale.
 *
 * `studio-group-uniform-resize.ts` deliberately handles only positive, axis-aligned, *uniform*
 * corner resize across a whole selection, because tearing a mixed group under a general affine is
 * not a safe default. A single stroke has no such constraint: it is one point array, so the full
 * transform can be applied exactly.
 *
 * **The transform is baked into `points`, not stored as a matrix.** That is the existing convention
 * (`transformDocumentPointArray` in the group planner) and it is also the quality-correct choice:
 * a stroke scaled by re-rendering its transformed coordinates stays a vector path and is rasterized
 * at the final size, so it keeps full edge sharpness. Scaling a rasterized stroke instead — or
 * leaving a `scaleX/scaleY` on the Konva node — resamples already-rendered ink and visibly softens
 * it. DrawEl therefore gains no scale/rotation fields; the geometry *is* the state.
 *
 * Geometry matches how Konva reports a transformed node, so the editor can hand its Transformer
 * output straight through: the box is scaled first, then rotated about the target box's origin.
 *
 *   sx = target.width / source.width,  sy = target.height / source.height
 *   u  = (px - source.x) * sx,         v  = (py - source.y) * sy
 *   p' = (target.x + u·cosθ - v·sinθ,  target.y + u·sinθ + v·cosθ)
 *
 * With θ = 0 and sx = sy this reduces exactly to the group planner's uniform formula, so the two
 * paths agree wherever their domains overlap.
 *
 * A rejected transform returns `null` rather than a partially transformed stroke: callers treat
 * that as "leave the document untouched", the same all-or-nothing discipline the group planner uses.
 */
import { MAX_COORDINATE, MAX_STROKE_WIDTH } from "../live/studio-crdt-document-constants";

import { resolveStudioBrushRuntimeContract } from "./studio-brush-runtime-contract";
import { resolveStudioCalligraphyRenderTip } from "./studio-calligraphy-nib-profile";
import { SHAPE_PARAM_RANGES } from "./studio-stroke-shapes";

import type { DrawEl } from "../studio-element-model";

/**
 * The nib a single-sample calligraphy TAP actually renders, from `StudioDrawNode`'s tap branch:
 * angle -30 and roundness 0.35, hardcoded there rather than resolved from the catalogue. Kept
 * beside the planner that has to rotate from the same base the render used.
 */
const STUDIO_LEGACY_CALLIGRAPHY_TAP_TIP = {
  tiltEnabled: false,
  angleDeg: -30,
  roundness: 0.35,
} as const;

/**
 * Kinds `StudioDrawNode` reconstructs from `drawBounds(points)` as AXIS-ALIGNED primitives, so
 * nothing an affine writes into `points` can carry an orientation for them. Kept beside the
 * planner that has to refuse them; the canvas layer derives the same verdict for the preview.
 */
export function studioDrawShapeIsBoundsDerived(kind: unknown): boolean {
  return kind === "rect"
    || kind === "ellipse"
    || kind === "star"
    || kind === "triangle"
    || kind === "polygon";
}

/**
 * Symmetry families whose copies are REFLECTIONS about world axes through the stored centre
 * (`studioBrushSymmetryTransforms` regenerates them from the committed base at render time).
 * A reflection conjugates rotation -- `reflect(R_θ p) = R_{-θ}(reflect p)` -- so turning the base
 * points by θ turns every mirrored copy by −θ: the '/' half of a mirrored 'V' would go clockwise
 * while its twin goes anticlockwise. The model stores no axis angle that could absorb θ, so a
 * rotation has nowhere to go for these strokes. Radial copies are rotations about the same
 * centre and commute with the frame rotation, so they carry θ exactly. Kept beside the planner
 * that has to drop the angle; the group planner refuses from the same verdict.
 */
export function studioDrawSymmetryIsMirrored(symmetry: DrawEl["symmetry"]): boolean {
  if (symmetry === undefined) return false;
  return symmetry.type === "vertical"
    || symmetry.type === "horizontal"
    || symmetry.type === "kaleidoscope"
    || symmetry.type === "silk";
}

/**
 * The single-stroke planner's own drop rule: a stroke whose `points` cannot absorb a turn keeps
 * its move and resize and stays upright (`studioDrawShapeIsBoundsDerived`,
 * `studioDrawSymmetryIsMirrored`). Exported so the rest of the rotate lane reads the same verdict
 * BEFORE an angle reaches this planner: the editor withholds the rotation handle, the group
 * planner refuses such a member, and `planStudioSelectionTransformCommit` refuses a sole stroke's
 * angle outright rather than committing the drop below as a silent resize.
 */
export function studioDrawObjectRotationIsDropped(el: DrawEl): boolean {
  return studioDrawShapeIsBoundsDerived(el.kind) || studioDrawSymmetryIsMirrored(el.symmetry);
}

/**
 * Whether the retained calligraphy renderer actually consumes stored orientation samples.
 *
 * Mouse/CRDT materialization may populate zero-filled arrays, but the renderer normalizes those
 * to `hasTilt:false` and zero twist. A disabled nib ignores even non-zero samples, and the
 * single-sample tap route ignores all stylus channels. Keeping this predicate beside the commit
 * planner lets preview eligibility and brush-tip rotation share the exact same semantic gate.
 */
export function studioDrawHasEffectivePerSampleOrientation(el: DrawEl): boolean {
  if (el.points.length <= 2) return false;
  if (resolveStudioBrushRuntimeContract(el.brush)?.engine !== "calligraphy-segments") {
    return false;
  }
  const tip = resolveStudioCalligraphyRenderTip(el.brush, el.brushTip);
  // The user-adjustable `calligraphy` brush has no catalogue profile when old documents omitted
  // brushTip; buildCalligraphySegments then sanitizes undefined to its tilt-enabled default.
  if ((tip?.tiltEnabled ?? true) !== true) return false;
  const sampleCount = Math.min(
    Math.floor(el.points.length / 2),
    Math.max(el.tiltXs?.length ?? 0, el.tiltYs?.length ?? 0, el.twists?.length ?? 0),
  );
  for (let index = 0; index < sampleCount; index += 1) {
    const tiltX = el.tiltXs?.[index] ?? 0;
    const tiltY = el.tiltYs?.[index] ?? 0;
    const twist = el.twists?.[index] ?? 0;
    // Match normalizeCalligraphyStylusInput: malformed axes fall back independently, so one
    // finite non-zero axis still constitutes effective tilt rather than being masked by its peer.
    const safeTiltX = Number.isFinite(tiltX) ? tiltX : 0;
    const safeTiltY = Number.isFinite(tiltY) ? tiltY : 0;
    if (
      Math.hypot(safeTiltX, safeTiltY) > Number.EPSILON
      || (Number.isFinite(twist) && twist > Number.EPSILON)
    ) {
      return true;
    }
  }
  return false;
}

export interface StudioDrawObjectTransformBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Brush width response to the transform.
 *
 * `preserve` keeps the authored width — matching the group planner's default, where resizing a
 * layout must not silently re-weight line art. `scale` grows the width with the object, which is
 * what "make this drawing bigger" means for a single stroke.
 */
export type StudioDrawObjectStrokeWidthPolicy = "preserve" | "scale";

export interface StudioDrawObjectTransformInput {
  readonly el: DrawEl;
  readonly sourceBounds: StudioDrawObjectTransformBounds;
  /** Target box *before* rotation — width/height are the scaled extents, as Konva reports them. */
  readonly targetBounds: StudioDrawObjectTransformBounds;
  /** Clockwise rotation in degrees about the target box origin. Konva's `rotation()` convention. */
  readonly rotationDeg?: number;
  readonly strokeWidthPolicy?: StudioDrawObjectStrokeWidthPolicy;
}

/** One point traversal produces both the durable candidate and the bounds its readers need. */
export interface StudioDrawObjectTransformPlan {
  readonly element: DrawEl;
  /**
   * The angle actually baked into `element`: the requested one, or 0 when this planner dropped it
   * (bounds-derived kinds, mirrored symmetry). A caller that must not tolerate a dropped turn --
   * the group planner, whose other members did turn -- compares this with what it asked for.
   */
  readonly rotationDeg: number;
  /** Exact `elBounds(element)` result, without scanning the transformed points a second time. */
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  };
}

/** Axis scale factors, exposed so callers can warn about (or reject) a non-uniform gesture. */
export interface StudioDrawObjectTransformScale {
  readonly scaleX: number;
  readonly scaleY: number;
  /** Geometric mean — the single factor applied to radial quantities like brush width. */
  readonly uniformEquivalent: number;
  readonly uniform: boolean;
}

const UNIFORM_SCALE_RELATIVE_EPSILON = 1e-6;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function finiteNonNegative(value: number): boolean {
  return finite(value) && value >= 0;
}

function finitePositive(value: number): boolean {
  return finite(value) && value > 0;
}

function finiteOptionalNonNegative(value: number | undefined): boolean {
  return value === undefined || finiteNonNegative(value);
}

function validBounds(bounds: StudioDrawObjectTransformBounds): boolean {
  return (
    finite(bounds.x) &&
    finite(bounds.y) &&
    finitePositive(bounds.width) &&
    finitePositive(bounds.height)
  );
}

function finiteEvenPoints(points: readonly number[] | undefined): boolean {
  return (
    points !== undefined &&
    points.length >= 2 &&
    points.length % 2 === 0 &&
    points.every(finite)
  );
}

function validShapeParams(shapeParams: DrawEl["shapeParams"]): boolean {
  return (
    shapeParams === undefined ||
    (finitePositive(shapeParams.starPoints) &&
      finiteNonNegative(shapeParams.starInnerRatio) &&
      finitePositive(shapeParams.polygonSides) &&
      finiteNonNegative(shapeParams.cornerRadius))
  );
}

function validSymmetry(symmetry: DrawEl["symmetry"]): boolean {
  return (
    symmetry === undefined ||
    (finite(symmetry.centerX) &&
      finite(symmetry.centerY) &&
      finiteOptionalNonNegative(symmetry.radialCount))
  );
}

/**
 * Resolves the axis scale factors for a source→target box pair.
 *
 * Exported so the editor can decide what to do about a non-uniform gesture (warn, or constrain the
 * handles) without duplicating the arithmetic or the uniformity epsilon.
 */
export function studioDrawObjectTransformScale(
  sourceBounds: StudioDrawObjectTransformBounds,
  targetBounds: StudioDrawObjectTransformBounds
): StudioDrawObjectTransformScale | null {
  if (!validBounds(sourceBounds) || !validBounds(targetBounds)) return null;
  const scaleX = targetBounds.width / sourceBounds.width;
  const scaleY = targetBounds.height / sourceBounds.height;
  if (!finitePositive(scaleX) || !finitePositive(scaleY)) return null;
  const uniformEquivalent = Math.sqrt(scaleX * scaleY);
  if (!finitePositive(uniformEquivalent)) return null;
  return {
    scaleX,
    scaleY,
    uniformEquivalent,
    uniform:
      Math.abs(scaleX - scaleY) <=
      UNIFORM_SCALE_RELATIVE_EPSILON * Math.max(1, scaleX, scaleY),
  };
}

/**
 * Applies a free affine transform to one draw element, returning a new element.
 *
 * Brush width scales by the geometric mean of the axis factors. That is exact for a uniform
 * transform; under a non-uniform one it is an explicit approximation, because a round brush nib
 * has no elliptical representation in the stroke model — the path deforms exactly, the nib keeps
 * its area. Callers that need to surface that trade-off can read `uniform` from
 * `studioDrawObjectTransformScale`.
 *
 * @returns the transformed element and its exact point bounds, or `null` for invalid input/result.
 */
export function planStudioDrawObjectTransformWithBounds(
  input: StudioDrawObjectTransformInput
): StudioDrawObjectTransformPlan | null {
  const { el, sourceBounds, targetBounds } = input;
  const requestedRotationDeg = input.rotationDeg ?? 0;
  const strokeWidthPolicy = input.strokeWidthPolicy ?? "scale";

  if (el.type !== "draw") return null;
  if (!finite(requestedRotationDeg)) return null;
  // Bounds-derived primitives cannot absorb a rotation into `points`, and rotating them anyway
  // DESTROYS them. StudioDrawNode rebuilds rect/ellipse/star/triangle/polygon from
  // `drawBounds(points)` as axis-aligned shapes, so only the bounding box of the rotated endpoints
  // survives -- and for a square stored as its diagonal `[0, 0, 40, 40]`, a 45deg rotation puts
  // both endpoints on the same vertical line, collapsing the committed width to the renderer's
  // 0.1px floor (measured: the rotated x-extent comes out at 3.6e-15). The bounds mapping still
  // applies, so the handle's move and resize land; only the turn is dropped, which is what the
  // renderer would have done with it regardless. These kinds are excluded from the live preview
  // for the same reason (studio-live-transform-preview-eligibility), so the two agree.
  //
  // Mirrored symmetry drops the turn from the other side: the points CAN carry theta, but the
  // renderer re-reflects the turned base about world axes, so the copies come out turned by
  // -theta and the artwork tears in place (`studioDrawSymmetryIsMirrored`). The stroke keeps its
  // move and resize -- those commute with the reflections -- and stays upright, exactly as a
  // bounds-derived shape does.
  const rotationDeg = studioDrawObjectRotationIsDropped(el) ? 0 : requestedRotationDeg;
  if (
    !finiteEvenPoints(el.points) ||
    !finiteNonNegative(el.strokeWidth) ||
    !finiteOptionalNonNegative(el.sampleSpacing) ||
    !validShapeParams(el.shapeParams) ||
    !validSymmetry(el.symmetry)
  ) {
    return null;
  }

  const scale = studioDrawObjectTransformScale(sourceBounds, targetBounds);
  if (!scale) return null;

  const radians = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  const mapPoint = (px: number, py: number): { x: number; y: number } | null => {
    const u = (px - sourceBounds.x) * scale.scaleX;
    const v = (py - sourceBounds.y) * scale.scaleY;
    const x = targetBounds.x + u * cos - v * sin;
    const y = targetBounds.y + u * sin + v * cos;
    // Same trap as the stroke width below: `validatePayload` asserts every coordinate within
    // +/-MAX_COORDINATE, so a stroke near that boundary can be moved, scaled or rotated to a
    // finite-but-unpublishable position. It would apply locally and then fail publication,
    // leaving the author's document ahead of every collaborator's. Refusing the transform keeps
    // the stroke where it was, which is the honest outcome for a gesture that cannot be persisted.
    if (x < -MAX_COORDINATE || x > MAX_COORDINATE) return null;
    if (y < -MAX_COORDINATE || y > MAX_COORDINATE) return null;
    return finite(x) && finite(y) ? { x, y } : null;
  };

  const points = new Array<number>(el.points.length);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let index = 0; index + 1 < el.points.length; index += 2) {
    const mapped = mapPoint(el.points[index]!, el.points[index + 1]!);
    if (!mapped) return null;
    points[index] = mapped.x;
    points[index + 1] = mapped.y;
    if (mapped.x < minX) minX = mapped.x;
    if (mapped.x > maxX) maxX = mapped.x;
    if (mapped.y < minY) minY = mapped.y;
    if (mapped.y > maxY) maxY = mapped.y;
  }
  const bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };

  const widthFactor = strokeWidthPolicy === "scale" ? scale.uniformEquivalent : 1;
  const strokeWidth = el.strokeWidth * widthFactor;
  // Finite is not enough: `validatePayload` in live/studio-crdt-document-payload asserts
  // strokeWidth within [0.01, MAX_STROKE_WIDTH] and sampleSpacing within [0, MAX_STROKE_WIDTH],
  // so a large enough enlargement produces an element that applies locally and then FAILS CRDT
  // publication -- the collaborator's document silently diverges from the author's. Refusing the
  // transform leaves the stroke as it was, which is the honest outcome for a gesture whose result
  // cannot be persisted. The same trap caught the stylus-channel rotation earlier in this file.
  if (!finite(strokeWidth) || strokeWidth < 0.01 || strokeWidth > MAX_STROKE_WIDTH) return null;

  let sampleSpacing: number | undefined;
  if (el.sampleSpacing !== undefined) {
    sampleSpacing = el.sampleSpacing * widthFactor;
    if (!finite(sampleSpacing) || sampleSpacing < 0 || sampleSpacing > MAX_STROKE_WIDTH) {
      return null;
    }
  }

  let shapeParams: DrawEl["shapeParams"];
  if (el.shapeParams !== undefined) {
    // Only the radial corner radius carries a length; counts and ratios are scale-free.
    // Clamped to the editor's own range. `normalizeShapeParams` clamps to
    // SHAPE_PARAM_RANGES.cornerRadius (0-120) whenever the shape RENDERS, and the live payload
    // validator enforces the same bounds, so an unclamped product is both invisible and
    // unpublishable: scaling a radius-100 rectangle by 2 stored 200 while the canvas drew 120, and
    // the next resize then compounded from the hidden 200 instead of the visible 120, moving the
    // radius non-proportionally and handing the inspector an out-of-range value.
    const cornerRadius = Math.min(
      SHAPE_PARAM_RANGES.cornerRadius.max,
      Math.max(
        SHAPE_PARAM_RANGES.cornerRadius.min,
        el.shapeParams.cornerRadius * scale.uniformEquivalent,
      ),
    );
    if (!finite(cornerRadius)) return null;
    // Keep the original reference when nothing moved: the no-op guard below compares by identity
    // (as `commitCanvasSelectionResize` does), so an always-fresh clone would defeat it and push
    // an undo entry plus a CRDT mutation for a gesture that changed nothing.
    shapeParams = cornerRadius === el.shapeParams.cornerRadius
      ? el.shapeParams
      : { ...el.shapeParams, cornerRadius };
  }

  let symmetry: DrawEl["symmetry"];
  if (el.symmetry !== undefined) {
    const center = mapPoint(el.symmetry.centerX, el.symmetry.centerY);
    if (!center) return null;
    symmetry = center.x === el.symmetry.centerX && center.y === el.symmetry.centerY
      ? el.symmetry
      : { ...el.symmetry, centerX: center.x, centerY: center.y };
  }

  // Per-sample stylus orientation is deliberately NOT transformed here.
  //
  // Three attempts at rotating it were each wrong in a different way, and the third explains the
  // other two: `calligraphySegmentStep` composes the nib angle as `atan2(tiltY, tiltX) + twist`
  // (studio-brush.ts), and it takes that branch only when the sample HAS tilt -- otherwise the
  // angle comes from twist alone. So the correct rotation is not "rotate both channels"; it
  // depends on renderer-internal branching, and rotating both adds the gesture angle twice.
  // Along the way the naive versions also produced values the CRDT payload validator rejects
  // (negative twists, twists at 359.5, tilt outside its square).
  //
  // Rather than replicate that branching -- coupling this planner to renderer internals that can
  // change underneath it -- strokes carrying these channels are excluded from the live preview
  // (studio-live-transform-preview-eligibility) and keep commit-at-release, where the stored
  // samples are replayed exactly as authored. Correct, just not live.

  // Orientation-dependent nibs must turn with the stroke. A calligraphy tip's `angleDeg` feeds
  // Konva's `rotation` prop directly (StudioDrawNode renders the tap as a rotated Ellipse), the
  // same clockwise-degree convention as `rotationDeg`, so the two simply compose. Without this the
  // preview rotates the whole rendered subtree — nib included — and the commit then replans from
  // points alone, snapping the nib back to its original orientation the moment the handle is
  // released. The flip path already transforms this field (studio-figma-selection-ux negates it on
  // mirror), so carrying it through a rotation is the established treatment, not a new rule.
  // Only when the stroke has NO per-sample orientation. `calligraphySegmentStep` uses
  // `brushTip.angleDeg` as the FALLBACK angle for samples without tilt and replaces it with
  // `atan2(tiltY, tiltX) + twist` for samples that have it, so a stroke carrying both kinds would
  // have half its nib turned by this rotation and half left alone -- the commit would distort the
  // stroke rather than rotate it. Excluding these strokes from the preview does not help here:
  // this is the commit path, which runs whether or not a preview did.
  const hasPerSampleOrientation = studioDrawHasEffectivePerSampleOrientation(el);
  // Pre-nib-table documents carry no `brushTip` at all, and StudioDrawNode recovers one for them
  // from the catalogue (`resolveStudioCalligraphyRenderTip`) before building the ribbon. Skipping
  // those would leave the recovered nib at its catalogue angle through every rotation while the
  // preview turned it, so the rotation is applied to the SAME tip the renderer would have used and
  // the result is persisted -- materializing what the render already assumed, at the angle the
  // gesture asked for. A brush with no nib profile still resolves to undefined and is left alone.
  // A legacy stroke's base nib depends on WHICH route renders it, and the two disagree. The
  // multi-point ribbon calls `resolveStudioCalligraphyRenderTip`, so the catalogue profile is its
  // base; the single-point TAP branch renders a hardcoded fallback instead (angle -30, roundness
  // 0.35, `StudioDrawNode` around line 1063) and never consults the catalogue. Materializing the
  // catalogue nib for a tap would rotate from the wrong base -- a fountain-pen tap would jump an
  // extra 60 degrees at commit -- so a tap materializes the fallback it actually rendered.
  const isSingleSampleTap = el.points.length <= 2;
  let brushTip = el.brushTip
    ?? (isSingleSampleTap
      ? STUDIO_LEGACY_CALLIGRAPHY_TAP_TIP
      : resolveStudioCalligraphyRenderTip(el.brush, undefined));
  if (brushTip && rotationDeg !== 0 && !hasPerSampleOrientation) {
    const rotatedAngle = brushTip.angleDeg + rotationDeg;
    if (!finite(rotatedAngle)) return null;
    // Wrapped to (-180, 180] so repeated rotations cannot drift the stored angle without bound.
    const wrapped = ((((rotatedAngle + 180) % 360) + 360) % 360) - 180;
    brushTip = { ...brushTip, angleDeg: wrapped === -180 ? 180 : wrapped };
  } else {
    // Nothing rotated, so nothing is materialized: a stroke that only moved or scaled keeps the
    // document exactly as authored rather than acquiring a tip it never stored.
    brushTip = el.brushTip;
  }

  // A dropped rotation must not publish a mutation. `commitCanvasSelectionResize` decides whether
  // anything changed by OBJECT IDENTITY, so returning a fresh element whose numbers all match the
  // input would push an undo entry, a CRDT mutation and a "resized" announcement for a gesture
  // that changed nothing -- which is exactly what a rotate-only gesture on a bounds-derived shape
  // now is. Hand back the original reference instead.
  if (
    rotationDeg !== requestedRotationDeg
    && strokeWidth === el.strokeWidth
    && brushTip === el.brushTip
    && sampleSpacing === el.sampleSpacing
    && shapeParams === el.shapeParams
    && symmetry === el.symmetry
    && points.length === el.points.length
    && points.every((value, index) => value === el.points[index])
  ) {
    return { element: el, rotationDeg, bounds };
  }

  return {
    element: {
      ...el,
      points,
      strokeWidth,
      ...(brushTip !== undefined ? { brushTip } : {}),
      ...(sampleSpacing !== undefined ? { sampleSpacing } : {}),
      ...(shapeParams !== undefined ? { shapeParams } : {}),
      ...(symmetry !== undefined ? { symmetry } : {}),
    },
    rotationDeg,
    bounds,
  };
}

/** Compatibility projection for durable callers that only need the transformed element. */
export function planStudioDrawObjectTransform(
  input: StudioDrawObjectTransformInput,
): DrawEl | null {
  return planStudioDrawObjectTransformWithBounds(input)?.element ?? null;
}
