import { describe, expect, it } from "vitest";

import {
  STUDIO_BG3D_MODEL_THUMBNAIL_MAX_BYTES,
  inspectStudioBg3dModelThumbnailDataUrl,
  normalizeStudioBg3dModelThumbnailDataUrl,
} from "./studio-bg3d-model-thumbnail-data";

function uint32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, false);
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffff_ffff;
  for (let offset = start; offset < end; offset += 1) {
    crc ^= bytes[offset] ?? 0;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb8_8320 : 0);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(58);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  uint32(bytes, 8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  uint32(bytes, 16, width);
  uint32(bytes, 20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  uint32(bytes, 33, 1);
  bytes.set([0x49, 0x44, 0x41, 0x54], 37);
  bytes[41] = 0;
  bytes.set([0x49, 0x45, 0x4e, 0x44], 50);
  uint32(bytes, 29, crc32(bytes, 12, 29));
  uint32(bytes, 42, crc32(bytes, 37, 42));
  uint32(bytes, 54, crc32(bytes, 50, 54));
  return bytes;
}

function dataUrl(bytes: Uint8Array, mime = "image/png"): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${mime};base64,${btoa(binary)}`;
}

describe("Studio BG3D model thumbnail data admission", () => {
  it("returns exact decoded bytes and dimensions for a bounded canonical PNG", () => {
    const value = dataUrl(png(320, 180));
    expect(inspectStudioBg3dModelThumbnailDataUrl(value)).toEqual({
      dataUrl: value,
      mime: "image/png",
      byteLength: 58,
      width: 320,
      height: 180,
    });
    expect(normalizeStudioBg3dModelThumbnailDataUrl(value)).toBe(value);
  });

  it("rejects noncanonical base64, declared MIME mismatches, and truncated PNG structure", () => {
    const valid = dataUrl(png(1, 1));
    expect(inspectStudioBg3dModelThumbnailDataUrl(valid.replace(/.$/u, "!"))).toBeNull();
    expect(inspectStudioBg3dModelThumbnailDataUrl(valid.replace("image/png", "IMAGE/PNG"))).toBeNull();
    expect(inspectStudioBg3dModelThumbnailDataUrl(dataUrl(png(1, 1).slice(0, -1)))).toBeNull();
    expect(inspectStudioBg3dModelThumbnailDataUrl(valid.replace("image/png", "image/jpeg"))).toBeNull();
    expect(inspectStudioBg3dModelThumbnailDataUrl("https://example.invalid/thumb.png")).toBeNull();
  });

  it("fails closed on unsafe dimensions, pixel counts, and pre-decode byte budgets", () => {
    expect(inspectStudioBg3dModelThumbnailDataUrl(dataUrl(png(513, 1)))).toBeNull();
    expect(inspectStudioBg3dModelThumbnailDataUrl(dataUrl(png(512, 513)))).toBeNull();
    const oversizedPayload = "A".repeat(Math.ceil((STUDIO_BG3D_MODEL_THUMBNAIL_MAX_BYTES + 1) / 3) * 4);
    expect(inspectStudioBg3dModelThumbnailDataUrl(`data:image/png;base64,${oversizedPayload}`)).toBeNull();
  });

  it("does not accept duplicate IHDR, empty IDAT, trailing bytes, or unsupported PNG profiles", () => {
    const corruptCrc = png(16, 16);
    corruptCrc[42] ^= 1;
    expect(inspectStudioBg3dModelThumbnailDataUrl(dataUrl(corruptCrc))).toBeNull();

    const duplicateIhdr = png(16, 16);
    duplicateIhdr.set([0x49, 0x48, 0x44, 0x52], 37);
    expect(inspectStudioBg3dModelThumbnailDataUrl(dataUrl(duplicateIhdr))).toBeNull();

    const emptyIdat = png(16, 16);
    uint32(emptyIdat, 33, 0);
    expect(inspectStudioBg3dModelThumbnailDataUrl(dataUrl(emptyIdat))).toBeNull();

    const unsupportedProfile = png(16, 16);
    unsupportedProfile[25] = 3;
    expect(inspectStudioBg3dModelThumbnailDataUrl(dataUrl(unsupportedProfile))).toBeNull();

    const trailing = new Uint8Array(59);
    trailing.set(png(16, 16));
    expect(inspectStudioBg3dModelThumbnailDataUrl(dataUrl(trailing))).toBeNull();
  });
});
