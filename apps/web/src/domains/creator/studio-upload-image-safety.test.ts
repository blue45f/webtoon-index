import { describe, expect, it } from "vitest";

import {
  STUDIO_ASSET_DATA_URL_MAX_CHARS,
  STUDIO_UPLOAD_DESKTOP_MAX_DECODED_PIXELS,
  STUDIO_UPLOAD_MAX_SOURCE_FILE_BYTES,
  STUDIO_UPLOAD_MOBILE_MAX_DECODED_PIXELS,
  StudioUploadImageSafetyError,
  assertStudioUploadDecodedPixels,
  assertStudioUploadSourceBatch,
  inspectStudioUploadSourceImage,
  parseStudioUploadImageDimensions,
  selectStudioUploadDecodedPixelLimit,
} from "./studio-upload-image-safety";

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function jpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
  ]);
}

describe("studio upload source image safety", () => {
  it("keeps the shared asset data URL budget at 32 MiB", () => {
    expect(STUDIO_ASSET_DATA_URL_MAX_CHARS).toBe(32 * 1024 * 1024);
  });

  it("PNG/JPEG 헤더에서 decode 전 실제 픽셀 수를 읽는다", () => {
    expect(parseStudioUploadImageDimensions(png(720, 12_000))).toEqual({
      format: "png",
      width: 720,
      height: 12_000,
      pixels: 8_640_000,
    });
    expect(parseStudioUploadImageDimensions(jpeg(4_000, 3_000))).toMatchObject({
      format: "jpeg",
      width: 4_000,
      height: 3_000,
      pixels: 12_000_000,
    });
    expect(() => parseStudioUploadImageDimensions(new Uint8Array([1, 2, 3]))).toThrow(
      StudioUploadImageSafetyError
    );
  });

  it("모바일/coarse/저메모리 장치에는 더 보수적인 decode 예산을 사용한다", () => {
    expect(selectStudioUploadDecodedPixelLimit({ coarsePointer: false, deviceMemoryGb: 8 })).toBe(
      STUDIO_UPLOAD_DESKTOP_MAX_DECODED_PIXELS
    );
    expect(selectStudioUploadDecodedPixelLimit({ coarsePointer: true, deviceMemoryGb: 8 })).toBe(
      STUDIO_UPLOAD_MOBILE_MAX_DECODED_PIXELS
    );
    expect(selectStudioUploadDecodedPixelLimit({ coarsePointer: false, deviceMemoryGb: 4 })).toBe(
      STUDIO_UPLOAD_MOBILE_MAX_DECODED_PIXELS
    );
  });

  it("개별 12MB와 선택 묶음 48MB 원본 상한을 decode 전에 적용한다", () => {
    expect(
      assertStudioUploadSourceBatch([
        { name: "one.png", size: STUDIO_UPLOAD_MAX_SOURCE_FILE_BYTES, type: "image/png" },
      ])
    ).toBe(STUDIO_UPLOAD_MAX_SOURCE_FILE_BYTES);
    expect(() =>
      assertStudioUploadSourceBatch([
        { name: "large.png", size: STUDIO_UPLOAD_MAX_SOURCE_FILE_BYTES + 1, type: "image/png" },
      ])
    ).toThrow(/12MB/);
    expect(() =>
      assertStudioUploadSourceBatch(
        Array.from({ length: 5 }, (_, index) => ({
          name: `${index}.jpg`,
          size: 10 * 1024 * 1024,
          type: "image/jpeg",
        }))
      )
    ).toThrow(/48MB/);
    expect(() =>
      assertStudioUploadSourceBatch([{ name: "vector.svg", size: 100, type: "image/svg+xml" }])
    ).toThrow(/지원하지 않습니다/);
  });

  it("긴 이미지가 장치 픽셀 예산을 넘으면 페이지 분할 안내와 함께 거부한다", () => {
    const image = parseStudioUploadImageDimensions(png(720, 12_000));
    expect(() =>
      assertStudioUploadDecodedPixels(image, STUDIO_UPLOAD_MOBILE_MAX_DECODED_PIXELS, "long.png")
    ).toThrow(/여러 페이지로 나눠/);
    expect(
      assertStudioUploadDecodedPixels(image, STUDIO_UPLOAD_DESKTOP_MAX_DECODED_PIXELS, "long.png")
    ).toBe(image);
  });

  it("MIME과 실제 헤더 불일치도 downscale 전에 거부한다", async () => {
    const bytes = png(800, 600);
    await expect(
      inspectStudioUploadSourceImage(
        {
          name: "spoofed.jpg",
          size: bytes.byteLength,
          type: "image/jpeg",
          arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
        },
        STUDIO_UPLOAD_DESKTOP_MAX_DECODED_PIXELS
      )
    ).rejects.toThrow(/일치하지 않습니다/);
  });
});
