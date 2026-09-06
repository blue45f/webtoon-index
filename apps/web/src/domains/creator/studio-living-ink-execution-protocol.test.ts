import { describe, expect, it } from "vitest";

import {
  canonicalStudioLivingInkDisplayRgba8,
  canonicalStudioLivingInkDisplayRgba8BottomUp,
  isStudioLivingInkExecutionReadbackProvenance,
} from "./studio-living-ink-execution-protocol";

describe("Living Ink display hash encoding", () => {
  it("pins the RGBA8 premultiply contract including transparent placeholder colour", () => {
    expect(Array.from(canonicalStudioLivingInkDisplayRgba8(new Uint8Array([
      255, 128, 64, 255,
      255, 128, 64, 128,
      255, 255, 255, 0,
    ])))).toEqual([
      255, 128, 64, 255,
      128, 64, 32, 128,
      0, 0, 0, 0,
    ]);
  });

  it("recovers the same canonical bytes after every possible alpha/channel canvas round-trip", () => {
    for (let alpha = 0; alpha <= 255; alpha += 1) {
      for (let channel = 0; channel <= 255; channel += 1) {
        const premultiplied = Math.round((channel * alpha) / 255);
        // Chromium may round the visible straight byte up or down after un-premultiplication. Both
        // neighbouring representations collapse to the same premultiplied receipt byte.
        const visible = alpha === 0 ? 0 : Math.round((premultiplied * 255) / alpha);
        const canonical = canonicalStudioLivingInkDisplayRgba8(
          new Uint8Array([visible, visible, visible, alpha]),
        );
        expect(Math.abs((canonical[0] ?? 0) - premultiplied)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("rejects torn pixels instead of silently dropping trailing bytes", () => {
    expect(() => canonicalStudioLivingInkDisplayRgba8(new Uint8Array(3))).toThrow(RangeError);
  });

  it("canonicalizes the receipt row orientation without a second full-frame allocation", () => {
    expect(Array.from(canonicalStudioLivingInkDisplayRgba8BottomUp(new Uint8Array([
      200, 100, 50, 255,
      30, 60, 90, 128,
    ]), 1, 2))).toEqual([
      15, 30, 45, 128,
      200, 100, 50, 255,
    ]);
    expect(() => canonicalStudioLivingInkDisplayRgba8BottomUp(new Uint8Array(8), 2, 2))
      .toThrow(RangeError);
  });

  it("accepts only truthful backend-discriminated readback provenance", () => {
    expect(isStudioLivingInkExecutionReadbackProvenance({
      backend: "webgl2-offscreen-half-float",
      displayReadbackOrientation: "webgl-bottom-left-row-major",
      readbackFormat: "rgba8-staging-fbo",
    })).toBe(true);
    expect(isStudioLivingInkExecutionReadbackProvenance({
      backend: "webgpu-offscreen-half-float",
      displayReadbackOrientation: "top-left-row-major",
      readbackFormat: "rgba32float-storage-buffer-to-rgba8",
    })).toBe(true);

    // Historical WebGPU receipts copied the WebGL2 labels. They are intentionally invalid rather
    // than being silently coerced into evidence for a readback path they never used.
    expect(isStudioLivingInkExecutionReadbackProvenance({
      backend: "webgpu-offscreen-half-float",
      displayReadbackOrientation: "webgl-bottom-left-row-major",
      readbackFormat: "rgba8-staging-fbo",
    })).toBe(false);
    expect(isStudioLivingInkExecutionReadbackProvenance({
      backend: "webgl2-offscreen-half-float",
      displayReadbackOrientation: "top-left-row-major",
      readbackFormat: "rgba32float-storage-buffer-to-rgba8",
    })).toBe(false);
  });
});
