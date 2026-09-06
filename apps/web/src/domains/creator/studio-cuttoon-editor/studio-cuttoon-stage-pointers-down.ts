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

export function bindStudioCuttoonStagePointersDown(
  h: StudioCuttoonStagePointersHost,
  api: StudioCuttoonStagePointersApi,
) {
  const {
    advancedFillActive,
    applyStudioDrawingColor,
    applyVectorEraseToIntersectionAt,
    bubbleAnchorPickActive,
    bubbleShapeDragRef,
    colorWheelOpen,
    colorWheelPressRef,
    colorWheelTimerRef,
    cropRect,
    dodgeBurnActive,
    drawMode,
    eraseToIntersection,
    eyedropperActive,
    getClientPointFromKonvaEvent,
    handleStudioPointCommentStageDown,
    healCloneTool,
    isSpacePressed,
    journalPendingPixelSelectionRasterGesture,
    journalPendingRasterRetouchGesture,
    liquifyDragRef,
    nodeEditTool,
    openColorWheelAt,
    panelSplitActive,
    pendingPixelSelectionRasterGestureRef,
    pendingRasterRetouchGestureRef,
    pickCanvasColorAt,
    pixelDragRef,
    pixelMarqueeRasterPreparationActivationRef,
    pixelTool,
    quickShapeActive,
    recentColors,
    setEyedropperActive,
    smudgeActive,
    studioRasterRetouchPreparationRef,
    tool,
    wetMixActive,
    canvasInteractionBlocked,
    commentPinArmed,
    healCloneArmed,
  } = h;

  function onStageDown(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (
      e.target.name() === "symmetry-handle"
      || e.target.name() === "guide-line-handle"
      || e.target.name() === "vp-handle"
      || e.target.name() === "isometric-origin-handle"
    ) {
      return;
    }
    const stagePointerEvent = e.evt as PointerEvent;
    // One contact owns a liquify gesture. A second finger is ignored and cannot cancel or replace it.
    if (liquifyDragRef.current) return;
    // One contact also owns a pixel-selection drag; a palm/second finger cannot replace it.
    if (pixelDragRef.current) return;
    // Raster preparation journals the first vector-only selection contact with the same ownership
    // rule; a second touch/palm cannot replace its start point or release owner.
    if (pendingPixelSelectionRasterGestureRef.current) return;
    // The same one-contact rule protects the first smudge/dodge/wet-mix/liquify gesture while a
    // vector-only page is being rendered into its non-destructive editable raster copy.
    if (pendingRasterRetouchGestureRef.current) return;
    // The first contact owns a bubble point drag. A palm/second finger cannot replace its owner.
    if (bubbleShapeDragRef.current) return;
    if (handleStudioPointCommentStageDown(e, stagePointerEvent)) return;
    if (canvasInteractionBlocked && !commentPinArmed) return;
    const pendingRetouchPreparation = studioRasterRetouchPreparationRef.current;
    const pendingSelectionPreparation = pixelMarqueeRasterPreparationActivationRef.current;
    if (pendingSelectionPreparation && !isSpacePressed) {
      const position = e.target.getStage()?.getRelativePointerPosition();
      if (position) {
        journalPendingPixelSelectionRasterGesture({
          captureFallback: e.target.getStage()?.container() ?? null,
          event: stagePointerEvent,
          forceCircle: pendingSelectionPreparation.forceCircle,
          position,
          tool: pendingSelectionPreparation.tool,
        });
      }
      // The requested pixel tool may not have reached this render's closure yet. Preparation owns
      // the contact through its synchronous ref so the first fast drag cannot move a source vector.
      return;
    }
    if (pendingRetouchPreparation && !isSpacePressed) {
      const position = e.target.getStage()?.getRelativePointerPosition();
      if (position) {
        journalPendingRasterRetouchGesture({
          captureFallback: e.target.getStage()?.container() ?? null,
          event: stagePointerEvent,
          position,
        });
      }
      // During preparation, never let the same contact select/move the source vectors behind the
      // pending editable copy, even when a secondary contact was deliberately rejected.
      return;
    }
    // 색상 휠 롱프레스 무장 — 조건을 전부 만족할 때만 타이머를 건다. 이 블록은 return하지
    // 않는다(관찰만 함) — 아래 기존 분기들(스포이드/크롭/드로잉/마퀴 등)은 오늘과 동일하게
    // 그대로 실행된다. 타이머가 실제로 발화(450ms 정지 유지)했을 때만 openColorWheelAt 이
    // disarmAllPixelTools 로 그 사이 진행된 제스처(마퀴 시작 등)를 되돌린다.
    if (
      tool === "select" &&
      !isSpacePressed &&
      !cropRect &&
      !panelSplitActive &&
      !nodeEditTool &&
      !smudgeActive &&
      !dodgeBurnActive &&
      !wetMixActive &&
      !healCloneTool &&
      !advancedFillActive &&
      !eyedropperActive &&
      !bubbleAnchorPickActive &&
      !pixelTool &&
      !quickShapeActive &&
      !colorWheelOpen &&
      recentColors.length > 0 &&
      !(e.target.getParent() instanceof KonvaRuntime.Transformer)
    ) {
      const clientPoint = getClientPointFromKonvaEvent(e.evt);
      if (clientPoint) {
        colorWheelPressRef.current = clientPoint;
        colorWheelTimerRef.current = setTimeout(() => {
          colorWheelTimerRef.current = null;
          openColorWheelAt(clientPoint.x, clientPoint.y);
        }, COLOR_WHEEL_LONG_PRESS_MS);
      }
    }
    // 스포이드: 토글 버튼으로 무장했거나(한 번 뽑으면 자동 해제), 펜 도구 중 Alt 를 누른 momentary
    // 방식(CSP/Photoshop 관례) — 다른 어떤 캔버스 제스처보다 항상 최우선으로 가로챈다.
    if (eyedropperActive || (tool === "draw" && e.evt.altKey && !healCloneArmed)) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (pos) {
        const hex = pickCanvasColorAt(pos);
        if (hex) applyStudioDrawingColor(hex);
      }
      if (eyedropperActive) setEyedropperActive(false);
      return;
    }
    // CSP 교점까지 지우기 — 지우개 + 토글 시 자유선 클릭 한 번으로 교차 구간을 정리한다.
    if (tool === "draw" && drawMode === "eraser" && eraseToIntersection) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (pos && applyVectorEraseToIntersectionAt(pos.x, pos.y)) return;
    }
    if (api.tryStageDownArmedTools(e, stagePointerEvent)) return;
    if (api.tryStageDownPixel(e, stagePointerEvent)) return;
    api.tryStageDownDraw(e, stagePointerEvent);
  }
  api.onStageDown = onStageDown;
}
