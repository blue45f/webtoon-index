import {
  assignStudioBrushSlot,
  studioBrushSlotAt,
  type StudioBrushSlot,
  type StudioBrushSlotsState,
} from "./brush/studio-brush-slots";
import {
  adjustStudioBrushOpacity,
  adjustStudioBrushWidth,
  resolveStudioDrawingShortcut,
  shouldPreserveStudioTabNavigation,
} from "./brush/studio-drawing-shortcuts";
import { removeBubbleShapePoint } from "./lettering/studio-bubble-custom-shape";
import { matchStudioShortcut, type StudioAppSettings } from "./studio-app-settings";
import {
  isStudioUndoRedoChord,
  resolveStudioEditShortcut,
  shouldHandleStudioEditEvent,
} from "./studio-edit-controls";
import { planGroupEscape, type GroupSelectionState } from "./studio-group-selection";
import { isEffectivelyLocked, type LayerGroup } from "./studio-layers";
import { STUDIO_FILTER_SHORTCUTS } from "./studio-page-editor-runtime-contracts";
import {
  canRedoPixelSelectionHistory,
  canUndoPixelSelectionHistory,
  resolvePixelSelectionHistoryShortcut,
  type PixelSelectionHistoryOperation,
} from "./studio-pixel-selection-session-history";
import { cycleStudioStabilizerStrength, type StudioProDrawPrefs } from "./studio-pro-draw-prefs";
import {
  isSelectionUsable,
  planSelectionAdjust,
  type PixelSelection,
  type SelectionAdjustPlan,
  type SelectionToolKind,
} from "./studio-selection-tools";
import { resolveStudioViewShortcut, stepStudioViewZoom } from "./studio-view-controls";

import type { NormalizedStudioBrushDynamicsSettings } from "./brush/studio-brush-dynamics";
import type { StudioFilterKind } from "./filter/studio-filter-menu";
import type { BubbleVariant } from "./studio-assets";
import type { CropRect } from "./studio-crop";
import type { DrawMode, StudioMenu, Tool } from "./studio-editor-tool-model";
import type { El } from "./studio-element-model";
import type { HealCloneMode } from "./studio-heal-clone";
import type { NodeEditTool } from "./studio-node-edit";
import type { PixelSelectionHistory } from "./studio-pixel-selection-history";
import type { PuppetPin } from "./studio-puppet-warp";
import type { StudioMobileSheet } from "./StudioMobileEditingDock";
import type { StudioProDrawPrefsMutation } from "./useStudioProDrawPrefs";
import type { Dispatch, SetStateAction } from "react";

/**
 * StudioPage 키다운 디스패처가 렌더마다 받는 편집기 표면 — 값은 렌더 시점 스냅샷이고, refs 는
 * ref 그대로 흘러 원본 클로저의 최신성 계약(마운트 한 번 등록 + shortcutRef 로 최신 상태 참조)을
 * 유지한다. 모든 멤버는 StudioPage 의 원래 이름과 1:1 로 대응한다.
 */
export interface StudioShortcutHandlerContext {
  readonly activateDrawToolWithProperties: (nextDrawMode?: DrawMode) => void;
  readonly activatePixelSelectionToolFromInspector: (
    kind: SelectionToolKind | "circle" | "wand" | "color-range"
  ) => void;
  readonly activatePrimaryCanvasTool: (
    nextTool: "select" | "draw",
    nextDrawMode?: DrawMode,
    selectionWillReplaceToolSnapshot?: boolean
  ) => void;
  readonly activeCatalogBrush: {
    readonly name: string;
    readonly sourcePresetId?: string | null;
    readonly sourcePresetName?: string | null;
  };
  readonly activeGroupIdRef: { readonly current: string | null };
  readonly activeSurfaceReviewLocked: boolean;
  readonly activeSurfaceReviewLockedRef: { readonly current: boolean };
  readonly addBubble: (
    variant: BubbleVariant,
    at?: { x: number; y: number },
    editImmediately?: boolean
  ) => void;
  readonly addLayerGroup: (seedElId?: string) => boolean;
  readonly addText: (at?: { x: number; y: number }, editImmediately?: boolean) => void;
  readonly advancedFillActive: boolean;
  readonly advancedFillPreview: object | null;
  readonly announceDrawingShortcut: (message: string) => void;
  readonly appSettingsRef: { readonly current: Pick<StudioAppSettings, "shortcuts"> };
  readonly applyBrushSlot: (slot: StudioBrushSlot) => void;
  readonly applyGroupSelectionState: (next: GroupSelectionState) => void;
  readonly applyPixelSelectionAdjust: (plan: SelectionAdjustPlan) => Promise<void>;
  readonly applyPixelSelectionHistoryCommand: (command: "undo" | "redo") => boolean;
  readonly brush: string;
  readonly brushDynamics: NormalizedStudioBrushDynamicsSettings;
  readonly brushOpacity: number;
  readonly brushSlotsState: StudioBrushSlotsState;
  readonly bubbleShapeArmed: boolean;
  readonly bubbleShapeDragRef: { current: object | null };
  readonly bubbleShapeEditActive: boolean;
  readonly bubbleShapeSelectedPointIndex: number | null;
  readonly cancelAdvancedFillPreview: () => void;
  readonly cancelCanvasGroupDrag: () => boolean;
  readonly cancelCanvasSelectionResize: () => void;
  readonly cancelLiquifyPointerSession: () => void;
  readonly cancelStudioPointCommentComposer: () => void;
  readonly cancelStudioRasterPreparation: () => boolean;
  readonly canvasOnlyMode: boolean;
  readonly clearFilterMaskDragPreview: () => void;
  readonly clearHealCloneDragPreview: () => void;
  readonly clearHistoryBrushDragPreview: () => void;
  readonly clearLayerMaskDragPreview: () => void;
  readonly clearPaintRetouchStrokePreview: () => void;
  readonly clearPolyLassoDraft: () => void;
  readonly closeViewToolWithFocus: () => void;
  readonly collaborationDocumentLocked: boolean;
  readonly collaborationLockMessage: () => string;
  readonly color: string;
  readonly commentPinArmed: boolean;
  readonly commitPixelSelectionState: (
    update: PixelSelection | null | ((current: PixelSelection | null) => PixelSelection | null),
    operation: PixelSelectionHistoryOperation,
    coalesceKey?: string
  ) => boolean;
  readonly commitProDrawPrefsMutation: (
    mutate: StudioProDrawPrefsMutation
  ) => { readonly prefs: StudioProDrawPrefs };
  readonly commitQuickMask: () => void;
  readonly commitStudioBrushSlotsMutation: (
    update: (state: StudioBrushSlotsState) => StudioBrushSlotsState,
    options: { readonly successMessage?: string; readonly failureMessage: string }
  ) => void;
  readonly copySelectedElements: () => boolean;
  readonly cropRect: CropRect | null;
  readonly cutSelectedElements: () => boolean;
  readonly deselectForEdit: () => void;
  readonly disarmAllPixelTools: () => void;
  readonly discardDrawingPointerSession: () => void;
  readonly dismissActiveMobileSheet: () => void;
  readonly dodgeBurnActive: boolean;
  readonly dodgeBurnDragRef: { current: object | null };
  readonly drawingShortcutStateRef: {
    readonly current: { tool: Tool; drawMode: DrawMode; strokeWidth: number; brushOpacity: number };
  };
  readonly duplicateSelected: () => void;
  readonly editing: { readonly id: string } | null;
  readonly elements: El[];
  readonly enterCanvasOnlyMode: () => void;
  readonly enterCompleteSelectedGroup: () => boolean;
  readonly enterQuickMask: () => void;
  readonly exitQuickMask: () => void;
  readonly eyedropperActive: boolean;
  readonly filterMaskDragRef: { current: object | null };
  readonly filterMaskPaintActive: boolean;
  readonly finishPolyLassoSession: () => void;
  readonly fitCanvasToWidth: () => void;
  readonly flipSelected: (axis: "horizontal" | "vertical") => void;
  readonly groupResizeRef: { readonly current: object | null };
  readonly groupSelectedElements: () => boolean;
  readonly groups: LayerGroup[];
  readonly handleSave: (status: "published" | "draft") => Promise<void>;
  readonly hasActiveDrawingPointerSession: () => boolean;
  readonly healCloneAbortRef: { current: AbortController | null };
  readonly healCloneDragRef: { current: object | null };
  readonly healCloneTool: HealCloneMode | null;
  readonly historyBrushActive: boolean;
  readonly historyBrushDragRef: { current: object | null };
  readonly invertSelectionForEdit: () => void;
  readonly lastLetteringInsertRef: {
    readonly current: { kind: "text" } | { kind: "bubble"; variant: BubbleVariant };
  };
  readonly layerMaskDragRef: { current: object | null };
  readonly layerMaskPaintActive: boolean;
  readonly liquifyActive: boolean;
  readonly marqueeIds: string[];
  readonly marqueeIdsRef: { readonly current: string[] };
  readonly menu: StudioMenu | null;
  readonly menuRef: { readonly current: HTMLDivElement | null };
  readonly mobileSheet: StudioMobileSheet;
  readonly nodeEditTool: NodeEditTool | null;
  readonly nudgeSelected: (dx: number, dy: number) => void;
  readonly openPixelSelectionTransform: () => void;
  readonly openSelectedLayerCrop: () => void;
  readonly openStudioFilter: (kind: StudioFilterKind) => Promise<void>;
  readonly panelSplitActive: boolean;
  readonly pasteStudioElementsFromClipboard: (
    placement: "cascade" | "in-place"
  ) => Promise<boolean>;
  readonly patchEl: (id: string, patch: Partial<El>) => boolean;
  readonly pixelBusy: boolean;
  readonly pixelSel: PixelSelection | null;
  readonly pixelSelectionDocumentHistoryOwnsLatestEditRef: { current: boolean };
  readonly pixelSelectionHistoryRef: { readonly current: PixelSelectionHistory };
  readonly pixelTool: SelectionToolKind | "wand" | null;
  readonly pointCommentComposer: object | null;
  readonly polyLassoSessionRef: { readonly current: object | null };
  readonly puppetWarpActive: boolean;
  readonly quickMaskActive: boolean;
  readonly redo: () => void;
  readonly releaseBubbleShapePointerCapture: () => void;
  readonly removeSelected: () => void;
  readonly reorder: (dir: "front" | "back" | "forward" | "backward") => void;
  readonly resetView: () => void;
  readonly restoreSavedStudioView: () => void;
  readonly saveCurrentStudioView: () => void;
  readonly saving: boolean;
  readonly secondaryColor: string;
  readonly selectAllForEdit: () => void;
  readonly selected: El | null;
  readonly selectedId: string | null;
  readonly selectedIdRef: { readonly current: string | null };
  readonly selectedImageMutationLocked: boolean;
  readonly setActualPixelView: () => void;
  readonly setBrushOpacity: Dispatch<SetStateAction<number>>;
  readonly setBubbleShapeEditActive: Dispatch<SetStateAction<boolean>>;
  readonly setBubbleShapeSelectedPointIndex: Dispatch<SetStateAction<number | null>>;
  readonly setCanvasOnlyMode: Dispatch<SetStateAction<boolean>>;
  readonly setColor: Dispatch<SetStateAction<string>>;
  readonly setCropRect: Dispatch<SetStateAction<CropRect | null>>;
  readonly setDodgeBurnActive: Dispatch<SetStateAction<boolean>>;
  readonly setEyedropperActive: Dispatch<SetStateAction<boolean>>;
  readonly setFilterMaskPaintActive: Dispatch<SetStateAction<boolean>>;
  readonly setHealCloneBusy: Dispatch<SetStateAction<boolean>>;
  readonly setHealCloneTool: Dispatch<SetStateAction<HealCloneMode | null>>;
  readonly setHistoryBrushActive: Dispatch<SetStateAction<boolean>>;
  readonly setLayerMaskPaintActive: Dispatch<SetStateAction<boolean>>;
  readonly setLiquifyActive: Dispatch<SetStateAction<boolean>>;
  readonly setMarqueeIds: Dispatch<SetStateAction<string[]>>;
  readonly setMenu: (update: SetStateAction<StudioMenu | null>) => void;
  readonly setNodeEditTool: Dispatch<SetStateAction<NodeEditTool | null>>;
  readonly setPanelSplitActive: Dispatch<SetStateAction<boolean>>;
  readonly setPanelSplitHint: Dispatch<SetStateAction<string | null>>;
  readonly setPixelTool: Dispatch<SetStateAction<SelectionToolKind | "wand" | null>>;
  readonly setPuppetWarpActive: Dispatch<SetStateAction<boolean>>;
  readonly setPuppetWarpPins: Dispatch<SetStateAction<PuppetPin[]>>;
  readonly setSecondaryColor: Dispatch<SetStateAction<string>>;
  readonly setSelectedId: Dispatch<SetStateAction<string | null>>;
  readonly setShortcutsOpen: Dispatch<SetStateAction<boolean>>;
  readonly setSmudgeActive: Dispatch<SetStateAction<boolean>>;
  readonly setStabilizer: Dispatch<SetStateAction<number>>;
  readonly setStrokeWidth: (update: SetStateAction<number>) => void;
  readonly setStudioCommentPinsHidden: (next: SetStateAction<boolean>) => void;
  readonly setViewTool: Dispatch<SetStateAction<"zoom" | "rotate" | null>>;
  readonly setWetMixActive: Dispatch<SetStateAction<boolean>>;
  readonly setZoom: (action: SetStateAction<number>) => void;
  readonly shortcutsOpen: boolean;
  readonly smudgeActive: boolean;
  readonly smudgeDragRef: { current: object | null };
  readonly startEditText: (id: string) => Promise<void>;
  readonly stopStudioCommentPlacementSession: () => void;
  readonly strokeWidth: number;
  readonly timelapseCapturing: boolean;
  readonly toggleAdvancedFill: () => void;
  readonly toggleCanvasRulers: () => void;
  readonly toggleDodgeBurnTool: () => void;
  readonly toggleFullscreen: () => void;
  readonly toggleGrayscaleView: () => void;
  readonly toggleHorizontalCanvasView: () => void;
  readonly toggleLiquifyTool: () => void;
  readonly togglePerspectiveGuideView: () => void;
  readonly togglePixelMarquee: (kind: "rect" | "circle") => void;
  readonly toggleSmudgeTool: () => void;
  readonly toggleStudioCommentPinPlacement: () => void;
  readonly toggleStudioQuickAccessPalette: () => void;
  readonly toggleWetMixTool: () => void;
  readonly undo: () => void;
  readonly ungroupSelectedElements: () => boolean;
  readonly viewTool: "zoom" | "rotate" | null;
  readonly viewTransformSuppressed: boolean;
  readonly wetMixActive: boolean;
  readonly wetMixDragRef: { current: object | null };
  readonly zoomToSelection: () => void;
}

/**
 * StudioPage 키다운 디스패처 본문 — StudioPage.tsx 에서 추출(2026-08, B-06). 동작 동일 이동:
 * 아래 반환 핸들러 본문은 원본 `shortcutRef.current = (e) => { … }` 클로저의 verbatim 이동이고,
 * 우선순위(모달 경계 → ⌘S 저장 → 편집 게이트 → 사용자 지정 도구 화음 → 보기/편집/그리기 리졸버 →
 * Esc 레이어 캐스케이드 → 방향키 미세이동)도 그대로다. StudioPage 는 렌더마다 이 팩토리로 만든
 * 핸들러를 shortcutRef 에 대입하고, 마운트 시 한 번 등록한 keydown 리스너가 ref 를 경유한다.
 */
export function buildStudioShortcutHandler(
  ctx: StudioShortcutHandlerContext
): (e: KeyboardEvent) => void {
  const {
    activateDrawToolWithProperties,
    activatePixelSelectionToolFromInspector,
    activatePrimaryCanvasTool,
    activeCatalogBrush,
    activeGroupIdRef,
    activeSurfaceReviewLocked,
    activeSurfaceReviewLockedRef,
    addBubble,
    addLayerGroup,
    addText,
    advancedFillActive,
    advancedFillPreview,
    announceDrawingShortcut,
    appSettingsRef,
    applyBrushSlot,
    applyGroupSelectionState,
    applyPixelSelectionAdjust,
    applyPixelSelectionHistoryCommand,
    brush,
    brushDynamics,
    brushOpacity,
    brushSlotsState,
    bubbleShapeArmed,
    bubbleShapeDragRef,
    bubbleShapeEditActive,
    bubbleShapeSelectedPointIndex,
    cancelAdvancedFillPreview,
    cancelCanvasGroupDrag,
    cancelCanvasSelectionResize,
    cancelLiquifyPointerSession,
    cancelStudioPointCommentComposer,
    cancelStudioRasterPreparation,
    canvasOnlyMode,
    clearFilterMaskDragPreview,
    clearHealCloneDragPreview,
    clearHistoryBrushDragPreview,
    clearLayerMaskDragPreview,
    clearPaintRetouchStrokePreview,
    clearPolyLassoDraft,
    closeViewToolWithFocus,
    collaborationDocumentLocked,
    collaborationLockMessage,
    color,
    commentPinArmed,
    commitPixelSelectionState,
    commitProDrawPrefsMutation,
    commitQuickMask,
    commitStudioBrushSlotsMutation,
    copySelectedElements,
    cropRect,
    cutSelectedElements,
    deselectForEdit,
    disarmAllPixelTools,
    discardDrawingPointerSession,
    dismissActiveMobileSheet,
    dodgeBurnActive,
    dodgeBurnDragRef,
    drawingShortcutStateRef,
    duplicateSelected,
    editing,
    elements,
    enterCanvasOnlyMode,
    enterCompleteSelectedGroup,
    enterQuickMask,
    exitQuickMask,
    eyedropperActive,
    filterMaskDragRef,
    filterMaskPaintActive,
    finishPolyLassoSession,
    fitCanvasToWidth,
    flipSelected,
    groupResizeRef,
    groupSelectedElements,
    groups,
    handleSave,
    hasActiveDrawingPointerSession,
    healCloneAbortRef,
    healCloneDragRef,
    healCloneTool,
    historyBrushActive,
    historyBrushDragRef,
    invertSelectionForEdit,
    lastLetteringInsertRef,
    layerMaskDragRef,
    layerMaskPaintActive,
    liquifyActive,
    marqueeIds,
    marqueeIdsRef,
    menu,
    menuRef,
    mobileSheet,
    nodeEditTool,
    nudgeSelected,
    openPixelSelectionTransform,
    openSelectedLayerCrop,
    openStudioFilter,
    panelSplitActive,
    pasteStudioElementsFromClipboard,
    patchEl,
    pixelBusy,
    pixelSel,
    pixelSelectionDocumentHistoryOwnsLatestEditRef,
    pixelSelectionHistoryRef,
    pixelTool,
    pointCommentComposer,
    polyLassoSessionRef,
    puppetWarpActive,
    quickMaskActive,
    redo,
    releaseBubbleShapePointerCapture,
    removeSelected,
    reorder,
    resetView,
    restoreSavedStudioView,
    saveCurrentStudioView,
    saving,
    secondaryColor,
    selectAllForEdit,
    selected,
    selectedId,
    selectedIdRef,
    selectedImageMutationLocked,
    setActualPixelView,
    setBrushOpacity,
    setBubbleShapeEditActive,
    setBubbleShapeSelectedPointIndex,
    setCanvasOnlyMode,
    setColor,
    setCropRect,
    setDodgeBurnActive,
    setEyedropperActive,
    setFilterMaskPaintActive,
    setHealCloneBusy,
    setHealCloneTool,
    setHistoryBrushActive,
    setLayerMaskPaintActive,
    setLiquifyActive,
    setMarqueeIds,
    setMenu,
    setNodeEditTool,
    setPanelSplitActive,
    setPanelSplitHint,
    setPixelTool,
    setPuppetWarpActive,
    setPuppetWarpPins,
    setSecondaryColor,
    setSelectedId,
    setShortcutsOpen,
    setSmudgeActive,
    setStabilizer,
    setStrokeWidth,
    setStudioCommentPinsHidden,
    setViewTool,
    setWetMixActive,
    setZoom,
    shortcutsOpen,
    smudgeActive,
    smudgeDragRef,
    startEditText,
    stopStudioCommentPlacementSession,
    strokeWidth,
    timelapseCapturing,
    toggleAdvancedFill,
    toggleCanvasRulers,
    toggleDodgeBurnTool,
    toggleFullscreen,
    toggleGrayscaleView,
    toggleHorizontalCanvasView,
    toggleLiquifyTool,
    togglePerspectiveGuideView,
    togglePixelMarquee,
    toggleSmudgeTool,
    toggleStudioCommentPinPlacement,
    toggleStudioQuickAccessPalette,
    toggleWetMixTool,
    undo,
    ungroupSelectedElements,
    viewTool,
    viewTransformSuppressed,
    wetMixActive,
    wetMixDragRef,
    zoomToSelection,
  } = ctx;
  // 본문 들여쓰기(6칸)는 StudioPage 원본 그대로 보존한다 — 소스 스캔 경계 테스트들의
  // 들여쓰기 포함 마커('\n      } else if (' 등)가 추출 후에도 같은 텍스트를 찾도록.
  return (e: KeyboardEvent) => {
      // 탭·메뉴·캔버스 내부 위젯이 이미 소비한 키는 전역 원고 편집 명령으로 다시 실행하지 않는다.
      if (e.defaultPrevented) return;
      if (e.isComposing || e.keyCode === 229) return;
      const target = e.target as HTMLElement | null;
      const typing = !!target && (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable ||
        target.getAttribute("role") === "textbox"
      );
      const insideShortcutBoundary = target !== null &&
        target.closest("[data-studio-shortcut-boundary='true'], [aria-modal='true']") !== null;
      // 포커스를 아직 모달 안으로 옮기지 못한 첫 프레임에도 Delete/Undo/B/E가 뒤 원고에 닿지 않게,
      // 이벤트 target뿐 아니라 열린 modal 자체를 전역 파괴 명령의 경계로 취급한다.
      const openModals = typeof document === "undefined"
        ? []
        : [...document.querySelectorAll<HTMLElement>("[aria-modal='true']")].filter(
            (modal) => !modal.hidden && !modal.inert && modal.getClientRects().length > 0
          );
      if (openModals.length > 0) {
        if (
          e.key === "Escape"
          && mobileSheet
          && openModals.every((modal) => modal.dataset.studioMobileSheet === "true")
        ) {
          e.preventDefault();
          dismissActiveMobileSheet();
        }
        return;
      }
      // 파일 메뉴(`임시저장`)와 Quick Access deck이 ⌘S를 광고하므로 실제 핸들러를 여기에 둔다.
      // 광고만 되고 바인딩이 없으면 브라우저 "페이지 저장" 대화상자가 대신 뜬다.
      // 제목·대사 입력 중에도 저장은 동작해야 하므로 편집 게이트보다 앞에 배치한다.
      if (
        (e.metaKey || e.ctrlKey)
        && !e.altKey
        && !e.shiftKey
        && e.code === "KeyS"
        && !e.repeat
      ) {
        e.preventDefault();
        if (collaborationDocumentLocked) {
          announceDrawingShortcut(collaborationLockMessage());
        } else if (saving) {
          announceDrawingShortcut("이미 저장 중이에요");
        } else {
          void handleSave("draft");
        }
        return;
      }
      if (!shouldHandleStudioEditEvent({
        typing,
        editing: Boolean(editing),
        insideShortcutBoundary,
        undoRedoIntent: isStudioUndoRedoChord(e),
        timelapseCapturing,
      })) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape" && viewTool) {
        e.preventDefault();
        closeViewToolWithFocus();
        return;
      }
      if (
        e.code === "KeyC"
        && e.shiftKey
        && !e.metaKey
        && !e.ctrlKey
        && !e.altKey
        && !e.repeat
      ) {
        e.preventDefault();
        setStudioCommentPinsHidden((hidden) => {
          const next = !hidden;
          announceDrawingShortcut(next ? "열린 댓글 핀 숨김" : "열린 댓글 핀 표시");
          return next;
        });
        return;
      }

      // 앱 설정 → Shortcuts: user-bound chords (tool switchers etc.).
      const sc = appSettingsRef.current.shortcuts;
      if (matchStudioShortcut(sc["tool-select"], e)) {
        e.preventDefault();
        activatePrimaryCanvasTool("select");
        return;
      }
      if (matchStudioShortcut(sc["tool-pen"], e)) {
        e.preventDefault();
        activateDrawToolWithProperties("pen");
        return;
      }
      if (matchStudioShortcut(sc["tool-eraser"], e)) {
        e.preventDefault();
        activateDrawToolWithProperties("eraser");
        return;
      }
      if (matchStudioShortcut(sc["tool-fill"], e)) {
        e.preventDefault();
        toggleAdvancedFill();
        return;
      }
      if (matchStudioShortcut(sc["tool-eyedropper"], e)) {
        e.preventDefault();
        const nextEyedropperActive = !eyedropperActive;
        if (nextEyedropperActive) disarmAllPixelTools();
        setEyedropperActive(nextEyedropperActive);
        return;
      }
      if (matchStudioShortcut(sc["tool-lasso"], e)) {
        e.preventDefault();
        activatePixelSelectionToolFromInspector("lasso");
        return;
      }
      // 각 설정 가능 단축키는 레일 버튼과 동일한 상태 전이를 재사용한다.
      if (matchStudioShortcut(sc["tool-pixel"], e)) {
        e.preventDefault();
        if (!activeSurfaceReviewLocked) {
          activateDrawToolWithProperties("pixel");
        }
        return;
      }
      if (matchStudioShortcut(sc["tool-marquee"], e)) {
        e.preventDefault();
        togglePixelMarquee("rect");
        return;
      }
      if (matchStudioShortcut(sc["tool-marquee-circle"], e)) {
        e.preventDefault();
        togglePixelMarquee("circle");
        return;
      }
      if (matchStudioShortcut(sc["tool-transform"], e)) {
        e.preventDefault();
        openPixelSelectionTransform();
        return;
      }
      if (matchStudioShortcut(sc["tool-crop"], e)) {
        e.preventDefault();
        openSelectedLayerCrop();
        return;
      }
      if (!e.repeat && matchStudioShortcut(sc["tool-comment"], e)) {
        e.preventDefault();
        toggleStudioCommentPinPlacement();
        return;
      }
      if (matchStudioShortcut(sc["tool-blend"], e)) {
        e.preventDefault();
        toggleSmudgeTool();
        return;
      }
      if (matchStudioShortcut(sc["tool-wet-mix"], e)) {
        e.preventDefault();
        toggleWetMixTool();
        return;
      }
      if (matchStudioShortcut(sc["tool-dodge-burn"], e)) {
        e.preventDefault();
        toggleDodgeBurnTool();
        return;
      }
      if (matchStudioShortcut(sc["tool-liquify"], e)) {
        e.preventDefault();
        toggleLiquifyTool();
        return;
      }
      if (matchStudioShortcut(sc["tool-lettering"], e)) {
        e.preventDefault();
        if (
          selected &&
          (selected.type === "text" || selected.type === "bubble" || selected.type === "sticker")
        ) {
          if (activeSurfaceReviewLocked || isEffectivelyLocked(selected, groups)) {
            announceDrawingShortcut("잠긴 레터링은 편집할 수 없어요");
            return;
          }
          void startEditText(selected.id);
          return;
        }
        if (activeSurfaceReviewLocked) {
          announceDrawingShortcut("검토 잠금을 해제한 뒤 레터링을 추가할 수 있어요");
          return;
        }
        const lastLettering = lastLetteringInsertRef.current;
        if (lastLettering.kind === "text") addText(undefined, true);
        else addBubble(lastLettering.variant, undefined, true);
        return;
      }
      if (matchStudioShortcut(sc["tool-zoom"], e)) {
        e.preventDefault();
        if (!viewTransformSuppressed) {
          if (viewTool === "zoom") closeViewToolWithFocus();
          else setViewTool("zoom");
          announceDrawingShortcut("보기 확대·축소 도구");
        }
        return;
      }
      if (matchStudioShortcut(sc["tool-rotate-view"], e)) {
        e.preventDefault();
        if (!viewTransformSuppressed) {
          if (viewTool === "rotate") closeViewToolWithFocus();
          else setViewTool("rotate");
          announceDrawingShortcut("보기 회전 도구");
        }
        return;
      }
      if (matchStudioShortcut(sc["flip-canvas"], e)) {
        e.preventDefault();
        if (!e.repeat) toggleHorizontalCanvasView();
        return;
      }
      if (matchStudioShortcut(sc["reset-view"], e)) {
        e.preventDefault();
        resetView();
        announceDrawingShortcut("화면 리셋");
        return;
      }
      if (matchStudioShortcut(sc["zoom-to-selection"], e) && !e.repeat) {
        e.preventDefault();
        zoomToSelection();
        return;
      }
      if (matchStudioShortcut(sc["flip-selection-h"], e) && !e.repeat) {
        e.preventDefault();
        flipSelected("horizontal");
        return;
      }
      if (matchStudioShortcut(sc["flip-selection-v"], e) && !e.repeat) {
        e.preventDefault();
        flipSelected("vertical");
        return;
      }
      if (matchStudioShortcut(sc["deselect-pixels"], e)) {
        e.preventDefault();
        deselectForEdit();
        return;
      }
      // 빠른 액세스 팔레트 — Q(퀵 마스크)와 충돌하지 않는 Shift+Q.
      // 사용자 지정 도구 단축키를 먼저 해석했으므로 같은 조합을 직접 지정한 경우 그 설정이 우선한다.
      if (
        e.code === "KeyQ"
        && e.shiftKey
        && !e.metaKey
        && !e.ctrlKey
        && !e.altKey
        && !e.repeat
      ) {
        e.preventDefault();
        toggleStudioQuickAccessPalette();
        return;
      }
      // 퀵 마스크(Q) — PS 관례: 토글, 끌 때 마스크를 선택 영역으로 변환한다.
      if (e.code === "KeyQ" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat) {
        if (quickMaskActive) {
          e.preventDefault();
          commitQuickMask();
          return;
        }
        if (selected?.type === "image" && !selectedImageMutationLocked) {
          e.preventDefault();
          enterQuickMask();
          return;
        }
      }
      if (
        matchStudioShortcut(sc["invert-pixels"], e)
        && selected?.type === "image"
        && isSelectionUsable(pixelSel)
      ) {
        e.preventDefault();
        invertSelectionForEdit();
        return;
      }
      if (matchStudioShortcut(sc["shortcuts-help"], e)) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      // Magma식 보기 키는 Shift+S(기존 크기 잠금)와 Shift+G(고급 채우기)보다 먼저 해석한다.
      // 입력 필드·모달·메뉴·레이어 트리는 위 shortcut boundary 가 이미 보호한다.
      const viewShortcut = resolveStudioViewShortcut(e);
      if (viewShortcut) {
        e.preventDefault();
        if (viewTransformSuppressed) return;
        if (viewShortcut === "zoom-in") {
          setZoom((current) => stepStudioViewZoom(current, 1));
        } else if (viewShortcut === "zoom-out") {
          setZoom((current) => stepStudioViewZoom(current, -1));
        } else if (viewShortcut === "fit-width") {
          fitCanvasToWidth();
          announceDrawingShortcut("화면에 맞게 조정");
        } else if (viewShortcut === "actual-pixels") {
          setActualPixelView();
          announceDrawingShortcut("실제 픽셀 100%");
        } else if (viewShortcut === "fullscreen") {
          toggleFullscreen();
        } else if (viewShortcut === "toggle-grayscale") {
          toggleGrayscaleView();
        } else if (viewShortcut === "save-view") {
          saveCurrentStudioView();
        } else if (viewShortcut === "restore-view") {
          restoreSavedStudioView();
        } else if (viewShortcut === "toggle-perspective-guide") {
          togglePerspectiveGuideView();
        }
        return;
      }
      const editShortcut = resolveStudioEditShortcut(e);
      const drawingShortcut = resolveStudioDrawingShortcut(e, { shortcuts: appSettingsRef.current.shortcuts });
      const filterShortcut = mod && e.shiftKey && !e.altKey
        ? STUDIO_FILTER_SHORTCUTS[e.code]
        : undefined;
      const pixelSelectionHistoryShortcut = resolvePixelSelectionHistoryShortcut(e, {
        history: pixelSelectionHistoryRef.current,
        activeElementId: selected?.type === "image" ? selected.id : null,
        pixelSelectionContextActive:
          !pixelBusy
          && selected?.type === "image"
          && Boolean(
            pixelTool
            || pixelSel
            || canUndoPixelSelectionHistory(
              pixelSelectionHistoryRef.current,
              selected.id
            )
            || canRedoPixelSelectionHistory(
              pixelSelectionHistoryRef.current,
              selected.id
            )
          ),
        documentHistoryOwnsLatestEdit:
          pixelSelectionDocumentHistoryOwnsLatestEditRef.current,
      });
      if (pixelSelectionHistoryShortcut.command) {
        if (pixelSelectionHistoryShortcut.preventDefault) e.preventDefault();
        applyPixelSelectionHistoryCommand(
          pixelSelectionHistoryShortcut.command === "selection-undo" ? "undo" : "redo"
        );
      } else if (filterShortcut) {
        e.preventDefault();
        openStudioFilter(filterShortcut);
      } else if (mod && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
          pixelSelectionDocumentHistoryOwnsLatestEditRef.current = true;
        } else {
          undo();
          pixelSelectionDocumentHistoryOwnsLatestEditRef.current = false;
        }
      } else if (mod && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        redo();
        pixelSelectionDocumentHistoryOwnsLatestEditRef.current = true;
      } else if (editShortcut === "cut") {
        if (cutSelectedElements()) e.preventDefault();
      } else if (editShortcut === "copy") {
        if (copySelectedElements()) e.preventDefault();
      } else if (editShortcut === "paste-in-place") {
        e.preventDefault();
        void pasteStudioElementsFromClipboard("in-place");
      } else if (editShortcut === "select-all") {
        e.preventDefault();
        selectAllForEdit();
      } else if (editShortcut === "deselect") {
        e.preventDefault();
        deselectForEdit();
      } else if (editShortcut === "invert-selection") {
        e.preventDefault();
        invertSelectionForEdit();
      } else if (editShortcut === "duplicate") {
        e.preventDefault();
        if (!activeSurfaceReviewLocked) duplicateSelected();
      } else if (editShortcut === "bring-front") {
        e.preventDefault();
        if (!activeSurfaceReviewLocked) reorder("front");
      } else if (editShortcut === "bring-forward") {
        e.preventDefault();
        if (!activeSurfaceReviewLocked) reorder("forward");
      } else if (editShortcut === "send-back") {
        e.preventDefault();
        if (!activeSurfaceReviewLocked) reorder("back");
      } else if (editShortcut === "send-backward") {
        e.preventDefault();
        if (!activeSurfaceReviewLocked) reorder("backward");
      } else if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        if (!viewTransformSuppressed) {
          setZoom((current) => stepStudioViewZoom(current, 1));
        }
      } else if (mod && e.key === "-") {
        e.preventDefault();
        if (!viewTransformSuppressed) {
          setZoom((current) => stepStudioViewZoom(current, -1));
        }
      } else if (mod && e.key === "0") {
        e.preventDefault();
        if (!viewTransformSuppressed) setZoom(1);
      } else if (drawingShortcut) {
        const targetEl = e.target instanceof HTMLElement ? e.target : null;
        const inField = Boolean(
          targetEl?.closest("input, textarea, select, [contenteditable='true']")
        );
        const preserveTabNavigation =
          drawingShortcut.type === "toggle-chrome" &&
          targetEl !== null &&
          shouldPreserveStudioTabNavigation({
            tagName: targetEl.tagName,
            role: targetEl.getAttribute("role"),
            tabIndex: targetEl.tabIndex,
            isContentEditable: targetEl.isContentEditable,
            canvasViewportFocused: targetEl.matches("[data-studio-canvas-viewport]"),
          });
        // Chrome toggle / number slots must not steal focus from form fields.
        if (
          preserveTabNavigation ||
          (inField && drawingShortcut.type === "recall-brush-slot")
        ) {
          return;
        }
        e.preventDefault();
        if (
          activeSurfaceReviewLockedRef.current &&
          drawingShortcut.type !== "toggle-chrome"
        ) {
          if (!e.repeat) {
            announceDrawingShortcut(
              collaborationDocumentLocked
                ? collaborationLockMessage()
                : "이 페이지는 검토 잠금 상태예요. 잠금을 해제한 뒤 그릴 수 있어요."
            );
          }
          return;
        }
        if (drawingShortcut.type === "select-pen") {
          drawingShortcutStateRef.current.tool = "draw";
          drawingShortcutStateRef.current.drawMode = "pen";
          activatePrimaryCanvasTool("draw", "pen");
          announceDrawingShortcut("펜");
        } else if (drawingShortcut.type === "select-eraser") {
          const currentDrawing = drawingShortcutStateRef.current;
          currentDrawing.tool = "draw";
          currentDrawing.drawMode = "eraser";
          activatePrimaryCanvasTool("draw", "eraser");
          announceDrawingShortcut("지우개");
        } else if (drawingShortcut.type === "toggle-transparent-color") {
          const currentDrawing = drawingShortcutStateRef.current;
          const nextMode = currentDrawing.drawMode === "eraser" ? "pen" : "eraser";
          currentDrawing.tool = "draw";
          currentDrawing.drawMode = nextMode;
          activatePrimaryCanvasTool("draw", nextMode);
          announceDrawingShortcut(nextMode === "eraser" ? "투명색 (지우개 모드)" : "원래 색 (펜 모드)");
        } else if (drawingShortcut.type === "swap-colors") {
          setColor(secondaryColor);
          setSecondaryColor(color);
          announceDrawingShortcut("색 교체");
        } else if (drawingShortcut.type === "default-colors") {
          setColor("#1a1a1a");
          setSecondaryColor("#f5f0e8");
          announceDrawingShortcut("기본 색 (먹·종이)");
        } else if (drawingShortcut.type === "cycle-stabilizer") {
          setStabilizer((prev) => {
            const next = cycleStudioStabilizerStrength(prev);
            announceDrawingShortcut(`보정 ${next}`);
            return next;
          });
        } else if (drawingShortcut.type === "toggle-canvas-flip-h") {
          toggleHorizontalCanvasView();
        } else if (drawingShortcut.type === "toggle-size-lock") {
          const { prefs: next } = commitProDrawPrefsMutation(
            (latest) => ({ ...latest, sizeLocked: !latest.sizeLocked })
          );
          announceDrawingShortcut(next.sizeLocked ? "크기 잠금" : "크기 잠금 해제");
        } else if (drawingShortcut.type === "toggle-opacity-lock") {
          const { prefs: next } = commitProDrawPrefsMutation(
            (latest) => ({ ...latest, opacityLocked: !latest.opacityLocked })
          );
          announceDrawingShortcut(next.opacityLocked ? "불투명 잠금" : "불투명 잠금 해제");
        } else if (drawingShortcut.type === "adjust-width") {
          const currentDrawing = drawingShortcutStateRef.current;
          const nextWidth = adjustStudioBrushWidth(currentDrawing.strokeWidth, drawingShortcut.delta);
          if (nextWidth === currentDrawing.strokeWidth) return;
          currentDrawing.strokeWidth = nextWidth;
          setStrokeWidth(nextWidth);
          if (!e.repeat) announceDrawingShortcut(`브러시 크기 ${nextWidth}px`);
        } else if (drawingShortcut.type === "adjust-opacity") {
          const currentDrawing = drawingShortcutStateRef.current;
          const nextOpacity = adjustStudioBrushOpacity(currentDrawing.brushOpacity, drawingShortcut.delta);
          if (nextOpacity === currentDrawing.brushOpacity) return;
          currentDrawing.brushOpacity = nextOpacity;
          setBrushOpacity(nextOpacity);
          if (!e.repeat) announceDrawingShortcut(`브러시 불투명도 ${Math.round(nextOpacity * 100)}%`);
        } else if (drawingShortcut.type === "recall-brush-slot") {
          const slot = studioBrushSlotAt(brushSlotsState, drawingShortcut.index);
          if (!slot) {
            if (!e.repeat) announceDrawingShortcut(`슬롯 ${drawingShortcut.index + 1} 비어 있음 · Shift+${drawingShortcut.index + 1}로 저장`);
            return;
          }
          applyBrushSlot(slot);
          announceDrawingShortcut(`슬롯 ${drawingShortcut.index + 1}`);
        } else if (drawingShortcut.type === "toggle-chrome") {
          // Browser-safe canvas-first toggle; Tab remains native focus navigation.
          if (canvasOnlyMode) {
            setCanvasOnlyMode(false);
            announceDrawingShortcut("도구 표시");
          } else {
            enterCanvasOnlyMode();
            announceDrawingShortcut("캔버스만");
          }
        }
      } else if (
        !mod &&
        e.shiftKey &&
        !e.altKey &&
        !e.repeat &&
        /^[1-6]$/.test(e.key) &&
        !(e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable=true]"))
      ) {
        e.preventDefault();
        const index = Number(e.key) - 1;
        commitStudioBrushSlotsMutation(
          (prev) => assignStudioBrushSlot(prev, index, {
            brushId: brush,
            ...(activeCatalogBrush.sourcePresetId
              ? {
                  sourcePresetId: activeCatalogBrush.sourcePresetId,
                  sourcePresetName: activeCatalogBrush.sourcePresetName ?? activeCatalogBrush.name,
                }
              : {}),
            brushDynamics,
            strokeWidth,
            brushOpacity,
          }),
          {
            successMessage: `슬롯 ${index + 1}에 저장`,
            failureMessage: `슬롯 ${index + 1}을 SQLite에 저장하지 못했어요.`,
          },
        );
      } else if (
        !mod &&
        !e.altKey &&
        !e.shiftKey &&
        !e.repeat &&
        (e.key === "x" || e.key === "X") &&
        !(e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable=true]"))
      ) {
        // Photoshop/CSP: swap foreground / background colors.
        e.preventDefault();
        setColor(secondaryColor);
        setSecondaryColor(color);
        announceDrawingShortcut("색 교체");
      } else if ((e.key === "Delete" || e.key === "Backspace") && (selectedId || marqueeIds.length > 0)) {
        e.preventDefault();
        if (
          bubbleShapeArmed &&
          selected?.type === "bubble" &&
          bubbleShapeSelectedPointIndex !== null
        ) {
          const removed = removeBubbleShapePoint(
            selected.customShapePoints ?? [],
            bubbleShapeSelectedPointIndex
          );
          if (removed.changed) {
            patchEl(selected.id, { customShapePoints: removed.points } as Partial<El>);
            const nextCount = removed.points.length / 2;
            setBubbleShapeSelectedPointIndex(Math.min(bubbleShapeSelectedPointIndex, nextCount - 1));
            announceDrawingShortcut(`말풍선 외곽선 점 삭제 · ${nextCount}개`);
          } else if (removed.outcome === "minimum-points") {
            announceDrawingShortcut("말풍선 외곽선에는 최소 3개의 점이 필요합니다");
          }
          return;
        }
        // 픽셀 선택이 살아 있으면 요소 삭제 대신 선택 영역 픽셀 삭제(포토샵과 동일한 기대).
        if (selected?.type === "image" && isSelectionUsable(pixelSel)) {
          if (!pixelBusy && !selectedImageMutationLocked) {
            void applyPixelSelectionAdjust(planSelectionAdjust("delete"));
          }
          return;
        }
        removeSelected();
      } else if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      } else if (e.key === "Escape") {
        // Quick Start dismisses itself via capture-phase Esc on StudioQuickStartPanel.
        if (cancelStudioRasterPreparation()) {
          e.preventDefault();
          announceDrawingShortcut("편집용 래스터 준비를 취소했습니다");
        } else if (groupResizeRef.current) {
          e.preventDefault();
          cancelCanvasSelectionResize();
          announceDrawingShortcut("그룹 크기 조절을 취소했습니다");
        } else if (cancelCanvasGroupDrag()) {
          e.preventDefault();
          announceDrawingShortcut("그룹 이동을 취소했습니다");
        } else if (hasActiveDrawingPointerSession()) {
          e.preventDefault();
          discardDrawingPointerSession();
          announceDrawingShortcut("진행 중인 획을 취소했습니다");
        } else if (mobileSheet) dismissActiveMobileSheet();
        else if (shortcutsOpen) setShortcutsOpen(false);
        else if (menu) {
          // 위 레이어부터 닫기: 단축키 오버레이 → 열린 툴바 드롭다운 → 선택해제.
          // 포커스가 드롭다운 안이면 언마운트로 잃어버리므로 트리거(래퍼 첫 버튼)로 복귀.
          menuRef.current?.querySelector<HTMLButtonElement>(":scope > button")?.focus();
          setMenu(null);
        } else if (commentPinArmed) {
          e.preventDefault();
          stopStudioCommentPlacementSession();
          announceDrawingShortcut("댓글 핀 배치 취소");
        } else if (pointCommentComposer) {
          e.preventDefault();
          cancelStudioPointCommentComposer();
        } else if (advancedFillPreview) {
          cancelAdvancedFillPreview();
        } else if (advancedFillActive) {
          toggleAdvancedFill();
        } else if (cropRect) {
          // 크롭 모드를 먼저 종료(영역 폐기) — 다음 Esc 가 픽셀 선택/요소 선택을 해제한다.
          setCropRect(null);
        } else if (puppetWarpActive) {
          // 퍼펫 워프도 crop과 동일하게 Esc 로 먼저 종료(핀 전부 폐기) — 다음 Esc 가 그 다음 레이어를 닫는다.
          setPuppetWarpActive(false);
          setPuppetWarpPins([]);
        } else if (panelSplitActive) {
          setPanelSplitActive(false);
          setPanelSplitHint(null);
        } else if (nodeEditTool) {
          setNodeEditTool(null);
        } else if (bubbleShapeEditActive) {
          setBubbleShapeEditActive(false);
          releaseBubbleShapePointerCapture();
          bubbleShapeDragRef.current = null;
        } else if (healCloneTool) {
          healCloneAbortRef.current?.abort();
          healCloneAbortRef.current = null;
          setHealCloneBusy(false);
          setHealCloneTool(null);
          healCloneDragRef.current = null;
          clearHealCloneDragPreview();
        } else if (historyBrushActive) {
          // 소스 지정(historyBrushSourceIndex/Src)은 crop rect 와 달리 Esc 로 폐기하지 않는다 — 다시
          // 켰을 때 같은 소스로 이어서 칠할 수 있어야 사용자가 반복 작업하기 편하다(heal-clone 의
          // Alt+클릭 오프셋도 disarm 으로는 안 지워지고 요소 전환/명시적 해제로만 지워지는 것과 동일 정책).
          setHistoryBrushActive(false);
          historyBrushDragRef.current = null;
          clearHistoryBrushDragPreview();
        } else if (smudgeActive) {
          setSmudgeActive(false);
          smudgeDragRef.current = null;
          clearPaintRetouchStrokePreview();
        } else if (dodgeBurnActive) {
          setDodgeBurnActive(false);
          dodgeBurnDragRef.current = null;
          clearPaintRetouchStrokePreview();
        } else if (wetMixActive) {
          setWetMixActive(false);
          wetMixDragRef.current = null;
          clearPaintRetouchStrokePreview();
        } else if (liquifyActive) {
          setLiquifyActive(false);
          cancelLiquifyPointerSession();
        } else if (quickMaskActive) {
          // Esc = 취소(선택 원상 유지) — 완료는 Q 또는 패널 버튼.
          exitQuickMask();
        } else if (layerMaskPaintActive) {
          setLayerMaskPaintActive(false);
          layerMaskDragRef.current = null;
          clearLayerMaskDragPreview();
        } else if (filterMaskPaintActive) {
          setFilterMaskPaintActive(false);
          filterMaskDragRef.current = null;
          clearFilterMaskDragPreview();
        } else if (polyLassoSessionRef.current) {
          // 다각형 올가미 초안만 먼저 취소 — 다음 Esc 가 도구/완성 선택을 해제한다.
          e.preventDefault();
          clearPolyLassoDraft();
        } else if (pixelTool || pixelSel) {
          // 픽셀 선택 도구/영역을 먼저 해제 — 다음 Esc 가 요소 선택을 해제한다.
          setPixelTool(null);
          commitPixelSelectionState(null, "clear");
          clearPolyLassoDraft();
        } else if (activeGroupIdRef.current) {
          // 그룹 진입 중이면 Esc 는 한 단계 위로: 진입을 해제하고 그룹 전체를 다시 선택한다(Figma 관례).
          e.preventDefault();
          const stepUp = planGroupEscape({
            items: elements,
            current: {
              selectedId: selectedIdRef.current,
              marqueeIds: marqueeIdsRef.current,
              activeGroupId: activeGroupIdRef.current,
            },
          });
          if (stepUp) {
            applyGroupSelectionState(stepUp);
            announceDrawingShortcut("그룹 내부 편집 종료 · 그룹 전체 선택");
          }
          else {
            applyGroupSelectionState({
              selectedId: null,
              marqueeIds: [],
              activeGroupId: null,
            });
          }
        } else {
          setSelectedId(null);
          setMarqueeIds([]);
        }
      } else if (
        !mod &&
        !e.altKey &&
        !e.shiftKey &&
        !e.repeat &&
        e.key === "Enter" &&
        polyLassoSessionRef.current &&
        !(e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable=true]"))
      ) {
        e.preventDefault();
        finishPolyLassoSession();
      } else if (
        !mod &&
        !e.altKey &&
        !e.shiftKey &&
        !e.repeat &&
        e.key === "Enter" &&
        !(e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable=true]"))
      ) {
        if (enterCompleteSelectedGroup()) e.preventDefault();
      } else if (mod && e.altKey && (e.key === "g" || e.key === "G" || e.key === "ㅎ")) {
        // Photoshop / ClipStudio / Figma: ⌥⌘G (Alt+Cmd+G / Alt+Ctrl+G) = 클리핑 마스크 토글
        e.preventDefault();
        if (selected) {
          const nextClip = !(selected as El & { clipToBelow?: boolean }).clipToBelow;
          patchEl(selected.id, { clipToBelow: nextClip } as Partial<El>);
          announceDrawingShortcut(nextClip ? "아래 레이어에 클리핑 마스크 적용 (Alt+Cmd+G)" : "클리핑 마스크 해제");
        }
      } else if (mod && e.altKey && (e.key === "r" || e.key === "R" || e.key === "ㄱ")) {
        // Photoshop / CSP / Figma: ⌥⌘R (Alt+Cmd+R) = 캔버스 눈금자(Rulers) 표시/숨기기 토글
        e.preventDefault();
        toggleCanvasRulers();
      } else if (mod && !e.altKey && (e.key === "g" || e.key === "G")) {
        // Figma/Illustrator/ClipStudio: ⌘G = 그룹 생성, ⇧⌘G = 그룹 해제
        e.preventDefault();
        if (e.shiftKey) {
          ungroupSelectedElements();
        } else {
          if (marqueeIdsRef.current.length >= 2) {
            groupSelectedElements();
          } else if (selectedIdRef.current) {
            if (addLayerGroup(selectedIdRef.current)) {
              announceDrawingShortcut("그룹 생성 완료");
            }
          }
        }
      } else if ((selectedId || marqueeIds.length > 0) && e.key.startsWith("Arrow")) {
        // 방향키 미세이동: 1px, Shift 동반 시 10px.
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        if (e.key === "ArrowLeft") nudgeSelected(-step, 0);
        else if (e.key === "ArrowRight") nudgeSelected(step, 0);
        else if (e.key === "ArrowUp") nudgeSelected(0, -step);
        else if (e.key === "ArrowDown") nudgeSelected(0, step);
      }
  };
}
