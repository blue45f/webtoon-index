/**
 * Studio Perspective Overlay — 원근자 소실점 핸들 + 부채꼴 안내선(Konva).
 * StudioPage 의 <Stage> 트리 안에서만 동작한다. 모듈 자체는 React.lazy 로 나눌 수 있지만,
 * 렌더 결과는 반드시 같은 react-konva Stage 자식 트리에 남아야 한다(별도 DOM/React 포탈 금지).
 * 드래그 중 좌표만 로컬 미리보기로 소유하고 dragend에서 문서 좌표를 한 번 커밋한다.
 */
import { useRef, useState, type ReactElement } from "react";
import { Circle as KCircle, Group, Line } from "react-konva/lib/ReactKonvaCore";

import {
  defaultPerspectiveEyeLevelY,
  perspectiveFanRays,
  type VanishingPoint,
} from "./studio-perspective-guide";

import type Konva from "konva";

type StudioPerspectiveOverlayBaseProps = {
  points: VanishingPoint[];
  canvasWidth: number;
  canvasHeight: number;
  effScale: number;
  /** Independent horizon line (document px). null = derive a soft default for drawing only. */
  eyeLevelY?: number | null;
  lockHorizon?: boolean;
  disabled?: boolean;
  /** 브라우저가 포인터/터치 드래그를 취소한 경우의 선택적 정리 알림. */
  onCancelPoint?: (id: string) => void;
  onPreviewEyeLevelY?: (y: number) => void;
  onCommitEyeLevelY?: (y: number) => void;
  onCancelEyeLevel?: () => void;
};

type StudioPerspectiveOverlayCommitProps = {
  /** 드래그 중 UI 전용 좌표 알림. 프로젝트 문서/undo history를 갱신하면 안 된다. */
  onPreviewPoint?: (id: string, x: number, y: number) => void;
  /** dragend 한 번에만 호출되는 영속 문서 커밋 경계. */
  onCommitPoint: (id: string, x: number, y: number) => void;
  onMovePoint?: never;
};

type StudioPerspectiveOverlayLegacyProps = {
  /** @deprecated onPreviewPoint/onCommitPoint를 사용한다. */
  onMovePoint: (id: string, x: number, y: number) => void;
  onPreviewPoint?: never;
  onCommitPoint?: never;
};

export type StudioPerspectiveOverlayProps = StudioPerspectiveOverlayBaseProps &
  (StudioPerspectiveOverlayCommitProps | StudioPerspectiveOverlayLegacyProps);

type PointDragPreview = {
  id: string;
  x: number;
  y: number;
};

const VP_COLOR = "#f97316"; // 대칭자(#0ea5e9)와 시각적으로 구분되는 색.
const EYE_LEVEL_COLOR = "#fbbf24";

export function StudioPerspectiveOverlay({
  points,
  canvasWidth,
  canvasHeight,
  effScale,
  eyeLevelY = null,
  lockHorizon = false,
  disabled = false,
  onPreviewEyeLevelY,
  onCommitEyeLevelY,
  onCancelEyeLevel,
  ...callbacks
}: StudioPerspectiveOverlayProps): ReactElement {
  const safeScale = Number.isFinite(effScale) && effScale > 0 ? effScale : 1;
  const [dragPreview, setDragPreview] = useState<PointDragPreview | null>(null);
  const [eyeLevelPreviewY, setEyeLevelPreviewY] = useState<number | null>(null);
  const cancelledDragIdRef = useRef<string | null>(null);
  const cancelledEyeLevelRef = useRef(false);
  const previewPoints = dragPreview === null
    ? points
    : points.map((point) => point.id === dragPreview.id
      ? { ...point, x: dragPreview.x, y: dragPreview.y }
      : point);
  const fanRays = perspectiveFanRays(previewPoints, canvasWidth, canvasHeight);
  const showEyeLevel = eyeLevelY !== null || lockHorizon || onCommitEyeLevelY !== undefined;
  const resolvedEyeLevelY = eyeLevelPreviewY
    ?? eyeLevelY
    ?? defaultPerspectiveEyeLevelY(canvasHeight);

  const previewPoint = "onCommitPoint" in callbacks
    ? callbacks.onPreviewPoint
    : callbacks.onMovePoint;
  const commitPoint = "onCommitPoint" in callbacks
    ? callbacks.onCommitPoint
    : undefined;

  return (
    <>
      {fanRays.map((ray, index) => (
        <Line
          key={`${ray.vpId}-${index}`}
          points={[ray.x1, ray.y1, ray.x2, ray.y2]}
          stroke={VP_COLOR}
          strokeWidth={1 / safeScale}
          dash={[4 / safeScale, 4 / safeScale]}
          opacity={0.5}
          listening={false}
        />
      ))}
      {showEyeLevel && (
        <Line
          points={[-canvasWidth, resolvedEyeLevelY, canvasWidth * 2, resolvedEyeLevelY]}
          stroke={EYE_LEVEL_COLOR}
          strokeWidth={1.5 / safeScale}
          dash={[8 / safeScale, 6 / safeScale]}
          opacity={lockHorizon ? 0.9 : 0.65}
          hitStrokeWidth={28 / safeScale}
          draggable={!disabled && onCommitEyeLevelY !== undefined}
          listening={!disabled && onCommitEyeLevelY !== undefined}
          name="eye-level-handle"
          dragBoundFunc={(pos) => ({ x: 0, y: pos.y })}
          onPointerDown={(e: Konva.KonvaEventObject<PointerEvent>) => {
            e.cancelBubble = true;
          }}
          onMouseEnter={(e: Konva.KonvaEventObject<MouseEvent>) => {
            const stage = e.target.getStage();
            if (stage) stage.container().style.cursor = "ns-resize";
          }}
          onMouseLeave={(e: Konva.KonvaEventObject<MouseEvent>) => {
            const stage = e.target.getStage();
            if (stage) stage.container().style.cursor = "";
          }}
          onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
            if (disabled) return;
            const y = e.target.y();
            // Keep the infinite line anchored at document x origin while dragging.
            e.target.x(0);
            setEyeLevelPreviewY(y);
            onPreviewEyeLevelY?.(y);
          }}
          onPointerCancel={() => {
            cancelledEyeLevelRef.current = true;
            setEyeLevelPreviewY(null);
            onCancelEyeLevel?.();
          }}
          onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
            const y = e.target.y();
            e.target.x(0);
            e.target.y(resolvedEyeLevelY);
            const nativeEventType = e.evt?.type;
            const cancelled = disabled
              || cancelledEyeLevelRef.current
              || nativeEventType === "pointercancel"
              || nativeEventType === "touchcancel";
            if (cancelled) {
              if (!disabled && !cancelledEyeLevelRef.current) onCancelEyeLevel?.();
            } else {
              onCommitEyeLevelY?.(y);
            }
            cancelledEyeLevelRef.current = false;
            setEyeLevelPreviewY(null);
          }}
        />
      )}
      {previewPoints.map((vp) => (
        <Group key={vp.id}>
          <KCircle
            x={vp.x}
            y={vp.y}
            radius={8 / safeScale}
            fill={VP_COLOR}
            stroke="#ffffff"
            strokeWidth={2 / safeScale}
            // 16px visual mark + 28px hit stroke = 44px coarse-pointer target at every zoom.
            hitStrokeWidth={28 / safeScale}
            draggable={!disabled}
            listening={!disabled}
            name="vp-handle"
            dragBoundFunc={lockHorizon
              ? (pos) => ({ x: pos.x, y: resolvedEyeLevelY })
              : undefined}
            onPointerDown={(e: Konva.KonvaEventObject<PointerEvent>) => {
              // A handle lives inside the draw Stage. Consume pointerdown so it cannot also begin ink.
              e.cancelBubble = true;
            }}
            onMouseEnter={(e: Konva.KonvaEventObject<MouseEvent>) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "move";
            }}
            onMouseLeave={(e: Konva.KonvaEventObject<MouseEvent>) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "";
            }}
            onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
              if (disabled) return;
              // 대칭축 핸들과 달리 캔버스 밖 좌표도 허용한다(의도적, 클램프 없음).
              const x = e.target.x();
              const y = lockHorizon ? resolvedEyeLevelY : e.target.y();
              if (lockHorizon) e.target.y(resolvedEyeLevelY);
              setDragPreview({ id: vp.id, x, y });
              previewPoint?.(vp.id, x, y);
            }}
            onPointerCancel={() => {
              cancelledDragIdRef.current = vp.id;
              setDragPreview(null);
              callbacks.onCancelPoint?.(vp.id);
            }}
            onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
              const x = e.target.x();
              const y = lockHorizon ? resolvedEyeLevelY : e.target.y();
              // Konva는 별도 dragcancel을 노출하지 않고 touchcancel도 dragend로 전달한다.
              // 네이티브 취소 이벤트와 앞서 받은 pointercancel은 롤백으로 취급한다.
              const nativeEventType = e.evt?.type;
              const cancelled = disabled
                || cancelledDragIdRef.current === vp.id
                || nativeEventType === "pointercancel"
                || nativeEventType === "touchcancel";
              if (cancelled) {
                if (!disabled && cancelledDragIdRef.current !== vp.id) {
                  callbacks.onCancelPoint?.(vp.id);
                }
              } else {
                commitPoint?.(vp.id, x, y);
              }
              cancelledDragIdRef.current = null;
              setDragPreview(null);
            }}
          />
        </Group>
      ))}
    </>
  );
}
