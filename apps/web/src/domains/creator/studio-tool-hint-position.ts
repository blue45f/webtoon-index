export type StudioToolHintSide = "right" | "left" | "bottom" | "top";

export type StudioToolHintRect = Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height">;

export type StudioToolHintPosition = {
  left: number;
  top: number;
  side: StudioToolHintSide;
  arrowOffset: number;
};

type StudioToolHintPositionInput = {
  anchor: StudioToolHintRect;
  viewportWidth: number;
  viewportHeight: number;
  popupWidth: number;
  popupHeight: number;
  preferredSide?: StudioToolHintSide;
  gap?: number;
  viewportPadding?: number;
};

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}
/**
 * Viewport-safe rich-hint placement. It keeps the preferred rail side when it
 * fits, then chooses the side with the most usable room and clamps the panel.
 */
export function planStudioToolHintPosition({
  anchor,
  viewportWidth,
  viewportHeight,
  popupWidth,
  popupHeight,
  preferredSide = "right",
  gap = 12,
  viewportPadding = 8,
}: StudioToolHintPositionInput): StudioToolHintPosition {
  const room: Record<StudioToolHintSide, number> = {
    right: viewportWidth - viewportPadding - anchor.right - gap,
    left: anchor.left - viewportPadding - gap,
    bottom: viewportHeight - viewportPadding - anchor.bottom - gap,
    top: anchor.top - viewportPadding - gap,
  };
  const required: Record<StudioToolHintSide, number> = {
    right: popupWidth,
    left: popupWidth,
    bottom: popupHeight,
    top: popupHeight,
  };
  const preferredAxisOrder: StudioToolHintSide[] =
    preferredSide === "right" || preferredSide === "left"
      ? [preferredSide, preferredSide === "right" ? "left" : "right", "bottom", "top"]
      : [preferredSide, preferredSide === "bottom" ? "top" : "bottom", "right", "left"];
  const fittingSide = preferredAxisOrder.find((side) => room[side] >= required[side]);
  const side =
    fittingSide ??
    preferredAxisOrder.reduce((best, candidate) => (room[candidate] > room[best] ? candidate : best));

  const maxLeft = Math.max(viewportPadding, viewportWidth - viewportPadding - popupWidth);
  const maxTop = Math.max(viewportPadding, viewportHeight - viewportPadding - popupHeight);
  const anchorCenterX = anchor.left + anchor.width / 2;
  const anchorCenterY = anchor.top + anchor.height / 2;

  if (side === "right" || side === "left") {
    const left = clamp(
      side === "right" ? anchor.right + gap : anchor.left - gap - popupWidth,
      viewportPadding,
      maxLeft
    );
    const top = clamp(anchorCenterY - popupHeight / 2, viewportPadding, maxTop);
    return {
      left,
      top,
      side,
      arrowOffset: clamp(anchorCenterY - top, 16, Math.max(16, popupHeight - 16)),
    };
  }

  const left = clamp(anchorCenterX - popupWidth / 2, viewportPadding, maxLeft);
  const top = clamp(
    side === "bottom" ? anchor.bottom + gap : anchor.top - gap - popupHeight,
    viewportPadding,
    maxTop
  );
  return {
    left,
    top,
    side,
    arrowOffset: clamp(anchorCenterX - left, 16, Math.max(16, popupWidth - 16)),
  };
}
