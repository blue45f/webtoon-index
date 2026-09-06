export interface StudioObjectDragSnapInput {
  readonly position: { readonly x: number; readonly y: number };
  readonly enabled: boolean;
  readonly gridSize: number;
  readonly viewportScale: number;
  /** Magnetic distance in screen pixels, independent of zoom. */
  readonly toleranceScreenPx?: number;
}

export const STUDIO_OBJECT_DRAG_SNAP_TOLERANCE_PX = 6;

function snapAxis(value: number, gridSize: number, tolerance: number): number {
  const target = Math.round(value / gridSize) * gridSize;
  return Math.abs(target - value) <= tolerance ? target : value;
}

/**
 * Magnetic grid snap for object dragging.
 *
 * The previous drag bound rounded every pointer frame to a grid cell, so a 40px grid made objects
 * jump in 40px steps. This keeps free movement continuous and only attracts an axis near a line.
 */
export function snapStudioObjectDragPosition({
  position,
  enabled,
  gridSize,
  viewportScale,
  toleranceScreenPx = STUDIO_OBJECT_DRAG_SNAP_TOLERANCE_PX,
}: StudioObjectDragSnapInput): { x: number; y: number } {
  if (
    !enabled
    || !Number.isFinite(position.x)
    || !Number.isFinite(position.y)
    || !Number.isFinite(gridSize)
    || gridSize <= 0
    || !Number.isFinite(viewportScale)
    || viewportScale <= 0
  ) {
    return position;
  }
  const safeScreenTolerance = Number.isFinite(toleranceScreenPx)
    ? Math.max(0, toleranceScreenPx)
    : STUDIO_OBJECT_DRAG_SNAP_TOLERANCE_PX;
  const localTolerance = Math.min(gridSize / 3, safeScreenTolerance / viewportScale);
  return {
    x: snapAxis(position.x, gridSize, localTolerance),
    y: snapAxis(position.y, gridSize, localTolerance),
  };
}
