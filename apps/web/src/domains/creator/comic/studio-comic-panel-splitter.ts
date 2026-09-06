export interface PanelPoint {
  x: number;
  y: number;
}

export interface ComicPanelPolygon {
  id: string;
  points: readonly PanelPoint[]; // Closed polygon (clockwise or CCW)
}

export interface ComicPanelSplitCut {
  start: PanelPoint;
  end: PanelPoint;
  gutterWidthPx: number; // Space between split frames (e.g. 10..40px)
}

/**
 * Clips a polygon against a half-plane.
 * The half-plane is defined by a point P, a normal N, and an offset.
 * Points V inside the half-plane satisfy: (V - P) dot N >= offset.
 */
function clipPolygon(
  points: readonly PanelPoint[],
  P: PanelPoint,
  N: PanelPoint,
  offset: number
): PanelPoint[] {
  const inside = (v: PanelPoint) => (v.x - P.x) * N.x + (v.y - P.y) * N.y >= offset;

  const intersect = (v1: PanelPoint, v2: PanelPoint): PanelPoint => {
    const d1 = (v1.x - P.x) * N.x + (v1.y - P.y) * N.y;
    const d2 = (v2.x - P.x) * N.x + (v2.y - P.y) * N.y;
    const t = (offset - d1) / (d2 - d1);
    return {
      x: v1.x + t * (v2.x - v1.x),
      y: v1.y + t * (v2.y - v1.y),
    };
  };

  const result: PanelPoint[] = [];
  if (points.length === 0) return result;

  let prev = points[points.length - 1];
  let prevInside = inside(prev);

  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    const currInside = inside(curr);

    if (currInside) {
      if (!prevInside) {
        result.push(intersect(prev, curr));
      }
      result.push(curr);
    } else {
      if (prevInside) {
        result.push(intersect(prev, curr));
      }
    }

    prev = curr;
    prevInside = currInside;
  }

  return result;
}

/**
 * Calculates the area of a polygon.
 */
export function getPolygonArea(points: readonly PanelPoint[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return Math.abs(area / 2);
}

/**
 * Splits a comic panel polygon into two separate polygons using a cut line.
 * It applies a gutter gap between the two resulting panels.
 * Returns null if the cut does not intersect or produces degenerate polygons (< 3 vertices).
 */
export function splitComicPanelPolygon(
  panel: ComicPanelPolygon,
  cut: ComicPanelSplitCut
): [ComicPanelPolygon, ComicPanelPolygon] | null {
  const dx = cut.end.x - cut.start.x;
  const dy = cut.end.y - cut.start.y;
  const len = Math.sqrt(dx * dx + dy * dy);

  if (len === 0) return null; // Invalid cut line

  // Normal vector pointing to the "left" of the cut direction
  const nx = -dy / len;
  const ny = dx / len;
  const N: PanelPoint = { x: nx, y: ny };

  const P = cut.start;
  const halfGutter = cut.gutterWidthPx / 2;

  // Polygon 1: Left side of the cut line (dist >= halfGutter)
  const points1 = clipPolygon(panel.points, P, N, halfGutter);

  // Polygon 2: Right side of the cut line (dist <= -halfGutter)
  // For the right side, we use -N as the normal to keep points on the right.
  // The condition is (V - P) dot (-N) >= halfGutter
  const negN: PanelPoint = { x: -nx, y: -ny };
  const points2 = clipPolygon(panel.points, P, negN, halfGutter);

  if (points1.length < 3 || points2.length < 3) {
    return null; // Cut missed or created degenerate polygons
  }

  const area1 = getPolygonArea(points1);
  const area2 = getPolygonArea(points2);

  // If area is effectively zero, it's a degenerate polygon
  if (area1 < 1e-4 || area2 < 1e-4) {
    return null;
  }

  return [
    {
      id: `${panel.id}-1`,
      points: points1,
    },
    {
      id: `${panel.id}-2`,
      points: points2,
    },
  ];
}
