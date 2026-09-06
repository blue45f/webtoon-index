import { STUDIO_BRUSH_DYNAMICS_VARIANTS_MEDIA } from "./studio-brush-dynamics-variants-media";
import { STUDIO_BRUSH_DYNAMICS_VARIANTS_TOOLBAR } from "./studio-brush-dynamics-variants-toolbar";
import { STUDIO_BRUSH_DYNAMICS_VARIANTS_WEB } from "./studio-brush-dynamics-variants-web";

import type {
  StudioBrushDynamicsPresetId,
  StudioBrushDynamicsSettings,
} from "./studio-brush-dynamics";

export interface StudioBrushDynamicsVariant {
  presetId: StudioBrushDynamicsPresetId;
  overrides: StudioBrushDynamicsSettings;
}

/**
 * Physical variants for toolbar brush ids that share a persisted canonical dynamics preset.
 *
 * Saved strokes keep their existing `brush` id and canonical preset ids remain unchanged. Runtime
 * consumers can opt into this helper to make each commercial alias visibly distinct without a
 * document migration. Every call normalizes into a detached value, so UI edits cannot mutate the
 * variant catalogue or the canonical preset.
 */
export const STUDIO_BRUSH_DYNAMICS_VARIANTS: Readonly<Record<string, StudioBrushDynamicsVariant>> = {
  ...STUDIO_BRUSH_DYNAMICS_VARIANTS_TOOLBAR,
  ...STUDIO_BRUSH_DYNAMICS_VARIANTS_WEB,
  ...STUDIO_BRUSH_DYNAMICS_VARIANTS_MEDIA,
};
