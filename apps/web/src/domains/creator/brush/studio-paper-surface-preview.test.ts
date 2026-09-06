/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearStudioPaperSurfacePreviewCache,
  getStudioPaperSurfacePreviewTile,
  studioPaperSurfacePreviewCacheStats,
  studioPaperSurfacePreviewOpacity,
} from "./studio-paper-surface-preview";

let latestPixels: Uint8ClampedArray | null = null;

function installCanvas2dStub(): void {
  HTMLCanvasElement.prototype.getContext = vi.fn(function (
    this: HTMLCanvasElement,
    type: string,
  ) {
    if (type !== "2d") return null;
    const width = this.width || 128;
    const height = this.height || 128;
    return {
      createImageData: (w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
      }),
      putImageData: vi.fn((image: ImageData) => {
        latestPixels = new Uint8ClampedArray(image.data);
      }),
      canvas: this,
      width,
      height,
    } as unknown as CanvasRenderingContext2D;
  }) as typeof HTMLCanvasElement.prototype.getContext;
}

beforeEach(() => {
  latestPixels = null;
  installCanvas2dStub();
});

afterEach(() => {
  clearStudioPaperSurfacePreviewCache();
  vi.restoreAllMocks();
});

describe("studio paper surface preview", () => {
  it("builds a seamless tile canvas and reuses the cache", () => {
    const first = getStudioPaperSurfacePreviewTile({ kind: "canvas", seed: 41 });
    const second = getStudioPaperSurfacePreviewTile({ kind: "canvas", seed: 41 });
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(first!.width).toBe(128);
    expect(first!.height).toBe(128);
    expect(studioPaperSurfacePreviewCacheStats().entries).toBe(1);
  });

  it("varies opacity by paper tooth and isolates cache by kind", () => {
    expect(studioPaperSurfacePreviewOpacity("charcoal")).toBeGreaterThan(
      studioPaperSurfacePreviewOpacity("bristol"),
    );
    getStudioPaperSurfacePreviewTile({ kind: "washi", seed: 1 });
    getStudioPaperSurfacePreviewTile({ kind: "kraft", seed: 1 });
    expect(studioPaperSurfacePreviewCacheStats().entries).toBe(2);
  });

  it("builds a neutral, visibly non-flat relief tile", () => {
    getStudioPaperSurfacePreviewTile({ kind: "cold-press", seed: 41 });
    expect(latestPixels).not.toBeNull();
    const pixels = latestPixels!;
    const levels: number[] = [];
    for (let index = 0; index < pixels.length; index += 4) {
      expect(pixels[index]).toBe(pixels[index + 1]);
      expect(pixels[index]).toBe(pixels[index + 2]);
      levels.push(pixels[index]!);
    }
    expect(Math.max(...levels) - Math.min(...levels)).toBeGreaterThan(40);
    expect(new Set(levels).size).toBeGreaterThan(20);
  });

  it("keeps smooth paper restrained while rough paper carries stronger contrast", () => {
    clearStudioPaperSurfacePreviewCache();
    getStudioPaperSurfacePreviewTile({ kind: "bristol", seed: 9 });
    const bristol = latestPixels!;
    clearStudioPaperSurfacePreviewCache();
    getStudioPaperSurfacePreviewTile({ kind: "sanded-pastel", seed: 9 });
    const sanded = latestPixels!;
    const standardDeviation = (pixels: Uint8ClampedArray) => {
      const values: number[] = [];
      for (let index = 0; index < pixels.length; index += 4) values.push(pixels[index]!);
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      return Math.sqrt(
        values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length,
      );
    };
    expect(standardDeviation(sanded)).toBeGreaterThan(standardDeviation(bristol) * 3);
  });

  it("allows an explicitly flat preview without changing the surface selection", () => {
    getStudioPaperSurfacePreviewTile(
      { kind: "rough", seed: 7 },
      { grainStrength: 0 },
    );
    const levels = new Set<number>();
    for (let index = 0; index < latestPixels!.length; index += 4) {
      levels.add(latestPixels![index]!);
    }
    expect([...levels]).toEqual([255]);
  });
});
