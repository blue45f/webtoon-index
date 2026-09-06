import {
  StudioBg3dProSuiteRuntimeContext,
  type StudioBg3dProSuiteRuntimeValue,
} from "./studio-bg3d-pro-suite-runtime-context";
import {
  evaluateStudioBg3dProductionPassReadiness,
  summarizeStudioBg3dProductionLook,
} from "./studio-bg3d-production-pass-readiness";
import { summarizeStudioBg3dProductionScene } from "./studio-bg3d-production-workflow";
import { StudioBg3dSpatialStoryboardLauncher } from "./StudioBg3dSpatialStoryboardLauncher";
import { StudioBg3dViewPanel as StudioBg3dViewPanelContent } from "./StudioBg3dViewPanelContent";

import type { StudioBg3dShotBatchPass } from "./studio-bg3d-shot-batch-pass-catalog";
import type { StudioBg3dViewPanelProps } from "./StudioBg3dViewPanelContent";

export {
  StudioBg3dAiReferenceAction,
  StudioBg3dBabylonDiagnostic,
} from "./StudioBg3dViewPanelContent";
export type {
  StudioBg3dAiReferenceActionProps,
  StudioBg3dBabylonDiagnosticBackend,
  StudioBg3dBabylonDiagnosticProps,
  StudioBg3dBabylonDiagnosticState,
  StudioBg3dViewPanelProps,
} from "./StudioBg3dViewPanelContent";

function normalizeSelectedPasses(
  availablePasses: readonly StudioBg3dShotBatchPass[],
  requestedPasses: readonly StudioBg3dShotBatchPass[],
): Set<StudioBg3dShotBatchPass> {
  const available = new Set(availablePasses);
  return new Set(requestedPasses.filter((pass) => available.has(pass)));
}

/**
 * Production bridge for the view-panel layout.
 *
 * The dense camera/environment presentation stays isolated in the content component while this
 * thin shell publishes its existing SceneDocument commands to nested 3D specialist tools. This
 * avoids duplicating shot state and keeps every director and batch action on the editor's undo,
 * recovery and archive-integrity paths.
 */
export function StudioBg3dViewPanel(props: StudioBg3dViewPanelProps) {
  const { context } = props;
  const disabled =
    context.isCapturing ||
    context.isBatchRenderingShots ||
    context.isRestoringScene ||
    context.physicsInteractionLocked;
  const sceneSummary = summarizeStudioBg3dProductionScene({
    document: context.sceneBaseDocument,
    selectedNodeCount: context.selectedIds.size,
    lineArtPreview: context.lineArtPreview,
    transparentBackground: context.transparentInsert,
  });
  const productionLook = summarizeStudioBg3dProductionLook(
    context.sceneBaseDocument.output,
  );
  const passReadiness = evaluateStudioBg3dProductionPassReadiness(
    context.selectedShotBatchPasses,
    productionLook,
  );
  const productionBlockedReason =
    context.shotBatchBlockedReason ?? passReadiness.blockingReason;
  const runtime: StudioBg3dProSuiteRuntimeValue = {
    disabled,
    proSuiteActive: !props.hidden && context.viewEditorSection === "prosuite",
    baseCamera: context.sceneBaseDocument.camera,
    productionShots: context.savedShots,
    sceneSummary,
    onSetLineArtPreview: context.setLineArtPreview,
    onSetTransparentBackground: context.updateBackgroundTransparency,
    productionBatch: {
      selectedShotIds: context.shotBatchSelectedIds,
      availablePasses: context.STUDIO_BG3D_SHOT_BATCH_PASSES,
      selectedPasses: context.selectedShotBatchPasses,
      passLabels: context.STUDIO_BG3D_SHOT_BATCH_PASS_LABELS,
      look: productionLook,
      exportHeight: context.shotBatchExportHeight,
      exportHeightOptions: context.LT_EXPORT_HEIGHTS,
      includeLayeredPsd: context.shotBatchIncludeLayeredPsd,
      includeContactSheet: context.shotBatchIncludeContactSheet,
      recoveryReady: context.recoveryScope !== null,
      blockedReason: productionBlockedReason,
      isRendering: context.isBatchRenderingShots,
      progress: context.shotBatchProgress,
      recoverySummary: context.shotBatchRecoverySummary,
      selectAllShots: () => context.setShotBatchExcludedIds(new Set()),
      clearShotSelection: () => context.setShotBatchExcludedIds(
        new Set(context.savedShots.map((shot) => shot.id)),
      ),
      setShotSelected: (shotId, selected) => {
        if (!context.savedShots.some((shot) => shot.id === shotId)) return;
        context.setShotBatchExcludedIds((current) => {
          const next = new Set(current);
          if (selected) next.delete(shotId);
          else next.add(shotId);
          return next;
        });
      },
      setSelectedPasses: (passes) => context.setShotBatchPasses(
        normalizeSelectedPasses(context.STUDIO_BG3D_SHOT_BATCH_PASSES, passes),
      ),
      setPassSelected: (pass, selected) => {
        if (!context.STUDIO_BG3D_SHOT_BATCH_PASSES.includes(pass)) return;
        context.setShotBatchPasses((current) => {
          const next = new Set(current);
          if (selected) next.add(pass);
          else next.delete(pass);
          return next;
        });
      },
      setExportHeight: (height) => {
        if (
          height !== "per-shot" &&
          !context.LT_EXPORT_HEIGHTS.some((candidate) => candidate === height)
        ) return;
        context.setShotBatchExportHeight(height);
      },
      setIncludeLayeredPsd: context.setShotBatchIncludeLayeredPsd,
      setIncludeContactSheet: context.setShotBatchIncludeContactSheet,
      startExport: context.exportSavedShotsAsZip,
    },
    onApplyCameraView: (camera) => context.updateCameraLens(() => camera),
    onPreviewCameraView: (camera) => context.previewCameraLens(() => camera),
    onFinishCameraViewPreview: context.finishCameraLensGesture,
    onCaptureCurrentShot: context.captureCurrentShot,
    onApplyProductionShot: context.applySavedShot,
    onMoveProductionShot: context.moveSavedShot,
    onRemoveProductionShot: context.removeSavedShot,
    onUseCurrentFrameAsAiReference: props.onUseCurrentFrameAsAiReference,
    aiReferenceBusy: props.aiReferenceBusy ?? false,
    aiReferenceDisabled: (props.aiReferenceDisabled ?? false) || disabled,
  };

  return (
    <StudioBg3dProSuiteRuntimeContext.Provider value={runtime}>
      <StudioBg3dViewPanelContent {...props} />
      <StudioBg3dSpatialStoryboardLauncher hidden={props.hidden} />
    </StudioBg3dProSuiteRuntimeContext.Provider>
  );
}
