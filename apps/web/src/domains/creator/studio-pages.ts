/**
 * Studio Pages — pure multi-page state operations for cuttoon editor.
 * 페이지 추가/복제/삭제/이동/재배치/일괄 적용 등 다중 페이지 조작의 순수 로직.
 * 히스토리/커밋/선택 상태 관리는 호출 측(StudioPage)에서 담당.
 *
 * 전부 불변 · 부수효과 없음. Konva/React/DOM 의존 없음.
 * 단위 테스트와 StudioPage가 동일한 진짜 export를 사용한다.
 */

import {
  mirrorStudioDrawingAssistDocument,
  parseStudioDrawingAssistDocument,
} from "./brush/studio-drawing-assist-document";
import {
  remapStudioLinked3dRenderDocumentElementIds,
  studioLinked3dRenderElementIds,
} from "./studio-linked-3d-render-document";
import {
  remapStudioShared3dStageCollectionElementIds,
  studioShared3dStageLinkedCharacterElementIds,
} from "./studio-shared-3d-stage-collection";

export interface PageElementLike {
  id: string;
  type?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  rotation?: unknown;
  points?: unknown;
  tail?: unknown;
  tailDirection?: unknown;
  tailXRatio?: unknown;
  text?: unknown;
}

export interface PageLike {
  id: string;
  elements: PageElementLike[];
  bg: string;
  bgGrad: string[] | null;
  canvasH: number;
  grade?: unknown;
  groups?: Array<{ id: string }>;
  drawingAssist?: unknown;
  shared3dStage?: unknown;
  linked3dRender?: unknown;
}

export const DEFAULT_CANVAS_H = 1080;
export const DEFAULT_BG = "#ffffff";

/** 새 빈 페이지 생성. makeId로 호출자가 UUID 등을 제공(테스트 시 결정적 id 가능). */
export function createBlankPage(makeId: () => string, canvasH: number = DEFAULT_CANVAS_H): PageLike {
  return {
    id: makeId(),
    elements: [],
    bg: DEFAULT_BG,
    bgGrad: null,
    canvasH,
  };
}

/** 페이지 복제 — 새 id + elements의 각 id도 새로 부여. 원본 불변. */
export function duplicatePageState<P extends PageLike>(page: P, makeId: () => string): P {
  const nextPageId = makeId();
  const copiedElements = page.elements.map((element) => ({
    source: element,
    nextId: makeId(),
  }));
  const sourceIdCounts = new Map<string, number>();
  for (const { source } of copiedElements) {
    sourceIdCounts.set(source.id, (sourceIdCounts.get(source.id) ?? 0) + 1);
  }
  const elementIdMap = new Map(
    copiedElements.flatMap(({ source, nextId }) =>
      sourceIdCounts.get(source.id) === 1
        ? [[source.id, nextId] as const]
        : []),
  );
  const duplicated = {
    ...page,
    id: nextPageId,
    elements: copiedElements.map(({ source, nextId }) => ({ ...source, id: nextId })),
  } as P;
  if (page.shared3dStage !== undefined) {
    const linkedIds = studioShared3dStageLinkedCharacterElementIds(page.shared3dStage);
    for (const elementId of linkedIds ?? []) {
      // Preserve missing-character tombstones on the copied page without cross-linking the source
      // page. Allocate after every live element so existing deterministic ID call order is stable.
      if (!elementIdMap.has(elementId)) elementIdMap.set(elementId, makeId());
    }
    const remapped = remapStudioShared3dStageCollectionElementIds(
      page.shared3dStage,
      elementIdMap,
    );
    if (remapped) duplicated.shared3dStage = remapped;
    else delete duplicated.shared3dStage;
  }
  if (page.linked3dRender !== undefined) {
    const linkedIds = studioLinked3dRenderElementIds(page.linked3dRender);
    if (!linkedIds) {
      delete duplicated.linked3dRender;
    } else {
      const remapped = remapStudioLinked3dRenderDocumentElementIds(
        page.linked3dRender,
        elementIdMap,
      );
      if (remapped) duplicated.linked3dRender = remapped;
      else delete duplicated.linked3dRender;
    }
  }
  return duplicated;
}

/** 지정 인덱스에 빈 페이지 삽입 (0..length 범위 클램프). */
export function insertBlankPageAt<P extends PageLike>(
  pages: readonly P[],
  index: number,
  makeId: () => string,
  canvasH: number = DEFAULT_CANVAS_H
): P[] {
  const safeIdx = Math.max(0, Math.min(index, pages.length));
  const newPage = createBlankPage(makeId, canvasH) as P;
  const next = pages.slice();
  next.splice(safeIdx, 0, newPage);
  return next;
}

/** fromIdx → toIdx 로 재배치 (splice 이동). 범위 벗어나면 원본 복사 반환. */
export function reorderPages<P extends PageLike>(
  pages: readonly P[],
  fromIndex: number,
  toIndex: number
): P[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= pages.length ||
    toIndex > pages.length
  ) {
    return pages.slice();
  }
  const next = pages.slice();
  const [moved] = next.splice(fromIndex, 1);
  // splice remove 후 toIndex를 그대로 사용하면 이동 의미가 정확 (append 시 length 허용).
  next.splice(toIndex, 0, moved);
  return next;
}

/** 페이지 삭제 (1개 이하 시 원본 그대로). */
export function deletePageSafe<P extends PageLike>(pages: readonly P[], pageId: string): P[] {
  if (pages.length <= 1) return pages.slice();
  return pages.filter((p) => p.id !== pageId);
}

/** 방향 이동(up=-1, down=+1) — reorderPages 재사용. */
export function movePage<P extends PageLike>(pages: readonly P[], pageId: string, dir: -1 | 1): P[] {
  const idx = pages.findIndex((p) => p.id === pageId);
  if (idx < 0) return pages.slice();
  const target = idx + dir;
  if (target < 0 || target >= pages.length) return pages.slice();
  return reorderPages(pages, idx, target);
}

/** 현재 페이지 내용만 비우기 (elements=[], groups는 보존 — 스타일/구조 유지). */
export function clearPage<P extends PageLike>(pages: readonly P[], pageId: string): P[] {
  return pages.map((p) =>
    p.id === pageId
      ? ({ ...p, elements: [], shared3dStage: undefined, linked3dRender: undefined } as P)
      : p
  );
}

/** 모든 페이지에 동일 grade 적용 (복사본). grade는 정규화된 값 또는 undefined. */
export function applyGradeToAllPages<P extends PageLike>(pages: readonly P[], grade: unknown): P[] {
  return pages.map((p) => ({ ...p, grade } as P));
}

/** 모든 페이지에 동일 bg / bgGrad 적용. */
export function applyBackgroundToAllPages<P extends PageLike>(
  pages: readonly P[],
  bg: string,
  bgGrad: string[] | null
): P[] {
  return pages.map((p) => ({ ...p, bg, bgGrad } as P));
}

/** 가로 미러(좌우 반전) 복제 — 위치/폭/points x 좌표 반전. draw/image/text/frame 등 지원.
 * 버블 꼬리(left/right)와 tailXRatio도 대칭 보정.
 */
export function duplicateMirroredPage<P extends PageLike>(
  page: P,
  makeId: () => string,
  canvasW: number
): P {
  const drawingAssist = parseStudioDrawingAssistDocument(page.drawingAssist);
  const elementIdMap = new Map<string, string>();
  const sourceIdCounts = new Map<string, number>();
  for (const element of page.elements) {
    sourceIdCounts.set(element.id, (sourceIdCounts.get(element.id) ?? 0) + 1);
  }
  const mirroredEls = page.elements.map((el) => {
    const w = typeof el.width === "number" ? el.width : 0;
    const x = typeof el.x === "number" ? el.x : 0;
    const newX = canvasW - x - w;
    const rot = typeof el.rotation === "number" ? el.rotation : 0;
    const nextId = makeId();
    if (sourceIdCounts.get(el.id) === 1) elementIdMap.set(el.id, nextId);
    const newEl: PageElementLike = { ...el, id: nextId, x: newX, rotation: -rot };

    // draw freehand/shape points: x좌표만 반전
    if (Array.isArray(el.points) && el.points.length > 0) {
      const pts = el.points as number[];
      const flipped: number[] = [];
      for (let i = 0; i < pts.length; i += 2) {
        const px = pts[i] ?? 0;
        const py = pts[i + 1] ?? 0;
        flipped.push(canvasW - px, py);
      }
      newEl.points = flipped;
    }

    // frame 비정형 polygon points 반전
    if (Array.isArray(el.points) && el.type === "frame") {
      // 이미 위에서 처리됨 (points는 x,y 연속). frame points는 로컬? 하지만 안전하게 캔버스 기준 반전.
      // (기존 사용은 x,y 절대라 동일 로직 OK)
    }

    // Bubble tail 대칭: left <-> right, tailXRatio 1-x 로 반전 (상하 tailDirection은 시각적 유지)
    if (el.type === "bubble") {
      if (el.tail === "left") newEl.tail = "right";
      else if (el.tail === "right") newEl.tail = "left";
      if (el.tailDirection === "left") newEl.tailDirection = "right";
      else if (el.tailDirection === "right") newEl.tailDirection = "left";
      if (typeof el.tailXRatio === "number") {
        newEl.tailXRatio = 1 - el.tailXRatio;
      }
      // tailHeight, top/bottom direction 등은 수평 반전에서 상대적으로 유지
    }

    // lockAspect 등 기타는 복사 유지
    return newEl;
  });

  const mirrored = {
    ...page,
    id: makeId(),
    elements: mirroredEls,
    ...(drawingAssist
      ? { drawingAssist: mirrorStudioDrawingAssistDocument(drawingAssist, canvasW) }
      : {}),
  } as P;
  if (page.shared3dStage !== undefined) {
    const linkedIds = studioShared3dStageLinkedCharacterElementIds(page.shared3dStage);
    for (const elementId of linkedIds ?? []) {
      if (!elementIdMap.has(elementId)) elementIdMap.set(elementId, makeId());
    }
    const remapped = remapStudioShared3dStageCollectionElementIds(
      page.shared3dStage,
      elementIdMap,
    );
    if (remapped) mirrored.shared3dStage = remapped;
    else delete mirrored.shared3dStage;
  }
  if (page.linked3dRender !== undefined) {
    const linkedIds = studioLinked3dRenderElementIds(page.linked3dRender);
    if (!linkedIds) {
      delete mirrored.linked3dRender;
    } else {
      const remapped = remapStudioLinked3dRenderDocumentElementIds(
        page.linked3dRender,
        elementIdMap,
      );
      if (remapped) mirrored.linked3dRender = remapped;
      else delete mirrored.linked3dRender;
    }
  }
  return mirrored;
}

/** 유틸: id로 페이지 인덱스 찾기. */
export function findPageIndex<P extends PageLike>(pages: readonly P[], pageId: string): number {
  return pages.findIndex((p) => p.id === pageId);
}

/**
 * Compute the id of the page that should become active after deleting one.
 * Replicates the original preference: pages[idx-1] || pages[idx+1] || pages[0]
 * (id-based snapshot to avoid stale array bugs).
 */
export function computeNextActiveIdAfterDelete<P extends { id: string }>(
  pages: readonly P[],
  deletedId: string
): string | null {
  if (pages.length <= 1) return null;
  const idx = pages.findIndex((p) => p.id === deletedId);
  if (idx < 0) return pages[0]?.id ?? null;
  const prev = idx > 0 ? pages[idx - 1] : null;
  const nxt = idx + 1 < pages.length ? pages[idx + 1] : null;
  const candidate = prev || nxt || pages[0];
  return candidate ? candidate.id : null;
}

/**
 * Pure append for a new blank page (the shipped "추가" command).
 * Returns the new immutable list and the id of the appended page.
 * Component does: const {nextPages, newPageId} = append... ; commitPages(nextPages); setCurrent(newPageId);
 */
export function appendPageState<P extends PageLike>(
  pages: readonly P[],
  makeId: () => string,
  baseH: number = DEFAULT_CANVAS_H
): { nextPages: P[]; newPageId: string } {
  const newPage = createBlankPage(makeId, baseH) as P;
  const nextPages = [...pages, newPage];
  return { nextPages, newPageId: newPage.id };
}

/** Insert a blank page with a known id so follow can jump before CRDT topology arrives. */
export function adoptMissingPage<P extends PageLike>(
  pages: readonly P[],
  pageId: string,
  baseH: number = DEFAULT_CANVAS_H
): P[] {
  const id = pageId.trim();
  if (!id || pages.some((page) => page.id === id)) return pages as P[];
  return [...pages, createBlankPage(() => id, baseH) as P];
}

/**
 * Pure delete transition (the shipped delete command).
 * Returns the new list and the id that should become active (if the deleted one was current).
 * Component does the commit + setCurrent based on this.
 */
export function executeDeletePageTransition<P extends PageLike>(
  pages: readonly P[],
  deletedId: string,
  currentId: string | null
): { nextPages: P[]; nextActiveId: string | null } {
  if (pages.length <= 1) {
    return { nextPages: [...pages], nextActiveId: currentId };
  }
  const nextPages = deletePageSafe(pages, deletedId);
  const nextActiveId = computeNextActiveIdAfterDelete(pages, deletedId);
  return { nextPages, nextActiveId };
}

/**
 * CLIP STUDIO–style multi-select page ops (CSP EX page manager bulk move/delete).
 * Selection order is ignored; document order is canonical. Always keeps ≥1 page.
 */
export function normalizeSelectedPageIds(
  pages: readonly { id: string }[],
  selectedIds: readonly string[]
): string[] {
  const allowed = new Set(pages.map((page) => page.id));
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const page of pages) {
    if (!allowed.has(page.id) || !selectedIds.includes(page.id) || seen.has(page.id)) continue;
    seen.add(page.id);
    ordered.push(page.id);
  }
  return ordered;
}

/** Delete every selected page in one step; never removes the last remaining page. */
export function deletePagesBulk<P extends PageLike>(
  pages: readonly P[],
  selectedIds: readonly string[]
): { nextPages: P[]; removedIds: readonly string[]; keptIds: readonly string[] } {
  const selected = new Set(normalizeSelectedPageIds(pages, selectedIds));
  if (selected.size === 0 || pages.length <= 1) {
    return { nextPages: pages.slice() as P[], removedIds: [], keptIds: pages.map((p) => p.id) };
  }
  // Preserve at least one page: if selection would wipe the document, keep the first unselected
  // or the first page when everything is selected.
  let next = pages.filter((page) => !selected.has(page.id));
  if (next.length === 0) {
    next = [pages[0]!];
  }
  const kept = new Set(next.map((page) => page.id));
  const removedIds = pages.filter((page) => !kept.has(page.id)).map((page) => page.id);
  return {
    nextPages: next as P[],
    removedIds,
    keptIds: next.map((page) => page.id),
  };
}

/**
 * Move the selected contiguous/non-contiguous pages as a block by `delta` slots
 * (negative = earlier in the list). Relative order among selected pages is preserved.
 */
export function movePagesBulk<P extends PageLike>(
  pages: readonly P[],
  selectedIds: readonly string[],
  delta: number
): P[] {
  if (!Number.isFinite(delta) || delta === 0 || pages.length <= 1) {
    return pages.slice() as P[];
  }
  const selected = normalizeSelectedPageIds(pages, selectedIds);
  if (selected.length === 0) return pages.slice() as P[];
  const selectedSet = new Set(selected);
  const moving = pages.filter((page) => selectedSet.has(page.id));
  const firstIndex = pages.findIndex((page) => selectedSet.has(page.id));
  if (firstIndex < 0) return pages.slice() as P[];
  const without = pages.filter((page) => !selectedSet.has(page.id));
  // Insert relative to how many unselected pages sit before the first selected page.
  let unselectedBefore = 0;
  for (let i = 0; i < firstIndex; i += 1) {
    if (!selectedSet.has(pages[i]!.id)) unselectedBefore += 1;
  }
  const insertAt = Math.max(0, Math.min(without.length, unselectedBefore + Math.trunc(delta)));
  const next = without.slice();
  next.splice(insertAt, 0, ...moving);
  // no-op identity: same order
  if (
    next.length === pages.length &&
    next.every((page, index) => page.id === pages[index]?.id)
  ) {
    return pages.slice() as P[];
  }
  return next as P[];
}

/** Active page after bulk delete: keep current if still present, else nearest surviving neighbour. */
export function computeNextActiveIdAfterBulkDelete<P extends { id: string }>(
  previousPages: readonly P[],
  nextPages: readonly P[],
  currentId: string | null
): string | null {
  if (nextPages.length === 0) return null;
  if (currentId && nextPages.some((page) => page.id === currentId)) return currentId;
  if (!currentId) return nextPages[0]?.id ?? null;
  const prevIndex = previousPages.findIndex((page) => page.id === currentId);
  if (prevIndex < 0) return nextPages[0]?.id ?? null;
  // Walk backward then forward for a surviving neighbour.
  for (let i = prevIndex - 1; i >= 0; i -= 1) {
    const id = previousPages[i]!.id;
    if (nextPages.some((page) => page.id === id)) return id;
  }
  for (let i = prevIndex + 1; i < previousPages.length; i += 1) {
    const id = previousPages[i]!.id;
    if (nextPages.some((page) => page.id === id)) return id;
  }
  return nextPages[0]?.id ?? null;
}
