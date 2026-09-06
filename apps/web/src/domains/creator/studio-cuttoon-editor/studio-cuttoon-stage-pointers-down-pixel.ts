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

export function bindStudioCuttoonStagePointersDownPixel(
  h: StudioCuttoonStagePointersHost,
  api: StudioCuttoonStagePointersApi,
) {
  const {
    finishPolyLassoSession,
    isSpacePressed,
    journalPendingPixelSelectionRasterGesture,
    pixelBrushRadius,
    pixelCombine,
    pixelDragRef,
    pixelForceCircle,
    pixelMarqueeRasterPreparationAbortRef,
    pixelSelRef,
    pixelSelectionAutoTargetRef,
    pixelSelectionCaptureTargetRef,
    pixelTool,
    polyLassoOperationRef,
    polyLassoSessionRef,
    runMagicWandSelect,
    setError,
    setMarqueeIds,
    setPolyLassoHover,
    setPolyLassoSession,
    setSelectedId,
    tool,
    acquirePixelSelectionAutoTarget,
    currentMagneticLassoField,
    elementById,
    elements,
    groups,
    pixelToolArmed,
    pixelToolGestureArmed,
    pixelToolRasterPreparationArmed,
    preparePixelMarqueeRasterTarget,
    schedulePixelDragPreview,
    selected,
  } = h;

  function tryStageDownPixel(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>, stagePointerEvent: PointerEvent): boolean {
    // 픽셀 선택 도구 무장 중: 스테이지 드래그를 픽셀 선택 그리기로 가로챈다(요소 이동·마퀴·
    // 드로잉보다 우선). 트랜스포머 앵커는 예외(선택이 정규화 좌표라 리사이즈/회전을 따라간다),
    // Space/Hand 팬도 예외. 시작점은 이미지 밖이어도 된다(rect/ellipse 는 0..1 로 클램프).
    if (
      pixelToolGestureArmed &&
      !isSpacePressed &&
      tool !== "hand" &&
      !(e.target.getParent() instanceof KonvaRuntime.Transformer)
    ) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (!pos) return true;
      if (pixelToolRasterPreparationArmed && pixelTool) {
        // The artist began before the vector-only page copy finished rasterizing. Capture this
        // pointer now instead of dropping the gesture or letting it move a vector element. The
        // async preparation continuation replays the normalized drag once the full-page image is
        // atomically committed; pointermove/up below only update this bounded intent record.
        journalPendingPixelSelectionRasterGesture({
          event: stagePointerEvent,
          position: pos,
          tool: pixelTool,
          forceCircle: pixelForceCircle,
          captureFallback: e.target.getStage()?.container() ?? null,
        });
        return true;
      }
      // 대상 이미지 해석 — 이미 편집 가능한 이미지가 선택돼 있으면 그대로, 아니면(arm-anytime)
      // 포인터 아래 최상단 이미지를 자동 획득해 선택하고 이번 제스처를 그 위에서 시작한다.
      // 자동 획득 id 를 ref 에 남겨 선택 변경 이펙트가 진행 중 제스처를 살려 두게 한다.
      let pixelTarget: ImageEl | null =
        pixelToolArmed && selected?.type === "image" ? selected : null;
      // 대상 재획득(2026-07-24) — 이미지 A가 선택된 채로 다른 이미지 B 위에서 드래그를 시작하면,
      // 예전에는 마퀴가 A의 좌표계로 계산돼 면적이 무의미해지고 아무 선택도 생기지 않았다("선택이
      // 됐다 안 됐다"의 원인). 시작점이 선택된 이미지 "밖"이면서 그 자리에 다른 편집 가능한
      // 이미지가 있을 때만 대상을 옮긴다 — 사각/타원은 이미지 밖에서 시작하는 것도 정상이므로
      // (좌표를 0..1 로 클램프한다) 아무것도 없는 빈 곳에서 시작하는 기존 동작은 그대로 둔다.
      if (pixelTarget) {
        const local = canvasPointToNormalized(pos.x, pos.y, {
          x: pixelTarget.x,
          y: pixelTarget.y,
          width: pixelTarget.width,
          height: pixelTarget.height,
          rotation: pixelTarget.rotation,
        });
        if (local.x < 0 || local.x > 1 || local.y < 0 || local.y > 1) {
          const under = acquirePixelSelectionAutoTarget(pos);
          const retarget = under.kind === "target" && under.id !== pixelTarget.id
            ? elementById.get(under.id) ?? null
            : null;
          if (retarget?.type === "image") {
            pixelTarget = retarget;
            pixelSelectionAutoTargetRef.current = retarget.id;
            setMarqueeIds([]);
            setSelectedId(retarget.id);
          }
        }
      }
      if (!pixelTarget) {
        const resolution = acquirePixelSelectionAutoTarget(pos);
        if (resolution.kind === "locked") {
          setError("이 위치의 이미지 레이어는 편집이 잠겨 있어요. 잠금을 먼저 해제하세요.");
          return true;
        }
        const acquired =
          resolution.kind === "target" ? elementById.get(resolution.id) ?? null : null;
        if (!acquired || acquired.type !== "image") {
          const editableRasterCount = elements.filter(
            (element: any) =>
              element.type === "image"
              && !isEffectivelyHidden(element, groups)
              && !isEffectivelyLocked(element, groups)
              && !studioWorkAssetDestructiveEditReason(element)
              && !studioLinked3dPassDestructiveEditReason(element)
              && !element.isAnimatedGif
              && (element.frames?.length ?? 0) <= 1,
          ).length;
          if (editableRasterCount === 0 && pixelTool) {
            const activation: PixelSelectionActivationKind =
              pixelTool === "ellipse" && pixelForceCircle
                ? "circle"
                : pixelTool;
            // This call reaches its first dynamic-import await synchronously, so the preparation
            // controller/run id already exist when the pointer journal is attached immediately
            // below. Empty/locked/unsupported pages fail closed inside the same preparation seam.
            void preparePixelMarqueeRasterTarget(activation);
            if (pixelMarqueeRasterPreparationAbortRef.current) {
              journalPendingPixelSelectionRasterGesture({
                event: stagePointerEvent,
                position: pos,
                tool: pixelTool,
                forceCircle: pixelForceCircle,
                captureFallback: e.target.getStage()?.container() ?? null,
              });
              return true;
            }
          }
          setError("픽셀을 고를 이미지가 이 위치에 없어요. 이미지 레이어 위에서 다시 시작하세요.");
          return true;
        }
        pixelTarget = acquired;
        pixelSelectionAutoTargetRef.current = acquired.id;
        setMarqueeIds([]);
        setSelectedId(acquired.id);
      }
      if (!pixelTarget) return true;
      const frame: SelectionFrame = {
        x: pixelTarget.x,
        y: pixelTarget.y,
        width: pixelTarget.width,
        height: pixelTarget.height,
        rotation: pixelTarget.rotation,
      };
      if (pixelTool === "wand") {
        void runMagicWandSelect(pos, frame);
        return true;
      }
      // 제스처 시작 결합 모드 — 기존 선택이 있을 때만 Shift=합치기/Alt=빼기/둘 다=교집합으로
      // 덮어쓴다(Photoshop/CSP 관례). 선택이 없으면 base(add) + Shift/Alt 는 정원/중심 제약 의미.
      const effectiveCombine = resolveSelectionCombineOverride(
        pixelCombine,
        { shift: e.evt.shiftKey, alt: e.evt.altKey },
        isSelectionUsable(pixelSelRef.current)
      );
      const startNorm = canvasPointToNormalized(pos.x, pos.y, frame);
      const existingSelection = pixelSelRef.current;
      const frameAspect = frame.height / Math.max(1, frame.width);
      // Magma: drag inside the marching-ants marquee (without Shift/Alt combine) moves the
      // outline only. Content moves via Transform / content-transform actions.
      if (
        (pixelTool as string) !== "wand"
        && pixelTool !== "poly-lasso"
        && shouldMoveSelectionMarquee({
          hasUsableSelection: isSelectionUsable(existingSelection),
          pointInside: pointInSelection(existingSelection, startNorm, { aspect: frameAspect }),
          operationMode: effectiveCombine,
        })
        && existingSelection
      ) {
        const pointerId = Number.isFinite(stagePointerEvent.pointerId)
          ? stagePointerEvent.pointerId
          : 1;
        const stubDrag = beginSelectionDrag(
          pixelTool,
          selectionCombineModeForOperation(effectiveCombine),
          startNorm,
          0,
        );
        pixelDragRef.current = {
          elId: pixelTarget.id,
          frame,
          drag: stubDrag,
          operation: effectiveCombine,
          pointerId,
          magneticField: null,
          marqueeMove: {
            startNorm,
            baseSelection: existingSelection,
          },
        };
        const captureTarget = stagePointerEvent.target instanceof Element
          ? stagePointerEvent.target
          : e.target.getStage()?.container() ?? null;
        pixelSelectionCaptureTargetRef.current = captureTarget;
        try {
          captureTarget?.setPointerCapture(pointerId);
        } catch {
          // Global capture-phase pointerup remains the safety net on browsers without capture.
        }
        return true;
      }
      const magneticLassoResolution = pixelTool === "lasso" || pixelTool === "poly-lasso"
        ? currentMagneticLassoField(pixelTarget)
        : { status: "ordinary", field: null };
      if (magneticLassoResolution.status === "rejected") {
        setError(
          `선택한 자석 올가미를 시작할 수 없습니다. ${magneticLassoResolution.reason} `
          + "일반 올가미로 자동 전환하지 않습니다. 옵션을 끄거나 준비 후 다시 시도하세요.",
        );
        return true;
      }
      const magneticLassoField = magneticLassoResolution.field;
      // 다각형 올가미 — 클릭마다 꼭짓점. 시작점 근처 재클릭·더블클릭으로 닫기(드래그 세션 아님).
      if (pixelTool === "poly-lasso") {
        const raw = canvasPointToNormalized(pos.x, pos.y, frame);
        const p = magneticLassoField
          ? snapLassoPointToEdge(raw, magneticLassoField)
          : raw;
        const existing = polyLassoSessionRef.current;
        const detail = "detail" in e.evt ? e.evt.detail : 1;
        if (existing && (detail >= 2 || polyLassoCloseToStart(existing, p))) {
          finishPolyLassoSession();
          return true;
        }
        if (!existing) {
          polyLassoOperationRef.current = effectiveCombine;
          const next = beginPolyLassoSession(
            selectionCombineModeForOperation(effectiveCombine),
            p,
          );
          polyLassoSessionRef.current = next;
          setPolyLassoSession(next);
          setPolyLassoHover(null);
        } else {
          const next = appendPolyLassoVertex(existing, p);
          polyLassoSessionRef.current = next;
          setPolyLassoSession(next);
          setPolyLassoHover(null);
        }
        return true;
      }
      // 브러시는 캔버스 px 반경을 요소 폭 기준 정규화 반경으로 넘긴다(다른 도구는 무시됨).
      const brushRadiusNorm = pixelBrushRadius / Math.max(1, pixelTarget.width);
      const drag = beginSelectionDrag(
        pixelTool,
        selectionCombineModeForOperation(effectiveCombine),
        canvasPointToNormalized(pos.x, pos.y, frame),
        brushRadiusNorm,
        { forceCircle: pixelForceCircle || (pixelTool === "ellipse" && e.evt.shiftKey) }
      );
      const pointerId = Number.isFinite(stagePointerEvent.pointerId)
        ? stagePointerEvent.pointerId
        : 1;
      pixelDragRef.current = {
        elId: pixelTarget.id,
        frame,
        drag,
        operation: effectiveCombine,
        pointerId,
        magneticField: magneticLassoField,
      };
      const captureTarget = stagePointerEvent.target instanceof Element
        ? stagePointerEvent.target
        : e.target.getStage()?.container() ?? null;
      pixelSelectionCaptureTargetRef.current = captureTarget;
      try {
        captureTarget?.setPointerCapture(pointerId);
      } catch {
        // Global capture-phase pointerup remains the safety net on browsers without capture.
      }
      schedulePixelDragPreview(drag);
      return true;
    }
    return false;
  }
  api.tryStageDownPixel = tryStageDownPixel;
}
