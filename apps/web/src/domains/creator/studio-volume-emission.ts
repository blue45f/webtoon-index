/**
 * Studio Volume — 온도 → 방출(불) 매핑
 *
 * ── 매핑 정의(문서화 필수 항목) ──────────────────────────────────────────
 * 1) **분광 복사휘도**: 플랑크 법칙을 그대로 쓴다.
 *
 *        B(λ, T) = (2hc² / λ⁵) / (exp(hc / (λ k_B T)) - 1)          [W·sr⁻¹·m⁻³]
 *
 *    h, c, k_B 는 2019 SI 정의값을 그대로 박아둔다. 빈의 변위법칙(λ_max·T = 2.897771955e-3 m·K)
 *    이 이 구현에서 실제로 성립하는지는 테스트가 수치 탐색으로 확인한다.
 *
 * 2) **분광 → XYZ**: Wyman·Sloan·Shirley(2013)의 다엽 가우시안 근사로 CIE 1931 등색함수를
 *    평가하고 360–830 nm 를 5 nm 간격 리만 합으로 적분한다. 실제 CIE 표를 싣지 않는 이유는
 *    번들 예산(스튜디오 청크 budget) 때문이며, 이 근사의 오차는 색도 좌표 기준 1e-3 수준이라
 *    불꽃 색 재현에는 과분하다. (한계로 명시)
 *
 * 3) **XYZ → 선형 sRGB**: Rec.709/sRGB(D65) 행렬. 음수는 0 으로 자른다(색역 밖 클리핑).
 *    결과는 **채널 최댓값이 1** 이 되도록 정규화한 "색도(chroma)" 다 — 밝기는 4)가 정한다.
 *    ⚠️ 한계: 약 1900K 미만 흑체는 sRGB 색역 **밖**의 진한 적색이라 B 채널이 정확히 0 으로
 *    클리핑된다(색상 자체는 여전히 단조롭게 변하지만 B/R 비로는 관측되지 않는다). 넓은 색역
 *    출력이 필요해지면 이 단계만 Rec.2020/ACEScg 행렬로 갈아끼우면 된다.
 *
 * 4) **밝기(스테판–볼츠만)**: 방출 총량은 T⁴ 에 비례한다.
 *
 *        L_e(T) = intensity · (T / referenceK)^exponent · chroma(T) · gate(T)
 *
 *    exponent 기본값 4 가 스테판–볼츠만이고, 아트 디렉션용으로 낮출 수 있다.
 *    gate(T) 는 ignitionK 미만에서 0 이고 [ignitionK, ignitionK + rampK] 구간을 smoothstep 으로
 *    잇는다(rampK 기본 0 = 하드 게이트).
 *
 * 5) **RTE 결합**: 방출 항은 `σ_a · L_e(T)` 로 들어간다(σ_a = (1 - albedo)·σ_t). 즉 밀도가 0 인
 *    곳은 온도가 높아도 빛을 내지 않는다 — 키르히호프 법칙(흡수 = 방출)에 맞고, 빈 공간 스킵이
 *    이미지를 바꾸지 않는다는 계약도 이것 덕에 성립한다.
 */

/** 플랑크 상수 [J·s] (2019 SI 정의값). */
export const PLANCK_CONSTANT = 6.62607015e-34;
/** 진공 광속 [m/s] (정의값). */
export const SPEED_OF_LIGHT = 2.99792458e8;
/** 볼츠만 상수 [J/K] (2019 SI 정의값). */
export const BOLTZMANN_CONSTANT = 1.380649e-23;
/** 빈의 변위 상수 [m·K] — 테스트 기준값. */
export const WIEN_DISPLACEMENT_CONSTANT = 2.897771955e-3;

const CMF_LAMBDA_MIN = 360;
const CMF_LAMBDA_MAX = 830;
const CMF_LAMBDA_STEP = 5;

export interface StudioVolumeEmissionParams {
  /** 이 온도(K) 미만은 방출 0. */
  readonly ignitionK: number;
  /** ignitionK 위로 이만큼(K) smoothstep 램프. 0 이면 하드 게이트. */
  readonly rampK: number;
  /** intensity 가 그대로 적용되는 기준 온도(K). */
  readonly referenceK: number;
  /** referenceK 에서의 복사휘도 스케일. */
  readonly intensity: number;
  /** 스테판–볼츠만 지수. 기본 4. */
  readonly exponent: number;
  /** 색도 계산 시 온도 상한(K) — 시뮬레이터의 스파이크가 색을 폭주시키지 않게 자른다. */
  readonly maxK: number;
}

export const STUDIO_VOLUME_DEFAULT_EMISSION: StudioVolumeEmissionParams = Object.freeze({
  ignitionK: 900,
  rampK: 0,
  referenceK: 1500,
  intensity: 1,
  exponent: 4,
  maxK: 6000,
});

export function normalizeStudioVolumeEmissionParams(
  params?: Partial<StudioVolumeEmissionParams> | null
): StudioVolumeEmissionParams {
  const base = STUDIO_VOLUME_DEFAULT_EMISSION;
  const pick = (value: unknown, fallback: number, min: number): number =>
    typeof value === "number" && Number.isFinite(value) && value >= min ? value : fallback;
  const referenceK = pick(params?.referenceK, base.referenceK, 1);
  return {
    ignitionK: pick(params?.ignitionK, base.ignitionK, 0),
    rampK: pick(params?.rampK, base.rampK, 0),
    referenceK,
    intensity: pick(params?.intensity, base.intensity, 0),
    exponent: pick(params?.exponent, base.exponent, 0),
    maxK: Math.max(pick(params?.maxK, base.maxK, 1), referenceK),
  };
}

/** 플랑크 법칙. λ ≤ 0 또는 T ≤ 0 이면 0, 지수 오버플로 영역도 0 으로 수렴시킨다. */
export function planckSpectralRadiance(wavelengthNm: number, temperatureK: number): number {
  if (!(wavelengthNm > 0) || !(temperatureK > 0)) return 0;
  const lambda = wavelengthNm * 1e-9;
  const exponent =
    (PLANCK_CONSTANT * SPEED_OF_LIGHT) / (lambda * BOLTZMANN_CONSTANT * temperatureK);
  if (exponent > 700) return 0;
  const denom = Math.expm1(exponent);
  if (!(denom > 0)) return 0;
  const lambda5 = lambda * lambda * lambda * lambda * lambda;
  return (2 * PLANCK_CONSTANT * SPEED_OF_LIGHT * SPEED_OF_LIGHT) / (lambda5 * denom);
}

/** 비대칭 가우시안 — Wyman 등의 근사에 쓰이는 기본 엽(lobe). */
function lobe(x: number, mu: number, sigma1: number, sigma2: number): number {
  const t = (x - mu) * (x < mu ? 1 / sigma1 : 1 / sigma2);
  return Math.exp(-0.5 * t * t);
}

/** CIE 1931 x̄(λ) 근사. */
export function cieXBar(lambdaNm: number): number {
  return (
    1.056 * lobe(lambdaNm, 599.8, 37.9, 31.0) +
    0.362 * lobe(lambdaNm, 442.0, 16.0, 26.7) -
    0.065 * lobe(lambdaNm, 501.1, 20.4, 26.2)
  );
}

/** CIE 1931 ȳ(λ) 근사. */
export function cieYBar(lambdaNm: number): number {
  return 0.821 * lobe(lambdaNm, 568.8, 46.9, 40.5) + 0.286 * lobe(lambdaNm, 530.9, 16.3, 31.1);
}

/** CIE 1931 z̄(λ) 근사. */
export function cieZBar(lambdaNm: number): number {
  return 1.217 * lobe(lambdaNm, 437.0, 11.8, 36.0) + 0.681 * lobe(lambdaNm, 459.0, 26.0, 13.8);
}

/** 흑체 스펙트럼을 CIE XYZ 로 적분한다(정규화 없음 — 상대값). out = [X, Y, Z]. */
export function blackbodyXyz(
  temperatureK: number,
  out: Float64Array = new Float64Array(3)
): Float64Array {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let l = CMF_LAMBDA_MIN; l <= CMF_LAMBDA_MAX; l += CMF_LAMBDA_STEP) {
    const radiance = planckSpectralRadiance(l, temperatureK);
    if (radiance === 0) continue;
    x += radiance * cieXBar(l);
    y += radiance * cieYBar(l);
    z += radiance * cieZBar(l);
  }
  out[0] = x * CMF_LAMBDA_STEP;
  out[1] = y * CMF_LAMBDA_STEP;
  out[2] = z * CMF_LAMBDA_STEP;
  return out;
}

/** XYZ → 선형 sRGB(D65, Rec.709). 음수 클리핑 포함. out = [r, g, b]. */
export function xyzToLinearSrgb(
  x: number,
  y: number,
  z: number,
  out: Float64Array = new Float64Array(3)
): Float64Array {
  const r = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const g = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const b = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  out[0] = r > 0 ? r : 0;
  out[1] = g > 0 ? g : 0;
  out[2] = b > 0 ? b : 0;
  return out;
}

/**
 * 흑체 색도 — 채널 최댓값이 1 이 되도록 정규화한 선형 sRGB.
 * 밝기 정보는 담지 않는다(밝기는 스테판–볼츠만 항이 담당).
 */
export function blackbodyChroma(
  temperatureK: number,
  out: Float64Array = new Float64Array(3)
): Float64Array {
  if (!(temperatureK > 0)) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return out;
  }
  const xyz = blackbodyXyz(temperatureK);
  xyzToLinearSrgb(xyz[0], xyz[1], xyz[2], out);
  const max = Math.max(out[0], out[1], out[2]);
  if (max > 0) {
    out[0] /= max;
    out[1] /= max;
    out[2] /= max;
  }
  return out;
}

function smoothstep01(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/** 점화 게이트 — ignitionK 미만 0, rampK 구간 smoothstep, 그 위 1. */
export function studioVolumeIgnitionGate(
  temperatureK: number,
  params: StudioVolumeEmissionParams
): number {
  if (!(temperatureK > params.ignitionK)) return 0;
  if (!(params.rampK > 0)) return 1;
  return smoothstep01((temperatureK - params.ignitionK) / params.rampK);
}

/**
 * 온도 → 방출 복사휘도(선형 sRGB). out = [r, g, b].
 * 위 문서의 4) 수식을 그대로 구현한다.
 */
export function studioVolumeBlackbodyEmission(
  temperatureK: number,
  params: StudioVolumeEmissionParams,
  out: Float64Array = new Float64Array(3)
): Float64Array {
  const gate = studioVolumeIgnitionGate(temperatureK, params);
  if (gate <= 0 || params.intensity <= 0) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return out;
  }
  const clampedK = Math.min(temperatureK, params.maxK);
  blackbodyChroma(clampedK, out);
  const power = Math.pow(clampedK / params.referenceK, params.exponent);
  const scale = params.intensity * power * gate;
  out[0] *= scale;
  out[1] *= scale;
  out[2] *= scale;
  return out;
}

/**
 * GPU 경로 패리티용 방출 LUT. [0, maxK] 를 size 칸으로 나눠 RGB 를 미리 굽는다.
 * WGSL 은 플랑크/CIE 적분을 하지 않고 이 LUT 를 선형 보간만 한다 → CPU 와 같은 매핑을 보장한다.
 * 레이아웃: `lut[i*4 + 0..2] = rgb`, `lut[i*4 + 3] = 해당 칸의 온도(K)`.
 */
export function buildStudioVolumeEmissionLut(
  params: StudioVolumeEmissionParams,
  size = 256
): Float32Array {
  const n = Math.max(2, Math.floor(size));
  const lut = new Float32Array(n * 4);
  const rgb = new Float64Array(3);
  for (let i = 0; i < n; i += 1) {
    const t = (i / (n - 1)) * params.maxK;
    studioVolumeBlackbodyEmission(t, params, rgb);
    lut[i * 4] = rgb[0];
    lut[i * 4 + 1] = rgb[1];
    lut[i * 4 + 2] = rgb[2];
    lut[i * 4 + 3] = t;
  }
  return lut;
}

/** LUT 선형 조회(WGSL 과 동일 수식). out = [r, g, b]. */
export function sampleStudioVolumeEmissionLut(
  lut: Float32Array,
  maxK: number,
  temperatureK: number,
  out: Float64Array = new Float64Array(3)
): Float64Array {
  const n = lut.length >> 2;
  if (n < 2 || !(maxK > 0) || !(temperatureK > 0)) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return out;
  }
  const g = Math.min(temperatureK / maxK, 1) * (n - 1);
  const i0 = Math.min(Math.floor(g), n - 2);
  const f = g - i0;
  const a = i0 * 4;
  const b = a + 4;
  out[0] = lut[a] + (lut[b] - lut[a]) * f;
  out[1] = lut[a + 1] + (lut[b + 1] - lut[a + 1]) * f;
  out[2] = lut[a + 2] + (lut[b + 2] - lut[a + 2]) * f;
  return out;
}
