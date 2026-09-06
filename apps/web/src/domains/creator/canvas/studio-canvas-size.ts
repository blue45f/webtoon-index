/**
 * Canvas size helpers for the background editor / resizer.
 * Width is fixed at CANVAS_W; height drives page aspect (webtoon/PicsArt flow).
 * Pure — no React/DOM.
 */

import { CANVAS_W } from "../studio-assets";
import {
  MAGIC_RESIZE_PRESETS,
  presetCanvasSize,
  type MagicResizePreset,
} from "../studio-magic-resize";

export const STUDIO_CANVAS_H_RANGE = { min: 360, max: 6000 } as const;
export const STUDIO_CANVAS_H_STEP = 40;

export interface StudioCanvasHeightPreset {
  id: string;
  label: string;
  hint: string;
  /** Target height at CANVAS_W width. */
  height: number;
  /** Short aspect label e.g. "1:1". */
  aspectLabel: string;
}

/** Friendly height chips for quick page size (PicsArt/Canva-style). */
export const STUDIO_CANVAS_HEIGHT_PRESETS: readonly StudioCanvasHeightPreset[] = Object.freeze([
  {
    id: "thumb",
    label: "가로 썸네일",
    hint: "16:9 유튜브·카드",
    height: presetCanvasSize({ id: "x", label: "", hint: "", aspectW: 16, aspectH: 9 }).height,
    aspectLabel: "16:9",
  },
  {
    id: "square",
    label: "정사각",
    hint: "1:1 인스타 피드",
    height: CANVAS_W,
    aspectLabel: "1:1",
  },
  {
    id: "feed",
    label: "세로 피드",
    hint: "4:5 피드 카드",
    height: Math.round((CANVAS_W * 5) / 4),
    aspectLabel: "4:5",
  },
  {
    id: "cut",
    label: "세로 컷",
    hint: "3:4 웹툰 한 컷",
    height: Math.round((CANVAS_W * 4) / 3),
    aspectLabel: "3:4",
  },
  {
    id: "story",
    label: "스토리",
    hint: "9:16 숏폼",
    height: Math.round((CANVAS_W * 16) / 9),
    aspectLabel: "9:16",
  },
  {
    id: "scroll",
    label: "스크롤 장문",
    hint: "웹툰 긴 페이지",
    height: 2400,
    aspectLabel: "3:10",
  },
]);

export function clampStudioCanvasHeight(height: unknown): number {
  const h = typeof height === "number" && Number.isFinite(height) ? height : 1080;
  return Math.min(
    STUDIO_CANVAS_H_RANGE.max,
    Math.max(STUDIO_CANVAS_H_RANGE.min, Math.round(h))
  );
}

export function adjustStudioCanvasHeight(height: unknown, delta: number): number {
  const d = typeof delta === "number" && Number.isFinite(delta) ? delta : 0;
  return clampStudioCanvasHeight(clampStudioCanvasHeight(height) + d);
}

export function studioCanvasAspectLabel(width: number, height: number): string {
  const w = width > 0 ? width : CANVAS_W;
  const h = height > 0 ? height : w;
  const ratio = w / h;
  // Match common named ratios with tolerance
  const known: { label: string; r: number }[] = [
    { label: "1:1", r: 1 },
    { label: "4:5", r: 4 / 5 },
    { label: "3:4", r: 3 / 4 },
    { label: "9:16", r: 9 / 16 },
    { label: "16:9", r: 16 / 9 },
    { label: "1.91:1", r: 1.91 },
  ];
  for (const k of known) {
    if (Math.abs(ratio - k.r) < 0.03) return k.label;
  }
  // Reduced fraction-ish label
  const g = gcd(Math.round(w), Math.round(h));
  const aw = Math.round(w / g);
  const ah = Math.round(h / g);
  if (aw <= 32 && ah <= 32) return `${aw}:${ah}`;
  return `${ratio.toFixed(2)}:1`;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

/** Nearest friendly height preset id (by absolute height distance). */
export function nearestStudioCanvasHeightPresetId(height: unknown): string | null {
  const h = clampStudioCanvasHeight(height);
  let best: StudioCanvasHeightPreset | null = null;
  let dist = Infinity;
  for (const preset of STUDIO_CANVAS_HEIGHT_PRESETS) {
    const d = Math.abs(preset.height - h);
    if (d < dist) {
      dist = d;
      best = preset;
    }
  }
  // Only "match" if within 24px
  if (!best || dist > 24) return null;
  return best.id;
}

/** ViewBox rect for aspect preview (max 40×40). */
export function studioCanvasAspectPreviewRect(
  width: number,
  height: number,
  box = 40
): { x: number; y: number; w: number; h: number } {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const scale = Math.min(box / w, box / h);
  const rw = Math.max(4, w * scale);
  const rh = Math.max(4, h * scale);
  return {
    x: (box - rw) / 2,
    y: (box - rh) / 2,
    w: rw,
    h: rh,
  };
}

export function magicResizePresetsForEditor(): readonly MagicResizePreset[] {
  return MAGIC_RESIZE_PRESETS;
}

export function studioCanvasSizeSummary(width: number, height: number): string {
  const aspect = studioCanvasAspectLabel(width, height);
  return `${Math.round(width)}×${Math.round(height)} · ${aspect}`;
}
