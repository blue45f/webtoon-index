import { isAnimatedGifDataUrl, isGifFile } from "../studio-gif-element";
import {
  inspectStudioUploadSourceImage,
  selectStudioUploadDecodedPixelLimit,
  STUDIO_UPLOAD_MAX_SOURCE_FILE_BYTES,
} from "../studio-upload-image-safety";

import type { StudioRasterInterchangeFormat, StudioRgbaBitmap } from "../render/studio-raster-interchange";

export const STUDIO_CANVAS_IMAGE_ACCEPT =
  "image/*,.bmp,.dib,.tga,.icb,.vda,.vst,.ppm,.pam,.qoi,.tif,.tiff" as const;
export const STUDIO_CANVAS_OPEN_RASTER_MAX_BYTES = 64 * 1024 * 1024;

const OPEN_RASTER_EXTENSION_FORMAT: Readonly<Record<string, StudioRasterInterchangeFormat>> = Object.freeze({
  bmp: "bmp",
  dib: "bmp",
  tga: "tga",
  icb: "tga",
  vda: "tga",
  vst: "tga",
  ppm: "ppm",
  pam: "pam",
  qoi: "qoi",
  tif: "tiff",
  tiff: "tiff",
});

const OPEN_RASTER_MIME_FORMAT: Readonly<Record<string, StudioRasterInterchangeFormat>> = Object.freeze({
  "image/bmp": "bmp",
  "image/x-ms-bmp": "bmp",
  "image/x-tga": "tga",
  "image/x-targa": "tga",
  "image/x-portable-pixmap": "ppm",
  "image/x-portable-arbitrarymap": "pam",
  "image/qoi": "qoi",
  "image/tiff": "tiff",
  "image/x-tiff": "tiff",
});

export function studioOpenRasterFormatForFile(file: Pick<File, "name" | "type">): StudioRasterInterchangeFormat | null {
  const extension = file.name.toLocaleLowerCase("en-US").split(".").pop() ?? "";
  return OPEN_RASTER_EXTENSION_FORMAT[extension] ?? OPEN_RASTER_MIME_FORMAT[file.type.toLocaleLowerCase("en-US")] ?? null;
}

export function isStudioOpenRasterFile(file: Pick<File, "name" | "type">): boolean {
  return studioOpenRasterFormatForFile(file) !== null;
}

export function studioCanvasDecodedPixelLimit(): number {
  const navigatorWithMemory = globalThis.navigator as Navigator & { deviceMemory?: number };
  return selectStudioUploadDecodedPixelLimit({
    coarsePointer: globalThis.matchMedia?.("(pointer: coarse)").matches ?? false,
    deviceMemoryGb: navigatorWithMemory.deviceMemory,
  });
}

export function assertStudioCanvasDecodedImageSize(
  width: number,
  height: number,
  maximumPixels: number
): void {
  const pixels = width * height;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    !Number.isSafeInteger(pixels) ||
    pixels > maximumPixels
  ) {
    const megapixels = Math.max(1, Math.floor(maximumPixels / 1_000_000));
    throw new Error(`이미지 해상도가 안전 한도(${megapixels}MP)를 초과합니다.`);
  }
}

// data-URL 이미지를 maxDim 이하로 축소해 전송 크기를 제한한다. 디코드 직후 픽셀 예산을 다시
// 확인해, 파일 헤더와 브라우저 디코더 결과가 어긋나도 거대한 캔버스를 만들지 않는다.
export function downscaleImageFile(file: File, maxDim = 1280, quality = 0.85) {
  const maximumPixels = studioCanvasDecodedPixelLimit();
  return new Promise<{ src: string; width: number; height: number }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
    reader.onload = () => {
      const img = new globalThis.Image();
      img.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
      img.onload = () => {
        try {
          assertStudioCanvasDecodedImageSize(img.width, img.height, maximumPixels);
        } catch (error) {
          reject(error);
          return;
        }
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const width = Math.round(img.width * scale);
        const height = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d")?.drawImage(img, 0, 0, width, height);
        resolve({ src: canvas.toDataURL("image/webp", quality), width, height });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function studioRasterBitmapToCanvasDataUrl(
  bitmap: StudioRgbaBitmap,
  maxDim = 1280,
  quality = 0.85
): { src: string; width: number; height: number } {
  const maximumPixels = studioCanvasDecodedPixelLimit();
  assertStudioCanvasDecodedImageSize(bitmap.width, bitmap.height, maximumPixels);
  if (
    !(bitmap.data instanceof Uint8Array) &&
    !(bitmap.data instanceof Uint8ClampedArray)
  ) throw new Error("래스터 픽셀 버퍼 형식이 올바르지 않습니다.");
  if (bitmap.data.byteLength !== bitmap.width * bitmap.height * 4) {
    throw new Error("래스터 픽셀 버퍼 길이가 이미지 크기와 일치하지 않습니다.");
  }
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = bitmap.width;
  sourceCanvas.height = bitmap.height;
  const sourceContext = sourceCanvas.getContext("2d");
  if (!sourceContext) throw new Error("래스터 픽셀을 캔버스로 변환할 수 없습니다.");
  const imageData = sourceContext.createImageData(bitmap.width, bitmap.height);
  imageData.data.set(bitmap.data);
  sourceContext.putImageData(imageData, 0, 0);

  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const outputCanvas = scale === 1 ? sourceCanvas : document.createElement("canvas");
  if (outputCanvas !== sourceCanvas) {
    outputCanvas.width = width;
    outputCanvas.height = height;
    const outputContext = outputCanvas.getContext("2d");
    if (!outputContext) throw new Error("래스터 이미지를 축소할 수 없습니다.");
    outputContext.drawImage(sourceCanvas, 0, 0, width, height);
  }
  const src = outputCanvas.toDataURL("image/webp", quality);
  if (!src.startsWith("data:image/")) throw new Error("래스터 이미지를 WebP로 변환하지 못했습니다.");
  return { src, width, height };
}

async function loadOpenRasterFileForCanvas(
  file: File,
  format: StudioRasterInterchangeFormat
): Promise<{ src: string; width: number; height: number; isAnimatedGif: false }> {
  if (file.size > STUDIO_CANVAS_OPEN_RASTER_MAX_BYTES) {
    throw new Error("BMP/TGA/PPM/PAM/QOI/TIFF 원본은 64MB 이하여야 합니다.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { decodeStudioRasterInterchangeAsync } = await import( "../render/studio-raster-interchange-worker-client");
  const decoded = await decodeStudioRasterInterchangeAsync(
    bytes,
    format,
    { executionMode: "worker" },
  );
  const converted = studioRasterBitmapToCanvasDataUrl(decoded.decoded.bitmap);
  return { ...converted, isAnimatedGif: false };
}

// GIF 파일 전용 읽기 — downscaleImageFile과 달리 캔버스에 그려 재인코딩하지 않는다(애니메이션
// GIF를 캔버스에 한 번 그리면 그 순간의 프레임 하나만 캡처되어 애니메이션이 사라진다).
export function readGifFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("GIF 파일을 읽지 못했습니다."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

// 이미지 업로드 통합 진입점 — GIF가 아니면 기존 downscaleImageFile 그대로, GIF인데 정적(GCE
// 없음)이어도 손실이 없으므로 마찬가지로 downscaleImageFile(용량 최적화 혜택을 그대로 받는다).
// 진짜 애니메이션 GIF일 때만 캔버스 왕복 없이 원본 바이트를 그대로 보존한다. onPickImage가
// 우선 사용한다.
export async function loadImageFileForCanvas(
  file: File
): Promise<{ src: string; width: number; height: number; isAnimatedGif: boolean }> {
  const maximumPixels = studioCanvasDecodedPixelLimit();
  if (!Number.isSafeInteger(file.size) || file.size < 1) {
    throw new Error("이미지 파일이 비어 있거나 크기를 확인할 수 없습니다.");
  }
  const openRasterFormat = studioOpenRasterFormatForFile(file);
  if (openRasterFormat) return loadOpenRasterFileForCanvas(file, openRasterFormat);
  if (file.size > STUDIO_UPLOAD_MAX_SOURCE_FILE_BYTES) {
    throw new Error("이미지 원본이 12MB를 초과합니다. 먼저 크기를 줄여 주세요.");
  }
  if (!isGifFile(file)) {
    await inspectStudioUploadSourceImage(file, maximumPixels);
    const r = await downscaleImageFile(file);
    return { ...r, isAnimatedGif: false };
  }
  const rawDataUrl = await readGifFileAsDataUrl(file);
  if (!isAnimatedGifDataUrl(rawDataUrl)) {
    // 정적 GIF(애니메이션 없음) — 잃을 게 없으므로 기존 최적화 경로로 되돌아간다.
    const r = await downscaleImageFile(file);
    return { ...r, isAnimatedGif: false };
  }
  // 진짜 애니메이션 GIF — 원본 바이트를 그대로 src로 사용(재생 보존이 용량 최적화보다 우선).
  const { naturalWidth, naturalHeight } = await new Promise<{ naturalWidth: number; naturalHeight: number }>(
    (resolve, reject) => {
      const img = new globalThis.Image();
      img.onload = () =>
        resolve({ naturalWidth: img.naturalWidth || img.width, naturalHeight: img.naturalHeight || img.height });
      img.onerror = () => reject(new Error("GIF 크기를 확인하지 못했습니다."));
      img.src = rawDataUrl;
    }
  );
  assertStudioCanvasDecodedImageSize(naturalWidth, naturalHeight, maximumPixels);
  return { src: rawDataUrl, width: naturalWidth, height: naturalHeight, isAnimatedGif: true };
}

export function downscaleDataUrl(dataUrl: string, maxW: number, quality = 0.72) {
  return new Promise<string>((resolve) => {
    const img = new globalThis.Image();
    img.onerror = () => resolve(dataUrl);
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/webp", quality));
    };
    img.src = dataUrl;
  });
}

// 픽셀 선택 편집용 오프스크린 캔버스 팩토리 — studio-selection-tools 의 SelectionCanvasFactory
// 구조에 맞는 실제 DOM 캔버스를 만든다(2D 컨텍스트를 못 얻으면 null → 코어가 중단 신호로 처리).
export function createPixelEditCanvas(
  width: number,
  height: number
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d");
  return ctx ? { canvas, ctx } : null;
}

// 픽셀 편집용 원본 이미지 로드 — data: URL 이 아니면 CORS 를 요청해 캔버스 오염(taint)으로
// toDataURL 이 막히는 것을 피한다(업로드/에셋은 대부분 data: 라 영향 없음).
export function loadPixelEditImage(src: string, abort?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new globalThis.Image();
    let settled = false;
    const cleanup = () => abort?.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      img.src = "";
      reject(new DOMException("이미지 픽셀 처리를 취소했습니다.", "AbortError"));
    };
    if (!src.startsWith("data:")) img.crossOrigin = "anonymous";
    img.onload = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(img);
    };
    img.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("이미지 원본을 불러오지 못했습니다."));
    };
    abort?.addEventListener("abort", onAbort, { once: true });
    if (abort?.aborted) {
      onAbort();
      return;
    }
    img.src = src;
  });
}
