/**
 * Pure view-state helpers shared by the Studio View menu and its keyboard shortcuts.
 * View snapshots are session-only UI state: they never enter page history, CRDT, or exports.
 */

import {
  planStudioStageViewportClipBox,
  type StudioStageViewportClipBox,
  type StudioStageViewportClipViewport,
} from "./canvas/studio-stage-viewport-clip";

export const STUDIO_VIEW_ZOOM_MIN = 0.2;
export const STUDIO_VIEW_ZOOM_MAX = 5;
export const STUDIO_VIEW_ZOOM_STEP = 0.2;

export type StudioCanvasWheelMode = "zoom" | "pan" | "brush-size";

/** Quick canvas control intentionally alternates only between navigation modes. */
export function toggleStudioCanvasWheelMode(
  current: StudioCanvasWheelMode
): Extract<StudioCanvasWheelMode, "zoom" | "pan"> {
  return current === "pan" ? "zoom" : "pan";
}

/** View-only quarter-turn rotation. Positive angles follow Konva's clockwise screen rotation. */
export type StudioViewRotation = 0 | 90 | 180 | 270;

/** Snap any finite angle to the nearest quarter turn and wrap it into the canonical 0..270 range. */
export function normalizeStudioViewRotation(value: number): StudioViewRotation {
  if (!Number.isFinite(value)) return 0;
  const quarterTurns = Math.round(value / 90);
  return ((((quarterTurns % 4) + 4) % 4) * 90) as StudioViewRotation;
}

/** Rotate the view 90 degrees counter-clockwise without changing the document. */
export function rotateStudioViewLeft(value: number): StudioViewRotation {
  return normalizeStudioViewRotation(value - 90);
}

/** Rotate the view 90 degrees clockwise without changing the document. */
export function rotateStudioViewRight(value: number): StudioViewRotation {
  return normalizeStudioViewRotation(value + 90);
}

export interface StudioViewShortcutEvent {
  code?: string;
  key?: string;
  keyCode?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
}

export type StudioViewShortcut =
  | "zoom-in"
  | "zoom-out"
  | "fit-width"
  | "actual-pixels"
  | "fullscreen"
  | "toggle-grayscale"
  | "save-view"
  | "restore-view"
  | "toggle-perspective-guide";

export interface StudioViewSnapshot {
  pageId: string;
  scale: number;
  zoom: number;
  /** Document-local coordinate under the center of the viewport. */
  centerX: number;
  /** Document-local coordinate under the center of the viewport. */
  centerY: number;
  canvasFlipH: boolean;
  canvasRotation: StudioViewRotation;
}

export interface CaptureStudioViewInput {
  pageId: string;
  scale: number;
  zoom: number;
  scrollLeft: number;
  scrollTop: number;
  viewportWidth: number;
  viewportHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  canvasFlipH: boolean;
  /** Optional until StudioPage wires its view state; omitted input preserves the legacy 0-degree view. */
  canvasRotation?: number;
}

export interface RestoreStudioViewInput {
  snapshot: StudioViewSnapshot;
  pageId: string;
  viewportWidth: number;
  viewportHeight: number;
  canvasWidth: number;
  canvasHeight: number;
}

export interface StudioViewRestorePlan {
  scale: number;
  zoom: number;
  scrollLeft: number;
  scrollTop: number;
  canvasFlipH: boolean;
  canvasRotation: StudioViewRotation;
}

export interface StudioViewStageLayoutInput {
  /** Unscaled document dimensions. */
  documentWidth: number;
  documentHeight: number;
  /** Effective display scale (`fit scale * user zoom`). */
  scale: number;
  canvasFlipH: boolean;
  canvasRotation?: number;
}

export interface StudioCanvasStageLayoutInput extends StudioViewStageLayoutInput {
  /**
   * Lay the Stage out as the document itself rather than as the artist's screen.
   *
   * Set while saving, exporting or capturing a timelapse frame. Every view-only decision has to be
   * off in that mode, because those paths read Stage pixels as the document: a quarter turn or a
   * horizontal flip would be baked into the output, and any Stage box smaller than
   * `document × scale` would silently crop it.
   */
  captureDocumentView: boolean;
  /**
   * Live scroll viewport of the canvas host, when the adaptive viewport clip is armed.
   *
   * Only the editor canvas passes this. `captureDocumentView` discards it unconditionally, which
   * is what keeps every export, save, thumbnail and timelapse path on the full-document Stage
   * without each of them having to know the clip exists.
   */
  viewportClip?: StudioStageViewportClipViewport | null;
}

/** Stage layout for the editor canvas, including the on-screen document box it was clipped from. */
export interface StudioCanvasStageLayout extends StudioViewStageLayout {
  /**
   * The unclipped Stage box — the document's full on-screen footprint.
   *
   * The zoom host keeps this box even when the Stage does not: the scroll extent, drop coordinates,
   * the zoom anchor and every overlay positioned in document CSS space are measured against it.
   */
  readonly hostWidth: number;
  readonly hostHeight: number;
  /** Non-null when `width`/`height` describe a viewport window rather than the whole document. */
  readonly clip: StudioStageViewportClipBox | null;
}

/** Props needed to lay a transformed document out inside an axis-aligned Konva Stage. */
export interface StudioViewStageLayout {
  width: number;
  height: number;
  x: number;
  y: number;
  rotation: StudioViewRotation;
  scaleX: number;
  scaleY: number;
}

export interface StudioViewTransformInput {
  documentWidth: number;
  documentHeight: number;
  canvasFlipH: boolean;
  canvasRotation?: number;
}

export interface StudioViewPoint {
  x: number;
  y: number;
}

export interface StudioViewRect extends StudioViewPoint {
  width: number;
  height: number;
}

export interface StudioViewProjectedPoint extends StudioViewPoint {
  /** Unscaled width/height of the axis-aligned visual stage. */
  viewWidth: number;
  viewHeight: number;
}

export interface StudioViewScrollPlan {
  scrollLeft: number;
  scrollTop: number;
}

export interface StudioViewRotationTransitionInput extends StudioViewTransformInput {
  nextCanvasRotation: number;
  scale: number;
  scrollLeft: number;
  scrollTop: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface StudioViewRotationTransitionPlan extends StudioViewScrollPlan {
  canvasRotation: StudioViewRotation;
  documentPoint: StudioViewPoint;
}

export interface StudioViewClientRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface StudioVisibleDocumentPlacement {
  /** Center of the document area that is genuinely visible inside the scroll viewport. */
  center: StudioViewPoint;
  /** Axis-aligned visible bounds in document coordinates. */
  bounds: StudioViewRect;
}

export interface StudioViewZoomGestureAnchor {
  /** Client-space point used for the final scroll anchor. */
  clientX: number;
  clientY: number;
  /** Host-local transform-origin point. */
  originX: number;
  originY: number;
}

export interface StudioViewZoomGestureFrameInput {
  baseZoom: number;
  targetZoom: number;
  originX: number;
  originY: number;
  originClientX: number;
  originClientY: number;
  clientX: number;
  clientY: number;
  baseLeft: number;
  baseTop: number;
  baseWidth: number;
  baseHeight: number;
  wrapLeft: number;
  wrapTop: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface StudioViewZoomGestureFrame {
  scale: number;
  translateX: number;
  translateY: number;
  targetScrollLeft: number;
  targetScrollTop: number;
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clampFinite(value: number, minimum: number, maximum: number): number {
  const safe = Number.isFinite(value) ? value : minimum;
  return Math.min(maximum, Math.max(minimum, safe));
}

/**
 * Keep wheel/pinch zoom anchored to a real point on the canvas host.
 *
 * The viewport is intentionally larger than the document at low zoom. A wheel event can therefore
 * originate on the surrounding pasteboard. CSS accepts a transform origin outside the element,
 * but the document projection clamps that point later; using those two different anchors makes the
 * canvas jump when the preview transform settles. Clamp once up front so preview and committed
 * scroll math share the exact same point.
 */
export function clampStudioViewZoomGestureAnchor(
  rect: StudioViewClientRect,
  clientX: number,
  clientY: number
): StudioViewZoomGestureAnchor {
  const left = Number.isFinite(rect.left) ? rect.left : 0;
  const top = Number.isFinite(rect.top) ? rect.top : 0;
  const right = Math.max(left, Number.isFinite(rect.right) ? rect.right : left);
  const bottom = Math.max(top, Number.isFinite(rect.bottom) ? rect.bottom : top);
  const anchoredClientX = clampFinite(clientX, left, right);
  const anchoredClientY = clampFinite(clientY, top, bottom);
  return {
    clientX: anchoredClientX,
    clientY: anchoredClientY,
    originX: anchoredClientX - left,
    originY: anchoredClientY - top,
  };
}

/**
 * Smooth, magnitude-aware wheel zoom.
 *
 * Trackpads can emit sub-pixel deltas while a mouse wheel usually emits line/page-sized deltas.
 * Treating every event as one fixed 15 percentage-point jump makes even a tiny accidental touch
 * move the document. Normalize the unit and use a bounded multiplicative step so the same physical
 * gesture feels consistent at 25% and 400% zoom.
 */
export function stepStudioViewWheelZoom(
  currentZoom: number,
  deltaY: number,
  deltaMode: number,
  reverse = false,
  pageSize = 800
): number {
  const modeScale = deltaMode === 1
    ? 16
    : deltaMode === 2
      ? finitePositive(pageSize, 800)
      : 1;
  const pixels = (Number.isFinite(deltaY) ? deltaY : 0) * modeScale * (reverse ? -1 : 1);
  const current = clampFinite(
    Number.isFinite(currentZoom) ? currentZoom : 1,
    STUDIO_VIEW_ZOOM_MIN,
    STUDIO_VIEW_ZOOM_MAX
  );
  if (pixels === 0) return current;
  const exponent = clampFinite(-pixels * 0.002, -0.18, 0.18);
  return clampFinite(
    current * Math.exp(exponent),
    STUDIO_VIEW_ZOOM_MIN,
    STUDIO_VIEW_ZOOM_MAX
  );
}

/**
 * Plan the transient CSS frame and its eventual scroll position from one shared boundary model.
 * This removes the fit-or-smaller snap where CSS can scale around an off-axis cursor but native
 * scroll cannot represent the negative offset required to preserve that cursor anchor.
 */
export function planStudioViewZoomGestureFrame(
  input: StudioViewZoomGestureFrameInput
): StudioViewZoomGestureFrame {
  // Keep the compositor preview on the exact same product bounds as the committed React state.
  // A caller normally clamps first, but pinch ratios and accumulated fractional wheel deltas can
  // briefly overshoot. Previewing that overshoot and clamping only on settlement moves the point
  // under the cursor twice, which feels like a late anchor jump at 20%/500%.
  const baseZoom = clampFinite(
    finitePositive(input.baseZoom, 1),
    STUDIO_VIEW_ZOOM_MIN,
    STUDIO_VIEW_ZOOM_MAX
  );
  const targetZoom = clampFinite(
    finitePositive(input.targetZoom, baseZoom),
    STUDIO_VIEW_ZOOM_MIN,
    STUDIO_VIEW_ZOOM_MAX
  );
  const scale = targetZoom / baseZoom;
  const baseWidth = finiteNonNegative(input.baseWidth);
  const baseHeight = finiteNonNegative(input.baseHeight);
  const viewportWidth = finiteNonNegative(input.viewportWidth);
  const viewportHeight = finiteNonNegative(input.viewportHeight);
  const originX = clampFinite(input.originX, 0, baseWidth);
  const originY = clampFinite(input.originY, 0, baseHeight);
  const baseLeft = Number.isFinite(input.baseLeft) ? input.baseLeft : 0;
  const baseTop = Number.isFinite(input.baseTop) ? input.baseTop : 0;
  const wrapLeft = Number.isFinite(input.wrapLeft) ? input.wrapLeft : baseLeft;
  const wrapTop = Number.isFinite(input.wrapTop) ? input.wrapTop : baseTop;
  const originClientX = Number.isFinite(input.originClientX)
    ? input.originClientX
    : baseLeft + originX;
  const originClientY = Number.isFinite(input.originClientY)
    ? input.originClientY
    : baseTop + originY;
  const clientX = Number.isFinite(input.clientX) ? input.clientX : originClientX;
  const clientY = Number.isFinite(input.clientY) ? input.clientY : originClientY;
  const translateX = clientX - originClientX;
  const translateY = clientY - originClientY;
  const maximumScrollLeft = Math.max(0, baseWidth * scale - viewportWidth);
  const maximumScrollTop = Math.max(0, baseHeight * scale - viewportHeight);
  const targetScrollLeft = clampFinite(
    originX * scale - (clientX - wrapLeft),
    0,
    maximumScrollLeft
  );
  const targetScrollTop = clampFinite(
    originY * scale - (clientY - wrapTop),
    0,
    maximumScrollTop
  );
  const naturalLeft = baseLeft + originX * (1 - scale) + translateX;
  const naturalTop = baseTop + originY * (1 - scale) + translateY;
  return {
    scale,
    translateX: translateX + wrapLeft - targetScrollLeft - naturalLeft,
    translateY: translateY + wrapTop - targetScrollTop - naturalTop,
    targetScrollLeft,
    targetScrollTop,
  };
}

/**
 * Project one document-local point into the unscaled, axis-aligned quarter-turned view box.
 * Horizontal flip is screen-relative: rotate first, then mirror the visible view's X axis. This
 * keeps “좌우 반전” horizontal even when the canvas is viewed at 90° or 270°.
 */
export function projectStudioDocumentPointToView(
  input: StudioViewTransformInput & StudioViewPoint
): StudioViewProjectedPoint {
  const documentWidth = finitePositive(input.documentWidth, 1);
  const documentHeight = finitePositive(input.documentHeight, 1);
  const rotation = normalizeStudioViewRotation(input.canvasRotation ?? 0);
  const documentX = clampFinite(input.x, 0, documentWidth);
  const documentY = clampFinite(input.y, 0, documentHeight);
  let projected: StudioViewProjectedPoint;

  if (rotation === 90) {
    projected = {
      x: documentHeight - documentY,
      y: documentX,
      viewWidth: documentHeight,
      viewHeight: documentWidth,
    };
  } else if (rotation === 180) {
    projected = {
      x: documentWidth - documentX,
      y: documentHeight - documentY,
      viewWidth: documentWidth,
      viewHeight: documentHeight,
    };
  } else if (rotation === 270) {
    projected = {
      x: documentY,
      y: documentWidth - documentX,
      viewWidth: documentHeight,
      viewHeight: documentWidth,
    };
  } else {
    projected = {
      x: documentX,
      y: documentY,
      viewWidth: documentWidth,
      viewHeight: documentHeight,
    };
  }

  return input.canvasFlipH
    ? { ...projected, x: projected.viewWidth - projected.x }
    : projected;
}

/** Inverse of projectStudioDocumentPointToView for drop, minimap and zoom-anchor input. */
export function projectStudioViewPointToDocument(
  input: StudioViewTransformInput & StudioViewPoint
): StudioViewPoint {
  const documentWidth = finitePositive(input.documentWidth, 1);
  const documentHeight = finitePositive(input.documentHeight, 1);
  const rotation = normalizeStudioViewRotation(input.canvasRotation ?? 0);
  const viewWidth = rotation === 90 || rotation === 270 ? documentHeight : documentWidth;
  const viewHeight = rotation === 90 || rotation === 270 ? documentWidth : documentHeight;
  const viewX = clampFinite(input.x, 0, viewWidth);
  const viewY = clampFinite(input.y, 0, viewHeight);
  const rotatedX = input.canvasFlipH ? viewWidth - viewX : viewX;

  let documentX: number;
  let documentY: number;
  if (rotation === 90) {
    documentX = viewY;
    documentY = documentHeight - rotatedX;
  } else if (rotation === 180) {
    documentX = documentWidth - rotatedX;
    documentY = documentHeight - viewY;
  } else if (rotation === 270) {
    documentX = documentWidth - viewY;
    documentY = rotatedX;
  } else {
    documentX = rotatedX;
    documentY = viewY;
  }

  return {
    x: clampFinite(documentX, 0, documentWidth),
    y: clampFinite(documentY, 0, documentHeight),
  };
}

function boundsFromStudioViewPoints(points: readonly StudioViewPoint[]): StudioViewRect {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Project a document AABB into the unscaled, axis-aligned view box. */
export function projectStudioDocumentRectToViewRect(
  input: StudioViewTransformInput & StudioViewRect
): StudioViewRect {
  const right = input.x + finiteNonNegative(input.width);
  const bottom = input.y + finiteNonNegative(input.height);
  return boundsFromStudioViewPoints([
    projectStudioDocumentPointToView({ ...input, x: input.x, y: input.y }),
    projectStudioDocumentPointToView({ ...input, x: right, y: input.y }),
    projectStudioDocumentPointToView({ ...input, x: input.x, y: bottom }),
    projectStudioDocumentPointToView({ ...input, x: right, y: bottom }),
  ]);
}

/** Inverse AABB projection used by minimap viewport indicators and DOM overlay culling. */
export function projectStudioViewRectToDocumentRect(
  input: StudioViewTransformInput & StudioViewRect
): StudioViewRect {
  const right = input.x + finiteNonNegative(input.width);
  const bottom = input.y + finiteNonNegative(input.height);
  return boundsFromStudioViewPoints([
    projectStudioViewPointToDocument({ ...input, x: input.x, y: input.y }),
    projectStudioViewPointToDocument({ ...input, x: right, y: input.y }),
    projectStudioViewPointToDocument({ ...input, x: input.x, y: bottom }),
    projectStudioViewPointToDocument({ ...input, x: right, y: bottom }),
  ]);
}

/**
 * Resolve the visible document intersection from measured DOM rectangles.
 *
 * Using the intersection (instead of the browser viewport center) avoids placing
 * new content on a clamped document edge when the zoomed canvas is smaller than
 * its scroll viewport. The same inverse transform keeps click insertion aligned
 * after view-only rotation and horizontal flip.
 */
export function resolveStudioVisibleDocumentPlacement(input: StudioViewTransformInput & {
  hostRect: StudioViewClientRect;
  viewportRect: StudioViewClientRect;
}): StudioVisibleDocumentPlacement | null {
  const hostWidth = input.hostRect.right - input.hostRect.left;
  const hostHeight = input.hostRect.bottom - input.hostRect.top;
  if (
    !Number.isFinite(hostWidth) || hostWidth <= 0 ||
    !Number.isFinite(hostHeight) || hostHeight <= 0 ||
    !Number.isFinite(input.documentWidth) || input.documentWidth <= 0 ||
    !Number.isFinite(input.documentHeight) || input.documentHeight <= 0
  ) return null;

  const left = Math.max(input.hostRect.left, input.viewportRect.left);
  const top = Math.max(input.hostRect.top, input.viewportRect.top);
  const right = Math.min(input.hostRect.right, input.viewportRect.right);
  const bottom = Math.min(input.hostRect.bottom, input.viewportRect.bottom);
  if (right <= left || bottom <= top) return null;

  const rotation = normalizeStudioViewRotation(input.canvasRotation ?? 0);
  const quarterTurn = rotation === 90 || rotation === 270;
  const viewWidth = quarterTurn ? input.documentHeight : input.documentWidth;
  const viewHeight = quarterTurn ? input.documentWidth : input.documentHeight;
  const viewRect = {
    x: ((left - input.hostRect.left) / hostWidth) * viewWidth,
    y: ((top - input.hostRect.top) / hostHeight) * viewHeight,
    width: ((right - left) / hostWidth) * viewWidth,
    height: ((bottom - top) / hostHeight) * viewHeight,
  };
  const transform = {
    documentWidth: input.documentWidth,
    documentHeight: input.documentHeight,
    canvasFlipH: input.canvasFlipH,
    canvasRotation: rotation,
  };
  return {
    bounds: projectStudioViewRectToDocumentRect({ ...transform, ...viewRect }),
    center: projectStudioViewPointToDocument({
      ...transform,
      x: viewRect.x + viewRect.width / 2,
      y: viewRect.y + viewRect.height / 2,
    }),
  };
}

/** Center a document-local point in the current visual view while respecting scroll bounds. */
export function planStudioViewScrollToDocumentPoint(
  input: StudioViewTransformInput & StudioViewPoint & {
    scale: number;
    viewportWidth: number;
    viewportHeight: number;
  }
): StudioViewScrollPlan {
  const scale = finitePositive(input.scale, 1);
  const viewportWidth = finiteNonNegative(input.viewportWidth);
  const viewportHeight = finiteNonNegative(input.viewportHeight);
  const projected = projectStudioDocumentPointToView(input);
  const maximumScrollLeft = Math.max(0, projected.viewWidth * scale - viewportWidth);
  const maximumScrollTop = Math.max(0, projected.viewHeight * scale - viewportHeight);
  return {
    scrollLeft: clampFinite(projected.x * scale - viewportWidth / 2, 0, maximumScrollLeft),
    scrollTop: clampFinite(projected.y * scale - viewportHeight / 2, 0, maximumScrollTop),
  };
}

/**
 * Preserve the document point under the viewport center while changing only the view rotation.
 * This deliberately keeps scale/zoom untouched; explicit Fit remains the only rotation-aware refit.
 */
export function planStudioViewRotationTransition(
  input: StudioViewRotationTransitionInput
): StudioViewRotationTransitionPlan {
  const scale = finitePositive(input.scale, 1);
  const viewportWidth = finiteNonNegative(input.viewportWidth);
  const viewportHeight = finiteNonNegative(input.viewportHeight);
  const documentPoint = projectStudioViewPointToDocument({
    documentWidth: input.documentWidth,
    documentHeight: input.documentHeight,
    canvasFlipH: input.canvasFlipH,
    canvasRotation: input.canvasRotation,
    x: (finiteNonNegative(input.scrollLeft) + viewportWidth / 2) / scale,
    y: (finiteNonNegative(input.scrollTop) + viewportHeight / 2) / scale,
  });
  const canvasRotation = normalizeStudioViewRotation(input.nextCanvasRotation);
  const scroll = planStudioViewScrollToDocumentPoint({
    documentWidth: input.documentWidth,
    documentHeight: input.documentHeight,
    canvasFlipH: input.canvasFlipH,
    canvasRotation,
    scale,
    viewportWidth,
    viewportHeight,
    ...documentPoint,
  });
  return { ...scroll, canvasRotation, documentPoint };
}

/**
 * Calculate an axis-aligned Stage box and transform for a view-only quarter turn.
 *
 * `canvasFlipH` mirrors the visible view's X axis after rotation. At 90°/270° this is represented
 * by a negative local Y scale so the user-facing operation remains a screen-horizontal flip.
 * Translation keeps every transformed document corner inside the returned `width`/`height` box.
 */
export function planStudioViewStageLayout(
  input: StudioViewStageLayoutInput
): StudioViewStageLayout {
  const documentWidth = finitePositive(input.documentWidth, 1);
  const documentHeight = finitePositive(input.documentHeight, 1);
  const scale = finitePositive(input.scale, 1);
  const scaledWidth = documentWidth * scale;
  const scaledHeight = documentHeight * scale;
  const rotation = normalizeStudioViewRotation(input.canvasRotation ?? 0);

  if (rotation === 90) {
    return {
      width: scaledHeight,
      height: scaledWidth,
      x: input.canvasFlipH ? 0 : scaledHeight,
      y: 0,
      rotation,
      scaleX: scale,
      scaleY: input.canvasFlipH ? -scale : scale,
    };
  }
  if (rotation === 180) {
    return {
      width: scaledWidth,
      height: scaledHeight,
      x: input.canvasFlipH ? 0 : scaledWidth,
      y: scaledHeight,
      rotation,
      scaleX: input.canvasFlipH ? -scale : scale,
      scaleY: scale,
    };
  }
  if (rotation === 270) {
    return {
      width: scaledHeight,
      height: scaledWidth,
      x: input.canvasFlipH ? scaledHeight : 0,
      y: scaledWidth,
      rotation,
      scaleX: scale,
      scaleY: input.canvasFlipH ? -scale : scale,
    };
  }
  return {
    width: scaledWidth,
    height: scaledHeight,
    x: input.canvasFlipH ? scaledWidth : 0,
    y: 0,
    rotation,
    scaleX: input.canvasFlipH ? -scale : scale,
    scaleY: scale,
  };
}

/**
 * The single decision point for "what box is the Konva Stage right now".
 *
 * Both consumers go through here so they cannot drift apart:
 * - the live editor canvas (`StudioCanvasViewport`), which passes the artist's view state, and
 * - the capture choke points (`studio-stage-document-view.ts`, and the `suppressViewTransform`
 *   render that `captureReadyStageForPage()` waits for), which pass `captureDocumentView: true`.
 *
 * Keeping the branch here — rather than at each call site — means the viewport clip that stops zoom
 * from reallocating a document-sized backing store is written once and is automatically excluded
 * from every capture path.
 * `studio-stage-document-raster-contract.test.ts` drives this function directly for that reason.
 *
 * The clip is a translation, not a projection: the window offset is subtracted from the Stage
 * translation and added back by the caller as a CSS transform on the Stage container, so the
 * document origin stays on the same screen pixel and pointer mapping is unchanged at every
 * magnification, rotation and flip.
 */
export function planStudioCanvasStageLayout(
  input: StudioCanvasStageLayoutInput
): StudioCanvasStageLayout {
  const host = planStudioViewStageLayout({
    documentWidth: input.documentWidth,
    documentHeight: input.documentHeight,
    scale: input.scale,
    canvasFlipH: input.captureDocumentView ? false : input.canvasFlipH,
    canvasRotation: input.captureDocumentView ? 0 : input.canvasRotation,
  });
  const clip = input.captureDocumentView
    ? null
    : planStudioStageViewportClipBox(host.width, host.height, input.viewportClip);
  if (!clip) return { ...host, hostWidth: host.width, hostHeight: host.height, clip: null };
  return {
    ...host,
    width: clip.width,
    height: clip.height,
    x: host.x - clip.left,
    y: host.y - clip.top,
    hostWidth: host.width,
    hostHeight: host.height,
    clip,
  };
}

function eventCode(event: StudioViewShortcutEvent): string {
  if (event.code) return event.code;
  const key = event.key?.toLowerCase();
  if (key === "=") return "Equal";
  if (key === "-") return "Minus";
  if (key === "h") return "KeyH";
  if (key === "q") return "KeyQ";
  if (key === "s") return "KeyS";
  if (key === "z") return "KeyZ";
  if (key === "g") return "KeyG";
  if (key === "home") return "Home";
  if (key === "end") return "End";
  if (key === "f11") return "F11";
  return "";
}

/**
 * Resolve Magma-style view shortcuts by physical key so keyboard-layout changes do not
 * turn Shift/Option combinations into unrelated characters. Cmd/Ctrl combinations remain
 * available to the existing editor and browser-compatible aliases.
 */
export function resolveStudioViewShortcut(
  event: StudioViewShortcutEvent
): StudioViewShortcut | null {
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    event.metaKey ||
    event.ctrlKey
  ) {
    return null;
  }

  const code = eventCode(event);

  if (!event.altKey && !event.shiftKey) {
    if (code === "Equal") return "zoom-in";
    if (code === "Minus") return "zoom-out";
    if (event.repeat) return null;
    if (code === "Home") return "fit-width";
    if (code === "End") return "actual-pixels";
    if (code === "F11") return "fullscreen";
    // 단독 `Q` 는 퀵 마스크(select.quick-mask)의 것이다 — conflict
    // `q-quickmask-vs-grayscale` 의 해소. 페이지 마스터 핸들러가 퀵 마스크를 먼저
    // 시도하고, 이미지 레이어가 없으면 여기로 흘러 내려와 색각 검수가 대신 켜졌다.
    // 같은 배지를 두 명령이 달고 조건에 따라 다른 일을 하던 상태를 끊는다.
    return null;
  }

  // ⌥Q — 색각 검수 흑백 명암. `⇧Q` 는 빠른 액세스 팔레트가 이미 쓰고 있어
  // (StudioPage 마스터 핸들러) Shift 계열로는 옮길 수 없다.
  if (event.altKey && !event.shiftKey) {
    if (event.repeat) return null;
    if (code === "KeyQ") return "toggle-grayscale";
    return null;
  }

  if (event.altKey || !event.shiftKey || event.repeat) return null;
  if (code === "KeyS") return "save-view";
  if (code === "KeyZ") return "restore-view";
  if (code === "KeyG") return "toggle-perspective-guide";
  return null;
}

export function clampStudioViewZoom(value: number): number {
  const safe = Number.isFinite(value) ? value : 1;
  return Math.min(
    STUDIO_VIEW_ZOOM_MAX,
    Math.max(STUDIO_VIEW_ZOOM_MIN, Math.round(safe * 20) / 20)
  );
}

export function stepStudioViewZoom(current: number, direction: -1 | 1): number {
  return clampStudioViewZoom(current + direction * STUDIO_VIEW_ZOOM_STEP);
}

export function fitStudioViewToWidth(
  viewportWidth: number,
  canvasWidth: number,
  maximumScale: number
): number {
  const safeViewportWidth = finitePositive(viewportWidth, canvasWidth);
  const safeCanvasWidth = finitePositive(canvasWidth, 1);
  const safeMaximum = finitePositive(maximumScale, 1);
  return Math.min(safeMaximum, Math.max(0.1, safeViewportWidth / safeCanvasWidth));
}

export function captureStudioView(input: CaptureStudioViewInput): StudioViewSnapshot {
  const scale = finitePositive(input.scale, 1);
  const zoom = clampStudioViewZoom(input.zoom);
  const effectiveScale = scale * zoom;
  const viewportWidth = finiteNonNegative(input.viewportWidth);
  const viewportHeight = finiteNonNegative(input.viewportHeight);

  const center = projectStudioViewPointToDocument({
    documentWidth: input.canvasWidth,
    documentHeight: input.canvasHeight,
    canvasFlipH: input.canvasFlipH,
    canvasRotation: input.canvasRotation,
    x: (finiteNonNegative(input.scrollLeft) + viewportWidth / 2) / effectiveScale,
    y: (finiteNonNegative(input.scrollTop) + viewportHeight / 2) / effectiveScale,
  });

  return {
    pageId: input.pageId,
    scale,
    zoom,
    centerX: center.x,
    centerY: center.y,
    canvasFlipH: input.canvasFlipH,
    canvasRotation: normalizeStudioViewRotation(input.canvasRotation ?? 0),
  };
}

/**
 * Recalculate scrolling from the saved document center after the restored scale has laid out.
 * Returning null for another page prevents a view from silently jumping to unrelated content.
 */
export function planStudioViewRestore(
  input: RestoreStudioViewInput
): StudioViewRestorePlan | null {
  if (input.snapshot.pageId !== input.pageId) return null;

  const scale = finitePositive(input.snapshot.scale, 1);
  const zoom = clampStudioViewZoom(input.snapshot.zoom);
  const effectiveScale = scale * zoom;
  const viewportWidth = finiteNonNegative(input.viewportWidth);
  const viewportHeight = finiteNonNegative(input.viewportHeight);
  const canvasWidth = finitePositive(input.canvasWidth, 1);
  const canvasHeight = finitePositive(input.canvasHeight, 1);
  const canvasRotation = normalizeStudioViewRotation(input.snapshot.canvasRotation);
  const stageLayout = planStudioViewStageLayout({
    documentWidth: canvasWidth,
    documentHeight: canvasHeight,
    scale: effectiveScale,
    canvasFlipH: input.snapshot.canvasFlipH,
    canvasRotation,
  });
  const scroll = planStudioViewScrollToDocumentPoint({
    documentWidth: canvasWidth,
    documentHeight: canvasHeight,
    canvasFlipH: input.snapshot.canvasFlipH,
    canvasRotation,
    scale: effectiveScale,
    viewportWidth,
    viewportHeight,
    x: input.snapshot.centerX,
    y: input.snapshot.centerY,
  });

  return {
    scale,
    zoom,
    scrollLeft: scroll.scrollLeft,
    scrollTop: scroll.scrollTop,
    canvasFlipH: input.snapshot.canvasFlipH,
    canvasRotation: stageLayout.rotation,
  };
}
