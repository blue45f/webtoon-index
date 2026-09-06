/**
 * Studio Quick Mask Overlay — 퀵 마스크 세션 중 마스크를 색 틴트(기본 포토샵 빨강 50%)로 캔버스
 * 위에 덮어 그리고, 진행 중 스트로크 미리보기 + 편집 모드 점선 테두리를 보여주는 Konva 오버레이.
 * StudioLayerMaskOverlay.tsx와 동일한 이유로 lazy-load 하지 않고 일반 import 로 쓴다(react-konva
 * 는 Stage 트리 밖으로 포탈될 수 없다). 상태 없는 순수 프레젠테이션(fully-controlled, StudioPage
 * 가 마스크 버퍼·틴트 캔버스·좌표를 소유) — listening=false, 포인터는 Stage 핸들러가 처리한다.
 *
 * 핫패스 규약: 이 컴포넌트는 프레임당 React 상태를 만들지 않는다.
 *  - 확정된 마스크: tintCanvas(오프스크린 캔버스, buildQuickMaskTintPixels → putImageData 결과)를
 *    Konva Image 로 요소 크기에 늘려 그린다. 스트로크 커밋(포인터 업)마다 **새 캔버스 참조**로
 *    교체해야 react-konva 가 다시 그린다 — 프레임당이 아니라 스트로크당 1회.
 *  - 진행 중 스트로크: StudioLayerMaskOverlay 와 동일하게 RAF 스로틀된 drag prop(반투명 라운드
 *    획, brushStrokePreview 재사용)으로만 표시한다 — 결과 픽셀은 손을 뗀 시점에 한 번에 반영.
 *
 * 여기 없는 것(의도적, StudioLayerMaskOverlay 와 동일한 이유): 포인터를 실시간으로 따라다니는
 * 호버 브러시 반경 원은 ref-mutated 기법이라 이 컴포넌트의 순수성을 깨므로 StudioPage.tsx 안에
 * 형제 JSX(독립 Layer)로 직접 둔다(layerMaskCursorRef 패턴 참고).
 */
import { Group, Image as KonvaImage, Line, Rect } from "react-konva/lib/ReactKonvaCore";

import {
  quickMaskStrokePreviewColor,
  QUICK_MASK_TINT_COLOR_DEFAULT,
  QUICK_MASK_TINT_OPACITY_DEFAULT,
  type QuickMaskBrushMode,
} from "./studio-quick-mask";
import { brushStrokePreview, type SelectionFrame, type SelPoint } from "./studio-selection-tools";

import type { ReactElement } from "react";

export type StudioQuickMaskOverlayProps = {
  frame: SelectionFrame;
  scale: number; // effScale
  /** 틴트 캔버스(마스크 래스터 해상도) — 스트로크 커밋마다 새 참조로 교체. null = 틴트 없음. */
  tintCanvas: HTMLCanvasElement | null;
  /** RAF 스로틀된 진행 중 스트로크 — layerMaskDragPreview 와 동일 형태. */
  drag: { points: SelPoint[] } | null;
  /** 표시 px — brushStrokePreview 의 radiusNorm 변환은 이 컴포넌트가 한다(LayerMaskOverlay 관례). */
  radiusPx: number;
  mode: QuickMaskBrushMode;
  tintColor?: string;
  tintOpacity?: number;
};

export function StudioQuickMaskOverlay({
  frame,
  scale,
  tintCanvas,
  drag,
  radiusPx,
  mode,
  tintColor = QUICK_MASK_TINT_COLOR_DEFAULT,
  tintOpacity = QUICK_MASK_TINT_OPACITY_DEFAULT,
}: StudioQuickMaskOverlayProps): ReactElement {
  const size = { width: frame.width, height: frame.height };
  const radiusNorm = frame.width > 0 ? radiusPx / frame.width : 0;
  const strokePreview = drag ? brushStrokePreview(drag.points, radiusNorm, size) : null;

  return (
    <Group x={frame.x} y={frame.y} rotation={frame.rotation ?? 0} listening={false}>
      {tintCanvas && (
        <KonvaImage
          image={tintCanvas}
          width={frame.width}
          height={frame.height}
          listening={false}
        />
      )}
      {/* 편집 모드 테두리 — 틴트색 그대로(마술봉 보라·레이어 마스크 호박색과 구분). */}
      <Rect
        width={frame.width}
        height={frame.height}
        stroke={tintColor}
        strokeWidth={1.5 / scale}
        dash={[6 / scale, 4 / scale]}
        listening={false}
      />
      {strokePreview && (
        <Line
          points={strokePreview.points}
          stroke={quickMaskStrokePreviewColor(mode, tintColor, tintOpacity)}
          strokeWidth={strokePreview.strokeWidth}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      )}
    </Group>
  );
}
