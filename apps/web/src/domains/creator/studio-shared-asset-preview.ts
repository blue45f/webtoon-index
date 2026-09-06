export const STUDIO_SHARED_ASSET_PREVIEW_MAX_DIMENSION = 320;
export const STUDIO_SHARED_ASSET_PREVIEW_MAX_BYTES = 128 * 1024;

const PREVIEW_DIMENSION_CAPS = [320, 256, 192, 144, 96, 64, 48, 32] as const;
const PREVIEW_QUALITIES = [0.82, 0.68, 0.54, 0.4] as const;

export interface StudioSharedAssetPreview {
  previewDataUrl: string;
  previewWidth: number;
  previewHeight: number;
}

export interface StudioSharedAssetPreviewRuntime {
  loadImage(dataUrl: string): Promise<{ image: CanvasImageSource; width: number; height: number }>;
  encode(
    image: CanvasImageSource,
    width: number,
    height: number,
    quality: number
  ): string;
}

export function creatorAssetBaseImageDataUrl(dataUrl: string): string {
  const hashIndex = dataUrl.indexOf("#");
  return hashIndex === -1 ? dataUrl : dataUrl.slice(0, hashIndex);
}

export function creatorAssetDataUrlByteLength(dataUrl: string): number | null {
  const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(dataUrl);
  if (!match) return null;
  const encoded = match[1]!;
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return Math.floor(encoded.length * 3 / 4) - padding;
}

export function fitCreatorAssetPreviewDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxDimension: number
): { width: number; height: number } {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth < 1 ||
    sourceHeight < 1
  ) {
    throw new Error("에셋 미리보기의 원본 크기를 확인할 수 없습니다.");
  }
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

const browserPreviewRuntime: StudioSharedAssetPreviewRuntime = {
  loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new globalThis.Image();
      image.onload = () => {
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        resolve({ image, width, height });
      };
      image.onerror = () => reject(new Error("에셋 미리보기 원본을 불러오지 못했습니다."));
      image.src = dataUrl;
    });
  },
  encode(image, width, height, quality) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("에셋 미리보기 캔버스를 준비하지 못했습니다.");
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/webp", quality);
  },
};

/**
 * Build a bounded catalog thumbnail from the raster part of an asset. VRM's re-editable JSON
 * fragment is intentionally excluded from image decoding and remains only on the original.
 */
export async function createStudioSharedAssetPreview(
  dataUrl: string,
  runtime: StudioSharedAssetPreviewRuntime = browserPreviewRuntime
): Promise<StudioSharedAssetPreview> {
  const baseDataUrl = creatorAssetBaseImageDataUrl(dataUrl);
  const loaded = await runtime.loadImage(baseDataUrl);
  for (const maxDimension of PREVIEW_DIMENSION_CAPS) {
    const dimensions = fitCreatorAssetPreviewDimensions(loaded.width, loaded.height, maxDimension);
    for (const quality of PREVIEW_QUALITIES) {
      const previewDataUrl = runtime.encode(loaded.image, dimensions.width, dimensions.height, quality);
      const byteLength = creatorAssetDataUrlByteLength(previewDataUrl);
      if (byteLength !== null && byteLength > 0 && byteLength <= STUDIO_SHARED_ASSET_PREVIEW_MAX_BYTES) {
        return {
          previewDataUrl,
          previewWidth: dimensions.width,
          previewHeight: dimensions.height,
        };
      }
    }
  }
  throw new Error("에셋 미리보기를 128KiB 이하로 줄이지 못했습니다.");
}
