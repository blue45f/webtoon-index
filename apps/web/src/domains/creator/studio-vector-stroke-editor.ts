/**
 * Studio Vector Line & Stroke Editor Engine — 독립 벡터 레이어, 중심선(Centerline)
 * 스트로크 편집, 필압 프로파일, 선 단순화(Ramer-Douglas-Peucker), 교차점까지 지우기 코어.
 *
 * 마스터플랜 5.8 (벡터 선화) & 997개 기능 갭 (F-055 ~ F-078):
 * - Centerline Vector Stroke 모델 (좌표 x, y, 필압 pressure, 선폭 widthPx)
 * - RDP 알고리즘 기반 벡터 선 단순화(Simplify Stroke) 및 제어점 최적화
 * - 스트로크 끝단 테이퍼(Taper) 및 부분 선폭 핀치/팽창(Modulate Thickness)
 * - 교차점까지 지우기 (Erase up to Intersection): 두 선의 교차점을 찾아 돌출된 꼬리 자동 삭제
 * - 두 벡터 선 자동 연결(Connect Strokes) 및 SVG Path d-string 내보내기
 * - 순수 함수, 불변성, 결정론, DOM/React 무관
 */

export const STUDIO_VECTOR_STROKE_VERSION = 1 as const;

export const STUDIO_VECTOR_LIMITS = Object.freeze({
  maxPointsPerStroke: 4_096,
  maxStrokesPerLayer: 10_000,
  maxIdLength: 128,
  maxDiagnostics: 256,
});

export interface VectorControlPoint {
  readonly x: number;
  readonly y: number;
  readonly pressure: number; // 0..1
  readonly widthPx: number; // calculated width
}

export interface VectorStroke {
  readonly id: string;
  readonly layerId: string;
  readonly points: readonly VectorControlPoint[];
  readonly colorHex: string;
  readonly opacity: number; // 0..1
  readonly isClosed: boolean;
  readonly brushPresetId?: string;
}

/**
 * 2D 점과 선분 사이의 수직 거리를 계산한다.
 */
function perpendicularDistance(
  p: VectorControlPoint,
  p1: VectorControlPoint,
  p2: VectorControlPoint,
): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag === 0) {
    const px = p.x - p1.x;
    const py = p.y - p1.y;
    return Math.sqrt(px * px + py * py);
  }
  const u = ((p.x - p1.x) * dx + (p.y - p1.y) * dy) / (mag * mag);
  const clampedU = Math.max(0, Math.min(1, u));
  const projX = p1.x + clampedU * dx;
  const projY = p1.y + clampedU * dy;
  const distDx = p.x - projX;
  const distDy = p.y - projY;
  return Math.sqrt(distDx * distDx + distDy * distDy);
}

/**
 * Ramer-Douglas-Peucker 알고리즘을 사용하여 벡터 선의 형상을 보존하며 제어점을 단순화한다.
 */
export function simplifyVectorStroke(
  stroke: VectorStroke,
  tolerancePx: number = 2.0,
): VectorStroke {
  const pts = stroke.points;
  if (pts.length <= 2) return stroke;

  function rdpRecursive(
    points: readonly VectorControlPoint[],
    startIndex: number,
    endIndex: number,
  ): VectorControlPoint[] {
    let maxDist = 0;
    let maxIndex = 0;

    for (let i = startIndex + 1; i < endIndex; i += 1) {
      const dist = perpendicularDistance(points[i], points[startIndex], points[endIndex]);
      if (dist > maxDist) {
        maxDist = dist;
        maxIndex = i;
      }
    }

    if (maxDist > tolerancePx) {
      const left = rdpRecursive(points, startIndex, maxIndex);
      const right = rdpRecursive(points, maxIndex, endIndex);
      return [...left.slice(0, -1), ...right];
    }

    return [points[startIndex], points[endIndex]];
  }

  const simplified = rdpRecursive(pts, 0, pts.length - 1);
  return {
    ...stroke,
    points: Object.freeze(simplified),
  };
}

/**
 * 스트로크의 시작과 끝부분에 자연스러운 필압 테이퍼(Taper)를 적용한다.
 */
export function applyStrokeTaper(
  stroke: VectorStroke,
  taperLengthRatio: number = 0.2, // 0..0.5
): VectorStroke {
  const pts = stroke.points;
  if (pts.length < 3) return stroke;

  const count = pts.length;
  const taperCount = Math.max(1, Math.floor(count * taperLengthRatio));

  const modified = pts.map((p, idx) => {
    let factor = 1.0;
    if (idx < taperCount) {
      factor = (idx + 1) / (taperCount + 1);
    } else if (idx >= count - taperCount) {
      factor = (count - idx) / (taperCount + 1);
    }

    return Object.freeze({
      ...p,
      pressure: p.pressure * factor,
      widthPx: Math.max(0.5, p.widthPx * factor),
    });
  });

  return {
    ...stroke,
    points: Object.freeze(modified),
  };
}

/**
 * 두 선분 (p1-p2)와 (p3-p4)의 2D 교차점을 찾는다.
 */
function findSegmentIntersection(
  p1: VectorControlPoint,
  p2: VectorControlPoint,
  p3: VectorControlPoint,
  p4: VectorControlPoint,
): { x: number; y: number } | null {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-6) return null;

  const u = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const v = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;

  if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
    return {
      x: p1.x + u * (p2.x - p1.x),
      y: p1.y + u * (p2.y - p1.y),
    };
  }
  return null;
}

/**
 * 교차점까지 지우기 (Erase up to Intersection):
 * targetStroke가 otherStroke와 교차하는 지점을 찾아서, 클릭한 끝단 쪽의 돌출된 선분을 교차점까지 삭제한다.
 */
export function eraseUpToIntersection(
  targetStroke: VectorStroke,
  otherStroke: VectorStroke,
  clickNearStart: boolean = false,
): VectorStroke {
  const tPts = targetStroke.points;
  const oPts = otherStroke.points;

  let bestTIndex = -1;
  let intersectionPt: { x: number; y: number } | null = null;

  for (let i = 0; i < tPts.length - 1; i += 1) {
    for (let j = 0; j < oPts.length - 1; j += 1) {
      const isect = findSegmentIntersection(tPts[i], tPts[i + 1], oPts[j], oPts[j + 1]);
      if (isect) {
        bestTIndex = i;
        intersectionPt = isect;
        break;
      }
    }
    if (intersectionPt) break;
  }

  if (!intersectionPt || bestTIndex === -1) return targetStroke;

  const newIntersectionPt: VectorControlPoint = Object.freeze({
    x: Math.round(intersectionPt.x * 10) / 10,
    y: Math.round(intersectionPt.y * 10) / 10,
    pressure: tPts[bestTIndex].pressure,
    widthPx: tPts[bestTIndex].widthPx,
  });

  let nextPoints: VectorControlPoint[];
  if (clickNearStart) {
    // 시작 쪽 꼬리를 교차점까지 삭제 -> 교차점부터 끝까지 유지
    nextPoints = [newIntersectionPt, ...tPts.slice(bestTIndex + 1)];
  } else {
    // 끝 쪽 꼬리를 교차점까지 삭제 -> 시작부터 교차점까지 유지
    nextPoints = [...tPts.slice(0, bestTIndex + 1), newIntersectionPt];
  }

  return {
    ...targetStroke,
    points: Object.freeze(nextPoints),
  };
}

/**
 * 벡터 스트로크를 SVG Path d-문자열로 직렬화한다.
 */
export function exportStrokeToSvgPath(stroke: VectorStroke): string {
  const pts = stroke.points;
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y} Z`;

  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i += 1) {
    d += ` L ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
  }
  if (stroke.isClosed) d += " Z";
  return d;
}
