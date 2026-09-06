/**
 * Print resolution metadata for raster exports — PNG `pHYs` and JPEG JFIF density.
 *
 * Why this exists: `canvas.toBlob()` never records physical resolution. A print shop that
 * receives such a file places it at the container default (72 DPI) no matter what the studio
 * UI promised, so a "300 DPI 인쇄 원고" silently becomes a 72 DPI placement. These helpers
 * rewrite the container bytes only — **pixels and colors are never touched** — so the web
 * export path keeps byte-identical image data and only gains an honest density tag.
 *
 * Format support is deliberately narrow and honest:
 *  - PNG  → `pHYs` chunk (pixels-per-metre, unit specifier 1 = metre).
 *  - JPEG → JFIF APP0 density (units 1 = dots/inch), inserting an APP0 when the encoder
 *           omitted it (Chrome's canvas JPEG has no JFIF APP0).
 *  - WebP → not supported. Density requires an extended (VP8X) container with an EXIF chunk;
 *           rewriting a simple-format WebP into VP8X is a re-mux, not a tag, so we refuse
 *           rather than pretend.
 *  - QOI  → the QOI specification has no resolution field at all (header is width/height/
 *           channels/colorspace). Nothing to write.
 *
 * The published-resolution channel at the bottom is a module-scoped single value on purpose:
 * the export geometry editor (StudioExportMenuPanel) unmounts when the menu closes, while the
 * toolbar 다운로드 button lives in another component tree. The last geometry the author chose
 * therefore has to outlive the panel; it is never cleared on unmount.
 */

/** Metres per inch — `pHYs` stores pixels per metre, JFIF stores dots per inch. */
export const METRES_PER_INCH = 0.0254;

const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** JFIF APP0 density is a uint16 pair. */
const MAX_JFIF_DENSITY = 65_535;
/** pHYs pixels-per-metre is a uint32 pair; the DPI range we accept stays far below it. */
const MAX_DPI = 100_000;

export type StudioRasterResolutionTagKind = "png-phys" | "jpeg-jfif" | "none";

export interface StudioRasterResolutionReading {
  readonly dpiX: number;
  readonly dpiY: number;
}

/** Round-trip helpers for the two density encodings. */
export function dpiToPixelsPerMetre(dpi: number): number {
  return Math.round(dpi / METRES_PER_INCH);
}

export function pixelsPerMetreToDpi(pixelsPerMetre: number): number {
  return pixelsPerMetre * METRES_PER_INCH;
}

/** Which container tag (if any) can carry resolution for a MIME type. */
export function rasterResolutionTagKind(mimeType: string): StudioRasterResolutionTagKind {
  const type = mimeType.trim().toLowerCase();
  if (type === "image/png") return "png-phys";
  if (type === "image/jpeg" || type === "image/jpg") return "jpeg-jfif";
  return "none";
}

function isUsableDpi(dpi: number): boolean {
  return Number.isFinite(dpi) && dpi > 0 && dpi <= MAX_DPI;
}

// ---------------------------------------------------------------------------
// PNG — pHYs
// ---------------------------------------------------------------------------

let crcTable: Uint32Array | null = null;

function pngCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  crcTable = table;
  return table;
}

function pngCrc32(bytes: Uint8Array): number {
  const table = pngCrcTable();
  let crc = 0xff_ff_ff_ff;
  for (const byte of bytes) {
    crc = (table[(crc ^ byte) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

export function isPngBytes(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0
  );
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function pngChunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
}

function buildPngPhysChunk(dpiX: number, dpiY: number): Uint8Array {
  // length(4) + "pHYs"(4) + ppuX(4) + ppuY(4) + unit(1) + crc(4)
  const chunk = new Uint8Array(21);
  writeUint32(chunk, 0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  writeUint32(chunk, 8, dpiToPixelsPerMetre(dpiX));
  writeUint32(chunk, 12, dpiToPixelsPerMetre(dpiY));
  chunk[16] = 1; // unit specifier: metre
  writeUint32(chunk, 17, pngCrc32(chunk.subarray(4, 17)));
  return chunk;
}

/**
 * Return PNG bytes carrying a `pHYs` density. Any pre-existing `pHYs` is replaced and the new
 * chunk is written directly after IHDR (the spec only requires it before the first IDAT).
 * Non-PNG or structurally unreadable input is returned untouched — never corrupt an export.
 */
export function withPngPhysDensity(bytes: Uint8Array, dpiX: number, dpiY = dpiX): Uint8Array {
  if (!isPngBytes(bytes) || !isUsableDpi(dpiX) || !isUsableDpi(dpiY)) return bytes;

  const kept: { start: number; end: number }[] = [];
  let insertAfter = -1;
  let offset = PNG_SIGNATURE.length;
  let sawEnd = false;
  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const end = offset + 12 + length;
    if (!Number.isSafeInteger(end) || end > bytes.length) return bytes;
    const type = pngChunkType(bytes, offset + 4);
    if (type !== "pHYs") kept.push({ start: offset, end });
    if (type === "IHDR") insertAfter = kept.length;
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
    offset = end;
  }
  if (!sawEnd || insertAfter < 0) return bytes;

  const physChunk = buildPngPhysChunk(dpiX, dpiY);
  const total =
    PNG_SIGNATURE.length
    + physChunk.length
    + kept.reduce((sum, chunk) => sum + (chunk.end - chunk.start), 0);
  const output = new Uint8Array(total);
  output.set(bytes.subarray(0, PNG_SIGNATURE.length), 0);
  let cursor = PNG_SIGNATURE.length;
  kept.forEach((chunk, index) => {
    output.set(bytes.subarray(chunk.start, chunk.end), cursor);
    cursor += chunk.end - chunk.start;
    if (index + 1 === insertAfter) {
      output.set(physChunk, cursor);
      cursor += physChunk.length;
    }
  });
  return output;
}

/** Actual pixel size straight from IHDR — the encoded truth, not a predicted one. */
export function readPngPixelSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (!isPngBytes(bytes) || bytes.length < 24) return null;
  // IHDR is required to be the first chunk: sig(8) + length(4) + type(4) → data at 16.
  if (pngChunkType(bytes, 12) !== "IHDR") return null;
  const width = readUint32(bytes, 16);
  const height = readUint32(bytes, 20);
  if (width < 1 || height < 1) return null;
  return { width, height };
}

/** Read a PNG `pHYs` density back as DPI — measurement/verification helper. */
export function readPngPhysDensity(bytes: Uint8Array): StudioRasterResolutionReading | null {
  if (!isPngBytes(bytes)) return null;
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const end = offset + 12 + length;
    if (!Number.isSafeInteger(end) || end > bytes.length) return null;
    if (pngChunkType(bytes, offset + 4) === "pHYs" && length === 9) {
      const unit = bytes[offset + 16]!;
      if (unit !== 1) return null;
      return {
        dpiX: pixelsPerMetreToDpi(readUint32(bytes, offset + 8)),
        dpiY: pixelsPerMetreToDpi(readUint32(bytes, offset + 12)),
      };
    }
    if (pngChunkType(bytes, offset + 4) === "IDAT") return null;
    offset = end;
  }
  return null;
}

// ---------------------------------------------------------------------------
// JPEG — JFIF APP0 density
// ---------------------------------------------------------------------------

const JFIF_IDENTIFIER = Object.freeze([0x4a, 0x46, 0x49, 0x46, 0x00]); // "JFIF\0"

export function isJpegBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function hasJfifApp0(bytes: Uint8Array): boolean {
  if (bytes.length < 20) return false;
  if (bytes[2] !== 0xff || bytes[3] !== 0xe0) return false;
  return JFIF_IDENTIFIER.every((byte, index) => bytes[6 + index] === byte);
}

function clampDensity(dpi: number): number {
  return Math.min(MAX_JFIF_DENSITY, Math.max(1, Math.round(dpi)));
}

/**
 * Return JPEG bytes whose JFIF APP0 declares the density in dots per inch. When the encoder
 * emitted no JFIF APP0 (Chrome's canvas JPEG), a minimal 18-byte APP0 is inserted right after
 * SOI, which is where JFIF requires it.
 */
export function withJpegJfifDensity(bytes: Uint8Array, dpiX: number, dpiY = dpiX): Uint8Array {
  if (!isJpegBytes(bytes) || !isUsableDpi(dpiX) || !isUsableDpi(dpiY)) return bytes;
  const densityX = clampDensity(dpiX);
  const densityY = clampDensity(dpiY);

  if (hasJfifApp0(bytes)) {
    const output = new Uint8Array(bytes);
    output[13] = 1; // units: dots per inch
    output[14] = (densityX >> 8) & 0xff;
    output[15] = densityX & 0xff;
    output[16] = (densityY >> 8) & 0xff;
    output[17] = densityY & 0xff;
    return output;
  }

  const app0 = new Uint8Array([
    0xff, 0xe0, 0x00, 0x10, // APP0, length 16
    ...JFIF_IDENTIFIER,
    0x01, 0x02, // JFIF 1.02
    0x01, // units: dots per inch
    (densityX >> 8) & 0xff, densityX & 0xff,
    (densityY >> 8) & 0xff, densityY & 0xff,
    0x00, 0x00, // no thumbnail
  ]);
  const output = new Uint8Array(bytes.length + app0.length);
  output.set(bytes.subarray(0, 2), 0);
  output.set(app0, 2);
  output.set(bytes.subarray(2), 2 + app0.length);
  return output;
}

/**
 * Actual pixel size from the JPEG frame header (SOF0/1/2/…), skipping the marker segments
 * before it. `FFC4` (DHT), `FFC8` (JPG) and `FFCC` (DAC) share the C-range but are not frames.
 */
export function readJpegPixelSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (!isJpegBytes(bytes)) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    // Standalone markers carry no length payload.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / start of scan — no frame found
    const length = ((bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      const height = ((bytes[offset + 5]! << 8) | bytes[offset + 6]!) >>> 0;
      const width = ((bytes[offset + 7]! << 8) | bytes[offset + 8]!) >>> 0;
      if (width < 1 || height < 1) return null;
      return { width, height };
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

/** Read JFIF density back as DPI (returns null when the unit is aspect-ratio-only). */
export function readJpegJfifDensity(bytes: Uint8Array): StudioRasterResolutionReading | null {
  if (!isJpegBytes(bytes) || !hasJfifApp0(bytes)) return null;
  const units = bytes[13]!;
  const densityX = ((bytes[14]! << 8) | bytes[15]!) >>> 0;
  const densityY = ((bytes[16]! << 8) | bytes[17]!) >>> 0;
  if (units === 1) return { dpiX: densityX, dpiY: densityY };
  if (units === 2) return { dpiX: densityX * 2.54, dpiY: densityY * 2.54 };
  return null;
}

// ---------------------------------------------------------------------------
// Shared entry point
// ---------------------------------------------------------------------------

/** Apply the resolution tag a MIME type can actually carry; other types pass through. */
export function withRasterResolutionMetadata(
  bytes: Uint8Array,
  mimeType: string,
  dpi: number
): Uint8Array {
  const kind = rasterResolutionTagKind(mimeType);
  if (kind === "png-phys") return withPngPhysDensity(bytes, dpi);
  if (kind === "jpeg-jfif") return withJpegJfifDensity(bytes, dpi);
  return bytes;
}

// ---------------------------------------------------------------------------
// Published export resolution — panel → toolbar download channel
// ---------------------------------------------------------------------------

let publishedDpi: number | null = null;
let publishedPrintBoxMm: { widthMm: number; heightMm: number } | null = null;

/** Millimetres per inch — the physical-size conversion the print box needs. */
const MM_PER_INCH = 25.4;

/**
 * Physical output box (trim + bleed) the export is meant to fill, in millimetres.
 *
 * Publishing this makes the density **measured rather than predicted**: at tag time we read the
 * encoded file's own pixel dimensions and divide by the box. That matters because the studio
 * cannot predict the exact output size — the export runs `stage.toCanvas({ pixelRatio:
 * exportScale / effectiveScale })`, and that float division truncates to a pixel count that
 * depends on the editor's current zoom (measured: 1080 px at 3.55× lands on 3833 or 3834
 * depending on `effectiveScale`). A predicted DPI would be off by the same pixel, which is a
 * physical-size error at the print shop. `null` falls back to the published flat DPI.
 */
export function publishStudioExportPrintBoxMm(
  box: { widthMm: number; heightMm: number } | null
): void {
  publishedPrintBoxMm =
    box != null
    && Number.isFinite(box.widthMm)
    && Number.isFinite(box.heightMm)
    && box.widthMm > 0
    && box.heightMm > 0
      ? box
      : null;
}

export function readStudioExportPrintBoxMm(): { widthMm: number; heightMm: number } | null {
  return publishedPrintBoxMm;
}

/** Actual pixel size for any container we can tag; null when the bytes are unreadable. */
export function readRasterPixelSize(
  bytes: Uint8Array,
  mimeType: string
): { width: number; height: number } | null {
  const kind = rasterResolutionTagKind(mimeType);
  if (kind === "png-phys") return readPngPixelSize(bytes);
  if (kind === "jpeg-jfif") return readJpegPixelSize(bytes);
  return null;
}

/**
 * DPI the given pixels really achieve against a physical box, using the limiting axis — the one
 * that still covers the whole box. Same rule the export preflight reports, so the number in the
 * UI and the number in the file bytes come from one definition.
 */
export function dpiForPixelsInBox(
  pixels: { width: number; height: number },
  box: { widthMm: number; heightMm: number }
): number {
  return Math.min(
    pixels.width / (box.widthMm / MM_PER_INCH),
    pixels.height / (box.heightMm / MM_PER_INCH)
  );
}

/**
 * Publish the DPI that subsequent raster exports should declare. `null` means "do not tag",
 * which is the pre-open default so an author who never touches export geometry keeps
 * byte-identical output. Never cleared on panel unmount — the toolbar download happens after
 * the geometry editor closes.
 */
export function publishStudioExportResolutionDpi(dpi: number | null): void {
  publishedDpi = dpi != null && isUsableDpi(dpi) ? dpi : null;
}

export function readStudioExportResolutionDpi(): number | null {
  return publishedDpi;
}

/** Test-only reset so a published resolution cannot leak between cases. */
export function resetStudioExportResolutionDpi(): void {
  publishedDpi = null;
  publishedPrintBoxMm = null;
}

/**
 * Tag an encoded raster blob with the published resolution. Returns the original blob when no
 * resolution is published or the container cannot carry one, so callers can await
 * unconditionally without changing existing output.
 */
export async function tagStudioRasterBlobResolution(blob: Blob, mimeType: string): Promise<Blob> {
  const dpi = publishedDpi;
  const box = publishedPrintBoxMm;
  if (dpi == null && box == null) return blob;
  if (rasterResolutionTagKind(mimeType) === "none") return blob;
  const source = new Uint8Array(await blob.arrayBuffer());
  // Prefer the density measured off the encoded pixels; the published DPI is only a fallback
  // for screen packs (no print box) or bytes whose header we could not read.
  const measuredPixels = box ? readRasterPixelSize(source, mimeType) : null;
  const effectiveDpi =
    box && measuredPixels ? dpiForPixelsInBox(measuredPixels, box) : dpi;
  if (effectiveDpi == null || !isUsableDpi(effectiveDpi)) return blob;
  const tagged = withRasterResolutionMetadata(source, mimeType, effectiveDpi);
  if (tagged === source) return blob;
  return new Blob([tagged as unknown as BlobPart], { type: blob.type || mimeType });
}
