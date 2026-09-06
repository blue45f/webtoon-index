export interface StudioPointCommentViewportBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface StudioPointCommentComposerPosition {
  mode: "popover" | "sheet";
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

const STUDIO_POINT_COMMENT_SHEET_BREAKPOINT = 640;
const STUDIO_POINT_COMMENT_POPOVER_WIDTH = 336;
const STUDIO_POINT_COMMENT_SHEET_MAX_WIDTH = 480;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Keeps the desktop composer beside its pin and turns narrow/coarse layouts into a keyboard-safe
 * bottom sheet. Coordinates are expressed in visual-viewport space so a virtual keyboard cannot
 * leave the form underneath an occluded part of the layout viewport.
 */
export function planStudioPointCommentComposerPosition(options: {
  point: { x: number; y: number };
  viewport: StudioPointCommentViewportBounds;
  measuredCard?: { width: number; height: number };
  coarsePointer?: boolean;
}): StudioPointCommentComposerPosition {
  const viewportWidth = Math.max(1, options.viewport.width);
  const viewportHeight = Math.max(1, options.viewport.height);
  const measuredHeight = Math.max(176, options.measuredCard?.height ?? 224);
  const useBottomSheet = options.coarsePointer === true
    || viewportWidth < STUDIO_POINT_COMMENT_SHEET_BREAKPOINT;

  if (useBottomSheet) {
    const topInset = Math.min(8, viewportHeight / 2);
    const maxHeight = Math.max(1, viewportHeight - topInset);
    const height = Math.min(measuredHeight, maxHeight);
    const width = Math.min(STUDIO_POINT_COMMENT_SHEET_MAX_WIDTH, viewportWidth);
    return {
      mode: "sheet",
      left: options.viewport.left + (viewportWidth - width) / 2,
      top: options.viewport.top + viewportHeight - height,
      width,
      maxHeight,
    };
  }

  const margin = 12;
  const gap = 16;
  const width = Math.min(
    Math.max(240, options.measuredCard?.width ?? STUDIO_POINT_COMMENT_POPOVER_WIDTH),
    Math.max(1, viewportWidth - margin * 2)
  );
  const height = Math.min(
    measuredHeight,
    Math.max(1, viewportHeight - margin * 2)
  );
  const minimumLeft = options.viewport.left + margin;
  const maximumLeft = options.viewport.left + viewportWidth - width - margin;
  const minimumTop = options.viewport.top + margin;
  const maximumTop = options.viewport.top + viewportHeight - height - margin;
  const pointX = Number.isFinite(options.point.x)
    ? options.point.x
    : options.viewport.left + viewportWidth / 2;
  const pointY = Number.isFinite(options.point.y)
    ? options.point.y
    : options.viewport.top + viewportHeight / 2;
  const placeRight = pointX <= options.viewport.left + viewportWidth / 2;
  const placeBelow = pointY <= options.viewport.top + viewportHeight * 0.58;

  return {
    mode: "popover",
    left: clamp(
      placeRight ? pointX + gap : pointX - width - gap,
      minimumLeft,
      Math.max(minimumLeft, maximumLeft)
    ),
    top: clamp(
      placeBelow ? pointY + gap : pointY - height - gap,
      minimumTop,
      Math.max(minimumTop, maximumTop)
    ),
    width,
    maxHeight: Math.max(1, viewportHeight - margin * 2),
  };
}
