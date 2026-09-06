import { useEffect, useMemo, useState } from "react";

import { adjustStudioBrushSize } from "./brush/studio-draw-ux";
import {
  STUDIO_SUB_TOOL_PALETTE_DEFAULT_CATEGORY_ID,
  studioSubToolPaletteCategoryIdForBrushId,
} from "./brush/studio-sub-tool-palette-data";
import { STUDIO_LAYER_BORDER_EFFECT_OPEN_EVENT } from "./layer/studio-layer-border-effect";
import { summarizeStudioRasterPreparationSources } from "./render/studio-raster-edit-preparation";
import {
  resolveStudioRasterToolAvailability,
  type StudioRasterToolAvailabilityContext,
} from "./render/studio-raster-tool-availability";
import { localizeStudioInspectorRasterPolicy } from "./render/studio-raster-tool-reason-localization";
import { CANVAS_W } from "./studio-assets";
import { BRUSH_PRESETS } from "./studio-brush";
import { isCropRectNoop } from "./studio-crop";
import {
  resolveStudioInspectorContentMode,
  resolveStudioInspectorInteractionPolicy,
} from "./studio-inspector-interaction-policy";
import type { StudioImageInspectorSection } from "./studio-inspector-layout";
import { resolveStudioInspectorRasterToolPolicy } from "./studio-inspector-raster-tool-policy";
import {
  studioInspectorTransientOwners,
  type StudioInspectorTransientState,
} from "./studio-inspector-tool-transition";
import {
  isEffectivelyHidden,
  isEffectivelyLocked,
} from "./studio-layers";
import { isPuppetWarpNoop } from "./studio-puppet-warp";
import { isSelectionUsable } from "./studio-selection-tools";
import type {
  StudioInspectorAsideHandlers,
  StudioInspectorAsideProps,
} from "./StudioInspectorAsideTypes";
import type {
  StudioInspectorPixelSelectionToolId,
  StudioRasterRecoveryRequest,
} from "./StudioRasterToolRecoveryPanel";
import { useStudioRasterSourcePresentation } from "./use-studio-raster-source-presentation";

import type { El, ImageEl } from "./studio-element-model";

import { useT } from "@/shared/lib/i18n";

export type StudioInspectorAsideModel = StudioInspectorAsideProps &
  StudioInspectorAsideHandlers & {
    t: ReturnType<typeof useT>;
    selectedReadableImageSource: string | null;
    inspectorContentMode: ReturnType<typeof resolveStudioInspectorContentMode>;
    inspectorDrawing: boolean;
    selectedSupportsImageInspectorTabs: boolean;
    unselectedImageToolsVisible: boolean;
    setUnselectedImageToolsVisible: import("react").Dispatch<
      import("react").SetStateAction<boolean>
    >;
    activeImageInspectorTab: StudioImageInspectorSection | null;
    imageInspectorRouteWithoutImageSelection: boolean;
    inspectorTransientState: StudioInspectorTransientState;
    inspectorTransientOwners: ReturnType<typeof studioInspectorTransientOwners>;
    inspectorInteractionPolicy: ReturnType<typeof resolveStudioInspectorInteractionPolicy>;
    pathBooleanInspectorUnavailableReason: string | null | undefined;
    activeInspectorPixelSelectionTool: StudioInspectorPixelSelectionToolId | null;
    rasterAvailability: (
      id: Parameters<typeof resolveStudioRasterToolAvailability>[0],
      busy?: boolean,
    ) => ReturnType<typeof resolveStudioRasterToolAvailability>;
    rasterAvailabilityForTab: (
      tab: StudioImageInspectorSection,
    ) => ReturnType<typeof resolveStudioRasterToolAvailability>[];
    activeImageRasterPolicy: ReturnType<typeof localizeStudioInspectorRasterPolicy> | null;
    handleRasterRecovery: (request: StudioRasterRecoveryRequest) => void;
    shouldMountImageInspectorTab: (tab: StudioImageInspectorSection) => boolean;
    activeInspectorBrushId: string;
    activeInspectorBrushName: string;
    subToolPaletteCategory: string;
    canvasControlsDisabled: boolean;
    drawingAssistControlsDisabled: boolean;
    drawingAssistDisabledReason: string | null | undefined;
    rightPanelDisabledReasons: readonly string[];
    withCanvasControlsGuard: <TArgs extends readonly unknown[]>(
      callback: (...args: TArgs) => void,
    ) => (...args: TArgs) => void;
    commitBrushSizePreset: (size: number) => void;
    rememberRecentBrushSize: (size: number) => void;
    recentBrushSizes: readonly number[];
    setSubToolPaletteBrowsedCategory: import("react").Dispatch<
      import("react").SetStateAction<string | null>
    >;
    safeMobileKeyboardInset: number;
  };

export function useStudioInspectorAsideModel(
  props: StudioInspectorAsideProps,
): StudioInspectorAsideModel {
  const {
    activeSurfaceReviewLocked,
    advancedFillActive,
    advancedFillBusy,
    advancedFillPreview,
    autoColorScribbleCanvasArmed,
    bg,
    bgGrad,
    brush,
    bubbleAnchorPickActive,
    bubbleShapeEditActive,
    canvasH,
    collaborationDocumentLocked,
    colorRangePickActive,
    cropBusy,
    cropRect,
    currentBrushSnapshot,
    dodgeBurnActive,
    dodgeBurnBusy,
    drawMode,
    elementById,
    elements,
    eyedropperActive,
    filterMaskBusy,
    filterMaskPaintActive,
    groups,
    healCloneBusy,
    healCloneSourceAnchor,
    healCloneTool,
    historyBrushActive,
    historyBrushSourceSrc,
    inspectorLayout,
    layerMaskBusy,
    layerMaskPaintActive,
    liquifyActive,
    liquifyBusy,
    localHiddenElementIds,
    marqueeIds,
    masterEditMode,
    mobileKeyboardInset,
    nodeEditTool,
    panelSplitActive,
    pathBooleanUnavailableReason,
    pixelBusy,
    pixelForceCircle,
    pixelSel,
    pixelTool,
    polyLassoSession,
    puppetWarpActive,
    puppetWarpBusy,
    puppetWarpPins,
    quickMaskActive,
    quickShapeActive,
    saving,
    selected,
    selectedContentMutationLocked,
    selectedRasterSource,
    selectedWorkAssetDestructiveEditReason,
    setHealCloneTool,
    setHistoryPanelOpen,
    setPixelForceCircle,
    setPixelTool,
    setStrokeWidth,
    setTool,
    smudgeActive,
    smudgeBusy,
    stableHandlers,
    studioFilterPreparationBusy,
    timelinePlaying,
    tool,
    webtoonTheme,
    wetMixActive,
    wetMixBusy,
  } = props;
  const {
    announceDrawingShortcut,
    changeInspectorLayout,
    createEditableRasterCopyForInspector,
    disarmAllPixelTools,
    openImagePastePicker,
    patchEl,
    selectLayersFromNavigator,
    stopTimeline,
    toggleLocalHidden,
  } = stableHandlers;
  const t = useT(); // 래스터 도구 사유·라벨을 화면 경계에서 로케일로 옮길 때 쓴다.
  const selectedRasterPresentation = useStudioRasterSourcePresentation(
    selectedRasterSource,
    { consumer: "studio-inspector-selected-image" },
  );
  const selectedReadableImageSource = selectedRasterPresentation.src;
  const [activatedImageInspectorTabs, setActivatedImageInspectorTabs] = useState<
    ReadonlySet<StudioImageInspectorSection>
  >(() => new Set());
  // 서브 도구 팔레트의 "탐색 중" 탭. 적용된 브러시의 분류와 별개로, 아티스트가 다른 탭을
  // 둘러보는 상태만 기억한다(적용 자체는 activateCanvasTool + applyBuiltInBrushPreset 경유).
  const [subToolPaletteBrowsedCategory, setSubToolPaletteBrowsedCategory] = useState<
    string | null
  >(null);
  // CSP식 크기 프리셋 그리드의 "최근 크기" — 슬라이더/그리드 커밋의 마지막 고유값만
  // 컴포넌트 상태로 기억한다(별도 영속화 없음). 표시 개수 제한은 그리드가 담당한다.
  const [recentBrushSizes, setRecentBrushSizes] = useState<readonly number[]>([]);
  const [unselectedImageToolsVisible, setUnselectedImageToolsVisible] = useState(false);
  const rememberRecentBrushSize = (size: number) => {
    const next = adjustStudioBrushSize(size, 0);
    setRecentBrushSizes((prev) =>
      prev[0] === next ? prev : [next, ...prev.filter((s) => s !== next)].slice(0, 8)
    );
  };
  const commitBrushSizePreset = (size: number) => {
    const next = adjustStudioBrushSize(size, 0);
    setStrokeWidth(next);
    rememberRecentBrushSize(next);
  };
  const safeMobileKeyboardInset = Number.isFinite(mobileKeyboardInset)
    ? Math.max(0, Math.round(mobileKeyboardInset))
    : 0;
  const inspectorContentMode = resolveStudioInspectorContentMode({
    tool,
    hasSelection: selected !== null || marqueeIds.length > 0,
  });
  const inspectorDrawing = inspectorContentMode === "drawing";
  const selectedSupportsImageInspectorTabs =
    !inspectorDrawing && (selected?.type === "image" || selected?.type === "draw");
  const activeImageInspectorTab =
    inspectorLayout.primary === "properties" && !inspectorDrawing
      ? inspectorLayout.image
      : null;
  const imageInspectorRouteWithoutImageSelection =
    activeImageInspectorTab !== null &&
    !selectedSupportsImageInspectorTabs &&
    unselectedImageToolsVisible;

  // Keep an explicitly opened image workspace visible while the artist inspects a text/frame
  // selection: its recovery surface explains how to choose or prepare a raster target. Starting a
  // drawing tool is the context switch that closes that workspace; the visible "시작 안내" action
  // remains the direct way to close it without changing tools.
  useEffect(() => {
    if (inspectorDrawing) setUnselectedImageToolsVisible(false);
  }, [inspectorDrawing]);
  const inspectorTransientState: StudioInspectorTransientState = {
    advancedFillActive,
    advancedFillBusy,
    advancedFillPreviewActive: advancedFillPreview !== null,
    autoColorScribbleArmed: autoColorScribbleCanvasArmed ?? false,
    pixelToolActive: pixelTool !== null,
    polyLassoSessionActive: polyLassoSession !== null,
    colorRangePickActive,
    quickMaskActive,
    smudgeActive,
    dodgeBurnActive,
    wetMixActive,
    liquifyActive,
    healCloneActive: healCloneTool !== null,
    historyBrushActive,
    layerMaskPaintActive,
    filterMaskPaintActive,
    cropActive: cropRect !== null,
    puppetWarpActive,
    eyedropperActive,
    quickShapeActive,
    nodeEditActive: nodeEditTool !== null,
    bubbleAnchorPickActive,
    bubbleShapeEditActive,
    panelSplitActive,
  };
  const inspectorTransientOwners =
    studioInspectorTransientOwners(inspectorTransientState);
  const inspectorInteractionPolicy = resolveStudioInspectorInteractionPolicy({
    saving,
    collaborationDocumentLocked,
    activeSurfaceReviewLocked,
    selectedContentMutationLocked,
    masterEditMode,
  });
  const marqueeSelectionMutationLocked = marqueeIds.some((id) => {
    const element = elementById.get(id);
    return element ? isEffectivelyLocked(element, groups) : false;
  });
  const pathBooleanInspectorUnavailableReason =
    inspectorInteractionPolicy.global.reason ??
    (marqueeSelectionMutationLocked
      ? "선택한 도형 레이어의 잠금을 해제한 뒤 결합할 수 있어요."
      : pathBooleanUnavailableReason);
  const normalizedPageBackground = bg.trim().toLowerCase();
  const hasAuthoredPageBackground =
    (bgGrad?.length ?? 0) > 0 ||
    ![
      "",
      "#fff",
      "#ffffff",
      "rgb(255, 255, 255)",
      "rgba(255, 255, 255, 1)",
      "transparent",
      "white",
    ].includes(normalizedPageBackground);
  const rasterPreparationSummary = useMemo(() => {
    if (inspectorDrawing || inspectorLayout.primary !== "properties") return null;
    return summarizeStudioRasterPreparationSources({
      width: CANVAS_W,
      height: canvasH,
      elements,
      groups,
      theme: webtoonTheme,
      bg,
      bgGrad,
      hasPageBackground: hasAuthoredPageBackground,
    });
  }, [
    bg,
    bgGrad,
    canvasH,
    elements,
    groups,
    hasAuthoredPageBackground,
    inspectorDrawing,
    inspectorLayout.primary,
    webtoonTheme,
  ]);
  const rasterDocumentMutationBlockedReason =
    inspectorInteractionPolicy.page.reason ||
    (selected?.type !== "image"
      ? inspectorInteractionPolicy.selection.reason
      : undefined) ||
    (selected?.type !== "image" && localHiddenElementIds.size > 0
      ? "‘나만 숨기기’ 레이어를 다시 표시한 뒤 페이지 합성 복사본을 만들 수 있어요."
      : null);
  const selectedRasterAnimated =
    selected?.type === "image" &&
    (selected.isAnimatedGif || (selected.frames?.length ?? 0) > 1);
  const rasterToolContext: StudioRasterToolAvailabilityContext = {
    documentMutationBlockedReason: rasterDocumentMutationBlockedReason,
    timelinePlaying,
    selectedType: selected?.type ?? null,
    selectedHidden: selected
      ? localHiddenElementIds.has(selected.id) || isEffectivelyHidden(selected, groups)
      : false,
    selectedMutationBlockedReason:
      selected?.type === "image"
        ? selectedWorkAssetDestructiveEditReason ??
          inspectorInteractionPolicy.selection.reason ??
          null
        : null,
    selectedMutationRecovery: selectedWorkAssetDestructiveEditReason ? "copy" : "unlock",
    selectedAnimated: selectedRasterAnimated,
    visibleEditableRasterCount: rasterPreparationSummary?.visibleUnlockedRasterCount ?? 0,
    visibleVectorDrawCount: rasterPreparationSummary?.visibleVectorDrawCount ?? 0,
    exactRenderableVisibleCount: rasterPreparationSummary?.exactRenderableVisibleCount ?? 0,
    unsupportedVisibleCount: rasterPreparationSummary?.unsupportedVisibleCount ?? 0,
    hiddenContentCount:
      (rasterPreparationSummary?.hiddenContentCount ?? 0) + localHiddenElementIds.size,
    hasPageBackground: rasterPreparationSummary?.hasPageBackground ?? true,
    hasPixelSelection: isSelectionUsable(pixelSel),
    hasCloneSource: healCloneSourceAnchor !== null,
    hasHistorySource: historyBrushSourceSrc !== null,
    hasPuppetDisplacement: !isPuppetWarpNoop(puppetWarpPins),
    hasCropChange: cropRect !== null && !isCropRectNoop(cropRect),
  };
  const lockedCompositeSourceReason =
    (rasterPreparationSummary?.lockedVisibleSourceIds.length ?? 0) > 0
      ? "페이지 합성본으로 바꿀 표시 레이어 중 잠긴 레이어가 있습니다. 해당 레이어의 잠금을 해제한 뒤 다시 시도하세요."
      : null;
  const activeInspectorPixelSelectionTool: StudioInspectorPixelSelectionToolId | null =
    colorRangePickActive
      ? "color-range"
      : pixelTool === "ellipse"
        ? pixelForceCircle
          ? "circle"
          : "ellipse"
        : pixelTool;
  const rasterAvailability = (
    id: Parameters<typeof resolveStudioRasterToolAvailability>[0],
    busy = false,
  ) =>
    resolveStudioRasterToolAvailability(id, {
      ...rasterToolContext,
      documentMutationBlockedReason:
        rasterToolContext.documentMutationBlockedReason ??
        (id === "filter" || id === "paint-bucket"
          ? null
          : lockedCompositeSourceReason),
      busy,
    });
  const rasterAvailabilityForTab = (
    tab: StudioImageInspectorSection,
  ) => {
    switch (tab) {
      case "quick":
        return [rasterAvailability("filter", studioFilterPreparationBusy)];
      case "fill":
        return [rasterAvailability("paint-bucket", advancedFillBusy)];
      case "retouch":
        return [
          rasterAvailability("pixel-marquee", pixelBusy),
          rasterAvailability("smudge", smudgeBusy),
          rasterAvailability("dodge-burn", dodgeBurnBusy),
          rasterAvailability("wet-mix", wetMixBusy),
          rasterAvailability("liquify", liquifyBusy),
          rasterAvailability("heal", healCloneBusy),
        ];
      case "mask":
        return [rasterAvailability("layer-mask", layerMaskBusy || filterMaskBusy)];
      case "transform":
        return [
          rasterAvailability("crop", cropBusy),
          rasterAvailability("pixel-transform", pixelBusy),
          rasterAvailability("puppet-warp", puppetWarpBusy),
      ];
    }
  };
  const activeImageRasterAvailability = activeImageInspectorTab
    ? rasterAvailabilityForTab(activeImageInspectorTab)[0]
    : null;
  // 사유·라벨은 저자형 한국어로 만들고 **화면 경계에서만** 옮긴다(필터 사유와 같은 관례) — 한국어이거나 표에 없으면 원문 그대로.
  const activeImageRasterPolicy = activeImageRasterAvailability
    ? localizeStudioInspectorRasterPolicy(
        resolveStudioInspectorRasterToolPolicy(activeImageRasterAvailability),
        t,
      )
    : null;
  const editableRasterCandidates = elements.filter(
    (element): element is ImageEl =>
      element.type === "image" &&
      !localHiddenElementIds.has(element.id) &&
      !isEffectivelyHidden(element, groups) &&
      !isEffectivelyLocked(element, groups),
  );
  const handleRasterRecovery = (request: StudioRasterRecoveryRequest): void => {
    switch (request.action.id) {
      case "select-only-raster-layer": {
        if (editableRasterCandidates.length === 1) {
          selectLayersFromNavigator([editableRasterCandidates[0]!.id]);
          announceDrawingShortcut(`${request.toolId} 대상 이미지 레이어를 선택했어요`);
          return;
        }
        disarmAllPixelTools();
        changeInspectorLayout({ ...inspectorLayout, primary: "layers" });
        return;
      }
      case "select-raster-layer":
      case "show-hidden-layers":
      case "resolve-document-lock":
        disarmAllPixelTools();
        changeInspectorLayout({ ...inspectorLayout, primary: "layers" });
        return;
      case "show-selected-layer":
        if (selected && localHiddenElementIds.has(selected.id)) {
          toggleLocalHidden(selected.id);
          announceDrawingShortcut("나만 숨긴 선택 레이어를 다시 표시했어요");
          return;
        }
        if (selected && selected.hidden === true) {
          patchEl(selected.id, { hidden: false } as Partial<El>);
          announceDrawingShortcut("선택 레이어를 표시했어요");
          return;
        }
        disarmAllPixelTools();
        changeInspectorLayout({ ...inspectorLayout, primary: "layers" });
        return;
      case "unlock-selected-layer":
        if (selected && selected.locked === true) {
          patchEl(selected.id, { locked: false } as Partial<El>);
          announceDrawingShortcut("선택 레이어 잠금을 해제했어요");
          return;
        }
        disarmAllPixelTools();
        changeInspectorLayout({ ...inspectorLayout, primary: "layers" });
        return;
      case "create-editable-raster-copy":
      case "create-selected-static-copy":
        void createEditableRasterCopyForInspector(request.toolId);
        return;
      case "add-or-import-content":
        openImagePastePicker();
        return;
      case "stop-timeline":
        stopTimeline();
        return;
      case "make-pixel-selection":
        disarmAllPixelTools();
        setTool("select");
        setPixelForceCircle(false);
        setPixelTool("rect");
        changeInspectorLayout({ ...inspectorLayout, primary: "properties", image: "retouch" });
        return;
      case "pick-clone-source":
        disarmAllPixelTools();
        setTool("select");
        setHealCloneTool("clone");
        changeInspectorLayout({ ...inspectorLayout, primary: "properties", image: "retouch" });
        return;
      case "pick-history-source":
        setHistoryPanelOpen(true);
        return;
      case "move-puppet-pin":
      case "adjust-crop-area":
        changeInspectorLayout({ ...inspectorLayout, primary: "properties", image: "transform" });
        return;
      case "retry-when-idle":
        announceDrawingShortcut("현재 작업이 끝나면 같은 도구를 다시 눌러 주세요");
        return;
    }
  };

  useEffect(() => {
    if (!activeImageInspectorTab) return;
    setActivatedImageInspectorTabs((current) => {
      if (current.has(activeImageInspectorTab)) return current;
      const next = new Set(current);
      next.add(activeImageInspectorTab);
      return next;
    });
  }, [activeImageInspectorTab]);

  // 메뉴 '레이어 ▸ 경계 효과…'의 열기 신호 — 호스트 시임(StudioPage) 없이
  // studio-companion-add-text와 같은 창 이벤트 브리지로 받아 레이어 탭을 연다(2026-08-20).
  useEffect(() => {
    const openLayerBorderEffectPanel = () => {
      changeInspectorLayout({ ...inspectorLayout, primary: "layers" });
    };
    window.addEventListener(STUDIO_LAYER_BORDER_EFFECT_OPEN_EVENT, openLayerBorderEffectPanel);
    return () => {
      window.removeEventListener(STUDIO_LAYER_BORDER_EFFECT_OPEN_EVENT, openLayerBorderEffectPanel);
    };
  }, [inspectorLayout, changeInspectorLayout]);

  const shouldMountImageInspectorTab = (tab: StudioImageInspectorSection) =>
    activeImageInspectorTab === tab || activatedImageInspectorTabs.has(tab);
  const activeInspectorBrushId = currentBrushSnapshot.sourcePresetId ?? brush;
  const activeInspectorBrushName =
    currentBrushSnapshot.sourcePresetName
    ?? BRUSH_PRESETS.find((preset) => preset.id === brush)?.name
    ?? brush;
  // 표시 중인 서브 도구 탭 — 탐색 중이면 그 탭, 아니면 적용된 브러시의 소속 분류,
  // 팔레트 밖 브러시면 지우개 모드에 한해 지우개 탭, 그 외엔 기본 탭.
  const subToolPaletteCategory =
    subToolPaletteBrowsedCategory
    ?? studioSubToolPaletteCategoryIdForBrushId(activeInspectorBrushId)
    ?? (drawMode === "eraser" ? "eraser" : STUDIO_SUB_TOOL_PALETTE_DEFAULT_CATEGORY_ID);
  const canvasControlsDisabled = inspectorInteractionPolicy.page.disabled;
  const drawingAssistControlsDisabled = inspectorInteractionPolicy.page.disabled;
  const drawingAssistDisabledReason = inspectorInteractionPolicy.page.reason;
  const rightPanelDisabledReasons = inspectorInteractionPolicy.reasons;
  const withCanvasControlsGuard = <TArgs extends readonly unknown[]>(callback: (...args: TArgs) => void) =>
    (...args: TArgs) => {
      if (canvasControlsDisabled) return;
      callback(...args);
    };
  return {
    ...props,
    ...stableHandlers,
    t,
    selectedReadableImageSource,
    inspectorContentMode,
    inspectorDrawing,
    selectedSupportsImageInspectorTabs,
    unselectedImageToolsVisible,
    setUnselectedImageToolsVisible,
    activeImageInspectorTab,
    imageInspectorRouteWithoutImageSelection,
    inspectorTransientState,
    inspectorTransientOwners,
    inspectorInteractionPolicy,
    pathBooleanInspectorUnavailableReason,
    activeInspectorPixelSelectionTool,
    rasterAvailability,
    rasterAvailabilityForTab,
    activeImageRasterPolicy,
    handleRasterRecovery,
    shouldMountImageInspectorTab,
    activeInspectorBrushId,
    activeInspectorBrushName,
    subToolPaletteCategory,
    canvasControlsDisabled,
    drawingAssistControlsDisabled,
    drawingAssistDisabledReason,
    rightPanelDisabledReasons,
    withCanvasControlsGuard,
    commitBrushSizePreset,
    rememberRecentBrushSize,
    recentBrushSizes,
    setSubToolPaletteBrowsedCategory,
    safeMobileKeyboardInset,
  };
}
