/**
 * studio-line-width-adjust.ts
 *
 * Clip Studio Paint Correct Line Width Tool (선폭 수정 / 선 굵기 조절).
 * Enables non-destructive or batch line weight modifications on drawn vector/raster strokes:
 * - Thicken (지정 폭으로 굵게)
 * - Narrow (지정 폭으로 가늘게)
 * - Scale (배율로 확대/축소)
 * - Fix (일정 폭으로 변경)
 */

import type { DrawEl } from "../studio-element-model";

export type LineWidthAction = "thicken" | "narrow" | "scale" | "fix";

export interface LineWidthAdjustmentOptions {
  readonly action: LineWidthAction;
  readonly value: number; // px for thicken/narrow/fix, or multiplier for scale (e.g. 1.2)
  readonly scalePressures?: boolean;
}

export const LINE_WIDTH_PRESETS: readonly {
  readonly label: string;
  readonly options: LineWidthAdjustmentOptions;
}[] = Object.freeze([
  { label: "+1px", options: { action: "thicken", value: 1 } },
  { label: "+2px", options: { action: "thicken", value: 2 } },
  { label: "+5px", options: { action: "thicken", value: 5 } },
  { label: "-1px", options: { action: "narrow", value: 1 } },
  { label: "-2px", options: { action: "narrow", value: 2 } },
  { label: "1.2x", options: { action: "scale", value: 1.2 } },
  { label: "0.8x", options: { action: "scale", value: 0.8 } },
  { label: "3px 고정", options: { action: "fix", value: 3 } },
]);

export const MIN_STROKE_WIDTH = 0.5;
export const MAX_STROKE_WIDTH = 250;

/**
 * Calculates the new stroke width given a current width and adjustment options.
 */
export function calculateAdjustedStrokeWidth(
  currentWidth: number,
  options: LineWidthAdjustmentOptions,
): number {
  const safeCurrent = Math.max(MIN_STROKE_WIDTH, currentWidth);
  let next = safeCurrent;

  switch (options.action) {
    case "thicken":
      next = safeCurrent + Math.max(0, options.value);
      break;
    case "narrow":
      next = safeCurrent - Math.max(0, options.value);
      break;
    case "scale":
      next = safeCurrent * Math.max(0.1, options.value);
      break;
    case "fix":
      next = Math.max(MIN_STROKE_WIDTH, options.value);
      break;
  }

  return Math.max(MIN_STROKE_WIDTH, Math.min(MAX_STROKE_WIDTH, Math.round(next * 10) / 10));
}

/**
 * Computes the partial update for a DrawEl applying the line width adjustment.
 */
export function adjustDrawStrokeWidth(
  stroke: DrawEl,
  options: LineWidthAdjustmentOptions,
): Partial<DrawEl> {
  const newWidth = calculateAdjustedStrokeWidth(stroke.strokeWidth ?? 2, options);

  let nextPressures = stroke.pressures;
  if (options.scalePressures && stroke.pressures && stroke.pressures.length > 0) {
    const ratio = newWidth / Math.max(MIN_STROKE_WIDTH, stroke.strokeWidth ?? 2);
    nextPressures = stroke.pressures.map((p) => Math.max(0.05, Math.min(1.5, p * ratio)));
  }

  return {
    strokeWidth: newWidth,
    ...(nextPressures ? { pressures: nextPressures } : {}),
  };
}
