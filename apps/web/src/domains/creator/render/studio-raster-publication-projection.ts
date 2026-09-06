/**
 * Disabled automatic raster publication is the production default. Keep its render path allocation
 * free: projecting every scene element and serializing an authority base key are only useful when
 * the verified raster handoff surface can actually mount.
 */

const EMPTY_STUDIO_RASTER_OVERLAY_ELEMENTS: readonly never[] = Object.freeze([]);

export const DISABLED_STUDIO_RASTER_HANDOFF_BASE_KEY = "";

export function projectStudioRasterOverlayElements<TElement>(input: {
  readonly enabled: boolean;
  readonly project: () => readonly TElement[];
}): readonly TElement[] {
  if (!input.enabled) return EMPTY_STUDIO_RASTER_OVERLAY_ELEMENTS;
  return input.project();
}

export function resolveStudioRasterHandoffProjection<TVisibleDocumentRect>(input: {
  readonly enabled: boolean;
  readonly projectVisibleDocumentRect: () => TVisibleDocumentRect | null;
  readonly createHandoffBaseKey: () => string;
}): {
  readonly visibleDocumentRect: TVisibleDocumentRect | null;
  readonly handoffBaseKey: string;
} {
  if (!input.enabled) {
    return {
      visibleDocumentRect: null,
      handoffBaseKey: DISABLED_STUDIO_RASTER_HANDOFF_BASE_KEY,
    };
  }
  return {
    visibleDocumentRect: input.projectVisibleDocumentRect(),
    handoffBaseKey: input.createHandoffBaseKey(),
  };
}
