// 이메레스 밑그림(underlay) 배치 계획 — 카탈로그 틀(studio-emeres-templates)과 개인 보관함
// 항목(studio-emeres-library)이 캔버스에 들어갈 때 공유하는 순수 계산.
//
// 호스트(StudioCuttoonEditorHost)의 두 삽입 경로는 이미지 소스와 출처 표식만 달랐고 배치 규칙은
// 글자 하나까지 같았다. 그 규칙을 여기로 모아 두 경로가 조용히 갈라질 수 없게 하고, 칸 맞춤
// 계산을 브라우저 없이 단위 테스트할 수 있게 한다.
//
// 순수 모듈이라 id 생성(uid)·문서 커밋·도구 전환 같은 부수효과는 전부 호출자 몫이다.

import {
  createCanvasImageElement,
  type CanvasImageElement,
  type CanvasImagePlacement,
} from "./studio-image-placement";

/** 배치 대상 칸. FrameEl 전체가 아니라 계산에 실제로 쓰이는 사각형만 받는다. */
export interface StudioEmeresUnderlayFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StudioEmeresUnderlayInput {
  /** 호출자가 만든 요소 id. uid()는 부수효과라 이 모듈 안에서 부르지 않는다. */
  id: string;
  /** 이미 dataURL로 구워진 이미지 소스(카탈로그 SVG 변환 결과 또는 보관함 래스터). */
  src: string;
  sourceWidth: number;
  sourceHeight: number;
  /** 반투명 밑그림 정도. 호스트의 studioOptionalAssets.emeresUnderlayOpacity 값. */
  opacity: number;
  /** 카탈로그 틀은 `t.id`, 개인 보관함 항목은 `custom:${item.id}`. 일괄 삭제가 이 표식만 본다. */
  emeresSourceId: string;
  /** 선택된 칸. null이면 캔버스 기준 배치로 떨어진다. */
  frame: StudioEmeresUnderlayFrame | null;
  canvasWidth: number;
  canvasHeight: number;
  /** 칸 밖 배치에서만 쓰인다. 칸이 선택된 호출은 생략해 삽입 캐스케이드 순번을 소모하지 않는다. */
  placement?: CanvasImagePlacement;
}

/** 밑그림은 항상 잠긴 반투명 레이어다 — 작가가 그 위에 펜으로 그리는 동안 잡히면 안 된다. */
export interface StudioEmeresUnderlayElement extends CanvasImageElement {
  opacity: number;
  locked: true;
  emeresSourceId: string;
}

/** 칸 안쪽에 남기는 여백 비율 — 밑그림이 칸선에 닿지 않아야 그 위에 그릴 여지가 남는다. */
const FRAME_FIT_RATIO = 0.94;
/** 칸 밖 배치의 좌우 여백(px). createCanvasImageElement 기본값(120)보다 좁게 잡아 밑그림을 크게 깐다. */
const CANVAS_HORIZONTAL_INSET = 80;

export function planStudioEmeresUnderlayElement({
  id,
  src,
  sourceWidth,
  sourceHeight,
  opacity,
  emeresSourceId,
  frame,
  canvasWidth,
  canvasHeight,
  placement,
}: StudioEmeresUnderlayInput): StudioEmeresUnderlayElement {
  if (frame) {
    // 칸 안에 넣을 때는 비율을 유지한 채 축소만 하고 칸 중앙에 세운다.
    const fit = Math.min(frame.width / sourceWidth, frame.height / sourceHeight) * FRAME_FIT_RATIO;
    const width = Math.round(sourceWidth * fit);
    const height = Math.round(sourceHeight * fit);
    return {
      id,
      type: "image",
      src,
      x: Math.round(frame.x + (frame.width - width) / 2),
      y: Math.round(frame.y + (frame.height - height) / 2),
      width,
      height,
      rotation: 0,
      opacity,
      locked: true,
      emeresSourceId,
    };
  }
  return {
    ...createCanvasImageElement({
      id,
      src,
      canvasWidth,
      canvasHeight,
      sourceWidth,
      sourceHeight,
      horizontalInset: CANVAS_HORIZONTAL_INSET,
      placement,
    }),
    opacity,
    locked: true,
    emeresSourceId,
  };
}
