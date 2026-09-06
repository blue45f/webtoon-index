/**
 * Studio High-Bit — 색공간(원색) 모델.
 *
 * sRGB 와 Display P3 는 **동일한 D65 백색점 + 동일한 전달 함수**를 쓰고 원색(primaries)만
 * 다르다. 따라서 두 공간 사이 변환은 "선형광에서의 3×3 행렬 하나"가 전부다. 감마 부호화된
 * 값에 행렬을 곱하면 안 된다(색이 틀어진다) — 이 모듈의 모든 행렬은 **선형광 전용**이다.
 *
 * 행렬은 하드코딩하지 않고 각 공간의 RGB→XYZ(D65) 행렬을 곱해 유도한다. 문헌값(0.822462 …)
 * 과의 일치는 계약 테스트가 검증한다 — 오타로 인한 미세 색틀어짐을 원천 차단하기 위함이다.
 *
 * 개멋(gamut) 처리:
 *   - P3 → sRGB 변환은 sRGB 삼각형 밖 색에서 **음수 채널**을 만든다. 그냥 클램프하면 채도가
 *     높은 영역에서 휘도가 튀고 색상(hue)이 회전한다.
 *   - `"clamp"` 는 채널별 절단(빠르고, 브라우저/캔버스 기본 동작과 동일).
 *   - `"desaturate"` 는 상대휘도를 유지한 채 무채축으로 채도만 줄여 범위 안으로 넣는다
 *     (색상 회전 없음 — 웹툰 채색의 그라데이션 연속성 보존에 유리).
 */

export type StudioHighBitGamut = "srgb" | "display-p3";
export type StudioHighBitGamutClipMode = "clamp" | "desaturate";

export type StudioHighBitMatrix3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

/** sRGB(선형) → CIE XYZ, D65. IEC 61966-2-1 원색에서 유도된 표준값. */
export const STUDIO_HIGHBIT_SRGB_TO_XYZ: StudioHighBitMatrix3 = [
  0.4123907992659595, 0.35758433938387796, 0.1804807884018343,
  0.21263900587151036, 0.7151686787677559, 0.07219231536073371,
  0.01933081871559185, 0.11919477979462599, 0.9505321522496606,
];

/** Display P3(선형) → CIE XYZ, D65. SMPTE RP 431-2 원색 + D65 백색점. */
export const STUDIO_HIGHBIT_DISPLAY_P3_TO_XYZ: StudioHighBitMatrix3 = [
  0.4865709486482162, 0.26566769316909306, 0.1982172852343625,
  0.2289745640697488, 0.6917385218365064, 0.079286914093745,
  0.0000000000000000, 0.04511338185890264, 1.0439443689009760,
];

/** 상대휘도 가중치(선형 sRGB/Rec.709). XYZ 행렬의 Y 행과 같은 값이다. */
export const STUDIO_HIGHBIT_LUMINANCE_WEIGHTS: readonly [number, number, number] = [
  STUDIO_HIGHBIT_SRGB_TO_XYZ[3],
  STUDIO_HIGHBIT_SRGB_TO_XYZ[4],
  STUDIO_HIGHBIT_SRGB_TO_XYZ[5],
];

export function multiplyStudioHighBitMatrix3(
  left: StudioHighBitMatrix3,
  right: StudioHighBitMatrix3
): StudioHighBitMatrix3 {
  const out = new Array<number>(9);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      let sum = 0;
      for (let k = 0; k < 3; k += 1) {
        sum += left[row * 3 + k]! * right[k * 3 + column]!;
      }
      out[row * 3 + column] = sum;
    }
  }
  return out as unknown as StudioHighBitMatrix3;
}

/** 3×3 역행렬(여인수 전개). 특이행렬이면 null — 상수 행렬이라 실제로는 발생하지 않는다. */
export function invertStudioHighBitMatrix3(
  matrix: StudioHighBitMatrix3
): StudioHighBitMatrix3 | null {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const cofactorA = e * i - f * h;
  const cofactorB = f * g - d * i;
  const cofactorC = d * h - e * g;
  const determinant = a * cofactorA + b * cofactorB + c * cofactorC;
  if (!Number.isFinite(determinant) || determinant === 0) return null;
  const inverse = 1 / determinant;
  return [
    cofactorA * inverse, (c * h - b * i) * inverse, (b * f - c * e) * inverse,
    cofactorB * inverse, (a * i - c * g) * inverse, (c * d - a * f) * inverse,
    cofactorC * inverse, (b * g - a * h) * inverse, (a * e - b * d) * inverse,
  ];
}

function requireInverse(matrix: StudioHighBitMatrix3, label: string): StudioHighBitMatrix3 {
  const inverse = invertStudioHighBitMatrix3(matrix);
  if (!inverse) throw new Error(`고비트 색공간: ${label} 행렬을 역변환할 수 없습니다.`);
  return inverse;
}

export const STUDIO_HIGHBIT_XYZ_TO_SRGB: StudioHighBitMatrix3 =
  requireInverse(STUDIO_HIGHBIT_SRGB_TO_XYZ, "sRGB→XYZ");
export const STUDIO_HIGHBIT_XYZ_TO_DISPLAY_P3: StudioHighBitMatrix3 =
  requireInverse(STUDIO_HIGHBIT_DISPLAY_P3_TO_XYZ, "P3→XYZ");

/** 선형 sRGB → 선형 Display P3 (백색점 동일이라 순응 변환 불필요). */
export const STUDIO_HIGHBIT_SRGB_TO_DISPLAY_P3: StudioHighBitMatrix3 =
  multiplyStudioHighBitMatrix3(STUDIO_HIGHBIT_XYZ_TO_DISPLAY_P3, STUDIO_HIGHBIT_SRGB_TO_XYZ);

/** 선형 Display P3 → 선형 sRGB. */
export const STUDIO_HIGHBIT_DISPLAY_P3_TO_SRGB: StudioHighBitMatrix3 =
  multiplyStudioHighBitMatrix3(STUDIO_HIGHBIT_XYZ_TO_SRGB, STUDIO_HIGHBIT_DISPLAY_P3_TO_XYZ);

export type StudioHighBitRgb = readonly [number, number, number];

export function applyStudioHighBitMatrix3(
  matrix: StudioHighBitMatrix3,
  rgb: StudioHighBitRgb
): StudioHighBitRgb {
  const [r, g, b] = rgb;
  return [
    matrix[0] * r + matrix[1] * g + matrix[2] * b,
    matrix[3] * r + matrix[4] * g + matrix[5] * b,
    matrix[6] * r + matrix[7] * g + matrix[8] * b,
  ];
}

/** 두 개멋 사이의 선형광 변환 행렬(같은 개멋이면 단위행렬). */
export function studioHighBitGamutMatrix(
  from: StudioHighBitGamut,
  to: StudioHighBitGamut
): StudioHighBitMatrix3 {
  if (from === to) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  return from === "srgb"
    ? STUDIO_HIGHBIT_SRGB_TO_DISPLAY_P3
    : STUDIO_HIGHBIT_DISPLAY_P3_TO_SRGB;
}

/** 선형광 RGB 를 다른 개멋의 선형광 RGB 로 변환한다(클리핑 없음 — 의도적). */
export function convertStudioHighBitLinearGamut(
  rgb: StudioHighBitRgb,
  from: StudioHighBitGamut,
  to: StudioHighBitGamut
): StudioHighBitRgb {
  if (from === to) return [rgb[0], rgb[1], rgb[2]];
  return applyStudioHighBitMatrix3(studioHighBitGamutMatrix(from, to), rgb);
}

export function studioHighBitRelativeLuminance(rgb: StudioHighBitRgb): number {
  return STUDIO_HIGHBIT_LUMINANCE_WEIGHTS[0] * rgb[0]
    + STUDIO_HIGHBIT_LUMINANCE_WEIGHTS[1] * rgb[1]
    + STUDIO_HIGHBIT_LUMINANCE_WEIGHTS[2] * rgb[2];
}

export function isStudioHighBitInGamut(rgb: StudioHighBitRgb, epsilon = 1e-9): boolean {
  return rgb.every((channel) => Number.isFinite(channel) && channel >= -epsilon && channel <= 1 + epsilon);
}

/**
 * 개멋 밖 선형광 RGB 를 [0,1]^3 안으로 넣는다.
 *
 * `"desaturate"`: 상대휘도 L 을 고정하고 `L + t·(C − L)` 의 t 를 이분 없이 닫힌 형태로 구해
 * 가장 먼저 경계에 닿는 t 를 취한다. 휘도가 이미 [0,1] 밖이면(노출 과다) 휘도부터 클램프한다.
 */
export function clipStudioHighBitToGamut(
  rgb: StudioHighBitRgb,
  mode: StudioHighBitGamutClipMode = "clamp"
): StudioHighBitRgb {
  const safe: StudioHighBitRgb = [
    Number.isFinite(rgb[0]) ? rgb[0] : 0,
    Number.isFinite(rgb[1]) ? rgb[1] : 0,
    Number.isFinite(rgb[2]) ? rgb[2] : 0,
  ];
  if (mode === "clamp" || isStudioHighBitInGamut(safe)) {
    return [
      Math.min(1, Math.max(0, safe[0])),
      Math.min(1, Math.max(0, safe[1])),
      Math.min(1, Math.max(0, safe[2])),
    ];
  }
  const luminance = Math.min(1, Math.max(0, studioHighBitRelativeLuminance(safe)));
  let scale = 1;
  for (const channel of safe) {
    const delta = channel - luminance;
    if (delta > 0 && channel > 1) scale = Math.min(scale, (1 - luminance) / delta);
    if (delta < 0 && channel < 0) scale = Math.min(scale, luminance / -delta);
  }
  if (!Number.isFinite(scale) || scale < 0) scale = 0;
  return [
    Math.min(1, Math.max(0, luminance + (safe[0] - luminance) * scale)),
    Math.min(1, Math.max(0, luminance + (safe[1] - luminance) * scale)),
    Math.min(1, Math.max(0, luminance + (safe[2] - luminance) * scale)),
  ];
}
