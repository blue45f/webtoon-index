/**
 * Studio PBR — 노출 + 톤매핑 커브 (순수 TS, 정확한 역함수 포함)
 *
 * StudioBg3dRenderSettings 의 `toneMapping: "none" | "neutral" | "aces"` 와 `exposure` 를
 * 공유 수학으로 구현한다. 지금까지 이 세 이름은 문서 필드로만 존재하고 공유 커브 모듈이
 * 없었다 — 그래서 작가가 exposure 를 만지면 LT 톤 패스의 밴드 경계가 예측 불가하게
 * 움직였다. 밴드 경계는 전적으로 이 커브에 달려 있으므로 커브가 단일 소스여야 한다.
 *
 * 【세 커브】
 *  - "none"    : y = x·exposure. 커브 없음. 역함수는 정확(나눗셈 하나).
 *  - "neutral" : Khronos PBR Neutral. three 의 NeutralToneMapping 과 같은 알고리즘 —
 *                (a) 어두운 쪽에서 균일 오프셋을 빼 검정을 살짝 들어올리고,
 *                (b) startCompression(0.76) 위쪽 피크를 유리함수로 1 에 점근시키며,
 *                (c) 압축량에 비례해 하이라이트를 흰색으로 탈채도시킨다.
 *                채널이 서로 얽히지만 max/min 구조 덕분에 **해석적 역함수가 존재**한다
 *                (아래 invert 구현이 그 역산이며 테스트가 왕복 오차를 잰다).
 *  - "aces"    : Narkowicz 의 ACES **근사 피팅**이다. 진짜 RRT+ODT 가 아니다.
 *                채널별 유리함수 y = x(2.51x+0.03)/(x(2.43x+0.59)+0.14) 이고,
 *                역함수는 이차방정식의 양근으로 **닫힌 형태**로 구한다.
 *
 * 【정직한 한계】
 *  - "aces" 는 피팅이다. ACES 색공간 변환 행렬(ACEScg↔AP1)도, RRT 의 실제 스윕도 없다.
 *    three 의 ACESFilmicToneMapping 과도 정확히 같지 않다(그쪽은 행렬 포함판).
 *  - forward 는 [0,1] 로 클램프하지 않는다. aces 커브의 점근값은 2.51/2.43 ≈ 1.0329 라
 *    1 을 살짝 넘길 수 있으며, 클램프는 표시 단계의 책임이다. 클램프 후에는 역함수가
 *    성립하지 않는다(정보가 소실되므로).
 *  - "neutral" 의 역함수는 피크가 매우 클 때(탈채도 계수 g→1) 조건수가 나빠진다.
 *    실용 범위(선형 입력 ≤ 약 16)에서 왕복 오차가 1e-6 이하임을 테스트가 확인한다.
 *
 * 【웹툰 파이프라인 기여도】 화려하지 않지만 필수다. cel 양자화 밴드 경계가 이 커브
 *  하나로 결정되므로, 커브가 공유되지 않으면 exposure 조작이 스크린톤 밀도를
 *  예측 불가하게 바꾼다. 역함수가 있어야 "이 밴드 경계를 만들려면 선형 광량이 얼마여야
 *  하는가" 를 되풀 수 있다.
 */

export type StudioPbrToneMapMode = "none" | "neutral" | "aces";

export interface StudioPbrToneMapParams {
  readonly mode: StudioPbrToneMapMode;
  /** 선형 광량에 곱하는 노출 배수(>0). 기본 1. */
  readonly exposure?: number;
}

export type StudioPbrRgb = readonly [number, number, number];

// --- Khronos PBR Neutral 상수 ---------------------------------------------
const NEUTRAL_START_COMPRESSION = 0.8 - 0.04; // 0.76
const NEUTRAL_DESATURATION = 0.15;
const NEUTRAL_D = 1 - NEUTRAL_START_COMPRESSION; // 0.24
const NEUTRAL_TOE_LIMIT = 0.08;
const NEUTRAL_TOE_K = 6.25;
const NEUTRAL_TOE_OFFSET = 0.04; // = 0.08 - 6.25·0.08²

// --- Narkowicz ACES 피팅 계수 ----------------------------------------------
const ACES_A = 2.51;
const ACES_B = 0.03;
const ACES_C = 2.43;
const ACES_D = 0.59;
const ACES_E = 0.14;

/** aces 커브가 x→∞ 에서 접근하는 상한. 이 값 이상은 역함수가 정의되지 않는다. */
export const STUDIO_PBR_ACES_CEILING = ACES_A / ACES_C;

function normalizeExposure(exposure: number | undefined): number {
  if (exposure === undefined) return 1;
  if (!Number.isFinite(exposure) || exposure <= 0) {
    throw new Error(`studio-pbr: exposure 는 유한한 양수여야 한다 (${exposure})`);
  }
  return exposure;
}

// ---------------------------------------------------------------------------
// ACES (Narkowicz 피팅) — 채널별
// ---------------------------------------------------------------------------

/** 채널별 Narkowicz ACES 근사. 음수 입력은 0 으로 흡수한다. */
export function studioPbrAcesChannel(x: number): number {
  const v = x > 0 ? x : 0;
  return (v * (ACES_A * v + ACES_B)) / (v * (ACES_C * v + ACES_D) + ACES_E);
}

/**
 * studioPbrAcesChannel 의 닫힌 형태 역함수.
 *   y·(Cx² + Dx + E) = Ax² + Bx  →  (A - Cy)x² + (B - Dy)x - Ey = 0
 * y ≥ STUDIO_PBR_ACES_CEILING 이면 해가 없으므로 Infinity 를 돌려준다.
 */
export function studioPbrAcesChannelInverse(y: number): number {
  if (y <= 0) return 0;
  if (y >= STUDIO_PBR_ACES_CEILING) return Number.POSITIVE_INFINITY;
  const a = ACES_A - ACES_C * y;
  const b = ACES_B - ACES_D * y;
  const c = -ACES_E * y;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return Number.NaN;
  return (-b + Math.sqrt(discriminant)) / (2 * a);
}

// ---------------------------------------------------------------------------
// Khronos PBR Neutral
// ---------------------------------------------------------------------------

function neutralToeOffset(minChannel: number): number {
  return minChannel < NEUTRAL_TOE_LIMIT
    ? minChannel - NEUTRAL_TOE_K * minChannel * minChannel
    : NEUTRAL_TOE_OFFSET;
}

/** Khronos PBR Neutral 정방향(노출은 이미 곱해진 입력을 받는다). */
export function studioPbrNeutral(rgb: StudioPbrRgb): [number, number, number] {
  const r = rgb[0] > 0 ? rgb[0] : 0;
  const g = rgb[1] > 0 ? rgb[1] : 0;
  const b = rgb[2] > 0 ? rgb[2] : 0;
  const offset = neutralToeOffset(Math.min(r, g, b));
  const cr = r - offset;
  const cg = g - offset;
  const cb = b - offset;
  const peak = Math.max(cr, cg, cb);
  if (peak < NEUTRAL_START_COMPRESSION) return [cr, cg, cb];
  const newPeak = 1 - (NEUTRAL_D * NEUTRAL_D) / (peak + NEUTRAL_D - NEUTRAL_START_COMPRESSION);
  const k = newPeak / peak;
  const desat = 1 - 1 / (NEUTRAL_DESATURATION * (peak - newPeak) + 1);
  const mix = (value: number): number => value * k * (1 - desat) + newPeak * desat;
  return [mix(cr), mix(cg), mix(cb)];
}

/**
 * Khronos PBR Neutral 의 해석적 역함수.
 *
 * 역산 순서: max(out) 이 곧 newPeak 이라는 성질(압축 후 최대 채널이 정확히 newPeak 이고
 * 탈채도 mix 는 최대 채널을 움직이지 않는다)에서 시작해 peak → desat → 원래 채널 →
 * toe 오프셋 순으로 되돌린다. toe 는 min(c) 값으로 두 분기를 구별한다:
 * m ≥ 0.04 이면 상수 오프셋 구간, 아니면 m = 6.25x² 를 풀어 x 를 되찾는다.
 */
export function studioPbrNeutralInverse(rgb: StudioPbrRgb): [number, number, number] {
  const outMax = Math.max(rgb[0], rgb[1], rgb[2]);
  let cr = rgb[0];
  let cg = rgb[1];
  let cb = rgb[2];
  if (outMax >= NEUTRAL_START_COMPRESSION) {
    const newPeak = outMax;
    if (newPeak >= 1) return [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    const peak = (NEUTRAL_D * NEUTRAL_D) / (1 - newPeak) + NEUTRAL_START_COMPRESSION - NEUTRAL_D;
    const desat = 1 - 1 / (NEUTRAL_DESATURATION * (peak - newPeak) + 1);
    const scale = peak / newPeak;
    const unmix = (value: number): number => ((value - newPeak * desat) / (1 - desat)) * scale;
    cr = unmix(rgb[0]);
    cg = unmix(rgb[1]);
    cb = unmix(rgb[2]);
  }
  const m = Math.max(0, Math.min(cr, cg, cb));
  const offset = m >= NEUTRAL_TOE_OFFSET ? NEUTRAL_TOE_OFFSET : Math.sqrt(m / NEUTRAL_TOE_K) - m;
  return [cr + offset, cg + offset, cb + offset];
}

// ---------------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------------

/**
 * 선형 RGB → 톤매핑된 표시값. 클램프하지 않는다(표시 단계의 책임).
 */
export function applyStudioPbrToneMap(rgb: StudioPbrRgb, params: StudioPbrToneMapParams): [number, number, number] {
  const exposure = normalizeExposure(params.exposure);
  const exposed: StudioPbrRgb = [rgb[0] * exposure, rgb[1] * exposure, rgb[2] * exposure];
  switch (params.mode) {
    case "none":
      return [exposed[0], exposed[1], exposed[2]];
    case "neutral":
      return studioPbrNeutral(exposed);
    case "aces":
      return [
        studioPbrAcesChannel(exposed[0]),
        studioPbrAcesChannel(exposed[1]),
        studioPbrAcesChannel(exposed[2]),
      ];
    default: {
      const exhaustive: never = params.mode;
      throw new Error(`studio-pbr: 알 수 없는 톤매핑 모드 ${String(exhaustive)}`);
    }
  }
}

/**
 * applyStudioPbrToneMap 의 역함수 — 표시값 → 선형 RGB.
 * 커브 상한을 넘는 입력에는 Infinity 를 돌려준다(정보 소실 구간).
 */
export function invertStudioPbrToneMap(rgb: StudioPbrRgb, params: StudioPbrToneMapParams): [number, number, number] {
  const exposure = normalizeExposure(params.exposure);
  let linear: [number, number, number];
  switch (params.mode) {
    case "none":
      linear = [rgb[0], rgb[1], rgb[2]];
      break;
    case "neutral":
      linear = studioPbrNeutralInverse(rgb);
      break;
    case "aces":
      linear = [
        studioPbrAcesChannelInverse(rgb[0]),
        studioPbrAcesChannelInverse(rgb[1]),
        studioPbrAcesChannelInverse(rgb[2]),
      ];
      break;
    default: {
      const exhaustive: never = params.mode;
      throw new Error(`studio-pbr: 알 수 없는 톤매핑 모드 ${String(exhaustive)}`);
    }
  }
  return [linear[0] / exposure, linear[1] / exposure, linear[2] / exposure];
}

/**
 * cel 양자화 밴드 경계를 **선형 광량**으로 되푼다.
 *
 * LT 톤 패스는 톤매핑된 휘도를 levels 개의 밴드로 자른다. 밴드 i 의 상단 경계는 표시
 * 공간에서 (i+1)/levels 이며, 그 경계에 해당하는 선형 광량이 이 함수의 반환값이다.
 * 작가가 exposure 를 만졌을 때 스크린톤 밀도가 어떻게 움직이는지 예측하는 데 쓴다.
 * 커브 상한 위의 경계는 Infinity 가 되므로 호출부는 그 밴드가 도달 불가임을 알 수 있다.
 */
export function studioPbrToneBandThresholds(levels: number, params: StudioPbrToneMapParams): Float64Array {
  if (!Number.isInteger(levels) || levels < 2) {
    throw new Error(`studio-pbr: levels 는 2 이상 정수여야 한다 (${levels})`);
  }
  const thresholds = new Float64Array(levels - 1);
  for (let i = 0; i < levels - 1; i += 1) {
    const display = (i + 1) / levels;
    const [linear] = invertStudioPbrToneMap([display, display, display], params);
    thresholds[i] = linear;
  }
  return thresholds;
}
