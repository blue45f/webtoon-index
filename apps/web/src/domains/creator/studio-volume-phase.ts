/**
 * Studio Volume — 위상함수(phase function)
 *
 * Henyey–Greenstein(HG) 단일 파라미터 모델. 방향 규약은 **전방 전파(forward propagation)** 로
 * 통일한다:
 *
 *     cosTheta = dot(입사 진행방향 ω_in, 산란 후 진행방향 ω_out)
 *
 * 즉 g > 0 이면 cosTheta = +1 근처(= 계속 앞으로 진행)에서 최댓값을 가진다. PBRT 는 ω_o 를
 * "빛이 온 쪽" 으로 잡아 분모 부호가 반대(1 + g² + 2g·μ)인데, 이 모듈은 그 규약을 쓰지 않는다.
 * 렌더러(studio-volume-raymarch)는 그림자 레이 방향을 `-rayDir` 과 내적할 때 이 규약에 맞춰
 * 부호를 넣는다.
 *
 *     p(μ) = (1 - g²) / (4π · (1 + g² - 2gμ)^{3/2}),      ∮ p dω = 1
 *
 * 르장드르 모멘트가 ⟨P_n⟩ = gⁿ 이라 ⟨μ⟩ = g, ⟨μ²⟩ = (2g² + 1)/3 — 테스트가 이 두 값을
 * 몬테카를로로 직접 검증한다.
 */

const INV_FOUR_PI = 1 / (4 * Math.PI);
/** g = ±1 은 디랙 델타라 수치적으로 표현 불가 — 이 값으로 클램프한다. */
export const STUDIO_VOLUME_MAX_ANISOTROPY = 0.995;
/** |g| 가 이보다 작으면 등방으로 취급(샘플링 수식의 1/(2g) 특이점 회피). */
export const STUDIO_VOLUME_ISOTROPIC_EPSILON = 1e-4;

export function clampStudioVolumeAnisotropy(g: number): number {
  if (!Number.isFinite(g)) return 0;
  if (g > STUDIO_VOLUME_MAX_ANISOTROPY) return STUDIO_VOLUME_MAX_ANISOTROPY;
  if (g < -STUDIO_VOLUME_MAX_ANISOTROPY) return -STUDIO_VOLUME_MAX_ANISOTROPY;
  return g;
}

/** 등방 위상함수 값 1/(4π). g = 0 인 HG 와 정확히 같아야 한다(테스트가 대조). */
export const STUDIO_VOLUME_ISOTROPIC_PHASE = INV_FOUR_PI;

/** HG 위상함수 값. cosTheta 는 [-1, 1] 로 클램프한다. */
export function henyeyGreensteinPhase(g: number, cosTheta: number): number {
  const gc = clampStudioVolumeAnisotropy(g);
  if (Math.abs(gc) < STUDIO_VOLUME_ISOTROPIC_EPSILON) return INV_FOUR_PI;
  const mu = cosTheta < -1 ? -1 : cosTheta > 1 ? 1 : cosTheta;
  const denom = 1 + gc * gc - 2 * gc * mu;
  const safe = denom > 1e-12 ? denom : 1e-12;
  return (INV_FOUR_PI * (1 - gc * gc)) / (safe * Math.sqrt(safe));
}

/**
 * HG 의 cosθ 역변환 샘플링.
 *
 *     s = (1 - g²) / (1 - g + 2gu),      μ = (1 + g² - s²) / (2g)
 *
 * u = 0 → μ = -1, u = 1 → μ = +1 로 정확히 떨어진다(테스트가 두 끝점을 확인).
 */
export function sampleHenyeyGreensteinCosine(g: number, u: number): number {
  const gc = clampStudioVolumeAnisotropy(g);
  const uu = u < 0 ? 0 : u > 1 ? 1 : u;
  if (Math.abs(gc) < STUDIO_VOLUME_ISOTROPIC_EPSILON) return 1 - 2 * uu;
  const s = (1 - gc * gc) / (1 - gc + 2 * gc * uu);
  const mu = (1 + gc * gc - s * s) / (2 * gc);
  return mu < -1 ? -1 : mu > 1 ? 1 : mu;
}

/**
 * Duff 등(2017)의 분기 없는 정규직교기저. w 는 단위벡터여야 한다.
 * out = [t0x,t0y,t0z, t1x,t1y,t1z].
 */
export function studioVolumeOrthonormalBasis(
  wx: number,
  wy: number,
  wz: number,
  out: Float64Array = new Float64Array(6)
): Float64Array {
  const sign = wz >= 0 ? 1 : -1;
  const a = -1 / (sign + wz);
  const b = wx * wy * a;
  out[0] = 1 + sign * wx * wx * a;
  out[1] = sign * b;
  out[2] = -sign * wx;
  out[3] = b;
  out[4] = sign + wy * wy * a;
  out[5] = -wy;
  return out;
}

/**
 * 입사 진행방향 (wx,wy,wz)(단위벡터) 주변으로 HG 산란 방향을 샘플링한다.
 * out = [dx, dy, dz] (단위벡터). 반환 pdf 는 p(μ) 그대로다(HG 는 정확 중요도 샘플링이라
 * 기여 가중치가 항상 1 → 렌더러에서 pdf 나눗셈이 필요 없다).
 */
export function sampleStudioVolumePhaseDirection(
  g: number,
  wx: number,
  wy: number,
  wz: number,
  u1: number,
  u2: number,
  out: Float64Array = new Float64Array(3)
): number {
  const mu = sampleHenyeyGreensteinCosine(g, u1);
  const sinTheta = Math.sqrt(Math.max(0, 1 - mu * mu));
  const phi = 2 * Math.PI * u2;
  const basis = studioVolumeOrthonormalBasis(wx, wy, wz);
  const cx = Math.cos(phi) * sinTheta;
  const cy = Math.sin(phi) * sinTheta;
  out[0] = cx * basis[0] + cy * basis[3] + mu * wx;
  out[1] = cx * basis[1] + cy * basis[4] + mu * wy;
  out[2] = cx * basis[2] + cy * basis[5] + mu * wz;
  const len = Math.hypot(out[0], out[1], out[2]);
  if (len > 0) {
    out[0] /= len;
    out[1] /= len;
    out[2] /= len;
  }
  return henyeyGreensteinPhase(g, mu);
}

/**
 * ∮ p dω 를 구면 위에서 수치적분한다(방위각 대칭이라 2π∫p(μ)dμ 로 축약).
 * 짝수 구간 수의 합성 심프슨 법칙 — 테스트가 1.0 과 대조하는 검증 유틸이다.
 */
export function integrateStudioVolumePhaseOverSphere(g: number, intervals = 20000): number {
  const n = intervals % 2 === 0 ? intervals : intervals + 1;
  const h = 2 / n;
  let sum = henyeyGreensteinPhase(g, -1) + henyeyGreensteinPhase(g, 1);
  for (let i = 1; i < n; i += 1) {
    const mu = -1 + i * h;
    sum += henyeyGreensteinPhase(g, mu) * (i % 2 === 0 ? 2 : 4);
  }
  return 2 * Math.PI * ((h / 3) * sum);
}
