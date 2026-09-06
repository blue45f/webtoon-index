/**
 * studio-subview-model.ts
 *
 * Model and color sampling engine for Clip Studio Paint Sub View Palette (서브 뷰 팔레트).
 * Provides multi-image reference handling, zoom/rotation/flip transforms,
 * and high-precision eyedropper sampling.
 */

export interface StudioSubViewImage {
  readonly id: string;
  readonly name: string;
  readonly src: string;
  readonly width?: number;
  readonly height?: number;
}

export interface StudioSubViewState {
  readonly images: readonly StudioSubViewImage[];
  readonly activeIndex: number;
  readonly zoom: number; // 0.25 .. 4.0
  readonly rotationDeg: number; // 0 .. 360
  readonly flipH: boolean;
  readonly flipV: boolean;
  readonly eyedropperActive: boolean;
}

export const STUDIO_SUBVIEW_ZOOM_RANGE = { min: 0.25, max: 4.0, step: 0.05 } as const;

export const DEFAULT_SUBVIEW_IMAGES: readonly StudioSubViewImage[] = Object.freeze([
  {
    id: "sample-palette-1",
    name: "웹툰 기본 컬러 레퍼런스",
    src: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='200' viewBox='0 0 300 200'><rect width='300' height='200' fill='%231e293b'/><circle cx='80' cy='100' r='50' fill='%23fcd5b5'/><circle cx='150' cy='100' r='50' fill='%23e59882'/><circle cx='220' cy='100' r='50' fill='%23985b60'/><text x='150' y='180' fill='%2394a3b8' font-size='12' text-anchor='middle'>Webtoon Skin Swatches</text></svg>",
    width: 300,
    height: 200,
  },
  {
    id: "sample-palette-2",
    name: "자연광 & 그림자 틴트",
    src: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='200' viewBox='0 0 300 200'><rect width='300' height='200' fill='%230f172a'/><rect x='30' y='40' width='60' height='120' rx='8' fill='%23fbbf24'/><rect x='120' y='40' width='60' height='120' rx='8' fill='%23f43f5e'/><rect x='210' y='40' width='60' height='120' rx='8' fill='%2338bdf8'/><text x='150' y='185' fill='%2364748b' font-size='12' text-anchor='middle'>Lighting Moods</text></svg>",
    width: 300,
    height: 200,
  },
]);

export const DEFAULT_SUBVIEW_STATE: StudioSubViewState = Object.freeze({
  images: DEFAULT_SUBVIEW_IMAGES,
  activeIndex: 0,
  zoom: 1.0,
  rotationDeg: 0,
  flipH: false,
  flipV: false,
  eyedropperActive: true,
});

export function clampSubViewZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1.0;
  return Math.min(STUDIO_SUBVIEW_ZOOM_RANGE.max, Math.max(STUDIO_SUBVIEW_ZOOM_RANGE.min, zoom));
}

export function normalizeRotationDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const mod = deg % 360;
  return mod < 0 ? mod + 360 : mod;
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => {
    const clamped = Math.max(0, Math.min(255, Math.round(n)));
    return clamped.toString(16).padStart(2, "0");
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function samplePixelColorFromRgbaData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): { r: number; g: number; b: number; a: number; hex: string } {
  const safeX = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const safeY = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const index = (safeY * width + safeX) * 4;

  const r = data[index] ?? 0;
  const g = data[index + 1] ?? 0;
  const b = data[index + 2] ?? 0;
  const a = (data[index + 3] ?? 255) / 255;

  return {
    r,
    g,
    b,
    a,
    hex: rgbToHex(r, g, b),
  };
}
