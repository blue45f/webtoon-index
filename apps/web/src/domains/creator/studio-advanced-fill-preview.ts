import type { AdvancedFillDiagnostics } from "./studio-advanced-fill";
import type { StudioAdvancedFillVirtualTarget } from "./studio-vector-fill-reference";

export type StudioAdvancedFillPreview = {
  targetId: string;
  originalSrc: string;
  historyIndex: number;
  resultSrc: string;
  diagnostics: AdvancedFillDiagnostics;
  message: string;
  paintedPixelCount: number;
  regionCount: number;
  /** Preview-only full-page raster synthesized from visible DrawEl line art. */
  virtualTarget?: StudioAdvancedFillVirtualTarget;
};
