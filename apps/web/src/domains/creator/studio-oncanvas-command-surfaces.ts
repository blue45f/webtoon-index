/**
 * On-canvas command surfaces — the placement contract behind V5 §15 "포인터 거리".
 *
 * The V5 acceptance row reads `브러시 HUD 80px, 선택 명령 180px, 레이어 행 동작
 * 120px 이내 목표 / 손·팝업 가림 자동 회피`. The 2026-08-08 audit measured all ten
 * budget items from the canvas visible centre and failed 10/10, the nearest
 * interactive control of any kind sitting 388px away
 * (`tests/benchmarks/results/ux-audit.json`). Nothing lived within reach because
 * every command was pinned to screen-edge chrome.
 *
 * The three budgets are **anchor-relative**, and that is the only reading under
 * which "레이어 행 동작 120px" means anything at all — a layer row is never near
 * the canvas centre:
 *
 * - `brushHud` — measured from the pointer (the cursor is the anchor).
 * - `selectionCommand` — measured from the selection's bounding box.
 * - `layerRowAction` — measured from the layer row's own centre.
 *
 * This module is **pure geometry**: no React, no DOM ownership, no store. It is
 * what both the shipped surfaces and the distance regression gate
 * (`tests/benchmarks/harness/ux-pointer-distance.ts`) agree on, so a placement
 * change that breaks a budget breaks a unit test before it reaches a browser.
 */

import {
  projectStudioDocumentPointToView,
  type StudioViewRotation,
} from "./studio-view-controls";

/* ------------------------------------------------------------------ types */

export interface StudioSurfacePoint {
  readonly x: number;
  readonly y: number;
}

export interface StudioSurfaceRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Pointer-distance ceilings, in CSS px, exactly as V5 §15 states them. */
export const STUDIO_POINTER_DISTANCE_BUDGETS_PX = Object.freeze({
  /** Brush HUD control ← cursor. */
  brushHud: 80,
  /** Selection command ← selection bounding box. */
  selectionCommand: 180,
  /** Layer row inline action ← that row's centre. */
  layerRowAction: 120,
});

export type StudioPointerDistanceBudgetId =
  keyof typeof STUDIO_POINTER_DISTANCE_BUDGETS_PX;

/**
 * Which hand holds the pen. Studio already stores this as
 * `StudioWorkspaceState.mobileControlSide` (labelled 왼손/오른손 in the workspace
 * menu), so the surfaces read that rather than inventing a second preference.
 */
export type StudioPointerHandedness = "left" | "right";

/* -------------------------------------------------------------- rect math */

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (maximum < minimum) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

export function studioSurfaceRectCenter(rect: StudioSurfaceRect): StudioSurfacePoint {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** Distance from a point to the nearest point of a rect. `0` when inside. */
export function studioDistanceToRect(
  point: StudioSurfacePoint,
  rect: StudioSurfaceRect
): number {
  const dx = Math.max(rect.left - point.x, 0, point.x - (rect.left + rect.width));
  const dy = Math.max(rect.top - point.y, 0, point.y - (rect.top + rect.height));
  return Math.hypot(dx, dy);
}

export function studioRectsOverlapPx2(
  a: StudioSurfaceRect,
  b: StudioSurfaceRect
): number {
  const width = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const height = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return width > 0 && height > 0 ? width * height : 0;
}

function totalObstructionPx2(
  rect: StudioSurfaceRect,
  obstacles: readonly StudioSurfaceRect[]
): number {
  let total = 0;
  for (const obstacle of obstacles) total += studioRectsOverlapPx2(rect, obstacle);
  return total;
}

function clampRectIntoArea(
  rect: StudioSurfaceRect,
  area: StudioSurfaceRect
): { rect: StudioSurfaceRect; clamped: boolean } {
  const maxLeft = area.left + Math.max(0, area.width - rect.width);
  const maxTop = area.top + Math.max(0, area.height - rect.height);
  const left = clamp(rect.left, area.left, maxLeft);
  const top = clamp(rect.top, area.top, maxTop);
  if (left === rect.left && top === rect.top) return { rect, clamped: false };
  return { rect: { ...rect, left, top }, clamped: true };
}

/**
 * Farthest distance from `anchor` to any corner of `rect`.
 *
 * Corners are the conservative stand-in for "the control that sits farthest
 * inside this surface": no control can be beyond its own container's corner.
 */
export function studioMaxCornerDistance(
  rect: StudioSurfaceRect,
  anchor: StudioSurfacePoint | StudioSurfaceRect
): number {
  const corners: readonly StudioSurfacePoint[] = [
    { x: rect.left, y: rect.top },
    { x: rect.left + rect.width, y: rect.top },
    { x: rect.left, y: rect.top + rect.height },
    { x: rect.left + rect.width, y: rect.top + rect.height },
  ];
  let worst = 0;
  for (const corner of corners) {
    const distance = "width" in anchor
      ? studioDistanceToRect(corner, anchor)
      : Math.hypot(corner.x - anchor.x, corner.y - anchor.y);
    if (distance > worst) worst = distance;
  }
  return worst;
}

/* ----------------------------------------------------------- brush HUD */

export type StudioBrushHudSide = "top" | "bottom" | "left" | "right";

export interface StudioBrushHudGeometry {
  /** Edge length of one square control cell. */
  readonly cellPx: number;
  /** Gap between the two rows/columns of the 2×2 cluster. */
  readonly gapPx: number;
  /** Distance from the cursor to the cluster centre. */
  readonly radiusPx: number;
}

/**
 * Fine pointer (mouse / pen). 34px cells clear the WCAG 2.2 AA 24px target
 * floor; radius 50 leaves a 14px gap between the pen tip and the cluster so the
 * HUD never sits under the nib.
 *
 * Farthest cell centre is `hypot(19, 69) = 71.6px` — inside the 80px budget with
 * 8px of headroom.
 */
export const STUDIO_BRUSH_HUD_FINE_GEOMETRY: StudioBrushHudGeometry = Object.freeze({
  cellPx: 34,
  gapPx: 4,
  radiusPx: 50,
});

/**
 * Coarse pointer (touch). 40px cells, radius 52 — farthest cell centre
 * `hypot(22, 74) = 77.2px`. The budget, not comfort, is what caps the radius
 * here: a 44px cell would push the far corner past 80px.
 */
export const STUDIO_BRUSH_HUD_COARSE_GEOMETRY: StudioBrushHudGeometry = Object.freeze({
  cellPx: 40,
  gapPx: 4,
  radiusPx: 52,
});

/**
 * Distance from the safe-area edge inside which the 80px budget is guaranteed.
 *
 * Equal to half the cluster extent: past that, at least one of the four sides
 * can be placed without clamping, and an unclamped side is always inside budget
 * by construction. Only a *corner* closer than this on both axes can force every
 * side to clamp, and no cluster of legible targets can satisfy 80px there —
 * three 34px targets need ~72px of extent, and the edge pushes the far one out.
 */
export const STUDIO_BRUSH_HUD_GUARANTEE_INSET_PX = 36;

export function studioBrushHudExtentPx(geometry: StudioBrushHudGeometry): number {
  return geometry.cellPx * 2 + geometry.gapPx;
}

function brushHudCellOffset(geometry: StudioBrushHudGeometry): number {
  return (geometry.cellPx + geometry.gapPx) / 2;
}

const HANDEDNESS_SIDE_ORDER: Record<
  StudioPointerHandedness,
  readonly StudioBrushHudSide[]
> = Object.freeze({
  /**
   * A right hand rests below and to the right of the nib, so the drawing hand
   * covers the bottom-right quadrant. Above first, then the far (left) side.
   */
  right: Object.freeze(["top", "left", "right", "bottom"] as const),
  left: Object.freeze(["top", "right", "left", "bottom"] as const),
});

const SIDE_DIRECTION: Record<StudioBrushHudSide, StudioSurfacePoint> = Object.freeze({
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
});

export interface StudioBrushHudPlacement {
  readonly side: StudioBrushHudSide;
  readonly rect: StudioSurfaceRect;
  /** Centres of the four control cells, reading order (row-major). */
  readonly cells: readonly StudioSurfacePoint[];
  readonly maxControlDistancePx: number;
  readonly clamped: boolean;
  readonly obstructedPx2: number;
  readonly withinBudget: boolean;
}

export interface StudioBrushHudPlacementInput {
  /** Where the HUD is tethered — the cursor, or the latched anchor. */
  readonly anchor: StudioSurfacePoint;
  /** Region the HUD may occupy (usually the canvas viewport, inset). */
  readonly safeArea: StudioSurfaceRect;
  readonly handedness: StudioPointerHandedness;
  readonly geometry?: StudioBrushHudGeometry;
  /** Open popovers, docks, panels the HUD must not cover. */
  readonly obstacles?: readonly StudioSurfaceRect[];
}

function brushHudCandidate(
  side: StudioBrushHudSide,
  input: StudioBrushHudPlacementInput,
  geometry: StudioBrushHudGeometry
): StudioBrushHudPlacement {
  const extent = studioBrushHudExtentPx(geometry);
  const direction = SIDE_DIRECTION[side];
  const centerX = input.anchor.x + direction.x * geometry.radiusPx;
  const centerY = input.anchor.y + direction.y * geometry.radiusPx;
  const raw: StudioSurfaceRect = {
    left: centerX - extent / 2,
    top: centerY - extent / 2,
    width: extent,
    height: extent,
  };
  const clampedRect = clampRectIntoArea(raw, input.safeArea);
  const offset = brushHudCellOffset(geometry);
  const finalCenter = studioSurfaceRectCenter(clampedRect.rect);
  const cells: StudioSurfacePoint[] = [];
  for (const dy of [-offset, offset]) {
    for (const dx of [-offset, offset]) {
      cells.push({ x: finalCenter.x + dx, y: finalCenter.y + dy });
    }
  }
  let maxControlDistancePx = 0;
  for (const cell of cells) {
    const distance = Math.hypot(cell.x - input.anchor.x, cell.y - input.anchor.y);
    if (distance > maxControlDistancePx) maxControlDistancePx = distance;
  }
  const obstructedPx2 = totalObstructionPx2(clampedRect.rect, input.obstacles ?? []);
  return {
    side,
    rect: clampedRect.rect,
    cells,
    maxControlDistancePx,
    clamped: clampedRect.clamped,
    obstructedPx2,
    withinBudget: maxControlDistancePx <= STUDIO_POINTER_DISTANCE_BUDGETS_PX.brushHud,
  };
}

function brushHudCandidateIsBetter(
  candidate: StudioBrushHudPlacement,
  incumbent: StudioBrushHudPlacement
): boolean {
  if (candidate.obstructedPx2 !== incumbent.obstructedPx2) {
    return candidate.obstructedPx2 < incumbent.obstructedPx2;
  }
  if (candidate.withinBudget !== incumbent.withinBudget) return candidate.withinBudget;
  return candidate.maxControlDistancePx < incumbent.maxControlDistancePx;
}

/**
 * Choose which side of the cursor the brush HUD sits on.
 *
 * Preference order is handedness-first (never park the HUD under the drawing
 * hand), then whatever keeps it on screen and clear of open popovers. The first
 * candidate that needs no clamping and covers nothing wins outright; otherwise
 * the least-obstructed, then closest-fitting candidate does.
 *
 * When the cursor is deep in a corner no 2×2 cluster of legible targets can stay
 * inside 80px — three targets need ~72px of extent and the safe-area edge pushes
 * the far cell out. The planner reports that honestly through `withinBudget`
 * instead of pretending; callers may surface it, and the regression gate asserts
 * the budget across the canvas area rather than the last 8px of the viewport.
 */
export function planStudioBrushHudPlacement(
  input: StudioBrushHudPlacementInput
): StudioBrushHudPlacement {
  const geometry = input.geometry ?? STUDIO_BRUSH_HUD_FINE_GEOMETRY;
  const order = HANDEDNESS_SIDE_ORDER[input.handedness];
  let best: StudioBrushHudPlacement | null = null;
  for (const side of order) {
    const candidate = brushHudCandidate(side, input, geometry);
    if (!candidate.clamped && candidate.obstructedPx2 === 0 && candidate.withinBudget) {
      return candidate;
    }
    if (best === null || brushHudCandidateIsBetter(candidate, best)) best = candidate;
  }
  return best ?? brushHudCandidate("top", input, geometry);
}

/* -------------------------------------------------------- brush HUD tether */

/**
 * How close the pointer must get to the HUD before it stops chasing the cursor.
 *
 * Without this a cursor-tethered HUD is unusable: it keeps its offset as the
 * pointer approaches, so the user can never catch it. Latching at 26px lets the
 * pointer cross the gap; releasing only past 44px keeps it latched while the
 * user works the controls.
 */
export const STUDIO_BRUSH_HUD_LATCH_APPROACH_PX = 26;
export const STUDIO_BRUSH_HUD_LATCH_RELEASE_PX = 44;

export type StudioBrushHudTetherPhase =
  /** Pointer is off the canvas (or the HUD was dismissed): nothing shown. */
  | "idle"
  /** HUD tracks the cursor. */
  | "following"
  /** Pointer is reaching into the HUD; the anchor is frozen so it can be hit. */
  | "latched"
  /** A stroke is in flight: hidden so it never covers the ink. */
  | "drawing";

export interface StudioBrushHudTetherState {
  readonly phase: StudioBrushHudTetherPhase;
  readonly anchor: StudioSurfacePoint | null;
}

export const STUDIO_BRUSH_HUD_TETHER_INITIAL: StudioBrushHudTetherState = Object.freeze({
  phase: "idle",
  anchor: null,
});

export type StudioBrushHudTetherEvent =
  | {
      readonly type: "pointer";
      readonly point: StudioSurfacePoint;
      readonly overCanvas: boolean;
      readonly hudRect: StudioSurfaceRect | null;
    }
  | { readonly type: "stroke-start" }
  | { readonly type: "stroke-end"; readonly point: StudioSurfacePoint | null }
  | { readonly type: "dismiss" };

/**
 * Pure tether state machine. Kept out of React on purpose: the pointer hot path
 * must not commit, so the component steps this on every `pointermove` and writes
 * the result straight to `style`.
 */
export function stepStudioBrushHudTether(
  state: StudioBrushHudTetherState,
  event: StudioBrushHudTetherEvent
): StudioBrushHudTetherState {
  if (event.type === "dismiss") return STUDIO_BRUSH_HUD_TETHER_INITIAL;
  if (event.type === "stroke-start") {
    return state.phase === "drawing" ? state : { phase: "drawing", anchor: state.anchor };
  }
  if (event.type === "stroke-end") {
    if (event.point === null) return { phase: "idle", anchor: state.anchor };
    return { phase: "following", anchor: event.point };
  }
  if (state.phase === "drawing") return state;
  const threshold = state.phase === "latched"
    ? STUDIO_BRUSH_HUD_LATCH_RELEASE_PX
    : STUDIO_BRUSH_HUD_LATCH_APPROACH_PX;
  const nearHud = event.hudRect !== null
    && state.anchor !== null
    && studioDistanceToRect(event.point, event.hudRect) <= threshold;
  if (nearHud) {
    return state.phase === "latched" ? state : { phase: "latched", anchor: state.anchor };
  }
  if (!event.overCanvas) {
    return state.phase === "idle" ? state : { phase: "idle", anchor: state.anchor };
  }
  return { phase: "following", anchor: event.point };
}

/* -------------------------------------------------- selection context bar */

export type StudioSelectionContextBarSide = "top" | "bottom";

export interface StudioSelectionContextBarPlacement {
  readonly side: StudioSelectionContextBarSide;
  readonly rect: StudioSurfaceRect;
  readonly clamped: boolean;
  /** Farthest bar corner ← nearest point of the selection box. */
  readonly maxControlDistancePx: number;
  readonly obstructedPx2: number;
  readonly withinBudget: boolean;
}

export interface StudioSelectionContextBarInput {
  /** Selection bounding box, in client coordinates. */
  readonly selection: StudioSurfaceRect;
  readonly bar: { readonly width: number; readonly height: number };
  readonly safeArea: StudioSurfaceRect;
  readonly gapPx?: number;
  readonly obstacles?: readonly StudioSurfaceRect[];
}

export const STUDIO_SELECTION_CONTEXT_BAR_GAP_PX = 12;

function selectionBarCandidate(
  side: StudioSelectionContextBarSide,
  input: StudioSelectionContextBarInput
): StudioSelectionContextBarPlacement {
  const gap = input.gapPx ?? STUDIO_SELECTION_CONTEXT_BAR_GAP_PX;
  const width = Math.max(0, finiteOr(input.bar.width, 0));
  const height = Math.max(0, finiteOr(input.bar.height, 0));
  const selectionCenterX = input.selection.left + input.selection.width / 2;
  const raw: StudioSurfaceRect = {
    left: selectionCenterX - width / 2,
    top: side === "top"
      ? input.selection.top - gap - height
      : input.selection.top + input.selection.height + gap,
    width,
    height,
  };
  const clampedRect = clampRectIntoArea(raw, input.safeArea);
  const maxControlDistancePx = studioMaxCornerDistance(clampedRect.rect, input.selection);
  return {
    side,
    rect: clampedRect.rect,
    clamped: clampedRect.clamped,
    maxControlDistancePx,
    obstructedPx2: totalObstructionPx2(clampedRect.rect, input.obstacles ?? []),
    withinBudget:
      maxControlDistancePx <= STUDIO_POINTER_DISTANCE_BUDGETS_PX.selectionCommand,
  };
}

/**
 * Park the selection command bar against the selection itself.
 *
 * Above the selection first — that is where the pointer already is after a drag,
 * and it keeps the bar off the resize handles the user grabs next. It flips
 * below when there is no room above or something is covering it.
 */
export function planStudioSelectionContextBarPlacement(
  input: StudioSelectionContextBarInput
): StudioSelectionContextBarPlacement {
  const above = selectionBarCandidate("top", input);
  if (!above.clamped && above.obstructedPx2 === 0 && above.withinBudget) return above;
  const below = selectionBarCandidate("bottom", input);
  if (!below.clamped && below.obstructedPx2 === 0 && below.withinBudget) return below;
  if (above.obstructedPx2 !== below.obstructedPx2) {
    return above.obstructedPx2 < below.obstructedPx2 ? above : below;
  }
  if (above.withinBudget !== below.withinBudget) return above.withinBudget ? above : below;
  return above.maxControlDistancePx <= below.maxControlDistancePx ? above : below;
}

/* ----------------------------------------------------- layer row actions */

/**
 * Pointer travel a layer row's inline actions cost, measured from the row centre
 * — the point the user just clicked to make that layer current.
 *
 * Before this wave, 표시 was the only inline control; 잠금 and 불투명도 both
 * required opening the row's `…` popover, so the real travel was row centre →
 * popover control. That is what the regression gate compares against.
 */
export function measureStudioLayerRowActionDistance(
  rowRect: StudioSurfaceRect,
  controlRects: readonly StudioSurfaceRect[]
): number {
  if (controlRects.length === 0) return 0;
  const rowCenter = studioSurfaceRectCenter(rowRect);
  let worst = 0;
  for (const control of controlRects) {
    const center = studioSurfaceRectCenter(control);
    const distance = Math.hypot(center.x - rowCenter.x, center.y - rowCenter.y);
    if (distance > worst) worst = distance;
  }
  return worst;
}

/* ------------------------------------------------- document → client rect */

export interface StudioDocumentRectProjectionInput {
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly canvasFlipH: boolean;
  readonly canvasRotation: StudioViewRotation;
  /** Selection bounds in document space. */
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** Client rect of the zoom host — already the axis-aligned quarter-turned box. */
  readonly hostRect: StudioSurfaceRect;
}

/**
 * Project a document-space rect into fixed-position client coordinates.
 *
 * Reuses the canonical Studio view projection (the same one point comments ride
 * on) so the selection bar stays glued to its element through zoom, horizontal
 * flip, and every quarter turn without reading Konva internals or forcing a
 * Stage render.
 */
export function projectStudioDocumentRectToClient(
  input: StudioDocumentRectProjectionInput
): StudioSurfaceRect {
  const documentWidth = Math.max(1, finiteOr(input.documentWidth, 1));
  const documentHeight = Math.max(1, finiteOr(input.documentHeight, 1));
  const hostWidth = Math.max(0, finiteOr(input.hostRect.width, 0));
  const hostHeight = Math.max(0, finiteOr(input.hostRect.height, 0));
  const x0 = clamp(finiteOr(input.rect.x, 0), 0, documentWidth);
  const y0 = clamp(finiteOr(input.rect.y, 0), 0, documentHeight);
  const x1 = clamp(x0 + Math.max(0, finiteOr(input.rect.w, 0)), 0, documentWidth);
  const y1 = clamp(y0 + Math.max(0, finiteOr(input.rect.h, 0)), 0, documentHeight);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as const) {
    const projected = projectStudioDocumentPointToView({
      documentWidth,
      documentHeight,
      canvasFlipH: input.canvasFlipH,
      canvasRotation: input.canvasRotation,
      x,
      y,
    });
    const clientX = finiteOr(input.hostRect.left, 0)
      + (projected.x / Math.max(1, projected.viewWidth)) * hostWidth;
    const clientY = finiteOr(input.hostRect.top, 0)
      + (projected.y / Math.max(1, projected.viewHeight)) * hostHeight;
    if (clientX < minX) minX = clientX;
    if (clientX > maxX) maxX = clientX;
    if (clientY < minY) minY = clientY;
    if (clientY > maxY) maxY = clientY;
  }
  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

/* ---------------------------------------------------------- safe area */

export const STUDIO_ONCANVAS_SAFE_INSET_PX = 8;

/**
 * Intersect the canvas viewport with the visual viewport and inset it, so a
 * surface can never be planned into browser chrome or off screen.
 */
export function studioOnCanvasSafeArea(
  canvasRect: StudioSurfaceRect,
  viewport: StudioSurfaceRect,
  insetPx: number = STUDIO_ONCANVAS_SAFE_INSET_PX
): StudioSurfaceRect {
  const left = Math.max(canvasRect.left, viewport.left) + insetPx;
  const top = Math.max(canvasRect.top, viewport.top) + insetPx;
  const right = Math.min(
    canvasRect.left + canvasRect.width,
    viewport.left + viewport.width
  ) - insetPx;
  const bottom = Math.min(
    canvasRect.top + canvasRect.height,
    viewport.top + viewport.height
  ) - insetPx;
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}
