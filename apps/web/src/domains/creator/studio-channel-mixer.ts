/**
 * Studio Channel Mixer Engine
 * 포토샵 "채널 혼합(Channel Mixer)" 보정 — 출력 R·G·B 각각을 입력 R·G·B의
 * 선형 결합(3x3 행렬)에 상수 오프셋을 더해 다시 굽고, 흑백(monochrome) 모드에서는
 * 빨강 행 한 줄로 회색값을 만들어 세 채널에 똑같이 넣는다(알파 보존).
 * Konva/DOM 의존 없음 — StudioPage 캔버스 로직과 단위 테스트가 공유한다.
 * 전부 순수·결정적(랜덤 없음).
 */

import type { StudioImageDataLike } from "./studio-filters";

// ---------------------------------------------------------------------------
// 파라미터 타입·기본값·범위
// ---------------------------------------------------------------------------

/** 한 출력 채널 = r*R + g*G + b*B + constant*255. gain(r·g·b)은 -2..2, constant는 -1..1. */
export type MixerChannel = { r: number; g: number; b: number; constant: number };

/** 출력 R·G·B 세 채널의 혼합 묶음 + 흑백 모드 플래그. */
export type ChannelMixer = { red: MixerChannel; green: MixerChannel; blue: MixerChannel; monochrome: boolean };

/** 항등(보정 없음) — 각 채널이 자기 자신만 1배, monochrome:false. */
export const DEFAULT_CHANNEL_MIXER: ChannelMixer = {
  red: { r: 1, g: 0, b: 0, constant: 0 },
  green: { r: 0, g: 1, b: 0, constant: 0 },
  blue: { r: 0, g: 0, b: 1, constant: 0 },
  monochrome: false,
};

/** 채널 가중치(r·g·b) 슬라이더 범위 — -2..2, 0.05 단위. */
export const CHANNEL_MIXER_GAIN_RANGE = { min: -2, max: 2, step: 0.05 } as const;

/** 상수 오프셋(constant) 슬라이더 범위 — -1..1, 0.01 단위. */
export const CHANNEL_MIXER_CONST_RANGE = { min: -1, max: 1, step: 0.01 } as const;

// 출력 채널 키 — 정규화·항등 판정·평탄화에서 공통으로 순회한다(평탄 배열 순서이기도 함).
const CHANNEL_MIXER_KEYS = ["red", "green", "blue"] as const;

// ---------------------------------------------------------------------------
// 정규화·항등 판정
// ---------------------------------------------------------------------------

// 한 값을 [min,max]로 클램프, 숫자 아님은 fallback.
function clampNumber(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

// 한 출력 채널 정규화 — 누락/무효 gain은 0, constant도 0, 범위 밖은 클램프.
// def는 누락 시 채울 항등 기본값(예: red.r=1).
function normalizeChannel(raw: unknown, def: MixerChannel): MixerChannel {
  const src = raw && typeof raw === "object" ? (raw as Partial<MixerChannel>) : {};
  const { min: gMin, max: gMax } = CHANNEL_MIXER_GAIN_RANGE;
  const { min: cMin, max: cMax } = CHANNEL_MIXER_CONST_RANGE;
  return {
    r: clampNumber(src.r, gMin, gMax, def.r),
    g: clampNumber(src.g, gMin, gMax, def.g),
    b: clampNumber(src.b, gMin, gMax, def.b),
    constant: clampNumber(src.constant, cMin, cMax, def.constant),
  };
}

/**
 * 과거 저장본/외부 입력 안전장치 — 누락 채널은 항등 기본값, 누락/무효 값은 채널 기본값,
 * gain은 -2..2, constant는 -1..1로 클램프, monochrome은 Boolean으로 강제한 새 객체를 반환.
 */
export function normalizeChannelMixer(cm?: Partial<ChannelMixer> | null): ChannelMixer {
  const src = cm && typeof cm === "object" ? cm : {};
  return {
    red: normalizeChannel(src.red, DEFAULT_CHANNEL_MIXER.red),
    green: normalizeChannel(src.green, DEFAULT_CHANNEL_MIXER.green),
    blue: normalizeChannel(src.blue, DEFAULT_CHANNEL_MIXER.blue),
    monochrome: src.monochrome === true,
  };
}

// 한 채널이 주어진 항등 기본값과 완전히 같은지.
function isIdentityChannel(ch: MixerChannel, def: MixerChannel): boolean {
  return ch.r === def.r && ch.g === def.g && ch.b === def.b && ch.constant === def.constant;
}

/** 세 채널이 모두 항등 행렬이고 monochrome이 false — 즉 픽셀을 건드리지 않는 설정인지. */
export function isIdentityChannelMixer(cm: ChannelMixer): boolean {
  if (cm.monochrome) return false;
  for (const key of CHANNEL_MIXER_KEYS) {
    if (!isIdentityChannel(cm[key], DEFAULT_CHANNEL_MIXER[key])) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 적용 — 3x3 행렬 + 상수 오프셋(제자리 변형). Uint8ClampedArray가 반올림·0..255 클램프.
// ---------------------------------------------------------------------------

/**
 * 채널 혼합 제자리 적용 — 항등이면 no-op. 각 픽셀에서
 *   oR = R*red.r   + G*red.g   + B*red.b   + red.constant*255
 *   oG = R*green.r + G*green.g + B*green.b + green.constant*255
 *   oB = R*blue.r  + G*blue.g  + B*blue.b  + blue.constant*255
 * monochrome=true면 red 행 하나로 회색값을 구해 R=G=B에 똑같이 넣는다(green/blue 무시).
 *   gray = R*red.r + G*red.g + B*red.b + red.constant*255
 * 알파(+3)는 보존한다.
 */
export function applyChannelMixer(img: StudioImageDataLike, cm: ChannelMixer): void {
  const safe = normalizeChannelMixer(cm);
  if (isIdentityChannelMixer(safe)) return;
  const { red, green, blue, monochrome } = safe;
  const rOff = red.constant * 255;
  const gOff = green.constant * 255;
  const bOff = blue.constant * 255;

  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    if (monochrome) {
      const gray = r * red.r + g * red.g + b * red.b + rOff;
      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
    } else {
      data[i] = r * red.r + g * red.g + b * red.b + rOff;
      data[i + 1] = r * green.r + g * green.g + b * green.b + gOff;
      data[i + 2] = r * blue.r + g * blue.g + b * blue.b + bOff;
    }
  }
}

// ---------------------------------------------------------------------------
// 평탄 직렬화 — Konva attrs/저장본은 길이 13짜리 number[]로 보관한다.
//   [rr,rg,rb,rc, gr,gg,gb,gc, br,bg,bb,bc, mono?1:0]
// ---------------------------------------------------------------------------

/** 채널 혼합 → 길이 13 평탄 배열(행 단위 r·g·b·constant ×3 + 마지막 mono 0/1). */
export function channelMixerToFlat(cm: ChannelMixer): number[] {
  const safe = normalizeChannelMixer(cm);
  const { red, green, blue } = safe;
  return [
    red.r, red.g, red.b, red.constant,
    green.r, green.g, green.b, green.constant,
    blue.r, blue.g, blue.b, blue.constant,
    safe.monochrome ? 1 : 0,
  ];
}

/** 길이 13 평탄 배열 → 채널 혼합(역변환 후 normalize로 범위 보정). 짧으면 누락분은 기본값. */
export function flatToChannelMixer(flat: number[]): ChannelMixer {
  const f = Array.isArray(flat) ? flat : [];
  return normalizeChannelMixer({
    red: { r: f[0], g: f[1], b: f[2], constant: f[3] } as MixerChannel,
    green: { r: f[4], g: f[5], b: f[6], constant: f[7] } as MixerChannel,
    blue: { r: f[8], g: f[9], b: f[10], constant: f[11] } as MixerChannel,
    monochrome: f[12] === 1,
  });
}

// ---------------------------------------------------------------------------
// 웹툰 채널 혼합 프리셋 — 첫 항목은 항등, 나머지는 흑백 변환·채널 스왑·크로스 프로세스.
// 모든 mixer는 normalizeChannelMixer를 통과(gain -2..2, constant -1..1).
// ---------------------------------------------------------------------------

export type ChannelMixerPreset = { id: string; label: string; tip: string; mixer: ChannelMixer };

export const CHANNEL_MIXER_PRESETS: ChannelMixerPreset[] = [
  {
    id: "identity",
    label: "기본",
    tip: "혼합 없는 원본 채널.",
    mixer: normalizeChannelMixer(DEFAULT_CHANNEL_MIXER),
  },
  {
    id: "mono-balanced",
    label: "흑백 균형",
    tip: "세 채널을 고르게 섞어 평탄한 흑백으로 변환합니다.",
    mixer: normalizeChannelMixer({
      red: { r: 0.33, g: 0.33, b: 0.33, constant: 0 },
      monochrome: true,
    }),
  },
  {
    id: "mono-portrait",
    label: "흑백 인물",
    tip: "빨강 비중을 높여 피부 톤이 밝게 살아나는 인물용 흑백.",
    mixer: normalizeChannelMixer({
      red: { r: 0.5, g: 0.3, b: 0.2, constant: 0 },
      monochrome: true,
    }),
  },
  {
    id: "mono-landscape",
    label: "흑백 풍경",
    tip: "파랑 비중을 높여 하늘과 물이 깊어지는 풍경용 흑백.",
    mixer: normalizeChannelMixer({
      red: { r: 0.25, g: 0.35, b: 0.4, constant: 0 },
      monochrome: true,
    }),
  },
  {
    id: "mono-infrared",
    label: "적외선",
    tip: "초록을 크게 끌어올려 잎이 하얗게 빛나는 적외선 흑백을 흉내냅니다.",
    mixer: normalizeChannelMixer({
      red: { r: -0.2, g: 1.3, b: -0.1, constant: 0 },
      monochrome: true,
    }),
  },
  {
    id: "swap-gbr",
    label: "채널 스왑 RGB→GBR",
    tip: "빨강·초록·파랑을 한 칸씩 돌려 색을 비틀어 바꿉니다.",
    mixer: normalizeChannelMixer({
      red: { r: 0, g: 1, b: 0, constant: 0 },
      green: { r: 0, g: 0, b: 1, constant: 0 },
      blue: { r: 1, g: 0, b: 0, constant: 0 },
    }),
  },
  {
    id: "red-boost",
    label: "레드 부스트",
    tip: "빨강 채널만 1.2배로 키워 붉은 기운을 강하게 끌어올립니다.",
    mixer: normalizeChannelMixer({
      red: { r: 1.2, g: 0, b: 0, constant: 0 },
    }),
  },
  {
    id: "cross-process",
    label: "크로스 프로세스",
    tip: "채널을 살짝 섞고 끌어올려 필름 교차현상 같은 색감을 냅니다.",
    mixer: normalizeChannelMixer({
      red: { r: 1.1, g: 0.05, b: -0.05, constant: 0.02 },
      green: { r: 0, g: 1.05, b: 0.05, constant: 0 },
      blue: { r: 0.05, g: -0.05, b: 0.95, constant: -0.02 },
    }),
  },
];

// ---------------------------------------------------------------------------
// Konva 등록용 — StudioPage가 커스텀 필터로 부착.
// attrs는 외부 입력이므로 flatToChannelMixer로 안전 변환, 항등/무효면 no-op.
// ---------------------------------------------------------------------------

/**
 * Konva 필터 함수 — node(`this`).attrs.channelMixer(길이 13 number[])를
 * flatToChannelMixer로 안전 변환 후 applyChannelMixer. 항등이거나 attrs/배열이
 * 비면 no-op.
 */
export function channelMixerKonvaFilter(
  this: { attrs?: Record<string, unknown> },
  imageData: StudioImageDataLike
): void {
  const attrs = this.attrs;
  if (!attrs) return;
  const flat = attrs.channelMixer;
  if (!Array.isArray(flat)) return;
  const cm = flatToChannelMixer(flat as number[]);
  if (isIdentityChannelMixer(cm)) return;
  applyChannelMixer(imageData, cm);
}
