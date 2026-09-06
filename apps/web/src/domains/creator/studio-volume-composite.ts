/**
 * Studio Volume — 합성(compositing) 계약
 *
 * 볼륨 렌더 결과를 래스터/패스트레이스 배경 위에 올릴 때의 **정확한** 규약을 정의한다.
 * 패스트레이서(studio-pathtrace-*)와 스튜디오 캔버스가 이 규약만 지키면 볼륨 레이어를 그대로
 * 얹을 수 있다.
 *
 * ── 1. 알파는 프리멀티플라이드(premultiplied) ────────────────────────────
 *   적분기 출력 rgb 는 이미 `Σ T(t)·source(t)·dt` 이다 — 매질 스스로의 감쇠가 곱해진 값이라
 *   정의상 프리멀티플라이드다. 절대 rgb/alpha 로 나눠서(스트레이트 알파로 바꿔서) 전달하지 말 것.
 *   나눗셈은 alpha→0 에서 수치적으로 폭발하고, 방출(불)처럼 alpha 가 거의 0 인데 rgb 가 큰
 *   화소를 표현할 수 없게 만든다.
 *
 *     alpha = 1 - T_total,     T_total = exp(-∫σ_t ds)
 *
 * ── 2. over 연산자 ───────────────────────────────────────────────────────
 *   배경도 프리멀티플라이드라고 가정한다.
 *
 *     out.rgb = vol.rgb + bg.rgb · T_total
 *     out.a   = vol.a   + bg.a   · T_total          (T_total = 1 - vol.a)
 *
 *   즉 표준 `src OVER dst` 와 동일하되, 곱하는 값이 (1 - vol.a) 가 아니라 **적분기가 실제로
 *   보고한 T_total** 이다. 조기 종료(transmittance cutoff)로 둘이 미세하게 어긋날 수 있는데,
 *   물리적으로 옳은 쪽은 T_total 이다.
 *
 * ── 3. 깊이(depth) 처리 ──────────────────────────────────────────────────
 *   볼륨은 반투명 매질이라 단일 깊이 값이 없다. 계약은 **적분 구간을 자르는 쪽**이다:
 *
 *   (a) 배경이 불투명하면, 배경의 월드 깊이를 `maxDistance` 로 넘겨 그 앞까지만 적분한다.
 *       → z-test 가 필요 없고, 볼륨이 배경 지오메트리를 관통하는 문제도 생기지 않는다.
 *   (b) 배경 깊이가 카메라 z(뷰 공간 깊이)로 주어지면 `studioVolumeDistanceFromViewDepth` 로
 *       레이 거리로 환산해서 넘긴다(원근 카메라에서 z ≠ 거리).
 *   (c) 볼륨 자체가 다른 반투명 레이어와 정렬되어야 하면 `depth`(불투명도 임계 교차 거리) 또는
 *       `expectedDepth`(불투명도 가중 평균 거리)를 대표 깊이로 쓴다. 전자는 하드 서피스처럼
 *       보이게, 후자는 디노이저/모션블러의 시간적 재투영에 적합하다.
 *
 *   불투명 배경 앞에서 적분을 자른 뒤에는 **볼륨 알파를 깊이 버퍼에 쓰지 않는다** — 볼륨은
 *   깊이를 점유하지 않는 참여 매질이다.
 *
 * ── 4. 색 공간 ───────────────────────────────────────────────────────────
 *   전 구간 **선형(scene-referred) RGB**. 톤매핑/sRGB 인코딩은 합성이 끝난 뒤 마지막에 한 번만.
 *   중간에 sRGB 로 인코딩하고 합성하면 반투명 경계가 어둡게 뭉친다.
 */

export interface StudioVolumeCompositeSpec {
  readonly alphaMode: "premultiplied";
  readonly colorSpace: "linear-srgb";
  readonly channels: 4;
  readonly depthPolicy: "clip-integration-at-background-distance";
}

export const STUDIO_VOLUME_COMPOSITE_SPEC: StudioVolumeCompositeSpec = Object.freeze({
  alphaMode: "premultiplied",
  colorSpace: "linear-srgb",
  channels: 4,
  depthPolicy: "clip-integration-at-background-distance",
});

/**
 * 프리멀티플라이드 `over` 한 화소. `transmittance` 를 명시적으로 받는다(1 - alpha 로 재계산하지
 * 않는다 — 위 2절 참고). out 은 [r, g, b, a].
 */
export function compositeStudioVolumePixelOver(
  volR: number,
  volG: number,
  volB: number,
  volA: number,
  transmittance: number,
  bgR: number,
  bgG: number,
  bgB: number,
  bgA: number,
  out: Float64Array = new Float64Array(4)
): Float64Array {
  const t = transmittance < 0 ? 0 : transmittance > 1 ? 1 : transmittance;
  out[0] = volR + bgR * t;
  out[1] = volG + bgG * t;
  out[2] = volB + bgB * t;
  out[3] = volA + bgA * t;
  return out;
}

/**
 * RGBA(프리멀티플라이드) 이미지 두 장을 합성한다. `transmittance` 배열이 없으면 1 - a 로
 * 대체한다(조기 종료 보정 없이도 성립하는 근사 경로).
 */
export function compositeStudioVolumeImageOver(
  volume: Float32Array,
  background: Float32Array,
  transmittance: Float32Array | null = null,
  out: Float32Array = new Float32Array(volume.length)
): Float32Array {
  const pixels = Math.min(volume.length, background.length, out.length) >> 2;
  for (let i = 0; i < pixels; i += 1) {
    const o = i * 4;
    const a = volume[o + 3];
    const t = transmittance ? transmittance[i] : 1 - a;
    const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
    out[o] = volume[o] + background[o] * clamped;
    out[o + 1] = volume[o + 1] + background[o + 1] * clamped;
    out[o + 2] = volume[o + 2] + background[o + 2] * clamped;
    out[o + 3] = a + background[o + 3] * clamped;
  }
  return out;
}

/** 프리멀티플라이드 → 스트레이트 알파. alpha ≈ 0 은 0 으로 둔다(폭발 방지). */
export function unpremultiplyStudioVolumeRgba(
  rgba: Float32Array,
  epsilon = 1e-6,
  out: Float32Array = new Float32Array(rgba.length)
): Float32Array {
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const a = rgba[i + 3];
    if (a > epsilon) {
      const inv = 1 / a;
      out[i] = rgba[i] * inv;
      out[i + 1] = rgba[i + 1] * inv;
      out[i + 2] = rgba[i + 2] * inv;
    } else {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
    }
    out[i + 3] = a;
  }
  return out;
}

/** 스트레이트 → 프리멀티플라이드. */
export function premultiplyStudioVolumeRgba(
  rgba: Float32Array,
  out: Float32Array = new Float32Array(rgba.length)
): Float32Array {
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const a = rgba[i + 3];
    out[i] = rgba[i] * a;
    out[i + 1] = rgba[i + 1] * a;
    out[i + 2] = rgba[i + 2] * a;
    out[i + 3] = a;
  }
  return out;
}

/**
 * 뷰 공간 깊이(z, 카메라 전방 축 성분) → 레이 거리.
 * `cosToForward` 는 레이 방향과 카메라 전방축의 내적이다(픽셀마다 다르다).
 * 원근 카메라에서 z 를 그대로 maxDistance 로 넘기면 화면 가장자리가 잘못 잘린다.
 */
export function studioVolumeDistanceFromViewDepth(viewDepth: number, cosToForward: number): number {
  if (!(viewDepth > 0)) return 0;
  if (!(cosToForward > 1e-6)) return Number.POSITIVE_INFINITY;
  return viewDepth / cosToForward;
}

/** 선형 → sRGB 전달함수(합성 **이후** 마지막 단계에서만 쓸 것). */
export function studioVolumeLinearToSrgb(value: number): number {
  const v = value < 0 ? 0 : value > 1 ? 1 : value;
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/**
 * 프리멀티플라이드 선형 RGBA(Float32) → 8비트 sRGB 프리멀티플라이드 RGBA.
 * 언프리멀티플라이 후 인코딩하고 다시 프리멀티플라이한다(경계 화소 어두워짐 방지).
 */
export function encodeStudioVolumeRgba8(
  rgba: Float32Array,
  out: Uint8ClampedArray = new Uint8ClampedArray((rgba.length >> 2) * 4)
): Uint8ClampedArray {
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const a = rgba[i + 3] < 0 ? 0 : rgba[i + 3] > 1 ? 1 : rgba[i + 3];
    const inv = a > 1e-6 ? 1 / a : 0;
    out[i] = Math.round(studioVolumeLinearToSrgb(rgba[i] * inv) * a * 255);
    out[i + 1] = Math.round(studioVolumeLinearToSrgb(rgba[i + 1] * inv) * a * 255);
    out[i + 2] = Math.round(studioVolumeLinearToSrgb(rgba[i + 2] * inv) * a * 255);
    out[i + 3] = Math.round(a * 255);
  }
  return out;
}
