/**
 * Palette + variant matching shared by every Studio tool hint preview cluster.
 *
 * Extracted from `StudioToolHintPreview.tsx` so the per-cluster preview modules
 * and the dispatcher can both depend on these primitives without a cycle.
 */
export const COLOR = {
  accent: "var(--color-accent, oklch(0.72 0.185 42))",
  accentSoft: "var(--color-accent-soft, oklch(0.72 0.185 42 / 0.14))",
  canvas: "var(--color-canvas, oklch(0.155 0.008 70))",
  card: "var(--color-card, oklch(0.205 0.01 66))",
  cool: "var(--color-cool, oklch(0.8 0.11 232))",
  fg: "var(--color-fg, oklch(0.95 0.01 85))",
  fg2: "var(--color-fg-2, oklch(0.74 0.012 78))",
  fg3: "var(--color-fg-3, oklch(0.57 0.012 76))",
  line: "var(--color-line, oklch(0.305 0.012 64))",
  lineStrong: "var(--color-line-strong, oklch(0.42 0.013 64))",
  raised: "var(--color-raised, oklch(0.245 0.011 64))",
} as const;

export function previewVariantMatches(variant: string, ...candidates: readonly string[]): boolean {
  return candidates.some(
    (candidate) =>
      variant === candidate ||
      variant.endsWith(`:${candidate}`) ||
      variant.endsWith(`-${candidate}`) ||
      variant.endsWith(`/${candidate}`)
  );
}
