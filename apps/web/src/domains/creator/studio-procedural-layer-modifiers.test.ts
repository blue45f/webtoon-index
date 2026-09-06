import { describe, expect, it } from "vitest";

import {
  applyStudioAutoOutline,
  applyStudioToonHalftone,
  generateStudioSpeedlinesMask,
} from "./studio-procedural-layer-modifiers";

describe("studio-procedural-layer-modifiers", () => {
  it("applies autoOutline around alpha pixels", () => {
    const width = 10;
    const height = 10;
    const pixels = new Uint8Array(width * height * 4);

    // Set 2x2 square in center
    for (let y = 4; y <= 5; y += 1) {
      for (let x = 4; x <= 5; x += 1) {
        pixels[(y * width + x) * 4 + 3] = 255;
      }
    }

    const result = applyStudioAutoOutline(pixels, width, height, { outlineWidth: 1 });
    // Adjacent pixel (3,4) should receive outline color
    expect(result[(4 * width + 3) * 4 + 3]).toBe(255);
  });

  it("generates speedlines mask centered around vanishing point", () => {
    const width = 20;
    const height = 20;
    const mask = generateStudioSpeedlinesMask(width, height, {
      centerX: 0.5,
      centerY: 0.5,
      lineCount: 20,
    });

    expect(mask.length).toBe(width * height);
    // Center point (10,10) inside inner radius should be 0
    expect(mask[10 * width + 10]).toBe(0);
    // Boundary corners should have speedline pixels
    let nonZeroCount = 0;
    for (let i = 0; i < mask.length; i += 1) {
      if (mask[i] > 0) nonZeroCount += 1;
    }
    expect(nonZeroCount).toBeGreaterThan(0);
  });

  it("applies toon halftone shading", () => {
    const width = 10;
    const height = 10;
    const pixels = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
      pixels[i * 4] = 100;
      pixels[i * 4 + 1] = 100;
      pixels[i * 4 + 2] = 100;
      pixels[i * 4 + 3] = 255;
    }

    const result = applyStudioToonHalftone(pixels, width, height, { dotSize: 4 });
    expect(result.length).toBe(pixels.length);
  });
});
