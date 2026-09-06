import type { StudioToolHintSpec } from "./studio-tool-hints";

/**
 * Canonical copy and motion-coach routing for every persistent canvas-view
 * control. Keep HUD, tool-belt, status-bar, and mobile fallbacks on this one
 * vocabulary so identical actions never promise different behavior.
 */
export const STUDIO_VIEW_ACTION_HINTS = {
  zoomOut: {
    id: "view:zoom-out",
    title: "축소",
    description: "캔버스 보기 배율을 한 단계 축소해 더 넓은 작업 범위를 확인합니다.",
    shortcut: "−",
    preview: "zoom-view",
    previewVariant: "zoom-out",
    tip: "포인터가 있는 위치를 기준으로 확대·축소하려면 Ctrl/Cmd를 누른 채 휠을 움직이세요.",
  },
  zoomIn: {
    id: "view:zoom-in",
    title: "확대",
    description: "캔버스 보기 배율을 한 단계 확대해 선과 픽셀의 세부를 확인합니다.",
    shortcut: "=",
    preview: "zoom-view",
    previewVariant: "zoom-in",
    tip: "포인터가 있는 위치를 기준으로 확대·축소하려면 Ctrl/Cmd를 누른 채 휠을 움직이세요.",
  },
  actualSize: {
    id: "view:actual-size",
    title: "실제 픽셀 100%",
    description: "화면의 CSS 1px에 문서 1px이 대응하도록 맞춰 선명도와 픽셀 경계를 왜곡 없이 확인합니다.",
    shortcut: "End",
    preview: "zoom-view",
    previewVariant: "actual-size",
    tip: "브러시 가장자리나 래스터 효과를 최종 점검할 때 사용하세요.",
  },
  fitWidth: {
    id: "view:fit-width",
    title: "너비에 맞춤",
    description: "현재 작업 영역의 가로 폭에 캔버스가 들어오도록 보기 배율을 자동 계산합니다.",
    shortcut: "Home",
    preview: "zoom-view",
    previewVariant: "fit-width",
    tip: "긴 세로 원고를 위에서 아래로 검토할 때 가로 스크롤을 없앨 수 있어요.",
  },
  reset: {
    id: "view:reset",
    title: "보기 초기화",
    description: "배율·회전·좌우 반전과 스크롤 위치를 기본 보기로 되돌립니다. 원고 데이터와 내보내기 결과는 바뀌지 않습니다.",
    preview: "zoom-view",
    previewVariant: "reset",
    tip: "보기 방향을 잃었을 때 원고를 수정하지 않고 작업 시점만 복원합니다.",
  },
  rotateLeft: {
    id: "view:rotate-left",
    title: "왼쪽으로 90° 회전",
    description: "캔버스 보기만 반시계 방향으로 90° 돌립니다. 원고 좌표와 내보내기 방향은 유지됩니다.",
    preview: "rotate-view",
    previewVariant: "rotate-left",
  },
  rotateRight: {
    id: "view:rotate-right",
    title: "오른쪽으로 90° 회전",
    description: "캔버스 보기만 시계 방향으로 90° 돌립니다. 원고 좌표와 내보내기 방향은 유지됩니다.",
    preview: "rotate-view",
    previewVariant: "rotate-right",
  },
  flip: {
    id: "view:flip",
    title: "좌우 반전",
    description: "그림의 균형을 점검할 수 있도록 캔버스 보기만 거울처럼 뒤집습니다. 원고 픽셀은 변경하지 않습니다.",
    preview: "flip-view",
    previewVariant: "flip",
    tip: "얼굴 비대칭이나 구도 치우침을 찾은 뒤 다시 눌러 원래 방향으로 돌아오세요.",
  },
  restoreFlip: {
    id: "view:restore-flip",
    title: "좌우 반전 해제",
    description: "거울 보기를 해제하고 캔버스를 원래 좌우 방향으로 복원합니다. 원고 픽셀은 변경하지 않습니다.",
    preview: "flip-view",
    previewVariant: "restore",
  },
  close: {
    id: "view:close-tools",
    title: "보기 도구 닫기",
    description: "현재 확대·축소 또는 회전 HUD를 닫고 호출한 보기 도구로 포커스를 돌려보냅니다. 호출 도구가 없으면 캔버스로 이동하며 적용한 보기 상태는 유지됩니다.",
    shortcut: "Esc",
    preview: "dismiss",
  },
} as const satisfies Readonly<Record<string, StudioToolHintSpec>>;

export function studioViewFlipHint(flipped: boolean): StudioToolHintSpec {
  return flipped ? STUDIO_VIEW_ACTION_HINTS.restoreFlip : STUDIO_VIEW_ACTION_HINTS.flip;
}
