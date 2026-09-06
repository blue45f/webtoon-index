/**
 * Studio Photo Filter Engine
 * 포토샵 "포토 필터(Photo Filter)" 보정 — 한 가지 색을 밀도(density)만큼 멀티플라이로
 * 덮어 전체에 색조를 입히고, 휘도 보존(preserveLuminosity) 옵션이면 적용 후 각 픽셀의
 * 밝기를 원본 휘도에 맞춰 되돌린다(알파 보존).
 * Konva/DOM 의존 없음 — StudioPage 캔버스 로직과 단위 테스트가 공유한다.
 * 전부 순수·결정적(랜덤 없음).
 */

import { hexToRgb, type StudioImageDataLike } from "./studio-filters";

// ---------------------------------------------------------------------------
// 파라미터 타입·기본값·범위
// ---------------------------------------------------------------------------

export type PhotoFilter = {
  color: string; // #rrggbb 오버레이 색
  density: number; // 0..100 색조 강도(0이면 항등)
  preserveLuminosity: boolean; // true면 적용 후 픽셀 밝기를 원본 휘도로 복원
};

/** 항등(보정 없음) — 따뜻한 기본색이지만 density 0이라 픽셀을 건드리지 않는다. */
export const DEFAULT_PHOTO_FILTER: PhotoFilter = {
  color: "#ec8a00",
  density: 0,
  preserveLuminosity: true,
};

/** 슬라이더 한 칸 범위 — 밀도는 0..100, 1 단위. */
export const PHOTO_FILTER_DENSITY_RANGE = { min: 0, max: 100, step: 1 } as const;

// 휘도 가중치 — applyColorBalance/applyInkThreshold와 같은 Rec.601 계수.
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

// ---------------------------------------------------------------------------
// 정규화·항등 판정
// ---------------------------------------------------------------------------

/**
 * 과거 저장본/외부 입력 안전장치 — 누락/무효 색은 기본색, density는 숫자 아니면 기본값,
 * 범위 밖은 0..100으로 클램프, preserveLuminosity는 boolean으로 강제(누락 시 기본값).
 */
export function normalizePhotoFilter(p?: Partial<PhotoFilter> | null): PhotoFilter {
  const src = p && typeof p === "object" ? p : {};

  const color = typeof src.color === "string" && /^#[0-9a-f]{6}$/i.test(src.color) ? src.color : DEFAULT_PHOTO_FILTER.color;

  const rawDensity = src.density;
  const density =
    typeof rawDensity === "number" && Number.isFinite(rawDensity)
      ? Math.min(PHOTO_FILTER_DENSITY_RANGE.max, Math.max(PHOTO_FILTER_DENSITY_RANGE.min, rawDensity))
      : DEFAULT_PHOTO_FILTER.density;

  const preserveLuminosity =
    typeof src.preserveLuminosity === "boolean" ? src.preserveLuminosity : DEFAULT_PHOTO_FILTER.preserveLuminosity;

  return { color, density, preserveLuminosity };
}

/** density가 0 이하 — 즉 픽셀을 건드리지 않는 항등 설정인지. */
export function isIdentityPhotoFilter(p: PhotoFilter): boolean {
  return p.density <= 0;
}

// ---------------------------------------------------------------------------
// 적용 — 멀티플라이 색조 + 선택적 휘도 보존(제자리 변형)
// ---------------------------------------------------------------------------

/**
 * 포토 필터 제자리 적용 — 항등(density 0)이면 no-op.
 * 밀도 d=density/100, 필터색 (fr,fg,fb)에 대해 각 채널:
 *   c' = c*(1-d) + (c*f/255)*d   (멀티플라이 톤을 d만큼 섞음)
 * preserveLuminosity면 적용 후 픽셀 휘도(L')를 원본 휘도(L)에 맞춰 채널을 스케일:
 *   c'' = c' * (L / L')   (L'=0이면 보정 불가 → 그대로)
 * Uint8ClampedArray가 반올림·0..255 클램프를 처리한다. 알파(+3)는 보존.
 */
export function applyPhotoFilter(img: StudioImageDataLike, p: PhotoFilter): void {
  const safe = normalizePhotoFilter(p);
  if (isIdentityPhotoFilter(safe)) return;
  const { r: fr, g: fg, b: fb } = hexToRgb(safe.color);
  const d = safe.density / 100;
  const inv = 1 - d;
  // 채널별 멀티플라이 계수: c' = c * (inv + (f/255)*d) = c * mul[c].
  const mulR = inv + (fr / 255) * d;
  const mulG = inv + (fg / 255) * d;
  const mulB = inv + (fb / 255) * d;

  const data = img.data;
  if (safe.preserveLuminosity) {
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const lum = LUMA_R * r + LUMA_G * g + LUMA_B * b;
      const nr = r * mulR;
      const ng = g * mulG;
      const nb = b * mulB;
      const newLum = LUMA_R * nr + LUMA_G * ng + LUMA_B * nb;
      // 멀티플라이는 밝기를 낮추므로 원본 휘도로 되돌린다. newLum 0이면 보정 불가.
      const scale = newLum > 0 ? lum / newLum : 1;
      data[i] = nr * scale;
      data[i + 1] = ng * scale;
      data[i + 2] = nb * scale;
    }
  } else {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = data[i]! * mulR;
      data[i + 1] = data[i + 1]! * mulG;
      data[i + 2] = data[i + 2]! * mulB;
    }
  }
}

// ---------------------------------------------------------------------------
// 웹툰 색조 프리셋 — 첫 항목은 항등(없음), 나머지는 자주 쓰는 색조.
// 모든 value는 normalizePhotoFilter를 통과(색 #rrggbb, density 0..100).
// ---------------------------------------------------------------------------

export type PhotoFilterPreset = { id: string; label: string; tip: string; value: PhotoFilter };

export const PHOTO_FILTER_PRESETS: PhotoFilterPreset[] = [
  {
    id: "none",
    label: "없음",
    tip: "색조 없는 원본.",
    value: normalizePhotoFilter(DEFAULT_PHOTO_FILTER),
  },
  {
    id: "warming-85",
    label: "워밍 85",
    tip: "주황빛을 더해 차가운 빛을 따뜻하게 데우는 표준 워밍 필터.",
    value: normalizePhotoFilter({ color: "#ec8a00", density: 35 }),
  },
  {
    id: "cooling-80",
    label: "쿨링 80",
    tip: "푸른빛을 더해 따뜻한 빛을 서늘하게 식히는 표준 쿨링 필터.",
    value: normalizePhotoFilter({ color: "#006dff", density: 35 }),
  },
  {
    id: "sepia",
    label: "세피아",
    tip: "누런 갈색 톤으로 오래된 사진 같은 색조를 입힙니다.",
    value: normalizePhotoFilter({ color: "#ac7a33", density: 40 }),
  },
  {
    id: "underwater",
    label: "언더워터",
    tip: "청록빛을 더해 물속에서 본 듯한 색조를 만듭니다.",
    value: normalizePhotoFilter({ color: "#00c2cc", density: 40 }),
  },
  {
    id: "sunset",
    label: "선셋 노을",
    tip: "짙은 주황빛으로 노을 진 해질녘 색조를 냅니다.",
    value: normalizePhotoFilter({ color: "#ff7b00", density: 45 }),
  },
  {
    id: "golden-hour",
    label: "골든 아워",
    tip: "황금빛 햇살이 내리쬐는 클래식 감성 필터.",
    value: normalizePhotoFilter({ color: "#ffb300", density: 38 }),
  },
  {
    id: "cyberpunk",
    label: "사이버펑크",
    tip: "자줏빛과 네온의 조화로 미래지향적 도시 분위기를 극대화합니다.",
    value: normalizePhotoFilter({ color: "#e040fb", density: 42 }),
  },
  {
    id: "retro-anime",
    label: "90s 셀 애니",
    tip: "90년대 클래식 애니메이션의 맑은 원색 색조 느낌.",
    value: normalizePhotoFilter({ color: "#40c4ff", density: 30 }),
  },
  {
    id: "cherry-blossom",
    label: "체리 블라썸",
    tip: "은은한 핑크빛으로 화사하고 사랑스러운 로맨스 연출.",
    value: normalizePhotoFilter({ color: "#ff80ab", density: 32 }),
  },
  {
    id: "emerald-forest",
    label: "에메랄드 숲",
    tip: "싱그러운 청록 잎사귀 빛의 신비로운 자연 필터.",
    value: normalizePhotoFilter({ color: "#00e676", density: 28 }),
  },
  {
    id: "vintage-film",
    label: "빈티지 필름",
    tip: "아날로그 아카이브 잡지 느낌의 따스한 감성 필터.",
    value: normalizePhotoFilter({ color: "#d7ccc8", density: 35 }),
  },
  {
    id: "midnight-purple",
    label: "미드나잇 보라",
    tip: "깊은 보랏빛 밤하늘과 심야 판타지 연출.",
    value: normalizePhotoFilter({ color: "#7c4dff", density: 40 }),
  },
  {
    id: "deep-blue",
    label: "딥 블루",
    tip: "짙은 청색으로 깊은 밤·심해 같은 색조를 만듭니다.",
    value: normalizePhotoFilter({ color: "#0033aa", density: 40 }),
  },
  {
    id: "green",
    label: "그린",
    tip: "초록빛을 더해 숲·이질적인 분위기의 색조를 냅니다.",
    value: normalizePhotoFilter({ color: "#1f8a3a", density: 30 }),
  },
  {
    id: "violet",
    label: "바이올렛",
    tip: "보랏빛을 더해 몽환적이고 신비로운 색조를 만듭니다.",
    value: normalizePhotoFilter({ color: "#7b3fd0", density: 30 }),
  },
  {
    id: "pink",
    label: "핑크",
    tip: "분홍빛을 더해 화사하고 로맨틱한 색조를 냅니다.",
    value: normalizePhotoFilter({ color: "#ff5e9a", density: 30 }),
  },
];

// ---------------------------------------------------------------------------
// Konva 등록용 — StudioPage가 커스텀 필터로 부착.
// attrs는 외부 입력이므로 normalizePhotoFilter로 안전 변환, 항등/무효면 no-op.
// ---------------------------------------------------------------------------

/**
 * Konva 필터 함수 — node(`this`).attrs에서 pfColor(string)·pfDensity(number)·
 * pfPreserve(0|1)를 읽어 normalizePhotoFilter로 안전 변환 후 applyPhotoFilter.
 * 항등(density 0)이거나 attrs가 비면 no-op. pfPreserve는 1만 true(누락/0=false).
 */
export function photoFilterKonvaFilter(this: { attrs?: Record<string, unknown> }, imageData: StudioImageDataLike): void {
  const attrs = this.attrs;
  if (!attrs) return;
  const rawColor = attrs.pfColor;
  const rawDensity = attrs.pfDensity;
  const filter = normalizePhotoFilter({
    color: typeof rawColor === "string" ? rawColor : undefined,
    density: typeof rawDensity === "number" && Number.isFinite(rawDensity) ? rawDensity : undefined,
    preserveLuminosity: attrs.pfPreserve === 1,
  });
  if (isIdentityPhotoFilter(filter)) return;
  applyPhotoFilter(imageData, filter);
}
