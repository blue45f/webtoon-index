import { describe, expect, it } from "vitest";

import {
  computeStudioVrmTextureFillMask,
  type StudioVrmTextureFillRequest,
  type StudioVrmTextureFillScope,
} from "./studio-vrm-texture-fill";

type Rgba = readonly [red: number, green: number, blue: number, alpha: number];

function pixels(...colors: readonly Rgba[]): Uint8ClampedArray {
  return new Uint8ClampedArray(colors.flat());
}

function request(
  input: Partial<StudioVrmTextureFillRequest> & Pick<StudioVrmTextureFillRequest, "pixels">,
): StudioVrmTextureFillRequest {
  return {
    pixels: input.pixels,
    width: input.width ?? 1,
    height: input.height ?? 1,
    seed: input.seed ?? { x: 0, y: 0 },
    tolerance: input.tolerance ?? 0,
    scope: input.scope ?? "contiguous",
  };
}

function selectedPositions(mask: Uint8Array, pixelCount: number): number[] {
  return Array.from({ length: pixelCount }, (_, position) => position)
    .filter((position) => (mask[position >>> 3]! & (1 << (position & 7))) !== 0);
}

const RED: Rgba = [255, 0, 0, 255];
const NEAR_RED: Rgba = [254, 0, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];

describe("computeStudioVrmTextureFillMask", () => {
  it("fills a single texel and reports the exact seed RGBA", () => {
    const source = pixels([12, 34, 56, 78]);
    const result = computeStudioVrmTextureFillMask(request({ pixels: source }));

    expect(result).toEqual({
      bitMask: new Uint8Array([0b0000_0001]),
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      matchedCount: 1,
      seedRgba: [12, 34, 56, 78],
    });
  });

  it.each([
    {
      label: "1×N",
      width: 1,
      height: 4,
      seed: { x: 0, y: 1 },
    },
    {
      label: "N×1",
      width: 4,
      height: 1,
      seed: { x: 1, y: 0 },
    },
  ])("walks all four-neighbour texels in a $label texture", ({ width, height, seed }) => {
    const result = computeStudioVrmTextureFillMask(request({
      pixels: pixels(RED, RED, RED, RED),
      width,
      height,
      seed,
    }));

    expect(selectedPositions(result.bitMask, 4)).toEqual([0, 1, 2, 3]);
    expect(result.bounds).toEqual({ x: 0, y: 0, width, height });
    expect(result.matchedCount).toBe(4);
  });

  it("uses an inclusive premultiplied RGBA RMS tolerance from 0 through 255", () => {
    const source = pixels(RED, NEAR_RED, BLUE);
    const exact = computeStudioVrmTextureFillMask(request({
      pixels: source,
      width: 3,
      tolerance: 0,
      scope: "whole-material",
    }));
    const near = computeStudioVrmTextureFillMask(request({
      pixels: source,
      width: 3,
      tolerance: 1,
      scope: "whole-material",
    }));
    const all = computeStudioVrmTextureFillMask(request({
      pixels: source,
      width: 3,
      tolerance: 255,
      scope: "whole-material",
    }));

    expect(selectedPositions(exact.bitMask, 3)).toEqual([0]);
    expect(selectedPositions(near.bitMask, 3)).toEqual([0, 1]);
    expect(selectedPositions(all.bitMask, 3)).toEqual([0, 1, 2]);
  });

  it("ignores hidden straight RGB bytes when both texels are fully transparent", () => {
    const source = pixels([255, 0, 0, 0], [0, 255, 255, 0], [0, 0, 0, 1]);
    const result = computeStudioVrmTextureFillMask(request({
      pixels: source,
      width: 3,
      tolerance: 0,
      scope: "whole-material",
    }));

    expect(selectedPositions(result.bitMask, 3)).toEqual([0, 1]);
    expect(result.seedRgba).toEqual([255, 0, 0, 0]);
  });

  it("distinguishes disconnected matches in contiguous scope from whole-material scope", () => {
    const source = pixels(RED, BLUE, RED);
    const contiguous = computeStudioVrmTextureFillMask(request({
      pixels: source,
      width: 3,
      scope: "contiguous",
    }));
    const whole = computeStudioVrmTextureFillMask(request({
      pixels: source,
      width: 3,
      scope: "whole-material",
    }));

    expect(selectedPositions(contiguous.bitMask, 3)).toEqual([0]);
    expect(contiguous.bounds).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(selectedPositions(whole.bitMask, 3)).toEqual([0, 2]);
    expect(whole.bounds).toEqual({ x: 0, y: 0, width: 3, height: 1 });
  });

  it("does not connect the end of one row to the start of the next", () => {
    const source = pixels(BLUE, BLUE, RED, RED, BLUE, BLUE);
    const result = computeStudioVrmTextureFillMask(request({
      pixels: source,
      width: 3,
      height: 2,
      seed: { x: 2, y: 0 },
    }));

    expect(selectedPositions(result.bitMask, 6)).toEqual([2]);
    expect(result.matchedCount).toBe(1);
  });

  it("packs positions LSB-first and reports aggregate bounds and count", () => {
    const colors = Array.from({ length: 9 }, (_, position): Rgba =>
      position === 0 || position === 7 || position === 8 ? RED : BLUE);
    const result = computeStudioVrmTextureFillMask(request({
      pixels: pixels(...colors),
      width: 9,
      scope: "whole-material",
    }));

    expect(result.bitMask).toEqual(new Uint8Array([0b1000_0001, 0b0000_0001]));
    expect(result.bounds).toEqual({ x: 0, y: 0, width: 9, height: 1 });
    expect(result.matchedCount).toBe(3);
  });

  it.each([
    ["null request", null],
    ["non-clamped pixels", request({ pixels: new Uint8ClampedArray(4), })],
  ])("rejects invalid request objects: %s", (_label, invalid) => {
    const value = invalid === null
      ? null
      : { ...invalid, pixels: new Uint8Array(4) };
    expect(() =>
      computeStudioVrmTextureFillMask(value as unknown as StudioVrmTextureFillRequest),
    ).toThrow();
  });

  it.each([
    ["zero width", { width: 0 }],
    ["fractional width", { width: 1.5 }],
    ["unsafe width", { width: Number.MAX_SAFE_INTEGER + 1 }],
    ["oversized width", { width: 4_097 }],
    ["zero height", { height: 0 }],
    ["fractional height", { height: 1.5 }],
    ["unsafe height", { height: Number.MAX_SAFE_INTEGER + 1 }],
    ["oversized height", { height: 4_097 }],
  ])("rejects invalid dimensions: %s", (_label, patch) => {
    expect(() =>
      computeStudioVrmTextureFillMask({
        ...request({ pixels: new Uint8ClampedArray(4) }),
        ...patch,
      }),
    ).toThrow(RangeError);
  });

  it("rejects RGBA buffers whose length does not exactly match the dimensions", () => {
    expect(() =>
      computeStudioVrmTextureFillMask(request({
        pixels: new Uint8ClampedArray(7),
        width: 2,
      })),
    ).toThrow(/length/);
  });

  it.each([
    ["missing", null],
    ["fractional x", { x: 0.5, y: 0 }],
    ["negative x", { x: -1, y: 0 }],
    ["out-of-range x", { x: 2, y: 0 }],
    ["fractional y", { x: 0, y: 0.5 }],
    ["negative y", { x: 0, y: -1 }],
    ["out-of-range y", { x: 0, y: 1 }],
  ])("rejects an invalid seed: %s", (_label, seed) => {
    expect(() =>
      computeStudioVrmTextureFillMask({
        ...request({ pixels: pixels(RED, RED), width: 2 }),
        seed: seed as StudioVrmTextureFillRequest["seed"],
      }),
    ).toThrow();
  });

  it.each([-1, 0.5, 256, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid tolerance %s",
    (tolerance) => {
      expect(() =>
        computeStudioVrmTextureFillMask({
          ...request({ pixels: pixels(RED) }),
          tolerance,
        }),
      ).toThrow(RangeError);
    },
  );

  it("rejects unknown scopes and non-function abort hooks", () => {
    expect(() =>
      computeStudioVrmTextureFillMask({
        ...request({ pixels: pixels(RED) }),
        scope: "selection" as StudioVrmTextureFillScope,
      }),
    ).toThrow(TypeError);
    expect(() =>
      computeStudioVrmTextureFillMask(
        request({ pixels: pixels(RED) }),
        true as unknown as () => boolean,
      ),
    ).toThrow(TypeError);
  });

  it("throws a DOM-independent AbortError before or during work", () => {
    expect(() =>
      computeStudioVrmTextureFillMask(request({ pixels: pixels(RED) }), () => true),
    ).toThrow(expect.objectContaining({ name: "AbortError" }));

    let checks = 0;
    const largeSource = new Uint8ClampedArray(5_000 * 4);
    expect(() =>
      computeStudioVrmTextureFillMask(
        request({
          pixels: largeSource,
          width: 1_000,
          height: 5,
          scope: "whole-material",
          tolerance: 255,
        }),
        () => {
          checks += 1;
          return checks >= 2;
        },
      ),
    ).toThrow(expect.objectContaining({ name: "AbortError" }));
    expect(checks).toBe(2);
  });

  it("never mutates its input on success or abort", () => {
    const source = pixels(RED, NEAR_RED, BLUE);
    const before = source.slice();
    computeStudioVrmTextureFillMask(request({
      pixels: source,
      width: 3,
      tolerance: 255,
    }));
    expect(source).toEqual(before);

    expect(() =>
      computeStudioVrmTextureFillMask(
        request({ pixels: source, width: 3 }),
        () => true,
      ),
    ).toThrow(expect.objectContaining({ name: "AbortError" }));
    expect(source).toEqual(before);
  });

  it("is deterministic across repeated contiguous and whole-material runs", () => {
    const source = pixels(
      RED, NEAR_RED, BLUE,
      RED, BLUE, NEAR_RED,
      RED, RED, NEAR_RED,
    );
    for (const scope of ["contiguous", "whole-material"] satisfies StudioVrmTextureFillScope[]) {
      const input = request({
        pixels: source,
        width: 3,
        height: 3,
        seed: { x: 0, y: 0 },
        tolerance: 1,
        scope,
      });
      const first = computeStudioVrmTextureFillMask(input);
      const second = computeStudioVrmTextureFillMask(input);
      expect(second).toEqual(first);
      expect(second.bitMask).not.toBe(first.bitMask);
    }
  });
});
