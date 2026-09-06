/**
 * Studio Crop — 이미지 요소 크롭 도구(포토샵식) 순수 코어.
 *
 * 픽셀 선택 도구(studio-selection-tools)와 같은 좌표 규약을 쓴다:
 *   - 크롭 rect 는 이미지 요소의 **비회전 로컬 박스 기준 정규화(0..1)** 로 저장한다.
 *     요소를 리사이즈/회전해도 크롭 영역이 화면 표시를 그대로 따라간다.
 *   - 화면 포인터 ↔ 정규화 변환은 studio-selection-tools 의 canvasPointToNormalized /
 *     normalizedPointToCanvas 를 재사용한다(오버레이·마스크와 동일한 수식 보장).
 *   - 정규화 좌표는 **표시(반전 적용 후) 기준**이다 — 원본 픽셀을 자를 때만
 *     flipX/flipY 를 되반전한다(planCropApply).
 *
 * 구성:
 *   (1) 비율 프리셋(자유/1:1/4:3/16:9) — 표시 px 기준 w/h 비율.
 *   (2) 드래그 리듀서 — 8핸들 리사이즈 + 이동. 최소 크기 가드, 0..1 경계 클램프,
 *       비율 잠금(코너=포인터의 대각 투영, 변=수직축 중앙 고정) 지원. 전부 불변·결정적.
 *   (3) 히트테스트/오버레이 기하 — 핸들 판정, 바깥 어둡게 마스크 4분할, 3분할 안내선.
 *   (4) 적용 계획 — 원본 자연 해상도 소스 rect(sx,sy,sw,sh) + 크롭 후에도 화면상
 *       위치가 유지되는 새 요소 프레임(x/y/width/height, 회전 보정 포함).
 *
 * DOM/Konva 의존성 없음 — 실제 캔버스 자르기(drawImage)는 호출자(StudioPage)가
 * 계획(plan)을 받아 수행한다.
 */
import { normalizedPointToCanvas, type SelectionFrame, type SelPoint } from "./studio-selection-tools";

// ---------------------------------------------------------------------------
// 타입·상수
// ---------------------------------------------------------------------------

/** 정규화 크롭 rect — 이미지 요소 비회전 로컬 박스 기준 0..1. 불변식: 0≤x, x+w≤1 (y/h 동일). */
export type CropRect = { x: number; y: number; w: number; h: number };

/** 크롭 핸들 — 8방향 리사이즈 + 안쪽 이동. */
export type CropHandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move";

/** 비율 프리셋 id — ratio 는 표시(화면) px 기준 w/h. */
export type CropAspectId = "free" | "1:1" | "4:3" | "16:9";

/** 크롭 rect 최소 변 길이(정규화) — 퇴화(0×0) 방지 가드. */
export const CROP_MIN_SIZE_NORM = 0.02;

/** 리사이즈 핸들 8개 — 오버레이 렌더 순서(시계 방향, nw 시작). */
export const CROP_RESIZE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;

/** 비율 프리셋 칩 목록 — 패널에서 id/라벨/설명으로 사용. */
export const CROP_ASPECTS: { id: CropAspectId; label: string; ratio: number | null; tip: string }[] = [
  { id: "free", label: "자유", ratio: null, tip: "비율 제한 없이 자유롭게 조절합니다." },
  { id: "1:1", label: "1:1", ratio: 1, tip: "정사각형(프로필·썸네일) 비율로 잠급니다." },
  { id: "4:3", label: "4:3", ratio: 4 / 3, tip: "4:3 표준 가로 비율로 잠급니다." },
  { id: "16:9", label: "16:9", ratio: 16 / 9, tip: "16:9 와이드 비율로 잠급니다." },
];

/** 비율 프리셋 id → 표시 비율(w/h). 자유·미지정은 null. */
export function cropAspectRatio(id: CropAspectId): number | null {
  return CROP_ASPECTS.find((a) => a.id === id)?.ratio ?? null;
}

// ---------------------------------------------------------------------------
// 내부 수치 헬퍼
// ---------------------------------------------------------------------------

/** 비유한 값을 fallback 으로, 나머지는 [lo, hi]로 클램프. lo>hi(공간 부족)면 hi(경계 우선). */
function clampNum(v: number, lo: number, hi: number, fallback = 0): number {
  if (!Number.isFinite(v)) v = fallback;
  if (lo > hi) return hi;
  return v < lo ? lo : v > hi ? hi : v;
}

/** 소수 노이즈 제거(1e-4 단위) — 히스토리/직렬화에 긴 부동소수가 남지 않게 한다. */
function snap4(v: number): number {
  const r = Math.round(v * 10000) / 10000;
  return r === 0 ? 0 : r; // -0 정규화
}

/** 최소 크기 옵션 위생 처리 — 0 이하/비유한은 기본값, 1 초과는 1. */
function sanitizeMin(v: number | undefined): number {
  if (!Number.isFinite(v) || v! <= 0) return CROP_MIN_SIZE_NORM;
  return Math.min(v!, 1);
}

// ---------------------------------------------------------------------------
// (1) rect 생성·위생·판정
// ---------------------------------------------------------------------------

/** 크롭 모드 진입 시 초기 rect — 전체 영역(자르는 것 없음). */
export function initialCropRect(): CropRect {
  return { x: 0, y: 0, w: 1, h: 1 };
}

/** rect 위생 처리 — NaN 방어 + 최소 크기 + 0..1 경계로 클램프(불변식 복구). */
export function clampCropRect(rect: CropRect, opts?: { minW?: number; minH?: number }): CropRect {
  const minW = sanitizeMin(opts?.minW);
  const minH = sanitizeMin(opts?.minH);
  const w = clampNum(rect.w, minW, 1, 1);
  const h = clampNum(rect.h, minH, 1, 1);
  return {
    x: snap4(clampNum(rect.x, 0, 1 - w)),
    y: snap4(clampNum(rect.y, 0, 1 - h)),
    w: snap4(w),
    h: snap4(h),
  };
}

/** 전체 영역과 사실상 같은지 — 자를 것이 없어 적용이 무의미한 rect. */
export function isCropRectNoop(rect: CropRect, eps = 0.005): boolean {
  return rect.x <= eps && rect.y <= eps && rect.x + rect.w >= 1 - eps && rect.y + rect.h >= 1 - eps;
}

/**
 * 표시 비율(w/h) → 정규화 비율. 정규화 rect 의 w/h 가 이 값이면 화면에서 ratio 로 보인다.
 *   표시비 = (w·elW)/(h·elH) = (w/h)·frameAspect  →  w/h = ratio / frameAspect.
 * ratio 가 null/비정상이거나 frameAspect 가 비정상이면 null(자유 비율).
 */
export function normalizedCropRatio(ratio: number | null | undefined, frameAspect: number): number | null {
  if (ratio == null || !Number.isFinite(ratio) || ratio <= 0) return null;
  const fa = Number.isFinite(frameAspect) && frameAspect > 0 ? frameAspect : 1;
  return ratio / fa;
}

/**
 * 기존 rect 에 비율 프리셋 적용 — 중심·넓이를 보존한 채 비율만 맞춘 rect 로.
 * 0..1 에 안 들어가면 비율을 유지하며 축소하고, 중심이 경계를 벗어나면 안쪽으로 민다.
 */
export function applyCropAspect(
  rect: CropRect,
  ratio: number | null,
  frameAspect: number,
  opts?: { minW?: number; minH?: number }
): CropRect {
  const r = clampCropRect(rect, opts);
  const rNorm = normalizedCropRatio(ratio, frameAspect);
  if (!rNorm) return r;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  // 넓이 보존: w·h = area, w/h = rNorm → w = √(area·rNorm)
  const desiredW = Math.sqrt(r.w * r.h * rNorm);
  const capW = Math.min(1, rNorm); // w ≤ 1 이고 h = w/rNorm ≤ 1 → w ≤ rNorm
  const floorW = Math.min(capW, Math.max(sanitizeMin(opts?.minW), sanitizeMin(opts?.minH) * rNorm));
  const w = clampNum(desiredW, floorW, capW);
  const h = w / rNorm;
  return {
    x: snap4(clampNum(cx - w / 2, 0, 1 - w)),
    y: snap4(clampNum(cy - h / 2, 0, 1 - h)),
    w: snap4(w),
    h: snap4(h),
  };
}

// ---------------------------------------------------------------------------
// (2) 드래그 리듀서 — 8핸들 리사이즈 + 이동
// ---------------------------------------------------------------------------

/**
 * 진행 중 크롭 드래그 세션 — 시작 시점 rect/포인터 스냅샷.
 * updateCropDrag 는 항상 "시작 스냅샷 + 누적 델타"로 계산한다(증분 누적 오차 없음,
 * 핸들을 살짝 빗겨 잡아도 rect 가 포인터로 점프하지 않는다).
 */
export type CropDragSession = { handle: CropHandleId; startRect: CropRect; startPoint: SelPoint };

/** 드래그 옵션 — ratio 는 표시 px 기준 w/h(null=자유), frameAspect 는 요소 width/height. */
export type CropDragOptions = {
  ratio?: number | null;
  frameAspect?: number;
  minW?: number;
  minH?: number;
};

/** 드래그 시작 — rect 는 위생 처리해 스냅샷으로 고정한다. */
export function beginCropDrag(rect: CropRect, handle: CropHandleId, p: SelPoint): CropDragSession {
  return {
    handle,
    startRect: clampCropRect(rect),
    startPoint: { x: clampNum(p.x, -1e6, 1e6), y: clampNum(p.y, -1e6, 1e6) },
  };
}

/**
 * 드래그 이동 — 새 rect 를 돌려준다(불변·결정적).
 *   move        : 크기 보존 + 0..1 경계로 클램프.
 *   자유 리사이즈: 반대 코너/변을 고정(anchor)하고 잡은 쪽만 델타만큼 이동.
 *                  최소 크기 가드 — anchor 를 넘어 뒤집히지 않는다.
 *   비율 잠금   : 코너=포인터 자취를 비율 대각선에 직교 투영(양 축을 균형 있게 따라감),
 *                  가로변(e/w)=세로 중앙 고정, 세로변(n/s)=가로 중앙 고정.
 *                  경계 캡이 최소 크기보다 우선한다(0..1 탈출 방지).
 */
export function updateCropDrag(session: CropDragSession, p: SelPoint, opts?: CropDragOptions): CropRect {
  const start = session.startRect;
  const dx = clampNum(p.x, -1e6, 1e6) - session.startPoint.x;
  const dy = clampNum(p.y, -1e6, 1e6) - session.startPoint.y;

  if (session.handle === "move") {
    return {
      x: snap4(clampNum(start.x + dx, 0, 1 - start.w)),
      y: snap4(clampNum(start.y + dy, 0, 1 - start.h)),
      w: start.w,
      h: start.h,
    };
  }

  const minW = sanitizeMin(opts?.minW);
  const minH = sanitizeMin(opts?.minH);
  const west = session.handle === "nw" || session.handle === "w" || session.handle === "sw";
  const east = session.handle === "ne" || session.handle === "e" || session.handle === "se";
  const north = session.handle === "nw" || session.handle === "n" || session.handle === "ne";
  const south = session.handle === "sw" || session.handle === "s" || session.handle === "se";

  // 고정(anchor) 변 — 잡은 쪽의 반대편. 그 변에서 경계까지가 늘어날 수 있는 최대 공간.
  const ax = west ? start.x + start.w : start.x;
  const ay = north ? start.y + start.h : start.y;
  const maxW = west ? ax : 1 - ax;
  const maxH = north ? ay : 1 - ay;

  // 잡은 변을 델타만큼 움직였을 때의 잠정 크기.
  const wT = start.w + (east ? dx : west ? -dx : 0);
  const hT = start.h + (south ? dy : north ? -dy : 0);

  const rNorm = normalizedCropRatio(opts?.ratio, opts?.frameAspect ?? 1);
  let w: number;
  let h: number;
  let x: number;
  let y: number;

  if (!rNorm) {
    // 자유 비율 — 각 축 독립. 변 핸들은 수직 축을 건드리지 않는다.
    w = east || west ? clampNum(wT, minW, maxW) : start.w;
    h = north || south ? clampNum(hT, minH, maxH) : start.h;
    x = west ? ax - w : east ? ax : start.x;
    y = north ? ay - h : south ? ay : start.y;
  } else if ((east || west) && (north || south)) {
    // 코너 + 비율: (wT,hT)를 w=h·rNorm 직선에 직교 투영 — 어느 축으로 끌어도 자연스럽다.
    const t = (wT * rNorm + hT) / (rNorm * rNorm + 1); // 목표 높이
    const capW = Math.min(maxW, maxH * rNorm);
    const floorW = Math.min(capW, Math.max(minW, minH * rNorm));
    w = clampNum(t * rNorm, floorW, capW);
    h = w / rNorm;
    x = west ? ax - w : ax;
    y = north ? ay - h : ay;
  } else if (east || west) {
    // 가로변 + 비율: 세로는 rect 중앙 고정으로 파생 — 중앙 기준 위아래 공간이 캡.
    const cy = start.y + start.h / 2;
    const roomH = 2 * Math.min(cy, 1 - cy);
    const capW = Math.min(maxW, roomH * rNorm);
    const floorW = Math.min(capW, Math.max(minW, minH * rNorm));
    w = clampNum(wT, floorW, capW);
    h = w / rNorm;
    x = west ? ax - w : ax;
    y = cy - h / 2;
  } else {
    // 세로변 + 비율: 가로는 rect 중앙 고정으로 파생.
    const cx = start.x + start.w / 2;
    const roomW = 2 * Math.min(cx, 1 - cx);
    const capH = Math.min(maxH, roomW / rNorm);
    const floorH = Math.min(capH, Math.max(minH, minW / rNorm));
    h = clampNum(hT, floorH, capH);
    w = h * rNorm;
    y = north ? ay - h : ay;
    x = cx - w / 2;
  }

  // 수치 안전망 — 계산상 이미 경계 안이지만 부동소수 오차를 흡수한다.
  return {
    x: snap4(clampNum(x, 0, Math.max(0, 1 - w))),
    y: snap4(clampNum(y, 0, Math.max(0, 1 - h))),
    w: snap4(clampNum(w, 0, 1)),
    h: snap4(clampNum(h, 0, 1)),
  };
}

// ---------------------------------------------------------------------------
// (3) 히트테스트 + 오버레이 기하(전부 순수 — Konva 노드로 그리는 건 호출자)
// ---------------------------------------------------------------------------

/**
 * 화면 px 허용 오차 → 정규화 허용 오차(축별). 요소가 가늘수록 정규화 오차가 커진다.
 * @param px 캔버스 좌표계 기준 허용 px(스테이지 줌으로 이미 나눈 값).
 */
export function cropHitTolerance(
  frame: { width: number; height: number },
  px: number
): { x: number; y: number } {
  const p = Number.isFinite(px) && px > 0 ? px : 0;
  const w = Number.isFinite(frame.width) && frame.width > 0 ? frame.width : 1;
  const h = Number.isFinite(frame.height) && frame.height > 0 ? frame.height : 1;
  return { x: p / w, y: p / h };
}

/**
 * 정규화 포인터 → 핸들 판정. 우선순위: 코너 > 변(전체 변이 밴드) > 안쪽(move) > null.
 * 변 핸들은 중점만이 아니라 변 전체를 잡을 수 있다(포토샵과 동일).
 */
export function hitTestCropHandle(
  p: SelPoint,
  rect: CropRect,
  tol: { x: number; y: number }
): CropHandleId | null {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  const x0 = rect.x;
  const x1 = rect.x + rect.w;
  const y0 = rect.y;
  const y1 = rect.y + rect.h;
  if (![x0, x1, y0, y1].every(Number.isFinite)) return null;
  const tx = Math.max(0, tol.x);
  const ty = Math.max(0, tol.y);
  const nearX0 = Math.abs(p.x - x0) <= tx;
  const nearX1 = Math.abs(p.x - x1) <= tx;
  const nearY0 = Math.abs(p.y - y0) <= ty;
  const nearY1 = Math.abs(p.y - y1) <= ty;
  const inX = p.x >= x0 - tx && p.x <= x1 + tx;
  const inY = p.y >= y0 - ty && p.y <= y1 + ty;
  if (nearX0 && nearY0) return "nw";
  if (nearX1 && nearY0) return "ne";
  if (nearX1 && nearY1) return "se";
  if (nearX0 && nearY1) return "sw";
  if (nearY0 && inX) return "n";
  if (nearY1 && inX) return "s";
  if (nearX0 && inY) return "w";
  if (nearX1 && inY) return "e";
  if (p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1) return "move";
  return null;
}

/** 요소 로컬 px 크기. */
export type CropLocalSize = { width: number; height: number };

/** rect → 요소 로컬 px 박스(오버레이 테두리용). */
export function cropRectLocalPx(rect: CropRect, size: CropLocalSize): { x: number; y: number; w: number; h: number } {
  return { x: rect.x * size.width, y: rect.y * size.height, w: rect.w * size.width, h: rect.h * size.height };
}

/** 8개 핸들 중심 좌표(요소 로컬 px) — 코너 4 + 변 중점 4. */
export function cropHandlePoints(rect: CropRect, size: CropLocalSize): { id: CropHandleId; x: number; y: number }[] {
  const b = cropRectLocalPx(rect, size);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const x1 = b.x + b.w;
  const y1 = b.y + b.h;
  return [
    { id: "nw", x: b.x, y: b.y },
    { id: "n", x: cx, y: b.y },
    { id: "ne", x: x1, y: b.y },
    { id: "e", x: x1, y: cy },
    { id: "se", x: x1, y: y1 },
    { id: "s", x: cx, y: y1 },
    { id: "sw", x: b.x, y: y1 },
    { id: "w", x: b.x, y: cy },
  ];
}

/** 크롭 바깥 어둡게 마스킹 — 이미지 박스를 rect 제외 4조각(상/하/좌/우)으로 덮는다. */
export function cropShadeRects(
  rect: CropRect,
  size: CropLocalSize
): { x: number; y: number; w: number; h: number }[] {
  const b = cropRectLocalPx(rect, size);
  const W = size.width;
  const H = size.height;
  const y1 = b.y + b.h;
  return [
    { x: 0, y: 0, w: W, h: Math.max(0, b.y) }, // 상단 띠(전체 폭)
    { x: 0, y: y1, w: W, h: Math.max(0, H - y1) }, // 하단 띠(전체 폭)
    { x: 0, y: b.y, w: Math.max(0, b.x), h: Math.max(0, b.h) }, // 좌측
    { x: b.x + b.w, y: b.y, w: Math.max(0, W - (b.x + b.w)), h: Math.max(0, b.h) }, // 우측
  ];
}

/** 3분할 구도 안내선 — [x1,y1,x2,y2] 4개(세로 2 + 가로 2), 요소 로컬 px. */
export function cropThirdsLines(rect: CropRect, size: CropLocalSize): number[][] {
  const b = cropRectLocalPx(rect, size);
  const y1 = b.y + b.h;
  const x1 = b.x + b.w;
  return [
    [b.x + b.w / 3, b.y, b.x + b.w / 3, y1],
    [b.x + (2 * b.w) / 3, b.y, b.x + (2 * b.w) / 3, y1],
    [b.x, b.y + b.h / 3, x1, b.y + b.h / 3],
    [b.x, b.y + (2 * b.h) / 3, x1, b.y + (2 * b.h) / 3],
  ];
}

// ---------------------------------------------------------------------------
// (4) 적용 계획 — 원본 자연 해상도 소스 rect + 요소 프레임 보정
// ---------------------------------------------------------------------------

/** 크롭 실행 계획 — source 는 drawImage(sx,sy,sw,sh) 인자(정수 px), el 은 새 요소 프레임. */
export type CropApplyPlan = {
  /** 원본(자연 해상도) 픽셀 소스 rect — 반전(flipX/flipY)이 되반전된 좌표. */
  source: { sx: number; sy: number; sw: number; sh: number };
  /** 크롭 후 요소 프레임 — 화면상 크롭 영역이 있던 자리에 그대로 남는다(회전 보정 포함). */
  el: { x: number; y: number; width: number; height: number };
};

/**
 * 크롭 적용 계획 계산.
 *   소스: 정규화 rect(표시 기준)를 자연 px 로 환산. 표시가 반전 상태면 원본 좌표로 되반전
 *         (u0 = 1-(x+w)). 반올림 후 sx+sw ≤ naturalW 로 클램프, 최소 1px 보장.
 *   프레임: 새 좌상단 = 요소 회전을 적용한 rect 좌상단의 캔버스 좌표
 *           (normalizedPointToCanvas — 오버레이·포인터 변환과 동일 수식이라 표류가 없다).
 *           크기 = rect 비례(표시 배율 보존). 회전값은 그대로 유지된다.
 * 입력이 퇴화(자연 크기·프레임 크기 ≤0, rect 무의미)면 null.
 */
export function planCropApply(input: {
  rect: CropRect;
  natural: { width: number; height: number };
  frame: SelectionFrame;
  flipX?: boolean;
  flipY?: boolean;
}): CropApplyPlan | null {
  const { natural, frame } = input;
  if (!Number.isFinite(natural.width) || !Number.isFinite(natural.height)) return null;
  if (natural.width <= 0 || natural.height <= 0) return null;
  if (!Number.isFinite(frame.width) || !Number.isFinite(frame.height)) return null;
  if (frame.width <= 0 || frame.height <= 0) return null;
  const rect = clampCropRect(input.rect);
  if (rect.w <= 0 || rect.h <= 0) return null;

  const NW = Math.max(1, Math.round(natural.width));
  const NH = Math.max(1, Math.round(natural.height));
  // 표시(반전 후) 정규화 → 원본 정규화: 반전이면 좌우/상하를 되반전.
  const u0 = input.flipX ? 1 - (rect.x + rect.w) : rect.x;
  const v0 = input.flipY ? 1 - (rect.y + rect.h) : rect.y;
  const sx = clampNum(Math.round(u0 * NW), 0, NW - 1);
  const sy = clampNum(Math.round(v0 * NH), 0, NH - 1);
  const sw = clampNum(Math.round(rect.w * NW), 1, NW - sx);
  const sh = clampNum(Math.round(rect.h * NH), 1, NH - sy);

  const topLeft = normalizedPointToCanvas({ x: rect.x, y: rect.y }, frame);
  const round2 = (v: number) => Math.round(v * 100) / 100;
  return {
    source: { sx, sy, sw, sh },
    el: {
      x: round2(topLeft.x),
      y: round2(topLeft.y),
      width: round2(rect.w * frame.width),
      height: round2(rect.h * frame.height),
    },
  };
}
