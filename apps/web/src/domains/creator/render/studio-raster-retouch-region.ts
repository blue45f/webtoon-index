/**
 * Dirty-region planning shared by destructive raster brushes.
 *
 * Pixel engines use coordinates relative to the supplied RGBA buffer. Keeping this boundary in a
 * small pure module lets browser orchestration read and transfer only the stroke footprint while
 * still encoding the complete output canvas for the existing document/history contract.
 */

export interface StudioRasterRetouchPoint {
  readonly x: number;
  readonly y: number;
}

export interface StudioRasterRetouchRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function finitePositiveInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(1, Math.round(value));
}

/**
 * Returns an image-clamped, end-exclusive rectangle covering every brush footprint.
 *
 * The two-pixel halo covers the engines' floor/ceil, rounded source sampling, and fractional dab
 * centres. A region is deliberately a little conservative: correctness at the region boundary is
 * more important than shaving a handful of pixels, while its area still scales with the stroke
 * instead of the complete page.
 */
export function planStudioRasterRetouchRegion(
  points: readonly StudioRasterRetouchPoint[],
  radiusPx: number,
  imageWidth: number,
  imageHeight: number,
  haloPx = 2,
): StudioRasterRetouchRegion | null {
  const width = finitePositiveInteger(imageWidth);
  const height = finitePositiveInteger(imageHeight);
  if (width === 0 || height === 0 || points.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;

  const radius = Number.isFinite(radiusPx) ? Math.max(0, radiusPx) : 0;
  const halo = Number.isFinite(haloPx) ? Math.max(0, haloPx) : 0;
  const margin = radius + halo;
  const left = Math.max(0, Math.floor(minX - margin));
  const top = Math.max(0, Math.floor(minY - margin));
  const right = Math.min(width, Math.ceil(maxX + margin) + 1);
  const bottom = Math.min(height, Math.ceil(maxY + margin) + 1);
  if (right <= left || bottom <= top) return null;

  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function translateStudioRasterRetouchPoints<T extends StudioRasterRetouchPoint>(
  points: readonly T[],
  region: Pick<StudioRasterRetouchRegion, "x" | "y">,
): T[] {
  return points.map((point) => ({
    ...point,
    x: point.x - region.x,
    y: point.y - region.y,
  }));
}
