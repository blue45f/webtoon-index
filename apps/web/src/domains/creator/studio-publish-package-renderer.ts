import { canvasToBlob } from "./export/studio-export";
import { drawWatermarkOnSlice } from "./export/studio-export-presets";
import {
  getStudioPublishPlatformPreset,
  planStudioPublishCanvasSlices,
  planStudioPublishThumbnailCrop,
  studioPublishThumbnailFileName,
  type StudioPublishPackageImageMimeType,
  type StudioPublishPackageFormat,
  type StudioPublishPackageSettings,
  type StudioPublishRenderedImageMetadata,
  type StudioPublishThumbnailMetadata,
  type StudioPublishThumbnailSlot,
} from "./studio-publish-package";

import type { WatermarkSettings } from "./studio-watermark";

export interface StudioPublishPackageCanvasSource {
  id: string;
  canvas: HTMLCanvasElement;
}

export interface StudioPublishPackageRenderedFile {
  fileName: string;
  blob: Blob;
  metadata: StudioPublishRenderedImageMetadata;
}

export interface StudioPublishPackageRenderedThumbnail {
  fileName: string;
  blob: Blob;
  metadata: StudioPublishThumbnailMetadata;
}

export interface StudioPublishPackageRenderResult {
  episodeImages: StudioPublishPackageRenderedFile[];
  thumbnails: StudioPublishPackageRenderedThumbnail[];
}

export interface StudioPublishPackageRenderOptions {
  settings: StudioPublishPackageSettings;
  seriesTitle: string;
  episodeNumber?: number | null;
  sources: readonly StudioPublishPackageCanvasSource[];
  /** Defaults to the first source and is used only for requested thumbnail cover crops. */
  thumbnailSourceId?: string;
  focalX?: number;
  focalY?: number;
  watermark?: WatermarkSettings;
  onProgress?: (done: number, total: number) => void;
  createCanvas?: (width: number, height: number) => HTMLCanvasElement;
  encode?: (canvas: HTMLCanvasElement, mimeType: string, quality?: number) => Promise<Blob>;
  digestSha256?: (blob: Blob) => Promise<string>;
  /**
   * Releases a temporary output canvas after its encoded Blob and checksum are complete. A
   * caller-provided canvas factory keeps ownership unless it also provides this hook; canvases
   * created by the default browser factory are cleared automatically.
   */
  releaseCanvas?: (canvas: HTMLCanvasElement) => void;
}

const MIME_BY_FORMAT: Record<StudioPublishPackageFormat, StudioPublishPackageImageMimeType> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

function createOutputCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function releaseOutputCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

function bestEffortReleaseCanvas(
  canvas: HTMLCanvasElement,
  releaseCanvas: ((canvas: HTMLCanvasElement) => void) | undefined
): void {
  try {
    releaseCanvas?.(canvas);
  } catch {
    // 메모리 정리는 best-effort다. 렌더·인코딩 오류를 정리 오류로 덮어쓰지 않는다.
  }
}

async function defaultDigestSha256(blob: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("이 브라우저에서는 패키지 파일 무결성 해시를 만들 수 없어요.");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function qualityForMime(mimeType: string): number | undefined {
  return mimeType === "image/jpeg" ? 0.92 : mimeType === "image/webp" ? 0.9 : undefined;
}

function drawCover(
  output: HTMLCanvasElement,
  source: HTMLCanvasElement,
  crop: { x: number; y: number; width: number; height: number }
): void {
  const context = output.getContext("2d");
  if (!context) throw new Error("게시 패키지 출력 캔버스를 만들지 못했어요.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, output.width, output.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    source,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    output.width,
    output.height
  );
}

function thumbnailMimeType(
  settings: StudioPublishPackageSettings,
  slot: StudioPublishThumbnailSlot
): StudioPublishPackageImageMimeType {
  const preset = getStudioPublishPlatformPreset(settings.destination);
  const spec = preset.thumbnails.find((thumbnail) => thumbnail.slot === slot);
  if (!spec) throw new Error("선택한 목적지에서 지원하지 않는 썸네일 종류예요.");
  const requested = MIME_BY_FORMAT[settings.outputFormat];
  return spec.allowedMimeTypes.includes(requested)
    ? requested
    : spec.allowedMimeTypes[0];
}

async function encodedImageMimeType(blob: Blob): Promise<StudioPublishPackageImageMimeType | null> {
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) return "image/webp";
  if (bytes.length >= 6) {
    const signature = String.fromCharCode(...bytes.slice(0, 6));
    if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
  }
  return null;
}

async function assertEncodedImageMatches(blob: Blob, expected: StudioPublishPackageImageMimeType): Promise<void> {
  const declared = blob.type.trim().toLowerCase();
  const normalizedDeclared = declared === "image/jpg" ? "image/jpeg" : declared;
  const detected = await encodedImageMimeType(blob);
  if (normalizedDeclared !== expected || detected !== expected) {
    throw new Error("브라우저가 요청한 이미지 형식과 다른 파일을 만들었어요. PNG 또는 JPEG로 다시 시도해 주세요.");
  }
}

/**
 * Renders the deterministic package plan into in-memory Blobs. It does not download, upload, or
 * write files; the caller reviews the returned byte sizes/checksums with planStudioPublishPackage
 * before explicitly saving them.
 */
export async function renderStudioPublishPackageImages(
  options: StudioPublishPackageRenderOptions
): Promise<StudioPublishPackageRenderResult> {
  if (options.sources.length === 0) throw new Error("게시 패키지로 렌더링할 캔버스가 없어요.");
  const sourceById = new Map<string, HTMLCanvasElement>();
  for (const source of options.sources) {
    const id = source.id.trim();
    if (!id || sourceById.has(id) || source.canvas.width <= 0 || source.canvas.height <= 0) {
      throw new Error("게시 패키지 원본 캔버스 ID 또는 크기가 올바르지 않아요.");
    }
    sourceById.set(id, source.canvas);
  }
  const createCanvas = options.createCanvas ?? createOutputCanvas;
  const encode = options.encode ?? canvasToBlob;
  const digestSha256 = options.digestSha256 ?? defaultDigestSha256;
  const releaseCanvas = options.releaseCanvas
    ?? (options.createCanvas ? undefined : releaseOutputCanvas);
  const slicePlan = planStudioPublishCanvasSlices({
    destination: options.settings.destination,
    seriesTitle: options.seriesTitle,
    episodeNumber: options.episodeNumber,
    canvases: options.sources.map((source) => ({
      id: source.id,
      width: source.canvas.width,
      height: source.canvas.height,
    })),
    format: options.settings.outputFormat,
  });
  if (slicePlan.length === 0) throw new Error("게시 패키지 이미지 분할 계획을 만들지 못했어요.");

  const requestedSlots = options.settings.requestedThumbnailSlots;
  const total = slicePlan.length + requestedSlots.length;
  let done = 0;
  const episodeImages: StudioPublishPackageRenderedFile[] = [];
  for (const slice of slicePlan) {
    const source = sourceById.get(slice.sourceCanvasId);
    if (!source) throw new Error("게시 패키지 분할 계획의 원본 캔버스를 찾지 못했어요.");
    const output = createCanvas(slice.output.width, slice.output.height);
    try {
      drawCover(output, source, slice.source);
      if (options.watermark) drawWatermarkOnSlice(output, options.watermark);
      const blob = await encode(output, slice.mimeType, qualityForMime(slice.mimeType));
      await assertEncodedImageMatches(blob, slice.mimeType);
      const sha256 = await digestSha256(blob);
      episodeImages.push({
        fileName: slice.fileName,
        blob,
        metadata: {
          id: `episode-image-${slice.sliceIndex + 1}`,
          sourceCanvasId: slice.sourceCanvasId,
          mimeType: slice.mimeType,
          width: slice.output.width,
          height: slice.output.height,
          byteSize: blob.size,
          sha256,
          fileName: slice.fileName,
        },
      });
    } finally {
      bestEffortReleaseCanvas(output, releaseCanvas);
    }
    done += 1;
    options.onProgress?.(done, total);
  }

  const thumbnailSource = sourceById.get(options.thumbnailSourceId ?? "")
    ?? options.sources[0]?.canvas;
  if (!thumbnailSource) throw new Error("썸네일 원본 캔버스를 찾지 못했어요.");
  const thumbnails: StudioPublishPackageRenderedThumbnail[] = [];
  for (const slot of requestedSlots) {
    const crop = planStudioPublishThumbnailCrop({
      destination: options.settings.destination,
      slot,
      sourceWidth: thumbnailSource.width,
      sourceHeight: thumbnailSource.height,
      focalX: options.focalX,
      focalY: options.focalY,
    });
    if (!crop) continue;
    const mimeType = thumbnailMimeType(options.settings, slot);
    const output = createCanvas(crop.output.width, crop.output.height);
    try {
      drawCover(output, thumbnailSource, crop.source);
      const blob = await encode(output, mimeType, qualityForMime(mimeType));
      await assertEncodedImageMatches(blob, mimeType);
      const sha256 = await digestSha256(blob);
      const fileName = studioPublishThumbnailFileName({
        destination: options.settings.destination,
        seriesTitle: options.seriesTitle,
        episodeNumber: options.episodeNumber,
        slot,
        mimeType,
      });
      thumbnails.push({
        fileName,
        blob,
        metadata: {
          id: `thumbnail-${slot}`,
          slot,
          mimeType,
          width: crop.output.width,
          height: crop.output.height,
          byteSize: blob.size,
          sha256,
          fileName,
        },
      });
    } finally {
      bestEffortReleaseCanvas(output, releaseCanvas);
    }
    done += 1;
    options.onProgress?.(done, total);
  }
  return { episodeImages, thumbnails };
}
