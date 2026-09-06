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

export function bindStudioCuttoonStagePointersFixedRate(
  h: StudioCuttoonStagePointersHost,
  api: StudioCuttoonStagePointersApi,
) {
  const {
    drawingFixedRateOwnedPointsRef,
    drawingInkTimeOriginRef,
    drawingPredictionBatchMutationRef,
    drawingPredictionPreviewRef,
    drawingRef,
    gpuLiveInkPinnedRef,
    liveDraftDirectRef,
    liveDynamicBrushDraftDirectRef,
    liveDynamicBrushOverlayRendererRef,
    liveRetainedMediaDraftDirectRef,
    liveRetainedMediaOverlayRendererRef,
    liveInkOverlayRendererRef,
    liveStampDraftDirectRef,
    liveStampOverlayRendererRef,
    liveWetInkDraftDirectRef,
    liveWetInkOverlayRendererRef,
    effScale,
    scheduleDraft,
  } = h;

  function appendFixedRateStrokeSamples(
    samples: readonly FixedRateStrokeFilteredSample[],
    pointerSample: PointerEvent,
    speed: number
  ) {
    const current = drawingRef.current;
    if (!current || samples.length === 0) return;
    const capturePointerDynamics = current.mode === "pen"
      && resolveStudioCapturedBrushDynamicsPresetId(current) !== null;
    const captureInkSensorChannels =
      current.mode === "pen" && current.inkInput !== undefined;
    const captureExtendedInkSensorChannels =
      current.mode === "pen" && isStudioInkInputContractV2(current.inkInput);
    const captureStylus = current.mode === "pen"
      && (
        current.brush === "calligraphy"
        || capturePointerDynamics
        || captureInkSensorChannels
      );
    const captureMotionChannels =
      capturePointerDynamics || captureInkSensorChannels;
    const stylus = captureStylus ? normalizeCalligraphyStylusInput(pointerSample) : null;
    const tangentialPressure = Number.isFinite(pointerSample.tangentialPressure)
      ? Math.min(1, Math.max(-1, pointerSample.tangentialPressure))
      : 0;
    const mutateDirectly = (
      (liveDraftDirectRef.current && liveInkOverlayRendererRef.current.isActive)
      || (liveStampDraftDirectRef.current && liveStampOverlayRendererRef.current.isActive)
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
    )
      && !gpuLiveInkPinnedRef.current
      && (
        !drawingPredictionPreviewRef.current
        || drawingPredictionBatchMutationRef.current
      );
    // current.points가 지난 호출에서 우리가 만든 배열이면 같은 스트로크 동안 그대로 이어붙인다.
    // WebGPU journal은 매 프레임 동결된 새 접미사만 보관하고 이 원본 배열을 노출하지 않으므로,
    // GPU 파인 중에도 전체 prefix 복제 없이 O(새 샘플 수)로 진행할 수 있다. 바깥 DrawEl(next)은
    // 매 호출 새 객체라 scheduleDraft의 참조 기반 변경 감지는 그대로 유지된다.
    const ownsCurrentArrays = !mutateDirectly
      && current.points === drawingFixedRateOwnedPointsRef.current;
    const reuseOrClone = <T,>(shouldTrack: boolean, arr: T[] | undefined): T[] | undefined => {
      if (!shouldTrack || !arr) return arr;
      return ownsCurrentArrays ? arr : [...arr];
    };
    const next: DrawEl = mutateDirectly
      ? current
      : {
          ...current,
          points: ownsCurrentArrays ? current.points : [...current.points],
          pressures: reuseOrClone(true, current.pressures),
          tiltXs: reuseOrClone(captureStylus, current.tiltXs),
          tiltYs: reuseOrClone(captureStylus, current.tiltYs),
          twists: reuseOrClone(captureStylus, current.twists),
          speeds: reuseOrClone(captureMotionChannels, current.speeds),
          tangentialPressures: reuseOrClone(
            captureMotionChannels,
            current.tangentialPressures,
          ),
          altitudeAngles: reuseOrClone(
            captureExtendedInkSensorChannels,
            current.altitudeAngles,
          ),
          azimuthAngles: reuseOrClone(
            captureExtendedInkSensorChannels,
            current.azimuthAngles,
          ),
          contactWidths: reuseOrClone(
            captureExtendedInkSensorChannels,
            current.contactWidths,
          ),
          contactHeights: reuseOrClone(
            captureExtendedInkSensorChannels,
            current.contactHeights,
          ),
          sampleTimeOffsets: reuseOrClone(
            captureExtendedInkSensorChannels,
            current.sampleTimeOffsets,
          ),
        };
    if (!mutateDirectly) {
      drawingFixedRateOwnedPointsRef.current = next.points;
    }
    let appended = false;
    const appendAligned = (
      values: number[] | undefined,
      count: number,
      value: number,
      fallback: number
    ): number[] => {
      const aligned = values ?? [];
      while (aligned.length < count) aligned.push(fallback);
      if (aligned.length > count) aligned.length = count;
      aligned.push(value);
      return aligned;
    };
    for (const sample of samples) {
      const lastX = next.points[next.points.length - 2] ?? sample.x;
      const lastY = next.points[next.points.length - 1] ?? sample.y;
      const pointCount = Math.floor(next.points.length / 2);
      const lastPressure = next.pressures?.[pointCount - 1]
        ?? studioInkFallbackPressure(next.pressureModel);
      const minimumDistance = next.sampleSpacing ?? strokeSampleDistanceForScale(effScale);
      if (!shouldAppendStudioCausalInkSample({
        lastX,
        lastY,
        lastPressure,
        nextX: sample.x,
        nextY: sample.y,
        nextPressure: sample.pressure,
        minDistance: minimumDistance,
        pressureModel: next.pressureModel,
      })) continue;
      next.points.push(sample.x, sample.y);
      next.pressures = appendAligned(
        next.pressures,
        pointCount,
        sample.pressure,
        studioInkFallbackPressure(next.pressureModel)
      );
      if (captureStylus && stylus) {
        next.tiltXs = appendAligned(next.tiltXs, pointCount, sample.tiltX, 0);
        next.tiltYs = appendAligned(next.tiltYs, pointCount, sample.tiltY, 0);
        next.twists = appendAligned(next.twists, pointCount, stylus.twist, 0);
      }
      if (captureMotionChannels) {
        next.speeds = appendAligned(next.speeds, pointCount, speed, 0);
        next.tangentialPressures = appendAligned(
          next.tangentialPressures,
          pointCount,
          tangentialPressure,
          0
        );
      }
      if (captureExtendedInkSensorChannels) {
        const persistedPointerChannels = normalizeStudioPersistedPointerChannels(
          pointerSample,
          {
            timeOriginMilliseconds:
              drawingInkTimeOriginRef.current ?? pointerSample.timeStamp,
            previousTimeOffsetMilliseconds: next.sampleTimeOffsets?.at(-1) ?? 0,
            sourceTimeMilliseconds: sample.sourceTimeStamp,
          },
        );
        next.altitudeAngles = appendAligned(
          next.altitudeAngles,
          pointCount,
          persistedPointerChannels.altitudeAngle,
          Math.PI / 2,
        );
        next.azimuthAngles = appendAligned(
          next.azimuthAngles,
          pointCount,
          persistedPointerChannels.azimuthAngle,
          0,
        );
        next.contactWidths = appendAligned(
          next.contactWidths,
          pointCount,
          persistedPointerChannels.contactWidth,
          1,
        );
        next.contactHeights = appendAligned(
          next.contactHeights,
          pointCount,
          persistedPointerChannels.contactHeight,
          1,
        );
        next.sampleTimeOffsets = appendAligned(
          next.sampleTimeOffsets,
          pointCount,
          persistedPointerChannels.timeOffsetMilliseconds,
          0,
        );
      }
      appended = true;
    }
    if (!appended) return;
    drawingRef.current = next;
    if (!drawingPredictionPreviewRef.current) scheduleDraft(next);
  }
  api.appendFixedRateStrokeSamples = appendFixedRateStrokeSamples;
}
