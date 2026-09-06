/* Extracted stage pointer handlers from StudioCuttoonEditor.
 * Closures keep the original editor typing envelope via an `any` host bag. */
// @ts-nocheck
"use no memo";
// React Compiler 옵트아웃: 가변 호스트 백(h) 을 렌더마다 재대입해 공유하는 추출 패턴이라,
// 컴파일러가 h 참조 동일성만 보고 JSX/계산을 캐시하면 첫 렌더에서 UI 가 영구 동결된다
// (탭 전환 등 커밋된 상태 변경이 화면에 반영되지 않음).

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

export function bindStudioCuttoonStagePointersRelease(
  h: StudioCuttoonStagePointersHost,
  api: StudioCuttoonStagePointersApi,
) {
  const {
    activeSurfaceReviewLockedRef,
    announceDrawingShortcut,
    appendStudioHokusaiAuthoritativeSuffix,
    appendStudioLivingInkAuthoritativeSuffix,
    armStudioLivingInkCanonicalHandoffTimeout,
    causalPostCorrectionStateRef,
    clearStudioHokusaiRetainedDraftPixels,
    clearStudioLivingInkRetainedDraftPixels,
    collaborationAccessRef,
    commit,
    currentPageIdRef,
    drawingCrdtPublisherRef,
    drawingFixedRateFilterRef,
    drawingInkTimeOriginRef,
    drawingInputSettingsRef,
    drawingPrecisionStabilizerBridgeRef,
    drawingRef,
    drawingStabilizerRef,
    drawingThinLineInkInputRef,
    hokusaiLiveFinalizingRef,
    hokusaiLiveOverlaySurfaceRef,
    hokusaiLiveOverlayVisibleRef,
    hokusaiLiveStrokeRef,
    liveDraftDirectRef,
    liveDraftLayerRef,
    liveDraftPendingRef,
    liveDraftVisualRef,
    livingInkAcceptedAuthorityRef,
    livingInkCanonicalHandoffRef,
    livingInkConfigRef,
    livingInkCoordinatorRef,
    livingInkFinalizingRef,
    livingInkOverlaySurfaceRef,
    livingInkOverlayVisibleRef,
    livingInkRejectedAuthorityRef,
    livingInkStrokeRef,
    livingInkWaterNoopStrokeIdsRef,
    onStudioLivingInkOverlayPresented,
    pagesHiRef,
    pagesHistoryRef,
    pressureCurve,
    pressureMinSize,
    releaseLivingInkInputPointer,
    session,
    setError,
    setLivingInkBusy,
    setLivingInkScope,
    setSelectedId,
    studioStrokeSurfaceRouteRef,
    appendCausalPostCorrectionState,
    canvasH,
    elements,
    flushDirectLiveDraftNow,
    gpuLiveInkPinnedRef,
    pages,
    sealCausalPostCorrectionState,
  } = h;
  const appendDrawingCrdtSampleSuffix = (...args) => api.appendDrawingCrdtSampleSuffix(...args);
  const appendFixedRateStrokeSamples = (...args) => api.appendFixedRateStrokeSamples(...args);
  const consumeFreehandPointerBatch = (...args) => api.consumeFreehandPointerBatch(...args);
  const updateActiveShapeEndpoint = (...args) => api.updateActiveShapeEndpoint(...args);
  function releaseEndpointPointerSample(
    pointerEvent: PointerEvent,
    current: DrawEl,
  ): StudioPointerReleaseEndpointSample {
    const channels = normalizeStudioPersistedPointerChannels(pointerEvent, {
      timeOriginMilliseconds:
        drawingInkTimeOriginRef.current ?? pointerEvent.timeStamp,
      previousTimeOffsetMilliseconds:
        current.sampleTimeOffsets?.at(-1) ?? 0,
      sourceTimeMilliseconds: pointerEvent.timeStamp,
    });
    return {
      pointerType: pointerEvent.pointerType,
      pressure: pointerEvent.pressure,
      tiltX: pointerEvent.tiltX,
      tiltY: pointerEvent.tiltY,
      twist: pointerEvent.twist,
      tangentialPressure: pointerEvent.tangentialPressure,
      altitudeAngle: pointerEvent.altitudeAngle,
      azimuthAngle: pointerEvent.azimuthAngle,
      width: pointerEvent.width,
      height: pointerEvent.height,
      sampleTimeOffset: channels.timeOffsetMilliseconds,
    };
  }

  function studioPageElementsFromHistory(pageId: string): El[] {
    const history = pagesHistoryRef.current;
    const index = Math.max(0, Math.min(pagesHiRef.current, Math.max(0, history.length - 1)));
    return [...(
      history[index]?.find((page) => page.id === pageId)?.elements
      ?? pages.find((page) => page.id === pageId)?.elements
      ?? []
    )];
  }

  function withStudioHokusaiSource(
    baseElements: readonly El[],
    source: DrawEl,
  ): El[] {
    const next = [...baseElements];
    const index = next.findIndex(({ id }) => id === source.id);
    if (index >= 0) next[index] = source;
    else next.push(source);
    return next;
  }

  function rejectStudioHokusaiFailedStroke(
    state: StudioHokusaiPinnedLiveStroke,
    reason: string,
  ): void {
    state.failed = true;
    state.abortController.abort();
    hokusaiLiveOverlaySurfaceRef.current?.renderer.clear();
    hokusaiLiveOverlayVisibleRef.current = false;
    if (hokusaiLiveStrokeRef.current === state) hokusaiLiveStrokeRef.current = null;
    hokusaiLiveFinalizingRef.current = false;
    studioStrokeSurfaceRouteRef.current = null;
    clearStudioHokusaiRetainedDraftPixels(state);
    liveDraftLayerRef.current?.drawScene();
    announceDrawingShortcut("Hokusai 자연매체 획 취소 · 문서 보존");
    setError(
      `선택한 Hokusai 엔진이 결과를 확정하지 못해 획을 저장하지 않았습니다. 다른 렌더러로 자동 전환하지 않습니다. ${reason}`,
    );
  }

  function completeStudioLivingInkRejectedNoop(strokeId: string, reason: string): void {
    livingInkWaterNoopStrokeIdsRef.current.delete(strokeId);
    const state = livingInkStrokeRef.current;
    if (state?.strokeId === strokeId) livingInkStrokeRef.current = null;
    livingInkOverlaySurfaceRef.current?.renderer.clear();
    if (state) clearStudioLivingInkRetainedDraftPixels(state);
    livingInkOverlayVisibleRef.current = false;
    livingInkFinalizingRef.current = false;
    studioStrokeSurfaceRouteRef.current = null;
    liveDraftVisualRef.current = null;
    liveDraftPendingRef.current = null;
    liveDraftDirectRef.current = false;
    setLivingInkBusy(false);
    void livingInkCoordinatorRef.current.cancelStroke(strokeId);
    liveDraftLayerRef.current?.drawScene();
    announceDrawingShortcut("Living Ink 시작 거부 · 문서 보존");
    setError(`선택한 Living Ink 작업을 시작하지 않아 문서를 변경하지 않았습니다. ${reason}`);
  }

  function rejectStudioLivingInkFailedStroke(
    state: StudioLivingInkPinnedStroke,
    reason: string,
  ): void {
    const cancelClaim = claimStudioStrokeSurfaceLifecycle(state.route, {
      phase: "cancel",
      routeKey: state.route.routeKey,
      strokeId: state.strokeId,
      kind: "living-ink",
    });
    if (cancelClaim.status !== "owned") return;
    livingInkWaterNoopStrokeIdsRef.current.delete(state.strokeId);
    livingInkOverlaySurfaceRef.current?.renderer.clear();
    clearStudioLivingInkRetainedDraftPixels(state);
    livingInkOverlayVisibleRef.current = false;
    if (livingInkStrokeRef.current === state) livingInkStrokeRef.current = null;
    releaseLivingInkInputPointer();
    livingInkFinalizingRef.current = false;
    studioStrokeSurfaceRouteRef.current = null;
    setLivingInkBusy(false);
    void livingInkCoordinatorRef.current.cancelStroke(state.strokeId);
    liveDraftLayerRef.current?.drawScene();
    announceDrawingShortcut("Living Ink 획 취소 · 문서 보존");
    setError(
      `선택한 Living Ink 엔진이 결과를 확정하지 못해 획을 저장하지 않았습니다. 다른 렌더러로 자동 전환하지 않습니다. ${reason}`,
    );
  }

  async function finishStudioLivingInkStroke(
    state: StudioLivingInkPinnedStroke,
    finished: DrawEl,
  ): Promise<void> {
    let work: StudioLivingInkFinishedWork | null = null;
    try {
      const claim = claimStudioStrokeSurfaceLifecycle(state.route, {
        phase: "finish",
        routeKey: state.route.routeKey,
        strokeId: state.strokeId,
        kind: "living-ink",
      });
      if (claim.status !== "owned") throw new Error("pointer-down 물리 route 소유권이 바뀌었습니다.");
      const surface = livingInkOverlaySurfaceRef.current;
      const config = livingInkConfigRef.current;
      if (
        !surface
        || surface.binding.surfaceKey !== state.surfaceKey
        || !config
        || livingInkStrokeRef.current !== state
      ) throw new Error("Living Ink 최종 표면이 캔버스 좌표계와 일치하지 않습니다.");
      work = await livingInkCoordinatorRef.current.finishStroke(
        state.strokeId,
        state.route.routeKey,
      );
      const presentation = await surface.renderer.presentCanonical(
        work.frame,
        state.route.routeKey,
        surface.binding.projection,
        (receipt) => onStudioLivingInkOverlayPresented(state, receipt),
      );
      if (!studioLivingInkCoverageIntersectsStroke({
        coverage: presentation.alphaCoverage,
        outputWidth: presentation.width,
        outputHeight: presentation.height,
        documentWidth: CANVAS_W,
        documentHeight: canvasH,
        points: finished.points,
        diameter: studioLiveBrushEffectiveDiameter(finished),
      })) {
        throw new Error(
          "Living Ink canonical PNG가 원본 획의 위치에 표시 가능한 안료를 만들지 못했습니다.",
        );
      }
      const result: StudioLivingInkCanonicalResult = Object.freeze({
        src: presentation.src,
        pngSha256: presentation.pngSha256,
        routeKey: state.route.routeKey,
        pageId: state.pageId,
        documentWidth: CANVAS_W,
        documentHeight: canvasH,
        config,
        journal: work.journal,
        finalExecutionReceipt: work.frame.receipt,
      });
      const baseElements = withStudioHokusaiSource(
        studioPageElementsFromHistory(state.pageId),
        finished,
      );
      const existingImage = baseElements.find((element) =>
        element.type === "image" && element.livingInkReceipt?.pageId === state.pageId
      );
      const transaction = createStudioLivingInkCanonicalTransaction({
        elements: baseElements,
        sourceElementId: finished.id,
        canonicalImageId: existingImage?.id ?? uid(),
        result,
        mutationLocked:
          collaborationAccessRef.current.locked
          || activeSurfaceReviewLockedRef.current,
      });
      if (!transaction.ok) throw new Error(transaction.message);
      const handoffClaim = claimStudioStrokeSurfaceLifecycle(state.route, {
        phase: "handoff",
        routeKey: state.route.routeKey,
        strokeId: state.strokeId,
        kind: "living-ink",
      });
      if (handoffClaim.status !== "owned") {
        throw new Error("canonical 이미지 인계 route가 pointer-down 영수증과 다릅니다.");
      }
      const committed = commit(
        [...transaction.transaction.nextElements],
        undefined,
        state.pageId,
      );
      if (!committed) throw new Error("문서가 잠겨 Living Ink 단일 트랜잭션을 확정하지 못했습니다.");
      state.canonicalImageId = transaction.transaction.canonicalImageId;
      state.canonicalPngHash = presentation.pngSha256;
      state.transactionCommitted = true;
      livingInkCanonicalHandoffRef.current = Object.freeze({
        token: `${state.route.routeKey}:canonical`,
        kind: "stroke",
        pageId: state.pageId,
        imageId: transaction.transaction.canonicalImageId,
        pngHash: presentation.pngSha256,
        strokeId: state.strokeId,
      });
      armStudioLivingInkCanonicalHandoffTimeout();
      const committedCanonicalImage = transaction.transaction.nextElements.find(
        (element): element is ImageEl =>
          element.type === "image"
          && element.id === transaction.transaction.canonicalImageId,
      );
      const committedAuthority = committedCanonicalImage?.livingInkReceipt
        ? Object.freeze({
            pageId: state.pageId,
            replayToken: studioLivingInkReceiptReplayToken(committedCanonicalImage.livingInkReceipt),
            canonicalSrc: committedCanonicalImage.src,
          })
        : null;
      if (!livingInkCoordinatorRef.current.acceptFinishedStroke(work)) {
        livingInkAcceptedAuthorityRef.current = null;
        livingInkRejectedAuthorityRef.current = committedAuthority;
        const message =
          "수채 번짐 PNG는 저장됐지만 Worker 상태 고정에 실패해, 저장 영수증 재검증 전에는 물리 편집을 비활성화합니다.";
        setError(message);
        void livingInkCoordinatorRef.current.failClosed(message);
      } else {
        livingInkRejectedAuthorityRef.current = null;
        livingInkAcceptedAuthorityRef.current = committedAuthority;
      }
      if (currentPageIdRef.current === state.pageId) {
        // Automatic materialization is still part of the drawing gesture. Selecting the new
        // page-sized image would mount image-editing chrome and move the canvas host between the
        // live/released frame and the canonical handoff. The pixels and document coordinates are
        // already identical; keep the drawing context stable and let the artist explicitly select
        // the materialized layer afterward (same contract as Hokusai below).
        setSelectedId(null);
        setLivingInkScope("all");
      }
      announceDrawingShortcut("수채 번짐 · 입력·놓을 때 물리 계산, 손을 떼면 2초 고정 settle");
      // The exact live pixels stay visible until StudioKonvaImageNode synchronously draws the same
      // PNG hash into the main layer. No guessed requestAnimationFrame handoff is allowed.
    } catch (cause) {
      if (state.transactionCommitted || livingInkStrokeRef.current !== state) return;
      if (work) await livingInkCoordinatorRef.current.rollbackFinishedStroke(work).catch(() => undefined);
      rejectStudioLivingInkFailedStroke(
        state,
        cause instanceof Error ? cause.message : "최종 물리 프레임을 검증하지 못했습니다.",
      );
    }
  }

  async function finishStudioHokusaiLiveStroke(
    state: StudioHokusaiPinnedLiveStroke,
    finished: DrawEl,
  ): Promise<void> {
    try {
      const session = state.session ?? await state.beginPromise;
      if (!session || state.failed || hokusaiLiveStrokeRef.current !== state) {
        throw new Error("라이브 자연매체 세션이 최종화 전에 해제되었습니다.");
      }
      state.session = session;
      if (state.queuedSamples.length > 0) {
        const queued = state.queuedSamples;
        state.queuedSamples = [];
        state.lastAppendedSequence = session.append(queued);
      }
      const result: StudioHokusaiLiveCanonicalResult = await session.finish();
      if (state.failed || hokusaiLiveStrokeRef.current !== state) {
        throw new Error("최종 질감 결과가 도착하기 전에 문서 표면이 변경되었습니다.");
      }
      const expectedSourceRevision = studioHokusaiSourceRevision(finished);
      const transaction = createStudioHokusaiLiveCanonicalTransaction({
        elements: withStudioHokusaiSource(
          studioPageElementsFromHistory(state.pageId),
          finished,
        ),
        sourceElementId: finished.id,
        expectedSourceRevision,
        canonicalImageId: uid(),
        result,
        mutationLocked:
          collaborationAccessRef.current.locked
          || activeSurfaceReviewLockedRef.current,
      });
      if (!transaction.ok) throw new Error(transaction.message);
      state.canonicalImageId = transaction.transaction.canonicalImageId;
      state.canonicalPngHash = result.receipt.pngHash;
      state.transactionCommitted = true;
      const committed = commit(
        [...transaction.transaction.nextElements],
        undefined,
        state.pageId,
      );
      if (!committed) {
        state.transactionCommitted = false;
        state.canonicalImageId = null;
        state.canonicalPngHash = null;
        throw new Error("문서가 저장 중이거나 잠겨 있어 단일 Hokusai 트랜잭션을 확정하지 못했습니다.");
      }
      if (currentPageIdRef.current === state.pageId) {
        // Automatic brush materialization must not switch the editor into image-selection chrome.
        // That contextual row changes the viewport's DOM offset while the pointer-up frame is
        // being handed to the canonical PNG, making a stationary stroke appear to jump. Keep the
        // drawing context stable; artists can explicitly select the materialized image afterward.
        setSelectedId(null);
      }
      announceDrawingShortcut("Hokusai 자연매체 획 저장 완료");
      // StudioKonvaImageNode will release the material overlay only after the exact PNG is decoded
      // and synchronously painted into the main layer. Until then the receipted live pixels stay
      // visible; there is deliberately no requestAnimationFrame timeout handoff here.
    } catch (cause) {
      // Explicit cancel, route unmount, or an already committed transaction must never be turned
      // into a late second history entry by the async rejection path.
      if (
        (state.abortController.signal.aborted && hokusaiLiveStrokeRef.current !== state)
        || state.transactionCommitted
      ) return;
      rejectStudioHokusaiFailedStroke(
        state,
        cause instanceof Error ? cause.message : "최종 질감 결과를 검증하지 못했습니다.",
      );
    }
  }

  function sealStudioDrawReleaseInput(
    stage: Konva.Stage | null,
    pointerEvent: PointerEvent,
    consumeReleaseSample: boolean,
  ): DrawEl | null {
    const inputSettings = drawingInputSettingsRef.current;
    let authoritativeLiveStroke: DrawEl | null = null;
    let selectedGpuFinalCrdtFlushDeferred = false;
    if (
      consumeReleaseSample
      && drawingRef.current
      && (drawingRef.current.kind ?? "freehand") !== "freehand"
      && stage
    ) {
      updateActiveShapeEndpoint(stage, pointerEvent, false);
    }
    const releaseLastContactPressure = drawingRef.current?.pressures?.at(-1)
      ?? studioInkFallbackPressure(drawingRef.current?.pressureModel);
    if (
      consumeReleaseSample
      && drawingRef.current
      && (drawingRef.current.kind ?? "freehand") === "freehand"
      && stage
    ) {
      consumeFreehandPointerBatch(stage, pointerEvent, false, {
        dispatchedPressureOverride: pointerEvent.pointerType === "pen"
          ? resolveStudioBrushReleasePressure({
              brushId: drawingRef.current.brush,
              pointerType: "pen",
              rawPressure: pointerEvent.pressure,
              lastContactPressure: releaseLastContactPressure,
              pressureCurve: inputSettings?.pressureCurve ?? pressureCurve,
              pressureMinSize: inputSettings?.pressureMinSize ?? pressureMinSize,
              fallbackPressure: releaseLastContactPressure,
            })
          : undefined,
        authoritativeSource: "parent-only",
      });
    }
    if (drawingRef.current && (drawingRef.current.kind ?? "freehand") === "freehand") {
      // The release coordinate above has already been published. Stabilizer endpoint/drain
      // samples are locally generated, so publish only that suffix before finalizing the stroke.
      const crdtReleaseSampleStart = Math.floor(drawingRef.current.points.length / 2);
      const fixedRateState = drawingFixedRateFilterRef.current;
      if (fixedRateState) {
        const released = transitionFixedRateStrokeFilter(fixedRateState, { type: "release" });
        drawingFixedRateFilterRef.current = released.state;
        // Geometry and paint complete in the pointerup task. Deferring only the pixels across
        // rAF made a released stroke continue changing while the next stroke had already begun.
        appendFixedRateStrokeSamples(released.emitted, pointerEvent, 0);
      } else {
        const liveState = drawingStabilizerRef.current;
        const flushed =
          drawingPrecisionStabilizerBridgeRef.current?.flush()
          ?? (liveState ? flushStudioStrokeStabilizerEndpoint(liveState) : null);
        if (flushed) {
          drawingStabilizerRef.current = flushed.state;
          const current = drawingRef.current;
          const endpointPlan = planStudioPointerReleaseEndpoint({
            stroke: current,
            endpoint: { x: flushed.point[0], y: flushed.point[1] },
            pointer: releaseEndpointPointerSample(pointerEvent, current),
            pressureCurve: inputSettings?.pressureCurve ?? pressureCurve,
            pressureMinSize: inputSettings?.pressureMinSize ?? pressureMinSize,
          });
          if (endpointPlan.appended) drawingRef.current = endpointPlan.stroke;
        } else if (drawingThinLineInkInputRef.current) {
          const thinLineFlush = flushStudioThinLineInkInput(drawingThinLineInkInputRef.current);
          drawingThinLineInkInputRef.current = thinLineFlush.state;
          const current = drawingRef.current;
          const endpointPlan = planStudioPointerReleaseEndpoint({
            stroke: current,
            endpoint: { x: thinLineFlush.x, y: thinLineFlush.y },
            pointer: releaseEndpointPointerSample(pointerEvent, current),
            pressureCurve: inputSettings?.pressureCurve ?? pressureCurve,
            pressureMinSize: inputSettings?.pressureMinSize ?? pressureMinSize,
          });
          if (endpointPlan.appended) drawingRef.current = endpointPlan.stroke;
        }
      }
      if (drawingRef.current) {
        appendDrawingCrdtSampleSuffix(drawingRef.current, crdtReleaseSampleStart);
        appendStudioLivingInkAuthoritativeSuffix(
          drawingRef.current,
          crdtReleaseSampleStart,
        );
        appendStudioHokusaiAuthoritativeSuffix(
          drawingRef.current,
          crdtReleaseSampleStart,
        );
      }
      const causalPostCorrection = causalPostCorrectionStateRef.current;
      if (drawingRef.current && causalPostCorrection?.phase === "active") {
        const sourceSampleCount = Math.floor(drawingRef.current.points.length / 2);
        if (sourceSampleCount > causalPostCorrection.sourceSampleCount) {
          appendCausalPostCorrectionState(
            drawingRef.current,
            causalPostCorrection.sourceSampleCount
          );
        }
        drawingRef.current = sealCausalPostCorrectionState(drawingRef.current);
      }
      authoritativeLiveStroke = drawingRef.current;
      // release/coalesced sample과 stabilizer endpoint를 live surface에 동기적으로 반영한다.
      // clearDraftPreview가 예약 rAF를 취소하기 전에 이 호출이 반드시 완료되어야 한다.
      flushDirectLiveDraftNow(authoritativeLiveStroke);
      if (gpuLiveInkPinnedRef.current) {
        // Keep canonical/input geometry local while the exact terminal GPU request is pending.
        // Cancelling the scheduled suffix also prevents its post-paint timer from racing the
        // receipt watchdog; StudioPage publishes the completed CRDT record only after acceptance.
        drawingCrdtPublisherRef.current.cancel(authoritativeLiveStroke.id);
        selectedGpuFinalCrdtFlushDeferred = true;
      } else {
        drawingCrdtPublisherRef.current.flush(authoritativeLiveStroke.id);
      }
    }
    // Shapes do not append freehand suffixes, but their deferred begin must still precede the
    // final scene publication (or deletion of an intentionally incomplete gesture).
    if (drawingRef.current && !selectedGpuFinalCrdtFlushDeferred) {
      drawingCrdtPublisherRef.current.flush(drawingRef.current.id);
    }
    return authoritativeLiveStroke;
  }
  function finishStudioSpecialistStroke(
    finished: DrawEl,
  ): "ordinary" | "handled" | "handled-preserve-ink" {
    const livingInkStroke = livingInkStrokeRef.current;
    if (livingInkStroke?.strokeId === finished.id) {
      if (!livingInkStroke.failed) {
        appendStudioLivingInkAuthoritativeSuffix(
          finished,
          livingInkStroke.forwardedSampleCount,
        );
        livingInkStroke.finalDrawing = finished;
        livingInkStroke.finishing = true;
        livingInkFinalizingRef.current = true;
        setLivingInkBusy(true);
        void finishStudioLivingInkStroke(livingInkStroke, finished);
        return "handled-preserve-ink";
      }
      rejectStudioLivingInkFailedStroke(
        livingInkStroke,
        "물리 계산 또는 표시 영수증이 중단되었습니다.",
      );
      return "handled";
    }
    const hokusaiStroke = hokusaiLiveStrokeRef.current;
    if (hokusaiStroke?.strokeId === finished.id) {
      if (!hokusaiStroke.failed) {
        appendStudioHokusaiAuthoritativeSuffix(
          finished,
          hokusaiStroke.forwardedSampleCount,
        );
        hokusaiStroke.finalDrawing = finished;
        hokusaiStroke.finishing = true;
        hokusaiLiveFinalizingRef.current = true;
        // session.finish() waits for the latest appended sequence to be presented and acknowledged
        // before it posts the canonical finish. The bounded vector tail remains fail-visible during
        // that async handshake, including a stabilizer endpoint appended on pointer-up.
        void finishStudioHokusaiLiveStroke(hokusaiStroke, finished);
        return "handled-preserve-ink";
      }
      rejectStudioHokusaiFailedStroke(
        hokusaiStroke,
        "Worker 또는 표면 영수증이 중단되었습니다.",
      );
      return "handled";
    }
    return "ordinary";
  }
  api.releaseEndpointPointerSample = releaseEndpointPointerSample;
  api.studioPageElementsFromHistory = studioPageElementsFromHistory;
  api.withStudioHokusaiSource = withStudioHokusaiSource;
  api.rejectStudioHokusaiFailedStroke = rejectStudioHokusaiFailedStroke;
  api.completeStudioLivingInkRejectedNoop = completeStudioLivingInkRejectedNoop;
  api.rejectStudioLivingInkFailedStroke = rejectStudioLivingInkFailedStroke;
  api.finishStudioLivingInkStroke = finishStudioLivingInkStroke;
  api.finishStudioHokusaiLiveStroke = finishStudioHokusaiLiveStroke;
  api.sealStudioDrawReleaseInput = sealStudioDrawReleaseInput;
  api.finishStudioSpecialistStroke = finishStudioSpecialistStroke;
}
