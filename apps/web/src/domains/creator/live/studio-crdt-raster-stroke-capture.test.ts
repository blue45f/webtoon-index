import { describe, expect, it, vi } from "vitest";

import { STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1 } from "../brush/studio-ink-pressure-model";

import {
  STUDIO_RASTER_STROKE_CAPTURE_MAX_PIXELS,
  StudioRasterStrokeCaptureError,
  captureStudioRasterStroke,
  planStudioRasterStrokeCapture,
} from "./studio-crdt-raster-stroke-capture";

import type { StudioGpuStroke } from "../render/studio-webgpu-stroke";

function stroke(patch: Partial<StudioGpuStroke> = {}): StudioGpuStroke {
  return {
    id: "stroke-1",
    points: [10, 10, 30, 10],
    color: "#336699",
    size: 10,
    opacity: 0.5,
    ...patch,
  };
}

function fakeCanvas() {
  const context = {
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillStyle: "",
    globalCompositeOperation: "source-over",
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4).fill(7),
    })),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
  };
  return { canvas, context };
}

describe("studio raster stroke capture", () => {
  it("uses the retained WebGPU dab plan and clips a bounded capture to the document", () => {
    const result = planStudioRasterStrokeCapture({
      stroke: stroke({ points: [-2, 8, 10, 8], size: 8 }),
      documentWidth: 100,
      documentHeight: 80,
    });

    expect(result.intent).toBe("paint");
    expect(result.bounds.x).toBe(0);
    expect(result.bounds.y).toBeGreaterThanOrEqual(0);
    expect(result.bounds.x + result.bounds.width).toBeLessThanOrEqual(100);
    expect(result.bounds.y + result.bounds.height).toBeLessThanOrEqual(80);
    expect(result.dabs.length).toBeGreaterThan(1);
  });

  it("captures erasers as an opaque-color alpha mask, never destination-out on transparency", () => {
    const fake = fakeCanvas();
    const result = captureStudioRasterStroke({
      stroke: stroke({ composite: "erase", color: "#000000", opacity: 0.4 }),
      documentWidth: 100,
      documentHeight: 80,
    }, () => fake.canvas as unknown as HTMLCanvasElement);

    expect(result.intent).toBe("erase");
    expect(fake.context.globalCompositeOperation).toBe("source-over");
    expect(fake.context.fillStyle).toMatch(/^rgba\(255, 255, 255,/u);
    expect(result.pixels.byteLength).toBe(result.bounds.width * result.bounds.height * 4);
  });

  it("treats linear pressure zero as zero coverage without rejecting a later visible suffix", () => {
    const pressureModel = STUDIO_INK_PRESSURE_MODEL_LINEAR_FULL_V1;
    expect(() => planStudioRasterStrokeCapture({
      stroke: stroke({ points: [20, 20], pressures: [0], pressureModel }),
      documentWidth: 100,
      documentHeight: 80,
    })).toThrow(/픽셀을 만드는/u);

    const visible = planStudioRasterStrokeCapture({
      stroke: stroke({
        points: [20, 20, 40, 20],
        pressures: [0, 1],
        pressureModel,
      }),
      documentWidth: 100,
      documentHeight: 80,
    });
    expect(visible.dabs.length).toBeGreaterThan(0);
    expect(visible.dabs.every(({ radius }) => radius > 0)).toBe(true);

    const legacy = planStudioRasterStrokeCapture({
      stroke: stroke({ points: [20, 20], pressures: [0] }),
      documentWidth: 100,
      documentHeight: 80,
    });
    expect(legacy.dabs[0]?.radius).toBe(1.5);
  });

  it("keeps paint color/opacity in the uploaded pixels and offsets document dabs locally", () => {
    const fake = fakeCanvas();
    const result = captureStudioRasterStroke({
      stroke: stroke(),
      documentWidth: 100,
      documentHeight: 80,
    }, () => fake.canvas as unknown as HTMLCanvasElement);

    expect(fake.context.setTransform).toHaveBeenCalledWith(
      1,
      0,
      0,
      1,
      -result.bounds.x,
      -result.bounds.y
    );
    expect(fake.context.fillStyle).toMatch(/^rgba\(51, 102, 153,/u);
  });

  it("fails closed for invalid, off-document, or oversized capture requests", () => {
    expect(() => planStudioRasterStrokeCapture({
      stroke: stroke(),
      documentWidth: 0,
      documentHeight: 80,
    })).toThrowError(StudioRasterStrokeCaptureError);

    expect(() => planStudioRasterStrokeCapture({
      stroke: stroke({ points: [200, 200, 220, 220] }),
      documentWidth: 100,
      documentHeight: 80,
    })).toThrow(/교차/u);

    const side = Math.floor(Math.sqrt(STUDIO_RASTER_STROKE_CAPTURE_MAX_PIXELS)) + 1;
    expect(() => planStudioRasterStrokeCapture({
      stroke: stroke({
        points: [side / 2, side / 2],
        size: Math.min(8_192, side * 2),
      }),
      documentWidth: side,
      documentHeight: side,
    })).toThrow(/16MP/u);
  });
});
