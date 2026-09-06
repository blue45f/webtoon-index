/**
 * Studio Vibrance / Saturation Engine
 * 포토샵 "활기(Vibrance)" + "채도(Saturation)" 보정 — 픽셀을 휘도(luma) 중심에서
 * 멀어지게/가까워지게 스케일해 채도를 조절한다. 채도(saturation)는 모든 픽셀을 균일하게,
 * 활기(vibrance)는 채도가 낮은 픽셀일수록 더 강하게 올려(이미 쨍한 색·살색은 덜 건드림)
 * HSL 왕복 없이 RGB만으로 처리한다(알파 보존).
 * Konva/DOM 의존 없음 — StudioPage 캔버스 로직과 단위 테스트가 공유한다.
 * 전부 순수·결정적(랜덤 없음).
 */

import type { StudioImageDataLike } from "./studio-filters";

// ---------------------------------------------------------------------------
// 파라미터 타입·기본값·범위
// ---------------------------------------------------------------------------

/** 활기·채도 보정. 각 -100..100(양수=올림, 음수=내림). */
export type Vibrance = { vibrance: number; saturation: number };

/** 항등(보정 없음) — 둘 다 0. */
export const DEFAULT_VIBRANCE: Vibrance = { vibrance: 0, saturation: 0 };

/** 슬라이더 한 칸 범위 — 두 값 모두 -100..100, 1 단위. */
export const VIBRANCE_RANGE = { min: -100, max: 100, step: 1 } as const;

// 휘도(luma) 가중치 — 채도 스케일의 중심점(픽셀 그레이 포인트)을 구한다.
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

// ---------------------------------------------------------------------------
// 정규화·항등 판정
// ---------------------------------------------------------------------------

// 한 값을 -100..100으로 클램프, 숫자 아님은 0.
function clampAmount(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.min(VIBRANCE_RANGE.max, Math.max(VIBRANCE_RANGE.min, raw));
}

/**
 * 과거 저장본/외부 입력 안전장치 — 누락 키는 0, 숫자 아님은 0,
 * 범위 밖은 -100..100으로 클램프한 새 객체를 반환.
 */
export function normalizeVibrance(v?: Partial<Vibrance> | null): Vibrance {
  const src = v && typeof v === "object" ? v : {};
  return {
    vibrance: clampAmount(src.vibrance),
    saturation: clampAmount(src.saturation),
  };
}

/** 두 값 모두 0 — 즉 픽셀을 건드리지 않는 항등 설정인지. */
export function isIdentityVibrance(v: Vibrance): boolean {
  return v.vibrance === 0 && v.saturation === 0;
}

// ---------------------------------------------------------------------------
// 적용 — 휘도 중심에서 RGB를 스케일해 채도 조절(제자리 변형)
// ---------------------------------------------------------------------------

/**
 * 활기·채도 제자리 적용 — 항등이면 no-op. 각 픽셀에서:
 *   L = 0.299r + 0.587g + 0.114b                 (휘도 = 채도 스케일의 중심)
 *   currentSat = (max - min) / 255               (현재 채도 0..1)
 *   satScale = 1 + saturation/100                (모든 픽셀 균일)
 *   amt = (vibrance/100) * (1 - currentSat)      (채도 낮을수록 강함)
 *   scale = satScale * (1 + amt)
 *   c' = L + (c - L) * scale                      (휘도에서 멀어지게/가까워지게)
 * 회색(currentSat=0)은 c-L=0이라 거의 변화 없음. saturation=-100이면 satScale=0이라
 * 모든 채널이 L로 수렴(=그레이스케일). Uint8ClampedArray가 반올림·0..255 클램프, 알파(+3) 보존.
 */
export function applyVibrance(img: StudioImageDataLike, v: Vibrance): void {
  if (isIdentityVibrance(v)) return;
  const satScale = 1 + v.saturation / 100;
  const vibUnit = v.vibrance / 100;
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const max = r > g ? (r > b ? r : b) : g > b ? g : b;
    const min = r < g ? (r < b ? r : b) : g < b ? g : b;
    const currentSat = (max - min) / 255;
    // 활기는 저채도일수록 강하게, 고채도는 보호.
    const amt = vibUnit * (1 - currentSat);
    const scale = satScale * (1 + amt);
    const l = LUMA_R * r + LUMA_G * g + LUMA_B * b;
    data[i] = l + (r - l) * scale;
    data[i + 1] = l + (g - l) * scale;
    data[i + 2] = l + (b - l) * scale;
  }
}

// ---------------------------------------------------------------------------
// 웹툰 채도 프리셋 — 첫 항목은 항등, 나머지는 자주 쓰는 활기/채도 조합.
// 모든 value는 normalizeVibrance를 통과(각 -100..100).
// ---------------------------------------------------------------------------

export type VibrancePreset = { id: string; label: string; tip: string; value: Vibrance };

export const VIBRANCE_PRESETS: VibrancePreset[] = [
  {
    id: "neutral",
    label: "기본",
    tip: "보정 없는 원본 채도.",
    value: normalizeVibrance(DEFAULT_VIBRANCE),
  },
  {
    id: "vivid",
    label: "생기있게",
    tip: "흐린 색을 골라 끌어올려 칙칙한 부분만 생기있게 살립니다.",
    value: normalizeVibrance({ vibrance: 40 }),
  },
  {
    id: "calm",
    label: "차분하게",
    tip: "활기를 낮춰 과한 색을 눌러 차분하고 정돈된 톤으로 가라앉힙니다.",
    value: normalizeVibrance({ vibrance: -30 }),
  },
  {
    id: "pop",
    label: "팝",
    tip: "활기와 채도를 함께 올려 색이 톡 튀는 팝아트 느낌을 냅니다.",
    value: normalizeVibrance({ vibrance: 30, saturation: 20 }),
  },
  {
    id: "mono",
    label: "흑백 근접",
    tip: "채도를 완전히 빼 흑백에 가까운 무채색 톤을 만듭니다.",
    value: normalizeVibrance({ saturation: -100 }),
  },
  {
    id: "pastel",
    label: "파스텔",
    tip: "전체 채도는 낮추되 흐린 색만 살짝 살려 부드러운 파스텔 톤을 냅니다.",
    value: normalizeVibrance({ saturation: -40, vibrance: 20 }),
  },
];

// ---------------------------------------------------------------------------
// Konva 등록용 — StudioPage가 커스텀 필터로 부착.
// attrs는 외부 입력이므로 normalizeVibrance로 안전 변환, 항등/무효면 no-op.
// ---------------------------------------------------------------------------

/**
 * Konva 필터 함수 — node(`this`).attrs에서 vibrance·vibranceSat(각 number)를 읽어
 * normalizeVibrance로 안전 변환 후 applyVibrance. 항등이거나 attrs가 비면 no-op.
 */
export function vibranceKonvaFilter(
  this: { attrs?: Record<string, unknown> },
  imageData: StudioImageDataLike
): void {
  const attrs = this.attrs;
  if (!attrs) return;
  const v = normalizeVibrance({
    vibrance: clampAmount(attrs.vibrance),
    saturation: clampAmount(attrs.vibranceSat),
  });
  if (isIdentityVibrance(v)) return;
  applyVibrance(imageData, v);
}
