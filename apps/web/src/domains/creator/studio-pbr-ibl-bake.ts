/**
 * Studio PBR — 결정적 IBL 사전계산 (BRDF LUT / SH9 확산 / 스페큘러 prefilter)
 *
 * 이미지 기반 조명의 세 조각을 전부 헤드리스 순수 함수로 굽는다. three.js·WebGPU·DOM
 * 의존이 0이라 node 테스트에서 그대로 검증된다. 환경맵은 **인자로 받는다** — 이 모듈은
 * studio-bg3d-procedural-panorama 를 import 하지 않는다(그쪽이 three 를 끌고 오기 때문).
 *
 * 【1. BRDF LUT — split-sum 의 두 번째 항】
 *  Karis 의 분할합 근사에서 스페큘러 IBL 은
 *    L_spec ≈ prefiltered(R, roughness) · (F0·scale + bias)
 *  로 분해된다. (scale, bias) 는 환경과 무관한 2D 함수라 (n·v, roughness) 격자에 미리
 *  구워둘 수 있다. GGX 중요도 샘플링 추정량은
 *    G_vis = G·(v·h)/((n·h)(n·v)),  Fc = (1-(v·h))⁵
 *    scale += (1-Fc)·G_vis,  bias += Fc·G_vis
 *  이다. roughness=0 에서는 h=n 이 되어 해석해
 *    scale = 1-(1-μ)⁵,  bias = (1-μ)⁵
 *  로 닫히며(즉 F0·scale+bias 가 정확히 Schlick 프레넬), 테스트가 이 등식을 직접 단언한다.
 *
 * 【2. 확산 IBL — 9계수 구면조화(SH9)】
 *  Ramamoorthi-Hanrahan(2001): Lambertian 반사는 저역통과라 2차 SH 9개면 평균 1% 오차로
 *  irradiance 를 복원한다. equirect 파노라마를 solid-angle 가중으로 SH 기저에 투영하고,
 *  평가할 때 코사인 로브 컨볼루션 상수(c1..c5)를 곱해 irradiance E(n) 을 얻는다.
 *  확산 radiance = albedo/π · E(n) 이다(1/π 는 폴딩하지 않았다).
 *
 * 【3. 스페큘러 prefilter】
 *  러프니스별로 GGX 로 미리 컨볼브한 밉 체인. 큐브맵이 아니라 **equirect** 밉 체인을
 *  만든다 — 소스가 equirect 이고 2D 라 seam/face 경계 없이 헤드리스 검증이 쉽다.
 *  mip 0 은 러프니스 0 이라 컨볼루션이 항등이므로 소스를 그대로 리샘플한다.
 *  N=V=R 가정(Karis)을 쓰므로 스침각 신축(stretchy reflection)은 재현하지 못한다.
 *
 * 【정직한 한계】
 *  - 큐브맵 아님. three 의 PMREM 과 텍스처 레이아웃이 다르므로 그대로 샘플러에 물릴 수
 *    없고, 통합 시 equirect 샘플링 셰이더가 필요하다(WGSL 쪽에 동봉).
 *  - N=V=R 근사, 이방성 없음, 스침각 신축 없음.
 *  - SH9 는 2차까지라 강한 방향성 광원(작은 태양)은 링잉/뭉개짐이 생긴다. 태양은
 *    directional light 로 따로 넣는 것이 옳다.
 *  - 결정성 등급은 "같은 엔진에서 바이트 동일"이다(초월함수 비트 미명세).
 */

import {
  directionalAlbedoGgx,
  geometrySmithSchlickGgx,
  hammersley,
  importanceSampleGgx,
  srgbToLinear,
  studioPbrAdd,
  studioPbrDot,
  studioPbrScale,
  type StudioPbrVec3,
} from "./studio-pbr-brdf";

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// 공통 입력 형태
// ---------------------------------------------------------------------------

/** equirect(정거원통) 파노라마 픽셀 — RGBA8, 행 우선, sRGB 인코딩 가정. */
export interface StudioPbrEquirectSource {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array | Uint8ClampedArray;
}

/** 선형 광량 equirect — prefilter 중간 표현(RGB f32, 알파 없음). */
export interface StudioPbrLinearEquirect {
  readonly width: number;
  readonly height: number;
  /** width·height·3 개의 선형 RGB. */
  readonly rgb: Float32Array;
}

function assertEquirect(source: StudioPbrEquirectSource): void {
  if (!Number.isInteger(source.width) || source.width <= 0) {
    throw new Error(`studio-pbr: equirect width 가 양의 정수가 아니다 (${source.width})`);
  }
  if (!Number.isInteger(source.height) || source.height <= 0) {
    throw new Error(`studio-pbr: equirect height 가 양의 정수가 아니다 (${source.height})`);
  }
  const expected = source.width * source.height * 4;
  if (source.rgba.length !== expected) {
    throw new Error(`studio-pbr: equirect rgba 길이 불일치 (기대 ${expected}, 실제 ${source.rgba.length})`);
  }
}

/**
 * equirect 텍셀 (x,y) → 단위 방향. 규약:
 *   θ = (y+0.5)/height·π  (y=0 이 +Y 천정), φ = (x+0.5)/width·2π - π
 *   dir = (sinθ·sinφ, cosθ, -sinθ·cosφ)
 * 즉 +Y 가 위, φ=0 이 -Z 를 향한다(three 의 equirect 규약과 같은 계열).
 */
export function studioPbrEquirectDirection(x: number, y: number, width: number, height: number): StudioPbrVec3 {
  const theta = ((y + 0.5) / height) * Math.PI;
  const phi = ((x + 0.5) / width) * TAU - Math.PI;
  const sinTheta = Math.sin(theta);
  return {
    x: sinTheta * Math.sin(phi),
    y: Math.cos(theta),
    z: -sinTheta * Math.cos(phi),
  };
}

/** 방향 → equirect UV(0..1). studioPbrEquirectDirection 의 역함수. */
export function studioPbrDirectionToEquirectUv(direction: StudioPbrVec3): readonly [number, number] {
  const y = Math.min(1, Math.max(-1, direction.y));
  const theta = Math.acos(y);
  const phi = Math.atan2(direction.x, -direction.z);
  return [(phi + Math.PI) / TAU, theta / Math.PI];
}

/** sRGB RGBA8 equirect → 선형 RGB f32 equirect. */
export function decodeStudioPbrEquirectLinear(source: StudioPbrEquirectSource): StudioPbrLinearEquirect {
  assertEquirect(source);
  const { width, height, rgba } = source;
  const rgb = new Float32Array(width * height * 3);
  for (let i = 0, o = 0; i < rgba.length; i += 4, o += 3) {
    rgb[o] = srgbToLinear(rgba[i] / 255);
    rgb[o + 1] = srgbToLinear(rgba[i + 1] / 255);
    rgb[o + 2] = srgbToLinear(rgba[i + 2] / 255);
  }
  return { width, height, rgb };
}

/**
 * 선형 equirect 이중선형 샘플. u 는 원통 방향이라 wrap, v 는 극 방향이라 clamp 한다.
 */
export function sampleStudioPbrEquirectLinear(
  source: StudioPbrLinearEquirect,
  u: number,
  v: number,
  out: [number, number, number],
): [number, number, number] {
  const { width, height, rgb } = source;
  const fx = u * width - 0.5;
  const fy = v * height - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const wrapX = (x: number): number => ((x % width) + width) % width;
  const clampY = (y: number): number => (y < 0 ? 0 : y >= height ? height - 1 : y);
  const x0w = wrapX(x0);
  const x1w = wrapX(x0 + 1);
  const y0c = clampY(y0);
  const y1c = clampY(y0 + 1);
  const i00 = (y0c * width + x0w) * 3;
  const i10 = (y0c * width + x1w) * 3;
  const i01 = (y1c * width + x0w) * 3;
  const i11 = (y1c * width + x1w) * 3;
  for (let c = 0; c < 3; c += 1) {
    const top = rgb[i00 + c] * (1 - tx) + rgb[i10 + c] * tx;
    const bottom = rgb[i01 + c] * (1 - tx) + rgb[i11 + c] * tx;
    out[c] = top * (1 - ty) + bottom * ty;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. BRDF LUT
// ---------------------------------------------------------------------------

export interface StudioPbrBrdfLutOptions {
  /** 정사각 LUT 한 변(기본 128 — 실측 128²@64spp ≈ 35 ms). */
  readonly size?: number;
  /** 텍셀당 GGX 샘플 수. */
  readonly sampleCount?: number;
}

export interface StudioPbrBrdfLut {
  readonly size: number;
  readonly sampleCount: number;
  /** RG32F, size·size·2 개. [0]=scale(F0 계수), [1]=bias(가산항). */
  readonly data: Float32Array;
}

export const STUDIO_PBR_BRDF_LUT_DEFAULT_SIZE = 128;
export const STUDIO_PBR_BRDF_LUT_DEFAULT_SAMPLES = 64;

/**
 * LUT 한 텍셀의 split-sum 적분. 테스트가 임의의 (nDotV, roughness) 로 직접 부를 수
 * 있도록 공개한다 — roughness=0 해석해 대조가 여기에 걸린다.
 */
export function integrateStudioPbrBrdfTexel(
  nDotV: number,
  roughness: number,
  sampleCount: number,
): readonly [number, number] {
  const v = Math.min(1, Math.max(1e-4, nDotV));
  const alpha = roughness * roughness;
  const view: StudioPbrVec3 = { x: Math.sqrt(Math.max(0, 1 - v * v)), y: 0, z: v };
  const normal: StudioPbrVec3 = { x: 0, y: 0, z: 1 };
  let scale = 0;
  let bias = 0;
  for (let i = 0; i < sampleCount; i += 1) {
    const [u1, u2] = hammersley(i, sampleCount);
    // α=0 이면 importanceSampleGgx 가 h=n 을 그대로 돌려준다(델타 로브).
    const h = alpha <= 0 ? normal : importanceSampleGgx(u1, u2, alpha, normal);
    const vDotH = studioPbrDot(view, h);
    if (vDotH <= 0) continue;
    const l = studioPbrAdd(studioPbrScale(h, 2 * vDotH), studioPbrScale(view, -1));
    const nDotL = l.z;
    if (nDotL <= 0) continue;
    const nDotH = h.z;
    if (nDotH <= 0) continue;
    const g = geometrySmithSchlickGgx(v, nDotL, roughness, "ibl");
    const gVis = (g * vDotH) / (nDotH * v);
    const m = 1 - vDotH;
    const m2 = m * m;
    const fc = m2 * m2 * m;
    scale += (1 - fc) * gVis;
    bias += fc * gVis;
  }
  return [scale / sampleCount, bias / sampleCount];
}

/**
 * BRDF LUT 굽기. x 축이 n·v, y 축이 roughness 이며 둘 다 텍셀 중심 좌표
 * ((i+0.5)/size)를 쓴다 — n·v=0 특이점을 자연히 피한다.
 */
export function bakeStudioPbrBrdfLut(options: StudioPbrBrdfLutOptions = {}): StudioPbrBrdfLut {
  const size = options.size ?? STUDIO_PBR_BRDF_LUT_DEFAULT_SIZE;
  const sampleCount = options.sampleCount ?? STUDIO_PBR_BRDF_LUT_DEFAULT_SAMPLES;
  if (!Number.isInteger(size) || size < 2) {
    throw new Error(`studio-pbr: BRDF LUT size 는 2 이상 정수여야 한다 (${size})`);
  }
  if (!Number.isInteger(sampleCount) || sampleCount < 1) {
    throw new Error(`studio-pbr: BRDF LUT sampleCount 는 1 이상 정수여야 한다 (${sampleCount})`);
  }
  const data = new Float32Array(size * size * 2);
  for (let y = 0; y < size; y += 1) {
    const roughness = (y + 0.5) / size;
    for (let x = 0; x < size; x += 1) {
      const nDotV = (x + 0.5) / size;
      const [scale, bias] = integrateStudioPbrBrdfTexel(nDotV, roughness, sampleCount);
      const index = (y * size + x) * 2;
      data[index] = scale;
      data[index + 1] = bias;
    }
  }
  return { size, sampleCount, data };
}

/** LUT 이중선형 조회 → (scale, bias). 셰이딩 시 F0·scale + bias 로 쓴다. */
export function sampleStudioPbrBrdfLut(
  lut: StudioPbrBrdfLut,
  nDotV: number,
  roughness: number,
): { readonly scale: number; readonly bias: number } {
  const { size, data } = lut;
  const fx = Math.min(1, Math.max(0, nDotV)) * size - 0.5;
  const fy = Math.min(1, Math.max(0, roughness)) * size - 0.5;
  const clamp = (i: number): number => (i < 0 ? 0 : i >= size ? size - 1 : i);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const x0c = clamp(x0);
  const x1c = clamp(x0 + 1);
  const y0c = clamp(y0);
  const y1c = clamp(y0 + 1);
  const read = (xi: number, yi: number, c: number): number => data[(yi * size + xi) * 2 + c];
  const lerp2 = (c: number): number => {
    const top = read(x0c, y0c, c) * (1 - tx) + read(x1c, y0c, c) * tx;
    const bottom = read(x0c, y1c, c) * (1 - tx) + read(x1c, y1c, c) * tx;
    return top * (1 - ty) + bottom * ty;
  };
  return { scale: lerp2(0), bias: lerp2(1) };
}

// ---------------------------------------------------------------------------
// 2. SH9 확산 IBL
// ---------------------------------------------------------------------------

/** SH9 계수 개수 × RGB. */
export const STUDIO_PBR_SH9_COEFFICIENTS = 27;

// 실수 구면조화 기저 상수(l=0..2).
const SH_Y00 = 0.282095;
const SH_Y1 = 0.488603;
const SH_Y2_XY = 1.092548;
const SH_Y2_Z2 = 0.315392;
const SH_Y2_X2Y2 = 0.546274;

/**
 * 방향에 대한 9개 실수 SH 기저값. 인덱스 순서:
 *   0: Y00 · 1: Y1-1(y) · 2: Y10(z) · 3: Y11(x)
 *   4: Y2-2(xy) · 5: Y2-1(yz) · 6: Y20(3z²-1) · 7: Y21(xz) · 8: Y22(x²-y²)
 */
export function studioPbrSh9Basis(d: StudioPbrVec3, out: Float64Array): Float64Array {
  out[0] = SH_Y00;
  out[1] = SH_Y1 * d.y;
  out[2] = SH_Y1 * d.z;
  out[3] = SH_Y1 * d.x;
  out[4] = SH_Y2_XY * d.x * d.y;
  out[5] = SH_Y2_XY * d.y * d.z;
  out[6] = SH_Y2_Z2 * (3 * d.z * d.z - 1);
  out[7] = SH_Y2_XY * d.x * d.z;
  out[8] = SH_Y2_X2Y2 * (d.x * d.x - d.y * d.y);
  return out;
}

/**
 * equirect 파노라마를 SH9 에 투영한다. 반환은 Float32Array(27) — [band*3 + channel].
 *
 * 텍셀 입체각은 근사 sinθ·dθ·dφ 가 아니라 **정확한** 띠 적분
 *   dω = (2π/W)·(cos θ_top - cos θ_bottom)
 * 을 쓴다. 그래야 Σdω 가 정확히 4π 가 되고, 균일 환경의 L00 항이 해석해와 일치한다
 * (중점근사를 쓰면 H=32 에서 4·10⁻⁴ 의 상대오차가 남는다 — 실측으로 확인했다).
 * 기저 함수 자체는 여전히 텍셀 중심에서 평가하므로 1~2차 밴드에는 O(1/H²) 의
 * 구적 오차가 남는다. 테스트가 그 수렴 차수를 직접 단언한다.
 */
export function projectStudioPbrIrradianceSh9(source: StudioPbrEquirectSource): Float32Array {
  assertEquirect(source);
  const { width, height, rgba } = source;
  const accumulator = new Float64Array(STUDIO_PBR_SH9_COEFFICIENTS);
  const basis = new Float64Array(9);
  const dPhi = TAU / width;
  for (let y = 0; y < height; y += 1) {
    const cosTop = Math.cos((y / height) * Math.PI);
    const cosBottom = Math.cos(((y + 1) / height) * Math.PI);
    const solidAngle = (cosTop - cosBottom) * dPhi;
    for (let x = 0; x < width; x += 1) {
      const direction = studioPbrEquirectDirection(x, y, width, height);
      studioPbrSh9Basis(direction, basis);
      const texel = (y * width + x) * 4;
      const r = srgbToLinear(rgba[texel] / 255) * solidAngle;
      const g = srgbToLinear(rgba[texel + 1] / 255) * solidAngle;
      const b = srgbToLinear(rgba[texel + 2] / 255) * solidAngle;
      for (let i = 0; i < 9; i += 1) {
        const w = basis[i];
        accumulator[i * 3] += r * w;
        accumulator[i * 3 + 1] += g * w;
        accumulator[i * 3 + 2] += b * w;
      }
    }
  }
  return Float32Array.from(accumulator);
}

// Ramamoorthi-Hanrahan 코사인 로브 컨볼루션 상수.
const SH_C1 = 0.429043;
const SH_C2 = 0.511664;
const SH_C3 = 0.743125;
const SH_C4 = 0.886227;
const SH_C5 = 0.247708;

/**
 * SH9 계수로부터 법선 n 의 **irradiance** E(n) 을 복원한다(단위: radiance·sr).
 * 확산 radiance = albedo/π · E(n) 이다 — 1/π 는 폴딩하지 않았다.
 *
 * 검증 가능한 성질: 사방이 radiance L 인 균일 환경이면 L00 = L·Y00·4π 이고
 * E = c4·L00 = π·L 이 정확히 나온다(반구 코사인 적분 = π).
 */
export function evaluateStudioPbrIrradianceSh9(
  sh: Float32Array | Float64Array,
  normal: StudioPbrVec3,
  out: [number, number, number] = [0, 0, 0],
): [number, number, number] {
  if (sh.length !== STUDIO_PBR_SH9_COEFFICIENTS) {
    throw new Error(`studio-pbr: SH9 계수는 ${STUDIO_PBR_SH9_COEFFICIENTS}개여야 한다 (${sh.length})`);
  }
  const { x, y, z } = normal;
  for (let c = 0; c < 3; c += 1) {
    const l00 = sh[c];
    const l1m1 = sh[3 + c];
    const l10 = sh[6 + c];
    const l11 = sh[9 + c];
    const l2m2 = sh[12 + c];
    const l2m1 = sh[15 + c];
    const l20 = sh[18 + c];
    const l21 = sh[21 + c];
    const l22 = sh[24 + c];
    out[c] =
      SH_C1 * l22 * (x * x - y * y) +
      SH_C3 * l20 * z * z +
      SH_C4 * l00 -
      SH_C5 * l20 +
      2 * SH_C1 * (l2m2 * x * y + l21 * x * z + l2m1 * y * z) +
      2 * SH_C2 * (l11 * x + l1m1 * y + l10 * z);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. 스페큘러 prefilter (equirect 밉 체인)
// ---------------------------------------------------------------------------

export interface StudioPbrPrefilterOptions {
  readonly source: StudioPbrEquirectSource;
  /** mip 0 의 가로 해상도(세로는 절반). 기본 128. */
  readonly baseWidth?: number;
  /** 밉 개수(러프니스 0 → 1 등분). 기본 6. */
  readonly mipCount?: number;
  /** 러프한 밉의 GGX 샘플 수. 기본 64. */
  readonly sampleCount?: number;
}

export interface StudioPbrPrefilterMip {
  readonly level: number;
  readonly roughness: number;
  readonly width: number;
  readonly height: number;
  /** width·height·3 선형 RGB. */
  readonly rgb: Float32Array;
}

export interface StudioPbrPrefilteredSpecular {
  readonly mipCount: number;
  readonly sampleCount: number;
  readonly mips: readonly StudioPbrPrefilterMip[];
}

export const STUDIO_PBR_PREFILTER_DEFAULT_BASE_WIDTH = 128;
export const STUDIO_PBR_PREFILTER_DEFAULT_MIPS = 6;
export const STUDIO_PBR_PREFILTER_DEFAULT_SAMPLES = 64;

/**
 * 러프니스별 GGX 컨볼브 밉 체인을 만든다.
 *  - mip 0(roughness 0): 컨볼루션이 항등이므로 소스를 이중선형 리샘플만 한다.
 *  - mip k>0: N=V=R 가정 하에 GGX 로 하프벡터를 뽑고, 반사 방향 L 을 (n·l) 로 가중해
 *    누적한 뒤 가중합으로 나눈다. 가중치 합 정규화 덕분에 균일 환경은 그대로 보존된다
 *    (테스트가 이 불변식을 단언한다).
 */
export function prefilterStudioPbrSpecularEquirect(
  options: StudioPbrPrefilterOptions,
): StudioPbrPrefilteredSpecular {
  const baseWidth = options.baseWidth ?? STUDIO_PBR_PREFILTER_DEFAULT_BASE_WIDTH;
  const mipCount = options.mipCount ?? STUDIO_PBR_PREFILTER_DEFAULT_MIPS;
  const sampleCount = options.sampleCount ?? STUDIO_PBR_PREFILTER_DEFAULT_SAMPLES;
  if (!Number.isInteger(baseWidth) || baseWidth < 4 || baseWidth % 2 !== 0) {
    throw new Error(`studio-pbr: prefilter baseWidth 는 4 이상 짝수여야 한다 (${baseWidth})`);
  }
  if (!Number.isInteger(mipCount) || mipCount < 2) {
    throw new Error(`studio-pbr: prefilter mipCount 는 2 이상이어야 한다 (${mipCount})`);
  }
  const linear = decodeStudioPbrEquirectLinear(options.source);
  const mips: StudioPbrPrefilterMip[] = [];
  const sample: [number, number, number] = [0, 0, 0];

  for (let level = 0; level < mipCount; level += 1) {
    const width = Math.max(4, baseWidth >> level);
    const height = Math.max(2, width >> 1);
    const roughness = level / (mipCount - 1);
    const rgb = new Float32Array(width * height * 3);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const outIndex = (y * width + x) * 3;
        const n = studioPbrEquirectDirection(x, y, width, height);
        if (level === 0) {
          const [u, v] = studioPbrDirectionToEquirectUv(n);
          sampleStudioPbrEquirectLinear(linear, u, v, sample);
          rgb[outIndex] = sample[0];
          rgb[outIndex + 1] = sample[1];
          rgb[outIndex + 2] = sample[2];
          continue;
        }
        const alpha = roughness * roughness;
        let r = 0;
        let g = 0;
        let b = 0;
        let weightSum = 0;
        for (let i = 0; i < sampleCount; i += 1) {
          const [u1, u2] = hammersley(i, sampleCount);
          const h = importanceSampleGgx(u1, u2, alpha, n);
          const vDotH = studioPbrDot(n, h);
          const l = studioPbrAdd(studioPbrScale(h, 2 * vDotH), studioPbrScale(n, -1));
          const nDotL = studioPbrDot(n, l);
          if (nDotL <= 0) continue;
          const [su, sv] = studioPbrDirectionToEquirectUv(l);
          sampleStudioPbrEquirectLinear(linear, su, sv, sample);
          r += sample[0] * nDotL;
          g += sample[1] * nDotL;
          b += sample[2] * nDotL;
          weightSum += nDotL;
        }
        if (weightSum > 0) {
          rgb[outIndex] = r / weightSum;
          rgb[outIndex + 1] = g / weightSum;
          rgb[outIndex + 2] = b / weightSum;
        }
      }
    }
    mips.push({ level, roughness, width, height, rgb });
  }
  return { mipCount, sampleCount, mips };
}

// ---------------------------------------------------------------------------
// 다이제스트 — 결정성 단언 + 캐시 키
// ---------------------------------------------------------------------------

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a(bytes: Uint8Array, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < bytes.length; i += 1) {
    hash = (hash ^ bytes[i]) >>> 0;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

function hashFloat32(array: Float32Array, seed: number): number {
  return fnv1a(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), seed);
}

/**
 * IBL 산출물의 FNV-1a 다이제스트(8자리 hex). 같은 입력·같은 엔진이면 항상 같다.
 * 크로스 엔진 동일성은 보장하지 않는다(초월함수 비트 미명세).
 */
export function hashStudioPbrIblBake(bake: {
  readonly brdfLut?: StudioPbrBrdfLut;
  readonly sh9?: Float32Array;
  readonly specular?: StudioPbrPrefilteredSpecular;
}): string {
  let hash = FNV_OFFSET;
  if (bake.brdfLut) {
    hash = fnv1a(new Uint8Array([bake.brdfLut.size & 0xff, bake.brdfLut.sampleCount & 0xff]), hash);
    hash = hashFloat32(bake.brdfLut.data, hash);
  }
  if (bake.sh9) hash = hashFloat32(bake.sh9, hash);
  if (bake.specular) {
    for (const mip of bake.specular.mips) {
      hash = fnv1a(new Uint8Array([mip.level & 0xff, mip.width & 0xff, mip.height & 0xff]), hash);
      hash = hashFloat32(mip.rgb, hash);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// 편의: 에너지 보상 테이블
// ---------------------------------------------------------------------------

/**
 * 러프니스별 단일산란 방향 알베도 곡선 E(μ=1, α). 손실을 눈으로 확인하거나 UI 에
 * "에너지 손실 %" 를 띄울 때 쓴다. 값이 1 미만인 것은 버그가 아니라 GGX 단일산란의 성질이다.
 */
export function buildStudioPbrEnergyLossCurve(steps = 11, sampleCount = 128): Float64Array {
  const curve = new Float64Array(steps);
  for (let i = 0; i < steps; i += 1) {
    const roughness = i / (steps - 1);
    curve[i] = directionalAlbedoGgx(1, Math.max(1e-4, roughness * roughness), sampleCount);
  }
  return curve;
}
