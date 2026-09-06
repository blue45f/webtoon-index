import { useCallback, useEffect, useRef, useState } from "react";

import { NODE_SMOOTH_DEFAULT_STRENGTH } from "../studio-curve-smoothing";

import type {
  NodeDragSession,
  NodeEditTool,
} from "../studio-node-edit";

export type BubbleShapePointerCaptureTarget = {
  releasePointerCapture?: (pointerId: number) => void;
};

export interface UseStudioVectorNodeBubbleEditOptions {
  readonly selectedId: string | null;
}

export function useStudioVectorNodeBubbleEdit({
  selectedId,
}: UseStudioVectorNodeBubbleEditOptions) {
  // ── 벡터 노드 편집(자유선 점 이동·굵기) ──
  const [nodeEditTool, setNodeEditTool] = useState<NodeEditTool | null>(null);
  const nodeEditDragRef = useRef<{ elId: string; session: NodeDragSession } | null>(null);
  const nodeEditRafRef = useRef<number | null>(null);
  const pendingNodeEditDraftRef = useRef<{ elId: string; points: number[]; pressures: number[] } | null>(null);
  const [nodeEditDraft, setNodeEditDraft] = useState<{ elId: string; points: number[]; pressures: number[] } | null>(null);

  const scheduleNodeEditDraft = (next: { elId: string; points: number[]; pressures: number[] }) => {
    pendingNodeEditDraftRef.current = next;
    if (nodeEditRafRef.current !== null) return;
    nodeEditRafRef.current = globalThis.requestAnimationFrame(() => {
      nodeEditRafRef.current = null;
      if (pendingNodeEditDraftRef.current) setNodeEditDraft(pendingNodeEditDraftRef.current);
    });
  };

  useEffect(() => () => {
    if (nodeEditRafRef.current !== null) globalThis.cancelAnimationFrame(nodeEditRafRef.current);
  }, []);

  useEffect(() => {
    void selectedId;
    nodeEditDragRef.current = null;
    pendingNodeEditDraftRef.current = null;
    if (nodeEditRafRef.current !== null) {
      globalThis.cancelAnimationFrame(nodeEditRafRef.current);
      nodeEditRafRef.current = null;
    }
    setNodeEditDraft(null);
    setNodeEditTool(null);
  }, [selectedId]);

  const [nodeSmoothStrength, setNodeSmoothStrength] = useState(NODE_SMOOTH_DEFAULT_STRENGTH);
  const nodeSmoothStrengthAtDragStartRef = useRef(NODE_SMOOTH_DEFAULT_STRENGTH);

  // ── 말풍선 커스텀 모양(폴리곤 점 편집) ──
  const [bubbleShapeEditActive, setBubbleShapeEditActive] = useState(false);
  const [bubbleShapeSelectedPointIndex, setBubbleShapeSelectedPointIndex] = useState<number | null>(null);
  const bubbleShapeDragRef = useRef<{
    captureTarget: BubbleShapePointerCaptureTarget | null;
    elId: string;
    pointerId: number;
    session: NodeDragSession;
  } | null>(null);
  const bubbleShapeRafRef = useRef<number | null>(null);
  const pendingBubbleShapeDraftRef = useRef<{ elId: string; points: number[] } | null>(null);
  const [bubbleShapeDraft, setBubbleShapeDraft] = useState<{ elId: string; points: number[] } | null>(null);

  const releaseBubbleShapePointerCapture = useCallback((
    drag: NonNullable<typeof bubbleShapeDragRef.current> | null = bubbleShapeDragRef.current,
  ) => {
    if (!drag?.captureTarget?.releasePointerCapture) return;
    try {
      drag.captureTarget.releasePointerCapture(drag.pointerId);
    } catch {
      // Browser may release capture before pointercancel/lost-capture cleanup reaches Konva.
    }
  }, []);

  const scheduleBubbleShapeDraft = (next: { elId: string; points: number[] }) => {
    pendingBubbleShapeDraftRef.current = next;
    if (bubbleShapeRafRef.current !== null) return;
    bubbleShapeRafRef.current = globalThis.requestAnimationFrame(() => {
      bubbleShapeRafRef.current = null;
      if (pendingBubbleShapeDraftRef.current) setBubbleShapeDraft(pendingBubbleShapeDraftRef.current);
    });
  };

  useEffect(() => () => {
    if (bubbleShapeRafRef.current !== null) globalThis.cancelAnimationFrame(bubbleShapeRafRef.current);
  }, []);

  useEffect(() => {
    const cancelBubbleShapeDragOutsideStage = (event: PointerEvent) => {
      const drag = bubbleShapeDragRef.current;
      if (!drag) return;
      const pointerId = Number.isFinite(event.pointerId) ? event.pointerId : 1;
      if (drag.pointerId !== pointerId) return;
      releaseBubbleShapePointerCapture(drag);
      bubbleShapeDragRef.current = null;
      pendingBubbleShapeDraftRef.current = null;
      if (bubbleShapeRafRef.current !== null) {
        globalThis.cancelAnimationFrame(bubbleShapeRafRef.current);
        bubbleShapeRafRef.current = null;
      }
      setBubbleShapeDraft(null);
    };
    globalThis.addEventListener("pointerup", cancelBubbleShapeDragOutsideStage);
    globalThis.addEventListener("pointercancel", cancelBubbleShapeDragOutsideStage);
    return () => {
      globalThis.removeEventListener("pointerup", cancelBubbleShapeDragOutsideStage);
      globalThis.removeEventListener("pointercancel", cancelBubbleShapeDragOutsideStage);
    };
  }, [releaseBubbleShapePointerCapture]);

  const resetBubbleShapeSession = useCallback(() => {
    releaseBubbleShapePointerCapture();
    bubbleShapeDragRef.current = null;
    pendingBubbleShapeDraftRef.current = null;
    if (bubbleShapeRafRef.current !== null) {
      globalThis.cancelAnimationFrame(bubbleShapeRafRef.current);
      bubbleShapeRafRef.current = null;
    }
    setBubbleShapeDraft(null);
    setBubbleShapeSelectedPointIndex(null);
  }, [releaseBubbleShapePointerCapture]);

  useEffect(() => {
    void selectedId;
    resetBubbleShapeSession();
    setBubbleShapeEditActive(false);
  }, [selectedId, resetBubbleShapeSession]);

  return {
    nodeEditTool,
    setNodeEditTool,
    nodeEditDragRef,
    nodeEditRafRef,
    pendingNodeEditDraftRef,
    nodeEditDraft,
    setNodeEditDraft,
    scheduleNodeEditDraft,
    nodeSmoothStrength,
    setNodeSmoothStrength,
    nodeSmoothStrengthAtDragStartRef,
    bubbleShapeEditActive,
    setBubbleShapeEditActive,
    bubbleShapeSelectedPointIndex,
    setBubbleShapeSelectedPointIndex,
    bubbleShapeDragRef,
    bubbleShapeRafRef,
    pendingBubbleShapeDraftRef,
    bubbleShapeDraft,
    setBubbleShapeDraft,
    releaseBubbleShapePointerCapture,
    scheduleBubbleShapeDraft,
    resetBubbleShapeSession,
  };
}
