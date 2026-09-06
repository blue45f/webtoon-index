/**
 * Surviving draft of the export menu's print geometry.
 *
 * The export options panel is rendered through a conditional portal, so it **unmounts every
 * time the menu closes**. Keeping DPI/trim/bleed in component state alone means an author who
 * picks "인쇄 A4 300", closes the menu to download, and reopens it finds the geometry silently
 * back at 72 DPI / no trim — measured in a real browser, not hypothetical. Worse, the
 * resolution published to the encoders follows that reset, so a reopened menu would retag the
 * next export at 72 DPI.
 *
 * This module keeps the last geometry the author actually chose so the next mount resumes it.
 * It is intentionally module-scoped (single editor, single document at a time) and is only
 * written from the panel's own state effect.
 */
import type { StudioExportGeometryPresetId } from "./studio-export-package-preflight";

export interface StudioExportGeometryDraft {
  readonly dpi: number;
  readonly trimWidthMm: number | null;
  readonly trimHeightMm: number | null;
  readonly bleedMm: number | null;
  readonly presetId: StudioExportGeometryPresetId | null;
}

let draft: StudioExportGeometryDraft | null = null;

export function readStudioExportGeometryDraft(): StudioExportGeometryDraft | null {
  return draft;
}

export function writeStudioExportGeometryDraft(next: StudioExportGeometryDraft): void {
  draft = next;
}

/** Test-only reset so one case's geometry cannot leak into the next. */
export function resetStudioExportGeometryDraft(): void {
  draft = null;
}
