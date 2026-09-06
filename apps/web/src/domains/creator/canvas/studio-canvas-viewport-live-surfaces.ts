import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { resolveStudioPaperGrainVisibleV1 } from "../brush/studio-paper-grain-visibility-v1";
import {
  normalizeStudioPaperSurfaceSettings,
} from "../brush/studio-paper-granulation-runtime";
import {
  requestStudioPaperSubstrateTileHeightsV1,
  STUDIO_PAPER_SUBSTRATE_TILE_SIZE_V1,
} from "../brush/studio-paper-substrate-tile-host-v1";
import {
  getStudioPaperSurfacePreviewTile,
  paintStudioPaperSubstrateTileCanvas,
  studioPaperSurfacePreviewOpacity,
} from "../brush/studio-paper-surface-preview";
import {
  planStudioLiveGesturePreviewRenderElements,
} from "../live/studio-live-gesture-preview-projection";
import {
  documentIdsOwnedByVectorIslands,
  lowerStudioElementsToRenderScene,
  studioDocumentAllowsKonvaHide,
} from "../render/studio-document-scene-lower";
import {
  resolveStudioVelloHubProductCapability,
  STUDIO_VELLO_HUB_PRODUCT_CAPABILITY,
} from "../render/studio-vello-hub";
import type {
  StudioRenderSurfaceAuthority,
} from "../render/StudioRenderSurface";
import { CANVAS_W } from "../studio-assets";
import { containingPanel } from "../studio-element-geometry";
import { isEffectivelyHidden } from "../studio-layers";
import { planStudioCanvasStageLayout } from "../studio-view-controls";

import {
  readStageDevicePixelRatio,
} from "./studio-canvas-viewport-primitives";
import {
  resolveStudioCanonicalDryMediaViewportAuthority,
} from "./studio-canonical-dry-media-authority";
import {
  applyStudioStageViewportClip,
  resolveStudioStageViewportClipArmed,
  studioStageBackingPixels,
  type StudioStageViewportClipRuntime,
} from "./studio-stage-viewport-clip";

import type {
  StudioCanvasViewportProps,
} from "./StudioCanvasViewportTypes";
import type { StudioCanonicalVNextDryMediaCanvasAuthority } from "../StudioCanonicalVNextDryMediaCanvas";

export function useStudioCanvasViewportLiveSurfaces(props: StudioCanvasViewportProps) {
  const {
    activePage,
    advancedFillPreview,
    canvasFlipH,
    canvasH,
    canvasRotation,
    canvasScrollViewport,
    collaborationDocumentUnavailable,
    drawingRef,
    effScale,
    elements,
    frameAnimOpen,
    groups,
    isExporting,
    localHiddenElementIds,
    mainLayerRef,
    marqueeIds,
    masterEditMode,
    masterRenderEls,
    nodeEditDraft,
    saving,
    scrollViewportStore,
    selectedId,
    sourceHydrationPending,
    stageRef,
    studioCrdtOperationSyncReady,
    studioFilterPageComposite,
    studioFilterPreview,
    studioLiveGesturePreviewAdapter,
    studioLiveGesturePreviewAuthoritativeElementIds,
    studioRasterHiddenOperationIds,
    studioWorkAssetRenderPlaceholders,
    studioWorkAssetRenderProjection,
    timelapseCapturing,
    timelinePlaying,
    timelineOpen,
    tool,
    webGpuPreviewAuthorized,
    webGpuViewportSurface,
    stableHandlers,
  } = props;
  const { setHokusaiLiveOverlaySurface, setLivingInkOverlaySurface } = stableHandlers;
  const [
    canonicalDryMediaCanvasAuthority,
    setCanonicalDryMediaCanvasAuthority,
  ] = useState<StudioCanonicalVNextDryMediaCanvasAuthority | null>(null);
  const velloHubCapability = resolveStudioVelloHubProductCapability();
  const [velloHubAuthority, setVelloHubAuthority] =
    useState<StudioRenderSurfaceAuthority>(() => ({
      status: velloHubCapability.enabled ? "idle" : "disabled",
      backendId: null,
      decision: null,
      reason: velloHubCapability.reason,
      sceneRevision: null,
      ownedDocumentIds: [],
      visibleCanvasCount: 0,
    }));
  const [pixiMountParent, setPixiMountParent] = useState<HTMLDivElement | null>(null);
  const hokusaiLiveCanvasRef = useRef<HTMLCanvasElement>(null);
  const livingInkCanvasRef = useRef<HTMLCanvasElement>(null);
  const hokusaiSurfaceLeft = webGpuViewportSurface?.surface.left;
  const hokusaiSurfaceTop = webGpuViewportSurface?.surface.top;
  const hokusaiSurfaceWidth = webGpuViewportSurface?.surface.width;
  const hokusaiSurfaceHeight = webGpuViewportSurface?.surface.height;
  const studioLiveGesturePreviewSnapshot = useSyncExternalStore(
    studioLiveGesturePreviewAdapter.subscribe,
    studioLiveGesturePreviewAdapter.getSnapshot,
    studioLiveGesturePreviewAdapter.getSnapshot,
  );
  const studioLiveGesturePreviewEligibleKeys = new Set(
    studioLiveGesturePreviewAdapter.getEligiblePreviewKeys(),
  );
  const studioLiveGesturePreviewVisible =
    !masterEditMode
    && !isExporting
    && !saving
    && !timelapseCapturing
    && !sourceHydrationPending
    && !collaborationDocumentUnavailable
    && studioCrdtOperationSyncReady;
  const studioLiveGesturePreviewPageId = studioLiveGesturePreviewVisible
    ? activePage.id
    : null;
  const studioLiveGesturePreviewPaintElements = masterEditMode
    ? elements
    : studioWorkAssetRenderProjection.elements;
  const studioLiveGesturePreviewRenderSnapshot = studioLiveGesturePreviewVisible
    ? studioLiveGesturePreviewSnapshot.filter(
        (entry) => entry.pageId === activePage.id,
      )
    : [];
  const studioLiveGesturePreviewReservedElementIds =
    studioLiveGesturePreviewRenderSnapshot.length > 0
      ? studioLiveGesturePreviewAuthoritativeElementIds instanceof Set
        ? studioLiveGesturePreviewAuthoritativeElementIds
        : new Set(studioLiveGesturePreviewAuthoritativeElementIds)
      : undefined;
  const studioLiveGesturePreviewRenderPlan = planStudioLiveGesturePreviewRenderElements(
    studioLiveGesturePreviewPaintElements,
    studioLiveGesturePreviewRenderSnapshot,
    studioLiveGesturePreviewVisible
      ? studioLiveGesturePreviewEligibleKeys
      : new Set<string>(),
    studioLiveGesturePreviewReservedElementIds,
  );
  const studioLiveGesturePreviewRenderedGestureIds =
    studioLiveGesturePreviewRenderPlan.previewElementIds.size > 0
    || studioLiveGesturePreviewRenderPlan.authoritativeHandoffIds.length > 0
      ? new Set([
          ...studioLiveGesturePreviewRenderPlan.previewElementIds,
          ...studioLiveGesturePreviewRenderPlan.authoritativeHandoffIds,
        ])
      : null;
  const studioLiveGesturePreviewTrailSuppressedSessionIds =
    studioLiveGesturePreviewRenderedGestureIds
      ? new Set(
          studioLiveGesturePreviewRenderSnapshot
            .filter(
              (entry) =>
                studioLiveGesturePreviewEligibleKeys.has(entry.key)
                && studioLiveGesturePreviewRenderedGestureIds.has(entry.gestureId),
            )
            .map((entry) => entry.senderSessionId),
        )
      : undefined;
  const studioLiveGesturePreviewHandoffIdsRef = useRef<readonly string[]>([]);
  studioLiveGesturePreviewHandoffIdsRef.current =
    studioLiveGesturePreviewRenderPlan.authoritativeHandoffIds;

  useLayoutEffect(() => {
    studioLiveGesturePreviewAdapter.setActivePage(studioLiveGesturePreviewPageId);
    studioLiveGesturePreviewAdapter.setAuthoritativeElementIds(
      studioLiveGesturePreviewPageId,
      studioLiveGesturePreviewPageId === null
        ? []
        : studioLiveGesturePreviewAuthoritativeElementIds,
    );
  }, [
    studioLiveGesturePreviewAuthoritativeElementIds,
    studioLiveGesturePreviewAdapter,
    studioLiveGesturePreviewPageId,
  ]);

  useLayoutEffect(() => {
    if (
      !studioLiveGesturePreviewVisible
      || studioLiveGesturePreviewRenderPlan.authoritativeHandoffToken === "[]"
    ) return;
    const pageId = activePage.id;
    const gestureIds = [
      ...studioLiveGesturePreviewHandoffIdsRef.current,
    ];
    const frameHandle = globalThis.requestAnimationFrame(() => {
      const layer = mainLayerRef.current;
      if (!layer?.getStage()) return;
      try {
        // Clip/mask and blend wrappers refresh caches in effects. Drawing one frame later makes
        // this synchronous draw an exact receipt for the authoritative React tree.
        layer.draw();
      } catch {
        // Keep the speculative entry visible until TTL rather than risking a blank handoff.
        return;
      }
      for (const gestureId of gestureIds) {
        studioLiveGesturePreviewAdapter.markAuthoritativeProjection(
          pageId,
          gestureId,
        );
      }
    });
    return () => globalThis.cancelAnimationFrame(frameHandle);
  }, [
    activePage.id,
    mainLayerRef,
    studioLiveGesturePreviewAdapter,
    studioLiveGesturePreviewRenderPlan.authoritativeHandoffToken,
    studioLiveGesturePreviewVisible,
  ]);

  // Document paper grain: the sheet the artist chose, painted under the artwork.
  //
  // Visibility is resolved by one authority (`resolveStudioPaperGrainVisibleV1`) so the stage and
  // this viewport can never disagree: an explicit toggle wins, otherwise the sheet shows exactly
  // when the page carries an authored `paperSurface`. Export is deliberately NOT excluded any more
  // — the paper is a property of the page, so what the artist sees is what ships.
  const paperSurfaceForPreview = useMemo(
    () => normalizeStudioPaperSurfaceSettings(activePage.paperSurface),
    [activePage.paperSurface],
  );
  const paperGrainVisible = resolveStudioPaperGrainVisibleV1(activePage);
  // High-fidelity substrate tile, baked off the main thread by the procedural surface worker.
  // Until it lands (or if workers are unavailable) the legacy 128² tile keeps the paper visible —
  // the degradation path never turns the sheet off.
  const [substrateTile, setSubstrateTile] = useState<HTMLCanvasElement | null>(null);
  const paperSurfaceKind = paperSurfaceForPreview.kind;
  const paperSurfaceSeed = paperSurfaceForPreview.seed;
  useEffect(() => {
    if (!paperGrainVisible) {
      setSubstrateTile(null);
      return;
    }
    let cancelled = false;
    const abort = new AbortController();
    void requestStudioPaperSubstrateTileHeightsV1(
      {
        kind: paperSurfaceKind,
        seed: paperSurfaceSeed,
        size: STUDIO_PAPER_SUBSTRATE_TILE_SIZE_V1,
        // One-texel halo so the relief BRDF never clamps inside the repeating core.
        halo: 1,
      },
      abort.signal,
    ).then((baked) => {
      if (cancelled || !baked) return;
      setSubstrateTile(
        paintStudioPaperSubstrateTileCanvas(baked.heightField, baked.size, {
          halo: baked.halo,
          relief: "lit",
          grainStrength: 0.58,
        }),
      );
    });
    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [paperGrainVisible, paperSurfaceKind, paperSurfaceSeed]);
  const paperGrainFallbackImage = useMemo(() => {
    if (!paperGrainVisible) return null;
    return getStudioPaperSurfacePreviewTile(paperSurfaceForPreview, {
      size: 128,
      grainStrength: 0.58,
    });
  }, [paperGrainVisible, paperSurfaceForPreview]);
  // Both tiles cover exactly `tile.width` document pixels, so the pattern scale stays 1 and the
  // physical wavelength of the grain is identical whichever tile is live.
  const paperGrainPatternImage = paperGrainVisible
    ? substrateTile ?? paperGrainFallbackImage
    : null;
  const paperGrainOpacity = paperGrainVisible
    ? studioPaperSurfacePreviewOpacity(paperSurfaceForPreview.kind)
    : 0;
  useLayoutEffect(() => {
    const canvas = hokusaiLiveCanvasRef.current;
    // v1 is axis-aligned. A mirrored or quarter-turn view keeps the exact retained DrawEl route;
    // presenting unmirrored material pixels would be worse than a visible capability fallback.
    if (
      !canvas
      || hokusaiSurfaceLeft === undefined
      || hokusaiSurfaceTop === undefined
      || hokusaiSurfaceWidth === undefined
      || hokusaiSurfaceHeight === undefined
      || canvasFlipH
      || canvasRotation !== 0
      || !(effScale > 0)
    ) {
      setHokusaiLiveOverlaySurface(null);
      return undefined;
    }
    const dpr = Math.max(1, Math.min(4, globalThis.devicePixelRatio || 1));
    const backingWidth = Math.max(1, Math.ceil(hokusaiSurfaceWidth * dpr));
    const backingHeight = Math.max(1, Math.ceil(hokusaiSurfaceHeight * dpr));
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;
    const surfaceKey = [
      activePage.id,
      hokusaiSurfaceLeft,
      hokusaiSurfaceTop,
      hokusaiSurfaceWidth,
      hokusaiSurfaceHeight,
      effScale,
      dpr,
    ].join(":");
    setHokusaiLiveOverlaySurface({
      canvas,
      surfaceKey,
      projection: {
        documentX: hokusaiSurfaceLeft / effScale,
        documentY: hokusaiSurfaceTop / effScale,
        scaleX: effScale,
        scaleY: effScale,
        devicePixelRatio: dpr,
      },
    });
    // A parent render can update this effect while canvas geometry is unchanged. Publishing a
    // transient null from dependency cleanup would cancel an admitted Hokusai route before the
    // exact same binding is registered again. The guarded branch above clears genuinely missing
    // surfaces, and StudioPage owns final provider/renderer disposal when the editor unmounts.
    return undefined;
  }, [
    activePage.id,
    canvasFlipH,
    canvasRotation,
    effScale,
    hokusaiSurfaceHeight,
    hokusaiSurfaceLeft,
    hokusaiSurfaceTop,
    hokusaiSurfaceWidth,
    setHokusaiLiveOverlaySurface,
  ]);

  useLayoutEffect(() => {
    const canvas = livingInkCanvasRef.current;
    if (
      !canvas
      || hokusaiSurfaceLeft === undefined
      || hokusaiSurfaceTop === undefined
      || hokusaiSurfaceWidth === undefined
      || hokusaiSurfaceHeight === undefined
      || canvasFlipH
      || canvasRotation !== 0
      || !(effScale > 0)
    ) {
      setLivingInkOverlaySurface(null);
      return undefined;
    }
    const dpr = Math.max(1, Math.min(4, globalThis.devicePixelRatio || 1));
    const backingWidth = Math.max(1, Math.ceil(hokusaiSurfaceWidth * dpr));
    const backingHeight = Math.max(1, Math.ceil(hokusaiSurfaceHeight * dpr));
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;
    // Living Ink frames are full-field composites. The overlay's visible clip width/height can
    // resize when contextual editor chrome opens or closes without changing document projection;
    // canvas resizing clears old pixels, then the next full frame safely repopulates the clip.
    // Keep only physical-field/projection identity in the route key so that UI reflow cannot
    // cancel an otherwise valid pointer contact. Hokusai above stays stricter because it receives
    // incremental dirty patches whose accumulated canvas is invalidated by a backing resize.
    const surfaceKey = [
      "living-ink",
      activePage.id,
      hokusaiSurfaceLeft,
      hokusaiSurfaceTop,
      effScale,
      dpr,
      CANVAS_W,
      canvasH,
    ].join(":");
    setLivingInkOverlaySurface({
      canvas,
      surfaceKey,
      projection: {
        documentX: hokusaiSurfaceLeft / effScale,
        documentY: hokusaiSurfaceTop / effScale,
        scaleX: effScale,
        scaleY: effScale,
        devicePixelRatio: dpr,
        documentWidth: CANVAS_W,
        documentHeight: canvasH,
      },
    });
    // Dependency updates can be caused by an ordinary parent render (for example clearing the
    // selected canonical image when a Water stroke begins). Do not publish a transient null
    // surface from effect cleanup: the next layout effect often registers the exact same canvas
    // and key, but that momentary teardown would fail-close the already admitted pointer route.
    // A genuinely unavailable surface is cleared by the guarded branch above, while editor
    // unmount disposes the coordinator and renderer at the owning StudioPage boundary.
    return undefined;
  }, [
    activePage.id,
    canvasFlipH,
    canvasH,
    canvasRotation,
    effScale,
    hokusaiSurfaceHeight,
    hokusaiSurfaceLeft,
    hokusaiSurfaceTop,
    hokusaiSurfaceWidth,
    setLivingInkOverlaySurface,
  ]);
  const suppressViewTransform = isExporting || saving || timelapseCapturing;
  // 적응형 뷰포트 클립 — 스테이지 백킹 스토어가 임계를 넘을 때만 보이는 영역으로 줄인다.
  // 임계·이력(히스테리시스) 근거는 studio-stage-viewport-clip.ts 상단 실측 표에 있다.
  const [stageDevicePixelRatio, setStageDevicePixelRatio] = useState(readStageDevicePixelRatio);
  useEffect(() => {
    // DPR 은 창을 다른 배율의 모니터로 옮길 때 바뀌고, 그때 resize 가 함께 발행된다.
    const syncDevicePixelRatio = () => {
      const next = readStageDevicePixelRatio();
      setStageDevicePixelRatio((current) => (current === next ? current : next));
    };
    globalThis.addEventListener("resize", syncDevicePixelRatio);
    return () => globalThis.removeEventListener("resize", syncDevicePixelRatio);
  }, []);
  // 이력값은 state 가 아니라 ref 다 — 임계를 넘는 순간 그 렌더에서 바로 클립돼야 하고
  // (한 프레임 늦으면 그 프레임에 32Mpx 를 할당한다), 결정이 바뀌었다고 추가 렌더를 만들면
  // 줌 정착 커밋 예산(studio-hot-path-commit-budget.ts)을 잡아먹는다.
  const stageClipArmedRef = useRef(false);
  const stageClipArmed = resolveStudioStageViewportClipArmed(
    studioStageBackingPixels({
      documentWidth: CANVAS_W,
      documentHeight: canvasH,
      scale: effScale,
      devicePixelRatio: stageDevicePixelRatio,
    }),
    stageClipArmedRef.current
  );
  useEffect(() => {
    stageClipArmedRef.current = stageClipArmed;
  }, [stageClipArmed]);
  const stageViewLayout = planStudioCanvasStageLayout({
    documentWidth: CANVAS_W,
    documentHeight: canvasH,
    scale: effScale,
    canvasFlipH,
    canvasRotation,
    captureDocumentView: suppressViewTransform,
    viewportClip: stageClipArmed
      ? {
          viewportWidth: canvasScrollViewport.width,
          viewportHeight: canvasScrollViewport.height,
          scrollLeft: canvasScrollViewport.left,
          scrollTop: canvasScrollViewport.top,
        }
      : null,
  });
  const stageViewClip = stageViewLayout.clip;
  // Pixi 선택 오버레이는 Stage 와 같은 문서→뷰포트 배치를 써야 한다. Stage 는 뷰포트 클립만큼
  // 원점을 당겨 두고 컨테이너 CSS transform 으로 되돌리지만, 이 캔버스는 클립되지 않은 줌 호스트
  // 박스를 그대로 덮으므로 클립 오프셋을 다시 더해 "클립 이전" 배치를 복원한다.
  const pixiSceneDocumentTransform = useMemo(
    () => ({
      scaleX: stageViewLayout.scaleX,
      scaleY: stageViewLayout.scaleY,
      offsetX: stageViewLayout.x + (stageViewClip?.left ?? 0),
      offsetY: stageViewLayout.y + (stageViewClip?.top ?? 0),
      rotation: stageViewLayout.rotation,
    }),
    [
      stageViewLayout.scaleX,
      stageViewLayout.scaleY,
      stageViewLayout.x,
      stageViewLayout.y,
      stageViewLayout.rotation,
      stageViewClip?.left,
      stageViewClip?.top,
    ],
  );
  // Vello is inserted inside `.konvajs-content`, so it consumes Stage-local
  // placement. Pixi remains a host sibling and therefore keeps the restored
  // clip offsets above. Adaptive clips stay an explicit legacy boundary until
  // the Vello surface can subscribe to the live scroll window and redraw it.
  const velloSceneDocumentTransform = useMemo(
    () => ({
      scaleX: stageViewLayout.scaleX,
      scaleY: stageViewLayout.scaleY,
      offsetX: stageViewLayout.x,
      offsetY: stageViewLayout.y,
      rotation: stageViewLayout.rotation,
    }),
    [
      stageViewLayout.scaleX,
      stageViewLayout.scaleY,
      stageViewLayout.x,
      stageViewLayout.y,
      stageViewLayout.rotation,
    ],
  );
  // Stable identity prevents the async Vello/Pixi selection island from rerendering when an
  // unrelated inspector or status control commits while the selected document ids are unchanged.
  const acceleratedSceneSelectedIds = useMemo(
    () => marqueeIds.length > 0 ? marqueeIds : selectedId ? [selectedId] : [],
    [marqueeIds, selectedId],
  );
  const readVelloHubPenDown = useCallback(
    () => drawingRef.current !== null,
    [drawingRef],
  );
  const velloDocumentElements = useMemo(
    () => studioLiveGesturePreviewRenderPlan.elements.map((element) => (
      isEffectivelyHidden(element, groups) || localHiddenElementIds.has(element.id)
        ? { ...element, hidden: true }
        : element
    )),
    [groups, localHiddenElementIds, studioLiveGesturePreviewRenderPlan.elements],
  );
  const velloEligibleDocumentIds = useMemo(
    () => documentIdsOwnedByVectorIslands(lowerStudioElementsToRenderScene(velloDocumentElements, {
      width: CANVAS_W,
      height: canvasH,
    })),
    [canvasH, velloDocumentElements],
  );
  const velloSurfaceDpr = Math.max(1, stageDevicePixelRatio);
  const velloBackingWidth = Math.ceil(stageViewLayout.width * velloSurfaceDpr);
  const velloBackingHeight = Math.ceil(stageViewLayout.height * velloSurfaceDpr);
  const velloSurfaceSizeAdmitted =
    stageViewLayout.width > 0
    && stageViewLayout.height > 0
    && velloBackingWidth <= STUDIO_VELLO_HUB_PRODUCT_CAPABILITY.maxBackingDimension
    && velloBackingHeight <= STUDIO_VELLO_HUB_PRODUCT_CAPABILITY.maxBackingDimension
    && velloBackingWidth * velloBackingHeight
      <= STUDIO_VELLO_HUB_PRODUCT_CAPABILITY.maxBackingPixelArea;
  const velloHasExactPaintProjection =
    !isExporting
    && !saving
    && !timelapseCapturing
    && !sourceHydrationPending
    && !collaborationDocumentUnavailable
    && studioCrdtOperationSyncReady
    && !masterEditMode
    && (activePage.hideMaster || masterRenderEls.length === 0)
    && studioFilterPreview === null
    && studioFilterPageComposite === null
    && advancedFillPreview === null
    && !timelineOpen
    && !timelinePlaying
    && !frameAnimOpen
    && nodeEditDraft === null
    && studioWorkAssetRenderPlaceholders.length === 0
    && studioRasterHiddenOperationIds.size === 0
    && studioLiveGesturePreviewRenderPlan.previewElementIds.size === 0
    && studioLiveGesturePreviewRenderPlan.authoritativeHandoffToken === "[]";
  const velloDocumentSurfaceEnabled =
    velloHubCapability.enabled
    && stageViewClip === null
    && velloSurfaceSizeAdmitted
    && velloHasExactPaintProjection
    && tool === "select"
    && selectedId === null
    && marqueeIds.length === 0
    && studioDocumentAllowsKonvaHide(
      velloDocumentElements,
      velloEligibleDocumentIds,
    );
  const velloSceneRevision = useMemo(
    () => Object.freeze({
      pageId: activePage.id,
      documentHeight: canvasH,
      elements: velloDocumentElements,
      transform: velloSceneDocumentTransform,
      dpr: velloSurfaceDpr,
      viewportHeight: stageViewLayout.height,
      viewportWidth: stageViewLayout.width,
    }),
    [
      activePage.id,
      canvasH,
      velloDocumentElements,
      velloSceneDocumentTransform,
      velloSurfaceDpr,
      stageViewLayout.height,
      stageViewLayout.width,
    ],
  );
  // The handoff is exact-revision and receipt-gated. During initialisation or
  // a changed scene, Konva's already-rendered document group remains visible;
  // no provider is re-executed as a recovery attempt. A current-revision
  // last-good Vello frame may remain held during an explicit unavailable state.
  const frameGraphOwnsDocumentPixels =
    velloDocumentSurfaceEnabled
    && velloHubAuthority.sceneRevision === velloSceneRevision
    && velloHubAuthority.visibleCanvasCount === 1
    && (
      velloHubAuthority.status === "active"
      || velloHubAuthority.status === "unavailable"
    );
  const stageClipRuntimeRef = useRef<StudioStageViewportClipRuntime | null>(null);
  // React 는 정착된 스크롤 스냅샷으로 Stage 를 커밋하므로, 커밋 직후 살아 있는 스크롤 값으로
  // 다시 맞춘다. 컨테이너 transform 과 stage.x/y 는 크기가 같고 부호가 반대라, 둘 중 하나만
  // 반영된 프레임은 포인터 좌표를 스크롤 델타만큼 어긋나게 만든다 — 항상 같이 쓴다.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (!stageViewClip) {
      stageClipRuntimeRef.current = null;
      const container = stage.container();
      if (container && container.style.transform) container.style.transform = "";
      return;
    }
    const runtime: StudioStageViewportClipRuntime = {
      stageWidth: stageViewLayout.hostWidth,
      stageHeight: stageViewLayout.hostHeight,
      width: stageViewClip.width,
      height: stageViewClip.height,
      baseX: stageViewLayout.x + stageViewClip.left,
      baseY: stageViewLayout.y + stageViewClip.top,
      appliedLeft: Number.NaN,
      appliedTop: Number.NaN,
    };
    stageClipRuntimeRef.current = runtime;
    const live = scrollViewportStore.getSnapshot();
    applyStudioStageViewportClip(stage, runtime, live.left, live.top);
  });
  useEffect(() => {
    // 팬 핫패스: 스크롤 프레임마다 React 를 통과하지 않고 스테이지 창만 옮긴다.
    const followScroll = () => {
      const stage = stageRef.current;
      const runtime = stageClipRuntimeRef.current;
      if (!stage || !runtime) return;
      const live = scrollViewportStore.getSnapshot();
      applyStudioStageViewportClip(stage, runtime, live.left, live.top);
    };
    return scrollViewportStore.subscribe(followScroll);
  }, [scrollViewportStore, stageRef]);
  /*
   * First product-visible canonical-vNext slice.
   *
   * The separate WebGPU canvas is intentionally authorized only for one selected, top-most,
   * unclipped dry-media DrawEl. Keeping this gate narrower than the product compiler prevents a
   * presentation-only surface from changing layer, clipping, mask, preview or rotation semantics.
   * DrawEl/CRDT stays authoritative; until the child returns an exact completed parity receipt the
   * ordinary Konva node below remains visible.
   */
  const canonicalDryMediaAuthoredElements = masterEditMode
    ? elements
    : studioWorkAssetRenderProjection.elements;
  const canonicalDryMediaVisibleElements =
    canonicalDryMediaAuthoredElements.filter(
      (element) =>
        !isEffectivelyHidden(element, groups)
        && !localHiddenElementIds.has(element.id),
    );
  const canonicalDryMediaTopElement =
    canonicalDryMediaVisibleElements[
      canonicalDryMediaVisibleElements.length - 1
    ] ?? null;
  const canonicalDryMediaSelectedElement =
    canonicalDryMediaTopElement?.id === selectedId
      && canonicalDryMediaTopElement.type === "draw"
      ? canonicalDryMediaTopElement
      : null;
  const canonicalDryMediaPanelClip =
    canonicalDryMediaSelectedElement
      && !canonicalDryMediaSelectedElement.noClip
      ? containingPanel(
          canonicalDryMediaSelectedElement,
          canonicalDryMediaAuthoredElements,
        )
      : null;
  const canonicalDryMediaCandidate =
    webGpuViewportSurface
    && tool === "select"
    && marqueeIds.length === 0
    && !masterEditMode
    && !isExporting
    && !saving
    && !timelapseCapturing
    && !sourceHydrationPending
    && !collaborationDocumentUnavailable
    && canvasRotation === 0
    && !timelinePlaying
    && studioFilterPreview === null
    && studioFilterPageComposite === null
    && advancedFillPreview === null
    && !webGpuPreviewAuthorized
    && studioRasterHiddenOperationIds.size === 0
    && canonicalDryMediaSelectedElement !== null
    && canonicalDryMediaSelectedElement.clipBelow !== true
    && canonicalDryMediaSelectedElement.maskSrc === undefined
    && canonicalDryMediaPanelClip === null
      ? canonicalDryMediaSelectedElement
      : null;
  // The device pixel ratio is part of the layout identity: the specialist canvas allocates its
  // backing store from it, so a monitor move or browser zoom that keeps the CSS bounds but changes
  // DPR must invalidate any retained last-good frame exactly like a resize does.
  const canonicalDryMediaDevicePixelRatio = Math.max(
    1,
    Math.min(4, Number(globalThis.devicePixelRatio) || 1),
  );
  const canonicalDryMediaLayoutKey = webGpuViewportSurface
    ? [
        activePage.id,
        CANVAS_W,
        canvasH,
        webGpuViewportSurface.surface.left,
        webGpuViewportSurface.surface.top,
        webGpuViewportSurface.surface.width,
        webGpuViewportSurface.surface.height,
        effScale,
        canvasFlipH ? 1 : 0,
        canonicalDryMediaDevicePixelRatio,
      ].join(":")
    : "unavailable";
  const canonicalDryMediaViewportAuthority =
    resolveStudioCanonicalDryMediaViewportAuthority(
      canonicalDryMediaCanvasAuthority,
      canonicalDryMediaCandidate,
      canonicalDryMediaLayoutKey,
    );
  const canonicalDryMediaCanvasVisible =
    canonicalDryMediaViewportAuthority.canvasVisible;
  const canonicalDryMediaHiddenElementId =
    canonicalDryMediaViewportAuthority.hiddenElementId;

  return {
    acceleratedSceneSelectedIds,
    canonicalDryMediaCanvasVisible,
    canonicalDryMediaCandidate,
    canonicalDryMediaHiddenElementId,
    canonicalDryMediaLayoutKey,
    frameGraphOwnsDocumentPixels,
    hokusaiLiveCanvasRef,
    livingInkCanvasRef,
    paperGrainOpacity,
    paperGrainPatternImage,
    paperSurfaceForPreview,
    pixiMountParent,
    pixiSceneDocumentTransform,
    readVelloHubPenDown,
    setCanonicalDryMediaCanvasAuthority,
    setPixiMountParent,
    setVelloHubAuthority,
    stageViewClip,
    stageViewLayout,
    studioLiveGesturePreviewRenderPlan,
    studioLiveGesturePreviewTrailSuppressedSessionIds,
    suppressViewTransform,
    velloHubAuthority,
    velloHubCapability,
    velloDocumentElements,
    velloDocumentSurfaceEnabled,
    velloSceneDocumentTransform,
    velloSceneRevision,
    velloSurfaceDpr,
  };
}

export type StudioCanvasViewportLiveSurfaces = ReturnType<typeof useStudioCanvasViewportLiveSurfaces>;
