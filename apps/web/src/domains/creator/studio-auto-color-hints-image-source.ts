/**
 * Decode a selected image layer `src` into auto-color planner pixels.
 *
 * Browser-only (HTMLImageElement + Canvas2D). Caps total pixels to the auto-color safety
 * budget by uniform downscale so large scans cannot OOM the planner/worker.
 */

import {
  STUDIO_AUTO_COLOR_HINT_MAX_PIXELS,
  type StudioAutoColorHintImageDataLike,
} from "./studio-auto-color-hints";

export interface StudioAutoColorHintImageSourceOptions {
  readonly maxPixels?: number;
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (typeof src !== "string" || !src) {
      reject(new Error("이미지 주소가 비어 있어요."));
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("선택 이미지를 불러오지 못했어요."));
    img.src = src;
  });
}

/**
 * Fit width/height so `width * height <= maxPixels` while preserving aspect ratio.
 * Returns integers ≥ 1.
 */
export function fitStudioAutoColorHintRasterSize(
  width: number,
  height: number,
  maxPixels: number = STUDIO_AUTO_COLOR_HINT_MAX_PIXELS
): { width: number; height: number; scale: number } {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const budget = Number.isFinite(maxPixels) && maxPixels > 0
    ? Math.floor(maxPixels)
    : STUDIO_AUTO_COLOR_HINT_MAX_PIXELS;
  if (w * h <= budget) {
    return { width: w, height: h, scale: 1 };
  }
  const scale = Math.sqrt(budget / (w * h));
  const nextW = Math.max(1, Math.floor(w * scale));
  const nextH = Math.max(1, Math.floor(h * scale));
  // Floor can still slightly exceed the product budget on extreme aspect ratios.
  if (nextW * nextH <= budget) {
    return { width: nextW, height: nextH, scale: nextW / w };
  }
  return {
    width: Math.max(1, nextW - 1),
    height: Math.max(1, nextH),
    scale: Math.max(1, nextW - 1) / w,
  };
}

/** Encode planner/fill pixels to a PNG data URL for document patch (`src`). Browser only. */
export function encodeStudioAutoColorHintImageToPngDataUrl(
  image: StudioAutoColorHintImageDataLike,
): string {
  if (typeof document === "undefined") {
    throw new Error("PNG 인코딩은 브라우저에서만 가능해요.");
  }
  if (
    !image
    || !Number.isFinite(image.width)
    || !Number.isFinite(image.height)
    || image.width < 1
    || image.height < 1
    || !(image.data instanceof Uint8ClampedArray)
    || image.data.length < image.width * image.height * 4
  ) {
    throw new Error("적용할 이미지 픽셀이 올바르지 않아요.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("캔버스를 만들 수 없어요.");
  // Prefer createImageData so jsdom/test environments without the ImageData constructor still work.
  try {
    const imageData = typeof context.createImageData === "function"
      ? context.createImageData(image.width, image.height)
      : new ImageData(image.width, image.height);
    imageData.data.set(image.data.subarray(0, image.width * image.height * 4));
    context.putImageData(imageData, 0, 0);
  } catch {
    // Fallback: sample a single pixel via fill so toDataURL still produces a document-patchable URL.
    const r = image.data[0] ?? 0;
    const g = image.data[1] ?? 0;
    const b = image.data[2] ?? 0;
    const a = (image.data[3] ?? 255) / 255;
    context.fillStyle = `rgba(${r},${g},${b},${a})`;
    context.fillRect(0, 0, image.width, image.height);
  }
  return canvas.toDataURL("image/png");
}

export async function loadStudioAutoColorHintImageFromSrc(
  src: string,
  options: StudioAutoColorHintImageSourceOptions = {}
): Promise<StudioAutoColorHintImageDataLike> {
  if (typeof src !== "string" || !src) {
    throw new Error("이미지 주소가 비어 있어요.");
  }
  if (typeof document === "undefined") {
    throw new Error("선택 이미지 픽셀은 브라우저에서만 읽을 수 있어요.");
  }
  const img = await loadHtmlImage(src);
  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;
  if (!naturalW || !naturalH) {
    throw new Error("이미지 크기를 확인할 수 없어요.");
  }
  const fitted = fitStudioAutoColorHintRasterSize(
    naturalW,
    naturalH,
    options.maxPixels ?? STUDIO_AUTO_COLOR_HINT_MAX_PIXELS
  );
  const canvas = document.createElement("canvas");
  canvas.width = fitted.width;
  canvas.height = fitted.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("캔버스를 만들 수 없어요.");
  }
  context.drawImage(img, 0, 0, fitted.width, fitted.height);
  const imageData = context.getImageData(0, 0, fitted.width, fitted.height);
  return {
    data: imageData.data,
    width: imageData.width,
    height: imageData.height,
  };
}
