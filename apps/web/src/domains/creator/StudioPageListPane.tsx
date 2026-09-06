import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Copy,
  Eraser,
  FlipHorizontal2,
  GripVertical,
  LayoutTemplate,
  Maximize2,
  Minimize2,
  Move,
  PanelLeft,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Suspense, lazy, memo, useEffect, useId, useRef, useState } from "react";

import { StudioEdgeRailButton } from "./studio-chrome-ui";
import { confirmStudioDestructiveAction } from "./studio-destructive-action-preview";
import {
  studioDeletePageRequest,
  studioDeletePagesBulkRequest,
} from "./studio-destructive-command-catalog";
import {
  DEFAULT_STUDIO_PAGE_LIST_FLOATING_LAYOUT,
  loadStudioDetachablePanelState,
  saveStudioDetachablePanelState,
} from "./studio-detachable-panels";
import {
  STUDIO_MOBILE_PAGES_SHEET_ID,
  studioMobileSheetSizeStyle,
  type StudioMobileSheetSnap,
} from "./studio-mobile-sheet-snap";
import { StudioPageThumbnail } from "./studio-page-lazy-ui";
import {
  PAGE_NAME_MAX,
  PAGE_NOTE_MAX,
  autoPageName,
  pageDisplayName,
} from "./studio-page-meta";
import { shotTagBadgeText, shotTagBadgeTitle } from "./studio-panel-shot-tags";
import { STUDIO_WORKSPACE_LEFT_PANEL_WIDTH } from "./studio-workspaces";
import { StudioDetachablePanelSlot } from "./StudioDetachablePanelSlot";

import type { El } from "./studio-element-model";
import type { DocumentMaster } from "./studio-master-page";
import type { StudioPageDnd } from "./studio-page-dnd";
import type { PageState } from "./studio-page-state";
import type {
  StudioPagePreviewSize,
  StudioUiPreferencesRepository,
} from "./studio-ui-preferences-sqlite";
import type { StudioMobileSheet } from "./StudioMobileEditingDock";
import type { Resizable } from "@/src/hooks/use-resizable";
import type { Dispatch, RefObject, SetStateAction } from "react";

import { cn } from "@/shared/lib/utils";

const LazyStudioMobileSheetHandle = lazy(() =>
  import("./StudioMobileSheetHandle").then(({ StudioMobileSheetHandle }) => ({
    default: StudioMobileSheetHandle,
  }))
);

const PAGE_PREVIEW_SIZE_VALUES = ["compact", "comfortable", "large"] as const satisfies readonly StudioPagePreviewSize[];

async function acquireProductStudioUiPreferencesRepository(): Promise<StudioUiPreferencesRepository> {
  const module = await import("./studio-ui-preferences-sqlite");
  return module.acquireProductStudioUiPreferencesRepository();
}

const PAGE_PREVIEW_SIZE_CLASS: Record<StudioPagePreviewSize, string> = {
  compact: "h-14",
  comfortable: "h-24",
  large: "h-36",
};
const PAGE_PREVIEW_SIZE_LABEL: Record<StudioPagePreviewSize, string> = {
  compact: "작게",
  comfortable: "보통",
  large: "크게",
};

function StudioPageListResizeHandle({ leftResize }: { readonly leftResize: Resizable }) {
  const helpId = useId();
  const { handleProps, dragging } = leftResize;
  const label = "페이지 목록 너비 조절";
  return (
    <>
      <div
        {...handleProps}
        aria-label={label}
        aria-describedby={helpId}
        title={`${label} · 현재 ${handleProps["aria-valuenow"]}px · 드래그 / 더블클릭·더블탭·Enter(기본) / ←→`}
        data-studio-panel-resizer="true"
        data-dragging={dragging ? "true" : "false"}
        className={cn(
          "group relative hidden w-3 shrink-0 touch-none cursor-col-resize select-none items-center justify-center self-stretch border-x border-line/35 bg-panel/35 transition-[background-color,border-color] motion-reduce:transition-none lg:flex",
          "before:absolute before:inset-y-0 before:left-1/2 before:w-6 before:-translate-x-1/2 before:content-['']",
          "focus-visible:z-10 focus-visible:border-accent/60 focus-visible:bg-accent/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
          "active:border-accent/50 active:bg-accent/15",
          dragging
            ? "border-accent/60 bg-accent/20"
            : "hover:border-accent/35 hover:bg-accent/10",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "grid h-12 w-2.5 place-items-center rounded-full border shadow-sm transition-[color,background-color,border-color,transform] motion-reduce:transition-none",
            dragging
              ? "scale-105 border-accent bg-accent text-on-accent"
              : "border-line bg-raised text-fg-3 group-hover:border-accent/50 group-hover:bg-accent-soft group-hover:text-accent group-focus-visible:border-accent group-focus-visible:bg-accent-soft group-focus-visible:text-accent",
          )}
        >
          <GripVertical size={10} strokeWidth={2.25} />
        </span>
      </div>
      <span id={helpId} className="sr-only">
        좌우 방향키로 조금씩 조절하고 Home과 End로 최소·최대 너비를 선택할 수 있습니다.
        Enter를 누르거나 더블클릭·더블탭하면 기본 너비로 돌아갑니다.
      </span>
    </>
  );
}

export interface StudioPageListPaneHandlers {
  addPage: () => void;
  applyBgToAll: () => void;
  applyGradeToAll: () => void;
  clearPageFor: (pageId: string) => void;
  commitPageMeta: (pageId: string, patch: { name?: string | null; note?: string | null; }) => void;
  deletePage: (pageId: string) => void;
  deletePagesBulk: (ids: string[]) => void;
  duplicatePage: (pageId: string) => void;
  duplicatePageMirrored: (pageId: string) => void;
  insertPageAfter: (pageId: string) => void;
  insertPageBefore: (pageId: string) => void;
  movePageDown: (pageId: string) => void;
  movePagesBulk: (ids: string[], delta: number) => void;
  movePageToBottom: (pageId: string) => void;
  movePageToTop: (pageId: string) => void;
  movePageUp: (pageId: string) => void;
}

export interface StudioPageListPaneProps {
  collaborationDocumentLocked: boolean;
  collaborationLockMessage: () => string;
  composeWorkAssetPreviewPage: (page: PageState) => PageState;
  currentPageId: string;
  isMobile: boolean;
  leftResize: Resizable;
  master: DocumentMaster<El>;
  masterEditMode: boolean;
  masterPanelOpen: boolean;
  metaEditPageId: string | null;
  mobileKeyboardInset: number;
  mobileSheet: StudioMobileSheet;
  pageDnd: StudioPageDnd;
  pages: PageState[];
  pagesSheetRef: RefObject<HTMLDivElement | null>;
  presentationPanelsHidden: boolean;
  setCurrentPageId: (value: SetStateAction<string>) => boolean;
  setLeftPanelOpen: Dispatch<SetStateAction<boolean>>;
  setMasterPanelOpen: Dispatch<SetStateAction<boolean>>;
  setMetaEditPageId: Dispatch<SetStateAction<string | null>>;
  setMobileSheet: Dispatch<SetStateAction<StudioMobileSheet>>;
  visibleLeftPanelOpen: boolean;
  stableHandlers: StudioPageListPaneHandlers;
  /** Test seam; product defaults to the shared SQLite/OPFS preference authority. */
  acquireUiPreferences?: () => Promise<StudioUiPreferencesRepository>;
}

export const StudioPageListPane = memo(function StudioPageListPane({
  collaborationDocumentLocked,
  collaborationLockMessage,
  composeWorkAssetPreviewPage,
  currentPageId,
  isMobile,
  leftResize,
  master,
  masterEditMode,
  masterPanelOpen,
  metaEditPageId,
  mobileKeyboardInset,
  mobileSheet,
  pageDnd,
  pages,
  pagesSheetRef,
  presentationPanelsHidden,
  setCurrentPageId,
  setLeftPanelOpen,
  setMasterPanelOpen,
  setMetaEditPageId,
  setMobileSheet,
  visibleLeftPanelOpen,
  stableHandlers,
  acquireUiPreferences = acquireProductStudioUiPreferencesRepository,
}: StudioPageListPaneProps) {
  const {
    addPage,
    applyBgToAll,
    applyGradeToAll,
    clearPageFor,
    commitPageMeta,
    deletePage,
    deletePagesBulk,
    duplicatePage,
    duplicatePageMirrored,
    insertPageAfter,
    insertPageBefore,
    movePageDown,
    movePagesBulk,
    movePageToBottom,
    movePageToTop,
    movePageUp,
  } = stableHandlers;
  const [mobileSnap, setMobileSnap] = useState<StudioMobileSheetSnap>("medium");
  const [pagePreviewSize, setPagePreviewSize] = useState<StudioPagePreviewSize>("comfortable");
  const [preferenceAuthority, setPreferenceAuthority] = useState<
    "loading" | "sqlite-opfs" | "memory-only"
  >("loading");
  const preferenceRepositoryRef = useRef<StudioUiPreferencesRepository | null>(null);
  const preferenceDirtyRef = useRef(false);
  const preferenceMountedRef = useRef(true);

  useEffect(() => {
    preferenceMountedRef.current = true;
    return () => {
      preferenceMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void acquireUiPreferences()
      .then(async (repository) => {
        preferenceRepositoryRef.current = repository;
        const persisted = await repository.loadPagePreviewSize();
        if (!active) return;
        setPreferenceAuthority("sqlite-opfs");
        if (!preferenceDirtyRef.current) setPagePreviewSize(persisted);
      })
      .catch(() => {
        if (active) setPreferenceAuthority("memory-only");
      });
    return () => {
      active = false;
    };
  }, [acquireUiPreferences]);

  const selectPagePreviewSize = (next: StudioPagePreviewSize): void => {
    preferenceDirtyRef.current = true;
    setPagePreviewSize(next);
    const save = preferenceRepositoryRef.current
      ? preferenceRepositoryRef.current.savePagePreviewSize(next)
      : acquireUiPreferences().then((repository) => {
          preferenceRepositoryRef.current = repository;
          return repository.savePagePreviewSize(next);
        });
    void save
      .then(() => {
        if (preferenceMountedRef.current) setPreferenceAuthority("sqlite-opfs");
      })
      .catch(() => {
        if (preferenceMountedRef.current) setPreferenceAuthority("memory-only");
      });
  };
  // CSP EX 스타일 다중 페이지 선택 — currentPageId 와 별도로 벌크 이동/삭제 대상 id 목록.
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>([]);
  const pageIdSet = new Set(pages.map((page) => page.id));
  const liveSelectedPageIds = selectedPageIds.filter((id) => pageIdSet.has(id));
  const multiSelectActive = liveSelectedPageIds.length > 1;
  const safeMobileKeyboardInset = Number.isFinite(mobileKeyboardInset)
    ? Math.max(0, Math.round(mobileKeyboardInset))
    : 0;
  const [detached, setDetached] = useState(() =>
    loadStudioDetachablePanelState("page-list")
  );
  const desktopDetached = !isMobile && detached;
  const setPageListDetached = (next: boolean): void => {
    setDetached(next);
    saveStudioDetachablePanelState("page-list", next);
    if (next) setLeftPanelOpen(true);
  };
  return (
    <>
        {!visibleLeftPanelOpen && !presentationPanelsHidden && (
          <StudioEdgeRailButton
            side="left"
            label="페이지"
            icon={LayoutTemplate}
            onClick={() => setLeftPanelOpen(true)}
            title="페이지 목록 펼치기"
          />
        )}
        <StudioDetachablePanelSlot
          detached={desktopDetached && visibleLeftPanelOpen}
          surfaceId="page-list"
          label="페이지 목록"
          defaultLayout={DEFAULT_STUDIO_PAGE_LIST_FLOATING_LAYOUT}
          minWidth={320}
          minHeight={420}
          maxWidth={720}
          maxHeight={1_100}
          allowedDockEdges={["left", "right"]}
          onClose={() => setLeftPanelOpen(false)}
        >
        <div
          id={STUDIO_MOBILE_PAGES_SHEET_ID}
          ref={pagesSheetRef}
          role={isMobile && mobileSheet === "pages" ? "dialog" : undefined}
          aria-modal={isMobile && mobileSheet === "pages" ? true : undefined}
          data-studio-sheet-id="pages"
          data-studio-panel-detached={desktopDetached ? "true" : undefined}
          data-studio-ui-preferences-authority={preferenceAuthority}
          data-studio-mobile-sheet={isMobile && mobileSheet === "pages" ? "true" : undefined}
          data-studio-sheet-snap={isMobile ? mobileSnap : undefined}
          data-popup-kind={isMobile && mobileSheet === "pages" ? "sheet" : undefined}
          aria-label={isMobile && mobileSheet === "pages" ? "페이지 목록" : undefined}
          aria-hidden={isMobile && mobileSheet !== "pages" ? true : undefined}
          tabIndex={isMobile && mobileSheet === "pages" ? -1 : undefined}
          inert={isMobile && mobileSheet !== "pages" ? true : undefined}
          className={cn(
            "flex flex-col gap-1.5 border border-line p-2",
            // 모바일: 하단에서 올라오는 바텀시트
            "fixed inset-x-0 bottom-0 z-[60] overflow-hidden rounded-t-3xl bg-panel pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl transition-[transform,height,max-height] duration-300 ease-out motion-reduce:transition-none",
            // 데스크톱: 엣지 도크(라운드·여백 최소, 캔버스 폭 최대)
            "lg:static lg:z-auto lg:max-h-none lg:min-h-0 lg:overflow-hidden lg:rounded-none lg:border-y-0 lg:border-l-0 lg:bg-panel/50 lg:pb-2 lg:shadow-none lg:transition-none lg:translate-y-0",
            mobileSheet === "pages" ? "translate-y-0" : "translate-y-full",
            desktopDetached && "lg:h-full lg:w-full lg:flex-1 lg:border-0 lg:bg-transparent lg:p-0",
            !visibleLeftPanelOpen && "lg:hidden"
          )}
          style={
            isMobile
              ? {
                  bottom: safeMobileKeyboardInset,
                  ...studioMobileSheetSizeStyle(mobileSnap, safeMobileKeyboardInset),
                }
              : desktopDetached
                ? { width: "100%", minWidth: 0 }
                : { width: leftResize.width, minWidth: STUDIO_WORKSPACE_LEFT_PANEL_WIDTH.minimum }
          }
        >
          <div className="shrink-0 border-b border-line/50 pb-1.5">
            {isMobile ? (
              <Suspense fallback={<div aria-hidden className="min-h-11" />}>
                <LazyStudioMobileSheetHandle
                  active={mobileSheet === "pages"}
                  kind="pages"
                  label="페이지 시트"
                  onDismiss={() => setMobileSheet(null)}
                  onSnapChange={setMobileSnap}
                  sheetRef={pagesSheetRef}
                  snap={mobileSnap}
                />
              </Suspense>
            ) : null}
            <div className="flex min-h-11 items-center justify-between gap-2 lg:min-h-6">
              <span className="flex items-center gap-1 text-[0.7rem] font-bold text-fg-2">
                <button
                  type="button"
                  onClick={() => setLeftPanelOpen(false)}
                  className="hidden text-fg-3 transition-colors hover:text-fg lg:inline-flex"
                  title="페이지 목록 접기"
                >
                  <ChevronLeft size={13} />
                </button>
                페이지
              </span>
              <div className="flex shrink-0 items-center gap-1">
                {!isMobile ? (
                  <button
                    type="button"
                    onClick={() => setPageListDetached(!detached)}
                    aria-label={detached
                      ? "페이지 목록을 왼쪽 패널에 붙이기"
                      : "페이지 목록을 창으로 분리"}
                    aria-pressed={desktopDetached}
                    title={detached ? "왼쪽 패널에 붙이기" : "자유 배치 창으로 분리"}
                    className="grid size-8 place-items-center rounded-lg text-fg-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {detached ? <PanelLeft size={14} aria-hidden /> : <Move size={14} aria-hidden />}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setMobileSheet(null)}
                  className="grid size-11 place-items-center rounded-xl text-fg-3 hover:bg-raised lg:hidden"
                  aria-label="페이지 시트 닫기"
                  data-autofocus
                >
                  <X size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  data-testid="studio-add-page"
                  aria-label="새 페이지 추가"
                  title="새 페이지 추가"
                  onClick={addPage}
                  className="flex min-h-11 items-center gap-1 rounded-lg bg-accent px-3 text-[0.7rem] font-semibold text-on-accent hover:bg-accent-hover lg:min-h-6 lg:px-2 lg:text-[10px]"
                >
                  <Plus size={12} aria-hidden /> 페이지 추가
                </button>
              </div>
            </div>
            <div
              role="toolbar"
              aria-label="페이지 일괄 작업"
              className="flex items-center gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:flex-wrap lg:overflow-x-visible"
            >
              <button
                type="button"
                onClick={applyGradeToAll}
                className="min-h-11 shrink-0 rounded-lg border border-line px-3 text-[0.7rem] text-fg-3 hover:bg-raised lg:min-h-6 lg:px-1.5 lg:text-[10px]"
                title="현재 페이지의 색보정을 모든 페이지에 적용"
              >
                그레이드 전체
              </button>
              <button
                type="button"
                onClick={applyBgToAll}
                className="min-h-11 shrink-0 rounded-lg border border-line px-3 text-[0.7rem] text-fg-3 hover:bg-raised lg:min-h-6 lg:px-1.5 lg:text-[10px]"
                title="현재 페이지의 배경을 모든 페이지에 적용"
              >
                배경 전체
              </button>
              <button
                type="button"
                onClick={() => setMasterPanelOpen((v) => !v)}
                disabled={collaborationDocumentLocked}
                aria-pressed={masterPanelOpen}
                className={cn(
                  "min-h-11 shrink-0 rounded-lg border px-3 text-[0.7rem] transition-colors disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-6 lg:px-1.5 lg:text-[10px]",
                  masterEditMode
                    ? "border-accent bg-accent-soft/50 text-accent"
                    : masterPanelOpen
                      ? "border-accent/60 text-fg-2 hover:bg-raised"
                      : "border-line text-fg-3 hover:bg-raised"
                )}
                title={collaborationDocumentLocked ? collaborationLockMessage() : "마스터 페이지(모든 페이지 공통 요소) 관리"}
              >
                마스터{master.elements.length > 0 ? ` ${master.elements.length}` : ""}
              </button>
              <div
                role="group"
                aria-label="페이지 미리보기 크기"
                className="ml-auto flex min-h-11 shrink-0 items-center gap-1 rounded-lg border border-line bg-card px-1.5 lg:min-h-6"
                title={`페이지 미리보기 ${PAGE_PREVIEW_SIZE_LABEL[pagePreviewSize]}`}
              >
                <Minimize2 size={12} className="shrink-0 text-fg-3" aria-hidden />
                <input
                  type="range"
                  min={0}
                  max={PAGE_PREVIEW_SIZE_VALUES.length - 1}
                  step={1}
                  value={PAGE_PREVIEW_SIZE_VALUES.indexOf(pagePreviewSize)}
                  onChange={(event) => {
                    const next = PAGE_PREVIEW_SIZE_VALUES[Number(event.currentTarget.value)];
                    if (!next) return;
                    selectPagePreviewSize(next);
                  }}
                  aria-label="페이지 미리보기 크기 조절"
                  aria-valuetext={PAGE_PREVIEW_SIZE_LABEL[pagePreviewSize]}
                  className="h-11 w-20 cursor-pointer accent-accent lg:h-6 lg:w-16"
                />
                <Maximize2 size={12} className="shrink-0 text-fg-3" aria-hidden />
              </div>
            </div>
            {preferenceAuthority === "memory-only" ? (
              <p role="status" className="mt-1 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-[0.62rem] text-fg-2">
                미리보기 크기는 저장소를 다시 연결하기 전까지 이번 탭에서만 유지됩니다.
              </p>
            ) : null}
            {multiSelectActive ? (
              <div
                role="toolbar"
                aria-label="선택한 페이지 일괄 작업"
                data-testid="studio-page-bulk-toolbar"
                className="mt-1.5 flex min-h-11 items-center gap-1 overflow-x-auto overscroll-x-contain rounded-lg border border-accent/40 bg-accent-soft/30 px-1.5 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                <span className="shrink-0 px-1.5 text-[0.7rem] font-bold tabular-nums text-accent lg:text-[10px]">
                  {liveSelectedPageIds.length}개 선택
                </span>
                <button
                  type="button"
                  data-testid="studio-page-bulk-move-up"
                  onClick={() => movePagesBulk(liveSelectedPageIds, -1)}
                  className="grid size-11 shrink-0 place-items-center rounded-xl text-fg-2 hover:bg-raised lg:size-auto lg:min-h-6 lg:rounded-lg lg:px-1.5"
                  title="선택한 페이지 위로 이동"
                  aria-label="선택한 페이지 위로 이동"
                >
                  <ChevronUp size={14} aria-hidden />
                </button>
                <button
                  type="button"
                  data-testid="studio-page-bulk-move-down"
                  onClick={() => movePagesBulk(liveSelectedPageIds, 1)}
                  className="grid size-11 shrink-0 place-items-center rounded-xl text-fg-2 hover:bg-raised lg:size-auto lg:min-h-6 lg:rounded-lg lg:px-1.5"
                  title="선택한 페이지 아래로 이동"
                  aria-label="선택한 페이지 아래로 이동"
                >
                  <ChevronDown size={14} aria-hidden />
                </button>
                <button
                  type="button"
                  data-testid="studio-page-bulk-delete"
                  onClick={() => {
                    void (async () => {
                      if (
                        !(await confirmStudioDestructiveAction(
                          studioDeletePagesBulkRequest(liveSelectedPageIds.length)
                        ))
                      ) return;
                      deletePagesBulk(liveSelectedPageIds);
                      setSelectedPageIds([]);
                    })();
                  }}
                  disabled={pages.length <= 1}
                  className="ml-auto grid size-11 shrink-0 place-items-center rounded-xl text-bad hover:bg-bad-soft/20 disabled:opacity-30 lg:size-auto lg:min-h-6 lg:rounded-lg lg:px-1.5"
                  title="선택한 페이지 삭제"
                  aria-label="선택한 페이지 삭제"
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
            ) : null}
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain pr-0.5">
            {pages.map((p, idx) => {
              const isActive = p.id === currentPageId;
              const isMultiSelected = liveSelectedPageIds.includes(p.id);
              const dropIndicator = pageDnd.indicatorFor(idx);
              return (
                <div
                  key={p.id}
                  data-testid="studio-page-item"
                  data-selected={isMultiSelected ? "true" : undefined}
                  {...pageDnd.itemProps(idx)}
                  title="드래그하여 순서 변경 · Shift/⌘/Ctrl+클릭으로 다중 선택"
                  className={cn(
                    "relative flex w-full flex-col gap-0.5 rounded-lg border p-1.5 transition-all hover:bg-raised/50",
                    isActive || isMultiSelected
                      ? "border-accent bg-accent-soft/40"
                      : "border-line bg-card",
                    isMultiSelected && !isActive && "ring-1 ring-accent/50",
                    pageDnd.dragIndex === idx && "opacity-50"
                  )}
                >
                  {/* 페이지 선택 — 접근성: 카드를 role=button 으로 만들면 내부 액션 버튼(편집·이동)이
                      중첩 인터랙티브가 되어 위반이므로, 카드 전체를 덮는 "늘린 버튼"으로 선택을 처리하고
                      액션 버튼은 z-index 로 그 위에 띄운다. 카드 div 는 드래그 정렬(draggable) 컨테이너로 유지. */}
                  <button
                    type="button"
                    onClick={(event) => {
                      const multi = event.metaKey || event.ctrlKey || event.shiftKey;
                      if (multi) {
                        setSelectedPageIds((prev) => {
                          const kept = prev.filter((id) => pageIdSet.has(id));
                          return kept.includes(p.id)
                            ? kept.filter((id) => id !== p.id)
                            : [...kept, p.id];
                        });
                        setCurrentPageId(p.id);
                        return;
                      }
                      setSelectedPageIds([p.id]);
                      setCurrentPageId(p.id);
                    }}
                    aria-label={`${pageDisplayName(p, idx)} 선택`}
                    aria-pressed={isActive || isMultiSelected}
                    className="absolute inset-0 z-10 cursor-pointer rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  />
                  {/* 드롭 삽입선(PPT식) — 카드 위/아래 절반 판정 결과 시각화. overflow 클리핑 없게 카드 가장자리에 겹쳐 그린다. */}
                  {dropIndicator && (
                    <span
                      aria-hidden
                      className={cn(
                        "pointer-events-none absolute inset-x-1 z-10 h-[3px] rounded-full bg-accent",
                        dropIndicator === "before" ? "top-0" : "bottom-0"
                      )}
                    />
                  )}
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-1">
                    <span className="min-w-0 flex-1 truncate text-xs font-bold text-fg-2 lg:min-w-[3.5rem] lg:text-[10px]" title={pageDisplayName(p, idx)}>
                      {pageDisplayName(p, idx)}
                    </span>
                    {shotTagBadgeText(p) ? (
                      <span
                        className="shrink-0 rounded bg-accent-soft px-1 py-0.5 text-[0.65rem] font-semibold text-accent lg:text-[8px]"
                        title={shotTagBadgeTitle(p) ?? undefined}
                      >
                        {shotTagBadgeText(p)}
                      </span>
                    ) : null}
                    {/* 액션 버튼은 늘린 선택 버튼(z-10) 위로 띄운다. */}
                    <div className="relative z-20 flex max-w-[70%] items-center gap-0.5 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:max-w-none lg:flex-wrap lg:justify-end lg:overflow-visible">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMetaEditPageId((v) => (v === p.id ? null : p.id));
                        }}
                        className={cn("grid size-11 shrink-0 place-items-center rounded-xl hover:bg-raised lg:size-6 lg:rounded", metaEditPageId === p.id ? "text-accent" : "text-fg-3")}
                        title="이름·콘티 메모 편집"
                        aria-label={`${pageDisplayName(p, idx)} 이름·콘티 메모 편집`}
                        aria-expanded={metaEditPageId === p.id}
                      >
                        <Pencil size={14} aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          movePageUp(p.id);
                        }}
                        disabled={idx === 0}
                        className="grid size-11 shrink-0 place-items-center rounded-xl text-fg-3 hover:bg-raised disabled:opacity-30 lg:size-6 lg:rounded"
                        title="위로 이동"
                        aria-label="위로 이동"
                      >
                        <ChevronUp size={14} aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          movePageDown(p.id);
                        }}
                        disabled={idx === pages.length - 1}
                        className="grid size-11 shrink-0 place-items-center rounded-xl text-fg-3 hover:bg-raised disabled:opacity-30 lg:size-6 lg:rounded"
                        title="아래로 이동"
                        aria-label="아래로 이동"
                      >
                        <ChevronDown size={14} aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          movePageToTop(p.id);
                        }}
                        disabled={idx === 0}
                        className="grid size-11 shrink-0 place-items-center rounded-xl text-fg-3 hover:bg-raised disabled:opacity-30 lg:size-6 lg:rounded"
                        title="맨 위로"
                        aria-label="맨 위로 이동"
                      >
                        <span aria-hidden="true" className="text-sm leading-none lg:text-[10px]">⇧</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          movePageToBottom(p.id);
                        }}
                        disabled={idx === pages.length - 1}
                        className="grid size-11 shrink-0 place-items-center rounded-xl text-fg-3 hover:bg-raised disabled:opacity-30 lg:size-6 lg:rounded"
                        title="맨 아래로"
                        aria-label="맨 아래로 이동"
                      >
                        <span aria-hidden="true" className="text-sm leading-none lg:text-[10px]">⇩</span>
                      </button>
                    </div>
                  </div>
                  {/* 실내용 미니 썸네일 — 마스터 요소를 페이지 요소 아래에 합성해 경량 SVG 프록시로 축소 렌더.
                      마스터 없음/페이지 숨김이면 원본 page 를 동일 참조로 넘겨 RC 메모이제이션을 보존한다. */}
                  <Suspense
                    fallback={(
                      <div
                        aria-hidden="true"
                        className="h-24 animate-pulse rounded border border-line/60 bg-raised/40"
                      />
                    )}
                  >
                    <StudioPageThumbnail
                      page={composeWorkAssetPreviewPage(p)}
                      className={PAGE_PREVIEW_SIZE_CLASS[pagePreviewSize]}
                    />
                  </Suspense>
                  {metaEditPageId === p.id ? (
                    // 인라인 편집 입력은 늘린 선택 버튼(z-10) 위로 올려 포커스·타이핑을 받게 한다.
                    <div className="relative z-20 flex flex-col gap-1 pt-1">
                      <input
                        // eslint-disable-next-line jsx-a11y/no-autofocus -- 연필 버튼 클릭으로만 열리는 인라인 편집 — 열릴 때 이름란 포커스가 올바른 패턴(기존 텍스트 편집 모달과 동일)
                        autoFocus
                        type="text"
                        defaultValue={p.name ?? ""}
                        placeholder={autoPageName(idx)}
                        maxLength={PAGE_NAME_MAX}
                        aria-label="페이지 이름"
                        className="min-h-11 w-full rounded-lg border border-line bg-card px-2 text-xs font-semibold text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none lg:min-h-0 lg:rounded lg:px-1.5 lg:py-1 lg:text-[10px]"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") {
                            commitPageMeta(p.id, { name: e.currentTarget.value });
                            setMetaEditPageId(null);
                          } else if (e.key === "Escape") {
                            setMetaEditPageId(null);
                          }
                        }}
                        onBlur={(e) => commitPageMeta(p.id, { name: e.target.value })}
                      />
                      <textarea
                        rows={2}
                        defaultValue={p.note ?? ""}
                        placeholder="콘티 메모 (장면·대사 아이디어)"
                        maxLength={PAGE_NOTE_MAX}
                        spellCheck
                        aria-label="콘티 메모"
                        className="min-h-16 w-full resize-none rounded-lg border border-line bg-card px-2 py-2 text-xs leading-tight text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none lg:min-h-0 lg:rounded lg:px-1.5 lg:py-1 lg:text-[9px]"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                        onBlur={(e) => commitPageMeta(p.id, { note: e.target.value })}
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMetaEditPageId(null);
                        }}
                        className="min-h-11 self-end rounded-lg bg-accent px-4 text-xs font-semibold text-on-accent hover:bg-accent-hover lg:min-h-0 lg:rounded lg:px-2 lg:py-0.5 lg:text-[9px]"
                      >
                        완료
                      </button>
                    </div>
                  ) : p.note ? (
                    <p className="line-clamp-2 whitespace-pre-wrap text-[9px] leading-tight text-fg-3" title={p.note}>
                      {p.note}
                    </p>
                  ) : null}
                  <div className="relative z-20 flex items-center justify-start gap-1 overflow-x-auto overscroll-x-contain pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:flex-wrap lg:justify-end lg:overflow-visible">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        insertPageBefore(p.id);
                      }}
                      className="grid size-11 shrink-0 place-items-center rounded-xl text-fg-3 hover:bg-raised lg:size-6 lg:rounded"
                      title="이 앞에 빈 페이지 삽입"
                      aria-label="이 앞에 빈 페이지 삽입"
                    >
                      <Plus size={14} aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        insertPageAfter(p.id);
                      }}
                      className="grid size-11 shrink-0 place-items-center rounded-xl text-fg-3 hover:bg-raised lg:size-6 lg:rounded"
                      title="이 뒤에 빈 페이지 삽입"
                      aria-label="이 뒤에 빈 페이지 삽입"
                    >
                      <Plus size={14} aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        duplicatePage(p.id);
                      }}
                      className="grid size-11 shrink-0 place-items-center rounded-xl text-fg-3 hover:bg-raised lg:size-6 lg:rounded"
                      title="페이지 복제"
                      aria-label="페이지 복제"
                    >
                      <Copy size={14} aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        duplicatePageMirrored(p.id);
                      }}
                      className="grid size-11 shrink-0 place-items-center rounded-xl text-fg-3 hover:bg-raised lg:size-6 lg:rounded"
                      title="미러 복제 (좌우 반전)"
                      aria-label="미러 복제 (좌우 반전)"
                    >
                      <FlipHorizontal2 size={14} aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        clearPageFor(p.id);
                      }}
                      className="grid size-11 shrink-0 place-items-center rounded-xl text-fg-3 hover:bg-raised lg:size-6 lg:rounded"
                      title="이 페이지 내용 비우기"
                      aria-label="이 페이지 내용 비우기"
                    >
                      <Eraser size={14} aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (pages.length <= 1) return;
                        void (async () => {
                          if (
                            !(await confirmStudioDestructiveAction(
                              studioDeletePageRequest({
                                pageNumber: idx + 1,
                                elementCount: p.elements.length,
                              })
                            ))
                          ) return;
                          deletePage(p.id);
                        })();
                      }}
                      disabled={pages.length <= 1}
                      className="grid size-11 shrink-0 place-items-center rounded-xl text-bad hover:bg-bad-soft/20 disabled:opacity-30 lg:size-6 lg:rounded"
                      title="페이지 삭제"
                      aria-label="페이지 삭제"
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        </StudioDetachablePanelSlot>

        {/* 페이지 목록 ↔ 캔버스 너비 스플리터(데스크톱) */}
        {visibleLeftPanelOpen && !desktopDetached && (
          <StudioPageListResizeHandle leftResize={leftResize} />
        )}
    </>
  );
});
