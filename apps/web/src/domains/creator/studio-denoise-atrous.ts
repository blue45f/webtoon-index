/**
 * Studio Denoise — 엣지 회피 à-trous 웨이블릿 디노이저 (SVGF 계열)
 *
 * Blender 의 OIDN/OptiX 자리에 해당하는 모듈. 경로 추적기가 뱉는 노이즈 HDR 버퍼와
 * 보조 특징 버퍼(albedo/normal/depth)를 받아 CPU 만으로 결정적으로 디노이즈한다.
 * 같은 파이프라인의 레벨 루프만 WGSL 로 옮긴 것이 studio-denoise-gpu.ts 다.
 *
 * ── 파이프라인 ──────────────────────────────────────────────────────────────
 *  1) 정규화        NaN/Inf/음수/영벡터 노멀 복구, 배경(depth<=0) 분리
 *  2) 알베도 디모듈레이션   L = C / max(albedo, floor)
 *       텍스처 디테일을 신호에서 빼두면 필터가 텍스처를 뭉개지 않는다. 마지막에 곱해
 *       정확히 되돌린다(가역). SVGF/OIDN 이 albedo 를 입력으로 받는 이유와 동일.
 *  3) 파이어플라이 억제      이웃 통계 기반 이상치 클램프(아래 별도 설명)
 *  4) HDR 도메인 변환       y = log1p(x)  (기본) 또는 항등
 *  5) 분산 추정      모멘트가 있으면 E[L²]-E[L]² / spp, 없으면 기하 게이팅 창의 MAD 강건 추정
 *  6) à-trous 반복   레벨 i 의 stepwidth = 2^i, 5x5 B3-스플라인 커널
 *  7) 역변환 + 리모듈레이션  C' = expm1(y') * albedo
 *
 * ── 엣지 스토핑 함수 ────────────────────────────────────────────────────────
 *  커널   h = [1,4,6,4,1]/16 의 외적 (B3 스플라인). 레벨마다 탭 간격만 2배로 벌린다
 *         (à-trous = "구멍 뚫린" 웨이블릿) → 커널 크기는 25 탭 고정, 지지 반경만 성장.
 *
 *  w_n = max(0, dot(n_p, n_q))^σ_n            σ_n = 64
 *        노멀 정렬도의 급한 거듭제곱. 45° 만 꺾여도 0.707^64 ≈ 2e-10 로 사실상 차단된다.
 *        코사인 기반이라 스케일 불변이고 곡면에서는 완만하게만 감쇠한다.
 *
 *  w_z = exp( -|z_p - z_q| / (σ_z * |∇z|_p * d + ε_z * max(z_p, 1)) )        σ_z = 1
 *        핵심은 분모다. 기울어진 평면에서는 깊이가 "정상적으로" 변하므로 그 예상 변화량
 *        (|∇z|_p * 픽셀거리 d)을 허용 오차로 쓴다. 그래서 경사면을 실루엣으로 오인하지
 *        않는다. ε_z * max(z_p,1) 은 평면(∇z=0)에서 분모가 0 이 되는 것을 막는 상대 허용치.
 *        SVGF 는 G-buffer 의 해석적 ∂z/∂x 를 쓰지만 우리 계약에는 없으므로 depth 버퍼의
 *        중앙 차분으로 추정한다(문서화된 근사 — 1픽셀 실루엣에서 기울기가 과대평가되어
 *        가장자리에서 살짝 관대해질 수 있다).
 *
 *  w_a = exp( -||a_p - a_q||_1 / σ_a )        σ_a = 0.25
 *        재질 경계에서 빛이 새는 것을 막는다. 디모듈레이션을 켜면 신호에서 알베도가
 *        빠지므로 이 항이 재질 식별의 유일한 근거가 된다.
 *
 *  w_l = exp( -|l_p - l_q| / (σ_l * sqrt(Var_p) + ε_l) )      σ_l = 4
 *        **분산 인지 항**. 분산이 크면(=아직 노이즈) 분모가 커져 가중치가 1 로 붙고 넓게
 *        평균낸다. 분산이 0 에 가까우면(=수렴) 분모가 ε_l 로 붕괴해 조금만 달라도 가중치가
 *        0 이 되고 결과는 중심 픽셀 그대로 → 수렴한 영역은 뭉개지지 않는다.
 *        Var 는 레벨마다 함께 필터링되며(Var' = Σw²Var / (Σw)²), 사용 직전 3x3 가우시안으로
 *        한 번 더 다듬는다(분산 추정 자체의 노이즈 제거 — SVGF 와 동일).
 *
 *  샘플 수 변조: 가이드 분산에 clamp(sqrt(refSpp/spp), [0.25,4])² 를 곱한다. 픽셀별 spp 가
 *  달라도 하나의 uniform 으로 CPU/GPU 가 동일하게 처리되도록 σ_l 대신 분산에 접어 넣었다.
 *  결과적으로 spp 가 높을수록 휘도 게이트가 조여져 덜 필터링된다.
 *
 * ── HDR 안전성: 왜 log1p 인가 ───────────────────────────────────────────────
 *  선형 도메인에서 가중 평균을 하면 이웃 하나가 100 nit 만 되어도 주변 0.1 nit 픽셀들로
 *  에너지가 번져 "smear" 가 생긴다(가중치가 완전히 0 이 아닌 한 밝은 값이 합을 지배).
 *  y = log(1+x) 는 [0,∞) 위의 단조 전단사이고 x≫1 에서 로그로 압축되므로 밝은 이웃의
 *  지배력이 사라진다. 역변환은 expm1 로 정확히 되돌아간다.
 *  순수 log(x) 대신 log1p 를 쓰는 이유: log 도메인 가중 평균은 기하 평균이라 상대 편향이
 *  -σ²/2 만큼 어둡게 나오는데, log1p 는 x≲1 구간에서 거의 선형이라 중간톤/어두운 영역의
 *  편향이 -Var/(2(1+x)) 수준으로 줄어든다(σ=0.4, x=0.5 기준 약 -2.7% vs log 의 -7.7%).
 *  즉 "하이라이트는 압축, 미드톤은 선형"이라는 절충이다.
 *  측정(합성 씬, 64x64, 16spp): 조명 40 짜리 밝은 원반 + 0.04 배경에서 log1p 의 RMSE 는
 *  0.686, linear 는 1.033 (log1p 가 34% 우세). 반대로 다이내믹 레인지가 좁은 씬(조명
 *  0.55~1.25)에서는 linear 가 근소하게 낫다(0.018 vs 0.023) — 기하 평균 편향이 남기 때문.
 *  HDR 이 목적이므로 기본값은 log1p 이고, 에너지 정확도가 우선이면 hdrDomain: "linear".
 *  전체 평균 밝기 편향은 테스트에서 5% 이내로 고정한다.
 *
 * ── 파이어플라이 억제 ───────────────────────────────────────────────────────
 *  파이어플라이 = 이웃과 **공간적으로 무관한** 단일 픽셀 스파이크(낮은 확률 경로 하나가
 *  거대한 기여를 남긴 것). 진짜 하이라이트 = 공간적으로 응집된 밝은 영역.
 *  그래서 판정은 중심을 제외한 이웃 통계로만 한다:
 *      μ, σ = 중심 제외 이웃의 휘도 평균/표준편차
 *      limit = μ + k·σ                                  (k = 3)
 *      클램프 조건: L_c > limit  AND  L_c > μ·minRatio  AND  L_c > minLuminance   (minRatio = 3)
 *  하이라이트 내부는 μ 가 크므로 통과. 하이라이트 **가장자리**는 이웃이 이중 분포라 σ 가
 *  커져 limit 이 크게 잡히므로 역시 통과. 반면 어두운 배경 속 스파이크는 μ,σ 가 모두
 *  작아 즉시 클램프된다. 클램프는 RGB 를 limit/L_c 로 균일 스케일해 색상(hue)을 보존한다.
 *  디모듈레이션 **이후**에 수행하므로 밝은 알베도를 파이어플라이로 오인하지 않는다.
 *
 * ── OIDN 대비 정직한 한계 ───────────────────────────────────────────────────
 *  · 학습 기반 prior 가 없다. OIDN 의 U-Net 은 "그럴듯한 표면 디테일"을 복원하지만
 *    à-trous 는 저역 통과 필터라 잃어버린 고주파를 만들어내지 못한다.
 *  · 매우 낮은 spp(1~4) 에서 넓은 저주파 얼룩(low-frequency blotch)은 남는다. 레벨을
 *    늘리면 얼룩이 커질 뿐 사라지지 않는다 — 이건 SVGF 계열 공통 한계다.
 *  · 조명 자체의 고주파(코스틱, 날카로운 그림자 경계)는 가이드 버퍼에 나타나지 않으므로
 *    노이즈와 구분되지 않고 뭉개질 수 있다.
 *  · 스페큘러/거울 반사에는 1차 히트 가이드가 맞지 않는다(반사된 표면의 노멀이 필요).
 *  · 시간 안정성은 studio-denoise-temporal 의 누적에 의존한다. 여기엔 시간 항이 없다.
 *
 * 결정적이다 — Math.random / Date.now / 시간 의존 분기가 전혀 없다.
 */

import {
  STUDIO_DENOISE_VEC4_STRIDE,
  resolveStudioDenoiseOptions,
  sanitizeStudioDenoiseFrame,
  studioDenoiseLuminance,
  type StudioDenoiseFrame,
  type StudioDenoiseOptions,
  type StudioDenoiseResolvedOptions,
  type StudioDenoiseResult,
  type StudioDenoiseSanitizedFrame,
} from "./studio-denoise-contract";

/** B3-스플라인 5탭 커널 — CPU/WGSL 공용 상수. */
export const STUDIO_DENOISE_ATROUS_KERNEL: readonly number[] = [
  1 / 16,
  1 / 4,
  3 / 8,
  1 / 4,
  1 / 16,
];

/** à-trous 레벨 i 의 탭 간격. */
export function studioDenoiseStepWidth(level: number): number {
  return 1 << level;
}

/**
 * 한 프레임을 필터링 직전 상태까지 준비한 결과.
 * CPU 루프와 GPU 루프가 이 구조를 공유하므로 두 백엔드의 전/후처리는 100% 동일하다.
 */
export interface StudioDenoisePreparedFrame {
  readonly sanitized: StudioDenoiseSanitizedFrame;
  readonly options: StudioDenoiseResolvedOptions;
  /** vec4(신호 RGB, 가이드 분산) × 픽셀 수. WGSL `array<vec4<f32>>` 와 바이트 동일. */
  readonly signal: Float32Array;
  /** vec4(노멀 XYZ, 깊이). 깊이 <= 0 이면 배경. */
  readonly guideA: Float32Array;
  /** vec4(알베도 RGB, |∇z|). */
  readonly guideB: Float32Array;
  /** 리모듈레이션에 쓸 클램프된 알베도(디모듈레이션 역연산이 정확하도록 보관). */
  readonly albedoUsed: Float32Array;
  /** 필터 전 가이드 분산 사본. */
  readonly varianceInput: Float32Array;
  readonly fireflyClamped: number;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** 중앙 차분으로 |∇z| 추정 (경계는 한쪽 차분). 배경 픽셀은 0. */
function estimateDepthGradient(sanitized: StudioDenoiseSanitizedFrame): Float32Array {
  const { width, height, depth, valid, pixelCount } = sanitized;
  const grad = new Float32Array(pixelCount);
  if (width === 0 || height === 0) return grad;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      if (!valid[p]) continue;
      const zc = depth[p];

      const xm = x > 0 ? p - 1 : p;
      const xp = x + 1 < width ? p + 1 : p;
      const ym = y > 0 ? p - width : p;
      const yp = y + 1 < height ? p + width : p;

      const zxm = valid[xm] ? depth[xm] : zc;
      const zxp = valid[xp] ? depth[xp] : zc;
      const zym = valid[ym] ? depth[ym] : zc;
      const zyp = valid[yp] ? depth[yp] : zc;

      const spanX = (x > 0 ? 1 : 0) + (x + 1 < width ? 1 : 0);
      const spanY = (y > 0 ? 1 : 0) + (y + 1 < height ? 1 : 0);
      const dx = spanX > 0 ? Math.abs(zxp - zxm) / spanX : 0;
      const dy = spanY > 0 ? Math.abs(zyp - zym) / spanY : 0;
      grad[p] = Math.max(dx, dy);
    }
  }
  return grad;
}

/** 기하 가이드가 "같은 표면"이라고 보는지 — 공간 분산 추정 창을 게이팅한다. */
function geometryCompatible(
  sanitized: StudioDenoiseSanitizedFrame,
  depthGrad: Float32Array,
  p: number,
  q: number,
  distance: number,
): boolean {
  if (!sanitized.valid[q]) return false;
  const nb = p * 3;
  const qb = q * 3;
  const dot =
    sanitized.normal[nb] * sanitized.normal[qb] +
    sanitized.normal[nb + 1] * sanitized.normal[qb + 1] +
    sanitized.normal[nb + 2] * sanitized.normal[qb + 2];
  if (dot < 0.9) return false;
  const zp = sanitized.depth[p];
  const dz = Math.abs(zp - sanitized.depth[q]);
  return dz <= 0.05 * Math.max(zp, 1) + 2 * depthGrad[p] * distance;
}

function toFilterDomain(value: number, domain: string): number {
  return domain === "log1p" ? Math.log1p(value) : value;
}

function fromFilterDomain(value: number, domain: string): number {
  if (domain !== "log1p") return Math.max(0, value);
  return Math.max(0, Math.expm1(value));
}

/** 파이어플라이 클램프 — 조명(디모듈레이션된) 도메인, 선형 스케일에서 수행. */
function suppressFireflies(
  illum: Float32Array,
  sanitized: StudioDenoiseSanitizedFrame,
  options: StudioDenoiseResolvedOptions,
): number {
  const { width, height, valid } = sanitized;
  const radius = options.fireflyRadius;
  const luma = new Float32Array(sanitized.pixelCount);
  for (let p = 0; p < sanitized.pixelCount; p += 1) {
    const b = p * 3;
    luma[p] = studioDenoiseLuminance(illum[b], illum[b + 1], illum[b + 2]);
  }

  let clamped = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      if (!valid[p]) continue;
      const center = luma[p];
      if (center <= options.fireflyMinLuminance) continue;

      let sum = 0;
      let sum2 = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const q = yy * width + xx;
          if (!valid[q]) continue;
          const l = luma[q];
          sum += l;
          sum2 += l * l;
          count += 1;
        }
      }
      // 이웃 표본이 3개 미만이면 통계가 무의미하다 — 건드리지 않는다(1x1/모서리 안전).
      if (count < 3) continue;

      const mean = sum / count;
      const variance = Math.max(0, sum2 / count - mean * mean);
      const limit = mean + options.fireflySigmas * Math.sqrt(variance);
      if (center <= limit) continue;
      if (center <= mean * options.fireflyMinRatio) continue;

      const scale = limit / center;
      const b = p * 3;
      illum[b] *= scale;
      illum[b + 1] *= scale;
      illum[b + 2] *= scale;
      luma[p] = limit;
      clamped += 1;
    }
  }
  return clamped;
}

/** 정규분포에서 MAD → 표준편차 환산 상수 (1 / Φ⁻¹(3/4)). */
const MAD_TO_SIGMA = 1.4826;

/** 작은 고정 길이 배열용 삽입 정렬 (n ≤ 169, 결정적). */
function sortInPlace(values: Float64Array, count: number): void {
  for (let i = 1; i < count; i += 1) {
    const v = values[i];
    let j = i - 1;
    while (j >= 0 && values[j] > v) {
      values[j + 1] = values[j];
      j -= 1;
    }
    values[j + 1] = v;
  }
}

function medianOfSorted(values: Float64Array, count: number): number {
  const mid = count >> 1;
  return count % 2 === 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

/**
 * 기하 게이팅된 공간 창으로 필터 도메인 휘도의 분산을 추정한다.
 *
 * 표본 분산 대신 **MAD(median absolute deviation)** 기반 강건 추정을 쓴다:
 *     σ̂ = 1.4826 · median(|l_q - median(l)|),   Var̂ = σ̂²
 * 이유: 표본 분산은 창 안에 밝기 불연속(작은 하이라이트, 실루엣, 잔여 스파이크)이 하나만
 * 있어도 폭발한다. 그러면 휘도 게이트의 분모가 커져 "여긴 노이즈다"라고 오판하고 그 특징을
 * 뭉개버린다. MAD 는 창의 50% 미만이 이상치인 한 영향을 받지 않으므로, 어두운 배경 속
 * 작은 밝은 특징의 중심 픽셀에서도 σ̂ 가 배경 노이즈 수준으로 유지되어 특징이 보호된다.
 * (모멘트 기반 시간 분산이 있으면 그쪽이 항상 더 정확하다 — 이건 첫 프레임/정적 폴백용.)
 */
function estimateSpatialVariance(
  signalLuma: Float32Array,
  sanitized: StudioDenoiseSanitizedFrame,
  depthGrad: Float32Array,
  radius: number,
): Float32Array {
  const { width, height, valid, pixelCount } = sanitized;
  const variance = new Float32Array(pixelCount);
  if (radius <= 0) return variance;

  const area = (2 * radius + 1) * (2 * radius + 1);
  const samples = new Float64Array(area);
  const deviations = new Float64Array(area);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      if (!valid[p]) continue;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const q = yy * width + xx;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (!geometryCompatible(sanitized, depthGrad, p, q, distance)) continue;
          samples[count] = signalLuma[q];
          count += 1;
        }
      }
      if (count < 3) continue;
      sortInPlace(samples, count);
      const median = medianOfSorted(samples, count);
      for (let i = 0; i < count; i += 1) deviations[i] = Math.abs(samples[i] - median);
      sortInPlace(deviations, count);
      const sigma = MAD_TO_SIGMA * medianOfSorted(deviations, count);
      variance[p] = sigma * sigma;
    }
  }
  return variance;
}

/** 분산 버퍼를 3x3 가우시안으로 다듬는다(SVGF 와 동일 — 추정 자체의 노이즈 억제). */
function blurVariance(
  variance: Float32Array,
  sanitized: StudioDenoiseSanitizedFrame,
): Float32Array {
  const { width, height, valid, pixelCount } = sanitized;
  const out = new Float32Array(pixelCount);
  const kernel = [1 / 16, 2 / 16, 1 / 16, 2 / 16, 4 / 16, 2 / 16, 1 / 16, 2 / 16, 1 / 16];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      if (!valid[p]) continue;
      let sum = 0;
      let weight = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const q = yy * width + xx;
          if (!valid[q]) continue;
          const k = kernel[(dy + 1) * 3 + (dx + 1)];
          sum += k * variance[q];
          weight += k;
        }
      }
      out[p] = weight > 0 ? sum / weight : variance[p];
    }
  }
  return out;
}

/**
 * 정규화 → 디모듈레이션 → 파이어플라이 → 도메인 변환 → 분산 추정까지 수행한다.
 * 반환된 signal/guideA/guideB 는 그대로 GPU 스토리지 버퍼에 업로드할 수 있다.
 */
export function prepareStudioDenoiseFrame(
  frame: StudioDenoiseFrame,
  options?: StudioDenoiseOptions,
): StudioDenoisePreparedFrame {
  const sanitized = sanitizeStudioDenoiseFrame(frame);
  const resolved = resolveStudioDenoiseOptions(options);
  const { pixelCount } = sanitized;

  const signal = new Float32Array(pixelCount * STUDIO_DENOISE_VEC4_STRIDE);
  const guideA = new Float32Array(pixelCount * STUDIO_DENOISE_VEC4_STRIDE);
  const guideB = new Float32Array(pixelCount * STUDIO_DENOISE_VEC4_STRIDE);
  const albedoUsed = new Float32Array(pixelCount * 3);
  const varianceInput = new Float32Array(pixelCount);

  if (pixelCount === 0) {
    return {
      sanitized,
      options: resolved,
      signal,
      guideA,
      guideB,
      albedoUsed,
      varianceInput,
      fireflyClamped: 0,
    };
  }

  const depthGrad = estimateDepthGradient(sanitized);

  // 1) 알베도 디모듈레이션 → 조명 신호
  const demodulate = resolved.demodulateAlbedo && sanitized.hasAlbedo;
  const illum = new Float32Array(pixelCount * 3);
  for (let p = 0; p < pixelCount; p += 1) {
    const b = p * 3;
    for (let c = 0; c < 3; c += 1) {
      const a = demodulate ? Math.max(sanitized.albedo[b + c], resolved.albedoFloor) : 1;
      albedoUsed[b + c] = a;
      illum[b + c] = sanitized.color[b + c] / a;
    }
  }

  // 2) 파이어플라이 억제 (선형 조명 도메인)
  const fireflyClamped = resolved.fireflyEnabled
    ? suppressFireflies(illum, sanitized, resolved)
    : 0;

  // 3) HDR 도메인 변환
  const domain = resolved.hdrDomain;
  const signalLuma = new Float32Array(pixelCount);
  for (let p = 0; p < pixelCount; p += 1) {
    const b = p * 3;
    const s = p * STUDIO_DENOISE_VEC4_STRIDE;
    const r = toFilterDomain(illum[b], domain);
    const g = toFilterDomain(illum[b + 1], domain);
    const bl = toFilterDomain(illum[b + 2], domain);
    signal[s] = r;
    signal[s + 1] = g;
    signal[s + 2] = bl;
    signalLuma[p] = studioDenoiseLuminance(r, g, bl);
  }

  // 4) 분산 추정 — 모멘트 우선, 없으면 공간 창
  let variance: Float32Array;
  if (sanitized.momentVariance) {
    variance = new Float32Array(pixelCount);
    for (let p = 0; p < pixelCount; p += 1) {
      if (!sanitized.valid[p]) continue;
      const linearVariance = sanitized.momentVariance[p];
      if (domain === "log1p") {
        // y = log1p(x) 의 델타 방법: Var[y] ≈ Var[x] / (1+x)²
        const b = p * 3;
        const x = studioDenoiseLuminance(illum[b], illum[b + 1], illum[b + 2]);
        const j = 1 + Math.max(0, x);
        variance[p] = linearVariance / (j * j);
      } else {
        variance[p] = linearVariance;
      }
    }
  } else {
    variance = estimateSpatialVariance(signalLuma, sanitized, depthGrad, resolved.varianceRadius);
  }
  variance = blurVariance(variance, sanitized);

  // 5) spp 변조를 분산에 접어 넣는다 (CPU/GPU 가 uniform 하나로 동일 동작).
  for (let p = 0; p < pixelCount; p += 1) {
    const spp = Math.max(1, sanitized.sampleCount[p]);
    const scale = clamp(
      Math.sqrt(resolved.sampleCountReference / spp),
      resolved.sampleCountScaleMin,
      resolved.sampleCountScaleMax,
    );
    const guided = variance[p] * scale * scale;
    varianceInput[p] = guided;
    signal[p * STUDIO_DENOISE_VEC4_STRIDE + 3] = guided;
  }

  // 6) 가이드 버퍼 패킹
  for (let p = 0; p < pixelCount; p += 1) {
    const b = p * 3;
    const v = p * STUDIO_DENOISE_VEC4_STRIDE;
    guideA[v] = sanitized.normal[b];
    guideA[v + 1] = sanitized.normal[b + 1];
    guideA[v + 2] = sanitized.normal[b + 2];
    guideA[v + 3] = sanitized.valid[p] ? Math.max(sanitized.depth[p], 1e-6) : 0;
    guideB[v] = sanitized.albedo[b];
    guideB[v + 1] = sanitized.albedo[b + 1];
    guideB[v + 2] = sanitized.albedo[b + 2];
    guideB[v + 3] = depthGrad[p];
  }

  return {
    sanitized,
    options: resolved,
    signal,
    guideA,
    guideB,
    albedoUsed,
    varianceInput,
    fireflyClamped,
  };
}

/** 한 레벨의 à-trous 패스(CPU). WGSL 커널과 수식이 1:1 대응한다. */
export function runStudioDenoiseAtrousLevel(
  src: Float32Array,
  dst: Float32Array,
  guideA: Float32Array,
  guideB: Float32Array,
  width: number,
  height: number,
  stepWidth: number,
  options: StudioDenoiseResolvedOptions,
): void {
  const kernel = STUDIO_DENOISE_ATROUS_KERNEL;
  const stride = STUDIO_DENOISE_VEC4_STRIDE;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const pv = p * stride;
      const zp = guideA[pv + 3];
      if (zp <= 0) {
        dst[pv] = src[pv];
        dst[pv + 1] = src[pv + 1];
        dst[pv + 2] = src[pv + 2];
        dst[pv + 3] = src[pv + 3];
        continue;
      }

      const npx = guideA[pv];
      const npy = guideA[pv + 1];
      const npz = guideA[pv + 2];
      const gradP = guideB[pv + 3];
      const apr = guideB[pv];
      const apg = guideB[pv + 1];
      const apb = guideB[pv + 2];
      const lp = studioDenoiseLuminance(src[pv], src[pv + 1], src[pv + 2]);
      const varP = Math.max(0, src[pv + 3]);
      const lumaDenom = options.sigmaLuma * Math.sqrt(varP) + options.epsLuma;

      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumVar = 0;
      let weightSum = 0;

      for (let ky = 0; ky < 5; ky += 1) {
        const dy = (ky - 2) * stepWidth;
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let kx = 0; kx < 5; kx += 1) {
          const dx = (kx - 2) * stepWidth;
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const q = yy * width + xx;
          const qv = q * stride;
          const zq = guideA[qv + 3];
          if (zq <= 0) continue;

          const h = kernel[kx] * kernel[ky];

          const dot = npx * guideA[qv] + npy * guideA[qv + 1] + npz * guideA[qv + 2];
          const wn = Math.pow(Math.max(0, dot), options.sigmaNormal);
          if (wn <= 0) continue;

          const distance = Math.sqrt(dx * dx + dy * dy);
          const denomZ =
            options.sigmaDepth * gradP * distance + options.depthEpsilon * Math.max(zp, 1);
          const wz = Math.exp(-Math.abs(zp - zq) / Math.max(denomZ, 1e-8));

          const da =
            Math.abs(apr - guideB[qv]) +
            Math.abs(apg - guideB[qv + 1]) +
            Math.abs(apb - guideB[qv + 2]);
          const wa = Math.exp(-da / options.sigmaAlbedo);

          let wl = 1;
          if (options.useLuminanceWeight) {
            const lq = studioDenoiseLuminance(src[qv], src[qv + 1], src[qv + 2]);
            wl = Math.exp(-Math.abs(lp - lq) / Math.max(lumaDenom, 1e-12));
          }

          const w = h * wn * wz * wa * wl;
          if (w <= 0) continue;

          sumR += w * src[qv];
          sumG += w * src[qv + 1];
          sumB += w * src[qv + 2];
          sumVar += w * w * Math.max(0, src[qv + 3]);
          weightSum += w;
        }
      }

      if (weightSum > 0) {
        dst[pv] = sumR / weightSum;
        dst[pv + 1] = sumG / weightSum;
        dst[pv + 2] = sumB / weightSum;
        dst[pv + 3] = sumVar / (weightSum * weightSum);
      } else {
        dst[pv] = src[pv];
        dst[pv + 1] = src[pv + 1];
        dst[pv + 2] = src[pv + 2];
        dst[pv + 3] = src[pv + 3];
      }
    }
  }
}

/** 전체 à-trous 레벨 루프(CPU). ping-pong 후 최종 버퍼를 돌려준다. */
export function runStudioDenoiseAtrousCpu(prepared: StudioDenoisePreparedFrame): Float32Array {
  const { sanitized, options } = prepared;
  const { width, height, pixelCount } = sanitized;
  let src = Float32Array.from(prepared.signal);
  if (pixelCount === 0 || options.levels === 0) return src;

  let dst = new Float32Array(src.length);
  for (let level = 0; level < options.levels; level += 1) {
    runStudioDenoiseAtrousLevel(
      src,
      dst,
      prepared.guideA,
      prepared.guideB,
      width,
      height,
      studioDenoiseStepWidth(level),
      options,
    );
    const swap = src;
    src = dst;
    dst = swap;
  }
  return src;
}

/** 필터 결과를 선형 HDR 색으로 되돌린다(역도메인 + 리모듈레이션 + 배경 통과). */
export function finishStudioDenoise(
  prepared: StudioDenoisePreparedFrame,
  filtered: Float32Array,
  backend: "cpu" | "gpu",
): StudioDenoiseResult {
  const { sanitized, options } = prepared;
  const { width, height, pixelCount } = sanitized;
  const color = new Float32Array(pixelCount * 3);
  const variance = new Float32Array(pixelCount);
  const stride = STUDIO_DENOISE_VEC4_STRIDE;
  let filteredPixels = 0;
  let passthroughPixels = 0;

  for (let p = 0; p < pixelCount; p += 1) {
    const b = p * 3;
    const v = p * stride;
    if (!sanitized.valid[p]) {
      color[b] = sanitized.color[b];
      color[b + 1] = sanitized.color[b + 1];
      color[b + 2] = sanitized.color[b + 2];
      variance[p] = 0;
      passthroughPixels += 1;
      continue;
    }
    filteredPixels += 1;
    variance[p] = Math.max(0, filtered[v + 3]);
    for (let c = 0; c < 3; c += 1) {
      const linear = fromFilterDomain(filtered[v + c], options.hdrDomain);
      const out = linear * prepared.albedoUsed[b + c];
      color[b + c] = Number.isFinite(out) ? Math.max(0, out) : 0;
    }
  }

  return {
    width,
    height,
    color,
    variance,
    varianceInput: prepared.varianceInput,
    stats: {
      fireflyClamped: prepared.fireflyClamped,
      filteredPixels,
      passthroughPixels,
      levels: options.levels,
      repairs: sanitized.repairs,
      backend,
    },
  };
}

/**
 * 프레임 하나를 CPU 로 디노이즈한다. 순수 함수 — 입력 버퍼를 변형하지 않는다.
 *
 * @throws {StudioDenoiseInputError} 버퍼 길이/차원이 구조적으로 어긋난 경우에만.
 */
export function denoiseStudioFrame(
  frame: StudioDenoiseFrame,
  options?: StudioDenoiseOptions,
): StudioDenoiseResult {
  const prepared = prepareStudioDenoiseFrame(frame, options);
  const filtered = runStudioDenoiseAtrousCpu(prepared);
  return finishStudioDenoise(prepared, filtered, "cpu");
}
