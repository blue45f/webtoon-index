import { describe, expect, it } from "vitest";

import {
  planStudioAutoColorHints,
  type StudioAutoColorHintImageDataLike,
  type StudioAutoColorHintRgba,
  type StudioAutoColorHintSeed,
} from "./studio-auto-color-hints";
import {
  appendStudioAutoColorScribbleSeed,
  applyStudioAutoColorHintsAdvancedFillBatch,
  applyStudioAutoColorHintsToPaintTarget,
  createStudioAutoColorBlankPaintTarget,
  planStudioAutoColorHintsAdvancedFillJobs,
  STUDIO_AUTO_COLOR_SCRIBBLE_SEED_MAX,
  studioAutoColorScribbleSeedFromRecommendation,
} from "./studio-auto-color-hints-advanced-fill";

const WHITE: StudioAutoColorHintRgba = [255, 255, 255, 255];
const BLACK: StudioAutoColorHintRgba = [0, 0, 0, 255];
const RED: StudioAutoColorHintRgba = [240, 40, 30, 255];
const BLUE: StudioAutoColorHintRgba = [30, 80, 240, 255];

function imageFromRows(
  rows: readonly string[],
  palette: Readonly<Record<string, StudioAutoColorHintRgba>> = { W: WHITE, B: BLACK },
): StudioAutoColorHintImageDataLike {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) => {
    [...row].forEach((key, x) => {
      const color = palette[key]!;
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

function readyTwoRegionPlan() {
  const image = imageFromRows(["WWBWW", "WWBWW"]);
  const plan = planStudioAutoColorHints({
    image,
    seeds: [seed("left", 0, 0, RED), seed("right", 4, 1, BLUE)],
    options: {
      recommendations: {
        minimumArea: 1,
        minimumBackgroundArea: 1,
        minimumTransparentArea: 1,
        maximumRecommendations: 8,
      },
    },
  });
  return { image, plan };
}

describe("appendStudioAutoColorScribbleSeed", () => {
  it("appends, replaces by id, and caps length", () => {
    let seeds: StudioAutoColorHintSeed[] = [];
    seeds = appendStudioAutoColorScribbleSeed(seeds, seed("a", 0, 0, RED));
    seeds = appendStudioAutoColorScribbleSeed(seeds, seed("b", 1, 0, BLUE));
    expect(seeds).toHaveLength(2);
    seeds = appendStudioAutoColorScribbleSeed(seeds, seed("a", 2, 0, BLUE));
    expect(seeds).toHaveLength(2);
    expect(seeds.find((entry) => entry.id === "a")?.x).toBe(2);

    for (let i = 0; i < STUDIO_AUTO_COLOR_SCRIBBLE_SEED_MAX + 8; i += 1) {
      seeds = appendStudioAutoColorScribbleSeed(
        seeds,
        seed(`n${i}`, i % 5, 0, RED),
      );
    }
    expect(seeds.length).toBe(STUDIO_AUTO_COLOR_SCRIBBLE_SEED_MAX);
  });
});

describe("studioAutoColorScribbleSeedFromRecommendation", () => {
  it("builds a stable scribble id from component label", () => {
    expect(
      studioAutoColorScribbleSeedFromRecommendation({
        componentLabel: 3,
        x: 4,
        y: 5,
        color: RED,
      }),
    ).toEqual({
      id: "scribble-c3",
      x: 4,
      y: 5,
      color: RED,
    });
  });
});

describe("planStudioAutoColorHintsAdvancedFillJobs", () => {
  it("maps ready operations to boundary-fill jobs at component representatives", () => {
    const { plan } = readyTwoRegionPlan();
    expect(plan.status).toBe("ready");
    const jobs = planStudioAutoColorHintsAdvancedFillJobs(plan);
    expect(jobs.ok).toBe(true);
    if (!jobs.ok) return;
    expect(jobs.jobs).toHaveLength(2);
    expect(jobs.jobs[0]).toMatchObject({
      componentLabel: 1,
      seed: { x: 0, y: 0 },
      fill: RED,
    });
    expect(jobs.jobs[1]).toMatchObject({
      componentLabel: 2,
      seed: { x: 3, y: 0 },
      fill: BLUE,
    });
  });

  it("fails closed for blocked or empty plans", () => {
    const image = imageFromRows(["WWBWW"]);
    const blocked = planStudioAutoColorHints({
      image,
      seeds: [seed("a", 0, 0, RED), seed("b", 0, 0, BLUE)],
    });
    expect(blocked.status).toBe("blocked");
    expect(planStudioAutoColorHintsAdvancedFillJobs(blocked).ok).toBe(false);

    const empty = planStudioAutoColorHints({
      image,
      seeds: [],
      options: {
        recommendations: {
          minimumArea: 1,
          minimumBackgroundArea: 1,
          minimumTransparentArea: 1,
          maximumRecommendations: 4,
        },
      },
    });
    expect(empty.status).toBe("ready");
    expect(empty.operations).toHaveLength(0);
    const emptyJobs = planStudioAutoColorHintsAdvancedFillJobs(empty);
    expect(emptyJobs.ok).toBe(false);
    if (emptyJobs.ok) return;
    expect(emptyJobs.reason).toMatch(/시드/);
  });
});

describe("applyStudioAutoColorHintsAdvancedFillBatch", () => {
  it("paints ready operations into a cloned raster without mutating the source", () => {
    const { image, plan } = readyTwoRegionPlan();
    const sourceSnapshot = new Uint8ClampedArray(image.data);

    const result = applyStudioAutoColorHintsAdvancedFillBatch({
      plan,
      target: image,
      referenceImage: image,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("applied");
    expect(result.jobCount).toBe(2);
    expect(result.paintedPixelCount).toBeGreaterThan(0);
    // Source buffer must stay untouched.
    expect(Array.from(image.data)).toEqual(Array.from(sourceSnapshot));
    // Left region representative painted red.
    expect(Array.from(result.imageData.data.slice(0, 4))).toEqual([...RED]);
    // Ink column stays black (boundary).
    const inkIndex = (0 * image.width + 2) * 4;
    expect(Array.from(result.imageData.data.slice(inkIndex, inkIndex + 4))).toEqual([...BLACK]);
    // Right region representative painted blue.
    const rightIndex = (0 * image.width + 3) * 4;
    expect(Array.from(result.imageData.data.slice(rightIndex, rightIndex + 4))).toEqual([...BLUE]);
  });

  it("does not apply a blocked plan", () => {
    const image = imageFromRows(["WWW"]);
    const plan = planStudioAutoColorHints({
      image,
      seeds: [seed("a", 0, 0, RED), seed("b", 2, 0, BLUE)],
    });
    expect(plan.status).toBe("blocked");
    const result = applyStudioAutoColorHintsAdvancedFillBatch({ plan, target: image });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Array.from(result.imageData.data)).toEqual(Array.from(image.data));
  });
});

describe("createStudioAutoColorBlankPaintTarget + multi-layer paint", () => {
  it("builds a transparent canvas of the requested size", () => {
    const blank = createStudioAutoColorBlankPaintTarget(3, 2);
    expect(blank.width).toBe(3);
    expect(blank.height).toBe(2);
    expect(blank.data.length).toBe(3 * 2 * 4);
    expect(Array.from(blank.data)).toEqual(new Array(24).fill(0));
  });

  it("paints plan colors onto a blank layer without mutating the line-art source", () => {
    const { image, plan } = readyTwoRegionPlan();
    const lineArtSnapshot = new Uint8ClampedArray(image.data);
    const blank = createStudioAutoColorBlankPaintTarget(image.width, image.height);

    const result = applyStudioAutoColorHintsToPaintTarget({
      plan,
      paintTarget: blank,
      referenceImage: image,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("applied");
    // Line art untouched.
    expect(Array.from(image.data)).toEqual(Array.from(lineArtSnapshot));
    // Blank layer received region paints.
    expect(Array.from(result.imageData.data.slice(0, 4))).toEqual([...RED]);
    const rightIndex = (0 * image.width + 3) * 4;
    expect(Array.from(result.imageData.data.slice(rightIndex, rightIndex + 4))).toEqual([...BLUE]);
    // Ink column stays transparent on the paint layer (label 0).
    const inkIndex = (0 * image.width + 2) * 4;
    expect(Array.from(result.imageData.data.slice(inkIndex, inkIndex + 4))).toEqual([0, 0, 0, 0]);
  });
});
