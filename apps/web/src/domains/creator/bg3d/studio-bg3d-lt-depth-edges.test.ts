import { describe, expect, it } from "vitest";

import {
  STUDIO_BG3D_LT_DEPTH_EDGE_MAX_PIXELS,
  extractStudioBg3dLtDepthEdges,
} from "./studio-bg3d-lt-depth-edges";

function depthImage(
  width: number,
  height: number,
  sample: (x: number, y: number) => number
): Float32Array {
  return Float32Array.from({ length: width * height }, (_, index) =>
    sample(index % width, Math.floor(index / width))
  );
}

describe("extractStudioBg3dLtDepthEdges", () => {
  it("keeps an occlusion contour on the foreground surface without a far-side halo", () => {
    const width = 7;
    const height = 5;
    const depth = depthImage(width, height, (x) => (x < 3 ? 0.25 : 0.75));
    const response = extractStudioBg3dLtDepthEdges({
      width,
      height,
      depth,
      includeCreases: false,
    });

    for (let y = 1; y < height - 1; y += 1) {
      expect(response[y * width + 2]).toBeGreaterThan(0);
      expect(response[y * width + 3]).toBe(0);
    }
  });

  it("cancels constant depth slopes instead of turning a planar surface into line art", () => {
    const width = 9;
    const height = 7;
    const depth = depthImage(width, height, (x, y) => 0.15 + x * 0.035 + y * 0.01);
    const response = extractStudioBg3dLtDepthEdges({
      width,
      height,
      depth,
      includeCreases: false,
    });

    expect(response.every((value) => value === 0)).toBe(true);
  });

  it("compensates compressed far-device-depth steps while remaining bounded", () => {
    const width = 7;
    const height = 5;
    const depth = depthImage(width, height, (x) => (x < 3 ? 0.99 : 0.995));
    const response = extractStudioBg3dLtDepthEdges({
      width,
      height,
      depth,
      includeCreases: false,
    });

    expect(response[2 * width + 2]).toBeGreaterThan(100);
    expect(response[2 * width + 3]).toBe(0);
    expect(Math.max(...response)).toBeLessThanOrEqual(255);
  });

  it("adds second-order form cues only when crease extraction is requested", () => {
    const width = 7;
    const height = 5;
    const depth = depthImage(width, height, (x) => {
      const offset = x - 3;
      return 0.35 + offset * offset * 0.002;
    });
    const outlineOnly = extractStudioBg3dLtDepthEdges({
      width,
      height,
      depth,
      includeCreases: false,
    });
    const withCreases = extractStudioBg3dLtDepthEdges({
      width,
      height,
      depth,
      includeCreases: true,
    });

    expect(withCreases[2 * width + 3]).toBeGreaterThan(outlineOnly[2 * width + 3]);
  });

  it("is deterministic and never mutates or aliases the caller's depth buffer", () => {
    const depth = depthImage(5, 5, (x, y) => (x + y < 4 ? 0.2 : 0.8));
    const before = depth.slice();
    const input = { width: 5, height: 5, depth, includeCreases: true };
    const first = extractStudioBg3dLtDepthEdges(input);
    const second = extractStudioBg3dLtDepthEdges(input);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(depth).toEqual(before);
    first[6] = 0;
    expect(depth).toEqual(before);
  });

  it("fails closed for malformed shapes, samples, options, and pixel budgets", () => {
    const valid = {
      width: 1,
      height: 1,
      depth: new Float32Array([0.5]),
      includeCreases: false,
    };
    expect(() =>
      extractStudioBg3dLtDepthEdges(null as unknown as typeof valid)
    ).toThrow(TypeError);
    expect(() => extractStudioBg3dLtDepthEdges({ ...valid, width: 0 })).toThrow(RangeError);
    expect(() => extractStudioBg3dLtDepthEdges({ ...valid, height: 1.5 })).toThrow(RangeError);
    expect(() =>
      extractStudioBg3dLtDepthEdges({ ...valid, depth: new Float32Array(2) })
    ).toThrow(/length/u);
    expect(() =>
      extractStudioBg3dLtDepthEdges({
        ...valid,
        depth: new Float64Array([0.5]) as unknown as Float32Array,
      })
    ).toThrow(TypeError);
    expect(() =>
      extractStudioBg3dLtDepthEdges({
        ...valid,
        depth: new Float32Array([Number.NaN]),
      })
    ).toThrow(/finite/u);
    expect(() =>
      extractStudioBg3dLtDepthEdges({ ...valid, depth: new Float32Array([1.01]) })
    ).toThrow(/normalized/u);
    expect(() =>
      extractStudioBg3dLtDepthEdges({
        ...valid,
        includeCreases: "yes" as unknown as boolean,
      })
    ).toThrow(/includeCreases/u);
    expect(() =>
      extractStudioBg3dLtDepthEdges({
        width: STUDIO_BG3D_LT_DEPTH_EDGE_MAX_PIXELS + 1,
        height: 1,
        depth: new Float32Array(),
        includeCreases: false,
      })
    ).toThrow(/pixel budget/u);
  });
});
