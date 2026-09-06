import { describe, expect, it } from "vitest";

import {
  EXPORT_FORMATS,
  JPEG_QUALITY,
  MAX_CANVAS_DIM,
  StudioRasterCodecUnavailableError,
  WEBP_QUALITY,
  canCopyImageToClipboard,
  canvasToBlob,
  copyCanvasToClipboard,
  detectStudioCanvasRasterMime,
  exportFormatLabel,
  exportMimeType,
  exportQuality,
  maxFittingScale,
  pageExportFileName,
  splitPagesForExport,
  stripExportFileName,
  stripTotalHeight,
} from "./studio-export";

describe("exportMimeType", () => {
  it("maps formats to canvas mime types", () => {
    expect(exportMimeType("png")).toBe("image/png");
    expect(exportMimeType("jpg")).toBe("image/jpeg");
    expect(exportMimeType("webp")).toBe("image/webp");
  });
});

describe("EXPORT_FORMATS", () => {
  it("lists every supported format once", () => {
    expect(EXPORT_FORMATS).toEqual(["png", "jpg", "webp"]);
  });
});

describe("exportFormatLabel", () => {
  it("returns a human label per format", () => {
    expect(exportFormatLabel("png")).toBe("PNG");
    expect(exportFormatLabel("jpg")).toBe("JPG");
    expect(exportFormatLabel("webp")).toBe("WebP");
  });
});

describe("exportQuality", () => {
  it("returns the lossy quality only for jpg/webp", () => {
    expect(exportQuality("png")).toBeUndefined();
    expect(exportQuality("jpg")).toBe(JPEG_QUALITY);
    expect(exportQuality("webp")).toBe(WEBP_QUALITY);
  });
});

describe("canvasToBlob exact codec", () => {
  const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0);
  const webp = new TextEncoder().encode("RIFF0000WEBP");

  function canvasReturning(bytes: Uint8Array, actualType: string): HTMLCanvasElement {
    return {
      toBlob(callback: BlobCallback) {
        callback(new Blob([bytes as unknown as BlobPart], { type: actualType }));
      },
    } as HTMLCanvasElement;
  }

  it("accepts PNG, JPEG, and WebP only when MIME and container magic both match", async () => {
    await expect(canvasToBlob(canvasReturning(png, "image/png"), "image/png"))
      .resolves.toMatchObject({ type: "image/png" });
    await expect(canvasToBlob(canvasReturning(jpeg, "image/jpeg"), "image/jpeg"))
      .resolves.toMatchObject({ type: "image/jpeg" });
    await expect(canvasToBlob(canvasReturning(webp, "image/webp"), "image/webp"))
      .resolves.toMatchObject({ type: "image/webp" });
    expect(detectStudioCanvasRasterMime(png)).toBe("image/png");
    expect(detectStudioCanvasRasterMime(jpeg)).toBe("image/jpeg");
    expect(detectStudioCanvasRasterMime(webp)).toBe("image/webp");
  });

  it("rejects the browser's PNG substitution for a requested JPEG", async () => {
    const failure = canvasToBlob(canvasReturning(png, "image/png"), "image/jpeg");
    await expect(failure).rejects.toBeInstanceOf(StudioRasterCodecUnavailableError);
    await expect(failure).rejects.toMatchObject({
      requestedMime: "image/jpeg",
      actualMime: "image/png",
      detectedMime: "image/png",
    });
  });

  it("rejects a matching MIME label when the encoded bytes are another container", async () => {
    await expect(canvasToBlob(canvasReturning(png, "image/webp"), "image/webp"))
      .rejects.toMatchObject({
        name: "StudioRasterCodecUnavailableError",
        requestedMime: "image/webp",
        actualMime: "image/webp",
        detectedMime: "image/png",
      });
  });
});

describe("pageExportFileName", () => {
  it("keeps the legacy naming rule including the transparent suffix", () => {
    expect(pageExportFileName("내 컷툰", "png", false)).toBe("내 컷툰.png");
    expect(pageExportFileName("내 컷툰", "png", true)).toBe("내 컷툰-transparent.png");
    expect(pageExportFileName("  ", "jpg", false)).toBe("toonspectrum-comic.jpg");
    expect(pageExportFileName("내 컷툰", "webp", false)).toBe("내 컷툰.webp");
  });
});

describe("stripExportFileName", () => {
  it("keeps the legacy strip name for a single file", () => {
    expect(stripExportFileName("내 웹툰", "png")).toBe("내 웹툰-strip.png");
    expect(stripExportFileName("", "png", { index: 0, total: 1 })).toBe("toonspectrum-webtoon-strip.png");
  });

  it("appends a part suffix when split into multiple files", () => {
    expect(stripExportFileName("내 웹툰", "jpg", { index: 0, total: 3 })).toBe("내 웹툰-strip-1of3.jpg");
    expect(stripExportFileName("내 웹툰", "png", { index: 2, total: 3 })).toBe("내 웹툰-strip-3of3.png");
    expect(stripExportFileName("내 웹툰", "webp", { index: 1, total: 3 })).toBe("내 웹툰-strip-2of3.webp");
  });
});

describe("stripTotalHeight", () => {
  it("sums page heights with spacing between pages only", () => {
    expect(stripTotalHeight([1080, 1080, 1080], 24)).toBe(1080 * 3 + 24 * 2);
    expect(stripTotalHeight([1080], 24)).toBe(1080);
    expect(stripTotalHeight([], 24)).toBe(0);
  });

  it("scales the whole strip including spacing", () => {
    expect(stripTotalHeight([1080, 1080], 24, 2)).toBe((1080 * 2 + 24) * 2);
  });
});

describe("maxFittingScale", () => {
  it("returns the requested scale when it already fits", () => {
    expect(maxFittingScale([1080, 1080, 1080], 24, 2)).toBe(2);
  });

  it("downgrades to the largest fitting scale", () => {
    // 5페이지 × 2880px ≈ 14,496px → 2×(28,992)는 한계 초과, 1×는 통과.
    const heights = Array.from({ length: 5 }, () => 2880);
    expect(stripTotalHeight(heights, 24, 2)).toBeGreaterThan(MAX_CANVAS_DIM);
    expect(maxFittingScale(heights, 24, 2)).toBe(1);
  });

  it("returns null when even 1x exceeds the limit", () => {
    const heights = Array.from({ length: 12 }, () => 2880);
    expect(maxFittingScale(heights, 24, 3)).toBeNull();
  });
});

describe("splitPagesForExport", () => {
  it("keeps everything in one chunk when it fits", () => {
    expect(splitPagesForExport([1080, 1080, 1080], 24, 2)).toEqual([[0, 1, 2]]);
  });

  it("splits consecutive pages so each file stays under the limit", () => {
    // 2880px × 2배율 = 5760px/페이지 → 파일당 2장(11,568px)까지, 3장(17,376px)은 초과.
    const heights = Array.from({ length: 6 }, () => 2880);
    expect(splitPagesForExport(heights, 24, 2)).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });

  it("keeps an oversized single page as its own chunk", () => {
    expect(splitPagesForExport([20000, 1080], 24, 1)).toEqual([[0], [1]]);
  });

  it("covers every page exactly once in order", () => {
    const heights = [1080, 2880, 6000, 480, 2880, 1080];
    const chunks = splitPagesForExport(heights, 24, 3);
    expect(chunks.flat()).toEqual([0, 1, 2, 3, 4, 5]);
    for (const chunk of chunks) {
      const chunkHeights = chunk.map((i) => heights[i]);
      // 한 묶음짜리 초대형 페이지를 빼면 모든 파일이 한계 안이어야 한다.
      if (chunk.length > 1) {
        expect(stripTotalHeight(chunkHeights, 24, 3)).toBeLessThanOrEqual(MAX_CANVAS_DIM);
      }
    }
  });
});

describe("canCopyImageToClipboard", () => {
  it("returns a boolean without throwing in the node env", () => {
    // node 환경엔 navigator/ClipboardItem이 없어 false가 기대값 — 호출 자체가 안전해야 한다.
    const result = canCopyImageToClipboard();
    expect(typeof result).toBe("boolean");
    expect(result).toBe(false);
  });
});

describe("copyCanvasToClipboard", () => {
  it("rejects with the Korean unsupported message when clipboard image copy is unavailable", async () => {
    // node 환경: canCopyImageToClipboard()가 false라 캔버스 없이도 가드에서 즉시 거부된다.
    await expect(copyCanvasToClipboard(undefined as unknown as HTMLCanvasElement)).rejects.toThrow(
      "이 브라우저는 이미지 클립보드 복사를 지원하지 않아요."
    );
  });
});
