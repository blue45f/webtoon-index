/**
 * Studio High-Bit — 전달 함수(transfer function) 코어.
 *
 * sRGB / Display P3 는 **원색(primaries)만 다르고 전달 함수는 동일**하다(IEC 61966-2-1 의
 * piecewise 감마 ≈2.2). 이 모듈은 그 EOTF(디코드: 부호화값 → 선형광)와 OETF(인코드: 선형광 →
 * 부호화값)를 정확한 조각별 정의 그대로 제공한다. 근사(pow 2.2) 는 쓰지 않는다 — 어두운 쪽
 * 선형 구간에서 최대 0.01(2.5 코드) 오차가 나고, 그게 바로 밴딩이 눈에 띄는 구간이다.
 *
 * ── 왜 이 모듈이 필요한가 ─────────────────────────────────────────────────
 * Canvas 2D 의 `globalAlpha`/`source-over`, Konva 필터 체인, WebGPU dab 합성은 전부
 * **감마 부호화된 값 위에서 산술**을 한다. 물리적으로 빛은 선형으로 더해지므로 감마 공간
 * 합성은 중간톤을 어둡게 뭉치게 만든다(검정↔흰색 50% 혼합이 128 vs 188, 60 코드 차이).
 * 정확한 합성은 반드시 decode → (선형에서 합성) → encode 순서여야 한다.
 *
 * 순수·결정적: DOM/난수/시간 의존 없음. 룩업 테이블은 모듈 로드시 한 번 계산한다.
 */

/** sRGB / Display P3 공통 EOTF 의 선형 구간 임계값(부호화 도메인). */
export const STUDIO_HIGHBIT_SRGB_ENCODED_THRESHOLD = 0.04045;
/** sRGB / Display P3 공통 OETF 의 선형 구간 임계값(선형광 도메인). */
export const STUDIO_HIGHBIT_SRGB_LINEAR_THRESHOLD = 0.0031308;
/** 선형 구간 기울기. */
export const STUDIO_HIGHBIT_SRGB_SLOPE = 12.92;
/** 지수 구간 계수/오프셋/지수. */
export const STUDIO_HIGHBIT_SRGB_ALPHA = 1.055;
export const STUDIO_HIGHBIT_SRGB_OFFSET = 0.055;
export const STUDIO_HIGHBIT_SRGB_GAMMA = 2.4;

export function clampStudioHighBitUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/**
 * EOTF — 부호화 sRGB(0..1) → 선형광(0..1). 음수/1 초과는 **부호 보존 확장**으로 처리한다
 * (와이드 개멋 변환 중간값은 합법적으로 [0,1] 밖으로 나가므로 여기서 클램프하면 개멋 매핑이
 * 불가능해진다 — 클램프는 최종 양자화 경계에서만 한다).
 */
export function studioHighBitSrgbToLinear(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const magnitude = Math.abs(value);
  const linear = magnitude <= STUDIO_HIGHBIT_SRGB_ENCODED_THRESHOLD
    ? magnitude / STUDIO_HIGHBIT_SRGB_SLOPE
    : Math.pow(
      (magnitude + STUDIO_HIGHBIT_SRGB_OFFSET) / STUDIO_HIGHBIT_SRGB_ALPHA,
      STUDIO_HIGHBIT_SRGB_GAMMA
    );
  return value < 0 ? -linear : linear;
}

/** OETF — 선형광(0..1) → 부호화 sRGB(0..1). 부호 보존 확장은 EOTF 와 동일 규약. */
export function studioHighBitLinearToSrgb(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const magnitude = Math.abs(value);
  const encoded = magnitude <= STUDIO_HIGHBIT_SRGB_LINEAR_THRESHOLD
    ? magnitude * STUDIO_HIGHBIT_SRGB_SLOPE
    : STUDIO_HIGHBIT_SRGB_ALPHA * Math.pow(magnitude, 1 / STUDIO_HIGHBIT_SRGB_GAMMA)
      - STUDIO_HIGHBIT_SRGB_OFFSET;
  return value < 0 ? -encoded : encoded;
}

/**
 * 8비트 코드(0..255) → 선형광 룩업. 브러시 dab 색·이미지 디코드처럼 픽셀당 한 번씩 도는
 * 경로에서 `Math.pow` 를 없앤다(결과는 `studioHighBitSrgbToLinear(code / 255)` 와 비트 동일).
 */
export const STUDIO_HIGHBIT_BYTE_TO_LINEAR: Float64Array = (() => {
  const table = new Float64Array(256);
  for (let code = 0; code < 256; code += 1) {
    table[code] = studioHighBitSrgbToLinear(code / 255);
  }
  return table;
})();

/**
 * 8비트 코드 하나가 선형광에서 차지하는 폭의 **최솟값**. uint16 선형 고정소수점이 8비트 코드
 * 하나를 몇 조각으로 쪼개는지(= 정밀도 마진) 계산하는 근거값이다.
 */
export const STUDIO_HIGHBIT_MIN_LINEAR_STEP_PER_BYTE_CODE: number = (() => {
  let minimum = Number.POSITIVE_INFINITY;
  for (let code = 1; code < 256; code += 1) {
    const step = STUDIO_HIGHBIT_BYTE_TO_LINEAR[code]! - STUDIO_HIGHBIT_BYTE_TO_LINEAR[code - 1]!;
    if (step < minimum) minimum = step;
  }
  return minimum;
})();

/** 선형광 → 8비트 코드(반올림, 클램프). 디더링은 studio-highbit-dither 가 담당한다. */
export function studioHighBitLinearToByte(value: number): number {
  const encoded = studioHighBitLinearToSrgb(clampStudioHighBitUnit(value));
  return Math.max(0, Math.min(255, Math.round(encoded * 255)));
}

/** 8비트 코드 → 선형광(룩업). 범위 밖 입력은 클램프한다. */
export function studioHighBitByteToLinear(code: number): number {
  if (!Number.isFinite(code)) return 0;
  const index = Math.max(0, Math.min(255, Math.round(code)));
  return STUDIO_HIGHBIT_BYTE_TO_LINEAR[index]!;
}
