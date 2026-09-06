
import { CANVAS_W } from "../studio-assets";
import { uid } from "../studio-id";
import { useStudioPageDnd } from "../studio-page-dnd";
import {
  appendPageState,
  applyBackgroundToAllPages,
  applyGradeToAllPages,
  clearPage,
  computeNextActiveIdAfterBulkDelete,
  deletePagesBulk as deletePagesBulkPure,
  duplicateMirroredPage,
  duplicatePageState,
  executeDeletePageTransition,
  insertBlankPageAt,
  movePage as movePagePure,
  movePagesBulk as movePagesBulkPure,
  reorderPages,
} from "../studio-pages";

import type { PageState } from "../studio-page-state";
import type { RefObject } from "react";

export interface UseStudioPageManagementOptions {
  readonly pages: PageState[];
  readonly pagesHistoryRef: RefObject<PageState[][]>;
  readonly pagesHiRef: RefObject<number>;
  readonly activePage: PageState;
  readonly currentPageId: string;
  readonly setCurrentPageId: (id: string) => void;
  readonly pendingStrokeCommitsRef: RefObject<unknown>;
  readonly flushPendingStrokeCommitsRef: RefObject<() => boolean>;
  readonly commitPages: (
    nextPages: PageState[],
    options?: { bypassReviewLock?: boolean; pendingStrokePolicy?: "drop" | "preserve" },
  ) => boolean;
}

export function useStudioPageManagement({
  pages,
  pagesHistoryRef,
  pagesHiRef,
  activePage,
  currentPageId,
  setCurrentPageId,
  pendingStrokeCommitsRef,
  flushPendingStrokeCommitsRef,
  commitPages,
}: UseStudioPageManagementOptions) {
  function latestStudioPagesSnapshot(): PageState[] {
    const history = pagesHistoryRef.current;
    const index = Math.max(0, Math.min(pagesHiRef.current, Math.max(0, history.length - 1)));
    return history[index] ?? pages;
  }

  function addPage() {
    const baseH = activePage.canvasH || 1080;
    const { nextPages, newPageId } = appendPageState(pages, uid, baseH);
    if (!commitPages(nextPages)) return;
    setCurrentPageId(newPageId);
  }

  function findPageIndexInPages(pageId: string) {
    return pages.findIndex((p) => p.id === pageId);
  }

  function insertPageBefore(pageId: string) {
    const idx = findPageIndexInPages(pageId);
    if (idx < 0) return;
    const baseH = pages[idx]?.canvasH || 1080;
    const nextPages = insertBlankPageAt(pages, idx, uid, baseH);
    if (!commitPages(nextPages)) return;
    const inserted = nextPages[idx];
    if (inserted) setCurrentPageId(inserted.id);
  }

  function insertPageAfter(pageId: string) {
    const idx = findPageIndexInPages(pageId);
    if (idx < 0) return;
    const baseH = pages[idx]?.canvasH || 1080;
    const nextPages = insertBlankPageAt(pages, idx + 1, uid, baseH);
    if (!commitPages(nextPages)) return;
    const inserted = nextPages[idx + 1];
    if (inserted) setCurrentPageId(inserted.id);
  }

  function duplicatePage(pageId: string) {
    if (pendingStrokeCommitsRef.current && !flushPendingStrokeCommitsRef.current()) return;
    const basePages = latestStudioPagesSnapshot();
    const pageToDup = basePages.find((p) => p.id === pageId);
    if (!pageToDup) return;
    const newPage = { ...duplicatePageState(pageToDup, uid), review: undefined };
    const idx = basePages.findIndex((p) => p.id === pageId);
    const nextPages = [...basePages];
    nextPages.splice(idx + 1, 0, newPage);
    if (commitPages(nextPages)) setCurrentPageId(newPage.id);
  }

  function duplicatePageMirrored(pageId: string) {
    if (pendingStrokeCommitsRef.current && !flushPendingStrokeCommitsRef.current()) return;
    const basePages = latestStudioPagesSnapshot();
    const pageToDup = basePages.find((p) => p.id === pageId);
    if (!pageToDup) return;
    const mir = { ...duplicateMirroredPage(pageToDup, uid, CANVAS_W), review: undefined };
    const idx = basePages.findIndex((p) => p.id === pageId);
    const nextPages = [...basePages];
    nextPages.splice(idx + 1, 0, mir);
    if (commitPages(nextPages)) setCurrentPageId(mir.id);
  }

  function deletePage(pageId: string) {
    if (pages.length <= 1) return;
    const { nextPages, nextActiveId } = executeDeletePageTransition(pages, pageId, currentPageId);
    if (!commitPages(nextPages)) return;
    if (currentPageId === pageId && nextActiveId) {
      const found = nextPages.find((p) => p.id === nextActiveId);
      if (found) setCurrentPageId(found.id);
      else if (nextPages[0]) setCurrentPageId(nextPages[0].id);
    }
  }

  function deletePagesBulk(ids: string[]) {
    if (pages.length <= 1 || ids.length === 0) return;
    const { nextPages, removedIds } = deletePagesBulkPure(pages, ids);
    if (removedIds.length === 0) return;
    if (!commitPages(nextPages)) return;
    const nextActiveId = computeNextActiveIdAfterBulkDelete(pages, nextPages, currentPageId);
    if (nextActiveId && nextActiveId !== currentPageId) {
      setCurrentPageId(nextActiveId);
    }
  }

  function movePageUp(pageId: string) {
    const idx = pages.findIndex((p) => p.id === pageId);
    if (idx <= 0) return;
    const nextPages = movePagePure(pages, pageId, -1);
    commitPages(nextPages);
  }

  function movePageDown(pageId: string) {
    const idx = pages.findIndex((p) => p.id === pageId);
    if (idx === -1 || idx >= pages.length - 1) return;
    const nextPages = movePagePure(pages, pageId, 1);
    commitPages(nextPages);
  }

  function movePagesBulk(ids: string[], delta: number) {
    if (ids.length === 0 || !Number.isFinite(delta) || delta === 0) return;
    const nextPages = movePagesBulkPure(pages, ids, delta);
    if (
      nextPages.length === pages.length &&
      nextPages.every((page: PageState, index: number) => page.id === pages[index]?.id)
    ) {
      return;
    }
    commitPages(nextPages);
  }

  function clearPageFor(pageId: string) {
    const target = pages.find((p) => p.id === pageId);
    if (!target || target.elements.length === 0) return;
    const nextPages = clearPage(pages, pageId);
    commitPages(nextPages, { pendingStrokePolicy: "drop" });
  }

  function applyGradeToAll() {
    const cur = JSON.stringify(activePage.grade ?? null);
    const allSame = pages.every((p) => JSON.stringify(p.grade ?? null) === cur);
    if (allSame) return;
    const nextPages = applyGradeToAllPages(pages, activePage.grade);
    commitPages(nextPages);
  }

  function applyBgToAll() {
    const curBg = activePage.bg;
    const curGrad = JSON.stringify(activePage.bgGrad ?? null);
    const allSame = pages.every(
      (p) => p.bg === curBg && JSON.stringify(p.bgGrad ?? null) === curGrad,
    );
    if (allSame) return;
    const nextPages = applyBackgroundToAllPages(pages, activePage.bg, activePage.bgGrad);
    commitPages(nextPages);
  }

  function movePageToTop(pageId: string) {
    const from = findPageIndexInPages(pageId);
    if (from <= 0) return;
    const nextPages = reorderPages(pages, from, 0);
    commitPages(nextPages);
  }

  function movePageToBottom(pageId: string) {
    const from = findPageIndexInPages(pageId);
    const last = pages.length - 1;
    if (from < 0 || from === last) return;
    const nextPages = reorderPages(pages, from, last);
    commitPages(nextPages);
  }

  const pageDnd = useStudioPageDnd(pages.length, (from: number, to: number) => {
    commitPages(reorderPages(pages, from, to));
  });

  return {
    latestStudioPagesSnapshot,
    addPage,
    findPageIndexInPages,
    insertPageBefore,
    insertPageAfter,
    duplicatePage,
    duplicatePageMirrored,
    deletePage,
    deletePagesBulk,
    movePageUp,
    movePageDown,
    movePagesBulk,
    clearPageFor,
    applyGradeToAll,
    applyBgToAll,
    movePageToTop,
    movePageToBottom,
    pageDnd,
  };
}
