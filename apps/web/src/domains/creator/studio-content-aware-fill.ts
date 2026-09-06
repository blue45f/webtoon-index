/**
 * Studio Content-Aware Fill — Photoshop "내용 인식 채우기" 대응, 실용적 근사 코어.
 *
 * ⚠️ Adobe PatchMatch(랜덤화 최근접 이웃 탐색 + 반복 전파)나 진짜 텍스처 합성은 스코프 밖이다.
 * 이 모듈은 명시적으로 단순화된 **타일 기반 근사**를 구현한다 — 선택 영역(구멍)을 작은 정사각
 * 타일 그리드로 나누고, 그리드 가장자리(항상 알려진 실제 픽셀)에서 안쪽으로 BFS 파동을 그리며
 * 각 타일마다 "이미 알려진 이웃 문맥과 SSD(제곱오차합)가 가장 작은" 후보 타일을 몇 개(전수탐색이
 * 아니라 8방향×반경 몇 단계로 미리 정의한 소수 후보)만 비교해 복사한다. 왜 이렇게 단순화했는지,
 * 어떤 장면에서 품질이 떨어지는지는 docs/design-content-aware-fill.md §5에 정직하게 적혀 있다 —
 * 이 파일의 알고리즘을 바꾸면 그 문서도 함께 갱신할 것.
 *
 * 2계층 구조(studio-heal-clone.ts와 동일한 관례):
 *   (A) 순수 타일 알고리즘 — StudioImageDataLike 입출력만 다룬다(캔버스/DOM 없음, 유닛 테스트 가능).
 *       외부에 노출하는 엔트리포인트는 contentAwareFillPixels 하나뿐 — 나머지는 전부 모듈 내부 헬퍼.
 *   (B) 캔버스 팩토리 orchestration — bakeHealCloneStrokeToCanvas와 동일 패턴으로 DOM은
 *       호출자(StudioPage.tsx의 createPixelEditCanvas)가 주입한다.
 *
 * 입력 규약: source(원본, 자연 해상도 RGBA)와 mask(studio-selection-tools.ts의
 * rasterizeSelectionMask 결과 — 흰색 알파 0..255 = 선택 강도, feather로 인한 부분 알파 포함)는
 * **반드시 같은 픽셀 크기**여야 한다(다르면 방어적으로 원본을 그대로 복제해 반환 — no-op). 둘 다 이
 * 함수가 변경하지 않는다(항상 새 버퍼를 반환 — heal-clone의 frozen 소스와 동일한 "입력 불변" 정신).
 *
 * 좌표/반전 규약: 이 모듈은 화면 반전(flipX/flipY)을 전혀 모른다 — buildSelectionMaskPlan이 이미
 * flipX/flipY를 반영해 원본(비반전) 픽셀 좌표로 마스크를 구운 상태로 넘어온다는 전제다(heal-clone의
 * dab 좌표, layer-mask의 브러시 좌표와 동일한 "호출부가 되반전해서 넘긴다" 규약).
 */
import {
  CONTENT_AWARE_FILL_TILE_PX_DEFAULT,
  CONTENT_AWARE_FILL_TILE_PX_RANGE,
} from "./studio-content-aware-fill-contract";

import type { StudioImageDataLike } from "./studio-filters";
import type { MaskCanvasLike, MaskCtx2DLike, MaskImageSource } from "./studio-selection-tools";

export {
  CONTENT_AWARE_FILL_TILE_PX_DEFAULT,
  CONTENT_AWARE_FILL_TILE_PX_RANGE,
} from "./studio-content-aware-fill-contract";

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

/** 사실상 선택되지 않은 것으로 볼 알파 문턱(0..1 스케일, 1/255 미만은 반올림 잡음 취급). */
const MASK_ALPHA_EPS = 1 / 255;
/** 타일 코어의 "완전히 알려짐" 판정 여유(부동소수 오차 방어). */
const RESOLVED_EPS = 1e-6;
/**
 * 후보 탐색용 문맥(컨텍스트) 여백(px) — 타일 코어 바깥으로 이만큼 더 보고 SSD를 잰다.
 * 타일이 선택 영역에 완전히 파묻혀 자체 신호가 0이어도(모든 픽셀이 선택됨), 이미 알려진 이웃
 * 타일의 실제 픽셀이 이 여백 안에 들어와 방향성 있는 매칭이 가능해진다 — BFS가 "이웃 중 하나라도
 * 알려진 타일만 처리 대상으로 큐에 넣는다"는 불변을 지키므로, 어떤 타일이 처리될 시점엔 최소 한
 * 변의 여백은 항상 진짜(이미 확정된) 데이터다.
 */
const CONTEXT_MARGIN_PX = 3;
/** 후보 오프셋 최대 링(타일 단위) — 8방향 × 이 반경까지 미리 정의한 오프셋만 본다(전수탐색 아님). */
const MAX_RING_RADIUS_TILES = 6;
/** 타일 하나당 실제로 SSD를 계산해 볼 최대 후보 수(성능 상한 — 범위밖/미해결 후보는 이 수에 안 낀다). */
const MAX_CANDIDATES_PER_TILE = 16;
/** 타일 그리드 총 개수 상한 — 이보다 크면 tilePx를 자동으로 키운다(거대 선택에서 프리즈 방지). */
const MAX_TOTAL_TILES = 20000;
/** 자동 확대의 tilePx 상한 — 이 이상은 매칭 품질이 더 떨어지더라도 응답성을 우선한다. */
const MAX_ADAPTIVE_TILE_PX = 128;
/** 타일 경계선 이음매 완화 밴드(로컬 px) — 이 폭 안의 픽셀만 3×3 평균으로 살짝 매끈하게 만든다. */
const SEAM_SMOOTH_BAND_PX = 1;

/** 8방향 단위 벡터(타일 격자 단위) — 결정적 순서(동점 시 이 순서가 타이브레이크 기준이 된다). */
const RING_DIRECTIONS: readonly [number, number][] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

type TileOffset = { dx: number; dy: number };

/** 반경 1..MAX_RING_RADIUS_TILES × 8방향을 반경 오름차순으로 나열한 고정 후보 목록(모듈 1회 생성). */
const CANDIDATE_OFFSETS: readonly TileOffset[] = (() => {
  const offsets: TileOffset[] = [];
  for (let r = 1; r <= MAX_RING_RADIUS_TILES; r += 1) {
    for (const [dx, dy] of RING_DIRECTIONS) offsets.push({ dx: dx * r, dy: dy * r });
  }
  return offsets;
})();

// ---------------------------------------------------------------------------
// 타입 · 내부 수치 헬퍼
// ---------------------------------------------------------------------------

export type ContentAwareFillOptions = {
  /** 타일 한 변 길이(원본 자연 px). 범위 밖 값은 클램프, 비유한은 기본값. */
  tilePx?: number;
};

/**
 * Cooperative main-thread options for large fills. Sync {@link contentAwareFillPixels} ignores
 * these — use {@link contentAwareFillPixelsAsync} / {@link bakeContentAwareFillToCanvasAsync}.
 */
export type ContentAwareFillAsyncOptions = ContentAwareFillOptions & {
  /** Yield between tile batches so UI input/paint can run. */
  yieldControl?: () => Promise<void>;
  /**
   * How many BFS tiles to process between yields. Default 48 — large enough to keep throughput,
   * small enough that a full-frame fill does not freeze the page for multi-second stretches.
   */
  yieldEveryTiles?: number;
};

/** Default tile batch size for cooperative content-aware fill. */
export const CONTENT_AWARE_FILL_YIELD_EVERY_TILES_DEFAULT = 48;

function clampNum(v: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return v < lo ? lo : v > hi ? hi : v;
}

/** 원본과 같은 크기의 독립된 복제본 — 입력을 절대 변경하지 않기 위한 클론. */
function cloneImageData(img: StudioImageDataLike): StudioImageDataLike {
  return { data: img.data.slice() as Uint8ClampedArray, width: img.width, height: img.height };
}

type PxRect = { x: number; y: number; w: number; h: number };

// ---------------------------------------------------------------------------
// (A-1) 타일 그리드 상태
// ---------------------------------------------------------------------------

/**
 * 선택 영역(구멍)의 bbox를 한 타일만큼 패딩해 감싼 타일 그리드. 그리드 **바깥**은 항상 "알려짐"으로
 * 취급한다 — 패딩이 그리드 가장자리 링을 전부 비-구멍 타일로 만든다는 것을 보장하므로(선택 알파의
 * bbox 자체가 이미 "알파>0인 모든 픽셀"을 포함하니, 그 bbox보다 한 타일 바깥은 알파가 0이어야 한다).
 */
type FillGrid = {
  bx: number;
  by: number;
  bx2: number;
  by2: number;
  cols: number;
  rows: number;
  tilePx: number;
  /** 타일별 "구멍(채워야 함)" 여부 — 0/1, 그리드 생성 시 한 번만 계산되고 이후 불변. */
  holeTile: Uint8Array;
  /** 타일별 "이미 처리 완료(신뢰 가능)" 여부 — 0/1, BFS 진행에 따라 갱신. */
  filled: Uint8Array;
};

/**
 * 선택 알파 bbox(+패딩) → 타일 그리드. 알파>EPS 픽셀이 하나도 없으면 null(채울 게 없음, no-op 신호).
 * 패딩은 tilePx 그대로(최소 한 타일 두께의 "확실히 알려진" 링을 보장해 BFS 시작 프론티어를 만든다).
 * 타일 총수가 MAX_TOTAL_TILES를 넘을 만큼 선택이 크면 tilePx를 자동으로 키운다(§design 성능 절 참고
 * — 거대 선택에서 매 프레임이 아니라 단 한 번 굽는 작업이라도 수억 회 픽셀 연산은 체감 프리즈로
 * 이어지므로, 응답성을 위해 이 경우 품질이 거칠어지는 것을 감수한다).
 */
function computeContentAwareFillGrid(
  maskAlpha: Float32Array,
  width: number,
  height: number,
  requestedTilePx: number
): FillGrid | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (maskAlpha[row + x]! > MASK_ALPHA_EPS) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null; // 선택 없음.

  let tilePx = requestedTilePx;
  const computeBounds = () => {
    const bx = Math.max(0, minX - tilePx);
    const by = Math.max(0, minY - tilePx);
    const bx2 = Math.min(width, maxX + 1 + tilePx);
    const by2 = Math.min(height, maxY + 1 + tilePx);
    const cols = Math.max(1, Math.ceil((bx2 - bx) / tilePx));
    const rows = Math.max(1, Math.ceil((by2 - by) / tilePx));
    return { bx, by, bx2, by2, cols, rows };
  };

  let bounds = computeBounds();
  if (bounds.cols * bounds.rows > MAX_TOTAL_TILES) {
    const scale = Math.sqrt((bounds.cols * bounds.rows) / MAX_TOTAL_TILES);
    tilePx = Math.min(MAX_ADAPTIVE_TILE_PX, Math.round(tilePx * scale));
    bounds = computeBounds();
  }

  const total = bounds.cols * bounds.rows;
  const grid: FillGrid = {
    bx: bounds.bx,
    by: bounds.by,
    bx2: bounds.bx2,
    by2: bounds.by2,
    cols: bounds.cols,
    rows: bounds.rows,
    tilePx,
    holeTile: new Uint8Array(total),
    filled: new Uint8Array(total),
  };

  for (let tr = 0; tr < grid.rows; tr += 1) {
    for (let tc = 0; tc < grid.cols; tc += 1) {
      const rect = tileRectPx(grid, tc, tr);
      grid.holeTile[tr * grid.cols + tc] = rectHasSelection(maskAlpha, width, rect) ? 1 : 0;
    }
  }
  return grid;
}

/** 그리드 절대 좌표 타일 rect — 마지막 행/열은 bbox 끝에서 잘려 tilePx보다 작을 수 있다. */
function tileRectPx(grid: FillGrid, tc: number, tr: number): PxRect {
  const x = grid.bx + tc * grid.tilePx;
  const y = grid.by + tr * grid.tilePx;
  return { x, y, w: Math.min(grid.tilePx, grid.bx2 - x), h: Math.min(grid.tilePx, grid.by2 - y) };
}

/** 타일 rect 안에 알파>EPS 픽셀이 하나라도 있는지(=채워야 하는 "구멍" 타일인지). */
function rectHasSelection(maskAlpha: Float32Array, width: number, rect: PxRect): boolean {
  for (let y = 0; y < rect.h; y += 1) {
    const row = (rect.y + y) * width;
    for (let x = 0; x < rect.w; x += 1) {
      if (maskAlpha[row + rect.x + x]! > MASK_ALPHA_EPS) return true;
    }
  }
  return false;
}

/**
 * 절대 픽셀 좌표 (px,py)의 "알려짐(신뢰 가능)" 가중치(0..1).
 * - 그리드 바깥: 원본 마스크 알파로 판단(패딩 밖은 실질적으로 항상 1).
 * - 그리드 안: 비-구멍 타일(holeTile=0) 또는 이미 처리 완료(filled=1) 타일이면 무조건 1(원래
 *   마스크 알파가 얼마였든 — filled 타일은 이미 좋은 콘텐츠로 덮어써졌으므로 원본 알파와 무관하게
 *   전적으로 신뢰할 수 있다). 그 외(아직 처리 안 된 구멍 타일)는 1-알파(부분 알파=약한 신호,
 *   feather로 마스크 가장자리가 타일 안쪽까지 걸친 경우에 의미가 있다).
 * 호출자는 항상 이미지 경계 안의 좌표만 넘겨야 한다(경계 확인은 호출부 책임).
 */
function resolvedWeightAt(grid: FillGrid, width: number, maskAlpha: Float32Array, px: number, py: number): number {
  const idx = py * width + px;
  if (px < grid.bx || py < grid.by || px >= grid.bx2 || py >= grid.by2) {
    return 1 - maskAlpha[idx]!;
  }
  const tc = Math.floor((px - grid.bx) / grid.tilePx);
  const tr = Math.floor((py - grid.by) / grid.tilePx);
  const tIdx = tr * grid.cols + tc;
  if (grid.holeTile[tIdx] === 0 || grid.filled[tIdx] === 1) return 1;
  return 1 - maskAlpha[idx]!;
}

/** 타일(코어, 문맥 여백 제외) 전체가 지금 시점에 "완전히 알려짐"인지 — 코너 4개+중심 5점 샘플링(근사,
 * 타일이 작아 대부분의 경우 충분히 정확하다 — §design 참고). */
function isRectFullyResolved(grid: FillGrid, width: number, maskAlpha: Float32Array, rect: PxRect): boolean {
  const samples: [number, number][] = [
    [rect.x, rect.y],
    [rect.x + rect.w - 1, rect.y],
    [rect.x, rect.y + rect.h - 1],
    [rect.x + rect.w - 1, rect.y + rect.h - 1],
    [rect.x + Math.floor(rect.w / 2), rect.y + Math.floor(rect.h / 2)],
  ];
  for (const [px, py] of samples) {
    if (resolvedWeightAt(grid, width, maskAlpha, px, py) < 1 - RESOLVED_EPS) return false;
  }
  return true;
}

/** 그리드 타일 인덱스(tc,tr) 기준 "알려짐" — BFS가 다음 처리 대상을 고를 때 쓰는 타일 단위 판정. */
function isTileKnownIdx(grid: FillGrid, tc: number, tr: number): boolean {
  if (tc < 0 || tr < 0 || tc >= grid.cols || tr >= grid.rows) return true; // 그리드 밖 = 패딩이 보장하는 앎.
  const idx = tr * grid.cols + tc;
  return grid.holeTile[idx] === 0 || grid.filled[idx] === 1;
}

// ---------------------------------------------------------------------------
// (A-2) 후보 탐색 — 문맥 SSD 최소 타일 선택
// ---------------------------------------------------------------------------

/** rect를 문맥 여백만큼 확장(이미지 경계 클램프) — marginLeft/Top을 후보 쪽 위치 계산에도 그대로 쓴다. */
function expandWithContext(rect: PxRect, width: number, height: number) {
  const marginLeft = Math.min(CONTEXT_MARGIN_PX, rect.x);
  const marginTop = Math.min(CONTEXT_MARGIN_PX, rect.y);
  const marginRight = Math.min(CONTEXT_MARGIN_PX, width - (rect.x + rect.w));
  const marginBottom = Math.min(CONTEXT_MARGIN_PX, height - (rect.y + rect.h));
  return {
    x: rect.x - marginLeft,
    y: rect.y - marginTop,
    w: rect.w + marginLeft + marginRight,
    h: rect.h + marginTop + marginBottom,
    marginLeft,
    marginTop,
  };
}

/**
 * 타깃 타일(rect)과 후보 코어(candCore, rect와 동일 크기)의 문맥 여백 포함 가중 평균 SSD.
 * 가중치는 항상 **타깃** 쪽 resolvedWeightAt로 정한다 — "이미 아는 것과 후보가 얼마나 다른가"를
 * 재는 것이지 후보 쪽 신뢰도를 재는 게 아니다. 후보 쪽 픽셀은 work 버퍼에서 같은 상대 오프셋으로
 * 그대로 읽는다(후보 코어가 isRectFullyResolved를 통과했으므로 코어 자체는 신뢰할 수 있고, 문맥
 * 여백 쪽 일부가 아직 미해결이어도 그 위치의 **타깃** 가중치가 자연히 낮아 SSD에 거의 기여하지
 * 않는다 — 별도로 후보 문맥까지 검증하지 않는 의도적 단순화, §design 참고).
 * 가중합이 0(문맥까지도 전혀 알려진 게 없는 병적인 경우)이면 0을 반환한다 — 호출부가 후보를 오름차순
 * (반경 가까운 순)으로 순회하며 첫 최솟값을 그대로 채택하므로, 이 경우 "가장 가까운 후보"가 결정적
 * 타이브레이크로 자동 선택된다.
 *
 * 후보 쪽(candX+x, candY+y)은 **타깃 rect의 여백**을 그대로 재사용해 계산한다 — 타깃이 이미지 안쪽에
 * 있어 여백이 꽉 차 있어도(marginRight=3 등) 후보 코어 자신은 이미지 경계에 바싹 붙어 있을 수 있어
 * (예: 후보 코어 오른쪽 끝이 정확히 width와 같음), 그 여백만큼 shift한 후보 쪽 좌표가 이미지 밖으로
 * 나갈 수 있다. 그 자리를 그냥 읽으면(예전 버그) 배열 끝을 넘어 undefined를 읽어 SSD가 NaN이
 * 되거나(→ 후보가 통째로 버려져 타일이 전혀 채워지지 않는다), 다음 행의 픽셀을 잘못 읽어 매칭 품질이
 * 조용히 나빠진다. 그래서 후보 쪽도 항상 이미지 경계 안인지 확인하고, 밖이면 그 자리는 가중치 0과
 * 동치로 건너뛴다(타깃 쪽이 미해결이라 건너뛰는 것과 같은 처리 — 대칭적으로 안전하다).
 */
function contextWeightedSsd(
  work: Uint8ClampedArray,
  width: number,
  height: number,
  maskAlpha: Float32Array,
  grid: FillGrid,
  rect: PxRect,
  candCore: PxRect
): number {
  const ctx = expandWithContext(rect, width, height);
  const candX = candCore.x - ctx.marginLeft;
  const candY = candCore.y - ctx.marginTop;

  let sum = 0;
  let weightSum = 0;
  for (let y = 0; y < ctx.h; y += 1) {
    const ty = ctx.y + y;
    const cy = candY + y;
    if (cy < 0 || cy >= height) continue; // 후보 쪽 문맥 행이 이미지 밖 — 이 행 전체를 건너뛴다.
    for (let x = 0; x < ctx.w; x += 1) {
      const tx = ctx.x + x;
      const w = resolvedWeightAt(grid, width, maskAlpha, tx, ty);
      if (w <= 0) continue;
      const cx = candX + x;
      if (cx < 0 || cx >= width) continue; // 후보 쪽 문맥 열이 이미지 밖 — 배열 경계 밖/오염된 행 읽기 방지.
      const tIdx = (ty * width + tx) * 4;
      const cIdx = (cy * width + cx) * 4;
      const dr = work[tIdx]! - work[cIdx]!;
      const dg = work[tIdx + 1]! - work[cIdx + 1]!;
      const db = work[tIdx + 2]! - work[cIdx + 2]!;
      sum += w * (dr * dr + dg * dg + db * db);
      weightSum += w;
    }
  }
  return weightSum > 0 ? sum / weightSum : 0;
}

/**
 * 타일 rect에 대해 CANDIDATE_OFFSETS를 반경 오름차순으로 순회하며 SSD가 가장 작은 후보 코어 rect를
 * 고른다. 이미지 경계를 벗어나거나(카운트 안 함) 코어가 아직 완전히 알려지지 않은 후보(카운트 안 함)는
 * 건너뛴다 — 실제로 SSD를 계산한 후보가 MAX_CANDIDATES_PER_TILE개에 도달하면 탐색을 멈춘다(성능
 * 상한, 나머지는 더 먼 반경이라 어차피 덜 유용할 가능성이 높다는 실용적 가정 — §design 참고).
 * 유효 후보가 하나도 없으면 null(BFS 관례상 거의 발생하지 않지만, 발생하면 호출부 폴백이 처리한다).
 */
function pickBestCandidateCore(
  work: Uint8ClampedArray,
  width: number,
  height: number,
  maskAlpha: Float32Array,
  grid: FillGrid,
  rect: PxRect
): PxRect | null {
  let best: PxRect | null = null;
  let bestSsd = Infinity;
  let evaluated = 0;
  for (const off of CANDIDATE_OFFSETS) {
    if (evaluated >= MAX_CANDIDATES_PER_TILE) break;
    const cx = rect.x + off.dx * grid.tilePx;
    const cy = rect.y + off.dy * grid.tilePx;
    if (cx < 0 || cy < 0 || cx + rect.w > width || cy + rect.h > height) continue;
    const candCore: PxRect = { x: cx, y: cy, w: rect.w, h: rect.h };
    if (!isRectFullyResolved(grid, width, maskAlpha, candCore)) continue;
    evaluated += 1;
    const ssd = contextWeightedSsd(work, width, height, maskAlpha, grid, rect, candCore);
    if (ssd < bestSsd) {
      bestSsd = ssd;
      best = candCore;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// (A-3) 타일 굽기 · 폴백 · 이음매 완화
// ---------------------------------------------------------------------------

/**
 * 후보 코어의 픽셀을 타깃 타일 위치에 복사 — 각 픽셀은 **그 픽셀 자신의** 원본 선택 알파만큼만
 * 원본과 블렌드된다(알파=1인 픽셀은 후보로 완전히 대체, feather로 인한 부분 알파는 자연스러운
 * 경계 블렌딩이 된다 — applySelectionAdjustToCanvas의 delete/adjust 합성과 동일한 알파 규약).
 * 타일 간 이음매를 여기서 완화하지 않는 이유(중요): "이미 확정된 이웃과 이번 타일 후보를 섞는" 방식은
 * 자칫 아직 채워지지 않은 원본(지워야 할) 픽셀을 그대로 남기는 회귀를 만들기 쉽다(초기 구현에서
 * 실제로 겪음 — 경계 바로 그 줄만 대체가 안 되는 버그). 그래서 "완전한 대체"를 여기서 보장하고,
 * 이음매 완화는 전부 끝난 뒤 smoothTileSeams 한 번의 후처리로 분리했다(아래 참고, §design도 동일 설명).
 */
function copyTileFill(
  work: Uint8ClampedArray,
  width: number,
  maskAlpha: Float32Array,
  rect: PxRect,
  candCore: PxRect
): void {
  for (let y = 0; y < rect.h; y += 1) {
    const ty = rect.y + y;
    const cy = candCore.y + y;
    for (let x = 0; x < rect.w; x += 1) {
      const tx = rect.x + x;
      const a = maskAlpha[ty * width + tx]!;
      if (a <= 0) continue;
      const cx = candCore.x + x;
      const tIdx = (ty * width + tx) * 4;
      const cIdx = (cy * width + cx) * 4;
      work[tIdx] = work[tIdx]! * (1 - a) + work[cIdx]! * a;
      work[tIdx + 1] = work[tIdx + 1]! * (1 - a) + work[cIdx + 1]! * a;
      work[tIdx + 2] = work[tIdx + 2]! * (1 - a) + work[cIdx + 2]! * a;
      work[tIdx + 3] = work[tIdx + 3]! * (1 - a) + work[cIdx + 3]! * a;
    }
  }
}

/** 마스크 알파>EPS 인 모든 픽셀(그리드 전체가 아니라 이미지 전체 기준)의 평균 RGB — 폴백 채움 색. */
function meanKnownColor(
  work: Uint8ClampedArray,
  width: number,
  height: number,
  maskAlpha: Float32Array
): { r: number; g: number; b: number } | null {
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let count = 0;
  const total = width * height;
  for (let i = 0; i < total; i += 1) {
    if (maskAlpha[i]! <= MASK_ALPHA_EPS) {
      const idx = i * 4;
      sr += work[idx]!;
      sg += work[idx + 1]!;
      sb += work[idx + 2]!;
      count += 1;
    }
  }
  return count > 0 ? { r: sr / count, g: sg / count, b: sb / count } : null;
}

/** rect 안의 선택된 픽셀만 단색으로 평탄하게 채운다(자체 알파 비율로 블렌드) — BFS 교착 폴백 전용. */
function flatFillRect(
  work: Uint8ClampedArray,
  width: number,
  maskAlpha: Float32Array,
  rect: PxRect,
  color: { r: number; g: number; b: number }
): void {
  for (let y = 0; y < rect.h; y += 1) {
    const ty = rect.y + y;
    for (let x = 0; x < rect.w; x += 1) {
      const tx = rect.x + x;
      const a = maskAlpha[ty * width + tx]!;
      if (a <= 0) continue;
      const idx = (ty * width + tx) * 4;
      work[idx] = work[idx]! * (1 - a) + color.r * a;
      work[idx + 1] = work[idx + 1]! * (1 - a) + color.g * a;
      work[idx + 2] = work[idx + 2]! * (1 - a) + color.b * a;
      work[idx + 3] = work[idx + 3]! * (1 - a) + 255 * a;
    }
  }
}

/**
 * 타일 경계선 완화 — 그리드 내부 경계선(로컬 좌표가 tilePx의 배수 근방)에 걸친 **선택된** 픽셀만
 * SEAM_SMOOTH_BAND_PX 폭으로 3×3 평균(이미지 경계는 클램프)과 원래 자기 알파 비율로 다시 블렌드한다.
 * 같은 패스 안에서 방금 평균 낸 값이 다시 재귀적으로 섞여 들어가는 편향을 막기 위해 항상 이전
 * 스냅샷에서 읽는다. 타일이 하나뿐이면(내부 경계선이 없음) 아무 일도 하지 않는다.
 * 단색 배경(§design 결정론 테스트)에서는 3×3 평균이 항상 같은 값이라 결과가 전혀 바뀌지 않는다.
 */
function smoothTileSeams(
  work: Uint8ClampedArray,
  width: number,
  height: number,
  maskAlpha: Float32Array,
  grid: FillGrid
): void {
  if (grid.cols <= 1 && grid.rows <= 1) return;
  const snapshot = work.slice();
  const band = SEAM_SMOOTH_BAND_PX;
  const tilePx = grid.tilePx;

  for (let y = grid.by; y < grid.by2; y += 1) {
    const localY = y - grid.by;
    const modY = localY % tilePx;
    const nearRowLine = modY < band || tilePx - modY <= band;
    for (let x = grid.bx; x < grid.bx2; x += 1) {
      const a = maskAlpha[y * width + x]!;
      if (a <= MASK_ALPHA_EPS) continue;
      const localX = x - grid.bx;
      const modX = localX % tilePx;
      const nearColLine = modX < band || tilePx - modX <= band;
      if (!nearRowLine && !nearColLine) continue;

      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      let count = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        const ny = y + oy;
        if (ny < 0 || ny >= height) continue;
        for (let ox = -1; ox <= 1; ox += 1) {
          const nx = x + ox;
          if (nx < 0 || nx >= width) continue;
          const idx = (ny * width + nx) * 4;
          sr += snapshot[idx]!;
          sg += snapshot[idx + 1]!;
          sb += snapshot[idx + 2]!;
          sa += snapshot[idx + 3]!;
          count += 1;
        }
      }
      if (count === 0) continue;
      const idx = (y * width + x) * 4;
      work[idx] = work[idx]! * (1 - a) + (sr / count) * a;
      work[idx + 1] = work[idx + 1]! * (1 - a) + (sg / count) * a;
      work[idx + 2] = work[idx + 2]! * (1 - a) + (sb / count) * a;
      work[idx + 3] = work[idx + 3]! * (1 - a) + (sa / count) * a;
    }
  }
}

// ---------------------------------------------------------------------------
// (A-4) 엔트리포인트 — BFS 오케스트레이션
// ---------------------------------------------------------------------------

/**
 * 콘텐츠 인식 채우기 순수 코어 — source(RGBA, 원본 이미지 자연 해상도)와 mask(같은 크기, 알파=선택
 * 강도 0..255)를 받아 선택 영역을 주변 텍스처 근사로 채운 **새** StudioImageDataLike를 반환한다.
 * source/mask는 변경하지 않는다.
 *
 * 알고리즘 개요(§design에 전체 설명):
 *   1) 선택 알파 bbox + 패딩 한 타일 → 타일 그리드, 타일별 "구멍" 분류.
 *   2) 그리드 가장자리(패딩 덕분에 전부 비-구멍)에서 시작해 BFS로 안쪽 구멍 타일을 순서대로 처리 —
 *      이웃 타일 중 하나라도 "알려짐"이 된 구멍 타일만 큐에 들어간다(파동이 안쪽으로 전파).
 *   3) 각 타일마다 미리 정의된 8방향×반경 후보 중 문맥 가중 SSD가 최소인 것을 골라 그대로 복사.
 *   4) BFS로 끝내 닿지 못한 구멍 타일(고립된 선택 등, 정상 입력에선 드묾)은 평균색 폴백으로 채운다.
 *   5) 타일 경계선 근방만 가볍게 3×3 평균으로 이음매를 완화한다.
 *
 * width/height가 mask와 다르거나 비정상이면, 또는 선택 알파가 전부 0이면(채울 게 없음) source의
 * 복제본을 그대로 반환한다(no-op, 히스토리에 무의미한 변화를 남기지 않도록 호출부가 판단할 수 있게
 * `contentAwareFillHasWork`로 미리 확인하는 것을 권장 — 아래 참고).
 */
type ContentAwareFillRunState = {
  width: number;
  height: number;
  maskAlpha: Float32Array;
  grid: FillGrid;
  work: Uint8ClampedArray;
  queue: number[];
  tryEnqueue: (tc: number, tr: number) => void;
};

function prepareContentAwareFillRun(
  source: StudioImageDataLike,
  mask: StudioImageDataLike,
  opts?: ContentAwareFillOptions,
): ContentAwareFillRunState | { noop: StudioImageDataLike } {
  const width = source.width;
  const height = source.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { noop: cloneImageData(source) };
  }
  if (mask.width !== width || mask.height !== height) {
    return { noop: cloneImageData(source) };
  }

  const maskAlpha = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    maskAlpha[i] = mask.data[i * 4 + 3]! / 255;
  }

  const requestedTilePx = Math.round(
    clampNum(
      opts?.tilePx ?? CONTENT_AWARE_FILL_TILE_PX_DEFAULT,
      CONTENT_AWARE_FILL_TILE_PX_RANGE.min,
      CONTENT_AWARE_FILL_TILE_PX_RANGE.max,
      CONTENT_AWARE_FILL_TILE_PX_DEFAULT
    )
  );

  const grid = computeContentAwareFillGrid(maskAlpha, width, height, requestedTilePx);
  if (!grid) return { noop: cloneImageData(source) }; // 선택 없음 — 채울 게 없다.

  const work = source.data.slice() as Uint8ClampedArray;
  const total = grid.cols * grid.rows;
  const queued = new Uint8Array(total);
  const queue: number[] = [];

  const tryEnqueue = (tc: number, tr: number) => {
    if (tc < 0 || tr < 0 || tc >= grid.cols || tr >= grid.rows) return;
    const idx = tr * grid.cols + tc;
    if (grid.holeTile[idx] !== 1 || grid.filled[idx] === 1 || queued[idx] === 1) return;
    const ready =
      isTileKnownIdx(grid, tc - 1, tr) ||
      isTileKnownIdx(grid, tc + 1, tr) ||
      isTileKnownIdx(grid, tc, tr - 1) ||
      isTileKnownIdx(grid, tc, tr + 1);
    if (ready) {
      queued[idx] = 1;
      queue.push(idx);
    }
  };

  for (let tr = 0; tr < grid.rows; tr += 1) {
    for (let tc = 0; tc < grid.cols; tc += 1) tryEnqueue(tc, tr);
  }

  return { width, height, maskAlpha, grid, work, queue, tryEnqueue };
}

function processContentAwareFillTile(
  state: ContentAwareFillRunState,
  queueIndex: number,
): number {
  const { width, height, maskAlpha, grid, work, queue, tryEnqueue } = state;
  const idx = queue[queueIndex]!;
  const tc = idx % grid.cols;
  const tr = Math.floor(idx / grid.cols);
  const rect = tileRectPx(grid, tc, tr);
  const best = pickBestCandidateCore(work, width, height, maskAlpha, grid, rect);
  // 후보를 못 찾았으면(best=null) 이 타일은 filled=1로 표시하지 않는다 — 이전 버그: 후보를 못
  // 찾은 타일도 무조건 filled=1로 찍으면, (a) 실제로는 원본(구멍) 픽셀이 그대로인데도
  // resolvedWeightAt/isTileKnownIdx가 "신뢰 가능"으로 오판해 이후 다른 타일들의 SSD 비교·복사가
  // 이 타일의 미해결 원본 픽셀을 진짜 문맥인 것처럼 베끼는 연쇄(오염 전파)로 이어지고, (b) 아래
  // 폴백 스윕은 filled===0인 타일만 골라내므로 이 타일은 평균색 폴백 대상에서도 영영 빠진다(§design
  // §5-4가 약속하는 "고립된 구멍은 평균색으로" 안전망이 무력화된다 — 이미지 전체 선택처럼 진짜
  // 알려진 픽셀이 하나도 없는 경우, 최초로 실패하는 타일 하나의 원본 내용이 그리드 전체로 잘못
  // 전파되어 버렸다). best를 찾았을 때만 filled=1로 찍어야 이 타일이 실패하면 정직하게 "아직
  // 미해결"로 남고, 마지막 폴백 스윕에 정확히 걸린다.
  if (best) {
    copyTileFill(work, width, maskAlpha, rect, best);
    grid.filled[idx] = 1;
  }
  tryEnqueue(tc - 1, tr);
  tryEnqueue(tc + 1, tr);
  tryEnqueue(tc, tr - 1);
  tryEnqueue(tc, tr + 1);
  return queueIndex + 1;
}

function finalizeContentAwareFillRun(state: ContentAwareFillRunState): StudioImageDataLike {
  const { width, height, maskAlpha, grid, work } = state;
  const total = grid.cols * grid.rows;

  // 폴백 — BFS 프론티어가 닿지 못했거나(고립된 구멍) 후보를 못 찾은 타일을 평균색으로 마저 채운다.
  const remaining: number[] = [];
  for (let i = 0; i < total; i += 1) {
    if (grid.holeTile[i] === 1 && grid.filled[i] === 0) remaining.push(i);
  }
  if (remaining.length > 0) {
    const fallback = meanKnownColor(work, width, height, maskAlpha) ?? { r: 200, g: 200, b: 200 };
    for (const idx of remaining) {
      const tc = idx % grid.cols;
      const tr = Math.floor(idx / grid.cols);
      flatFillRect(work, width, maskAlpha, tileRectPx(grid, tc, tr), fallback);
      grid.filled[idx] = 1;
    }
  }

  smoothTileSeams(work, width, height, maskAlpha, grid);

  return { data: work, width, height };
}

export function contentAwareFillPixels(
  source: StudioImageDataLike,
  mask: StudioImageDataLike,
  opts?: ContentAwareFillOptions
): StudioImageDataLike {
  const prepared = prepareContentAwareFillRun(source, mask, opts);
  if ("noop" in prepared) return prepared.noop;

  let qi = 0;
  while (qi < prepared.queue.length) {
    qi = processContentAwareFillTile(prepared, qi);
  }

  return finalizeContentAwareFillRun(prepared);
}

/**
 * Same pixel result as {@link contentAwareFillPixels}, but yields between BFS tile batches so a
 * large selection fill does not monopolize the main thread for the entire run.
 */
export async function contentAwareFillPixelsAsync(
  source: StudioImageDataLike,
  mask: StudioImageDataLike,
  opts?: ContentAwareFillAsyncOptions,
): Promise<StudioImageDataLike> {
  const prepared = prepareContentAwareFillRun(source, mask, opts);
  if ("noop" in prepared) return prepared.noop;

  const yieldEvery = Math.max(
    1,
    Math.round(opts?.yieldEveryTiles ?? CONTENT_AWARE_FILL_YIELD_EVERY_TILES_DEFAULT),
  );
  const yieldControl = opts?.yieldControl;
  let qi = 0;
  let processed = 0;
  while (qi < prepared.queue.length) {
    qi = processContentAwareFillTile(prepared, qi);
    processed += 1;
    if (yieldControl && processed % yieldEvery === 0) {
      await yieldControl();
    }
  }

  return finalizeContentAwareFillRun(prepared);
}

/**
 * 실행 전 가드 — mask에 실제로 채울 알파(>0)가 하나라도 있는지만 빠르게 확인한다. StudioPage 쪽에서
 * "적용" 버튼 활성화 여부나 무의미한 캔버스 생성을 피하는 용도(isSelectionAdjustNoop과 같은 역할).
 */
export function contentAwareFillHasWork(mask: StudioImageDataLike): boolean {
  const total = mask.width * mask.height;
  for (let i = 0; i < total; i += 1) {
    if (mask.data[i * 4 + 3]! > 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// (B) 캔버스 팩토리 orchestration — bakeHealCloneStrokeToCanvas와 동일 관례
// ---------------------------------------------------------------------------

/**
 * studio-selection-tools.ts의 MaskCtx2DLike를 확장 — 픽셀을 읽고 쓰려면 get/putImageData가
 * 필요하다. studio-heal-clone.ts의 HealCloneCtx2DLike와 구조가 같지만, 그 모듈의 docstring이
 * 설명하듯 서로 다른 픽셀 편집 도구가 우연히 구조가 같다고 타입을 공유하지 않는 것이 이 파일들의
 * 관례라 여기서도 독립적으로 정의한다. StudioPage.tsx의 createPixelEditCanvas는 진짜
 * CanvasRenderingContext2D를 반환하므로 **수정 없이 그대로** 이 자리에 넘길 수 있다(구조적 호환).
 */
export type ContentAwareFillCtx2DLike = MaskCtx2DLike & {
  getImageData(sx: number, sy: number, sw: number, sh: number): StudioImageDataLike;
  putImageData(imageData: StudioImageDataLike, dx: number, dy: number): void;
};

/** 오프스크린 캔버스 팩토리 — DOM 의존부를 호출자(StudioPage)가 주입한다. */
export type ContentAwareFillCanvasFactory = (
  width: number,
  height: number
) => { canvas: MaskCanvasLike & MaskImageSource; ctx: ContentAwareFillCtx2DLike } | null;

/**
 * source(원본 이미지)+mask(rasterizeSelectionMask 결과)로 콘텐츠 인식 채우기를 실행해 결과 캔버스를
 * 만든다. applySelectionAdjustToCanvas/bakeHealCloneStrokeToCanvas와 동일한 "오프스크린 캔버스에
 * 그려 getImageData → 순수 계산 → putImageData" 관례 — 이 함수 자체는 알고리즘을 전혀 모르고
 * contentAwareFillPixels에 전부 위임한다. 캔버스 생성 순서: source용 1개 → mask용 1개 → 결과용 1개
 * (총 3개, 실패 시 그 시점에서 즉시 null).
 */
function prepareContentAwareFillCanvasBuffers(
  source: MaskImageSource,
  mask: MaskImageSource,
  width: number,
  height: number,
  createCanvas: ContentAwareFillCanvasFactory,
): { w: number; h: number; srcData: StudioImageDataLike; maskData: StudioImageDataLike } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));

  const srcCanvas = createCanvas(w, h);
  if (!srcCanvas) return null;
  srcCanvas.ctx.drawImage(source, 0, 0);

  const maskCanvas = createCanvas(w, h);
  if (!maskCanvas) return null;
  maskCanvas.ctx.drawImage(mask, 0, 0);

  return {
    w,
    h,
    srcData: srcCanvas.ctx.getImageData(0, 0, w, h),
    maskData: maskCanvas.ctx.getImageData(0, 0, w, h),
  };
}

export function bakeContentAwareFillToCanvas(
  source: MaskImageSource,
  mask: MaskImageSource,
  width: number,
  height: number,
  opts: ContentAwareFillOptions | undefined,
  createCanvas: ContentAwareFillCanvasFactory
): (MaskCanvasLike & MaskImageSource) | null {
  const buffers = prepareContentAwareFillCanvasBuffers(source, mask, width, height, createCanvas);
  if (!buffers) return null;

  const result = contentAwareFillPixels(buffers.srcData, buffers.maskData, opts);

  const out = createCanvas(buffers.w, buffers.h);
  if (!out) return null;
  out.ctx.putImageData(result, 0, 0);
  return out.canvas;
}

/**
 * Async bake path for StudioPage — cooperative tile yields + same pixel contract as the sync bake.
 */
export async function bakeContentAwareFillToCanvasAsync(
  source: MaskImageSource,
  mask: MaskImageSource,
  width: number,
  height: number,
  opts: ContentAwareFillAsyncOptions | undefined,
  createCanvas: ContentAwareFillCanvasFactory,
): Promise<(MaskCanvasLike & MaskImageSource) | null> {
  const buffers = prepareContentAwareFillCanvasBuffers(source, mask, width, height, createCanvas);
  if (!buffers) return null;

  const result = await contentAwareFillPixelsAsync(buffers.srcData, buffers.maskData, opts);

  const out = createCanvas(buffers.w, buffers.h);
  if (!out) return null;
  out.ctx.putImageData(result, 0, 0);
  return out.canvas;
}
