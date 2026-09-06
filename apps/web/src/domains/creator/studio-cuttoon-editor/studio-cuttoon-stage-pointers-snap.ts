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

export function bindStudioCuttoonStagePointersSnap(
  h: StudioCuttoonStagePointersHost,
  api: StudioCuttoonStagePointersApi,
) {
  const {
    advancedRulerSnapRef,
    drawingGesturePreviewPublisherRef,
    drawingInputSettingsRef,
    drawingPointerTransportRef,
    drawingRef,
    freehandObjectSnapLatchRef,
    healCloneCursorRef,
    healCloneOffsetRef,
    healCloneRadius,
    healCloneSourceCursorRef,
    historyBrushCursorRef,
    historyBrushRadius,
    isometricAxisRayRef,
    mainLayerRef,
    nodeRefsRef,
    perspectiveRayRef,
    quickShapeConvertedRef,
    quickShapeLivePointerOffsetRef,
    showAlignmentGuides,
    snapEnabled,
    strokeObjectSnapCacheRef,
    applySmartGuides,
    effScale,
    elements,
    groups,
    isometricAngleDeg,
    isometricGridActive,
    perspectiveRulerActive,
    scheduleDraft,
    vanishingPoints,
  } = h;

  // 복구 브러시/도장 호버 커서(브러시 원 + 소스 크로스헤어) — brushCursorRef 와 동일하게
  // ref 를 직접 갱신해 리렌더 없이 따라오게 한다. 드래그 중에도 계속 호출된다.
  function updateHealCloneCursorNodes(destNorm: SelPoint, frame: SelectionFrame) {
    const cursor = healCloneCursorRef.current;
    const srcCursor = healCloneSourceCursorRef.current;
    if (!cursor) return;
    const destCanvas = normalizedPointToCanvas(destNorm, frame);
    cursor.position(destCanvas);
    cursor.radius(healCloneRadius / effScale);
    if (!cursor.visible()) cursor.visible(true);
    if (srcCursor) {
      if (healCloneOffsetRef.current) {
        const srcNorm = healCloneSourcePoint(healCloneOffsetRef.current, destNorm);
        srcCursor.position(normalizedPointToCanvas(srcNorm, frame));
        if (!srcCursor.visible()) srcCursor.visible(true);
      } else {
        srcCursor.visible(false);
      }
    }
    cursor.getLayer()?.batchDraw();
  }
  // 히스토리 브러시 호버 커서(브러시 원) — healCloneCursorRef 와 동일하게 ref 를 직접 갱신해
  // 리렌더 없이 따라오게 한다.
  function updateHistoryBrushCursorNode(destNorm: SelPoint, frame: SelectionFrame) {
    const cursor = historyBrushCursorRef.current;
    if (!cursor) return;
    cursor.position(normalizedPointToCanvas(destNorm, frame));
    cursor.radius(historyBrushRadius / effScale);
    if (!cursor.visible()) cursor.visible(true);
    cursor.getLayer()?.batchDraw();
  }

  function snapPointToAdvancedRuler(
    ruler: StudioAdvancedRuler,
    start: { x: number; y: number },
    target: { x: number; y: number }
  ): { x: number; y: number } | null {
    const snapped = snapStudioAdvancedRulerStrokePoint(
      advancedRulerSnapRef.current,
      ruler,
      start,
      target
    );
    if (!snapped) return null;
    advancedRulerSnapRef.current = snapped.state;
    return snapped.point;
  }

  /** Element bboxes used as object-snap targets while placing strokes/shapes (excludes active draft). */
  function collectStrokeObjectSnapTargets(excludeId?: string | null): GuideBox[] {
    const targets: GuideBox[] = [];
    for (const el of elements) {
      if (excludeId && el.id === excludeId) continue;
      if (isEffectivelyHidden(el, groups)) continue;
      const node = nodeRefsRef.current[el.id];
      if (node && mainLayerRef.current) {
        try {
          const rect = node.getClientRect({ relativeTo: mainLayerRef.current });
          if (Number.isFinite(rect.width) && Number.isFinite(rect.height)) {
            targets.push({
              id: el.id,
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            });
            continue;
          }
        } catch {
          // Fall through to document bounds when the node is mid-detach.
        }
      }
      const bounds = elBounds(el);
      targets.push({
        id: el.id,
        x: bounds.x,
        y: bounds.y,
        width: bounds.w,
        height: bounds.h,
      });
    }
    return targets;
  }

  /**
   * One getClientRect walk per stroke contact. Other layers are static while the pointer owns
   * the stroke, so reusing the frozen target list keeps shape-endpoint moves O(1) in element count.
   */
  function strokeObjectSnapTargetsFor(strokeId: string, excludeId?: string | null): readonly GuideBox[] {
    const resolved = resolveStudioStrokeObjectSnapTargets({
      cache: strokeObjectSnapCacheRef.current,
      strokeId,
      collect: () => collectStrokeObjectSnapTargets(excludeId ?? strokeId),
    });
    strokeObjectSnapCacheRef.current = resolved.cache;
    return resolved.targets;
  }

  function applyStrokeObjectSnapToPoint(
    x: number,
    y: number,
    options: {
      mode?: string;
      kind?: string;
      sampleIndex: number;
      directionalRulerActive: boolean;
      excludeId?: string | null;
    }
  ): { x: number; y: number } {
    if (
      !shouldApplyStrokeObjectSnap({
        snapEnabled,
        showAlignmentGuides,
        mode: options.mode,
        kind: options.kind,
        sampleIndex: options.sampleIndex,
        directionalRulerActive: options.directionalRulerActive,
      })
    ) {
      return { x, y };
    }
    const strokeId = options.excludeId ?? drawingRef.current?.id;
    if (!strokeId) return { x, y };
    const others = strokeObjectSnapTargetsFor(strokeId, options.excludeId);
    if (others.length === 0) return { x, y };
    const threshold = SMART_SNAP_THRESHOLD / Math.max(effScale, 1e-6);
    const kind = options.kind ?? "freehand";
    // Freehand uses latch-based edge following so continuous samples do not zigzag between
    // nearby object edges. Shapes/lines use nearest-edge capture for explicit placement.
    const snap = kind === "freehand"
      ? (() => {
          const planned = planFreehandObjectSnapPoint({
            x,
            y,
            others,
            latch: freehandObjectSnapLatchRef.current,
            threshold,
          });
          freehandObjectSnapLatchRef.current = planned.latch;
          return planned;
        })()
      : snapPointToObjectGuides(x, y, others, { threshold });
    if (showAlignmentGuides && (snap.snappedX || snap.snappedY)) {
      applySmartGuides(buildPointObjectSnapOverlay(
        snap.x,
        snap.y,
        others,
        snap,
        { epsilon: SMART_GUIDE_EPSILON / Math.max(effScale, 1e-6) }
      ));
    } else {
      applySmartGuides(EMPTY_SMART_GUIDE_OVERLAY);
    }
    // Guide-only mode (alignment guides on, snap master off): preview guides without bending ink.
    if (!shouldMutateStrokeWithObjectSnap({ snapEnabled })) {
      return { x, y };
    }
    return { x: snap.x, y: snap.y };
  }

  function updateActiveShapeEndpoint(
    stage: Konva.Stage,
    pointerEvent: PointerEvent,
    schedulePreview: boolean
  ): boolean {
    const current = drawingRef.current;
    const kind = current?.kind ?? "freehand";
    if (
      !current
      || kind === "freehand"
      || !isStudioStrokePointerEvent(requireStudioDrawingPointerTransport(drawingPointerTransportRef).getSession(), pointerEvent)
    ) return false;

    // Capture-phase pointerup runs before Konva updates its pointer position. Feed the native event
    // through Konva's public coordinate path so a fast drag commits the actual lift point.
    stage.setPointersPositions(pointerEvent);
    const pos = stage.getRelativePointerPosition();
    if (!pos) return false;
    const x0 = current.points[0] ?? pos.x;
    const y0 = current.points[1] ?? pos.y;
    const livePointerOffset = quickShapeConvertedRef.current
      ? quickShapeLivePointerOffsetRef.current
      : null;
    let x1 = pos.x + (livePointerOffset?.x ?? 0);
    let y1 = pos.y + (livePointerOffset?.y ?? 0);
    const inputSettings = drawingInputSettingsRef.current;
    // Shift is the explicit gesture and therefore wins over perspective/isometric ruler locks.
    let directionalRulerActive = false;
    if (inputSettings?.advancedRuler && kind === "line" && !pointerEvent.shiftKey) {
      const snapped = snapPointToAdvancedRuler(
        inputSettings.advancedRuler,
        { x: x0, y: y0 },
        { x: x1, y: y1 }
      );
      if (snapped) {
        x1 = snapped.x;
        y1 = snapped.y;
        directionalRulerActive = true;
      }
    } else if (perspectiveRulerActive && kind === "line" && !pointerEvent.shiftKey && vanishingPoints.length > 0) {
      if (!perspectiveRayRef.current) {
        perspectiveRayRef.current = resolvePerspectiveRay(vanishingPoints, x0, y0, x1, y1);
      }
      [x1, y1] = snapStrokePointToPerspective(x1, y1, perspectiveRayRef.current);
      directionalRulerActive = perspectiveRayRef.current !== null;
    } else if (
      shouldSnapStrokeToIsometricAxis({
        active: isometricGridActive,
        mode: current.mode,
        kind,
      })
      && !pointerEvent.shiftKey
    ) {
      if (!isometricAxisRayRef.current) {
        isometricAxisRayRef.current = resolveIsometricAxisRay(isometricAngleDeg, x0, y0, x1, y1);
      }
      [x1, y1] = snapStrokePointToIsometricGrid(x1, y1, isometricAxisRayRef.current);
      directionalRulerActive = isometricAxisRayRef.current !== null;
    }
    if (!directionalRulerActive && !pointerEvent.shiftKey) {
      const snapped = applyStrokeObjectSnapToPoint(x1, y1, {
        mode: current.mode,
        kind,
        sampleIndex: 1,
        directionalRulerActive: false,
        excludeId: current.id,
      });
      x1 = snapped.x;
      y1 = snapped.y;
    }
    if (pointerEvent.shiftKey) {
      const dx = x1 - x0;
      const dy = y1 - y0;
      if (kind === "line") {
        if (Math.abs(dx) > Math.abs(dy) * 2) y1 = y0;
        else if (Math.abs(dy) > Math.abs(dx) * 2) x1 = x0;
        else {
          const size = Math.max(Math.abs(dx), Math.abs(dy));
          x1 = x0 + Math.sign(dx || 1) * size;
          y1 = y0 + Math.sign(dy || 1) * size;
        }
      } else {
        const size = Math.max(Math.abs(dx), Math.abs(dy));
        x1 = x0 + Math.sign(dx || 1) * size;
        y1 = y0 + Math.sign(dy || 1) * size;
      }
    }
    const next = { ...current, points: [x0, y0, x1, y1] };
    drawingRef.current = next;
    drawingGesturePreviewPublisherRef.current.replaceShape(next);
    if (schedulePreview) scheduleDraft(next);
    return true;
  }
  api.updateHealCloneCursorNodes = updateHealCloneCursorNodes;
  api.updateHistoryBrushCursorNode = updateHistoryBrushCursorNode;
  api.snapPointToAdvancedRuler = snapPointToAdvancedRuler;
  api.collectStrokeObjectSnapTargets = collectStrokeObjectSnapTargets;
  api.strokeObjectSnapTargetsFor = strokeObjectSnapTargetsFor;
  api.applyStrokeObjectSnapToPoint = applyStrokeObjectSnapToPoint;
  api.updateActiveShapeEndpoint = updateActiveShapeEndpoint;
}
