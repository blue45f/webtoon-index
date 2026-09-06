/**
 * CLIP STUDIO EX 스타일의 스토리 편집 구조 작업.
 *
 * 대사를 여러 페이지에서 한꺼번에 보는 것에 그치지 않고, 문단을 나누거나 합치고
 * 다른 페이지로 이동·복사할 수 있도록 순수 변환만 제공한다. UI와 히스토리 커밋은
 * StudioPage가 맡으며, 이 모듈은 입력을 절대 변경하지 않고 무변경 시 원본 참조를 돌려준다.
 */
import { isEffectivelyLocked } from "../studio-layers";

import {
  collectDialogueItems,
  isDialogueElement,
  type DialogueElementLike,
  type DialoguePageLike,
} from "./studio-dialogue-batch";

export type DialogueSplitRequest = {
  pageId: string;
  elementId: string;
  /** textarea의 현재 임시본까지 포함한 전체 텍스트. */
  text: string;
  /** UTF-16 커서 오프셋. textarea.selectionStart와 같은 좌표계다. */
  offset: number;
  newElementId: string;
};

export type DialogueTransferRequest = {
  sourcePageId: string;
  targetPageId: string;
  elementId: string;
  mode: "move" | "copy";
  /** copy일 때만 필요하다. move는 기존 ID를 유지한다. */
  newElementId?: string;
  /** 패널에서 아직 커밋되지 않은 최신 임시본. */
  text?: string;
};

function hasElementId(pages: readonly DialoguePageLike[], id: string): boolean {
  return pages.some((page) => page.elements.some((element) => element.id === id));
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function splitPlacement(element: DialogueElementLike): Pick<DialogueElementLike, "x" | "y"> {
  const x = finite(element.x);
  const y = finite(element.y);
  if (x == null || y == null) return {};
  const height = Math.max(24, finite(element.height) ?? (element.type === "text" ? 48 : 96));
  return { x: x + 18, y: y + height + 18 };
}

function transferPlacement(
  element: DialogueElementLike,
  targetPage: DialoguePageLike
): Pick<DialogueElementLike, "x" | "y"> {
  const targetDialogues = targetPage.elements.filter(isDialogueElement);
  let bottom = 24;
  for (const target of targetDialogues) {
    const y = finite(target.y);
    if (y == null) continue;
    bottom = Math.max(bottom, y + Math.max(24, finite(target.height) ?? 64) + 20);
  }

  const height = Math.max(24, finite(element.height) ?? 64);
  const canvasHeight = finite((targetPage as DialoguePageLike & { canvasH?: number }).canvasH);
  const y = canvasHeight == null ? bottom : Math.max(24, Math.min(bottom, canvasHeight - height - 24));
  return {
    x: finite(element.x) ?? 24,
    y,
  };
}

/** 커서 위치에서 대사 요소를 둘로 나누고 두 번째 요소를 바로 뒤에 삽입한다. */
export function splitDialogueElement(
  pages: readonly DialoguePageLike[],
  request: DialogueSplitRequest
): readonly DialoguePageLike[] {
  const offset = Math.trunc(request.offset);
  if (
    !request.newElementId ||
    hasElementId(pages, request.newElementId) ||
    offset <= 0 ||
    offset >= request.text.length
  ) {
    return pages;
  }
  const firstText = request.text.slice(0, offset);
  const secondText = request.text.slice(offset);
  if (!firstText.trim() || !secondText.trim()) return pages;

  let changed = false;
  const next = pages.map((page) => {
    if (page.id !== request.pageId) return page;
    const groups = page.groups ?? [];
    const sourceIndex = page.elements.findIndex((element) => element.id === request.elementId);
    const source = page.elements[sourceIndex];
    if (
      sourceIndex < 0 ||
      !source ||
      !isDialogueElement(source) ||
      isEffectivelyLocked(source, groups)
    ) {
      return page;
    }

    const first = { ...source, text: firstText };
    const second = {
      ...source,
      ...splitPlacement(source),
      id: request.newElementId,
      text: secondText,
    };
    const elements = [...page.elements];
    elements.splice(sourceIndex, 1, first, second);
    changed = true;
    return { ...page, elements };
  });
  return changed ? next : pages;
}

/** 같은 페이지의 실제 읽기 순서에서 바로 다음 대사를 현재 요소로 합친다. */
export function mergeDialogueWithNext(
  pages: readonly DialoguePageLike[],
  pageId: string,
  elementId: string,
  currentText?: string
): readonly DialoguePageLike[] {
  const page = pages.find((candidate) => candidate.id === pageId);
  if (!page) return pages;
  const ordered = collectDialogueItems([page]);
  const currentOrder = ordered.findIndex((item) => item.id === elementId);
  const nextItem = ordered[currentOrder + 1];
  if (currentOrder < 0 || !nextItem) return pages;

  const groups = page.groups ?? [];
  const current = page.elements.find((element) => element.id === elementId);
  const following = page.elements.find((element) => element.id === nextItem.id);
  if (
    !current ||
    !following ||
    !isDialogueElement(current) ||
    !isDialogueElement(following) ||
    isEffectivelyLocked(current, groups) ||
    isEffectivelyLocked(following, groups)
  ) {
    return pages;
  }

  const authoredCurrentText = currentText ?? current.text;
  const text = authoredCurrentText && following.text
    ? `${authoredCurrentText}\n${following.text}`
    : authoredCurrentText || following.text;
  return pages.map((candidate) => {
    if (candidate.id !== pageId) return candidate;
    const elements = candidate.elements
      .filter((element) => element.id !== following.id)
      .map((element) => (element.id === current.id ? { ...element, text } : element));
    return { ...candidate, elements };
  });
}

/** 대사 하나를 다른 페이지로 옮기거나 복사한다. 대상 페이지에서는 유효하지 않은 그룹 연결을 해제한다. */
export function transferDialogueElement(
  pages: readonly DialoguePageLike[],
  request: DialogueTransferRequest
): readonly DialoguePageLike[] {
  if (request.sourcePageId === request.targetPageId) return pages;
  const sourcePage = pages.find((page) => page.id === request.sourcePageId);
  const targetPage = pages.find((page) => page.id === request.targetPageId);
  const source = sourcePage?.elements.find((element) => element.id === request.elementId);
  if (!sourcePage || !targetPage || !source || !isDialogueElement(source)) return pages;
  if (isEffectivelyLocked(source, sourcePage.groups ?? [])) return pages;

  const nextId = request.mode === "copy" ? request.newElementId : source.id;
  if (!nextId || (request.mode === "copy" && hasElementId(pages, nextId))) return pages;
  const placed = {
    ...source,
    ...transferPlacement(source, targetPage),
    id: nextId,
    text: request.text ?? source.text,
    groupId: undefined,
  };

  return pages.map((page) => {
    if (page.id === request.sourcePageId && request.mode === "move") {
      return {
        ...page,
        elements: page.elements.filter((element) => element.id !== source.id),
      };
    }
    if (page.id === request.targetPageId) {
      return { ...page, elements: [...page.elements, placed] };
    }
    return page;
  });
}
