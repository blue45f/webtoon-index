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

export function bindStudioCuttoonStagePointersPublish(
  h: StudioCuttoonStagePointersHost,
  api: StudioCuttoonStagePointersApi,
) {
  const {
    appSettingsRef,
    appendStudioHokusaiAuthoritativeSuffix,
    appendStudioLivingInkAuthoritativeSuffix,
    brushCursorRef,
    causalPostCorrectionStateRef,
    colorWheelTimerRef,
    currentRawPenInkPreviewEligibility,
    discardDrawingPointerSession,
    drawMode,
    drawingFixedRateFilterRef,
    drawingFixedRatePumpClockRef,
    drawingFixedRatePumpFrameRef,
    drawingFixedRateSampleClockRef,
    drawingGesturePreviewPublisherRef,
    drawingInputSettingsRef,
    drawingLastAuthoritativePointerRef,
    drawingPointerTransportRef,
    drawingRef,
    drawingVelocityPressureRef,
    inkMeshLivePreviewRuntimeRef,
    liveDraftDirectRef,
    liveInkPredictionRendererRef,
    liveStampDraftDirectRef,
    noteQuickShapePointerMoved,
    predictedInkTailStateRef,
    pressureCurve,
    pressureMinSize,
    rawPenInkPreviewStateRef,
    session,
    stabilizer,
    stagePointerFrameMapperCacheRef,
    stageRef,
    strokeGuideRef,
    tool,
    useVelocityPressure,
    velocitySensitivity,
    appendAuthoritativePredictedInkState,
    appendCausalPostCorrectionState,
    flushDirectLiveDraftNow,
    liveBrushPressureSamplesFor,
    liveInkStyleFor,
  } = h;
  const appendDrawingCrdtSampleSuffix = (...args) => api.appendDrawingCrdtSampleSuffix(...args);
  const appendFixedRateStrokeSamples = (...args) => api.appendFixedRateStrokeSamples(...args);
  const consumeFreehandPointerBatch = (...args) => api.consumeFreehandPointerBatch(...args);
  const finishDrawingPointer = (...args) => api.finishDrawingPointer(...args);
  const updateBrushCursor = (...args) => api.updateBrushCursor(...args);
  const updateStrokeGuide = (...args) => api.updateStrokeGuide(...args);
  function publishAuthoritativeFreehandSuffix(startSample: number): DrawEl | null {
    const authoritativeDrawing = drawingRef.current;
    if (!authoritativeDrawing) return null;
    // The same coalesced suffix that becomes DrawEl/CRDT authority advances Google Ink's retained
    // InProgressStroke. Any previously displayed estimate is replaced by this exact prefix before
    // the normal live surface flushes; no predicted sample enters this call.
    inkMeshLivePreviewRuntimeRef.current?.synchronizeAuthoritative(
      authoritativeDrawing,
      liveBrushPressureSamplesFor(authoritativeDrawing),
    );
    appendStudioLivingInkAuthoritativeSuffix(authoritativeDrawing, startSample);
    appendStudioHokusaiAuthoritativeSuffix(authoritativeDrawing, startSample);
    drawingGesturePreviewPublisherRef.current.append(authoritativeDrawing, startSample);
    if (liveDraftDirectRef.current || liveStampDraftDirectRef.current) {
      if (causalPostCorrectionStateRef.current) {
        appendCausalPostCorrectionState(authoritativeDrawing, startSample);
      } else if (predictedInkTailStateRef.current) {
        // Every real browser suffix invalidates the previous estimate first. Only the new durable
        // suffix advances this state; the append-only live surface is never cleared or replaced.
        appendAuthoritativePredictedInkState(authoritativeDrawing, startSample);
      }
      // The pointer task or frame pump already owns the earliest available presentation slot.
      // Publish Canvas/WebGPU suffixes now instead of adding another display frame of latency.
      flushDirectLiveDraftNow(authoritativeDrawing);
    }
    // Local ink is the interaction-critical path. Yjs encoding/broadcast is coalesced behind a
    // paint opportunity; pointer release flushes the same queue before final CRDT reconciliation.
    appendDrawingCrdtSampleSuffix(authoritativeDrawing, startSample);
    return authoritativeDrawing;
  }

  drawingFixedRatePumpFrameRef.current = (frameTimeStamp: any) => {
    const drawing = drawingRef.current;
    const session = requireStudioDrawingPointerTransport(drawingPointerTransportRef).getSession();
    const filter = drawingFixedRateFilterRef.current;
    const clock = drawingFixedRatePumpClockRef.current;
    const pointerSample = drawingLastAuthoritativePointerRef.current;
    if (
      !drawing
      || !session
      || !filter
      || !clock
      || !pointerSample
      || (drawing.kind ?? "freehand") !== "freehand"
      || !isStudioStrokePointerEvent(session, pointerSample)
    ) return false;

    const frameClock = advanceFixedRateStrokeFrameClock(clock, frameTimeStamp);
    drawingFixedRatePumpClockRef.current = frameClock.state;
    const sampleClock = drawingFixedRateSampleClockRef.current;
    if (sampleClock) {
      drawingFixedRateSampleClockRef.current = advanceFixedRateStrokeSampleClockFloor(
        sampleClock,
        frameClock.watermark
      );
    }
    const crdtSampleStart = Math.floor(drawing.points.length / 2);
    const transition = transitionFixedRateStrokeFilter(filter, {
      type: "advance",
      timeStamp: frameClock.watermark,
    });
    drawingFixedRateFilterRef.current = transition.state;
    appendFixedRateStrokeSamples(transition.emitted, pointerSample, 0);
    const nextSampleCount = Math.floor((drawingRef.current?.points.length ?? 0) / 2);
    if (nextSampleCount > crdtSampleStart) {
      publishAuthoritativeFreehandSuffix(crdtSampleStart);
    }
    const stage = stageRef.current;
    const pointerMapperCache = stagePointerFrameMapperCacheRef.current;
    const strokeGuidePointer = stage && pointerMapperCache
      ? pointerMapperCache.mapperFor(stage).pointFor(pointerSample)
      : null;
    updateStrokeGuide(
      strokeGuidePointer?.x ?? Number.NaN,
      strokeGuidePointer?.y ?? Number.NaN,
      true,
    );
    return true;
  };

  // Native listeners stay mounted for one contact, while these ports always point at this render's
  // drawing settings, document, draft surfaces and finish coordinator.
  requireStudioDrawingPointerTransport(drawingPointerTransportRef).updatePorts({
    getLastAuthoritativePointer: () => drawingLastAuthoritativePointerRef.current,
    onAuthoritativeMove: (pointerEvent) => {
      const session = requireStudioDrawingPointerTransport(drawingPointerTransportRef).getSession();
      const drawing = drawingRef.current;
      if (
        tool !== "draw"
        || !session
        || !drawing
        || (drawing.kind ?? "freehand") !== "freehand"
        || !isStudioStrokePointerEvent(session, pointerEvent)
      ) return;
      const stage = stageRef.current;
      if (!stage) return;
      if (!consumeFreehandPointerBatch(
        stage,
        pointerEvent,
        canCollectStudioPointerPredictionsForActiveTail(
          STUDIO_POINTER_PREDICTION_ENABLED,
          session,
          predictedInkTailStateRef.current !== null
        ),
      )) return;
      const pointerMapperCache = stagePointerFrameMapperCacheRef.current;
      if (!pointerMapperCache) return;
      // Reuse the mapper acquired while consuming the batch.
      const contactPoint = pointerMapperCache.mapperFor(stage).pointFor(pointerEvent);
      // Authoritative ink wins the native pointer task. The cursor keeps only the latest position
      // and paints once on the next frame, so a high-Hz pen cannot make a cosmetic layer delay ink.
      updateBrushCursor(stage, pointerEvent, contactPoint, true);
      updateStrokeGuide(
        contactPoint?.x ?? Number.NaN,
        contactPoint?.y ?? Number.NaN,
        true,
      );
      if (drawMode === "pen" && contactPoint) noteQuickShapePointerMoved(contactPoint);
    },
    onRawPreviewMove: (pointerEvent) => {
      const session = requireStudioDrawingPointerTransport(drawingPointerTransportRef).getSession();
      const drawing = drawingRef.current;
      if (
        tool !== "draw"
        || !session
        || session.pointerType !== "pen"
        || !drawing
        || (drawing.kind ?? "freehand") !== "freehand"
        || !isStudioStrokePointerEvent(session, pointerEvent)
      ) return;
      const rawState = rawPenInkPreviewStateRef.current;
      const rawCursorWanted = (
        brushCursorRef.current !== null
        && isStudioBrushCursorMode(drawMode)
        && appSettingsRef.current.general.brushCursorStyle !== "none"
      );
      const rawGuideWanted = (
        strokeGuideRef.current !== null
        && appSettingsRef.current.general.showStrokeGuide
        && (drawingInputSettingsRef.current?.stabilizer ?? stabilizer) > 0
      );
      // pointerrawupdate may run at 120–240 Hz. If no prediction surface or visible cosmetic
      // consumer exists, avoid even the stage/layout coordinate snapshot on this native path.
      if (!rawState && !rawCursorWanted && !rawGuideWanted) return;
      const stage = stageRef.current;
      if (!stage) return;
      const pointerMapperCache = stagePointerFrameMapperCacheRef.current;
      if (!pointerMapperCache) return;
      const coordinateMapper = pointerMapperCache.mapperFor(stage);
      const contactPoint = coordinateMapper.pointFor(pointerEvent);
      if (rawState && contactPoint) {
        const settings = drawingInputSettingsRef.current;
        // Raw updates are replace-only previews. Branch from (but never publish) the latest
        // authoritative pressure state so pencil, marker, dry-media and every other family show
        // the same hardware-pressure curve before the processed pointer event commits it.
        const previewPressure = advanceStudioBrushVelocityPressure(
          drawingVelocityPressureRef.current,
          {
            x: pointerEvent.clientX,
            y: pointerEvent.clientY,
            timeMs: pointerEvent.timeStamp,
            pointerType: pointerEvent.pointerType,
            pressure: pointerEvent.pressure,
          },
          {
            brushId: drawing.brush,
            pressureCurve: settings?.pressureCurve ?? pressureCurve,
            pressureMinSize: settings?.pressureMinSize ?? pressureMinSize,
            useVelocityPressure: settings?.useVelocityPressure ?? useVelocityPressure,
            velocitySensitivity: settings?.velocitySensitivity ?? velocitySensitivity,
            fallbackPressure: studioInkFallbackPressure(drawing.pressureModel),
          }
        ).pressure;
        const rawTransition = replaceStudioRawPenInkPreview(rawState, {
          pointerId: pointerEvent.pointerId,
          generation: rawState.generation,
          eligibility: currentRawPenInkPreviewEligibility(pointerEvent, drawing),
          point: {
            x: contactPoint.x,
            y: contactPoint.y,
            pressure: studioLiveBrushPressure(drawing, previewPressure),
          },
        });
        rawPenInkPreviewStateRef.current = rawTransition.state;
        liveInkPredictionRendererRef.current.apply(
          rawTransition.predictionSurface,
          liveInkStyleFor(drawing),
        );
      }
      // Raw ink is transient and replace-only. Durable geometry, history, CRDT, ruler locks,
      // QuickShape recognition, and the pointer-session signature still wait for processed input.
      updateBrushCursor(stage, pointerEvent, contactPoint, true);
      updateStrokeGuide(
        contactPoint?.x ?? Number.NaN,
        contactPoint?.y ?? Number.NaN,
        true,
      );
    },
    onDiscard: () => {
      if (!drawingRef.current && !requireStudioDrawingPointerTransport(drawingPointerTransportRef).getSession()) return;
      discardDrawingPointerSession();
    },
    onFinish: (pointerEvent, request) => {
      // Snapshot + stop happen inside finishDrawingPointer; clearing QuickShape here would wipe
      // the hold/lock state used by release promotion.
      if (!request.cancelled && colorWheelTimerRef.current) {
        clearTimeout(colorWheelTimerRef.current);
        colorWheelTimerRef.current = null;
      }
      finishDrawingPointer(stageRef.current, pointerEvent, {
        consumeReleaseSample: request.consumeReleaseSample,
      });
    },
  });
  api.publishAuthoritativeFreehandSuffix = publishAuthoritativeFreehandSuffix;
}
