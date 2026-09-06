/**
 * Studio Sculpt — 브러시 팔로프 커널(순수 함수, 상태 없음).
 *
 * ## 계약 (테스트로 잠근 것)
 * 모든 커널 f 는 정규화 거리 t = distance / radius 에 대해:
 *   - f(0) === 1, f(1) === 0
 *   - t < 0 은 0 으로, t > 1 은 1 로 클램프한 뒤 평가한다(반경 밖은 항상 0).
 *   - [0, 1] 구간에서 **단조 비증가**이고 값이 항상 [0, 1] 안이다.
 * "constant" 만 예외적으로 t < 1 에서 1 을 유지하다 t = 1 에서 0 으로 떨어진다(계단). 위 계약
 * (비증가·f(0)=1·f(1)=0)은 그대로 만족한다.
 *
 * ## 커널
 *   smooth   0.5 + 0.5·cos(π t)   — Hann. 이 레포 2D 브러시(studio-liquify 의 코사인 가중)와
 *                                    같은 정신이라 3D/2D 브러시의 감쇠 느낌이 어긋나지 않는다.
 *   linear   1 − t                — 원뿔.
 *   sharp    (1 − t)²             — 중심이 뾰족, 가장자리가 완만.
 *   sphere   sqrt(1 − t²)         — 반구 단면. 가장자리가 급격히 떨어진다.
 *   constant t < 1 ? 1 : 0        — 계단(마스크성 편집).
 *
 * ## 한계
 * 사용자 정의 커브(Blender 의 falloff curve widget)나 알파 텍스처 브러시가 없다. 프리셋 5종뿐이다.
 */

export const SCULPT_FALLOFF_KERNELS = ["smooth", "linear", "sharp", "sphere", "constant"] as const;

export type SculptFalloffKernel = (typeof SCULPT_FALLOFF_KERNELS)[number];

export const DEFAULT_SCULPT_FALLOFF: SculptFalloffKernel = "smooth";

/** 영속 상태·외부 입력에서 온 값이 커널 이름이 아니면 기본값으로 폴백한다(throw 하지 않는다). */
export function normalizeSculptFalloffKernel(value: unknown): SculptFalloffKernel {
  return SCULPT_FALLOFF_KERNELS.includes(value as SculptFalloffKernel)
    ? (value as SculptFalloffKernel)
    : DEFAULT_SCULPT_FALLOFF;
}

/** 정규화 거리 t(0 = 중심, 1 = 반경) → 가중치 [0, 1]. t 는 내부에서 클램프된다. */
export function sculptFalloff(kernel: SculptFalloffKernel, t: number): number {
  if (!Number.isFinite(t)) return 0;
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  switch (kernel) {
    case "linear":
      return 1 - clamped;
    case "sharp": {
      const inverse = 1 - clamped;
      return inverse * inverse;
    }
    case "sphere":
      // sqrt(1 - t²). t=1 에서 정확히 0 이 되도록 분기한다(sqrt 반올림에 기대지 않는다).
      return clamped >= 1 ? 0 : Math.sqrt(1 - clamped * clamped);
    case "constant":
      return clamped >= 1 ? 0 : 1;
    case "smooth":
    default:
      // Hann. t=0/1 에서 cos 의 반올림에 기대지 않고 정확한 1/0 을 못 박는다.
      if (clamped <= 0) return 1;
      if (clamped >= 1) return 0;
      return 0.5 + 0.5 * Math.cos(Math.PI * clamped);
  }
}

/** 월드 거리 → 가중치. radius <= 0 이면 항상 0(브러시가 없는 것과 같다). */
export function sculptFalloffWeight(
  kernel: SculptFalloffKernel,
  distance: number,
  radius: number,
): number {
  if (!Number.isFinite(radius) || radius <= 0) return 0;
  if (!Number.isFinite(distance) || distance < 0) return 0;
  return sculptFalloff(kernel, distance / radius);
}
