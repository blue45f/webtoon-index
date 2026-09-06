/**
 * The single imperative choke point for "read the Konva Stage as the whole document".
 *
 * Two invariants meet here and they are independent of each other:
 *
 * 1. **View-only rotation/flip is not document data.** A quarter turn or a horizontal flip is a
 *    property of how the artist is looking at the page, so it must never be baked into exported,
 *    saved, thumbnailed or colour-sampled pixels.
 * 2. **`stage` raster == full document raster.** Every caller of `stage.toCanvas()` /
 *    `stage.toDataURL()` in the editor assumes the Stage covers the entire document at
 *    `document × effectiveScale`, and derives its `pixelRatio` from that assumption
 *    (`exportScale / effectiveScale`, `1 / effectiveScale`, `2 / effectiveScale`, …). If the Stage
 *    is ever laid out as something smaller than the whole document — for example a viewport-sized,
 *    scroll-offset Stage — those reads silently produce a *cropped* image. No type error, no test
 *    failure: just a broken export in the artist's hands.
 *
 * Both invariants are restored by the same operation, so they are enforced in one place. The
 * restore box comes from {@link planStudioViewStageLayout} — the single geometry planner that also
 * lays out the live Stage — called with no rotation, no flip and no viewport clipping. That keeps
 * the imperative restore and the declarative live layout derived from one function by construction,
 * so a future change to Stage geometry cannot make them disagree.
 *
 * The declarative twin of this module is `suppressViewTransform` in `StudioCanvasViewport.tsx`
 * (driven by `isExporting || saving || timelapseCapturing`), which the async export paths reach
 * through `captureReadyStageForPage()`. Anything that reads Stage pixels must go through one of
 * the two; `studio-stage-document-raster-contract.test.ts` fails the build if a new call site does
 * not.
 */

import { planStudioCanvasStageLayout, type StudioCanvasStageLayout } from "../studio-view-controls";

/** Unscaled document size plus the display scale the Stage is currently rendered at. */
export interface StudioStageDocumentGeometry {
  /** Unscaled document width (`CANVAS_W`). */
  readonly documentWidth: number;
  /** Unscaled document height (`canvasH` of the active page). */
  readonly documentHeight: number;
  /** `fit scale * user zoom` — the same `effScale` every caller divides its `pixelRatio` by. */
  readonly effectiveScale: number;
}

/**
 * Structural view of the Konva Stage surface this module drives. Declared here (instead of
 * importing `Konva.Stage`) so the contract test can exercise the real restore logic against a
 * geometry model without a DOM or a WebGL/2D canvas.
 */
export interface StudioDocumentViewStage {
  width(): number;
  height(): number;
  x(): number;
  y(): number;
  scaleX(): number;
  scaleY(): number;
  rotation(): number;
  rotation(angle: number): unknown;
  size(box: { width: number; height: number }): unknown;
  position(point: { x: number; y: number }): unknown;
  scale(value: { x: number; y: number }): unknown;
  draw(): unknown;
}

/**
 * The Stage box that makes `stage.toCanvas({ pixelRatio: n / effectiveScale })` produce exactly the
 * whole document at `n×`. Deliberately routed through the shared planner rather than recomputed.
 */
export function planStudioStageDocumentViewBox(
  geometry: StudioStageDocumentGeometry
): StudioCanvasStageLayout {
  return planStudioCanvasStageLayout({
    documentWidth: geometry.documentWidth,
    documentHeight: geometry.documentHeight,
    scale: geometry.effectiveScale,
    // A capture is a document read, never a screen mirror: no view-only flip, no view-only turn.
    canvasFlipH: false,
    canvasRotation: 0,
    // A capture is also never a viewport window. Passing no clip here is belt-and-braces: the
    // `captureDocumentView` flag below already discards any clip the planner is handed.
    viewportClip: null,
    captureDocumentView: true,
  });
}

/**
 * Synchronously restore the Stage to the full-document view, run `read`, then put the artist's
 * exact layout back — including when `read` throws. The restore is `finally`-guarded so a failed
 * export can never leave the canvas rotated back to zero under the artist's cursor.
 */
export function readStudioStageInDocumentView<Result>(
  stage: StudioDocumentViewStage,
  geometry: StudioStageDocumentGeometry,
  read: () => Result
): Result {
  const previous = {
    width: stage.width(),
    height: stage.height(),
    x: stage.x(),
    y: stage.y(),
    rotation: stage.rotation(),
    scaleX: stage.scaleX(),
    scaleY: stage.scaleY(),
  };
  const documentView = planStudioStageDocumentViewBox(geometry);

  try {
    stage.size({ width: documentView.width, height: documentView.height });
    stage.position({ x: documentView.x, y: documentView.y });
    stage.rotation(documentView.rotation);
    stage.scale({ x: documentView.scaleX, y: documentView.scaleY });
    stage.draw();
    return read();
  } finally {
    stage.size({ width: previous.width, height: previous.height });
    stage.position({ x: previous.x, y: previous.y });
    stage.rotation(previous.rotation);
    stage.scale({ x: previous.scaleX, y: previous.scaleY });
    stage.draw();
  }
}
