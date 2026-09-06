/**
 * Renderer-neutral size contract shared by BG3D model loading and cross-editor handoffs.
 *
 * Imported models are normalized so their largest local-space dimension becomes two world units.
 * A producer that needs to preserve authored dimensions must divide its persisted instance scale by
 * this factor; the loader normalization and instance compensation then cancel exactly.
 */

export const STUDIO_BG3D_AUTO_FIT_TARGET_SIZE = 2;

export function computeStudioBg3dAutoFitScale(
  boundingSize: readonly [number, number, number],
  targetSize: number = STUDIO_BG3D_AUTO_FIT_TARGET_SIZE,
): number {
  const maxDimension = Math.max(...boundingSize.map((value) => Math.abs(value)));
  if (
    !Number.isFinite(maxDimension) || maxDimension <= 0 ||
    !Number.isFinite(targetSize) || targetSize <= 0
  ) return 1;
  return targetSize / maxDimension;
}
