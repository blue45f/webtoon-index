export const STRICT_RASTER_MAX_JPEG_SEGMENTS = 4_096;
export const STRICT_RASTER_MAX_WEBP_CHUNKS = 8_192;

export interface StrictRasterImageDimensions {
  readonly width: number;
  readonly height: number;
}

export type StrictRasterImageInspectionErrorCode =
  | "invalid-jpeg"
  | "invalid-webp"
  | "jpeg-structure-too-complex"
  | "webp-structure-too-complex";

export class StrictRasterImageInspectionError extends Error {
  constructor(readonly code: StrictRasterImageInspectionErrorCode) {
    super(code);
    this.name = "StrictRasterImageInspectionError";
  }
}

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
]);

function fail(code: StrictRasterImageInspectionErrorCode): never {
  throw new StrictRasterImageInspectionError(code);
}

function bytesEqual(
  bytes: Uint8Array,
  offset: number,
  expected: readonly number[],
): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function chunkName(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0)
    + (bytes[offset + 1] ?? 0) * 0x100
    + (bytes[offset + 2] ?? 0) * 0x10000;
}

function checkedDimensions(
  width: number,
  height: number,
  code: "invalid-jpeg" | "invalid-webp",
): StrictRasterImageDimensions {
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width < 1
    || height < 1
  ) {
    fail(code);
  }
  return { width, height };
}

/**
 * Reads the one authoritative 8-bit JPEG SOF before the first scan.
 *
 * The segment ceiling is a CPU boundary, not a file-size boundary: a small file can otherwise
 * contain millions of tiny APP/COM records. A second SOF is rejected instead of allowing later
 * metadata to replace the dimensions used for decoded-memory admission.
 */
export function inspectStrictJpegDimensions(
  bytes: Uint8Array,
  maximumSegments = STRICT_RASTER_MAX_JPEG_SEGMENTS,
): StrictRasterImageDimensions {
  if (
    !Number.isSafeInteger(maximumSegments)
    || maximumSegments < 1
    || bytes.byteLength < 12
    || !bytesEqual(bytes, 0, [0xff, 0xd8])
    || !bytesEqual(bytes, bytes.byteLength - 2, [0xff, 0xd9])
  ) {
    fail("invalid-jpeg");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let dimensions: StrictRasterImageDimensions | null = null;
  let offset = 2;
  let segments = 0;
  let sawScan = false;
  let inEntropyData = false;
  const frameComponents = new Set<number>();

  while (offset < bytes.byteLength) {
    let marker: number;
    if (inEntropyData) {
      let foundMarker = false;
      marker = 0;
      while (offset < bytes.byteLength) {
        if (bytes[offset++] !== 0xff) continue;
        while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
        if (offset >= bytes.byteLength) fail("invalid-jpeg");
        marker = bytes[offset++]!;
        if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        foundMarker = true;
        break;
      }
      if (!foundMarker) fail("invalid-jpeg");
      inEntropyData = false;
    } else {
      if (bytes[offset] !== 0xff) fail("invalid-jpeg");
      while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.byteLength) fail("invalid-jpeg");
      marker = bytes[offset++]!;
    }

    segments += 1;
    if (segments > maximumSegments) fail("jpeg-structure-too-complex");
    if (marker === 0x00) fail("invalid-jpeg");
    if (marker === 0xd9) {
      if (offset !== bytes.byteLength || !dimensions || !sawScan) fail("invalid-jpeg");
      return dimensions;
    }
    if (marker === 0xd8 || marker === 0xdc) fail("invalid-jpeg");
    // TEM may appear between header segments. Restart markers are valid only while scanning
    // entropy-coded bytes and are consumed by the inEntropyData state above.
    if (marker === 0x01) continue;
    if (marker >= 0xd0 && marker <= 0xd7) fail("invalid-jpeg");
    if (offset + 2 > bytes.byteLength) fail("invalid-jpeg");
    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) {
      fail("invalid-jpeg");
    }
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      const componentCount = bytes[offset + 7] ?? 0;
      if (
        dimensions
        || bytes[offset + 2] !== 8
        || componentCount < 1
        || componentCount > 4
        || segmentLength !== 8 + 3 * componentCount
      ) {
        fail("invalid-jpeg");
      }
      dimensions = checkedDimensions(
        view.getUint16(offset + 5, false),
        view.getUint16(offset + 3, false),
        "invalid-jpeg",
      );
      for (let component = 0; component < componentCount; component += 1) {
        const componentOffset = offset + 8 + component * 3;
        const id = bytes[componentOffset] ?? -1;
        const sampling = bytes[componentOffset + 1] ?? 0;
        const horizontalSampling = sampling >> 4;
        const verticalSampling = sampling & 0x0f;
        const quantizationTable = bytes[componentOffset + 2] ?? 4;
        if (
          frameComponents.has(id)
          || horizontalSampling < 1
          || horizontalSampling > 4
          || verticalSampling < 1
          || verticalSampling > 4
          || quantizationTable > 3
        ) {
          fail("invalid-jpeg");
        }
        frameComponents.add(id);
      }
    }
    if (marker === 0xda) {
      if (!dimensions) fail("invalid-jpeg");
      const scanComponentCount = bytes[offset + 2] ?? 0;
      if (
        scanComponentCount < 1
        || scanComponentCount > 4
        || segmentLength !== 6 + 2 * scanComponentCount
      ) {
        fail("invalid-jpeg");
      }
      const scanComponents = new Set<number>();
      for (let component = 0; component < scanComponentCount; component += 1) {
        const componentOffset = offset + 3 + component * 2;
        const id = bytes[componentOffset] ?? -1;
        const tableSelectors = bytes[componentOffset + 1] ?? 0xff;
        if (
          !frameComponents.has(id)
          || scanComponents.has(id)
          || (tableSelectors >> 4) > 3
          || (tableSelectors & 0x0f) > 3
        ) {
          fail("invalid-jpeg");
        }
        scanComponents.add(id);
      }
      sawScan = true;
      offset += segmentLength;
      inEntropyData = true;
      continue;
    }
    offset += segmentLength;
  }
  fail("invalid-jpeg");
}

function webpPayloadDimensions(
  bytes: Uint8Array,
  type: string,
  dataOffset: number,
  byteLength: number,
): (StrictRasterImageDimensions & { readonly hasAlpha: boolean }) | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === "VP8 ") {
    if (byteLength < 10 || !bytesEqual(bytes, dataOffset + 3, [0x9d, 0x01, 0x2a])) {
      fail("invalid-webp");
    }
    if (((bytes[dataOffset] ?? 1) & 0x01) !== 0) fail("invalid-webp");
    return {
      ...checkedDimensions(
      view.getUint16(dataOffset + 6, true) & 0x3fff,
      view.getUint16(dataOffset + 8, true) & 0x3fff,
      "invalid-webp",
      ),
      hasAlpha: false,
    };
  }
  if (type === "VP8L") {
    if (byteLength < 5 || bytes[dataOffset] !== 0x2f) fail("invalid-webp");
    const b0 = bytes[dataOffset + 1] ?? 0;
    const b1 = bytes[dataOffset + 2] ?? 0;
    const b2 = bytes[dataOffset + 3] ?? 0;
    const b3 = bytes[dataOffset + 4] ?? 0;
    if ((b3 & 0xe0) !== 0) fail("invalid-webp");
    return {
      ...checkedDimensions(
        1 + b0 + ((b1 & 0x3f) << 8),
        1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)),
        "invalid-webp",
      ),
      hasAlpha: (b3 & 0x10) !== 0,
    };
  }
  return null;
}

/**
 * Strict static WebP inspector shared by browser and server admission boundaries.
 *
 * Animated WebP is intentionally rejected here. Reference-image animation uses its own full ANMF
 * parser; creator-asset previews/content and 3D textures must remain static and must contain one
 * top-level VP8/VP8L payload whose dimensions exactly match the optional VP8X canvas.
 */
export function inspectStrictStaticWebpDimensions(
  bytes: Uint8Array,
  maximumChunks = STRICT_RASTER_MAX_WEBP_CHUNKS,
): StrictRasterImageDimensions {
  if (
    !Number.isSafeInteger(maximumChunks)
    || maximumChunks < 1
    || bytes.byteLength < 26
    || !bytesEqual(bytes, 0, [0x52, 0x49, 0x46, 0x46])
    || !bytesEqual(bytes, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    fail("invalid-webp");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.byteLength) fail("invalid-webp");

  let offset = 12;
  let chunks = 0;
  let extendedCanvas: StrictRasterImageDimensions | null = null;
  let imageDimensions: StrictRasterImageDimensions | null = null;
  let imagePayloads = 0;
  let alphaChunks = 0;
  let alphaFlag = false;
  let iccpFlag = false;
  let exifFlag = false;
  let xmpFlag = false;
  let iccpChunks = 0;
  let exifChunks = 0;
  let xmpChunks = 0;
  let imageType: "VP8 " | "VP8L" | null = null;
  let intrinsicAlpha = false;

  while (offset < bytes.byteLength) {
    chunks += 1;
    if (chunks > maximumChunks) fail("webp-structure-too-complex");
    if (bytes.byteLength - offset < 8) fail("invalid-webp");
    const type = chunkName(bytes, offset);
    const byteLength = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + byteLength;
    const chunkEnd = dataEnd + (byteLength % 2);
    if (!Number.isSafeInteger(dataEnd) || chunkEnd > bytes.byteLength) {
      fail("invalid-webp");
    }
    if (byteLength % 2 === 1 && bytes[dataEnd] !== 0) fail("invalid-webp");

    if (type === "VP8X") {
      if (offset !== 12 || extendedCanvas || byteLength !== 10) fail("invalid-webp");
      const flags = bytes[dataOffset] ?? 0;
      if (
        (flags & 0xc1) !== 0
        || (flags & 0x02) !== 0
        || bytes[dataOffset + 1] !== 0
        || bytes[dataOffset + 2] !== 0
        || bytes[dataOffset + 3] !== 0
      ) {
        fail("invalid-webp");
      }
      iccpFlag = (flags & 0x20) !== 0;
      alphaFlag = (flags & 0x10) !== 0;
      exifFlag = (flags & 0x08) !== 0;
      xmpFlag = (flags & 0x04) !== 0;
      extendedCanvas = checkedDimensions(
        readUint24LittleEndian(bytes, dataOffset + 4) + 1,
        readUint24LittleEndian(bytes, dataOffset + 7) + 1,
        "invalid-webp",
      );
    } else if (type === "ANIM" || type === "ANMF") {
      fail("invalid-webp");
    } else if (type === "ICCP") {
      iccpChunks += 1;
      if (!extendedCanvas || !iccpFlag || iccpChunks > 1 || imagePayloads > 0 || byteLength < 1) {
        fail("invalid-webp");
      }
    } else if (type === "ALPH") {
      alphaChunks += 1;
      if (!extendedCanvas || !alphaFlag || alphaChunks > 1 || imagePayloads > 0 || byteLength < 1) {
        fail("invalid-webp");
      }
    } else {
      const payload = webpPayloadDimensions(bytes, type, dataOffset, byteLength);
      if (payload) {
        imagePayloads += 1;
        if (imagePayloads > 1) fail("invalid-webp");
        imageDimensions = payload;
        imageType = type === "VP8 " ? "VP8 " : "VP8L";
        intrinsicAlpha = payload.hasAlpha;
      } else if (type === "EXIF") {
        exifChunks += 1;
        if (!extendedCanvas || !exifFlag || exifChunks > 1 || imagePayloads !== 1 || byteLength < 1) {
          fail("invalid-webp");
        }
      } else if (type === "XMP ") {
        xmpChunks += 1;
        if (!extendedCanvas || !xmpFlag || xmpChunks > 1 || imagePayloads !== 1 || byteLength < 1) {
          fail("invalid-webp");
        }
      } else if (!extendedCanvas) {
        // Simple WebP contains only its single image bitstream. Metadata/unknown chunks require
        // an extended header so their feature flags and canvas are authoritative.
        fail("invalid-webp");
      }
    }
    offset = chunkEnd;
  }

  if (
    offset !== bytes.byteLength
    || imagePayloads !== 1
    || !imageDimensions
    || (extendedCanvas && (
      extendedCanvas.width !== imageDimensions.width
      || extendedCanvas.height !== imageDimensions.height
    ))
    || (alphaChunks > 0 && imageType !== "VP8 ")
    || (imageType === "VP8 " && alphaFlag !== (alphaChunks === 1))
    || (imageType === "VP8L" && (
      alphaChunks !== 0
      || (extendedCanvas !== null && alphaFlag !== intrinsicAlpha)
    ))
    || (extendedCanvas !== null && (
      iccpFlag !== (iccpChunks === 1)
      || exifFlag !== (exifChunks === 1)
      || xmpFlag !== (xmpChunks === 1)
    ))
  ) {
    fail("invalid-webp");
  }
  const admitted = extendedCanvas ?? imageDimensions;
  return { width: admitted.width, height: admitted.height };
}
