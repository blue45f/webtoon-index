import type { StudioGpuViewTransform } from "./studio-webgpu-viewport-contract";

export interface StudioWebGpuViewportSurfaceInput {
  /** Logical document width before editor zoom. */
  readonly documentWidth: number;
  /** Logical document height before editor zoom. */
  readonly documentHeight: number;
  /** CSS pixels per logical document pixel. */
  readonly documentScale: number;
  /** Scroll position in the document's scaled CSS coordinate space. */
  readonly scrollLeft: number;
  readonly scrollTop: number;
  /** Available scroll viewport in CSS pixels. */
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly flipX?: boolean;
}

export interface StudioWebGpuSurfaceBounds {
  /** Position inside the scaled document so the surface remains fixed in the scroll viewport. */
  readonly left: number;
  readonly top: number;
  /** CSS presentation size, never larger than the intersecting scroll viewport. */
  readonly width: number;
  readonly height: number;
}

export interface StudioWebGpuViewportSurfacePlan {
  readonly surface: StudioWebGpuSurfaceBounds;
  readonly transform: Required<StudioGpuViewTransform>;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Plans a viewport-sized presentation surface while preserving document-space ink coordinates.
 *
 * The WebGPU engine projects against the full logical document extent. Therefore its normalized
 * scale is `document CSS extent / surface CSS extent`, and its offset is the negative scroll
 * position expressed in the same normalized coordinate space. This keeps one document pixel at
 * exactly `documentScale` CSS pixels without allocating a full-height presentation texture.
 */
export function planStudioWebGpuViewportSurface(
  input: StudioWebGpuViewportSurfaceInput
): StudioWebGpuViewportSurfacePlan | null {
  if (
    !finitePositive(input.documentWidth)
    || !finitePositive(input.documentHeight)
    || !finitePositive(input.documentScale)
    || !finitePositive(input.viewportWidth)
    || !finitePositive(input.viewportHeight)
  ) {
    return null;
  }

  const documentCssWidth = input.documentWidth * input.documentScale;
  const documentCssHeight = input.documentHeight * input.documentScale;
  if (!finitePositive(documentCssWidth) || !finitePositive(documentCssHeight)) return null;

  const left = clamp(finiteOrZero(input.scrollLeft), 0, documentCssWidth);
  const top = clamp(finiteOrZero(input.scrollTop), 0, documentCssHeight);
  const width = Math.min(input.viewportWidth, documentCssWidth - left);
  const height = Math.min(input.viewportHeight, documentCssHeight - top);
  if (!finitePositive(width) || !finitePositive(height)) return null;

  return {
    surface: { left, top, width, height },
    transform: {
      scaleX: documentCssWidth / width,
      scaleY: documentCssHeight / height,
      offsetX: -left * input.documentWidth / width,
      offsetY: -top * input.documentHeight / height,
      flipX: input.flipX === true,
    },
  };
}
