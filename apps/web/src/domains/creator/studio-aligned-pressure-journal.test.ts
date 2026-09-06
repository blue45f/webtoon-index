/**
 * A growing stroke must not change the pressure of a sample it already captured.
 *
 * ## The defect this pins
 *
 * Four planners read a stroke's pressure journal through a NORMALISED progress: sample `i` of `n`
 * was fetched at `i / (n - 1)` and the reader multiplied that back by `pressures.length - 1`.
 * When the journal runs parallel to the points — the shape every live stroke has — the round trip
 * is supposed to land back on `i`, and in exact arithmetic it does. In binary floating point it
 * does not: at n = 800, `(357 / 799) * 799` is 356.99999999999994, so the reader interpolated a
 * sliver of sample 358 into sample 357.
 *
 * The value error is ~1e-15 and nobody could see it. The DEPENDENCE was the bug: the pressure a
 * planner derived for an EARLY sample changed every time the stroke grew, because `n` grew. Every
 * incremental planner in the shelf establishes its reusable prefix by comparing derived samples
 * byte-for-byte, so each of them found its prefix ending a few hundred samples in and rebuilt the
 * rest of the stroke on every pointer move — the O(n²) shape the long-stroke gate exists to catch,
 * arriving through a rounding artefact rather than through a planner that meant to replan.
 * Measured on a 1600-sample oil sweep before this fix: `FxOilDabPlanner` reused 357 of 1458 dabs.
 * After it: 1456 of 1458.
 *
 * ## What is asserted
 *
 * For each reader, that a prefix's derived pressures are IDENTICAL whether they are derived from
 * the prefix alone or from a longer stroke that starts with it. `toEqual` on numbers is exact, so
 * a single returned ulp of drift fails this.
 *
 * Journals that do NOT run parallel to the points (legacy documents, resampled or mirrored series)
 * still go through the interpolating path, where the normalisation is doing real work — asserted
 * here too, so the fast path cannot quietly swallow them.
 */
import { describe, expect, it } from "vitest";

import { resampleStrokePressures } from "./studio-brush";
import {
  FX_OIL_DAB_CAP,
  planOilBrushDabs,
  planStudioFxBrushPressurePath,
  studioOilPaintBodyForBrush,
  studioOilTipProfileForBrush,
} from "./studio-fx-brush";
import { STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1 } from "./studio-material-pressure-model";
import { resolveStudioRetainedMediaPressureSeries } from "./studio-retained-media-pressure";

/** Lengths that straddle the region where the round trip first drifted (~n/2 at these sizes). */
const LENGTHS = [1, 2, 3, 17, 400, 800, 1600] as const;
const PREFIX = 357;

function points(count: number): number[] {
  const out: number[] = [];
  for (let index = 0; index < count; index += 1) {
    out.push(60 + index * 2.75, 200 + Math.sin(index / 23) * 64);
  }
  return out;
}

/** Neighbouring samples differ, so blending a sliver of the next one is detectable. */
function pressures(count: number): number[] {
  return Array.from(
    { length: count },
    (_, index) => 0.18 + 0.7 * Math.abs(Math.sin(index / 11)),
  );
}

describe("aligned pressure journals are read by index, not by normalised progress", () => {
  it("resampleStrokePressures keeps a prefix identical as the stroke grows", () => {
    for (const count of LENGTHS) {
      const short = resampleStrokePressures(pressures(count), count);
      const long = resampleStrokePressures(pressures(count * 2), count * 2);
      expect(short).toEqual(long.slice(0, count));
      // Aligned means the journal is returned as-is, clamped — not resampled at all.
      expect(short).toEqual(pressures(count).map((value) => value));
    }
  });

  it("resampleStrokePressures still resamples a journal that is not parallel", () => {
    // Three sources stretched over five stations: the middle stations MUST interpolate.
    expect(resampleStrokePressures([0, 0.5, 1], 5)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(resampleStrokePressures([0.25], 4)).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it("the retained-media pressure series keeps a prefix identical as the stroke grows", () => {
    const short = resolveStudioRetainedMediaPressureSeries("pencil", pressures(800), 800);
    const long = resolveStudioRetainedMediaPressureSeries("pencil", pressures(1600), 1600);
    expect(short.map((response) => response.pressure))
      .toEqual(long.slice(0, 800).map((response) => response.pressure));
    expect(short.map((response) => response.sizeScale))
      .toEqual(long.slice(0, 800).map((response) => response.sizeScale));
  });

  it("the retained-media pressure series still aligns a journal that is not parallel", () => {
    const stretched = resolveStudioRetainedMediaPressureSeries("pencil", [0, 1], 3);
    expect(stretched.map((response) => response.pressure)).toEqual([0, 0.5, 1]);
  });

  it("the fx pressure path keeps its planned prefix identical as the stroke grows", () => {
    // The canonical model is what makes the path READ the journal; without it every segment takes
    // the neutral response and the assertion would hold for the wrong reason.
    const plan = (count: number) => planStudioFxBrushPressurePath({
      brushId: "highlighter",
      points: points(count),
      pressures: pressures(count),
      pressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
    });
    const short = plan(800);
    const long = plan(1600);
    // Same endpoint caveat as the oil bed: the shorter path's final segment closes the stroke.
    const shared = short.segments.length - 1;
    expect(shared).toBeGreaterThan(PREFIX);
    expect(short.segments.slice(0, shared)).toEqual(long.segments.slice(0, shared));
  });

  it("the oil dab bed keeps its planned prefix identical as the stroke grows", () => {
    const plan = (count: number) => planOilBrushDabs({
      points: points(count),
      pressures: pressures(count),
      baseWidth: 24,
      seed: 991,
      maxDabs: FX_OIL_DAB_CAP,
      paintBody: studioOilPaintBodyForBrush("oil--flat-ribbon"),
      tipProfile: studioOilTipProfileForBrush("oil--flat-ribbon"),
    });
    const short = plan(800);
    const long = plan(1600);
    // `sampleStations` closes a stroke by appending its final source point as an extra station,
    // and a dab reads the station after its own for the centred tangent. So the shorter bed's
    // last two dabs legitimately see a different neighbourhood; everything before them must not.
    const shared = short.length - 2;
    expect(shared).toBeGreaterThan(PREFIX);
    expect(short.slice(0, shared)).toEqual(long.slice(0, shared));
  });
});
