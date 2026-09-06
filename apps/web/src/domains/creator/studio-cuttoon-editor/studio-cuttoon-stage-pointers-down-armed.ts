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

export function bindStudioCuttoonStagePointersDownArmed(
  h: StudioCuttoonStagePointersHost,
  api: StudioCuttoonStagePointersApi,
) {
  const {
    advancedFillTapGestureRef,
    advancedFillTapPayloadRef,
    advancedFillTouchPanRef,
    advancedFillVirtualTarget,
    autoColorCanvasSeedNonceRef,
    autoColorPlanImageSizeRef,
    autoColorScribbleCanvasArmed,
    autoColorScribbleStrokeRef,
    bubbleAnchorPickActive,
    colorRangePickActive,
    cropDragRef,
    cropRect,
    dodgeBurnDragRef,
    dodgeBurnRadius,
    filterMaskDragRef,
    getClientPointFromKonvaEvent,
    handleBubbleShapePointerDown,
    healCloneAligned,
    healCloneBusy,
    healCloneDragRef,
    healCloneOffsetRef,
    healClonePreviewLineRef,
    healCloneRadius,
    healCloneSourceAnchor,
    historyBrushBusy,
    historyBrushDragRef,
    historyBrushRadius,
    historyBrushSourceSrc,
    isSpacePressed,
    layerMaskDragRef,
    liquifyCaptureTargetRef,
    liquifyDragRef,
    liquifyMode,
    liquifyRadius,
    nodeEditDragRef,
    nodeEditTool,
    nodeSmoothStrength,
    nodeSmoothStrengthAtDragStartRef,
    panelSplitDragRef,
    panelSplitLastLineRef,
    patchEl,
    puppetWarpBusy,
    quickMaskDragRef,
    runColorRangeSample,
    scheduleLiquifyLivePreview,
    session,
    setAutoColorCanvasSeedHit,
    setAutoColorCanvasSeedHits,
    setBubbleAnchorPickActive,
    setError,
    setHealCloneDragPreview,
    setHealCloneSourceAnchor,
    setPanelSplitHint,
    setPuppetWarpPins,
    smudgeDragRef,
    smudgeRadius,
    tool,
    wetMixDragRef,
    wetMixRadius,
    activeSurfaceReviewLocked,
    advancedFillArmed,
    dodgeBurnArmed,
    effScale,
    filterMaskPaintArmed,
    groups,
    healCloneArmed,
    historyBrushArmed,
    layerMaskPaintArmed,
    liquifyArmed,
    nodeEditArmed,
    nodeEditHandles,
    panelSplitArmed,
    puppetWarpArmed,
    quickMaskArmed,
    scheduleFilterMaskDragPreview,
    scheduleHealCloneDragPreview,
    scheduleHistoryBrushDragPreview,
    scheduleLayerMaskDragPreview,
    schedulePaintRetouchStrokePreview,
    scheduleQuickMaskDragPreview,
    selected,
    smudgeArmed,
    wetMixArmed,
  } = h;

  function tryStageDownArmedTools(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>, stagePointerEvent: PointerEvent): boolean {
    // Auto-color canvas scribble — armed panel places color seeds on the selected line-art image
    // (click starts a freehand path; move/up sample the stroke).
    if (autoColorScribbleCanvasArmed && selected?.type === "image") {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      const planSize = autoColorPlanImageSizeRef.current;
      if (pos && planSize) {
        const imageFrame = {
          x: selected.x,
          y: selected.y,
          width: selected.width,
          height: selected.height,
          rotation: selected.rotation,
          flipped: selected.flipped,
          flippedY: selected.flippedY,
        };
        const sample = mapStudioDocumentPointToAutoColorSeed({
          documentX: pos.x,
          documentY: pos.y,
          image: imageFrame,
          pixelWidth: planSize.width,
          pixelHeight: planSize.height,
        });
        if (sample) {
          autoColorScribbleStrokeRef.current = {
            points: [pos.x, pos.y],
            lastDocX: pos.x,
            lastDocY: pos.y,
          };
          autoColorCanvasSeedNonceRef.current += 1;
          setAutoColorCanvasSeedHits(null);
          setAutoColorCanvasSeedHit({
            x: sample.x,
            y: sample.y,
            nonce: autoColorCanvasSeedNonceRef.current,
          });
          return true;
        }
        setError("선화 이미지 안을 드래그해 시드를 찍어 주세요.");
        return true;
      }
      if (pos && !planSize) {
        setError("먼저 자동 채색 힌트 계획을 한 번 실행해 선화 크기를 맞춰 주세요.");
        return true;
      }
    }
    // 색상 범위 샘플 pick — 스포이드와 달리 다중 샘플 도구라 1회성 해제하지 않는다.
    // 무장 중엔 다른 스테이지 제스처를 차단한다(crop/heal-clone 정책과 동일).
    if (colorRangePickActive && selected?.type === "image") {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (pos) {
        const frame: SelectionFrame = {
          x: selected.x,
          y: selected.y,
          width: selected.width,
          height: selected.height,
          rotation: selected.rotation,
        };
        const p = canvasPointToNormalized(pos.x, pos.y, frame);
        if (p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) void runColorRangeSample(p);
      }
      return true;
    }
    // 말풍선 꼬리 자동 부착 — 대상 픽커 무장 중: 다음 클릭으로 부착 대상(요소 또는 빈 좌표)을
    // 고른다. 스포이드와 동일하게 항상 1회성으로 해제.
    if (bubbleAnchorPickActive) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      setBubbleAnchorPickActive(false);
      if (pos && selected?.type === "bubble") {
        const clickedId = studioElementIdOf(e.target);
        if (activeSurfaceReviewLocked || isEffectivelyLocked(selected, groups)) {
          setError("말풍선 또는 상위 그룹의 잠금을 해제한 뒤 꼬리 대상을 지정해 주세요.");
        } else if (clickedId && clickedId === selected.id) {
          setError("말풍선 자기 자신은 부착 대상으로 고를 수 없어요.");
        } else if (clickedId) {
          patchEl(selected.id, { tailAnchorId: clickedId, tailAnchorPoint: undefined } as Partial<El>);
        } else {
          patchEl(selected.id, { tailAnchorPoint: { x: pos.x, y: pos.y }, tailAnchorId: undefined } as Partial<El>);
        }
      }
      return true;
    }
    // 고급 채우기 — pointerdown에서는 탭 후보만 보관한다. pointerup까지 8px 이내의 단일 주 포인터
    // 탭일 때만 실행해 긴 캔버스 한 손가락 스크롤과 두 손가락 핀치를 채우기로 오인하지 않는다.
    if (advancedFillArmed) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (pos && !isSpacePressed && !(e.target.getParent() instanceof KonvaRuntime.Transformer)) {
        const clientPoint = getClientPointFromKonvaEvent(e.evt);
        const pointerEvent = e.evt as PointerEvent;
        const pointerId = Number.isFinite(pointerEvent.pointerId) ? pointerEvent.pointerId : 1;
        const frame: SelectionFrame | null = advancedFillVirtualTarget?.frame ?? (
          selected?.type === "image"
            ? {
                x: selected.x,
                y: selected.y,
                width: selected.width,
                height: selected.height,
                rotation: selected.rotation,
              }
            : null
        );
        if (!frame) return true;
        if (clientPoint) {
          const gesture = beginStudioAdvancedFillTap(advancedFillTapGestureRef.current, {
            pointerId,
            point: clientPoint,
            button: pointerEvent.button,
            isPrimary: pointerEvent.isPrimary,
          });
          advancedFillTapGestureRef.current = gesture;
          if (
            pointerEvent.pointerType === "touch" &&
            gesture.primaryPointerId === pointerId &&
            gesture.activePointerIds.length === 1 &&
            !gesture.blocked
          ) {
            advancedFillTouchPanRef.current = { pointerId, last: clientPoint };
          } else if (gesture.activePointerIds.length > 1) {
            advancedFillTouchPanRef.current = null;
          }
          if (
            gesture.primaryPointerId === pointerId &&
            gesture.activePointerIds.length === 1 &&
            !gesture.blocked
          ) {
            advancedFillTapPayloadRef.current = { position: pos, frame };
          }
        }
      }
      return true;
    }
    // 크롭 모드 무장 중: 스테이지 드래그를 크롭 rect 조작(핸들 리사이즈/이동)으로 가로챈다.
    // 아래 픽셀 선택보다 먼저 검사한다 — 크롭 진입 시 픽셀 도구를 끄지만, 혹시 겹치면 크롭 우선.
    // 트랜스포머 앵커·Space 팬은 픽셀 선택과 동일하게 예외(크롭 rect 는 정규화라 리사이즈를 따라간다).
    if (
      cropRect &&
      selected?.type === "image" &&
      !isSpacePressed &&
      !(e.target.getParent() instanceof KonvaRuntime.Transformer)
    ) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (!pos) return true;
      const frame: SelectionFrame = {
        x: selected.x,
        y: selected.y,
        width: selected.width,
        height: selected.height,
        rotation: selected.rotation,
      };
      const p = canvasPointToNormalized(pos.x, pos.y, frame);
      const handle = hitTestCropHandle(p, cropRect, cropHitTolerance(frame, 14 / effScale));
      if (handle) {
        cropDragRef.current = { elId: selected.id, frame, session: beginCropDrag(cropRect, handle, p) };
      }
      return true; // 핸들 밖이어도 크롭 모드 중엔 마퀴·드로잉 등 다른 스테이지 제스처를 막는다.
    }
    // 패널 손그림 컷 무장 중: 스테이지 드래그를 절단선 그리기로 가로챈다. FrameEl 은 회전이
    // 없으므로(항상 캔버스 절대좌표) crop 처럼 정규화 좌표 변환이 필요 없다.
    if (panelSplitArmed && !isSpacePressed && !(e.target.getParent() instanceof KonvaRuntime.Transformer)) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (!pos) return true;
      panelSplitDragRef.current = beginPanelSplitDrag(selected.id, { x: pos.x, y: pos.y });
      panelSplitLastLineRef.current = null;
      setPanelSplitHint(null);
      return true; // 크롭/픽셀 선택과 동일하게 다른 스테이지 제스처(마퀴·드로잉 등)를 막는다.
    }
    // 벡터 노드 편집 무장 중: 핸들 히트테스트 후 드래그 세션을 연다. 무장 중엔 핸들 밖 클릭도
    // 마퀴 등 다른 제스처를 막는다 — crop/pixel 과 동일 정책.
    if (
      nodeEditArmed &&
      selected?.type === "draw" &&
      !isSpacePressed &&
      !(e.target.getParent() instanceof KonvaRuntime.Transformer)
    ) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (!pos) return true;
      const tolerance = 14 / effScale; // 화면 14px, crop 의 hitTolerance 관례와 동일
      const hitIdx = hitTestNodeHandle(pos, nodeEditHandles, tolerance);
      if (hitIdx !== null) {
        const session = beginNodeDrag(selected.points, selected.pressures, hitIdx, nodeEditTool!, pos);
        if (session) {
          nodeEditDragRef.current = { elId: selected.id, session };
          // "스무딩" 드래그의 강도 기준선을 스냅샷(다른 도구에선 참조되지 않아 무해).
          nodeSmoothStrengthAtDragStartRef.current = nodeSmoothStrength;
        }
      }
      return true;
    }
    // 말풍선 커스텀 모양 점 편집 무장 중: 포인터를 말풍선 로컬좌표로 변환해(회전 포함)
    // 노드 편집과 동일한 히트테스트/드래그 개시 로직을 재사용한다. 무장 중엔 핸들 밖 클릭도
    // 다른 제스처를 막는다 — crop/node-edit과 동일 정책.
    if (handleBubbleShapePointerDown(e, stagePointerEvent)) return true;
    // 문지르기 브러시 무장 중: 스테이지 드래그를 문지르기 스트로크 좌표 누적으로 가로챈다.
    if (
      smudgeArmed &&
      selected?.type === "image" &&
      !isSpacePressed &&
      !(e.target.getParent() instanceof KonvaRuntime.Transformer)
    ) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (!pos) return true;
      const frame: SelectionFrame = {
        x: selected.x,
        y: selected.y,
        width: selected.width,
        height: selected.height,
        rotation: selected.rotation,
      };
      const first = canvasPointToNormalized(pos.x, pos.y, frame);
      const radiusNorm = smudgeRadius / Math.max(1, frame.width);
      smudgeDragRef.current = {
        elId: selected.id,
        frame,
        points: [first],
        radiusNorm,
      };
      schedulePaintRetouchStrokePreview(smudgeDragRef.current);
      return true;
    }
    // 닷지/번 무장 중: 스테이지 드래그를 보정 스트로크 좌표 누적으로 가로챈다.
    if (
      dodgeBurnArmed &&
      selected?.type === "image" &&
      !isSpacePressed &&
      !(e.target.getParent() instanceof KonvaRuntime.Transformer)
    ) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (!pos) return true;
      const frame: SelectionFrame = {
        x: selected.x,
        y: selected.y,
        width: selected.width,
        height: selected.height,
        rotation: selected.rotation,
      };
      const first = canvasPointToNormalized(pos.x, pos.y, frame);
      const radiusNorm = dodgeBurnRadius / Math.max(1, frame.width);
      dodgeBurnDragRef.current = {
        elId: selected.id,
        frame,
        points: [first],
        radiusNorm,
      };
      schedulePaintRetouchStrokePreview(dodgeBurnDragRef.current);
      return true;
    }
    // 혼색 브러시 무장 중: 스테이지 드래그를 혼색 스트로크 좌표 누적으로 가로챈다.
    if (
      wetMixArmed &&
      selected?.type === "image" &&
      !isSpacePressed &&
      !(e.target.getParent() instanceof KonvaRuntime.Transformer)
    ) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (!pos) return true;
      const frame: SelectionFrame = {
        x: selected.x,
        y: selected.y,
        width: selected.width,
        height: selected.height,
        rotation: selected.rotation,
      };
      const first = canvasPointToNormalized(pos.x, pos.y, frame);
      const radiusNorm = wetMixRadius / Math.max(1, frame.width);
      wetMixDragRef.current = {
        elId: selected.id,
        frame,
        points: [first],
        radiusNorm,
      };
      schedulePaintRetouchStrokePreview(wetMixDragRef.current);
      return true;
    }
    // 리퀴파이 — 이미지를 드래그하면 픽셀을 밀어 왜곡한다.
    if (
      liquifyArmed &&
      selected?.type === "image" &&
      !isSpacePressed &&
      tool !== "hand" &&
      !(e.target.getParent() instanceof KonvaRuntime.Transformer)
    ) {
      if (stagePointerEvent.isPrimary === false) return true;
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (!pos) return true;
      const frame: SelectionFrame = {
        x: selected.x,
        y: selected.y,
        width: selected.width,
        height: selected.height,
        rotation: selected.rotation,
      };
      const session = beginStudioLiquifyPointerSession({
        elId: selected.id,
        frame,
        mode: liquifyMode,
        point: canvasPointToNormalized(pos.x, pos.y, frame),
        pointer: stagePointerEvent,
      });
      if (!session) return true;
      liquifyDragRef.current = session;
      const radiusNorm = liquifyRadius / Math.max(1, frame.width);
      schedulePaintRetouchStrokePreview({
        frame,
        radiusNorm,
        points: session.points,
      });
      // Twirl/pinch/bloat can be a single dab — kick a preview immediately on down.
      scheduleLiquifyLivePreview();
      const captureTarget = stagePointerEvent.target instanceof Element
        ? stagePointerEvent.target
        : e.target.getStage()?.container() ?? null;
      liquifyCaptureTargetRef.current = captureTarget;
      try {
        captureTarget?.setPointerCapture(session.pointerId);
      } catch {
        // Global capture-phase pointerup remains the safety net on browsers without capture.
      }
      return true;
    }
    // 퀵 마스크 무장 중: 스테이지 드래그를 마스크 브러시 좌표 누적으로 가로챈다(레이어 마스크 미러).
    if (
      quickMaskArmed &&
      selected?.type === "image" &&
      !isSpacePressed &&
      !(e.target.getParent() instanceof KonvaRuntime.Transformer)
    ) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (!pos) return true;
      const frame: SelectionFrame = {
        x: selected.x,
        y: selected.y,
        width: selected.width,
        height: selected.height,
        rotation: selected.rotation,
      };
      const p = canvasPointToNormalized(pos.x, pos.y, frame);
      quickMaskDragRef.current = { elId: selected.id, frame, points: [p] };
      scheduleQuickMaskDragPreview({ points: [p] });
      return true;
    }
    // 레이어 마스크 브러시 무장 중: 스테이지 드래그를 마스크 스트로크 좌표 누적으로 가로챈다.
    // maskSrc가 아직 없어도 드래그를 시작할 수 있다(bakeLayerMaskStroke가 없으면 "전체 보임"
    // 흰 마스크를 자동으로 베이스 삼는다 — Photoshop이 마스크 없는 레이어에 처음 브러시를 대면
    // 자동으로 흰 마스크를 추가하는 관례와 동일).
    if (
      layerMaskPaintArmed &&
      selected?.type === "image" &&
      !isSpacePressed &&
      !(e.target.getParent() instanceof KonvaRuntime.Transformer)
    ) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (!pos) return true;
      const frame: SelectionFrame = {
        x: selected.x,
        y: selected.y,
        width: selected.width,
        height: selected.height,
        rotation: selected.rotation,
      };
      const p = canvasPointToNormalized(pos.x, pos.y, frame);
      layerMaskDragRef.current = { elId: selected.id, frame, points: [p] };
      scheduleLayerMaskDragPreview({ points: [p] });
      return true;
    }
    // 필터 마스크 브러시 무장 중: 레이어 마스크와 동일하게 스테이지 드래그를 마스크 스트로크
    // 좌표 누적으로 가로챈다(filterMaskSrc가 없으면 bakeLayerMaskStroke가 흰 마스크를 자동 베이스로).
    if (
      filterMaskPaintArmed &&
      selected?.type === "image" &&
      !isSpacePressed &&
      !(e.target.getParent() instanceof KonvaRuntime.Transformer)
    ) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (!pos) return true;
      const frame: SelectionFrame = {
        x: selected.x,
        y: selected.y,
        width: selected.width,
        height: selected.height,
        rotation: selected.rotation,
      };
      const p = canvasPointToNormalized(pos.x, pos.y, frame);
      filterMaskDragRef.current = { elId: selected.id, frame, points: [p] };
      scheduleFilterMaskDragPreview({ points: [p] });
      return true;
    }
    // 복구 브러시/도장 무장 중: Alt(Option)+클릭은 소스 앵커 지정, 일반 드래그는 페인트 스트로크.
    // crop/픽셀 선택과 동일한 정책 — 무장 중엔 다른 캔버스 제스처를 막는다. healCloneBusy 가드는
    // 직전 스트로크의 비동기 굽기가 끝나기 전에 새 스트로크를 시작해 patchEl 갱신이 서로를 덮어쓰는
    // (lost-update) 경쟁을 막는다.
    if (
      healCloneArmed &&
      !healCloneBusy &&
      selected?.type === "image" &&
      !isSpacePressed &&
      !(e.target.getParent() instanceof KonvaRuntime.Transformer)
    ) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (!pos) return true;
      const frame: SelectionFrame = {
        x: selected.x,
        y: selected.y,
        width: selected.width,
        height: selected.height,
        rotation: selected.rotation,
      };
      const p = canvasPointToNormalized(pos.x, pos.y, frame);
      if (e.evt.altKey) {
        setHealCloneSourceAnchor(p);
        healCloneOffsetRef.current = null; // 새 앵커 지정 시 정렬 오프셋을 다음 스트로크에서 재계산.
        return true;
      }
      if (!healCloneSourceAnchor) return true; // 패널 상태 문구가 이미 "Alt+클릭으로 지정" 안내 중.
      const offset =
        healCloneAligned && healCloneOffsetRef.current
          ? healCloneOffsetRef.current
          : computeHealCloneSourceOffset(healCloneSourceAnchor, p);
      healCloneOffsetRef.current = offset;
      const radiusNorm = healCloneRadius / Math.max(1, selected.width);
      const session = { elId: selected.id, frame, offset, radiusNorm, points: [p] };
      healCloneDragRef.current = session;
      // 오버레이 마운트는 제스처당 한 번만 React에 알리고, 이후 move는 Line ref만 갱신한다.
      setHealCloneDragPreview({ points: [p], lineRef: healClonePreviewLineRef });
      scheduleHealCloneDragPreview(session);
      return true;
    }
    // 히스토리 브러시 무장 중: 소스가 지정돼 있으면 일반 드래그로 스트로크 좌표를 누적한다(오프셋
    // 없음 — heal-clone 과 달리 Alt+클릭 지정 단계가 없다, 소스는 작업 내역 패널에서 이미 골랐다).
    if (
      historyBrushArmed &&
      !historyBrushBusy &&
      selected?.type === "image" &&
      !isSpacePressed &&
      !(e.target.getParent() instanceof KonvaRuntime.Transformer)
    ) {
      if (!historyBrushSourceSrc) return true; // 패널 상태 문구가 이미 "작업 내역에서 먼저 지정하세요" 안내 중.
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (!pos) return true;
      const frame: SelectionFrame = {
        x: selected.x,
        y: selected.y,
        width: selected.width,
        height: selected.height,
        rotation: selected.rotation,
      };
      const p = canvasPointToNormalized(pos.x, pos.y, frame);
      const radiusNorm = historyBrushRadius / Math.max(1, selected.width);
      historyBrushDragRef.current = { elId: selected.id, frame, radiusNorm, points: [p] };
      scheduleHistoryBrushDragPreview({ points: [p] });
      return true;
    }
    // 퍼펫 워프 무장 중: 빈 자리 클릭 = 새 핀 추가(그 자리에서 세션 없이 즉시 커밋). 기존 핀
    // 위 클릭은 오버레이의 Konva 네이티브 draggable(onDragMove)이 처리하므로 여기서는
    // "puppet-pin-handle" 이름으로 걸러 무시한다 — 안 걸러내면 핀을 클릭할 때마다 그 자리에 또
    // 새 핀이 추가돼 버린다(Konva 이벤트가 핀 Circle → Stage 로 버블링되기 때문).
    if (
      puppetWarpArmed &&
      !puppetWarpBusy &&
      selected?.type === "image" &&
      !isSpacePressed &&
      !(e.target.getParent() instanceof KonvaRuntime.Transformer) &&
      e.target.name() !== "puppet-pin-handle"
    ) {
      const pos = e.target.getStage()?.getRelativePointerPosition();
      if (!pos) return true;
      const frame: SelectionFrame = {
        x: selected.x,
        y: selected.y,
        width: selected.width,
        height: selected.height,
        rotation: selected.rotation,
      };
      const p = canvasPointToNormalized(pos.x, pos.y, frame);
      setPuppetWarpPins((pins: any) => addPuppetPin(pins, { id: uid(), x: p.x, y: p.y }));
      return true; // 무장 중엔 다른 스테이지 제스처(마퀴 등)를 막는다 — crop/heal-clone과 동일 정책.
    }
    return false;
  }
  api.tryStageDownArmedTools = tryStageDownArmedTools;
}
