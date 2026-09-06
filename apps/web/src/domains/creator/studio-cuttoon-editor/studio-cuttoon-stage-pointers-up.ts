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

export function bindStudioCuttoonStagePointersUp(
  h: StudioCuttoonStagePointersHost,
  api: StudioCuttoonStagePointersApi,
) {
  const {
    activeGroupId,
    activeGroupIdRef,
    advancedFillAbortRef,
    advancedFillTapGestureRef,
    advancedFillTapPayloadRef,
    advancedFillTouchPanRef,
    applyDodgeBurnStroke,
    applyGroupSelectionState,
    applySmudgeStroke,
    applyWetMixStroke,
    autoColorCanvasSeedNonceRef,
    autoColorPlanImageSizeRef,
    autoColorScribbleStrokeRef,
    bakeFilterMaskPaintStroke,
    bakeHealCloneDragStroke,
    bakeHistoryBrushDragStroke,
    bakeLayerMaskPaintStroke,
    bubbleShapeDragRef,
    bubbleShapeRafRef,
    colorWheelTimerRef,
    commit,
    cropDragRef,
    discardDrawingPointerSession,
    dodgeBurnDragRef,
    drawingPointerTransportRef,
    drawingRef,
    filterMaskDragRef,
    finishLiquifyPointerSession,
    finishPendingRasterRetouchGesture,
    finishPixelSelectionPointerSession,
    getClientPointFromKonvaEvent,
    healCloneDragRef,
    historyBrushDragRef,
    layerMaskDragRef,
    liquifyDragRef,
    liquifyHandledNativeEndEventsRef,
    marqueeStartRef,
    nodeEditDragRef,
    nodeEditRafRef,
    panelGutter,
    panelSplitDragRef,
    panelSplitLastLineRef,
    panelSplitPreview,
    patchEl,
    pendingBubbleShapeDraftRef,
    pendingMarqueeRectRef,
    pendingNodeEditDraftRef,
    pendingRasterRetouchGestureRef,
    pixelDragRef,
    pixelSelectionHandledNativeEndEventsRef,
    quickMaskBrushMode,
    quickMaskDragRef,
    quickMaskHardness,
    quickMaskOpacity,
    quickMaskRadius,
    quickMaskSessionRef,
    refreshQuickMaskTint,
    releaseBubbleShapePointerCapture,
    runAdvancedFillAt,
    session,
    setAutoColorCanvasSeedHit,
    setAutoColorCanvasSeedHits,
    setBubbleShapeDraft,
    setBubbleShapeSelectedPointIndex,
    setNodeEditDraft,
    setPanelSplitHint,
    setPanelSplitPreview,
    setSelectedId,
    smudgeDragRef,
    stopQuickShapeTracking,
    wetMixDragRef,
    activeSurfaceReviewLocked,
    advancedFillArmed,
    clearFilterMaskDragPreview,
    clearHealCloneDragPreview,
    clearHistoryBrushDragPreview,
    clearLayerMaskDragPreview,
    clearMarqueePreview,
    clearPaintRetouchStrokePreview,
    clearQuickMaskDragPreview,
    elementById,
    elements,
    flushCropRect,
    flushPanelSplitPreview,
    groups,
    selected,
  } = h;
  const finishDrawingPointer = (...args) => api.finishDrawingPointer(...args);
  const updateBrushCursor = (...args) => api.updateBrushCursor(...args);
  function onStageUp(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    const pointerEvent = e.evt as PointerEvent;
    // Flush freehand auto-color scribble samples collected during the drag.
    const scribbleStroke = autoColorScribbleStrokeRef.current;
    if (scribbleStroke) {
      autoColorScribbleStrokeRef.current = null;
      const planSize = autoColorPlanImageSizeRef.current;
      const image = selected?.type === "image" ? selected : null;
      if (planSize && image && scribbleStroke.points.length >= 4) {
        const samples = sampleStudioAutoColorStrokeSeeds({
          documentPoints: scribbleStroke.points,
          image: {
            x: image.x,
            y: image.y,
            width: image.width,
            height: image.height,
            rotation: image.rotation,
            flipped: image.flipped,
            flippedY: image.flippedY,
          },
          pixelWidth: planSize.width,
          pixelHeight: planSize.height,
        });
        // Skip the first sample (already emitted on pointerdown as a single hit).
        const rest = samples.slice(1);
        if (rest.length > 0) {
          const hits = rest.map((sample) => {
            autoColorCanvasSeedNonceRef.current += 1;
            return {
              x: sample.x,
              y: sample.y,
              nonce: autoColorCanvasSeedNonceRef.current,
            };
          });
          setAutoColorCanvasSeedHit(null);
          setAutoColorCanvasSeedHits(hits);
        }
      }
      return;
    }
    if (liquifyHandledNativeEndEventsRef.current.delete(pointerEvent)) return;
    if (pixelSelectionHandledNativeEndEventsRef.current.delete(pointerEvent)) return;
    if (requireStudioDrawingPointerTransport(drawingPointerTransportRef).consumeHandledNativeEnd(pointerEvent)) return;
    if (pendingRasterRetouchGestureRef.current) {
      if (!finishPendingRasterRetouchGesture(pointerEvent, false, e.target.getStage())) return;
      return;
    }
    const drawingPointerSession = requireStudioDrawingPointerTransport(drawingPointerTransportRef).getSession();
    if (drawingRef.current || drawingPointerSession) {
      if (!drawingPointerSession) {
        // Defensive HMR/legacy state: ownership is unknown, so discard rather than committing an
        // arbitrary pointer's draft. Normal sessions always have both refs.
        discardDrawingPointerSession();
        return;
      }
      if (!isStudioStrokePointerEvent(drawingPointerSession, pointerEvent)) {
        // A secondary touch ending must not stop QuickShape, commit, or discard the active pen.
        return;
      }
      if (colorWheelTimerRef.current) {
        clearTimeout(colorWheelTimerRef.current);
        colorWheelTimerRef.current = null;
      }
      // Handle drawing before every other tool's early-return branch. Even a stale marquee/crop ref
      // cannot intercept pointerup and leak capture; finishDrawingPointer always cleans up in finally
      // (including QuickShape timer stop after promote snapshot).
      finishDrawingPointer(e.target.getStage(), pointerEvent);
      updateBrushCursor(e.target.getStage(), pointerEvent);
      return;
    }
    if (liquifyDragRef.current) {
      if (!isStudioLiquifyPointerOwner(liquifyDragRef.current, pointerEvent)) return;
      finishLiquifyPointerSession(pointerEvent, false, e.target.getStage());
      return;
    }
    if (pixelDragRef.current) {
      if (!finishPixelSelectionPointerSession(pointerEvent, false)) return;
      return;
    }
    stopQuickShapeTracking(); // 드로잉이 아닌 경로 — 잔여 인터벌만 정리.
    // 색상 휠 롱프레스 타이머가 아직 안 터졌는데 포인터를 뗐다 — 평범한 클릭/드래그였다는 뜻이니
    // 타이머만 정리한다(이미 열려 있었다면 오버레이가 이벤트를 가로채서 애초에 여기까지 안 온다).
    if (colorWheelTimerRef.current) {
      clearTimeout(colorWheelTimerRef.current);
      colorWheelTimerRef.current = null;
    }
    if (advancedFillTapGestureRef.current) {
      const pointerEvent = e.evt as PointerEvent;
      const pointerId = Number.isFinite(pointerEvent.pointerId) ? pointerEvent.pointerId : 1;
      const clientPoint = getClientPointFromKonvaEvent(e.evt);
      const moved = clientPoint
        ? moveStudioAdvancedFillTap(advancedFillTapGestureRef.current, pointerId, clientPoint)
        : advancedFillTapGestureRef.current;
      const outcome = endStudioAdvancedFillTap(moved, pointerId);
      advancedFillTapGestureRef.current = outcome.gesture;
      if (advancedFillTouchPanRef.current?.pointerId === pointerId) {
        advancedFillTouchPanRef.current = null;
      }
      const payload = advancedFillTapPayloadRef.current;
      if (!outcome.gesture) advancedFillTapPayloadRef.current = null;
      if (outcome.execute && payload && !advancedFillAbortRef.current) {
        void runAdvancedFillAt(payload.position, payload.frame);
      }
      return;
    }
    if (advancedFillArmed) return;
    // 크롭 드래그 종료 — 마지막 RAF 대기분을 반영하고 세션만 닫는다(rect 는 적용 전까지 유지).
    if (cropDragRef.current) {
      cropDragRef.current = null;
      flushCropRect();
      return;
    }
    // 패널 손그림 컷 드래그 종료 — 마지막 절단선으로 실제 분할을 확정한다. 도구는 계속 무장된
    // 채로 둔다(크롭과 달리 의도적 — 연속으로 여러 컷을 이어서 그릴 수 있게).
    if (panelSplitDragRef.current) {
      const session = panelSplitDragRef.current;
      panelSplitDragRef.current = null;
      flushPanelSplitPreview();
      const line = panelSplitLastLineRef.current;
      const frame = elements.find((el) => el.id === session.targetFrameId);
      if (
        line &&
        frame &&
        frame.type === "frame" &&
        !activeSurfaceReviewLocked &&
        !isEffectivelyLocked(frame, groups)
      ) {
        const plan = planPanelSplit({ frame, line, gutterPx: panelGutter });
        if (plan) {
          // frame 을 먼저 펼치고 plan.shape* 로 덮어써야 shapeA/B 의 항상-존재하는 points 키(뒤집힌
          // 사각형일 때도 undefined 로 명시)가 원본 frame 의 남은 points 를 확실히 지운다.
          const shapeA = { ...frame, ...plan.shapeA, id: uid() };
          const shapeB = { ...frame, ...plan.shapeB, id: uid() };
          commit([...elements.filter((e) => e.id !== frame.id), shapeA, shapeB]);
          setSelectedId(shapeA.id);
        } else {
          setPanelSplitHint(
            panelSplitPreview
              ? "여백을 적용하면 한쪽 칸이 너무 작아져요. 여백을 줄이거나 더 넓게 갈라보세요."
              : "선이 패널을 가로지르지 않았어요. 패널 양쪽 변을 관통하도록 다시 그어보세요."
          );
        }
      }
      panelSplitLastLineRef.current = null;
      setPanelSplitPreview(null);
      return;
    }
    // 벡터 노드 편집 드래그 종료 — 커밋은 이 pointerup 틱에서 바로 일어나므로(리렌더를 기다리는
    // crop 의 "적용" 버튼과 다름) nodeEditDraft state 가 아니라 항상-최신인 ref 를 읽는다. state 를
    // 읽으면 React 의 비동기 업데이트 때문에 드래그의 마지막 프레임을 놓칠 수 있다.
    if (nodeEditDragRef.current) {
      const { elId } = nodeEditDragRef.current;
      nodeEditDragRef.current = null;
      if (nodeEditRafRef.current !== null) {
        globalThis.cancelAnimationFrame(nodeEditRafRef.current);
        nodeEditRafRef.current = null;
      }
      const finalDraft = pendingNodeEditDraftRef.current;
      pendingNodeEditDraftRef.current = null;
      setNodeEditDraft(null);
      const current = elementById.get(elId);
      if (
        finalDraft &&
        finalDraft.elId === elId &&
        current?.type === "draw" &&
        !activeSurfaceReviewLocked &&
        !isEffectivelyLocked(current, groups)
      ) {
        patchEl(elId, { points: finalDraft.points, pressures: finalDraft.pressures } as Partial<El>);
      }
      return;
    }
    // 말풍선 커스텀 모양 점 드래그 종료 — nodeEdit과 동일하게 이 pointerup 틱에서 ref로 바로
    // 커밋한다(state는 비동기라 마지막 프레임을 놓칠 수 있다).
    if (bubbleShapeDragRef.current) {
      const pointerId = Number.isFinite(pointerEvent.pointerId) ? pointerEvent.pointerId : 1;
      if (bubbleShapeDragRef.current.pointerId !== pointerId) return;
      const { elId, session } = bubbleShapeDragRef.current;
      releaseBubbleShapePointerCapture(bubbleShapeDragRef.current);
      bubbleShapeDragRef.current = null;
      if (bubbleShapeRafRef.current !== null) {
        globalThis.cancelAnimationFrame(bubbleShapeRafRef.current);
        bubbleShapeRafRef.current = null;
      }
      const finalDraft = pendingBubbleShapeDraftRef.current;
      pendingBubbleShapeDraftRef.current = null;
      setBubbleShapeDraft(null);
      const current = elementById.get(elId);
      if (
        finalDraft &&
        finalDraft.elId === elId &&
        current?.type === "bubble" &&
        !activeSurfaceReviewLocked &&
        !isEffectivelyLocked(current, groups)
      ) {
        const pointOffset = session.pointIndex * 2;
        const moved = moveBubbleShapePoint(
          current.customShapePoints ?? [],
          session.pointIndex,
          finalDraft.points[pointOffset],
          finalDraft.points[pointOffset + 1]
        );
        if (moved.changed) {
          patchEl(elId, { customShapePoints: moved.points } as Partial<El>);
          setBubbleShapeSelectedPointIndex(session.pointIndex);
        }
      }
      return;
    }
    // 문지르기 드래그 종료 — 누적된 좌표로 실제 픽셀 스트로크를 적용한다.
    if (smudgeDragRef.current) {
      const session = smudgeDragRef.current;
      smudgeDragRef.current = null;
      clearPaintRetouchStrokePreview();
      if (session.points.length >= 2) {
        void applySmudgeStroke(
          session.elId,
          thinStudioRasterRetouchPointsForApply(session.points),
        );
      }
      return;
    }
    // 닷지/번 드래그 종료 — 누적된 좌표로 실제 픽셀 보정을 적용한다(탭 1점도 도장 1개로 유효).
    if (dodgeBurnDragRef.current) {
      const session = dodgeBurnDragRef.current;
      dodgeBurnDragRef.current = null;
      clearPaintRetouchStrokePreview();
      if (session.points.length >= 1) {
        void applyDodgeBurnStroke(
          session.elId,
          thinStudioRasterRetouchPointsForApply(session.points),
        );
      }
      return;
    }
    // 혼색 브러시 드래그 종료 — 누적된 좌표로 혼색 스트로크를 적용한다(탭 1점도 도장 1개).
    if (wetMixDragRef.current) {
      const session = wetMixDragRef.current;
      wetMixDragRef.current = null;
      clearPaintRetouchStrokePreview();
      if (session.points.length >= 1) {
        void applyWetMixStroke(
          session.elId,
          thinStudioRasterRetouchPointsForApply(session.points),
        );
      }
      return;
    }
    // 퀵 마스크 드래그 종료 — 스트로크당 1회만 마스크에 굽고 틴트 캔버스를 교체(핫패스 계약).
    if (quickMaskDragRef.current) {
      const session = quickMaskDragRef.current;
      quickMaskDragRef.current = null;
      clearQuickMaskDragPreview();
      const qm = quickMaskSessionRef.current;
      if (qm && session.elId === qm.elId && session.points.length > 0) {
        applyMaskStrokeDabs(
          qm.mask,
          qm.maskW,
          qm.maskH,
          session.points.map((p) => ({ x: p.x * qm.maskW, y: p.y * qm.maskH })),
          {
            radius: Math.max(1, quickMaskRadius * qm.featherScale),
            hardness: quickMaskHardness,
            opacity: quickMaskOpacity,
            mode: quickMaskBrushMode,
          }
        );
        refreshQuickMaskTint();
      }
      return;
    }
    // 레이어 마스크 브러시 드래그 종료 — 누적된 좌표로 실제 마스크 스트로크를 굽는다.
    if (layerMaskDragRef.current) {
      const session = layerMaskDragRef.current;
      layerMaskDragRef.current = null;
      clearLayerMaskDragPreview();
      if (session.points.length > 0) void bakeLayerMaskPaintStroke(session);
      return;
    }
    // 필터 마스크 브러시 드래그 종료 — 누적된 좌표로 실제 마스크 스트로크를 굽는다.
    if (filterMaskDragRef.current) {
      const session = filterMaskDragRef.current;
      filterMaskDragRef.current = null;
      clearFilterMaskDragPreview();
      if (session.points.length > 0) void bakeFilterMaskPaintStroke(session);
      return;
    }
    // 복구 브러시/도장 드래그 종료 — 누적된 좌표로 dab 목록을 계산해 굽는다.
    if (healCloneDragRef.current) {
      const session = healCloneDragRef.current;
      healCloneDragRef.current = null;
      clearHealCloneDragPreview();
      if (session.points.length > 0) void bakeHealCloneDragStroke(session);
      return;
    }
    // 히스토리 브러시 드래그 종료 — 누적된 좌표로 dab 목록을 계산해 굽는다.
    if (historyBrushDragRef.current) {
      const session = historyBrushDragRef.current;
      historyBrushDragRef.current = null;
      clearHistoryBrushDragPreview();
      if (session.points.length > 0) void bakeHistoryBrushDragStroke(session);
      return;
    }
    // 마퀴 드래그 종료: 박스와 겹치는(숨김·아닌) 요소를 한꺼번에 선택.
    if (marqueeStartRef.current) {
      const rect = pendingMarqueeRectRef.current;
      marqueeStartRef.current = null;
      clearMarqueePreview();
      if (rect && rect.w > 3 && rect.h > 3) {
        const hitIds = selectIdsByMarquee(
          elements,
          (el) => elBounds(el),
          rect,
          { include: (el) => !isEffectivelyHidden(el, groups) }
        );
        const ids = expandSelectionIdsToGroupUnits(
          elements,
          groups,
          hitIds,
          activeGroupIdRef.current
        );
        applyGroupSelectionState({
          ...selectionShapeForIds(ids),
          activeGroupId: activeGroupIdRef.current,
        });
      }
      return;
    }
  }
  api.onStageUp = onStageUp;
}
