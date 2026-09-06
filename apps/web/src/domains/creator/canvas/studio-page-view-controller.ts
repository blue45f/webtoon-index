
import { CANVAS_W } from "../studio-assets";
import {
  planStudioZoomToSelection,
  selectStudioFigmaDesignTargets,
  unionStudioSelectionBounds,
} from "../studio-figma-selection-ux";
import { uid } from "../studio-id";
import { addVanishingPoint, defaultVanishingPointPosition } from "../studio-perspective-guide";
import {
  captureStudioView,
  fitStudioViewToWidth,
  planStudioViewRestore,
  planStudioViewRotationTransition,
  rotateStudioViewLeft,
  rotateStudioViewRight,
  type StudioViewRotation,
  type StudioViewSnapshot,
} from "../studio-view-controls";

import type { StudioDrawingAssistDocument } from "../brush/studio-drawing-assist-document";
import type { Tool } from "../studio-editor-tool-model";
import type { El } from "../studio-element-model";
import type { PageState } from "../studio-page-state";
import type { CvdMode } from "../StudioColorBlindPreview";
import type { StudioZoomGestureState } from "./studio-zoom-gesture-engine";
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";

export interface UseStudioPageViewControlsOptions {
  readonly viewTransformSuppressed: boolean;
  readonly viewTransformSuppressedRef: MutableRefObject<boolean>;
  readonly zoomLockedRef: RefObject<boolean>;
  readonly wrapRef: RefObject<HTMLDivElement | null>;
  readonly isFullscreen: boolean;
  readonly maximized: boolean;
  readonly mobileImmersive: boolean;
  readonly canvasOnlyMode: boolean;
  readonly activePage: PageState;
  readonly scale: number;
  readonly setScale: (scale: number) => void;
  readonly zoom: number;
  readonly setZoom: (zoom: number) => void;
  readonly effScale: number;
  readonly canvasH: number;
  readonly canvasFlipH: boolean;
  readonly setCanvasFlipH: Dispatch<SetStateAction<boolean>>;
  readonly canvasRotation: StudioViewRotation;
  readonly setCanvasRotation: (rotation: StudioViewRotation) => void;
  readonly pendingCanvasRotationScrollRef: MutableRefObject<{ scrollLeft: number; scrollTop: number } | null>;
  readonly captureSuppressedViewRef: MutableRefObject<StudioViewSnapshot | null>;
  readonly savedStudioView: StudioViewSnapshot | null;
  readonly setSavedStudioView: (snapshot: StudioViewSnapshot | null) => void;
  readonly colorPreviewBeforeGrayscaleRef: MutableRefObject<CvdMode>;
  readonly setColorBlindPreview: Dispatch<SetStateAction<CvdMode>>;
  readonly announceDrawingShortcut: (text: string) => void;
  readonly currentStudioDrawingAssistDocument: () => {
    document: StudioDrawingAssistDocument;
    page: PageState;
  } | null;
  readonly commitStudioDrawingAssistDocument: (
    updater: (doc: StudioDrawingAssistDocument) => StudioDrawingAssistDocument,
  ) => boolean;
  readonly setTool: (tool: Tool) => void;
  readonly elements: El[];
  readonly marqueeIds: string[];
  readonly selected: El | null;
  readonly studioViewDocumentWidth: number;
  readonly zoomGestureRef?: RefObject<StudioZoomGestureState | null>;
  readonly zoomHostRef?: RefObject<HTMLDivElement | null>;
  readonly zoomSettleAnchorRef?: MutableRefObject<unknown>;
}

export function useStudioPageViewControls({
  viewTransformSuppressed,
  viewTransformSuppressedRef,
  zoomLockedRef,
  wrapRef,
  isFullscreen,
  maximized,
  mobileImmersive,
  canvasOnlyMode,
  activePage,
  scale,
  setScale,
  zoom,
  setZoom,
  effScale,
  canvasH,
  canvasFlipH,
  setCanvasFlipH,
  canvasRotation,
  setCanvasRotation,
  pendingCanvasRotationScrollRef,
  captureSuppressedViewRef,
  savedStudioView,
  setSavedStudioView,
  colorPreviewBeforeGrayscaleRef,
  setColorBlindPreview,
  announceDrawingShortcut,
  currentStudioDrawingAssistDocument,
  commitStudioDrawingAssistDocument,
  setTool,
  elements,
  marqueeIds,
  selected,
  studioViewDocumentWidth,
  zoomGestureRef,
  zoomHostRef,
  zoomSettleAnchorRef,
}: UseStudioPageViewControlsOptions) {
  function fitCanvasToWidth() {
    if (viewTransformSuppressed || zoomLockedRef.current) return;
    const wrap = wrapRef.current;
    const maximumScale = isFullscreen || maximized || mobileImmersive || canvasOnlyMode ? 4 : 2.5;
    if (wrap) setScale(fitStudioViewToWidth(wrap.clientWidth, studioViewDocumentWidth, maximumScale));
    setZoom(1);
  }

  function preserveStudioViewBeforeCapture() {
    if (viewTransformSuppressed || captureSuppressedViewRef.current) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    captureSuppressedViewRef.current = captureStudioView({
      pageId: activePage.id,
      scale,
      zoom,
      scrollLeft: wrap.scrollLeft,
      scrollTop: wrap.scrollTop,
      viewportWidth: wrap.clientWidth,
      viewportHeight: wrap.clientHeight,
      canvasWidth: CANVAS_W,
      canvasHeight: canvasH,
      canvasFlipH,
      canvasRotation,
    });
    viewTransformSuppressedRef.current = true;
  }

  function resetView() {
    if (viewTransformSuppressed || zoomLockedRef.current) return;
    const wrap = wrapRef.current;
    if (wrap) {
      const maximumScale = isFullscreen || maximized || mobileImmersive || canvasOnlyMode ? 4 : 2.5;
      setScale(fitStudioViewToWidth(wrap.clientWidth, CANVAS_W, maximumScale));
      wrap.scrollLeft = 0;
      wrap.scrollTop = 0;
    }
    setZoom(1);
    setCanvasFlipH(false);
    pendingCanvasRotationScrollRef.current = null;
    setCanvasRotation(0);
  }

  function setActualPixelView() {
    if (viewTransformSuppressed || zoomLockedRef.current) return;
    setScale(1);
    setZoom(1);
  }

  function toggleHorizontalCanvasView() {
    if (viewTransformSuppressed) return;
    setCanvasFlipH((current) => {
      const next = !current;
      announceDrawingShortcut(next ? "캔버스 좌우 반전" : "캔버스 반전 해제");
      return next;
    });
  }

  function setCanvasViewRotationPreservingCenter(next: StudioViewRotation) {
    if (viewTransformSuppressed) return;
    if (next === canvasRotation) {
      pendingCanvasRotationScrollRef.current = null;
      return;
    }
    const wrap = wrapRef.current;
    pendingCanvasRotationScrollRef.current = wrap
      ? planStudioViewRotationTransition({
          documentWidth: CANVAS_W,
          documentHeight: canvasH,
          canvasFlipH,
          canvasRotation,
          nextCanvasRotation: next,
          scale: effScale,
          scrollLeft: wrap.scrollLeft,
          scrollTop: wrap.scrollTop,
          viewportWidth: wrap.clientWidth,
          viewportHeight: wrap.clientHeight,
        })
      : null;
    setCanvasRotation(next);
  }

  function rotateCanvasView(direction: "left" | "right") {
    const next = direction === "left"
      ? rotateStudioViewLeft(canvasRotation)
      : rotateStudioViewRight(canvasRotation);
    setCanvasViewRotationPreservingCenter(next);
    announceDrawingShortcut(`캔버스 ${direction === "left" ? "왼쪽" : "오른쪽"} 회전 · ${next}°`);
  }

  function resetCanvasViewRotation() {
    setCanvasViewRotationPreservingCenter(0);
    announceDrawingShortcut("보기 회전 초기화");
  }

  function toggleGrayscaleView() {
    setColorBlindPreview((current) => {
      const next = current === "grayscale"
        ? colorPreviewBeforeGrayscaleRef.current
        : "grayscale";
      announceDrawingShortcut(next === "grayscale" ? "흑백 보기" : "흑백 보기 해제");
      return next;
    });
  }

  function saveCurrentStudioView() {
    if (viewTransformSuppressed) return;
    const wrap = wrapRef.current;
    if (!wrap) {
      announceDrawingShortcut("현재 보기를 저장할 수 없습니다");
      return;
    }
    setSavedStudioView(captureStudioView({
      pageId: activePage.id,
      scale,
      zoom,
      scrollLeft: wrap.scrollLeft,
      scrollTop: wrap.scrollTop,
      viewportWidth: wrap.clientWidth,
      viewportHeight: wrap.clientHeight,
      canvasWidth: CANVAS_W,
      canvasHeight: canvasH,
      canvasFlipH,
      canvasRotation,
    }));
    announceDrawingShortcut("현재 보기 저장");
  }

  function restoreSavedStudioView() {
    if (viewTransformSuppressed || zoomLockedRef.current) return;
    const wrap = wrapRef.current;
    if (!savedStudioView || !wrap) {
      announceDrawingShortcut("저장된 보기가 없습니다");
      return;
    }
    const initialPlan = planStudioViewRestore({
      snapshot: savedStudioView,
      pageId: activePage.id,
      viewportWidth: wrap.clientWidth,
      viewportHeight: wrap.clientHeight,
      canvasWidth: CANVAS_W,
      canvasHeight: canvasH,
    });
    if (!initialPlan) {
      announceDrawingShortcut("이 페이지에 저장된 보기가 없습니다");
      return;
    }

    setScale(initialPlan.scale);
    setZoom(initialPlan.zoom);
    setCanvasFlipH(initialPlan.canvasFlipH);
    setCanvasRotation(initialPlan.canvasRotation);
    const restoreScroll = () => {
      const currentWrap = wrapRef.current;
      if (!currentWrap) return;
      const plan = planStudioViewRestore({
        snapshot: savedStudioView,
        pageId: activePage.id,
        viewportWidth: currentWrap.clientWidth,
        viewportHeight: currentWrap.clientHeight,
        canvasWidth: CANVAS_W,
        canvasHeight: canvasH,
      });
      if (!plan) return;
      currentWrap.scrollLeft = plan.scrollLeft;
      currentWrap.scrollTop = plan.scrollTop;
    };
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(restoreScroll);
    } else {
      restoreScroll();
    }
    announceDrawingShortcut("보기 복원");
  }

  function togglePerspectiveGuideView() {
    const current = currentStudioDrawingAssistDocument();
    if (!current) return;
    const active = !current.document.perspective.active;
    const committed = commitStudioDrawingAssistDocument((document) => {
      let points = document.perspective.points;
      if (active && points.length === 0) {
        const position = defaultVanishingPointPosition(points, CANVAS_W, current.page.canvasH);
        points = addVanishingPoint(points, { id: uid(), x: position.x, y: position.y });
      }
      return {
        ...document,
        perspective: { ...document.perspective, active, points },
        isometric: active ? { ...document.isometric, active: false } : document.isometric,
      };
    });
    if (!committed) return;
    if (active) setTool("draw");
    announceDrawingShortcut(active ? "원근 도우미 표시" : "원근 도우미 숨김");
  }

  function zoomToSelection() {
    if (viewTransformSuppressed || zoomLockedRef.current) return;
    const selectedEls = selectStudioFigmaDesignTargets(elements, marqueeIds, selected);
    if (selectedEls.length === 0) {
      announceDrawingShortcut("확대할 요소를 먼저 선택하세요");
      return;
    }
    const bounds = unionStudioSelectionBounds(selectedEls);
    const wrap = wrapRef.current;
    if (!bounds || !wrap) return;
    const maximumScale = isFullscreen || maximized || mobileImmersive || canvasOnlyMode ? 4 : 2.5;
    const plan = planStudioZoomToSelection({
      bounds,
      viewportWidth: wrap.clientWidth,
      viewportHeight: wrap.clientHeight,
      documentWidth: CANVAS_W,
      documentHeight: canvasH,
      canvasFlipH,
      canvasRotation,
      maxScale: maximumScale,
      minScale: 0.15,
    });
    if (!plan) return;
    const pendingZoomGesture = zoomGestureRef?.current;
    if (pendingZoomGesture) {
      zoomGestureRef.current = null;
      if (pendingZoomGesture.raf) globalThis.cancelAnimationFrame(pendingZoomGesture.raf);
      if (pendingZoomGesture.settleTimer) globalThis.clearTimeout(pendingZoomGesture.settleTimer);
      if (zoomSettleAnchorRef) zoomSettleAnchorRef.current = null;
      const zoomHost = zoomHostRef?.current;
      if (zoomHost) {
        zoomHost.style.transform = "";
        zoomHost.style.willChange = "";
      }
    }
    setScale(plan.scale);
    setZoom(1);
    requestAnimationFrame(() => {
      const host = wrapRef.current;
      if (!host) return;
      host.scrollLeft = plan.scrollLeft;
      host.scrollTop = plan.scrollTop;
    });
    announceDrawingShortcut("선택 영역으로 확대 · ⇧F");
  }

  return {
    fitCanvasToWidth,
    preserveStudioViewBeforeCapture,
    resetView,
    setActualPixelView,
    toggleHorizontalCanvasView,
    setCanvasViewRotationPreservingCenter,
    rotateCanvasView,
    resetCanvasViewRotation,
    toggleGrayscaleView,
    saveCurrentStudioView,
    restoreSavedStudioView,
    togglePerspectiveGuideView,
    zoomToSelection,
  };
}
