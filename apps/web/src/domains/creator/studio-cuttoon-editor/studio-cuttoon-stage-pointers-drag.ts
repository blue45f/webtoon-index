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

export function bindStudioCuttoonStagePointersDrag(
  h: StudioCuttoonStagePointersHost,
  api: StudioCuttoonStagePointersApi,
) {
  const {
    canvasInteractionUnitIds,
    commit,
    currentPageIdRef,
    endLiveResourceEdit,
    gridSize,
    groupDragRef,
    masterEditMode,
    masterEditModeRef,
    nodeRefsRef,
    pendingCommittedGroupDrawResetRef,
    setError,
    showAlignmentGuides,
    snapEnabled,
    userGuides,
    applyGuides,
    applySmartGuides,
    canvasH,
    effScale,
    elementById,
    elements,
    groups,
  } = h;
  const liveCanvasElementRect = (...args) => api.liveCanvasElementRect(...args);
  const restoreGroupDragPreview = (...args) => api.restoreGroupDragPreview(...args);
  function onStageDragMove(e: Konva.KonvaEventObject<DragEvent>) {
    const node = e.target;
    const stage = node.getStage();
    if (!node || node === stage) return;
    if (
      node instanceof KonvaRuntime.Transformer
      || node.getParent() instanceof KonvaRuntime.Transformer
    ) return; // 트랜스포머 proxy/앵커는 작성 객체와 별도 drag 이벤트를 내므로 제외.
    const draggedId = studioElementIdOf(node);
    if (!draggedId) return;
    const layer = node.getLayer();
    if (!layer) return;

    let activeGroupDrag = groupDragRef.current;
    const candidateGroupIds = canvasInteractionUnitIds(draggedId);
    const canStartGroupDrag =
      draggedId !== null &&
      candidateGroupIds.length > 1 &&
      candidateGroupIds.includes(draggedId) &&
      candidateGroupIds.every((id) => {
        const element = elementById.get(id);
        return Boolean(element && !isEffectivelyLocked(element, groups));
      });

    const translateGroupPreview = (
      anchorId: string,
      selectedIds: readonly string[],
      deltaX: number,
      deltaY: number
    ) => {
      if (deltaX === 0 && deltaY === 0) return;
      for (const id of selectedIds) {
        if (id === anchorId) continue;
        const other = nodeRefsRef.current[id];
        if (other) {
          other.x(other.x() + deltaX);
          other.y(other.y() + deltaY);
        }
      }
      const selectionOverlay = layer.findOne(".studio-group-selection-overlay");
      if (selectionOverlay) {
        selectionOverlay.x(selectionOverlay.x() + deltaX);
        selectionOverlay.y(selectionOverlay.y() + deltaY);
      }
      const resizeProxy = layer.findOne(".studio-group-uniform-resize-proxy");
      if (resizeProxy) {
        resizeProxy.x(resizeProxy.x() + deltaX);
        resizeProxy.y(resizeProxy.y() + deltaY);
      }
    };

    // 다중선택 그룹 이동: 좌표형과 draw wrapper, 전체 선택 경계를 함께 움직이고 문서에는
    // Stage drag-end에서 한 스냅샷만 커밋한다. 첫 dragmove 전에도 클릭한 그룹 단위를 다시 해석해
    // selection state 렌더 타이밍과 무관하게 전체 lease/preview를 동일한 멤버 집합으로 유지한다.
    if (draggedId && canStartGroupDrag) {
      const draggedEl = elementById.get(draggedId);
      if (draggedEl) {
        if (!activeGroupDrag || activeGroupDrag.id !== draggedId) {
          const x0 = draggedEl.type === "draw" ? 0 : draggedEl.x;
          const y0 = draggedEl.type === "draw" ? 0 : draggedEl.y;
          const currentX = node.x();
          const currentY = node.y();
          activeGroupDrag = {
            id: draggedId,
            x0,
            y0,
            lastX: currentX,
            lastY: currentY,
            selectedIds: [...candidateGroupIds],
          };
          groupDragRef.current = activeGroupDrag;
          const initialDx = currentX - x0;
          const initialDy = currentY - y0;
          translateGroupPreview(
            draggedId,
            activeGroupDrag.selectedIds,
            initialDx,
            initialDy
          );
        } else {
          const ddx = node.x() - activeGroupDrag.lastX;
          const ddy = node.y() - activeGroupDrag.lastY;
          if (ddx !== 0 || ddy !== 0) {
            translateGroupPreview(
              draggedId,
              activeGroupDrag.selectedIds,
              ddx,
              ddy
            );
            activeGroupDrag.lastX = node.x();
            activeGroupDrag.lastY = node.y();
          }
        }
      }
    }

    const liveSelectionRect = () => {
      const selectedIds = activeGroupDrag?.selectedIds;
      if (!selectedIds || selectedIds.length < 2) {
        return node.getClientRect({ relativeTo: layer });
      }
      const rects = selectedIds
        .map((id) => elementById.get(id))
        .filter((candidate): candidate is El => Boolean(candidate))
        .map((candidate) => liveCanvasElementRect(candidate));
      if (rects.length === 0) return node.getClientRect({ relativeTo: layer });
      const left = Math.min(...rects.map((rect) => rect.x));
      const top = Math.min(...rects.map((rect) => rect.y));
      const right = Math.max(...rects.map((rect) => rect.x + rect.width));
      const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
      return { x: left, y: top, width: right - left, height: bottom - top };
    };
    const liveMovingSelectionIds = new Set(
      activeGroupDrag?.selectedIds ?? (draggedId ? [draggedId] : [])
    );

    if (!snapEnabled) {
      applyGuides([], []);
      // "정렬선 표시"와 "위치 스냅"은 서로 다른 설정이다. 스냅을 끈 상태에서도
      // PPT/Figma처럼 가까운 엣지·중앙·균등 간격 후보를 ghost 위치로 계산해 선만 보여 준다.
      // 실제 Konva node 좌표는 이 분기에서 절대 바꾸지 않는다.
      if (showAlignmentGuides && draggedId) {
        const previewBoxRect = liveSelectionRect();
        const previewOthers: GuideBox[] = [];
        for (const element of elements) {
          if (
            liveMovingSelectionIds.has(element.id) ||
            isEffectivelyHidden(element, groups)
          ) {
            continue;
          }
          const rect = liveCanvasElementRect(element);
          previewOthers.push({
            id: element.id,
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          });
        }
        const movingBox: GuideBox = {
          id:
            activeGroupDrag?.selectedIds.length
              ? `selection:${activeGroupDrag.selectedIds.join(",")}`
              : draggedId,
          x: previewBoxRect.x,
          y: previewBoxRect.y,
          width: previewBoxRect.width,
          height: previewBoxRect.height,
        };
        const suggestion = computeSmartSnap(movingBox, previewOthers, {
          threshold: SMART_SNAP_THRESHOLD / effScale,
        });
        const preview = buildSmartGuideOverlayPreview(
          movingBox,
          previewOthers,
          suggestion,
          { epsilon: SMART_GUIDE_EPSILON / effScale },
        );
        applySmartGuides(preview?.overlay ?? EMPTY_SMART_GUIDE_OVERLAY);
      } else {
        applySmartGuides(EMPTY_SMART_GUIDE_OVERLAY);
      }
      return;
    }

    const box = liveSelectionRect();
    const snap = 8 / effScale; // 화면상 ~8px

    // 스냅 기준선: 캔버스 가장자리·중앙 + (있으면)들어있는 패널 가장자리·중앙
    const vLines = [0, CANVAS_W / 2, CANVAS_W];
    const hLines = [0, canvasH / 2, canvasH];

    // 작가 수동 가이드선 추가
    for (const guide of userGuides) {
      if (guide.type === "v") vLines.push(guide.pos);
      else hLines.push(guide.pos);
    }

    let panel: FrameEl | null = null;
    const boxCenterX = box.x + box.width / 2;
    const boxCenterY = box.y + box.height / 2;
    for (const candidate of elements) {
      if (
        candidate.type === "frame" &&
        !candidate.hidden &&
        boxCenterX >= candidate.x &&
        boxCenterX <= candidate.x + candidate.width &&
        boxCenterY >= candidate.y &&
        boxCenterY <= candidate.y + candidate.height
      ) {
        panel = candidate;
        break;
      }
    }
    if (panel) {
      vLines.push(panel.x, panel.x + panel.width / 2, panel.x + panel.width);
      hLines.push(panel.y, panel.y + panel.height / 2, panel.y + panel.height);
    }

    const edgesX = [box.x, box.x + box.width / 2, box.x + box.width];
    const edgesY = [box.y, box.y + box.height / 2, box.y + box.height];
    let dx = 0;
    let gx: number | null = null;
    let bestX = snap;
    for (const line of vLines)
      for (const edge of edgesX) {
        const dist = Math.abs(line - edge);
        if (dist < bestX) {
          bestX = dist;
          dx = line - edge;
          gx = line;
        }
      }
    let dy = 0;
    let gy: number | null = null;
    let bestY = snap;
    for (const line of hLines)
      for (const edge of edgesY) {
        const dist = Math.abs(line - edge);
        if (dist < bestY) {
          bestY = dist;
          dy = line - edge;
          gy = line;
        }
      }
    // Grid visibility is presentation-only: hidden grid lines remain valid placement targets.
    // Snap one visual anchor (the live bounding box's top-left), not all three edges plus the node
    // origin. With a 40px grid, three independent 8px attraction bands covered most positions and
    // made free movement feel like a sequence of tiny jumps.
    const gridAnchor = snapStudioObjectDragPosition({
      position: { x: box.x, y: box.y },
      enabled: snapEnabled,
      gridSize,
      viewportScale: effScale,
    });
    const gridDx = gridAnchor.x - box.x;
    const gridDy = gridAnchor.y - box.y;
    if (gridDx !== 0 && Math.abs(gridDx) < bestX) {
      dx = gridDx;
      gx = gridAnchor.x;
      bestX = Math.abs(gridDx);
    }
    if (gridDy !== 0 && Math.abs(gridDy) < bestY) {
      dy = gridDy;
      gy = gridAnchor.y;
      bestY = Math.abs(gridDy);
    }
    // ── 요소 간 스마트 가이드(PPT급): 엣지/센터 정렬 + 균등 간격 스냅 ──
    // 다른 요소들의 bbox를 O(n)으로 모아(숨김·함께 끌리는 다중선택군 제외) 후보를 구하고,
    // 축별로 캔버스/그리드 라인 스냅과 요소 스냅 중 더 가까운 쪽을 채택한다(동률이면 요소 우선).
    let smartOthers: GuideBox[] | null = null;
    if (draggedId) {
      smartOthers = [];
      for (const el of elements) {
        if (
          liveMovingSelectionIds.has(el.id) ||
          isEffectivelyHidden(el, groups)
        ) {
          continue;
        }
        const r = liveCanvasElementRect(el);
        smartOthers.push({
          id: el.id,
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
        });
      }
      const movingBox: GuideBox = {
        id:
          activeGroupDrag?.selectedIds.length
            ? `selection:${activeGroupDrag.selectedIds.join(",")}`
            : draggedId,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      };
      const smart = computeSmartSnap(movingBox, smartOthers, { threshold: SMART_SNAP_THRESHOLD / effScale });
      if (smart.x && smart.x.dist <= bestX) {
        dx = smart.x.delta;
        gx = null;
      }
      if (smart.y && smart.y.dist <= bestY) {
        dy = smart.y.delta;
        gy = null;
      }
    }
    if (dx !== 0) node.x(node.x() + dx);
    if (dy !== 0) node.y(node.y() + dy);
    if (activeGroupDrag && draggedId) {
      translateGroupPreview(
        draggedId,
        activeGroupDrag.selectedIds,
        dx,
        dy
      );
      activeGroupDrag.lastX = node.x();
      activeGroupDrag.lastY = node.y();
    }
    // 스냅 확정 위치 기준으로 요소 정렬 선분·균등 간격 배지를 그린다(그리드/캔버스 스냅
    // 결과가 우연히 요소와 정렬된 경우도 함께 드러난다 — PPT 동작).
    if (smartOthers && draggedId && showAlignmentGuides) {
      const movedBox: GuideBox = {
        id:
          activeGroupDrag?.selectedIds.length
            ? `selection:${activeGroupDrag.selectedIds.join(",")}`
            : draggedId,
        x: box.x + dx,
        y: box.y + dy,
        width: box.width,
        height: box.height,
      };
      applySmartGuides(buildSmartGuideOverlay(movedBox, smartOthers, { epsilon: SMART_GUIDE_EPSILON / effScale }));
    } else {
      applySmartGuides(EMPTY_SMART_GUIDE_OVERLAY);
    }
    applyGuides(
      showAlignmentGuides && gx != null ? [gx] : [],
      showAlignmentGuides && gy != null ? [gy] : []
    );
  }
  function onStageDragEnd() {
    applyGuides([], []);
    applySmartGuides(EMPTY_SMART_GUIDE_OVERLAY);
    // 그룹 이동 확정: child onDragEnd의 anchor patch는 patchEl에서 소비했고, 여기서 좌표형 요소와
    // points 기반 draw를 같은 delta로 계산해 히스토리/CRDT에 정확히 한 번만 커밋한다.
    const g = groupDragRef.current;
    groupDragRef.current = null;
    if (!g) return;
    const dnode = nodeRefsRef.current[g.id];
    let dx = 0;
    let dy = 0;
    let committed = false;
    try {
      if (dnode && g.selectedIds.length > 1) {
        dx = dnode.x() - g.x0;
        dy = dnode.y() - g.y0;
        if (dx === 0 && dy === 0) {
          committed = true;
          return;
        }
        const next = planAtomicSelectionTranslation({
          items: elements,
          selectedIds: g.selectedIds,
          deltaX: dx,
          deltaY: dy,
          isLocked: (element) => isEffectivelyLocked(element, groups),
        });
        const changed = next.some((element, index) => element !== elements[index]);
        committed = changed && commit(next);
        if (committed) {
          const drawIds = g.selectedIds.filter(
            (id) => elementById.get(id)?.type === "draw"
          );
          if (drawIds.length > 0) {
            pendingCommittedGroupDrawResetRef.current = {
              drawIds,
              sourceElements: elements,
              pageId: currentPageIdRef.current,
              masterEditMode: masterEditModeRef.current,
            };
          }
        }
        if (!changed) {
          setError("그룹 전체를 이동할 수 없어요. 잠금 또는 지원하지 않는 멤버를 확인하세요.");
        }
      }
    } finally {
      if (!committed && dnode && (dx !== 0 || dy !== 0)) {
        // 실패한 commit의 imperative preview가 화면에 남지 않게 원점으로 복구한다.
        restoreGroupDragPreview(g, dx, dy);
      }
      // 성공 commit 뒤 selection overlay는 새 문서 bounds를 자식으로 다시 그리므로 부모 preview
      // offset만 제거한다. resize proxy는 독립 absolute 노드라 이미 새 bounds 위치에 있다. 여기서
      // 되돌리면 다음 React layout 전까지 이전 위치가 한 프레임 노출되므로 성공 경로에서는 유지한다.
      const overlayLayer = dnode?.getLayer();
      const selectionOverlay = overlayLayer?.findOne(
        ".studio-group-selection-overlay"
      );
      if (selectionOverlay) {
        selectionOverlay.position({ x: 0, y: 0 });
      }
      overlayLayer?.batchDraw();
      endLiveResourceEdit();
    }
  }
  api.onStageDragMove = onStageDragMove;
  api.onStageDragEnd = onStageDragEnd;
}
