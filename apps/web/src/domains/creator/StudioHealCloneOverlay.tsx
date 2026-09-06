/**
 * Studio Heal/Clone Overlay — 복구 브러시/도장의 소스 앵커 크로스헤어 + 진행 중 스트로크 미리보기
 * (Konva). StudioPerspectiveOverlay.tsx 와 동일한 이유로 lazy-load 하지 않고 일반 import 로 쓴다
 * (react-konva 는 Stage 트리 밖으로 포탈될 수 없다). 정적 앵커와 최초 점은 React가 그리고,
 * 진행 중인 선은 StudioPage가 전달한 Konva ref로 직접 갱신한다. listening=false라 포인터는 Stage
 * 핸들러가 계속 처리하며, 매 move마다 Studio 루트를 다시 렌더하지 않는다.
 *
 * 여기 없는 것(의도적): 포인터를 실시간으로 따라다니는 호버 브러시 원 + 소스 크로스헤어는
 * ref-mutated(브러시 도구의 brushCursorRef 기법)라 이 컴포넌트의 "완전히 상태로만 제어됨" 순수성을
 * 깨므로 StudioPage.tsx 안에 형제 JSX 로 직접 둔다(설계 문서 §2.2 참고).
 */
import { Circle as KCircle, Group, Line } from "react-konva/lib/ReactKonvaCore";

import { brushStrokePreview, type SelectionFrame, type SelPoint } from "./studio-selection-tools";

import type { HealCloneMode } from "./studio-heal-clone";
import type { Line as KonvaLine } from "konva/lib/shapes/Line";
import type { ReactElement, RefObject } from "react";

export type StudioHealCloneOverlayProps = {
  frame: SelectionFrame;
  scale: number; // effScale
  sourceAnchor: SelPoint | null; // 정적 마커
  drag: { points: SelPoint[]; lineRef?: RefObject<KonvaLine | null> } | null;
  radiusPx: number; // 표시 px — brushStrokePreview 의 radiusNorm 변환은 이 컴포넌트(호출자)가 한다
  mode: HealCloneMode;
};

// 소스 앵커 크로스헤어 색 — 마술봉(#7c5cfc)·원근자(#f97316)와 시각적으로 구분되는 초록.
const SOURCE_COLOR = "#22c55e";
// 스트로크 미리보기 색 — 모드별로 다른 색조(heal=초록 계열, clone=하늘색 계열).
const STROKE_COLORS: Record<HealCloneMode, string> = {
  heal: "rgba(34, 197, 94, 0.5)",
  clone: "rgba(56, 189, 248, 0.5)",
};

export function StudioHealCloneOverlay({
  frame,
  scale,
  sourceAnchor,
  drag,
  radiusPx,
  mode,
}: StudioHealCloneOverlayProps): ReactElement {
  const size = { width: frame.width, height: frame.height };
  const radiusNorm = frame.width > 0 ? radiusPx / frame.width : 0;
  const strokePreview = drag ? brushStrokePreview(drag.points, radiusNorm, size) : null;
  const crossLen = 10 / scale;

  return (
    <Group x={frame.x} y={frame.y} rotation={frame.rotation ?? 0} listening={false}>
      {sourceAnchor && (
        <Group x={sourceAnchor.x * frame.width} y={sourceAnchor.y * frame.height} listening={false}>
          <KCircle
            radius={7 / scale}
            stroke={SOURCE_COLOR}
            strokeWidth={1.5 / scale}
            dash={[3 / scale, 2 / scale]}
          />
          <Line points={[-crossLen, 0, crossLen, 0]} stroke={SOURCE_COLOR} strokeWidth={1.5 / scale} />
          <Line points={[0, -crossLen, 0, crossLen]} stroke={SOURCE_COLOR} strokeWidth={1.5 / scale} />
        </Group>
      )}
      {strokePreview && (
        <Line
          ref={drag?.lineRef}
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
