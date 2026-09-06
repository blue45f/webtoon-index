export const STUDIO_GUIDE_PERCENT_PRESETS = [25, 33.3, 50, 66.7, 75] as const;

const STUDIO_GUIDE_PERCENT_PATTERN = /^[+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/u;

/**
 * Accepts Korean/locale decimal commas, an optional percent sign, and surrounding spacing.
 * Invalid and boundary values fail closed so callers never create off-canvas guides.
 */
export function parseStudioGuidePercent(value: string | number): number | null {
  const raw = typeof value === "number" ? String(value) : value;
  const compact = raw.replace(/[\s\u00a0\u202f]+/gu, "").replace(/%$/u, "");
  if (!STUDIO_GUIDE_PERCENT_PATTERN.test(compact)) return null;

  const percent = Number(compact.replace(",", "."));
  return Number.isFinite(percent) && percent > 0 && percent < 100
    ? percent
    : null;
}

export function studioGuidePercentToPx(
  value: string | number,
  canvasDimension: number,
): number | null {
  const percent = parseStudioGuidePercent(value);
  if (percent === null || !Number.isFinite(canvasDimension) || canvasDimension <= 0) {
    return null;
  }
  const position = canvasDimension * percent / 100;
  return Number.isFinite(position)
    ? Math.round(position * 1_000) / 1_000
    : null;
}
