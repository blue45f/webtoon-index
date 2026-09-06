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

export function bindStudioCuttoonStagePointersQueue(
  h: StudioCuttoonStagePointersHost,
  api: StudioCuttoonStagePointersApi,
) {
  const {
    collaborationAccessRef,
    documentSaveInFlightRef,
    editorMountedRef,
    markStudioDocumentChanged,
    pagesHiRef,
    pagesHistoryRef,
    publishStudioCrdtSceneTransitionRef,
    rebaseStudioHistoryJournal,
    setError,
    setPagesHistoryState,
    studioCrdtAuthoritativeSaveBarrierRef,
    studioCrdtDocumentRef,
    studioCrdtSceneRuntimeRef,
    studioFilterMaskPublicationGenerationRef,
    studioRasterPublicationControllersRef,
    studioRasterPublicationTailRef,
  } = h;

  function queueStudioBg3dMagicFilterMaskPublication(input: {
    readonly pageId: string;
    readonly layerId: string;
    readonly targetElementId: string;
    readonly mask: StudioBackground3DMagicFilterMask;
    readonly workId: string;
    readonly actorId: string;
    readonly document: StudioCrdtDocument;
    readonly runtime: StudioCrdtSceneGraphRuntime;
    readonly accessGeneration: number;
    readonly publicationGeneration: number;
  }): void {
    const controller = new AbortController();
    studioRasterPublicationControllersRef.current.add(controller);
    const scopeIsCurrent = () => {
      const access = collaborationAccessRef.current;
      return (
        editorMountedRef.current
        && !documentSaveInFlightRef.current
        && !access.locked
        && access.authScopeKey === input.actorId
        && access.workId === input.workId
        && access.accessGeneration === input.accessGeneration
        && (
          studioFilterMaskPublicationGenerationRef.current.get(input.targetElementId)
          === input.publicationGeneration
        )
        && studioCrdtDocumentRef.current === input.document
        && studioCrdtSceneRuntimeRef.current === input.runtime
      );
    };
    const currentTarget = (): ImageEl | null => {
      const history = pagesHistoryRef.current;
      const currentIndex = Math.max(0, Math.min(pagesHiRef.current, history.length - 1));
      const page = history[currentIndex]?.find(({ id }: { id: string }) => id === input.pageId) ?? null;
      const target = page?.elements.find(({ id }: { id: string }) => id === input.targetElementId) ?? null;
      if (
        !page
        || target?.type !== "image"
        || target.filterMaskSrc !== input.mask.pngDataUrl
        || target.filterMaskSurfaceId !== undefined
        || (target.groupId ?? "page-root") !== input.layerId
        || isEffectivelyLocked(target, page.groups ?? [])
      ) {
        return null;
      }
      return target;
    };
    const abortForStaleScope = (): never => {
      throw new DOMException(
        "3D Magic Layer 또는 공동 편집 권한이 변경되었습니다.",
        "AbortError"
      );
    };

    const run = async () => {
      if (!scopeIsCurrent() || !currentTarget()) abortForStaleScope();
      const [
        publicationModule,
        rasterPublisherModule,
        assetClientModule,
        maskImage,
      ] = await Promise.all([
        import( "../filter/studio-filter-mask-surface-publisher"),
        import("../live/studio-crdt-raster-patch-publisher"),
        import("../render/studio-raster-asset-client"),
        loadStudioPixelEditImage(input.mask.pngDataUrl, controller.signal),
      ]);
      if (!scopeIsCurrent() || !currentTarget()) abortForStaleScope();
      const width = maskImage.naturalWidth || maskImage.width;
      const height = maskImage.naturalHeight || maskImage.height;
      if (width !== input.mask.width || height !== input.mask.height) {
        throw new Error("3D Magic Layer 마스크의 디코드 크기가 캡처 계약과 다릅니다.");
      }
      const made = createStudioPixelEditCanvas(width, height);
      if (!made) throw new Error("3D Magic Layer 게시용 픽셀 표면을 만들 수 없습니다.");
      made.ctx.clearRect(0, 0, width, height);
      made.ctx.drawImage(maskImage, 0, 0);
      const pixels = made.ctx.getImageData(0, 0, width, height).data;
      const sourceIdentity = await input.runtime.sha256RasterSemanticParameters(
        input.mask.pngDataUrl,
        controller.signal
      );
      if (!scopeIsCurrent() || !currentTarget()) abortForStaleScope();
      const encoder = rasterPublisherModule.createStudioRasterBrowserPngEncoder();

      await publicationModule.publishStudioFilterMaskSurface({
        workId: input.workId,
        actorId: input.actorId,
        pageId: input.pageId,
        layerId: input.layerId,
        targetElementId: input.targetElementId,
        sourceIdentity,
        selectedObjectStableId: input.mask.selectedObjectStableId,
        generation: input.publicationGeneration,
        width,
        height,
        pixels,
        signal: controller.signal,
      }, {
        encode: encoder,
        upload: (workId, { reference, bytes, signal }) => {
          if (workId !== input.workId) abortForStaleScope();
          return assetClientModule.uploadStudioRasterAsset(
            workId,
            reference,
            bytes,
            signal
          );
        },
        append: (log) => {
          if (!scopeIsCurrent() || !currentTarget()) abortForStaleScope();
          input.document.mergeRasterOperationLog(log);
        },
        compensate: (workId, { reference, signal }) => {
          if (workId !== input.workId) return Promise.resolve(false);
          return assetClientModule.deleteUnreferencedStudioRasterAssetUpload(
            workId,
            reference,
            signal
          );
        },
        canWriteLayer: (guardInput) => (
          guardInput.actorId === input.actorId
          && guardInput.pageId === input.pageId
          && guardInput.layerId === input.layerId
          && guardInput.intent === "paint"
          && scopeIsCurrent()
          && currentTarget() !== null
        ),
        isCurrent: () => scopeIsCurrent() && currentTarget() !== null,
        nextLogicalClock: () =>
          input.runtime.nextRasterLogicalClock(input.document.getRasterOperationLogs()),
        sha256SemanticParameters: (canonicalParameters, signal) =>
          input.runtime.sha256RasterSemanticParameters(canonicalParameters, signal),
        waitForAuthoritativeAck: async ({ signal }) => {
          const barrier = studioCrdtAuthoritativeSaveBarrierRef.current;
          if (!barrier) {
            throw new DOMException(
              "3D Magic Layer 서버 승인 경계가 준비되지 않았습니다.",
              "AbortError"
            );
          }
          if (!scopeIsCurrent() || signal.aborted) abortForStaleScope();
          return barrier(10_000);
        },
        attachSceneReference: ({ filterMaskSurfaceId }) => {
          if (!scopeIsCurrent() || !currentTarget()) abortForStaleScope();
          const history = pagesHistoryRef.current;
          const currentIndex = Math.max(0, Math.min(pagesHiRef.current, history.length - 1));
          const admitted = attachStudioFilterMaskSurfaceAcrossHistory<El, PageState>({
            history,
            currentIndex,
            targetElementId: input.targetElementId,
            expectedInlineSource: input.mask.pngDataUrl,
            surfaceId: filterMaskSurfaceId,
          });
          if (!admitted.changed || !markStudioDocumentChanged()) abortForStaleScope();
          if (!publishStudioCrdtSceneTransitionRef.current(
            admitted.previousCurrentPages,
            admitted.nextCurrentPages
          )) {
            throw new Error("승인된 3D Magic Layer 참조를 팀 문서에 반영하지 못했습니다.");
          }
          pagesHistoryRef.current = admitted.history;
          rebaseStudioHistoryJournal(
            admitted.nextCurrentPages,
            currentIndex,
            "Magic filter-mask surface admission"
          );
          setPagesHistoryState(admitted.history);
        },
      });
    };

    const task = studioRasterPublicationTailRef.current
      .catch(() => undefined)
      .then(run);
    studioRasterPublicationTailRef.current = task.then(
      () => undefined,
      () => undefined
    );
    void task.catch((cause: unknown) => {
      if (
        controller.signal.aborted
        || (cause instanceof DOMException && cause.name === "AbortError")
        || !scopeIsCurrent()
      ) {
        return;
      }
      setError(
        cause instanceof Error
          ? `3D Magic Layer 공유 표면 게시: ${cause.message} 인라인 마스크는 안전하게 유지됩니다.`
          : "3D Magic Layer 공유 표면을 게시하지 못해 인라인 마스크를 유지했습니다."
      );
    }).finally(() => {
      studioRasterPublicationControllersRef.current.delete(controller);
      if (
        studioFilterMaskPublicationGenerationRef.current.get(input.targetElementId)
        === input.publicationGeneration
      ) {
        studioFilterMaskPublicationGenerationRef.current.delete(input.targetElementId);
      }
    });
  }

  function queueStudioRasterDrawPromotion(input: {
    plan: NonNullable<ReturnType<StudioCrdtSceneGraphRuntime["planRasterDrawPromotion"]>>;
    pageId: string;
    layerId: string;
    workId: string;
    actorId: string;
    document: StudioCrdtDocument;
    runtime: StudioCrdtSceneGraphRuntime;
    accessGeneration: number;
  }): void {
    const controller = new AbortController();
    studioRasterPublicationControllersRef.current.add(controller);
    const scopeIsCurrent = () => {
      const access = collaborationAccessRef.current;
      return editorMountedRef.current &&
        !documentSaveInFlightRef.current &&
        !access.locked &&
        access.authScopeKey === input.actorId &&
        access.workId === input.workId &&
        access.accessGeneration === input.accessGeneration &&
        studioCrdtDocumentRef.current === input.document &&
        studioCrdtSceneRuntimeRef.current === input.runtime;
    };
    const abortForStaleScope = (): never => {
      throw new DOMException("작품 또는 공동 편집 권한이 변경되었습니다.", "AbortError");
    };
    const sourceVectorIsCurrent = () => {
      const history = pagesHistoryRef.current;
      const currentIndex = Math.max(0, Math.min(pagesHiRef.current, history.length - 1));
      const page = history[currentIndex]?.find(({ id }) => id === input.pageId);
      const element = page?.elements.find(({ id }) => id === input.plan.operationId) ?? null;
      return input.runtime.rasterDrawPromotionSourceMatches({
        plan: input.plan,
        element: element?.type === "draw" ? element : null,
        pageId: input.pageId,
        layerId: input.layerId,
        documentWidth: CANVAS_W,
        documentHeight: page?.canvasH ?? input.plan.surface.height,
        panelClipped: Boolean(
          element?.type === "draw" && page && containingPanel(element, page.elements)
        ),
      });
    };

    const run = async () => {
      if (!scopeIsCurrent()) abortForStaleScope();
      if (input.document.getRasterOperationLogs().some((log) =>
        log.operations.some(({ operationId }) => operationId === input.plan.operationId)
      )) return;

      const [captureModule, publisherModule, assetClientModule, semanticParametersSha256] =
        await Promise.all([
          import("../live/studio-crdt-raster-stroke-capture"),
          import("../live/studio-crdt-raster-patch-publisher"),
          import("../render/studio-raster-asset-client"),
          input.runtime.sha256RasterSemanticParameters(
            input.plan.semanticParameters,
            controller.signal
          ),
      ]);
      if (!scopeIsCurrent()) abortForStaleScope();
      if (!sourceVectorIsCurrent()) {
        throw new DOMException("원본 벡터 획이 게시 전에 변경되었습니다.", "AbortError");
      }
      const captured = captureModule.captureStudioRasterStroke({
        stroke: input.plan.stroke,
        documentWidth: input.plan.surface.width,
        documentHeight: input.plan.surface.height,
      });
      const encoder = publisherModule.createStudioRasterBrowserPngEncoder();
      const logicalClock = input.runtime.nextRasterLogicalClock(
        input.document.getRasterOperationLogs()
      );
      await publisherModule.publishStudioRasterPatch({
        surface: input.plan.surface,
        operationId: input.plan.operationId,
        actorId: input.actorId,
        logicalClock,
        pageId: input.pageId,
        layerId: input.layerId,
        intent: input.plan.intent,
        semanticParametersSha256,
        rect: captured.bounds,
        pixels: captured.pixels,
      }, {
        encode: encoder,
        upload: ({ reference, bytes, signal }) =>
          assetClientModule.uploadStudioRasterAsset(
            input.workId,
            reference,
            bytes,
            signal
          ),
        append: (log) => {
          if (!scopeIsCurrent()) abortForStaleScope();
          if (!sourceVectorIsCurrent()) {
            throw new DOMException("원본 벡터 획이 게시 중 변경되었습니다.", "AbortError");
          }
          input.document.mergeRasterOperationLog(log);
        },
        canWriteLayer: (guardInput) => {
          if (
            guardInput.operationId !== input.plan.operationId
            || guardInput.actorId !== input.actorId
            || guardInput.pageId !== input.pageId
            || guardInput.layerId !== input.layerId
            || guardInput.intent !== input.plan.intent
            || !scopeIsCurrent()
          ) return false;
          const history = pagesHistoryRef.current;
          const currentIndex = Math.max(0, Math.min(pagesHiRef.current, history.length - 1));
          const page = history[currentIndex]?.find(({ id }) => id === input.pageId) ?? null;
          return sourceVectorIsCurrent() && canPublishStudioRasterLayer({
            page,
            pageId: input.pageId,
            operationId: input.plan.operationId,
            layerId: input.layerId,
          });
        },
        compensate: ({ reference, signal }) =>
          assetClientModule.deleteUnreferencedStudioRasterAssetUpload(
            input.workId,
            reference,
            signal
          ),
      }, { signal: controller.signal });
    };

    const task = studioRasterPublicationTailRef.current
      .catch(() => undefined)
      .then(run);
    studioRasterPublicationTailRef.current = task.then(
      () => undefined,
      () => undefined
    );
    void task.catch((cause: unknown) => {
      if (
        controller.signal.aborted ||
        (cause instanceof DOMException && cause.name === "AbortError") ||
        !scopeIsCurrent()
      ) return;
      setError(
        cause instanceof Error
          ? `실시간 픽셀 획 게시: ${cause.message} 기존 벡터 획은 안전하게 유지됩니다.`
          : "실시간 픽셀 획을 게시하지 못해 기존 벡터 획을 유지했습니다."
      );
    }).finally(() => {
      studioRasterPublicationControllersRef.current.delete(controller);
    });
  }
  api.queueStudioBg3dMagicFilterMaskPublication = queueStudioBg3dMagicFilterMaskPublication;
  api.queueStudioRasterDrawPromotion = queueStudioRasterDrawPromotion;
}
