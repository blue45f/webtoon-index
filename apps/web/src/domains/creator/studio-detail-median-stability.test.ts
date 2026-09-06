import { describe, expect, it } from "vitest";

import { applyDetail, normalizeDetail } from "./studio-detail";

import type { StudioImageDataLike } from "./studio-filters";

function pattern(width: number, height: number, seed: number): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  let state = seed >>> 0;
  for (let index = 0; index < data.length; index++) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    data[index] = state >>> 24;
  }
  return { data, width, height };
}

/** Independent sorted-neighbourhood reference, matching the previous shipped pixel algorithm. */
function reference(input: StudioImageDataLike, radius: number, amount: number): Uint8ClampedArray {
  const { width, height, data: source } = input;
  const output = new Uint8ClampedArray(source);
  const settings = normalizeDetail({ type: "median", radius, amount });
  const r = Math.min(3, settings.radius);
  const samples: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const weight = (source[index + 3]! / 255) * (settings.amount / 100);
      for (let channel = 0; channel < 3; channel++) {
        samples.length = 0;
        for (let dy = -r; dy <= r; dy++) {
          const sy = Math.max(0, Math.min(height - 1, y + dy));
          for (let dx = -r; dx <= r; dx++) {
            const sx = Math.max(0, Math.min(width - 1, x + dx));
            samples.push(source[(sy * width + sx) * 4 + channel]!);
          }
        }
        samples.sort((a, b) => a - b);
        const median = samples[samples.length >> 1]!;
        output[index + channel] = source[index + channel]!
          + (median - source[index + channel]!) * weight;
      }
    }
  }
  return output;
}

describe("median and surface-blur long-session pixel parity", () => {
  it.each([[1, 1], [1, 17], [19, 1], [2, 3], [5, 4], [31, 23]])(
    "matches sorted medians byte-for-byte at %i x %i with clamped borders and mixed alpha",
    (width, height) => {
      for (const radius of [1, 2, 3, 10]) {
        for (const amount of [0, 1, 37, 78, 100]) {
          for (const seed of [1, 1_337]) {
            const input = pattern(width, height, seed);
            const expected = reference(input, radius, amount);
            applyDetail(input, { type: "median", radius, amount });
            expect(input.data, `radius=${radius}, amount=${amount}, seed=${seed}`).toEqual(expected);
          }
        }
      }
    },
  );

  it("does not carry histogram counts across 100 uses or mutate the retained original", () => {
    const source = pattern(96, 64, 1_337);
    const original = new Uint8ClampedArray(source.data);
    const expected = reference(source, 3, 78);
    expect(expected).not.toEqual(original);
    for (let round = 0; round < 100; round++) {
      const image = { ...source, data: new Uint8ClampedArray(source.data) };
      applyDetail(image, { type: "median", radius: 3, amount: 78 });
      expect(image.data).toEqual(expected);
    }
    expect(source.data).toEqual(original);
  });

  it("leaves empty surfaces, fully transparent RGB and every alpha byte unchanged", () => {
    for (const [width, height] of [[0, 0], [0, 4], [4, 0], [9, 7]]) {
      const input = pattern(width!, height!, 17);
      for (let index = 3; index < input.data.length; index += 4) input.data[index] = 0;
      const original = new Uint8ClampedArray(input.data);
      applyDetail(input, { type: "median", radius: 3, amount: 100 });
      expect(input.data).toEqual(original);
    }
    const input = pattern(17, 13, 42);
    const original = new Uint8ClampedArray(input.data);
    applyDetail(input, { type: "median", radius: 3, amount: 100 });
    for (let index = 3; index < input.data.length; index += 4) {
      expect(input.data[index]).toBe(original[index]);
    }
  });
});
