/**
 * Studio Isometric Grid Overlay — 아이소메트릭 그리드 평행선 다발 + 드래그 가능한 기준점
 * 핸들(Konva). 모듈 자체는 React.lazy 로 나눌 수 있지만 렌더 결과는 반드시 StudioPage 의
 * 같은 react-konva Stage 자식 트리에 남아야 한다(별도 DOM/React 포탈 금지). 드래그 중 좌표만
 * 로컬 미리보기로 소유하고 dragend에서 문서 좌표를 한 번 커밋한다.
 */
import { useRef, useState, type ReactElement } from "react";
import { Circle as KCircle, Group, Line } from "react-konva/lib/ReactKonvaCore";

import { isometricGridLines, type IsometricGridConfig } from "./studio-isometric-grid";

import type Konva from "konva";

type StudioIsometricGridOverlayBaseProps = {
  config: IsometricGridConfig;
  canvasWidth: number;
  canvasHeight: number;
  effScale: number;
  disabled?: boolean;
  /** 브라우저가 포인터/터치 드래그를 취소한 경우의 선택적 정리 알림. */
  onCancelOrigin?: () => void;
};

type StudioIsometricGridOverlayCommitProps = {
  /** 드래그 중 UI 전용 좌표 알림. 프로젝트 문서/undo history를 갱신하면 안 된다. */
  onPreviewOrigin?: (x: number, y: number) => void;
  /** dragend 한 번에만 호출되는 영속 문서 커밋 경계. */
  onCommitOrigin: (x: number, y: number) => void;
  onMoveOrigin?: never;
};

type StudioIsometricGridOverlayLegacyProps = {
  /** @deprecated onPreviewOrigin/onCommitOrigin을 사용한다. */
  onMoveOrigin: (x: number, y: number) => void;
  onPreviewOrigin?: never;
  onCommitOrigin?: never;
};

export type StudioIsometricGridOverlayProps = StudioIsometricGridOverlayBaseProps &
  (StudioIsometricGridOverlayCommitProps | StudioIsometricGridOverlayLegacyProps);

// 원근자 소실점(#f97316)/대칭자(#0ea5e9)와 시각적으로 구분되는 색.
const GRID_COLOR = "#a855f7";

export function StudioIsometricGridOverlay({
  config,
  canvasWidth,
  canvasHeight,
  effScale,
  disabled = false,
  ...callbacks
}: StudioIsometricGridOverlayProps): ReactElement {
  const safeScale = Number.isFinite(effScale) && effScale > 0 ? effScale : 1;
  const [dragPreview, setDragPreview] = useState<{ x: number; y: number } | null>(null);
  const cancelledDragRef = useRef(false);
  const previewConfig = dragPreview === null
    ? config
    : { ...config, originX: dragPreview.x, originY: dragPreview.y };
  const lines = isometricGridLines(previewConfig, canvasWidth, canvasHeight);

  const previewOrigin = "onCommitOrigin" in callbacks
    ? callbacks.onPreviewOrigin
    : callbacks.onMoveOrigin;
  const commitOrigin = "onCommitOrigin" in callbacks
    ? callbacks.onCommitOrigin
    : undefined;

  return (
    <>
      {lines.map((line, index) => (
        <Line
          key={`${line.axisIndex}-${index}`}
          points={[line.x1, line.y1, line.x2, line.y2]}
          stroke={GRID_COLOR}
          // 수직축(axisIndex 2)을 살짝 더 진하게 그려 기준축으로 눈에 띄게 한다.
          strokeWidth={(line.axisIndex === 2 ? 1 : 0.75) / safeScale}
          opacity={line.axisIndex === 2 ? 0.4 : 0.28}
          listening={false}
        />
      ))}
      <Group>
        <KCircle
          x={previewConfig.originX}
          y={previewConfig.originY}
          radius={8 / safeScale}
          fill={GRID_COLOR}
          stroke="#ffffff"
          strokeWidth={2 / safeScale}
          // 16px visual mark + 28px hit stroke = 44px coarse-pointer target at every zoom.
          hitStrokeWidth={28 / safeScale}
          draggable={!disabled}
          listening={!disabled}
          name="isometric-origin-handle"
          onPointerDown={(e: Konva.KonvaEventObject<PointerEvent>) => {
            // The handle is mounted only in draw mode; do not let this contact start a brush stroke.
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
            // 원근자 소실점 핸들과 동일하게 캔버스 밖 좌표도 허용한다(의도적, 클램프 없음).
            const x = e.target.x();
            const y = e.target.y();
            setDragPreview({ x, y });
            previewOrigin?.(x, y);
          }}
          onPointerCancel={() => {
            cancelledDragRef.current = true;
            setDragPreview(null);
            callbacks.onCancelOrigin?.();
          }}
          onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
            const x = e.target.x();
            const y = e.target.y();
            // Konva는 별도 dragcancel을 노출하지 않고 touchcancel도 dragend로 전달한다.
            // 네이티브 취소 이벤트와 앞서 받은 pointercancel은 롤백으로 취급한다.
            const nativeEventType = e.evt?.type;
            const cancelled = disabled
              || cancelledDragRef.current
              || nativeEventType === "pointercancel"
              || nativeEventType === "touchcancel";
            if (cancelled) {
              if (!disabled && !cancelledDragRef.current) callbacks.onCancelOrigin?.();
            } else {
              commitOrigin?.(x, y);
            }
            cancelledDragRef.current = false;
            setDragPreview(null);
          }}
        />
      </Group>
    </>
  );
}
