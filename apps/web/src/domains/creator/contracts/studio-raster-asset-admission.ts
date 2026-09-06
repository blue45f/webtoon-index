/**
 * Tiny fail-closed feature gate shared by browser and API code. It is isolated
 * from the validation schema so checking the gate never pulls the raster CRDT
 * engine into the Studio startup bundle.
 */
export const STUDIO_RASTER_ASSET_ADMISSION_OPT_IN_TOKEN =
  "verified-renderer-handoff-v1" as const;

export function isStudioRasterAssetAdmissionOptedIn(value: unknown): boolean {
  return value === STUDIO_RASTER_ASSET_ADMISSION_OPT_IN_TOKEN;
}
