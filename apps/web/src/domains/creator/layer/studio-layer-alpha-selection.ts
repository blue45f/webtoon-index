/**
 * Studio Layer Alpha → Selection — "레이어 불투명도를 선택 범위로" 순수 코어.
 *
 * 포토샵의 레이어 썸네일 Ctrl(⌘)+클릭 = "이 레이어가 실제로 칠해져 있는 자리"를 그대로 선택으로
 * 가져오는 동작. 셀 채색·광원 합성·후처리 마스킹의 출발점이라 없으면 매번 마술봉으로 흉내 내야 한다.
 *
 * 문제: PixelSelection(studio-selection-tools.ts)은 **벡터** 모델(폴리곤/브러시 서브패스)이라
 * 알파 래스터를 그대로 담을 수 없다. 그래서 알파 채널 → 이진화 → 윤곽선(닫힌 링) 추출 →
 * 서브패스 결합이라는 변환이 필요하다.
 *
 * 재사용(기하 코드 중복 금지 원칙):
 *  - 경계 추적은 studio-magic-wand.ts의 traceMaskContours(격자 크랙 추적 — 마칭스퀘어와 동치인
 *    "전경을 항상 진행 방향 오른쪽에 두는" 방향성 간선 걷기)를 쓴다. 대각선 모호성(체커보드)은
 *    그쪽 desaddleMask가 이미 결정적으로 해소한다.
 *  - 분리 성분(4방향) 라벨링 + 성분별 추적은 studio-quick-mask.ts의 traceMaskRegions를 공유한다
 *    (퀵 마스크 종료 경로와 **같은 구현**이다 — 링 순서 계약도 그쪽 docstring이 정본).
 *  - 1차 단순화(simplifyLassoPolygon)는 traceMaskContours 안에서 이미 돌아간다.
 *    이 모듈은 그 위에 **오차 한계가 보장되는 2차 단순화(RDP)** 를 얹는다.
 *
 * 점 수 예산 — 세 겹으로 막는다(실측 근거 포함):
 *   (1) 추적 해상도 캡 — 긴 변 LAYER_ALPHA_TRACE_MAX_DIM(640)으로 박스 평균 다운샘플.
 *       크랙 둘레의 상한이 대략 4·640 = 2560 꼭짓점으로 묶인다.
 *   (2) simplifyLassoPolygon(1차) — 중복점 제거 문턱이 **정규화 거리** LASSO_MIN_POINT_DIST
 *       (0.004 = 박스의 0.4%)라서, 실은 무손실이 아니라 해상도 의존 데시메이션이다. 덕분에
 *       링 하나가 이미 수백 점 규모로 떨어진다(1200px 원판 실측: 원본 해상도 추적에서도 346점).
 *       다만 이건 "가까운 점 버리기"라 **모양 오차 한계가 없다** — 뾰족한 모서리를 깎을 수 있다.
 *   (3) Ramer–Douglas–Peucker(2차) — 텍셀 단위 허용오차(기본 0.75텍셀) 안에서만 점을 버리므로
 *       모양 오차가 그 값으로 **보장**된다(1200px 원판 실측: 335 → 158점). 그래도 링이
 *       maxPointsPerRing을 넘으면 허용오차를 2배씩 올려 재시도하고(최대 8회), 끝내 안 되면
 *       균일 데시메이션으로 절단한다 — 결과적으로 점 수에 **하드 상한**이 있다.
 *
 * 결정성 계약(같은 입력 → 같은 링 배열, 바이트 단위로):
 *   - 링 순서: 성분은 시드 픽셀 래스터 스캔 순서(traceMaskRegions 계약 — 감싸는 성분이 항상 먼저),
 *     성분 안에서는 외곽 링 1개 뒤에 구멍 링들이 앵커((y,x) 사전순 최소 꼭짓점) 오름차순.
 *   - 링 방향: 외곽은 부호 있는 면적 > 0, 구멍은 < 0 (x→오른쪽 / y→아래 좌표계 기준). 강제 적용.
 *   - 꼭짓점 순서: 각 링은 앵커 꼭짓점이 index 0이 되도록 회전시켜 저장한다 — 추적 시작점이나
 *     Map 순회 순서에 결과가 흔들리지 않는다.
 *
 * 정직한 근사(문서화):
 *   - 소프트(안티에일리어싱) 경계는 이진 문턱 하나로 잘린다 — 기본 128이면 "알파 50% 지점"이
 *     경계다. 반투명 그라데이션 레이어는 그 등고선 하나로 축약된다(포토샵은 소프트 선택을
 *     그대로 갖지만 이 앱의 선택 모델은 페더 스칼라 1개뿐이라는 기존 한계와 같은 축).
 *   - 다운샘플은 박스 평균이라, 1텍셀 두께의 얇은 선은 평균이 문턱 아래로 내려가 사라질 수 있다.
 *     그럴 땐 maxDim을 올려 호출한다.
 *
 * DOM 의존성 0 · 전부 결정적(랜덤/Date 없음) — node 환경에서 그대로 유닛 테스트한다.
 */
import { flipMagicWandRegion, MAGIC_WAND_MAX_LOOPS, MAGIC_WAND_TRACE_MAX_DIM } from "../studio-magic-wand";
import { traceMaskRegions } from "../studio-quick-mask";
import {
  addSelectionSubpath,
  isSelectionUsable,
  SELECTION_FEATHER_RANGE,
  type PixelSelection,
  type SelPoint,
} from "../studio-selection-tools";

// ---------------------------------------------------------------------------
// (A) 상수 · 타입
// ---------------------------------------------------------------------------

/** 알파 → 선택 이진화 문턱(0..255) — 퀵 마스크의 QUICK_MASK_SELECTION_THRESHOLD와 같은 "절반" 규약. */
export const LAYER_ALPHA_SELECTION_THRESHOLD_DEFAULT = 128;
/** 추적 해상도 상한(긴 변 텍셀) — 마술봉/퀵 마스크와 같은 값이라 세 도구의 경계 체감이 일치한다. */
export const LAYER_ALPHA_TRACE_MAX_DIM = MAGIC_WAND_TRACE_MAX_DIM;
/** RDP 기본 허용오차(추적 텍셀) — 1텍셀 미만이라 계단만 펴고 실루엣은 보존한다. */
export const LAYER_ALPHA_SIMPLIFY_TOLERANCE_TEXELS = 0.75;
/** 링 1개의 꼭짓점 하드 상한 — 넘으면 허용오차 상향 → 균일 데시메이션 순으로 강제한다. */
export const LAYER_ALPHA_MAX_POINTS_PER_RING = 512;
/** 허용오차 상향 재시도 횟수 상한(매회 2배). */
const SIMPLIFY_ESCALATION_LIMIT = 8;

/** 단일 채널 알파 비트맵 — RGBA가 아니라 알파만 뽑아 든 형태. */
export type AlphaBitmap = {
  readonly width: number;
  readonly height: number;
  /** width*height, 0=완전 투명 · 255=완전 불투명. */
  readonly alpha: Uint8ClampedArray;
};

/** 추출된 닫힌 링 1개 — 정규화(0..1) 꼭짓점 배열. 첫 점과 끝 점은 중복하지 않는다(암묵 닫힘). */
export type AlphaContourRing = {
  readonly points: SelPoint[];
  /** outer = 칠해진 영역의 바깥 테두리, hole = 그 안의 구멍. */
  readonly kind: "outer" | "hole";
  /** 이 링이 속한 연결 성분 번호(0부터, traceMaskRegions 순서). */
  readonly componentIndex: number;
  /** 구멍이면 감싸는 외곽 링의 rings 배열 인덱스, 외곽이면 -1. */
  readonly parent: number;
  /** 부호 있는 면적(정규화 단위²) — 외곽은 양수, 구멍은 음수. */
  readonly signedArea: number;
};

export type TraceAlphaContourOptions = {
  /** 이진화 문턱(1..255). 기본 LAYER_ALPHA_SELECTION_THRESHOLD_DEFAULT. */
  threshold?: number;
  /** 유지할 최대 분리 성분 수. 기본 MAGIC_WAND_MAX_LOOPS. */
  maxRegions?: number;
  /** RDP 허용오차(텍셀). 0 이하면 2차 단순화를 끄고 1차 결과를 그대로 쓴다. */
  simplifyToleranceTexels?: number;
  /** 링 1개 꼭짓점 상한. 기본 LAYER_ALPHA_MAX_POINTS_PER_RING. */
  maxPointsPerRing?: number;
  /** 요소가 좌우/상하 반전 표시 중이면 true — 원본 픽셀 좌표를 표시 좌표로 되돌린다. */
  flipX?: boolean;
  flipY?: boolean;
};

// ---------------------------------------------------------------------------
// (B) 알파 비트맵 만들기 · 줄이기
// ---------------------------------------------------------------------------

function sanitizeDim(v: number): number | null {
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.max(1, Math.round(v));
}

/**
 * RGBA 평탄 배열에서 알파 채널만 뽑는다. 길이가 width*height*4 미만이면 null.
 * (ImageData.data를 그대로 넘기면 된다 — 캔버스 의존은 호출부 몫.)
 */
export function alphaBitmapFromRgba(
  rgba: ArrayLike<number>,
  width: number,
  height: number
): AlphaBitmap | null {
  const w = sanitizeDim(width);
  const h = sanitizeDim(height);
  if (!w || !h) return null;
  if (rgba.length < w * h * 4) return null;
  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i += 1) alpha[i] = rgba[i * 4 + 3] ?? 0;
  return { width: w, height: h, alpha };
}

/**
 * 추적 해상도로 줄인다 — 목적지 텍셀이 덮는 원본 픽셀 블록의 **산술 평균**(박스 필터).
 * 이미 상한 이하면 원본을 그대로 반환한다(복사 없음 — 불변 취급이라 안전).
 * 종횡비 유지, 최소 1텍셀. 결정적(부동소수 누적 순서가 스캔 순서로 고정).
 */
export function downsampleAlphaBitmap(bitmap: AlphaBitmap, maxDim = LAYER_ALPHA_TRACE_MAX_DIM): AlphaBitmap {
  const cap = Number.isFinite(maxDim) && maxDim > 0 ? Math.round(maxDim) : LAYER_ALPHA_TRACE_MAX_DIM;
  const longSide = Math.max(bitmap.width, bitmap.height);
  if (longSide <= cap) return bitmap;
  const scale = cap / longSide;
  const tw = Math.max(1, Math.round(bitmap.width * scale));
  const th = Math.max(1, Math.round(bitmap.height * scale));
  const out = new Uint8ClampedArray(tw * th);
  for (let j = 0; j < th; j += 1) {
    const sy0 = Math.floor((j * bitmap.height) / th);
    const sy1 = Math.max(sy0 + 1, Math.floor(((j + 1) * bitmap.height) / th));
    for (let i = 0; i < tw; i += 1) {
      const sx0 = Math.floor((i * bitmap.width) / tw);
      const sx1 = Math.max(sx0 + 1, Math.floor(((i + 1) * bitmap.width) / tw));
      let sum = 0;
      let count = 0;
      for (let sy = sy0; sy < sy1 && sy < bitmap.height; sy += 1) {
        const row = sy * bitmap.width;
        for (let sx = sx0; sx < sx1 && sx < bitmap.width; sx += 1) {
          sum += bitmap.alpha[row + sx]!;
          count += 1;
        }
      }
      out[j * tw + i] = count > 0 ? sum / count : 0;
    }
  }
  return { width: tw, height: th, alpha: out };
}

// ---------------------------------------------------------------------------
// (C) 링 정규화 — 방향 · 앵커 회전 · RDP 단순화
// ---------------------------------------------------------------------------

/** 신발끈 부호 있는 면적(x→오른쪽, y→아래 좌표계). 양수=외곽 방향, 음수=구멍 방향. */
function signedAreaNorm(points: readonly SelPoint[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}

/** 앵커 = (y, x) 사전순 최소 꼭짓점의 인덱스(동률이면 작은 인덱스). */
function anchorIndex(points: readonly SelPoint[]): number {
  let best = 0;
  for (let i = 1; i < points.length; i += 1) {
    const p = points[i]!;
    const b = points[best]!;
    if (p.y < b.y || (p.y === b.y && p.x < b.x)) best = i;
  }
  return best;
}

/** 앵커가 index 0이 되도록 회전(불변) — 추적 시작점 의존성을 제거한다. */
function rotateToAnchor(points: readonly SelPoint[]): SelPoint[] {
  if (points.length < 2) return points.slice();
  const a = anchorIndex(points);
  if (a === 0) return points.slice();
  return [...points.slice(a), ...points.slice(0, a)];
}

/** 점-선분 수직거리² (텍셀 공간). */
function perpDistSq(p: SelPoint, a: SelPoint, b: SelPoint, sx: number, sy: number): number {
  const px = p.x * sx;
  const py = p.y * sy;
  const ax = a.x * sx;
  const ay = a.y * sy;
  const bx = b.x * sx;
  const by = b.y * sy;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 0) {
    const ex = px - ax;
    const ey = py - ay;
    return ex * ex + ey * ey;
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = px - (ax + t * dx);
  const ey = py - (ay + t * dy);
  return ex * ex + ey * ey;
}

/**
 * 열린 폴리라인 RDP — keep 배열에 유지할 인덱스를 표시한다(명시 스택, 재귀 없음).
 * 같은 최대거리가 여러 곳이면 **작은 인덱스**를 고른다(결정적 타이브레이크).
 */
function rdpMark(
  pts: readonly SelPoint[],
  first: number,
  last: number,
  tolSq: number,
  sx: number,
  sy: number,
  keep: boolean[]
): void {
  const stack: [number, number][] = [[first, last]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    if (hi <= lo + 1) continue;
    let maxDist = -1;
    let maxIdx = -1;
    for (let i = lo + 1; i < hi; i += 1) {
      const d = perpDistSq(pts[i]!, pts[lo]!, pts[hi]!, sx, sy);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxIdx < 0 || maxDist <= tolSq) continue;
    keep[maxIdx] = true;
    stack.push([lo, maxIdx], [maxIdx, hi]);
  }
}

/**
 * 닫힌 링 RDP — 앵커(index 0)와 앵커에서 가장 먼 점 두 곳을 고정 분할점으로 잡아 두 개의 열린
 * 폴리라인으로 나눈 뒤 각각 RDP한다(닫힌 곡선 RDP의 표준 처리 — 시작점 하나만 고정하면 그
 * 주변이 통째로 잘려 링이 찌그러진다). 결과가 3점 미만이면 원본을 돌려준다.
 */
function simplifyClosedRing(
  points: readonly SelPoint[],
  toleranceTexels: number,
  width: number,
  height: number
): SelPoint[] {
  const n = points.length;
  if (n < 4 || !(toleranceTexels > 0)) return points.slice();
  const tolSq = toleranceTexels * toleranceTexels;
  // 링을 앵커에서 앵커로 되돌아오는 열린 폴리라인(n+1점)으로 편다.
  const open: SelPoint[] = [...points, points[0]!];
  let far = 1;
  let farDist = -1;
  for (let i = 1; i < n; i += 1) {
    const dx = (points[i]!.x - points[0]!.x) * width;
    const dy = (points[i]!.y - points[0]!.y) * height;
    const d = dx * dx + dy * dy;
    if (d > farDist) {
      farDist = d;
      far = i;
    }
  }
  const keep = new Array<boolean>(open.length).fill(false);
  keep[0] = true;
  keep[far] = true;
  keep[open.length - 1] = true;
  rdpMark(open, 0, far, tolSq, width, height, keep);
  rdpMark(open, far, open.length - 1, tolSq, width, height, keep);
  const out: SelPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    if (keep[i]) out.push(points[i]!);
  }
  return out.length >= 3 ? out : points.slice();
}

/** 균일 데시메이션(최후 수단) — 인덱스를 등간격으로 골라 하드 상한을 강제한다. */
function decimateRing(points: readonly SelPoint[], maxPoints: number): SelPoint[] {
  const n = points.length;
  if (n <= maxPoints || maxPoints < 3) return points.slice();
  const out: SelPoint[] = [];
  for (let k = 0; k < maxPoints; k += 1) {
    const idx = Math.min(n - 1, Math.round((k * n) / maxPoints));
    const p = points[idx]!;
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  return out.length >= 3 ? out : points.slice(0, Math.max(3, Math.min(n, maxPoints)));
}

/**
 * 링 하나를 규범형으로 만든다: (1) 방향 강제 → (2) 앵커 회전 → (3) RDP(+예산 초과 시 허용오차
 * 상향 재시도 → 균일 데시메이션) → (4) 앵커 재회전. 3점 미만이 되면 null(버림).
 */
function canonicalizeRing(
  raw: readonly SelPoint[],
  wantOuter: boolean,
  width: number,
  height: number,
  toleranceTexels: number,
  maxPoints: number
): { points: SelPoint[]; signedArea: number } | null {
  if (raw.length < 3) return null;
  let points = raw.slice();
  const area = signedAreaNorm(points);
  if (area === 0) return null;
  if (area > 0 !== wantOuter) points.reverse();
  points = rotateToAnchor(points);

  if (toleranceTexels > 0) {
    let tolerance = toleranceTexels;
    let simplified = simplifyClosedRing(points, tolerance, width, height);
    for (let attempt = 0; attempt < SIMPLIFY_ESCALATION_LIMIT && simplified.length > maxPoints; attempt += 1) {
      tolerance *= 2;
      simplified = simplifyClosedRing(points, tolerance, width, height);
    }
    points = simplified;
  }
  if (points.length > maxPoints) points = decimateRing(points, maxPoints);
  if (points.length < 3) return null;

  points = rotateToAnchor(points);
  const finalArea = signedAreaNorm(points);
  if (finalArea === 0) return null;
  if (finalArea > 0 !== wantOuter) {
    points.reverse();
    points = rotateToAnchor(points);
  }
  return { points, signedArea: signedAreaNorm(points) };
}

// ---------------------------------------------------------------------------
// (D) 알파 비트맵 → 닫힌 링
// ---------------------------------------------------------------------------

/**
 * 알파 비트맵 → 닫힌 링 배열(정규화 0..1). 비트맵은 **이미 추적 해상도**여야 한다
 * (필요하면 downsampleAlphaBitmap을 먼저 부른다 — layerAlphaToPixelSelection은 알아서 부른다).
 * 아무것도 안 칠해져 있으면 빈 배열. 모듈 docstring의 순서·방향·꼭짓점 계약을 만족한다.
 */
export function traceAlphaContourRings(
  bitmap: AlphaBitmap,
  opts?: TraceAlphaContourOptions
): AlphaContourRing[] {
  const w = sanitizeDim(bitmap.width);
  const h = sanitizeDim(bitmap.height);
  if (!w || !h || bitmap.alpha.length !== w * h) return [];

  const rawThreshold = opts?.threshold;
  const threshold =
    Number.isFinite(rawThreshold) && rawThreshold! >= 1 && rawThreshold! <= 255
      ? Math.round(rawThreshold!)
      : LAYER_ALPHA_SELECTION_THRESHOLD_DEFAULT;
  const rawMaxRegions = opts?.maxRegions;
  const maxRegions =
    Number.isFinite(rawMaxRegions) && rawMaxRegions! >= 1 ? Math.round(rawMaxRegions!) : MAGIC_WAND_MAX_LOOPS;
  const rawTolerance = opts?.simplifyToleranceTexels;
  const tolerance = Number.isFinite(rawTolerance)
    ? Math.max(0, rawTolerance!)
    : LAYER_ALPHA_SIMPLIFY_TOLERANCE_TEXELS;
  const rawMaxPoints = opts?.maxPointsPerRing;
  const maxPoints =
    Number.isFinite(rawMaxPoints) && rawMaxPoints! >= 3
      ? Math.round(rawMaxPoints!)
      : LAYER_ALPHA_MAX_POINTS_PER_RING;
  const flipX = !!opts?.flipX;
  const flipY = !!opts?.flipY;

  const regions = traceMaskRegions(bitmap.alpha, w, h, { threshold, maxRegions });
  const rings: AlphaContourRing[] = [];
  for (let componentIndex = 0; componentIndex < regions.length; componentIndex += 1) {
    // flip은 방향을 뒤집으므로 반드시 규범화 **전에** 적용한다(canonicalizeRing이 다시 바로잡는다).
    const region = flipMagicWandRegion(regions[componentIndex]!, flipX, flipY);
    const outer = canonicalizeRing(region.outer, true, w, h, tolerance, maxPoints);
    if (!outer) continue;
    const parent = rings.length;
    rings.push({
      points: outer.points,
      kind: "outer",
      componentIndex,
      parent: -1,
      signedArea: outer.signedArea,
    });
    const holes: AlphaContourRing[] = [];
    for (const rawHole of region.holes) {
      const hole = canonicalizeRing(rawHole, false, w, h, tolerance, maxPoints);
      if (!hole) continue;
      holes.push({
        points: hole.points,
        kind: "hole",
        componentIndex,
        parent,
        signedArea: hole.signedArea,
      });
    }
    // 구멍 순서도 앵커 기준으로 고정한다 — 추적 간선 맵 순회 순서에 의존하지 않는다.
    holes.sort((a, b) => a.points[0]!.y - b.points[0]!.y || a.points[0]!.x - b.points[0]!.x);
    rings.push(...holes);
  }
  return rings;
}

// ---------------------------------------------------------------------------
// (E) 링 → PixelSelection
// ---------------------------------------------------------------------------

export type AlphaRingsToSelectionOptions = {
  /** 기존 선택(없으면 새로 만든다 — 포토샵의 Ctrl+클릭 = 치환). */
  base?: PixelSelection | null;
  /**
   * 결합 모드. add = Ctrl+Shift+클릭, subtract = Ctrl+Alt+클릭.
   * intersect는 지원하지 않는다 — 기존 intersectSelectionWithPolygon이 폴리곤 1개만 받는
   * 근사라서 다중 링(구멍 포함)에 그대로 적용하면 구멍이 무시된다. 필요하면 호출부가
   * "치환 후 intersect" 2단계로 구성한다.
   */
  mode?: "add" | "subtract";
  /** 결과 선택의 페더(표시 px). 미지정 시 base의 값(없으면 0)을 유지한다. */
  featherPx?: number;
};

/**
 * 닫힌 링 배열 → PixelSelection. 외곽 링은 mode로, 구멍 링은 반대 모드로 **배열 순서 그대로**
 * addSelectionSubpath 한다 — "마지막에 덮은 서브패스가 이긴다"는 PixelSelection 규약과
 * traceMaskRegions의 "감싸는 성분이 먼저" 순서 계약이 맞물려, 구멍 안에 떠 있는 섬(중첩 성분)이
 * 구멍에 먹히지 않는다. 이는 마술봉의 applyMagicWandRegionToSelection과 같은 접기 규칙이다.
 * 남는 게 없으면 null.
 */
export function alphaRingsToPixelSelection(
  rings: readonly AlphaContourRing[],
  opts?: AlphaRingsToSelectionOptions
): PixelSelection | null {
  const mode = opts?.mode === "subtract" ? "subtract" : "add";
  const holeMode = mode === "add" ? "subtract" : "add";
  let sel: PixelSelection | null = opts?.base ?? null;
  for (const ring of rings) {
    sel = addSelectionSubpath(sel, ring.kind === "outer" ? mode : holeMode, ring.points);
  }
  if (!sel || !isSelectionUsable(sel)) return null;
  const rawFeather = opts?.featherPx;
  if (Number.isFinite(rawFeather)) {
    const featherPx = Math.round(
      Math.min(SELECTION_FEATHER_RANGE.max, Math.max(SELECTION_FEATHER_RANGE.min, rawFeather!))
    );
    return { ...sel, featherPx };
  }
  return sel;
}

export type LayerAlphaToSelectionOptions = TraceAlphaContourOptions &
  AlphaRingsToSelectionOptions & {
    /** 추적 해상도 상한(긴 변 텍셀). 기본 LAYER_ALPHA_TRACE_MAX_DIM. */
    maxDim?: number;
  };

/**
 * 레이어 알파 비트맵 → PixelSelection (한 방 진입점 — 포토샵 레이어 썸네일 Ctrl+클릭).
 * 다운샘플 → 추적 → 링 규범화 → 서브패스 접기를 한 번에 한다. 선택할 게 없으면 null.
 */
export function layerAlphaToPixelSelection(
  bitmap: AlphaBitmap,
  opts?: LayerAlphaToSelectionOptions
): PixelSelection | null {
  const w = sanitizeDim(bitmap.width);
  const h = sanitizeDim(bitmap.height);
  if (!w || !h || bitmap.alpha.length !== w * h) return null;
  const scaled = downsampleAlphaBitmap(bitmap, opts?.maxDim ?? LAYER_ALPHA_TRACE_MAX_DIM);
  const rings = traceAlphaContourRings(scaled, opts);
  if (rings.length === 0) return null;
  return alphaRingsToPixelSelection(rings, opts);
}
