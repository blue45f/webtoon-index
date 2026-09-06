import {
  projectStudioDocumentPointToView,
  type StudioViewRotation,
} from "./studio-view-controls";

import type { StudioCommentAnchor } from "./studio-comments";

export interface StudioCommentViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface StudioCommentScreenPoint {
  x: number;
  y: number;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Projects a normalized point-comment anchor into fixed-position viewport coordinates.
 *
 * The canvas host is already the axis-aligned quarter-turned view box. Reusing the canonical
 * Studio view projection keeps comment chrome attached to its document point through zoom,
 * screen-relative horizontal flip, and every supported quarter turn without reading Konva
 * internals or forcing a Stage render.
 */
export function projectStudioPointCommentToScreen(options: {
  anchor: Extract<StudioCommentAnchor, { type: "point" }>;
  canvasWidth: number;
  canvasHeight: number;
  canvasFlipH: boolean;
  canvasRotation: StudioViewRotation;
  viewportRect: StudioCommentViewportRect;
}): StudioCommentScreenPoint {
  const canvasWidth = Math.max(1, finiteOr(options.canvasWidth, 1));
  const canvasHeight = Math.max(1, finiteOr(options.canvasHeight, 1));
  const rectWidth = Math.max(0, finiteOr(options.viewportRect.width, 0));
  const rectHeight = Math.max(0, finiteOr(options.viewportRect.height, 0));
  const projected = projectStudioDocumentPointToView({
    documentWidth: canvasWidth,
    documentHeight: canvasHeight,
    canvasFlipH: options.canvasFlipH,
    canvasRotation: options.canvasRotation,
    x: options.anchor.x * canvasWidth,
    y: options.anchor.y * canvasHeight,
  });

  return {
    x: finiteOr(options.viewportRect.left, 0)
      + (projected.x / Math.max(1, projected.viewWidth)) * rectWidth,
    y: finiteOr(options.viewportRect.top, 0)
      + (projected.y / Math.max(1, projected.viewHeight)) * rectHeight,
  };
}
