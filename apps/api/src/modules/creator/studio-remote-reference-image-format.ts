import {
  STUDIO_REMOTE_REFERENCE_IMAGE_MAX_AXIS,
  STUDIO_REMOTE_REFERENCE_IMAGE_MAX_DECODED_RGBA_BYTES,
  STUDIO_REMOTE_REFERENCE_IMAGE_MAX_PIXELS,
} from "../../../../web/src/shared/lib/studio-remote-reference-image-contract";

import type { StudioRemoteReferenceImageMediaType } from "../../../../web/src/shared/lib/studio-remote-reference-image-contract";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
]);
export const STUDIO_REMOTE_REFERENCE_MAX_PNG_CHUNKS = 8_192;
export const STUDIO_REMOTE_REFERENCE_MAX_JPEG_SEGMENTS = 4_096;
export const STUDIO_REMOTE_REFERENCE_MAX_WEBP_CHUNKS = 8_192;
export const STUDIO_REMOTE_REFERENCE_MAX_GIF_BLOCKS = 8_192;
export const STUDIO_REMOTE_REFERENCE_MAX_GIF_SUB_BLOCKS = 32_768;
// A reference board never needs an unbounded movie. The rectangle sum catches large changed
// regions, while canvasPixels * frameCount bounds browser frame-cache/compositing work even when
// every encoded frame is a tiny delta. Both limits are pixel counts (roughly 256 MiB at RGBA8).
export const STUDIO_REMOTE_REFERENCE_MAX_ANIMATION_FRAMES = 240;
export const STUDIO_REMOTE_REFERENCE_MAX_ANIMATION_FRAME_PIXELS =
  STUDIO_REMOTE_REFERENCE_IMAGE_MAX_PIXELS * 4;

export interface StudioRemoteReferenceImageMetadata {
  readonly mediaType: StudioRemoteReferenceImageMediaType;
  readonly width: number;
  readonly height: number;
  readonly decodedRgbaBytes: number;
}

export class StudioRemoteReferenceImageFormatError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "StudioRemoteReferenceImageFormatError";
  }
}

function bytesEqual(
  bytes: Uint8Array,
  offset: number,
  expected: readonly number[]
): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function chunkName(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0
  );
}

function checkedDimensions(
  mediaType: StudioRemoteReferenceImageMediaType,
  width: number,
  height: number
): StudioRemoteReferenceImageMetadata {
  const pixels = width * height;
  const decodedRgbaBytes = pixels * 4;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > STUDIO_REMOTE_REFERENCE_IMAGE_MAX_AXIS ||
    height > STUDIO_REMOTE_REFERENCE_IMAGE_MAX_AXIS ||
    !Number.isSafeInteger(pixels) ||
    pixels > STUDIO_REMOTE_REFERENCE_IMAGE_MAX_PIXELS ||
    !Number.isSafeInteger(decodedRgbaBytes) ||
    decodedRgbaBytes > STUDIO_REMOTE_REFERENCE_IMAGE_MAX_DECODED_RGBA_BYTES
  ) {
    throw new StudioRemoteReferenceImageFormatError("decoded_image_too_large");
  }
  return { mediaType, width, height, decodedRgbaBytes };
}

function assertAnimationBudget({
  canvasPixels,
  frameCount,
  framePixelSum,
  errorCode,
}: {
  canvasPixels: number;
  frameCount: number;
  framePixelSum: number;
  errorCode: "animation_too_large" | "gif_animation_too_large";
}): void {
  const fullCanvasFramePixels = canvasPixels * frameCount;
  if (
    frameCount > STUDIO_REMOTE_REFERENCE_MAX_ANIMATION_FRAMES ||
    !Number.isSafeInteger(framePixelSum) ||
    framePixelSum > STUDIO_REMOTE_REFERENCE_MAX_ANIMATION_FRAME_PIXELS ||
    !Number.isSafeInteger(fullCanvasFramePixels) ||
    fullCanvasFramePixels > STUDIO_REMOTE_REFERENCE_MAX_ANIMATION_FRAME_PIXELS
  ) {
    throw new StudioRemoteReferenceImageFormatError(errorCode);
  }
}

function readPngMetadata(bytes: Uint8Array): StudioRemoteReferenceImageMetadata {
  if (bytes.byteLength < 57 || !bytesEqual(bytes, 0, PNG_SIGNATURE)) {
    throw new StudioRemoteReferenceImageFormatError("invalid_png");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset: number = PNG_SIGNATURE.length;
  let chunks = 0;
  let dimensions: StudioRemoteReferenceImageMetadata | null = null;
  let sawImageData = false;
  let animationFrames: number | null = null;
  let animationFrameControls = 0;
  let animationFramePixels = 0;

  while (offset < bytes.byteLength) {
    if (
      chunks >= STUDIO_REMOTE_REFERENCE_MAX_PNG_CHUNKS ||
      bytes.byteLength - offset < 12
    ) {
      throw new StudioRemoteReferenceImageFormatError("invalid_png");
    }
    const length = view.getUint32(offset, false);
    const typeOffset = offset + 4;
    const dataOffset = typeOffset + 4;
    const dataEnd = dataOffset + length;
    const chunkEnd = dataEnd + 4;
    if (
      !Number.isSafeInteger(dataEnd) ||
      chunkEnd > bytes.byteLength ||
      [...bytes.subarray(typeOffset, typeOffset + 4)].some((byte) => !(
        (byte >= 0x41 && byte <= 0x5a) ||
        (byte >= 0x61 && byte <= 0x7a)
      ))
    ) {
      throw new StudioRemoteReferenceImageFormatError("invalid_png");
    }
    const type = chunkName(bytes, typeOffset);
    if (chunks === 0) {
      if (type !== "IHDR" || length !== 13) {
        throw new StudioRemoteReferenceImageFormatError("invalid_png");
      }
      const bitDepth = bytes[dataOffset + 8] ?? -1;
      const colorType = bytes[dataOffset + 9] ?? -1;
      const validBitDepth = (
        (colorType === 0 && [1, 2, 4, 8, 16].includes(bitDepth)) ||
        (colorType === 2 && [8, 16].includes(bitDepth)) ||
        (colorType === 3 && [1, 2, 4, 8].includes(bitDepth)) ||
        ((colorType === 4 || colorType === 6) && [8, 16].includes(bitDepth))
      );
      if (
        !validBitDepth ||
        bytes[dataOffset + 10] !== 0 ||
        bytes[dataOffset + 11] !== 0 ||
        (bytes[dataOffset + 12] !== 0 && bytes[dataOffset + 12] !== 1)
      ) {
        throw new StudioRemoteReferenceImageFormatError("invalid_png");
      }
      dimensions = checkedDimensions(
        "image/png",
        view.getUint32(dataOffset, false),
        view.getUint32(dataOffset + 4, false)
      );
    } else if (!dimensions) {
      throw new StudioRemoteReferenceImageFormatError("invalid_png");
    }

    if (type === "IDAT") {
      if (length === 0) throw new StudioRemoteReferenceImageFormatError("invalid_png");
      sawImageData = true;
    }
    if (type === "acTL") {
      if (!dimensions || animationFrames !== null || sawImageData || length !== 8) {
        throw new StudioRemoteReferenceImageFormatError("invalid_png");
      }
      animationFrames = view.getUint32(dataOffset, false);
      if (animationFrames < 1) {
        throw new StudioRemoteReferenceImageFormatError("invalid_png");
      }
      assertAnimationBudget({
        canvasPixels: dimensions.width * dimensions.height,
        frameCount: animationFrames,
        framePixelSum: 0,
        errorCode: "animation_too_large",
      });
    }
    if (type === "fcTL") {
      if (!dimensions || animationFrames === null || length !== 26) {
        throw new StudioRemoteReferenceImageFormatError("invalid_png");
      }
      const frameWidth = view.getUint32(dataOffset + 4, false);
      const frameHeight = view.getUint32(dataOffset + 8, false);
      const frameX = view.getUint32(dataOffset + 12, false);
      const frameY = view.getUint32(dataOffset + 16, false);
      const framePixels = frameWidth * frameHeight;
      if (
        frameWidth < 1 ||
        frameHeight < 1 ||
        frameX + frameWidth > dimensions.width ||
        frameY + frameHeight > dimensions.height ||
        !Number.isSafeInteger(framePixels)
      ) {
        throw new StudioRemoteReferenceImageFormatError("invalid_png");
      }
      animationFrameControls += 1;
      animationFramePixels += framePixels;
      if (animationFrameControls > animationFrames) {
        throw new StudioRemoteReferenceImageFormatError("animation_too_large");
      }
      assertAnimationBudget({
        canvasPixels: dimensions.width * dimensions.height,
        frameCount: animationFrameControls,
        framePixelSum: animationFramePixels,
        errorCode: "animation_too_large",
      });
    }
    if (type === "fdAT" && (animationFrames === null || length <= 4)) {
      throw new StudioRemoteReferenceImageFormatError("invalid_png");
    }
    if (type === "IEND") {
      if (
        length !== 0 ||
        !sawImageData ||
        chunkEnd !== bytes.byteLength ||
        !dimensions ||
        (animationFrames !== null && animationFrameControls !== animationFrames)
      ) {
        throw new StudioRemoteReferenceImageFormatError("invalid_png");
      }
      return dimensions;
    }
    offset = chunkEnd;
    chunks += 1;
  }
  throw new StudioRemoteReferenceImageFormatError("invalid_png");
}

function readJpegMetadata(bytes: Uint8Array): StudioRemoteReferenceImageMetadata {
  if (
    bytes.byteLength < 12 ||
    !bytesEqual(bytes, 0, [0xff, 0xd8, 0xff]) ||
    !bytesEqual(bytes, bytes.byteLength - 2, [0xff, 0xd9])
  ) {
    throw new StudioRemoteReferenceImageFormatError("invalid_jpeg");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  let dimensions: StudioRemoteReferenceImageMetadata | null = null;
  let sawScan = false;
  let segments = 0;

  while (offset < bytes.byteLength - 2) {
    segments += 1;
    if (segments > STUDIO_REMOTE_REFERENCE_MAX_JPEG_SEGMENTS) {
      throw new StudioRemoteReferenceImageFormatError("jpeg_structure_too_complex");
    }
    if (bytes[offset] !== 0xff) {
      throw new StudioRemoteReferenceImageFormatError("invalid_jpeg");
    }
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.byteLength) break;
    const marker = bytes[offset++]!;
    if (marker === 0x00) throw new StudioRemoteReferenceImageFormatError("invalid_jpeg");
    if (marker === 0xd9) break;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > bytes.byteLength) {
      throw new StudioRemoteReferenceImageFormatError("invalid_jpeg");
    }
    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) {
      throw new StudioRemoteReferenceImageFormatError("invalid_jpeg");
    }
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (dimensions || segmentLength < 8 || bytes[offset + 2] !== 8) {
        throw new StudioRemoteReferenceImageFormatError("invalid_jpeg");
      }
      dimensions = checkedDimensions(
        "image/jpeg",
        view.getUint16(offset + 5, false),
        view.getUint16(offset + 3, false)
      );
    }
    if (marker === 0xda) {
      sawScan = true;
      break;
    }
    offset += segmentLength;
  }
  if (!dimensions || !sawScan) {
    throw new StudioRemoteReferenceImageFormatError("invalid_jpeg");
  }
  return dimensions;
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16);
}

function webpChunkDimensions(
  bytes: Uint8Array,
  type: string,
  dataOffset: number,
  length: number
): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === "VP8X") {
    if (length !== 10) throw new StudioRemoteReferenceImageFormatError("invalid_webp");
    const flags = bytes[dataOffset] ?? 0;
    if ((flags & 0xc1) !== 0) throw new StudioRemoteReferenceImageFormatError("invalid_webp");
    return {
      width: readUint24LittleEndian(bytes, dataOffset + 4) + 1,
      height: readUint24LittleEndian(bytes, dataOffset + 7) + 1,
    };
  }
  if (type === "VP8 ") {
    if (length < 10 || !bytesEqual(bytes, dataOffset + 3, [0x9d, 0x01, 0x2a])) {
      throw new StudioRemoteReferenceImageFormatError("invalid_webp");
    }
    return {
      width: view.getUint16(dataOffset + 6, true) & 0x3fff,
      height: view.getUint16(dataOffset + 8, true) & 0x3fff,
    };
  }
  if (type === "VP8L") {
    if (length < 5 || bytes[dataOffset] !== 0x2f) {
      throw new StudioRemoteReferenceImageFormatError("invalid_webp");
    }
    const b0 = bytes[dataOffset + 1] ?? 0;
    const b1 = bytes[dataOffset + 2] ?? 0;
    const b2 = bytes[dataOffset + 3] ?? 0;
    const b3 = bytes[dataOffset + 4] ?? 0;
    return {
      width: 1 + b0 + ((b1 & 0x3f) << 8),
      height: 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)),
    };
  }
  return null;
}

function readWebpMetadata(bytes: Uint8Array): StudioRemoteReferenceImageMetadata {
  if (
    bytes.byteLength < 26 ||
    !bytesEqual(bytes, 0, [0x52, 0x49, 0x46, 0x46]) ||
    !bytesEqual(bytes, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    throw new StudioRemoteReferenceImageFormatError("invalid_webp");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.byteLength) {
    throw new StudioRemoteReferenceImageFormatError("invalid_webp");
  }

  let offset = 12;
  let canvas: { width: number; height: number } | null = null;
  let hasExtendedHeader = false;
  let topLevelImagePayloads = 0;
  let sawAnimationHeader = false;
  let animationFlag = false;
  let animationFrames = 0;
  let animationFramePixels = 0;
  let chunkCount = 0;
  while (offset < bytes.byteLength) {
    chunkCount += 1;
    if (chunkCount > STUDIO_REMOTE_REFERENCE_MAX_WEBP_CHUNKS) {
      throw new StudioRemoteReferenceImageFormatError("webp_structure_too_complex");
    }
    if (bytes.byteLength - offset < 8) {
      throw new StudioRemoteReferenceImageFormatError("invalid_webp");
    }
    const type = chunkName(bytes, offset);
    const length = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + length;
    const chunkEnd = dataEnd + (length % 2);
    if (!Number.isSafeInteger(dataEnd) || chunkEnd > bytes.byteLength) {
      throw new StudioRemoteReferenceImageFormatError("invalid_webp");
    }
    const dimensions = webpChunkDimensions(bytes, type, dataOffset, length);
    if (dimensions) {
      if (type === "VP8X") {
        if (offset !== 12 || canvas) {
          throw new StudioRemoteReferenceImageFormatError("invalid_webp");
        }
        hasExtendedHeader = true;
        canvas = dimensions;
        animationFlag = ((bytes[dataOffset] ?? 0) & 0x02) !== 0;
      } else {
        if (
          animationFlag ||
          sawAnimationHeader ||
          animationFrames > 0 ||
          topLevelImagePayloads > 0 ||
          (canvas && (
            canvas.width !== dimensions.width ||
            canvas.height !== dimensions.height
          ))
        ) {
          throw new StudioRemoteReferenceImageFormatError("invalid_webp");
        }
        topLevelImagePayloads += 1;
        canvas ??= dimensions;
      }
    }
    if (type === "ANIM") {
      if (
        !hasExtendedHeader ||
        !animationFlag ||
        sawAnimationHeader ||
        topLevelImagePayloads > 0 ||
        animationFrames > 0 ||
        length !== 6
      ) {
        throw new StudioRemoteReferenceImageFormatError("invalid_webp");
      }
      sawAnimationHeader = true;
    }
    if (type === "ANMF") {
      if (!canvas || !animationFlag || !sawAnimationHeader || length < 16) {
        throw new StudioRemoteReferenceImageFormatError("invalid_webp");
      }
      const frameX = readUint24LittleEndian(bytes, dataOffset) * 2;
      const frameY = readUint24LittleEndian(bytes, dataOffset + 3) * 2;
      const frameWidth = readUint24LittleEndian(bytes, dataOffset + 6) + 1;
      const frameHeight = readUint24LittleEndian(bytes, dataOffset + 9) + 1;
      const framePixels = frameWidth * frameHeight;
      if (
        frameX + frameWidth > canvas.width ||
        frameY + frameHeight > canvas.height ||
        !Number.isSafeInteger(framePixels)
      ) {
        throw new StudioRemoteReferenceImageFormatError("invalid_webp");
      }
      let frameOffset = dataOffset + 16;
      let sawFrameImage = false;
      let sawFrameAlpha = false;
      while (frameOffset < dataEnd) {
        chunkCount += 1;
        if (chunkCount > STUDIO_REMOTE_REFERENCE_MAX_WEBP_CHUNKS) {
          throw new StudioRemoteReferenceImageFormatError("webp_structure_too_complex");
        }
        if (dataEnd - frameOffset < 8) {
          throw new StudioRemoteReferenceImageFormatError("invalid_webp");
        }
        const frameType = chunkName(bytes, frameOffset);
        const frameLength = view.getUint32(frameOffset + 4, true);
        const frameDataOffset = frameOffset + 8;
        const frameDataEnd = frameDataOffset + frameLength;
        const frameChunkEnd = frameDataEnd + (frameLength % 2);
        if (!Number.isSafeInteger(frameDataEnd) || frameChunkEnd > dataEnd) {
          throw new StudioRemoteReferenceImageFormatError("invalid_webp");
        }
        const frameDimensions = webpChunkDimensions(
          bytes,
          frameType,
          frameDataOffset,
          frameLength
        );
        if (frameDimensions) {
          if (
            frameType === "VP8X" ||
            sawFrameImage ||
            frameDimensions.width !== frameWidth ||
            frameDimensions.height !== frameHeight
          ) {
            throw new StudioRemoteReferenceImageFormatError("invalid_webp");
          }
          sawFrameImage = true;
        } else if (frameType === "ALPH") {
          if (sawFrameAlpha || sawFrameImage || frameLength < 1) {
            throw new StudioRemoteReferenceImageFormatError("invalid_webp");
          }
          sawFrameAlpha = true;
        } else {
          throw new StudioRemoteReferenceImageFormatError("invalid_webp");
        }
        frameOffset = frameChunkEnd;
      }
      if (!sawFrameImage || frameOffset !== dataEnd) {
        throw new StudioRemoteReferenceImageFormatError("invalid_webp");
      }
      animationFrames += 1;
      animationFramePixels += framePixels;
      assertAnimationBudget({
        canvasPixels: canvas.width * canvas.height,
        frameCount: animationFrames,
        framePixelSum: animationFramePixels,
        errorCode: "animation_too_large",
      });
    }
    offset = chunkEnd;
  }
  if (
    offset !== bytes.byteLength ||
    !canvas ||
    (animationFlag && (
      !hasExtendedHeader ||
      !sawAnimationHeader ||
      animationFrames < 1 ||
      topLevelImagePayloads !== 0
    )) ||
    (!animationFlag && (
      sawAnimationHeader ||
      animationFrames > 0 ||
      topLevelImagePayloads !== 1
    ))
  ) {
    throw new StudioRemoteReferenceImageFormatError("invalid_webp");
  }
  return checkedDimensions("image/webp", canvas.width, canvas.height);
}

function skipGifSubBlocks(
  bytes: Uint8Array,
  initialOffset: number,
  budget: { count: number }
): number {
  let offset = initialOffset;
  while (offset < bytes.byteLength) {
    budget.count += 1;
    if (budget.count > STUDIO_REMOTE_REFERENCE_MAX_GIF_SUB_BLOCKS) {
      throw new StudioRemoteReferenceImageFormatError("gif_structure_too_complex");
    }
    const length = bytes[offset++]!;
    if (length === 0) return offset;
    offset += length;
    if (offset > bytes.byteLength) {
      throw new StudioRemoteReferenceImageFormatError("invalid_gif");
    }
  }
  throw new StudioRemoteReferenceImageFormatError("invalid_gif");
}

function readGifMetadata(bytes: Uint8Array): StudioRemoteReferenceImageMetadata {
  if (
    bytes.byteLength < 20 ||
    (!bytesEqual(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) &&
      !bytesEqual(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))
  ) {
    throw new StudioRemoteReferenceImageFormatError("invalid_gif");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);
  const metadata = checkedDimensions("image/gif", width, height);
  const packed = bytes[10] ?? 0;
  let offset = 13;
  if ((packed & 0x80) !== 0) {
    offset += 3 * (2 ** ((packed & 0x07) + 1));
  }
  if (offset > bytes.byteLength) throw new StudioRemoteReferenceImageFormatError("invalid_gif");

  let frames = 0;
  let framePixels = 0;
  let blocks = 0;
  const subBlockBudget = { count: 0 };
  while (offset < bytes.byteLength) {
    blocks += 1;
    if (blocks > STUDIO_REMOTE_REFERENCE_MAX_GIF_BLOCKS) {
      throw new StudioRemoteReferenceImageFormatError("gif_structure_too_complex");
    }
    const introducer = bytes[offset++]!;
    if (introducer === 0x3b) {
      if (offset !== bytes.byteLength || frames === 0) {
        throw new StudioRemoteReferenceImageFormatError("invalid_gif");
      }
      return metadata;
    }
    if (introducer === 0x21) {
      if (offset >= bytes.byteLength) throw new StudioRemoteReferenceImageFormatError("invalid_gif");
      offset += 1; // extension label
      offset = skipGifSubBlocks(bytes, offset, subBlockBudget);
      continue;
    }
    if (introducer !== 0x2c || offset + 9 > bytes.byteLength) {
      throw new StudioRemoteReferenceImageFormatError("invalid_gif");
    }
    const left = view.getUint16(offset, true);
    const top = view.getUint16(offset + 2, true);
    const frameWidth = view.getUint16(offset + 4, true);
    const frameHeight = view.getUint16(offset + 6, true);
    const framePacked = bytes[offset + 8] ?? 0;
    const nextFramePixels = frameWidth * frameHeight;
    if (
      frameWidth < 1 ||
      frameHeight < 1 ||
      left + frameWidth > width ||
      top + frameHeight > height ||
      !Number.isSafeInteger(nextFramePixels)
    ) {
      throw new StudioRemoteReferenceImageFormatError("invalid_gif");
    }
    frames += 1;
    framePixels += nextFramePixels;
    assertAnimationBudget({
      canvasPixels: width * height,
      frameCount: frames,
      framePixelSum: framePixels,
      errorCode: "gif_animation_too_large",
    });
    offset += 9;
    if ((framePacked & 0x80) !== 0) {
      offset += 3 * (2 ** ((framePacked & 0x07) + 1));
    }
    if (offset >= bytes.byteLength) throw new StudioRemoteReferenceImageFormatError("invalid_gif");
    const lzwMinimumCodeSize = bytes[offset++]!;
    if (lzwMinimumCodeSize < 2 || lzwMinimumCodeSize > 8) {
      throw new StudioRemoteReferenceImageFormatError("invalid_gif");
    }
    offset = skipGifSubBlocks(bytes, offset, subBlockBudget);
  }
  throw new StudioRemoteReferenceImageFormatError("invalid_gif");
}

export function sniffStudioRemoteReferenceImageMediaType(
  bytes: Uint8Array
): StudioRemoteReferenceImageMediaType | null {
  if (bytesEqual(bytes, 0, PNG_SIGNATURE)) return "image/png";
  if (bytesEqual(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (
    bytesEqual(bytes, 0, [0x52, 0x49, 0x46, 0x46]) &&
    bytesEqual(bytes, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    return "image/webp";
  }
  if (
    bytesEqual(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    bytesEqual(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return "image/gif";
  }
  return null;
}

export function inspectStudioRemoteReferenceImage(
  declaredMediaType: StudioRemoteReferenceImageMediaType,
  bytes: Uint8Array
): StudioRemoteReferenceImageMetadata {
  const sniffed = sniffStudioRemoteReferenceImageMediaType(bytes);
  if (!sniffed || sniffed !== declaredMediaType) {
    throw new StudioRemoteReferenceImageFormatError("mime_magic_mismatch");
  }
  if (sniffed === "image/png") return readPngMetadata(bytes);
  if (sniffed === "image/jpeg") return readJpegMetadata(bytes);
  if (sniffed === "image/webp") return readWebpMetadata(bytes);
  return readGifMetadata(bytes);
}
