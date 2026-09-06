// 치수/스케일 가이드 — SketchUp이 새 문서마다 사람 실루엣을 세워 두는 관례의 bg3d판.
// 160cm 인체 실루엣 파츠 레이아웃을 순수 계산한다. 렌더는 StudioBackground3D.tsx가
// 캡처 제외 그룹(registerStudioBg3dCaptureExcludedObject) 안에서 수행하므로 결과물(PNG/LT)에는
// 절대 포함되지 않는다 — 기존 바닥 그리드(BgGroundHelper)와 같은 "뷰포트 보조물" 계약.
//
// makeGeometry 기본 치수 보정(§studio-background-3d-primitives.ts):
//   sphere 반지름 0.5 → 지름 = scale, capsule 반지름 0.3·원통 0.7 → 총높이 = 0.7·scaleY + 0.6·scaleX(반구 2개).
// 여기서는 검증 가능성을 위해 box/sphere만 사용해 합계가 정확히 1.6m가 되도록 잡는다.

export const STUDIO_BG3D_SCALE_GUIDE_HEIGHT_M = 1.6;

export interface StudioBg3dScaleGuidePart {
  readonly shape: "box" | "sphere";
  readonly name: string;
  readonly position: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
}

/**
 * 실루엣 파츠(발바닥 y=0, 정수리 y=1.6). 7.5등신 근사 비율 — 정확한 인체가 아니라
 * "이 벽이 사람 키의 몇 배인가"를 즉시 읽게 하는 자(尺)다.
 */
export function buildStudioBg3dScaleGuideParts(): StudioBg3dScaleGuidePart[] {
  const total = STUDIO_BG3D_SCALE_GUIDE_HEIGHT_M;
  const headHeight = 0.22;
  const neckTop = total - headHeight; // 1.38
  const legHeight = 0.74;
  const torsoHeight = neckTop - legHeight; // 0.64
  return [
    { shape: "sphere", name: "머리", position: [0, neckTop + headHeight / 2, 0], scale: [headHeight, headHeight, headHeight] },
    { shape: "box", name: "몸통", position: [0, legHeight + torsoHeight / 2, 0], scale: [0.36, torsoHeight, 0.18] },
    { shape: "box", name: "왼다리", position: [-0.09, legHeight / 2, 0], scale: [0.12, legHeight, 0.16] },
    { shape: "box", name: "오른다리", position: [0.09, legHeight / 2, 0], scale: [0.12, legHeight, 0.16] },
    { shape: "box", name: "왼팔", position: [-0.24, legHeight + torsoHeight - 0.29, 0], scale: [0.09, 0.58, 0.12] },
    { shape: "box", name: "오른팔", position: [0.24, legHeight + torsoHeight - 0.29, 0], scale: [0.09, 0.58, 0.12] },
  ];
}

/** 파츠 전체의 y 범위 [min, max] — 테스트와 라벨 배치(머리 위 1.6m 표기)에 쓴다. */
export function computeStudioBg3dScaleGuideHeightRange(
  parts: readonly StudioBg3dScaleGuidePart[],
): readonly [number, number] {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const part of parts) {
    const halfHeight = part.scale[1] / 2;
    min = Math.min(min, part.position[1] - halfHeight);
    max = Math.max(max, part.position[1] + halfHeight);
  }
  return [min, max];
}
