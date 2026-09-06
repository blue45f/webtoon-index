import { describe, expect, it } from "vitest";

import {
  placeStudioLineSegment,
  planStudioFocusLineSegments,
  planStudioSpeedLineSegments,
  studioSeededRandom,
  STUDIO_FOCUS_LINE_DEFAULTS,
  STUDIO_SPEED_LINE_DEFAULTS,
  type StudioLineSegment,
} from "./studio-radial-line-geometry";

/**
 * GOLDEN — captured from the Konva `sceneFunc` bodies as they shipped BEFORE
 * this planner existed (the artwork artists have been looking at). Every value
 * is exact; the planner is a verbatim lift, so anything but exact equality is a
 * regression in the picture, not a rounding difference.
 *
 * Do NOT regenerate these numbers from the planner. They are the independent
 * side of the comparison — regenerating them turns the test into a tautology.
 */
const GOLDEN = {
  // id "burst-a", 400x300, lineCount 8, inner 40, outer 150, noise 0
  focusNoiseless: [
    [240, 150, 350, 150],
    [228.2842712474619, 178.2842712474619, 306.06601717798213, 256.06601717798213],
    [200, 190, 200, 300],
    [171.7157287525381, 178.2842712474619, 93.93398282201788, 256.06601717798213],
    [160, 150, 50, 150.00000000000003],
    [171.7157287525381, 121.7157287525381, 93.93398282201785, 43.93398282201788],
    [200, 110, 199.99999999999997, 0],
    [228.2842712474619, 121.7157287525381, 306.0660171779821, 43.93398282201785],
  ],
  // id "burst-b", 400x300, lineCount 8, inner 40, outer 150, noise 24, centre (0.4, 0.6)
  focusNoisy: [
    [192.83380282371945, 180, 308.06996212848753, 180],
    [180.86195397997588, 200.86195397997588, 262.08695833203933, 282.0869583320393],
    [160, 210.37888046058652, 160, 320.37675786424006],
    [133.4018438592887, 206.5981561407113, 61.98035161829881, 278.0196483817012],
    [127.59897534894117, 180, 6.195324889878975, 180.00000000000003],
    [126.73633456585603, 146.73633456585605, 58.093139244218236, 78.09313924421826],
    [160, 130.6367484869843, 159.99999999999997, 23.96008843644813],
    [194.66621022578, 145.33378977421998, 261.22992956327386, 78.77007043672607],
  ],
  // id "burst-c", 320x320, every optional field omitted — pure Konva `??` defaults
  focusDefaultsHead: [
    [278.06996212848753, 160, 749.5032582560852, 160],
    [274.02018796235836, 168.9735834051014, 748.558939401117, 206.32059309775508],
    [269.0178368152026, 177.2667290693675, 750.2578349878336, 253.4876568417205],
  ],
  // id "dash-a", 400x200, lineCount 5, horizontal
  speedHorizontal: [
    [0, 142.9200732377467, 297.7538951789029, 142.9200732377467],
    [4.010304243711289, 25.35088447339149, 400, 25.35088447339149],
    [213.96783368778415, 44.66098488010175, 400, 44.66098488010175],
    [15.39605870784726, 36.5378362546835, 400, 36.5378362546835],
    [131.98517310142051, 176.30949246358796, 400, 176.30949246358796],
  ],
  // id "dash-b", 400x200, lineCount 5, vertical
  speedVertical: [
    [272.1923689736286, 51.404153729381505, 272.1923689736286, 200],
    [394.9871196953609, 90.63537508685839, 394.9871196953609, 200],
    [132.5402078902698, 119.43479010282316, 132.5402078902698, 200],
    [380.7549266151909, 0, 380.7549266151909, 42.30373594065895],
    [235.01853362322436, 0, 235.01853362322436, 41.67553604929708],
  ],
  // id "dash-c", 400x200, every optional field omitted
  speedDefaultsHead: [
    [0, 135.74480783827312, 120.5614151574264, 135.74480783827312],
    [248.5424241918372, 86.705781141427, 400, 86.705781141427],
    [0, 50.706512371471035, 138.4605380074936, 50.706512371471035],
  ],
} as const;

function flatten(segments: readonly StudioLineSegment[]): number[][] {
  return segments.map((s) => [s.x1, s.y1, s.x2, s.y2]);
}

const FOCUS_NOISELESS = {
  id: "burst-a",
  width: 400,
  height: 300,
  lineCount: 8,
  innerRadius: 40,
  outerRadius: 150,
  noise: 0,
} as const;

const FOCUS_NOISY = {
  id: "burst-b",
  width: 400,
  height: 300,
  lineCount: 8,
  innerRadius: 40,
  outerRadius: 150,
  noise: 24,
  centerXRatio: 0.4,
  centerYRatio: 0.6,
} as const;

const SPEED_HORIZONTAL = {
  id: "dash-a",
  width: 400,
  height: 200,
  lineCount: 5,
  direction: "horizontal",
} as const;

const SPEED_VERTICAL = {
  id: "dash-b",
  width: 400,
  height: 200,
  lineCount: 5,
  direction: "vertical",
} as const;

describe("studio radial line geometry — golden parity with the pre-planner Konva artwork", () => {
  it("reproduces noiseless focus rays exactly", () => {
    expect(flatten(planStudioFocusLineSegments(FOCUS_NOISELESS))).toEqual(GOLDEN.focusNoiseless);
  });

  it("reproduces seeded noisy focus rays exactly, including the rStart/rEnd clamps", () => {
    expect(flatten(planStudioFocusLineSegments(FOCUS_NOISY))).toEqual(GOLDEN.focusNoisy);
  });

  it("reproduces Konva's defensive defaults for a document missing every optional field", () => {
    const plan = planStudioFocusLineSegments({ id: "burst-c", width: 320, height: 320 });
    expect(plan).toHaveLength(STUDIO_FOCUS_LINE_DEFAULTS.lineCount);
    expect(flatten(plan).slice(0, 3)).toEqual(GOLDEN.focusDefaultsHead);
    expect(plan.every((s) => Number.isFinite(s.x1) && Number.isFinite(s.y2))).toBe(true);
  });

  it("reproduces horizontal and vertical speed lines exactly", () => {
    expect(flatten(planStudioSpeedLineSegments(SPEED_HORIZONTAL))).toEqual(GOLDEN.speedHorizontal);
    expect(flatten(planStudioSpeedLineSegments(SPEED_VERTICAL))).toEqual(GOLDEN.speedVertical);
  });

  it("reproduces speed-line defaults for a document missing every optional field", () => {
    const plan = planStudioSpeedLineSegments({ id: "dash-c", width: 400, height: 200 });
    expect(plan).toHaveLength(STUDIO_SPEED_LINE_DEFAULTS.lineCount);
    expect(flatten(plan).slice(0, 3)).toEqual(GOLDEN.speedDefaultsHead);
  });

  it("treats an unknown direction string as vertical, exactly as Konva does", () => {
    const unknown = planStudioSpeedLineSegments({ ...SPEED_VERTICAL, direction: "diagonal" });
    expect(flatten(unknown)).toEqual(GOLDEN.speedVertical);
  });
});

describe("studio radial line geometry — seeded sequence", () => {
  it("is deterministic per seed and different across seeds", () => {
    const a = studioSeededRandom("el-1");
    const b = studioSeededRandom("el-1");
    const c = studioSeededRandom("el-2");
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect([c(), c(), c()]).not.toEqual(first);
  });

  it("keeps a capped speed-line plan a strict prefix of the uncapped one", () => {
    const full = planStudioSpeedLineSegments(SPEED_HORIZONTAL);
    const capped = planStudioSpeedLineSegments(SPEED_HORIZONTAL, { maxSegments: 3 });
    expect(capped).toEqual(full.slice(0, 3));
  });

  it("redistributes capped focus rays around the full circle instead of slicing a wedge", () => {
    const capped = planStudioFocusLineSegments({ ...FOCUS_NOISELESS, lineCount: 80 }, { maxSegments: 8 });
    // Same count as an authored 8-ray element, and the rays still span 360°.
    expect(flatten(capped)).toEqual(GOLDEN.focusNoiseless);
  });
});

describe("studio radial line geometry — placement", () => {
  it("translates by the node origin when unrotated", () => {
    const placed = placeStudioLineSegment({ x1: 1, y1: 2, x2: 3, y2: 4 }, { x: 10, y: 20 });
    expect(placed).toEqual({ x1: 11, y1: 22, x2: 13, y2: 24 });
  });

  it("rotates about the node ORIGIN, not the pattern centre", () => {
    // A 90° turn sends local (10, 0) to origin + (0, 10). Pivoting anywhere
    // else — e.g. the focus-line centre — lands somewhere different, which is
    // exactly the bug the Vello lowering shipped.
    const placed = placeStudioLineSegment({ x1: 10, y1: 0, x2: 20, y2: 0 }, { x: 5, y: 7, rotationDeg: 90 });
    expect(placed.x1).toBeCloseTo(5, 10);
    expect(placed.y1).toBeCloseTo(17, 10);
    expect(placed.x2).toBeCloseTo(5, 10);
    expect(placed.y2).toBeCloseTo(27, 10);
  });

  it("ignores a non-finite rotation instead of emitting NaN geometry", () => {
    const placed = placeStudioLineSegment(
      { x1: 1, y1: 2, x2: 3, y2: 4 },
      { x: 0, y: 0, rotationDeg: Number.NaN },
    );
    expect(placed).toEqual({ x1: 1, y1: 2, x2: 3, y2: 4 });
  });
});
