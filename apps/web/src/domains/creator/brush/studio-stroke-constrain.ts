/**
 * Freehand stroke constraints — commercial drawing affordances (CSP / Procreate style).
 * Pure geometry; no DOM. Used when the artist holds Shift while freehand drawing.
 */

export type StudioStrokeAngleSnap = "free" | "horizontal" | "vertical" | "diagonal";

export interface StudioStrokePoint {
  x: number;
  y: number;
}

/**
 * Snap an endpoint to 0° / 45° / 90° relative to the stroke start.
 * Used for freehand-with-Shift straight lines (not the dedicated line tool).
 */
export function snapStrokeEndpointToCardinalOrDiagonal(
  start: StudioStrokePoint,
  end: StudioStrokePoint
): StudioStrokePoint {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    return { x: start.x, y: start.y };
  }
  if (dx === 0 && dy === 0) return { x: start.x, y: start.y };

  // Prefer pure H/V when clearly axis-aligned; otherwise 45° diagonal.
  if (Math.abs(dx) > Math.abs(dy) * 2) {
    return { x: end.x, y: start.y };
  }
  if (Math.abs(dy) > Math.abs(dx) * 2) {
    return { x: start.x, y: end.y };
  }
  const s = Math.max(Math.abs(dx), Math.abs(dy));
  const sx = dx === 0 ? 1 : Math.sign(dx);
  const sy = dy === 0 ? 1 : Math.sign(dy);
  return { x: start.x + sx * s, y: start.y + sy * s };
}

/**
 * Build a two-point polyline from start → constrained end for Shift freehand.
 * Pressures: keep first pressure (or 0.5) and append current pressure.
 */
export function buildShiftConstrainedFreehandPoints(
  startX: number,
  startY: number,
  endX: number,
  endY: number
): number[] {
  const end = snapStrokeEndpointToCardinalOrDiagonal(
    { x: startX, y: startY },
    { x: endX, y: endY }
  );
  return [startX, startY, end.x, end.y];
}

export interface StudioShiftFreehandTransition {
  readonly points: number[];
  readonly pressures: number[];
  /** Replacement geometry invalidates any endpoint retained by the prior freehand stabilizer. */
  readonly stabilizerState: null;
}

/**
 * Replace an arbitrary freehand suffix with one constrained line and explicitly invalidate the
 * old stabilizer endpoint. Keeping this lifecycle decision next to the geometry prevents a later
 * pointer-up flush from appending a stale pre-Shift point behind the snapped endpoint.
 */
export function resolveShiftFreehandTransition(input: {
  readonly currentPoints: readonly number[];
  readonly currentPressures?: readonly number[];
  readonly endX: number;
  readonly endY: number;
  readonly pressure: number;
}): StudioShiftFreehandTransition {
  const startX = input.currentPoints[0] ?? input.endX;
  const startY = input.currentPoints[1] ?? input.endY;
  return {
    points: buildShiftConstrainedFreehandPoints(
      startX,
      startY,
      input.endX,
      input.endY
    ),
    pressures: [input.currentPressures?.[0] ?? input.pressure, input.pressure],
    stabilizerState: null,
  };
}

/**
 * Classify the snap mode for UI status ("가로 직선" etc.).
 */
export function classifyStrokeAngleSnap(
  start: StudioStrokePoint,
  end: StudioStrokePoint
): StudioStrokeAngleSnap {
  const snapped = snapStrokeEndpointToCardinalOrDiagonal(start, end);
  const dx = snapped.x - start.x;
  const dy = snapped.y - start.y;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return "free";
  if (Math.abs(dy) < 1e-6) return "horizontal";
  if (Math.abs(dx) < 1e-6) return "vertical";
  return "diagonal";
}

export function studioStrokeAngleSnapLabel(mode: StudioStrokeAngleSnap): string {
  if (mode === "horizontal") return "가로 직선";
  if (mode === "vertical") return "세로 직선";
  if (mode === "diagonal") return "45° 직선";
  return "자유선";
}
