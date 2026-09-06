import { describe, expect, it } from "vitest";

import { computeStudioSmartGapFillMask } from "./studio-smart-gap-fill";

describe("computeStudioSmartGapFillMask", () => {
  it("fills enclosed empty area cleanly", () => {
    const width = 10;
    const height = 10;
    const pixels = new Uint8Array(width * height * 4); // all transparent

    // Create a 4x4 box with boundary pixels
    for (let x = 2; x <= 7; x += 1) {
      pixels[(2 * width + x) * 4 + 3] = 255; // top line
      pixels[(7 * width + x) * 4 + 3] = 255; // bottom line
    }
    for (let y = 2; y <= 7; y += 1) {
      pixels[(y * width + 2) * 4 + 3] = 255; // left line
      pixels[(y * width + 7) * 4 + 3] = 255; // right line
    }

    const result = computeStudioSmartGapFillMask(pixels, width, height, 4, 4, { gapRadius: 2 });
    expect(result.filledPixelCount).toBeGreaterThan(0);
    expect(result.mask[4 * width + 4]).toBe(255);
    // Outside should not be filled
    expect(result.mask[0]).toBe(0);
  });

  it("seals broken gap and prevents paint leak", () => {
    const width = 10;
    const height = 10;
    const pixels = new Uint8Array(width * height * 4);

    // Create a box with a 1-pixel gap in top boundary
    for (let x = 2; x <= 7; x += 1) {
      if (x === 4) continue; // Gap at (4, 2)
      pixels[(2 * width + x) * 4 + 3] = 255;
      pixels[(7 * width + x) * 4 + 3] = 255;
    }
    for (let y = 2; y <= 7; y += 1) {
      pixels[(y * width + 2) * 4 + 3] = 255;
      pixels[(y * width + 7) * 4 + 3] = 255;
    }

    const result = computeStudioSmartGapFillMask(pixels, width, height, 4, 4, {
      gapRadius: 3,
      expandPx: 0,
    });

    expect(result.sealedGapCount).toBeGreaterThan(0);
    // Inside should be filled
    expect(result.mask[4 * width + 4]).toBe(255);
    // Outer corner (0,0) must stay unfilled because gap was sealed!
    expect(result.mask[0]).toBe(0);
  });
});
