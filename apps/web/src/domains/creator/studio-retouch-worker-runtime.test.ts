import { describe, expect, it } from "vitest";

import { wetMixStroke } from "./brush/studio-wet-mix";
import { dodgeBurnStroke } from "./studio-dodge-burn";
import { applyStudioRetouchWorkerRequest } from "./studio-retouch-worker-runtime";

function pixels(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(12 * 12 * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = (offset * 3) % 255;
    data[offset + 1] = (offset * 5) % 255;
    data[offset + 2] = (offset * 7) % 255;
    data[offset + 3] = 255;
  }
  return data;
}

describe("Studio retouch Worker runtime", () => {
  it("matches the canonical dodge/burn core exactly and mutates the owned buffer", () => {
    const data = pixels();
    const expected = new Uint8ClampedArray(data);
    const points = [{ x: 3, y: 4 }, { x: 9, y: 7 }];
    const settings = {
      radiusPx: 3,
      hardness: 0.4,
      exposure: 55,
      mode: "burn" as const,
      range: "midtones" as const,
      sponge: "saturate" as const,
    };
    dodgeBurnStroke(expected, 12, 12, points, settings);

    const result = applyStudioRetouchWorkerRequest({
      kind: "dodge-burn",
      data,
      w: 12,
      h: 12,
      points,
      settings,
    });

    expect(result.data).toBe(data);
    expect(result.data).toEqual(expected);
  });

  it("matches the canonical wet-mix core exactly and preserves operation identity", () => {
    const data = pixels();
    const expected = new Uint8ClampedArray(data);
    const points = [{ x: 2, y: 2 }, { x: 10, y: 9 }];
    const settings = {
      radiusPx: 2.5,
      hardness: 0.6,
      strength: 0.55,
      wetness: 0.7,
      pickup: 0.4,
      paintColor: { r: 30, g: 120, b: 220 },
    };
    wetMixStroke(expected, 12, 12, points, settings);

    const result = applyStudioRetouchWorkerRequest({
      kind: "wet-mix",
      data,
      w: 12,
      h: 12,
      points,
      settings,
    });

    expect(result.kind).toBe("wet-mix");
    expect(result.data).toEqual(expected);
  });
});
