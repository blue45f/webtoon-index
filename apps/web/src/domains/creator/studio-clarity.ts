/**
 * Studio Clarity / Dehaze Engine
 * 포토샵 "선명도(Clarity)" + "디헤이즈(Dehaze)" 보정 —
 *   clarity: 큰 반경 박스블러로 로컬 평균을 구해 언샤프 마스크(detail = px - blurred)를
 *            중간톤 가중(midWeight)으로 더한다. 섀도/하이라이트는 보호해 로컬 대비만 키운다.
 *   dehaze:  전역 대비를 128 중심으로 늘리고 채도를 살짝 올려 뿌연 기운을 걷어낸다(간단 근사).
 * 픽셀에서 멀어진 로컬 평균을 빼는 방식이라 가장자리(엣지) 대비가 또렷해진다(알파 보존).
 * Konva/DOM 의존 없음 — StudioPage 캔버스 로직과 단위 테스트가 공유한다.
 * 전부 순수·결정적(랜덤 없음).
 */

import { boxBlurRgb } from "./studio-image-blur";

import type { StudioImageDataLike } from "./studio-filters";

// ---------------------------------------------------------------------------
// 파라미터 타입·기본값·범위
// ---------------------------------------------------------------------------

/** 선명도·디헤이즈 보정. clarity -100..100(±로컬 대비), dehaze 0..100(뿌연 기운 제거). */
export type Clarity = { clarity: number; dehaze: number };

/** 항등(보정 없음) — 둘 다 0. */
export const DEFAULT_CLARITY: Clarity = { clarity: 0, dehaze: 0 };

/** 선명도 슬라이더 한 칸 범위 — -100..100, 1 단위. */
export const CLARITY_RANGE = { min: -100, max: 100, step: 1 } as const;

/** 디헤이즈 슬라이더 한 칸 범위 — 0..100, 1 단위. */
export const DEHAZE_RANGE = { min: 0, max: 100, step: 1 } as const;

// 로컬 평균을 구하는 박스블러 반경(px). 클수록 더 큰 범위의 대비를 잡는다.
const CLARITY_RADIUS = 5;

// 휘도(luma) 가중치 — 중간톤 보호 마스크와 디헤이즈 채도 중심을 구한다.
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

// 디헤이즈 전역 대비 계수 상한 — dehaze=100에서 대비 ×1.6.
const DEHAZE_CONTRAST = 0.6;
// 디헤이즈 채도 가산 상한 — dehaze=100에서 채도 스케일 ×1.3.
const DEHAZE_SATURATION = 0.3;

// ---------------------------------------------------------------------------
// 정규화·항등 판정
// ---------------------------------------------------------------------------

// 한 값을 [min,max]로 클램프, 숫자 아님은 fallback.
function clampTo(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

/**
 * 과거 저장본/외부 입력 안전장치 — 누락 키는 0, 숫자 아님은 0,
 * 범위 밖은 각 범위(clarity -100..100, dehaze 0..100)로 클램프한 새 객체를 반환.
 */
export function normalizeClarity(c?: Partial<Clarity> | null): Clarity {
  const src = c && typeof c === "object" ? c : {};
  return {
    clarity: clampTo(src.clarity, CLARITY_RANGE.min, CLARITY_RANGE.max, DEFAULT_CLARITY.clarity),
    dehaze: clampTo(src.dehaze, DEHAZE_RANGE.min, DEHAZE_RANGE.max, DEFAULT_CLARITY.dehaze),
  };
}

/** 두 값 모두 0 — 즉 픽셀을 건드리지 않는 항등 설정인지. */
export function isIdentityClarity(c: Clarity): boolean {
  return c.clarity === 0 && c.dehaze === 0;
}

// ---------------------------------------------------------------------------
// 적용 — clarity(중간톤 언샤프) + dehaze(전역 대비·채도) 제자리 변형
// ---------------------------------------------------------------------------

/**
 * 선명도·디헤이즈 제자리 적용 — 항등이면 no-op.
 *
 * clarity(≠0): 반경 CLARITY_RADIUS 박스블러로 로컬 평균(blurred)을 구하고
 *   detail   = px - blurred                        (로컬 고주파 = 엣지 디테일)
 *   midWeight= 1 - |2L/255 - 1|                     (휘도 중간(0.5)=1, 양끝=0)
 *   out      = px + detail * (clarity/100) * midWeight
 *   → 섀도/하이라이트는 midWeight≈0이라 거의 안 건드리고 중간톤 로컬 대비만 키운다.
 *     음수 clarity는 detail을 빼서 로컬 대비를 누른다(부드럽게).
 *
 * dehaze(>0): 전역 대비를 128 중심으로 (1 + dehaze/100*0.6)배 늘리고,
 *   채도를 (1 + dehaze/100*0.3)배 올려 뿌연 기운을 걷어낸다(간단 근사).
 *
 * clarity → dehaze 순으로 적용. Uint8ClampedArray가 반올림·0..255 클램프, 알파(+3) 보존.
 */
export function applyClarity(img: StudioImageDataLike, c: Clarity): void {
  if (isIdentityClarity(c)) return;
  const { data, width, height } = img;

  // --- 1) 선명도: 중간톤 가중 언샤프 ---
  if (c.clarity !== 0 && width > 0 && height > 0) {
    const amount = c.clarity / 100;
    const blurred = new Float32Array(data.length);
    boxBlurRgb(data, blurred, width, height, CLARITY_RADIUS);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      // 중간톤일수록 1, 섀도/하이라이트일수록 0(보호).
      const lum = LUMA_R * r + LUMA_G * g + LUMA_B * b;
      const midWeight = 1 - Math.abs((2 * lum) / 255 - 1);
      const k = amount * midWeight;
      data[i] = r + (r - blurred[i]!) * k;
      data[i + 1] = g + (g - blurred[i + 1]!) * k;
      data[i + 2] = b + (b - blurred[i + 2]!) * k;
    }
  }

  // --- 2) 디헤이즈: 전역 대비(128 중심) + 채도 약간 ---
  if (c.dehaze > 0) {
    const unit = c.dehaze / 100;
    const contrast = 1 + unit * DEHAZE_CONTRAST;
    const satScale = 1 + unit * DEHAZE_SATURATION;
    for (let i = 0; i < data.length; i += 4) {
      // 전역 대비: 128 중심으로 양끝을 벌린다.
      const r = (data[i]! - 128) * contrast + 128;
      const g = (data[i + 1]! - 128) * contrast + 128;
      const b = (data[i + 2]! - 128) * contrast + 128;
      // 채도: 휘도 중심에서 멀어지게 스케일.
      const l = LUMA_R * r + LUMA_G * g + LUMA_B * b;
      data[i] = l + (r - l) * satScale;
      data[i + 1] = l + (g - l) * satScale;
      data[i + 2] = l + (b - l) * satScale;
    }
  }
}

// ---------------------------------------------------------------------------
// 웹툰 선명도 프리셋 — 첫 항목은 항등, 나머지는 자주 쓰는 선명도/디헤이즈 조합.
// 모든 value는 normalizeClarity를 통과(clarity -100..100, dehaze 0..100).
// ---------------------------------------------------------------------------

export type ClarityPreset = { id: string; label: string; tip: string; value: Clarity };

export const CLARITY_PRESETS: ClarityPreset[] = [
  {
    id: "neutral",
    label: "기본",
    tip: "보정 없는 원본 선명도.",
    value: normalizeClarity(DEFAULT_CLARITY),
  },
  {
    id: "crisp",
    label: "또렷하게",
    tip: "중간톤 로컬 대비를 올려 디테일을 또렷하게 살립니다.",
    value: normalizeClarity({ clarity: 40 }),
  },
  {
    id: "punch",
    label: "강한 디테일",
    tip: "선명도를 크게 올려 질감과 윤곽을 강하게 끌어냅니다.",
    value: normalizeClarity({ clarity: 70 }),
  },
  {
    id: "soft",
    label: "부드럽게",
    tip: "로컬 대비를 눌러 피부·배경을 매끈하고 부드럽게 만듭니다.",
    value: normalizeClarity({ clarity: -40 }),
  },
  {
    id: "dehaze",
    label: "안개 제거",
    tip: "전역 대비와 채도를 올려 뿌옇게 낀 안개 기운을 걷어냅니다.",
    value: normalizeClarity({ dehaze: 50 }),
  },
  {
    id: "dramatic",
    label: "드라마틱",
    tip: "선명도와 디헤이즈를 함께 올려 묵직하고 강렬한 분위기를 냅니다.",
    value: normalizeClarity({ clarity: 50, dehaze: 30 }),
  },
];

// ---------------------------------------------------------------------------
// Konva 등록용 — StudioPage가 커스텀 필터로 부착.
// attrs는 외부 입력이므로 normalizeClarity로 안전 변환, 항등/무효면 no-op.
// ---------------------------------------------------------------------------

/**
 * Konva 필터 함수 — node(`this`).attrs에서 clarity·dehaze(각 number)를 읽어
 * normalizeClarity로 안전 변환 후 applyClarity. 항등이거나 attrs가 비면 no-op.
 */
export function clarityKonvaFilter(this: { attrs?: Record<string, unknown> }, imageData: StudioImageDataLike): void {
  const attrs = this.attrs;
  if (!attrs) return;
  const c = normalizeClarity({
    clarity: typeof attrs.clarity === "number" ? attrs.clarity : undefined,
    dehaze: typeof attrs.dehaze === "number" ? attrs.dehaze : undefined,
  });
  if (isIdentityClarity(c)) return;
  applyClarity(imageData, c);
}
