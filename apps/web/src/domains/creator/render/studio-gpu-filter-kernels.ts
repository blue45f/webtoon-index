/**
 * Studio GPU Filter Kernels (엔진 로드맵 M1)
 * 가장 사용 빈도가 높은 5개 이미지 보정(밝기/대비 · HSL · 레벨 · 톤 커브 · 컬러 밸런스)의
 * WGSL 컴퓨트 셰이더 소스와 TS 파라미터 패커를 한 모듈에 모았다.
 *
 * 비트 충실도 설계:
 *  - 픽셀은 rgba8 바이트를 u32 로 패킹한 storage buffer 로 다루고, WGSL 안에서 CPU 필터와
 *    동일한 0..255 "바이트 공간" 수식을 그대로 계산한다(텍스처 unorm 변환의 반올림 규칙에
 *    의존하지 않는다). 스테이지 경계의 양자화는 `clamp(round(v), 0, 255)` — WGSL `round` 는
 *    round-half-to-even 이라 Uint8ClampedArray 대입의 반올림 규칙과 일치한다.
 *  - 밝기/대비·레벨/커브는 전부 바이트→바이트 사상이라 CPU 쪽에서 정확한 256칸 LUT 를 굽고
 *    그 바이트를 GPU 로 올린다(lut3 커널) — LUT 매핑은 순수 정수 조회라 CPU 결과와 비트
 *    단위로 동일하다. 레벨/커브는 CPU 엔진(studio-levels / studio-curves)의 LUT 빌더를
 *    **그대로 호출**하고, 밝기/대비는 nativeBrighten→nativeContrast 를 스테이지 사이
 *    Uint8ClampedArray 양자화까지 포함해 f64 로 재현한 LUT 를 굽는다.
 *  - HSL·컬러밸런스 계수는 패커가 CPU 와 동일한 f64 수식으로 미리 계산해 uniform 에
 *    싣는다. 픽셀별 잔여 연산만 f32 라 최대 채널 오차는 반올림 경계에서 ±1 수준이다.
 *
 * CPU 원본(수식 출처, 그대로 복제):
 *  - 밝기/대비: studio-konva-native-filters.ts nativeBrighten / nativeContrast (Konva verbatim,
 *    두 스테이지 사이 Uint8ClampedArray 재양자화 포함 — LUT 로 정확 재현)
 *  - HSL: studio-konva-native-filters.ts nativeHSL (Konva verbatim)
 *  - 레벨: studio-levels.ts buildChannelLevelsLuts
 *  - 커브: studio-curves.ts buildCurveChannelLuts
 *  - 컬러 밸런스: studio-color-balance.ts applyColorBalance (GAIN 1.275 포함)
 *
 * Konva/DOM 의존 없음 — node 구조 테스트와 브라우저 GPU 경로가 공유한다.
 */

import { normalizeColorBalance } from "../studio-color-balance";
import { buildCurveChannelLuts, normalizeCurve } from "../studio-curves";
import { buildChannelLevelsLuts } from "../studio-levels";

import type { ColorBalance } from "../studio-color-balance";
import type { CurvePoint, CurveRgbChannels } from "../studio-curves";
import type { LevelsParams, LevelsRgbChannels } from "../studio-levels";

// ---------------------------------------------------------------------------
// 공용 상수 — 디스패치 좌표계·바인딩 인덱스·uniform 레이아웃 오프셋
// ---------------------------------------------------------------------------

/** WGSL `@workgroup_size` 리터럴과 반드시 일치해야 한다(구조 테스트가 대조). */
export const STUDIO_GPU_FILTER_WORKGROUP_SIZE = 64;

/**
 * 1 디스패치 행(row)이 담당하는 스레드 수 — WGSL 의 `16384u` 리터럴과 일치.
 * dispatchWorkgroups(x=ROW_THREADS/WORKGROUP_SIZE, y=ceil(pixelCount/ROW_THREADS)) 로
 * 16MP 이상 이미지도 maxComputeWorkgroupsPerDimension(65535) 안에서 처리한다.
 */
export const STUDIO_GPU_FILTER_DISPATCH_ROW_THREADS = 16384;

/** 모든 커널이 공유하는 bind group 0 바인딩 인덱스(WGSL `@binding(n)` 과 일치). */
export const STUDIO_GPU_FILTER_BINDINGS = {
  src: 0,
  dst: 1,
  params: 2,
  lut: 3,
} as const;

/** 모든 uniform 의 첫 4바이트는 pixelCount(u32 LE) — 패커는 0 자리표시자를 쓴다. */
export const STUDIO_GPU_FILTER_PIXEL_COUNT_OFFSET = 0;

/** HSL uniform — 행렬 3행(vec4: 계수 3개 + luminance 오프셋). */
export const STUDIO_GPU_HSL_OFFSETS = { rowR: 16, rowG: 32, rowB: 48 } as const;
export const STUDIO_GPU_HSL_UNIFORM_BYTES = 64;

/** 밝기대비/레벨/커브(lut3) 공용 uniform — pixelCount 뿐(16바이트 패딩). */
export const STUDIO_GPU_LUT3_UNIFORM_BYTES = 16;
/** lut3 스토리지 버퍼 엔트리 수 — r 0..255, g 256..511, b 512..767. */
export const STUDIO_GPU_LUT3_ENTRY_COUNT = 768;

/** 컬러 밸런스 uniform — shadows/midtones/highlights 각 vec4(w 미사용). */
export const STUDIO_GPU_COLOR_BALANCE_OFFSETS = {
  shadows: 16,
  midtones: 32,
  highlights: 48,
} as const;
export const STUDIO_GPU_COLOR_BALANCE_UNIFORM_BYTES = 64;

// ---------------------------------------------------------------------------
// WGSL 소스 — 각 소스는 독립 컴파일 단위(공통 헬퍼 텍스트를 각자 포함)
// ---------------------------------------------------------------------------

// 0..255 바이트 공간 공통 헬퍼. round() 는 round-half-to-even —
// Uint8ClampedArray 대입(ECMAScript ToUint8Clamp)과 동일한 타이 규칙이다.
const WGSL_BYTE_HELPERS = /* wgsl */ `
fn studio_unpack_r(texel : u32) -> f32 { return f32(texel & 0xffu); }
fn studio_unpack_g(texel : u32) -> f32 { return f32((texel >> 8u) & 0xffu); }
fn studio_unpack_b(texel : u32) -> f32 { return f32((texel >> 16u) & 0xffu); }
fn studio_unpack_a(texel : u32) -> u32 { return (texel >> 24u) & 0xffu; }

fn studio_quantize_byte(value : f32) -> u32 {
  return u32(clamp(round(value), 0.0, 255.0));
}

fn studio_repack(r : u32, g : u32, b : u32, a : u32) -> u32 {
  return r | (g << 8u) | (b << 16u) | (a << 24u);
}
`;

// gid → 선형 픽셀 인덱스. dispatch 는 (256, ceil(pixelCount/16384)) 2D 그리드.
const WGSL_INDEX_EXPR = "gid.y * 16384u + gid.x";

/**
 * ② HSL — nativeHSL 의 3×3 색 행렬 + luminance 오프셋. 행렬 계수는 패커가 CPU 와 동일한
 * f64 수식(2^saturation, cos/sin)으로 계산해 uniform 에 싣고, 픽셀별로는 dot 만 수행한다.
 * 각 행 vec4 의 w 성분이 luminance 오프셋(l) — dot(vec4(r,g,b,1), row) = 행렬곱 + l.
 */
const WGSL_HSL = /* wgsl */ `
struct Params {
  pixel_count : u32,
  _pad0 : u32,
  _pad1 : u32,
  _pad2 : u32,
  row_r : vec4<f32>,
  row_g : vec4<f32>,
  row_b : vec4<f32>,
}

@group(0) @binding(0) var<storage, read> src : array<u32>;
@group(0) @binding(1) var<storage, read_write> dst : array<u32>;
@group(0) @binding(2) var<uniform> params : Params;
${WGSL_BYTE_HELPERS}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = ${WGSL_INDEX_EXPR};
  if (i >= params.pixel_count) { return; }
  let texel = src[i];
  let p = vec4<f32>(
    studio_unpack_r(texel),
    studio_unpack_g(texel),
    studio_unpack_b(texel),
    1.0,
  );
  dst[i] = studio_repack(
    studio_quantize_byte(dot(p, params.row_r)),
    studio_quantize_byte(dot(p, params.row_g)),
    studio_quantize_byte(dot(p, params.row_b)),
    studio_unpack_a(texel),
  );
}
`;

/**
 * ①③④ 밝기대비/레벨/커브 공용 lut3 — 채널별 256칸 LUT 순수 정수 조회(data[i] = lut[data[i]]).
 * LUT 바이트는 CPU 빌더가 만든 것을 그대로 올리므로 결과는 CPU 와 비트 단위로 동일하다.
 * 인접한 lut3 스텝들은 plan 단계에서 LUT 합성으로 한 디스패치에 융합된다("lut-fused").
 */
const WGSL_LUT3 = /* wgsl */ `
struct Params {
  pixel_count : u32,
  _pad0 : u32,
  _pad1 : u32,
  _pad2 : u32,
}

@group(0) @binding(0) var<storage, read> src : array<u32>;
@group(0) @binding(1) var<storage, read_write> dst : array<u32>;
@group(0) @binding(2) var<uniform> params : Params;
@group(0) @binding(3) var<storage, read> lut : array<u32>;
${WGSL_BYTE_HELPERS}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = ${WGSL_INDEX_EXPR};
  if (i >= params.pixel_count) { return; }
  let texel = src[i];
  let r = texel & 0xffu;
  let g = (texel >> 8u) & 0xffu;
  let b = (texel >> 16u) & 0xffu;
  dst[i] = studio_repack(
    lut[r] & 0xffu,
    lut[256u + g] & 0xffu,
    lut[512u + b] & 0xffu,
    studio_unpack_a(texel),
  );
}
`;

/**
 * ⑤ 컬러 밸런스 — applyColorBalance verbatim: 휘도 t 로 그림자/중간톤/하이라이트 가중치를
 * 섞어 채널별 쉬프트. GAIN 1.275 는 CPU 의 COLOR_BALANCE_GAIN 과 동일한 상수다.
 */
const WGSL_COLOR_BALANCE = /* wgsl */ `
struct Params {
  pixel_count : u32,
  _pad0 : u32,
  _pad1 : u32,
  _pad2 : u32,
  shadows : vec4<f32>,
  midtones : vec4<f32>,
  highlights : vec4<f32>,
}

@group(0) @binding(0) var<storage, read> src : array<u32>;
@group(0) @binding(1) var<storage, read_write> dst : array<u32>;
@group(0) @binding(2) var<uniform> params : Params;

const STUDIO_COLOR_BALANCE_GAIN : f32 = 1.275;
${WGSL_BYTE_HELPERS}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = ${WGSL_INDEX_EXPR};
  if (i >= params.pixel_count) { return; }
  let texel = src[i];
  let r = studio_unpack_r(texel);
  let g = studio_unpack_g(texel);
  let b = studio_unpack_b(texel);
  let t = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
  let sw = (1.0 - t) * (1.0 - t);
  let hw = t * t;
  let mid = 2.0 * t - 1.0;
  let mw = max(0.0, 1.0 - mid * mid);
  let shift_r = (sw * params.shadows.x + mw * params.midtones.x + hw * params.highlights.x)
    * STUDIO_COLOR_BALANCE_GAIN;
  let shift_g = (sw * params.shadows.y + mw * params.midtones.y + hw * params.highlights.y)
    * STUDIO_COLOR_BALANCE_GAIN;
  let shift_b = (sw * params.shadows.z + mw * params.midtones.z + hw * params.highlights.z)
    * STUDIO_COLOR_BALANCE_GAIN;
  dst[i] = studio_repack(
    studio_quantize_byte(r + shift_r),
    studio_quantize_byte(g + shift_g),
    studio_quantize_byte(b + shift_b),
    studio_unpack_a(texel),
  );
}
`;

// ---------------------------------------------------------------------------
// 커널 스펙 레지스트리
// ---------------------------------------------------------------------------

export type StudioGpuFilterKernelId =
  | "brightness-contrast"
  | "hsl"
  | "levels"
  | "curves"
  | "color-balance"
  /** 인접 LUT 스텝들을 plan 이 하나로 합성한 결과 — 스펙은 lut3 와 동일하다. */
  | "lut-fused";

export interface StudioGpuFilterKernelSpec {
  readonly id: StudioGpuFilterKernelId;
  /** 파이프라인 캐시 키 — 레벨/커브는 동일 lut3 셰이더를 공유해 파이프라인 1개만 만든다. */
  readonly shaderId: string;
  readonly wgsl: string;
  readonly entryPoint: "main";
  /** true 면 binding(3) 에 768칸 u32 LUT 스토리지 버퍼가 필요하다. */
  readonly usesLut: boolean;
  readonly uniformByteLength: number;
}

export const STUDIO_GPU_FILTER_KERNELS: Record<StudioGpuFilterKernelId, StudioGpuFilterKernelSpec> = {
  "brightness-contrast": {
    id: "brightness-contrast",
    shaderId: "studio-gpu-filter/lut3",
    wgsl: WGSL_LUT3,
    entryPoint: "main",
    usesLut: true,
    uniformByteLength: STUDIO_GPU_LUT3_UNIFORM_BYTES,
  },
  hsl: {
    id: "hsl",
    shaderId: "studio-gpu-filter/hsl",
    wgsl: WGSL_HSL,
    entryPoint: "main",
    usesLut: false,
    uniformByteLength: STUDIO_GPU_HSL_UNIFORM_BYTES,
  },
  levels: {
    id: "levels",
    shaderId: "studio-gpu-filter/lut3",
    wgsl: WGSL_LUT3,
    entryPoint: "main",
    usesLut: true,
    uniformByteLength: STUDIO_GPU_LUT3_UNIFORM_BYTES,
  },
  curves: {
    id: "curves",
    shaderId: "studio-gpu-filter/lut3",
    wgsl: WGSL_LUT3,
    entryPoint: "main",
    usesLut: true,
    uniformByteLength: STUDIO_GPU_LUT3_UNIFORM_BYTES,
  },
  "color-balance": {
    id: "color-balance",
    shaderId: "studio-gpu-filter/color-balance",
    wgsl: WGSL_COLOR_BALANCE,
    entryPoint: "main",
    usesLut: false,
    uniformByteLength: STUDIO_GPU_COLOR_BALANCE_UNIFORM_BYTES,
  },
  "lut-fused": {
    id: "lut-fused",
    shaderId: "studio-gpu-filter/lut3",
    wgsl: WGSL_LUT3,
    entryPoint: "main",
    usesLut: true,
    uniformByteLength: STUDIO_GPU_LUT3_UNIFORM_BYTES,
  },
};

// ---------------------------------------------------------------------------
// 파라미터 패커 — buildImageFilters 와 동일한 활성 판정/클램프/수식(f64)을 복제한다.
// ---------------------------------------------------------------------------

// buildImageFilters 의 isActiveNumber / clampFinite 복제(비공개 함수라 재구현).
function isActiveNumber(value: number | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value !== 0;
}

function clampFinite(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** uniform 의 pixelCount(u32 LE, offset 0)를 실제 픽셀 수로 패치한다(apply 가 이미지별 호출). */
export function patchStudioGpuFilterPixelCount(uniform: ArrayBuffer, pixelCount: number): void {
  new DataView(uniform).setUint32(STUDIO_GPU_FILTER_PIXEL_COUNT_OFFSET, pixelCount >>> 0, true);
}

/**
 * ② HSL — buildImageFilters 의 attrs 계산(saturation 클램프 -1..1, hue 0..359 래핑,
 * luminance 항상 0) 뒤 nativeHSL 의 행렬 계수 수식 verbatim. 계수는 f64 로 계산해 f32 로
 * 저장하므로 GPU 픽셀 연산은 dot 한 번만 남는다.
 */
export function packStudioGpuHslParams(input: {
  saturation?: number;
  hue?: number;
  luminance?: number;
}): ArrayBuffer {
  const saturationAttr = isActiveNumber(input.saturation) ? clampFinite(input.saturation!, -1, 1) : 0;
  const hueAttr = isActiveNumber(input.hue) ? (((input.hue! % 360) + 360) % 360) : 0;
  const luminanceAttr = typeof input.luminance === "number" && Number.isFinite(input.luminance)
    ? input.luminance
    : 0;

  // nativeHSL verbatim.
  const v = 1;
  const s = Math.pow(2, saturationAttr);
  const h = Math.abs(hueAttr + 360) % 360;
  const l = luminanceAttr * 127;
  const vsu = v * s * Math.cos((h * Math.PI) / 180);
  const vsw = v * s * Math.sin((h * Math.PI) / 180);
  const rr = 0.299 * v + 0.701 * vsu + 0.167 * vsw;
  const rg = 0.587 * v - 0.587 * vsu + 0.33 * vsw;
  const rb = 0.114 * v - 0.114 * vsu - 0.497 * vsw;
  const gr = 0.299 * v - 0.299 * vsu - 0.328 * vsw;
  const gg = 0.587 * v + 0.413 * vsu + 0.035 * vsw;
  const gb = 0.114 * v - 0.114 * vsu + 0.293 * vsw;
  const br = 0.299 * v - 0.3 * vsu + 1.25 * vsw;
  const bg = 0.587 * v - 0.586 * vsu - 1.05 * vsw;
  const bb = 0.114 * v + 0.886 * vsu - 0.2 * vsw;

  const uniform = new ArrayBuffer(STUDIO_GPU_HSL_UNIFORM_BYTES);
  const view = new DataView(uniform);
  const writeRow = (offset: number, c0: number, c1: number, c2: number) => {
    view.setFloat32(offset, c0, true);
    view.setFloat32(offset + 4, c1, true);
    view.setFloat32(offset + 8, c2, true);
    view.setFloat32(offset + 12, l, true);
  };
  writeRow(STUDIO_GPU_HSL_OFFSETS.rowR, rr, rg, rb);
  writeRow(STUDIO_GPU_HSL_OFFSETS.rowG, gr, gg, gb);
  writeRow(STUDIO_GPU_HSL_OFFSETS.rowB, br, bg, bb);
  return uniform;
}

/** 레벨/커브(lut3) 공용 uniform — pixelCount 자리표시자만 담는다. */
export function packStudioGpuLut3Uniform(): ArrayBuffer {
  return new ArrayBuffer(STUDIO_GPU_LUT3_UNIFORM_BYTES);
}

// 채널별 Uint8ClampedArray LUT 3개 → GPU 스토리지 레이아웃(u32 768칸: r,g,b 순).
function lutsToUint32(luts: {
  r: Uint8ClampedArray;
  g: Uint8ClampedArray;
  b: Uint8ClampedArray;
}): Uint32Array {
  const packed = new Uint32Array(STUDIO_GPU_LUT3_ENTRY_COUNT);
  for (let i = 0; i < 256; i++) {
    packed[i] = luts.r[i]!;
    packed[256 + i] = luts.g[i]!;
    packed[512 + i] = luts.b[i]!;
  }
  return packed;
}

/**
 * ① 밝기/대비 LUT — 두 필터 모두 바이트→바이트 사상이므로 CPU 체인을 f64 로 정확 재현한
 * 256칸 LUT 를 굽는다(세 채널 동일). CPU 원본(applyImageFilters)은 필터마다
 * Uint8ClampedArray 에 다시 쓰므로 스테이지 사이에 ToUint8Clamp(클램프+round-half-even)
 * 양자화가 있다 — LUT 도 같은 순서로 복제한다:
 *   lut[i] = u8clamp( contrast_f64( u8clamp( i + brightness*255 ) ) )
 * 파라미터는 buildImageFilters 의 attrs 계산 verbatim: brightness clampFinite(-0.8..0.8)*255,
 * contrast clampFinite(-80..80) → ((c+100)/100)^2. 비활성 스테이지는 CPU 체인에서 해당
 * 필터가 아예 빠진 것과 동일하게 건너뛴다. lut3 정수 조회라 결과는 CPU 와 비트 동일하다.
 */
export function packStudioGpuBrightnessContrastLut(input: {
  brightness?: number;
  contrast?: number;
}): Uint32Array {
  const applyBrightness = isActiveNumber(input.brightness);
  const applyContrast = isActiveNumber(input.contrast);
  const brightnessOffset = applyBrightness ? clampFinite(input.brightness!, -0.8, 0.8) * 255 : 0;
  const contrastAdjust = applyContrast
    ? Math.pow((clampFinite(input.contrast!, -80, 80) + 100) / 100, 2)
    : 1;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i += 1) {
    // nativeBrighten: data[i] += brightness*255 — Uint8ClampedArray 대입이 스테이지 경계 양자화.
    lut[i] = applyBrightness ? i + brightnessOffset : i;
    if (applyContrast) {
      // nativeContrast verbatim: (v/255 - 0.5)*adjust + 0.5, *255, 명시적 클램프 후 대입 양자화.
      const value = ((lut[i]! / 255 - 0.5) * contrastAdjust + 0.5) * 255;
      lut[i] = value < 0 ? 0 : value > 255 ? 255 : value;
    }
  }
  return lutsToUint32({ r: lut, g: lut, b: lut });
}

/**
 * 인접 lut3 스텝 융합용 LUT 합성 — first 를 먼저, second 를 나중에 태운 순차 디스패치와
 * 동일한 사상: out[c][i] = second[c][ first[c][i] ]. LUT 엔트리는 이미 양자화된 바이트라
 * 정수 조회 합성은 스테이지 경계 양자화를 그대로 보존한다(순차 실행과 비트 동일).
 */
export function composeStudioGpuLut3(first: Uint32Array, second: Uint32Array): Uint32Array {
  const composed = new Uint32Array(STUDIO_GPU_LUT3_ENTRY_COUNT);
  for (let channel = 0; channel < 3; channel += 1) {
    const base = channel * 256;
    for (let i = 0; i < 256; i += 1) {
      composed[base + i] = second[base + (first[base + i]! & 0xff)]! & 0xff;
    }
  }
  return composed;
}

/**
 * ③ 레벨 LUT — CPU 와 동일한 buildChannelLevelsLuts(마스터 + r/g/b 채널 합성)를 호출해
 * 바이트를 그대로 u32 스토리지 레이아웃으로 복사한다(비트 동일).
 */
export function packStudioGpuLevelsLut(input: {
  master?: Partial<LevelsParams> | null;
  channels?: LevelsRgbChannels | null;
}): Uint32Array {
  return lutsToUint32(buildChannelLevelsLuts(input.master, input.channels));
}

/**
 * ④ 커브 LUT — CPU 와 동일한 buildCurveChannelLuts(마스터 + r/g/b 채널 합성)를 호출해
 * 바이트를 그대로 u32 스토리지 레이아웃으로 복사한다(비트 동일).
 */
export function packStudioGpuCurvesLut(input: {
  master?: CurvePoint[] | null;
  channels?: CurveRgbChannels | null;
}): Uint32Array {
  return lutsToUint32(buildCurveChannelLuts(normalizeCurve(input.master), input.channels));
}

/**
 * ⑤ 컬러 밸런스 — normalizeColorBalance(클램프 -100..100) 후 세 톤 영역 쉬프트를 vec4 로.
 * GAIN(1.275)은 WGSL 상수로 CPU 의 COLOR_BALANCE_GAIN 과 동일하다.
 */
export function packStudioGpuColorBalanceParams(cb?: Partial<ColorBalance> | null): ArrayBuffer {
  const safe = normalizeColorBalance(cb);
  const uniform = new ArrayBuffer(STUDIO_GPU_COLOR_BALANCE_UNIFORM_BYTES);
  const view = new DataView(uniform);
  const writeZone = (offset: number, shift: readonly [number, number, number]) => {
    view.setFloat32(offset, shift[0], true);
    view.setFloat32(offset + 4, shift[1], true);
    view.setFloat32(offset + 8, shift[2], true);
    view.setFloat32(offset + 12, 0, true);
  };
  writeZone(STUDIO_GPU_COLOR_BALANCE_OFFSETS.shadows, safe.shadows);
  writeZone(STUDIO_GPU_COLOR_BALANCE_OFFSETS.midtones, safe.midtones);
  writeZone(STUDIO_GPU_COLOR_BALANCE_OFFSETS.highlights, safe.highlights);
  return uniform;
}
