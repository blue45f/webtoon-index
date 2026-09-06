import type { StudioBg3dBackgroundSettings } from "./studio-bg3d-scene-document";

export const STUDIO_BG3D_FOG_MIN_GAP = 0.25;

export const STUDIO_BG3D_FOG_PRESETS = [
  { id: "air", label: "공기감", near: 18, far: 80 },
  { id: "depth", label: "거리감", near: 8, far: 40 },
  { id: "mist", label: "짙게", near: 2, far: 22 },
] as const;

export interface StudioBg3dResolvedFog {
  readonly color: string;
  readonly near: number;
  readonly far: number;
}

/**
 * Converts a persistence-safe background into the exact Three/R3F fog contract.
 * The document normalizer already bounds the values, but this renderer boundary
 * remains fail-closed when called with an older or manually constructed document.
 */
export function resolveStudioBg3dSceneFog(
  background: StudioBg3dBackgroundSettings,
): StudioBg3dResolvedFog | null {
  if (!background.fogEnabled) return null;
  const near = Number.isFinite(background.fogNear) ? Math.max(0, background.fogNear ?? 10) : 10;
  const farCandidate = Number.isFinite(background.fogFar) ? Math.max(0, background.fogFar ?? 50) : 50;
  return {
    color: background.fogColor ?? background.color,
    near,
    far: Math.max(near + STUDIO_BG3D_FOG_MIN_GAP, farCandidate),
  };
}
