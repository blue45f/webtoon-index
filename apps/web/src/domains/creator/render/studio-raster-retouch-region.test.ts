import { describe, expect, it } from "vitest";

import { wetMixStroke } from "../brush/studio-wet-mix";
import { dodgeBurnStroke } from "../studio-dodge-burn";
import { smudgeStroke } from "../studio-smudge";

import {
  planStudioRasterRetouchRegion,
  translateStudioRasterRetouchPoints,
  type StudioRasterRetouchRegion,
} from "./studio-raster-retouch-region";

function texturedPixels(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      pixels[offset] = (x * 17 + y * 3) % 256;
      pixels[offset + 1] = (x * 5 + y * 19) % 256;
      pixels[offset + 2] = (x * 11 + y * 7) % 256;
      pixels[offset + 3] = 128 + ((x * 13 + y * 23) % 128);
    }
  }
  return pixels;
}

function cropPixels(
  source: Uint8ClampedArray,
  sourceWidth: number,
  region: StudioRasterRetouchRegion,
): Uint8ClampedArray {
  const cropped = new Uint8ClampedArray(region.width * region.height * 4);
  for (let y = 0; y < region.height; y++) {
    const sourceStart = ((region.y + y) * sourceWidth + region.x) * 4;
    const targetStart = y * region.width * 4;
    cropped.set(source.subarray(sourceStart, sourceStart + region.width * 4), targetStart);
  }
  return cropped;
}

function pastePixels(
  target: Uint8ClampedArray,
  targetWidth: number,
  region: StudioRasterRetouchRegion,
  patch: Uint8ClampedArray,
): void {
  for (let y = 0; y < region.height; y++) {
    const sourceStart = y * region.width * 4;
    const targetStart = ((region.y + y) * targetWidth + region.x) * 4;
    target.set(patch.subarray(sourceStart, sourceStart + region.width * 4), targetStart);
  }
}

describe("Studio raster retouch dirty regions", () => {
  it("plans a clamped footprint whose byte count scales with the stroke", () => {
    expect(planStudioRasterRetouchRegion([], 8, 2_000, 30_000)).toBeNull();
    expect(planStudioRasterRetouchRegion([{ x: Number.NaN, y: 1 }], 8, 100, 100)).toBeNull();
    expect(planStudioRasterRetouchRegion([{ x: -3, y: 4 }], 8, 100, 100)).toEqual({
      x: 0,
      y: 0,
      width: 8,
      height: 15,
    });

    const region = planStudioRasterRetouchRegion(
      [{ x: 994, y: 14_990 }, { x: 1_006, y: 15_010 }],
      20,
      2_000,
      30_000,
    );
    expect(region).toEqual({ x: 972, y: 14_968, width: 57, height: 65 });
    expect(region!.width * region!.height * 4).toBeLessThan(2_000 * 30_000 * 4 / 10_000);
  });

  it.each(["smudge", "dodge-burn", "wet-mix"] as const)(
    "keeps %s byte-identical to full-frame execution while preserving pixels outside the ROI",
    (kind) => {
      const width = 180;
      const height = 140;
      const radiusPx = 11.5;
      const points = [
        { x: 61.25, y: 48.75 },
        { x: 77.5, y: 63.5 },
        { x: 94.125, y: 68.875 },
      ];
      const original = texturedPixels(width, height);
      const expected = new Uint8ClampedArray(original);
      const region = planStudioRasterRetouchRegion(points, radiusPx, width, height);
      expect(region).not.toBeNull();
      expect(region!.width * region!.height).toBeLessThan(width * height / 2);

      const actual = new Uint8ClampedArray(original);
      const patch = cropPixels(actual, width, region!);
      const localPoints = translateStudioRasterRetouchPoints(points, region!);
      if (kind === "smudge") {
        smudgeStroke(expected, width, height, points, radiusPx, 0.62);
        smudgeStroke(patch, region!.width, region!.height, localPoints, radiusPx, 0.62);
      } else if (kind === "dodge-burn") {
        const settings = {
          radiusPx,
          hardness: 0.45,
          exposure: 44,
          mode: "dodge" as const,
          range: "midtones" as const,
          sponge: "saturate" as const,
        };
        dodgeBurnStroke(expected, width, height, points, settings);
        dodgeBurnStroke(patch, region!.width, region!.height, localPoints, settings);
      } else {
        const settings = {
          radiusPx,
          hardness: 0.35,
          strength: 0.58,
          wetness: 0.7,
          pickup: 0.4,
          paintColor: { r: 230, g: 55, b: 92 },
        };
        wetMixStroke(expected, width, height, points, settings);
        wetMixStroke(patch, region!.width, region!.height, localPoints, settings);
      }
      pastePixels(actual, width, region!, patch);

      expect(actual).toEqual(expected);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const inside = x >= region!.x && x < region!.x + region!.width
            && y >= region!.y && y < region!.y + region!.height;
          if (inside) continue;
          const offset = (y * width + x) * 4;
          expect(actual.subarray(offset, offset + 4)).toEqual(original.subarray(offset, offset + 4));
        }
      }
    },
  );
});
