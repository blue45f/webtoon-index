import { describe, expect, it } from "vitest";

import { applyStudioToonShading } from "./studio-toon-shading-pipeline";

describe("applyStudioToonShading", () => {
  it("applies 2-tone cell shading ramp bands to RGBA buffer", () => {
    const width = 10;
    const height = 10;
    const pixels = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
      pixels[i * 4] = 200;
      pixels[i * 4 + 1] = 200;
      pixels[i * 4 + 2] = 200;
      pixels[i * 4 + 3] = 255;
    }

    const result = applyStudioToonShading(pixels, width, height, [1, 0, 0], {
      rampBands: 2,
      shadowThreshold: 0.5,
    });

    expect(result.rgba.length).toBe(pixels.length);
    // Lit pixel
    expect(result.rgba[0]).toBeGreaterThan(0);
  });
});
