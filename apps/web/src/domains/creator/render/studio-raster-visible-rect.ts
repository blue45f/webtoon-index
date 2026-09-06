import type { StudioWebGpuViewportSurfacePlan } from "./studio-webgpu-viewport";
import type { StudioRasterReplayTileFilterInput } from "../live/studio-crdt-raster-replay-runtime";
import type {
  StudioRasterOperation,
  StudioRasterSurfaceSpec,
} from "@/shared/lib/studio-crdt-raster-ops";

export interface StudioRasterVisibleDocumentRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function studioRasterVisibleDocumentRectFromViewport(input: {
  readonly viewport: StudioWebGpuViewportSurfacePlan | null;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly documentScale: number;
}): StudioRasterVisibleDocumentRect | null {
  const { viewport, documentWidth, documentHeight, documentScale } = input;
  if (
    !viewport || !Number.isFinite(documentWidth) || documentWidth <= 0 ||
    !Number.isFinite(documentHeight) || documentHeight <= 0 ||
    !Number.isFinite(documentScale) || documentScale <= 0
  ) {
    return null;
  }
  const width = Math.min(documentWidth, viewport.surface.width / documentScale);
  const height = Math.min(documentHeight, viewport.surface.height / documentScale);
  const unflippedX = viewport.surface.left / documentScale;
  const x = viewport.transform.flipX
    ? documentWidth - unflippedX - width
    : unflippedX;
  return {
    x: Math.max(0, Math.min(documentWidth - width, x)),
    y: Math.max(0, Math.min(documentHeight - height, viewport.surface.top / documentScale)),
    width,
    height,
  };
}

export function studioRasterTileIntersectsDocumentRect(
  tile: StudioRasterReplayTileFilterInput,
  rect: StudioRasterVisibleDocumentRect,
  tileSize: number
): boolean {
  if (
    !Number.isFinite(rect.x) || !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) || !Number.isFinite(rect.height) ||
    rect.width <= 0 || rect.height <= 0
  ) return false;
  if (!Number.isSafeInteger(tileSize) || tileSize <= 0) return false;
  // Edge tiles can be narrower than the canonical tile grid. Their origin still advances by
  // surface.tileSize, not by the edge tile's decoded width/height.
  const tileLeft = tile.tileX * tileSize;
  const tileTop = tile.tileY * tileSize;
  return tileLeft < rect.x + rect.width &&
    tileTop < rect.y + rect.height &&
    tileLeft + tile.width > rect.x &&
    tileTop + tile.height > rect.y;
}

/**
 * Selects only operations whose immutable tile patches can contribute pixels to the current
 * viewport. The raster replay runtime intentionally projects away off-screen composite patches;
 * the handoff verifier must use the same visible subset instead of requiring every page operation
 * to appear in a viewport-sized replay result.
 */
export function studioRasterOperationIntersectsDocumentRect(
  operation: Pick<StudioRasterOperation, "patches">,
  surface: Pick<StudioRasterSurfaceSpec, "surfaceId" | "width" | "height" | "tileSize">,
  rect: StudioRasterVisibleDocumentRect
): boolean {
  if (
    !Number.isFinite(surface.width) || surface.width <= 0 ||
    !Number.isFinite(surface.height) || surface.height <= 0 ||
    !Number.isSafeInteger(surface.tileSize) || surface.tileSize <= 0
  ) {
    return false;
  }
  return operation.patches.some((patch) => {
    if (
      !Number.isSafeInteger(patch.tileX) || patch.tileX < 0 ||
      !Number.isSafeInteger(patch.tileY) || patch.tileY < 0
    ) {
      return false;
    }
    const tileLeft = patch.tileX * surface.tileSize;
    const tileTop = patch.tileY * surface.tileSize;
    const width = Math.min(surface.tileSize, surface.width - tileLeft);
    const height = Math.min(surface.tileSize, surface.height - tileTop);
    if (width <= 0 || height <= 0) return false;
    return studioRasterTileIntersectsDocumentRect({
      surfaceId: surface.surfaceId,
      tileX: patch.tileX,
      tileY: patch.tileY,
      width,
      height,
    }, rect, surface.tileSize);
  });
}
