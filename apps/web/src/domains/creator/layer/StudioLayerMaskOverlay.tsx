/**
 * Studio Layer Mask Overlay — 마스크 브러시 무장 중 "지금 마스크를 편집 중"임을 알리는 점선
 * 테두리 + 진행 중 스트로크 미리보기(Konva). StudioHealCloneOverlay.tsx/StudioPerspectiveOverlay.tsx
 * 와 동일한 이유로 lazy-load 하지 않고 일반 import 로 쓴다(react-konva 는 Stage 트리 밖으로
 * 포탈될 수 없다). 상태 없는 순수 프레젠테이션(fully-controlled, StudioPage 가 좌표를 소유) —
 * listening=false, 포인터는 Stage 핸들러가 처리한다.
 *
 * 여기 없는 것(의도적, StudioHealCloneOverlay와 동일한 이유): 포인터를 실시간으로 따라다니는
 * 호버 브러시 반경 원은 ref-mutated(smudgeCursorRef/healCloneCursorRef 기법)라 이 컴포넌트의
 * "완전히 상태로만 제어됨" 순수성을 깨므로 StudioPage.tsx 안에 형제 JSX(독립 Layer)로 직접 둔다
 * (design 문서 §StudioPage.tsx 통합 참고).
 */
import { Group, Line, Rect } from "react-konva/lib/ReactKonvaCore";

import { brushStrokePreview, type SelectionFrame, type SelPoint } from "../studio-selection-tools";

import type { LayerMaskPaintMode } from "./studio-layer-mask";
import type { ReactElement } from "react";

export type StudioLayerMaskOverlayProps = {
  frame: SelectionFrame;
  scale: number; // effScale
  drag: { points: SelPoint[] } | null; // RAF 스로틀된 진행 중 스트로크, pixelDragPreview 와 동일 형태
  radiusPx: number; // 표시 px — brushStrokePreview 의 radiusNorm 변환은 이 컴포넌트(호출자)가 한다
  mode: LayerMaskPaintMode;
};

// 마스크 편집 모드 테두리 색 — 마술봉(#7c5cfc)·원근자(#f97316)·heal(#22c55e)/clone(#38bdf8) 과
// 시각적으로 구분되는 호박색(주의를 끌되 경고색은 아님 — "비파괴 편집 중"이라는 뉘앙스).
const MODE_BORDER_COLOR = "#eab308";
// 스트로크 미리보기 색 — reveal(드러냄)은 흰색 계열, conceal(가림)은 어두운 계열로 결과를 암시.
const STROKE_COLORS: Record<LayerMaskPaintMode, string> = {
  reveal: "rgba(255,255,255,0.55)",
  conceal: "rgba(24,24,27,0.55)",
};

export function StudioLayerMaskOverlay({ frame, scale, drag, radiusPx, mode }: StudioLayerMaskOverlayProps): ReactElement {
  const size = { width: frame.width, height: frame.height };
  const radiusNorm = frame.width > 0 ? radiusPx / frame.width : 0;
  const strokePreview = drag ? brushStrokePreview(drag.points, radiusNorm, size) : null;

  return (
    <Group x={frame.x} y={frame.y} rotation={frame.rotation ?? 0} listening={false}>
      <Rect
        width={frame.width}
        height={frame.height}
        stroke={MODE_BORDER_COLOR}
        strokeWidth={1.5 / scale}
        dash={[6 / scale, 4 / scale]}
        listening={false}
      />
      {strokePreview && (
        <Line
          points={strokePreview.points}
          stroke={STROKE_COLORS[mode]}
          strokeWidth={strokePreview.strokeWidth}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      )}
    </Group>
  );
}
