import { describe, expect, it } from "vitest";

import {
  buildStudioBg3dLtDepthWidthField,
  expandStudioBg3dLtResponseWithWidthField,
} from "./studio-bg3d-lt-depth-width";

function depthRamp(width: number, height: number): Float32Array {
  // Left = near (0), right = far (1).
  return Float32Array.from({ length: width * height }, (_, index) => {
    const x = index % width;
    return width === 1 ? 0 : x / (width - 1);
  });
}

describe("buildStudioBg3dLtDepthWidthField", () => {
  it("makes nearer pixels thicker on a synthetic depth ramp", () => {
    const width = 5;
    const height = 3;
    const depth = depthRamp(width, height);
    const field = buildStudioBg3dLtDepthWidthField({
      width,
      height,
      depth,
      baseWidthPx: 2,
      minWidthPx: 1,
      maxWidthPx: 8,
      nearBoost: 4,
    });
    expect(field).not.toBeNull();
    expect(field).toBeInstanceOf(Float32Array);
    expect(field!.length).toBe(width * height);

    // depth 0 → 2 + 4 * 1 = 6; depth 1 → 2 + 4 * 0 = 2
    expect(field![0]).toBeCloseTo(6, 9);
    expect(field![width - 1]).toBeCloseTo(2, 9);
    // Monotone non-increasing across a row.
    for (let x = 1; x < width; x += 1) {
      expect(field![x]!).toBeLessThanOrEqual(field![x - 1]! + 1e-9);
    }
    // Every row matches the first (deterministic, row-major independent of y).
    for (let y = 1; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        expect(field![y * width + x]).toBe(field![x]);
      }
    }
  });

  it("clamps to min/max width and is deterministic", () => {
    const depth = Float32Array.of(0, 0.5, 1);
    const first = buildStudioBg3dLtDepthWidthField({
      width: 3,
      height: 1,
      depth,
      baseWidthPx: 1,
      minWidthPx: 2,
      maxWidthPx: 3,
      nearBoost: 10,
    });
    const second = buildStudioBg3dLtDepthWidthField({
      width: 3,
      height: 1,
      depth,
      baseWidthPx: 1,
      minWidthPx: 2,
      maxWidthPx: 3,
      nearBoost: 10,
    });
    expect(first).toEqual(second);
    // near: clamp(1+10, 2, 3) = 3; mid: clamp(1+5, 2, 3) = 3; far: clamp(1, 2, 3) = 2
    expect([...first!]).toEqual([3, 3, 2]);
  });

  it("accepts a plain number[] depth buffer", () => {
    const field = buildStudioBg3dLtDepthWidthField({
      width: 2,
      height: 1,
      depth: [0, 1],
      baseWidthPx: 1,
      minWidthPx: 0.5,
      maxWidthPx: 4,
      nearBoost: 1,
    });
    expect(field).not.toBeNull();
    expect(field![0]).toBeCloseTo(2, 9);
    expect(field![1]).toBeCloseTo(1, 9);
  });

  it("fails closed on empty, mismatched, and non-finite inputs", () => {
    expect(buildStudioBg3dLtDepthWidthField({
      width: 0,
      height: 1,
      depth: new Float32Array(0),
      baseWidthPx: 1,
      minWidthPx: 0,
      maxWidthPx: 2,
    })).toBeNull();
    expect(buildStudioBg3dLtDepthWidthField({
      width: 2,
      height: 2,
      depth: new Float32Array(3),
      baseWidthPx: 1,
      minWidthPx: 0,
      maxWidthPx: 2,
    })).toBeNull();
    expect(buildStudioBg3dLtDepthWidthField({
      width: 1,
      height: 1,
      depth: Float32Array.of(Number.NaN),
      baseWidthPx: 1,
      minWidthPx: 0,
      maxWidthPx: 2,
    })).toBeNull();
    expect(buildStudioBg3dLtDepthWidthField({
      width: 1,
      height: 1,
      depth: Float32Array.of(1.5),
      baseWidthPx: 1,
      minWidthPx: 0,
      maxWidthPx: 2,
    })).toBeNull();
    expect(buildStudioBg3dLtDepthWidthField({
      width: 1,
      height: 1,
      depth: Float32Array.of(0),
      baseWidthPx: 1,
      minWidthPx: 3,
      maxWidthPx: 2,
    })).toBeNull();
    expect(buildStudioBg3dLtDepthWidthField(null as never)).toBeNull();
  });

  it("uses base width only when nearBoost is omitted", () => {
    const field = buildStudioBg3dLtDepthWidthField({
      width: 2,
      height: 1,
      depth: Float32Array.of(0, 1),
      baseWidthPx: 1.5,
      minWidthPx: 0,
      maxWidthPx: 8,
    });
    expect(field).not.toBeNull();
    expect(field![0]).toBeCloseTo(1.5, 9);
    expect(field![1]).toBeCloseTo(1.5, 9);
  });
});

describe("expandStudioBg3dLtResponseWithWidthField", () => {
  it("expands a thin response using the mean width field radius", () => {
    const width = 5;
    const height = 1;
    const response = new Uint8ClampedArray([0, 0, 255, 0, 0]);
    const widthField = Float32Array.of(3, 3, 3, 3, 3);
    const expanded = expandStudioBg3dLtResponseWithWidthField(
      response,
      widthField,
      width,
      height,
    );
    expect(expanded).not.toBeNull();
    // radius = ceil((3-1)/2) = 1 → ink spreads one pixel horizontally
    expect([...expanded!]).toEqual([0, 255, 255, 255, 0]);
  });

  it("fails closed on size mismatches", () => {
    expect(expandStudioBg3dLtResponseWithWidthField(
      new Uint8ClampedArray(4),
      new Float32Array(3),
      2,
      2,
    )).toBeNull();
  });
});
