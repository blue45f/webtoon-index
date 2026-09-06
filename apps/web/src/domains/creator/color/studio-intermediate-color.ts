/**
 * studio-intermediate-color.ts
 *
 * Mathematical bilinear color interpolation engine for Clip Studio Paint
 * Intermediate Color Palette (중간색 팔레트).
 *
 * Given 4 corner anchor colors (Top-Left, Top-Right, Bottom-Left, Bottom-Right),
 * computes an interactive 2D NxN grid of subtle transitional shades:
 *   C(u, v) = (1-u)(1-v)C00 + u(1-v)C10 + (1-u)v C01 + uv C11
 */

export interface StudioIntermediateColorCorners {
  readonly c00: string; // Top-Left (e.g. highlight)
  readonly c10: string; // Top-Right (e.g. base tone)
  readonly c01: string; // Bottom-Left (e.g. shadow 1)
  readonly c11: string; // Bottom-Right (e.g. ambient shadow 2)
}

export interface StudioIntermediateColorPreset {
  readonly id: string;
  readonly name: string;
  readonly corners: StudioIntermediateColorCorners;
}

export type StudioIntermediateGridSize = 4 | 6 | 8 | 12;

export const STUDIO_INTERMEDIATE_COLOR_PRESETS: readonly StudioIntermediateColorPreset[] =
  Object.freeze([
    {
      id: "korean-webtoon-skin",
      name: "웹툰 피부톤",
      corners: {
        c00: "#fff0e6", // 밝은 하이라이트
        c10: "#fcd5b5", // 기본 살구빛 피부
        c01: "#e59882", // 1차 따뜻한 음영
        c11: "#8c5357", // 2차 딥 모브 그림자
      },
    },
    {
      id: "anime-golden-hair",
      name: "골든 헤어",
      corners: {
        c00: "#fffbeb", // 엔젤링 하이라이트
        c10: "#fde047", // 기본 골드 옐로
        c01: "#ca8a04", // 앰버 중간음영
        c11: "#713f12", // 딥 브라운 암부
      },
    },
    {
      id: "cool-night-shadow",
      name: "쿨 나이트 섀도우",
      corners: {
        c00: "#f1f5f9", // 창백한 달빛
        c10: "#94a3b8", // 슬레이트 중간톤
        c01: "#334155", // 짙은 남회색
        c11: "#090d16", // 딥 네이비 암부
      },
    },
    {
      id: "sunset-lighting",
      name: "노을 석양 무드",
      corners: {
        c00: "#fed7aa", // 피치 하이라이트
        c10: "#fb7185", // 로즈 마젠타
        c01: "#c084fc", // 라벤더 황혼
        c11: "#1e1b4b", // 미드나잇 인디고
      },
    },
  ]);

export const DEFAULT_INTERMEDIATE_CORNERS: StudioIntermediateColorCorners =
  STUDIO_INTERMEDIATE_COLOR_PRESETS[0]!.corners;

/** Converts hex (#rgb, #rrggbb) string to [r, g, b] numbers (0..255) */
export function hexToRgb(hex: string): readonly [number, number, number] {
  let cleaned = hex.trim().replace(/^#/u, "");
  if (cleaned.length === 3) {
    cleaned = cleaned
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (cleaned.length !== 6) {
    return [128, 128, 128];
  }
  const num = parseInt(cleaned, 16);
  if (Number.isNaN(num)) return [128, 128, 128];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/** Converts [r, g, b] (0..255) numbers to standard #rrggbb lowercase hex */
export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v: number) => clamp(v).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Bilinear interpolation between 4 colors:
 * u in [0..1] (horizontal factor from left to right)
 * v in [0..1] (vertical factor from top to bottom)
 */
export function interpolateBilinearColor(
  c00: string,
  c10: string,
  c01: string,
  c11: string,
  u: number,
  v: number,
): string {
  const [r00, g00, b00] = hexToRgb(c00);
  const [r10, g10, b10] = hexToRgb(c10);
  const [r01, g01, b01] = hexToRgb(c01);
  const [r11, g11, b11] = hexToRgb(c11);

  const safeU = Math.max(0, Math.min(1, u));
  const safeV = Math.max(0, Math.min(1, v));

  const w00 = (1 - safeU) * (1 - safeV);
  const w10 = safeU * (1 - safeV);
  const w01 = (1 - safeU) * safeV;
  const w11 = safeU * safeV;

  const r = w00 * r00 + w10 * r10 + w01 * r01 + w11 * r11;
  const g = w00 * g00 + w10 * g10 + w01 * g01 + w11 * g11;
  const b = w00 * b00 + w10 * b10 + w01 * b01 + w11 * b11;

  return rgbToHex(r, g, b);
}

/** Generates a 2D matrix of intermediate colors with dimension gridSize x gridSize */
export function generateIntermediateColorGrid(
  corners: StudioIntermediateColorCorners,
  gridSize: StudioIntermediateGridSize,
): readonly (readonly string[])[] {
  const size = Math.max(2, gridSize);
  const grid: (readonly string[])[] = [];

  for (let row = 0; row < size; row++) {
    const v = size > 1 ? row / (size - 1) : 0;
    const currentRow: string[] = [];
    for (let col = 0; col < size; col++) {
      const u = size > 1 ? col / (size - 1) : 0;
      currentRow.push(
        interpolateBilinearColor(
          corners.c00,
          corners.c10,
          corners.c01,
          corners.c11,
          u,
          v,
        ),
      );
    }
    grid.push(Object.freeze(currentRow));
  }

  return Object.freeze(grid);
}
