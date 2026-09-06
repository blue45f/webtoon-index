import { createCanvasImageElement } from "./studio-image-placement";

/** Lightweight placement contract: no image/catalog import in the editor shell. */
export function studio2dSourceSize(source: { readonly width?: number; readonly height?: number }): { width: number; height: number } {
  const { width, height } = source;
  if (typeof width === "number" && typeof height === "number"
    && Number.isInteger(width) && Number.isInteger(height)
    && width > 0 && height > 0 && width <= 8192 && height <= 8192
    && width * height <= 36_000_000) return { width, height };
  // Existing vectors and third-party legacy scene packs retain their 720x1080 contract.
  return { width: 720, height: 1080 };
}

/** Shared by the production editor and browser tests, preserving the existing placement policy. */
export function createStudio2dCanvasImage(
  source: { readonly width?: number; readonly height?: number },
  input: { id: string; src: string; canvasWidth: number; canvasHeight: number },
) {
  const size = studio2dSourceSize(source);
  return createCanvasImageElement({
    ...input,
    sourceWidth: size.width,
    sourceHeight: size.height,
    horizontalInset: 0,
    minY: 0,
  });
}
