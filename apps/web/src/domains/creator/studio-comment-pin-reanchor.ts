import {
  projectStudioDocumentPointToView,
  projectStudioViewPointToDocument,
  type StudioViewRotation,
} from "./studio-view-controls";

import type { StudioCommentAnchor } from "./studio-comments";

interface StudioCommentPinViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface StudioCommentPinViewTransform {
  canvasWidth: number;
  canvasHeight: number;
  canvasFlipH: boolean;
  canvasRotation: StudioViewRotation;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function safeCanvasDimensions(input: StudioCommentPinViewTransform) {
  return {
    canvasWidth: Math.max(1, finiteOr(input.canvasWidth, 1)),
    canvasHeight: Math.max(1, finiteOr(input.canvasHeight, 1)),
  };
}

/** Maps one viewport pointer to a normalized point anchor through every Studio view transform. */
export function projectStudioCommentPointerToPointAnchor(options: {
  pageId: string;
  clientX: number;
  clientY: number;
  viewportRect: StudioCommentPinViewportRect;
} & StudioCommentPinViewTransform): Extract<StudioCommentAnchor, { type: "point" }> {
  const { canvasWidth, canvasHeight } = safeCanvasDimensions(options);
  const rotationSwapsAxes = options.canvasRotation === 90 || options.canvasRotation === 270;
  const viewWidth = rotationSwapsAxes ? canvasHeight : canvasWidth;
  const viewHeight = rotationSwapsAxes ? canvasWidth : canvasHeight;
  const rectWidth = Math.max(1, finiteOr(options.viewportRect.width, 1));
  const rectHeight = Math.max(1, finiteOr(options.viewportRect.height, 1));
  const relativeX = clamp(
    (finiteOr(options.clientX, options.viewportRect.left) - finiteOr(options.viewportRect.left, 0))
      / rectWidth,
    0,
    1
  );
  const relativeY = clamp(
    (finiteOr(options.clientY, options.viewportRect.top) - finiteOr(options.viewportRect.top, 0))
      / rectHeight,
    0,
    1
  );
  const documentPoint = projectStudioViewPointToDocument({
    documentWidth: canvasWidth,
    documentHeight: canvasHeight,
    canvasFlipH: options.canvasFlipH,
    canvasRotation: options.canvasRotation,
    x: relativeX * viewWidth,
    y: relativeY * viewHeight,
  });
  return {
    type: "point",
    pageId: options.pageId,
    x: clamp(documentPoint.x / canvasWidth, 0, 1),
    y: clamp(documentPoint.y / canvasHeight, 0, 1),
  };
}

/**
 * Nudges a point in screen-relative directions. This lets Alt+Arrow remain visually predictable
 * while the canvas is rotated or mirrored; Shift can pass a larger fraction for coarse movement.
 */
export function nudgeStudioCommentPointAnchor(options: {
  anchor: Extract<StudioCommentAnchor, { type: "point" }>;
  directionX: -1 | 0 | 1;
  directionY: -1 | 0 | 1;
  viewFraction: number;
} & StudioCommentPinViewTransform): Extract<StudioCommentAnchor, { type: "point" }> {
  const { canvasWidth, canvasHeight } = safeCanvasDimensions(options);
  const projected = projectStudioDocumentPointToView({
    documentWidth: canvasWidth,
    documentHeight: canvasHeight,
    canvasFlipH: options.canvasFlipH,
    canvasRotation: options.canvasRotation,
    x: options.anchor.x * canvasWidth,
    y: options.anchor.y * canvasHeight,
  });
  const fraction = clamp(finiteOr(options.viewFraction, 0.005), 0.0001, 0.25);
  const documentPoint = projectStudioViewPointToDocument({
    documentWidth: canvasWidth,
    documentHeight: canvasHeight,
    canvasFlipH: options.canvasFlipH,
    canvasRotation: options.canvasRotation,
    x: projected.x + options.directionX * projected.viewWidth * fraction,
    y: projected.y + options.directionY * projected.viewHeight * fraction,
  });
  return {
    ...options.anchor,
    x: clamp(documentPoint.x / canvasWidth, 0, 1),
    y: clamp(documentPoint.y / canvasHeight, 0, 1),
  };
}
