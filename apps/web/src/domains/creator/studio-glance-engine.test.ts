import { describe, expect, it } from "vitest";

import { StudioGlanceEngine } from "./studio-glance-engine";

describe("StudioGlanceEngine", () => {
  it("applies preview filters to RGBA tiles", () => {
    const glance = new StudioGlanceEngine({ wetEdgeGloss: 0.5, contrast: 1.2 });
    const width = 4;
    const height = 4;
    const input = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < input.length; i += 4) {
      input[i] = 100;
      input[i + 1] = 150;
      input[i + 2] = 200;
      input[i + 3] = 128;
    }

    const output = glance.applyPreviewFilter(input, width, height);
    expect(output.length).toBe(input.length);
    expect(output[3]).toBe(128);
  });
});
