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

export function bindStudioCuttoonStagePointersBatch(
  h: StudioCuttoonStagePointersHost,
  api: StudioCuttoonStagePointersApi,
) {
  const {
    advancedRulerSnapRef,
    causalPostCorrectionStateRef,
    drawingCrdtPublisherRef,
    drawingCrdtStrokeActiveRef,
    drawingFixedRateFilterRef,
    drawingFixedRateOwnedPointsRef,
    drawingFixedRateSampleClockRef,
    drawingImmediateBatchMutationRef,
    drawingImmediateCausalInputRef,
    drawingLastAuthoritativePointerRef,
    drawingPointerTransportRef,
    drawingPredictionBatchMutationRef,
    drawingPredictionPreviewRef,
    drawingRef,
    drawingStabilizerRef,
    drawingVelocityPressureRef,
    drawingVelocityRef,
    gpuLiveInkPinnedRef,
    gpuLiveSourceJournalRef,
    inkMeshLivePreviewModuleRef,
    inkMeshLivePreviewRuntimeRef,
    isometricAxisRayRef,
    liveDraftDirectRef,
    liveDynamicBrushDraftDirectRef,
    liveDynamicBrushOverlayRendererRef,
    liveRetainedMediaDraftDirectRef,
    liveRetainedMediaOverlayRendererRef,
    liveInkOverlayRendererRef,
    liveInkPredictionRendererRef,
    liveStampDraftDirectRef,
    liveStampOverlayRendererRef,
    liveWetInkDraftDirectRef,
    liveWetInkOverlayRendererRef,
    perspectiveRayRef,
    predictedInkTailStateRef,
    rawPenInkPreviewStateRef,
    session,
    stagePointerFrameMapperCacheRef,
    studioCrdtDocumentRef,
    liveInkStyleFor,
    previewCausalPostCorrectionTail,
    replacePredictedInkTail,
    scheduleDraft,
  } = h;
  const appendFreehandStrokePoint = (...args) => api.appendFreehandStrokePoint(...args);
  const publishAuthoritativeFreehandSuffix = (...args) => api.publishAuthoritativeFreehandSuffix(...args);
  function appendDrawingCrdtSampleSuffix(drawing: DrawEl, startSample: number): void {
    const crdtDocument = studioCrdtDocumentRef.current;
    if (!crdtDocument || !drawingCrdtStrokeActiveRef.current) return;
    drawingCrdtPublisherRef.current.append(drawing.id, {
      snapshot: drawing,
      startSample,
      publish: (latestDrawing: any, earliestSample: any) => {
        if (
          !drawingCrdtStrokeActiveRef.current
          || studioCrdtDocumentRef.current !== crdtDocument
        ) {
          throw new Error("실시간 협업 문서가 획 전송 전에 변경되었습니다.");
        }
        const samples = studioDrawElementSampleSlice(latestDrawing, earliestSample);
        if (samples) crdtDocument.appendStrokeSamples(latestDrawing.id, samples);
      },
    });
  }
  function consumeFreehandPointerBatch(
    stage: Konva.Stage,
    pointerEvent: PointerEvent,
    includePredicted: boolean,
    options: {
      dispatchedPressureOverride?: number;
      authoritativeSource?: "coalesced-or-parent" | "parent-only";
      coordinateMapper?: StudioStagePointerBatchMapper;
    } = {}
  ): boolean {
    const session = requireStudioDrawingPointerTransport(drawingPointerTransportRef).getSession();
    if (!session || !isStudioStrokePointerEvent(session, pointerEvent)) return false;

    // Predictions are always routed to a physically separate replaceable surface. Shift gestures
    // replace the whole path rather than a suffix, so they intentionally stay hardware-only.
    const predictionIsReplaceable = includePredicted && !pointerEvent.shiftKey;
    const batch = collectStudioStrokePointerBatch(session, pointerEvent, {
      includePredicted: predictionIsReplaceable,
      authoritativeSource: options.authoritativeSource,
    });
    requireStudioDrawingPointerTransport(drawingPointerTransportRef).replaceSession(batch.session);
    // Exact duplicate hardware deliveries have no document or preview work.
    if (batch.authoritative.length === 0 && batch.predicted.length === 0) return false;
    const sampleClock = drawingFixedRateSampleClockRef.current;
    const sampleClockTransition = sampleClock && batch.authoritative.length > 0
      ? normalizeFixedRateStrokeSampleTimeStamps(
          sampleClock,
          batch.authoritative.map((sample) => (
            typeof sample.timeStamp === "number" ? sample.timeStamp : pointerEvent.timeStamp
          )),
          globalThis.performance?.now?.() ?? pointerEvent.timeStamp
        )
      : null;
    if (sampleClockTransition) {
      drawingFixedRateSampleClockRef.current = sampleClockTransition.state;
    }
    // One browser delivery shares one layout/Stage transform. Mapping the full coalesced and
    // predicted batch from one snapshot avoids a DOM read plus transform inversion per sample.
    const coordinateMapper = options.coordinateMapper
      ?? stagePointerFrameMapperCacheRef.current?.mapperFor(stage)
      ?? snapshotStudioStagePointerBatchMapper(stage);
    const crdtSampleStart = Math.floor((drawingRef.current?.points.length ?? 0) / 2);
    const activeDrawing = drawingRef.current;
    const mutableDirectSurfaceActive = (
      (
        liveDraftDirectRef.current
        && (
          liveInkOverlayRendererRef.current.isActive
          || (activeDrawing !== null && isStudioPixelPencilRenderMode(activeDrawing.brush))
        )
      )
      || (
        liveStampDraftDirectRef.current
        && liveStampOverlayRendererRef.current.isActive
      )
      || (
        liveDynamicBrushDraftDirectRef.current
        && liveDynamicBrushOverlayRendererRef.current.isActive
      )
      || (
        liveRetainedMediaDraftDirectRef.current
        && liveRetainedMediaOverlayRendererRef.current.isActive
      )
      || (
        liveWetInkDraftDirectRef.current
        && liveWetInkOverlayRendererRef.current.isActive
      )
    );
    const compactGpuSourceJournalActive = gpuLiveInkPinnedRef.current
      && gpuLiveSourceJournalRef.current !== null;
    const immediateBatchMutation = !compactGpuSourceJournalActive
      && shouldOwnStudioCoalescedBatchDraft({
        authoritativeSampleCount: batch.authoritative.length,
        gpuPinned: gpuLiveInkPinnedRef.current,
        fixedRateFilterActive: drawingFixedRateFilterRef.current !== null,
        immediateCausalInput: drawingImmediateCausalInputRef.current,
        mutableDirectSurfaceActive,
    });
    if (immediateBatchMutation && drawingRef.current) {
      const current = drawingRef.current;
      // Clone once per stroke — not once per browser delivery. The first delivery still takes the
      // private copy that keeps every previously published draft immutable; afterwards the arrays
      // carry the same ownership token appendFixedRateStrokeSamples already uses, so the batch
      // simply keeps appending into the draft it made. That removes twelve O(points) prefix copies
      // from every later delivery (the old comment's admitted O(events × points)) and, because
      // `pressures` keeps its identity, the alias-mapped prefix cache in StudioPage stays hot
      // instead of remapping the whole stroke each frame.
      // Any path that replaces `points` with a fresh array (QuickShape regularization, the Shift
      // replace-in-place gesture, a new stroke) breaks the token and pays exactly one clone again.
      const ownsBatchArrays = current.points === drawingFixedRateOwnedPointsRef.current;
      const reuseOrCloneBatch = <T,>(values: T[] | undefined): T[] | undefined => {
        if (!values) return values;
        return ownsBatchArrays ? values : [...values];
      };
      const batchDraft: DrawEl = {
        ...current,
        points: ownsBatchArrays ? current.points : [...current.points],
        pressures: reuseOrCloneBatch(current.pressures),
        tiltXs: reuseOrCloneBatch(current.tiltXs),
        tiltYs: reuseOrCloneBatch(current.tiltYs),
        twists: reuseOrCloneBatch(current.twists),
        speeds: reuseOrCloneBatch(current.speeds),
        tangentialPressures: reuseOrCloneBatch(current.tangentialPressures),
        altitudeAngles: reuseOrCloneBatch(current.altitudeAngles),
        azimuthAngles: reuseOrCloneBatch(current.azimuthAngles),
        contactWidths: reuseOrCloneBatch(current.contactWidths),
        contactHeights: reuseOrCloneBatch(current.contactHeights),
        sampleTimeOffsets: reuseOrCloneBatch(current.sampleTimeOffsets),
      };
      drawingRef.current = batchDraft;
      drawingFixedRateOwnedPointsRef.current = batchDraft.points;
      drawingImmediateBatchMutationRef.current = true;
    }
    try {
      for (const [sampleIndex, sample] of batch.authoritative.entries()) {
        const point = coordinateMapper.pointFor(sample);
        if (point) {
          drawingLastAuthoritativePointerRef.current = sample;
          appendFreehandStrokePoint(
            point,
            sample,
            sample === pointerEvent ? options.dispatchedPressureOverride : undefined,
            sampleClockTransition?.timeStamps[sampleIndex]
          );
        }
      }
      drawingImmediateBatchMutationRef.current = false;

      const authoritativeDrawing = batch.authoritative.length > 0
        ? publishAuthoritativeFreehandSuffix(crdtSampleStart)
        : drawingRef.current;
      const authoritativePointCount = Math.floor((authoritativeDrawing?.points.length ?? 0) / 2);
      const rawPreviewState = rawPenInkPreviewStateRef.current;
      const canonicalPredictionTail = predictedInkTailStateRef.current;
      if (
        authoritativeDrawing
        && rawPreviewState
        && canonicalPredictionTail
        && session.pointerId === rawPreviewState.pointerId
      ) {
        const rawSync = syncStudioRawPenInkPreviewAuthority(rawPreviewState, {
          pointerId: rawPreviewState.pointerId,
          generation: rawPreviewState.generation,
          authoritativeTail: canonicalPredictionTail,
        });
        rawPenInkPreviewStateRef.current = rawSync.state;
        // The canonical append has already cleared the old transient tail. Applying the same
        // bounded command here keeps the wrapper lifecycle explicit before native predictions win.
        liveInkPredictionRendererRef.current.apply(
          rawSync.predictionSurface,
          liveInkStyleFor(authoritativeDrawing),
        );
      }
      if (
        immediateBatchMutation
        && authoritativePointCount > crdtSampleStart
        && !liveDraftDirectRef.current
        && !liveStampDraftDirectRef.current
      ) {
        scheduleDraft(authoritativeDrawing);
      }
      if (
        authoritativeDrawing
        && batch.predicted.length > 0
        && !liveStampDraftDirectRef.current
      ) {
        // Predictions make the tip feel closer to the pen, but never advance drawingRef/history.
        // Ruler locks are also restored so an estimate cannot choose the permanent perspective ray.
        const authoritativePerspectiveRay = perspectiveRayRef.current;
        const authoritativeIsometricRay = isometricAxisRayRef.current;
        const authoritativeAdvancedRulerSnap = advancedRulerSnapRef.current;
        const authoritativeFixedRateFilter = drawingFixedRateFilterRef.current;
        const authoritativeStabilizer = drawingStabilizerRef.current;
        const authoritativeVelocity = drawingVelocityRef.current;
        const authoritativeVelocityPressure = drawingVelocityPressureRef.current;
        try {
          drawingPredictionPreviewRef.current = true;
          const suffixDraftCandidate = liveDraftDirectRef.current && predictedInkTailStateRef.current
            ? planStudioPredictedInkSuffixDraft({
                points: authoritativeDrawing.points,
                pressures: authoritativeDrawing.pressures,
                tiltXs: authoritativeDrawing.tiltXs,
                tiltYs: authoritativeDrawing.tiltYs,
                twists: authoritativeDrawing.twists,
                speeds: authoritativeDrawing.speeds,
                tangentialPressures: authoritativeDrawing.tangentialPressures,
                fallbackPressure: studioInkFallbackPressure(authoritativeDrawing.pressureModel),
              })
            : null;
          const suffixDraft = suffixDraftCandidate?.authoritativeSampleCount === authoritativePointCount
            ? suffixDraftCandidate
            : null;
          const predictionStartSampleIndex = suffixDraft?.draftPredictionStartSampleIndex
            ?? authoritativePointCount;
          // Direct replaceable-tail rendering needs only origin + current endpoint, so its work is
          // independent of an already-long stroke. Causal correction and Konva fallbacks retain the
          // complete private clone because those paths still render or compare the whole preview.
          drawingRef.current = {
            ...authoritativeDrawing,
            points: suffixDraft?.points ?? [...authoritativeDrawing.points],
            pressures: suffixDraft
              ? suffixDraft.pressures
              : authoritativeDrawing.pressures ? [...authoritativeDrawing.pressures] : undefined,
            tiltXs: suffixDraft
              ? suffixDraft.tiltXs
              : authoritativeDrawing.tiltXs ? [...authoritativeDrawing.tiltXs] : undefined,
            tiltYs: suffixDraft
              ? suffixDraft.tiltYs
              : authoritativeDrawing.tiltYs ? [...authoritativeDrawing.tiltYs] : undefined,
            twists: suffixDraft
              ? suffixDraft.twists
              : authoritativeDrawing.twists ? [...authoritativeDrawing.twists] : undefined,
            speeds: suffixDraft
              ? suffixDraft.speeds
              : authoritativeDrawing.speeds ? [...authoritativeDrawing.speeds] : undefined,
            tangentialPressures: suffixDraft
              ? suffixDraft.tangentialPressures
              : authoritativeDrawing.tangentialPressures
                ? [...authoritativeDrawing.tangentialPressures]
                : undefined,
            altitudeAngles: authoritativeDrawing.altitudeAngles
              ? [...authoritativeDrawing.altitudeAngles]
              : undefined,
            azimuthAngles: authoritativeDrawing.azimuthAngles
              ? [...authoritativeDrawing.azimuthAngles]
              : undefined,
            contactWidths: authoritativeDrawing.contactWidths
              ? [...authoritativeDrawing.contactWidths]
              : undefined,
            contactHeights: authoritativeDrawing.contactHeights
              ? [...authoritativeDrawing.contactHeights]
              : undefined,
            sampleTimeOffsets: authoritativeDrawing.sampleTimeOffsets
              ? [...authoritativeDrawing.sampleTimeOffsets]
              : undefined,
          };
          drawingPredictionBatchMutationRef.current = true;
          for (const sample of batch.predicted) {
            const point = coordinateMapper.pointFor(sample);
            if (point) appendFreehandStrokePoint(point, sample);
          }
          const predictedPreview = drawingRef.current;
          drawingRef.current = authoritativeDrawing;
          if (predictedPreview && predictedPreview !== authoritativeDrawing) {
            if (liveDraftDirectRef.current && causalPostCorrectionStateRef.current) {
              previewCausalPostCorrectionTail(predictedPreview, authoritativePointCount);
            } else if (liveDraftDirectRef.current && predictedInkTailStateRef.current) {
              replacePredictedInkTail(predictedPreview, predictionStartSampleIndex);
            } else {
              scheduleDraft(predictedPreview);
            }
            const inkMeshModule = inkMeshLivePreviewModuleRef.current;
            const inkMeshRuntime = inkMeshLivePreviewRuntimeRef.current;
            if (inkMeshModule && inkMeshRuntime) {
              try {
                const meshPreview = suffixDraft
                  ? inkMeshModule.expandStudioInkMeshPredictedSuffix(
                      authoritativeDrawing,
                      predictedPreview,
                      predictionStartSampleIndex,
                    )
                  : predictedPreview;
                const meshReceipt = inkMeshRuntime.previewPredicted(
                  meshPreview,
                  authoritativePointCount,
                  studioLiveBrushPressureSamples(meshPreview),
                );
                if (inkMeshModule.isStudioInkMeshRenderedReceipt(meshReceipt)) {
                  // Canvas prediction remains the fail-visible CPU path, but exactly one transient
                  // tail is visible in this frame. Its state stays intact so device loss can resume
                  // on the next browser delivery without touching DrawEl/history.
                  liveInkPredictionRendererRef.current.clear();
                }
              } catch {
                // A malformed compact preview is non-authoritative. Drop only the mesh island and
                // leave the already-rendered Canvas2D prediction + Perfect Freehand path untouched.
                inkMeshRuntime.cancel();
              }
            }
          }
        } finally {
          drawingPredictionBatchMutationRef.current = false;
          drawingPredictionPreviewRef.current = false;
          drawingRef.current = authoritativeDrawing;
          perspectiveRayRef.current = authoritativePerspectiveRay;
          isometricAxisRayRef.current = authoritativeIsometricRay;
          advancedRulerSnapRef.current = authoritativeAdvancedRulerSnap;
          // Predicted timestamps are in the future by definition. They may draw only on the
          // replaceable preview surface and must never advance the authoritative 5ms filter clock,
          // otherwise the following real samples are clamped to that future tick and visibly stall.
          drawingFixedRateFilterRef.current = authoritativeFixedRateFilter;
          drawingStabilizerRef.current = authoritativeStabilizer;
          drawingVelocityRef.current = authoritativeVelocity;
          drawingVelocityPressureRef.current = authoritativeVelocityPressure;
        }
      }
    } finally {
      drawingImmediateBatchMutationRef.current = false;
      drawingPredictionBatchMutationRef.current = false;
      // Avoid a second Stage layout read unless the event route is outside Stage.
      if (
        shouldSynchronizeStudioStagePointerPosition(
          stage.getContent(),
          pointerEvent.target
        )
      ) {
        stage.setPointersPositions(pointerEvent);
      }
    }
    return true;
  }
  api.appendDrawingCrdtSampleSuffix = appendDrawingCrdtSampleSuffix;
  api.consumeFreehandPointerBatch = consumeFreehandPointerBatch;
}
