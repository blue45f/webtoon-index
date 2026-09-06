/**
 * Studio Glow / Bloom Engine
 * 포토샵 "글로우(Glow)/블룸(Bloom)" 효과 — 밝은 영역만 뽑아 블러로 번지게 한 뒤
 * 원본에 스크린 합성해 빛이 새어 나오는 듯한 광채를 입힌다.
 *   1) 휘도 >= threshold%인 픽셀을 소프트 니(knee)로 추출 — 임계 바로 아래 휘도도 부분
 *      가중(smoothstep)으로 살려 하드 컷 밴딩(경계 링) 없이 자연스럽게 빛이 이어진다.
 *      (color로 칠하기 선택.)
 *   2) 밝은 레이어를 합계 반경 = size인 연속 3패스 박스블러로 번지게 한다 — 단일 박스의
 *      사각 별 모양 아티팩트 없이 가우시안형 부드러운 감쇠, 도달 거리는 size 그대로.
 *   3) 원본에 스크린 합성: out = 255 - (255-orig)*(255-blur*strength/100)/255.
 * 밝은 픽셀은 더 밝아지고 주변으로 빛이 번지지만 어두운 영역은 거의 그대로 남는다(알파 보존).
 * Konva/DOM 의존 없음 — StudioPage 캔버스 로직과 단위 테스트가 공유한다.
 * 전부 순수·결정적(랜덤 없음).
 */

import { boxBlurRgb } from "./studio-image-blur";

import type { StudioImageDataLike } from "./studio-filters";

// ---------------------------------------------------------------------------
// 색 유틸 — #rrggbb 한정(모듈 자급자족, studio-filters에서는 타입만 가져온다)
// ---------------------------------------------------------------------------

// #rrggbb 만 허용(대소문자). #rgb 축약은 받지 않는다.
const HEX_RE = /^#[0-9a-f]{6}$/i;

/** "#rrggbb"(검증된 값) → {r,g,b} 0..255. */
function hexChannels(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

// ---------------------------------------------------------------------------
// 파라미터 타입·기본값·범위
// ---------------------------------------------------------------------------

export type Glow = {
  strength: number; // 0..100 글로우 세기(0이면 항등)
  size: number; // 1..40 블러 반경(클수록 멀리 번진다)
  threshold: number; // 0..100 이 휘도% 이상만 글로우 대상으로 추출
  color: string; // "auto"(원색) 또는 "#rrggbb"(글로우를 그 색으로 칠함)
};

/** 항등(효과 없음) — strength 0이라 픽셀을 건드리지 않는다. */
export const DEFAULT_GLOW: Glow = {
  strength: 0,
  size: 12,
  threshold: 60,
  color: "auto",
};

/** 글로우 세기 슬라이더 한 칸 범위 — 0..100, 1 단위. */
export const GLOW_STRENGTH_RANGE = { min: 0, max: 100, step: 1 } as const;
/** 블러 반경 슬라이더 한 칸 범위 — 1..40, 1 단위. */
export const GLOW_SIZE_RANGE = { min: 1, max: 40, step: 1 } as const;
/** 추출 임계 슬라이더 한 칸 범위 — 0..100, 1 단위. */
export const GLOW_THRESHOLD_RANGE = { min: 0, max: 100, step: 1 } as const;

// 휘도 가중치 — studio-filters/clarity와 같은 Rec.601 계수.
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

// ---------------------------------------------------------------------------
// 정규화·항등 판정
// ---------------------------------------------------------------------------

// 한 값을 [min,max]로 클램프, 숫자 아님은 fallback.
function clampTo(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

// color는 "auto" 또는 유효 #rrggbb(소문자화)만 인정, 그 외는 "auto".
function normalizeColor(raw: unknown): string {
  if (typeof raw !== "string") return "auto";
  if (raw === "auto") return "auto";
  return HEX_RE.test(raw) ? raw.toLowerCase() : "auto";
}

/**
 * 과거 저장본/외부 입력 안전장치 — 누락 키는 기본값, 숫자 아님은 기본값,
 * 범위 밖은 각 범위로 클램프. color는 "auto" 또는 유효 #rrggbb(아니면 "auto").
 */
export function normalizeGlow(g?: Partial<Glow> | null): Glow {
  const src = g && typeof g === "object" ? g : {};
  return {
    strength: clampTo(src.strength, GLOW_STRENGTH_RANGE.min, GLOW_STRENGTH_RANGE.max, DEFAULT_GLOW.strength),
    size: clampTo(src.size, GLOW_SIZE_RANGE.min, GLOW_SIZE_RANGE.max, DEFAULT_GLOW.size),
    threshold: clampTo(src.threshold, GLOW_THRESHOLD_RANGE.min, GLOW_THRESHOLD_RANGE.max, DEFAULT_GLOW.threshold),
    color: normalizeColor(src.color),
  };
}

/** strength가 0 이하 — 즉 픽셀을 건드리지 않는 항등 설정인지. */
export function isIdentityGlow(g: Glow): boolean {
  return g.strength <= 0;
}

// ---------------------------------------------------------------------------
// 적용 — 밝은 레이어 추출 → 블러 → 스크린 합성(제자리 변형)
// ---------------------------------------------------------------------------

// 소프트 니 폭(휘도 단위) — 임계 아래 이 폭 구간에서 smoothstep으로 가중이 0→1로 올라간다.
// 임계 이상 픽셀은 기존과 동일하게 가중 1(사용자 threshold 의미 보존), 바로 아래만 부드럽게 이어진다.
const GLOW_KNEE = 32;

// smoothstep(0..1) — 니 램프의 부드러운 보간.
function smoothstep01(t: number): number {
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

// 합계 반경 = size가 되도록 연속 3패스 박스 반경으로 쪼갠다(0 반경 패스는 스킵).
// 도달 거리(빛이 미치는 최대 px)는 단일 박스와 동일하게 유지하면서 프로파일만 가우시안형이 된다.
function bloomPassRadii(size: number): [number, number, number] {
  const r1 = Math.round(size / 3);
  const r2 = Math.round((size - r1) / 2);
  const r3 = size - r1 - r2;
  return [r1, r2, r3];
}

/**
 * 글로우 제자리 적용 — 항등(strength 0)이면 no-op.
 *
 * 1) 밝은 레이어 추출: 휘도 L = 0.299r+0.587g+0.114b 기준, cut = threshold%(*255).
 *    w = smoothstep((L - (cut-GLOW_KNEE)) / GLOW_KNEE) — L ≥ cut이면 1(기존과 동일),
 *    cut 바로 아래 니 구간은 부분 가중, 그 아래는 0. 하드 컷 밴딩(경계 링)을 없앤다.
 *    color!=="auto"면 그 색으로 칠하고(원래 밝기 L·w에 비례) 아니면 원색·w 가중.
 * 2) 합계 반경 = size인 연속 3패스 박스블러(boxBlurRgb ×3)로 밝은 레이어를 번지게 한다
 *    — 단일 박스의 사각/계단 프로파일 대신 가우시안형 감쇠, 도달 거리는 size 그대로.
 * 3) 원본에 스크린 합성(채널별, k=strength/100):
 *    out = 255 - (255-orig)*(255 - blur*k)/255.
 *    밝은 곳은 더 밝아지고 주변으로 빛이 번지며, blur 0(어두운 영역)은 orig 그대로.
 *
 * Uint8ClampedArray가 반올림·0..255 클램프를 처리한다. 알파(+3)는 보존. 작은 이미지도 안전.
 */
export function applyGlow(img: StudioImageDataLike, g: Glow): void {
  if (isIdentityGlow(g)) return;
  const { data, width, height } = img;
  if (!(width > 0) || !(height > 0)) return;

  const cut = (g.threshold / 100) * 255; // 추출 휘도 컷오프(0..255)
  const kneeLo = cut - GLOW_KNEE; // 니 램프 시작 휘도
  const tinted = g.color !== "auto"; // 글로우를 단색으로 칠할지
  const tint = tinted ? hexChannels(g.color) : { r: 0, g: 0, b: 0 };

  // --- 1) 밝은 레이어: threshold 이상 = 1, 니 구간은 부분 가중, 그 아래 0 ---
  const bright = new Float32Array(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const gg = data[i + 1]!;
    const b = data[i + 2]!;
    const lum = LUMA_R * r + LUMA_G * gg + LUMA_B * b;
    if (lum <= kneeLo) continue; // 니 아래 어두운 픽셀은 0(이미 초기값)
    const w = smoothstep01((lum - kneeLo) / GLOW_KNEE); // cut 이상이면 1
    if (tinted) {
      // 단색 글로우 — 추출 휘도 비율(L/255)·니 가중으로 칠해 밝을수록 진하게.
      const s = (lum / 255) * w;
      bright[i] = tint.r * s;
      bright[i + 1] = tint.g * s;
      bright[i + 2] = tint.b * s;
    } else {
      // 원색 글로우 — 밝은 픽셀의 색을 니 가중으로 번지게.
      bright[i] = r * w;
      bright[i + 1] = gg * w;
      bright[i + 2] = b * w;
    }
  }

  // --- 2) 밝은 레이어를 합계 반경 size의 3패스로 번지게(가우시안형 프로파일) ---
  // bright ↔ blurred 두 버퍼를 핑퐁하며 0이 아닌 반경 패스만 실행. 마지막 결과가 bloom.
  const blurred = new Float32Array(data.length);
  let bloom: Float32Array = bright;
  for (const r of bloomPassRadii(g.size)) {
    if (r <= 0) continue;
    const target = bloom === bright ? blurred : bright;
    boxBlurRgb(bloom, target, width, height, r);
    bloom = target;
  }

  // --- 3) 원본에 스크린 합성 ---
  const k = g.strength / 100;
  for (let i = 0; i < data.length; i += 4) {
    // out = 255 - (255-orig)*(255 - blur*k)/255
    data[i] = 255 - ((255 - data[i]!) * (255 - bloom[i]! * k)) / 255;
    data[i + 1] = 255 - ((255 - data[i + 1]!) * (255 - bloom[i + 1]! * k)) / 255;
    data[i + 2] = 255 - ((255 - data[i + 2]!) * (255 - bloom[i + 2]! * k)) / 255;
  }
}

// ---------------------------------------------------------------------------
// 웹툰 글로우 프리셋 — 첫 항목은 기본, 나머지는 자주 쓰는 빛 번짐 조합.
// 모든 value는 normalizeGlow를 통과(strength 0..100, size 1..40, threshold 0..100, color auto/#rrggbb).
// ---------------------------------------------------------------------------

export type GlowPreset = { id: string; label: string; tip: string; value: Glow };

export const GLOW_PRESETS: GlowPreset[] = [
  {
    id: "none",
    label: "기본",
    tip: "빛 번짐 없는 원본.",
    value: normalizeGlow(DEFAULT_GLOW),
  },
  {
    id: "subtle",
    label: "은은한 빛",
    tip: "밝은 영역에 옅은 빛을 더해 부드럽게 띄웁니다.",
    value: normalizeGlow({ strength: 30 }),
  },
  {
    id: "radiant",
    label: "강한 광채",
    tip: "넓고 강한 블룸으로 하이라이트를 화사하게 폭발시킵니다.",
    value: normalizeGlow({ strength: 70, size: 20 }),
  },
  {
    id: "neon",
    label: "네온",
    tip: "하늘색 빛으로 사이버펑크 네온 광채를 입힙니다.",
    value: normalizeGlow({ color: "#00e5ff", strength: 60 }),
  },
  {
    id: "dream",
    label: "드림",
    tip: "넓게 번지는 부드러운 빛으로 꿈결 같은 분위기를 만듭니다.",
    value: normalizeGlow({ strength: 45, size: 28, threshold: 45 }),
  },
  {
    id: "sunshine",
    label: "햇살",
    tip: "따뜻한 황금빛으로 햇살이 스며드는 듯한 광채를 더합니다.",
    value: normalizeGlow({ color: "#ffcf6b", strength: 50 }),
  },
];

// ---------------------------------------------------------------------------
// Konva 등록용 — StudioPage가 커스텀 필터로 부착.
// attrs는 외부 입력이므로 normalizeGlow로 안전 변환, 항등/무효면 no-op.
// ---------------------------------------------------------------------------

function attrNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Konva 필터 함수 — node(`this`).attrs에서 glowStrength·glowSize·glowThreshold(각 number)와
 * glowColor(string)를 읽어 normalizeGlow로 안전 변환 후 applyGlow.
 * 항등(strength 0)이거나 attrs가 비면 no-op.
 */
export function glowKonvaFilter(this: { attrs?: Record<string, unknown> }, imageData: StudioImageDataLike): void {
  const attrs = this.attrs;
  if (!attrs) return;
  const g = normalizeGlow({
    strength: attrNumber(attrs.glowStrength),
    size: attrNumber(attrs.glowSize),
    threshold: attrNumber(attrs.glowThreshold),
    color: typeof attrs.glowColor === "string" ? attrs.glowColor : undefined,
  });
  if (isIdentityGlow(g)) return;
  applyGlow(imageData, g);
}
