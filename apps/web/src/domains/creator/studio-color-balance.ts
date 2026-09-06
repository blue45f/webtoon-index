/**
 * Studio Color Balance Engine
 * 포토샵 "색상 균형(Color Balance)" 보정 — 그림자/중간톤/하이라이트별 R·G·B 채널을
 * 독립적으로 밀고, 각 픽셀의 휘도(luma)로 톤 영역 가중치를 섞어 적용한다(알파 보존).
 * Konva/DOM 의존 없음 — StudioPage 캔버스 로직과 단위 테스트가 공유한다.
 * 전부 순수·결정적(랜덤 없음).
 */

import type { StudioImageDataLike } from "./studio-filters";

// ---------------------------------------------------------------------------
// 파라미터 타입·기본값·범위
// ---------------------------------------------------------------------------

/** 한 톤 영역의 R·G·B 쉬프트. 각 -100..100(양수=그 채널을 올림). */
export type RgbShift = [number, number, number];

/** 그림자·중간톤·하이라이트 세 톤 영역의 채널 쉬프트 묶음. */
export type ColorBalance = { shadows: RgbShift; midtones: RgbShift; highlights: RgbShift };

/** 항등(보정 없음) — 세 영역 전부 [0,0,0]. */
export const DEFAULT_COLOR_BALANCE: ColorBalance = {
  shadows: [0, 0, 0],
  midtones: [0, 0, 0],
  highlights: [0, 0, 0],
};

/** 슬라이더 한 칸 범위 — 채널 쉬프트는 -100..100, 1 단위. */
export const COLOR_BALANCE_RANGE = { min: -100, max: 100, step: 1 } as const;

// 톤 영역 키 — 정규화·항등 판정·적용에서 공통으로 순회한다.
const COLOR_BALANCE_ZONES = ["shadows", "midtones", "highlights"] as const;

// -100..100 쉬프트를 약 ±128 픽셀 변화로 확장하는 계수(100 * 1.275 ≈ 128).
const COLOR_BALANCE_GAIN = 1.275;

// ---------------------------------------------------------------------------
// 정규화·항등 판정
// ---------------------------------------------------------------------------

// 한 채널 값을 -100..100으로 클램프, 숫자 아님은 0.
function clampShift(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.min(COLOR_BALANCE_RANGE.max, Math.max(COLOR_BALANCE_RANGE.min, raw));
}

// 길이 3짜리 쉬프트 튜플 정규화 — 누락/무효 채널은 0.
function normalizeShift(raw: unknown): RgbShift {
  const src = Array.isArray(raw) ? raw : [];
  return [clampShift(src[0]), clampShift(src[1]), clampShift(src[2])];
}

/**
 * 과거 저장본/외부 입력 안전장치 — 누락 영역·누락 채널은 0,
 * 숫자 아님은 0, 범위 밖은 -100..100으로 클램프한 새 객체를 반환.
 */
export function normalizeColorBalance(cb?: Partial<ColorBalance> | null): ColorBalance {
  const src = cb && typeof cb === "object" ? cb : {};
  return {
    shadows: normalizeShift(src.shadows),
    midtones: normalizeShift(src.midtones),
    highlights: normalizeShift(src.highlights),
  };
}

/** 세 영역의 모든 채널이 0 — 즉 픽셀을 건드리지 않는 항등 설정인지. */
export function isIdentityColorBalance(cb: ColorBalance): boolean {
  for (const zone of COLOR_BALANCE_ZONES) {
    const shift = cb[zone];
    if (shift[0] !== 0 || shift[1] !== 0 || shift[2] !== 0) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 적용 — 픽셀 휘도로 톤 영역 가중치를 섞어 채널별 쉬프트(제자리 변형)
// ---------------------------------------------------------------------------

/**
 * 색상 균형 제자리 적용 — 항등이면 no-op. 각 픽셀의 휘도 t=luma/255로
 * 그림자/중간톤/하이라이트 가중치를 구하고, 채널별 쉬프트를 더한다.
 *   luma = 0.299r + 0.587g + 0.114b
 *   sW = (1-t)^2          (그림자: 어두울수록 1)
 *   hW = t^2              (하이라이트: 밝을수록 1)
 *   mW = max(0, 1-(2t-1)^2) (중간톤: 포물선, t=0.5에서 1, 양끝 0)
 *   shift[c] = (sW*shadows[c] + mW*midtones[c] + hW*highlights[c]) * 1.275
 *   data[c]  = clamp(orig + shift)   (Uint8ClampedArray가 반올림·0..255 클램프)
 * 알파(+3)는 보존한다.
 */
export function applyColorBalance(img: StudioImageDataLike, cb: ColorBalance): void {
  const safe = normalizeColorBalance(cb);
  if (isIdentityColorBalance(safe)) return;
  const { shadows, midtones, highlights } = safe;
  const sR = shadows[0];
  const sG = shadows[1];
  const sB = shadows[2];
  const mR = midtones[0];
  const mG = midtones[1];
  const mB = midtones[2];
  const hR = highlights[0];
  const hG = highlights[1];
  const hB = highlights[2];

  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const t = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const sW = (1 - t) * (1 - t);
    const hW = t * t;
    const mid = 2 * t - 1;
    const mW = Math.max(0, 1 - mid * mid);

    data[i] = r + (sW * sR + mW * mR + hW * hR) * COLOR_BALANCE_GAIN;
    data[i + 1] = g + (sW * sG + mW * mG + hW * hG) * COLOR_BALANCE_GAIN;
    data[i + 2] = b + (sW * sB + mW * mB + hW * hB) * COLOR_BALANCE_GAIN;
  }
}

// ---------------------------------------------------------------------------
// 웹툰 색감 프리셋 — 첫 항목은 항등, 나머지는 자주 쓰는 톤 조합.
// 모든 balance는 normalizeColorBalance를 통과(각 채널 -100..100).
// ---------------------------------------------------------------------------

export type ColorBalancePreset = { id: string; label: string; tip: string; balance: ColorBalance };

export const COLOR_BALANCE_PRESETS: ColorBalancePreset[] = [
  {
    id: "neutral",
    label: "기본",
    tip: "보정 없는 원본 색감.",
    balance: normalizeColorBalance(DEFAULT_COLOR_BALANCE),
  },
  {
    id: "warm",
    label: "따뜻하게",
    tip: "그림자와 하이라이트에 붉은 기운을 더해 포근한 색감으로 데웁니다.",
    balance: normalizeColorBalance({ shadows: [15, 0, -5], highlights: [20, 8, -10] }),
  },
  {
    id: "cool",
    label: "차갑게",
    tip: "그림자와 하이라이트에 푸른 기운을 더해 서늘한 색감으로 식힙니다.",
    balance: normalizeColorBalance({ shadows: [-10, 0, 18], highlights: [-12, -4, 22] }),
  },
  {
    id: "vintage",
    label: "빈티지",
    tip: "그림자는 청록, 하이라이트는 주황으로 빛바랜 필름 색감을 냅니다.",
    balance: normalizeColorBalance({ shadows: [-12, 6, 14], highlights: [18, 10, -16] }),
  },
  {
    id: "teal-orange",
    label: "티얼&오렌지",
    tip: "그림자는 청록, 인물 하이라이트는 주황으로 미는 블록버스터 룩.",
    balance: normalizeColorBalance({ shadows: [-10, 5, 20], highlights: [25, 10, -20] }),
  },
  {
    id: "cinematic",
    label: "시네마틱",
    tip: "그림자는 차갑게 가라앉히고 하이라이트는 따뜻하게 들어올린 영화 톤.",
    balance: normalizeColorBalance({ shadows: [-8, 2, 16], midtones: [4, 0, -4], highlights: [16, 6, -12] }),
  },
  {
    id: "daybreak",
    label: "새벽",
    tip: "전체에 옅은 푸른빛을 더해 동트기 전 새벽 공기를 표현합니다.",
    balance: normalizeColorBalance({ shadows: [-6, 0, 12], midtones: [-4, 0, 10], highlights: [-4, 2, 12] }),
  },
  {
    id: "sunset",
    label: "석양",
    tip: "하이라이트는 붉고 노란 노을빛, 그림자에도 붉은 기운을 더한 해질녘.",
    balance: normalizeColorBalance({ shadows: [14, 2, -6], midtones: [10, 4, -8], highlights: [22, 14, -16] }),
  },
];

// ---------------------------------------------------------------------------
// Konva 등록용 — StudioPage가 커스텀 필터로 부착.
// attrs는 외부 입력이므로 normalizeColorBalance로 안전 변환, 항등/무효면 no-op.
// ---------------------------------------------------------------------------

/**
 * Konva 필터 함수 — node(`this`).attrs에서 cbShadows/cbMidtones/cbHighlights
 * (각 길이 3 number[])를 읽어 normalizeColorBalance로 안전 변환 후 applyColorBalance.
 * 항등이거나 attrs가 비면 no-op.
 */
export function colorBalanceKonvaFilter(
  this: { attrs?: Record<string, unknown> },
  imageData: StudioImageDataLike
): void {
  const attrs = this.attrs;
  if (!attrs) return;
  const cb = normalizeColorBalance({
    shadows: normalizeShift(attrs.cbShadows),
    midtones: normalizeShift(attrs.cbMidtones),
    highlights: normalizeShift(attrs.cbHighlights),
  });
  if (isIdentityColorBalance(cb)) return;
  applyColorBalance(imageData, cb);
}
