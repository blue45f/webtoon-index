import { describe, expect, it } from "vitest";

import {
  createStudioCanvasRulerTicks,
  normalizeStudioCanvasRulerDpr,
  normalizeStudioCanvasRulerScale,
  shouldStartStudioCanvasRulerGuideDrag,
  snapStudioCanvasRulerDevicePixel,
  STUDIO_CANVAS_RULER_MAX_TICKS,
  studioCanvasRulerBackingPixels,
  studioCanvasRulerDocumentCoordinate,
  studioCanvasRulerMajorStep,
} from "./studio-canvas-ruler";

describe("studio canvas ruler geometry", () => {
  it("fails safely for zero, negative and non-finite scales", () => {
    for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(normalizeStudioCanvasRulerScale(scale)).toBeNull();
      expect(studioCanvasRulerMajorStep(scale)).toBeNull();
      expect(
        createStudioCanvasRulerTicks({
          viewportPixels: 800,
          scrollPixels: 0,
          scale,
          documentExtent: 720,
        })
      ).toEqual([]);
      expect(
        studioCanvasRulerDocumentCoordinate({
          clientCoordinate: 100,
          rulerStart: 0,
          scrollPixels: 0,
          scale,
          documentExtent: 720,
        })
      ).toBeNull();
    }
  });

  it("uses readable nice-number steps and never emits an unbounded tick list", () => {
    expect(studioCanvasRulerMajorStep(0.2)).toBe(500);
    expect(studioCanvasRulerMajorStep(1)).toBe(50);
    expect(studioCanvasRulerMajorStep(3)).toBe(20);
    expect(studioCanvasRulerMajorStep(100)).toBe(0.5);

    const ticks = createStudioCanvasRulerTicks({
      viewportPixels: 1_000_000,
      scrollPixels: 0,
      scale: 100,
      documentExtent: 1_000_000,
    });
    expect(ticks.length).toBeLessThanOrEqual(STUDIO_CANVAS_RULER_MAX_TICKS);
    expect(ticks.some((tick) => tick.major && tick.label === "0")).toBe(true);
  });

  it("clamps pointer coordinates to the document and sanitizes invalid scroll", () => {
    expect(
      studioCanvasRulerDocumentCoordinate({
        clientCoordinate: -50,
        rulerStart: 10,
        scrollPixels: 0,
        scale: 2,
        documentExtent: 720,
      })
    ).toBe(0);
    expect(
      studioCanvasRulerDocumentCoordinate({
        clientCoordinate: 9_000,
        rulerStart: 10,
        scrollPixels: 0,
        scale: 2,
        documentExtent: 720,
      })
    ).toBe(720);
    expect(
      studioCanvasRulerDocumentCoordinate({
        clientCoordinate: 110,
        rulerStart: 10,
        scrollPixels: Number.NaN,
        scale: 2,
        documentExtent: 720,
      })
    ).toBe(50);
  });

  it("starts guide creation only after crossing from a ruler into the canvas", () => {
    const rect = { left: 0, top: 0, right: 100, bottom: 22 };
    expect(
      shouldStartStudioCanvasRulerGuideDrag(
        "x",
        { clientX: 50, clientY: 25 },
        rect
      )
    ).toBe(false);
    expect(
      shouldStartStudioCanvasRulerGuideDrag(
        "x",
        { clientX: 50, clientY: 26 },
        rect
      )
    ).toBe(true);
    expect(
      shouldStartStudioCanvasRulerGuideDrag(
        "y",
        { clientX: 103, clientY: 50 },
        rect
      )
    ).toBe(false);
    expect(
      shouldStartStudioCanvasRulerGuideDrag(
        "y",
        { clientX: 104, clientY: 50 },
        rect
      )
    ).toBe(true);
  });

  it("creates bounded high-DPI backing stores and one-device-pixel coordinates", () => {
    expect(normalizeStudioCanvasRulerDpr(Number.NaN)).toBe(1);
    expect(normalizeStudioCanvasRulerDpr(8)).toBe(4);
    expect(studioCanvasRulerBackingPixels(300.25, 2)).toBe(601);
    expect(studioCanvasRulerBackingPixels(0, 2)).toBe(1);
    expect(snapStudioCanvasRulerDevicePixel(10, 2)).toBe(10.25);
  });
});
