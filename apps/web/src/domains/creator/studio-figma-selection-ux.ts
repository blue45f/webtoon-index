/**
 * Figma-inspired selection geometry + view helpers (pure).
 *
 * Product copy stays Korean; the algorithm mirrors Figma's "zoom to selection",
 * Design-panel layout metrics, and flip-around-selection-center behavior without
 * cloning Figma's branding.
 */

import {
  planStudioDrawObjectTransform,
  studioDrawObjectRotationIsDropped,
  studioDrawSymmetryIsMirrored,
} from "./brush/studio-draw-object-transform";
import { elBounds, type StudioElementBounds } from "./studio-element-geometry";
import {
  normalizeStudioViewRotation,
  planStudioViewScrollToDocumentPoint,
  STUDIO_VIEW_ZOOM_MAX,
  STUDIO_VIEW_ZOOM_MIN,
  type StudioViewRotation,
} from "./studio-view-controls";

import type { DrawEl, El } from "./studio-element-model";

/** Design-panel edit: only the fields the creator actually typed into. */
export interface StudioFigmaSelectionLayoutPatch {
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly rotation?: number;
  readonly opacity?: number;
}

export interface StudioFigmaSelectionLayoutMetrics {
  /** Stable identity for clearing an uncommitted number when selection changes. */
  readonly selectionKey: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly opacity: number;
  readonly opacityMixed: boolean;
  readonly hasFixedSize: boolean;
  readonly supportsWidth: boolean;
  readonly supportsHeight: boolean;
  readonly supportsOpacity: boolean;
  readonly supportsRotation: boolean;
  /**
   * True when the rotation field means "turn it this much more", not "sit at this angle".
   *
   * A stroke bakes its transform into `points` (see `studio-draw-object-transform`), so there is
   * no stored angle to display or to type an absolute value against. Inventing one would mean
   * adding a rotation field to `DrawEl` — a different authoring model, and one that would
   * re-rasterize ink through a Konva node transform instead of re-rendering the vector path.
   * Photoshop's free-transform angle box behaves exactly this way for the same reason.
   */
  readonly rotationIsRelative: boolean;
  /** Why W/H is inert, for the field's tooltip. Null when the field is live. */
  readonly sizeDisabledReason: string | null;
  readonly widthDisabledReason: string | null;
  readonly heightDisabledReason: string | null;
  /** Why rotation is inert, for the field's tooltip. Null when the field is live. */
  readonly rotationDisabledReason: string | null;
  readonly elementCount: number;
}

/**
 * Shape strokes (`rect`/`ellipse`/`star`/`triangle`/`polygon`) are rendered from the axis-aligned
 * box of their first two points (`drawBounds` in `StudioDrawNode`), so baking an angle into those
 * points would only move the box corners — the shape would resize, never turn. Freehand, `line`
 * and `arrow` keep their geometry in the raw point array, so rotation is exact for them.
 *
 * A mirrored-symmetry stroke is excluded for a second reason, and it must be checked against the
 * planner's own rule rather than re-derived: `planStudioDrawObjectTransform` DROPS the angle for
 * those (`studioDrawObjectRotationIsDropped`), because the renderer regenerates the copies by
 * reflecting the committed base about world axes and a reflection turns them by −θ. Offering the
 * field anyway would not merely no-op — the numeric path rotates the box about its own centre to
 * turn the planner's origin rotation into a centre rotation, so a dropped angle leaves that pivot
 * offset behind and the stroke TRANSLATES instead of turning.
 */
function studioDrawRotationSupported(element: DrawEl): boolean {
  const kind = element.kind ?? "freehand";
  if (kind !== "freehand" && kind !== "line" && kind !== "arrow") return false;
  return !studioDrawObjectRotationIsDropped(element);
}

/** Element kinds whose model accepts an optional stored angle even when the key is absent at 0°. */
function studioStoredRotationSupported(element: El): boolean {
  return element.type === "image"
    || element.type === "text"
    || element.type === "bubble"
    || element.type === "sticker"
    || element.type === "focusLines"
    || element.type === "speedLines";
}

export function unionStudioSelectionBounds(
  elements: readonly El[],
): StudioElementBounds | null {
  if (elements.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const element of elements) {
    const box = elBounds(element);
    // Flat freehand lines need a non-zero visual pad for zoom/flip pivots.
    const pad =
      element.type === "draw"
        ? Math.max(1, Number(element.strokeWidth) > 0 ? element.strokeWidth / 2 : 1)
        : 0;
    // Pad symmetrically. Flooring the far edge at pad*2 would push the box off-centre on a
    // degenerate axis, and the flip pivot would walk a flat stroke sideways on every press.
    const x0 = box.x - pad;
    const y0 = box.y - pad;
    const x1 = box.x + box.w + pad;
    const y1 = box.y + box.h + pad;
    minX = Math.min(minX, x0);
    minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x1);
    maxY = Math.max(maxY, y1);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return {
    x: minX,
    y: minY,
    w: Math.max(1, maxX - minX),
    h: Math.max(1, maxY - minY),
  };
}

/**
 * The elements a Design panel edits: the marquee set when present, else the single selection.
 * Keeps the inspector leaf free of selection-shape branching.
 */
export function selectStudioFigmaDesignTargets(
  elements: readonly El[],
  marqueeIds: readonly string[],
  selected: El | null,
): El[] {
  if (marqueeIds.length > 0) {
    const ids = new Set(marqueeIds);
    return elements.filter((element) => ids.has(element.id));
  }
  return selected ? [selected] : [];
}

export function resolveStudioFigmaSelectionLayoutMetrics(
  elements: readonly El[],
): StudioFigmaSelectionLayoutMetrics | null {
  const bounds = unionStudioSelectionBounds(elements);
  if (!bounds) return null;
  const single = elements.length === 1 ? elements[0]! : null;
  const rotation =
    single && "rotation" in single && typeof single.rotation === "number"
      ? single.rotation
      : 0;
  const opacityValues = elements.map((element) =>
    typeof element.opacity === "number" && Number.isFinite(element.opacity)
      ? Math.min(1, Math.max(0, element.opacity))
      : 1,
  );
  const opacity = opacityValues[0] ?? 1;
  const opacityMixed = opacityValues.some((value) => Math.abs(value - opacity) > 1e-6);
  // A stroke has no width/height field, but it does have a size: the handles already scale one
  // by baking the target box into `points`. The numeric path calls that same planner, so gating
  // W/H on the presence of a stored field would disable a capability the object demonstrably has.
  const supportsWidth = Boolean(single && (single.type === "draw" || "width" in single));
  const supportsHeight = Boolean(single && (single.type === "draw" || "height" in single));
  const hasFixedSize = supportsWidth && supportsHeight;
  const supportsRotation = Boolean(
    single
    && (single.type === "draw"
      ? studioDrawRotationSupported(single)
      : studioStoredRotationSupported(single)),
  );
  const multi = elements.length > 1;
  return {
    selectionKey: elements.map((element) => element.id).join("\u001f"),
    x: roundLayout(bounds.x),
    y: roundLayout(bounds.y),
    width: roundLayout(bounds.w),
    height: roundLayout(bounds.h),
    rotation: roundLayout(rotation),
    opacity,
    opacityMixed,
    hasFixedSize,
    supportsWidth,
    supportsHeight,
    // Frames are the one type whose renderer ignores opacity. Mixed selections remain editable
    // only when every target shares the property; otherwise the field explains why it is inert.
    supportsOpacity: elements.length > 0 && elements.every((element) => element.type !== "frame"),
    supportsRotation,
    rotationIsRelative: single?.type === "draw",
    sizeDisabledReason: hasFixedSize
      ? null
      : multi
        ? "여러 개를 선택하면 크기는 하나씩만 입력할 수 있어요."
        : "이 요소는 크기를 숫자로 지정할 수 없어요.",
    widthDisabledReason: supportsWidth
      ? null
      : multi
        ? "여러 개의 전체 너비는 캔버스 핸들로 조절해 주세요."
        : "이 요소는 너비를 숫자로 지정할 수 없어요.",
    heightDisabledReason: supportsHeight
      ? null
      : multi
        ? "여러 개의 전체 높이는 캔버스 핸들로 조절해 주세요."
        : "이 요소는 높이를 숫자로 지정할 수 없어요.",
    rotationDisabledReason: supportsRotation
      ? null
      : multi
        ? "여러 개를 선택하면 회전은 하나씩만 입력할 수 있어요."
        : single?.type === "draw"
          ? studioDrawSymmetryIsMirrored(single.symmetry)
            ? "좌우·상하·만화경 대칭 획은 사본이 월드 축을 기준으로 다시 비치기 때문에 함께 돌릴 수 없어요. 대칭을 끄면 회전할 수 있어요."
            : "사각형·원·별·다각형 도형은 축에 정렬된 상자로 그려져서 각도를 가질 수 없어요. 자유곡선·직선·화살표는 회전할 수 있어요."
          : "이 요소는 회전을 지원하지 않아요.",
    elementCount: elements.length,
  };
}

function roundLayout(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface StudioZoomToSelectionInput {
  readonly bounds: StudioElementBounds;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly canvasFlipH?: boolean;
  readonly canvasRotation?: number;
  /** 0–0.4 of viewport reserved as margin (Figma-like breathing room). */
  readonly paddingRatio?: number;
  readonly maxScale?: number;
  readonly minScale?: number;
}

export interface StudioZoomToSelectionPlan {
  readonly scale: number;
  readonly zoom: 1;
  readonly scrollLeft: number;
  readonly scrollTop: number;
  readonly centerX: number;
  readonly centerY: number;
}

/**
 * Zoom the viewport so the selection fills most of the screen (Figma Shift+2).
 * Returns null when the bounds/viewport are unusable.
 */
export function planStudioZoomToSelection(
  input: StudioZoomToSelectionInput,
): StudioZoomToSelectionPlan | null {
  const viewportWidth = finitePositive(input.viewportWidth);
  const viewportHeight = finitePositive(input.viewportHeight);
  const boundsW = Math.max(1, finitePositive(input.bounds.w, 1));
  const boundsH = Math.max(1, finitePositive(input.bounds.h, 1));
  if (viewportWidth <= 0 || viewportHeight <= 0) return null;

  const padding = clamp(input.paddingRatio ?? 0.14, 0, 0.4);
  const usableW = viewportWidth * (1 - padding);
  const usableH = viewportHeight * (1 - padding);
  // A quarter-turned view transposes the stage box (planStudioViewStageLayout), so a w×h
  // document AABB occupies h×w on screen and must be fitted that way.
  const quarterTurned = normalizeStudioViewRotation(input.canvasRotation ?? 0) % 180 !== 0;
  const fitW = quarterTurned ? boundsH : boundsW;
  const fitH = quarterTurned ? boundsW : boundsH;
  const rawScale = Math.min(usableW / fitW, usableH / fitH);
  const maxScale = finitePositive(input.maxScale ?? STUDIO_VIEW_ZOOM_MAX, STUDIO_VIEW_ZOOM_MAX);
  const minScale = finitePositive(input.minScale ?? STUDIO_VIEW_ZOOM_MIN, STUDIO_VIEW_ZOOM_MIN);
  const scale = clamp(rawScale, minScale, maxScale);
  const centerX = input.bounds.x + input.bounds.w / 2;
  const centerY = input.bounds.y + input.bounds.h / 2;
  const scroll = planStudioViewScrollToDocumentPoint({
    documentWidth: input.documentWidth,
    documentHeight: input.documentHeight,
    canvasFlipH: input.canvasFlipH === true,
    canvasRotation: input.canvasRotation as StudioViewRotation | undefined,
    scale,
    viewportWidth,
    viewportHeight,
    x: centerX,
    y: centerY,
  });
  return {
    scale,
    zoom: 1,
    scrollLeft: scroll.scrollLeft,
    scrollTop: scroll.scrollTop,
    centerX,
    centerY,
  };
}

export type StudioSelectionFlipAxis = "horizontal" | "vertical";

/**
 * Mirror element transforms around the selection AABB center (Figma Flip).
 * Draw strokes flip point coordinates; positioned elements flip origin + optional flip flags.
 *
 * Elements that cannot mirror (no flip flag, and already centred on the axis — e.g. a lone
 * text block) are returned by reference so callers can tell a real flip from a no-op and skip
 * the history entry.
 */
export function planStudioSelectionFlip(
  elements: readonly El[],
  selectedIds: readonly string[],
  axis: StudioSelectionFlipAxis,
): El[] | null {
  const selected = new Set(selectedIds);
  const targets = elements.filter((element) => selected.has(element.id));
  if (targets.length === 0) return null;
  const bounds = unionStudioSelectionBounds(targets);
  if (!bounds) return null;
  const centerX = bounds.x + bounds.w / 2;
  const centerY = bounds.y + bounds.h / 2;

  return elements.map((element) => {
    if (!selected.has(element.id)) return element;
    if (element.type === "draw") {
      const points = element.points.map((value, index) => {
        if (axis === "horizontal" && index % 2 === 0) {
          return centerX * 2 - value;
        }
        if (axis === "vertical" && index % 2 === 1) {
          return centerY * 2 - value;
        }
        return value;
      });
      // Mirroring only the points would leave the pen's direction channels pointing the old
      // way, so a calligraphy nib would thicken on the wrong side of the mirrored stroke.
      return {
        ...element,
        points,
        ...(axis === "horizontal" && element.tiltXs
          ? { tiltXs: element.tiltXs.map(negateFinite) }
          : {}),
        ...(axis === "vertical" && element.tiltYs
          ? { tiltYs: element.tiltYs.map(negateFinite) }
          : {}),
        ...(element.twists ? { twists: element.twists.map(negateFinite) } : {}),
        ...(element.brushTip
          ? { brushTip: { ...element.brushTip, angleDeg: negateFinite(element.brushTip.angleDeg) } }
          : {}),
      } as El;
    }
    if (!("x" in element) || !("y" in element)) return element;
    const box = elBounds(element);
    const mirrorable = element.type === "image";
    // The flip flags mirror the bitmap in its own local space, so rotation and skew — which
    // Konva applies on top of that — have to reverse too or the result is off by 2θ.
    const mirroredTransform = mirrorable
      ? {
          rotation: negateFinite(element.rotation),
          ...(typeof element.skewX === "number" ? { skewX: negateFinite(element.skewX) } : {}),
          ...(typeof element.skewY === "number" ? { skewY: negateFinite(element.skewY) } : {}),
        }
      : {};
    if (axis === "horizontal") {
      const nextX = centerX * 2 - (box.x + box.w);
      if (!mirrorable && nextX === element.x) return element;
      return {
        ...element,
        x: nextX,
        ...mirroredTransform,
        ...(mirrorable
          ? { flipped: !(element as { flipped?: boolean }).flipped }
          : {}),
      } as El;
    }
    const nextY = centerY * 2 - (box.y + box.h);
    if (!mirrorable && nextY === element.y) return element;
    return {
      ...element,
      y: nextY,
      ...mirroredTransform,
      ...(mirrorable
        ? { flippedY: !(element as { flippedY?: boolean }).flippedY }
        : {}),
    } as El;
  });
}

/**
 * Apply Design-panel position/size numbers (Figma X/Y/W/H) onto one element.
 * Multi-selection should only call this for single targets.
 */
export function planStudioSelectionLayoutPatch(
  element: El,
  patch: StudioFigmaSelectionLayoutPatch,
): Partial<El> | null {
  const next: Record<string, unknown> = {};

  if (
    typeof patch.opacity === "number"
    && Number.isFinite(patch.opacity)
    && element.type !== "frame"
  ) {
    const opacity = Math.min(1, Math.max(0, patch.opacity));
    const currentOpacity =
      typeof element.opacity === "number" && Number.isFinite(element.opacity)
        ? Math.min(1, Math.max(0, element.opacity))
        : 1;
    if (Math.abs(opacity - currentOpacity) > 1e-6) next.opacity = opacity;
  }
  if (
    typeof patch.rotation === "number"
    && Number.isFinite(patch.rotation)
    && element.type !== "draw"
    && studioStoredRotationSupported(element)
  ) {
    next.rotation = patch.rotation;
  }

  if (element.type === "draw") {
    const geometry = planStudioDrawLayoutGeometry(element, patch);
    if (geometry) Object.assign(next, geometry);
    return Object.keys(next).length > 0 ? (next as Partial<El>) : null;
  }

  if (typeof patch.x === "number" && Number.isFinite(patch.x) && "x" in element) {
    next.x = patch.x;
  }
  if (typeof patch.y === "number" && Number.isFinite(patch.y) && "y" in element) {
    next.y = patch.y;
  }
  if (
    typeof patch.width === "number"
    && Number.isFinite(patch.width)
    && patch.width > 0
    && "width" in element
  ) {
    next.width = patch.width;
  }
  if (
    typeof patch.height === "number"
    && Number.isFinite(patch.height)
    && patch.height > 0
    && "height" in element
  ) {
    next.height = patch.height;
  }

  return Object.keys(next).length > 0 ? (next as Partial<El>) : null;
}

/**
 * Applies the common multi-selection fields exposed by the Inspector in one durable commit.
 * X/Y move the union box without collapsing relative spacing; opacity is shared by every
 * compatible target. Group resize/rotation remain canvas-handle operations until their exact
 * transform planner can be reused here.
 */
export function planStudioMultiSelectionLayoutPatch(
  elements: readonly El[],
  selectedIds: readonly string[],
  patch: StudioFigmaSelectionLayoutPatch,
): El[] | null {
  const selected = new Set(selectedIds);
  const targets = elements.filter((element) => selected.has(element.id));
  if (targets.length < 2) return null;
  const bounds = unionStudioSelectionBounds(targets);
  if (!bounds) return null;

  const dx = typeof patch.x === "number" && Number.isFinite(patch.x)
    ? patch.x - bounds.x
    : 0;
  const dy = typeof patch.y === "number" && Number.isFinite(patch.y)
    ? patch.y - bounds.y
    : 0;
  let changed = false;
  const next = elements.map((element) => {
    if (!selected.has(element.id)) return element;
    // Use the same visual (stroke-padded) box the numeric panel displays. `elBounds`
    // alone would move freehand ink by half its stroke width on a group edit.
    const box = unionStudioSelectionBounds([element]);
    if (!box) return element;
    const targetPatch: StudioFigmaSelectionLayoutPatch = {
      ...(dx !== 0 ? { x: box.x + dx } : {}),
      ...(dy !== 0 ? { y: box.y + dy } : {}),
      ...(typeof patch.opacity === "number" ? { opacity: patch.opacity } : {}),
    };
    const planned = planStudioSelectionLayoutPatch(element, targetPatch);
    if (!planned) return element;
    changed = true;
    return { ...element, ...planned } as El;
  });
  return changed ? next : null;
}

/** How close the fixed-point solve below has to land before it stops refining. Document px. */
const DRAW_LAYOUT_SOLVE_TOLERANCE = 1e-4;
const DRAW_LAYOUT_SOLVE_MAX_STEPS = 6;

function finiteNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Turns one Design-panel X/Y/W/H/rotation edit on a stroke into a geometry patch.
 *
 * The numeric path deliberately owns no transform maths of its own: it resolves a target box and
 * hands it to `planStudioDrawObjectTransform`, the same planner the on-canvas resize/rotate
 * handles commit through (`commitCanvasSelectionResize` in `StudioPage`). Typing 150 into W and
 * dragging the handle to 150 therefore produce byte-identical points, stroke width and shape
 * params — there is one bake, not two.
 *
 * Conventions, both chosen to match what the artist is already looking at:
 *  - the box is the *padded* stroke box the panel displays (`unionStudioSelectionBounds`), which
 *    is also the box the selection handles draw, so a typed number and a dragged handle refer to
 *    the same edge;
 *  - W/H scale from the top-left, exactly like the W/H fields on an image in this same panel;
 *  - rotation turns about the box centre, exactly like the rotate handle.
 */
function planStudioDrawLayoutGeometry(
  element: DrawEl,
  patch: StudioFigmaSelectionLayoutPatch,
): Record<string, unknown> | null {
  const shown = unionStudioSelectionBounds([element]);
  if (!shown || shown.w <= 0 || shown.h <= 0) return null;

  const widthTyped = finiteNumber(patch.width) && patch.width > 0;
  const heightTyped = finiteNumber(patch.height) && patch.height > 0;
  let goalW = widthTyped ? patch.width! : shown.w;
  let goalH = heightTyped ? patch.height! : shown.h;
  // The Transformer keeps the ratio for aspect-locked elements (`keepRatio` in the viewport), so
  // the numeric path has to honour the same lock or the two would disagree on the same object.
  if (element.lockAspect && widthTyped !== heightTyped) {
    if (widthTyped) goalH = shown.h * (goalW / shown.w);
    else goalW = shown.w * (goalH / shown.h);
  }
  const goalX = finiteNumber(patch.x) ? patch.x : shown.x;
  const goalY = finiteNumber(patch.y) ? patch.y : shown.y;

  // Relative, not absolute: the field always reads 0 because a stroke stores no angle. See
  // `rotationIsRelative`.
  const rotationDeg =
    finiteNumber(patch.rotation) && studioDrawRotationSupported(element)
      ? normalizeSignedDegrees(patch.rotation)
      : 0;

  const moved =
    Math.abs(goalX - shown.x) > DRAW_LAYOUT_SOLVE_TOLERANCE
    || Math.abs(goalY - shown.y) > DRAW_LAYOUT_SOLVE_TOLERANCE;
  const resized =
    Math.abs(goalW - shown.w) > DRAW_LAYOUT_SOLVE_TOLERANCE
    || Math.abs(goalH - shown.h) > DRAW_LAYOUT_SOLVE_TOLERANCE;
  if (!moved && !resized && rotationDeg === 0) return null;

  const source = { x: shown.x, y: shown.y, width: shown.w, height: shown.h };
  const bake = (target: { x: number; y: number; width: number; height: number }) =>
    planStudioDrawObjectTransform({
      el: element,
      sourceBounds: source,
      // The planner rotates about the target box origin, so rotating the *unrotated* box about
      // its own centre first turns the whole thing into a centre rotation — which is what the
      // rotate handle does, and what "기울이기 15°" means to an artist.
      targetBounds: rotateBoxOriginAboutCentre(target, rotationDeg),
      rotationDeg,
    });

  let target = { x: goalX, y: goalY, width: goalW, height: goalH };
  let result = bake(target);
  if (!result) return null;

  // The displayed box is the point box grown by half a stroke width, and the planner scales the
  // width by the geometric mean of the axis factors. Those agree exactly for a uniform scale, so
  // one pass already lands the typed number; a lopsided W-only edit leaves a sub-percent residue.
  // Re-solving against the measured result — through the same planner, so no second formula
  // exists — makes "make both panels 480 wide" land on 480 either way. Rotation is skipped
  // because a turned stroke's axis-aligned box is not the box that was typed.
  if (rotationDeg === 0) {
    for (let step = 0; step < DRAW_LAYOUT_SOLVE_MAX_STEPS; step += 1) {
      const got = unionStudioSelectionBounds([result]);
      if (!got) break;
      const errorX = goalX - got.x;
      const errorY = goalY - got.y;
      const errorW = goalW - got.w;
      const errorH = goalH - got.h;
      if (
        Math.abs(errorX) <= DRAW_LAYOUT_SOLVE_TOLERANCE
        && Math.abs(errorY) <= DRAW_LAYOUT_SOLVE_TOLERANCE
        && Math.abs(errorW) <= DRAW_LAYOUT_SOLVE_TOLERANCE
        && Math.abs(errorH) <= DRAW_LAYOUT_SOLVE_TOLERANCE
      ) {
        break;
      }
      const nextTarget = {
        x: target.x + errorX,
        y: target.y + errorY,
        width: target.width + errorW,
        height: target.height + errorH,
      };
      if (nextTarget.width <= 0 || nextTarget.height <= 0) break;
      const refined = bake(nextTarget);
      if (!refined) break;
      target = nextTarget;
      result = refined;
    }
  }

  // Only the keys the transform actually moved. Handing back the whole element — or a rebuilt
  // sub-object holding identical numbers — would make untouched fields look changed to the CRDT
  // diff and to the revision compare view.
  const geometry: Record<string, unknown> = { points: result.points };
  if (result.strokeWidth !== element.strokeWidth) geometry.strokeWidth = result.strokeWidth;
  if (result.sampleSpacing !== element.sampleSpacing) {
    geometry.sampleSpacing = result.sampleSpacing;
  }
  if (result.shapeParams?.cornerRadius !== element.shapeParams?.cornerRadius) {
    geometry.shapeParams = result.shapeParams;
  }
  if (
    result.symmetry?.centerX !== element.symmetry?.centerX
    || result.symmetry?.centerY !== element.symmetry?.centerY
  ) {
    geometry.symmetry = result.symmetry;
  }
  return geometry;
}

/**
 * Where the top-left corner of `box` ends up after the box turns `degrees` about its own centre.
 * Feeding that origin to `planStudioDrawObjectTransform` converts its origin rotation into a
 * centre rotation without the planner needing to know about pivots.
 */
function rotateBoxOriginAboutCentre(
  box: { x: number; y: number; width: number; height: number },
  degrees: number,
): { x: number; y: number; width: number; height: number } {
  if (degrees === 0) return box;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const halfW = box.width / 2;
  const halfH = box.height / 2;
  return {
    x: box.x + halfW - halfW * cos + halfH * sin,
    y: box.y + halfH - halfW * sin - halfH * cos,
    width: box.width,
    height: box.height,
  };
}

/** Folds full turns away so typing 360 is the no-op it looks like. */
function normalizeSignedDegrees(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped === 0 ? 0 : wrapped;
}

/** A mirror reverses the sense of every angle/tilt channel; non-finite entries stay as they are. */
function negateFinite(value: number): number {
  return Number.isFinite(value) ? -value : value;
}

function finitePositive(value: number, fallback = 0): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
