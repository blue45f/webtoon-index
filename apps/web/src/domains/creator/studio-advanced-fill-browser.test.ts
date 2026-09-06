import { describe, expect, it } from "vitest";

import {
  countChangedStudioAdvancedFillPixels,
  planStudioAdvancedFillGuard,
  softenStudioAdvancedFillEdges,
  studioAdvancedFillResultMessage,
  summarizeStudioAdvancedFillPreview,
  type StudioAdvancedFillBrowserResult,
} from "./studio-advanced-fill-browser";
import { DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS } from "./studio-advanced-fill-settings";

function pixels(values: number[]): Uint8ClampedArray {
  return new Uint8ClampedArray(values);
}

describe("softenStudioAdvancedFillEdges", () => {
  it("keeps fully surrounded interior pixels at the fill color", () => {
    const width = 3;
    const height = 3;
    const original = new Uint8ClampedArray(width * height * 4);
    const output = new Uint8ClampedArray(width * height * 4);
    const mask = new Uint8Array(width * height).fill(1);
    const fill = [240, 80, 40, 255] as const;
    for (let position = 0; position < width * height; position++) {
      output.set(fill, position * 4);
    }

    softenStudioAdvancedFillEdges(output, original, mask, width, height, fill);

    expect([...output.slice((1 * width + 1) * 4, (1 * width + 1) * 4 + 4)]).toEqual(fill);
  });

  it("softens the inside boundary without writing outside the mask", () => {
    const original = pixels([
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
    ]);
    const output = original.slice();
    const fill = [255, 0, 0, 255] as const;
    output.set(fill, 4);

    softenStudioAdvancedFillEdges(output, original, new Uint8Array([0, 1, 0]), 3, 1, fill);

    expect([...output.slice(0, 4)]).toEqual([255, 255, 255, 255]);
    expect([...output.slice(8, 12)]).toEqual([255, 255, 255, 255]);
    expect(output[4]).toBe(255);
    expect(output[5]).toBeGreaterThan(0);
    expect(output[5]).toBeLessThan(255);
  });

  it("creates a halo-free partial-alpha edge over transparent pixels", () => {
    const original = pixels([
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const output = original.slice();
    output.set([255, 24, 12, 255], 4);
    softenStudioAdvancedFillEdges(output, original, new Uint8Array([0, 1, 0]), 3, 1, [255, 24, 12, 255]);
    expect([...output.slice(4, 7)]).toEqual([255, 24, 12]);
    expect(output[7]).toBeGreaterThan(0);
    expect(output[7]).toBeLessThan(255);
  });

  it("keeps a full-canvas fill fully opaque at the canvas boundary", () => {
    const original = pixels([0, 0, 0, 0]);
    const output = pixels([255, 24, 12, 255]);
    softenStudioAdvancedFillEdges(output, original, new Uint8Array([1]), 1, 1, [255, 24, 12, 255]);
    expect([...output]).toEqual([255, 24, 12, 255]);
  });

  it("rejects buffers whose dimensions do not match", () => {
    expect(() =>
      softenStudioAdvancedFillEdges(
        new Uint8ClampedArray(4),
        new Uint8ClampedArray(8),
        new Uint8Array(1),
        1,
        1,
        [0, 0, 0, 255],
      ),
    ).toThrow(RangeError);
  });
});

describe("advanced fill preview messages", () => {
  it("reports the leak threshold as an exceeded limit", () => {
    const result = {
      blockedReason: "area",
      diagnostics: { matched: { areaRatio: 0.651 } },
    } as StudioAdvancedFillBrowserResult;

    expect(studioAdvancedFillResultMessage(result)).toContain("65%를 넘는 영역");
  });

  it("keeps the first message and reports exact accumulated pixels for later regions", () => {
    const first = summarizeStudioAdvancedFillPreview("채우기 완료 · 30.0% · 30px", {
      width: 10,
      height: 10,
      paintedPixelCount: 30,
    });
    expect(first).toEqual({
      message: "채우기 완료 · 30.0% · 30px",
      paintedPixelCount: 30,
      regionCount: 1,
    });

    const second = summarizeStudioAdvancedFillPreview(
      "채우기 완료 · 25.0% · 25px",
      { width: 10, height: 10, paintedPixelCount: 25 },
      first,
    );
    expect(second).toEqual({
      message: "누적 미리보기 · 2개 영역 · 55.0% · 55px",
      paintedPixelCount: 55,
      regionCount: 2,
    });
  });
});

describe("advanced fill leak guard planning", () => {
  it("keeps the user's leak and canvas-edge preferences for ordinary fills", () => {
    expect(planStudioAdvancedFillGuard({
      ...DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS,
      treatCanvasEdgeAsBoundary: false,
    })).toEqual({
      maxAreaRatio: 0.65,
      blockCanvasEdge: true,
    });
  });

  it("allows an explicitly requested blank-page color layer to cover the whole canvas", () => {
    expect(
      planStudioAdvancedFillGuard(DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS, true),
    ).toEqual({
      maxAreaRatio: 1,
      blockCanvasEdge: false,
    });
  });
});

describe("countChangedStudioAdvancedFillPixels", () => {
  it("counts changed pixels rather than changed channels", () => {
    const before = pixels([
      0, 0, 0, 0,
      10, 20, 30, 255,
      40, 50, 60, 255,
    ]);
    const after = pixels([
      255, 255, 255, 255,
      11, 21, 31, 255,
      40, 50, 60, 255,
    ]);
    expect(countChangedStudioAdvancedFillPixels(before, after)).toBe(2);
  });

  it("rejects unequal or non-RGBA buffers", () => {
    expect(() => countChangedStudioAdvancedFillPixels(pixels([0, 0, 0, 0]), pixels([]))).toThrow(RangeError);
    expect(() => countChangedStudioAdvancedFillPixels(pixels([0, 0, 0]), pixels([0, 0, 0]))).toThrow(RangeError);
  });
});
