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

export function bindStudioCuttoonStagePointersMove(
  h: StudioCuttoonStagePointersHost,
  api: StudioCuttoonStagePointersApi,
) {
  const {
    advancedFillTapGestureRef,
    advancedFillTouchPanRef,
    autoColorScribbleCanvasArmed,
    autoColorScribbleStrokeRef,
    bubbleShapeDragRef,
    color,
    colorWheelPressRef,
    colorWheelTimerRef,
    cropAspect,
    cropDragRef,
    dodgeBurnDragRef,
    drawMode,
    drawingPointerTransportRef,
    drawingRef,
    filterMaskCursorRef,
    filterMaskDragRef,
    filterMaskRadius,
    getClientPointFromKonvaEvent,
    healCloneDragRef,
    historyBrushDragRef,
    isExporting,
    layerMaskCursorRef,
    layerMaskDragRef,
    layerMaskRadius,
    liquifyDragRef,
    liquifyRadius,
    marqueeStartRef,
    nodeEditDragRef,
    nodeSmoothStrengthAtDragStartRef,
    noteQuickShapePointerMoved,
    panelGutter,
    panelSplitDragRef,
    panelSplitLastLineRef,
    pendingPixelSelectionRasterGestureRef,
    pendingRasterRetouchGestureRef,
    pixelDragRef,
    pixelSelRef,
    pixelTool,
    polyLassoSessionRef,
    quickMaskDragRef,
    quickMaskRadius,
    scheduleLiquifyLivePreview,
    session,
    setNodeSmoothStrength,
    setPixelSel,
    setPolyLassoHover,
    smudgeCursorRef,
    smudgeDragRef,
    strokeWidth,
    studioLiveRoomRef,
    tool,
    wetMixDragRef,
    wrapRef,
    activePage,
    advancedFillArmed,
    canvasH,
    dodgeBurnArmed,
    effScale,
    elementById,
    elements,
    filterMaskPaintArmed,
    healCloneArmed,
    historyBrushArmed,
    layerMaskPaintArmed,
    liquifyArmed,
    quickMaskArmed,
    scheduleBubbleShapeDraft,
    scheduleCropRect,
    scheduleFilterMaskDragPreview,
    scheduleHealCloneDragPreview,
    scheduleHistoryBrushDragPreview,
    scheduleLayerMaskDragPreview,
    scheduleMarqueeRect,
    scheduleNodeEditDraft,
    schedulePaintRetouchStrokePreview,
    schedulePanelSplitPreview,
    schedulePixelDragPreview,
    scheduleQuickMaskDragPreview,
    selected,
    smudgeArmed,
    updateScrollPos,
    wetMixArmed,
  } = h;
  const finishDrawingPointer = (...args) => api.finishDrawingPointer(...args);
  const updateActiveShapeEndpoint = (...args) => api.updateActiveShapeEndpoint(...args);
  const updateBrushCursor = (...args) => api.updateBrushCursor(...args);
  const updateHealCloneCursorNodes = (...args) => api.updateHealCloneCursorNodes(...args);
  const updateHistoryBrushCursorNode = (...args) => api.updateHistoryBrushCursorNode(...args);
  function onStageMove(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    const stagePointerEvent = e.evt as PointerEvent;
    const stageActiveDrawing = drawingRef.current;
    const nativeFreehandMoveOwnsStage = Boolean(
      stageActiveDrawing
      && (stageActiveDrawing.kind ?? "freehand") === "freehand"
      && isStudioStrokePointerEvent(
        requireStudioDrawingPointerTransport(drawingPointerTransportRef).getSession(),
        stagePointerEvent
      )
    );
    // Figma-style multiplayer cursor publication must run before every tool-specific early return.
    // Throttle before reading Stage coordinates or copying the recent stroke tail.
    if (!isExporting && canvasH > 0) {
      studioLiveRoomRef.current?.publishCursorWhenDue(() => {
        const pointer = e.target.getStage()?.getRelativePointerPosition();
        if (!pointer) return null;
        const activeDrawing = stageActiveDrawing;
        const isDrawing = Boolean(activeDrawing && (activeDrawing.kind ?? "freehand") === "freehand");
        const publishedTool = resolveStudioLivePublishedCursorTool({
          tool,
          drawMode,
          drawingMode: activeDrawing?.mode,
        });
        const isEraserPreview = publishedTool === "eraser";
        const strokeColor = activeDrawing?.stroke ?? color;
        const strokeWidthVal = activeDrawing?.strokeWidth ?? strokeWidth;
        const strokeOpacity = activeDrawing?.opacity ?? 1;
        const pts = activeDrawing?.points;

        return {
          x: Math.max(0, Math.min(1, pointer.x / CANVAS_W)),
          y: Math.max(0, Math.min(1, pointer.y / canvasH)),
          pageId: activePage.id,
          tool: publishedTool,
          drawing: isDrawing,
          strokeColor: isEraserPreview ? undefined : strokeColor,
          strokeWidth: strokeWidthVal,
          strokeOpacity,
          points: isDrawing && pts && pts.length >= 2 ? pts.slice(-64) : undefined,
        };
      });
    }
    // Auto-color freehand scribble stroke — append document points while armed.
    const scribbleStroke = autoColorScribbleStrokeRef.current;
    if (scribbleStroke && autoColorScribbleCanvasArmed) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (pos) {
        if (
          shouldKeepStudioAutoColorStrokeSample({
            lastDocX: scribbleStroke.lastDocX,
            lastDocY: scribbleStroke.lastDocY,
            nextDocX: pos.x,
            nextDocY: pos.y,
            minDistanceDoc: STUDIO_AUTO_COLOR_STROKE_MIN_DISTANCE_DOC_DEFAULT,
          })
        ) {
          scribbleStroke.points.push(pos.x, pos.y);
          scribbleStroke.lastDocX = pos.x;
          scribbleStroke.lastDocY = pos.y;
        }
      }
      return;
    }
    // 색상 휠 롱프레스 타이머가 아직 대기 중인데 임계값(6px) 넘게 움직였으면 드래그/클릭으로
    // 보고 취소한다. colorWheelOpen 이 이미 true 인 동안은 오버레이가 캔버스를 덮어 이 핸들러
    // 자체가 더 안 불리므로 별도 가드가 필요 없다.
    if (colorWheelTimerRef.current && colorWheelPressRef.current) {
      const clientPoint = getClientPointFromKonvaEvent(e.evt);
      if (clientPoint) {
        const dx = clientPoint.x - colorWheelPressRef.current.x;
        const dy = clientPoint.y - colorWheelPressRef.current.y;
        if (shouldCancelLongPress(dx, dy)) {
          clearTimeout(colorWheelTimerRef.current);
          colorWheelTimerRef.current = null;
        }
      }
    }
    // Window capture already consumed and previewed this active freehand delivery.
    if (nativeFreehandMoveOwnsStage) return;
    const pendingRasterGesture = pendingPixelSelectionRasterGestureRef.current;
    if (pendingRasterGesture) {
      const pointerId = Number.isFinite(stagePointerEvent.pointerId)
        ? stagePointerEvent.pointerId
        : 1;
      if (pendingRasterGesture.pointerId !== pointerId) return;
      const position = e.target.getStage()?.getRelativePointerPosition();
      if (position) {
        pendingRasterGesture.current = { x: position.x, y: position.y };
        pendingRasterGesture.shift = stagePointerEvent.shiftKey;
        pendingRasterGesture.alt = stagePointerEvent.altKey;
      }
      return;
    }
    const pendingRetouchGesture = pendingRasterRetouchGestureRef.current;
    if (pendingRetouchGesture) {
      const pointerId = Number.isFinite(stagePointerEvent.pointerId)
        ? stagePointerEvent.pointerId
        : 1;
      if (pendingRetouchGesture.pointerId !== pointerId) return;
      const position = e.target.getStage()?.getRelativePointerPosition();
      if (position) {
        pendingRasterRetouchGestureRef.current =
          appendStudioPendingRasterRetouchGesturePoint(
            pendingRetouchGesture,
            stagePointerEvent,
            position,
          );
      }
      return;
    }
    if (advancedFillTapGestureRef.current) {
      const clientPoint = getClientPointFromKonvaEvent(e.evt);
      const pointerEvent = e.evt as PointerEvent;
      const pointerId = Number.isFinite(pointerEvent.pointerId) ? pointerEvent.pointerId : 1;
      if (clientPoint) {
        const gesture = moveStudioAdvancedFillTap(
          advancedFillTapGestureRef.current,
          pointerId,
          clientPoint,
        );
        advancedFillTapGestureRef.current = gesture;
        const pan = advancedFillTouchPanRef.current;
        if (
          pointerEvent.pointerType === "touch" &&
          pan?.pointerId === pointerId &&
          gesture.blocked &&
          gesture.activePointerIds.length === 1
        ) {
          const wrap = wrapRef.current;
          if (wrap) {
            wrap.scrollLeft -= clientPoint.x - pan.last.x;
            wrap.scrollTop -= clientPoint.y - pan.last.y;
            updateScrollPos();
          }
        }
        if (pan?.pointerId === pointerId) pan.last = clientPoint;
      }
      return;
    }
    // A cancelled scroll/pinch may still emit more pointermove events before the final pointerup.
    // While the bucket remains armed, never let those events fall through to selection/drawing.
    if (advancedFillArmed) return;
    // 크롭 드래그 중이면 rect 를 갱신한다(시작 시점 스냅샷 기준 — 증분 오차 없음, RAF 합침).
    if (cropDragRef.current) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (pos) {
        const session = cropDragRef.current;
        const next = updateCropDrag(session.session, canvasPointToNormalized(pos.x, pos.y, session.frame), {
          ratio: cropAspectRatio(cropAspect),
          frameAspect: session.frame.height > 0 ? session.frame.width / session.frame.height : 1,
        });
        scheduleCropRect(next);
      }
      return;
    }
    // 패널 손그림 컷 드래그 중이면 절단선 미리보기를 갱신한다.
    if (panelSplitDragRef.current) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      const session = panelSplitDragRef.current;
      const frame = elements.find((el) => el.id === session.targetFrameId);
      if (pos && frame && frame.type === "frame") {
        const line: PanelSplitLine = { a: session.start, b: { x: pos.x, y: pos.y } };
        panelSplitLastLineRef.current = line;
        const preview = previewPanelSplit({ frame, line, gutterPx: panelGutter });
        schedulePanelSplitPreview(preview);
      }
      return;
    }
    // 벡터 노드 편집 드래그 중이면 점 위치/굵기 초안을 갱신한다. 매 틱마다 커밋된 el.points/
    // pressures 기준으로 재계산한다(직전 draft 가 아니라) — updateNodeDragMove 의 "시작 스냅샷+델타"
    // 설계와 일치, crop 의 updateCropDrag 와 동일한 무누적오차 패턴.
    if (nodeEditDragRef.current) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (pos) {
        const { elId, session } = nodeEditDragRef.current;
        const el = elementById.get(elId);
        if (el && el.type === "draw") {
          if (session.tool === "move") {
            const { x, y } = updateNodeDragMove(session, pos);
            scheduleNodeEditDraft({
              elId,
              points: withPointMoved(el.points, session.pointIndex, x, y),
              pressures: el.pressures ?? [],
            });
          } else if (session.tool === "width") {
            const pressure = updateNodeDragWidth(session, pos, NODE_EDIT_WIDTH_DRAG_RANGE_PX / effScale);
            scheduleNodeEditDraft({
              elId,
              points: el.points,
              pressures: withPressureEdited(el.pressures, Math.floor(el.points.length / 2), session.pointIndex, pressure),
            });
          } else {
            // "smooth" — 세로 드래그는 위치가 아니라 강도(0..1)를 조절한다("굵기"와 동일한 부호
            // 규약: 위로 끌수록 값 증가). 드래그 시작 시점 강도(nodeSmoothStrengthAtDragStartRef)를
            // 기준선으로 매 틱 다시 계산한다 — updateNodeDragWidth 가 session.startPressure 를
            // 기준선으로 삼는 것과 동일한 "무누적오차" 패턴(el.points 도 매 틱 커밋된 원본에서
            // 다시 계산하므로 스무딩이 이전 틱의 결과 위에 누적되지 않는다).
            const strength = updateSmoothStrengthDrag(
              nodeSmoothStrengthAtDragStartRef.current,
              session.startPointerY,
              pos.y,
              NODE_SMOOTH_DRAG_RANGE_PX / effScale
            );
            setNodeSmoothStrength(strength); // 패널 슬라이더도 실시간으로 같은 값을 보여준다.
            scheduleNodeEditDraft({
              elId,
              points: smoothPointsAroundIndex(el.points, session.pointIndex, strength),
              pressures: el.pressures ?? [],
            });
          }
        }
      }
      return;
    }
    // 말풍선 커스텀 모양 점 드래그 중이면 위치 초안을 갱신한다. nodeEdit과 동일하게 "커밋된
    // el.customShapePoints 기준 매 틱 재계산"(직전 draft 아님) — updateNodeDragMove의 시작
    // 스냅샷+델타 설계와 일치, 무누적오차.
    if (bubbleShapeDragRef.current) {
      const pointerEvent = e.evt as PointerEvent;
      const pointerId = Number.isFinite(pointerEvent.pointerId) ? pointerEvent.pointerId : 1;
      if (bubbleShapeDragRef.current.pointerId !== pointerId) return;
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (pos) {
        const { elId, session } = bubbleShapeDragRef.current;
        const el = elementById.get(elId);
        if (el && el.type === "bubble" && hasCustomBubbleShape(el.customShapePoints)) {
          const local = bubbleShapeCanvasPointToLocal(pos.x, pos.y, { x: el.x, y: el.y, rotation: el.rotation });
          const { x, y } = updateNodeDragMove(session, local);
          scheduleBubbleShapeDraft({ elId, points: withPointMoved(el.customShapePoints, session.pointIndex, x, y) });
        }
      }
      return;
    }
    // 픽셀 선택 드래그 중이면 궤적/박스를 갱신한다(시작 시점 프레임 스냅샷 기준 좌표 변환).
    // 올가미는 최소 간격 미만이면 같은 상태를 돌려주므로 그때는 RAF 예약도 건너뛴다.
    // Magma 마퀴 이동: 선택 안 드래그는 아웃라인만 평행 이동(픽셀 변형은 Transform/내용 변형).
    if (pixelDragRef.current) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (pos) {
        const session = pixelDragRef.current;
        const norm = canvasPointToNormalized(pos.x, pos.y, session.frame);
        if (session.marqueeMove) {
          const dx = norm.x - session.marqueeMove.startNorm.x;
          const dy = norm.y - session.marqueeMove.startNorm.y;
          const moved =
            translateSelection(session.marqueeMove.baseSelection, dx, dy)
            ?? session.marqueeMove.baseSelection;
          pixelSelRef.current = moved;
          setPixelSel(moved);
        } else {
          const aspect = session.frame.height / Math.max(1, session.frame.width);
          const next = updateSelectionDrag(
            session.drag,
            norm,
            {
              shift: e.evt.shiftKey,
              alt: e.evt.altKey,
              aspect,
              magneticField: session.magneticField,
            }
          );
          if (next !== session.drag) {
            session.drag = next;
            schedulePixelDragPreview(next);
          }
        }
      }
      return;
    }
    // 다각형 올가미 초안 중 — 마지막 꼭짓점→커서 고무줄 미리보기.
    if (polyLassoSessionRef.current && selected?.type === "image" && pixelTool === "poly-lasso") {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (pos) {
        const frame: SelectionFrame = {
          x: selected.x,
          y: selected.y,
          width: selected.width,
          height: selected.height,
          rotation: selected.rotation,
        };
        setPolyLassoHover(canvasPointToNormalized(pos.x, pos.y, frame));
      }
      return;
    }
    // 문지르기 드래그 — 반경 기반 O(1) 샘플링 + rAF 미리보기(heal/clone과 동일 핫패스).
    if (smudgeDragRef.current) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (pos) {
        const session = smudgeDragRef.current;
        const next = canvasPointToNormalized(pos.x, pos.y, session.frame);
        if (appendStudioRasterRetouchDragPoint(session.points, next, session.radiusNorm)) {
          schedulePaintRetouchStrokePreview(session);
        }
      }
      return;
    }
    // 닷지/번 드래그 — 동일 샘플링/미리보기 핫패스.
    if (dodgeBurnDragRef.current) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (pos) {
        const session = dodgeBurnDragRef.current;
        const next = canvasPointToNormalized(pos.x, pos.y, session.frame);
        if (appendStudioRasterRetouchDragPoint(session.points, next, session.radiusNorm)) {
          schedulePaintRetouchStrokePreview(session);
        }
      }
      return;
    }
    // 혼색 브러시 드래그 — 동일 샘플링/미리보기 핫패스.
    if (wetMixDragRef.current) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (pos) {
        const session = wetMixDragRef.current;
        const next = canvasPointToNormalized(pos.x, pos.y, session.frame);
        if (appendStudioRasterRetouchDragPoint(session.points, next, session.radiusNorm)) {
          schedulePaintRetouchStrokePreview(session);
        }
      }
      return;
    }
    if (liquifyDragRef.current) {
      const pointerEvent = e.evt as PointerEvent;
      if (!isStudioLiquifyPointerOwner(liquifyDragRef.current, pointerEvent)) return;
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (pos) {
        const session = liquifyDragRef.current;
        const next = canvasPointToNormalized(pos.x, pos.y, session.frame);
        const radiusNorm = liquifyRadius / Math.max(1, session.frame.width);
        liquifyDragRef.current = appendStudioLiquifyPointerPoint(
          session,
          pointerEvent,
          next,
          studioLiquifyDragMinDistance(radiusNorm),
        );
        schedulePaintRetouchStrokePreview({
          frame: session.frame,
          radiusNorm,
          points: liquifyDragRef.current.points,
        });
        scheduleLiquifyLivePreview();
      }
      return;
    }
    // 퀵 마스크 브러시 드래그 중이면 좌표를 누적한다(레이어 마스크와 동일한 appendBrushPoint).
    if (quickMaskDragRef.current) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (pos) {
        const session = quickMaskDragRef.current;
        const p = canvasPointToNormalized(pos.x, pos.y, session.frame);
        const radiusNorm = quickMaskRadius / Math.max(1, session.frame.width);
        // heal-clone과 동일: 세션이 소유한 배열에 제자리 push 한다(같은 sanitize/간격 규약).
        // 프리뷰에는 매번 새 래퍼 객체를 넘겨 오버레이의 컴파일러 메모(의존성 = drag 객체)와
        // React 상태 비교가 그대로 무효화되게 한다 — 배열만 재사용하고 게시 규약은 불변.
        if (appendBrushPointInPlace(session.points, p, radiusNorm)) {
          scheduleQuickMaskDragPreview({ points: session.points });
        }
      }
      return;
    }
    // 레이어 마스크 브러시 드래그 중이면 좌표를 누적한다(브러시 간격 기반 최소 거리 필터 —
    // heal-clone과 동일한 appendBrushPoint 재사용).
    if (layerMaskDragRef.current) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (pos) {
        const session = layerMaskDragRef.current;
        const p = canvasPointToNormalized(pos.x, pos.y, session.frame);
        const radiusNorm = layerMaskRadius / Math.max(1, session.frame.width);
        if (appendBrushPointInPlace(session.points, p, radiusNorm)) {
          scheduleLayerMaskDragPreview({ points: session.points });
        }
      }
      return;
    }
    // 필터 마스크 브러시 드래그 중이면 좌표를 누적한다(레이어 마스크와 동일한 appendBrushPoint 재사용).
    if (filterMaskDragRef.current) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (pos) {
        const session = filterMaskDragRef.current;
        const p = canvasPointToNormalized(pos.x, pos.y, session.frame);
        const radiusNorm = filterMaskRadius / Math.max(1, session.frame.width);
        if (appendBrushPointInPlace(session.points, p, radiusNorm)) {
          scheduleFilterMaskDragPreview({ points: session.points });
        }
      }
      return;
    }
    // 복구 브러시/도장 드래그 중이면 좌표를 누적한다(브러시 간격 기반 최소 거리 필터).
    if (healCloneDragRef.current) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (pos) {
        const session = healCloneDragRef.current;
        const p = canvasPointToNormalized(pos.x, pos.y, session.frame);
        updateHealCloneCursorNodes(p, session.frame);
        // appendBrushPoint 와 같은 sanitize/간격 규약을 배열 복제 없이 O(1)로 적용한다
        // (이전의 "마지막 점 하나만 넘기는" 우회 대신 공용 제자리 API 사용 — 판정식은 동일).
        if (appendBrushPointInPlace(session.points, p, session.radiusNorm)) {
          scheduleHealCloneDragPreview(session);
        }
      }
      return;
    }
    // 히스토리 브러시 드래그 중이면 좌표를 누적한다(브러시 간격 기반 최소 거리 필터 —
    // appendBrushPoint 재사용, heal-clone과 동일 패턴).
    if (historyBrushDragRef.current) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (pos) {
        const session = historyBrushDragRef.current;
        const p = canvasPointToNormalized(pos.x, pos.y, session.frame);
        updateHistoryBrushCursorNode(p, session.frame);
        if (appendBrushPointInPlace(session.points, p, session.radiusNorm)) {
          scheduleHistoryBrushDragPreview({ points: session.points });
        }
      }
      return;
    }
    // 마퀴 드래그 중이면 선택 박스를 갱신한다.
    if (marqueeStartRef.current) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (pos) {
        const s = marqueeStartRef.current;
        scheduleMarqueeRect(normalizeMarqueeRect(s.x, s.y, pos.x, pos.y));
      }
      return;
    }
    // 커서 프리뷰: 드로잉/문지르기/복구브러시 세 무장 상태는 disarmAllPixelTools로 서로
    // 상호배제되지만 tool("select"|"draw")은 독립된 축이라(이미지 선택 + 스머지 켬 + tool="draw"가
    // 동시에 성립 가능), 셋 다 조건이 참일 수 있는 경우를 else if 로 묶어 한 프레임에 커서 하나만
    // (그리고 batchDraw 한 번만) 갱신되게 한다 — onStageDown 의 armed 우선순위(smudge/healClone이
    // draw 브러시보다 우선)와 동일 순서.
    if (smudgeArmed || liquifyArmed || dodgeBurnArmed || wetMixArmed) {
      const cursorPos = e.target.getStage()?.getRelativePointerPosition();
      const cursorNode = smudgeCursorRef.current;
      if (cursorPos && cursorNode) {
        cursorNode.position(cursorPos);
        if (!cursorNode.visible()) cursorNode.visible(true);
        cursorNode.getLayer()?.batchDraw();
      }
    } else if (layerMaskPaintArmed || quickMaskArmed) {
      const cursorPos = e.target.getStage()?.getRelativePointerPosition();
      const cursorNode = layerMaskCursorRef.current;
      if (cursorPos && cursorNode) {
        cursorNode.position(cursorPos);
        if (!cursorNode.visible()) cursorNode.visible(true);
        cursorNode.getLayer()?.batchDraw();
      }
    } else if (filterMaskPaintArmed) {
      const cursorPos = e.target.getStage()?.getRelativePointerPosition();
      const cursorNode = filterMaskCursorRef.current;
      if (cursorPos && cursorNode) {
        cursorNode.position(cursorPos);
        if (!cursorNode.visible()) cursorNode.visible(true);
        cursorNode.getLayer()?.batchDraw();
      }
    } else if (healCloneArmed && selected?.type === "image") {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (pos) {
        const frame: SelectionFrame = {
          x: selected.x,
          y: selected.y,
          width: selected.width,
          height: selected.height,
          rotation: selected.rotation,
        };
        updateHealCloneCursorNodes(canvasPointToNormalized(pos.x, pos.y, frame), frame);
      }
    } else if (historyBrushArmed && selected?.type === "image") {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (pos) {
        const frame: SelectionFrame = {
          x: selected.x,
          y: selected.y,
          width: selected.width,
          height: selected.height,
          rotation: selected.rotation,
        };
        updateHistoryBrushCursorNode(canvasPointToNormalized(pos.x, pos.y, frame), frame);
      }
    } else if (tool === "draw" && isStudioBrushCursorMode(drawMode)) {
      const brushPointerEvent = e.evt as PointerEvent;
      updateBrushCursor(e.target.getStage(), brushPointerEvent);
    }
    if (tool !== "draw" || !drawingRef.current) return;
    const pointerEvent = e.evt as PointerEvent;
    if (!isStudioStrokePointerEvent(requireStudioDrawingPointerTransport(drawingPointerTransportRef).getSession(), pointerEvent)) return;
    // Mouse: buttons can report 0 mid-drag when release is lost (capture fail / leave window).
    // Pen/touch must not end on buttons alone — drivers often omit a reliable mask mid-stroke.
    if (shouldEndStudioStrokeForReleasedContact(requireStudioDrawingPointerTransport(drawingPointerTransportRef).getSession(), pointerEvent)) {
      // Do not stop QuickShape before finish — finishDrawingPointer snapshots hold/lock first.
      if (colorWheelTimerRef.current) {
        clearTimeout(colorWheelTimerRef.current);
        colorWheelTimerRef.current = null;
      }
      // This is a non-contact hover event used only to detect a lost mouse release. Consuming its
      // current coordinates would connect the last ink sample to wherever the mouse re-entered.
      finishDrawingPointer(e.target.getStage(), pointerEvent, { consumeReleaseSample: false });
      return;
    }
    const kind = drawingRef.current.kind ?? "freehand";
    if (drawMode === "pen") {
      // QuickShape 정지-감지용 포인터 위치 — freehand 누적 경로와 도형-드래그 경로 둘 다에서
      // 실행돼야 하므로 kind 분기 이전에 넣는다(각 분기가 이후 자체적으로 위치를 다시 얻는 것과
      // 별개 — getRelativePointerPosition 은 가벼운 조회라 중복 호출 비용은 무시할 만하다).
      const qsPos = e.target.getStage()?.getRelativePointerPosition();
      if (qsPos) noteQuickShapePointerMoved(qsPos);
    }
    if (kind === "freehand") {
      // Active freehand ink is consumed once by the native capture listener. This Stage event is
      // the processed duplicate and remains responsible only for cursor/presence/QuickShape UI.
      return;
    }
    const stage = e.target.getStage();
    if (stage) updateActiveShapeEndpoint(stage, pointerEvent, true);
  }
  api.onStageMove = onStageMove;
}
