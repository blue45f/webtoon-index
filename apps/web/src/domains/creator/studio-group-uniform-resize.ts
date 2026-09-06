/**
 * Atomic, model-aware uniform resize and rotation for a Studio group/multi-selection.
 *
 * This is deliberately narrower than a general affine transform:
 * - positive, uniform scale only -- no reflection, no non-uniform scale;
 * - rotation about the target box origin, admitted ONLY when every member can absorb it;
 * - every selected member is validated and transformed before any result is exposed.
 *
 * The frame is the same decomposition the single-stroke planner uses,
 * `translate(target) . rotate(theta) . scale . translate(-source)`, under which the source box's
 * ORIGIN maps to the target origin for every theta. That matters for the box elements: each is
 * drawn at its own `(x, y)` and rotated about that point with no Konva offset, so composing the
 * gesture angle is exactly "move the origin through the affine, add theta to the stored rotation".
 * Uniform scale commutes with rotation, which is what makes that composition exact rather than
 * approximate -- and is the reason non-uniform scale stays refused.
 *
 * Rotation is all-or-nothing across the selection. A member that cannot represent an angle -- a
 * `frame`, whose panel geometry is axis-aligned, or a bounds-derived draw shape, which the
 * renderer rebuilds from its point bounding box -- makes the WHOLE plan refuse rather than
 * silently leaving that member upright while its neighbours turn. Tearing a selection is the one
 * outcome a group planner must never produce; the single-stroke planner can afford to drop a
 * rotation because there is nothing left behind to disagree with.
 *
 * A failure returns a fresh outer array containing the original element references. Callers can
 * therefore detect an applied resize with the same reference comparison used by the group
 * translation planner, while unsupported/invalid input can never tear a mixed group.
 */
import {
  planStudioDrawObjectTransformWithBounds,
  studioDrawHasEffectivePerSampleOrientation,
  studioDrawObjectRotationIsDropped,
} from "./brush/studio-draw-object-transform";
import { SHAPE_PARAM_RANGES } from "./brush/studio-stroke-shapes";
import { BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT } from "./lettering/studio-bubble-text-fit";

import type { BubbleTailSpec } from "./lettering/studio-bubble-path";
import type { El } from "./studio-element-model";

export interface StudioGroupUniformResizeBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type StudioGroupUniformResizeStrokeWidthPolicy = "preserve" | "scale";

export interface StudioGroupUniformResizeInput {
  readonly items: readonly El[];
  readonly selectedIds: readonly string[];
  readonly sourceBounds: StudioGroupUniformResizeBounds;
  readonly targetBounds: StudioGroupUniformResizeBounds;
  /** Must include both element-level and effective parent-group locks. */
  readonly isLocked: (item: El) => boolean;
  /**
   * Object resizing normally preserves every authored draw/object stroke width. The explicit
   * `scale` option scales those widths and draw sampling cadence without changing today's default
   * semantics. Shadow, blur, filter, and other effect radii remain authored values under both
   * policies until the editor exposes a separate "scale effects" contract.
   */
  readonly strokeWidthPolicy?: StudioGroupUniformResizeStrokeWidthPolicy;
  /**
   * Clockwise degrees about the TARGET box origin, the same convention the single-stroke planner
   * and Konva's `rotation` both use. Omitted or zero keeps the pure resize contract unchanged.
   */
  readonly rotationDeg?: number;
}

const UNIFORM_SCALE_RELATIVE_EPSILON = 1e-6;
const IDENTITY_RELATIVE_EPSILON = 1e-9;
const DEFAULT_BUBBLE_FONT_SIZE = 24;
const DEFAULT_BUBBLE_TAIL_HEIGHT = 30;

function unchanged(items: readonly El[]): El[] {
  return [...items];
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function finiteNonNegative(value: number): boolean {
  return finite(value) && value >= 0;
}

function finitePositive(value: number): boolean {
  return finite(value) && value > 0;
}

function finiteOptional(value: number | undefined): boolean {
  return value === undefined || finite(value);
}

function finiteOptionalNonNegative(value: number | undefined): boolean {
  return value === undefined || finiteNonNegative(value);
}

function finiteOptionalPositive(value: number | undefined): boolean {
  return value === undefined || finitePositive(value);
}

function finiteEvenPoints(
  points: readonly number[] | undefined,
  minimumLength: number
): points is readonly number[] {
  return (
    points !== undefined &&
    points.length >= minimumLength &&
    points.length % 2 === 0 &&
    points.every(finite)
  );
}

function validOptionalPoints(
  points: readonly number[] | undefined,
  minimumLength: number
): boolean {
  return points === undefined || finiteEvenPoints(points, minimumLength);
}

function validBounds(
  bounds: StudioGroupUniformResizeBounds,
  requirePositiveSize: boolean
): boolean {
  return (
    finite(bounds.x) &&
    finite(bounds.y) &&
    (requirePositiveSize ? finitePositive(bounds.width) : finiteNonNegative(bounds.width)) &&
    (requirePositiveSize ? finitePositive(bounds.height) : finiteNonNegative(bounds.height))
  );
}

function nearlyEqual(a: number, b: number, relativeEpsilon: number): boolean {
  return Math.abs(a - b) <= relativeEpsilon * Math.max(1, Math.abs(a), Math.abs(b));
}

function validBoxGeometry(item: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}): boolean {
  return (
    finite(item.x) &&
    finite(item.y) &&
    finiteNonNegative(item.width) &&
    finiteNonNegative(item.height)
  );
}

function validExtraTail(tail: BubbleTailSpec): boolean {
  return (
    finite(tail.ratio) &&
    finiteNonNegative(tail.length) &&
    finiteNonNegative(tail.base) &&
    finiteOptional(tail.bend)
  );
}

function validDrawShapeParams(
  shapeParams: Extract<El, { type: "draw" }>["shapeParams"]
): boolean {
  return (
    shapeParams === undefined ||
    (finitePositive(shapeParams.starPoints) &&
      finiteNonNegative(shapeParams.starInnerRatio) &&
      finitePositive(shapeParams.polygonSides) &&
      finiteNonNegative(shapeParams.cornerRadius))
  );
}

function validDrawSymmetry(
  symmetry: Extract<El, { type: "draw" }>["symmetry"]
): boolean {
  return (
    symmetry === undefined ||
    (finite(symmetry.centerX) &&
      finite(symmetry.centerY) &&
      finiteOptionalNonNegative(symmetry.radialCount))
  );
}

function scaleFinite(value: number, scale: number): number | null {
  const next = value * scale;
  return finite(next) ? next : null;
}

function scaleOptionalFinite(
  value: number | undefined,
  scale: number
): number | undefined | null {
  if (value === undefined) return undefined;
  return scaleFinite(value, scale);
}

function scaleFiniteForStrokePolicy(
  value: number,
  scale: number,
  policy: StudioGroupUniformResizeStrokeWidthPolicy
): number | null {
  return policy === "scale" ? scaleFinite(value, scale) : value;
}

function scaleOptionalFiniteForStrokePolicy(
  value: number | undefined,
  scale: number,
  policy: StudioGroupUniformResizeStrokeWidthPolicy
): number | undefined | null {
  if (value === undefined) return undefined;
  return scaleFiniteForStrokePolicy(value, scale, policy);
}

/**
 * `translate(target) . rotate(theta) . scale . translate(-source)` applied to one document point.
 *
 * At theta = 0 this reduces to the original scale-and-translate exactly (cos 1, sin 0), so the
 * pure-resize path is unchanged rather than merely equivalent.
 */
function transformPosition(
  x: number,
  y: number,
  source: StudioGroupUniformResizeBounds,
  target: StudioGroupUniformResizeBounds,
  scale: number,
  cos = 1,
  sin = 0
): { x: number; y: number } | null {
  const u = (x - source.x) * scale;
  const v = (y - source.y) * scale;
  const nextX = target.x + u * cos - v * sin;
  const nextY = target.y + u * sin + v * cos;
  return finite(nextX) && finite(nextY) ? { x: nextX, y: nextY } : null;
}

/**
 * The stored angle a rotated member should carry, wrapped so repeated gestures cannot drift it.
 *
 * Konva reads this straight into `rotation`, and the payload validator has a finite range, so an
 * unwrapped sum would accumulate without bound across a long editing session.
 */
function composeRotation(rotation: number, rotationDeg: number): number | null {
  if (rotationDeg === 0) return rotation;
  const sum = rotation + rotationDeg;
  if (!finite(sum)) return null;
  const wrapped = ((((sum + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

function scalePointArray(points: readonly number[], scale: number): number[] | null {
  const next = points.map((value) => value * scale);
  return next.every(finite) ? next : null;
}

function transformDocumentPointArray(
  points: readonly number[],
  source: StudioGroupUniformResizeBounds,
  target: StudioGroupUniformResizeBounds,
  scale: number
): number[] | null {
  const next = points.map((value, index) =>
    index % 2 === 0
      ? target.x + (value - source.x) * scale
      : target.y + (value - source.y) * scale
  );
  return next.every(finite) ? next : null;
}

function transformDrawSymmetry(
  symmetry: Extract<El, { type: "draw" }>["symmetry"],
  source: StudioGroupUniformResizeBounds,
  target: StudioGroupUniformResizeBounds,
  scale: number
): Extract<El, { type: "draw" }>["symmetry"] | null {
  if (symmetry === undefined) return undefined;
  const center = transformPosition(
    symmetry.centerX,
    symmetry.centerY,
    source,
    target,
    scale
  );
  return center
    ? {
        ...symmetry,
        centerX: center.x,
        centerY: center.y,
      }
    : null;
}

function scaleDrawShapeParams(
  shapeParams: Extract<El, { type: "draw" }>["shapeParams"],
  scale: number
): Extract<El, { type: "draw" }>["shapeParams"] | null {
  if (shapeParams === undefined) return undefined;
  const scaled = scaleFinite(shapeParams.cornerRadius, scale);
  if (scaled === null) return null;
  // Clamp to what the renderer and the payload validator accept, exactly as the single-stroke
  // planner does: an unclamped 200 on a radius-100 rectangle draws as 120, shows 120 in the
  // inspector, and the next resize then compounds from the hidden 200. Keep the original
  // reference when nothing moved so a no-op gesture cannot publish a mutation.
  const cornerRadius = Math.min(
    SHAPE_PARAM_RANGES.cornerRadius.max,
    Math.max(SHAPE_PARAM_RANGES.cornerRadius.min, scaled)
  );
  return cornerRadius === shapeParams.cornerRadius
    ? shapeParams
    : { ...shapeParams, cornerRadius };
}

/**
 * Whether a member can carry a gesture angle at all. This is the ONE rule a non-zero
 * `rotationDeg` is refused from, exported so the editor offers the rotation handle only where the
 * commit could honour it:
 *
 *  - a panel frame stores no angle;
 *  - a stroke the single-stroke planner would DROP the angle for -- a bounds-derived shape that
 *    is rebuilt axis-aligned from its point bounds, or a mirrored-symmetry stroke whose copies
 *    would turn by -theta (`studioDrawObjectRotationIsDropped`);
 *  - a calligraphy stroke with effective per-sample stylus orientation. The single planner turns
 *    its points but deliberately leaves the stored tilt/twist world-fixed, so alone that is a
 *    documented limitation; beside a mouse-drawn neighbour whose nib angle composed the turn it
 *    is a tear, and the live lane already refuses such strokes for the same reason.
 *
 * Every other member either stores an angle of its own or bakes the turn into `points`.
 */
export function studioGroupUniformResizeMemberCanRotate(item: El): boolean {
  if (item.type === "frame") return false;
  if (item.type !== "draw") return true;
  return !studioDrawObjectRotationIsDropped(item) && !studioDrawHasEffectivePerSampleOrientation(item);
}

function transformElement(
  item: El,
  source: StudioGroupUniformResizeBounds,
  target: StudioGroupUniformResizeBounds,
  scale: number,
  strokeWidthPolicy: StudioGroupUniformResizeStrokeWidthPolicy,
  rotationDeg: number,
  cos: number,
  sin: number
): El | null {
  // A member that cannot carry the angle stands the WHOLE plan down: leaving it upright beside
  // turning neighbours is the tear this planner exists to prevent. The editor withholds the
  // handle from the same verdict, so this is the commit's guard rather than its common path.
  if (rotationDeg !== 0 && !studioGroupUniformResizeMemberCanRotate(item)) return null;
  if (item.type === "draw") {
    // A turning stroke is handed to the single-stroke planner rather than re-derived here.
    //
    // That planner already owns every rotation rule a DrawEl needs, and each of them was learned
    // the hard way: the calligraphy nib angle composes with the gesture only when the stroke has
    // no per-sample tilt (otherwise half the ribbon turns and half does not), a legacy tap
    // materializes the fallback tip it actually rendered rather than the catalogue one, and the
    // stored angle is wrapped so repeated gestures cannot drift it. Re-deriving that here would
    // be two copies of renderer-coupled reasoning that must never disagree -- and a group
    // rotation disagreeing with a single-stroke rotation of the same stroke is precisely the bug
    // a user would report. The bounds it works from are the SELECTION box, which is the same
    // affine this planner applies to every other member.
    if (rotationDeg !== 0) {
      const turned = planStudioDrawObjectTransformWithBounds({
        el: item,
        sourceBounds: source,
        targetBounds: target,
        rotationDeg,
        strokeWidthPolicy,
      });
      // The single-stroke planner DROPS an angle it cannot bake in (bounds-derived kinds,
      // mirrored symmetry) and reports what it applied. The guard above already refused those
      // members; this catches any drop rule that planner grows later, because a member that did
      // not turn beside neighbours that did is a tear whatever produced it.
      if (!turned || turned.rotationDeg !== rotationDeg) return null;
      return turned.element;
    }
    if (
      !finiteEvenPoints(item.points, 2) ||
      !finiteNonNegative(item.strokeWidth) ||
      !finiteOptionalNonNegative(item.sampleSpacing) ||
      !validDrawShapeParams(item.shapeParams) ||
      !validDrawSymmetry(item.symmetry)
    ) {
      return null;
    }
    const points = transformDocumentPointArray(item.points, source, target, scale);
    const strokeWidth = scaleFiniteForStrokePolicy(
      item.strokeWidth,
      scale,
      strokeWidthPolicy
    );
    const sampleSpacing = scaleOptionalFiniteForStrokePolicy(
      item.sampleSpacing,
      scale,
      strokeWidthPolicy
    );
    const shapeParams = scaleDrawShapeParams(item.shapeParams, scale);
    const symmetry = transformDrawSymmetry(
      item.symmetry,
      source,
      target,
      scale
    );
    if (
      !points ||
      strokeWidth === null ||
      sampleSpacing === null ||
      shapeParams === null ||
      symmetry === null
    ) {
      return null;
    }
    return {
      ...item,
      points,
      strokeWidth,
      ...(sampleSpacing !== undefined ? { sampleSpacing } : {}),
      ...(shapeParams !== undefined ? { shapeParams } : {}),
      ...(symmetry !== undefined ? { symmetry } : {}),
    };
  }

  if (item.type === "image") {
    if (
      !validBoxGeometry(item) ||
      !finite(item.rotation) ||
      !finiteOptional(item.skewX) ||
      !finiteOptional(item.skewY) ||
      !finiteOptionalNonNegative(item.cornerRadius)
    ) {
      return null;
    }
    const position = transformPosition(item.x, item.y, source, target, scale, cos, sin);
    const width = scaleFinite(item.width, scale);
    const height = scaleFinite(item.height, scale);
    const cornerRadius = scaleOptionalFinite(item.cornerRadius, scale);
    if (
      !position ||
      width === null ||
      height === null ||
      cornerRadius === null
    ) {
      return null;
    }
    const rotation = composeRotation(item.rotation, rotationDeg);
    if (rotation === null) return null;
    return {
      ...item,
      ...position,
      width,
      height,
      rotation,
      ...(cornerRadius !== undefined ? { cornerRadius } : {}),
    };
  }

  if (item.type === "text") {
    if (
      !finite(item.x) ||
      !finite(item.y) ||
      !finiteNonNegative(item.width) ||
      !finitePositive(item.fontSize) ||
      !finite(item.rotation) ||
      !finiteOptional(item.skewX) ||
      !finiteOptional(item.skewY) ||
      !finiteOptional(item.letterSpacing) ||
      !finiteOptionalPositive(item.lineHeight) ||
      !finiteOptionalNonNegative(item.strokeWidth)
    ) {
      return null;
    }
    const position = transformPosition(item.x, item.y, source, target, scale, cos, sin);
    const width = scaleFinite(item.width, scale);
    const fontSize = scaleFinite(item.fontSize, scale);
    const letterSpacing = scaleOptionalFinite(item.letterSpacing, scale);
    const strokeWidth = scaleOptionalFiniteForStrokePolicy(
      item.strokeWidth,
      scale,
      strokeWidthPolicy
    );
    if (
      !position ||
      width === null ||
      fontSize === null ||
      fontSize <= 0 ||
      letterSpacing === null ||
      strokeWidth === null
    ) {
      return null;
    }
    const rotation = composeRotation(item.rotation, rotationDeg);
    if (rotation === null) return null;
    return {
      ...item,
      ...position,
      width,
      fontSize,
      rotation,
      ...(letterSpacing !== undefined ? { letterSpacing } : {}),
      ...(strokeWidth !== undefined ? { strokeWidth } : {}),
    };
  }

  if (item.type === "sticker") {
    if (
      !finite(item.x) ||
      !finite(item.y) ||
      !finitePositive(item.fontSize) ||
      !finite(item.rotation) ||
      !finiteOptional(item.skewX) ||
      !finiteOptional(item.skewY)
    ) {
      return null;
    }
    const position = transformPosition(item.x, item.y, source, target, scale, cos, sin);
    const fontSize = scaleFinite(item.fontSize, scale);
    const rotation = composeRotation(item.rotation, rotationDeg);
    if (!position || fontSize === null || fontSize <= 0 || rotation === null) return null;
    return { ...item, ...position, fontSize, rotation };
  }

  if (item.type === "bubble") {
    if (
      !validBoxGeometry(item) ||
      !finite(item.rotation) ||
      !validOptionalPoints(item.customShapePoints, 6) ||
      !finiteOptionalNonNegative(item.tailHeight) ||
      !finiteOptionalNonNegative(item.tailBase) ||
      !finiteOptional(item.tailBend) ||
      !finiteOptionalPositive(item.fontSize) ||
      !finiteOptionalPositive(item.lineHeight) ||
      !finiteOptionalPositive(item.autoShrinkMinFontSize) ||
      !finiteOptionalNonNegative(item.strokeWidth) ||
      (item.extraTails !== undefined && !item.extraTails.every(validExtraTail))
    ) {
      return null;
    }
    const position = transformPosition(item.x, item.y, source, target, scale, cos, sin);
    const width = scaleFinite(item.width, scale);
    const height = scaleFinite(item.height, scale);
    const customShapePoints = item.customShapePoints
      ? scalePointArray(item.customShapePoints, scale)
      : undefined;
    const changesScale = !nearlyEqual(
      scale,
      1,
      IDENTITY_RELATIVE_EPSILON
    );
    const materializedFontSize =
      item.fontSize ??
      (changesScale ? DEFAULT_BUBBLE_FONT_SIZE : undefined);
    const fontSize = scaleOptionalFinite(materializedFontSize, scale);
    const materializedAutoShrinkMinFontSize =
      item.autoShrinkMinFontSize ??
      (changesScale && item.autoShrinkText
        ? BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT
        : undefined);
    const autoShrinkMinFontSize = scaleOptionalFinite(
      materializedAutoShrinkMinFontSize,
      scale
    );
    const materializedTailHeight =
      item.tailHeight ??
      (changesScale &&
      item.customShapePoints === undefined &&
      item.tail !== "none"
        ? DEFAULT_BUBBLE_TAIL_HEIGHT
        : undefined);
    const tailHeight = scaleOptionalFinite(materializedTailHeight, scale);
    const tailBase = scaleOptionalFinite(item.tailBase, scale);
    const strokeWidth = scaleOptionalFiniteForStrokePolicy(
      item.strokeWidth,
      scale,
      strokeWidthPolicy
    );
    const extraTails = item.extraTails?.map((tail) => ({
      ...tail,
      length: tail.length * scale,
      base: tail.base * scale,
    }));
    if (
      !position ||
      width === null ||
      height === null ||
      customShapePoints === null ||
      fontSize === null ||
      autoShrinkMinFontSize === null ||
      tailHeight === null ||
      tailBase === null ||
      strokeWidth === null ||
      (extraTails !== undefined &&
        extraTails.some((tail) => !finite(tail.length) || !finite(tail.base)))
    ) {
      return null;
    }
    const rotation = composeRotation(item.rotation, rotationDeg);
    if (rotation === null) return null;
    return {
      ...item,
      ...position,
      width,
      height,
      rotation,
      ...(customShapePoints ? { customShapePoints } : {}),
      ...(fontSize !== undefined ? { fontSize } : {}),
      ...(autoShrinkMinFontSize !== undefined
        ? { autoShrinkMinFontSize }
        : {}),
      ...(tailHeight !== undefined ? { tailHeight } : {}),
      ...(tailBase !== undefined ? { tailBase } : {}),
      ...(strokeWidth !== undefined ? { strokeWidth } : {}),
      ...(extraTails ? { extraTails } : {}),
    };
  }

  if (item.type === "frame") {
    // A frame is the panel itself: axis-aligned box geometry plus an optional axis-aligned
    // `points` polygon, and no stored angle anywhere to put theta into. Turning one is not
    // representable, which is why `studioGroupUniformResizeMemberCanRotate` refuses it above.
    if (
      !validBoxGeometry(item) ||
      !validOptionalPoints(item.points, 6) ||
      !finiteOptionalNonNegative(item.strokeWidth)
    ) {
      return null;
    }
    const position = transformPosition(item.x, item.y, source, target, scale, cos, sin);
    const width = scaleFinite(item.width, scale);
    const height = scaleFinite(item.height, scale);
    const points = item.points ? scalePointArray(item.points, scale) : undefined;
    const strokeWidth = scaleOptionalFiniteForStrokePolicy(
      item.strokeWidth,
      scale,
      strokeWidthPolicy
    );
    if (
      !position ||
      width === null ||
      height === null ||
      points === null ||
      strokeWidth === null
    ) {
      return null;
    }
    return {
      ...item,
      ...position,
      width,
      height,
      ...(points ? { points } : {}),
      ...(strokeWidth !== undefined ? { strokeWidth } : {}),
    };
  }

  if (item.type === "focusLines") {
    if (
      !validBoxGeometry(item) ||
      !finite(item.rotation) ||
      !finiteNonNegative(item.innerRadius) ||
      !finiteNonNegative(item.outerRadius) ||
      !finiteNonNegative(item.strokeWidth) ||
      !finiteNonNegative(item.noise)
    ) {
      return null;
    }
    const position = transformPosition(item.x, item.y, source, target, scale, cos, sin);
    const width = scaleFinite(item.width, scale);
    const height = scaleFinite(item.height, scale);
    const innerRadius = scaleFinite(item.innerRadius, scale);
    const outerRadius = scaleFinite(item.outerRadius, scale);
    const strokeWidth = scaleFiniteForStrokePolicy(
      item.strokeWidth,
      scale,
      strokeWidthPolicy
    );
    const noise = scaleFinite(item.noise, scale);
    if (
      !position ||
      width === null ||
      height === null ||
      innerRadius === null ||
      outerRadius === null ||
      strokeWidth === null ||
      noise === null
    ) {
      return null;
    }
    const rotation = composeRotation(item.rotation, rotationDeg);
    if (rotation === null) return null;
    return {
      ...item,
      ...position,
      width,
      height,
      rotation,
      innerRadius,
      outerRadius,
      strokeWidth,
      noise,
    };
  }

  if (item.type === "speedLines") {
    if (
      !validBoxGeometry(item) ||
      !finite(item.rotation) ||
      !finiteNonNegative(item.strokeWidth) ||
      !finiteOptionalNonNegative(item.noise)
    ) {
      return null;
    }
    const position = transformPosition(item.x, item.y, source, target, scale, cos, sin);
    const width = scaleFinite(item.width, scale);
    const height = scaleFinite(item.height, scale);
    const strokeWidth = scaleFiniteForStrokePolicy(
      item.strokeWidth,
      scale,
      strokeWidthPolicy
    );
    const noise = scaleOptionalFinite(item.noise, scale);
    if (
      !position ||
      width === null ||
      height === null ||
      strokeWidth === null ||
      noise === null
    ) {
      return null;
    }
    const rotation = composeRotation(item.rotation, rotationDeg);
    if (rotation === null) return null;
    return {
      ...item,
      ...position,
      width,
      height,
      rotation,
      strokeWidth,
      ...(noise !== undefined ? { noise } : {}),
    };
  }

  return null;
}

/**
 * The transformed SELECTION only, in document order, or `null` where the plan is refused.
 *
 * Split out of `planStudioGroupUniformResize` so a per-frame live preview can show what the commit
 * will produce without allocating a whole-document array sixty times a second. The full planner is
 * defined in terms of this function rather than beside it: the preview and the commit must not be
 * able to answer differently about uniformity, locking, identity frames or a refused element, and
 * two copies of these rules would eventually do exactly that.
 *
 * `null` means "leave the document untouched" -- the same all-or-nothing verdict the full planner
 * expresses by returning its input unchanged.
 */
export function planStudioGroupUniformResizeSelection(
  input: StudioGroupUniformResizeInput
): El[] | null {
  const strokeWidthPolicy = input.strokeWidthPolicy ?? "preserve";
  if (strokeWidthPolicy !== "preserve" && strokeWidthPolicy !== "scale") return null;
  if (
    !validBounds(input.sourceBounds, true) ||
    !validBounds(input.targetBounds, true)
  ) {
    return null;
  }

  const requestedIds = new Set(input.selectedIds);
  if (requestedIds.size === 0) return null;
  const selectedItems = input.items.filter((item) => requestedIds.has(item.id));
  if (selectedItems.length !== requestedIds.size) return null;

  try {
    if (selectedItems.some(input.isLocked)) return null;
  } catch {
    return null;
  }

  const scaleX = input.targetBounds.width / input.sourceBounds.width;
  const scaleY = input.targetBounds.height / input.sourceBounds.height;
  if (!finitePositive(scaleX) || !finitePositive(scaleY)) return null;
  if (!nearlyEqual(scaleX, scaleY, UNIFORM_SCALE_RELATIVE_EPSILON)) return null;
  const scale = (scaleX + scaleY) / 2;
  const rotationDeg = input.rotationDeg ?? 0;
  if (!finite(rotationDeg)) return null;
  if (
    rotationDeg === 0 &&
    nearlyEqual(scale, 1, IDENTITY_RELATIVE_EPSILON) &&
    nearlyEqual(input.sourceBounds.x, input.targetBounds.x, IDENTITY_RELATIVE_EPSILON) &&
    nearlyEqual(input.sourceBounds.y, input.targetBounds.y, IDENTITY_RELATIVE_EPSILON)
  ) {
    return null;
  }

  const radians = (rotationDeg * Math.PI) / 180;
  // Exact at theta = 0 rather than merely close, so the pure-resize path keeps producing the
  // numbers it always did instead of ones a cosine happened to round back.
  const cos = rotationDeg === 0 ? 1 : Math.cos(radians);
  const sin = rotationDeg === 0 ? 0 : Math.sin(radians);

  const transformed: El[] = [];
  for (const item of selectedItems) {
    const next = transformElement(
      item,
      input.sourceBounds,
      input.targetBounds,
      scale,
      strokeWidthPolicy,
      rotationDeg,
      cos,
      sin
    );
    if (!next) return null;
    transformed.push(next);
  }
  return transformed;
}

/**
 * Plan one atomic positive uniform resize, optionally with a rigid rotation, over the document.
 *
 * The output always preserves document order. A successful plan replaces every selected element
 * with a transformed immutable copy and keeps the original reference for every unselected one;
 * every refusal -- including a member that cannot carry the requested angle -- returns a fresh
 * array holding only original element references.
 */
export function planStudioGroupUniformResize(
  input: StudioGroupUniformResizeInput
): El[] {
  const transformed = planStudioGroupUniformResizeSelection(input);
  if (!transformed) return unchanged(input.items);
  const transformedById = new Map(transformed.map((item) => [item.id, item]));
  return input.items.map((item) => transformedById.get(item.id) ?? item);
}
