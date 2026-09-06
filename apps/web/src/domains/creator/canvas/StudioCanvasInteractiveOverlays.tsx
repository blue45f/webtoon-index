import { Suspense, memo } from "react";
import { Layer } from "react-konva/lib/ReactKonvaCore";

import {
  StudioBubbleShapeOverlay,
  StudioCropOverlay,
  StudioHealCloneOverlay,
  StudioHistoryBrushOverlay,
  StudioLayerMaskOverlay,
  StudioNodeEditOverlay,
  StudioPanelSplitOverlay,
  StudioPuppetWarpOverlay,
  StudioQuickMaskOverlay,
  StudioSelectionAntsOverlay,
} from "../studio-page-lazy-ui";
import { movePuppetPin, type PuppetPin } from "../studio-puppet-warp";

import type { FilterMaskPaintMode } from "../filter/studio-filter-mask";
import type { LayerMaskPaintMode } from "../layer/studio-layer-mask";
import type { CropRect } from "../studio-crop";
import type { DrawEl, El } from "../studio-element-model";
import type { HealCloneMode } from "../studio-heal-clone";
import type { NodeEditHandle, NodeEditTool } from "../studio-node-edit";
import type { PanelSplitPreview } from "../studio-panel-split";
import type { QuickMaskBrushMode } from "../studio-quick-mask";
import type {
  PixelSelection,
  PolyLassoSession,
  SelectionDragState,
  SelectionFrame,
  SelPoint,
} from "../studio-selection-tools";

export interface StudioCanvasInteractiveOverlaysProps {
  isExporting: boolean;
  quickMaskArmed: boolean;
  pixelOverlayFrame: SelectionFrame | null;
  pixelOverlaySel: PixelSelection | null;
  pixelDragPreview: SelectionDragState | null;
  polyLassoSession: PolyLassoSession | null;
  polyLassoHover: SelPoint | null;
  effScale: number;
  cropRect: CropRect | null;
  panelSplitPreview: PanelSplitPreview | null;
  panelGutter: number;
  nodeEditArmed: boolean;
  selected: El | null;
  nodeEditHandles: NodeEditHandle[];
  nodeEditTool: NodeEditTool | null;
  nodeEditDraft: { elId: string; points: number[]; pressures: number[]; } | null;
  nodeEditActiveHandleIndex: number | null;
  bubbleShapeArmed: boolean;
  bubbleShapeHandles: NodeEditHandle[];
  bubbleShapeActiveHandleIndex: number | null;
  healCloneArmed: boolean;
  healCloneSourceAnchor: SelPoint | null;
  healCloneDragPreview: { points: SelPoint[]; } | null;
  healCloneRadius: number;
  healCloneTool: HealCloneMode | null;
  historyBrushArmed: boolean;
  historyBrushDragPreview: { points: SelPoint[]; } | null;
  historyBrushRadius: number;
  puppetWarpArmed: boolean;
  puppetWarpPins: PuppetPin[];
  puppetWarpBusy: boolean;
  setPuppetWarpPins: import("react").Dispatch<import("react").SetStateAction<PuppetPin[]>>;
  layerMaskPaintArmed: boolean;
  layerMaskDragPreview: { points: SelPoint[]; } | null;
  layerMaskRadius: number;
  layerMaskPaintMode: LayerMaskPaintMode;
  filterMaskPaintArmed: boolean;
  filterMaskDragPreview: { points: SelPoint[]; } | null;
  filterMaskRadius: number;
  filterMaskPaintMode: FilterMaskPaintMode;
  quickMaskTintCanvas: HTMLCanvasElement | null;
  quickMaskDragPreview: { points: SelPoint[]; } | null;
  quickMaskRadius: number;
  quickMaskBrushMode: QuickMaskBrushMode;
  quickMaskTintColor: string;
  quickMaskTintOpacity: number;
}

export const StudioCanvasInteractiveOverlays = memo(function StudioCanvasInteractiveOverlays({
  isExporting,
  quickMaskArmed,
  pixelOverlayFrame,
  pixelOverlaySel,
  pixelDragPreview,
  polyLassoSession,
  polyLassoHover,
  effScale,
  cropRect,
  panelSplitPreview,
  panelGutter,
  nodeEditArmed,
  selected,
  nodeEditHandles,
  nodeEditTool,
  nodeEditDraft,
  nodeEditActiveHandleIndex,
  bubbleShapeArmed,
  bubbleShapeHandles,
  bubbleShapeActiveHandleIndex,
  healCloneArmed,
  healCloneSourceAnchor,
  healCloneDragPreview,
  healCloneRadius,
  healCloneTool,
  historyBrushArmed,
  historyBrushDragPreview,
  historyBrushRadius,
  puppetWarpArmed,
  puppetWarpPins,
  puppetWarpBusy,
  setPuppetWarpPins,
  layerMaskPaintArmed,
  layerMaskDragPreview,
  layerMaskRadius,
  layerMaskPaintMode,
  filterMaskPaintArmed,
  filterMaskDragPreview,
  filterMaskRadius,
  filterMaskPaintMode,
  quickMaskTintCanvas,
  quickMaskDragPreview,
  quickMaskRadius,
  quickMaskBrushMode,
  quickMaskTintColor,
  quickMaskTintOpacity,
}: StudioCanvasInteractiveOverlaysProps) {
  if (isExporting) return null;

  return (
    <>
      {/* 픽셀 선택 마칭앤츠 */}
      {!quickMaskArmed &&
        pixelOverlayFrame &&
        (pixelOverlaySel || pixelDragPreview || polyLassoSession) && (
        <Layer listening={false}>
          <Suspense fallback={null}>
            <StudioSelectionAntsOverlay
              selection={pixelOverlaySel}
              drag={pixelDragPreview}
              polyDraft={
                polyLassoSession
                  ? {
                      points: polyLassoSession.points,
                      hover: polyLassoHover,
                      mode: polyLassoSession.mode,
                    }
                  : null
              }
              frame={pixelOverlayFrame}
              scale={effScale}
            />
          </Suspense>
        </Layer>
      )}

      {/* 크롭 오버레이 */}
      {cropRect && pixelOverlayFrame && (
        <Layer listening={false}>
          <Suspense fallback={null}>
            <StudioCropOverlay rect={cropRect} frame={pixelOverlayFrame} scale={effScale} />
          </Suspense>
        </Layer>
      )}

      {/* 패널 손그림 컷 오버레이 */}
      {panelSplitPreview && (
        <Layer listening={false}>
          <Suspense fallback={null}>
            <StudioPanelSplitOverlay preview={panelSplitPreview} gutterPx={panelGutter} scale={effScale} />
          </Suspense>
        </Layer>
      )}

      {/* 벡터 노드 편집 오버레이 */}
      {nodeEditArmed && selected?.type === "draw" && (
        <Layer listening={false}>
          <Suspense fallback={null}>
            <StudioNodeEditOverlay
              handles={nodeEditHandles}
              tool={nodeEditTool!}
              pressures={nodeEditDraft?.elId === selected.id ? nodeEditDraft.pressures : (selected as DrawEl).pressures}
              scale={effScale}
              activeHandleIndex={nodeEditActiveHandleIndex}
            />
          </Suspense>
        </Layer>
      )}

      {/* 말풍선 커스텀 모양 오버레이 */}
      {bubbleShapeArmed && selected?.type === "bubble" && (
        <Layer listening={false}>
          <Suspense fallback={null}>
            <StudioBubbleShapeOverlay
              frame={{ x: selected.x, y: selected.y, rotation: selected.rotation }}
              handles={bubbleShapeHandles}
              scale={effScale}
              activeHandleIndex={bubbleShapeActiveHandleIndex}
            />
          </Suspense>
        </Layer>
      )}

      {healCloneArmed && pixelOverlayFrame && (healCloneSourceAnchor || healCloneDragPreview) && (
        <Layer listening={false}>
          <Suspense fallback={null}>
            <StudioHealCloneOverlay
              frame={pixelOverlayFrame}
              scale={effScale}
              sourceAnchor={healCloneSourceAnchor}
              drag={healCloneDragPreview}
              radiusPx={healCloneRadius}
              mode={healCloneTool ?? "clone"}
            />
          </Suspense>
        </Layer>
      )}

      {historyBrushArmed && pixelOverlayFrame && historyBrushDragPreview && (
        <Layer listening={false}>
          <Suspense fallback={null}>
            <StudioHistoryBrushOverlay
              frame={pixelOverlayFrame}
              drag={historyBrushDragPreview}
              radiusPx={historyBrushRadius}
            />
          </Suspense>
        </Layer>
      )}

      {/* 퍼펫 워프 오버레이 */}
      {puppetWarpArmed && pixelOverlayFrame && (
        <Layer>
          <Suspense fallback={null}>
            <StudioPuppetWarpOverlay
              frame={pixelOverlayFrame}
              scale={effScale}
              pins={puppetWarpPins}
              busy={puppetWarpBusy}
              onMovePin={(id, x, y) => setPuppetWarpPins((pins) => movePuppetPin(pins, id, x, y))}
            />
          </Suspense>
        </Layer>
      )}

      {layerMaskPaintArmed && pixelOverlayFrame && (
        <Layer listening={false}>
          <Suspense fallback={null}>
            <StudioLayerMaskOverlay
              frame={pixelOverlayFrame}
              scale={effScale}
              drag={layerMaskDragPreview}
              radiusPx={layerMaskRadius}
              mode={layerMaskPaintMode}
            />
          </Suspense>
        </Layer>
      )}

      {/* 필터 마스크 페인트 프리뷰 */}
      {filterMaskPaintArmed && pixelOverlayFrame && (
        <Layer listening={false}>
          <Suspense fallback={null}>
            <StudioLayerMaskOverlay
              frame={pixelOverlayFrame}
              scale={effScale}
              drag={filterMaskDragPreview}
              radiusPx={filterMaskRadius}
              mode={filterMaskPaintMode}
            />
          </Suspense>
        </Layer>
      )}

      {quickMaskArmed && pixelOverlayFrame && (
        <Layer listening={false}>
          <Suspense fallback={null}>
            <StudioQuickMaskOverlay
              frame={pixelOverlayFrame}
              scale={effScale}
              tintCanvas={quickMaskTintCanvas}
              drag={quickMaskDragPreview}
              radiusPx={quickMaskRadius}
              mode={quickMaskBrushMode}
              tintColor={quickMaskTintColor}
              tintOpacity={quickMaskTintOpacity}
            />
          </Suspense>
        </Layer>
      )}
    </>
  );
});
