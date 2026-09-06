import { useEffect, useRef, useState } from "react";

import type { CropAspectId, CropDragSession, CropRect } from "../studio-crop";
import type { PanelSplitLine, PanelSplitPreview } from "../studio-panel-split";
import type { PuppetPin } from "../studio-puppet-warp";
import type { SelectionFrame } from "../studio-selection-tools";

export interface UseStudioCropPanelSplitToolsOptions {
  readonly selectedId: string | null;
}

export function useStudioCropPanelSplitTools({
  selectedId,
}: UseStudioCropPanelSplitToolsOptions) {
  // ── 이미지 크롭 도구 — studio-crop 통합 상태 ──
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const cropAutoTargetRef = useRef<string | null>(null);
  const [puppetWarpActive, setPuppetWarpActive] = useState(false);
  const [puppetWarpPins, setPuppetWarpPins] = useState<PuppetPin[]>([]);
  const [puppetWarpBusy, setPuppetWarpBusy] = useState(false);
  const [cropAspect, setCropAspect] = useState<CropAspectId>("free");
  const [cropBusy, setCropBusy] = useState(false);
  const cropDragRef = useRef<{ elId: string; frame: SelectionFrame; session: CropDragSession } | null>(null);
  const cropRafRef = useRef<number | null>(null);
  const pendingCropRectRef = useRef<CropRect | null>(null);

  const scheduleCropRect = (next: CropRect) => {
    pendingCropRectRef.current = next;
    if (cropRafRef.current !== null) return;
    cropRafRef.current = globalThis.requestAnimationFrame(() => {
      cropRafRef.current = null;
      if (pendingCropRectRef.current) setCropRect(pendingCropRectRef.current);
    });
  };

  const flushCropRect = () => {
    if (cropRafRef.current !== null) {
      globalThis.cancelAnimationFrame(cropRafRef.current);
      cropRafRef.current = null;
    }
    if (pendingCropRectRef.current) {
      setCropRect(pendingCropRectRef.current);
      pendingCropRectRef.current = null;
    }
  };

  useEffect(
    () => () => {
      if (cropRafRef.current !== null) globalThis.cancelAnimationFrame(cropRafRef.current);
    },
    []
  );

  // ── 패널 손그림 컷(임의 각도 절단선) — studio-panel-split 통합 상태 ──
  const [panelSplitActive, setPanelSplitActive] = useState(false);
  const [panelSplitHint, setPanelSplitHint] = useState<string | null>(null);
  const [panelSplitPreview, setPanelSplitPreview] = useState<PanelSplitPreview | null>(null);
  const panelSplitDragRef = useRef<{ targetFrameId: string; start: { x: number; y: number } } | null>(null);
  const panelSplitLastLineRef = useRef<PanelSplitLine | null>(null);
  const panelSplitRafRef = useRef<number | null>(null);
  const pendingPanelSplitPreviewRef = useRef<PanelSplitPreview | null>(null);

  const schedulePanelSplitPreview = (next: PanelSplitPreview | null) => {
    pendingPanelSplitPreviewRef.current = next;
    if (panelSplitRafRef.current !== null) return;
    panelSplitRafRef.current = globalThis.requestAnimationFrame(() => {
      panelSplitRafRef.current = null;
      setPanelSplitPreview(pendingPanelSplitPreviewRef.current);
    });
  };

  const flushPanelSplitPreview = () => {
    if (panelSplitRafRef.current !== null) {
      globalThis.cancelAnimationFrame(panelSplitRafRef.current);
      panelSplitRafRef.current = null;
    }
    setPanelSplitPreview(pendingPanelSplitPreviewRef.current);
  };

  useEffect(
    () => () => {
      if (panelSplitRafRef.current !== null) globalThis.cancelAnimationFrame(panelSplitRafRef.current);
    },
    []
  );

  // ── 선택 요소 변경 시 크롭 모드·드래그·busy 해제 ──
  useEffect(() => {
    const keepAutoTargetCrop = cropAutoTargetRef.current === selectedId;
    cropAutoTargetRef.current = null;
    cropDragRef.current = null;
    pendingCropRectRef.current = null;
    if (cropRafRef.current !== null) {
      globalThis.cancelAnimationFrame(cropRafRef.current);
      cropRafRef.current = null;
    }
    if (!keepAutoTargetCrop) setCropRect(null);
    setCropBusy(false);
  }, [selectedId]);

  return {
    // crop
    cropRect, setCropRect,
    cropAutoTargetRef,
    puppetWarpActive, setPuppetWarpActive,
    puppetWarpPins, setPuppetWarpPins,
    puppetWarpBusy, setPuppetWarpBusy,
    cropAspect, setCropAspect,
    cropBusy, setCropBusy,
    cropDragRef, cropRafRef, pendingCropRectRef,
    scheduleCropRect, flushCropRect,
    // panel split
    panelSplitActive, setPanelSplitActive,
    panelSplitHint, setPanelSplitHint,
    panelSplitPreview, setPanelSplitPreview,
    panelSplitDragRef, panelSplitLastLineRef,
    panelSplitRafRef, pendingPanelSplitPreviewRef,
    schedulePanelSplitPreview, flushPanelSplitPreview,
  };
}
