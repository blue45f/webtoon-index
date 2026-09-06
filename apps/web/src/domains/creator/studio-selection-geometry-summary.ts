/**
 * Selection geometry — the folded 변형 row's readout (pure).
 *
 * `StudioFigmaDesignPanel` shows this one line while its numeric grid is closed
 * (UX 감사 2026-09-02 §5.7): `X 120 · Y 840 · 640×320 · 0°`. Kept out of the
 * component file so the panel keeps fast refresh and the format is unit-testable.
 */

import type { StudioFigmaSelectionLayoutMetrics } from "./studio-figma-selection-ux";

/** Density-table id of the folded geometry grid — also the search/menu deep-link target. */
export const STUDIO_SELECTION_GEOMETRY_SECTION_ID = "selection.geometry";

const round = (value: number): string =>
  String(Math.round(Number.isFinite(value) ? value : 0));

/** One-line readout for the folded grid. Multi-selections report count and shared position. */
export function studioSelectionGeometrySummary(
  metrics: StudioFigmaSelectionLayoutMetrics,
): string {
  const position = `X ${round(metrics.x)} · Y ${round(metrics.y)}`;
  if (metrics.elementCount > 1) return `${metrics.elementCount}개 · ${position}`;
  const size = `${round(metrics.width)}×${round(metrics.height)}`;
  // A stroke's rotation is relative ("turn it this much more"), so there is no angle to report.
  const rotation = metrics.supportsRotation && !metrics.rotationIsRelative
    ? ` · ${round(metrics.rotation)}°`
    : "";
  return `${position} · ${size}${rotation}`;
}
