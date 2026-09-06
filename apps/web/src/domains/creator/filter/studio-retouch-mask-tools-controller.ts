import { useEffect, useRef, useState } from "react";


import {
  LAYER_MASK_BRUSH_HARDNESS_DEFAULT,
  LAYER_MASK_BRUSH_RADIUS_DEFAULT,
  LAYER_MASK_BRUSH_STRENGTH_DEFAULT,
  type LayerMaskPaintMode,
} from "../layer/studio-layer-mask";
import {
  HEAL_CLONE_HARDNESS_DEFAULT,
  HEAL_CLONE_OPACITY_DEFAULT,
  HEAL_CLONE_RADIUS_DEFAULT,
  type HealCloneMode,
} from "../studio-heal-clone";
import {
  HISTORY_BRUSH_HARDNESS_DEFAULT,
  HISTORY_BRUSH_OPACITY_DEFAULT,
  HISTORY_BRUSH_RADIUS_DEFAULT,
} from "../studio-history-brush";
import {
  QUICK_MASK_BRUSH_HARDNESS_DEFAULT,
  QUICK_MASK_BRUSH_OPACITY_DEFAULT,
  QUICK_MASK_BRUSH_RADIUS_DEFAULT,
  QUICK_MASK_TINT_COLOR_DEFAULT,
  QUICK_MASK_TINT_OPACITY_DEFAULT,
  type QuickMaskBrushMode,
} from "../studio-quick-mask";
import { useStudioRafPreview } from "../studio-raf-preview";

import {
  FILTER_MASK_BRUSH_HARDNESS_DEFAULT,
  FILTER_MASK_BRUSH_RADIUS_DEFAULT,
  FILTER_MASK_BRUSH_STRENGTH_DEFAULT,
  type FilterMaskPaintMode,
} from "./studio-filter-mask";

import type { SelPoint, SelectionFrame } from "../studio-selection-tools";
import type Konva from "konva";

export interface UseStudioRetouchMaskToolsOptions {
  readonly selectedId: string | null;
  readonly pagesHistoryLength: number;
}

export function useStudioRetouchMaskTools({
  selectedId,
  pagesHistoryLength,
}: UseStudioRetouchMaskToolsOptions) {
  // ── heal/clone ──
  const [healCloneTool, setHealCloneTool] = useState<HealCloneMode | null>(null);
  const [healCloneRadius, setHealCloneRadius] = useState(HEAL_CLONE_RADIUS_DEFAULT);
  const [healCloneHardness, setHealCloneHardness] = useState(HEAL_CLONE_HARDNESS_DEFAULT);
  const [healCloneOpacity, setHealCloneOpacity] = useState(HEAL_CLONE_OPACITY_DEFAULT);
  const [healCloneAligned, setHealCloneAligned] = useState(true);
  const [healCloneSourceAnchor, setHealCloneSourceAnchor] = useState<SelPoint | null>(null);
  const [healCloneBusy, setHealCloneBusy] = useState(false);
  const healCloneAbortRef = useRef<AbortController | null>(null);
  const healCloneOffsetRef = useRef<SelPoint | null>(null);

  function clearHealCloneSource() {
    setHealCloneSourceAnchor(null);
    healCloneOffsetRef.current = null;
  }

  const healCloneDragRef = useRef<{
    elId: string;
    frame: SelectionFrame;
    offset: SelPoint;
    radiusNorm: number;
    points: SelPoint[];
  } | null>(null);
  const healClonePreviewLineRef = useRef<Konva.Line>(null);
  const healCloneRafRef = useRef<number | null>(null);
  const pendingHealCloneDragRef = useRef<{
    frame: SelectionFrame;
    radiusNorm: number;
    points: SelPoint[];
  } | null>(null);
  const [healCloneDragPreview, setHealCloneDragPreview] = useState<{
    points: SelPoint[];
    lineRef: import("react").RefObject<Konva.Line | null>;
  } | null>(null);
  const healCloneCursorRef = useRef<Konva.Circle>(null);
  const healCloneSourceCursorRef = useRef<Konva.Circle>(null);

  const scheduleHealCloneDragPreview = (session: {
    frame: SelectionFrame;
    radiusNorm: number;
    points: SelPoint[];
  }) => {
    pendingHealCloneDragRef.current = session;
    if (healCloneRafRef.current !== null) return;
    healCloneRafRef.current = globalThis.requestAnimationFrame(() => {
      healCloneRafRef.current = null;
      const pending = pendingHealCloneDragRef.current;
      const line = healClonePreviewLineRef.current;
      if (!pending || !line) return;
      const tailStart = Math.max(0, pending.points.length - 64);
      const flat: number[] = [];
      for (let index = tailStart; index < pending.points.length; index += 1) {
        const point = pending.points[index]!;
        flat.push(point.x * pending.frame.width, point.y * pending.frame.height);
      }
      if (flat.length === 2) flat.push(flat[0]!, flat[1]!);
      line.points(flat);
      line.strokeWidth(2 * pending.radiusNorm * pending.frame.width);
      line.visible(flat.length > 0);
      line.getLayer()?.batchDraw();
    });
  };

  const clearHealCloneDragPreview = () => {
    pendingHealCloneDragRef.current = null;
    if (healCloneRafRef.current !== null) {
      globalThis.cancelAnimationFrame(healCloneRafRef.current);
      healCloneRafRef.current = null;
    }
    const line = healClonePreviewLineRef.current;
    if (line) {
      line.points([]);
      line.visible(false);
      line.getLayer()?.batchDraw();
    }
    setHealCloneDragPreview(null);
  };

  useEffect(() => () => {
    if (healCloneRafRef.current !== null) globalThis.cancelAnimationFrame(healCloneRafRef.current);
    healCloneAbortRef.current?.abort();
    healCloneAbortRef.current = null;
  }, []);

  useEffect(() => {
    void selectedId;
    healCloneAbortRef.current?.abort();
    healCloneAbortRef.current = null;
    healCloneDragRef.current = null;
    clearHealCloneDragPreview();
    setHealCloneSourceAnchor(null);
    healCloneOffsetRef.current = null;
    setHealCloneBusy(false);
  }, [selectedId]);

  // ── history brush ──
  const [historyBrushActive, setHistoryBrushActive] = useState(false);
  const [historyBrushRadius, setHistoryBrushRadius] = useState(HISTORY_BRUSH_RADIUS_DEFAULT);
  const [historyBrushHardness, setHistoryBrushHardness] = useState(HISTORY_BRUSH_HARDNESS_DEFAULT);
  const [historyBrushOpacity, setHistoryBrushOpacity] = useState(HISTORY_BRUSH_OPACITY_DEFAULT);
  const [historyBrushSourceIndex, setHistoryBrushSourceIndex] = useState<number | null>(null);
  const [historyBrushSourceSrc, setHistoryBrushSourceSrc] = useState<string | null>(null);
  const [historyBrushBusy, setHistoryBrushBusy] = useState(false);
  const historyBrushDragRef = useRef<{
    elId: string;
    frame: SelectionFrame;
    radiusNorm: number;
    points: SelPoint[];
  } | null>(null);
  const {
    preview: historyBrushDragPreview,
    schedule: scheduleHistoryBrushDragPreview,
    clear: clearHistoryBrushDragPreview,
  } = useStudioRafPreview<{ points: SelPoint[] }>();
  const historyBrushCursorRef = useRef<Konva.Circle>(null);

  useEffect(() => {
    void selectedId;
    historyBrushDragRef.current = null;
    clearHistoryBrushDragPreview();
    setHistoryBrushSourceIndex(null);
    setHistoryBrushSourceSrc(null);
    setHistoryBrushBusy(false);
  }, [selectedId, clearHistoryBrushDragPreview]);

  useEffect(() => {
    if (historyBrushSourceIndex !== null && historyBrushSourceIndex >= pagesHistoryLength) {
      setHistoryBrushSourceIndex(null);
    }
  }, [pagesHistoryLength, historyBrushSourceIndex]);

  // ── layer mask ──
  const [layerMaskPaintActive, setLayerMaskPaintActive] = useState(false);
  const [layerMaskPaintMode, setLayerMaskPaintMode] = useState<LayerMaskPaintMode>("reveal");
  const [layerMaskRadius, setLayerMaskRadius] = useState(LAYER_MASK_BRUSH_RADIUS_DEFAULT);
  const [layerMaskHardness, setLayerMaskHardness] = useState(LAYER_MASK_BRUSH_HARDNESS_DEFAULT);
  const [layerMaskStrength, setLayerMaskStrength] = useState(LAYER_MASK_BRUSH_STRENGTH_DEFAULT);
  const [layerMaskBusy, setLayerMaskBusy] = useState(false);
  const layerMaskDragRef = useRef<{ elId: string; frame: SelectionFrame; points: SelPoint[] } | null>(null);
  const {
    preview: layerMaskDragPreview,
    schedule: scheduleLayerMaskDragPreview,
    clear: clearLayerMaskDragPreview,
  } = useStudioRafPreview<{ points: SelPoint[] }>();
  const layerMaskCursorRef = useRef<Konva.Circle>(null);

  useEffect(() => {
    void selectedId;
    layerMaskDragRef.current = null;
    clearLayerMaskDragPreview();
    setLayerMaskBusy(false);
  }, [selectedId, clearLayerMaskDragPreview]);

  // ── filter mask ──
  const [filterMaskPaintActive, setFilterMaskPaintActive] = useState(false);
  const [filterMaskPaintMode, setFilterMaskPaintMode] = useState<FilterMaskPaintMode>("reveal");
  const [filterMaskRadius, setFilterMaskRadius] = useState(FILTER_MASK_BRUSH_RADIUS_DEFAULT);
  const [filterMaskHardness, setFilterMaskHardness] = useState(FILTER_MASK_BRUSH_HARDNESS_DEFAULT);
  const [filterMaskStrength, setFilterMaskStrength] = useState(FILTER_MASK_BRUSH_STRENGTH_DEFAULT);
  const [filterMaskBusy, setFilterMaskBusy] = useState(false);
  const filterMaskDragRef = useRef<{ elId: string; frame: SelectionFrame; points: SelPoint[] } | null>(null);
  const {
    preview: filterMaskDragPreview,
    schedule: scheduleFilterMaskDragPreview,
    clear: clearFilterMaskDragPreview,
  } = useStudioRafPreview<{ points: SelPoint[] }>();
  const filterMaskCursorRef = useRef<Konva.Circle>(null);

  useEffect(() => {
    void selectedId;
    filterMaskDragRef.current = null;
    clearFilterMaskDragPreview();
    setFilterMaskBusy(false);
  }, [selectedId, clearFilterMaskDragPreview]);

  // ── quick mask ──
  const [quickMaskActive, setQuickMaskActive] = useState(false);
  const [quickMaskBrushMode, setQuickMaskBrushMode] = useState<QuickMaskBrushMode>("paint");
  const [quickMaskRadius, setQuickMaskRadius] = useState(QUICK_MASK_BRUSH_RADIUS_DEFAULT);
  const [quickMaskHardness, setQuickMaskHardness] = useState(QUICK_MASK_BRUSH_HARDNESS_DEFAULT);
  const [quickMaskOpacity, setQuickMaskOpacity] = useState(QUICK_MASK_BRUSH_OPACITY_DEFAULT);
  const [quickMaskTintColor, setQuickMaskTintColor] = useState(QUICK_MASK_TINT_COLOR_DEFAULT);
  const [quickMaskTintOpacity, setQuickMaskTintOpacity] = useState(QUICK_MASK_TINT_OPACITY_DEFAULT);
  const quickMaskSessionRef = useRef<{
    elId: string; maskW: number; maskH: number; featherScale: number; mask: Uint8ClampedArray;
  } | null>(null);
  const quickMaskDragRef = useRef<{ elId: string; frame: SelectionFrame; points: SelPoint[] } | null>(null);
  const {
    preview: quickMaskDragPreview,
    schedule: scheduleQuickMaskDragPreview,
    clear: clearQuickMaskDragPreview,
  } = useStudioRafPreview<{ points: SelPoint[] }>();
  const [quickMaskTintCanvas, setQuickMaskTintCanvas] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const session = quickMaskSessionRef.current;
    if (session && selectedId !== session.elId) {
      quickMaskSessionRef.current = null;
      quickMaskDragRef.current = null;
      clearQuickMaskDragPreview();
      setQuickMaskTintCanvas(null);
      setQuickMaskActive(false);
    }
  }, [selectedId, clearQuickMaskDragPreview]);

  return {
    // heal/clone
    healCloneTool, setHealCloneTool,
    healCloneRadius, setHealCloneRadius,
    healCloneHardness, setHealCloneHardness,
    healCloneOpacity, setHealCloneOpacity,
    healCloneAligned, setHealCloneAligned,
    healCloneSourceAnchor, setHealCloneSourceAnchor,
    healCloneBusy, setHealCloneBusy,
    healCloneAbortRef, healCloneOffsetRef,
    clearHealCloneSource,
    healCloneDragRef, healClonePreviewLineRef,
    healCloneRafRef, pendingHealCloneDragRef,
    healCloneDragPreview, setHealCloneDragPreview,
    healCloneCursorRef, healCloneSourceCursorRef,
    scheduleHealCloneDragPreview, clearHealCloneDragPreview,
    // history brush
    historyBrushActive, setHistoryBrushActive,
    historyBrushRadius, setHistoryBrushRadius,
    historyBrushHardness, setHistoryBrushHardness,
    historyBrushOpacity, setHistoryBrushOpacity,
    historyBrushSourceIndex, setHistoryBrushSourceIndex,
    historyBrushSourceSrc, setHistoryBrushSourceSrc,
    historyBrushBusy, setHistoryBrushBusy,
    historyBrushDragRef,
    historyBrushDragPreview, scheduleHistoryBrushDragPreview, clearHistoryBrushDragPreview,
    historyBrushCursorRef,
    // layer mask
    layerMaskPaintActive, setLayerMaskPaintActive,
    layerMaskPaintMode, setLayerMaskPaintMode,
    layerMaskRadius, setLayerMaskRadius,
    layerMaskHardness, setLayerMaskHardness,
    layerMaskStrength, setLayerMaskStrength,
    layerMaskBusy, setLayerMaskBusy,
    layerMaskDragRef,
    layerMaskDragPreview, scheduleLayerMaskDragPreview, clearLayerMaskDragPreview,
    layerMaskCursorRef,
    // filter mask
    filterMaskPaintActive, setFilterMaskPaintActive,
    filterMaskPaintMode, setFilterMaskPaintMode,
    filterMaskRadius, setFilterMaskRadius,
    filterMaskHardness, setFilterMaskHardness,
    filterMaskStrength, setFilterMaskStrength,
    filterMaskBusy, setFilterMaskBusy,
    filterMaskDragRef,
    filterMaskDragPreview, scheduleFilterMaskDragPreview, clearFilterMaskDragPreview,
    filterMaskCursorRef,
    // quick mask
    quickMaskActive, setQuickMaskActive,
    quickMaskBrushMode, setQuickMaskBrushMode,
    quickMaskRadius, setQuickMaskRadius,
    quickMaskHardness, setQuickMaskHardness,
    quickMaskOpacity, setQuickMaskOpacity,
    quickMaskTintColor, setQuickMaskTintColor,
    quickMaskTintOpacity, setQuickMaskTintOpacity,
    quickMaskSessionRef, quickMaskDragRef,
    quickMaskDragPreview, scheduleQuickMaskDragPreview, clearQuickMaskDragPreview,
    quickMaskTintCanvas, setQuickMaskTintCanvas,
  };
}
