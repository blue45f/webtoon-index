/**
 * Studio Puppet Warp Overlay — 핀 마커(네이티브 Konva 드래그) + 변형된 메쉬 그물선.
 * StudioPerspectiveOverlay.tsx 와 동일한 이유로 lazy-load 하지 않고 일반 import 로 쓴다(react-konva
 * 는 Stage 트리 밖으로 포탈될 수 없다).
 *
 * 다른 5개 픽셀 도구 오버레이(healClone/cropOverlay 등)와 달리 이 오버레이는 **완전히
 * listening=false 인 순수 프레젠테이션이 아니다** — 핀 마커는 StudioPerspectiveOverlay 의 소실점
 * 핸들과 동일하게 Konva `draggable` + `onDragMove` 로 직접 움직인다(StudioPage 의 onStageMove/
 * onStageUp 에 별도 드래그 세션 코드가 필요 없다). 좌표는 이 Group 이 이미지 프레임(x/y/rotation)
 * 기준으로 배치되므로, Konva 가 부모의 회전 변환을 알아서 상쇄해 onDragMove 콜백에는 항상 프레임
 * 로컬 px 좌표가 들어온다(크롭/힐클론 오버레이가 쓰는 정규화 좌표 변환 없이 프레임 크기로만 나누면
 * 정규화된다).
 *
 * 메쉬 그물선(삼각형 와이어프레임)은 studio-puppet-warp.ts 의 puppetMeshTriangleLines 가 계산한
 * "현재(드래그된) 위치" 기준 좌표를 그대로 그린다 — 위상은 항상 원본 메쉬 기준으로 고정.
 */
import { Circle as KCircle, Group, Line } from "react-konva/lib/ReactKonvaCore";

import { puppetMeshTriangleLines, type PuppetPin } from "./studio-puppet-warp";

import type { SelectionFrame } from "./studio-selection-tools";
import type Konva from "konva";
import type { ReactElement } from "react";

export type StudioPuppetWarpOverlayProps = {
  frame: SelectionFrame;
  scale: number; // effScale
  pins: PuppetPin[];
  /** 굽는 중이면 드래그를 잠근다(직전 스트로크의 비동기 굽기와 겹치는 것 방지, heal-clone과 동일 이유). */
  busy?: boolean;
  onMovePin: (id: string, x: number, y: number) => void;
};

// 다른 오버레이 색과 겹치지 않는 보라 계열 — 마술봉(#7c5cfc)과 같은 계열이지만 핀은 별도 도구라
// 동시에 함께 무장될 일이 없어(disarmAllPixelTools) 색 충돌 걱정은 없다.
const MESH_STROKE = "rgba(124, 92, 252, 0.6)";
const PIN_FILL = "#7c5cfc";
const PIN_MOVED_FILL = "#f59e0b"; // rest 에서 드래그된 핀은 주황으로 강조해 "바뀐 핀"을 한눈에 보여준다.

export function StudioPuppetWarpOverlay({
  frame,
  scale,
  pins,
  busy = false,
  onMovePin,
}: StudioPuppetWarpOverlayProps): ReactElement {
  const size = { width: frame.width, height: frame.height };
  const meshLines = puppetMeshTriangleLines(pins, size);

  return (
    <Group x={frame.x} y={frame.y} rotation={frame.rotation ?? 0}>
      {meshLines.map((points, i) => (
        <Line
          // 삼각형 목록은 위상(rest 메쉬)이 고정이라 매 렌더 같은 순서 — 인덱스를 안정적인 키로 써도 안전하다.
          key={`pw-tri-${i}`}
          points={points}
          closed
          stroke={MESH_STROKE}
          strokeWidth={1 / scale}
          listening={false}
        />
      ))}
      {pins.map((p) => {
        const moved = p.x !== p.restX || p.y !== p.restY;
        return (
          <KCircle
            key={p.id}
            x={p.x * frame.width}
            y={p.y * frame.height}
            radius={7 / scale}
            fill={moved ? PIN_MOVED_FILL : PIN_FILL}
            stroke="#ffffff"
            strokeWidth={1.5 / scale}
            draggable={!busy}
            name="puppet-pin-handle"
            onMouseEnter={(e: Konva.KonvaEventObject<MouseEvent>) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "move";
            }}
            onMouseLeave={(e: Konva.KonvaEventObject<MouseEvent>) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "default";
            }}
            onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
              const w = frame.width > 0 ? frame.width : 1;
              const h = frame.height > 0 ? frame.height : 1;
              onMovePin(p.id, e.target.x() / w, e.target.y() / h);
            }}
          />
        );
      })}
    </Group>
  );
}
