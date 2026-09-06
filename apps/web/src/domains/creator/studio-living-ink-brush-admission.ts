/**
 * Explicit product admission for the page-wide Living Ink surface.
 *
 * Catalogue ids describe an artist-facing preset, not its renderer. In particular, the
 * `watercolor-*` and `sumi-*` packs are backed by airbrush, dry-media, or ink-particle plus their
 * own dynamics. A name match must never replace those presets with the generic Living Ink recipe.
 *
 * Even the exact built-ins stay on the ordinary DrawEl path until the artist opts into physical
 * mode. That keeps one visible element per stroke, preserves the current canvas paper, and makes
 * live/committed geometry follow the same renderer by default.
 */

const STUDIO_LIVING_INK_EXPLICIT_BRUSH_IDS = new Set([
  "watercolor",
  "ink-wash",
  "sumi",
  "sumi-e",
]);

/**
 * Page-wide physical strokes are retired from the ordinary brush toolbar.
 *
 * Their document model hides each source DrawEl and folds every stroke into one full-page PNG.
 * That makes a normal brush gesture pay a full-field settle/readback/encode cost, changes the
 * apparent paper inside the wash, and makes independent strokes behave like one forced group.
 * Existing canonical ImageEls remain renderable as read-only raster layers. Runtime journal replay
 * and physical edit controls stay off as well, so opening a legacy page cannot recreate the same
 * background worker/readback cost merely because a receipt is present.
 */
export const STUDIO_LIVING_INK_NEW_PHYSICAL_STROKES_ENABLED = false;

function normalizedId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Returns a stable opt-in key only when catalogue identity and runtime identity describe the same
 * exact built-in. Extended presets intentionally return null even when their names contain
 * `watercolor`, `ink-wash`, or `sumi`.
 */
export function studioLivingInkExplicitBrushKey(
  brushId: string | null | undefined,
  catalogId: string | null | undefined,
): string | null {
  const runtime = normalizedId(brushId);
  const catalog = normalizedId(catalogId);
  if (!runtime || !STUDIO_LIVING_INK_EXPLICIT_BRUSH_IDS.has(runtime)) return null;
  if (catalog && catalog !== runtime) return null;
  return `${runtime}\u001f${catalog ?? runtime}`;
}

export function studioLivingInkSupportsExplicitBrush(
  brushId: string | null | undefined,
  catalogId: string | null | undefined,
): boolean {
  return studioLivingInkExplicitBrushKey(brushId, catalogId) !== null;
}

export function studioLivingInkAdmitsBrush(input: Readonly<{
  brushId: string | null | undefined;
  catalogId: string | null | undefined;
  physicalModeEnabled: boolean;
}>): boolean {
  return STUDIO_LIVING_INK_NEW_PHYSICAL_STROKES_ENABLED
    && input.physicalModeEnabled
    && studioLivingInkSupportsExplicitBrush(input.brushId, input.catalogId);
}
