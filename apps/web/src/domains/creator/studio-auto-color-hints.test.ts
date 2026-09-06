import { describe, expect, it } from "vitest";

import {
  planStudioAutoColorHints,
  STUDIO_AUTO_COLOR_HINT_MAX_ID_LENGTH,
  STUDIO_AUTO_COLOR_HINT_MAX_PIXELS,
  type StudioAutoColorHintImageDataLike,
  type StudioAutoColorHintRgba,
  type StudioAutoColorHintSeed,
} from "./studio-auto-color-hints";

const CLEAR: StudioAutoColorHintRgba = [0, 0, 0, 0];
const WHITE: StudioAutoColorHintRgba = [255, 255, 255, 255];
const BLACK: StudioAutoColorHintRgba = [0, 0, 0, 255];
const RED: StudioAutoColorHintRgba = [240, 40, 30, 255];
const BLUE: StudioAutoColorHintRgba = [30, 80, 240, 255];

function imageFromRows(
  rows: readonly string[],
  palette: Readonly<Record<string, StudioAutoColorHintRgba>> = { W: WHITE, B: BLACK, T: CLEAR },
): StudioAutoColorHintImageDataLike {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) => {
    expect(row).toHaveLength(width);
    [...row].forEach((key, x) => {
      const color = palette[key];
      if (!color) throw new Error(`Missing test palette color ${key}`);
      data.set(color, (y * width + x) * 4);
    });
  });
  return { data, width, height };
}

function seed(
  id: string,
  x: number,
  y: number,
  color: StudioAutoColorHintRgba,
): StudioAutoColorHintSeed {
  return { id, x, y, color };
}

function baseRecommendations() {
  return {
    minimumArea: 1,
    minimumBackgroundArea: 1,
    minimumTransparentArea: 1,
    maximumRecommendations: 20,
  } as const;
}

describe("planStudioAutoColorHints component plans", () => {
  it("labels deterministic components and creates one operation per color-hinted region", () => {
    const image = imageFromRows(["WWBWW", "WWBWW"]);
    const plan = planStudioAutoColorHints({
      image,
      seeds: [seed("left", 0, 0, RED), seed("right", 4, 1, BLUE)],
      options: { recommendations: baseRecommendations() },
    });

    expect(plan.status).toBe("ready");
    expect(Array.from(plan.labels)).toEqual([1, 1, 0, 2, 2, 1, 1, 0, 2, 2]);
    expect(plan.components).toEqual([
      {
        label: 1,
        area: 4,
        bounds: { x: 0, y: 0, width: 2, height: 2 },
        representative: { x: 0, y: 0 },
        touchesCanvasEdge: true,
        transparentArea: 0,
        fullyTransparent: false,
      },
      {
        label: 2,
        area: 4,
        bounds: { x: 3, y: 0, width: 2, height: 2 },
        representative: { x: 3, y: 0 },
        touchesCanvasEdge: true,
        transparentArea: 0,
        fullyTransparent: false,
      },
    ]);
    expect(plan.operations.map(({ componentLabel, color }) => ({ componentLabel, color }))).toEqual([
      { componentLabel: 1, color: RED },
      { componentLabel: 2, color: BLUE },
    ]);
    expect(plan.recommendations).toEqual([]);
  });

  it("deduplicates same-color hints in one component using stable hint-id ordering", () => {
    const plan = planStudioAutoColorHints({
      image: imageFromRows(["WWW"]),
      seeds: [seed("z-last", 2, 0, RED), seed("a-first", 0, 0, RED)],
    });

    expect(plan.status).toBe("ready");
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]).toMatchObject({
      sourceHintId: "a-first",
      hintIds: ["a-first", "z-last"],
      componentLabel: 1,
    });
    expect(plan.deduplicatedHints).toEqual([
      {
        componentLabel: 1,
        retainedHintId: "a-first",
        duplicateHintId: "z-last",
        color: RED,
      },
    ]);
  });

  it("blocks the whole batch when one component has different color hints", () => {
    const plan = planStudioAutoColorHints({
      image: imageFromRows(["WWBWW"]),
      seeds: [seed("red", 0, 0, RED), seed("blue", 1, 0, BLUE), seed("safe", 4, 0, BLUE)],
    });

    expect(plan.status).toBe("blocked");
    expect(plan.operations).toEqual([]);
    expect(plan.conflicts).toEqual([
      {
        componentLabel: 1,
        area: 2,
        bounds: { x: 0, y: 0, width: 2, height: 1 },
        choices: [
          { color: BLUE, hintIds: ["blue"] },
          { color: RED, hintIds: ["red"] },
        ],
      },
    ]);
    expect(plan.diagnostics.conflictCount).toBe(1);
  });

  it("validates exact RGBA palette lock membership and fails closed", () => {
    const plan = planStudioAutoColorHints({
      image: imageFromRows(["WWBWW"]),
      seeds: [seed("allowed", 0, 0, RED), seed("forbidden", 4, 0, BLUE)],
      paletteLock: { colors: [RED] },
    });

    expect(plan.status).toBe("blocked");
    expect(plan.operations).toEqual([]);
    expect(plan.rejectedHints).toEqual([
      { hintId: "forbidden", reason: "palette-locked", componentLabel: 2 },
    ]);
    expect(plan.diagnostics).toMatchObject({
      paletteLockEnabled: true,
      acceptedHintCount: 1,
      rejectedHintCount: 1,
    });
  });
});

describe("planStudioAutoColorHints recommendations and boundaries", () => {
  it("sorts unhinted regions by descending area then stable scan-order label", () => {
    const image = imageFromRows(["WWWBWWBWW", "WWWBWWBWW"]);
    const first = planStudioAutoColorHints({
      image,
      seeds: [],
      options: { recommendations: baseRecommendations() },
    });
    const second = planStudioAutoColorHints({
      image,
      seeds: [],
      options: { recommendations: baseRecommendations() },
    });

    expect(first.recommendations.map(({ componentLabel, area }) => [componentLabel, area])).toEqual([
      [1, 6],
      [2, 4],
      [3, 4],
    ]);
    expect(first.recommendations).toEqual(second.recommendations);
    expect(first.labels).toEqual(second.labels);
  });

  it("applies independent background and fully-transparent minimum-area policies", () => {
    const image = imageFromRows([
      "WWWWW",
      "WBBBW",
      "WBTBW",
      "WBBBW",
      "WWWWW",
    ]);
    const excluded = planStudioAutoColorHints({
      image,
      seeds: [],
      options: {
        recommendations: {
          minimumArea: 1,
          minimumBackgroundArea: 17,
          minimumTransparentArea: 2,
          maximumRecommendations: 10,
        },
      },
    });
    const included = planStudioAutoColorHints({
      image,
      seeds: [],
      options: {
        recommendations: {
          minimumArea: 1,
          minimumBackgroundArea: 16,
          minimumTransparentArea: 1,
          maximumRecommendations: 10,
        },
      },
    });

    expect(excluded.components.map(({ area, touchesCanvasEdge, fullyTransparent }) => ({
      area,
      touchesCanvasEdge,
      fullyTransparent,
    }))).toEqual([
      { area: 16, touchesCanvasEdge: true, fullyTransparent: false },
      { area: 1, touchesCanvasEdge: false, fullyTransparent: true },
    ]);
    expect(excluded.recommendations).toEqual([]);
    expect(included.recommendations.map(({ componentLabel, requiredMinimumArea }) => ({
      componentLabel,
      requiredMinimumArea,
    }))).toEqual([
      { componentLabel: 1, requiredMinimumArea: 16 },
      { componentLabel: 2, requiredMinimumArea: 1 },
    ]);
  });

  it("treats transparent black as fillable and respects anti-aliased ink strength threshold", () => {
    const image = imageFromRows(["WabcW"], {
      W: WHITE,
      a: [0, 0, 0, 0],
      b: [0, 0, 0, 31],
      c: [0, 0, 0, 32],
    });
    const plan = planStudioAutoColorHints({
      image,
      seeds: [],
      options: {
        boundaryInkThreshold: 32,
        recommendations: baseRecommendations(),
      },
    });

    expect(Array.from(plan.labels)).toEqual([1, 1, 1, 0, 2]);
    expect(plan.diagnostics.boundaryPixelCount).toBe(1);
    expect(plan.components[0]).toMatchObject({ area: 3, transparentArea: 1 });
  });

  it("rejects a hint placed on boundary ink instead of planning a partial fill", () => {
    const plan = planStudioAutoColorHints({
      image: imageFromRows(["WBW"]),
      seeds: [seed("left", 0, 0, RED), seed("ink", 1, 0, RED)],
    });

    expect(plan.status).toBe("blocked");
    expect(plan.operations).toEqual([]);
    expect(plan.rejectedHints).toEqual([
      { hintId: "ink", reason: "boundary", componentLabel: null },
    ]);
  });
});

describe("planStudioAutoColorHints safety budgets and immutability", () => {
  it("enforces lowered hint and component budgets before exposing a plan", () => {
    const image = imageFromRows(["WBWBW"]);
    expect(() =>
      planStudioAutoColorHints({
        image,
        seeds: [seed("a", 0, 0, RED), seed("b", 2, 0, RED)],
        options: { budgets: { maxHints: 1 } },
      }),
    ).toThrow(/hint request budget/);
    expect(() =>
      planStudioAutoColorHints({
        image,
        seeds: [],
        options: { budgets: { maxComponents: 2 } },
      }),
    ).toThrow(/connected-component request budget/);
  });

  it("rejects malformed dimensions, buffers, coordinates, ids, and attempts to raise hard budgets", () => {
    expect(() =>
      planStudioAutoColorHints({
        image: { data: new Uint8ClampedArray(0), width: STUDIO_AUTO_COLOR_HINT_MAX_PIXELS + 1, height: 1 },
        seeds: [],
      }),
    ).toThrow(/image.width/);
    expect(() =>
      planStudioAutoColorHints({
        image: { data: new Uint8ClampedArray(3), width: 1, height: 1 },
        seeds: [],
      }),
    ).toThrow(/data length/);
    expect(() =>
      planStudioAutoColorHints({
        image: imageFromRows(["W"]),
        seeds: [seed("bad", Number.NaN, 0, RED)],
      }),
    ).toThrow(/seeds\[0\]\.x/);
    expect(() =>
      planStudioAutoColorHints({
        image: imageFromRows(["WW"]),
        seeds: [seed("same", 0, 0, RED), seed("same", 1, 0, RED)],
      }),
    ).toThrow(/duplicate id/);
    expect(() =>
      planStudioAutoColorHints({
        image: imageFromRows(["W"]),
        seeds: [seed("x".repeat(STUDIO_AUTO_COLOR_HINT_MAX_ID_LENGTH + 1), 0, 0, RED)],
      }),
    ).toThrow(/character safety limit/);
    expect(() =>
      planStudioAutoColorHints({
        image: imageFromRows(["W"]),
        seeds: [],
        options: { budgets: { maxPixels: STUDIO_AUTO_COLOR_HINT_MAX_PIXELS + 1 } },
      }),
    ).toThrow(/options\.budgets\.maxPixels/);
  });

  it("never mutates image, seed colors, or palette and returns only labels and batch metadata", () => {
    const image = imageFromRows(["WWBWW"]);
    const seeds = [seed("left", 0, 0, RED), seed("right", 4, 0, BLUE)];
    const paletteLock = { colors: [RED, BLUE] } as const;
    const beforeImage = image.data.slice();
    const beforeSeeds = structuredClone(seeds);
    const beforePalette = structuredClone(paletteLock);

    const plan = planStudioAutoColorHints({ image, seeds, paletteLock });

    expect(image.data).toEqual(beforeImage);
    expect(seeds).toEqual(beforeSeeds);
    expect(paletteLock).toEqual(beforePalette);
    expect(plan).not.toHaveProperty("imageData");
    expect(plan).not.toHaveProperty("pixels");
    plan.labels[0] = 99;
    expect(image.data).toEqual(beforeImage);
  });
});
