import { describe, expect, it } from "vitest";

import {
  copyStudioGpuReadbackRows,
  planStudioGpuReadbackLayout,
  STUDIO_GPU_MAX_READBACK_PIXELS,
} from "./studio-webgpu-readback";

const viewport = {
  logicalWidth: 800,
  logicalHeight: 12_000,
  cssWidth: 640,
  cssHeight: 720,
  scaleX: 1.5,
  scaleY: 25,
  offsetX: -100,
  offsetY: -80_000,
  flipX: false,
};

describe("studio WebGPU frame readback planning", () => {
  it("plans the explicit viewport with a 256-byte WebGPU row stride", () => {
    expect(planStudioGpuReadbackLayout(
      { kind: "viewport" },
      viewport,
      641,
      721
    )).toEqual({
      status: "planned",
      layout: {
        x: 0,
        y: 0,
        width: 641,
        height: 721,
        bytesPerRow: 2_816,
        byteLength: 2_030_336,
        pixelCount: 462_161,
      },
    });
  });

  it("maps a fully visible logical document rect through CSS and a backing fit clamp", () => {
    // The viewport is 640x720 CSS px but the backing was fit-clamped to 320x360 physical px.
    // x=100 is the first visible logical column; y=3200 is the first visible logical row.
    expect(planStudioGpuReadbackLayout(
      { kind: "document", rect: { x: 100, y: 3_200, width: 200, height: 120 } },
      viewport,
      320,
      360
    )).toEqual({
      status: "planned",
      layout: {
        x: 20,
        y: 0,
        width: 120,
        height: 90,
        bytesPerRow: 512,
        byteLength: 46_080,
        pixelCount: 10_800,
      },
    });
  });

  it("preserves the exact pixel extent while mirroring a document rect", () => {
    const result = planStudioGpuReadbackLayout(
      { kind: "document", rect: { x: 500, y: 3_200, width: 100, height: 80 } },
      { ...viewport, offsetX: -100, flipX: true },
      640,
      720
    );

    expect(result).toEqual({
      status: "planned",
      layout: {
        x: 160,
        y: 0,
        width: 120,
        height: 120,
        bytesPerRow: 512,
        byteLength: 61_440,
        pixelCount: 14_400,
      },
    });
  });

  it("rejects partial, zero-sized, invalid and oversized captures instead of clipping", () => {
    expect(planStudioGpuReadbackLayout(
      { kind: "document", rect: { x: 0, y: 3_200, width: 200, height: 100 } },
      viewport,
      640,
      720
    )).toEqual({ status: "rejected", reason: "outside-viewport" });
    expect(planStudioGpuReadbackLayout(
      { kind: "document", rect: { x: 100, y: 3_200, width: 0, height: 100 } },
      viewport,
      640,
      720
    )).toEqual({ status: "rejected", reason: "zero-size" });
    expect(planStudioGpuReadbackLayout(
      { kind: "document", rect: { x: Number.NaN, y: 0, width: 1, height: 1 } },
      viewport,
      640,
      720
    )).toEqual({ status: "rejected", reason: "invalid-area" });
    expect(planStudioGpuReadbackLayout(
      { kind: "viewport" },
      viewport,
      STUDIO_GPU_MAX_READBACK_PIXELS,
      2
    )).toEqual({ status: "rejected", reason: "oversize" });
    expect(planStudioGpuReadbackLayout(
      null as unknown as { kind: "viewport" },
      viewport,
      640,
      720
    )).toEqual({ status: "rejected", reason: "invalid-area" });
    expect(planStudioGpuReadbackLayout(
      { kind: "document", rect: { x: 0, y: 0, width: 1, height: 1 } },
      null as unknown as typeof viewport,
      640,
      720
    )).toEqual({ status: "rejected", reason: "invalid-area" });
  });

  it("strips padded rows, swaps BGRA and unpremultiplies alpha", () => {
    const layout = {
      x: 0,
      y: 0,
      width: 2,
      height: 2,
      bytesPerRow: 256,
      byteLength: 512,
      pixelCount: 4,
    };
    const source = new Uint8Array(layout.byteLength);
    source.set([25, 50, 100, 128, 0, 0, 0, 0], 0);
    source.set([30, 20, 10, 255, 5, 10, 15, 64], 256);

    expect(copyStudioGpuReadbackRows(
      source,
      layout,
      "bgra8unorm",
      true
    )).toEqual(new Uint8ClampedArray([
      199, 100, 50, 128,
      0, 0, 0, 0,
      10, 20, 30, 255,
      60, 40, 20, 64,
    ]));
  });

  it("preserves RGBA channel order and rejects nonlinear sRGB bytes", () => {
    const layout = {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      bytesPerRow: 256,
      byteLength: 256,
      pixelCount: 1,
    };
    const source = new Uint8Array(layout.byteLength);
    source.set([64, 32, 16, 128]);

    expect(copyStudioGpuReadbackRows(
      source,
      layout,
      "rgba8unorm",
      true
    )).toEqual(new Uint8ClampedArray([128, 64, 32, 128]));
    expect(copyStudioGpuReadbackRows(
      source,
      layout,
      "rgba8unorm-srgb" as "rgba8unorm",
      true
    )).toBeNull();
  });
});
