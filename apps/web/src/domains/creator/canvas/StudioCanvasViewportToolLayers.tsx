import { Layer, Rect, Circle as KCircle, Line, Shape, Image as KImage } from "react-konva/lib/ReactKonvaCore";

import {
  studioBrushAliasEffectiveDiameter,
} from "../brush/studio-brush-alias-profile";
import { drawLiveFreehandDraftToContext } from "../brush/studio-draw-rendering";
import { StudioBrushCursor } from "../brush/StudioBrushCursor";
import { StudioLiveTransformDraftNode } from "../StudioLiveTransformDraftNode";
import { CANVAS_W } from "../studio-assets";
import { StudioDraftPreviewLayers } from "../StudioDraftPreviewLayers";

import { isStudioBrushCursorMode } from "./studio-canvas-cursor";
import { StudioCanvasGuideOverlayLayers } from "./StudioCanvasGuideLayers";
import { StudioCanvasInteractiveOverlays } from "./StudioCanvasInteractiveOverlays";

import type {
  StudioCanvasViewportHandlers,
  StudioCanvasViewportProps,
} from "./StudioCanvasViewportTypes";
import type Konva from "konva";
import type { StudioPaperSurfaceSettings } from "../brush/studio-paper-granulation-runtime";
import type { StudioLiveTransformDraftStore } from "../studio-live-transform-draft-store";

export interface StudioCanvasViewportToolLayersProps {
  activeSurfaceReviewLocked: StudioCanvasViewportProps["activeSurfaceReviewLocked"];
  advancedRulers: StudioCanvasViewportProps["advancedRulers"];
  appSettings: StudioCanvasViewportProps["appSettings"];
  beginSharedGutterDrag: StudioCanvasViewportHandlers["beginSharedGutterDrag"];
  brush: StudioCanvasViewportProps["brush"];
  brushCursorRef: StudioCanvasViewportProps["brushCursorRef"];
  bubbleShapeActiveHandleIndex: StudioCanvasViewportProps["bubbleShapeActiveHandleIndex"];
  bubbleShapeArmed: StudioCanvasViewportProps["bubbleShapeArmed"];
  bubbleShapeHandles: StudioCanvasViewportProps["bubbleShapeHandles"];
  cancelStudioDrawingAssistPreview: StudioCanvasViewportHandlers["cancelStudioDrawingAssistPreview"];
  canvasInteractionBlocked: StudioCanvasViewportProps["canvasInteractionBlocked"];
  commitIsometricOrigin: StudioCanvasViewportHandlers["commitIsometricOrigin"];
  commitSharedGutterDrag: StudioCanvasViewportHandlers["commitSharedGutterDrag"];
  cropRect: StudioCanvasViewportProps["cropRect"];
  dodgeBurnArmed: StudioCanvasViewportProps["dodgeBurnArmed"];
  dodgeBurnRadius: StudioCanvasViewportProps["dodgeBurnRadius"];
  draftPreviewDynamicLayerRef: StudioCanvasViewportProps["draftPreviewDynamicLayerRef"];
  draftPreviewNormalLayerRef: StudioCanvasViewportProps["draftPreviewNormalLayerRef"];
  draftPreviewStore: StudioCanvasViewportProps["draftPreviewStore"];
  drawMode: StudioCanvasViewportProps["drawMode"];
  effScale: StudioCanvasViewportProps["effScale"];
  eraserPresetActive: boolean;
  filterMaskCursorRef: StudioCanvasViewportProps["filterMaskCursorRef"];
  filterMaskDragPreview: StudioCanvasViewportProps["filterMaskDragPreview"];
  filterMaskPaintArmed: StudioCanvasViewportProps["filterMaskPaintArmed"];
  filterMaskPaintMode: StudioCanvasViewportProps["filterMaskPaintMode"];
  filterMaskRadius: StudioCanvasViewportProps["filterMaskRadius"];
  gpuCanvasShadowVisibleRef: StudioCanvasViewportProps["gpuCanvasShadowVisibleRef"];
  gpuLiveInkPinnedRef: StudioCanvasViewportProps["gpuLiveInkPinnedRef"];
  guides: StudioCanvasViewportProps["guides"];
  healCloneArmed: StudioCanvasViewportProps["healCloneArmed"];
  healCloneCursorRef: StudioCanvasViewportProps["healCloneCursorRef"];
  healCloneDragPreview: StudioCanvasViewportProps["healCloneDragPreview"];
  healCloneRadius: StudioCanvasViewportProps["healCloneRadius"];
  healCloneSourceAnchor: StudioCanvasViewportProps["healCloneSourceAnchor"];
  healCloneSourceCursorRef: StudioCanvasViewportProps["healCloneSourceCursorRef"];
  healCloneTool: StudioCanvasViewportProps["healCloneTool"];
  historyBrushArmed: StudioCanvasViewportProps["historyBrushArmed"];
  historyBrushCursorRef: StudioCanvasViewportProps["historyBrushCursorRef"];
  historyBrushDragPreview: StudioCanvasViewportProps["historyBrushDragPreview"];
  historyBrushRadius: StudioCanvasViewportProps["historyBrushRadius"];
  isExporting: StudioCanvasViewportProps["isExporting"];
  isometricAngleDeg: StudioCanvasViewportProps["isometricAngleDeg"];
  isometricCellSize: StudioCanvasViewportProps["isometricCellSize"];
  isometricGridActive: StudioCanvasViewportProps["isometricGridActive"];
  isometricOriginX: StudioCanvasViewportProps["isometricOriginX"];
  isometricOriginY: StudioCanvasViewportProps["isometricOriginY"];
  isPanning: StudioCanvasViewportProps["isPanning"];
  isSpacePressed: StudioCanvasViewportProps["isSpacePressed"];
  layerMaskCursorRef: StudioCanvasViewportProps["layerMaskCursorRef"];
  layerMaskDragPreview: StudioCanvasViewportProps["layerMaskDragPreview"];
  layerMaskPaintArmed: StudioCanvasViewportProps["layerMaskPaintArmed"];
  layerMaskPaintMode: StudioCanvasViewportProps["layerMaskPaintMode"];
  layerMaskRadius: StudioCanvasViewportProps["layerMaskRadius"];
  liquifyArmed: StudioCanvasViewportProps["liquifyArmed"];
  liquifyPreviewImageRef: StudioCanvasViewportProps["liquifyPreviewImageRef"];
  liquifyRadius: StudioCanvasViewportProps["liquifyRadius"];
  liveDraftDirectRef: StudioCanvasViewportProps["liveDraftDirectRef"];
  liveDraftLayerRef: StudioCanvasViewportProps["liveDraftLayerRef"];
  liveDraftVisualRef: StudioCanvasViewportProps["liveDraftVisualRef"];
  liveDynamicBrushOverlayRenderer: StudioCanvasViewportProps["liveDynamicBrushOverlayRenderer"];
  liveInkOverlayRendererRef: StudioCanvasViewportProps["liveInkOverlayRendererRef"];
  liveTransformDraftStore: StudioLiveTransformDraftStore;
  liveTransformDraftScope: string;
  liveRetainedMediaOverlayRenderer: StudioCanvasViewportProps["liveRetainedMediaOverlayRenderer"];
  liveStampOverlayRenderer: StudioCanvasViewportProps["liveStampOverlayRenderer"];
  liveWetInkOverlayRenderer: StudioCanvasViewportProps["liveWetInkOverlayRenderer"];
  livingInkOverlayVisibleRef: StudioCanvasViewportProps["livingInkOverlayVisibleRef"];
  lowDensityEraserActive: boolean;
  paperSurfaceForLiveTransform: StudioPaperSurfaceSettings;
  marqueeRectNodeRef: StudioCanvasViewportProps["marqueeRectNodeRef"];
  masterEditMode: StudioCanvasViewportProps["masterEditMode"];
  moveVanishingPointById: StudioCanvasViewportHandlers["moveVanishingPointById"];
  nodeEditActiveHandleIndex: StudioCanvasViewportProps["nodeEditActiveHandleIndex"];
  nodeEditArmed: StudioCanvasViewportProps["nodeEditArmed"];
  nodeEditDraft: StudioCanvasViewportProps["nodeEditDraft"];
  nodeEditHandles: StudioCanvasViewportProps["nodeEditHandles"];
  nodeEditTool: StudioCanvasViewportProps["nodeEditTool"];
  paintRetouchStrokeLineRef: StudioCanvasViewportProps["paintRetouchStrokeLineRef"];
  panelGutter: StudioCanvasViewportProps["panelGutter"];
  panelSplitPreview: StudioCanvasViewportProps["panelSplitPreview"];
  patchAdvancedRuler: StudioCanvasViewportHandlers["patchAdvancedRuler"];
  perspectiveEyeLevelY: StudioCanvasViewportProps["perspectiveEyeLevelY"];
  perspectiveLockHorizon: StudioCanvasViewportProps["perspectiveLockHorizon"];
  perspectiveRulerActive: StudioCanvasViewportProps["perspectiveRulerActive"];
  pixelDragPreview: StudioCanvasViewportProps["pixelDragPreview"];
  pixelOverlayFrame: StudioCanvasViewportProps["pixelOverlayFrame"];
  pixelOverlaySel: StudioCanvasViewportProps["pixelOverlaySel"];
  polyLassoHover: StudioCanvasViewportProps["polyLassoHover"];
  polyLassoSession: StudioCanvasViewportProps["polyLassoSession"];
  previewAdvancedRuler: StudioCanvasViewportHandlers["previewAdvancedRuler"];
  previewIsometricOrigin: StudioCanvasViewportHandlers["previewIsometricOrigin"];
  previewPerspectiveEyeLevelY: StudioCanvasViewportHandlers["previewPerspectiveEyeLevelY"];
  previewSharedGutterDrag: StudioCanvasViewportHandlers["previewSharedGutterDrag"];
  previewVanishingPointById: StudioCanvasViewportHandlers["previewVanishingPointById"];
  puppetWarpArmed: StudioCanvasViewportProps["puppetWarpArmed"];
  puppetWarpBusy: StudioCanvasViewportProps["puppetWarpBusy"];
  puppetWarpPins: StudioCanvasViewportProps["puppetWarpPins"];
  quickMaskArmed: StudioCanvasViewportProps["quickMaskArmed"];
  quickMaskBrushMode: StudioCanvasViewportProps["quickMaskBrushMode"];
  quickMaskDragPreview: StudioCanvasViewportProps["quickMaskDragPreview"];
  quickMaskRadius: StudioCanvasViewportProps["quickMaskRadius"];
  quickMaskTintCanvas: StudioCanvasViewportProps["quickMaskTintCanvas"];
  quickMaskTintColor: StudioCanvasViewportProps["quickMaskTintColor"];
  quickMaskTintOpacity: StudioCanvasViewportProps["quickMaskTintOpacity"];
  saving: StudioCanvasViewportProps["saving"];
  selected: StudioCanvasViewportProps["selected"];
  setPuppetWarpPins: StudioCanvasViewportProps["setPuppetWarpPins"];
  setSymmetryCenterX: StudioCanvasViewportProps["setSymmetryCenterX"];
  setSymmetryCenterY: StudioCanvasViewportProps["setSymmetryCenterY"];
  setUserGuides: StudioCanvasViewportProps["setUserGuides"];
  sharedGutters: StudioCanvasViewportProps["sharedGutters"];
  singleObjectDragLayerRef: import("react").RefObject<Konva.Layer | null>;
  smartGuides: StudioCanvasViewportProps["smartGuides"];
  smudgeArmed: StudioCanvasViewportProps["smudgeArmed"];
  smudgeCursorRef: StudioCanvasViewportProps["smudgeCursorRef"];
  smudgeRadius: StudioCanvasViewportProps["smudgeRadius"];
  strokeGuideRef: StudioCanvasViewportProps["strokeGuideRef"];
  strokeWidth: StudioCanvasViewportProps["strokeWidth"];
  symmetryCenterX: StudioCanvasViewportProps["symmetryCenterX"];
  symmetryCenterY: StudioCanvasViewportProps["symmetryCenterY"];
  symmetryRadialCount: StudioCanvasViewportProps["symmetryRadialCount"];
  symmetryType: StudioCanvasViewportProps["symmetryType"];
  tipAngle: StudioCanvasViewportProps["tipAngle"];
  tipRoundness: StudioCanvasViewportProps["tipRoundness"];
  tool: StudioCanvasViewportProps["tool"];
  userGuides: StudioCanvasViewportProps["userGuides"];
  vanishingPoints: StudioCanvasViewportProps["vanishingPoints"];
  wetMixArmed: StudioCanvasViewportProps["wetMixArmed"];
  wetMixRadius: StudioCanvasViewportProps["wetMixRadius"];
  setPerspectiveEyeLevelY: StudioCanvasViewportHandlers["setPerspectiveEyeLevelY"];
  brushCursorStyle: StudioCanvasViewportProps["appSettings"]["general"]["brushCursorStyle"];
  stabilizer: StudioCanvasViewportProps["stabilizer"];
  canvasH: StudioCanvasViewportProps["canvasH"];
}

export function StudioCanvasViewportToolLayers({
  activeSurfaceReviewLocked,
  advancedRulers,
  appSettings,
  beginSharedGutterDrag,
  brush,
  brushCursorRef,
  brushCursorStyle,
  stabilizer,
  canvasH,
  bubbleShapeActiveHandleIndex,
  bubbleShapeArmed,
  bubbleShapeHandles,
  cancelStudioDrawingAssistPreview,
  canvasInteractionBlocked,
  commitIsometricOrigin,
  commitSharedGutterDrag,
  cropRect,
  dodgeBurnArmed,
  dodgeBurnRadius,
  draftPreviewDynamicLayerRef,
  draftPreviewNormalLayerRef,
  draftPreviewStore,
  drawMode,
  effScale,
  eraserPresetActive,
  filterMaskCursorRef,
  filterMaskDragPreview,
  filterMaskPaintArmed,
  filterMaskPaintMode,
  filterMaskRadius,
  gpuCanvasShadowVisibleRef,
  gpuLiveInkPinnedRef,
  guides,
  healCloneArmed,
  healCloneCursorRef,
  healCloneDragPreview,
  healCloneRadius,
  healCloneSourceAnchor,
  healCloneSourceCursorRef,
  healCloneTool,
  historyBrushArmed,
  historyBrushCursorRef,
  historyBrushDragPreview,
  historyBrushRadius,
  isExporting,
  isometricAngleDeg,
  isometricCellSize,
  isometricGridActive,
  isometricOriginX,
  isometricOriginY,
  isPanning,
  isSpacePressed,
  layerMaskCursorRef,
  layerMaskDragPreview,
  layerMaskPaintArmed,
  layerMaskPaintMode,
  layerMaskRadius,
  liquifyArmed,
  liquifyPreviewImageRef,
  liquifyRadius,
  liveDraftDirectRef,
  liveDraftLayerRef,
  liveDraftVisualRef,
  liveDynamicBrushOverlayRenderer,
  liveInkOverlayRendererRef,
  liveTransformDraftStore,
  liveTransformDraftScope,
  liveRetainedMediaOverlayRenderer,
  liveStampOverlayRenderer,
  liveWetInkOverlayRenderer,
  livingInkOverlayVisibleRef,
  lowDensityEraserActive,
  paperSurfaceForLiveTransform,
  marqueeRectNodeRef,
  masterEditMode,
  moveVanishingPointById,
  nodeEditActiveHandleIndex,
  nodeEditArmed,
  nodeEditDraft,
  nodeEditHandles,
  nodeEditTool,
  paintRetouchStrokeLineRef,
  panelGutter,
  panelSplitPreview,
  patchAdvancedRuler,
  perspectiveEyeLevelY,
  perspectiveLockHorizon,
  perspectiveRulerActive,
  pixelDragPreview,
  pixelOverlayFrame,
  pixelOverlaySel,
  polyLassoHover,
  polyLassoSession,
  previewAdvancedRuler,
  previewIsometricOrigin,
  previewPerspectiveEyeLevelY,
  previewSharedGutterDrag,
  previewVanishingPointById,
  puppetWarpArmed,
  puppetWarpBusy,
  puppetWarpPins,
  quickMaskArmed,
  quickMaskBrushMode,
  quickMaskDragPreview,
  quickMaskRadius,
  quickMaskTintCanvas,
  quickMaskTintColor,
  quickMaskTintOpacity,
  saving,
  selected,
  setPuppetWarpPins,
  setSymmetryCenterX,
  setSymmetryCenterY,
  setUserGuides,
  sharedGutters,
  singleObjectDragLayerRef,
  smartGuides,
  smudgeArmed,
  smudgeCursorRef,
  smudgeRadius,
  strokeGuideRef,
  strokeWidth,
  symmetryCenterX,
  symmetryCenterY,
  symmetryRadialCount,
  symmetryType,
  tipAngle,
  tipRoundness,
  tool,
  userGuides,
  vanishingPoints,
  wetMixArmed,
  wetMixRadius,
  setPerspectiveEyeLevelY,
}: StudioCanvasViewportToolLayersProps) {
  return (
    <>
            {/* A selected coordinate object is lifted here only while it is being dragged. Konva
                then repaints this tiny layer per pointer frame instead of rasterizing every
                committed stroke/image in the document layer. Composite-sensitive and grouped
                objects deliberately stay on the authoritative main layer. */}
            <Layer
              ref={singleObjectDragLayerRef}
              name="studio-single-object-drag-layer"
            >
              <StudioLiveTransformDraftNode
                store={liveTransformDraftStore}
                scope={liveTransformDraftScope}
                paperSurface={paperSurfaceForLiveTransform}
              />
            </Layer>
            {/* 라이브 프리핸드 초안은 전용 레이어에서만 다시 그린다: 포인터 프레임마다 메인
                레이어의 모든 커밋 요소(세그먼트 압력 획·수채 dab 등)를 재래스터하지 않는다.
                일반 획은 source-over 단일 노드라 별도 캔버스에서 합성해도 시각 결과가 같다.
                지우개(destination-out)만 위의 메인 레이어 경로를 쓴다.
                다이렉트 모드(펜/마커/지우개)는 임페러티브 sceneFunc 이 ref 에서 직접 그리므로
                포인터 프레임에 React 렌더가 없고, 그 외 브러시는 기존 선언적 경로를 유지한다. */}
            {tool === "draw" && (
              <Layer ref={liveDraftLayerRef} listening={false}>
                <Shape
                  sceneFunc={(context) => {
                    const el = liveDraftVisualRef.current;
                    if (
                      !el
                      || !liveDraftDirectRef.current
                      || el.mode === "eraser"
                      || liveRetainedMediaOverlayRenderer.isActive
                      || liveDynamicBrushOverlayRenderer.isActive
                      || (
                        (
                          gpuLiveInkPinnedRef.current
                          && !gpuCanvasShadowVisibleRef.current
                        )
                        || livingInkOverlayVisibleRef.current
                        || liveInkOverlayRendererRef.current.isActive
                        || liveStampOverlayRenderer.isActive
                        || liveWetInkOverlayRenderer.isActive
                      )
                    ) {
                      return;
                    }
                    drawLiveFreehandDraftToContext(context, el);
                  }}
                  listening={false}
                  perfectDrawEnabled={false}
                />
              </Layer>
            )}
            {/* 비다이렉트 초안(팬시 브러시·도형·입자) — 스토어 구독 격리 레이어. 포인터
                프레임은 이 서브트리만 다시 렌더한다. */}
            <StudioDraftPreviewLayers
              store={draftPreviewStore}
              dynamicLayerRef={draftPreviewDynamicLayerRef}
              normalLayerRef={draftPreviewNormalLayerRef}
            />
            {/* 브러시 렌더 종류와 실제 범위를 반영하는 고대비 포인터. */}
            {!isExporting
              && !canvasInteractionBlocked
              && !isSpacePressed
              && !isPanning
              && tool === "draw"
              && isStudioBrushCursorMode(drawMode)
              && (
                brushCursorStyle !== "none"
                || (appSettings.general.showStrokeGuide && stabilizer > 0)
              ) ? (
                <StudioBrushCursor
                  cursorRef={brushCursorRef}
                  guideRef={
                    appSettings.general.showStrokeGuide
                      ? strokeGuideRef
                      : undefined
                  }
                  brushId={drawMode === "eraser" && !eraserPresetActive ? "eraser" : brush}
                  diameter={
                    drawMode === "pen" || lowDensityEraserActive
                      ? studioBrushAliasEffectiveDiameter(brush, strokeWidth)
                      : strokeWidth
                  }
                  effectiveScale={effScale}
                  mode={drawMode}
                  style={brushCursorStyle}
                  tipAngleDeg={tipAngle}
                  tipRoundness={tipRoundness}
                />
              ) : null}
            {!isExporting && (smudgeArmed || liquifyArmed || dodgeBurnArmed || wetMixArmed) && (
              <Layer listening={false}>
                {liquifyArmed ? (
                  <KImage
                    ref={liquifyPreviewImageRef}
                    // Filled imperatively during drag; ImageConfig requires an image key.
                    image={undefined as unknown as HTMLCanvasElement}
                    visible={false}
                    listening={false}
                    opacity={0.92}
                  />
                ) : null}
                <Line
                  ref={paintRetouchStrokeLineRef}
                  visible={false}
                  stroke={
                    wetMixArmed
                      ? "rgba(45, 212, 191, 0.42)"
                      : dodgeBurnArmed
                        ? "rgba(234, 179, 8, 0.42)"
                        : liquifyArmed
                          ? "rgba(251, 146, 60, 0.42)"
                          : "rgba(124, 92, 255, 0.42)"
                  }
                  lineCap="round"
                  lineJoin="round"
                  listening={false}
                />
                <KCircle
                  ref={smudgeCursorRef}
                  visible={false}
                  radius={Math.max(1.5, wetMixArmed ? wetMixRadius : dodgeBurnArmed ? dodgeBurnRadius : liquifyArmed ? liquifyRadius : smudgeRadius)}
                  stroke={wetMixArmed ? "#2dd4bf" : dodgeBurnArmed ? "#eab308" : liquifyArmed ? "#fb923c" : "#7c5cff"}
                  strokeWidth={1.25 / effScale}
                  dash={[3 / effScale, 3 / effScale]}
                  opacity={0.9}
                />
              </Layer>
            )}
            {!isExporting && (layerMaskPaintArmed || quickMaskArmed) && (
              <Layer listening={false}>
                <KCircle
                  ref={layerMaskCursorRef}
                  visible={false}
                  radius={Math.max(1.5, quickMaskArmed ? quickMaskRadius : layerMaskRadius)}
                  stroke="#eab308"
                  strokeWidth={1.25 / effScale}
                  dash={[3 / effScale, 3 / effScale]}
                  opacity={0.9}
                />
              </Layer>
            )}
            {!isExporting && filterMaskPaintArmed && (
              <Layer listening={false}>
                <KCircle
                  ref={filterMaskCursorRef}
                  visible={false}
                  radius={Math.max(1.5, filterMaskRadius)}
                  stroke="#8b5cf6"
                  strokeWidth={1.25 / effScale}
                  dash={[3 / effScale, 3 / effScale]}
                  opacity={0.9}
                />
              </Layer>
            )}
            {/* healCloneArmed 는 tool 과 무관하게 참일 수 있어(select 모드에서도 무장 가능) 기존
                brushCursorRef Layer(tool==="draw" 로 게이팅됨)에 얹으면 select 모드에서 커서가
                아예 안 그려진다 — smudge 커서와 동일하게 독립 게이팅 Layer로 둔다. */}
            {!isExporting && healCloneArmed && (
              <Layer listening={false}>
                <KCircle
                  ref={healCloneCursorRef}
                  visible={false}
                  stroke={healCloneTool === "heal" ? "#22c55e" : "#38bdf8"}
                  strokeWidth={1.5 / effScale}
                  dash={[3 / effScale, 2 / effScale]}
                />
                <KCircle ref={healCloneSourceCursorRef} visible={false} radius={5 / effScale} stroke="#f59e0b" strokeWidth={1.5 / effScale} />
              </Layer>
            )}
            {!isExporting && historyBrushArmed && (
              <Layer listening={false}>
                <KCircle
                  ref={historyBrushCursorRef}
                  visible={false}
                  radius={Math.max(1.5, historyBrushRadius)}
                  stroke="#ec4899"
                  strokeWidth={1.5 / effScale}
                  dash={[3 / effScale, 2 / effScale]}
                />
              </Layer>
            )}
            {/* 마퀴 프리뷰 — 상시 마운트 임페러티브 Rect(드래그 프레임당 페이지 렌더 없음). */}
            {!isExporting && tool === "select" && (
              <Layer listening={false}>
                <Rect
                  ref={marqueeRectNodeRef}
                  visible={false}
                  fill="rgba(90,140,255,0.12)"
                  stroke="rgba(90,140,255,0.85)"
                  strokeWidth={1 / effScale}
                  dash={[4 / effScale, 4 / effScale]}
                />
              </Layer>
            )}
            <StudioCanvasInteractiveOverlays
              isExporting={isExporting}
              quickMaskArmed={quickMaskArmed}
              pixelOverlayFrame={pixelOverlayFrame}
              pixelOverlaySel={pixelOverlaySel}
              pixelDragPreview={pixelDragPreview}
              polyLassoSession={polyLassoSession}
              polyLassoHover={polyLassoHover}
              effScale={effScale}
              cropRect={cropRect}
              panelSplitPreview={panelSplitPreview}
              panelGutter={panelGutter}
              nodeEditArmed={nodeEditArmed}
              selected={selected}
              nodeEditHandles={nodeEditHandles}
              nodeEditTool={nodeEditTool}
              nodeEditDraft={nodeEditDraft}
              nodeEditActiveHandleIndex={nodeEditActiveHandleIndex}
              bubbleShapeArmed={bubbleShapeArmed}
              bubbleShapeHandles={bubbleShapeHandles}
              bubbleShapeActiveHandleIndex={bubbleShapeActiveHandleIndex}
              healCloneArmed={healCloneArmed}
              healCloneSourceAnchor={healCloneSourceAnchor}
              healCloneDragPreview={healCloneDragPreview}
              healCloneRadius={healCloneRadius}
              healCloneTool={healCloneTool}
              historyBrushArmed={historyBrushArmed}
              historyBrushDragPreview={historyBrushDragPreview}
              historyBrushRadius={historyBrushRadius}
              puppetWarpArmed={puppetWarpArmed}
              puppetWarpPins={puppetWarpPins}
              puppetWarpBusy={puppetWarpBusy}
              setPuppetWarpPins={setPuppetWarpPins}
              layerMaskPaintArmed={layerMaskPaintArmed}
              layerMaskDragPreview={layerMaskDragPreview}
              layerMaskRadius={layerMaskRadius}
              layerMaskPaintMode={layerMaskPaintMode}
              filterMaskPaintArmed={filterMaskPaintArmed}
              filterMaskDragPreview={filterMaskDragPreview}
              filterMaskRadius={filterMaskRadius}
              filterMaskPaintMode={filterMaskPaintMode}
              quickMaskTintCanvas={quickMaskTintCanvas}
              quickMaskDragPreview={quickMaskDragPreview}
              quickMaskRadius={quickMaskRadius}
              quickMaskBrushMode={quickMaskBrushMode}
              quickMaskTintColor={quickMaskTintColor}
              quickMaskTintOpacity={quickMaskTintOpacity}
            />
            <StudioCanvasGuideOverlayLayers
              isExporting={isExporting}
              drawingMode={tool === "draw"}
              canvasWidth={CANVAS_W}
              canvasHeight={canvasH}
              effScale={effScale}
              guides={guides}
              smartGuides={smartGuides}
              userGuides={userGuides}
              setUserGuides={setUserGuides}
              symmetryType={symmetryType}
              symmetryCenterX={symmetryCenterX}
              symmetryCenterY={symmetryCenterY}
              symmetryRadialCount={symmetryRadialCount}
              setSymmetryCenterX={setSymmetryCenterX}
              setSymmetryCenterY={setSymmetryCenterY}
              perspectiveRulerActive={perspectiveRulerActive}
              vanishingPoints={vanishingPoints}
              perspectiveEyeLevelY={perspectiveEyeLevelY}
              perspectiveLockHorizon={perspectiveLockHorizon}
              onPreviewVanishingPoint={previewVanishingPointById}
              onCommitVanishingPoint={moveVanishingPointById}
              onPreviewPerspectiveEyeLevelY={previewPerspectiveEyeLevelY}
              onCommitPerspectiveEyeLevelY={setPerspectiveEyeLevelY}
              isometricGridActive={isometricGridActive}
              isometricConfig={{
                angleDeg: isometricAngleDeg,
                cellSize: isometricCellSize,
                originX: isometricOriginX,
                originY: isometricOriginY,
              }}
              onPreviewIsometricOrigin={previewIsometricOrigin}
              onCommitIsometricOrigin={commitIsometricOrigin}
              advancedRulers={advancedRulers}
              onPreviewAdvancedRuler={previewAdvancedRuler}
              onCommitAdvancedRuler={patchAdvancedRuler}
              drawingAssistDisabled={activeSurfaceReviewLocked || saving || masterEditMode}
              onCancelDrawingAssistPreview={cancelStudioDrawingAssistPreview}
              sharedGutters={sharedGutters}
              onBeginSharedGutterDrag={beginSharedGutterDrag}
              onPreviewSharedGutterDrag={previewSharedGutterDrag}
              onCommitSharedGutterDrag={commitSharedGutterDrag}
            />
    </>
  );
}
