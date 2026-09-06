import type { El, FrameEl } from "./studio-element-model";

export interface StudioElementBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 요소의 대략적 바운딩 박스(중심·크기 판정용).
export function elBounds(el: El): StudioElementBounds {
  if (el.type === "draw") {
    const x0 = el.points[0] ?? 0;
    const y0 = el.points[1] ?? 0;
    let minX = x0;
    let minY = y0;
    let maxX = x0;
    let maxY = y0;
    for (let i = 2; i < el.points.length; i += 2) {
      const x = el.points[i] ?? maxX;
      const y = el.points[i + 1] ?? maxY;
      if (x < minX) minX = x;
      else if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      else if (y > maxY) maxY = y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  if (el.type === "text") {
    return { x: el.x, y: el.y, w: el.width, h: el.fontSize * 1.4 };
  }
  if (el.type === "sticker") {
    return { x: el.x, y: el.y, w: el.fontSize, h: el.fontSize };
  }
  return { x: el.x, y: el.y, w: el.width, h: el.height };
}

/** 축 정렬 경계 상자 — `elBounds`가 돌려주는 모양 그대로. */
export interface StudioElementBoundsRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * `containingPanel`의 판정을 BOUNDS만으로 수행하는 순수 코어.
 *
 * 라이브 변형 프리뷰가 이걸 직접 씁니다: 제스처 중 커밋될 클립을 알려면 아직 존재하지 않는
 * 요소(= 변형 후 기하)에 대해 같은 판정을 내려야 하는데, 요소를 합성해 넘기는 것보다 경계
 * 상자를 넘기는 편이 정직합니다. `containingPanel`이 이 함수에 위임하므로 두 판정이 갈라질
 * 수 없습니다 — 프리뷰가 커밋과 다른 규칙을 쓰는 순간 이 기능의 의미가 사라집니다.
 */
export function panelContainingBounds(
  b: StudioElementBoundsRect,
  all: readonly El[]
): FrameEl | null {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  let best: FrameEl | null = null;
  let bestArea = Infinity;
  for (const f of all) {
    if (f.type !== "frame" || f.hidden) continue;
    if (cx < f.x || cx > f.x + f.width || cy < f.y || cy > f.y + f.height) {
      continue;
    }
    if (b.w > f.width * 1.4 || b.h > f.height * 1.4) continue;
    const area = f.width * f.height;
    if (area < bestArea) {
      bestArea = area;
      best = f;
    }
  }
  return best;
}

// 요소가 "들어가야 할" 패널(중심이 패널 안 + 패널보다 크게 넘치지 않음). 없으면 null.
// 전체 배경처럼 패널보다 훨씬 큰 요소는 제외해 백드롭이 한 칸에 갇히지 않게 한다.
export function containingPanel(el: El, all: readonly El[]): FrameEl | null {
  if (el.type === "frame") return null;
  return panelContainingBounds(elBounds(el), all);
}
