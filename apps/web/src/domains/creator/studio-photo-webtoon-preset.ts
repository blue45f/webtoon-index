/**
 * Studio Photo → Webtoon Preset
 * 업로드한 사진 한 장을 원클릭으로 웹툰풍으로 바꾸는 프리셋 — 이미 존재하는 개별 필터 엔진
 * (Posterize/Vibrance/Clarity/Stylize/Halftone/PhotoFilter)의 값을 실사 사진에 맞게 조합한 것.
 *
 * studio-looks.ts(STUDIO_LOOKS)와 다른 점: 룩은 절대값 적용(looksResetPatch로 전 필드 비운 뒤
 * patch)이지만, 이 프리셋은 "이 프리셋이 실제로 건드리는 필드"만 골라 비우고 그 위에 patch를
 * 얹는다(scoped merge) — 사용자가 이미 손으로 맞춘 외곽선·글로우·그레인·컬러 밸런스 등은
 * 절대 건드리지 않는다("사진 위에 얹는" 원클릭, 룩처럼 전체를 갈아엎지 않음).
 *
 * 필터 조합은 buildImageFilters의 고정 파이프라인 순서(studio-konva-filters.ts)를 고려해
 * 골랐다: Halftone은 Stylize/Sketch보다 먼저 실행되므로 이미 망점화된 버퍼에 에지 검출을
 * 걸면 지저분해진다 — 이 모듈은 Halftone과 Stylize/Sketch를 같은 프리셋에 절대 함께 쓰지
 * 않는다. 반대로 Posterize는 Stylize보다 먼저 실행되어, 포스터화로 생긴 평평한 색 경계에
 * findEdges 잉크 선을 얹는 조합은 의도적이고 유효하다("선명한 카툰" 참고).
 * outline(Outline) 필드는 알파 경계 바깥에만 그려지는 스티커 테두리라 불투명 사각 사진에는
 * 아무 효과가 없다(no-op) — 그래서 이 카탈로그는 outline을 쓰지 않는다.
 *
 * 무거운 필터 엔진(normalizeVibrance 등)은 import하지 않는다 — studio-looks.ts와 같은 이유로,
 * 이 카탈로그는 defaultOpen 섹션에서 즉시 렌더되므로 raw 객체 리터럴만 쓴다(검증된 상수 범위).
 * Konva/DOM 의존 없음. 전부 순수·결정적.
 */

import type { ImageFilterFields } from "./render/studio-konva-filter-fields";

// ---------------------------------------------------------------------------
// 타입
// ---------------------------------------------------------------------------

export type PhotoWebtoonPresetId = "vivid-cartoon" | "soft-cel-shade" | "mono-screentone";

export type PhotoWebtoonPreset = {
  id: PhotoWebtoonPresetId;
  label: string;
  tip: string;
  swatch: string; // #rrggbb —칩 표시용 대표색(픽셀 효과와 무관, 순수 UI)
  patch: Partial<ImageFilterFields>;
};

// ---------------------------------------------------------------------------
// 프리셋 카탈로그 — 정확히 3개. 값은 IMAGE_ADJUSTMENT_RANGES / 각 엔진의 검증된 범위 안.
// ---------------------------------------------------------------------------

export const PHOTO_WEBTOON_PRESETS: PhotoWebtoonPreset[] = [
  {
    id: "vivid-cartoon",
    label: "선명한 카툰",
    tip: "색을 카툰처럼 단순화하고 채도·대비를 끌어올린 뒤 색 경계에 옅은 잉크 선을 더해, 인물·풍경 사진을 화사한 컬러 웹툰 컷처럼 바꿉니다.",
    swatch: "#ff5a36",
    patch: {
      contrast: 22,
      posterize: 4,
      vibrance: { vibrance: 32, saturation: 8 },
      clarity: { clarity: 24, dehaze: 0 },
      stylize: { type: "findEdges", strength: 36, detail: 2 },
    },
  },
  {
    id: "soft-cel-shade",
    label: "부드러운 셀셰이딩",
    tip: "은은한 색 계단화와 따뜻한 톤으로 피부·머리카락을 부드럽게 다듬어, 로맨스 웹툰 인물컷 같은 폭신한 셀셰이딩을 만듭니다.",
    swatch: "#ffb98a",
    patch: {
      contrast: 8,
      posterize: 7,
      vibrance: { vibrance: 20, saturation: 2 },
      clarity: { clarity: 10, dehaze: 0 },
      photoFilter: { color: "#ffb98a", density: 14, preserveLuminosity: true },
    },
  },
  {
    id: "mono-screentone",
    label: "흑백 망점 웹툰",
    tip: "흑백으로 바꾸고 고운 흑색 망점을 입혀, 정통 흑백 만화 원고 스타일의 스크린톤 웹툰 컷을 만듭니다.",
    swatch: "#1a1a1a",
    patch: {
      grayscale: true,
      contrast: 24,
      halftone: { dotSize: 3, angle: 45, mode: "mono", strength: 75 },
    },
  },
];

export function findPhotoWebtoonPreset(id: string): PhotoWebtoonPreset | undefined {
  return PHOTO_WEBTOON_PRESETS.find((p) => p.id === id);
}

// ---------------------------------------------------------------------------
// 이 카탈로그가 소유(touch)하는 필드 키 — 프리셋 간 전환 시 "새어나가는" 이전 프리셋
// 잔여값을 막기 위해 scoped reset에 쓰인다. 3개 프리셋 중 최소 하나가 생략하는 키만
// 넣으면 되지만(contrast는 3개 모두 지정하므로 이론상 불필요), looksResetPatch/
// imageFilterResetPatch와 같은 "무조건 전부 비운다" 방어적 스타일을 따라 안전하게 포함한다.
// ---------------------------------------------------------------------------

export const PHOTO_WEBTOON_TOUCHED_KEYS: (keyof ImageFilterFields)[] = [
  "grayscale",
  "contrast",
  "posterize",
  "vibrance",
  "clarity",
  "photoFilter",
  "stylize",
  "halftone",
];

/** PHOTO_WEBTOON_TOUCHED_KEYS를 전부 undefined로 비운 패치. */
function scopedResetPatch(): Partial<ImageFilterFields> {
  const patch: Partial<ImageFilterFields> = {};
  for (const key of PHOTO_WEBTOON_TOUCHED_KEYS) patch[key] = undefined;
  return patch;
}

// ---------------------------------------------------------------------------
// 적용 — scoped reset 후 프리셋 patch를 얹는다(이 카탈로그 소유 필드 밖은 전혀 건드리지 않음)
// ---------------------------------------------------------------------------

/**
 * presetId를 currentFields 위에 병합 적용한다.
 *   1) PHOTO_WEBTOON_TOUCHED_KEYS만 undefined로 비운다(프리셋 전환 시 이전 프리셋의
 *      stylize/halftone 등이 남아 다음 프리셋과 뒤섞이는 것을 방지).
 *   2) 그 위에 새 프리셋의 patch를 얹는다.
 * outline·glow·grain·colorBalance·channelMixer·selectiveHsl·gradientMap·autoAdjust·
 * blurFx·distort·light·detail·levels*·curve*·sketch·screentone·lineart·saturation(스칼라)·
 * hue·temperature·sharpen 등 이 카탈로그가 다루지 않는 모든 필드는 손대지 않는다 —
 * 사용자가 다른 패널에서 이미 조정해둔 값이 그대로 유지된다.
 *
 * 알 수 없는/유효하지 않은 presetId는 currentFields를 그대로 반환한다(no-op 안전 폴백 —
 * 정상 UI 경로에서는 발생하지 않는다. 버튼은 항상 카탈로그의 실제 preset 객체를 넘긴다).
 */
export function applyPhotoWebtoonPreset(
  currentFields: Partial<ImageFilterFields>,
  presetId: string
): Partial<ImageFilterFields> {
  const preset = findPhotoWebtoonPreset(presetId);
  if (!preset) return currentFields;
  return { ...currentFields, ...scopedResetPatch(), ...preset.patch };
}

/**
 * PHOTO_WEBTOON_TOUCHED_KEYS만 지운다 — 패널의 "원본으로" 버튼용.
 * 주의: grayscale/contrast/posterize/vibrance/clarity/photoFilter/stylize/halftone은
 * 이 카탈로그 전용 필드가 아니라 각각 "기본 필터"/"생동감"/"명료도"/"포토 필터"/
 * "스타일라이즈"/"하프톤" 전용 패널과 공유하는 필드다. 즉 이 프리셋을 한 번도 쓰지
 * 않고 저 전용 패널들에서 손으로 맞춘 값이라도, 여기서 "원본으로"를 누르면 함께
 * 지워진다 — "이 프리셋이 바꾼 값만" 지우는 게 아니라 "이 프리셋이 다루는 필드
 * 전체"를 지운다. 외곽선·글로우·그레인·컬러 밸런스 등 이 카탈로그가 다루지 않는
 * 필드만 보존된다.
 */
export function resetPhotoWebtoonPreset(currentFields: Partial<ImageFilterFields>): Partial<ImageFilterFields> {
  return { ...currentFields, ...scopedResetPatch() };
}
