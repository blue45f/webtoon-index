/**
 * Studio PBR — Cook-Torrance GGX 셰이딩 코어 (순수 TS, authoritative)
 *
 * 실시간 PBR(EEVEE 계열) 렌더 경로의 **수학 원본**이다. WGSL 패스(studio-pbr-wgsl.ts)는
 * 같은 수식의 f32 미러이고, 정확도 기준선은 언제나 이 파일이다. DOM·WebGPU·three 의존이
 * 0이라 node 헤드리스 테스트에서 그대로 돌아간다.
 *
 * 【구현한 것】
 *  - sRGB ↔ 선형 변환(IEC 61966-2-1 조각별 정확식)
 *  - GGX/Trowbridge-Reitz 법선분포 D
 *  - Smith 기하항 G — Schlick 근사(direct/ibl k 분리) + height-correlated 가시항 V
 *  - Schlick 프레넬 F(+ 러프니스 보정판)
 *  - Cook-Torrance 단일산란 BRDF 평가(금속/유전체 통합, Lambert 확산 포함)
 *  - Hammersley/van der Corput 저불일치 수열 + GGX 중요도 샘플링
 *  - 방향 알베도 E(μ,α)와 평균 알베도 Eavg(α) — 화이트 퍼니스 프로브
 *  - Kulla-Conty 다중산란 로브(에너지 보상)와 Fdez-Agüera IBL 보상항
 *
 * 【알고리즘 요약】
 *  스페큘러는 미세면 모델 f = D·G·F / (4·(n·v)·(n·l)) 이다. D 는 미세면 법선이 h 를
 *  향할 확률밀도(GGX), G 는 미세면 간 가림/그림자 확률, F 는 미세면 반사율이다.
 *  단일산란 GGX 는 미세면끼리의 재반사를 버리기 때문에 러프할수록 에너지를 잃는다
 *  (α=1 에서 최대 약 30%). 그 손실분을 Kulla-Conty 다중산란 로브
 *    f_ms(μo, μi) = (1 - E(μo))·(1 - E(μi)) / (π·(1 - Eavg))
 *  로 되돌린다. 해석적으로 ∫ f_ms·μi dωi = 1 - E(μo) 라서 전체 에너지가 1 로 닫힌다.
 *  이 성질은 studio-pbr-brdf.test.ts 가 **독립 구적법**으로 실측 검증한다.
 *
 * 【정직한 한계 — 블렌더/EEVEE 패리티 아님】
 *  이 서브시스템이 구현하는 것은 GGX BRDF + SH9 확산 IBL + split-sum 스페큘러 IBL +
 *  단일 캐스케이드 PCF 섀도우 + SSAO + 블룸 + 3개 톤커브, 그게 전부다.
 *  EEVEE Next 의 SSR/SSGI, 볼류메트릭, 광선추적 소프트 섀도우, 라이트프로브 볼륨,
 *  SSS, clearcoat/sheen/transmission/iridescence, 이방성, 에어리어 라이트, TAA 는
 *  전부 범위 밖이며 여기에 없다.
 *
 * 【결정성 계약】
 *  Math.random·Date.now 0개. 샘플링은 Hammersley radical-inverse 라 애초에 난수가
 *  아니다. 단, 결정성 등급은 "같은 엔진에서 바이트 동일"이다 — ECMAScript 는
 *  Math.pow/sin/exp 의 비트 결과를 명세하지 않는다(sqrt 만 IEEE 정확). GPU 필터 LUT
 *  경로(정수 조회 → 크로스 엔진 비트 동일)와는 **다른 등급**이므로 혼동하면 안 된다.
 *
 * 【웹툰 파이프라인 기여도】 스페큘러/IBL 은 중간 순위다. 금속·천·피부의 재질 분리를
 *  color 패스와 작가가 덧칠하는 beauty 레퍼런스에서 살려주지만, 순수 선화만 뽑을 때는
 *  하이라이트 형태 기여가 대부분이다. 실제로 값을 하는 것은 SSAO > 섀도우 > 톤매핑이다.
 */

export interface StudioPbrVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** 유전체 기본 반사율 — IOR 1.5 의 수직 입사 프레넬 ((1.5-1)/(1.5+1))². */
export const STUDIO_PBR_DIELECTRIC_F0 = 0.04;

/** roughness 0 은 D 가 델타로 발산하므로 α 하한을 둔다(three/Filament 관행). */
export const STUDIO_PBR_MIN_ALPHA = 1e-4;

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// 벡터 소도구 (외부 의존 없이 최소한만)
// ---------------------------------------------------------------------------

export function studioPbrDot(a: StudioPbrVec3, b: StudioPbrVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function studioPbrNormalize(v: StudioPbrVec3): StudioPbrVec3 {
  const length = Math.sqrt(studioPbrDot(v, v));
  if (length === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

export function studioPbrAdd(a: StudioPbrVec3, b: StudioPbrVec3): StudioPbrVec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function studioPbrScale(v: StudioPbrVec3, s: number): StudioPbrVec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function saturate(value: number): number {
  if (!(value > 0)) return 0; // NaN 도 0 으로 흡수
  return value < 1 ? value : 1;
}

// ---------------------------------------------------------------------------
// 색공간 — IEC 61966-2-1 sRGB 전달함수 (근사 2.2 감마 아님)
// ---------------------------------------------------------------------------

/** sRGB 인코딩값(0..1) → 선형 광량. */
export function srgbToLinear(value: number): number {
  const c = value <= 0 ? 0 : value >= 1 ? 1 : value;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** 선형 광량 → sRGB 인코딩값(0..1). srgbToLinear 의 정확한 역함수. */
export function linearToSrgb(value: number): number {
  const c = value <= 0 ? 0 : value >= 1 ? 1 : value;
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

// ---------------------------------------------------------------------------
// 러프니스 리매핑
// ---------------------------------------------------------------------------

/**
 * 지각 러프니스 → GGX α. Disney/UE4 관행대로 α = roughness² 이며, 하한
 * STUDIO_PBR_MIN_ALPHA 로 클램프한다(α=0 은 D 가 델타로 발산).
 */
export function studioPbrRoughnessToAlpha(roughness: number): number {
  const r = saturate(roughness);
  const alpha = r * r;
  return alpha < STUDIO_PBR_MIN_ALPHA ? STUDIO_PBR_MIN_ALPHA : alpha;
}

// ---------------------------------------------------------------------------
// D — GGX / Trowbridge-Reitz 법선분포
// ---------------------------------------------------------------------------

/**
 * D(h) = α² / (π · ((n·h)²(α²-1) + 1)²).
 * 반구 위 ∫ D(h)(n·h) dωh = 1 로 정규화된 확률밀도다.
 */
export function distributionGgx(nDotH: number, alpha: number): number {
  const a2 = alpha * alpha;
  const cos = saturate(nDotH);
  const denominator = cos * cos * (a2 - 1) + 1;
  return a2 / (Math.PI * denominator * denominator);
}

// ---------------------------------------------------------------------------
// G — Smith 기하항
// ---------------------------------------------------------------------------

export type StudioPbrGeometryMode = "direct" | "ibl";

/**
 * Schlick-GGX 재매핑 상수 k. 직접광은 k=(r+1)²/8, IBL 사전적분은 k=r²/2 를 쓴다
 * (Karis, "Real Shading in Unreal Engine 4"). 인자는 **지각 러프니스** r 이다.
 */
export function studioPbrSchlickK(roughness: number, mode: StudioPbrGeometryMode): number {
  const r = saturate(roughness);
  if (mode === "direct") {
    const k = r + 1;
    return (k * k) / 8;
  }
  return (r * r) / 2;
}

/** 한쪽 방향의 Schlick-GGX 가림 항. */
export function geometrySchlickGgx(nDotX: number, k: number): number {
  const cos = saturate(nDotX);
  if (cos === 0) return 0;
  return cos / (cos * (1 - k) + k);
}

/** 분리형 Smith G — 시야/광원 두 방향의 곱. */
export function geometrySmithSchlickGgx(
  nDotV: number,
  nDotL: number,
  roughness: number,
  mode: StudioPbrGeometryMode,
): number {
  const k = studioPbrSchlickK(roughness, mode);
  return geometrySchlickGgx(nDotV, k) * geometrySchlickGgx(nDotL, k);
}

/**
 * Height-correlated Smith 가시항 V = G / (4·(n·v)·(n·l)).
 * BRDF 분모를 이미 흡수하고 있어서 셰이더가 실제로 곱하는 항이다(Heitz 2014).
 */
export function visibilitySmithGgxCorrelated(nDotV: number, nDotL: number, alpha: number): number {
  const v = saturate(nDotV);
  const l = saturate(nDotL);
  if (v === 0 || l === 0) return 0;
  const a2 = alpha * alpha;
  const lambdaV = l * Math.sqrt(v * v * (1 - a2) + a2);
  const lambdaL = v * Math.sqrt(l * l * (1 - a2) + a2);
  const sum = lambdaV + lambdaL;
  return sum > 0 ? 0.5 / sum : 0;
}

// ---------------------------------------------------------------------------
// F — Schlick 프레넬
// ---------------------------------------------------------------------------

/**
 * F(v·h) = F0 + (1 - F0)(1 - v·h)⁵.
 * 극한: v·h=1(수직 입사) → 정확히 F0, v·h=0(스침각) → 정확히 1.
 */
export function fresnelSchlick(vDotH: number, f0: number): number {
  const cos = saturate(vDotH);
  const m = 1 - cos;
  const m2 = m * m;
  return f0 + (1 - f0) * (m2 * m2 * m);
}

/**
 * 러프니스 보정 프레넬(Sébastien Lagarde) — IBL 스페큘러 앰비언트에 쓴다.
 * 거친 표면에서 스침각 반사가 1 까지 치솟지 않도록 상한을 max(1-r, F0) 로 낮춘다.
 */
export function fresnelSchlickRoughness(nDotV: number, f0: number, roughness: number): number {
  const cos = saturate(nDotV);
  const m = 1 - cos;
  const m2 = m * m;
  const ceiling = Math.max(1 - saturate(roughness), f0);
  return f0 + (ceiling - f0) * (m2 * m2 * m);
}

// ---------------------------------------------------------------------------
// 저불일치 수열 — 난수가 아니라 인덱스 기반 결정적 수열
// ---------------------------------------------------------------------------

/**
 * van der Corput radical inverse(base 2). 비트를 뒤집어 [0,1) 에 균등 분포시킨다.
 * 같은 인덱스는 언제나 같은 값 — 결정성 계약을 깨지 않는 유일한 "샘플링" 방식이다.
 */
export function radicalInverseVdC(index: number): number {
  let bits = index >>> 0;
  bits = ((bits << 16) | (bits >>> 16)) >>> 0;
  bits = (((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1)) >>> 0;
  bits = (((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2)) >>> 0;
  bits = (((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4)) >>> 0;
  bits = (((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8)) >>> 0;
  return bits * 2.3283064365386963e-10; // 2⁻³²
}

/** Hammersley 점 (i/N, radicalInverse(i)). */
export function hammersley(index: number, count: number): readonly [number, number] {
  return [index / count, radicalInverseVdC(index)];
}

/** 법선 n 을 +Z 로 하는 정규직교 기저(Duff et al. 부호 안정판). */
export function studioPbrOrthonormalBasis(n: StudioPbrVec3): {
  readonly tangent: StudioPbrVec3;
  readonly bitangent: StudioPbrVec3;
} {
  const sign = n.z >= 0 ? 1 : -1;
  const a = -1 / (sign + n.z);
  const b = n.x * n.y * a;
  return {
    tangent: { x: 1 + sign * n.x * n.x * a, y: sign * b, z: -sign * n.x },
    bitangent: { x: b, y: sign + n.y * n.y * a, z: -n.y },
  };
}

/**
 * GGX NDF 중요도 샘플링 — (u1,u2) → 하프벡터 h(월드 공간).
 * pdf(h) = D(h)·(n·h) 이며, 반사 방향의 pdf 는 D(h)(n·h)/(4(v·h)) 이다.
 */
export function importanceSampleGgx(
  u1: number,
  u2: number,
  alpha: number,
  normal: StudioPbrVec3,
): StudioPbrVec3 {
  const a2 = alpha * alpha;
  const phi = TAU * u1;
  // cosθ = sqrt((1-u2)/(1+(α²-1)u2)) — GGX 분포의 역누적분포.
  const cosTheta = Math.sqrt((1 - u2) / (1 + (a2 - 1) * u2));
  const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
  const hx = sinTheta * Math.cos(phi);
  const hy = sinTheta * Math.sin(phi);
  const { tangent, bitangent } = studioPbrOrthonormalBasis(normal);
  return studioPbrNormalize({
    x: tangent.x * hx + bitangent.x * hy + normal.x * cosTheta,
    y: tangent.y * hx + bitangent.y * hy + normal.y * cosTheta,
    z: tangent.z * hx + bitangent.z * hy + normal.z * cosTheta,
  });
}

// ---------------------------------------------------------------------------
// 방향 알베도 E(μ,α) — 화이트 퍼니스(F=1) 단일산란 에너지
// ---------------------------------------------------------------------------

/** E 계산 기본 샘플 수 — 테스트/보상 테이블 모두 이 값을 기본으로 쓴다. */
export const STUDIO_PBR_ALBEDO_SAMPLES = 256;

/**
 * 단일산란 GGX 방향 알베도 E(μo, α) = ∫ f_ss·μi dωi (F=1).
 * GGX 하프벡터 중요도 샘플링 추정량은 G·(v·h)/((n·v)(n·h)) 로 정리된다.
 *
 * 이 값은 **1 보다 작다** — 미세면 재반사를 버린 만큼이 그대로 손실이다.
 * α 가 클수록 손실이 커지며 테스트가 그 곡선을 그대로 단언한다(숨기지 않는다).
 */
export function directionalAlbedoGgx(
  nDotV: number,
  alpha: number,
  sampleCount = STUDIO_PBR_ALBEDO_SAMPLES,
): number {
  const v = Math.min(1, Math.max(1e-4, nDotV));
  const roughness = Math.sqrt(alpha);
  const view: StudioPbrVec3 = { x: Math.sqrt(Math.max(0, 1 - v * v)), y: 0, z: v };
  const normal: StudioPbrVec3 = { x: 0, y: 0, z: 1 };
  let sum = 0;
  for (let i = 0; i < sampleCount; i += 1) {
    const [u1, u2] = hammersley(i, sampleCount);
    const h = importanceSampleGgx(u1, u2, alpha, normal);
    const vDotH = studioPbrDot(view, h);
    const l = studioPbrAdd(studioPbrScale(h, 2 * vDotH), studioPbrScale(view, -1));
    const nDotL = l.z;
    if (nDotL <= 0) continue;
    const nDotH = saturate(h.z);
    if (nDotH <= 0 || vDotH <= 0) continue;
    const g = geometrySmithSchlickGgx(v, nDotL, roughness, "ibl");
    sum += (g * vDotH) / (nDotH * v);
  }
  return sum / sampleCount;
}

/**
 * 반구 평균 알베도 Eavg(α) = 2∫₀¹ E(μ)·μ dμ — Gauss-Legendre 대신 midpoint 로
 * 고정 스텝 적분한다(결정적·단순, E 자체가 부드러운 함수라 충분).
 */
export function averageAlbedoGgx(
  alpha: number,
  steps = 32,
  sampleCount = STUDIO_PBR_ALBEDO_SAMPLES,
): number {
  let sum = 0;
  const dx = 1 / steps;
  for (let i = 0; i < steps; i += 1) {
    const mu = (i + 0.5) * dx;
    sum += directionalAlbedoGgx(mu, alpha, sampleCount) * mu * dx;
  }
  return 2 * sum;
}

/**
 * Kulla-Conty 다중산란 로브 (F=1 기준, 색 무관 스칼라).
 *   f_ms(μo,μi) = (1-E(μo))(1-E(μi)) / (π(1-Eavg))
 * 해석적으로 ∫f_ms·μi dωi = 1-E(μo) 라서 단일산란 손실을 정확히 되메운다.
 * Eavg → 1 (거의 매끈한 표면)일 때는 분모가 0 으로 가므로 손실도 0 → 로브를 0 으로 둔다.
 */
export function multiScatterLobeGgx(albedoV: number, albedoL: number, averageAlbedo: number): number {
  const deficit = 1 - averageAlbedo;
  if (deficit <= 1e-9) return 0;
  return ((1 - albedoV) * (1 - albedoL)) / (Math.PI * deficit);
}

/**
 * Fdez-Agüera IBL 다중산란 보상항 — split-sum LUT(scale,bias)에서 바로 계산한다.
 * 반환값은 스페큘러 IBL 에 **가산**할 계수다(FssEss 와 함께 쓴다).
 */
export function multiScatterCompensationGgx(
  f0: number,
  dfg: { readonly scale: number; readonly bias: number },
): number {
  const fssEss = f0 * dfg.scale + dfg.bias;
  const ess = dfg.scale + dfg.bias;
  const ems = 1 - ess;
  if (ems <= 0) return 0;
  // 평균 프레넬 근사 F_avg = F0 + (1-F0)/21 (Fdez-Agüera 2019).
  const fAvg = f0 + (1 - f0) / 21;
  const denominator = 1 - ems * fAvg;
  if (denominator <= 1e-9) return 0;
  const fms = (fssEss * fAvg) / denominator;
  return fms * ems;
}

// ---------------------------------------------------------------------------
// 반구 구적법 — 테스트가 쓰는 독립 적분기
// ---------------------------------------------------------------------------

/**
 * n=+Z 반구 위의 코사인 가중 적분 ∫ fn(l)·(n·l) dω 를 midpoint 격자로 계산한다.
 * 중요도 샘플링과 **완전히 독립**이라 에너지 보존 검증의 대조군으로 쓸 수 있다.
 * 스파이크가 날카로운 저러프니스 스페큘러에는 부정확하다 — 부드러운 로브 전용.
 */
export function integrateHemisphereCosine(
  fn: (direction: StudioPbrVec3) => number,
  thetaSteps = 64,
  phiSteps = 128,
): number {
  let sum = 0;
  const dTheta = Math.PI / 2 / thetaSteps;
  const dPhi = TAU / phiSteps;
  for (let ti = 0; ti < thetaSteps; ti += 1) {
    const theta = (ti + 0.5) * dTheta;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    for (let pi = 0; pi < phiSteps; pi += 1) {
      const phi = (pi + 0.5) * dPhi;
      const direction: StudioPbrVec3 = {
        x: sinTheta * Math.cos(phi),
        y: sinTheta * Math.sin(phi),
        z: cosTheta,
      };
      sum += fn(direction) * cosTheta * sinTheta * dTheta * dPhi;
    }
  }
  return sum;
}

export interface StudioPbrWhiteFurnaceOptions {
  /** true 면 Kulla-Conty 다중산란 로브를 더해 에너지를 닫는다. */
  readonly compensate: boolean;
  readonly sampleCount?: number;
  /** 다중산란 로브 적분 격자(부드러운 로브라 성긴 격자로 충분). */
  readonly thetaSteps?: number;
  readonly phiSteps?: number;
}

/**
 * 화이트 퍼니스 프로브 — 사방이 radiance 1 인 환경에서 표면이 반사하는 총 에너지.
 * 이상적인 에너지 보존 BRDF 라면 정확히 1 이어야 한다.
 *
 * 단일산란 항은 GGX 중요도 샘플링(directionalAlbedoGgx)으로, 다중산란 항은
 * **독립 반구 구적법**으로 계산한다. 후자는 로브 구현·Eavg·정규화가 모두 맞아야만
 * 1-E 로 수렴하므로 테스트로서 실질적 검증력이 있다.
 */
export function whiteFurnaceIntegral(
  nDotV: number,
  alpha: number,
  options: StudioPbrWhiteFurnaceOptions,
): number {
  const sampleCount = options.sampleCount ?? STUDIO_PBR_ALBEDO_SAMPLES;
  const single = directionalAlbedoGgx(nDotV, alpha, sampleCount);
  if (!options.compensate) return single;
  const averageAlbedo = averageAlbedoGgx(alpha, 32, sampleCount);
  const multi = integrateHemisphereCosine(
    (l) => multiScatterLobeGgx(single, directionalAlbedoGgx(l.z, alpha, sampleCount), averageAlbedo),
    options.thetaSteps ?? 32,
    options.phiSteps ?? 8,
  );
  return single + multi;
}

// ---------------------------------------------------------------------------
// Cook-Torrance 평가 (직접광 1개 기준, 선형 RGB)
// ---------------------------------------------------------------------------

export interface StudioPbrSurface {
  /** 표면 법선(단위). */
  readonly normal: StudioPbrVec3;
  /** 표면 → 눈 방향(단위). */
  readonly view: StudioPbrVec3;
  /** 표면 → 광원 방향(단위). */
  readonly light: StudioPbrVec3;
  /** 선형 RGB 알베도(0..1). 금속에서는 F0 로 쓰인다. */
  readonly baseColor: readonly [number, number, number];
  readonly metallic: number;
  readonly roughness: number;
  /** 유전체 반사율(기본 0.04). */
  readonly reflectance?: number;
}

export interface StudioPbrShadeResult {
  readonly diffuse: readonly [number, number, number];
  readonly specular: readonly [number, number, number];
  /** diffuse + specular, 이미 (n·l) 가 곱해진 값. */
  readonly total: readonly [number, number, number];
  readonly nDotL: number;
}

/**
 * Cook-Torrance 단일산란 BRDF 를 광원 1개에 대해 평가한다(radiance 1 기준).
 * 확산은 Lambert(albedo/π)이고 금속은 확산이 0 이다. kD = (1-F)(1-metallic) 로
 * 프레넬이 가져간 만큼 확산에서 뺀다.
 */
export function evaluateCookTorrance(surface: StudioPbrSurface): StudioPbrShadeResult {
  const n = surface.normal;
  const v = surface.view;
  const l = surface.light;
  const nDotL = saturate(studioPbrDot(n, l));
  const nDotV = saturate(studioPbrDot(n, v));
  if (nDotL <= 0 || nDotV <= 0) {
    return { diffuse: [0, 0, 0], specular: [0, 0, 0], total: [0, 0, 0], nDotL: 0 };
  }
  const h = studioPbrNormalize(studioPbrAdd(v, l));
  const nDotH = saturate(studioPbrDot(n, h));
  const vDotH = saturate(studioPbrDot(v, h));

  const roughness = saturate(surface.roughness);
  const alpha = studioPbrRoughnessToAlpha(roughness);
  const metallic = saturate(surface.metallic);
  const reflectance = surface.reflectance ?? STUDIO_PBR_DIELECTRIC_F0;

  const d = distributionGgx(nDotH, alpha);
  const vis = visibilitySmithGgxCorrelated(nDotV, nDotL, alpha);

  const diffuse: [number, number, number] = [0, 0, 0];
  const specular: [number, number, number] = [0, 0, 0];
  const total: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c += 1) {
    const base = surface.baseColor[c];
    const f0 = reflectance * (1 - metallic) + base * metallic;
    const f = fresnelSchlick(vDotH, f0);
    // f_spec = D·V·F (V 가 이미 1/(4·nDotV·nDotL) 을 포함)
    const spec = d * vis * f * nDotL;
    const kD = (1 - f) * (1 - metallic);
    const diff = ((kD * base) / Math.PI) * nDotL;
    diffuse[c] = diff;
    specular[c] = spec;
    total[c] = diff + spec;
  }
  return { diffuse, specular, total, nDotL };
}
