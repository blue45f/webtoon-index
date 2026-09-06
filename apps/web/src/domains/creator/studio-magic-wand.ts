/**
 * Studio Magic Wand — "마술봉" 자동 선택 순수 코어.
 *
 * studio-flood-fill.ts 의 scanFloodRegionMask(같은 BFS)를 재사용해 매치된 픽셀 마스크를 얻고,
 * 그 마스크의 윤곽선을 폴리곤으로 추적해 studio-selection-tools.ts 의 PixelSelection 모델에
 * addSelectionSubpath 로 그대로 먹인다 — 페인트 통처럼 픽셀을 직접 칠하지 않고, 이동·페더·반전·
 * 되돌리기가 가능한 "선택 영역"을 만든다.
 *
 * 좌표 규약: 이 파일의 모든 함수는 "스캔에 쓰인 마스크의 폭/높이" 기준 0..1 정규화 좌표를 다룬다.
 * studio-selection-tools.ts 의 SelPoint 와 동일한 의미다 — 스캔 해상도(마스크 크기)가 원본
 * 자연 해상도보다 낮아도(추적 성능을 위해 다운스케일함) 결과는 항상 0..1 이라 손실 없이 호환된다.
 *
 * DOM 의존성 없음 — 이 파일 전체가 순수하다(Uint8ClampedArray/Uint8Array 를 직접 만들어
 * 유닛 테스트할 수 있다). 캔버스/Image/Worker 오케스트레이션은 studio-magic-wand-browser.ts 가
 * 담당한다(studio-advanced-fill-browser.ts 와 동일한 분리 — 순수 코어를 Worker 클라이언트에서
 * 순환 참조 없이 재사용하기 위함).
 */
import { scanFloodRegionMask } from "./studio-flood-fill";
import {
  addSelectionSubpath,
  MIN_SELECTION_SUBPATH_AREA,
  pointInPolygon,
  polygonAreaNorm,
  simplifyLassoPolygon,
  type PixelSelection,
  type SelectionCombineMode,
  type SelPoint,
} from "./studio-selection-tools";

/** 허용 오차 슬라이더 범위 — studio-flood-fill 의 tolerance(0-255 채널 거리 스케일)와 동일 단위. */
export const MAGIC_WAND_TOLERANCE_RANGE = { min: 0, max: 120, step: 1 } as const;
/** 허용 오차 기본값 — 페인트 통(floodFillImage)의 기본값과 동일해 두 도구의 체감이 일치한다. */
export const MAGIC_WAND_TOLERANCE_DEFAULT = 32;
/** 스캔·추적 해상도 상한(긴 변 px) — 원본 해상도가 이보다 크면 다운스케일 후 스캔한다. */
export const MAGIC_WAND_TRACE_MAX_DIM = 640;
/** 한 번의 스캔에서 유지할 최대 루프(외곽+구멍) 수 — 스크린톤 등 병적 입력에서 폭주 방지. */
export const MAGIC_WAND_MAX_LOOPS = 48;

/** 마술봉 스캔 결과 — outer 는 정확히 하나(빈 배열 = "선택할 영역 없음" 신호), holes 는 0개 이상. */
export type MagicWandRegion = { outer: SelPoint[]; holes: SelPoint[][] };

/** 정규화 점 좌우/상하 반전 — 표시 좌표계 ↔ 원본(비반전) 픽셀 좌표계 변환에 재사용(자기 역함수). */
export function flipNormalizedPoint(p: SelPoint, flipX: boolean, flipY: boolean): SelPoint {
  return { x: flipX ? 1 - p.x : p.x, y: flipY ? 1 - p.y : p.y };
}

/** MagicWandRegion 전체에 flipNormalizedPoint 를 적용(불변) — 둘 다 false 면 원본을 그대로 반환. */
export function flipMagicWandRegion(region: MagicWandRegion, flipX: boolean, flipY: boolean): MagicWandRegion {
  if (!flipX && !flipY) return region;
  const flipPts = (pts: SelPoint[]) => pts.map((p) => flipNormalizedPoint(p, flipX, flipY));
  return { outer: flipPts(region.outer), holes: region.holes.map(flipPts) };
}

/**
 * 마스크의 윤곽선을 PixelSelection 서브패스로 접어 넣는다 — outer 를 mode 로, holes 를 반대
 * mode 로 순서대로 addSelectionSubpath 한다(마지막에 그려진 서브패스가 이긴다는 기존 규약을
 * 그대로 이용해 "외곽 선택 - 구멍" 도넛 모양을 만든다). outer 가 비었으면(선택할 게 없으면) sel
 * 을 그대로 반환한다(변화 없음).
 */
export function applyMagicWandRegionToSelection(
  sel: PixelSelection | null,
  region: MagicWandRegion,
  mode: SelectionCombineMode,
): PixelSelection | null {
  if (region.outer.length < 3) return sel;
  let next = addSelectionSubpath(sel, mode, region.outer);
  const holeMode: SelectionCombineMode = mode === "add" ? "subtract" : "add";
  for (const hole of region.holes) {
    next = addSelectionSubpath(next, holeMode, hole);
  }
  return next;
}

// ---------------------------------------------------------------------------
// 내부: 그리드 코너 좌표계 윤곽선 추적(순수, DOM 무관)
// ---------------------------------------------------------------------------

type GridPoint = { x: number; y: number };

/**
 * 대각선으로만 붙은(카디널 방향 이웃 없이 모서리만 맞닿은) 전경 픽셀 쌍은 경계 추적 시 코너의
 * out-degree 가 2가 되는 모호한 경우를 만든다(스크린톤 도트 패턴에서 실제로 발생 가능).
 * 이런 2×2 블록(체커보드 패턴)을 만나면 항상 좌상단 픽셀을 전경으로 채워 단순 연결로 만든다
 * (결정적 타이브레이크 — 아주 드문 패턴에서 1px 과다 선택될 수 있음을 감수하는 정직한 근사).
 */
function desaddleMask(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = mask.slice();
  for (let py = 0; py < h - 1; py++) {
    for (let px = 0; px < w - 1; px++) {
      const a = out[py * w + px]!;
      const b = out[py * w + px + 1]!;
      const c = out[(py + 1) * w + px]!;
      const d = out[(py + 1) * w + px + 1]!;
      if ((a === 1 && d === 1 && b === 0 && c === 0) || (b === 1 && c === 1 && a === 0 && d === 0)) {
        out[py * w + px] = 1;
      }
    }
  }
  return out;
}

/** 방향성 경계 간선 맵 구축 — 전경 픽셀은 항상 진행 방향의 오른쪽에 있도록 4규칙을 적용한다. */
function buildBoundaryEdges(mask: Uint8Array, w: number, h: number): Map<string, GridPoint> {
  const isFg = (px: number, py: number) => px >= 0 && px < w && py >= 0 && py < h && mask[py * w + px] === 1;
  const edges = new Map<string, GridPoint>();
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      if (!isFg(px, py)) continue;
      if (!isFg(px, py - 1)) edges.set(`${px},${py}`, { x: px + 1, y: py }); // 위쪽 경계 → +x
      if (!isFg(px + 1, py)) edges.set(`${px + 1},${py}`, { x: px + 1, y: py + 1 }); // 오른쪽 → +y
      if (!isFg(px, py + 1)) edges.set(`${px + 1},${py + 1}`, { x: px, y: py + 1 }); // 아래쪽 → -x
      if (!isFg(px - 1, py)) edges.set(`${px},${py + 1}`, { x: px, y: py }); // 왼쪽 → -y
    }
  }
  return edges;
}

/** 간선 맵을 끝까지 걸어 닫힌 루프들을 모두 뽑는다(외곽 1개 + 구멍 0개 이상, 미분류 상태). */
function walkLoops(edges: Map<string, GridPoint>): GridPoint[][] {
  const loops: GridPoint[][] = [];
  const visitedStart = new Set<string>();
  for (const startKey of edges.keys()) {
    if (visitedStart.has(startKey)) continue;
    const loopPoints: GridPoint[] = [];
    let cur = startKey;
    const maxSteps = edges.size + 1;
    let guard = 0;
    do {
      visitedStart.add(cur);
      const [cx, cy] = cur.split(",").map(Number);
      loopPoints.push({ x: cx!, y: cy! });
      const next = edges.get(cur);
      if (!next) break; // 방어적 — 정상 입력에선 발생하지 않는다(desaddle 이 보장).
      cur = `${next.x},${next.y}`;
      guard++;
    } while (cur !== startKey && guard < maxSteps);
    if (loopPoints.length >= 3) loops.push(loopPoints);
  }
  return loops;
}

/** 신발끈 부호 있는 면적(절댓값 아님) — 양수=외곽 방향, 음수=구멍 방향(추적 규칙에서 유도됨). */
function signedArea(pts: GridPoint[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

/** 그리드 좌표 루프 → 0..1 정규화 + 단순화(직선 중간점 제거) + 면적 문턱 필터. null = 버림. */
function finalizeLoop(raw: GridPoint[], w: number, h: number): SelPoint[] | null {
  const norm = raw.map((p) => ({ x: p.x / w, y: p.y / h }));
  const simplified = simplifyLassoPolygon(norm);
  if (simplified.length < 3) return null;
  if (polygonAreaNorm(simplified) < MIN_SELECTION_SUBPATH_AREA) return null;
  return simplified;
}

/**
 * 마스크(0/1, w*h) → 외곽 1개 + 구멍 0개 이상의 정규화 폴리곤. 순수 함수 — 캔버스 불필요,
 * 손으로 만든 Uint8Array 로 바로 유닛 테스트 가능하다.
 */
export function traceMaskContours(mask: Uint8Array, w: number, h: number, startX: number, startY: number): MagicWandRegion {
  const clean = desaddleMask(mask, w, h);
  const edges = buildBoundaryEdges(clean, w, h);
  const rawLoops = walkLoops(edges);
  if (rawLoops.length === 0) return { outer: [], holes: [] };

  const positives = rawLoops.filter((l) => signedArea(l) > 0);
  const negatives = rawLoops.filter((l) => signedArea(l) < 0);

  // 시작 픽셀 중심(+0.5,+0.5)은 정수 격자 변 위에 절대 놓이지 않아 point-in-polygon 판정이 항상
  // 결정적이다(가장자리 동률 없음). 못 찾으면(정상 입력에선 일어나지 않음) 최대 면적 후보로 대체.
  const startCenter: GridPoint = { x: startX + 0.5, y: startY + 0.5 };
  const trueOuter =
    positives.find((l) => pointInPolygon(startCenter, l)) ??
    positives.reduce<GridPoint[] | null>(
      (best, l) => (best === null || Math.abs(signedArea(l)) > Math.abs(signedArea(best)) ? l : best),
      null,
    );
  if (!trueOuter) return { outer: [], holes: [] };

  // 병적 입력(예: 스크린톤 전면 스캔) 방어 — 진짜 외곽은 항상 유지하고, 나머지(구멍 후보 = 음수
  // 루프 전체, trueOuter 는 양수 루프에서 골랐으므로 애초에 여기 섞일 수 없다)는 |면적| 기준
  // 상위 (MAGIC_WAND_MAX_LOOPS - 1)개만 남긴다.
  const rest = negatives;
  const capped =
    rest.length > MAGIC_WAND_MAX_LOOPS - 1
      ? rest.slice().sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a))).slice(0, MAGIC_WAND_MAX_LOOPS - 1)
      : rest;

  const outer = finalizeLoop(trueOuter, w, h);
  if (!outer) return { outer: [], holes: [] };
  const holes = capped.map((l) => finalizeLoop(l, w, h)).filter((l): l is SelPoint[] => l !== null);
  return { outer, holes };
}

// ---------------------------------------------------------------------------
// 순수(캔버스 불필요): scanFloodRegionMask + traceMaskContours 결합
// ---------------------------------------------------------------------------

/** ImageData 버퍼에서 바로 스캔+추적 — 손으로 만든 Uint8ClampedArray 로 유닛 테스트 가능. */
export function scanMagicWandRegionFromImageData(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  startX: number,
  startY: number,
  tolerance = MAGIC_WAND_TOLERANCE_DEFAULT,
): MagicWandRegion {
  const mask = scanFloodRegionMask(data, w, h, startX, startY, tolerance);
  return traceMaskContours(mask, w, h, startX, startY);
}
