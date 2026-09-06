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

export function bindStudioCuttoonStagePointersCursors(
  h: StudioCuttoonStagePointersHost,
  api: StudioCuttoonStagePointersApi,
) {
  const {
    appSettingsRef,
    brushCursorDrawRafRef,
    brushCursorRef,
    drawMode,
    drawingInputSettingsRef,
    drawingRef,
    endLiveResourceEdit,
    filterMaskCursorRef,
    groupDragRef,
    healCloneCursorRef,
    healCloneSourceCursorRef,
    historyBrushCursorRef,
    isExporting,
    isPanning,
    isSpacePressed,
    layerMaskCursorRef,
    nodeRefsRef,
    session,
    smudgeCursorRef,
    stabilizer,
    strokeGuideMetricsNodeRef,
    strokeGuideMetricsScaleRef,
    strokeGuideRef,
    tool,
    applyGuides,
    applySmartGuides,
    canvasH,
    effScale,
  } = h;

  function drawBrushCursorLayer(deferToFrame: boolean) {
    if (!deferToFrame) {
      if (brushCursorDrawRafRef.current !== null) {
        globalThis.cancelAnimationFrame(brushCursorDrawRafRef.current);
        brushCursorDrawRafRef.current = null;
      }
      (brushCursorRef.current?.getLayer() ?? strokeGuideRef.current?.getLayer())?.drawScene();
      return;
    }
    if (brushCursorDrawRafRef.current !== null) return;
    brushCursorDrawRafRef.current = globalThis.requestAnimationFrame(() => {
      brushCursorDrawRafRef.current = null;
      (brushCursorRef.current?.getLayer() ?? strokeGuideRef.current?.getLayer())?.drawScene();
    });
  }
  function hideStrokeGuide(deferToFrame = false) {
    const guideNode = strokeGuideRef.current;
    if (!guideNode || !guideNode.visible()) return;
    guideNode.visible(false);
    drawBrushCursorLayer(deferToFrame);
  }
  function hideBrushCursorVisual(deferToFrame = false) {
    const cursorNode = brushCursorRef.current;
    if (cursorNode && cursorNode.visible()) {
      cursorNode.visible(false);
      drawBrushCursorLayer(deferToFrame);
    }
  }
  // 포인터가 캔버스를 벗어나면 브러시 커서와 안정화 보조선을 함께 숨긴다.
  function hideBrushCursor(deferToFrame = false) {
    const cursorNode = brushCursorRef.current;
    const guideNode = strokeGuideRef.current;
    let changed = false;
    if (cursorNode?.visible()) {
      cursorNode.visible(false);
      changed = true;
    }
    if (guideNode?.visible()) {
      guideNode.visible(false);
      changed = true;
    }
    if (changed) drawBrushCursorLayer(deferToFrame);
  }
  function updateStrokeGuide(
    pointerX: number,
    pointerY: number,
    deferToFrame = false,
  ) {
    const guideNode = strokeGuideRef.current;
    if (!guideNode) return;
    const drawing = drawingRef.current;
    const points = drawing?.points;
    const inputSettings = drawingInputSettingsRef.current;
    if (
      !drawing
      || !points
      || points.length < 2
      || !Number.isFinite(pointerX)
      || !Number.isFinite(pointerY)
      || pointerX < 0
      || pointerX > CANVAS_W
      || pointerY < 0
      || pointerY > canvasH
      || tool !== "draw"
      || !isStudioBrushCursorMode(drawing.mode ?? drawMode)
      || (drawing.kind ?? "freehand") !== "freehand"
      || isExporting
      || isSpacePressed
      || isPanning
    ) {
      hideStrokeGuide(deferToFrame);
      return;
    }
    const inkX = points[points.length - 2]!;
    const inkY = points[points.length - 1]!;
    const activeStabilizer = inputSettings?.stabilizer ?? stabilizer;
    const activeScale = normalizeStudioStrokeGuideScale(
      inputSettings?.coordinateScale ?? effScale,
    );
    if (!shouldShowStudioStrokeGuide(
      appSettingsRef.current.general.showStrokeGuide,
      true,
      activeStabilizer,
      activeScale,
      inkX,
      inkY,
      pointerX,
      pointerY,
    )) {
      hideStrokeGuide(deferToFrame);
      return;
    }

    let changed = false;
    if (
      strokeGuideMetricsNodeRef.current !== guideNode
      || strokeGuideMetricsScaleRef.current !== activeScale
    ) {
      guideNode.strokeWidth(1.15 / activeScale);
      const dash = guideNode.dash();
      if (dash.length >= 2) {
        dash[0] = 4 / activeScale;
        dash[1] = 3 / activeScale;
        dash.length = 2;
      } else {
        // Defensive one-time repair for a host node created without the component's 2-value dash.
        guideNode.dash([4 / activeScale, 3 / activeScale]);
      }
      strokeGuideMetricsNodeRef.current = guideNode;
      strokeGuideMetricsScaleRef.current = activeScale;
      changed = true;
    }
    const geometry = guideNode.points();
    if (
      geometry.length !== 4
      || geometry[0] !== inkX
      || geometry[1] !== inkY
      || geometry[2] !== pointerX
      || geometry[3] !== pointerY
    ) {
      if (geometry.length === 4) {
        geometry[0] = inkX;
        geometry[1] = inkY;
        geometry[2] = pointerX;
        geometry[3] = pointerY;
      } else {
        // Defensive one-time repair; normal StudioBrushCursor nodes always start with four values.
        guideNode.points([inkX, inkY, pointerX, pointerY]);
      }
      changed = true;
    }
    if (!guideNode.visible()) {
      guideNode.visible(true);
      changed = true;
    }
    if (changed) drawBrushCursorLayer(deferToFrame);
  }
  function updateBrushCursor(
    stage: Konva.Stage | null,
    pointerEvent: PointerEvent,
    mappedPoint?: { x: number; y: number } | null,
    deferToFrame = false
  ) {
    const cursorNode = brushCursorRef.current;
    if (!cursorNode) return;
    if (
      tool !== "draw"
      || !isStudioBrushCursorMode(drawMode)
      || isSpacePressed
      || isPanning
    ) {
      hideBrushCursor(deferToFrame);
      return;
    }
    if (
      appSettingsRef.current.general.brushCursorStyle === "none"
      || !shouldShowStudioBrushCursor(pointerEvent.pointerType)
    ) {
      hideBrushCursorVisual(deferToFrame);
      return;
    }
    if (mappedPoint === undefined) stage?.setPointersPositions(pointerEvent);
    const cursorPos = mappedPoint === undefined
      ? stage?.getRelativePointerPosition()
      : mappedPoint;
    if (
      !cursorPos
      || cursorPos.x < 0
      || cursorPos.x > CANVAS_W
      || cursorPos.y < 0
      || cursorPos.y > canvasH
    ) {
      hideBrushCursor(deferToFrame);
      return;
    }
    cursorNode.position(cursorPos);
    if (!cursorNode.visible()) cursorNode.visible(true);
    drawBrushCursorLayer(deferToFrame);
  }
  function hideSmudgeCursor() {
    const cursorNode = smudgeCursorRef.current;
    if (cursorNode && cursorNode.visible()) {
      cursorNode.visible(false);
      cursorNode.getLayer()?.batchDraw();
    }
  }
  function hideHealCloneCursors() {
    const cursor = healCloneCursorRef.current;
    const srcCursor = healCloneSourceCursorRef.current;
    if (cursor?.visible()) cursor.visible(false);
    if (srcCursor?.visible()) srcCursor.visible(false);
    cursor?.getLayer()?.batchDraw();
  }
  function hideHistoryBrushCursor() {
    const cursor = historyBrushCursorRef.current;
    if (cursor?.visible()) cursor.visible(false);
    cursor?.getLayer()?.batchDraw();
  }
  function hideLayerMaskCursor() {
    const cursorNode = layerMaskCursorRef.current;
    if (cursorNode && cursorNode.visible()) {
      cursorNode.visible(false);
      cursorNode.getLayer()?.batchDraw();
    }
  }
  function hideFilterMaskCursor() {
    const cursorNode = filterMaskCursorRef.current;
    if (cursorNode && cursorNode.visible()) {
      cursorNode.visible(false);
      cursorNode.getLayer()?.batchDraw();
    }
  }

  function restoreGroupDragPreview(
    session: {
      id: string;
      x0: number;
      y0: number;
      selectedIds: string[];
    },
    deltaX: number,
    deltaY: number
  ) {
    const anchor = nodeRefsRef.current[session.id];
    if (!anchor) return;
    anchor.position({ x: session.x0, y: session.y0 });
    for (const id of session.selectedIds) {
      if (id === session.id) continue;
      const peer = nodeRefsRef.current[id];
      if (peer) {
        peer.x(peer.x() - deltaX);
        peer.y(peer.y() - deltaY);
      }
    }
    const layer = anchor.getLayer();
    const selectionOverlay = layer?.findOne(".studio-group-selection-overlay");
    if (selectionOverlay) {
      selectionOverlay.position({ x: 0, y: 0 });
    }
    const resizeProxy = layer?.findOne(".studio-group-uniform-resize-proxy");
    if (resizeProxy) {
      resizeProxy.x(resizeProxy.x() - deltaX);
      resizeProxy.y(resizeProxy.y() - deltaY);
    }
    layer?.batchDraw();
  }

  function cancelCanvasGroupDrag(): boolean {
    const session = groupDragRef.current;
    if (!session) return false;
    const anchor = nodeRefsRef.current[session.id];
    const deltaX = anchor ? anchor.x() - session.x0 : 0;
    const deltaY = anchor ? anchor.y() - session.y0 : 0;
    // Restore before invalidating/stopping the Konva drag. stopDrag() may synchronously emit the
    // child and Stage dragend handlers; at the authoritative origin those handlers can only make
    // a no-op patch, while the cleared session prevents the Stage from publishing a group commit.
    restoreGroupDragPreview(session, deltaX, deltaY);
    groupDragRef.current = null;
    anchor?.stopDrag();
    applyGuides([], []);
    applySmartGuides(EMPTY_SMART_GUIDE_OVERLAY);
    endLiveResourceEdit();
    return true;
  }

  function liveCanvasElementRect(
    element: El
  ): { x: number; y: number; width: number; height: number } {
    const fallback = elBounds(element);
    const node = nodeRefsRef.current[element.id];
    if (element.type === "draw") {
      // draw wrapper에는 scene-less hit Shape가 있어 getClientRect가 원점(0,0)을 포함할 수 있다.
      // 권위 points bounds에 wrapper의 imperative drag offset만 더해야 group snap union이 정확하다.
      return {
        x: fallback.x + (node?.x() ?? 0),
        y: fallback.y + (node?.y() ?? 0),
        width: fallback.w,
        height: fallback.h,
      };
    }
    if (node) {
      // A single coordinate object may be temporarily lifted to the sibling drag Layer. Measuring
      // every peer relative to the moving node's Layer mixes sibling coordinate systems under a
      // transformed Stage. Each direct Stage Layer shares document coordinates, so normalize each
      // node against its own Layer instead.
      const nodeLayer = node.getLayer();
      const rect = nodeLayer
        ? node.getClientRect({ relativeTo: nodeLayer })
        : node.getClientRect();
      if (
        Number.isFinite(rect.x) &&
        Number.isFinite(rect.y) &&
        Number.isFinite(rect.width) &&
        Number.isFinite(rect.height)
      ) {
        return rect;
      }
    }
    return {
      x: fallback.x,
      y: fallback.y,
      width: fallback.w,
      height: fallback.h,
    };
  }
  api.drawBrushCursorLayer = drawBrushCursorLayer;
  api.hideStrokeGuide = hideStrokeGuide;
  api.hideBrushCursorVisual = hideBrushCursorVisual;
  api.hideBrushCursor = hideBrushCursor;
  api.updateStrokeGuide = updateStrokeGuide;
  api.updateBrushCursor = updateBrushCursor;
  api.hideSmudgeCursor = hideSmudgeCursor;
  api.hideHealCloneCursors = hideHealCloneCursors;
  api.hideHistoryBrushCursor = hideHistoryBrushCursor;
  api.hideLayerMaskCursor = hideLayerMaskCursor;
  api.hideFilterMaskCursor = hideFilterMaskCursor;
  api.restoreGroupDragPreview = restoreGroupDragPreview;
  api.cancelCanvasGroupDrag = cancelCanvasGroupDrag;
  api.liveCanvasElementRect = liveCanvasElementRect;
}
