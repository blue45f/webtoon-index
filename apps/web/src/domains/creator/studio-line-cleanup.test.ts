import { describe, expect, it } from "vitest";

import {
  DEFAULT_LINE_ART_CLEANUP,
  applyLineArtCleanup,
  lineArtCleanupKonvaFilter,
  normalizeLineArtCleanup,
} from "./studio-line-cleanup";

import type { StudioImageDataLike } from "./studio-filters";

function lineFixture(): StudioImageDataLike {
  const width = 5;
  const height = 5;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const line = x === 2 || y === 2;
      data[index] = line ? 145 : 238;
      data[index + 1] = line ? 158 : 232;
      data[index + 2] = line ? 172 : 226;
      data[index + 3] = (x + y) % 4 === 0 ? 96 : 255;
    }
  }
  return { data, width, height };
}

function clone(image: StudioImageDataLike): StudioImageDataLike {
  return {
    data: new Uint8ClampedArray(image.data),
    width: image.width,
    height: image.height,
  };
}

function alphaBytes(image: StudioImageDataLike): number[] {
  const values: number[] = [];
  for (let index = 3; index < image.data.length; index += 4) {
    values.push(image.data[index]!);
  }
  return values;
}

describe("studio line cleanup engine", () => {
  it("normalizes malformed persisted parameters into bounded deterministic values", () => {
    expect(normalizeLineArtCleanup()).toEqual(DEFAULT_LINE_ART_CLEANUP);
    expect(normalizeLineArtCleanup({
      threshold: Number.POSITIVE_INFINITY,
      strength: -4,
    })).toEqual({
      threshold: DEFAULT_LINE_ART_CLEANUP.threshold,
      strength: 0,
    });
    expect(normalizeLineArtCleanup({ threshold: 4, strength: 0.45 })).toEqual({
      threshold: 1,
      strength: 0.45,
    });
  });

  it("produces deterministic grayscale ink while preserving every alpha byte", () => {
    const source = lineFixture();
    const first = clone(source);
    const repeated = clone(source);
    const alpha = alphaBytes(source);

    applyLineArtCleanup(first, { threshold: 0.6, strength: 0.5 });
    applyLineArtCleanup(repeated, { threshold: 0.6, strength: 0.5 });

    expect(first.data).toEqual(repeated.data);
    expect(first.data).not.toEqual(source.data);
    expect(alphaBytes(first)).toEqual(alpha);
    let black = 0;
    let white = 0;
    for (let index = 0; index < first.data.length; index += 4) {
      expect(first.data[index]).toBe(first.data[index + 1]);
      expect(first.data[index + 1]).toBe(first.data[index + 2]);
      if (first.data[index] === 0) black += 1;
      if (first.data[index] === 255) white += 1;
    }
    expect(black).toBeGreaterThan(0);
    expect(white).toBeGreaterThan(0);
  });

  it("keeps threshold zero as a grayscale cleanup rather than forcing binary pixels", () => {
    const image: StudioImageDataLike = {
      width: 4,
      height: 1,
      data: new Uint8ClampedArray([
        30, 60, 90, 255,
        90, 120, 150, 255,
        150, 180, 210, 255,
        210, 225, 240, 255,
      ]),
    };
    applyLineArtCleanup(image, { threshold: 0, strength: 0 });

    const values: number[] = [];
    for (let index = 0; index < image.data.length; index += 4) {
      expect(image.data[index]).toBe(image.data[index + 1]);
      expect(image.data[index + 1]).toBe(image.data[index + 2]);
      values.push(image.data[index]!);
    }
    expect(values.some((value) => value > 0 && value < 255)).toBe(true);
  });

  it("keeps the Konva/Worker attrs adapter byte-identical to the pure engine", () => {
    const direct = lineFixture();
    const adapted = lineFixture();
    applyLineArtCleanup(direct, { threshold: 0.64, strength: 0.45 });
    lineArtCleanupKonvaFilter.call(
      {
        attrs: {
          lineCleanupThreshold: 0.64,
          lineCleanupStrength: 0.45,
        },
      },
      adapted,
    );
    expect(adapted.data).toEqual(direct.data);

    const untouched = lineFixture();
    const before = new Uint8ClampedArray(untouched.data);
    lineArtCleanupKonvaFilter.call({}, untouched);
    expect(untouched.data).toEqual(before);
  });

  it("fails closed for malformed dimensions without touching the pixel buffer", () => {
    const malformed: StudioImageDataLike = {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([10, 20, 30, 255]),
    };
    const before = new Uint8ClampedArray(malformed.data);
    expect(() => applyLineArtCleanup(malformed)).not.toThrow();
    expect(malformed.data).toEqual(before);
  });
});
