import { describe, expect, it } from "vitest";

import { planOilBrushDabs } from "../studio-fx-brush";

import {
  planStudioOilRibbonCarrier,
  studioOilRibbonPathData,
  STUDIO_OIL_RIBBON_CARRIER_VERSION,
  traceStudioOilRibbonPath,
} from "./studio-oil-ribbon-carrier";

describe("studio oil/acrylic ribbon carrier", () => {
  it("replaces repeated ellipse bodies with one contiguous variable-width outline", () => {
    const dabs = planOilBrushDabs({
      points: [0, 0, 80, 30, 160, -10, 240, 45],
      pressures: [0.25, 0.65, 0.9, 0.45],
      baseWidth: 27,
      seed: 71,
    });
    const plan = planStudioOilRibbonCarrier(dabs);

    expect(plan.version).toBe(STUDIO_OIL_RIBBON_CARRIER_VERSION);
    expect(plan.sourceStationCount).toBe(dabs.length);
    expect(plan.repeatedBodyStampCount).toBe(0);
    expect(plan.body).not.toBeNull();
    expect(plan.body!.points.length).toBe(dabs.length * 4 + 12);
    // Five bristles cut into runs and regrouped into load bands. Every station of every bristle
    // is still covered — the relief is quantised for compositing, never dropped.
    expect(plan.bristleLanes.length).toBeGreaterThan(0);
    const runStations = plan.bristleLanes
      .flatMap((lane) => lane.runs)
      .reduce((total, run) => total + run.points.length / 2, 0);
    expect(runStations).toBeGreaterThanOrEqual(5 * dabs.length);
    // The body is the film the head spread, so it carries at least the mean station load. It used
    // to carry a two-overlap fold of it (0.68 against a 0.44 mean), which put the film ABOVE the
    // lowest band a hair could deposit — every furrow lighter than the film was then invisible by
    // construction and the bed rendered as a slab with a few dark decals. What the film must do is
    // leave the band range visible against it, so that is what is asserted.
    const meanStationLoad = dabs.reduce((sum, dab) => sum + dab.opacity, 0) / dabs.length;
    expect(plan.bodyOpacity).toBeCloseTo(meanStationLoad, 3);
    const bandTones = plan.bristleLanes.map(({ opacity }) => opacity);
    expect(Math.min(...bandTones)).toBeLessThan(plan.bodyOpacity);
    expect(Math.max(...bandTones)).toBeGreaterThan(0);
  });

  it("keeps bristle load varying along the stroke instead of collapsing it to one mean", () => {
    const dabs = planOilBrushDabs({
      points: [0, 0, 240, 0, 480, 0, 720, 0],
      pressures: [0.6, 0.6, 0.6, 0.6],
      baseWidth: 22,
      seed: 7,
    });
    const plan = planStudioOilRibbonCarrier(dabs);
    expect(plan.bristleLanes.length).toBeGreaterThanOrEqual(2);
    const widths = plan.bristleLanes.map(({ lineWidth }) => lineWidth);
    // What matters is the range of deposits a pixel can end up carrying, and the lanes are
    // cumulative shells, so a lane's own `opacity` is an INCREMENT rather than a final tone. Fold
    // each gauge's shells the way the renderer does — successive multiply passes — and check the
    // resulting tones actually span the load range. The old assertion read the raw increments and
    // would now report the spread of deltas, which is a different and much smaller number.
    const foldedByGauge = new Map<number, number[]>();
    for (const lane of plan.bristleLanes) {
      const carried = foldedByGauge.get(lane.lineWidth) ?? [];
      const previous = carried.at(-1) ?? 0;
      carried.push(1 - (1 - previous) * (1 - lane.opacity));
      foldedByGauge.set(lane.lineWidth, carried);
    }
    const folded = [...foldedByGauge.values()].flat();
    // A single averaged lane made this range exactly zero, which is what a 770 px measured stroke
    // reported as a length-axis coefficient of variation of 0.002.
    expect(Math.max(...folded) - Math.min(...folded)).toBeGreaterThan(0.35);
    // The outermost shell of every gauge carries that gauge's whole population, so it must be
    // spread over the stroke. Inner shells legitimately hold only the heaviest runs — that IS the
    // tonal resolution — so they carry no minimum of their own beyond being non-empty.
    for (const lanes of foldedByGauge.values()) expect(lanes.length).toBeGreaterThan(1);
    for (const [lineWidth, lanes] of foldedByGauge) {
      const outermost = plan.bristleLanes.find((lane) => lane.lineWidth === lineWidth)!;
      expect(outermost.runs.length, `gauge ${lineWidth} outer shell`).toBeGreaterThan(8);
      expect(lanes).toStrictEqual([...lanes].sort((left, right) => left - right));
    }
    for (const lane of plan.bristleLanes) expect(lane.runs.length).toBeGreaterThan(0);
    // The ridge must be a material fraction of the ribbon rather than a hairline.
    const meanRadiusY = dabs.reduce((sum, dab) => sum + dab.radiusY, 0) / dabs.length;
    expect(Math.max(...widths)).toBeGreaterThan(meanRadiusY * 0.15);
    expect(Math.max(...widths)).toBeLessThan(meanRadiusY * 0.5);
  });

  it("responds monotonically to pressure in width, body load and bristle contact", () => {
    const light = planStudioOilRibbonCarrier(planOilBrushDabs({
      points: [0, 0, 180, 12, 360, -8, 540, 10],
      pressures: [0.12, 0.12, 0.12, 0.12],
      baseWidth: 24,
      seed: 19,
    }));
    const heavy = planStudioOilRibbonCarrier(planOilBrushDabs({
      points: [0, 0, 180, 12, 360, -8, 540, 10],
      pressures: [0.94, 0.94, 0.94, 0.94],
      baseWidth: 24,
      seed: 19,
    }));
    expect(light.body).not.toBeNull();
    expect(heavy.body).not.toBeNull();
    const bodyWidth = (plan: ReturnType<typeof planStudioOilRibbonCarrier>) => {
      const points = plan.body!.points;
      let maxCross = 0;
      for (let index = 0; index + 3 < points.length; index += 2) {
        maxCross = Math.max(
          maxCross,
          Math.hypot(points[index]! - points[index + 2]!, points[index + 1]! - points[index + 3]!),
        );
      }
      return maxCross;
    };
    expect(bodyWidth(heavy)).toBeGreaterThan(bodyWidth(light) * 1.18);
    expect(heavy.bodyOpacity).toBeGreaterThan(light.bodyOpacity);
    const heavyRidge = Math.max(...heavy.bristleLanes.map(({ lineWidth }) => lineWidth));
    const lightRidge = Math.max(...light.bristleLanes.map(({ lineWidth }) => lineWidth));
    expect(heavyRidge).toBeGreaterThan(lightRidge * 1.08);
    // Deposited relief, measured as run STATIONS rather than run count. Consecutive runs of one
    // hair that stay in the same band are welded into a single furrow, so a heavier stroke — whose
    // load is steadier and therefore welds further — legitimately emits FEWER, longer runs while
    // laying down more paint. Counting runs measured the fragmentation, not the deposit.
    const stations = (plan: ReturnType<typeof planStudioOilRibbonCarrier>) => plan.bristleLanes
      .flatMap((lane) => lane.runs)
      .reduce((total, run) => total + run.points.length / 2, 0);
    expect(stations(heavy)).toBeGreaterThanOrEqual(stations(light));
  });

  it("emits multi-lane bristle structure rather than a soft round dab or flat ribbon only", () => {
    const dabs = planOilBrushDabs({
      points: [0, 0, 120, 20, 240, -10, 360, 16],
      pressures: [0.55, 0.7, 0.85, 0.6],
      baseWidth: 28,
      seed: 33,
    });
    // The bed scales with head width now (it was seven hairs at every size, which left a 28px head
    // with furrows further apart than they were wide). Pinned as a band around the width rule so
    // the count stays a deliberate choice rather than drifting.
    expect(dabs.every((dab) => dab.bristles.length >= 7)).toBe(true);
    expect(dabs.every((dab) => dab.bristles.length <= 44)).toBe(true);
    expect(dabs[0]!.bristles.length).toBe(Math.round(28 * 0.78));
    const plan = planStudioOilRibbonCarrier(dabs);
    expect(plan.repeatedBodyStampCount).toBe(0);
    expect(plan.bristleLanes.length).toBeGreaterThanOrEqual(2);
    const offsets = new Set(
      dabs.flatMap((dab) => dab.bristles.map((bristle) => bristle.offsetRatio.toFixed(3))),
    );
    expect(offsets.size).toBeGreaterThanOrEqual(5);
  });

  it("keeps an 8k-pixel acrylic stroke dense with a bounded 4096-station ribbon", () => {
    const dabs = planOilBrushDabs({
      points: [0, 0, 2_000, 120, 4_000, -80, 6_000, 140, 8_000, 0],
      pressures: [0.45, 0.8, 0.55, 0.9, 0.62],
      baseWidth: 27,
      seed: 91,
      maxDabs: 4_096,
    });
    const plan = planStudioOilRibbonCarrier(dabs);

    expect(dabs.length).toBeGreaterThan(3_000);
    expect(dabs.length).toBeLessThanOrEqual(4_096);
    expect(plan.sourceStationCount).toBe(dabs.length);
    expect(plan.body!.points.length).toBe(dabs.length * 4 + 12);
    expect(plan.repeatedBodyStampCount).toBe(0);
    expect(Math.min(...plan.bristleLanes.map(({ lineWidth }) => lineWidth)))
      .toBeGreaterThan(0);
  });

  it("uses a directional polygon for a tap instead of falling back to a circle", () => {
    const plan = planStudioOilRibbonCarrier(planOilBrushDabs({
      points: [12, 18],
      pressures: [0.7],
      baseWidth: 27,
      seed: 13,
    }));

    expect(plan.sourceStationCount).toBe(1);
    expect(plan.body?.points).toHaveLength(16);
    expect(plan.bristleLanes).toEqual([]);
    expect(studioOilRibbonPathData(plan.body!, true)).not.toContain("A");
  });

  it("shares identical quantized path coordinates between Canvas tracing and SVG", () => {
    const plan = planStudioOilRibbonCarrier(planOilBrushDabs({
      points: [2, 3, 25, 12, 48, -4, 82, 19],
      pressures: [0.3, 0.6, 0.9, 0.5],
      baseWidth: 27,
      seed: 29,
    }));
    const canvasCoordinates: number[] = [];
    traceStudioOilRibbonPath({
      moveTo: (x, y) => canvasCoordinates.push(x, y),
      lineTo: (x, y) => canvasCoordinates.push(x, y),
      closePath: () => undefined,
    }, plan.body!, true);
    const svgCoordinates = (
      studioOilRibbonPathData(plan.body!, true)
        .match(/-?(?:\d+\.\d+|\d+)/gu)
      ?? []
    ).map(Number);

    expect(svgCoordinates).toEqual(canvasCoordinates);
    expect(studioOilRibbonPathData(plan.body!, true)).not.toContain("A");
  });
});

describe("oil ribbon head and tail", () => {
  it("carries bristle texture into the body's directional caps", () => {
    // A straight horizontal stroke, so "along the stroke" is just x and the caps are the two
    // extremes of the body outline. The body overhangs its outermost stations by a directional
    // cap; the hairs used to stop dead at those stations, which left the whole cap as smooth
    // pigment and gave every oil stroke a blunt untextured head and tail.
    const dabs = planOilBrushDabs({
      points: [80, 100, 240, 100, 400, 100, 560, 100],
      pressures: [0.7, 0.7, 0.7, 0.7],
      baseWidth: 40,
      seed: 23,
    });
    const plan = planStudioOilRibbonCarrier(dabs);
    expect(plan.body).not.toBeNull();

    const bodyX = plan.body!.points.filter((_, index) => index % 2 === 0);
    const laneX = plan.bristleLanes
      .flatMap((lane) => lane.runs)
      .flatMap((run) => run.points.filter((_, index) => index % 2 === 0));
    expect(laneX.length).toBeGreaterThan(0);

    // The stations themselves sit inside the body, so the cap is the stretch between the body's
    // extreme and the outermost station. Measuring reach as a FRACTION of that stretch keeps the
    // assertion honest if the cap length is ever retuned.
    const stationX = dabs.map((dab) => dab.x);
    const headCap = Math.min(...stationX) - Math.min(...bodyX);
    const tailCap = Math.max(...bodyX) - Math.max(...stationX);
    expect(headCap).toBeGreaterThan(0);
    expect(tailCap).toBeGreaterThan(0);

    const headReach = (Math.min(...stationX) - Math.min(...laneX)) / headCap;
    const tailReach = (Math.max(...laneX) - Math.max(...stationX)) / tailCap;
    expect(headReach, "hairs must reach into the head cap").toBeGreaterThan(0.4);
    expect(tailReach, "hairs must reach into the tail cap").toBeGreaterThan(0.4);
    // …but not past the closing pigment, or the outer hairs hang in open space beyond the tip.
    expect(headReach).toBeLessThanOrEqual(1);
    expect(tailReach).toBeLessThanOrEqual(1);
  });
});
