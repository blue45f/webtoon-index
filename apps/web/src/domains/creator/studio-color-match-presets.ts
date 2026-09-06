/**
 * studio-color-match-presets.ts
 *
 * Presets and synthetic color image generator for StudioColorMatchPanel.
 */

import type { StudioAdvancedColorRgbaImage } from "./studio-advanced-color-filter-kernels";

export interface ColorMatchPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly previewGradient: string;
  readonly sampleColors: readonly [number, number, number][];
}

export const COLOR_MATCH_PRESETS: readonly ColorMatchPreset[] = Object.freeze([
  {
    id: "warm-sunset",
    name: "따뜻한 노을",
    description: "오렌지·마젠타 석양의 따스하고 감성적인 분위기",
    previewGradient: "linear-gradient(135deg, #f97316, #db2777, #7c3aed)",
    sampleColors: [
      [249, 115, 22],
      [219, 39, 119],
      [124, 58, 237],
      [254, 215, 170],
    ],
  },
  {
    id: "cool-moonlight",
    name: "서늘한 달빛",
    description: "짙은 남색과 청록빛의 차분하고 서늘한 밤 분위기",
    previewGradient: "linear-gradient(135deg, #0f172a, #1e3a8a, #06b6d4)",
    sampleColors: [
      [15, 23, 42],
      [30, 58, 138],
      [6, 182, 212],
      [148, 163, 184],
    ],
  },
  {
    id: "warm-dawn",
    name: "따뜻한 새벽",
    description: "파스텔톤 핑크와 연보라의 몽환적인 아침 햇살",
    previewGradient: "linear-gradient(135deg, #f43f5e, #ec4899, #a855f7)",
    sampleColors: [
      [244, 63, 94],
      [236, 72, 153],
      [168, 85, 247],
      [254, 205, 211],
    ],
  },
  {
    id: "cyberpunk-neon",
    name: "사이버펑크 네온",
    description: "선명한 시안과 네온 핑크의 미래형 드라마틱 무드",
    previewGradient: "linear-gradient(135deg, #06b6d4, #3b82f6, #f43f5e)",
    sampleColors: [
      [6, 182, 212],
      [59, 130, 246],
      [244, 63, 94],
      [20, 20, 40],
    ],
  },
  {
    id: "vintage-sepia",
    name: "빈티지 세피아",
    description: "골드와 웜 브라운의 레트로 아날로그 필름 톤",
    previewGradient: "linear-gradient(135deg, #78350f, #b45309, #fde68a)",
    sampleColors: [
      [120, 53, 15],
      [180, 83, 9],
      [253, 230, 138],
      [69, 26, 3],
    ],
  },
  {
    id: "noir-monochrome",
    name: "느와르 시네마",
    description: "깊은 콘트라스트의 시네마틱 흑백 흑백 톤",
    previewGradient: "linear-gradient(135deg, #000000, #4b5563, #ffffff)",
    sampleColors: [
      [15, 15, 15],
      [75, 85, 99],
      [180, 180, 180],
      [250, 250, 250],
    ],
  },
]);

/** Helper to construct a synthetic RGBA image from sample colors */
export function createSyntheticReferenceRgba(
  sampleColors: readonly [number, number, number][],
  size = 64,
): StudioAdvancedColorRgbaImage {
  const data = new Uint8ClampedArray(size * size * 4);
  const colorCount = sampleColors.length;

  for (let y = 0; y < size; y++) {
    const t = y / size;
    const colorIndex = Math.min(colorCount - 1, Math.floor(t * colorCount));
    const [r, g, b] = sampleColors[colorIndex] ?? [128, 128, 128];

    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }

  return {
    width: size,
    height: size,
    data,
  };
}
