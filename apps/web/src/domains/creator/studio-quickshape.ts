/**
 * Studio QuickShape — 프리핸드 스트로크를 "잠시 멈추면" 완벽한 도형으로 인식하는 순수 코어.
 *
 * StudioDrawNode 는 "line" 을 제외한 모든 도형 kind(rect/ellipse/triangle/polygon)를 오직
 * drawBounds(points)(= points[0..3] 두 꼭짓점의 바운딩 박스)로만 그린다 — 이 모듈의 출력은
 * 그래서 항상 kind + 4개 숫자([x0,y0,x1,y1]) 튜플 하나다. star/arrow 는 인식 대상에서 제외한다
 * (별은 내부/외곽 반경이 번갈아 나오는 지오메트리라 손떨림과 구분이 어렵고, 화살표는 단일
 * 스트로크로 인식할 지오메트리가 아니라 "line" 위에 얹는 스타일 선택이라 애초에 후보가 아니다).
 * points 배열은 studio-brush 의 프리핸드 points 규약과 동일([x0,y0,x1,y1,...]).
 *
 * 순수·결정적 — DOM/Konva/타이머 의존 없음. "정지 판정"과 두 단계 홀드 타이머는 StudioPage 가
 * 소유한다(studio-node-edit 의 beginNodeDrag/updateNodeDragMove 와 동일한 분업 — 엔진은 기하만,
 * 상위가 제스처/시간을 해석해 엔진을 호출한다).
 */
import { SHAPE_PARAM_RANGES, type StrokeShapeKind } from "./brush/studio-stroke-shapes";
import { polylineLength } from "./studio-brush";

export type QuickShapeKind = Extract<StrokeShapeKind, "line" | "rect" | "ellipse" | "triangle" | "polygon">;

export type QuickShapeMatch = {
  kind: QuickShapeKind;
  /** DrawEl.points 호환 4수 튜플 — "line"은 실제 두 끝점, 그 외는 바운딩 박스 두 모서리. */
  points: [number, number, number, number];
  /** kind === "polygon" 일 때만 존재 — 감지된 변 수(QUICKSHAPE_MIN/MAX_POLYGON_SIDES 로 클램프됨). */
  polygonSides?: number;
};

// ---------------------------------------------------------------------------
// 튜닝 상수(경험적 — 실제 손그림 테스트로 조정 필요, 초기값은 시작점일 뿐)
// ---------------------------------------------------------------------------

export const QUICKSHAPE_HOLD_MS = 350; // 1단계: 인식 시작까지 정지 시간
export const QUICKSHAPE_LOCK_HOLD_MS = 1100; // 2단계: 정비율 고정까지 누적 정지 시간
export const QUICKSHAPE_STILL_RADIUS_PX = 14; // "정지" 허용 반경(화면 px) — 터치·펜 지터 여유
export const QUICKSHAPE_MIN_POINTS = 5; // 분류 시도 최소 점 개수
export const QUICKSHAPE_MIN_SIZE_PX = 8; // 분류 시도 최소 바운딩박스 대각선(우발적 탭 방지)
export const QUICKSHAPE_CLOSURE_RATIO = 0.22; // (끝-시작 거리)/전체 길이 ≤ 이 값이면 "닫힘"
export const QUICKSHAPE_LINE_MAX_DEVIATION_RATIO = 0.06; // 직선 적합 잔차/스팬 허용비
// 코너 각도 문턱 — 설계 스케치 초안은 35°였지만 실제 합성 손그림 픽스처로 검증한 결과, 정십각형의
// 외각(360/10=36°)이 겨우 1° 여유라 리샘플 격자 정렬 오차만으로도 threshold 아래로 미끄러져
// 일부 코너를 놓쳤다(§구현 편차, 통합 요약 참조). 30°로 낮추면 정삼각형~정십각형(외각 120°~36°)
// 전 구간이 넉넉한 여유로 검출되면서도, 원(곡률 기반 가짜 코너)은 여전히 0으로 유지된다.
export const QUICKSHAPE_CORNER_ANGLE_THRESHOLD_DEG = 30;

/**
 * Excludes samples accumulated after the pointer entered its current still-radius. Stylus devices
 * commonly emit ~60Hz sub-pixel jitter during the hold gesture; those points are useful for an
 * immediate release route but must not distort the geometry classified after a dwell.
 */
export function trimQuickShapeDwellTail(
  points: readonly number[],
  stableCoordinateLength: number,
): readonly number[] {
  const completeLength = points.length - (points.length % 2);
  const boundedLength = Math.max(
    0,
    Math.min(
      completeLength,
      Number.isFinite(stableCoordinateLength)
        ? Math.floor(stableCoordinateLength / 2) * 2
        : completeLength,
    ),
  );
  return boundedLength >= completeLength ? points : points.slice(0, boundedLength);
}
export const QUICKSHAPE_MIN_POLYGON_SIDES = 5;
export const QUICKSHAPE_MAX_POLYGON_SIDES = 10; // SHAPE_PARAM_RANGES 는 12까지 허용하지만 11~12각
// 코너 카운팅은 손떨림 대비 신뢰도가 낮아 보수적으로 캡.
export const QUICKSHAPE_SIDE_LENGTH_CV_MAX = 0.4; // 다각형 "변 길이 고른가" 변동계수 허용치
export const QUICKSHAPE_RESAMPLE_COUNT = 64; // 코너 검출 전 등호길이 리샘플 개수(입력 크기 무관 O(1) 비용)
// (나비매듭/자기교차 사각형 낙서 판정은 면적비가 아니라 segmentsIntersect() 의 실제 교차 검사로 한다 —
// 대각선 두 변이 서로 교차하면 나비매듭. 이전에 쓰던 shoelace 면적비/바운딩박스 면적비 ≤ 0.5 휴리스틱은
// 45°로 회전한 정사각형(다이아몬드)의 면적비가 수학적으로 정확히 0.5 — 바로 그 문턱 — 이라 지터 방향에
// 따라 무작위로 rect/null 이 갈렸다(적대적 리뷰에서 발견, 회귀 테스트로 검증됨).
// 코너 사이 "변"이 실제로 곧은지 검증 — 문턱을 넘긴 원형(circle) 계열 오검출 코너 몇 개를 그대로
// 다각형으로 받아들이면(예: 완만한 다각형의 곡률이 threshold를 살짝 넘는 지점만 코너로 잡혀
// 실제로는 둥근 변인데 "삼각형"처럼 보이는 경우) 전혀 다른 모양이 나온다 — 코너와 코너 사이 호가
// 직선 현(chord)에서 얼마나 벗어나는지(최대 수직거리/현 길이)로 가려낸다. 실측: 정다각형은
// 손떨림을 크게 줘도 ≤0.16, 원의 곡률이 threshold를 넘겨 잘못 잡힌 코너 3개짜리 오검출은 ~0.49로
// 한 자릿수 차이가 나 관대하게 잡아도 안전하게 분리된다.
export const QUICKSHAPE_MAX_SIDE_DEVIATION_RATIO = 0.18;
// 손그림 삼각형은 변이 살짝 휘는 경우가 흔해 rect 문턱(0.18)보다 관대하게 허용한다.
// 실측: 살짝 불룩한 변 3개 + 지터면 ~0.22~0.26, 원 오검출 코너 3개 현 편차는 ~0.45+.
export const QUICKSHAPE_TRIANGLE_MAX_SIDE_DEVIATION_RATIO = 0.28;
// Release path passes through the production stabilizer, which intentionally rounds polygon
// vertices more than the ideal geometry fixtures. Keep live recognition strict, but allow the
// confirmed release to retain those short rounded shoulders without accepting circle-scale arcs.
export const QUICKSHAPE_RELEASE_POLYGON_MAX_SIDE_DEVIATION_RATIO = 0.32;
// Release may relax rounded *edges*, but not the regular-polygon contract itself. Raising the side
// length CV lets a five-corner scribble with one vertex more than 3x farther out snap into a regular
// pentagon. Keep the same side-balance gate as live recognition and relax only side straightness.
export const QUICKSHAPE_RELEASE_POLYGON_SIDE_LENGTH_CV_MAX = QUICKSHAPE_SIDE_LENGTH_CV_MAX;
// 타원/원 폴백 — 코너 1~2개 또는 직선성 실패 시, 중심 대비 반경 변동계수(CV)가 낮으면 원형으로 본다.
// 정다각형·사각형은 CV가 훨씬 커서(정삼각형 ~0.3+, 사각형 ~0.2+) 이 문턱 아래로 잘 안 내려간다.
export const QUICKSHAPE_ELLIPSE_RADIAL_CV_MAX = 0.16;
export const QUICKSHAPE_ELLIPSE_RADIAL_CV_MAX_RELAXED = 0.24; // release / 불완전 원호
export const QUICKSHAPE_ELLIPSE_MIN_ANGULAR_SPAN_DEG = 240; // 불완전 원도 이 각도 이상이면 후보
export const QUICKSHAPE_ELLIPSE_MAX_ASPECT = 3.2; // 장단축 비가 이보다 크면 원형 후보에서 제외(납작 선 방지)

// ---------------------------------------------------------------------------
// 내부 수치 헬퍼
// ---------------------------------------------------------------------------

/** 소수 둘째 자리 반올림 — 지오메트리 출력을 결정적·직렬화 친화적으로 유지(studio-stroke-shapes 관례와 동일). */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** [min,max] 정수 클램프(반올림). */
function clampInt(raw: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(raw)));
}

type Pt = { x: number; y: number };

/** points 평탄 배열 전체의 바운딩 박스(모든 좌표쌍 순회). */
function boundsOfPoints(points: readonly number[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = points[i]!;
    const y = points[i + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** points 평탄 배열 → {x,y} 정점 목록. */
function toVertices(points: readonly number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    out.push({ x: points[i]!, y: points[i + 1]! });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 닫힌 루프 리샘플 + 코너 검출(고정 비용 — 원본 점 개수와 무관)
// ---------------------------------------------------------------------------

/**
 * vertices 를 "닫힌" 폴리곤(마지막 정점→첫 정점 가상 변 포함)으로 보고 호길이 기준 균등
 * count개 점으로 리샘플한다. 느리고 신중하게 그린 원(원본 점 수백 개)도 이후 코너 검출은
 * 항상 고정된 count 크기에서만 동작하도록 만들어 입력 크기에 비례하지 않는 비용을 보장한다.
 */
function resampleClosedLoop(vertices: readonly Pt[], count: number): Pt[] {
  const n = vertices.length;
  if (n === 0) return [];
  if (n === 1) return Array.from({ length: count }, () => ({ ...vertices[0]! }));

  const edgeLengths: number[] = new Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % n]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    edgeLengths[i] = len;
    total += len;
  }
  if (total < 1e-6) return Array.from({ length: count }, () => ({ ...vertices[0]! }));

  const out: Pt[] = [];
  let edgeIndex = 0;
  let edgeStart = 0; // 현재 변 시작점까지의 누적 호길이
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total;
    while (edgeIndex < n - 1 && edgeStart + edgeLengths[edgeIndex]! < target) {
      edgeStart += edgeLengths[edgeIndex]!;
      edgeIndex++;
    }
    const a = vertices[edgeIndex]!;
    const b = vertices[(edgeIndex + 1) % n]!;
    const edgeLen = edgeLengths[edgeIndex]!;
    const t = edgeLen > 1e-9 ? (target - edgeStart) / edgeLen : 0;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/** 세 점 a→b→c 사이의 꺾임각(도, 0..180) — 한쪽 벡터가 거의 0길이면 0(판단 불가는 코너 아님으로). */
function turningAngleDeg(a: Pt, b: Pt, c: Pt): number {
  const v1x = b.x - a.x;
  const v1y = b.y - a.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  if (Math.hypot(v1x, v1y) < 1e-6 || Math.hypot(v2x, v2y) < 1e-6) return 0;
  const cross = v1x * v2y - v1y * v2x;
  const dot = v1x * v2x + v1y * v2y;
  return Math.abs(Math.atan2(cross, dot)) * (180 / Math.PI);
}

/**
 * 리샘플된 닫힌 루프에서 "코너"로 볼 인덱스 목록을 뽑는다. 인접(원형) 후보를 하나의 코너로
 * 비최대억제(non-max suppression)한다 — 실제 코너 하나가 손떨림 때문에 문턱을 넘는 연속된 여러
 * 샘플로 번져 나오는 것을 하나로 합친다.
 */
function detectCorners(loop: readonly Pt[], thresholdDeg: number): number[] {
  const n = loop.length;
  if (n < 6) return [];
  const window = Math.max(2, Math.round(n / 16));

  const angles: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = loop[(i - window + n) % n]!;
    const b = loop[i]!;
    const c = loop[(i + window) % n]!;
    angles[i] = turningAngleDeg(a, b, c);
  }

  const candidates: number[] = [];
  for (let i = 0; i < n; i++) {
    if (angles[i]! >= thresholdDeg) candidates.push(i);
  }
  if (candidates.length === 0) return [];

  // 오름차순 후보를 원형으로 인접 그룹핑(간격 ≤ mergeGap 면 같은 코너의 번짐으로 간주).
  // NOTE: mergeGap 은 의도적으로 각도 평활에 쓰는 `window` 보다 작다 — `window` 를 그대로 병합
  // 반경으로 쓰면 짧은 변 하나를 사이에 둔 서로 다른 두 코너(예: 세로/가로 비율이 큰 직사각형의
  // 짧은 변 양끝)까지 하나로 뭉개져, 정직사각형(4코너)이 코너 2개짜리로 잘못 셈해지는 실사용
  // 리그레션이 있었다(적대적 리뷰에서 발견, 회귀 테스트로 검증됨 — 손그림 직사각형은 세로/가로
  // 비율이 큰 경우가 흔해 실사용 임팩트가 크다).
  const mergeGap = Math.max(1, Math.floor(window / 2) - 1);
  const groups: number[][] = [[candidates[0]!]];
  for (let k = 1; k < candidates.length; k++) {
    const idx = candidates[k]!;
    const currentGroup = groups[groups.length - 1]!;
    const prev = currentGroup[currentGroup.length - 1]!;
    if (idx - prev <= mergeGap) {
      currentGroup.push(idx);
    } else {
      groups.push([idx]);
    }
  }
  // 마지막 그룹과 첫 그룹이 루프 경계를 넘어 인접하면 하나로 합친다(원형 wraparound).
  if (groups.length > 1) {
    const first = groups[0]!;
    const last = groups[groups.length - 1]!;
    const wrapGap = first[0]! + n - last[last.length - 1]!;
    if (wrapGap <= mergeGap) {
      groups[0] = [...last, ...first];
      groups.pop();
    }
  }

  return groups.map((group) => {
    let best = group[0]!;
    let bestAngle = angles[best]!;
    for (const idx of group) {
      if (angles[idx]! > bestAngle) {
        bestAngle = angles[idx]!;
        best = idx;
      }
    }
    return best;
  });
}

/** 세 점의 방향(부호 있는 넓이) — 0=일직선, >0=반시계, <0=시계. */
function orientationSign(a: Pt, b: Pt, c: Pt): number {
  const val = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(val) < 1e-9) return 0;
  return val > 0 ? 1 : -1;
}

/** c 가 a-b 를 잇는(공선인) 선분 위에 있는지(bbox 포함 검사, 부동소수 여유 포함). */
function onSegment(a: Pt, b: Pt, c: Pt): boolean {
  return (
    Math.min(a.x, b.x) - 1e-9 <= c.x &&
    c.x <= Math.max(a.x, b.x) + 1e-9 &&
    Math.min(a.y, b.y) - 1e-9 <= c.y &&
    c.y <= Math.max(a.y, b.y) + 1e-9
  );
}

/** 두 선분 p1-p2 와 p3-p4 가 (끝점 포함) 서로 교차하는지 — 나비매듭(자기교차 사각형) 판정용. */
function segmentsIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const o1 = orientationSign(p1, p2, p3);
  const o2 = orientationSign(p1, p2, p4);
  const o3 = orientationSign(p3, p4, p1);
  const o4 = orientationSign(p3, p4, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, p3)) return true;
  if (o2 === 0 && onSegment(p1, p2, p4)) return true;
  if (o3 === 0 && onSegment(p3, p4, p1)) return true;
  if (o4 === 0 && onSegment(p3, p4, p2)) return true;
  return false;
}

/**
 * 코너 인덱스들이 정말 "곧은 변"으로 이어지는지 검사 — 각 변(코너 i→i+1 사이의 루프 호)을 이루는
 * 리샘플 점들이 그 두 코너를 잇는 직선 현(chord)에서 얼마나 벗어나는지(최대 수직거리/현 길이)의
 * 최댓값. 여러 변 중 가장 심하게 휜 변이 전체 매치의 신뢰도를 결정한다(그 자체로 사실은 매끄러운
 * 곡선인데 문턱을 살짝 넘은 지점만 "코너"로 잘못 잡힌 경우를 가려낸다 — sideLengthCV 는 변
 * "길이"가 고른지만 보고 변이 "곧은지"는 보지 않아 이 검사를 대신할 수 없다).
 */
function maxSideDeviationRatio(loop: readonly Pt[], cornerIndices: readonly number[]): number {
  const n = loop.length;
  const m = cornerIndices.length;
  let worst = 0;
  for (let s = 0; s < m; s++) {
    const ci = cornerIndices[s]!;
    const cj = cornerIndices[(s + 1) % m]!;
    const a = loop[ci]!;
    const b = loop[cj]!;
    const chordLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (chordLen < 1e-6) continue;
    const ux = (b.x - a.x) / chordLen;
    const uy = (b.y - a.y) / chordLen;
    const steps = (cj - ci + n) % n;
    let maxDev = 0;
    for (let k = 0; k <= steps; k++) {
      const p = loop[(ci + k) % n]!;
      const dx = p.x - a.x;
      const dy = p.y - a.y;
      const perp = Math.abs(-dy * ux + dx * uy);
      if (perp > maxDev) maxDev = perp;
    }
    const ratio = maxDev / chordLen;
    if (ratio > worst) worst = ratio;
  }
  return worst;
}

/** 코너 인덱스들 사이 변 길이의 변동계수(표준편차/평균) — 작을수록 "정다각형에 가깝게 고름". */
function sideLengthCV(loop: readonly Pt[], cornerIndices: readonly number[]): number {
  const n = cornerIndices.length;
  if (n < 3) return Number.POSITIVE_INFINITY;
  const lengths: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = loop[cornerIndices[i]!]!;
    const b = loop[cornerIndices[(i + 1) % n]!]!;
    lengths.push(Math.hypot(b.x - a.x, b.y - a.y));
  }
  const mean = lengths.reduce((s, v) => s + v, 0) / n;
  if (mean < 1e-6) return Number.POSITIVE_INFINITY;
  const variance = lengths.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return Math.sqrt(variance) / mean;
}

/**
 * 원형 유사도 통계 — 중심 대비 반경 변동계수(CV), 각도 커버리지, bbox 장단축비.
 * 손그림 원에 가짜 코너가 잡히거나 끝점이 덜 닫혀도, CV가 낮고 각도 스팬이 충분하면 ellipse로 폴백한다.
 */
function ellipseShapeStats(vertices: readonly Pt[]): {
  radialCv: number;
  angularSpanDeg: number;
  aspect: number;
  meanR: number;
} {
  const n = vertices.length;
  if (n < 4) {
    return { radialCv: Number.POSITIVE_INFINITY, angularSpanDeg: 0, aspect: Number.POSITIVE_INFINITY, meanR: 0 };
  }
  let sx = 0;
  let sy = 0;
  for (const p of vertices) {
    sx += p.x;
    sy += p.y;
  }
  const cx = sx / n;
  const cy = sy / n;

  const radii: number[] = [];
  const angles: number[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of vertices) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    radii.push(Math.hypot(dx, dy));
    angles.push(Math.atan2(dy, dx));
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const meanR = radii.reduce((s, v) => s + v, 0) / n;
  const variance = radii.reduce((s, v) => s + (v - meanR) ** 2, 0) / n;
  const radialCv = meanR < 1e-6 ? Number.POSITIVE_INFINITY : Math.sqrt(variance) / meanR;

  // 각도 커버리지: 정렬된 atan2 간격 중 최대 갭을 빼고 나머지 스팬.
  const sorted = angles.slice().sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1]! - sorted[i]!;
    if (gap > maxGap) maxGap = gap;
  }
  // wraparound 갭 (첫 + 2π - 마지막)
  const wrapGap = sorted[0]! + Math.PI * 2 - sorted[sorted.length - 1]!;
  if (wrapGap > maxGap) maxGap = wrapGap;
  const angularSpanDeg = ((Math.PI * 2 - maxGap) * 180) / Math.PI;

  const w = Math.max(1e-6, maxX - minX);
  const h = Math.max(1e-6, maxY - minY);
  const aspect = Math.max(w, h) / Math.min(w, h);

  return { radialCv, angularSpanDeg, aspect, meanR };
}

/**
 * 타원/원 후보 여부. strict 는 live 홀드용, relaxed 는 펜을 바로 뗄 때·불완전 원호용.
 * aspect 가 너무 크면(납작한 호/선에 가까움) 제외해 line 과 충돌을 막는다.
 */
function looksLikeEllipse(vertices: readonly Pt[], mode: "strict" | "relaxed"): boolean {
  const { radialCv, angularSpanDeg, aspect, meanR } = ellipseShapeStats(vertices);
  if (!(meanR >= QUICKSHAPE_MIN_SIZE_PX * 0.35)) return false;
  if (aspect > QUICKSHAPE_ELLIPSE_MAX_ASPECT) return false;
  const cvMax = mode === "strict" ? QUICKSHAPE_ELLIPSE_RADIAL_CV_MAX : QUICKSHAPE_ELLIPSE_RADIAL_CV_MAX_RELAXED;
  if (radialCv > cvMax) return false;
  // 거의 닫힌 루프는 스팬 문턱을 낮추고, 열린 원호는 충분히 돌아야 한다.
  const minSpan = mode === "strict" ? 200 : QUICKSHAPE_ELLIPSE_MIN_ANGULAR_SPAN_DEG;
  return angularSpanDeg >= minSpan;
}

function bboxPoints(bbox: { minX: number; minY: number; maxX: number; maxY: number }): [number, number, number, number] {
  return [round2(bbox.minX), round2(bbox.minY), round2(bbox.maxX), round2(bbox.maxY)];
}

// ---------------------------------------------------------------------------
// 열린 스트로크 분기 — 전체최소제곱(PCA) 직선 적합
// ---------------------------------------------------------------------------

function classifyOpenStroke(points: readonly number[], startPt: Pt): QuickShapeMatch | null {
  const vertices = toVertices(points);
  const n = vertices.length;
  let sx = 0;
  let sy = 0;
  for (const p of vertices) {
    sx += p.x;
    sy += p.y;
  }
  const cx = sx / n;
  const cy = sy / n;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of vertices) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);

  let sumSqResidual = 0;
  let minProj = Infinity;
  let maxProj = -Infinity;
  for (const p of vertices) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const proj = dx * dirX + dy * dirY;
    const perp = -dx * dirY + dy * dirX;
    sumSqResidual += perp * perp;
    if (proj < minProj) minProj = proj;
    if (proj > maxProj) maxProj = proj;
  }
  const span = maxProj - minProj;
  if (span < 1e-6) return null; // 사실상 한 점 — MIN_SIZE_PX 가드가 대부분 걸러내지만 방어적으로.

  const rms = Math.sqrt(sumSqResidual / n);
  const deviationRatio = rms / span;
  if (deviationRatio > QUICKSHAPE_LINE_MAX_DEVIATION_RATIO) return null;

  const ex = cx + dirX * minProj;
  const ey = cy + dirY * minProj;
  const fx = cx + dirX * maxProj;
  const fy = cy + dirY * maxProj;

  // 원본 스트로크의 실제 시작점에 더 가까운 쪽을 첫 좌표로 둬 그리기 방향감을 보존한다
  // (순수하게 기능적으로는 순서가 중요하지 않지만 — anchorQuickShapePoints/regularize 는 어느
  // 쪽이 첫 점이든 동작한다 — 사용자가 그은 방향과 어긋나 보이지 않게 하기 위한 마감).
  const distE = Math.hypot(ex - startPt.x, ey - startPt.y);
  const distF = Math.hypot(fx - startPt.x, fy - startPt.y);
  const [ax, ay, bx, by] = distE <= distF ? [ex, ey, fx, fy] : [fx, fy, ex, ey];

  return { kind: "line", points: [round2(ax), round2(ay), round2(bx), round2(by)] };
}

// ---------------------------------------------------------------------------
// 닫힌 루프 분기 — 코너 카운팅
// ---------------------------------------------------------------------------

function classifyClosedLoop(
  points: readonly number[],
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  options?: { relaxTriangle?: boolean; relaxEllipse?: boolean; relaxPolygon?: boolean }
): QuickShapeMatch | null {
  const vertices = toVertices(points);
  const loop = resampleClosedLoop(vertices, QUICKSHAPE_RESAMPLE_COUNT);
  const cornerIndices = detectCorners(loop, QUICKSHAPE_CORNER_ANGLE_THRESHOLD_DEG);
  const cornerCount = cornerIndices.length;
  const outPoints = bboxPoints(bbox);
  const ellipseMode = options?.relaxEllipse ? "relaxed" : "strict";
  const tryEllipse = (): QuickShapeMatch | null =>
    looksLikeEllipse(vertices, ellipseMode) ? { kind: "ellipse", points: outPoints } : null;

  if (cornerCount === 0) {
    // 코너 0은 원형의 1차 신호. 다만 아주 찌그러진 루프(장단축 과다)는 ellipse 가드가 막는다.
    return tryEllipse() ?? { kind: "ellipse", points: outPoints };
  }

  // 가짜 코너 1~2개(원 곡률 스파이크) — 다각형 후보가 아니므로 원형 폴백만 시도.
  if (cornerCount === 1 || cornerCount === 2) {
    return tryEllipse();
  }

  const sideDev = maxSideDeviationRatio(loop, cornerIndices);
  const triDevMax = options?.relaxTriangle
    ? QUICKSHAPE_TRIANGLE_MAX_SIDE_DEVIATION_RATIO
    : Math.min(QUICKSHAPE_TRIANGLE_MAX_SIDE_DEVIATION_RATIO, QUICKSHAPE_MAX_SIDE_DEVIATION_RATIO + 0.06);
  // live 에서도 삼각형은 rect 보다 약간 관대(0.24), release 는 0.28.

  if (cornerCount === 3) {
    if (sideDev <= triDevMax) return { kind: "triangle", points: outPoints };
    // 원 오검출 코너 3개(현 편차 큼) → 원형 폴백. 진짜 휘어진 삼각형은 폴백 실패 시 null.
    return tryEllipse();
  }

  if (cornerCount === 4) {
    if (sideDev > QUICKSHAPE_MAX_SIDE_DEVIATION_RATIO) {
      // 원/타원에 가짜 코너 4개가 잡힌 경우.
      return tryEllipse();
    }
    // Konva RegularPolygon(sides=4)은 마름모로 렌더되어 손그림 사각형과 전혀 달라 보이므로,
    // 4코너는 항상 "rect"(바운딩 박스, 각도 무시)로 보낸다 — 나비매듭은 변 자체가 곧아 위
    // 직선성 검사를 통과해버리므로(자기교차는 "휜 변"이 아니라 "겹친 변" 문제) 별도 가드가 필요하다.
    const [c0, c1, c2, c3] = cornerIndices.map((i) => loop[i]!) as [Pt, Pt, Pt, Pt];
    if (segmentsIntersect(c0, c1, c2, c3) || segmentsIntersect(c1, c2, c3, c0)) {
      // 자기교차 낙서 — 원형으로도 보지 않는다.
      return null;
    }
    return { kind: "rect", points: outPoints };
  }

  if (cornerCount >= QUICKSHAPE_MIN_POLYGON_SIDES && cornerCount <= QUICKSHAPE_MAX_POLYGON_SIDES) {
    const polygonSideDevMax = options?.relaxPolygon
      ? QUICKSHAPE_RELEASE_POLYGON_MAX_SIDE_DEVIATION_RATIO
      : QUICKSHAPE_MAX_SIDE_DEVIATION_RATIO;
    const polygonSideLengthCvMax = options?.relaxPolygon
      ? QUICKSHAPE_RELEASE_POLYGON_SIDE_LENGTH_CV_MAX
      : QUICKSHAPE_SIDE_LENGTH_CV_MAX;
    if (sideDev > polygonSideDevMax) {
      return tryEllipse();
    }
    if (sideLengthCV(loop, cornerIndices) > polygonSideLengthCvMax) {
      return tryEllipse();
    }
    const sides = clampInt(
      clampInt(cornerCount, QUICKSHAPE_MIN_POLYGON_SIDES, QUICKSHAPE_MAX_POLYGON_SIDES),
      SHAPE_PARAM_RANGES.polygonSides.min,
      SHAPE_PARAM_RANGES.polygonSides.max
    );
    return { kind: "polygon", points: outPoints, polygonSides: sides };
  }

  // N>MAX 등 — 원형 폴백 후 포기.
  return tryEllipse();
}

// ---------------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------------

/**
 * 스트로크 지금까지의 points 와 "이 자리에 몇 ms째 정지해 있는가"를 받아 도형 매치를 시도한다.
 * holdDurationMs < QUICKSHAPE_HOLD_MS 면 항상 null. 자신 있는 매치가 없으면 null(추측하지 않음).
 */
export function classifyQuickShape(points: readonly number[], holdDurationMs: number): QuickShapeMatch | null {
  if (!Number.isFinite(holdDurationMs) || holdDurationMs < QUICKSHAPE_HOLD_MS) return null; // NaN<임계값은 항상 false라 isFinite 가드가 필수.
  if (points.length % 2 !== 0) return null;
  if (points.some((v) => typeof v !== "number" || !Number.isFinite(v))) return null;

  const pointCount = points.length / 2;
  if (pointCount < QUICKSHAPE_MIN_POINTS) return null;

  const bbox = boundsOfPoints(points);
  const diag = Math.hypot(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
  if (diag < QUICKSHAPE_MIN_SIZE_PX) return null;

  const total = polylineLength(points);
  if (total < 1e-6) return null;

  const x0 = points[0]!;
  const y0 = points[1]!;
  const xn = points[points.length - 2]!;
  const yn = points[points.length - 1]!;
  const closureRatio = Math.hypot(xn - x0, yn - y0) / total;

  // 두 분기는 상호 배타적(닫힘 비율 하나로만 갈린다) — 매우 납작한 타원처럼 닫힘 비율은 작지만
  // 거의 직선처럼 보이는 경우도 닫힌-루프 분기의 "코너 0개 → ellipse"로 올바르게 처리된다.
  if (closureRatio > QUICKSHAPE_CLOSURE_RATIO) {
    return classifyOpenStroke(points, { x: x0, y: y0 });
  }
  return classifyClosedLoop(points, bbox);
}

/**
 * 이미 인식된 도형의 현재 points 를 "정비율"로 스냅한다(2단계 홀드에서 1회 호출).
 * rect/ellipse/triangle/polygon: points[0],points[1](고정 모서리)을 앵커로 정사각형화
 *   — 기존 onStageMove 의 Shift 락(`s=max(|dx|,|dy|); x1=x0+sign*s; ...`)과 동일 공식이라
 *     수동 Shift 락과 시각적으로 100% 일관된다(의도적 소량 중복).
 * line: 현재 각도를 가장 가까운 45° 배수로 스냅(길이는 보존), 기존 Shift 스냅과 동일 감각.
 */
export function regularizeQuickShapePoints(
  kind: QuickShapeKind,
  points: readonly [number, number, number, number]
): [number, number, number, number] {
  const [x0, y0, x1, y1] = points;

  if (kind === "line") {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return [round2(x0), round2(y0), round2(x1), round2(y1)];
    const angle = Math.atan2(dy, dx);
    const step = Math.PI / 4;
    const snappedAngle = Math.round(angle / step) * step;
    return [
      round2(x0),
      round2(y0),
      round2(x0 + Math.cos(snappedAngle) * len),
      round2(y0 + Math.sin(snappedAngle) * len),
    ];
  }

  const dx = x1 - x0;
  const dy = y1 - y0;
  const s = Math.max(Math.abs(dx), Math.abs(dy));
  const nx = x0 + Math.sign(dx || 1) * s;
  const ny = y0 + Math.sign(dy || 1) * s;
  return [round2(x0), round2(y0), round2(nx), round2(ny)];
}

/**
 * 인식된 도형을 "지금 정지한 지점"에 물린다 — 4개 모서리(선은 두 끝점) 중 anchor 에서 가장 먼
 * 점을 고정하고, 가장 가까운 점을 anchor 로 옮긴다. 그 이후의 포인터 이동은 StudioPage의 기존
 * onStageMove 비-freehand 분기가 그대로 이어받아 처리한다(그 분기는 손대지 않는다).
 * anchor와 실제 인식된 도형의 가장 가까운 모서리 사이의 거리(≤ QUICKSHAPE_STILL_RADIUS_PX 보장됨,
 * "정지"의 정의상)만큼의 시각적 미세 팝(≤6px)이 발생할 수 있음 — 허용 가능한 트레이드오프.
 */
/**
 * Pointer-up promotion: skip the live hold timer and snap if geometry already looks like a shape.
 * Live preview still uses hold; release uses this so users who lift immediately still get a snap.
 *
 * Classification is intentionally a bit more lenient than the live tick path — release is a
 * one-shot confirm gesture and real pen/finger strokes rarely meet the strict live thresholds.
 */
export function promoteFreehandQuickShapeOnRelease(
  points: readonly number[],
  options?: {
    anchor?: { x: number; y: number } | null;
    /** When true (long hold already accumulated), snap to square/circle/45° line. */
    lockAspect?: boolean;
  }
): QuickShapeMatch | null {
  // Pass the hold gate without requiring the user to stay still for 350ms on release.
  // Prefer the strict classifier first (same as live), then a release-tolerant pass.
  const match =
    classifyQuickShape(points, QUICKSHAPE_HOLD_MS)
    ?? classifyQuickShapeForRelease(points);
  if (!match) return null;
  const lastX = points[points.length - 2];
  const lastY = points[points.length - 1];
  const anchor =
    options?.anchor
    ?? (typeof lastX === "number" && typeof lastY === "number" ? { x: lastX, y: lastY } : { x: match.points[0], y: match.points[1] });
  const anchored = anchorQuickShapePoints(match.kind, match.points, anchor);
  const finalPoints = options?.lockAspect
    ? regularizeQuickShapePoints(match.kind, anchored)
    : anchored;
  return {
    kind: match.kind,
    points: finalPoints,
    ...(match.polygonSides !== undefined ? { polygonSides: match.polygonSides } : {}),
  };
}

/**
 * Release-only classification with relaxed closure/line residual gates.
 * Does not replace live hold recognition; only backs stop-and-lift confirmations.
 */
export function classifyQuickShapeForRelease(points: readonly number[]): QuickShapeMatch | null {
  if (points.length % 2 !== 0) return null;
  if (points.some((v) => typeof v !== "number" || !Number.isFinite(v))) return null;

  const pointCount = points.length / 2;
  // Allow slightly shorter scribbles on lift (live still requires QUICKSHAPE_MIN_POINTS).
  if (pointCount < Math.max(4, QUICKSHAPE_MIN_POINTS - 1)) return null;

  const bbox = boundsOfPoints(points);
  const diag = Math.hypot(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
  if (diag < QUICKSHAPE_MIN_SIZE_PX) return null;

  const total = polylineLength(points);
  if (total < 1e-6) return null;

  const x0 = points[0]!;
  const y0 = points[1]!;
  const xn = points[points.length - 2]!;
  const yn = points[points.length - 1]!;
  // More open ends still count as "trying to close" on release (finger often lifts early).
  const closureRatio = Math.hypot(xn - x0, yn - y0) / total;
  // 원/삼각형은 끝이 덜 닫힌 채 손을 떼는 경우가 흔해 live(0.22)보다 더 관대하게 닫힘으로 본다.
  const releaseClosure = Math.min(0.42, QUICKSHAPE_CLOSURE_RATIO + 0.2);
  const vertices = toVertices(points);

  if (closureRatio > releaseClosure) {
    // 열린 경로: 직선 우선, 그다음 원호(불완전 원), 마지막에 느슨한 직선.
    const line = classifyOpenStroke(points, { x: x0, y: y0 });
    if (line) return line;
    if (looksLikeEllipse(vertices, "relaxed")) {
      return { kind: "ellipse", points: bboxPoints(bbox) };
    }
    // 열린 삼각형 낙서 — 낮은 각도 문턱으로 코너를 한 번 더 잡아 본다.
    const openTri = classifyLooseTriangle(points, bbox);
    if (openTri) return openTri;
    return classifyLooseLine(points, { x: x0, y: y0 });
  }
  // 닫힌(또는 거의 닫힌) 경로: 삼각형 변 편차·원형 폴백을 완화한 닫힌 루프 분류.
  return (
    classifyClosedLoop(points, bbox, { relaxTriangle: true, relaxEllipse: true, relaxPolygon: true })
    ?? classifyLooseTriangle(points, bbox)
  );
}

/**
 * Release 전용 — 코너 문턱을 낮춰 손그림 삼각형(둥근 꼭짓점)을 다시 잡는다.
 * live 경로에는 쓰지 않는다(원 오검출을 늘릴 수 있음).
 */
function classifyLooseTriangle(
  points: readonly number[],
  bbox: { minX: number; minY: number; maxX: number; maxY: number }
): QuickShapeMatch | null {
  const vertices = toVertices(points);
  if (vertices.length < 5) return null;
  // 열린 스트로크도 가상으로 닫아 코너를 센다(끝이 덜 붙은 삼각형).
  const loop = resampleClosedLoop(vertices, QUICKSHAPE_RESAMPLE_COUNT);
  const softCorners = detectCorners(loop, Math.max(18, QUICKSHAPE_CORNER_ANGLE_THRESHOLD_DEG - 10));
  if (softCorners.length !== 3) return null;
  if (maxSideDeviationRatio(loop, softCorners) > QUICKSHAPE_TRIANGLE_MAX_SIDE_DEVIATION_RATIO) {
    return null;
  }
  // 원형에 가까운 3코너 오검출은 제외(이미 ellipse 후보였을 것).
  if (looksLikeEllipse(vertices, "relaxed")) return null;
  return { kind: "triangle", points: bboxPoints(bbox) };
}

/** Slightly looser open-stroke line accept for release-only promotion. */
function classifyLooseLine(points: readonly number[], startPt: Pt): QuickShapeMatch | null {
  const tight = classifyOpenStroke(points, startPt);
  if (tight) return tight;
  // Re-run PCA residual with 1.6× tolerance of the live gate.
  const vertices = toVertices(points);
  const n = vertices.length;
  if (n < 3) return null;
  let sx = 0;
  let sy = 0;
  for (const p of vertices) {
    sx += p.x;
    sy += p.y;
  }
  const cx = sx / n;
  const cy = sy / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of vertices) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  let sumSqResidual = 0;
  let minProj = Infinity;
  let maxProj = -Infinity;
  for (const p of vertices) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const proj = dx * dirX + dy * dirY;
    const perp = -dx * dirY + dy * dirX;
    sumSqResidual += perp * perp;
    if (proj < minProj) minProj = proj;
    if (proj > maxProj) maxProj = proj;
  }
  const span = maxProj - minProj;
  if (span < QUICKSHAPE_MIN_SIZE_PX) return null;
  const rms = Math.sqrt(sumSqResidual / n);
  if (rms / span > QUICKSHAPE_LINE_MAX_DEVIATION_RATIO * 1.75) return null;
  const ex = cx + dirX * minProj;
  const ey = cy + dirY * minProj;
  const fx = cx + dirX * maxProj;
  const fy = cy + dirY * maxProj;
  const distE = Math.hypot(ex - startPt.x, ey - startPt.y);
  const distF = Math.hypot(fx - startPt.x, fy - startPt.y);
  const [ax, ay, bx, by] = distE <= distF ? [ex, ey, fx, fy] : [fx, fy, ex, ey];
  return { kind: "line", points: [round2(ax), round2(ay), round2(bx), round2(by)] };
}

export function anchorQuickShapePoints(
  kind: QuickShapeKind,
  points: readonly [number, number, number, number],
  anchor: { x: number; y: number }
): [number, number, number, number] {
  if (kind === "line") {
    const [x0, y0, x1, y1] = points;
    const d0 = Math.hypot(x0 - anchor.x, y0 - anchor.y);
    const d1 = Math.hypot(x1 - anchor.x, y1 - anchor.y);
    return d0 >= d1
      ? [round2(x0), round2(y0), round2(anchor.x), round2(anchor.y)]
      : [round2(anchor.x), round2(anchor.y), round2(x1), round2(y1)];
  }

  // A rectangle conventionally closes on a bounding-box corner, so attaching that corner to the
  // live pointer preserves the intended drag continuation. Ellipses and regular polygons do not:
  // their closing point is normally the right/top curve point or an outer vertex, which is often
  // halfway along a bounding-box edge. Treating that point as a box corner cuts one axis roughly
  // in half on release (most visibly for triangles and tall polygons). Their recognized bbox is
  // already authoritative; preserve it instead of inventing a corner from the closing pointer.
  if (kind !== "rect") {
    return [round2(points[0]), round2(points[1]), round2(points[2]), round2(points[3])];
  }

  const [x0, y0, x1, y1] = points;
  const corners: Pt[] = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  let farIdx = 0;
  let farDist = -Infinity;
  for (let i = 0; i < corners.length; i++) {
    const d = Math.hypot(corners[i]!.x - anchor.x, corners[i]!.y - anchor.y);
    if (d > farDist) {
      farDist = d;
      farIdx = i;
    }
  }
  const fixed = corners[farIdx]!;
  return [round2(fixed.x), round2(fixed.y), round2(anchor.x), round2(anchor.y)];
}

export interface QuickShapeLiveDragAnchor {
  /** Full recognized bounds, oriented as fixed corner -> moving corner. */
  readonly points: [number, number, number, number];
  /** Added to the live pointer before replacing points[2..3]. */
  readonly pointerOffset: { readonly x: number; readonly y: number };
}

/**
 * Prepares a recognized shape for continued pointer-down resizing without changing its bounds.
 *
 * Pointer-up promotion intentionally uses `anchorQuickShapePoints`: ellipse/triangle/polygon keep
 * their authoritative bbox because their closing point is normally on an edge, not a bbox corner.
 * A live hold has an additional requirement: later pointer moves must still resize the shape. For
 * non-rect shapes, orient the full bbox from the corner opposite the pointer to the nearest corner
 * and retain the pointer-to-corner offset. Applying that offset on later moves avoids the first
 * 1 px move collapsing an ellipse or polygon to the closing pointer's edge position.
 */
export function anchorQuickShapePointsForLiveDrag(
  kind: QuickShapeKind,
  points: readonly [number, number, number, number],
  anchor: { x: number; y: number }
): QuickShapeLiveDragAnchor {
  if (kind === "line" || kind === "rect") {
    const anchored = anchorQuickShapePoints(kind, points, anchor);
    return {
      points: anchored,
      pointerOffset: {
        x: round2(anchored[2] - anchor.x),
        y: round2(anchored[3] - anchor.y),
      },
    };
  }

  const minX = Math.min(points[0], points[2]);
  const minY = Math.min(points[1], points[3]);
  const maxX = Math.max(points[0], points[2]);
  const maxY = Math.max(points[1], points[3]);
  const corners: readonly Pt[] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
  let movingIndex = 0;
  let nearestDistance = Infinity;
  for (let index = 0; index < corners.length; index += 1) {
    const corner = corners[index]!;
    const distance = Math.hypot(corner.x - anchor.x, corner.y - anchor.y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      movingIndex = index;
    }
  }
  const moving = corners[movingIndex]!;
  const fixed = corners[(movingIndex + 2) % corners.length]!;
  return {
    points: [round2(fixed.x), round2(fixed.y), round2(moving.x), round2(moving.y)],
    pointerOffset: {
      x: round2(moving.x - anchor.x),
      y: round2(moving.y - anchor.y),
    },
  };
}
