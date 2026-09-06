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

export function bindStudioCuttoonStagePointersFreehand(
  h: StudioCuttoonStagePointersHost,
  api: StudioCuttoonStagePointersApi,
) {
  const {
    drawMode,
    drawingFixedRateFilterRef,
    drawingImmediateBatchMutationRef,
    drawingImmediateCausalInputRef,
    drawingInkTimeOriginRef,
    drawingInputSettingsRef,
    drawingPrecisionStabilizerBridgeRef,
    drawingPredictionBatchMutationRef,
    drawingPredictionPreviewRef,
    drawingRef,
    drawingStabilizerRef,
    drawingThinLineInkInputRef,
    drawingVelocityPressureRef,
    drawingVelocityRef,
    gpuLiveInkPinnedRef,
    gpuLiveSourceJournalRef,
    isometricAxisRayRef,
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
    perspectiveRayRef,
    pressureCurve,
    pressureMinSize,
    stabilizer,
    stabilizerMode,
    stopFixedRateStrokePump,
    useVelocityPressure,
    velocitySensitivity,
    effScale,
    exitDirectLiveDraft,
    isometricAngleDeg,
    isometricGridActive,
    perspectiveRulerActive,
    scheduleDraft,
    scheduleLiveDrawPressure,
    vanishingPoints,
  } = h;
  const appendFixedRateStrokeSamples = (...args) => api.appendFixedRateStrokeSamples(...args);
  const applyStrokeObjectSnapToPoint = (...args) => api.applyStrokeObjectSnapToPoint(...args);
  const snapPointToAdvancedRuler = (...args) => api.snapPointToAdvancedRuler(...args);
  function appendFreehandStrokePoint(
    pos: { x: number; y: number },
    pointerSample: PointerEvent,
    pressureOverride?: number,
    canonicalTimeStamp?: number
  ) {
    const current = drawingRef.current;
    if (!current) return;
    const inputSettings = drawingInputSettingsRef.current;
    const rawLastX = current.points[current.points.length - 2] ?? pos.x;
    const rawLastY = current.points[current.points.length - 1] ?? pos.y;
    const sampleTimeStamp = typeof canonicalTimeStamp === "number" && Number.isFinite(canonicalTimeStamp)
      ? canonicalTimeStamp
      : pointerSample.timeStamp;
    const timingSample = {
      clientX: pointerSample.clientX,
      clientY: pointerSample.clientY,
      timeStamp: sampleTimeStamp,
    };
    const previousVelocity = drawingVelocityRef.current ?? createStudioPointerVelocityState(timingSample);
    const velocitySample = sampleStudioPointerVelocity(previousVelocity, timingSample);
    drawingVelocityRef.current = velocitySample.state;
    const velocityPressure = advanceStudioBrushVelocityPressure(
      drawingVelocityPressureRef.current,
      {
        x: pointerSample.clientX,
        y: pointerSample.clientY,
        timeMs: sampleTimeStamp,
        pointerType: pointerSample.pointerType,
        pressure: pointerSample.pressure,
      },
      {
        brushId: current.brush,
        pressureCurve: inputSettings?.pressureCurve ?? pressureCurve,
        pressureMinSize: inputSettings?.pressureMinSize ?? pressureMinSize,
        useVelocityPressure: inputSettings?.useVelocityPressure ?? useVelocityPressure,
        velocitySensitivity:
          inputSettings?.velocitySensitivity ?? velocitySensitivity,
        fallbackPressure: studioInkFallbackPressure(current.pressureModel),
      }
    );
    drawingVelocityPressureRef.current = velocityPressure.state;
    let pressure = typeof pressureOverride === "number" && Number.isFinite(pressureOverride)
      ? Math.min(1, Math.max(0, pressureOverride))
      : velocityPressure.pressure;
    let targetX = pos.x;
    let targetY = pos.y;
    if (
      drawingThinLineInkInputRef.current
      && shouldFilterStudioThinLineInkInput({
        brushId: current.brush,
        immediateCausalInput: drawingImmediateCausalInputRef.current,
      })
    ) {
      const filtered = filterStudioThinLineInkInput(
        drawingThinLineInkInputRef.current,
        { x: targetX, y: targetY, timeStamp: sampleTimeStamp },
        inputSettings?.coordinateScale ?? effScale,
      );
      if (!drawingPredictionPreviewRef.current) {
        drawingThinLineInkInputRef.current = filtered.state;
      }
      targetX = filtered.x;
      targetY = filtered.y;
    }
    if (
      drawingImmediateCausalInputRef.current
      || drawingFixedRateFilterRef.current !== null
    ) {
      const stylus = normalizeCalligraphyStylusInput(pointerSample);
      const quantized = quantizeFixedRateStrokeSample({
        x: targetX,
        y: targetY,
        positionScale: inputSettings?.coordinateScale ?? effScale,
        pressure,
        tiltX: stylus.tiltX,
        tiltY: stylus.tiltY,
        timeStamp: sampleTimeStamp,
      });
      targetX = quantized.x;
      targetY = quantized.y;
      pressure = quantized.pressure;
    }
    if (!drawingPredictionPreviewRef.current) scheduleLiveDrawPressure(pressure);

    // Commercial freehand + Shift: force a clean straight line from stroke origin (0/45/90°).
    // Applied before perspective/isometric so the artist's explicit Shift intent wins.
    if (pointerSample.shiftKey && current.mode !== "eraser" && current.points.length >= 2) {
      const transition = resolveShiftFreehandTransition({
        currentPoints: current.points,
        currentPressures: current.pressures,
        endX: targetX,
        endY: targetY,
        pressure,
      });
      const shiftPersistsExtendedChannels = isStudioInkInputContractV2(
        current.inkInput,
      );
      const shiftPointerChannels = normalizeStudioPersistedPointerChannels(
        pointerSample,
        {
          timeOriginMilliseconds:
            drawingInkTimeOriginRef.current ?? pointerSample.timeStamp,
          previousTimeOffsetMilliseconds: current.sampleTimeOffsets?.[0] ?? 0,
          sourceTimeMilliseconds: pointerSample.timeStamp,
        },
      );
      const shiftStylus = shiftPersistsExtendedChannels
        ? normalizeCalligraphyStylusInput(pointerSample)
        : null;
      const shiftTangentialPressure =
        Number.isFinite(pointerSample.tangentialPressure)
          ? Math.min(1, Math.max(-1, pointerSample.tangentialPressure))
          : 0;
      const nextShift: DrawEl = {
        ...current,
        points: transition.points,
        pressures: transition.pressures,
        // A v2 retained-input stroke remains exactly aligned even while Shift replaces its whole
        // path with a two-point segment. Legacy contracts keep their historical omitted arrays.
        tiltXs: shiftStylus
          ? [current.tiltXs?.[0] ?? 0, shiftStylus.tiltX]
          : undefined,
        tiltYs: shiftStylus
          ? [current.tiltYs?.[0] ?? 0, shiftStylus.tiltY]
          : undefined,
        twists: shiftStylus
          ? [current.twists?.[0] ?? 0, shiftStylus.twist]
          : undefined,
        speeds: shiftPersistsExtendedChannels
          ? [current.speeds?.[0] ?? 0, velocitySample.speed]
          : undefined,
        tangentialPressures: shiftPersistsExtendedChannels
          ? [
              current.tangentialPressures?.[0] ?? 0,
              shiftTangentialPressure,
            ]
          : undefined,
        altitudeAngles: shiftPersistsExtendedChannels
          ? [
              current.altitudeAngles?.[0] ?? Math.PI / 2,
              shiftPointerChannels.altitudeAngle,
            ]
          : undefined,
        azimuthAngles: shiftPersistsExtendedChannels
          ? [
              current.azimuthAngles?.[0] ?? 0,
              shiftPointerChannels.azimuthAngle,
            ]
          : undefined,
        contactWidths: shiftPersistsExtendedChannels
          ? [
              current.contactWidths?.[0] ?? 1,
              shiftPointerChannels.contactWidth,
            ]
          : undefined,
        contactHeights: shiftPersistsExtendedChannels
          ? [
              current.contactHeights?.[0] ?? 1,
              shiftPointerChannels.contactHeight,
            ]
          : undefined,
        sampleTimeOffsets: shiftPersistsExtendedChannels
          ? [
              current.sampleTimeOffsets?.[0] ?? 0,
              shiftPointerChannels.timeOffsetMilliseconds,
            ]
          : undefined,
      };
      // Shift replaces the endpoint instead of appending samples. Retained Canvas/WebGPU surfaces
      // cannot erase the previous preview safely, so hand this gesture to the replaceable draft
      // layer before publishing its first constrained line.
      if (
        (liveDraftDirectRef.current || liveStampDraftDirectRef.current)
        && !drawingPredictionPreviewRef.current
      ) exitDirectLiveDraft();
      // The Shift gesture replaces the whole freehand suffix. A pre-constraint stabilizer still
      // points at the old raw sample and would be flushed after the snapped endpoint on pointer-up,
      // making the stroke run backwards. Recreate it lazily only if a later unconstrained move
      // resumes the freehand gesture.
      drawingStabilizerRef.current = transition.stabilizerState;
      drawingThinLineInkInputRef.current = null;
      drawingPrecisionStabilizerBridgeRef.current?.reset();
      drawingPrecisionStabilizerBridgeRef.current = null;
      // A replace-in-place Shift gesture cannot retain the old fixed-clock history. If the artist
      // releases Shift within the same contact, continue on the causal immediate path instead of
      // silently switching to the unrelated legacy stabilizer engine.
      if (drawingFixedRateFilterRef.current) drawingImmediateCausalInputRef.current = true;
      drawingFixedRateFilterRef.current = null;
      stopFixedRateStrokePump();
      drawingRef.current = nextShift;
      if (!drawingPredictionPreviewRef.current) scheduleDraft(nextShift);
      return;
    }
    const strokeVanishingPoints = inputSettings?.vanishingPoints ?? vanishingPoints;
    const strokeAdvancedRuler = inputSettings?.advancedRuler;
    if (strokeAdvancedRuler && current.mode !== "eraser") {
      const snapped = snapPointToAdvancedRuler(
        strokeAdvancedRuler,
        {
          x: current.points[0] ?? pos.x,
          y: current.points[1] ?? pos.y,
        },
        { x: targetX, y: targetY }
      );
      if (snapped) {
        targetX = snapped.x;
        targetY = snapped.y;
      }
    } else if (
      (inputSettings?.perspectiveActive ?? perspectiveRulerActive)
      && current.mode !== "eraser"
      && strokeVanishingPoints.length > 0
    ) {
      // 스트로크 시작점 기준으로 소실점 하나를 골라(가장 가까운 방향) 락을 걸고, 이후 포인트를
      // 그 직선 위로 투영한다. 락은 onStageDown/onStageUp에서 스트로크 경계마다 초기화된다.
      if (!perspectiveRayRef.current) {
        const startX = current.points[0] ?? pos.x;
        const startY = current.points[1] ?? pos.y;
        perspectiveRayRef.current = resolvePerspectiveRay(strokeVanishingPoints, startX, startY, pos.x, pos.y);
      }
      [targetX, targetY] = snapStrokePointToPerspective(targetX, targetY, perspectiveRayRef.current);
    } else if (
      shouldSnapStrokeToIsometricAxis({
        active: inputSettings?.isometricActive ?? isometricGridActive,
        mode: current.mode,
        kind: current.kind ?? "freehand",
      })
    ) {
      if (!isometricAxisRayRef.current) {
        const startX = current.points[0] ?? pos.x;
        const startY = current.points[1] ?? pos.y;
        isometricAxisRayRef.current = resolveIsometricAxisRay(
          inputSettings?.isometricAngleDeg ?? isometricAngleDeg,
          startX,
          startY,
          pos.x,
          pos.y
        );
      }
      [targetX, targetY] = snapStrokePointToIsometricGrid(targetX, targetY, isometricAxisRayRef.current);
    } else if (current.mode !== "eraser" && !pointerSample.shiftKey) {
      // Freehand uses latch-based object-edge following when snap and/or alignment guides are on.
      // Guide-only mode paints overlays without rewriting ink coordinates.
      const sampleIndex = Math.max(0, Math.floor(current.points.length / 2));
      const snapped = applyStrokeObjectSnapToPoint(targetX, targetY, {
        mode: current.mode,
        kind: current.kind ?? "freehand",
        sampleIndex,
        directionalRulerActive: false,
        excludeId: current.id,
      });
      targetX = snapped.x;
      targetY = snapped.y;
    }
    const fixedRateState = drawingFixedRateFilterRef.current;
    if (fixedRateState) {
      const stylus = normalizeCalligraphyStylusInput(pointerSample);
      const transition = transitionFixedRateStrokeFilter(fixedRateState, {
        type: "append",
        samples: [{
          x: targetX,
          y: targetY,
          positionScale: inputSettings?.coordinateScale ?? effScale,
          pressure,
          tiltX: stylus.tiltX,
          tiltY: stylus.tiltY,
          timeStamp: sampleTimeStamp,
        }],
      });
      drawingFixedRateFilterRef.current = transition.state;
      appendFixedRateStrokeSamples(transition.emitted, pointerSample, velocitySample.speed);
      return;
    }
    // Pixel pencil is a raw grid tool: stabilizer strength must never bend or trail its cells.
    // `null` at pointerdown means intentionally disabled for pixel, not "lazy-create on move".
    if (drawMode !== "pixel" && !drawingImmediateCausalInputRef.current) {
      const strokeStabilizerStrength = inputSettings?.stabilizer ?? stabilizer;
      const strokeStabilizerMode = inputSettings?.stabilizerMode ?? stabilizerMode;
      const strokeCoordinateScale = inputSettings?.coordinateScale ?? effScale;
      const liveStabilizerState = drawingStabilizerRef.current
        ?? createStudioStrokeStabilizerState({
          x: rawLastX,
          y: rawLastY,
          timeStamp: sampleTimeStamp,
        });
      let stabilized: ReturnType<typeof stabilizeStudioStrokeSample>;
      if (strokeStabilizerMode === "precision" && strokeStabilizerStrength > 0) {
        const precisionBridgeOptions = {
          strength: strokeStabilizerStrength,
          mode: "precision" as const,
          coordinateScale: strokeCoordinateScale,
          useLazyPrecision: true,
          lazyPointerPolicy: "all" as const,
        };
        const precisionPointerType =
          pointerSample.pointerType === "mouse"
          || pointerSample.pointerType === "pen"
          || pointerSample.pointerType === "touch"
            ? pointerSample.pointerType
            : "unknown";
        let precisionBridge = drawingPrecisionStabilizerBridgeRef.current;
        if (!precisionBridge && !drawingPredictionPreviewRef.current) {
          // Shift replacement deliberately resets the provider. If freehand resumes within the
          // same contact, re-anchor once at the retained endpoint before committing actual input.
          precisionBridge = createStudioStrokeStabilizerBridge();
          const first = precisionBridge.commit(
            {
              x: rawLastX,
              y: rawLastY,
              timeStamp: liveStabilizerState.timeStamp,
              pointerType: precisionPointerType,
              pointerId: pointerSample.pointerId,
            },
            precisionBridgeOptions
          );
          drawingStabilizerRef.current = first.state;
          drawingPrecisionStabilizerBridgeRef.current = precisionBridge;
        }
        stabilized = precisionBridge
          ? drawingPredictionPreviewRef.current
            ? precisionBridge.preview(
                {
                  x: targetX,
                  y: targetY,
                  timeStamp: sampleTimeStamp,
                  pointerType: precisionPointerType,
                  pointerId: pointerSample.pointerId,
                },
                precisionBridgeOptions
              )
            : precisionBridge.commit(
                {
                  x: targetX,
                  y: targetY,
                  timeStamp: sampleTimeStamp,
                  pointerType: precisionPointerType,
                  pointerId: pointerSample.pointerId,
                },
                precisionBridgeOptions
              )
          : stabilizeStudioStrokeSample(
              liveStabilizerState,
              { x: targetX, y: targetY, timeStamp: sampleTimeStamp },
              {
                strength: strokeStabilizerStrength,
                mode: strokeStabilizerMode,
                coordinateScale: strokeCoordinateScale,
              }
            );
      } else {
        stabilized = stabilizeStudioStrokeSample(
          liveStabilizerState,
          { x: targetX, y: targetY, timeStamp: sampleTimeStamp },
          {
            strength: strokeStabilizerStrength,
            mode: strokeStabilizerMode,
            coordinateScale: strokeCoordinateScale,
          }
        );
      }
      if (!drawingPredictionPreviewRef.current) {
        drawingStabilizerRef.current = stabilized.state;
      }
      [targetX, targetY] = stabilized.point;
    }

    const lastX = current.points[current.points.length - 2] ?? targetX;
    const lastY = current.points[current.points.length - 1] ?? targetY;
    const lastPressure = current.pressures?.at(-1)
      ?? studioInkFallbackPressure(current.pressureModel);
    // Repeated browser samples that collapse to the same 1/32 coordinate and 10-bit pressure add
    // no information. A pressure-only change is retained so the incremental dab walker can update
    // interpolation state without repainting the stationary prefix.
    const shouldAppend = isStudioPixelPencilRenderMode(current.brush)
      ? shouldAppendStudioPixelPencilSample({
          lastX,
          lastY,
          nextX: targetX,
          nextY: targetY,
        })
      : shouldAppendStudioCausalInkSample({
          lastX,
          lastY,
          lastPressure,
          nextX: targetX,
          nextY: targetY,
          nextPressure: pressure,
          minDistance: current.sampleSpacing
            ?? strokeSampleDistanceForScale(inputSettings?.coordinateScale ?? effScale),
          pressureModel: current.pressureModel,
        });
    if (!shouldAppend) return;
    const capturePointerDynamics = current.mode === "pen"
      && resolveStudioCapturedBrushDynamicsPresetId(current) !== null;
    const captureInkSensorChannels =
      current.mode === "pen" && current.inkInput !== undefined;
    const captureExtendedInkSensorChannels =
      current.mode === "pen" && isStudioInkInputContractV2(current.inkInput);
    const captureStylus = current.mode === "pen" && (
      current.brush === "calligraphy"
      || capturePointerDynamics
      || captureInkSensorChannels
    );
    const captureMotionChannels =
      capturePointerDynamics || captureInkSensorChannels;
    const previousPointCount = Math.floor(current.points.length / 2);
    const stylus = captureStylus ? normalizeCalligraphyStylusInput(pointerSample) : null;
    const tangentialPressure = Number.isFinite(pointerSample.tangentialPressure)
      ? Math.min(1, Math.max(-1, pointerSample.tangentialPressure))
      : 0;
    const persistedPointerChannels = normalizeStudioPersistedPointerChannels(
      pointerSample,
      {
        timeOriginMilliseconds:
          drawingInkTimeOriginRef.current ?? pointerSample.timeStamp,
        previousTimeOffsetMilliseconds: current.sampleTimeOffsets?.at(-1) ?? 0,
        sourceTimeMilliseconds: pointerSample.timeStamp,
      },
    );
    // 정렬 복사와 꼬리 추가를 한 번의 순회로 합친다. Array.from + spread 는 같은 값을 두 번
    // 훑어 포인트당 ~2n 이었다. 값·순서·길이는 정의상 동일하고(index 0..previousPointCount-1 을
    // 같은 `values?.[index] ?? 0` 로 채운 뒤 value 하나를 붙임) 새 배열을 만드는 불변 규약도 그대로다.
    const appendStylusValue = (values: number[] | undefined, value: number): number[] => {
      const aligned: number[] = [];
      for (let index = 0; index < previousPointCount; index += 1) {
        aligned.push(values?.[index] ?? 0);
      }
      aligned.push(value);
      return aligned;
    };
    const appendMutableStylusValue = (
      values: number[] | undefined,
      value: number
    ): number[] => {
      const aligned = values ?? [];
      if (aligned.length > previousPointCount) aligned.length = previousPointCount;
      while (aligned.length < previousPointCount) aligned.push(0);
      aligned.push(value);
      return aligned;
    };
    // Canvas2D authoritative overlay와 compact GPU journal은 ref 전용 draft를 소비한다. GPU도
    // 동결한 접미사만 큐에 넘기므로 원본 배열 참조는 외부에 게시되지 않는다. 두 경로 모두 새
    // 샘플을 제자리 추가해 긴 획의 매 포인트 전체 points/pressure 복사(O(N²))를 없앤다.
    const canAppendDirectly = (
      (
        (
          (liveDraftDirectRef.current && liveInkOverlayRendererRef.current.isActive)
          || (liveDraftDirectRef.current && isStudioPixelPencilRenderMode(current.brush))
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
          || (
            liveDraftDirectRef.current
            && gpuLiveInkPinnedRef.current
            && gpuLiveSourceJournalRef.current !== null
          )
        )
      )
      // These batches already cloned one private draft before their loop. Reusing that owned
      // array turns N coalesced hardware samples into one prefix copy for non-journal paths.
      || drawingImmediateBatchMutationRef.current
      || drawingPredictionBatchMutationRef.current
    )
      && (
        !drawingPredictionPreviewRef.current
        || drawingPredictionBatchMutationRef.current
      );
    if (canAppendDirectly) {
      current.points.push(targetX, targetY);
      if (!current.pressures) {
        current.pressures = Array.from(
          { length: previousPointCount },
          () => studioInkFallbackPressure(current.pressureModel)
        );
      }
      current.pressures.push(pressure);
      if (stylus) {
        current.tiltXs = appendMutableStylusValue(current.tiltXs, stylus.tiltX);
        current.tiltYs = appendMutableStylusValue(current.tiltYs, stylus.tiltY);
        current.twists = appendMutableStylusValue(current.twists, stylus.twist);
      }
      if (captureMotionChannels) {
        current.speeds = appendMutableStylusValue(current.speeds, velocitySample.speed);
        current.tangentialPressures = appendMutableStylusValue(
          current.tangentialPressures,
          tangentialPressure
        );
      }
      if (captureExtendedInkSensorChannels) {
        current.altitudeAngles = appendMutableStylusValue(
          current.altitudeAngles,
          persistedPointerChannels.altitudeAngle,
        );
        current.azimuthAngles = appendMutableStylusValue(
          current.azimuthAngles,
          persistedPointerChannels.azimuthAngle,
        );
        current.contactWidths = appendMutableStylusValue(
          current.contactWidths,
          persistedPointerChannels.contactWidth,
        );
        current.contactHeights = appendMutableStylusValue(
          current.contactHeights,
          persistedPointerChannels.contactHeight,
        );
        current.sampleTimeOffsets = appendMutableStylusValue(
          current.sampleTimeOffsets,
          persistedPointerChannels.timeOffsetMilliseconds,
        );
      }
      drawingRef.current = current;
      // A predicted batch owns this private mutable clone only for the replaceable prediction
      // surface below. Publishing it through scheduleDraft would leave liveDraftPendingRef/rAF
      // pointing at future samples and append those estimates to the authoritative live overlay.
      if (
        !drawingImmediateBatchMutationRef.current
        && !drawingPredictionPreviewRef.current
      ) scheduleDraft(current);
      return;
    }
    const next: DrawEl = {
      ...current,
      points: [...current.points, targetX, targetY],
      pressures: current.pressures ? [...current.pressures, pressure] : [pressure],
      tiltXs: stylus ? appendStylusValue(current.tiltXs, stylus.tiltX) : current.tiltXs,
      tiltYs: stylus ? appendStylusValue(current.tiltYs, stylus.tiltY) : current.tiltYs,
      twists: stylus ? appendStylusValue(current.twists, stylus.twist) : current.twists,
      speeds: captureMotionChannels
        ? appendStylusValue(current.speeds, velocitySample.speed)
        : current.speeds,
      tangentialPressures: captureMotionChannels
        ? appendStylusValue(current.tangentialPressures, tangentialPressure)
        : current.tangentialPressures,
      altitudeAngles: captureExtendedInkSensorChannels
        ? appendStylusValue(
            current.altitudeAngles,
            persistedPointerChannels.altitudeAngle,
          )
        : current.altitudeAngles,
      azimuthAngles: captureExtendedInkSensorChannels
        ? appendStylusValue(
            current.azimuthAngles,
            persistedPointerChannels.azimuthAngle,
          )
        : current.azimuthAngles,
      contactWidths: captureExtendedInkSensorChannels
        ? appendStylusValue(
            current.contactWidths,
            persistedPointerChannels.contactWidth,
          )
        : current.contactWidths,
      contactHeights: captureExtendedInkSensorChannels
        ? appendStylusValue(
            current.contactHeights,
            persistedPointerChannels.contactHeight,
          )
        : current.contactHeights,
      sampleTimeOffsets: captureExtendedInkSensorChannels
        ? appendStylusValue(
            current.sampleTimeOffsets,
            persistedPointerChannels.timeOffsetMilliseconds,
          )
        : current.sampleTimeOffsets,
    };
    drawingRef.current = next;
    if (!drawingPredictionPreviewRef.current) scheduleDraft(next);
  }
  api.appendFreehandStrokePoint = appendFreehandStrokePoint;
}
