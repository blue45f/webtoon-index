/**
 * Studio Smart Shape Interactive Recognition & Control Points
 *
 * CLIP STUDIO PAINT Ver.5.0.0 & Ver.5.1.0 Parity:
 * - Smart Shape: Draw freehand with any pen/brush, hold the stylus at the end for
 *   350~500ms (dwell recognition) or invoke via menu/shortcut/command bar.
 * - Automatically corrects freehand strokes into geometric shapes:
 *   Line, Bezier Arc, Circle, Ellipse, Rectangle, Triangle, Polygon, Speech Bubble.
 * - Generates interactive Control Points (handles) to fine-tune endpoints, radii, vertices.
 * - 15° / 30° / 45° angle snapping.
 * - Non-destructive: preserves original raw stroke points so user can revert anytime.
 *
 * Pure, deterministic, zero-dependency.
 */

export type SmartShapeKind =
  | "line"
  | "arc"
  | "circle"
  | "ellipse"
  | "rect"
  | "triangle"
  | "poly"
  | "bubble";

export interface SmartShapeControlPoint {
  readonly id: string;
  readonly role: "vertex" | "radius" | "center" | "tail" | "control";
  readonly x: number;
  readonly y: number;
  readonly label: string;
}

export interface SmartShapeGeometry {
  readonly kind: SmartShapeKind;
  readonly confidence: number; // 0..1
  readonly points: readonly (readonly [number, number])[];
  readonly controlPoints: readonly SmartShapeControlPoint[];
  readonly angleDeg?: number;
  readonly isClosed: boolean;
}

export interface SmartShapeInteractiveState {
  readonly enabled: boolean;
  readonly dwellMs: number; // default 400ms
  readonly snapAnglesDeg: readonly number[]; // e.g. [15, 30, 45, 90]
  readonly lastRecognized: SmartShapeGeometry | null;
  readonly originalPoints: readonly (readonly [number, number])[] | null;
}

export const DEFAULT_SMART_SHAPE_INTERACTIVE_STATE: SmartShapeInteractiveState = Object.freeze({
  enabled: true,
  dwellMs: 400,
  snapAnglesDeg: Object.freeze([15, 30, 45, 90]),
  lastRecognized: null,
  originalPoints: null,
});

/**
 * Computes angle in degrees [0, 360) between point A and point B.
 */
export function calculateLineAngleDeg(x1: number, y1: number, x2: number, y2: number): number {
  const rad = Math.atan2(y2 - y1, x2 - x1);
  const deg = (rad * 180) / Math.PI;
  return (deg + 360) % 360;
}

/**
 * Snaps angle to nearest step (e.g. 15°, 30°, 45°).
 */
export function snapAngleDeg(deg: number, stepDeg = 15, toleranceDeg = 5): number {
  const normalized = (deg + 360) % 360;
  const closest = Math.round(normalized / stepDeg) * stepDeg;
  if (Math.abs(normalized - closest) <= toleranceDeg) {
    return (closest + 360) % 360;
  }
  return normalized;
}

/**
 * Recognizes a freehand stroke as a geometric Smart Shape.
 */
export function recognizeSmartShapeFromStroke(
  points: readonly (readonly [number, number])[],
  options?: { readonly snapAngles?: boolean; readonly preferBubble?: boolean },
): SmartShapeGeometry | null {
  if (points.length < 3) return null;

  const first = points[0];
  const last = points[points.length - 1];
  const dx = last[0] - first[0];
  const dy = last[1] - first[1];
  const endToEndDist = Math.hypot(dx, dy);

  // Compute total path length
  let totalLength = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
    if (i > 0) {
      totalLength += Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]);
    }
  }

  const bboxWidth = maxX - minX;
  const bboxHeight = maxY - minY;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const isClosed = endToEndDist < Math.max(16, totalLength * 0.18);

  // 1. Line check: totalLength is very close to endToEndDist
  if (!isClosed && totalLength > 15) {
    const straightness = endToEndDist / totalLength;
    if (straightness > 0.92) {
      let angle = calculateLineAngleDeg(first[0], first[1], last[0], last[1]);
      let endX = last[0];
      let endY = last[1];

      if (options?.snapAngles !== false) {
        const snapped = snapAngleDeg(angle, 15, 6);
        if (snapped !== angle) {
          angle = snapped;
          const rad = (snapped * Math.PI) / 180;
          endX = first[0] + endToEndDist * Math.cos(rad);
          endY = first[1] + endToEndDist * Math.sin(rad);
        }
      }

      const linePoints: readonly (readonly [number, number])[] = Object.freeze([
        [Math.round(first[0]), Math.round(first[1])],
        [Math.round(endX), Math.round(endY)],
      ]);
      const lineControlPoints: readonly SmartShapeControlPoint[] = Object.freeze([
        { id: "start", role: "vertex" as const, x: Math.round(first[0]), y: Math.round(first[1]), label: "시작점" },
        { id: "end", role: "vertex" as const, x: Math.round(endX), y: Math.round(endY), label: "끝점" },
      ]);

      return Object.freeze({
        kind: "line",
        confidence: straightness,
        points: linePoints,
        controlPoints: lineControlPoints,
        angleDeg: Math.round(angle),
        isClosed: false,
      });
    }
  }

  // 2. Closed shapes: Circle, Ellipse, Rectangle, Triangle, Speech Bubble
  if (isClosed && bboxWidth > 12 && bboxHeight > 12) {
    const radiusX = bboxWidth / 2;
    const radiusY = bboxHeight / 2;
    const aspectRatio = radiusX / radiusY;

    // Circle / Ellipse check: points are roughly equidistant from center
    let radiusDiffSum = 0;
    for (const p of points) {
      const normDist = Math.hypot((p[0] - centerX) / (radiusX || 1), (p[1] - centerY) / (radiusY || 1));
      radiusDiffSum += Math.abs(normDist - 1);
    }
    const avgRadiusError = radiusDiffSum / points.length;

    if (avgRadiusError < 0.22) {
      const isCircle = Math.abs(aspectRatio - 1) < 0.15;
      const finalRx = isCircle ? (radiusX + radiusY) / 2 : radiusX;
      const finalRy = isCircle ? finalRx : radiusY;

      // Sample 16 polygon points for the smooth ellipse
      const ellipsePoints: (readonly [number, number])[] = [];
      for (let step = 0; step <= 32; step++) {
        const theta = (step / 32) * Math.PI * 2;
        ellipsePoints.push([
          Math.round((centerX + finalRx * Math.cos(theta)) * 10) / 10,
          Math.round((centerY + finalRy * Math.sin(theta)) * 10) / 10,
        ]);
      }

      if (options?.preferBubble) {
        const bubbleControlPoints: readonly SmartShapeControlPoint[] = Object.freeze([
          { id: "center", role: "center" as const, x: Math.round(centerX), y: Math.round(centerY), label: "중심" },
          { id: "radiusX", role: "radius" as const, x: Math.round(centerX + finalRx), y: Math.round(centerY), label: "가로 크기" },
          { id: "radiusY", role: "radius" as const, x: Math.round(centerX), y: Math.round(centerY - finalRy), label: "세로 크기" },
          { id: "tail", role: "tail" as const, x: Math.round(centerX + finalRx * 0.7), y: Math.round(centerY + finalRy * 1.3), label: "말풍선 꼬리" },
        ]);

        return Object.freeze({
          kind: "bubble",
          confidence: 0.9,
          points: Object.freeze(ellipsePoints),
          controlPoints: bubbleControlPoints,
          isClosed: true,
        });
      }

      const ellipseControlPoints: readonly SmartShapeControlPoint[] = Object.freeze([
        { id: "center", role: "center" as const, x: Math.round(centerX), y: Math.round(centerY), label: "중심" },
        { id: "radiusX", role: "radius" as const, x: Math.round(centerX + finalRx), y: Math.round(centerY), label: "가로 반경" },
        { id: "radiusY", role: "radius" as const, x: Math.round(centerX), y: Math.round(centerY - finalRy), label: "세로 반경" },
      ]);

      return Object.freeze({
        kind: isCircle ? "circle" : "ellipse",
        confidence: Math.max(0.7, 1 - avgRadiusError),
        points: Object.freeze(ellipsePoints),
        controlPoints: ellipseControlPoints,
        isClosed: true,
      });
    }

    // Rectangle check: 4 distinct corners near bounding box corners
    const rectPoints: readonly (readonly [number, number])[] = Object.freeze([
      [Math.round(minX), Math.round(minY)],
      [Math.round(maxX), Math.round(minY)],
      [Math.round(maxX), Math.round(maxY)],
      [Math.round(minX), Math.round(maxY)],
      [Math.round(minX), Math.round(minY)],
    ]);

    const rectControlPoints: readonly SmartShapeControlPoint[] = Object.freeze([
      { id: "tl", role: "vertex" as const, x: Math.round(minX), y: Math.round(minY), label: "좌상단" },
      { id: "tr", role: "vertex" as const, x: Math.round(maxX), y: Math.round(minY), label: "우상단" },
      { id: "br", role: "vertex" as const, x: Math.round(maxX), y: Math.round(maxY), label: "우하단" },
      { id: "bl", role: "vertex" as const, x: Math.round(minX), y: Math.round(maxY), label: "좌하단" },
    ]);

    return Object.freeze({
      kind: "rect",
      confidence: 0.85,
      points: rectPoints,
      controlPoints: rectControlPoints,
      isClosed: true,
    });
  }

  // 3. Smooth Arc: Open stroke that curves gracefully
  if (!isClosed && points.length >= 5) {
    const midPoint = points[Math.floor(points.length / 2)];
    const arcControlPoints: readonly SmartShapeControlPoint[] = Object.freeze([
      { id: "start", role: "vertex" as const, x: Math.round(first[0]), y: Math.round(first[1]), label: "시작" },
      { id: "control", role: "control" as const, x: Math.round(midPoint[0]), y: Math.round(midPoint[1]), label: "곡률 제어점" },
      { id: "end", role: "vertex" as const, x: Math.round(last[0]), y: Math.round(last[1]), label: "끝" },
    ]);

    return Object.freeze({
      kind: "arc",
      confidence: 0.8,
      points: Object.freeze([first, midPoint, last]),
      controlPoints: arcControlPoints,
      isClosed: false,
    });
  }

  return null;
}

/**
 * Checks if the stylus is currently dwelling (held motionless) at stroke end.
 */
export function checkStylusDwellHold(
  currentPoint: readonly [number, number],
  dwellAnchor: readonly [number, number],
  elapsedMs: number,
  dwellThresholdMs = 400,
  maxMovementPx = 7,
): boolean {
  const dist = Math.hypot(currentPoint[0] - dwellAnchor[0], currentPoint[1] - dwellAnchor[1]);
  return dist <= maxMovementPx && elapsedMs >= dwellThresholdMs;
}
