/**
 * Studio Color to Alpha Engine
 * 크리타/김프 "색상 투명화(Color to Alpha)" — 키 색상과의 채널별 최대 발산도를 알파로 삼아
 * 배경을 punching하고, 남은 색은 키 색 위에서 합성됐다고 가정해 언믹스(unmix)한다.
 * 매직완드/플러드필과 달리 앤티앨리어싱 가장자리를 하드 엣지 없이 비례 알파로 보존한다
 * (스캔한 원고의 흰/미색 종이 배경을 깔끔하게 지우는 표준 방법).
 * Konva/DOM 의존 없음 — StudioPage 캔버스 로직과 단위 테스트가 공유한다.
 * 전부 순수·결정적(랜덤 없음).
 */

import { hexToRgb, type StudioImageDataLike } from "./studio-filters";

// ---------------------------------------------------------------------------
// 파라미터 타입·기본값·범위
// ---------------------------------------------------------------------------

export type ColorToAlpha = {
  keyColor: string; // #rrggbb — 투명화 기준(배경) 색
  strength: number; // 0..100 — 0이면 항등(원본), 100이면 표준 알고리즘 그대로 적용
};

/** 항등(투명화 없음) — 흰 종이가 가장 흔한 대상이지만 strength 0이라 픽셀을 건드리지 않는다. */
export const DEFAULT_COLOR_TO_ALPHA: ColorToAlpha = { keyColor: "#ffffff", strength: 0 };

/** 슬라이더 한 칸 범위 — 강도는 0..100, 1 단위(PHOTO_FILTER_DENSITY_RANGE와 동일 관례). */
export const COLOR_TO_ALPHA_STRENGTH_RANGE = { min: 0, max: 100, step: 1 } as const;

// ---------------------------------------------------------------------------
// 정규화·항등 판정
// ---------------------------------------------------------------------------

/**
 * 과거 저장본/외부 입력 안전장치 — 누락/무효 색은 기본 흰색, strength는 숫자 아니면 기본값(0),
 * 범위 밖은 0..100으로 클램프. normalizePhotoFilter와 동일한 방어 패턴.
 */
export function normalizeColorToAlpha(p?: Partial<ColorToAlpha> | null): ColorToAlpha {
  const src = p && typeof p === "object" ? p : {};
  const keyColor =
    typeof src.keyColor === "string" && /^#[0-9a-f]{6}$/i.test(src.keyColor)
      ? src.keyColor
      : DEFAULT_COLOR_TO_ALPHA.keyColor;
  const raw = src.strength;
  const strength =
    typeof raw === "number" && Number.isFinite(raw)
      ? Math.min(COLOR_TO_ALPHA_STRENGTH_RANGE.max, Math.max(COLOR_TO_ALPHA_STRENGTH_RANGE.min, raw))
      : DEFAULT_COLOR_TO_ALPHA.strength;
  return { keyColor, strength };
}

/** strength가 0 이하 — 즉 픽셀을 건드리지 않는 항등 설정인지. */
export function isIdentityColorToAlpha(p: ColorToAlpha): boolean {
  return p.strength <= 0;
}

// ---------------------------------------------------------------------------
// 적용 — 채널별 최대 발산도 알파 + 언믹스(제자리 변형)
// ---------------------------------------------------------------------------

/**
 * 색상 투명화 제자리 적용 — 항등(strength 0)이면 no-op.
 *
 * 각 채널의 발산도는 pixel[c]가 key[c]보다 밝은지/어두운지에 따라 **방향별로 다른 분모**를 쓴다
 * (표준 Krita/GIMP color-to-alpha와 동일):
 *   pixel[c] > key[c] → (pixel[c]-key[c]) / (255-key[c])   ("밝은 쪽" 경계까지 남은 거리)
 *   pixel[c] < key[c] → (key[c]-pixel[c]) / key[c]         ("어두운 쪽" 경계까지 남은 거리)
 *   pixel[c] === key[c] → 0
 * 두 방향을 하나의 max(key[c],255-key[c])로 묶으면(대칭 분모) key[c]가 중앙(127.5)에서 먼
 * 색일 때 "가까운 쪽" 경계(0 또는 255)에 닿은 픽셀조차 발산도가 1에 못 미치는 오류가 생긴다
 * — 예: key=#f2ead9(r=242)일 때 순수 흰색(r=255)은 이미 그 채널의 이론적 최댓값(255)에
 * 닿아 있으므로 발산도가 반드시 1이어야 하는데, 대칭 분모(max(242,13)=242)를 쓰면
 * (255-242)/242≈0.05로 거의 발산하지 않은 것처럼 계산돼 밝은 하이라이트가 지워지지 않는다.
 * 방향별 분모는 각 채널이 자기 쪽 경계에 닿으면 항상 정확히 1이 되도록 보장한다(0-나눗셈
 * 없음 — key[c]===255일 때만 "밝은 쪽" 분모가 0인데 그 방향은 pixel[c]>255가 불가능해
 * 도달할 수 없고, key[c]===0일 때 "어두운 쪽"도 마찬가지로 도달 불가).
 * alpha = 세 채널 중 최댓값(가장 크게 어긋난 채널이 그 픽셀의 "전경다움"을 결정).
 *
 * alpha>0이면 그 픽셀이 키 색 배경 위에 alpha 비율로 합성된 결과라 가정하고 원래 전경색을
 * 복원(언믹스): unmixed = (pixel - key*(1-alpha)) / alpha ≡ key + (pixel-key)/alpha.
 * 이러면 반투명 앤티앨리어싱 가장자리에 남는 배경색 번짐(흰 헤일로)이 제거된다.
 *
 * strength(t=strength/100)는 원본→(언믹스 색, 계산된 알파)로의 블렌드 계수 — 0이면 완전 원본,
 * 100이면 표준 알고리즘 그대로. 기존 알파는 곱셈으로만 줄인다(이미 투명한 픽셀은 더 투명해질
 * 수 없고, 이 필터가 불투명도를 "복원"하지도 않는다 — 재적용/기보정 이미지에 안전).
 * Uint8ClampedArray가 반올림·0..255 클램프를 처리한다.
 */
export function applyColorToAlpha(img: StudioImageDataLike, p: ColorToAlpha): void {
  if (isIdentityColorToAlpha(p)) return;
  const { r: kr, g: kg, b: kb } = hexToRgb(p.keyColor);
  const t = Math.min(1, Math.max(0, p.strength / 100));
  // 채널별 "밝은 쪽"/"어두운 쪽" 방향 각각의 분모 — || 1은 도달 불가능한 분기의 방어용(위 설명).
  const drHi = 255 - kr || 1;
  const drLo = kr || 1;
  const dgHi = 255 - kg || 1;
  const dgLo = kg || 1;
  const dbHi = 255 - kb || 1;
  const dbLo = kb || 1;

  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;

    const ar = r > kr ? (r - kr) / drHi : r < kr ? (kr - r) / drLo : 0;
    const ag = g > kg ? (g - kg) / dgHi : g < kg ? (kg - g) / dgLo : 0;
    const ab = b > kb ? (b - kb) / dbHi : b < kb ? (kb - b) / dbLo : 0;
    const alpha = Math.min(1, Math.max(ar, ag, ab));

    if (alpha > 0) {
      const ur = kr + (r - kr) / alpha;
      const ug = kg + (g - kg) / alpha;
      const ub = kb + (b - kb) / alpha;
      data[i] = r + (ur - r) * t;
      data[i + 1] = g + (ug - g) * t;
      data[i + 2] = b + (ub - b) * t;
    }
    // alpha===0 → 픽셀이 키 색과 정확히 일치, 언믹스할 게 없다(색은 그대로, 알파만 아래서 줄인다).

    const origAFrac = data[i + 3]! / 255;
    const outAFrac = origAFrac * (1 - t * (1 - alpha));
    data[i + 3] = outAFrac * 255;
  }
}

// ---------------------------------------------------------------------------
// 배경/스캔 프리셋 — 첫 항목은 항등(없음), 나머지는 자주 지우는 배경색.
// 모든 value는 normalizeColorToAlpha를 통과(색 #rrggbb, strength 0..100).
// ---------------------------------------------------------------------------

export type ColorToAlphaPreset = { id: string; label: string; tip: string; value: ColorToAlpha };

export const COLOR_TO_ALPHA_PRESETS: ColorToAlphaPreset[] = [
  { id: "none", label: "없음", tip: "투명화 없는 원본.", value: normalizeColorToAlpha(DEFAULT_COLOR_TO_ALPHA) },
  {
    id: "white-paper",
    label: "흰 종이",
    tip: "흰 스캔/원고 배경을 지웁니다.",
    value: normalizeColorToAlpha({ keyColor: "#ffffff", strength: 85 }),
  },
  {
    id: "off-white-paper",
    label: "미색 종이",
    tip: "누렇게 뜬 미색 원고지 배경을 지웁니다.",
    value: normalizeColorToAlpha({ keyColor: "#f2ead9", strength: 80 }),
  },
  {
    id: "gray-scan",
    label: "회색 스캔",
    tip: "그림자 진 회색조 스캔 배경을 지웁니다.",
    value: normalizeColorToAlpha({ keyColor: "#dcdcdc", strength: 75 }),
  },
  {
    id: "black-bg",
    label: "검정 배경",
    tip: "어두운 배경(촬영/합성)을 지웁니다.",
    value: normalizeColorToAlpha({ keyColor: "#000000", strength: 85 }),
  },
  {
    id: "green-screen",
    label: "그린 스크린",
    tip: "크로마키 초록 배경을 지웁니다.",
    value: normalizeColorToAlpha({ keyColor: "#00ff00", strength: 90 }),
  },
];

// ---------------------------------------------------------------------------
// Konva 등록용 — StudioPage가 커스텀 필터로 부착.
// attrs는 외부 입력이므로 normalizeColorToAlpha로 안전 변환, 항등/무효면 no-op.
// ---------------------------------------------------------------------------

/**
 * Konva 필터 함수 — node(`this`).attrs에서 ctaColor(string)·ctaStrength(number)를 읽어
 * normalizeColorToAlpha로 안전 변환 후 applyColorToAlpha. 항등(strength 0)이거나 attrs가
 * 비면 no-op. photoFilterKonvaFilter와 동일한 방어 패턴.
 */
export function colorToAlphaKonvaFilter(
  this: { attrs?: Record<string, unknown> },
  imageData: StudioImageDataLike
): void {
  const attrs = this.attrs;
  if (!attrs) return;
  const rawColor = attrs.ctaColor;
  const rawStrength = attrs.ctaStrength;
  const cta = normalizeColorToAlpha({
    keyColor: typeof rawColor === "string" ? rawColor : undefined,
    strength: typeof rawStrength === "number" && Number.isFinite(rawStrength) ? rawStrength : undefined,
  });
  if (isIdentityColorToAlpha(cta)) return;
  applyColorToAlpha(imageData, cta);
}
