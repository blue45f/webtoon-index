// 단면(Section) 컷 — SketchUp Section Plane의 최소형. 축 정렬 클리핑 평면 하나를 전역
// renderer.clippingPlanes로 적용해 "바깥에서 실내를 들여다보는" 컷을 만든다.
//
// 순수 수학만 이 모듈에 둔다(three 평면 계약: 법선 n·점 p + 상수 c < 0인 픽셀이 잘린다 —
// 즉 n·p + c ≥ 0 영역이 남는다). 실제 renderer 적용은 StudioBackground3D.tsx의 Canvas 내부
// 컨트롤러가 담당하고, 상태는 뷰포트 보조물이라 장면 문서에 저장하지 않는다(캡처는 현재
// 보이는 화면 그대로 반영 — 잘린 상태로 캡처하면 잘린 이미지가 나온다는 것이 의도).

export const STUDIO_BG3D_SECTION_AXES = ["x", "y", "z"] as const;
export type StudioBg3dSectionAxis = (typeof STUDIO_BG3D_SECTION_AXES)[number];

export const STUDIO_BG3D_SECTION_AXIS_LABELS: Record<StudioBg3dSectionAxis, string> = {
  x: "좌우(X)",
  y: "상하(Y)",
  z: "앞뒤(Z)",
};

/** 오프셋 슬라이더 한계(m) — 씬 템플릿 최대 폭(14m)과 방 최대 치수(30m)를 여유 있게 덮는다. */
export const STUDIO_BG3D_SECTION_OFFSET_LIMIT = 30;

export interface StudioBg3dSectionPlaneState {
  readonly enabled: boolean;
  readonly axis: StudioBg3dSectionAxis;
  /** 축 방향 절단 위치(m). */
  readonly offset: number;
  /** false = 오프셋보다 큰 쪽을 잘라낸다(예: y축이면 위를 걷어 실내가 보임). true = 반대. */
  readonly flip: boolean;
}

export const DEFAULT_STUDIO_BG3D_SECTION_PLANE_STATE: StudioBg3dSectionPlaneState = Object.freeze({
  enabled: false,
  axis: "z",
  offset: 0,
  flip: false,
});

export interface StudioBg3dSectionPlaneEquation {
  readonly normal: readonly [number, number, number];
  readonly constant: number;
}

export function clampStudioBg3dSectionOffset(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(STUDIO_BG3D_SECTION_OFFSET_LIMIT, Math.max(-STUDIO_BG3D_SECTION_OFFSET_LIMIT, value))
    : 0;
}

/**
 * 상태 → three.js Plane 계수. 비활성화면 null(렌더러의 clippingPlanes를 비운다).
 *
 * flip=false 기본: 법선 = −축, 상수 = offset → 축 좌표 ≤ offset 영역이 남는다(축의 +쪽 절단).
 * flip=true: 법선 = +축, 상수 = −offset → 축 좌표 ≥ offset 영역이 남는다.
 */
export function computeStudioBg3dSectionPlane(
  state: StudioBg3dSectionPlaneState,
): StudioBg3dSectionPlaneEquation | null {
  if (!state.enabled) return null;
  const offset = clampStudioBg3dSectionOffset(state.offset);
  const axisIndex = STUDIO_BG3D_SECTION_AXES.indexOf(state.axis);
  if (axisIndex < 0) return null;
  const sign = state.flip ? 1 : -1;
  const normal: [number, number, number] = [0, 0, 0];
  normal[axisIndex] = sign;
  return { normal, constant: -sign * offset };
}

/** 남는 영역 판정 헬퍼 — n·p + c ≥ 0. 테스트와 UI 설명 문구 검증에 쓴다. */
export function isPointKeptByStudioBg3dSectionPlane(
  plane: StudioBg3dSectionPlaneEquation,
  point: readonly [number, number, number],
): boolean {
  const dot = plane.normal[0] * point[0] + plane.normal[1] * point[1] + plane.normal[2] * point[2];
  return dot + plane.constant >= 0;
}
