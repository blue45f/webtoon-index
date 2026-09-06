/* Extracted stage pointer handlers from StudioCuttoonEditor.
 * Closures keep the original editor typing envelope via an `any` host bag. */
// @ts-nocheck
"use no memo";
// React Compiler 옵트아웃: 가변 호스트 백(h) 을 렌더마다 재대입해 공유하는 추출 패턴이라,
// 컴파일러가 h 참조 동일성만 보고 JSX/계산을 캐시하면 첫 렌더에서 UI 가 영구 동결된다
// (탭 전환 등 커밋된 상태 변경이 화면에 반영되지 않음).
import { flushSync } from "react-dom";

import { resolveStudioCapturedBrushDynamicsPresetId } from "../brush/studio-brush-dynamics";
import {
  advanceStudioBrushVelocityPressure,
  initializeStudioBrushVelocityPressure,
  resolveStudioBrushReleasePressure,
} from "../brush/studio-brush-velocity-pressure";
import { isCompleteStudioDrawOp } from "../brush/studio-draw-completion";
import { studioLiveRetainedMediaOverlaySupportsElement } from "../live/studio-live-retained-media-overlay";
import { planStudioDrawPointerRelease } from "../brush/studio-draw-pointer-release-plan";
import { planStudioDrawPointerStart } from "../brush/studio-draw-pointer-start-plan";
import {
  executeStudioDraftPreviewBackdropBoundary,
  planStudioDraftPreviewBackdropBoundary,
  studioLiveBrushEffectiveDiameter,
  studioLiveBrushPressure,
  studioLiveBrushPressureSamples,
} from "../brush/studio-draw-rendering";
import { requireStudioDrawingPointerTransport } from "../brush/studio-drawing-pointer-transport";
import {
  studioInkFallbackPressure,
} from "../brush/studio-ink-pressure-model";
import { isStudioBrushCursorMode, shouldShowStudioBrushCursor } from "../canvas/studio-canvas-cursor";
import { bubbleShapeCanvasPointToLocal, hasCustomBubbleShape, moveBubbleShapePoint } from "../lettering/studio-bubble-custom-shape";
import { beginStudioAdvancedFillTap, endStudioAdvancedFillTap, moveStudioAdvancedFillTap } from "../studio-advanced-fill-tap";
import { resolveActiveStudioAdvancedRuler, type StudioAdvancedRuler } from "../studio-advanced-ruler-document";
import { snapStudioAdvancedRulerStrokePoint } from "../studio-advanced-ruler-snap";
import { CANVAS_W } from "../studio-assets";
import {
  mapStudioDocumentPointToAutoColorSeed,
  sampleStudioAutoColorStrokeSeeds,
  shouldKeepStudioAutoColorStrokeSample,
  STUDIO_AUTO_COLOR_STROKE_MIN_DISTANCE_DOC_DEFAULT,
} from "../studio-auto-color-hints-canvas-seed";
import { normalizeCalligraphyStylusInput, strokeSampleDistanceForScale } from "../studio-brush";
import {
  hasStudioCanonicalVNextQualityShadowRuntime,
  submitStudioCanonicalVNextQualityShadowFinalParity,
} from "../studio-canonical-vnext-quality-shadow";
import { studioElementIdOf } from "../canvas/studio-canvas-shared-runtime";
import { shouldAppendStudioCausalInkSample } from "../studio-causal-ink";
import { shouldOwnStudioCoalescedBatchDraft } from "../studio-coalesced-batch-mutation";
import { COLOR_WHEEL_LONG_PRESS_MS, shouldCancelLongPress } from "../studio-color-wheel";
import {
  studioDrawElementSampleSlice,
  studioDrawElementToCrdtStroke,
} from "../live/studio-crdt-draw-bridge";
import {
  beginCropDrag,
  cropAspectRatio,
  cropHitTolerance,
  hitTestCropHandle,
  updateCropDrag,
} from "../studio-crop";
import { NODE_SMOOTH_DRAG_RANGE_PX, smoothPointsAroundIndex, updateSmoothStrengthDrag } from "../studio-curve-smoothing";
import { planStudioDeferredStrokePostprocess } from "../studio-deferred-stroke-postprocess";
import { containingPanel, elBounds } from "../studio-element-geometry";
import { attachStudioFilterMaskSurfaceAcrossHistory } from "../filter/studio-filter-mask-surface-admission";
import {
  createFixedRateStrokeFilter,
  quantizeFixedRateStrokeSample,
  transitionFixedRateStrokeFilter,
  type FixedRateStrokeFilteredSample,
} from "../studio-fixed-rate-stroke-filter";
import {
  advanceFixedRateStrokeFrameClock,
  advanceFixedRateStrokeSampleClockFloor,
  normalizeFixedRateStrokeSampleTimeStamps,
} from "../studio-fixed-rate-stroke-frame-pump";
import {
  expandSelectionIdsToGroupUnits,
  planAtomicSelectionTranslation,
  selectionShapeForIds,
} from "../studio-group-selection";
import { computeHealCloneSourceOffset, healCloneSourcePoint } from "../studio-heal-clone";
import type { StudioHokusaiLiveCanonicalResult } from "../render/studio-hokusai-live-brush-runtime";
import {
  createStudioHokusaiLiveCanonicalTransaction,
} from "../render/studio-hokusai-live-brush-transaction";
import {
  studioHokusaiSourceRevision,
} from "../render/studio-hokusai-natural-media-contract";
import { uid } from "../studio-id";
import {
  resolveIsometricAxisRay,
  shouldSnapStrokeToIsometricAxis,
  snapStrokePointToIsometricGrid,
} from "../studio-isometric-grid";
import { studioKonvaRuntime as KonvaRuntime } from "../render/studio-konva-runtime";
import { isEffectivelyHidden, isEffectivelyLocked } from "../studio-layers";
import {
  createStudioPixelEditCanvas,
  loadStudioPixelEditImage,
  studioInkGestureTimeOrigin,
} from "../studio-legacy-editor-runtime-helpers";
import { studioLinked3dPassDestructiveEditReason } from "../studio-linked-3d-raster-edit-policy";
import { createStudioLinked3dCorrectionProvenance } from "../studio-linked-3d-render-document";
import {
  appendStudioLiquifyPointerPoint,
  beginStudioLiquifyPointerSession,
  isStudioLiquifyPointerOwner,
} from "../studio-liquify-pointer";
import { studioLiquifyDragMinDistance } from "../studio-liquify-stroke-sampling";
import { resolveStudioLivePublishedCursorTool } from "../live/studio-live-canvas-overlay-model";
import {
  createStudioLivingInkCanonicalTransaction,
  studioLivingInkReceiptReplayToken,
  type StudioLivingInkCanonicalResult,
} from "../studio-living-ink-document";
import { studioLivingInkCoverageIntersectsStroke } from "../studio-living-ink-overlay";
import { studioLivingInkFailureDisposition } from "../studio-living-ink-product-admission";
import type { StudioLivingInkFinishedWork } from "../studio-living-ink-studio-coordinator";
import {
  beginNodeDrag,
  hitTestNodeHandle,
  NODE_EDIT_WIDTH_DRAG_RANGE_PX,
  updateNodeDragMove,
  updateNodeDragWidth,
  withPointMoved,
  withPressureEdited,
} from "../studio-node-edit";
import { snapStudioObjectDragPosition } from "../studio-object-drag-snap";
import { STUDIO_POINTER_PREDICTION_ENABLED } from "../studio-page-shell-runtime";
import { beginPanelSplitDrag, planPanelSplit, previewPanelSplit, type PanelSplitLine } from "../studio-panel-split";
import { normalizeStudioPersistedPointerChannels } from "../studio-persisted-pointer-channels";
import { resolvePerspectiveRay, snapStrokePointToPerspective } from "../studio-perspective-guide";
import {
  isStudioPixelPencilRenderMode,
  shouldAppendStudioPixelPencilSample,
} from "../studio-pixel-pencil";
import {
  beginStudioStrokePointerSession,
  collectStudioStrokePointerBatch,
  isStudioStrokePointerEvent,
  shouldCommitStudioStrokeOnPointerCancel,
  shouldEndStudioStrokeForReleasedContact,
  shouldCancelStudioFingerStrokeForAdditionalContact,
} from "../canvas/studio-pointer-input";
import { canCollectStudioPointerPredictionsForActiveTail } from "../canvas/studio-pointer-prediction-capability";
import {
  planStudioPointerReleaseEndpoint,
  type StudioPointerReleaseEndpointSample,
} from "../canvas/studio-pointer-release-endpoint-plan";
import { planStudioPredictedInkSuffixDraft } from "../studio-predicted-ink-tail";
import { addPuppetPin } from "../studio-puppet-warp";
import { applyMaskStrokeDabs } from "../studio-quick-mask";
import { canPublishStudioRasterLayer } from "../render/studio-raster-layer-write-guard";
import { STUDIO_AUTOMATIC_RASTER_PUBLICATION_ENABLED } from "../render/studio-raster-publication-feature";
import {
  appendStudioRasterRetouchDragPoint,
  thinStudioRasterRetouchPointsForApply,
} from "../render/studio-raster-retouch-stroke-sampling";
import { QUICKSHAPE_KIND_LABELS } from "../studio-quickshape-labels";
import { replaceStudioRawPenInkPreview, syncStudioRawPenInkPreviewAuthority } from "../studio-raw-pen-ink-preview";
import { appendStudioPendingRasterRetouchGesturePoint } from "../studio-retouch-raster-gesture";
import { normalizeMarqueeRect, selectIdsByMarquee } from "../studio-selection";
import {
  appendBrushPointInPlace,
  appendPolyLassoVertex,
  beginPolyLassoSession,
  beginSelectionDrag,
  canvasPointToNormalized,
  isSelectionUsable,
  normalizedPointToCanvas,
  pointInSelection,
  polyLassoCloseToStart,
  resolveSelectionCombineOverride,
  selectionCombineModeForOperation,
  shouldMoveSelectionMarquee,
  snapLassoPointToEdge,
  translateSelection,
  updateSelectionDrag,
  type SelectionFrame,
  type SelPoint,
} from "../studio-selection-tools";
import {
  EMPTY_FREEHAND_OBJECT_SNAP_LATCH,
  EMPTY_SMART_GUIDE_OVERLAY,
  SMART_GUIDE_EPSILON,
  SMART_SNAP_THRESHOLD,
  buildPointObjectSnapOverlay,
  buildSmartGuideOverlay,
  buildSmartGuideOverlayPreview,
  computeSmartSnap,
  planFreehandObjectSnapPoint,
  shouldApplyStrokeObjectSnap,
  shouldMutateStrokeWithObjectSnap,
  snapPointToObjectGuides,
  type GuideBox,
} from "../studio-smart-guides";
import {
  shouldSynchronizeStudioStagePointerPosition,
  snapshotStudioStagePointerBatchMapper,
  type StudioStagePointerBatchMapper,
} from "../canvas/studio-stage-pointer-coordinate";
import { resolveShiftFreehandTransition } from "../brush/studio-stroke-constrain";
import {
  normalizeStudioStrokeGuideScale,
  shouldShowStudioStrokeGuide,
} from "../brush/studio-stroke-guide";
import { resolveStudioStrokeObjectSnapTargets } from "../brush/studio-stroke-object-snap-cache";
import {
  createStudioPointerVelocityState,
  createStudioStrokeStabilizerBridge,
  createStudioStrokeStabilizerState,
  flushStudioStrokeStabilizerEndpoint,
  sampleStudioPointerVelocity,
  stabilizeStudioStrokeSample,
} from "../brush/studio-stroke-stabilizer";
import { claimStudioStrokeSurfaceLifecycle } from "../brush/studio-stroke-surface-route";
import {
  createStudioThinLineInkInputState,
  filterStudioThinLineInkInput,
  flushStudioThinLineInkInput,
  shouldFilterStudioThinLineInkInput,
} from "../studio-thin-line-ink-input-v1";
import { studioWorkAssetDestructiveEditReason } from "../studio-work-asset-edit-guard";
import type { StudioCrdtSceneGraphRuntime } from "../live/StudioLiveCollaborationProvider";

import type { StudioCrdtDocument } from "../live/studio-crdt-document";
import type { StudioBackground3DMagicFilterMask } from "../scene-3d/studio-3d-insert-contract";
import type { DrawEl, El, FrameEl, ImageEl } from "../studio-element-model";
import type { PageState } from "../studio-page-state";
import type Konva from "konva";

import { isStudioInkInputContractV2 } from "@/shared/lib/studio-ink-input-contract";

import type { StudioCuttoonStagePointersHost } from "./studio-cuttoon-stage-pointers-types";
import type { StudioCuttoonStagePointersApi } from "./studio-cuttoon-stage-pointers-api";

export function bindStudioCuttoonStagePointersFinish(
  h: StudioCuttoonStagePointersHost,
  api: StudioCuttoonStagePointersApi,
) {
  const {
    advancedFillTapGestureRef,
    advancedFillTapPayloadRef,
    advancedFillTouchPanRef,
    advancedRulerSnapRef,
    announceDrawingShortcut,
    bubbleShapeDragRef,
    bubbleShapeRafRef,
    cancelCanvasSelectionResize,
    causalPostCorrectionStateRef,
    collaborationAccessRef,
    commit,
    companionRuntimeRef,
    discardDrawingPointerSession,
    draftPreviewStoreRef,
    drawingCrdtStrokeActiveRef,
    drawingGesturePreviewPublisherRef,
    drawingInputSettingsRef,
    drawingPointerTransportRef,
    drawingRef,
    endLiveResourceEdit,
    finalizeLiveStrokeBackendAudit,
    finishLiquifyPointerSession,
    finishPendingRasterRetouchGesture,
    finishPixelSelectionPointerSession,
    flushPendingStrokeCommitsRef,
    freehandObjectSnapLatchRef,
    gpuLiveInkPinnedRef,
    groupResizeRef,
    hokusaiLiveStrokeRef,
    inkMeshLivePreviewRuntimeRef,
    isometricAxisRayRef,
    liquifyDragRef,
    liquifyHandledNativeEndEventsRef,
    liveDraftDirectRef,
    liveDraftVisualRef,
    liveDynamicBrushDraftDirectRef,
    liveDynamicBrushOverlayRendererRef,
    liveRetainedMediaDraftDirectRef,
    liveRetainedMediaOverlayRendererRef,
    liveInkOverlayRendererRef,
    liveWetInkDraftDirectRef,
    liveWetInkOverlayRendererRef,
    livingInkStrokeRef,
    livingInkWaterNoopStrokeIdsRef,
    masterEditMode,
    noteQuickShapePointerMoved,
    pendingBubbleShapeDraftRef,
    pendingRasterRetouchGestureRef,
    pendingStrokeCommitsRef,
    perspectiveRayRef,
    pixelDragRef,
    pixelSelectionHandledNativeEndEventsRef,
    postCorrection,
    preserveCorners,
    queueCommittedStrokeSurfaceHandoff,
    queueDeferredStrokeCommit,
    queueDeferredStrokePostprocess,
    quickShapeActive,
    releaseBubbleShapePointerCapture,
    releaseDrawingPointerSession,
    restorePendingStrokeCommits,
    setBubbleShapeDraft,
    setError,
    snapshotQuickShapeTracking,
    stopFixedRateStrokePump,
    stopQuickShapeTracking,
    strokeObjectSnapCacheRef,
    studioCrdtDocumentRef,
    studioCrdtSceneRuntimeRef,
    takePendingStrokeCommits,
    activePage,
    applySmartGuides,
    authorizedWorkAssetScopeId,
    canvasH,
    clearDraftPreview,
    DEFERRED_STROKE_COMMIT_IDLE_MS,
    elements,
    liveBrushPressureSamplesFor,
    liveInkStyleFor,
    scheduleLiveDrawPressure,
    salvageRejectedStroke,
    settleGpuLiveStroke,
    studioAuthUserId,
    studioCrdtOperationSyncReady,
  } = h;
  const cancelCanvasGroupDrag = (...args) => api.cancelCanvasGroupDrag(...args);
  const completeStudioLivingInkRejectedNoop = (...args) =>
    api.completeStudioLivingInkRejectedNoop(...args);
  const finishStudioSpecialistStroke = (...args) => api.finishStudioSpecialistStroke(...args);
  const hideBrushCursor = (...args) => api.hideBrushCursor(...args);
  const queueStudioRasterDrawPromotion = (...args) => api.queueStudioRasterDrawPromotion(...args);
  const sealStudioDrawReleaseInput = (...args) => api.sealStudioDrawReleaseInput(...args);
  function finishDrawingPointer(
    stage: Konva.Stage | null,
    pointerEvent: PointerEvent,
    options: { consumeReleaseSample?: boolean } = {}
  ) {
    if (!drawingRef.current && !requireStudioDrawingPointerTransport(drawingPointerTransportRef).getSession()) return;
    const finishingStrokeId = drawingRef.current?.id ?? null;
    let completedLiveStrokeBackendAudit = false;
    let gesturePreviewFinished = false;
    const inputSettings = drawingInputSettingsRef.current;
    stopFixedRateStrokePump();
    if (
      options.consumeReleaseSample !== false
      && quickShapeActive
      && (drawingRef.current?.kind ?? "freehand") === "freehand"
      && stage
    ) {
      stage.setPointersPositions(pointerEvent);
      const releasePoint = stage.getRelativePointerPosition();
      if (releasePoint) noteQuickShapePointerMoved(releasePoint);
    }
    const quickShapeSnapshot = snapshotQuickShapeTracking();
    // 지연 커밋 경로에서만 true — finally 의 초안 정리가 라이브 잉크를 표면에 남기게 한다.
        let deferInkCleanup = false;
        // GPU 지연 표면에는 후보정 이전의, 실제 라이브 표면과 동일한 권위 획을 유지한다.
        let authoritativeLiveStroke: DrawEl | null;
        // Release-planner geometry used to reauthor settled live ink before handoff (anti-flicker).
        let releaseAuthoritativeStroke: DrawEl | null = null;
        let immediateSurfaceHandoff: { pageId: string; strokeIds: string[] } | null = null;
        try {
      authoritativeLiveStroke = sealStudioDrawReleaseInput(
        stage,
        pointerEvent,
        options.consumeReleaseSample !== false,
      );
      if (authoritativeLiveStroke) {
        // Seal the upstream InProgressStroke from hardware-backed DrawEl samples only. The mesh
        // canvas is cleared immediately afterwards; normal release planning still owns document
        // commit, anti-flicker handoff, and every settled pixel.
        inkMeshLivePreviewRuntimeRef.current?.finish(
          authoritativeLiveStroke,
          liveBrushPressureSamplesFor(authoritativeLiveStroke),
        );
      } else {
        inkMeshLivePreviewRuntimeRef.current?.cancel();
      }
      if (drawingRef.current && isCompleteStudioDrawOp(drawingRef.current)) {
        const completedDrawing = drawingRef.current;
        completedLiveStrokeBackendAudit = true;
        const overlayRenderer = liveInkOverlayRendererRef.current;
        const releasePostCorrectionStrength = inputSettings?.postCorrection ?? postCorrection;
        const releasePreserveCorners = inputSettings?.preserveCorners ?? preserveCorners;
        const releaseCausalStateSealed = causalPostCorrectionStateRef.current?.phase === "sealed";
        const deferredPostprocessPlan = planStudioDeferredStrokePostprocess({
          stroke: completedDrawing,
          strength: releasePostCorrectionStrength,
          causalStateSealed: releaseCausalStateSealed,
          quickShapeActive,
          workerAvailable: typeof Worker === "function",
        });
        const planRelease = (postCorrectionStrength: number) => planStudioDrawPointerRelease({
          stroke: completedDrawing,
          quickShape: {
            active: quickShapeActive,
            ...quickShapeSnapshot,
          },
          postCorrection: {
            strength: postCorrectionStrength,
            preserveCorners: releasePreserveCorners,
            causalStateSealed: releaseCausalStateSealed,
          },
          commit: {
            masterEditMode,
            directLiveDraft: liveDraftDirectRef.current,
            directInkSurfaceAvailable:
              overlayRenderer.isActive
              || gpuLiveInkPinnedRef.current
              || liveDynamicBrushOverlayRendererRef.current.isActive
              || liveRetainedMediaOverlayRendererRef.current.isActive
              || liveWetInkOverlayRendererRef.current.isActive,
          },
        });
        // Worker-worthy post-correction can leave pointerup only when the exact live draft already
        // owns the 200ms deferred-commit window. Immediate tools retain synchronous semantics.
        let releasePlan = planRelease(deferredPostprocessPlan ? 0 : releasePostCorrectionStrength);
        if (deferredPostprocessPlan && releasePlan.commitMode !== "deferred") {
          releasePlan = planRelease(releasePostCorrectionStrength);
        }
        const finished = releasePlan.stroke;
        gesturePreviewFinished = drawingGesturePreviewPublisherRef.current.end(finished);
        if (livingInkWaterNoopStrokeIdsRef.current.has(finished.id)) {
          completeStudioLivingInkRejectedNoop(
            finished.id,
            "물리 route가 시작 전에 거부되었습니다.",
          );
          return;
        }
        if (hasStudioCanonicalVNextQualityShadowRuntime()) {
          // Explicitly opted-in material providers receive the exact final DrawEl once for a
          // non-authoritative parity audit. Existing retained Studio pixels stay authoritative:
          // this shadow returns no presentation payload and cannot perform a renderer handoff.
          void submitStudioCanonicalVNextQualityShadowFinalParity({
            element: finished,
          }).catch(() => undefined);
        }
        releaseAuthoritativeStroke = finished;
        if (
          liveWetInkDraftDirectRef.current
          || liveDynamicBrushDraftDirectRef.current
          || liveRetainedMediaDraftDirectRef.current
        ) {
          // Pointer-up post-correction may replace geometry after the last live append. Keep the
          // exact candidate source available until its selected overlay explicitly accepts seal.
          liveDraftVisualRef.current = finished;
        }
        if (releasePlan.quickShapeAnnouncementKind) {
          const kind = releasePlan.quickShapeAnnouncementKind;
          announceDrawingShortcut(`스마트 도형 · ${QUICKSHAPE_KIND_LABELS[kind] ?? kind}`);
        }
        const specialistRelease = finishStudioSpecialistStroke(finished);
        if (specialistRelease !== "ordinary") {
          deferInkCleanup = specialistRelease === "handled-preserve-ink";
          return;
        }
        const gpuPinnedAtRelease = gpuLiveInkPinnedRef.current;
        if (
          gpuPinnedAtRelease
          && !settleGpuLiveStroke(authoritativeLiveStroke ?? finished, finished)
        ) {
          // The selected provider did not seal its exact final operation. Remove the streamed CRDT
          // draft in the same pointer-up task; no canonical or Konva path may present this failed
          // stroke. Its finished geometry is parked for an explicit user restore, not lost.
          salvageRejectedStroke(finished, "WebGPU 라이브 잉크", "final-seal-missing");
          completedLiveStrokeBackendAudit = false;
          discardDrawingPointerSession();
          return;
        }
        const selectedOverlaySeal = liveWetInkDraftDirectRef.current
          ? {
              provider: "습식 매체",
              result: liveWetInkOverlayRendererRef.current.end(finished, {
                pageEpoch: activePage.id,
                hidden: finished.hidden === true,
              }),
            }
          : liveDynamicBrushDraftDirectRef.current
            ? {
                provider: "동적 브러시",
                result: liveDynamicBrushOverlayRendererRef.current.end(finished),
              }
            : liveRetainedMediaDraftDirectRef.current
              ? {
                  provider: "리테인드 매체",
                  result: liveRetainedMediaOverlayRendererRef.current.end(finished),
                }
              : null;
        if (selectedOverlaySeal && selectedOverlaySeal.result.status !== "settled") {
          // The immutable `finished` source remains the decision authority until this explicit
          // cancellation. It is never queued/committed through a different renderer by itself;
          // the geometry is parked for an explicit user restore instead of being deleted.
          completedLiveStrokeBackendAudit = false;
          const outcome = `${selectedOverlaySeal.result.status}/${selectedOverlaySeal.result.reason}`;
          const salvaged = salvageRejectedStroke(finished, selectedOverlaySeal.provider, outcome).action === "salvage";
          setError(
            `${selectedOverlaySeal.provider} 엔진이 획을 확정하지 못했습니다: ${outcome}. `
              + (salvaged ? "완성된 획은 상태 레일의 '획 복구'로 되살릴 수 있습니다. " : "")
              + "다른 렌더러를 선택한 뒤 새 획으로 다시 시도해 주세요.",
          );
          discardDrawingPointerSession();
          return;
        }
        // WebGPU always leaves pointer-up through the receipt-gated deferred transaction. Even an
        // otherwise immediate brush cannot commit before its asynchronous terminal frame arrives.
        const deferCommit = releasePlan.commitMode === "deferred" || gpuPinnedAtRelease;
        if (deferCommit) {
          deferInkCleanup = true;
          if (!liveDraftDirectRef.current && finished.mode !== "eraser") {
            // 최종 형태(postCorrection·스마트도형 반영)를 settled 프리뷰로 유지한 채 커밋을 미룬다.
            draftPreviewStoreRef.current.settle(finished);
          }
          queueDeferredStrokeCommit(finished);
          if (deferredPostprocessPlan) {
            queueDeferredStrokePostprocess(
              finished,
              deferredPostprocessPlan.normalizedStrength,
              releasePreserveCorners,
            );
          }
        } else {
          // Plan the bounded raster equivalent before the React commit, but keep the vector as a
          // durable fallback until a verified replay frame is ready. Panel-clipped/complex brushes
          // stay entirely on Konva so the migration never changes compositing semantics.
          const rasterWorkId = authorizedWorkAssetScopeId;
          const rasterDocument = studioCrdtDocumentRef.current;
          const rasterRuntime = studioCrdtSceneRuntimeRef.current;
          const rasterActorId = studioAuthUserId;
          const rasterPlan =
            STUDIO_AUTOMATIC_RASTER_PUBLICATION_ENABLED &&
            !masterEditMode && rasterWorkId && rasterDocument && rasterRuntime && rasterActorId &&
            studioCrdtOperationSyncReady &&
            !containingPanel(finished, elements)
              ? rasterRuntime.planRasterDrawPromotion({
                  element: finished,
                  pageId: activePage.id,
                  documentWidth: CANVAS_W,
                  documentHeight: canvasH,
                })
              : null;
          // 즉시 커밋 앞에 대기 배치가 있으면(같은 페이지) 같은 커밋에 합쳐 유실을 막는다.
          if (
            pendingStrokeCommitsRef.current
            && pendingStrokeCommitsRef.current.pageId !== activePage.id
          ) {
            flushPendingStrokeCommitsRef.current();
          }
          const merged = takePendingStrokeCommits();
          const baseElements = merged ? [...elements, ...merged.strokes] : elements;
          const committed = commit([...baseElements, finished]);
          if (committed && !masterEditMode && finished.mode !== "eraser") {
            if (liveDraftDirectRef.current) {
              deferInkCleanup = overlayRenderer.isActive
                || gpuLiveInkPinnedRef.current
                || liveDynamicBrushOverlayRendererRef.current.isActive
                || liveDynamicBrushOverlayRendererRef.current.hasSettledStrokes
                || liveRetainedMediaOverlayRendererRef.current.isActive
                || liveRetainedMediaOverlayRendererRef.current.hasSettledStrokes
                || liveWetInkOverlayRendererRef.current.isActive
                || liveWetInkOverlayRendererRef.current.hasSettledStrokes;
              if (!deferInkCleanup) {
                // This is the successful document-commit boundary, not renderer error recovery.
                // Keep an exact settled Konva copy until the committed main-layer draw receipt
                // arrives instead of exposing a blank handoff frame while the selected live
                // surface is unavailable.
                // Eraser dest-out remesh of the draft FIFO is a long task on an empty page.
                if (finished.mode !== "eraser") {
                  draftPreviewStoreRef.current.settle(finished);
                }
                deferInkCleanup = true;
              }
            } else {
              // 불투명도·도형 등 즉시 커밋 경로도 최종 초안을 실제 draw 영수증까지 유지한다.
              if (finished.mode !== "eraser") {
                draftPreviewStoreRef.current.settle(finished);
              }
              deferInkCleanup = true;
            }
          }
          if (!committed) {
            // A transient save/lock/CRDT publication race must not destroy the only completed
            // stroke. Requeue the new stroke together with any batch consumed above and retain its
            // exact live pixels until a later flush succeeds.
            restorePendingStrokeCommits({
              pageId: activePage.id,
              strokes: [...(merged?.strokes ?? []), finished],
              retryCount: merged?.retryCount ?? 0,
            });
            if (liveDraftDirectRef.current) {
              deferInkCleanup = true;
              if (
                !overlayRenderer.isActive
                && !liveDynamicBrushOverlayRendererRef.current.isActive
                && !liveDynamicBrushOverlayRendererRef.current.hasSettledStrokes
                && !liveRetainedMediaOverlayRendererRef.current.isActive
                && !liveRetainedMediaOverlayRendererRef.current.hasSettledStrokes
                && !liveWetInkOverlayRendererRef.current.isActive
                && !liveWetInkOverlayRendererRef.current.hasSettledStrokes
                && finished.mode !== "eraser"
              ) {
                draftPreviewStoreRef.current.settle(finished);
              }
            } else {
              if (finished.mode !== "eraser") {
                draftPreviewStoreRef.current.settle(finished);
              }
              deferInkCleanup = true;
            }
          }
          if (committed && (merged || deferInkCleanup)) {
            immediateSurfaceHandoff = {
              pageId: activePage.id,
              strokeIds: [
                ...(merged?.strokes.map((stroke) => stroke.id) ?? []),
                finished.id,
              ],
            };
          }
          if (
            committed && rasterPlan && rasterWorkId && rasterDocument &&
            rasterRuntime && rasterActorId
          ) {
            queueStudioRasterDrawPromotion({
              plan: rasterPlan,
              pageId: activePage.id,
              layerId: (finished as DrawEl & { groupId?: string }).groupId ?? "page-root",
              workId: rasterWorkId,
              actorId: rasterActorId,
              document: rasterDocument,
              runtime: rasterRuntime,
              accessGeneration: collaborationAccessRef.current.accessGeneration,
            });
          }
          if (
            committed && merged &&
            STUDIO_AUTOMATIC_RASTER_PUBLICATION_ENABLED &&
            !masterEditMode && rasterWorkId && rasterDocument && rasterRuntime && rasterActorId &&
            studioCrdtOperationSyncReady
          ) {
            for (const strokeEl of merged.strokes) {
              if (containingPanel(strokeEl, elements)) continue;
              const plan = rasterRuntime.planRasterDrawPromotion({
                element: strokeEl,
                pageId: activePage.id,
                documentWidth: CANVAS_W,
                documentHeight: canvasH,
              });
              if (!plan) continue;
              queueStudioRasterDrawPromotion({
                plan,
                pageId: activePage.id,
                layerId: (strokeEl as DrawEl & { groupId?: string }).groupId ?? "page-root",
                workId: rasterWorkId,
                actorId: rasterActorId,
                document: rasterDocument,
                runtime: rasterRuntime,
                accessGeneration: collaborationAccessRef.current.accessGeneration,
              });
            }
          }
        }
      } else if (drawingRef.current && drawingCrdtStrokeActiveRef.current) {
        // Tiny geometric gestures below the intentional completion threshold are discarded locally.
        // Remove their streaming CRDT draft as well so a hidden `drawing` record cannot reappear on
        // reconnect or pollute the shared frontier.
        try {
          studioCrdtDocumentRef.current?.deleteStroke(drawingRef.current.id);
        } catch (cause) {
          setError(
            cause instanceof Error
              ? `미완성 획 정리: ${cause.message}`
              : "미완성 실시간 획을 정리하지 못했습니다."
          );
        }
      }
    } finally {
      if (!gesturePreviewFinished) {
        drawingGesturePreviewPublisherRef.current.cancel(finishingStrokeId ?? undefined);
      }
      // Always clear the hold timer after commit/promote so a second pointerup cannot re-use it.
      stopQuickShapeTracking();
      if (finishingStrokeId) livingInkWaterNoopStrokeIdsRef.current.delete(finishingStrokeId);
      // No error or stale tool ref may strand DOM capture or a predicted RAF after the stroke ends.
      releaseDrawingPointerSession();
      drawingRef.current = null;
      companionRuntimeRef.current?.schedulePublish();
      perspectiveRayRef.current = null;
      isometricAxisRayRef.current = null;
      advancedRulerSnapRef.current = null;
      scheduleLiveDrawPressure(null);
      applySmartGuides(EMPTY_SMART_GUIDE_OVERLAY);
      strokeObjectSnapCacheRef.current = null;
      freehandObjectSnapLatchRef.current = EMPTY_FREEHAND_OBJECT_SNAP_LATCH;
      finalizeLiveStrokeBackendAudit(
        finishingStrokeId,
        completedLiveStrokeBackendAudit && deferInkCleanup
      );
      clearDraftPreview({ preserveInkForDeferredCommit: deferInkCleanup });
      // Living Ink and Hokusai retain their final DrawEl only inside their selected-provider
      // transaction. Until an exact material frame/canonical image receipt arrives, the canvas
      // intentionally remains hidden; pointer-up never restores a Konva vector shadow.
      // Re-rasterize the newest settled overlay stroke from the release-planner geometry so the
      // live Canvas footprint matches Konva/causal planning before committed-ink handoff. Without
      // this, residual thinning / endpoint promotion can leave a one-frame pop when settled ink is
      // released after mainLayer.draw().
      // Pressures must use the same brush-alias live channel as appendFrom / Konva causal dabs —
      // raw DrawEl.pressures make alias brushes flash a different radius at pointerup.
      if (
        deferInkCleanup
        && releaseAuthoritativeStroke
        && releaseAuthoritativeStroke.mode !== "eraser"
        && liveInkOverlayRendererRef.current.hasSettledStrokes
      ) {
        liveInkOverlayRendererRef.current.reauthorLastSettledFromDocumentPoints({
          style: liveInkStyleFor(releaseAuthoritativeStroke),
          points: releaseAuthoritativeStroke.points,
          pressures: liveBrushPressureSamplesFor(releaseAuthoritativeStroke),
        });
      }
      if (immediateSurfaceHandoff) {
        queueCommittedStrokeSurfaceHandoff(
          immediateSurfaceHandoff.pageId,
          immediateSurfaceHandoff.strokeIds
        );
      }
      endLiveResourceEdit();
      // 획 시작이 보류시킨 배치 타이머를 반드시 복원한다(불완전 획으로 끝나도 배치가
      // 영원히 대기하지 않도록). 큐잉이 방금 타이머를 잡았다면 여기서는 건드리지 않는다.
      const strandedBatch = pendingStrokeCommitsRef.current;
      if (strandedBatch && strandedBatch.timer === null) {
        strandedBatch.timer = globalThis.setTimeout(function flushStrandedDeferredStrokeCommit() {
          const current = pendingStrokeCommitsRef.current;
          if (!current) return;
          if (drawingRef.current) {
            current.timer = globalThis.setTimeout(
              flushStrandedDeferredStrokeCommit,
              DEFERRED_STROKE_COMMIT_IDLE_MS,
            );
            return;
          }
          flushPendingStrokeCommitsRef.current();
        }, DEFERRED_STROKE_COMMIT_IDLE_MS);
      }
    }
  }
  function onStagePointerCancel(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    const pointerEvent = e.evt as PointerEvent;
    hideBrushCursor();
    if (groupResizeRef.current) {
      cancelCanvasSelectionResize();
      return;
    }
    if (liquifyHandledNativeEndEventsRef.current.delete(pointerEvent)) return;
    if (pixelSelectionHandledNativeEndEventsRef.current.delete(pointerEvent)) return;
    if (requireStudioDrawingPointerTransport(drawingPointerTransportRef).consumeHandledNativeEnd(pointerEvent)) return;
    if (pendingRasterRetouchGestureRef.current) {
      if (!finishPendingRasterRetouchGesture(pointerEvent, true, e.target.getStage())) return;
      return;
    }
    const pointerId = Number.isFinite(pointerEvent.pointerId) ? pointerEvent.pointerId : 1;
    // Drawing owns its matching cancel before any stale tool session can early-return. A foreign
    // pointer (typically a palm) cannot cancel the pen that opened the stroke.
    const drawingPointerSession = requireStudioDrawingPointerTransport(drawingPointerTransportRef).getSession();
    if (drawingRef.current || drawingPointerSession) {
      if (drawingPointerSession && !isStudioStrokePointerEvent(drawingPointerSession, pointerEvent)) {
        return;
      }
      if (
        drawingPointerSession
        && shouldCommitStudioStrokeOnPointerCancel(drawingPointerSession, pointerEvent)
      ) {
        finishDrawingPointer(e.target.getStage(), pointerEvent, { consumeReleaseSample: false });
      } else {
        discardDrawingPointerSession();
      }
      return;
    }
    if (liquifyDragRef.current) {
      if (!isStudioLiquifyPointerOwner(liquifyDragRef.current, pointerEvent)) return;
      finishLiquifyPointerSession(pointerEvent, true, e.target.getStage());
      return;
    }
    if (pixelDragRef.current) {
      if (!finishPixelSelectionPointerSession(pointerEvent, true)) return;
      return;
    }
    if (bubbleShapeDragRef.current) {
      if (bubbleShapeDragRef.current.pointerId !== pointerId) return;
      releaseBubbleShapePointerCapture(bubbleShapeDragRef.current);
      bubbleShapeDragRef.current = null;
      pendingBubbleShapeDraftRef.current = null;
      if (bubbleShapeRafRef.current !== null) {
        globalThis.cancelAnimationFrame(bubbleShapeRafRef.current);
        bubbleShapeRafRef.current = null;
      }
      setBubbleShapeDraft(null);
      return;
    }
    const current = advancedFillTapGestureRef.current;
    if (current) {
      const outcome = endStudioAdvancedFillTap(current, pointerId, true);
      advancedFillTapGestureRef.current = outcome.gesture;
      if (advancedFillTouchPanRef.current?.pointerId === pointerId) {
        advancedFillTouchPanRef.current = null;
      }
      if (!outcome.gesture) advancedFillTapPayloadRef.current = null;
      return;
    }
    if (cancelCanvasGroupDrag()) return;
  }
  api.finishDrawingPointer = finishDrawingPointer;
  api.onStagePointerCancel = onStagePointerCancel;
}
