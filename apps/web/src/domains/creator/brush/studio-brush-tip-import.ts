import { encodeStudioBrushTipAlphaMapBase64 } from "./studio-brush-tip-stamp";

export const STUDIO_BRUSH_TIP_IMPORT_LIMITS = {
  maxBytes: 4 * 1024 * 1024,
  maxSourceDimension: 4096,
  maxSourcePixels: 16 * 1024 * 1024,
  minOutputSize: 8,
  maxOutputSize: 64,
} as const;

export type StudioBrushTipImportErrorCode =
  | "empty"
  | "type"
  | "size"
  | "signature"
  | "dimensions"
  | "decode"
  | "canvas"
  | "blank";

const ERROR_MESSAGES: Record<StudioBrushTipImportErrorCode, string> = {
  empty: "PNG 파일이 비어 있습니다. 다른 펜촉 이미지를 선택해 주세요.",
  type: "PNG 파일만 가져올 수 있습니다. 파일 형식을 PNG로 저장한 뒤 다시 시도해 주세요.",
  size: "펜촉 PNG는 4MB 이하여야 합니다. 이미지를 줄인 뒤 다시 시도해 주세요.",
  signature: "올바른 PNG 파일을 읽지 못했습니다. 손상되지 않은 PNG를 선택해 주세요.",
  dimensions: "펜촉 PNG는 가로·세로 1~4,096px, 총 1,600만 픽셀 이하여야 합니다.",
  decode: "PNG 이미지를 해석하지 못했습니다. 다른 앱에서 다시 저장한 뒤 시도해 주세요.",
  canvas: "이 브라우저에서는 펜촉 이미지를 변환할 수 없습니다. 최신 브라우저에서 다시 시도해 주세요.",
  blank: "펜촉 모양을 찾지 못했습니다. 투명 배경 또는 대비가 뚜렷한 흑백 PNG를 사용해 주세요.",
};

export class StudioBrushTipImportError extends Error {
  readonly code: StudioBrushTipImportErrorCode;

  constructor(code: StudioBrushTipImportErrorCode, options?: ErrorOptions) {
    super(ERROR_MESSAGES[code], options);
    this.name = "StudioBrushTipImportError";
    this.code = code;
  }
}

export interface StudioBrushTipPngHeader {
  width: number;
  height: number;
}

export interface StudioBrushTipPixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StudioBrushTipDecodedPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  /** The drawn source bounds. Pixels outside this rect are transparent letterboxing. */
  contentRect?: StudioBrushTipPixelRect;
}

export type StudioBrushTipMaskSource = "alpha" | "grayscale-dark" | "grayscale-light";

export interface StudioBrushTipAlphaMask {
  bytes: Uint8Array;
  size: number;
  source: StudioBrushTipMaskSource;
}

export interface ImportedStudioBrushTip {
  alphaMapBase64: string;
  alphaMapSize: number;
  sourceWidth: number;
  sourceHeight: number;
  source: StudioBrushTipMaskSource;
}

interface StudioBrushTipImportOptions {
  decode?: (
    file: File,
    header: StudioBrushTipPngHeader,
    outputSize: number
  ) => Promise<StudioBrushTipDecodedPixels>;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeContentRect(
  pixels: StudioBrushTipDecodedPixels
): StudioBrushTipPixelRect {
  const source = pixels.contentRect ?? {
    x: 0,
    y: 0,
    width: pixels.width,
    height: pixels.height,
  };
  const x = Math.trunc(clamp(source.x, 0, Math.max(0, pixels.width - 1)));
  const y = Math.trunc(clamp(source.y, 0, Math.max(0, pixels.height - 1)));
  const width = Math.trunc(clamp(source.width, 1, pixels.width - x));
  const height = Math.trunc(clamp(source.height, 1, pixels.height - y));
  return { x, y, width, height };
}

function luminance(red: number, green: number, blue: number): number {
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function validateDecodedPixels(pixels: StudioBrushTipDecodedPixels): void {
  if (
    !Number.isInteger(pixels.width)
    || !Number.isInteger(pixels.height)
    || pixels.width < 1
    || pixels.height < 1
    || pixels.width !== pixels.height
    || pixels.width > STUDIO_BRUSH_TIP_IMPORT_LIMITS.maxOutputSize
    || pixels.data.length !== pixels.width * pixels.height * 4
  ) {
    throw new StudioBrushTipImportError("decode");
  }
}

/** Parse and validate the PNG signature and IHDR dimensions before browser decoding. */
export function parseStudioBrushTipPngHeader(bytes: Uint8Array): StudioBrushTipPngHeader {
  if (bytes.length < 24) throw new StudioBrushTipImportError("signature");
  for (let index = 0; index < PNG_SIGNATURE.length; index++) {
    if (bytes[index] !== PNG_SIGNATURE[index]) throw new StudioBrushTipImportError("signature");
  }
  if (String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!) !== "IHDR") {
    throw new StudioBrushTipImportError("signature");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (
    width < 1
    || height < 1
    || width > STUDIO_BRUSH_TIP_IMPORT_LIMITS.maxSourceDimension
    || height > STUDIO_BRUSH_TIP_IMPORT_LIMITS.maxSourceDimension
    || width * height > STUDIO_BRUSH_TIP_IMPORT_LIMITS.maxSourcePixels
  ) {
    throw new StudioBrushTipImportError("dimensions");
  }
  return { width, height };
}

/**
 * Convert square RGBA pixels to the compact alpha bytes used by the brush engine.
 * Transparent PNGs preserve their alpha. Fully opaque images are treated as grayscale
 * masks, with centre-vs-edge luminance selecting dark-on-light or light-on-dark polarity.
 */
export function buildStudioBrushTipAlphaMask(
  pixels: StudioBrushTipDecodedPixels
): StudioBrushTipAlphaMask {
  validateDecodedPixels(pixels);
  const content = normalizeContentRect(pixels);
  let hasTransparency = false;
  let centreTotal = 0;
  let centreCount = 0;
  let edgeTotal = 0;
  let edgeCount = 0;
  let minimumLuminance = 255;
  let maximumLuminance = 0;
  const centreX = content.x + (content.width - 1) / 2;
  const centreY = content.y + (content.height - 1) / 2;

  for (let y = content.y; y < content.y + content.height; y++) {
    for (let x = content.x; x < content.x + content.width; x++) {
      const offset = (y * pixels.width + x) * 4;
      const alpha = pixels.data[offset + 3]!;
      if (alpha < 250) hasTransparency = true;
      const value = luminance(
        pixels.data[offset]!,
        pixels.data[offset + 1]!,
        pixels.data[offset + 2]!
      );
      minimumLuminance = Math.min(minimumLuminance, value);
      maximumLuminance = Math.max(maximumLuminance, value);
      const nx = Math.abs(x - centreX) / Math.max(1, content.width / 2);
      const ny = Math.abs(y - centreY) / Math.max(1, content.height / 2);
      if (nx <= 0.32 && ny <= 0.32) {
        centreTotal += value;
        centreCount++;
      }
      if (nx >= 0.72 || ny >= 0.72) {
        edgeTotal += value;
        edgeCount++;
      }
    }
  }

  const centreLuminance = centreTotal / Math.max(1, centreCount);
  const edgeLuminance = edgeTotal / Math.max(1, edgeCount);
  if (!hasTransparency && maximumLuminance - minimumLuminance < 8) {
    throw new StudioBrushTipImportError("blank");
  }
  const source: StudioBrushTipMaskSource = hasTransparency
    ? "alpha"
    : centreLuminance + 4 < edgeLuminance
      ? "grayscale-dark"
      : centreLuminance > edgeLuminance + 4
        ? "grayscale-light"
        // A valid but off-centre mark can leave both sampled regions similar. In that
        // ambiguous case, treat the edge as the background and derive polarity from it.
        : edgeLuminance >= 128
          ? "grayscale-dark"
          : "grayscale-light";
  const bytes = new Uint8Array(pixels.width * pixels.height);
  let visibleTotal = 0;
  let visibleMaximum = 0;

  for (let y = content.y; y < content.y + content.height; y++) {
    for (let x = content.x; x < content.x + content.width; x++) {
      const sourceOffset = (y * pixels.width + x) * 4;
      const targetOffset = y * pixels.width + x;
      const value = source === "alpha"
        ? pixels.data[sourceOffset + 3]!
        : Math.round(source === "grayscale-dark"
          ? 255 - luminance(
              pixels.data[sourceOffset]!,
              pixels.data[sourceOffset + 1]!,
              pixels.data[sourceOffset + 2]!
            )
          : luminance(
              pixels.data[sourceOffset]!,
              pixels.data[sourceOffset + 1]!,
              pixels.data[sourceOffset + 2]!
            ));
      bytes[targetOffset] = value;
      visibleTotal += value;
      visibleMaximum = Math.max(visibleMaximum, value);
    }
  }

  if (visibleMaximum < 12 || visibleTotal < 48) {
    throw new StudioBrushTipImportError("blank");
  }
  return { bytes, size: pixels.width, source };
}

function outputSizeFor(header: StudioBrushTipPngHeader): number {
  return Math.trunc(clamp(
    Math.max(header.width, header.height),
    STUDIO_BRUSH_TIP_IMPORT_LIMITS.minOutputSize,
    STUDIO_BRUSH_TIP_IMPORT_LIMITS.maxOutputSize
  ));
}

function targetRectFor(
  header: StudioBrushTipPngHeader,
  outputSize: number
): StudioBrushTipPixelRect {
  const scale = outputSize / Math.max(header.width, header.height);
  const width = Math.max(1, Math.round(header.width * scale));
  const height = Math.max(1, Math.round(header.height * scale));
  return {
    x: Math.floor((outputSize - width) / 2),
    y: Math.floor((outputSize - height) / 2),
    width,
    height,
  };
}

async function loadImageElement(file: File): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new StudioBrushTipImportError("decode"));
      image.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function decodeStudioBrushTipInBrowser(
  file: File,
  header: StudioBrushTipPngHeader,
  outputSize: number
): Promise<StudioBrushTipDecodedPixels> {
  if (typeof document === "undefined") throw new StudioBrushTipImportError("canvas");
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new StudioBrushTipImportError("canvas");
  const contentRect = targetRectFor(header, outputSize);
  context.clearRect(0, 0, outputSize, outputSize);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  let source: ImageBitmap | HTMLImageElement | null = null;
  try {
    source = typeof createImageBitmap === "function"
      ? await createImageBitmap(file)
      : await loadImageElement(file);
    if (source.width !== header.width || source.height !== header.height) {
      throw new StudioBrushTipImportError("decode");
    }
    context.drawImage(
      source,
      contentRect.x,
      contentRect.y,
      contentRect.width,
      contentRect.height
    );
    const imageData = context.getImageData(0, 0, outputSize, outputSize);
    return {
      width: outputSize,
      height: outputSize,
      data: imageData.data,
      contentRect,
    };
  } catch (error) {
    if (error instanceof StudioBrushTipImportError) throw error;
    throw new StudioBrushTipImportError("decode", { cause: error });
  } finally {
    if (source && "close" in source && typeof source.close === "function") source.close();
  }
}

/** Validate, decode and compact one PNG File into the existing in-document alpha-map format. */
export async function importStudioBrushTipPng(
  file: File,
  options: StudioBrushTipImportOptions = {}
): Promise<ImportedStudioBrushTip> {
  if (file.size < 1) throw new StudioBrushTipImportError("empty");
  if (file.size > STUDIO_BRUSH_TIP_IMPORT_LIMITS.maxBytes) {
    throw new StudioBrushTipImportError("size");
  }
  if (file.type && file.type.toLowerCase() !== "image/png") {
    throw new StudioBrushTipImportError("type");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size) throw new StudioBrushTipImportError("decode");
  const header = parseStudioBrushTipPngHeader(bytes);
  const outputSize = outputSizeFor(header);
  const pixels = await (options.decode ?? decodeStudioBrushTipInBrowser)(file, header, outputSize);
  const mask = buildStudioBrushTipAlphaMask(pixels);
  return {
    alphaMapBase64: encodeStudioBrushTipAlphaMapBase64(mask.bytes),
    alphaMapSize: mask.size,
    sourceWidth: header.width,
    sourceHeight: header.height,
    source: mask.source,
  };
}

export function studioBrushTipImportErrorMessage(error: unknown): string {
  return error instanceof StudioBrushTipImportError
    ? error.message
    : ERROR_MESSAGES.decode;
}
