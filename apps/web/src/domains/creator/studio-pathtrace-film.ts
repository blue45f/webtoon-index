/**
 * Studio Path Tracer — 프로그레시브 필름 + 색 관리 (studio-pathtrace-film)
 *
 * 누적
 *  - `accum`(3*N f32)에 선형 radiance 를 더하고 `sampleCount`(N u32)로 나눈다.
 *  - **가산만** 하므로 타일/워커를 어떤 순서로 돌리든 픽셀별 결과가 같다. 단, f32
 *    덧셈은 결합법칙이 없으므로 계약은 "픽셀마다 sampleIndex 오름차순 누적"이다
 *    (한 픽셀은 항상 한 타일이 소유하므로 타일 순서·크기와 무관하게 성립한다).
 *
 * 색 관리
 *  - 파이프라인 내부는 **전 구간 선형**이다. 노출 → 톤맵 → linear→sRGB → 8bit 양자화
 *    순서로 출력 직전에 한 번만 변환한다.
 *  - `linearToSrgb` 는 studio-palette-interchange 의 상수와 동일하다
 *    (v ≤ 0.0031308 ? 12.92v : 1.055·v^(1/2.4) − 0.055). 계약 테스트가 왕복 검증한다.
 *
 * 정직한 한계
 *  - 필터 커널 없음(box 재구성만). Mitchell/Gaussian 픽셀 필터, 적응 샘플링,
 *    디노이저 전부 미구현 — 노이즈는 spp 로만 줄인다.
 *  - firefly 클램프는 인테그레이터 옵션이며 필름 단계에는 없다.
 *  - ACES 는 Narkowicz 근사(RRT+ODT fit)라 실제 ACES 파이프라인과 다르다.
 */

import type { StudioBg3dToneMapping } from "./bg3d/studio-bg3d-scene-document";

export type StudioPathtraceToneMap = "none" | "reinhard" | "aces";

export interface StudioPathtraceFilm {
  readonly width: number;
  readonly height: number;
  /** 3*width*height, 선형 radiance 합. */
  readonly accum: Float32Array;
  /** width*height, 픽셀별 누적 샘플 수. */
  readonly sampleCount: Uint32Array;
}

export interface StudioPathtraceResolveOptions {
  /** 선형 배율(스톱이 아니라 곱). 기본 1. */
  readonly exposure?: number;
  readonly toneMap?: StudioPathtraceToneMap;
}

export function createStudioPathtraceFilm(width: number, height: number): StudioPathtraceFilm {
  const pixels = width * height;
  return {
    width,
    height,
    accum: new Float32Array(pixels * 3),
    sampleCount: new Uint32Array(pixels),
  };
}

export function resetStudioPathtraceFilm(film: StudioPathtraceFilm): void {
  film.accum.fill(0);
  film.sampleCount.fill(0);
}

/** 픽셀에 선형 radiance 한 샘플을 더한다. NaN/Inf 는 0 으로 흡수한다(필름 오염 방지). */
export function accumulateStudioPathtraceSample(
  film: StudioPathtraceFilm,
  pixelIndex: number,
  r: number,
  g: number,
  b: number,
): void {
  const i = pixelIndex * 3;
  film.accum[i] += Number.isFinite(r) ? r : 0;
  film.accum[i + 1] += Number.isFinite(g) ? g : 0;
  film.accum[i + 2] += Number.isFinite(b) ? b : 0;
  film.sampleCount[pixelIndex] += 1;
}

/** 픽셀의 현재 평균 선형 radiance. out ← [r, g, b]. */
export function readStudioPathtraceFilmPixel(
  film: StudioPathtraceFilm,
  pixelIndex: number,
  out: Float64Array | number[],
): void {
  const n = film.sampleCount[pixelIndex];
  if (n === 0) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return;
  }
  const i = pixelIndex * 3;
  out[0] = film.accum[i] / n;
  out[1] = film.accum[i + 1] / n;
  out[2] = film.accum[i + 2] / n;
}

// ---------------------------------------------------------------------------
// 색 변환
// ---------------------------------------------------------------------------

/** 선형 → sRGB 전달함수(studio-palette-interchange 와 동일 상수). */
export function studioPathtraceLinearToSrgb(value: number): number {
  if (!(value > 0)) return 0;
  if (value >= 1) return 1;
  return value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}

/** sRGB → 선형(역함수). */
export function studioPathtraceSrgbToLinear(value: number): number {
  if (!(value > 0)) return 0;
  if (value >= 1) return 1;
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

/** Reinhard: x/(1+x). 0→0, 단조 증가, 1 로 점근. */
export function studioPathtraceToneMapReinhard(value: number): number {
  if (!(value > 0)) return 0;
  return value / (1 + value);
}

/** Narkowicz ACES 필믹 근사. */
export function studioPathtraceToneMapAces(value: number): number {
  if (!(value > 0)) return 0;
  const a = 2.51;
  const b = 0.03;
  const c = 2.43;
  const d = 0.59;
  const e = 0.14;
  const mapped = (value * (a * value + b)) / (value * (c * value + d) + e);
  return mapped < 0 ? 0 : mapped > 1 ? 1 : mapped;
}

export function applyStudioPathtraceToneMap(value: number, toneMap: StudioPathtraceToneMap): number {
  if (toneMap === "reinhard") return studioPathtraceToneMapReinhard(value);
  if (toneMap === "aces") return studioPathtraceToneMapAces(value);
  return value;
}

/**
 * bg3d 렌더 설정의 톤맵 이름 → 패스트레이서 톤맵.
 * bg3d 의 `"neutral"`(three.js Khronos PBR Neutral)은 구현하지 않았고 가장 가까운
 * 거동인 Reinhard 로 사상한다 — 결과가 three.js 프리뷰와 정확히 같지 않다(정직한 한계).
 */
export function studioPathtraceToneMapFromBg3d(toneMapping: StudioBg3dToneMapping): StudioPathtraceToneMap {
  if (toneMapping === "aces") return "aces";
  if (toneMapping === "neutral") return "reinhard";
  return "none";
}

/**
 * 필름 → RGBA8. 알파는 항상 255(패스트레이스 결과는 불투명 레이어로 삽입된다).
 * 샘플이 없는 픽셀은 검정으로 남는다.
 */
export function resolveStudioPathtraceFilm(
  film: StudioPathtraceFilm,
  options: StudioPathtraceResolveOptions = {},
): Uint8ClampedArray {
  const exposure = options.exposure === undefined ? 1 : options.exposure;
  const toneMap = options.toneMap ?? "none";
  const pixels = film.width * film.height;
  const out = new Uint8ClampedArray(pixels * 4);
  for (let p = 0; p < pixels; p += 1) {
    const n = film.sampleCount[p];
    const inv = n === 0 ? 0 : 1 / n;
    for (let c = 0; c < 3; c += 1) {
      const linear = film.accum[p * 3 + c] * inv * exposure;
      const mapped = applyStudioPathtraceToneMap(linear, toneMap);
      const srgb = studioPathtraceLinearToSrgb(mapped);
      out[p * 4 + c] = Math.round(srgb * 255);
    }
    out[p * 4 + 3] = 255;
  }
  return out;
}
