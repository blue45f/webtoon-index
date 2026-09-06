import { describe, expect, it } from "vitest";

import {
  resolveStudioAdvancedFillBrowserMaxPixels,
  formatStudioAdvancedFillRasterSizeError,
  STUDIO_ADVANCED_FILL_BROWSER_MAX_PIXELS,
  STUDIO_ADVANCED_FILL_MOBILE_MAX_PIXELS,
  StudioAdvancedFillRasterSizeError,
  validateStudioAdvancedFillRasterDimensions,
  type StudioAdvancedFillRasterSizeErrorCode,
} from "./studio-advanced-fill-raster-safety";

function expectRejectedSize(
  width: unknown,
  height: unknown,
  code: StudioAdvancedFillRasterSizeErrorCode,
): StudioAdvancedFillRasterSizeError {
  try {
    validateStudioAdvancedFillRasterDimensions(width, height);
  } catch (error) {
    expect(error).toBeInstanceOf(StudioAdvancedFillRasterSizeError);
    expect(error).toMatchObject({ code, width, height });
    return error as StudioAdvancedFillRasterSizeError;
  }
  throw new Error("Expected raster dimensions to be rejected.");
}

describe("validateStudioAdvancedFillRasterDimensions", () => {
  it("uses a 4096² browser cap", () => {
    expect(STUDIO_ADVANCED_FILL_BROWSER_MAX_PIXELS).toBe(16_777_216);
    expect(validateStudioAdvancedFillRasterDimensions(4096, 4096)).toEqual({
      width: 4096,
      height: 4096,
      pixelCount: STUDIO_ADVANCED_FILL_BROWSER_MAX_PIXELS,
    });
  });

  it("accepts UHD 3840 × 2160", () => {
    expect(validateStudioAdvancedFillRasterDimensions(3840, 2160)).toEqual({
      width: 3840,
      height: 2160,
      pixelCount: 8_294_400,
    });
  });

  it("uses the UHD-safe lower cap on touch and memory-constrained devices", () => {
    expect(STUDIO_ADVANCED_FILL_MOBILE_MAX_PIXELS).toBe(8_388_608);
    expect(resolveStudioAdvancedFillBrowserMaxPixels({ coarsePointer: true })).toBe(
      STUDIO_ADVANCED_FILL_MOBILE_MAX_PIXELS,
    );
    expect(resolveStudioAdvancedFillBrowserMaxPixels({ maxTouchPoints: 5 })).toBe(
      STUDIO_ADVANCED_FILL_MOBILE_MAX_PIXELS,
    );
    expect(resolveStudioAdvancedFillBrowserMaxPixels({ deviceMemoryGb: 4 })).toBe(
      STUDIO_ADVANCED_FILL_MOBILE_MAX_PIXELS,
    );
    expect(resolveStudioAdvancedFillBrowserMaxPixels({ deviceMemoryGb: 8 })).toBe(
      STUDIO_ADVANCED_FILL_BROWSER_MAX_PIXELS,
    );
  });

  it("accepts UHD but rejects a 720 × 20,000 source under the mobile cap", () => {
    expect(validateStudioAdvancedFillRasterDimensions(3840, 2160, STUDIO_ADVANCED_FILL_MOBILE_MAX_PIXELS)).toEqual({
      width: 3840,
      height: 2160,
      pixelCount: 8_294_400,
    });
    expect(() =>
      validateStudioAdvancedFillRasterDimensions(720, 20_000, STUDIO_ADVANCED_FILL_MOBILE_MAX_PIXELS),
    ).toThrow(StudioAdvancedFillRasterSizeError);
  });

  it("accepts a 720 × 20,000 long-webtoon canvas", () => {
    expect(validateStudioAdvancedFillRasterDimensions(720, 20_000)).toEqual({
      width: 720,
      height: 20_000,
      pixelCount: 14_400_000,
    });
  });

  it("accepts the largest whole 720px-wide canvas below the cap and rejects the next row", () => {
    const maximumHeight = Math.floor(STUDIO_ADVANCED_FILL_BROWSER_MAX_PIXELS / 720);
    expect(maximumHeight).toBe(23_301);
    expect(validateStudioAdvancedFillRasterDimensions(720, maximumHeight).pixelCount).toBe(16_776_720);

    const error = expectRejectedSize(720, maximumHeight + 1, "pixel-cap-exceeded");
    expect(error.pixelCount).toBe(16_777_440);
  });

  it.each([
    [Number.NaN, 1],
    [1, Number.NaN],
    [Number.POSITIVE_INFINITY, 1],
    [1, Number.NEGATIVE_INFINITY],
    ["720", 20_000],
    [720, null],
  ])("rejects non-finite or non-number dimensions before allocation: %j × %j", (width, height) => {
    expectRejectedSize(width, height, "invalid-number");
  });

  it.each([
    [1.5, 1],
    [1, 2.25],
  ])("rejects fractional dimensions: %s × %s", (width, height) => {
    expectRejectedSize(width, height, "non-integer");
  });

  it.each([
    [Number.MAX_SAFE_INTEGER + 1, 1],
    [1, Number.MIN_SAFE_INTEGER - 1],
  ])("rejects unsafe integer dimensions: %s × %s", (width, height) => {
    expectRejectedSize(width, height, "unsafe-integer");
  });

  it.each([
    [0, 1],
    [1, 0],
    [-1, 1],
    [1, -1],
    [-0, 720],
  ])("rejects zero and negative dimensions: %s × %s", (width, height) => {
    expectRejectedSize(width, height, "non-positive");
  });

  it("rejects an unsafe width × height product before comparing it with the browser cap", () => {
    expectRejectedSize(Number.MAX_SAFE_INTEGER, 2, "pixel-count-overflow");
  });

  it("rejects a finite safe product one pixel row over the cap", () => {
    const error = expectRejectedSize(4096, 4097, "pixel-cap-exceeded");
    expect(error.pixelCount).toBe(16_781_312);
  });
});

describe("formatStudioAdvancedFillRasterSizeError", () => {
  it("formats cap failures as actionable Korean UI copy with exact dimensions", () => {
    const error = expectRejectedSize(4096, 4097, "pixel-cap-exceeded");
    const message = formatStudioAdvancedFillRasterSizeError(error);

    expect(message).toContain("브라우저 메모리 보호");
    expect(message).toContain("최대 16,777,216픽셀");
    expect(message).toContain("4,096 × 4,097 (16,781,312픽셀)");
    expect(message).toContain("이미지를 나누거나 해상도를 낮춘 뒤 다시 시도해 주세요");
  });

  it.each([
    [Number.NaN, 1, "invalid-number", "픽셀 정보를 확인할 수 없습니다"],
    [1.5, 1, "non-integer", "정수 픽셀이어야 합니다"],
    [0, 1, "non-positive", "1픽셀 이상이어야 합니다"],
    [Number.MAX_SAFE_INTEGER + 1, 1, "unsafe-integer", "안전하게 계산할 수 있는 크기"],
    [Number.MAX_SAFE_INTEGER, 2, "pixel-count-overflow", "안전하게 계산할 수 있는 크기"],
  ] as const)("formats %s failures with Korean guidance", (width, height, code, copy) => {
    const error = expectRejectedSize(width, height, code);
    expect(formatStudioAdvancedFillRasterSizeError(error)).toContain(copy);
    expect(formatStudioAdvancedFillRasterSizeError(error)).toMatch(/[가-힣]/);
  });

  it("provides safe Korean fallback copy for unrelated errors", () => {
    expect(formatStudioAdvancedFillRasterSizeError(new Error("internal"))).toBe(
      "고급 채우기용 이미지 크기를 확인하지 못했습니다. 이미지를 다시 불러온 뒤 시도해 주세요.",
    );
  });
});
