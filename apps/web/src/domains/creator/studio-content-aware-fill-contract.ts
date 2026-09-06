/**
 * Tiny shared contract for Content-Aware Fill controls.
 *
 * Keep these values separate from the pixel engine so validators and UI controls do not pull the
 * optional fill implementation into Studio startup.
 */
export const CONTENT_AWARE_FILL_TILE_PX_RANGE = {
  min: 8,
  max: 16,
  step: 1,
} as const;

export const CONTENT_AWARE_FILL_TILE_PX_DEFAULT = 12;
