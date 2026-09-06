/**
 * Studio Path Tracer — BSDF (studio-pathtrace-bsdf)
 *
 * 모델: Lambert diffuse + GGX(Trowbridge-Reitz) 마이크로패싯 스페큘러.
 *  - D  = Trowbridge-Reitz, alpha = roughness²(perceptual → 선형 거칠기)
 *  - G2 = height-correlated Smith (Heitz 2014)
 *  - F  = Schlick, F0 = mix(((ior-1)/(ior+1))², baseColor, metallic)
 *  - 스페큘러 샘플은 Heitz(2018) VNDF — 반사 방향의 pdf 가 `pdfStudioPathtraceBsdf`
 *    와 정확히 일치한다(계약 테스트가 sample/pdf/eval 3자 정합을 강제).
 *  - 로브 선택 확률은 Fresnel 대 diffuse 알베도의 휘도비다. `sample` 과 `pdf` 가
 *    같은 순수 함수(`studioPathtraceSpecularLobeProbability`)를 쓰므로 MIS 없이도
 *    두 로브 혼합 pdf 가 정확하다.
 *
 * 좌표계: 모든 함수는 **로컬 셰이딩 프레임**(z = 셰이딩 노멀)에서 동작한다.
 * wo/wi 는 표면에서 바깥을 향하는 단위 벡터다.
 *
 * 정직한 한계 — Blender/Cycles Principled BSDF 가 **아니다**
 *  - **multiple-scattering GGX 보정 없음.** 단일 산란만 계산하므로 roughness 가
 *    높아질수록 알려진 만큼 에너지를 잃는다(거친 금속이 Cycles 보다 어둡다).
 *    이것은 버그가 아니라 미구현이며, 테스트도 "손실 0"이 아니라 "단일 산란 곡선
 *    범위 안"을 단언한다.
 *  - **투과(BTDF)·굴절·박막·시트/클리어코트·이방성 없음.** ior 는 F0 계산에만 쓰인다.
 *  - `ior === 1 && metallic === 0` 이면 F0 = 0 이 되어 **스페큘러 로브가 완전히
 *    꺼진다**(순수 Lambert). furnace 테스트가 이 경로를 쓴다.
 *  - diffuse 는 (1 - F) 로 감쇠하는 근사 결합이며, 엄밀한 층 결합(coupled layer)이 아니다.
 */

import { sampleStudioPathtraceCosineHemisphere, sampleStudioPathtraceGgxVndf } from "./studio-pathtrace-sampler";

import type { StudioPathtraceMaterial } from "./studio-pathtrace-scene";

/** alpha 하한 — 완전 거울(delta)로 발산하지 않게 막는다. */
export const STUDIO_PATHTRACE_MIN_ALPHA = 1e-3;

/** Rec.709 휘도 계수. */
export const STUDIO_PATHTRACE_LUMA = [0.2126, 0.7152, 0.0722] as const;

export interface StudioPathtraceBsdfSample {
  wiX: number;
  wiY: number;
  wiZ: number;
  fR: number;
  fG: number;
  fB: number;
  pdf: number;
  valid: boolean;
}

export function createStudioPathtraceBsdfSample(): StudioPathtraceBsdfSample {
  return { wiX: 0, wiY: 0, wiZ: 1, fR: 0, fG: 0, fB: 0, pdf: 0, valid: false };
}

/** perceptual roughness → GGX alpha. */
export function studioPathtraceAlphaFromRoughness(roughness: number): number {
  const r = roughness < 0 ? 0 : roughness > 1 ? 1 : roughness;
  return Math.max(STUDIO_PATHTRACE_MIN_ALPHA, r * r);
}

/** 유전체 수직 입사 반사율. ior = 1 → 0(스페큘러 꺼짐). */
export function studioPathtraceDielectricF0(ior: number): number {
  const k = (ior - 1) / (ior + 1);
  return k * k;
}

function luminance(r: number, g: number, b: number): number {
  return STUDIO_PATHTRACE_LUMA[0] * r + STUDIO_PATHTRACE_LUMA[1] * g + STUDIO_PATHTRACE_LUMA[2] * b;
}

function pow5(x: number): number {
  const x2 = x * x;
  return x2 * x2 * x;
}

/** Trowbridge-Reitz 법선 분포. */
export function studioPathtraceDistributionGgx(cosH: number, alpha: number): number {
  if (cosH <= 0) return 0;
  const a2 = alpha * alpha;
  const d = cosH * cosH * (a2 - 1) + 1;
  return a2 / (Math.PI * d * d);
}

/** height-correlated Smith G2. */
export function studioPathtraceSmithG2(cosO: number, cosI: number, alpha: number): number {
  if (cosO <= 0 || cosI <= 0) return 0;
  const a2 = alpha * alpha;
  const lo = cosI * Math.sqrt(a2 + (1 - a2) * cosO * cosO);
  const li = cosO * Math.sqrt(a2 + (1 - a2) * cosI * cosI);
  const denom = lo + li;
  return denom > 0 ? (2 * cosO * cosI) / denom : 0;
}

/** Smith G1(단방향) — VNDF pdf 에 쓰인다. */
export function studioPathtraceSmithG1(cosO: number, alpha: number): number {
  if (cosO <= 0) return 0;
  const a2 = alpha * alpha;
  return (2 * cosO) / (cosO + Math.sqrt(a2 + (1 - a2) * cosO * cosO));
}

interface MaterialTerms {
  f0R: number;
  f0G: number;
  f0B: number;
  diffR: number;
  diffG: number;
  diffB: number;
  alpha: number;
  specEnabled: boolean;
}

const materialTerms: MaterialTerms = {
  f0R: 0,
  f0G: 0,
  f0B: 0,
  diffR: 0,
  diffG: 0,
  diffB: 0,
  alpha: 0,
  specEnabled: false,
};

/** 머티리얼 파생 항(F0/diffuse albedo/alpha)을 스크래치에 굽는다. 재진입 불가. */
function deriveMaterialTerms(material: StudioPathtraceMaterial): MaterialTerms {
  const m = material.metallic < 0 ? 0 : material.metallic > 1 ? 1 : material.metallic;
  const dielectric = studioPathtraceDielectricF0(material.ior);
  const [br, bg, bb] = material.baseColorLinear;
  materialTerms.f0R = dielectric * (1 - m) + br * m;
  materialTerms.f0G = dielectric * (1 - m) + bg * m;
  materialTerms.f0B = dielectric * (1 - m) + bb * m;
  materialTerms.diffR = br * (1 - m);
  materialTerms.diffG = bg * (1 - m);
  materialTerms.diffB = bb * (1 - m);
  materialTerms.alpha = studioPathtraceAlphaFromRoughness(material.roughness);
  materialTerms.specEnabled =
    materialTerms.f0R > 0 || materialTerms.f0G > 0 || materialTerms.f0B > 0;
  return materialTerms;
}

/**
 * 스페큘러 로브를 고를 확률. `sample` 과 `pdf` 가 반드시 이 함수를 공유해야 한다
 * (다르면 pdf 가 틀어져 편향이 생긴다).
 */
export function studioPathtraceSpecularLobeProbability(
  material: StudioPathtraceMaterial,
  cosThetaO: number,
): number {
  const terms = deriveMaterialTerms(material);
  if (!terms.specEnabled) return 0;
  const f0lum = luminance(terms.f0R, terms.f0G, terms.f0B);
  const cos = cosThetaO < 0 ? 0 : cosThetaO > 1 ? 1 : cosThetaO;
  const fr = f0lum + (1 - f0lum) * pow5(1 - cos);
  const dw = luminance(terms.diffR, terms.diffG, terms.diffB);
  const denom = fr + dw;
  if (!(denom > 0)) return 0;
  return fr / denom;
}

/**
 * BSDF 값 f(wo, wi). `out` ← [r, g, b]. 반구 밖이면 0.
 * 코사인 항은 **포함하지 않는다**(호출부가 곱한다).
 */
export function evalStudioPathtraceBsdf(
  material: StudioPathtraceMaterial,
  woX: number,
  woY: number,
  woZ: number,
  wiX: number,
  wiY: number,
  wiZ: number,
  out: Float64Array | number[],
): void {
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  if (woZ <= 0 || wiZ <= 0) return;
  const terms = deriveMaterialTerms(material);

  let fresR = 0;
  let fresG = 0;
  let fresB = 0;
  let specR = 0;
  let specG = 0;
  let specB = 0;

  if (terms.specEnabled) {
    let hx = woX + wiX;
    let hy = woY + wiY;
    let hz = woZ + wiZ;
    const hLen = Math.hypot(hx, hy, hz);
    if (hLen > 0) {
      hx /= hLen;
      hy /= hLen;
      hz /= hLen;
      const dotWoH = woX * hx + woY * hy + woZ * hz;
      if (dotWoH > 0) {
        const schlick = pow5(1 - Math.min(1, dotWoH));
        fresR = terms.f0R + (1 - terms.f0R) * schlick;
        fresG = terms.f0G + (1 - terms.f0G) * schlick;
        fresB = terms.f0B + (1 - terms.f0B) * schlick;
        const d = studioPathtraceDistributionGgx(hz, terms.alpha);
        const g2 = studioPathtraceSmithG2(woZ, wiZ, terms.alpha);
        const common = (d * g2) / (4 * woZ * wiZ);
        specR = common * fresR;
        specG = common * fresG;
        specB = common * fresB;
      }
    }
  }

  const invPi = 1 / Math.PI;
  out[0] = terms.diffR * invPi * (1 - fresR) + specR;
  out[1] = terms.diffG * invPi * (1 - fresG) + specG;
  out[2] = terms.diffB * invPi * (1 - fresB) + specB;
}

/** 샘플링 pdf(입체각). sample 이 만든 방향에 대해 정확히 이 값을 돌려준다. */
export function pdfStudioPathtraceBsdf(
  material: StudioPathtraceMaterial,
  woX: number,
  woY: number,
  woZ: number,
  wiX: number,
  wiY: number,
  wiZ: number,
): number {
  if (woZ <= 0 || wiZ <= 0) return 0;
  const pSpec = studioPathtraceSpecularLobeProbability(material, woZ);
  const alpha = studioPathtraceAlphaFromRoughness(material.roughness);
  const pdfDiffuse = wiZ / Math.PI;
  let pdfSpec = 0;
  if (pSpec > 0) {
    let hx = woX + wiX;
    let hy = woY + wiY;
    let hz = woZ + wiZ;
    const hLen = Math.hypot(hx, hy, hz);
    if (hLen > 0) {
      hx /= hLen;
      hy /= hLen;
      hz /= hLen;
      const dotWoH = woX * hx + woY * hy + woZ * hz;
      if (dotWoH > 0) {
        const d = studioPathtraceDistributionGgx(hz, alpha);
        const g1 = studioPathtraceSmithG1(woZ, alpha);
        // pdf_wi = D_vis(h) / (4 |wo·h|) = G1(wo)·D(h) / (4 cosO)
        pdfSpec = (g1 * d) / (4 * woZ);
      }
    }
  }
  return pSpec * pdfSpec + (1 - pSpec) * pdfDiffuse;
}

const sampleScratch: number[] = [0, 0, 0];
const evalScratch: number[] = [0, 0, 0];

/**
 * 방향 샘플. `uLobe` 로 로브를 고르고 `u1,u2` 로 방향을 뽑은 뒤,
 * f/pdf 를 **혼합 로브 기준**으로 다시 평가해 채운다(sample/eval/pdf 3자 정합).
 */
export function sampleStudioPathtraceBsdf(
  material: StudioPathtraceMaterial,
  woX: number,
  woY: number,
  woZ: number,
  uLobe: number,
  u1: number,
  u2: number,
  sample: StudioPathtraceBsdfSample,
): void {
  sample.valid = false;
  sample.pdf = 0;
  sample.fR = 0;
  sample.fG = 0;
  sample.fB = 0;
  if (woZ <= 0) return;

  const pSpec = studioPathtraceSpecularLobeProbability(material, woZ);
  const alpha = studioPathtraceAlphaFromRoughness(material.roughness);

  let wiX: number;
  let wiY: number;
  let wiZ: number;
  if (uLobe < pSpec) {
    sampleStudioPathtraceGgxVndf(woX, woY, woZ, alpha, u1, u2, sampleScratch);
    const hx = sampleScratch[0];
    const hy = sampleScratch[1];
    const hz = sampleScratch[2];
    const dotWoH = woX * hx + woY * hy + woZ * hz;
    wiX = 2 * dotWoH * hx - woX;
    wiY = 2 * dotWoH * hy - woY;
    wiZ = 2 * dotWoH * hz - woZ;
    // 마이크로패싯 그림자에 가려 표면 아래로 반사되면 경로를 버린다
    // (= GGX 단일 산란의 에너지 손실. 보정하지 않는다).
    if (wiZ <= 0) return;
  } else {
    sampleStudioPathtraceCosineHemisphere(u1, u2, sampleScratch);
    wiX = sampleScratch[0];
    wiY = sampleScratch[1];
    wiZ = sampleScratch[2];
    if (wiZ <= 0) return;
  }

  const pdf = pdfStudioPathtraceBsdf(material, woX, woY, woZ, wiX, wiY, wiZ);
  if (!(pdf > 0)) return;
  evalStudioPathtraceBsdf(material, woX, woY, woZ, wiX, wiY, wiZ, evalScratch);

  sample.wiX = wiX;
  sample.wiY = wiY;
  sample.wiZ = wiZ;
  sample.fR = evalScratch[0];
  sample.fG = evalScratch[1];
  sample.fB = evalScratch[2];
  sample.pdf = pdf;
  sample.valid = true;
}
