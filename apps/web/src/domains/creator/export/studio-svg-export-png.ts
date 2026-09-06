import {
  rasterizeStudioBrushSoftFalloffMaskRgba,
  STUDIO_BRUSH_SOFT_FALLOFF_LINEAR_ACCUMULATION_TONE,
  STUDIO_BRUSH_SOFT_FALLOFF_STAMP_GUTTER_PIXELS,
  STUDIO_BRUSH_SOFT_FALLOFF_STAMP_RESOLUTION,
  type StudioBrushSoftFalloffStampTone,
} from "../brush/studio-brush-soft-falloff-stamp";
import { rasterizeStudioBrushTextureMaskRgba } from "../brush/studio-brush-textured-stamp";
import {
  encodeStudioBrushTipAlphaMapBase64,
  type StudioBrushTipAlphaMap,
} from "../brush/studio-brush-tip-stamp";
import { calculateStudioCrc32 } from "../studio-crc32";

export const STUDIO_SVG_BRUSH_TEXTURE_SERIALIZED_UTF16_BYTE_BUDGET =
  64 * 1_024 * 1_024;

export interface SvgExportPngContext {
  seq: number;
  defs: string[];
  brushTextureAssets: Map<string, Readonly<{ symbolId: string; size: number }>>;
  brushTextureAssetsByAlphaMap: WeakMap<
    StudioBrushTipAlphaMap,
    Readonly<{ symbolId: string; size: number }>
  >;
  brushTextureSerializedUtf16Bytes: number;
}

export function nextId(ctx: { seq: number }, prefix: string): string {
  ctx.seq += 1;
  return `${prefix}${ctx.seq}`;
}

export function joinSvgPngBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const byteLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export function svgPngChunk(type: string, data: Uint8Array): Uint8Array | null {
  if (!/^[A-Za-z]{4}$/u.test(type)) return null;
  const output = new Uint8Array(12 + data.byteLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.byteLength, false);
  for (let index = 0; index < 4; index += 1) {
    output[4 + index] = type.charCodeAt(index);
  }
  output.set(data, 8);
  const checksumSource = output.subarray(4, 8 + data.byteLength);
  view.setUint32(
    8 + data.byteLength,
    calculateStudioCrc32(checksumSource),
    false,
  );
  return output;
}

export function svgPngAdler32(bytes: Uint8Array): number {
  let low = 1;
  let high = 0;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    low = (low + bytes[index]!) % 65_521;
    high = (high + low) % 65_521;
  }
  return ((high << 16) | low) >>> 0;
}

/** Browser-safe zlib stream with deterministic uncompressed DEFLATE blocks. */
export function svgPngStoredZlib(bytes: Uint8Array): Uint8Array {
  const blockCount = Math.max(1, Math.ceil(bytes.byteLength / 65_535));
  const output = new Uint8Array(2 + blockCount * 5 + bytes.byteLength + 4);
  const view = new DataView(output.buffer);
  output.set([0x78, 0x01], 0);
  let sourceOffset = 0;
  let outputOffset = 2;
  for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
    const length = Math.min(65_535, bytes.byteLength - sourceOffset);
    output[outputOffset] = blockIndex === blockCount - 1 ? 1 : 0;
    outputOffset += 1;
    view.setUint16(outputOffset, length, true);
    view.setUint16(outputOffset + 2, length ^ 0xffff, true);
    outputOffset += 4;
    output.set(bytes.subarray(sourceOffset, sourceOffset + length), outputOffset);
    sourceOffset += length;
    outputOffset += length;
  }
  view.setUint32(outputOffset, svgPngAdler32(bytes), false);
  return output;
}

/**
 * Losslessly embeds an ImageData-compatible RGBA snapshot. Filter byte zero and stored DEFLATE
 * make the result synchronous, platform-independent and byte-deterministic.
 */
export function encodeSvgBrushTexturePng(
  pixels: Uint8ClampedArray,
  size: number,
): Uint8Array | null {
  if (
    !Number.isSafeInteger(size)
    || size <= 0
    || size > 512
    || pixels.byteLength !== size * size * 4
  ) return null;
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, size, false);
  headerView.setUint32(4, size, false);
  header.set([8, 6, 0, 0, 0], 8);

  const scanlineBytes = size * 4 + 1;
  const scanlines = new Uint8Array(scanlineBytes * size);
  for (let row = 0; row < size; row += 1) {
    const targetOffset = row * scanlineBytes;
    scanlines[targetOffset] = 0;
    scanlines.set(
      pixels.subarray(row * size * 4, (row + 1) * size * 4),
      targetOffset + 1,
    );
  }
  const headerChunk = svgPngChunk("IHDR", header);
  const dataChunk = svgPngChunk("IDAT", svgPngStoredZlib(scanlines));
  const endChunk = svgPngChunk("IEND", new Uint8Array());
  if (!headerChunk || !dataChunk || !endChunk) return null;
  return joinSvgPngBytes([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    headerChunk,
    dataChunk,
    endChunk,
  ]);
}

/**
 * Defines one alpha-only texture carrier. A white lossless PNG is used as an SVG alpha mask, so
 * every `<use>` can supply its own dynamic colour without duplicating the alpha asset.
 */
export function svgBrushTextureAsset(
  ctx: SvgExportPngContext,
  cacheKey: string,
  size: number,
  createPixels: () => Uint8ClampedArray | null,
): Readonly<{ symbolId: string; size: number }> | null {
  const cached = ctx.brushTextureAssets.get(cacheKey);
  if (cached) return cached;
  const pixels = createPixels();
  if (!pixels) return null;
  const png = encodeSvgBrushTexturePng(pixels, size);
  if (!png) return null;
  const dataUrl = `data:image/png;base64,${encodeStudioBrushTipAlphaMapBase64(png)}`;

  const symbolId = nextId(ctx, "sbt");
  const maskId = `${symbolId}m`;
  const asset = Object.freeze({ symbolId, size });
  const definition =
    `<symbol data-brush-tip-asset="full-alpha-map-v1" id="${symbolId}" viewBox="0 0 ${size} ${size}" preserveAspectRatio="none">`
      + `<mask id="${maskId}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${size}" height="${size}" mask-type="alpha">`
      + `<image x="0" y="0" width="${size}" height="${size}" preserveAspectRatio="none" href="${dataUrl}"/>`
      + `</mask><rect x="0" y="0" width="${size}" height="${size}" fill="currentColor" mask="url(#${maskId})"/>`
      + `</symbol>`;
  const definitionUtf16Bytes = definition.length * 2;
  const nextSerializedUtf16Bytes =
    ctx.brushTextureSerializedUtf16Bytes + definitionUtf16Bytes;
  if (
    !Number.isSafeInteger(nextSerializedUtf16Bytes)
    || nextSerializedUtf16Bytes
      > STUDIO_SVG_BRUSH_TEXTURE_SERIALIZED_UTF16_BYTE_BUDGET
  ) {
    return null;
  }
  ctx.brushTextureSerializedUtf16Bytes = nextSerializedUtf16Bytes;
  ctx.brushTextureAssets.set(cacheKey, asset);
  ctx.defs.push(definition);
  return asset;
}

export function svgAlphaMapTextureAsset(
  ctx: SvgExportPngContext,
  alphaMap: StudioBrushTipAlphaMap,
  retainMapIdentity = true,
): Readonly<{ symbolId: string; size: number }> | null {
  if (retainMapIdentity) {
    const identityHit = ctx.brushTextureAssetsByAlphaMap.get(alphaMap);
    if (identityHit) return identityHit;
  }
  const revisionKey = alphaMap.revision === undefined
    ? null
    : JSON.stringify([
        "alpha-map-v1",
        typeof alphaMap.revision,
        alphaMap.revision,
        alphaMap.size,
      ]);
  if (revisionKey) {
    const revisionHit = ctx.brushTextureAssets.get(revisionKey);
    if (revisionHit) {
      if (retainMapIdentity) {
        ctx.brushTextureAssetsByAlphaMap.set(alphaMap, revisionHit);
      }
      return revisionHit;
    }
  }

  let pixels: Uint8ClampedArray | null = null;
  const createPixels = (): Uint8ClampedArray | null => {
    pixels ??= rasterizeStudioBrushTextureMaskRgba(alphaMap);
    return pixels;
  };
  const fallbackKey = revisionKey ?? (() => {
    const snapshot = createPixels();
    if (!snapshot) return "";
    const bytes = new Uint8Array(
      snapshot.buffer,
      snapshot.byteOffset,
      snapshot.byteLength,
    );
    return JSON.stringify([
      "alpha-map-external-v1",
      alphaMap.size,
      calculateStudioCrc32(bytes),
      encodeStudioBrushTipAlphaMapBase64(bytes),
    ]);
  })();
  if (!fallbackKey) return null;
  const asset = svgBrushTextureAsset(
    ctx,
    fallbackKey,
    alphaMap.size,
    createPixels,
  );
  if (asset && retainMapIdentity) {
    ctx.brushTextureAssetsByAlphaMap.set(alphaMap, asset);
  }
  return asset;
}

export function svgSoftFalloffTextureAsset(
  ctx: SvgExportPngContext,
  exponent: number,
  tone?: StudioBrushSoftFalloffStampTone,
): Readonly<{ symbolId: string; size: number }> | null {
  if (
    tone !== undefined
    && tone !== STUDIO_BRUSH_SOFT_FALLOFF_LINEAR_ACCUMULATION_TONE
  ) {
    return null;
  }
  const cacheKey = JSON.stringify([
    tone === STUDIO_BRUSH_SOFT_FALLOFF_LINEAR_ACCUMULATION_TONE
      ? "analytic-radial-linear-accumulation-v1"
      : "analytic-radial-v1",
    exponent.toString(),
    STUDIO_BRUSH_SOFT_FALLOFF_STAMP_RESOLUTION,
    STUDIO_BRUSH_SOFT_FALLOFF_STAMP_GUTTER_PIXELS,
  ]);
  const surfaceSize = STUDIO_BRUSH_SOFT_FALLOFF_STAMP_RESOLUTION
    + STUDIO_BRUSH_SOFT_FALLOFF_STAMP_GUTTER_PIXELS * 2;
  return svgBrushTextureAsset(
    ctx,
    cacheKey,
    surfaceSize,
    () => rasterizeStudioBrushSoftFalloffMaskRgba(
      exponent,
      STUDIO_BRUSH_SOFT_FALLOFF_STAMP_RESOLUTION,
      tone,
    )?.pixels ?? null,
  );
}
