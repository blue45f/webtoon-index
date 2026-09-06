/**
 * Studio Dialogue Batch — 배치된 말풍선·텍스트 대사 일괄 편집(코미포식)의 순수 코어.
 *
 * 스크립트→삽입(studio-dialogue)의 역방향 편집이다. 이미 캔버스에 놓인 bubble/text
 * 요소를 페이지 순서대로 목록화하고, 찾아바꾸기를 "패치 계획(plan)"으로 계산한다.
 * 실제 상태 반영은 메인 루프(StudioPage)가 plan 을 applyReplacePlanToPages 로 적용해
 * 단일 히스토리 커밋(실행취소 1회)으로 처리한다.
 *
 * 규칙:
 *  - Konva/DOM 의존 없음(전부 순수·결정적). 사용자 노출 문자열은 한글.
 *  - 입력 배열/객체는 절대 변형하지 않는다. 바뀐 페이지·요소만 새 객체로 만들고,
 *    바뀐 것이 하나도 없으면 입력 배열을 그대로(참조 동일) 돌려준다 → 호출부가
 *    `next !== pages` 로 불필요한 히스토리 커밋을 막을 수 있다.
 *  - 잠긴 요소(자체 locked 또는 소속 그룹 locked)는 캔버스 편집과 동일하게
 *    기본적으로 치환 대상에서 제외한다(includeLocked 로 해제 가능).
 */

import { BUBBLE_VARIANTS } from "../studio-assets";
import { isEffectivelyHidden, isEffectivelyLocked, type LayerGroup } from "../studio-layers";

// ── 구조 타입 — StudioPage 의 El/PageState 최소 부분집합(임포트 순환 방지) ──────

/** StudioPage El 의 대사 편집에 필요한 최소 형태. */
export type DialogueElementLike = {
  id: string;
  type: string;
  text?: string;
  variant?: string;
  name?: string;
  /** Future/imported documents may provide an explicit reading order. */
  order?: number;
  /** Optional explicit panel association. Current canvas documents are also inferred spatially. */
  frameId?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  groupId?: string;
  hidden?: boolean;
  locked?: boolean;
};

/** StudioPage PageState 의 최소 형태(요소 + 레이어 그룹). */
export type DialoguePageLike = {
  id: string;
  elements: readonly DialogueElementLike[];
  groups?: LayerGroup[];
};

export type DialogueItemType = "bubble" | "text";

/** 패널 목록 한 행 — 페이지 순서→요소 순서(z순서)로 결정적으로 나열된다. */
export type DialogueBatchItem = {
  id: string;
  pageId: string;
  /** 0 기준 페이지 순번(표시할 땐 +1). */
  pageIndex: number;
  elType: DialogueItemType;
  /** 말풍선 종류 id(bubble 일 때만). */
  variant?: string;
  text: string;
  /** 유효 숨김(요소 자체 또는 소속 그룹). */
  hidden: boolean;
  /** 유효 잠금(요소 자체 또는 소속 그룹). */
  locked: boolean;
};

export type DialogueNavigationDirection = "next" | "previous";

// ── 목록화 ──────────────────────────────────────────────────────────────────

/** 대사 요소인지 — bubble/text 타입이면서 문자열 text 를 가진 요소만. */
export function isDialogueElement(
  el: DialogueElementLike
): el is DialogueElementLike & { type: DialogueItemType; text: string } {
  return (el.type === "bubble" || el.type === "text") && typeof el.text === "string";
}

type SpatialFrame = {
  id: string;
  sourceIndex: number;
  order: number | null;
  x: number;
  y: number;
  width: number;
  height: number;
};

type DialogueSortRecord = {
  item: DialogueBatchItem;
  sourceIndex: number;
  order: number | null;
  frameRank: number;
  x: number;
  y: number;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function spatialCoordinate(value: unknown): number {
  return finiteNumber(value) ?? Number.POSITIVE_INFINITY;
}

function compareExplicitOrderThenPosition(
  left: Pick<DialogueSortRecord, "order" | "y" | "x" | "sourceIndex">,
  right: Pick<DialogueSortRecord, "order" | "y" | "x" | "sourceIndex">
): number {
  // A partially ordered import remains deterministic: authored rows come first, then spatial rows.
  const leftOrderBucket = left.order == null ? 1 : 0;
  const rightOrderBucket = right.order == null ? 1 : 0;
  return (
    leftOrderBucket - rightOrderBucket ||
    (left.order ?? 0) - (right.order ?? 0) ||
    left.y - right.y ||
    left.x - right.x ||
    left.sourceIndex - right.sourceIndex
  );
}

function collectSpatialFrames(elements: readonly DialogueElementLike[]): SpatialFrame[] {
  return elements
    .flatMap((el, sourceIndex): SpatialFrame[] => {
      if (el.type !== "frame") return [];
      const x = finiteNumber(el.x);
      const y = finiteNumber(el.y);
      const width = finiteNumber(el.width);
      const height = finiteNumber(el.height);
      if (x == null || y == null || width == null || height == null || width <= 0 || height <= 0) {
        return [];
      }
      return [
        {
          id: el.id,
          sourceIndex,
          order: finiteNumber(el.order),
          x,
          y,
          width,
          height,
        },
      ];
    })
    .sort((left, right) => compareExplicitOrderThenPosition(left, right));
}

function inferredFrameRank(el: DialogueElementLike, frames: readonly SpatialFrame[]): number {
  if (frames.length === 0) return 0;
  if (el.frameId) {
    const explicitRank = frames.findIndex((frame) => frame.id === el.frameId);
    if (explicitRank >= 0) return explicitRank;
  }

  const x = finiteNumber(el.x);
  const y = finiteNumber(el.y);
  if (x == null || y == null) return frames.length;
  const centerX = x + Math.max(0, finiteNumber(el.width) ?? 0) / 2;
  const centerY = y + Math.max(0, finiteNumber(el.height) ?? 0) / 2;
  let bestRank = frames.length;
  let bestArea = Number.POSITIVE_INFINITY;
  frames.forEach((frame, rank) => {
    if (
      centerX < frame.x ||
      centerX > frame.x + frame.width ||
      centerY < frame.y ||
      centerY > frame.y + frame.height
    ) {
      return;
    }
    // Overlapping/nested panels resolve to the most specific containing frame.
    const area = frame.width * frame.height;
    if (area < bestArea) {
      bestArea = area;
      bestRank = rank;
    }
  });
  return bestRank;
}

/**
 * 전체 페이지에서 대사 요소를 실제 읽기 순서로 목록화한다.
 * 페이지 → 컷(위→아래, 왼→오른) → 명시 order → 요소 위치 y/x → 원래 배열 순서다.
 */
export function collectDialogueItems(pages: readonly DialoguePageLike[]): DialogueBatchItem[] {
  const out: DialogueBatchItem[] = [];
  pages.forEach((page, pageIndex) => {
    const groups = page.groups ?? [];
    const frames = collectSpatialFrames(page.elements);
    const records: DialogueSortRecord[] = [];
    page.elements.forEach((el, sourceIndex) => {
      if (!isDialogueElement(el)) return;
      records.push({
        sourceIndex,
        order: finiteNumber(el.order),
        frameRank: inferredFrameRank(el, frames),
        x: spatialCoordinate(el.x),
        y: spatialCoordinate(el.y),
        item: {
          id: el.id,
          pageId: page.id,
          pageIndex,
          elType: el.type,
          variant: el.type === "bubble" ? el.variant : undefined,
          text: el.text,
          hidden: isEffectivelyHidden(el, groups),
          locked: isEffectivelyLocked(el, groups),
        },
      });
    });
    records.sort(
      (left, right) =>
        left.frameRank - right.frameRank || compareExplicitOrderThenPosition(left, right)
    );
    out.push(...records.map((record) => record.item));
  });
  return out;
}

/** 현재 목록 순서에서 잠기지 않은 다음/이전 대사를 찾는다. 끝에서는 순환하지 않는다. */
export function adjacentEditableDialogueItem(
  items: readonly DialogueBatchItem[],
  currentId: string,
  direction: DialogueNavigationDirection
): DialogueBatchItem | null {
  const currentIndex = items.findIndex((item) => item.id === currentId);
  if (currentIndex < 0) return null;
  const step = direction === "next" ? 1 : -1;
  for (let index = currentIndex + step; index >= 0 && index < items.length; index += step) {
    const candidate = items[index];
    if (candidate && !candidate.locked) return candidate;
  }
  return null;
}

// 말풍선 종류 라벨 — studio-assets 의 BUBBLE_VARIANTS 를 단일 소스로 사용(드리프트 방지).
const BUBBLE_LABEL_BY_VARIANT = new Map<string, string>(BUBBLE_VARIANTS.map((v) => [v.id, v.label]));

/** 목록 행 종류 라벨 — "말풍선·생각" / "텍스트". 알 수 없는 variant 는 "말풍선". */
export function dialogueItemTypeLabel(item: Pick<DialogueBatchItem, "elType" | "variant">): string {
  if (item.elType === "text") return "텍스트";
  const label = item.variant ? BUBBLE_LABEL_BY_VARIANT.get(item.variant) : undefined;
  return label ? `말풍선·${label}` : "말풍선";
}

/** 한 줄 미리보기 — 개행을 " / "로 접고 max 를 넘으면 말줄임표를 붙인다. */
export function dialogueExcerpt(text: string, max = 24): string {
  const oneLine = text.replace(/\s*\n+\s*/g, " / ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/** 목록 검색 — 대사 본문·종류 라벨에 부분일치(대소문자 무시). 빈 질의는 전체. */
export function filterDialogueItems(
  items: readonly DialogueBatchItem[],
  query: string
): DialogueBatchItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter(
    (item) =>
      item.text.toLowerCase().includes(q) || dialogueItemTypeLabel(item).toLowerCase().includes(q)
  );
}

// ── 찾아바꾸기 planner ──────────────────────────────────────────────────────

export type DialogueReplaceScope = "all" | "current";

export type DialogueReplaceOptions = {
  /** 대소문자 구분(기본 false = 구분 안 함). */
  caseSensitive?: boolean;
  /** 대상 페이지 범위(기본 "all"). */
  scope?: DialogueReplaceScope;
  /** scope="current" 일 때 기준 페이지 id. 미지정이면 current 범위는 빈 계획. */
  currentPageId?: string;
  /** 잠긴 요소도 치환(기본 false = 캔버스 편집과 동일하게 보호). */
  includeLocked?: boolean;
};

/** 요소 1개 치환 패치 — prevText 는 미리보기·검증용. */
export type DialogueTextPatch = {
  id: string;
  text: string;
  prevText: string;
  /** 이 요소 안에서의 치환 건수. */
  count: number;
};

export type DialoguePagePatches = {
  pageId: string;
  patches: DialogueTextPatch[];
  /** 이 페이지의 치환 건수 합. */
  count: number;
};

/** 찾아바꾸기 계산 결과 — 적용 전 미리보기와 단일 커밋 적용에 모두 쓰인다. */
export type DialogueReplacePlan = {
  /** 치환이 실제로 생기는 페이지만 담긴다. */
  pages: DialoguePagePatches[];
  /** 전체 치환 건수. */
  totalCount: number;
  /** 텍스트가 바뀌는 요소 수. */
  elementCount: number;
  /** 텍스트가 바뀌는 페이지 수. */
  pageCount: number;
  /** 매치가 있었지만 잠겨서 건너뛴 요소 수(사용자 안내용). */
  lockedSkipped: number;
};

const EMPTY_PLAN: DialogueReplacePlan = {
  pages: [],
  totalCount: 0,
  elementCount: 0,
  pageCount: 0,
  lockedSkipped: 0,
};

// 정규식 메타문자 이스케이프 — 찾기 문자열을 리터럴로만 매칭한다.
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFindRegex(find: string, caseSensitive: boolean): RegExp {
  return new RegExp(escapeRegExp(find), caseSensitive ? "g" : "gi");
}

/** 문자열 안 매치 건수(비중첩, 표준 찾아바꾸기 의미론). 빈 찾기는 0. */
export function countOccurrences(text: string, find: string, caseSensitive = false): number {
  if (!find) return 0;
  return text.match(buildFindRegex(find, caseSensitive))?.length ?? 0;
}

/**
 * 문자열 치환 — 바꾸기 문자열의 "$&" 같은 패턴이 해석되지 않도록
 * 치환자 함수를 써서 항상 리터럴로 넣는다. 빈 찾기는 무변경.
 */
export function replaceOccurrences(
  text: string,
  find: string,
  replace: string,
  caseSensitive = false
): { text: string; count: number } {
  if (!find) return { text, count: 0 };
  let count = 0;
  const next = text.replace(buildFindRegex(find, caseSensitive), () => {
    count += 1;
    return replace;
  });
  return { text: next, count };
}

/**
 * 찾아바꾸기 계획 계산 — 상태는 건드리지 않는다.
 * 결과 텍스트가 원본과 같은 요소(예: 찾기=바꾸기)는 패치에 넣지 않는다.
 */
export function planDialogueReplace(
  pages: readonly DialoguePageLike[],
  find: string,
  replace: string,
  opts: DialogueReplaceOptions = {}
): DialogueReplacePlan {
  if (!find) return EMPTY_PLAN;
  const caseSensitive = opts.caseSensitive ?? false;
  const includeLocked = opts.includeLocked ?? false;
  const scope = opts.scope ?? "all";
  const targets =
    scope === "current" ? pages.filter((page) => page.id === opts.currentPageId) : pages;

  const pagePlans: DialoguePagePatches[] = [];
  let totalCount = 0;
  let elementCount = 0;
  let lockedSkipped = 0;

  for (const page of targets) {
    const groups = page.groups ?? [];
    const patches: DialogueTextPatch[] = [];
    let pageMatchCount = 0;
    for (const el of page.elements) {
      if (!isDialogueElement(el)) continue;
      const replaced = replaceOccurrences(el.text, find, replace, caseSensitive);
      if (replaced.count === 0 || replaced.text === el.text) continue;
      if (!includeLocked && isEffectivelyLocked(el, groups)) {
        lockedSkipped += 1;
        continue;
      }
      patches.push({ id: el.id, text: replaced.text, prevText: el.text, count: replaced.count });
      pageMatchCount += replaced.count;
    }
    if (patches.length === 0) continue;
    pagePlans.push({ pageId: page.id, patches, count: pageMatchCount });
    totalCount += pageMatchCount;
    elementCount += patches.length;
  }

  if (pagePlans.length === 0 && lockedSkipped === 0) return EMPTY_PLAN;
  return {
    pages: pagePlans,
    totalCount,
    elementCount,
    pageCount: pagePlans.length,
    lockedSkipped,
  };
}

// ── 적용(순수) — 메인 루프가 결과를 그대로 커밋한다 ─────────────────────────

/**
 * 치환 계획을 페이지 배열에 적용한 새 배열을 만든다.
 * 안 바뀐 페이지·요소는 참조를 유지하고, 아무것도 안 바뀌면 입력 배열을 그대로 반환.
 */
export function applyReplacePlanToPages(
  pages: readonly DialoguePageLike[],
  plan: DialogueReplacePlan
): readonly DialoguePageLike[] {
  if (plan.pages.length === 0) return pages;
  const textByPageEl = new Map<string, Map<string, string>>();
  for (const pagePlan of plan.pages) {
    textByPageEl.set(pagePlan.pageId, new Map(pagePlan.patches.map((p) => [p.id, p.text])));
  }

  let changed = false;
  const next = pages.map((page) => {
    const textById = textByPageEl.get(page.id);
    if (!textById || textById.size === 0) return page;
    let pageChanged = false;
    const elements = page.elements.map((el) => {
      const text = textById.get(el.id);
      if (text == null || !isDialogueElement(el) || el.text === text) return el;
      pageChanged = true;
      return { ...el, text };
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, elements };
  });
  return changed ? next : pages;
}

/**
 * 단일 요소 인라인 텍스트 수정 — 대상이 없거나 텍스트가 같으면 입력 배열 그대로 반환.
 * bubble/text 가 아닌 요소는 건드리지 않는다(방어적).
 */
export function applyDialogueTextEdit(
  pages: readonly DialoguePageLike[],
  pageId: string,
  elId: string,
  text: string
): readonly DialoguePageLike[] {
  let changed = false;
  const next = pages.map((page) => {
    if (page.id !== pageId) return page;
    let pageChanged = false;
    const elements = page.elements.map((el) => {
      if (el.id !== elId || !isDialogueElement(el) || el.text === text) return el;
      pageChanged = true;
      return { ...el, text };
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, elements };
  });
  return changed ? next : pages;
}
