import { describe, it, expect } from "vitest";

import { StudioPixelSelectionTransformEngine } from "./studio-pixel-selection-transform";

import type { PixelSelection } from "./studio-selection-tools";

describe("StudioPixelSelectionTransformEngine", () => {
  function makeSquareSelection(): PixelSelection {
    return {
      subpaths: [
        {
          mode: "add",
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
          ],
        },
      ],
      featherPx: 0,
      invert: false,
    };
  }

  it("computes the center of a selection correctly", () => {
    const sel = makeSquareSelection();
    const center = StudioPixelSelectionTransformEngine.computeSelectionCenter(sel);
    expect(center.x).toBe(0.5);
    expect(center.y).toBe(0.5);
  });

  it("translates selection points by offset", () => {
    const sel = makeSquareSelection();
    const transformed = StudioPixelSelectionTransformEngine.transformSelection(sel, {
      translation: [0.1, 0.2],
      rotationAngle: 0,
      scale: [1, 1],
      origin: { x: 0.5, y: 0.5 },
    });

    const pts = transformed.subpaths[0].points;
    expect(pts[0].x).toBeCloseTo(0.1);
    expect(pts[0].y).toBeCloseTo(0.2);
    expect(pts[1].x).toBeCloseTo(1.1);
    expect(pts[1].y).toBeCloseTo(0.2);
  });

  it("scales selection points around origin", () => {
    const sel = makeSquareSelection();
    const transformed = StudioPixelSelectionTransformEngine.transformSelection(sel, {
      translation: [0, 0],
      rotationAngle: 0,
      scale: [2, 2],
      origin: { x: 0.5, y: 0.5 },
    });

    const pts = transformed.subpaths[0].points;
    expect(pts[0].x).toBeCloseTo(-0.5);
    expect(pts[0].y).toBeCloseTo(-0.5);
    expect(pts[2].x).toBeCloseTo(1.5);
    expect(pts[2].y).toBeCloseTo(1.5);
  });

  it("rotates selection points 90 degrees around origin", () => {
    const sel = makeSquareSelection();
    const transformed = StudioPixelSelectionTransformEngine.transformSelection(sel, {
      translation: [0, 0],
      rotationAngle: 90,
      scale: [1, 1],
      origin: { x: 0.5, y: 0.5 },
    });

    const pts = transformed.subpaths[0].points;
    // (0,0) around (0.5, 0.5) rotated 90 deg -> (1, 0)
    expect(pts[0].x).toBeCloseTo(1);
    expect(pts[0].y).toBeCloseTo(0);
  });
});
