/**
 * Studio History Brush Overlay — 히스토리 브러시의 진행 중 스트로크 미리보기(Konva).
 * StudioHealCloneOverlay 와 동일한 이유로 lazy-load 하지 않고 일반 import 로 쓴다(react-konva 는
 * Stage 트리 밖으로 포탈될 수 없다). 상태 없는 순수 프레젠테이션(fully-controlled, StudioPage 가
 * 좌표를 소유) — listening=false, 포인터는 Stage 핸들러가 처리한다.
 *
 * StudioHealCloneOverlay 와 다른 점(의도적, 더 단순함): 소스 앵커 크로스헤어가 없다 — 히스토리
 * 브러시의 소스는 캔버스 위의 한 점이 아니라 "작업 내역 패널에서 고른 시점의 이미지 전체"라 캔버스
 * 위에 표시할 단일 좌표가 없다. 그래서 이 오버레이는 브러시 스트로크 궤적(진행 중 미리보기 선)
 * 하나만 그린다. 실시간 호버 브러시 원(ref-mutated, historyBrushCursorRef)은 heal-clone 과 동일한
 * 이유로 이 컴포넌트 밖(StudioPage.tsx 안)에 형제 JSX 로 직접 둔다. `scale`(effScale) prop 이 없는
 * 것도 의도적 — heal-clone 오버레이가 scale 로 나누는 대상은 전부 "화면에서 항상 일정 크기로
 * 보여야 하는 UI 마커"(소스 크로스헤어 등)뿐이고, brushStrokePreview 의 strokeWidth 는 원래도
 * scale 로 나누지 않는 순수 캔버스-단위 값이다(Stage 자체의 scaleX/scaleY 가 전역으로 이미
 * 적용된다) — 크로스헤어가 없는 이 오버레이엔 scale 을 쓸 대상이 아예 없다.
 */
import { Group, Line } from "react-konva/lib/ReactKonvaCore";

import { brushStrokePreview, type SelectionFrame, type SelPoint } from "./studio-selection-tools";

import type { ReactElement } from "react";

export type StudioHistoryBrushOverlayProps = {
  frame: SelectionFrame;
  drag: { points: SelPoint[] } | null; // RAF 스로틀된 진행 중 스트로크, healCloneDragPreview 와 동일 형태
  radiusPx: number; // 표시 px — brushStrokePreview 의 radiusNorm 변환은 이 컴포넌트(호출자)가 한다
};

// 스트로크 미리보기 색 — 다른 브러시류(smudge #7c5cff, heal #22c55e/clone #38bdf8, layer-mask 는
// 모드별)와 시각적으로 구분되는 핑크.
const STROKE_COLOR = "rgba(236, 72, 153, 0.5)";

export function StudioHistoryBrushOverlay({ frame, drag, radiusPx }: StudioHistoryBrushOverlayProps): ReactElement {
  const size = { width: frame.width, height: frame.height };
  const radiusNorm = frame.width > 0 ? radiusPx / frame.width : 0;
  const strokePreview = drag ? brushStrokePreview(drag.points, radiusNorm, size) : null;

  return (
    <Group x={frame.x} y={frame.y} rotation={frame.rotation ?? 0} listening={false}>
      {strokePreview && (
        <Line
          points={strokePreview.points}
          stroke={STROKE_COLOR}
          strokeWidth={strokePreview.strokeWidth}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      )}
    </Group>
  );
}
