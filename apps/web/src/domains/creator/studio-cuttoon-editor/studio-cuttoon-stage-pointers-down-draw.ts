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

export function bindStudioCuttoonStagePointersDownDraw(
  h: StudioCuttoonStagePointersHost,
  api: StudioCuttoonStagePointersApi,
) {
  const {
    activeCatalogBrush,
    activeGroupIdRef,
    advancedRulerSnapRef,
    announceDrawingShortcut,
    appSettingsRef,
    beginLiveResourceEdit,
    beginStudioDrawLiveSurfaces,
    brush,
    brushDynamics,
    brushEnginePrograms,
    brushOpacity,
    collaborationAccessRef,
    color,
    discardDrawingPointerSession,
    drawMode,
    drawShape,
    drawingCrdtPublishErrorRef,
    drawingCrdtPublisherRef,
    drawingCrdtStrokeActiveRef,
    drawingFixedRateFilterRef,
    drawingGesturePreviewPublisherRef,
    drawingImmediateCausalInputRef,
    drawingInkTimeOriginRef,
    drawingInputSettingsRef,
    drawingLastAuthoritativePointerRef,
    drawingPointerTransportRef,
    drawingPrecisionStabilizerBridgeRef,
    drawingRef,
    drawingStabilizerRef,
    drawingThinLineInkInputRef,
    drawingVelocityPressureRef,
    drawingVelocityRef,
    endLiveResourceEdit,
    flushPendingStrokeCommitsRef,
    hokusaiLiveFinalizingRef,
    isSpacePressed,
    isometricAxisRayRef,
    liveDynamicBrushOverlayRendererRef,
    liveRetainedMediaOverlayRendererRef,
    liveInkOverlayRendererRef,
    liveStampOverlayRendererRef,
    liveWetInkOverlayRendererRef,
    livingInkFinalizingRef,
    marqueeStartRef,
    pendingGpuStrokesRef,
    pendingStrokeCommitsRef,
    perspectiveRayRef,
    postCorrection,
    preserveCorners,
    pressureCurve,
    pressureMinSize,
    quickShapeActive,
    session,
    setActiveGroupId,
    setError,
    setMarqueeIds,
    setSelectedId,
    settleZoomGestureRef,
    shapeFill,
    showAlignmentGuides,
    snapEnabled,
    stabilizer,
    stabilizerMode,
    stageRef,
    stampTuning,
    startFixedRateStrokePump,
    startQuickShapeTracking,
    stopQuickShapeTracking,
    strokeWidth,
    studioCrdtDocumentRef,
    symmetryCenterX,
    symmetryCenterY,
    symmetryRadialCount,
    symmetryType,
    tiltEnabled,
    tipAngle,
    tipRoundness,
    tool,
    useVelocityPressure,
    velocitySensitivity,
    zoomGestureRef,
    activePage,
    clearMarqueePreview,
    drawingAssistDocument,
    effScale,
    isRealtimeTeamSession,
    isometricAngleDeg,
    isometricGridActive,
    perspectiveRulerActive,
    scheduleLiveDrawPressure,
    selected,
    vanishingPoints,
  } = h;
  const applyStrokeObjectSnapToPoint = (...args) => api.applyStrokeObjectSnapToPoint(...args);
  const updateBrushCursor = (...args) => api.updateBrushCursor(...args);
  function tryStageDownDraw(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>, stagePointerEvent: PointerEvent) {
    if (tool === "draw") {
      if (livingInkFinalizingRef.current) {
        announceDrawingShortcut("수채 번짐 프레임을 저장하는 중입니다 · 잠시 후 다음 획을 그려 주세요");
        return;
      }
      if (hokusaiLiveFinalizingRef.current) {
        announceDrawingShortcut("자연매체 획을 저장하는 중입니다 · 잠시 후 다음 획을 그려 주세요");
        return;
      }
      const pointerSample = e.evt as PointerEvent;
      // Capture the frame-clock anchor alongside pointerdown, before CRDT/render setup can add
      // device-dependent latency. The pump later maps this elapsed time back to the event clock.
      const pointerDownFrameTimeStamp = globalThis.performance?.now?.() ?? pointerSample.timeStamp;
      // 터치 정책: one-finger drag = draw | pan | none. Palm rejection ignores touch while pen preferred.
      const touchPrefs = appSettingsRef.current.touch;
      if (pointerSample.pointerType === "touch") {
        if (touchPrefs.oneFingerDrag !== "draw") return;
        if (touchPrefs.palmRejection && requireStudioDrawingPointerTransport(drawingPointerTransportRef).getSession()?.pointerType === "pen") return;
      }
      const activePointerSession = requireStudioDrawingPointerTransport(drawingPointerTransportRef).getSession();
      if (activePointerSession || drawingRef.current) {
        if (drawingRef.current) {
          if (isStudioStrokePointerEvent(activePointerSession, pointerSample)) return;
          if (shouldCancelStudioFingerStrokeForAdditionalContact(activePointerSession, pointerSample)) {
            // Two fingers mean navigation, not two simultaneous brush tips. Cancel the unfinished
            // finger stroke before the existing wrap-level pinch/undo gesture consumes both touches.
            // A pen plus a touch is deliberately different: the touch is treated as palm input.
            discardDrawingPointerSession();
          }
          return;
        }
        // Dangling transport state should never permanently block a new stroke.
        // If drawingRef is already null, drop the stale stroke session and allow this input to proceed.
        discardDrawingPointerSession();
      }
      if (zoomGestureRef.current) {
        // A wheel/pinch preview owns a temporary CSS transform for up to 170ms. Commit that view
        // synchronously before reading the stroke origin so the transform cannot settle halfway
        // through this contact and change the captured document coordinate system.
        flushSync(() => settleZoomGestureRef.current());
        stageRef.current?.setPointersPositions(pointerSample);
      }
      const pendingBatch = pendingStrokeCommitsRef.current;
      if (
        pendingBatch
        && pendingBatch.pageId !== activePage.id
        && !flushPendingStrokeCommitsRef.current()
      ) {
        setError(
          "이전 페이지의 마지막 획을 확정하지 못해 새 획을 시작하지 않았어요. 잠금·동기화 상태를 확인한 뒤 다시 시도해 주세요."
        );
        return;
      }
      const backdropPendingBatch = pendingStrokeCommitsRef.current;
      const backdropBoundary = planStudioDraftPreviewBackdropBoundary({
        incoming: {
          brush: drawMode === "pen" ? brush : undefined,
          fill:
            drawMode === "lasso-fill"
              ? color
              : drawMode === "shape" && shapeFill && drawShape !== "line"
                ? color
                : undefined,
          kind: drawMode === "shape" ? drawShape : "freehand",
          mode: drawMode === "eraser" ? "eraser" : "pen",
        },
        pending: backdropPendingBatch?.pageId === activePage.id
          ? backdropPendingBatch.strokes
          : [],
        hasRetainedDomBackdrop: backdropPendingBatch !== null && (
          liveInkOverlayRendererRef.current.hasSettledStrokes
          || liveStampOverlayRendererRef.current.hasSettledStrokes
          || liveDynamicBrushOverlayRendererRef.current.hasSettledStrokes
          || liveRetainedMediaOverlayRendererRef.current.hasSettledStrokes
          || liveWetInkOverlayRendererRef.current.hasSettledStrokes
          || pendingGpuStrokesRef.current.length > 0
        ),
        overlayOwnsPendingAndIncoming: Boolean(
          backdropPendingBatch
          && backdropPendingBatch.pageId === activePage.id
          && liveRetainedMediaOverlayRendererRef.current.hasSettledStrokes
          && (drawMode === "eraser" || studioLiveRetainedMediaOverlaySupportsElement({
            id: "incoming-retained-probe", type: "draw",
            kind: drawMode === "shape" ? drawShape : "freehand",
            mode: drawMode === "eraser" ? "eraser" : "pen",
            brush: drawMode === "pen" ? brush : undefined,
            points: [0, 0], stroke: color, strokeWidth: 1, opacity: 1,
          }))
          && backdropPendingBatch.strokes.every((stroke) => (
            studioLiveRetainedMediaOverlaySupportsElement(stroke)
          )),
        ),
      });
      const backdropBoundaryExecution = executeStudioDraftPreviewBackdropBoundary({
        plan: backdropBoundary,
        flushSynchronously: flushSync,
        flushPending: () => flushPendingStrokeCommitsRef.current(),
        restorePointerPosition: () => stageRef.current?.setPointersPositions(pointerSample),
      });
      if (!backdropBoundaryExecution.ready) {
        setError(
          "앞선 획의 합성 순서를 확정하지 못해 새 획을 시작하지 않았어요. 잠금·동기화 상태를 확인한 뒤 다시 시도해 주세요."
        );
        return;
      }
      // A CRDT stroke has its own conflict-free operation stream, so it must not claim the old
      // page-wide lease that prevented two artists from drawing at once. Keep the lease fallback
      // only while the durable document is not connected.
      if (!studioCrdtDocumentRef.current && !beginLiveResourceEdit()) return;
      const pointerSession = beginStudioStrokePointerSession(pointerSample);
      // A second contact cannot replace a live pen stroke. Right-click/barrel-button presses also
      // remain available to the context menu instead of leaving a one-point draft behind.
      if (!pointerSession) {
        endLiveResourceEdit();
        return;
      }
      const pos = stageRef.current?.getRelativePointerPosition()
        ?? e.target.getStage()?.getRelativePointerPosition();
      // Every early exit after a successful begin must release — stranded claimLock is collab-unsafe.
      if (!pos) {
        endLiveResourceEdit();
        return;
      }
      updateBrushCursor(e.target.getStage(), pointerSample);
      // One pointer contact owns one immutable input contract. Toolbar shortcuts can re-render
      // while a pen is still down; those new preferences apply to the next stroke, never halfway
      // through the current filter/pressure/post-correction pipeline.
      const strokeAdvancedRuler = resolveActiveStudioAdvancedRuler(
        drawingAssistDocument.advanced,
        selected?.groupId ?? null
      );
      drawingInputSettingsRef.current = {
        version: 1,
        stabilizer,
        stabilizerMode,
        postCorrection,
        preserveCorners,
        pressureCurve,
        pressureMinSize,
        useVelocityPressure,
        velocitySensitivity,
        coordinateScale: effScale,
        perspectiveActive: !strokeAdvancedRuler && perspectiveRulerActive,
        vanishingPoints: vanishingPoints.map((point: any) => ({ ...point })),
        isometricActive: !strokeAdvancedRuler && isometricGridActive,
        isometricAngleDeg,
        advancedRuler: strokeAdvancedRuler ? structuredClone(strokeAdvancedRuler) : null,
      };
      setSelectedId(null);

      const drawStartPlan = planStudioDrawPointerStart({
        id: uid(),
        position: pos,
        pointer: pointerSample,
        drawMode,
        drawShape,
        shapeFill,
        color,
        strokeWidth,
        brushOpacity,
        brush,
        brushCatalogId: activeCatalogBrush.id, brushCatalogName: activeCatalogBrush.name,
        stampTuning, brushDynamics,
        brushEnginePrograms,
        stabilizer,
        stabilizerMode,
        velocitySensitivity,
        pressureCurve,
        pressureMinSize,
        positionScale: effScale,
        brushTip: { tiltEnabled, angleDeg: tipAngle, roundness: tipRoundness },
        symmetry: {
          type: symmetryType,
          centerX: symmetryCenterX,
          centerY: symmetryCenterY,
          radialCount: symmetryRadialCount,
        },
      });
      const {
        causalInitialSample,
        causalInputPlan,
        pressure,
        stylus,
      } = drawStartPlan;
      let { element: next, strokeOrigin } = drawStartPlan;
      const linked3dCorrection = !isRealtimeTeamSession && drawMode === "pen"
        ? createStudioLinked3dCorrectionProvenance(
            activePage.linked3dRender,
            selected?.id,
          )
        : null;
      if (linked3dCorrection) next = { ...next, linked3dCorrection };
      // Snap explicit shape origins to neighboring object edges when no directional ruler is
      // active. Freehand coordinates must remain untouched so acquiring a guide cannot kink ink.
      {
        const directionalRulerActive = Boolean(
          strokeAdvancedRuler
          || (!strokeAdvancedRuler && perspectiveRulerActive && vanishingPoints.length > 0)
          || (
            !strokeAdvancedRuler
            && shouldSnapStrokeToIsometricAxis({
              active: isometricGridActive,
              mode: next.mode,
              kind: next.kind ?? "freehand",
            })
          )
        );
        if (
          shouldApplyStrokeObjectSnap({
            snapEnabled,
            showAlignmentGuides,
            mode: next.mode,
            kind: next.kind ?? "freehand",
            sampleIndex: 0,
            directionalRulerActive,
          })
        ) {
          const snapped = applyStrokeObjectSnapToPoint(strokeOrigin.x, strokeOrigin.y, {
            mode: next.mode,
            kind: next.kind ?? "freehand",
            sampleIndex: 0,
            directionalRulerActive,
            excludeId: next.id,
          });
          if (snapped.x !== strokeOrigin.x || snapped.y !== strokeOrigin.y) {
            strokeOrigin = { x: snapped.x, y: snapped.y };
            const points = next.points.slice();
            if (points.length >= 2) {
              points[0] = snapped.x;
              points[1] = snapped.y;
            }
            // Shape origin is duplicated as the initial endpoint until the drag moves.
            if ((next.kind ?? "freehand") !== "freehand" && points.length >= 4) {
              points[2] = snapped.x;
              points[3] = snapped.y;
            }
            next = { ...next, points };
          }
        }
      }
      if (drawMode === "pen") scheduleLiveDrawPressure(pressure);
      // Pointer-up is a lifecycle signal, not a new freehand coordinate. Retain pointer-down now
      // so a tap and a stroke with no delivered move still have authoritative release metadata.
      drawingLastAuthoritativePointerRef.current = pointerSample;
      const pointerTransportStart = requireStudioDrawingPointerTransport(drawingPointerTransportRef).start({
        pointerEvent: pointerSample,
        session: pointerSession,
        stage: e.target.getStage(),
      });
      if (!pointerTransportStart.started) {
        drawingLastAuthoritativePointerRef.current = null;
        drawingInkTimeOriginRef.current = null;
        drawingInputSettingsRef.current = null;
        scheduleLiveDrawPressure(null);
        endLiveResourceEdit();
        return;
      }
      drawingImmediateCausalInputRef.current = causalInputPlan.quantizeImmediately;
      drawingThinLineInkInputRef.current = shouldFilterStudioThinLineInkInput({
        brushId: next.brush,
        immediateCausalInput: causalInputPlan.quantizeImmediately,
      })
        ? createStudioThinLineInkInputState({
            x: strokeOrigin.x,
            y: strokeOrigin.y,
            timeStamp: pointerSample.timeStamp,
          })
        : null;
      // Pixel pencil bypasses stabilizers; positive standard strength keeps the exact 5ms cascade.
      drawingFixedRateFilterRef.current = causalInputPlan.usesFixedRateClock
        ? createFixedRateStrokeFilter({
            x: strokeOrigin.x, y: strokeOrigin.y, positionScale: effScale, pressure,
            tiltX: causalInitialSample?.tiltX ?? stylus.tiltX,
            tiltY: causalInitialSample?.tiltY ?? stylus.tiltY,
            timeStamp: pointerSample.timeStamp,
          }, stabilizer).state
        : null;
      drawingStabilizerRef.current =
        drawMode === "shape" || drawMode === "pixel" || causalInputPlan.sampleSpacing === 0
          ? null
          : createStudioStrokeStabilizerState({
              x: strokeOrigin.x,
              y: strokeOrigin.y,
              timeStamp: pointerSample.timeStamp,
            });
      drawingPrecisionStabilizerBridgeRef.current?.reset();
      drawingPrecisionStabilizerBridgeRef.current = null;
      if (
        drawingStabilizerRef.current
        && drawingFixedRateFilterRef.current === null
        && stabilizerMode === "precision"
        && stabilizer > 0
      ) {
        const bridge = createStudioStrokeStabilizerBridge();
        const first = bridge.commit(
          {
            x: strokeOrigin.x,
            y: strokeOrigin.y,
            timeStamp: pointerSample.timeStamp,
            pointerType:
              pointerSample.pointerType === "mouse"
              || pointerSample.pointerType === "pen"
              || pointerSample.pointerType === "touch"
                ? pointerSample.pointerType
                : "unknown",
            pointerId: pointerSample.pointerId,
          },
          {
            strength: stabilizer,
            mode: "precision",
            coordinateScale: effScale,
            useLazyPrecision: true,
            lazyPointerPolicy: "all",
          }
        );
        drawingStabilizerRef.current = first.state;
        drawingPrecisionStabilizerBridgeRef.current = bridge;
      }
      drawingVelocityRef.current =
        drawMode === "shape" || drawMode === "pixel"
          ? null
          : createStudioPointerVelocityState(pointerSample);
      drawingVelocityPressureRef.current = initializeStudioBrushVelocityPressure(
        drawMode, pointerSample, next, drawingInputSettingsRef.current
      );
      drawingInkTimeOriginRef.current = studioInkGestureTimeOrigin(next.inkInput, pointerSample.timeStamp);
      drawingRef.current = next;
      drawingGesturePreviewPublisherRef.current.begin({
        pageId: activePage.id,
        documentGeneration: collaborationAccessRef.current.documentGeneration,
        element: next,
      });
      // The active cursor is outline-only, so it can track the contact without darkening stable
      // pixels or becoming part of the live-ink/commit receipt.
      perspectiveRayRef.current = null; // 새 스트로크마다 원근 락을 다시 잡는다(첫 move에서 재계산).
      isometricAxisRayRef.current = null; // 새 스트로크마다 아이소메트릭 축 락도 다시 잡는다.
      advancedRulerSnapRef.current = null;
      if (!beginStudioDrawLiveSurfaces(next, pointerSample, strokeOrigin)) {
        // The selected renderer failed admission. Do not commit or publish the draft through a
        // different surface; cleanup leaves the previous document frame intact.
        discardDrawingPointerSession();
        return;
      }
      drawingCrdtPublisherRef.current.cancel();
      drawingCrdtStrokeActiveRef.current = false;
      const crdtDocument = studioCrdtDocumentRef.current;
      if (crdtDocument) {
        try {
          const crdtStroke = studioDrawElementToCrdtStroke(activePage.id, next);
          drawingCrdtStrokeActiveRef.current = true;
          drawingCrdtPublisherRef.current.begin(next.id, () => {
            if (
              !drawingCrdtStrokeActiveRef.current
              || studioCrdtDocumentRef.current !== crdtDocument
            ) {
              throw new Error("실시간 협업 문서가 획 시작 전에 변경되었습니다.");
            }
            crdtDocument.beginStroke(crdtStroke);
          });
        } catch (cause) {
          drawingCrdtPublisherRef.current.cancel(next.id);
          drawingCrdtPublishErrorRef.current(cause);
        }
      }
      startFixedRateStrokePump(pointerSample, pointerDownFrameTimeStamp);
      if (drawMode === "pen" && quickShapeActive) startQuickShapeTracking(strokeOrigin);
      else stopQuickShapeTracking(); // 방어적 — 이전 스트로크 타이머 잔존 방지
      return;
    }
    // 선택 모드: 빈 영역에서 드래그하면 마퀴(PPT식 박스) 다중선택, 그냥 클릭이면 선택 해제.
    if (e.target === e.target.getStage() || e.target.name() === "bg") {
      setSelectedId(null);
      setMarqueeIds([]);
      // 빈 영역 클릭은 그룹 진입 상태도 함께 빠져나온다(PPT/Figma: 그룹 밖 클릭 = 그룹에서 나가기).
      activeGroupIdRef.current = null;
      setActiveGroupId(null);
      if (!isSpacePressed) {
        const pos = e.target.getStage()?.getRelativePointerPosition();
        if (pos) {
          marqueeStartRef.current = { x: pos.x, y: pos.y };
          clearMarqueePreview();
        }
      }
    }
  }
  api.tryStageDownDraw = tryStageDownDraw;
}
