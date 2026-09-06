import type { CSSProperties } from "react";

export type CvdMode =
  | "none"
  | "protanopia"
  | "deuteranopia"
  | "tritanopia"
  | "grayscale";

export type CvdMatrixMode = Exclude<CvdMode, "none" | "grayscale">;

export const STUDIO_CVD_GRAYSCALE_SATURATION = "0";

/**
 * Viénot/Brettel/Mollon single-matrix dichromat approximations used by the live
 * canvas filter. The optional motion coach intentionally keeps a tiny lazy copy
 * so it cannot pull help UI into the editor startup graph; exact equality is
 * locked by StudioColorBlindPreview.test.ts.
 */
export const STUDIO_CVD_MATRIX: Readonly<Record<CvdMatrixMode, string>> = {
  protanopia:
    "0.10889,0.89111,-0.00000,0,0 0.10889,0.89111,0.00000,0,0 0.00447,-0.00447,1.00000,0,0 0,0,0,1,0",
  deuteranopia:
    "0.29031,0.70969,-0.00000,0,0 0.29031,0.70969,-0.00000,0,0 -0.02197,0.02197,1.00000,0,0 0,0,0,1,0",
  tritanopia:
    "1.00000,0.15236,-0.15236,0,0 0.00000,0.86717,0.13283,0,0 -0.00000,0.86717,0.13283,0,0 0,0,0,1,0",
};

export function studioColorVisionFilterStyle(mode: CvdMode): CSSProperties {
  if (mode === "none") return {};
  return { filter: `url(#cvd-${mode})` };
}
