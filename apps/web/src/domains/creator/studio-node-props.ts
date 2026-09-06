/**
 * Studio 캔버스 노드 공통 인터랙션 props.
 * renderEl 의 여러 엘리먼트 브랜치(이미지/프레임/텍스트/스티커/텍스트패스)가 복붙하던
 * 동일한 Konva 노드 props(드래그·선택·드래그종료, 리사이즈 변환)를 한 곳으로 모은다.
 * 반환 객체를 각 노드에 스프레드한다 — 동작은 기존 인라인 핸들러와 바이트 동일.
 * 타입별로 다른 onTransformEnd(텍스트=fontSize, 스티커=fontSize 등)는 추출하지 않고 각 노드에 인라인 유지.
 *
 * Soft-lock: optional onInteractionBegin/End claim live collaboration resources for the gesture.
 */
import type Konva from "konva";

type DragEvt = Konva.KonvaEventObject<DragEvent>;
type XfEvt = Konva.KonvaEventObject<Event>;
type BoundFunc = (pos: Konva.Vector2d) => Konva.Vector2d;

export type StudioNodeInteractionGuards = {
  /** Return false to cancel drag/transform start (e.g. soft-lock deny). */
  onInteractionBegin?: () => boolean;
  onInteractionEnd?: () => void;
};

export function withStudioNodeInteractionGuards(
  base: Record<string, unknown>,
  guards: StudioNodeInteractionGuards | undefined
): Record<string, unknown> {
  if (!guards?.onInteractionBegin && !guards?.onInteractionEnd) return base;
  const { onInteractionBegin, onInteractionEnd } = guards;
  const prevDragEnd = base.onDragEnd as ((e: DragEvt) => void) | undefined;
  const prevXfEnd = base.onTransformEnd as ((e: XfEvt) => void) | undefined;
  return {
    ...base,
    onDragStart: (e: DragEvt) => {
      if (onInteractionBegin && !onInteractionBegin()) {
        e.target.stopDrag();
      }
    },
    onTransformStart: (e: XfEvt) => {
      if (onInteractionBegin && !onInteractionBegin()) {
        // Transformer will not apply if the node rejects interaction; stop any active transform.
        const node = e.target;
        if (typeof (node as Konva.Node & { stopDrag?: () => void }).stopDrag === "function") {
          (node as Konva.Node & { stopDrag: () => void }).stopDrag();
        }
      }
    },
    onDragEnd: (e: DragEvt) => {
      try {
        prevDragEnd?.(e);
      } finally {
        onInteractionEnd?.();
      }
    },
    onTransformEnd: (e: XfEvt) => {
      try {
        prevXfEnd?.(e);
      } finally {
        onInteractionEnd?.();
      }
    },
  };
}

/**
 * 이미지·프레임처럼 width/height 로 리사이즈되는 노드의 공통 props.
 * onTransformEnd 는 scaleX/Y 를 width/height(최소 20)로 굳히고 rotation 반영(기존 로직 동일).
 */
export function resizableNodeProps<T>(opts: {
  draggable: boolean;
  dragBoundFunc?: BoundFunc;
  onSelect: () => void;
  onChange: (patch: T) => void;
  onInteractionBegin?: () => boolean;
  onInteractionEnd?: () => void;
}) {
  const { draggable, dragBoundFunc, onSelect, onChange, onInteractionBegin, onInteractionEnd } = opts;
  const base = {
    draggable,
    dragBoundFunc,
    onMouseDown: onSelect,
    onTap: onSelect,
    onDragEnd: (e: DragEvt) => onChange({ x: e.target.x(), y: e.target.y() } as T),
    onTransformEnd: (e: XfEvt) => {
      const node = e.target;
      const w = Math.max(20, node.width() * node.scaleX());
      const h = Math.max(20, node.height() * node.scaleY());
      node.scaleX(1);
      node.scaleY(1);
      onChange({ x: node.x(), y: node.y(), width: w, height: h, rotation: node.rotation() } as T);
    },
  };
  return withStudioNodeInteractionGuards(base, { onInteractionBegin, onInteractionEnd });
}

/**
 * 텍스트/스티커/텍스트패스 노드의 공통 인터랙션 props(더블클릭 편집 포함).
 * onTransformEnd 는 타입별(fontSize·width 처리)로 달라 각 노드에 인라인으로 둔다.
 */
export function textNodeProps<T>(opts: {
  id: string;
  draggable: boolean;
  dragBoundFunc?: BoundFunc;
  onSelect: () => void;
  onEdit: (id: string) => void;
  onPatch: (id: string, patch: T) => void;
  onInteractionBegin?: () => boolean;
  onInteractionEnd?: () => void;
}) {
  const { id, draggable, dragBoundFunc, onSelect, onEdit, onPatch, onInteractionBegin, onInteractionEnd } = opts;
  const base = {
    draggable,
    dragBoundFunc,
    onMouseDown: onSelect,
    onTap: onSelect,
    onDblClick: () => onEdit(id),
    onDblTap: () => onEdit(id),
    onDragEnd: (e: DragEvt) => onPatch(id, { x: e.target.x(), y: e.target.y() } as T),
  };
  return withStudioNodeInteractionGuards(base, { onInteractionBegin, onInteractionEnd });
}
