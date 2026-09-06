import { loadStudioBackground3DModule } from "./studio-background-3d-loader";
import { createStudioIntentLazyLoader } from "./studio-intent-lazy-loader";

import type { StudioExportMenuPanelProps } from "./export/StudioExportMenuPanel";
import type { StudioAssetMenuPanelProps } from "./StudioAssetMenuPanel";
import type { StudioColorPopoverProps } from "./StudioColorPopover";
import type { StudioIntegrationsSettingsPanelProps } from "./StudioIntegrationsSettingsPanel";
import type { StudioStockImagePanelProps } from "./StudioStockImagePanel";
import type { ComponentType } from "react";

import { lazyRetry } from "@/shared/lib/lazy-retry";

/**
 * Optional Studio surfaces and user-triggered runtimes live in this explicit registry so
 * StudioPage stays focused on orchestration. Every feature keeps a literal import() boundary
 * for Vite/Rolldown analysis.
 */
const studioCaptureReadinessRuntimeLoader = createStudioIntentLazyLoader(
  () => import("./studio-capture-readiness")
);
const studioSavePayloadRuntimeLoader = createStudioIntentLazyLoader(
  () => import("./studio-save-payload")
);

function loadStudioCaptureReadinessRuntime() {
  return studioCaptureReadinessRuntimeLoader.load();
}

function preloadStudioCaptureReadinessRuntime(): void {
  studioCaptureReadinessRuntimeLoader.preload();
}

function loadStudioSavePayloadRuntime() {
  return studioSavePayloadRuntimeLoader.load();
}

function preloadStudioSavePayloadRuntime(): void {
  studioSavePayloadRuntimeLoader.preload();
}

const StudioPageThumbnail = lazyRetry(
  () => import("./StudioPageThumbnails").then((mod) => ({ default: mod.StudioPageThumbnail })),
  "StudioPageThumbnail"
);
const StudioWebGpuCanvas = lazyRetry(
  () => import("./StudioWebGpuCanvas").then((mod) => ({ default: mod.StudioWebGpuCanvas })),
  "StudioWebGpuCanvas"
);
const StudioCanonicalVNextDryMediaCanvas = lazyRetry(
  () => import("./StudioCanonicalVNextDryMediaCanvas").then((mod) => ({
    default: mod.StudioCanonicalVNextDryMediaCanvas,
  })),
  "StudioCanonicalVNextDryMediaCanvas"
);
const StudioRasterCrdtSurface = lazyRetry(
  () => import("./StudioRasterCrdtSurface").then((mod) => ({ default: mod.StudioRasterCrdtSurface })),
  "StudioRasterCrdtSurface"
);
const StudioPublishContextBanner = lazyRetry(
  () => import("./StudioPublishContextBanner").then((mod) => ({ default: mod.StudioPublishContextBanner })),
  "StudioPublishContextBanner"
);
const StudioContinuityMetadataEditor = lazyRetry(
  () => import("./StudioContinuityMetadataEditor").then((mod) => ({ default: mod.StudioContinuityMetadataEditor })),
  "StudioContinuityMetadataEditor"
);
const StudioUploadPublish = lazyRetry(
  () => import("./StudioUploadPublish").then((mod) => ({ default: mod.StudioUploadPublish })),
  "StudioUploadPublish"
);
const StudioLivePresenceDockConnected = lazyRetry(
  () => import("./live/StudioLiveCanvasOverlay").then((mod) => ({ default: mod.StudioLivePresenceDockConnected })),
  "StudioLivePresenceDockConnected"
);
const StudioRemoteCursorOverlay = lazyRetry(
  () => import("./live/StudioLiveCanvasOverlay").then((mod) => ({ default: mod.StudioRemoteCursorOverlay })),
  "StudioRemoteCursorOverlay"
);
const studioPointCommentComposerLoader = createStudioIntentLazyLoader(() =>
  import("./StudioPointCommentComposer").then((mod) => ({
    default: mod.StudioPointCommentComposer,
  }))
);
const StudioPointCommentComposer = lazyRetry(
  studioPointCommentComposerLoader.load,
  "StudioPointCommentComposer"
);
function preloadStudioPointCommentComposer(): void {
  studioPointCommentComposerLoader.preload();
}
const studioCommentThreadPopoverLoader = createStudioIntentLazyLoader(() =>
  import("./StudioCommentThreadPopover").then((mod) => ({
    default: mod.StudioCommentThreadPopover,
  }))
);
const StudioCommentThreadPopover = lazyRetry(
  studioCommentThreadPopoverLoader.load,
  "StudioCommentThreadPopover"
);
function preloadStudioCommentThreadPopover(): void {
  studioCommentThreadPopoverLoader.preload();
}
const StudioPageGradePanel = lazyRetry(
  () => import("./StudioPageGradePanel").then((mod) => ({ default: mod.StudioPageGradePanel })),
  "StudioPageGradePanel"
);
const StudioImageAdjustmentsPanel = lazyRetry(
  () => import("./StudioImageAdjustmentsPanel").then((mod) => ({ default: mod.StudioImageAdjustmentsPanel })),
  "StudioImageAdjustmentsPanel"
);
const studioFilterDialogLoader = createStudioIntentLazyLoader(() =>
  import( "./filter/StudioFilterDialog").then((mod) => ({ default: mod.StudioFilterDialog }))
);
const StudioFilterDialog = lazyRetry(
  studioFilterDialogLoader.load,
  "StudioFilterDialog"
);
function preloadStudioFilterDialog(): void {
  studioFilterDialogLoader.preload();
}
const StudioLayerLiftDialog = lazyRetry(
  () => import( "./layer/StudioLayerLiftDialog").then((mod) => ({ default: mod.StudioLayerLiftDialog })),
  "StudioLayerLiftDialog"
);
const StudioColorPalettePanel = lazyRetry(
  () => import("./StudioColorPalettePanel").then((mod) => ({ default: mod.StudioColorPalettePanel })),
  "StudioColorPalettePanel"
);
const StudioFloodFillPanel = lazyRetry(
  () => import("./StudioFloodFillPanel").then((mod) => ({ default: mod.StudioFloodFillPanel })),
  "StudioFloodFillPanel"
);
const StudioAutoColorHintsPanel = lazyRetry(
  () =>
    import("./StudioAutoColorHintsPanel").then((mod) => ({
      default: mod.StudioAutoColorHintsPanel,
    })),
  "StudioAutoColorHintsPanel"
);
const StudioHealCloneOverlay = lazyRetry(
  () => import("./StudioHealCloneOverlay").then((mod) => ({ default: mod.StudioHealCloneOverlay })),
  "StudioHealCloneOverlay"
);
const StudioHistoryBrushOverlay = lazyRetry(
  () => import("./StudioHistoryBrushOverlay").then((mod) => ({ default: mod.StudioHistoryBrushOverlay })),
  "StudioHistoryBrushOverlay"
);
const StudioIsometricGridOverlay = lazyRetry(
  () => import("./StudioIsometricGridOverlay").then((mod) => ({ default: mod.StudioIsometricGridOverlay })),
  "StudioIsometricGridOverlay"
);
const StudioAdvancedRulerOverlay = lazyRetry(
  () => import("./StudioAdvancedRulerOverlay").then((mod) => ({ default: mod.StudioAdvancedRulerOverlay })),
  "StudioAdvancedRulerOverlay"
);
export const StudioCanvasRulerBars = lazyRetry(
  () => import("./canvas/StudioCanvasRulerBars").then((mod) => ({ default: mod.StudioCanvasRulerBars })),
  "StudioCanvasRulerBars"
);
const StudioLayerMaskOverlay = lazyRetry(
  () => import("./layer/StudioLayerMaskOverlay").then((mod) => ({ default: mod.StudioLayerMaskOverlay })),
  "StudioLayerMaskOverlay"
);
const StudioQuickMaskOverlay = lazyRetry(
  () => import("./StudioQuickMaskOverlay").then((mod) => ({ default: mod.StudioQuickMaskOverlay })),
  "StudioQuickMaskOverlay"
);
const studioPanelSplitToolLoader = createStudioIntentLazyLoader(
  () => import("./StudioPanelSplitTool")
);
const StudioPanelSplitOverlay = lazyRetry(
  () => studioPanelSplitToolLoader.load().then((mod) => ({ default: mod.StudioPanelSplitOverlay })),
  "StudioPanelSplitOverlay"
);
const StudioPanelSplitPanel = lazyRetry(
  () => studioPanelSplitToolLoader.load().then((mod) => ({ default: mod.StudioPanelSplitPanel })),
  "StudioPanelSplitPanel"
);
const StudioPerspectiveOverlay = lazyRetry(
  () => import("./StudioPerspectiveOverlay").then((mod) => ({ default: mod.StudioPerspectiveOverlay })),
  "StudioPerspectiveOverlay"
);
const StudioPuppetWarpOverlay = lazyRetry(
  () => import("./StudioPuppetWarpOverlay").then((mod) => ({ default: mod.StudioPuppetWarpOverlay })),
  "StudioPuppetWarpOverlay"
);
const StudioLayerNavigator = lazyRetry(
  () => import("./layer/StudioLayerNavigator").then((mod) => ({ default: mod.StudioLayerNavigator })),
  "StudioLayerNavigator"
);
const studioPaletteLibraryPanelLoader = createStudioIntentLazyLoader(() =>
  import("./StudioPaletteLibraryPanel").then((mod) => ({
    default: mod.StudioPaletteLibraryPanel,
  }))
);
const StudioPaletteLibraryPanel = lazyRetry(
  studioPaletteLibraryPanelLoader.load,
  "StudioPaletteLibraryPanel"
);

function preloadStudioPaletteLibraryPanel(): void {
  studioPaletteLibraryPanelLoader.preload();
}
const StudioBubbleStylePresetPanel = lazyRetry(
  () => import("./lettering/StudioBubbleStylePresetPanel").then((mod) => ({ default: mod.StudioBubbleStylePresetPanel })),
  "StudioBubbleStylePresetPanel"
);
const StudioBubbleAutoShrinkPanel = lazyRetry(
  () => import("./lettering/StudioBubbleAutoShrinkPanel").then((mod) => ({ default: mod.StudioBubbleAutoShrinkPanel })),
  "StudioBubbleAutoShrinkPanel"
);
const StudioDialogueBatchPanel = lazyRetry(
  () => import("./StudioDialogueBatchPanel").then((mod) => ({ default: mod.StudioDialogueBatchPanel })),
  "StudioDialogueBatchPanel"
);
const studioTextEditOverlayLoader = createStudioIntentLazyLoader(
  () => import("./lettering/StudioTextEditOverlay")
);
const StudioTextEditOverlay = lazyRetry(
  () => studioTextEditOverlayLoader.load().then((mod) => ({ default: mod.default })),
  "StudioTextEditOverlay"
);
const StudioTextEditFallbackModal = lazyRetry(
  () => studioTextEditOverlayLoader.load().then((mod) => ({
    default: mod.StudioTextEditFallbackModal,
  })),
  "StudioTextEditFallbackModal"
);

function preloadStudioTextEditOverlay(): void {
  studioTextEditOverlayLoader.preload();
}
const StudioQuickActionsMenu = lazyRetry(
  () => import("./StudioQuickActionsMenu").then((mod) => ({ default: mod.StudioQuickActionsMenu })),
  "StudioQuickActionsMenu"
);
const StudioHistoryPanel = lazyRetry(
  () => import("./StudioHistoryPanel").then((mod) => ({ default: mod.StudioHistoryPanel })),
  "StudioHistoryPanel"
);
const StudioCheckpointPanel = lazyRetry(
  () => import("./StudioCheckpointPanel").then((mod) => ({ default: mod.StudioCheckpointPanel })),
  "StudioCheckpointPanel"
);
const StudioAutoActionsPanel = lazyRetry(
  () => import("./StudioAutoActionsPanel").then((mod) => ({ default: mod.StudioAutoActionsPanel })),
  "StudioAutoActionsPanel"
);
const StudioCharacterBiblePanel = lazyRetry(
  () => import("./StudioCharacterBiblePanel").then((mod) => ({ default: mod.StudioCharacterBiblePanel })),
  "StudioCharacterBiblePanel"
);
const StudioWriterRoomPanel = lazyRetry(
  () => import("./StudioWriterRoomPanel").then((mod) => ({ default: mod.StudioWriterRoomPanel })),
  "StudioWriterRoomPanel"
);
const StudioAiProvenancePanel = lazyRetry(
  () =>
    import("./ai/StudioAiProvenancePanel").then((mod) => ({
      default: mod.StudioAiProvenancePanel,
    })),
  "StudioAiProvenancePanel"
);
const StudioPageReviewPanel = lazyRetry(
  () => import("./StudioPageReviewPanel").then((mod) => ({ default: mod.StudioPageReviewPanel })),
  "StudioPageReviewPanel"
);
const StudioContinuityPanel = lazyRetry(
  () => import("./StudioContinuityPanel").then((mod) => ({ default: mod.StudioContinuityPanel })),
  "StudioContinuityPanel"
);
const StudioFrameAnimationPanel = lazyRetry(
  () => import("./StudioFrameAnimationPanel").then((mod) => ({ default: mod.StudioFrameAnimationPanel })),
  "StudioFrameAnimationPanel"
);
const StudioAnimTimelinePanel = lazyRetry(
  () => import("./StudioAnimTimelinePanel").then((mod) => ({ default: mod.StudioAnimTimelinePanel })),
  "StudioAnimTimelinePanel"
);
const StudioMasterPagePanel = lazyRetry(
  () => import("./StudioMasterPagePanel").then((mod) => ({ default: mod.StudioMasterPagePanel })),
  "StudioMasterPagePanel"
);
const StudioStoryboardGridPanel = lazyRetry(
  () => import("./StudioStoryboardGridPanel").then((mod) => ({ default: mod.StudioStoryboardGridPanel })),
  "StudioStoryboardGridPanel"
);
const StudioShortcutsHelp = lazyRetry(
  () => import("./StudioShortcutsHelp").then((mod) => ({ default: mod.StudioShortcutsHelp })),
  "StudioShortcutsHelp"
);
const StudioStickerGrid = lazyRetry(
  () => import("./studio-sticker-grid").then((mod) => ({ default: mod.StudioStickerGrid })),
  "StudioStickerGrid"
);
const StudioCollagePanel = lazyRetry(
  () => import("./StudioCollagePanel").then((mod) => ({ default: mod.StudioCollagePanel })),
  "StudioCollagePanel"
);
const StudioElementsPanel = lazyRetry(
  () => import("./StudioElementsPanel").then((mod) => ({ default: mod.StudioElementsPanel })),
  "StudioElementsPanel"
);
const StudioBackgroundPanel = lazyRetry(
  () => import("./StudioBackgroundPanel").then((mod) => ({ default: mod.StudioBackgroundPanel })),
  "StudioBackgroundPanel"
);
const StudioCanvasResizer = lazyRetry(
  () => import("./canvas/StudioCanvasResizer").then((mod) => ({ default: mod.StudioCanvasResizer })),
  "StudioCanvasResizer"
);
const StudioRasterAssetGrid = lazyRetry(
  () => import("./StudioRasterAssetGrid").then((mod) => ({ default: mod.StudioRasterAssetGrid })),
  "StudioRasterAssetGrid"
);
const StudioTextEffectPanel = lazyRetry(
  () => import("./lettering/StudioTextEffectPanel").then((mod) => ({ default: mod.StudioTextEffectPanel })),
  "StudioTextEffectPanel"
);
const StudioGradientEnginePanel = lazyRetry(
  () => import("./StudioGradientEnginePanel").then((mod) => ({ default: mod.StudioGradientEnginePanel })),
  "StudioGradientEnginePanel"
);
const StudioPatternFillPanel = lazyRetry(
  () => import("./StudioPatternFillPanel").then((mod) => ({ default: mod.StudioPatternFillPanel })),
  "StudioPatternFillPanel"
);
const StudioTextPathPanel = lazyRetry(
  () => import("./lettering/StudioTextPathPanel").then((mod) => ({ default: mod.StudioTextPathPanel })),
  "StudioTextPathPanel"
);
const StudioTonePanel = lazyRetry(
  () => import("./StudioTonePanel").then((mod) => ({ default: mod.StudioTonePanel })),
  "StudioTonePanel"
);
const StudioStrokeShapePanel = lazyRetry(
  () => import("./StudioStrokeShapePanel").then((mod) => ({ default: mod.StudioStrokeShapePanel })),
  "StudioStrokeShapePanel"
);
const StudioSelectionToolsPanel = lazyRetry(
  () => import("./StudioSelectionToolsPanel").then((mod) => ({ default: mod.StudioSelectionToolsPanel })),
  "StudioSelectionToolsPanel"
);
const StudioCropPanel = lazyRetry(
  () => import("./StudioCropPanel").then((mod) => ({ default: mod.StudioCropPanel })),
  "StudioCropPanel"
);
const StudioPerspectivePanel = lazyRetry(
  () => import("./StudioPerspectivePanel").then((mod) => ({ default: mod.StudioPerspectivePanel })),
  "StudioPerspectivePanel"
);
const StudioIsometricGridPanel = lazyRetry(
  () => import("./StudioIsometricGridPanel").then((mod) => ({ default: mod.StudioIsometricGridPanel })),
  "StudioIsometricGridPanel"
);
const StudioAdvancedRulerPanel = lazyRetry(
  () => import("./StudioAdvancedRulerPanel").then((mod) => ({ default: mod.StudioAdvancedRulerPanel })),
  "StudioAdvancedRulerPanel"
);
const StudioVrmPoser = lazyRetry(
  () => import( "./vrm/StudioVrmPoser").then((mod) => ({ default: mod.StudioVrmPoser })),
  "StudioVrmPoser"
);
const StudioCharacterShaper = lazyRetry(
  () => import("./character-shaper/StudioCharacterShaper").then((mod) => ({ default: mod.StudioCharacterShaper })),
  "StudioCharacterShaper"
);
const StudioMannequinPoserPanel = lazyRetry(
  () => import("./scene-3d/StudioMannequinPoserPanel").then((mod) => ({ default: mod.StudioMannequinPoserPanel })),
  "StudioMannequinPoserPanel"
);
const StudioBackground3D = lazyRetry(
  () => loadStudioBackground3DModule().then((mod) => ({ default: mod.StudioBackground3D })),
  "StudioBackground3D"
);
const StudioTimelapsePanel = lazyRetry(
  () => import("./StudioTimelapsePanel").then((mod) => ({ default: mod.StudioTimelapsePanel })),
  "StudioTimelapsePanel"
);
const WorkFxPanel = lazyRetry(
  () => import("./WorkFxPanel").then((mod) => ({ default: mod.WorkFxPanel })),
  "WorkFxPanel"
);
const StudioBrandKitPanel = lazyRetry(
  () => import("./StudioBrandKitPanel").then((mod) => ({ default: mod.StudioBrandKitPanel })),
  "StudioBrandKitPanel"
);
const StudioBubbleAnchorPanel = lazyRetry(
  () => import("./lettering/StudioBubbleAnchorPanel").then((mod) => ({ default: mod.StudioBubbleAnchorPanel })),
  "StudioBubbleAnchorPanel"
);
const StudioBubbleTailControls = lazyRetry(
  () => import("./lettering/StudioBubbleTailControls").then((mod) => ({ default: mod.StudioBubbleTailControls })),
  "StudioBubbleTailControls"
);
const StudioSmudgePanel = lazyRetry(
  () => import("./StudioSmudgePanel").then((mod) => ({ default: mod.StudioSmudgePanel })),
  "StudioSmudgePanel"
);
const StudioDodgeBurnPanel = lazyRetry(
  () => import("./StudioDodgeBurnPanel").then((mod) => ({ default: mod.StudioDodgeBurnPanel })),
  "StudioDodgeBurnPanel"
);
const StudioWetMixPanel = lazyRetry(
  () => import("./StudioWetMixPanel").then((mod) => ({ default: mod.StudioWetMixPanel })),
  "StudioWetMixPanel"
);
const StudioExtendedBlendPanel = lazyRetry(
  () => import("./StudioExtendedBlendPanel").then((mod) => ({ default: mod.StudioExtendedBlendPanel })),
  "StudioExtendedBlendPanel"
);
const StudioPathBooleanPanel = lazyRetry(
  () => import("./StudioPathBooleanPanel").then((mod) => ({ default: mod.StudioPathBooleanPanel })),
  "StudioPathBooleanPanel"
);
const StudioLiquifyPanel = lazyRetry(
  () => import("./StudioLiquifyPanel").then((mod) => ({ default: mod.StudioLiquifyPanel })),
  "StudioLiquifyPanel"
);
const StudioHealClonePanel = lazyRetry(
  () => import("./StudioHealClonePanel").then((mod) => ({ default: mod.StudioHealClonePanel })),
  "StudioHealClonePanel"
);
const StudioHistoryBrushPanel = lazyRetry(
  () => import("./StudioHistoryBrushPanel").then((mod) => ({ default: mod.StudioHistoryBrushPanel })),
  "StudioHistoryBrushPanel"
);
const StudioLayerMaskPanel = lazyRetry(
  () => import( "./layer/StudioLayerMaskPanel").then((mod) => ({ default: mod.StudioLayerMaskPanel })),
  "StudioLayerMaskPanel"
);
const StudioFilterMaskPanel = lazyRetry(
  () => import( "./filter/StudioFilterMaskPanel").then((mod) => ({ default: mod.StudioFilterMaskPanel })),
  "StudioFilterMaskPanel"
);
// Inspector sections that only exist for one selection or tool state. They used to ride into the
// always-rendered inspector chunk on a static import, so a launch with nothing selected still paid
// for the font manager, the line-art cleanup kernels and the quick-mask editor.
const StudioCustomFontsPanel = lazyRetry(
  () => import("./StudioCustomFontsPanel").then((mod) => ({ default: mod.StudioCustomFontsPanel })),
  "StudioCustomFontsPanel"
);
const StudioLineCleanupPanel = lazyRetry(
  () => import("./StudioLineCleanupPanel").then((mod) => ({ default: mod.StudioLineCleanupPanel })),
  "StudioLineCleanupPanel"
);
const StudioQuickMaskPanel = lazyRetry(
  () => import("./StudioQuickMaskPanel").then((mod) => ({ default: mod.StudioQuickMaskPanel })),
  "StudioQuickMaskPanel"
);
const StudioPuppetWarpPanel = lazyRetry(
  () => import("./StudioPuppetWarpPanel").then((mod) => ({ default: mod.StudioPuppetWarpPanel })),
  "StudioPuppetWarpPanel"
);
const StudioQuickShapePanel = lazyRetry(
  () => import("./StudioQuickShapePanel").then((mod) => ({ default: mod.StudioQuickShapePanel })),
  "StudioQuickShapePanel"
);
const StudioFeatureTutorialHub = lazyRetry(
  () => import("./StudioFeatureTutorialHub").then((mod) => ({ default: mod.StudioFeatureTutorialHub })),
  "StudioFeatureTutorialHub"
);
const StudioMainMenu = lazyRetry(
  () => import("./StudioMainMenu").then((mod) => ({ default: mod.StudioMainMenu })),
  "StudioMainMenu"
);
const StudioDrawOptionsBar = lazyRetry(
  () => import("./brush/StudioDrawOptionsBar").then((mod) => ({ default: mod.StudioDrawOptionsBar })),
  "StudioDrawOptionsBar"
);
const studioDrawingPaletteStackLoader = createStudioIntentLazyLoader(() =>
  import("./brush/StudioDrawingPaletteStack").then((mod) => ({
    default: mod.StudioDrawingPaletteStack,
  }))
);
const StudioDrawingPaletteStack = lazyRetry(
  studioDrawingPaletteStackLoader.load,
  "StudioDrawingPaletteStack"
);
function preloadStudioDrawingPaletteStack(): void {
  studioDrawingPaletteStackLoader.preload();
}
const StudioUnifiedBrushPicker = lazyRetry(
  () => import("./StudioUnifiedBrushPicker").then((mod) => ({ default: mod.StudioUnifiedBrushPicker })),
  "StudioUnifiedBrushPicker"
);
const StudioBrushCatalogPortal = lazyRetry(
  () => import( "./brush/StudioBrushLibrarySheet").then((mod) => ({ default: mod.StudioBrushCatalogPortal })),
  "StudioBrushCatalogPortal"
);
const StudioSelectionAntsOverlay = lazyRetry(
  () => import("./StudioSelectionOverlays").then((mod) => ({ default: mod.StudioSelectionAntsOverlay })),
  "StudioSelectionAntsOverlay"
);
const StudioCropOverlay = lazyRetry(
  () => import("./StudioSelectionOverlays").then((mod) => ({ default: mod.StudioCropOverlay })),
  "StudioCropOverlay"
);
const StudioNodeEditOverlay = lazyRetry(
  () => import("./StudioSelectionOverlays").then((mod) => ({ default: mod.StudioNodeEditOverlay })),
  "StudioNodeEditOverlay"
);
const StudioDrawSelectionOverlay = lazyRetry(
  () => import("./StudioSelectionOverlays").then((mod) => ({ default: mod.StudioDrawSelectionOverlay })),
  "StudioDrawSelectionOverlay"
);
const StudioBubbleShapeOverlay = lazyRetry(
  () => import("./StudioSelectionOverlays").then((mod) => ({ default: mod.StudioBubbleShapeOverlay })),
  "StudioBubbleShapeOverlay"
);
const StudioOnionSkinImage = lazyRetry(
  () => import("./StudioSelectionOverlays").then((mod) => ({ default: mod.StudioOnionSkinImage })),
  "StudioOnionSkinImage"
);
const StudioLiveInkOverlayHost = lazyRetry(
  () => import("./live/StudioLiveInkHosts").then((mod) => ({ default: mod.StudioLiveInkOverlayHost })),
  "StudioLiveInkOverlayHost"
);
const StudioLiveStampOverlayHost = lazyRetry(
  () => import("./live/StudioLiveInkHosts").then((mod) => ({ default: mod.StudioLiveStampOverlayHost })),
  "StudioLiveStampOverlayHost"
);
const StudioLiveRetainedMediaOverlayHost = lazyRetry(
  () => import("./live/StudioLiveInkHosts").then((mod) => ({
    default: mod.StudioLiveRetainedMediaOverlayHost,
  })),
  "StudioLiveRetainedMediaOverlayHost"
);
const StudioLiveDynamicBrushOverlayHost = lazyRetry(
  () => import("./live/StudioLiveInkHosts").then((mod) => ({ default: mod.StudioLiveDynamicBrushOverlayHost })),
  "StudioLiveDynamicBrushOverlayHost"
);
const StudioLiveWetInkOverlayHost = lazyRetry(
  () => import("./live/StudioLiveInkHosts").then((mod) => ({ default: mod.StudioLiveWetInkOverlayHost })),
  "StudioLiveWetInkOverlayHost"
);
const StudioLiveInkPredictionHost = lazyRetry(
  () => import("./live/StudioLiveInkHosts").then((mod) => ({ default: mod.StudioLiveInkPredictionHost })),
  "StudioLiveInkPredictionHost"
);
const StudioLivePressureHudPill = lazyRetry(
  () => import("./live/StudioLiveInkHosts").then((mod) => ({ default: mod.StudioLivePressureHudPill })),
  "StudioLivePressureHudPill"
);
const loadStudioBrushStudio = () => import( "./brush/StudioBrushStudio");
const StudioBrushStudio = lazyRetry(
  () => loadStudioBrushStudio().then((mod) => ({ default: mod.StudioBrushStudio })),
  "StudioBrushStudio"
);
const StudioProceduralArtisticBrushController = lazyRetry(
  () =>
    import("./StudioProceduralArtisticBrushController").then((mod) => ({
      default: mod.StudioProceduralArtisticBrushController,
    })),
  "StudioProceduralArtisticBrushController"
);
const StudioHokusaiNaturalMediaInspectorSection = lazyRetry(
  () =>
    import("./StudioHokusaiNaturalMediaInspectorSection").then((mod) => ({
      default: mod.StudioHokusaiNaturalMediaInspectorSection,
    })),
  "StudioHokusaiNaturalMediaInspectorSection"
);
const QuickStartPanel = lazyRetry(
  () =>
    import("./StudioQuickStartPanel").then((module) => ({
      default: module.StudioQuickStartPanel,
    })),
  "StudioQuickStartPanel"
);
const StudioShapePickerGrid = lazyRetry(
  () => import("./studio-creative-visuals").then((mod) => ({ default: mod.StudioShapePickerGrid })),
  "StudioShapePickerGrid"
);
const StudioSelectOptionsBar = lazyRetry(
  () => import("./StudioSelectOptionsBar").then((mod) => ({ default: mod.StudioSelectOptionsBar })),
  "StudioSelectOptionsBar"
);
const StudioBrushLibraryPanel = lazyRetry(
  () => import( "./brush/StudioBrushLibraryPanel").then((mod) => ({ default: mod.StudioBrushLibraryPanel })),
  "StudioBrushLibraryPanel"
);

const StudioScrollPreviewPanel = lazyRetry(
  () => import("./StudioScrollPreviewPanel").then((mod) => ({ default: mod.StudioScrollPreviewPanel })),
  "StudioScrollPreviewPanel"
);
const StudioEmeresLibraryPanel = lazyRetry(
  () => import("./StudioEmeresLibraryPanel").then((mod) => ({ default: mod.StudioEmeresLibraryPanel })),
  "StudioEmeresLibraryPanel"
);
const StudioAiAssistHub = lazyRetry(
  () => import("./ai/StudioAiAssistHub").then((mod) => ({ default: mod.StudioAiAssistHub })),
  "StudioAiAssistHub"
);
const StudioAiBackgroundPanel = lazyRetry(
  () => import("./ai/StudioAiBackgroundPanel").then((mod) => ({ default: mod.StudioAiBackgroundPanel })),
  "StudioAiBackgroundPanel"
);
const StudioAiColorizePanel = lazyRetry(
  () => import("./ai/StudioAiColorizePanel").then((mod) => ({ default: mod.StudioAiColorizePanel })),
  "StudioAiColorizePanel"
);
const StudioAiCompositionPanel = lazyRetry(
  () => import( "./ai/StudioAiCompositionPanel").then((mod) => ({ default: mod.StudioAiCompositionPanel })),
  "StudioAiCompositionPanel"
);
const StudioAiCharacterConsistencyPanel = lazyRetry(
  () =>
    import( "./ai/StudioAiCharacterConsistencyPanel").then((mod) => ({
      default: mod.StudioAiCharacterConsistencyPanel,
    })),
  "StudioAiCharacterConsistencyPanel"
);
const StudioDialogueSuggestPanel = lazyRetry(
  () => import("./StudioDialogueSuggestPanel").then((mod) => ({ default: mod.StudioDialogueSuggestPanel })),
  "StudioDialogueSuggestPanel"
);
const StudioPaletteSuggestPanel = lazyRetry(
  () => import("./StudioPaletteSuggestPanel").then((mod) => ({ default: mod.StudioPaletteSuggestPanel })),
  "StudioPaletteSuggestPanel"
);
const StudioDialogueTranslatePanel = lazyRetry(
  () => import("./StudioDialogueTranslatePanel").then((mod) => ({ default: mod.StudioDialogueTranslatePanel })),
  "StudioDialogueTranslatePanel"
);
const StudioScenarioAutoLayoutPanel = lazyRetry(
  () =>
    import("./StudioScenarioAutoLayoutPanel").then((mod) => ({
      default: mod.StudioScenarioAutoLayoutPanel,
    })),
  "StudioScenarioAutoLayoutPanel"
);
const StudioPublishPreflightPanel = lazyRetry(
  () =>
    import("./StudioPublishPreflightPanel").then((mod) => ({
      default: mod.StudioPublishPreflightPanel,
    })),
  "StudioPublishPreflightPanel"
);
const StudioPublishPackagePanel = lazyRetry(
  () =>
    import("./StudioPublishPackagePanel").then((mod) => ({
      default: mod.StudioPublishPackagePanel,
    })),
  "StudioPublishPackagePanel"
);
const StudioProductionInsightsPanel = lazyRetry(
  () =>
    import("./StudioProductionInsightsPanel").then((mod) => ({
      default: mod.StudioProductionInsightsPanel,
    })),
  "StudioProductionInsightsPanel"
);
const StudioPublicationOperationsPanel = lazyRetry(
  () =>
    import("./StudioPublicationOperationsPanel").then((mod) => ({
      default: mod.StudioPublicationOperationsPanel,
    })),
  "StudioPublicationOperationsPanel"
);
const studioCommentsPanelSessionLoader = createStudioIntentLazyLoader(() =>
  import("./StudioCommentsPanelSession").then((mod) => ({
      default: mod.StudioCommentsPanelSession,
    }))
);
const StudioCommentsPanelSession = lazyRetry(
  studioCommentsPanelSessionLoader.load,
  "StudioCommentsPanelSession"
);
function preloadStudioCommentsPanelSession(): void {
  studioCommentsPanelSessionLoader.preload();
}

// Review networking and mutation verification are not part of the first-paint drawing path.
// Keep them in optional chunks while retaining the lightweight persisted comment model needed
// for canvas pins and project compatibility in the static Studio graph.
const loadStudioTeamCommentClient = () => import("./studio-team-comment-client");
const loadStudioTeamCommentMutationPlanner = () =>
  import("./studio-team-comment-mutation-plan");
const StudioTeamPanel = lazyRetry(
  () =>
    import("./StudioTeamPanel").then((mod) => ({
      default: mod.StudioTeamPanel,
    })),
  "StudioTeamPanel"
);
function loadStudioReferencePanel() {
  return import("./StudioReferencePanel").then((mod) => ({ default: mod.StudioReferencePanel }));
}
const StudioReferencePanel = lazyRetry(loadStudioReferencePanel, "StudioReferencePanel");
function preloadStudioReferencePanel(): void {
  void loadStudioReferencePanel();
}
function loadStudioColorWheelOverlay() {
  return import("./StudioColorWheelOverlay").then((mod) => ({ default: mod.StudioColorWheelOverlay }));
}
const StudioColorWheelOverlay = lazyRetry(loadStudioColorWheelOverlay, "StudioColorWheelOverlay");

type StudioAssetMenuPanelModule = { default: ComponentType<StudioAssetMenuPanelProps> };
let studioAssetMenuPanelPromise: Promise<StudioAssetMenuPanelModule> | null = null;

function loadStudioAssetMenuPanel(): Promise<StudioAssetMenuPanelModule> {
  studioAssetMenuPanelPromise ??= import("./StudioAssetMenuPanel").then((mod) => ({
    default: mod.StudioAssetMenuPanel,
  }));
  return studioAssetMenuPanelPromise;
}

const StudioAssetMenuPanel = lazyRetry(loadStudioAssetMenuPanel, "StudioAssetMenuPanel");

function preloadStudioAssetMenuPanel(): void {
  void loadStudioAssetMenuPanel();
}

type StudioStockImagePanelModule = { default: ComponentType<StudioStockImagePanelProps> };
let studioStockImagePanelPromise: Promise<StudioStockImagePanelModule> | null = null;

function loadStudioStockImagePanel(): Promise<StudioStockImagePanelModule> {
  studioStockImagePanelPromise ??= import("./StudioStockImagePanel").then((mod) => ({
    default: mod.StudioStockImagePanel,
  }));
  return studioStockImagePanelPromise;
}

const StudioStockImagePanel = lazyRetry(loadStudioStockImagePanel, "StudioStockImagePanel");

function preloadStudioStockImagePanel(): void {
  void loadStudioStockImagePanel();
}

type StudioIntegrationsSettingsPanelModule = { default: ComponentType<StudioIntegrationsSettingsPanelProps> };
let studioIntegrationsSettingsPanelPromise: Promise<StudioIntegrationsSettingsPanelModule> | null = null;

function loadStudioIntegrationsSettingsPanel(): Promise<StudioIntegrationsSettingsPanelModule> {
  studioIntegrationsSettingsPanelPromise ??= import("./StudioIntegrationsSettingsPanel").then((mod) => ({
    default: mod.StudioIntegrationsSettingsPanel,
  }));
  return studioIntegrationsSettingsPanelPromise;
}

const StudioIntegrationsSettingsPanel = lazyRetry(
  loadStudioIntegrationsSettingsPanel,
  "StudioIntegrationsSettingsPanel"
);

function preloadStudioIntegrationsSettingsPanel(): void {
  void loadStudioIntegrationsSettingsPanel();
}

const StudioAppSettingsPanel = lazyRetry(
  () => import("./StudioAppSettingsPanel").then((mod) => ({ default: mod.StudioAppSettingsPanel })),
  "StudioAppSettingsPanel"
);

type StudioExportMenuPanelModule = { default: ComponentType<StudioExportMenuPanelProps> };
let studioExportMenuPanelPromise: Promise<StudioExportMenuPanelModule> | null = null;

function loadStudioExportMenuPanel(): Promise<StudioExportMenuPanelModule> {
  studioExportMenuPanelPromise ??= import( "./export/StudioExportMenuPanel").then((mod) => ({
    default: mod.StudioExportMenuPanel,
  }));
  return studioExportMenuPanelPromise;
}

const StudioExportMenuPanel = lazyRetry(loadStudioExportMenuPanel, "StudioExportMenuPanel");

function preloadStudioExportMenuPanel(): void {
  void loadStudioExportMenuPanel();
  preloadStudioCaptureReadinessRuntime();
}

type StudioWebtoonGuidesModule = typeof import("./studio-webtoon-guides");
let studioWebtoonGuidesPromise: Promise<StudioWebtoonGuidesModule> | null = null;

function loadStudioWebtoonGuides(): Promise<StudioWebtoonGuidesModule> {
  studioWebtoonGuidesPromise ??= import("./studio-webtoon-guides").catch((error) => {
    studioWebtoonGuidesPromise = null;
    throw error;
  });
  return studioWebtoonGuidesPromise;
}

type StudioColorPopoverModule = { default: ComponentType<StudioColorPopoverProps> };

let studioColorPopoverPromise: Promise<StudioColorPopoverModule> | null = null;

function loadStudioColorPopover(): Promise<StudioColorPopoverModule> {
  studioColorPopoverPromise ??= import("./StudioColorPopover").then((mod) => ({
    default: mod.StudioColorPopover,
  }));
  return studioColorPopoverPromise;
}

const StudioColorPopoverContent = lazyRetry(loadStudioColorPopover, "StudioColorPopover");

type StudioComipoAssemblyModule = typeof import("./studio-comipo-assembly");
type StudioComipoShippedModule = typeof import("./studio-comipo-shipped");

let studioComipoAssemblyPromise: Promise<StudioComipoAssemblyModule> | null = null;
let studioComipoShippedPromise: Promise<StudioComipoShippedModule> | null = null;

function loadStudioComipoAssembly(): Promise<StudioComipoAssemblyModule> {
  studioComipoAssemblyPromise ??= import("./studio-comipo-assembly").catch((error) => {
    studioComipoAssemblyPromise = null;
    throw error;
  });
  return studioComipoAssemblyPromise;
}

function loadStudioComipoShipped(): Promise<StudioComipoShippedModule> {
  studioComipoShippedPromise ??= import("./studio-comipo-shipped").catch((error) => {
    studioComipoShippedPromise = null;
    throw error;
  });
  return studioComipoShippedPromise;
}

function preloadStudioColorPopover(): void {
  void loadStudioColorPopover();
}

export {
  StudioAiAssistHub,
  StudioAdvancedRulerOverlay,
  StudioAdvancedRulerPanel,
  StudioAiBackgroundPanel,
  StudioAiCharacterConsistencyPanel,
  StudioAiColorizePanel,
  StudioAiCompositionPanel,
  StudioAiProvenancePanel,
  StudioAnimTimelinePanel,
  StudioAppSettingsPanel,
  StudioAssetMenuPanel,
  StudioAutoColorHintsPanel,
  StudioAutoActionsPanel,
  StudioBackground3D,
  StudioBackgroundPanel,
  StudioBrandKitPanel,
  StudioBrushCatalogPortal,
  StudioBrushLibraryPanel,
  StudioBrushStudio,
  StudioHokusaiNaturalMediaInspectorSection,
  StudioProceduralArtisticBrushController,
  StudioBubbleAnchorPanel,
  StudioBubbleAutoShrinkPanel,
  StudioBubbleShapeOverlay,
  StudioBubbleStylePresetPanel,
  StudioBubbleTailControls,
  StudioCanvasResizer,
  StudioCharacterBiblePanel,
  StudioCheckpointPanel,
  StudioCollagePanel,
  StudioColorPalettePanel,
  StudioColorPopoverContent,
  StudioColorWheelOverlay,
  StudioCommentsPanelSession,
  StudioContinuityMetadataEditor,
  StudioContinuityPanel,
  StudioCropOverlay,
  StudioCropPanel,
  StudioCustomFontsPanel,
  StudioDialogueBatchPanel,
  StudioDialogueSuggestPanel,
  StudioDialogueTranslatePanel,
  StudioDrawOptionsBar,
  StudioDrawingPaletteStack,
  StudioElementsPanel,
  StudioEmeresLibraryPanel,
  StudioExportMenuPanel,
  StudioFeatureTutorialHub,
  StudioFilterDialog,
  StudioFilterMaskPanel,
  StudioFrameAnimationPanel,
  StudioFloodFillPanel,
  StudioGradientEnginePanel,
  StudioHealClonePanel,
  StudioHealCloneOverlay,
  StudioHistoryBrushPanel,
  StudioHistoryBrushOverlay,
  StudioHistoryPanel,
  StudioImageAdjustmentsPanel,
  StudioIntegrationsSettingsPanel,
  StudioIsometricGridPanel,
  StudioIsometricGridOverlay,
  StudioLayerMaskPanel,
  StudioLayerMaskOverlay,
  StudioLayerLiftDialog,
  StudioLineCleanupPanel,
  StudioQuickMaskOverlay,
  StudioLayerNavigator,
  StudioLiquifyPanel,
  StudioLiveInkOverlayHost,
  StudioLiveDynamicBrushOverlayHost,
  StudioLiveWetInkOverlayHost,
  StudioLiveInkPredictionHost,
  StudioLivePresenceDockConnected,
  StudioLivePressureHudPill,
  StudioLiveRetainedMediaOverlayHost,
  StudioLiveStampOverlayHost,
  StudioMainMenu,
  StudioMasterPagePanel,
  StudioDrawSelectionOverlay,
  StudioNodeEditOverlay,
  StudioOnionSkinImage,
  StudioPageGradePanel,
  StudioPageReviewPanel,
  StudioPageThumbnail,
  StudioPaletteLibraryPanel,
  StudioPaletteSuggestPanel,
  StudioPanelSplitOverlay,
  StudioPanelSplitPanel,
  StudioPatternFillPanel,
  StudioPerspectivePanel,
  StudioPerspectiveOverlay,
  StudioProductionInsightsPanel,
  StudioPublicationOperationsPanel,
  StudioPublishContextBanner,
  StudioPublishPackagePanel,
  StudioPublishPreflightPanel,
  StudioPuppetWarpPanel,
  StudioPuppetWarpOverlay,
  StudioQuickActionsMenu,
  StudioQuickMaskPanel,
  StudioQuickShapePanel,
  StudioRasterAssetGrid,
  StudioRasterCrdtSurface,
  StudioReferencePanel,
  StudioRemoteCursorOverlay,
  StudioPointCommentComposer,
  StudioCommentThreadPopover,
  StudioScenarioAutoLayoutPanel,
  StudioScrollPreviewPanel,
  StudioSelectOptionsBar,
  StudioSelectionAntsOverlay,
  StudioSelectionToolsPanel,
  StudioShapePickerGrid,
  StudioShortcutsHelp,
  StudioSmudgePanel,
  StudioDodgeBurnPanel,
  StudioWetMixPanel,
  StudioExtendedBlendPanel,
  StudioPathBooleanPanel,
  QuickStartPanel,
  StudioStickerGrid,
  StudioStockImagePanel,
  StudioStoryboardGridPanel,
  StudioStrokeShapePanel,
  StudioTeamPanel,
  StudioTextEditFallbackModal,
  StudioTextEditOverlay,
  StudioTextEffectPanel,
  StudioTextPathPanel,
  StudioTimelapsePanel,
  StudioTonePanel,
  StudioUnifiedBrushPicker,
  StudioUploadPublish,
  StudioVrmPoser,
  StudioCharacterShaper,
  StudioMannequinPoserPanel,
  StudioCanonicalVNextDryMediaCanvas,
  StudioWebGpuCanvas,
  StudioWriterRoomPanel,
  WorkFxPanel,
  loadStudioBrushStudio,
  loadStudioComipoAssembly,
  loadStudioComipoShipped,
  loadStudioCaptureReadinessRuntime,
  loadStudioSavePayloadRuntime,
  loadStudioTeamCommentClient,
  loadStudioTeamCommentMutationPlanner,
  loadStudioWebtoonGuides,
  preloadStudioAssetMenuPanel,
  preloadStudioCommentsPanelSession,
  preloadStudioColorPopover,
  preloadStudioDrawingPaletteStack,
  preloadStudioExportMenuPanel,
  preloadStudioIntegrationsSettingsPanel,
  preloadStudioPaletteLibraryPanel,
  preloadStudioCommentThreadPopover,
  preloadStudioCaptureReadinessRuntime,
  preloadStudioFilterDialog,
  preloadStudioPointCommentComposer,
  preloadStudioReferencePanel,
  preloadStudioSavePayloadRuntime,
  preloadStudioStockImagePanel,
  preloadStudioTextEditOverlay,
};

export type {
  StudioComipoAssemblyModule,
  StudioWebtoonGuidesModule,
};

// Keep optional scene loading in the shared registry, never in a popover body.
export const Studio2dSceneBrowser = lazyRetry(
  () => import("./Studio2dSceneBrowser").then((module) => ({ default: module.Studio2dSceneBrowser })),
  "Studio2dSceneBrowser"
);
