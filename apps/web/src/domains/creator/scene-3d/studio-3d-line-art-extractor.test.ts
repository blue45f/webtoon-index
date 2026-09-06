import { describe, expect, it } from "vitest";

import {
  extractStudio3DLineArt,
  extractVectorStrokesFromEdgeMask,
  generateMangaScreentone,
} from "./studio-3d-line-art-extractor";

describe("Studio 3D LineArt & Screentone Extractor", () => {
  it("detects edge boundary between black and white blocks using Sobel", () => {
    const width = 10;
    const height = 10;
    const pixels = new Uint8Array(width * height * 4);

    // Left half white, right half black
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const idx = (y * width + x) * 4;
        const val = x < 5 ? 255 : 0;
        pixels[idx] = val;
        pixels[idx + 1] = val;
        pixels[idx + 2] = val;
        pixels[idx + 3] = 255;
      }
    }

    const result = extractStudio3DLineArt(pixels, width, height, { threshold: 30 });
    expect(result.linePixelCount).toBeGreaterThan(0);
    expect(result.edgeMask.length).toBe(width * height);
  });

  it("detects edges using Canny detector with hysteresis", () => {
    const width = 16;
    const height = 16;
    const pixels = new Uint8Array(width * height * 4);

    // Diagonal step
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const idx = (y * width + x) * 4;
        const val = x > y ? 255 : 0;
        pixels[idx] = val;
        pixels[idx + 1] = val;
        pixels[idx + 2] = val;
        pixels[idx + 3] = 255;
      }
    }

    const result = extractStudio3DLineArt(pixels, width, height, {
      algorithm: "canny",
      threshold: 30,
      cannyLowThreshold: 15,
    });
    expect(result.linePixelCount).toBeGreaterThan(0);
  });

  it("detects edges using Difference of Gaussians (DoG) for manga inking", () => {
    const width = 16;
    const height = 16;
    const pixels = new Uint8Array(width * height * 4);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const idx = (y * width + x) * 4;
        const val = (x >= 4 && x <= 12 && y >= 4 && y <= 12) ? 255 : 0;
        pixels[idx] = val;
        pixels[idx + 1] = val;
        pixels[idx + 2] = val;
        pixels[idx + 3] = 255;
      }
    }

    const result = extractStudio3DLineArt(pixels, width, height, {
      algorithm: "dog",
      threshold: 20,
    });
    expect(result.linePixelCount).toBeGreaterThan(0);
  });

  it("detects normal and depth discontinuities in 3D geometry", () => {
    const width = 10;
    const height = 10;
    const dummyPixels = new Uint8Array(width * height * 4);

    // Depth buffer with a sharp jump at x = 5
    const depthBuf = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        depthBuf[y * width + x] = x < 5 ? 0.2 : 0.8;
      }
    }

    const result = extractStudio3DLineArt(dummyPixels, width, height, {
      algorithm: "normal-depth",
      depthBuffer: depthBuf,
      depthThreshold: 0.1,
    });
    expect(result.linePixelCount).toBeGreaterThan(0);
  });

  it("extracts 2D vector strokes from edge mask", () => {
    const width = 20;
    const height = 20;
    const edgeMask = new Uint8Array(width * height);

    // Draw a straight horizontal edge line
    for (let x = 2; x < 18; x += 1) {
      edgeMask[5 * width + x] = 255;
    }

    const strokes = extractVectorStrokesFromEdgeMask(edgeMask, width, height, 1.0);
    expect(strokes.length).toBeGreaterThan(0);
    expect(strokes[0].svgPathData).toContain("M ");
    expect(strokes[0].length).toBeGreaterThan(5);
  });

  it("generates manga screentones across various patterns", () => {
    const width = 32;
    const height = 32;

    const dotTone = generateMangaScreentone(width, height, { pattern: "dots", density: 0.4 });
    expect(dotTone.length).toBe(width * height * 4);

    const crossHatch = generateMangaScreentone(width, height, { pattern: "cross-hatch", density: 0.3 });
    expect(crossHatch.length).toBe(width * height * 4);

    const diamonds = generateMangaScreentone(width, height, { pattern: "diamonds", density: 0.5 });
    expect(diamonds.length).toBe(width * height * 4);

    const sand = generateMangaScreentone(width, height, { pattern: "sand", density: 0.2 });
    expect(sand.length).toBe(width * height * 4);
  });
});
