/**
 * PPT식 다중 선택·정렬 순수 헬퍼 — StudioPage 마퀴/align 로직의 테스트 가능한 코어.
 * Konva/DOM 의존 없음.
 */

export type Rect = { x: number; y: number; w: number; h: number };

export type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
export type DistributeMode = "distributeH" | "distributeV";

const MIN_MARQUEE = 3;

/** 드래그 시작·끝 좌표를 정규화된 마퀴 사각형으로 변환한다. */
export function normalizeMarqueeRect(ax: number, ay: number, bx: number, by: number): Rect {
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    w: Math.abs(bx - ax),
    h: Math.abs(by - ay),
  };
}

/** 두 사각형이 면적을 공유하는지(경계 접촉 포함). */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** 점이 사각형 안에 있는지(경계 포함). */
export function rectContainsPoint(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

export type CanvasPlacementFootprint = {
  width: number;
  height: number;
  margin?: number;
};

function clampPlacementAxis(center: number, extent: number, canvasExtent: number, margin: number) {
  const safeCanvasExtent = Math.max(1, Number.isFinite(canvasExtent) ? canvasExtent : 1);
  const safeExtent = Math.max(0, Number.isFinite(extent) ? extent : 0);
  const safeMargin = Math.max(
    0,
    Math.min(Number.isFinite(margin) ? margin : 0, safeCanvasExtent / 2)
  );
  const safeCenter = Number.isFinite(center) ? center : safeCanvasExtent / 2;
  if (safeExtent >= safeCanvasExtent - safeMargin * 2) return safeCanvasExtent / 2;
  return Math.min(
    Math.max(safeCenter, safeMargin + safeExtent / 2),
    safeCanvasExtent - safeMargin - safeExtent / 2
  );
}

/** Keep a center-anchored insertion's full footprint inside the document whenever it can fit. */
export function clampCanvasPlacementCenter(
  canvasW: number,
  canvasH: number,
  center: { x: number; y: number },
  footprint: CanvasPlacementFootprint
): [number, number] {
  return [
    clampPlacementAxis(center.x, footprint.width, canvasW, footprint.margin ?? 0),
    clampPlacementAxis(center.y, footprint.height, canvasH, footprint.margin ?? 0),
  ];
}

/** StudioPage.spawnCenter — 선택 패널, 현재 보이는 작업 영역, 문서 중심 순서. */
export function viewportSpawnCenter(
  canvasW: number,
  canvasH: number,
  selectedFrame?: Rect | null,
  viewCenter?: { x: number; y: number } | null
): [number, number] {
  if (selectedFrame) {
    return [selectedFrame.x + selectedFrame.w / 2, selectedFrame.y + selectedFrame.h / 2];
  }
  if (viewCenter && Number.isFinite(viewCenter.x) && Number.isFinite(viewCenter.y)) {
    return [
      Math.min(Math.max(viewCenter.x, 0), canvasW),
      Math.min(Math.max(viewCenter.y, 0), canvasH),
    ];
  }
  return [canvasW / 2, canvasH / 2];
}

/** 마퀴가 의미 있는 크기인지(우발 클릭 제외). */
export function isMeaningfulMarquee(rect: Rect, minSize = MIN_MARQUEE): boolean {
  return rect.w > minSize && rect.h > minSize;
}

/** 마퀴와 교차하는 항목 id 목록(숨김·잠금 등은 include로 필터). */
export function selectIdsByMarquee<T extends { id: string }>(
  items: readonly T[],
  getBounds: (item: T) => Rect,
  marquee: Rect,
  opts?: { minSize?: number; include?: (item: T) => boolean }
): string[] {
  if (!isMeaningfulMarquee(marquee, opts?.minSize)) return [];
  const include = opts?.include ?? (() => true);
  return items
    .filter((item) => include(item) && rectsIntersect(marquee, getBounds(item)))
    .map((item) => item.id);
}

/**
 * Topmost (last matching) object id under a document point. Linear scan for product paths
 * that do not yet hold an RBush index; hybrid large-doc pick should prefer spatial indexes.
 */
export function pickObjectIdAtPoint<T extends { id: string }>(
  items: readonly T[],
  getBounds: (item: T) => Rect,
  point: Readonly<{ x: number; y: number }>,
  opts?: { include?: (item: T) => boolean },
): string | null {
  const include = opts?.include ?? (() => true);
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    if (!include(item)) continue;
    if (rectContainsPoint(getBounds(item), point.x, point.y)) return item.id;
  }
  return null;
}

/** 여러 bounds의 합집합 bbox. */
export function unionBounds(bounds: readonly Rect[]): Rect {
  if (bounds.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of bounds) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export type AlignDelta = { dx: number; dy: number };

/**
 * 복수 선택 정렬 — 각 bounds를 target(미지정 시 선택 합집합) 기준으로 이동량을 계산한다.
 */
export function computeAlignDeltas(bounds: readonly Rect[], mode: AlignMode, target?: Rect): AlignDelta[] {
  if (bounds.length === 0) return [];
  const box = target ?? unionBounds(bounds);
  return bounds.map((b) => {
    let dx = 0;
    let dy = 0;
    if (mode === "left") dx = box.x - b.x;
    else if (mode === "right") dx = box.x + box.w - b.w - b.x;
    else if (mode === "hcenter") dx = box.x + (box.w - b.w) / 2 - b.x;
    else if (mode === "top") dy = box.y - b.y;
    else if (mode === "bottom") dy = box.y + box.h - b.h - b.y;
    else if (mode === "vcenter") dy = box.y + (box.h - b.h) / 2 - b.y;
    return { dx, dy };
  });
}

/**
 * 가로/세로 균등 분배 — 3개 이상일 때 양 끝은 고정, 중간만 이동. 부족하면 null.
 */
export function computeDistributeDeltas(bounds: readonly Rect[], mode: DistributeMode): AlignDelta[] | null {
  if (bounds.length < 3) return null;
  const deltas: AlignDelta[] = bounds.map(() => ({ dx: 0, dy: 0 }));

  if (mode === "distributeH") {
    const indexed = bounds.map((b, i) => ({ i, cx: b.x + b.w / 2 }));
    indexed.sort((a, b) => a.cx - b.cx);
    const start = indexed[0]!.cx;
    const end = indexed[indexed.length - 1]!.cx;
    const step = (end - start) / (indexed.length - 1);
    for (let rank = 1; rank < indexed.length - 1; rank++) {
      const item = indexed[rank]!;
      const targetCx = start + rank * step;
      const dx = targetCx - item.cx;
      deltas[item.i] = { dx, dy: 0 };
    }
    return deltas;
  }

  const indexed = bounds.map((b, i) => ({ i, cy: b.y + b.h / 2 }));
  indexed.sort((a, b) => a.cy - b.cy);
  const start = indexed[0]!.cy;
  const end = indexed[indexed.length - 1]!.cy;
  const step = (end - start) / (indexed.length - 1);
  for (let rank = 1; rank < indexed.length - 1; rank++) {
    const item = indexed[rank]!;
    const targetCy = start + rank * step;
    const dy = targetCy - item.cy;
    deltas[item.i] = { dx: 0, dy };
  }
  return deltas;
}
