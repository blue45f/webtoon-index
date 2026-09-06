import { describe, expect, it } from "vitest";

import {
  mapStudioDocumentPointToAutoColorSeed,
  sampleStudioAutoColorStrokeSeeds,
  shouldKeepStudioAutoColorStrokeSample,
  STUDIO_AUTO_COLOR_STROKE_SEED_MAX,
  studioAutoColorCanvasSeedId,
} from "./studio-auto-color-hints-canvas-seed";

const FRAME = { x: 100, y: 50, width: 200, height: 100 } as const;

describe("mapStudioDocumentPointToAutoColorSeed", () => {
  it("maps the top-left corner of an axis-aligned image to planner origin", () => {
    expect(
      mapStudioDocumentPointToAutoColorSeed({
        documentX: 100,
        documentY: 50,
        image: FRAME,
        pixelWidth: 40,
        pixelHeight: 20,
      }),
    ).toEqual({ x: 0, y: 0 });
  });

  it("maps the interior proportionally into pixel space", () => {
    const sample = mapStudioDocumentPointToAutoColorSeed({
      documentX: 200, // mid X of frame
      documentY: 100, // mid Y of frame
      image: FRAME,
      pixelWidth: 40,
      pixelHeight: 20,
    });
    expect(sample).not.toBeNull();
    expect(sample!.x).toBeCloseTo(20, 5);
    expect(sample!.y).toBeCloseTo(10, 5);
  });

  it("returns null outside the image frame", () => {
    expect(
      mapStudioDocumentPointToAutoColorSeed({
        documentX: 50,
        documentY: 50,
        image: FRAME,
        pixelWidth: 40,
        pixelHeight: 20,
      }),
    ).toBeNull();
  });

  it("maps a free-rotation point through the inverse image transform", () => {
    const radians = Math.PI / 4;
    const localX = 50;
    const localY = 30;
    const sample = mapStudioDocumentPointToAutoColorSeed({
      documentX: FRAME.x + Math.cos(radians) * localX - Math.sin(radians) * localY,
      documentY: FRAME.y + Math.sin(radians) * localX + Math.cos(radians) * localY,
      image: { ...FRAME, rotation: 45 },
      pixelWidth: 40,
      pixelHeight: 20,
    });
    expect(sample).not.toBeNull();
    expect(sample!.x).toBeCloseTo(10, 5);
    expect(sample!.y).toBeCloseTo(6, 5);
  });

  it("supports 180° rotation around the Konva node origin", () => {
    const sample = mapStudioDocumentPointToAutoColorSeed({
      documentX: -100,
      documentY: -50,
      image: { ...FRAME, rotation: 180 },
      pixelWidth: 40,
      pixelHeight: 20,
    });
    // The transformed local bottom-right corner maps to the opposite planner corner.
    expect(sample).not.toBeNull();
    expect(sample!.x).toBeCloseTo(40 - 1e-6, 4);
    expect(sample!.y).toBeCloseTo(20 - 1e-6, 4);
  });

  it("mirrors horizontal and vertical flips around the frame center", () => {
    // Document point at the left edge mid-height → after H-flip becomes right edge in planner.
    const hFlip = mapStudioDocumentPointToAutoColorSeed({
      documentX: 100,
      documentY: 100,
      image: { ...FRAME, flipped: true },
      pixelWidth: 40,
      pixelHeight: 20,
    });
    expect(hFlip).not.toBeNull();
    expect(hFlip!.x).toBeCloseTo(40 - 1e-6, 4);
    expect(hFlip!.y).toBeCloseTo(10, 5);

    // Document point at top edge mid-width → after V-flip becomes bottom edge in planner.
    const vFlip = mapStudioDocumentPointToAutoColorSeed({
      documentX: 200,
      documentY: 50,
      image: { ...FRAME, flippedY: true },
      pixelWidth: 40,
      pixelHeight: 20,
    });
    expect(vFlip).not.toBeNull();
    expect(vFlip!.x).toBeCloseTo(20, 5);
    expect(vFlip!.y).toBeCloseTo(20 - 1e-6, 4);
  });

  it("composes 180° rotation with the baked horizontal flip", () => {
    const sample = mapStudioDocumentPointToAutoColorSeed({
      documentX: -100,
      documentY: -50,
      image: { ...FRAME, rotation: 180, flipped: true },
      pixelWidth: 40,
      pixelHeight: 20,
    });
    expect(sample).not.toBeNull();
    expect(sample!.x).toBeCloseTo(0, 0);
    expect(sample!.y).toBeCloseTo(20 - 1e-6, 4);
  });
});

describe("studioAutoColorCanvasSeedId", () => {
  it("builds a stable ordered id", () => {
    expect(studioAutoColorCanvasSeedId(0)).toBe("canvas-scribble-0");
    expect(studioAutoColorCanvasSeedId(3)).toBe("canvas-scribble-3");
  });
});

describe("sampleStudioAutoColorStrokeSeeds", () => {
  it("thins a freehand polyline by document min-distance and maps into planner pixels", () => {
    // Dense points along the horizontal midline of the frame (y=100).
    const documentPoints: number[] = [];
    for (let x = 100; x <= 300; x += 2) {
      documentPoints.push(x, 100);
    }
    const samples = sampleStudioAutoColorStrokeSeeds({
      documentPoints,
      image: FRAME,
      pixelWidth: 40,
      pixelHeight: 20,
      minDistanceDoc: 20,
    });
    expect(samples.length).toBeGreaterThan(1);
    expect(samples.length).toBeLessThan(documentPoints.length / 2);
    // First sample near left edge mid-height.
    expect(samples[0]!.x).toBeCloseTo(0, 0);
    expect(samples[0]!.y).toBeCloseTo(10, 0);
    // Spacing roughly minDistanceDoc mapped into pixel space (20 doc / 200 frame * 40 px = 4).
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]!.x - samples[i - 1]!.x).toBeGreaterThanOrEqual(3.5);
    }
  });

  it("drops points outside the image and respects maxSeeds", () => {
    const samples = sampleStudioAutoColorStrokeSeeds({
      documentPoints: [
        50, 50, // outside
        150, 80,
        200, 80,
        250, 80,
        400, 80, // outside
      ],
      image: FRAME,
      pixelWidth: 40,
      pixelHeight: 20,
      minDistanceDoc: 1,
      maxSeeds: 2,
    });
    expect(samples).toHaveLength(2);
    expect(samples[0]!.x).toBeGreaterThan(0);
  });

  it("caps at STUDIO_AUTO_COLOR_STROKE_SEED_MAX by default", () => {
    const documentPoints: number[] = [];
    for (let i = 0; i < 500; i += 1) {
      documentPoints.push(100 + i * 0.4, 100);
    }
    const samples = sampleStudioAutoColorStrokeSeeds({
      documentPoints,
      image: FRAME,
      pixelWidth: 200,
      pixelHeight: 20,
      minDistanceDoc: 0.5,
    });
    expect(samples.length).toBeLessThanOrEqual(STUDIO_AUTO_COLOR_STROKE_SEED_MAX);
  });
});

describe("shouldKeepStudioAutoColorStrokeSample", () => {
  it("always keeps the first sample and gates later ones by distance", () => {
    expect(
      shouldKeepStudioAutoColorStrokeSample({
        hasLast: false,
        lastDocX: 0,
        lastDocY: 0,
        nextDocX: 1,
        nextDocY: 0,
      }),
    ).toBe(true);
    expect(
      shouldKeepStudioAutoColorStrokeSample({
        lastDocX: 0,
        lastDocY: 0,
        nextDocX: 3,
        nextDocY: 0,
        minDistanceDoc: 8,
      }),
    ).toBe(false);
    expect(
      shouldKeepStudioAutoColorStrokeSample({
        lastDocX: 0,
        lastDocY: 0,
        nextDocX: 10,
        nextDocY: 0,
        minDistanceDoc: 8,
      }),
    ).toBe(true);
  });
});
