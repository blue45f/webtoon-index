/**
 * Color Management Lab (V12 게이트 매트릭스 Color 행 — ADR-0011 레인 14 "조사 단계" 승격 조건).
 *
 * 엔진 독립 f64 참조 기준으로 sRGB ↔ Display-P3 변환 정확도를 CIEDE2000 deltaE 로 계측한다.
 * Linebender Color / OCIO / LCMS 가 맡을 "색관리 진실 원천" 역할을 라이브러리 도입 없이
 * 자체 참조 구현으로 대신하고, 실제 프로덕션 경로 두 곳을 그 기준에 비춘다:
 *
 *   (a) canvaskit-wasm 의 색공간 변환 (MakeRasterDirectSurface P3 서피스 / readPixels
 *       dstColorSpace 변환 — 어떤 표면이 실측 가능한지 이 랩이 실행으로 확정한다)
 *   (b) 스튜디오 자체 변환 (src/domains/creator/studio-highbit-transfer.ts 의 EOTF/OETF +
 *       studio-highbit-colorspace.ts 의 선형 개멋 행렬 합성 — studioHighBitSurfaceToBytes
 *       가 쓰는 실제 합성 경로)
 *
 * 참조 구현 출처(주석 필수 조건):
 *   - 전달 함수: IEC 61966-2-1 조각별(piecewise) sRGB EOTF/OETF. Display-P3 는 동일 전달
 *     함수 + P3 원색 (CSS Color 4 §10.5).
 *   - 행렬: CSS Color 4 "Sample code for Color Conversions"(w3.org/TR/css-color-4) 의
 *     유리수 행렬 그대로 — D65 백색점 공유라 Bradford 순응 없음. IEC 61966-2-1(sRGB) /
 *     SMPTE RP 431-2 원색(P3) + D65 에서 유도된 표준값과 동일.
 *   - deltaE: CIEDE2000 완전 구현, Sharma/Wu/Dalal 2005 공식 테스트 벡터 34쌍으로 자체
 *     검증(허용 1e-4).
 *
 * 실행: pnpm exec tsx tests/benchmarks/harness/color-lab.ts
 * 결과: tests/benchmarks/results/color-lab.json
 * 회귀 게이트: tests/visual/color-management.test.ts (이 JSON 실측이 게이트 상한을 정의)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, platform, arch } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { loadCanvasKitNode } from "@toonspectrum/studio-engine-skia/node";

import { convertStudioHighBitLinearGamut } from "../../../apps/web/src/domains/creator/studio-highbit-colorspace";
import {
  studioHighBitLinearToSrgb,
  studioHighBitSrgbToLinear,
} from "../../../apps/web/src/domains/creator/studio-highbit-transfer";

import type { CanvasKit, Surface } from "canvaskit-wasm";

const REPO_ROOT = new URL("../../..", import.meta.url).pathname;
const RESULTS_DIR = join(REPO_ROOT, "tests", "benchmarks", "results");

export type Vec3 = readonly [number, number, number];
export type Mat3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

// ── 참조: 전달 함수 (IEC 61966-2-1 piecewise, 부호 보존 확장) ─────────────────

/** 부호화 sRGB/P3 (0..1) → 선형광. IEC 61966-2-1 조각별 정확식. */
export function referenceSrgbEotf(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const magnitude = Math.abs(value);
  const linear = magnitude <= 0.04045
    ? magnitude / 12.92
    : ((magnitude + 0.055) / 1.055) ** 2.4;
  return value < 0 ? -linear : linear;
}

/** 선형광 → 부호화 sRGB/P3 (0..1). IEC 61966-2-1 조각별 정확식의 역. */
export function referenceSrgbOetf(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const magnitude = Math.abs(value);
  const encoded = magnitude <= 0.0031308
    ? magnitude * 12.92
    : 1.055 * magnitude ** (1 / 2.4) - 0.055;
  return value < 0 ? -encoded : encoded;
}

// ── 참조: 선형광 행렬 (CSS Color 4 유리수, D65, Bradford 없음) ────────────────

/**
 * 선형 sRGB → CIE XYZ(D65). CSS Color 4 "Sample code for Color Conversions" 의
 * 유리수 그대로 (IEC 61966-2-1 원색 + D65 백색점에서 유도된 표준 행렬).
 */
export const REFERENCE_SRGB_TO_XYZ: Mat3 = [
  506752 / 1228815, 87881 / 245763, 12673 / 70218,
  87098 / 409605, 175762 / 245763, 12673 / 175545,
  7918 / 409605, 87881 / 737289, 1001167 / 1053270,
];

/**
 * 선형 Display-P3 → CIE XYZ(D65). CSS Color 4 동일 출처 유리수
 * (SMPTE RP 431-2 원색 + D65 백색점).
 */
export const REFERENCE_P3_TO_XYZ: Mat3 = [
  608311 / 1250200, 189793 / 714400, 198249 / 1000160,
  35783 / 156275, 247089 / 357200, 198249 / 2500400,
  0, 32229 / 714400, 5220557 / 5000800,
];

export function multiplyMat3(left: Mat3, right: Mat3): Mat3 {
  const out = new Array<number>(9);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      let sum = 0;
      for (let k = 0; k < 3; k += 1) sum += left[row * 3 + k]! * right[k * 3 + column]!;
      out[row * 3 + column] = sum;
    }
  }
  return out as unknown as Mat3;
}

export function invertMat3(matrix: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const cofactorA = e * i - f * h;
  const cofactorB = f * g - d * i;
  const cofactorC = d * h - e * g;
  const determinant = a * cofactorA + b * cofactorB + c * cofactorC;
  if (!Number.isFinite(determinant) || determinant === 0) {
    throw new Error("color-lab: 특이 행렬은 역변환할 수 없습니다.");
  }
  const inverse = 1 / determinant;
  return [
    cofactorA * inverse, (c * h - b * i) * inverse, (b * f - c * e) * inverse,
    cofactorB * inverse, (a * i - c * g) * inverse, (c * d - a * f) * inverse,
    cofactorC * inverse, (b * g - a * h) * inverse, (a * e - b * d) * inverse,
  ];
}

export function applyMat3(matrix: Mat3, rgb: Vec3): Vec3 {
  const [r, g, b] = rgb;
  return [
    matrix[0] * r + matrix[1] * g + matrix[2] * b,
    matrix[3] * r + matrix[4] * g + matrix[5] * b,
    matrix[6] * r + matrix[7] * g + matrix[8] * b,
  ];
}

export const REFERENCE_XYZ_TO_SRGB: Mat3 = invertMat3(REFERENCE_SRGB_TO_XYZ);
export const REFERENCE_XYZ_TO_P3: Mat3 = invertMat3(REFERENCE_P3_TO_XYZ);
/** 선형 sRGB → 선형 P3 (XYZ 경유 합성, 백색점 동일이라 순응 불필요). */
export const REFERENCE_SRGB_TO_P3_LINEAR: Mat3 =
  multiplyMat3(REFERENCE_XYZ_TO_P3, REFERENCE_SRGB_TO_XYZ);
export const REFERENCE_P3_TO_SRGB_LINEAR: Mat3 =
  multiplyMat3(REFERENCE_XYZ_TO_SRGB, REFERENCE_P3_TO_XYZ);

/** 부호화 sRGB → 부호화 Display-P3 (f64 왕복 전 구간, 클리핑 없음 — sRGB ⊂ P3). */
export function referenceSrgbToDisplayP3(rgb: Vec3): Vec3 {
  const linear: Vec3 = [
    referenceSrgbEotf(rgb[0]),
    referenceSrgbEotf(rgb[1]),
    referenceSrgbEotf(rgb[2]),
  ];
  const p3 = applyMat3(REFERENCE_SRGB_TO_P3_LINEAR, linear);
  return [referenceSrgbOetf(p3[0]), referenceSrgbOetf(p3[1]), referenceSrgbOetf(p3[2])];
}

/** 부호화 Display-P3 → 부호화 sRGB (개멋 밖 값은 부호 보존 확장으로 그대로 통과). */
export function referenceDisplayP3ToSrgb(rgb: Vec3): Vec3 {
  const linear: Vec3 = [
    referenceSrgbEotf(rgb[0]),
    referenceSrgbEotf(rgb[1]),
    referenceSrgbEotf(rgb[2]),
  ];
  const srgb = applyMat3(REFERENCE_P3_TO_SRGB_LINEAR, linear);
  return [referenceSrgbOetf(srgb[0]), referenceSrgbOetf(srgb[1]), referenceSrgbOetf(srgb[2])];
}

// ── 참조: CIELAB (D65) + CIEDE2000 ───────────────────────────────────────────

/** D65 백색점 XYZ — 참조 sRGB 행렬의 행 합(백색 [1,1,1] 의 상). */
export const REFERENCE_D65_WHITE: Vec3 = [
  REFERENCE_SRGB_TO_XYZ[0] + REFERENCE_SRGB_TO_XYZ[1] + REFERENCE_SRGB_TO_XYZ[2],
  REFERENCE_SRGB_TO_XYZ[3] + REFERENCE_SRGB_TO_XYZ[4] + REFERENCE_SRGB_TO_XYZ[5],
  REFERENCE_SRGB_TO_XYZ[6] + REFERENCE_SRGB_TO_XYZ[7] + REFERENCE_SRGB_TO_XYZ[8],
];

const LAB_EPSILON = 216 / 24389;
const LAB_KAPPA = 24389 / 27;

export function xyzToLab(xyz: Vec3): Vec3 {
  const forward = (ratio: number): number =>
    ratio > LAB_EPSILON ? Math.cbrt(ratio) : (LAB_KAPPA * ratio + 16) / 116;
  const fx = forward(xyz[0] / REFERENCE_D65_WHITE[0]);
  const fy = forward(xyz[1] / REFERENCE_D65_WHITE[1]);
  const fz = forward(xyz[2] / REFERENCE_D65_WHITE[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export type ColorLabGamut = "srgb" | "display-p3";

/** 부호화 RGB(해당 개멋) → CIELAB(D65). deltaE 비교의 공통 좌표계. */
export function encodedToLab(rgb: Vec3, gamut: ColorLabGamut): Vec3 {
  const linear: Vec3 = [
    referenceSrgbEotf(rgb[0]),
    referenceSrgbEotf(rgb[1]),
    referenceSrgbEotf(rgb[2]),
  ];
  const toXyz = gamut === "srgb" ? REFERENCE_SRGB_TO_XYZ : REFERENCE_P3_TO_XYZ;
  return xyzToLab(applyMat3(toXyz, linear));
}

const DEG = Math.PI / 180;
const POW7_25 = 25 ** 7;

/**
 * CIEDE2000 색차 (kL = kC = kH = 1) — Sharma, Wu & Dalal,
 * "The CIEDE2000 Color-Difference Formula: Implementation Notes, Supplementary
 * Test Data, and Mathematical Observations", Color Res. Appl. 30(1), 2005.
 */
export function ciede2000(lab1: Vec3, lab2: Vec3): number {
  const [l1, a1, b1] = lab1;
  const [l2, a2, b2] = lab2;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cMean = (c1 + c2) / 2;
  const cMean7 = cMean ** 7;
  const g = 0.5 * (1 - Math.sqrt(cMean7 / (cMean7 + POW7_25)));
  const a1Prime = a1 * (1 + g);
  const a2Prime = a2 * (1 + g);
  const c1Prime = Math.hypot(a1Prime, b1);
  const c2Prime = Math.hypot(a2Prime, b2);
  const h1Prime = c1Prime === 0 ? 0 : ((Math.atan2(b1, a1Prime) / DEG) + 360) % 360;
  const h2Prime = c2Prime === 0 ? 0 : ((Math.atan2(b2, a2Prime) / DEG) + 360) % 360;

  const deltaLPrime = l2 - l1;
  const deltaCPrime = c2Prime - c1Prime;
  let deltaHueAngle = 0;
  if (c1Prime * c2Prime !== 0) {
    const diff = h2Prime - h1Prime;
    if (Math.abs(diff) <= 180) deltaHueAngle = diff;
    else deltaHueAngle = diff > 180 ? diff - 360 : diff + 360;
  }
  const deltaHPrime = 2 * Math.sqrt(c1Prime * c2Prime) * Math.sin((deltaHueAngle / 2) * DEG);

  const lMeanPrime = (l1 + l2) / 2;
  const cMeanPrime = (c1Prime + c2Prime) / 2;
  let hMeanPrime = h1Prime + h2Prime;
  if (c1Prime * c2Prime !== 0) {
    if (Math.abs(h1Prime - h2Prime) <= 180) hMeanPrime = (h1Prime + h2Prime) / 2;
    else if (h1Prime + h2Prime < 360) hMeanPrime = (h1Prime + h2Prime + 360) / 2;
    else hMeanPrime = (h1Prime + h2Prime - 360) / 2;
  }

  const t = 1
    - 0.17 * Math.cos((hMeanPrime - 30) * DEG)
    + 0.24 * Math.cos(2 * hMeanPrime * DEG)
    + 0.32 * Math.cos((3 * hMeanPrime + 6) * DEG)
    - 0.20 * Math.cos((4 * hMeanPrime - 63) * DEG);
  const deltaTheta = 30 * Math.exp(-(((hMeanPrime - 275) / 25) ** 2));
  const cMeanPrime7 = cMeanPrime ** 7;
  const rc = 2 * Math.sqrt(cMeanPrime7 / (cMeanPrime7 + POW7_25));
  const lShift = (lMeanPrime - 50) ** 2;
  const sl = 1 + (0.015 * lShift) / Math.sqrt(20 + lShift);
  const sc = 1 + 0.045 * cMeanPrime;
  const sh = 1 + 0.015 * cMeanPrime * t;
  const rt = -Math.sin(2 * deltaTheta * DEG) * rc;

  const lTerm = deltaLPrime / sl;
  const cTerm = deltaCPrime / sc;
  const hTerm = deltaHPrime / sh;
  return Math.sqrt(lTerm * lTerm + cTerm * cTerm + hTerm * hTerm + rt * cTerm * hTerm);
}

/** Sharma/Wu/Dalal 2005 Table 1 — CIEDE2000 공식 테스트 벡터 전체 34쌍. */
export const CIEDE2000_SHARMA_2005_VECTORS: ReadonlyArray<{
  readonly lab1: Vec3;
  readonly lab2: Vec3;
  readonly expected: number;
}> = [
  { lab1: [50.0, 2.6772, -79.7751], lab2: [50.0, 0.0, -82.7485], expected: 2.0425 },
  { lab1: [50.0, 3.1571, -77.2803], lab2: [50.0, 0.0, -82.7485], expected: 2.8615 },
  { lab1: [50.0, 2.8361, -74.02], lab2: [50.0, 0.0, -82.7485], expected: 3.4412 },
  { lab1: [50.0, -1.3802, -84.2814], lab2: [50.0, 0.0, -82.7485], expected: 1.0 },
  { lab1: [50.0, -1.1848, -84.8006], lab2: [50.0, 0.0, -82.7485], expected: 1.0 },
  { lab1: [50.0, -0.9009, -85.5211], lab2: [50.0, 0.0, -82.7485], expected: 1.0 },
  { lab1: [50.0, 0.0, 0.0], lab2: [50.0, -1.0, 2.0], expected: 2.3669 },
  { lab1: [50.0, -1.0, 2.0], lab2: [50.0, 0.0, 0.0], expected: 2.3669 },
  { lab1: [50.0, 2.49, -0.001], lab2: [50.0, -2.49, 0.0009], expected: 7.1792 },
  { lab1: [50.0, 2.49, -0.001], lab2: [50.0, -2.49, 0.001], expected: 7.1792 },
  { lab1: [50.0, 2.49, -0.001], lab2: [50.0, -2.49, 0.0011], expected: 7.2195 },
  { lab1: [50.0, 2.49, -0.001], lab2: [50.0, -2.49, 0.0012], expected: 7.2195 },
  { lab1: [50.0, -0.001, 2.49], lab2: [50.0, 0.0009, -2.49], expected: 4.8045 },
  { lab1: [50.0, -0.001, 2.49], lab2: [50.0, 0.001, -2.49], expected: 4.8045 },
  { lab1: [50.0, -0.001, 2.49], lab2: [50.0, 0.0011, -2.49], expected: 4.7461 },
  { lab1: [50.0, 2.5, 0.0], lab2: [50.0, 0.0, -2.5], expected: 4.3065 },
  { lab1: [50.0, 2.5, 0.0], lab2: [73.0, 25.0, -18.0], expected: 27.1492 },
  { lab1: [50.0, 2.5, 0.0], lab2: [61.0, -5.0, 29.0], expected: 22.8977 },
  { lab1: [50.0, 2.5, 0.0], lab2: [56.0, -27.0, -3.0], expected: 31.903 },
  { lab1: [50.0, 2.5, 0.0], lab2: [58.0, 24.0, 15.0], expected: 19.4535 },
  { lab1: [50.0, 2.5, 0.0], lab2: [50.0, 3.1736, 0.5854], expected: 1.0 },
  { lab1: [50.0, 2.5, 0.0], lab2: [50.0, 3.2972, 0.0], expected: 1.0 },
  { lab1: [50.0, 2.5, 0.0], lab2: [50.0, 1.8634, 0.5757], expected: 1.0 },
  { lab1: [50.0, 2.5, 0.0], lab2: [50.0, 3.2592, 0.335], expected: 1.0 },
  { lab1: [60.2574, -34.0099, 36.2677], lab2: [60.4626, -34.1751, 39.4387], expected: 1.2644 },
  { lab1: [63.0109, -31.0961, -5.8663], lab2: [62.8187, -29.7946, -4.0864], expected: 1.263 },
  { lab1: [61.2901, 3.7196, -5.3901], lab2: [61.4292, 2.248, -4.962], expected: 1.8731 },
  { lab1: [35.0831, -44.1164, 3.7933], lab2: [35.0232, -40.0716, 1.5901], expected: 1.8645 },
  { lab1: [22.7233, 20.0904, -46.694], lab2: [23.0331, 14.973, -42.5619], expected: 2.0373 },
  { lab1: [36.4612, 47.858, 18.3852], lab2: [36.2715, 50.5065, 21.2231], expected: 1.4146 },
  { lab1: [90.8027, -2.0831, 1.441], lab2: [91.1528, -1.6435, 0.0447], expected: 1.4441 },
  { lab1: [90.9257, -0.5406, -0.9208], lab2: [88.6381, -0.8985, -0.7239], expected: 1.5381 },
  { lab1: [6.7747, -0.2908, -2.4247], lab2: [5.8714, -0.0985, -2.2286], expected: 0.6377 },
  { lab1: [2.0776, 0.0795, -1.135], lab2: [0.9033, -0.0636, -0.5514], expected: 0.9082 },
];

/** 벡터 34쌍에 대한 |구현 − 공표값| 최대치 (공표값은 소수 4자리 반올림 — 허용 1e-4). */
export function ciede2000MaxVectorError(): number {
  let maxError = 0;
  for (const vector of CIEDE2000_SHARMA_2005_VECTORS) {
    const error = Math.abs(ciede2000(vector.lab1, vector.lab2) - vector.expected);
    if (error > maxError) maxError = error;
  }
  return maxError;
}

// ── 스튜디오 자체 변환 (검증 대상 — 참조가 아님) ─────────────────────────────

/**
 * 스튜디오 합성 경로: studioHighBitSrgbToLinear → convertStudioHighBitLinearGamut →
 * studioHighBitLinearToSrgb. studioHighBitSurfaceFromBytes/ToBytes 가 개멋이 다를 때
 * 실제로 밟는 조합과 동일하다(양자화·디더 제외).
 */
export function studioSrgbToDisplayP3(rgb: Vec3): Vec3 {
  const linear: Vec3 = [
    studioHighBitSrgbToLinear(rgb[0]),
    studioHighBitSrgbToLinear(rgb[1]),
    studioHighBitSrgbToLinear(rgb[2]),
  ];
  const p3 = convertStudioHighBitLinearGamut(linear, "srgb", "display-p3");
  return [
    studioHighBitLinearToSrgb(p3[0]),
    studioHighBitLinearToSrgb(p3[1]),
    studioHighBitLinearToSrgb(p3[2]),
  ];
}

export function studioDisplayP3ToSrgb(rgb: Vec3): Vec3 {
  const linear: Vec3 = [
    studioHighBitSrgbToLinear(rgb[0]),
    studioHighBitSrgbToLinear(rgb[1]),
    studioHighBitSrgbToLinear(rgb[2]),
  ];
  const srgb = convertStudioHighBitLinearGamut(linear, "display-p3", "srgb");
  return [
    studioHighBitLinearToSrgb(srgb[0]),
    studioHighBitLinearToSrgb(srgb[1]),
    studioHighBitLinearToSrgb(srgb[2]),
  ];
}

// ── 측정 매트릭스 ────────────────────────────────────────────────────────────

export const GRID_STEPS = 9;
/** 채널당 9단계 8비트 코드 (0..255 균등 반올림) — 9³ = 729 색. */
export const GRID_CODES: readonly number[] = Array.from(
  { length: GRID_STEPS },
  (_, index) => Math.round((index * 255) / (GRID_STEPS - 1)),
);

/** 729 색 그리드 — 부호화 sRGB (f64, 코드/255). */
export function buildGridColors(): Vec3[] {
  const colors: Vec3[] = [];
  for (const r of GRID_CODES) {
    for (const g of GRID_CODES) {
      for (const b of GRID_CODES) {
        colors.push([r / 255, g / 255, b / 255]);
      }
    }
  }
  return colors;
}

export interface DeltaStats {
  readonly max: number;
  readonly mean: number;
  readonly p95: number;
}

export function deltaStats(values: readonly number[]): DeltaStats {
  if (values.length === 0) return { max: 0, mean: 0, p95: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return {
    max: sorted[sorted.length - 1]!,
    mean: sum / sorted.length,
    p95: sorted[p95Index]!,
  };
}

function round6(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Number(value.toPrecision(6));
}

function roundStats(stats: DeltaStats): DeltaStats {
  return { max: round6(stats.max), mean: round6(stats.mean), p95: round6(stats.p95) };
}

/** P3 부호화 공간에서 두 색 배열의 CIEDE2000 통계. */
function p3DeltaStats(reference: readonly Vec3[], candidate: readonly Vec3[]): DeltaStats {
  const deltas = reference.map((ref, index) =>
    ciede2000(encodedToLab(ref, "display-p3"), encodedToLab(candidate[index]!, "display-p3")),
  );
  return deltaStats(deltas);
}

function srgbDeltaStats(reference: readonly Vec3[], candidate: readonly Vec3[]): DeltaStats {
  const deltas = reference.map((ref, index) =>
    ciede2000(encodedToLab(ref, "srgb"), encodedToLab(candidate[index]!, "srgb")),
  );
  return deltaStats(deltas);
}

// ── canvaskit 실측 ───────────────────────────────────────────────────────────

const IMAGE_EDGE = 27; // 27 × 27 = 729

export function gridToRgbaBytes(colors: readonly Vec3[]): Uint8Array {
  const bytes = new Uint8Array(colors.length * 4);
  for (let index = 0; index < colors.length; index += 1) {
    const [r, g, b] = colors[index]!;
    bytes[index * 4] = Math.round(r * 255);
    bytes[index * 4 + 1] = Math.round(g * 255);
    bytes[index * 4 + 2] = Math.round(b * 255);
    bytes[index * 4 + 3] = 255;
  }
  return bytes;
}

function bytesToVec3(bytes: Uint8Array): Vec3[] {
  const colors: Vec3[] = [];
  for (let index = 0; index < bytes.length; index += 4) {
    colors.push([bytes[index]! / 255, bytes[index + 1]! / 255, bytes[index + 2]! / 255]);
  }
  return colors;
}

function floatsToVec3(values: Float32Array): Vec3[] {
  const colors: Vec3[] = [];
  for (let index = 0; index < values.length; index += 4) {
    colors.push([values[index]!, values[index + 1]!, values[index + 2]!]);
  }
  return colors;
}

export interface CanvasKitLane {
  readonly lane: string;
  readonly supported: boolean;
  readonly notes: string;
  /** 참조 sRGB→P3 대비 CIEDE2000 (지원 시). */
  readonly vsReference: DeltaStats | null;
  /** "변환이 실제로 일어났는가" 감별용 — 무변환(항등) 가설 대비 CIEDE2000. */
  readonly vsIdentity: DeltaStats | null;
}

/** sRGB 소스 픽셀을 담은 SRGB 서피스를 만든다 (writePixels — 필터링 없는 정확 배치). */
function makeSrgbSourceSurface(ck: CanvasKit, sourceBytes: Uint8Array): Surface {
  const surface = ck.MakeSurface(IMAGE_EDGE, IMAGE_EDGE);
  if (!surface) throw new Error("color-lab: MakeSurface(SRGB) 실패");
  const wrote = surface.getCanvas().writePixels(
    sourceBytes,
    IMAGE_EDGE,
    IMAGE_EDGE,
    0,
    0,
    ck.AlphaType.Unpremul,
    ck.ColorType.RGBA_8888,
    ck.ColorSpace.SRGB,
  );
  if (!wrote) {
    surface.dispose();
    throw new Error("color-lab: SRGB writePixels 실패");
  }
  surface.flush();
  return surface;
}

export function laneReadPixels(
  ck: CanvasKit,
  sourceBytes: Uint8Array,
  sourceColors: readonly Vec3[],
  referenceP3: readonly Vec3[],
  colorType: "rgba8888" | "rgbaF32",
): CanvasKitLane {
  const lane = `srgb-surface-readPixels-dst-display-p3-${colorType}`;
  const surface = makeSrgbSourceSurface(ck, sourceBytes);
  try {
    const pixels = surface.getCanvas().readPixels(0, 0, {
      width: IMAGE_EDGE,
      height: IMAGE_EDGE,
      colorType: colorType === "rgba8888" ? ck.ColorType.RGBA_8888 : ck.ColorType.RGBA_F32,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.DISPLAY_P3,
    });
    if (!pixels) {
      return {
        lane,
        supported: false,
        notes: "readPixels 가 null 반환 — 이 빌드의 CPU 래스터가 해당 dst 조합을 거부",
        vsReference: null,
        vsIdentity: null,
      };
    }
    const candidate = pixels instanceof Float32Array
      ? floatsToVec3(pixels)
      : bytesToVec3(new Uint8Array(pixels as Uint8Array));
    const vsReference = p3DeltaStats(referenceP3, candidate);
    const vsIdentity = p3DeltaStats(sourceColors, candidate);
    const converted = vsIdentity.max > vsReference.max;
    return {
      lane,
      supported: converted,
      notes: converted
        ? "readPixels(dstColorSpace=DISPLAY_P3) 색변환 실측 확정"
        : "readPixels 는 성공했지만 출력이 입력과 항등 — 색변환 미수행으로 판정",
      vsReference,
      vsIdentity,
    };
  } finally {
    surface.dispose();
  }
}

export function laneRasterDirectP3(
  ck: CanvasKit,
  sourceBytes: Uint8Array,
  sourceColors: readonly Vec3[],
  referenceP3: readonly Vec3[],
): CanvasKitLane {
  const lane = "MakeRasterDirectSurface-display-p3-rgba8888";
  const pixelBuffer = ck.Malloc(Uint8Array, IMAGE_EDGE * IMAGE_EDGE * 4);
  try {
    let alphaTypeUsed = "Unpremul";
    let surface = ck.MakeRasterDirectSurface(
      {
        width: IMAGE_EDGE,
        height: IMAGE_EDGE,
        colorType: ck.ColorType.RGBA_8888,
        alphaType: ck.AlphaType.Unpremul,
        colorSpace: ck.ColorSpace.DISPLAY_P3,
      },
      pixelBuffer,
      IMAGE_EDGE * 4,
    );
    if (!surface) {
      // 래스터 렌더 타깃은 premul 을 요구할 수 있다 — alpha 255 소스라 값은 동일하다.
      alphaTypeUsed = "Premul";
      surface = ck.MakeRasterDirectSurface(
        {
          width: IMAGE_EDGE,
          height: IMAGE_EDGE,
          colorType: ck.ColorType.RGBA_8888,
          alphaType: ck.AlphaType.Premul,
          colorSpace: ck.ColorSpace.DISPLAY_P3,
        },
        pixelBuffer,
        IMAGE_EDGE * 4,
      );
    }
    if (!surface) {
      return {
        lane,
        supported: false,
        notes: "MakeRasterDirectSurface(DISPLAY_P3) 가 Unpremul/Premul 모두 null — P3 서피스 생성 불가",
        vsReference: null,
        vsIdentity: null,
      };
    }
    try {
      const wrote = surface.getCanvas().writePixels(
        sourceBytes,
        IMAGE_EDGE,
        IMAGE_EDGE,
        0,
        0,
        ck.AlphaType.Unpremul,
        ck.ColorType.RGBA_8888,
        ck.ColorSpace.SRGB,
      );
      if (!wrote) {
        return {
          lane,
          supported: false,
          notes: `P3 서피스(${alphaTypeUsed}) 생성은 성공했으나 SRGB writePixels 실패`,
          vsReference: null,
          vsIdentity: null,
        };
      }
      surface.flush();
      const candidate = bytesToVec3(
        new Uint8Array(pixelBuffer.toTypedArray() as Uint8Array),
      );
      const vsReference = p3DeltaStats(referenceP3, candidate);
      const vsIdentity = p3DeltaStats(sourceColors, candidate);
      const converted = vsIdentity.max > vsReference.max;
      return {
        lane,
        supported: converted,
        notes: converted
          ? `MakeRasterDirectSurface(ImageInfo{colorSpace: DISPLAY_P3, alphaType: ${alphaTypeUsed}}) P3 서피스 실측 확정 — 쓰기 시 SRGB→P3 변환 수행`
          : "P3 서피스 쓰기는 성공했지만 출력이 입력과 항등 — 색변환 미수행으로 판정",
        vsReference,
        vsIdentity,
      };
    } finally {
      surface.dispose();
    }
  } finally {
    ck.Free(pixelBuffer);
  }
}

/** canvaskit 왕복: sRGB 바이트 → (dst P3 readPixels) → P3 바이트 → SRGB 서피스로 재기록 → 읽기. */
function canvasKitRoundtrip(
  ck: CanvasKit,
  sourceBytes: Uint8Array,
  sourceColors: readonly Vec3[],
): DeltaStats | null {
  const p3Bytes = ((): Uint8Array | null => {
    const srgbSurface = makeSrgbSourceSurface(ck, sourceBytes);
    try {
      const pixels = srgbSurface.getCanvas().readPixels(0, 0, {
        width: IMAGE_EDGE,
        height: IMAGE_EDGE,
        colorType: ck.ColorType.RGBA_8888,
        alphaType: ck.AlphaType.Unpremul,
        colorSpace: ck.ColorSpace.DISPLAY_P3,
      });
      return pixels ? new Uint8Array(pixels as Uint8Array) : null;
    } finally {
      srgbSurface.dispose();
    }
  })();
  if (!p3Bytes) return null;
  const backSurface = ck.MakeSurface(IMAGE_EDGE, IMAGE_EDGE);
  if (!backSurface) return null;
  try {
    const wrote = backSurface.getCanvas().writePixels(
      p3Bytes,
      IMAGE_EDGE,
      IMAGE_EDGE,
      0,
      0,
      ck.AlphaType.Unpremul,
      ck.ColorType.RGBA_8888,
      ck.ColorSpace.DISPLAY_P3,
    );
    if (!wrote) return null;
    backSurface.flush();
    const roundtripPixels = backSurface.getCanvas().readPixels(0, 0, {
      width: IMAGE_EDGE,
      height: IMAGE_EDGE,
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.SRGB,
    });
    if (!roundtripPixels) return null;
    const candidate = bytesToVec3(new Uint8Array(roundtripPixels as Uint8Array));
    return srgbDeltaStats(sourceColors, candidate);
  } finally {
    backSurface.dispose();
  }
}

// ── 실행 ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const vectorError = ciede2000MaxVectorError();
  if (vectorError > 1e-4) {
    throw new Error(
      `color-lab: CIEDE2000 자체 검증 실패 — Sharma 2005 벡터 최대 오차 ${vectorError}`,
    );
  }

  const gridColors = buildGridColors();
  const referenceP3 = gridColors.map(referenceSrgbToDisplayP3);

  // 참조 f64 왕복 (sRGB→P3→sRGB) — 행렬/전달 함수 자기일관성.
  const referenceRoundtrip = srgbDeltaStats(
    gridColors,
    referenceP3.map(referenceDisplayP3ToSrgb),
  );

  // 스튜디오 자체 변환 vs 참조 + 스튜디오 왕복.
  const studioP3 = gridColors.map(studioSrgbToDisplayP3);
  const studioVsReference = p3DeltaStats(referenceP3, studioP3);
  const studioRoundtrip = srgbDeltaStats(gridColors, studioP3.map(studioDisplayP3ToSrgb));

  // 8비트 양자화 바닥 — 8888 레인이 물리적으로 넘을 수 없는 하한(정직성 맥락).
  const quantizedReferenceP3: Vec3[] = referenceP3.map((rgb) => [
    Math.round(Math.min(1, Math.max(0, rgb[0])) * 255) / 255,
    Math.round(Math.min(1, Math.max(0, rgb[1])) * 255) / 255,
    Math.round(Math.min(1, Math.max(0, rgb[2])) * 255) / 255,
  ]);
  const quantizationFloor = p3DeltaStats(referenceP3, quantizedReferenceP3);

  // canvaskit 실측 — 어떤 표면/경로가 실제 지원되는지 실행으로 확정.
  const ck = await loadCanvasKitNode();
  const sourceBytes = gridToRgbaBytes(gridColors);
  const lanes: CanvasKitLane[] = [
    laneReadPixels(ck, sourceBytes, gridColors, referenceP3, "rgba8888"),
    laneReadPixels(ck, sourceBytes, gridColors, referenceP3, "rgbaF32"),
    laneRasterDirectP3(ck, sourceBytes, gridColors, referenceP3),
  ];
  const ckRoundtrip = canvasKitRoundtrip(ck, sourceBytes, gridColors);

  const report = {
    harness: "tests/benchmarks/harness/color-lab.ts",
    generatedAt: new Date().toISOString(),
    host: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model, node: process.version },
    environment: {
      concurrentLoad:
        "24h 소크 벤치가 같은 호스트에서 병행 중 — 이 랩은 수치 정확도만 계측하며 타이밍 비의존이라 결과에 영향 없음",
    },
    reference: {
      transfer: "IEC 61966-2-1 piecewise sRGB EOTF/OETF (f64, 부호 보존 확장)",
      matrices:
        "CSS Color 4 'Sample code for Color Conversions' 유리수 행렬 — sRGB(IEC 61966-2-1)/Display-P3(SMPTE RP 431-2) 원색 + D65, Bradford 순응 없음",
      deltaE: "CIEDE2000 (Sharma/Wu/Dalal 2005), kL=kC=kH=1, CIELAB D65",
    },
    ciede2000Validation: {
      pairs: CIEDE2000_SHARMA_2005_VECTORS.length,
      maxAbsError: round6(vectorError),
      tolerance: 1e-4,
    },
    grid: { steps: GRID_STEPS, colors: gridColors.length, codes: [...GRID_CODES] },
    studioTargets: [
      "apps/web/src/domains/creator/studio-highbit-transfer.ts (studioHighBitSrgbToLinear / studioHighBitLinearToSrgb)",
      "apps/web/src/domains/creator/studio-highbit-colorspace.ts (convertStudioHighBitLinearGamut — STUDIO_HIGHBIT_SRGB_TO_DISPLAY_P3 / _DISPLAY_P3_TO_SRGB)",
    ],
    measurements: {
      quantization8bitFloorDeltaE00: roundStats(quantizationFloor),
      studioComposedVsReferenceDeltaE00: roundStats(studioVsReference),
      canvaskit: lanes.map((laneResult) => ({
        lane: laneResult.lane,
        supported: laneResult.supported,
        notes: laneResult.notes,
        vsReferenceDeltaE00: laneResult.vsReference ? roundStats(laneResult.vsReference) : null,
        vsIdentityDeltaE00: laneResult.vsIdentity ? roundStats(laneResult.vsIdentity) : null,
      })),
    },
    roundtripDeltaE00: {
      referenceF64: roundStats(referenceRoundtrip),
      studioComposedF64: roundStats(studioRoundtrip),
      canvaskitRgba8888: ckRoundtrip ? roundStats(ckRoundtrip) : null,
    },
  };

  await mkdir(RESULTS_DIR, { recursive: true });
  const target = join(RESULTS_DIR, "color-lab.json");
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`CIEDE2000 Sharma 2005 vectors: ${report.ciede2000Validation.pairs} pairs, max |err| ${report.ciede2000Validation.maxAbsError}`);
  console.log(`reference roundtrip dE00 max ${report.roundtripDeltaE00.referenceF64.max}`);
  console.log(`studio vs reference dE00 max ${report.measurements.studioComposedVsReferenceDeltaE00.max}`);
  for (const laneResult of report.measurements.canvaskit) {
    console.log(
      `${laneResult.lane}: supported=${laneResult.supported} vsRef max ${laneResult.vsReferenceDeltaE00?.max ?? "n/a"} (identity max ${laneResult.vsIdentityDeltaE00?.max ?? "n/a"})`,
    );
  }
  console.log(`written: ${target}`);
}

const executedDirectly =
  typeof process.argv[1] === "string"
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executedDirectly) await main();
