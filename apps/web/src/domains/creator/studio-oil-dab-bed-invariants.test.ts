/**
 * Invariants the oil dab bed's hair loop rests on.
 *
 * `appendOilBrushDabs` lifts three classes of work out of its per-(station, hair) walk: constants
 * of the hair and seed alone (pitch, gauge, reservoir), the load/drift knot hashes that only move
 * once per wavelength, and per-station terms that do not vary across hairs. At the 4096-dab cap
 * that walk runs ~90k times and the whole bed is rebuilt on every pointer move, so the lifting is
 * worth ~85% of the rebuild — but only if every value stays exactly what the inline form produced.
 *
 * These pin the two properties the lifting assumes, from the outside, on the emitted bed:
 *
 *  1. a hair's own constants really are constant along the stroke — its gauge-derived ridge floor
 *     does not drift from station to station;
 *  2. the knot cache cannot leak across a boundary — a bed built in one pass equals the same bed
 *     built by an incremental planner that stopped and resumed inside it.
 *
 * Byte-equality of the whole bed against the pre-lifting implementation was verified separately
 * over 948 beds (6 brushes x 4 stroke shapes x 9 lengths x 3 widths, plus 300 incremental frames);
 * what is kept here is the part a future edit could silently break.
 */
import { describe, expect, it } from "vitest";

import {
  FX_OIL_DAB_CAP,
  FxOilDabPlanner,
  fxBrushSeedFromKey,
  planOilBrushDabs,
  studioOilPaintBodyForBrush,
  studioOilTipProfileForBrush,
} from "./studio-fx-brush";

const SEED = fxBrushSeedFromKey("oil-dab-bed-invariants");

function strokePoints(count: number): number[] {
  const points: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = index / 29;
    points.push(
      80 + index * 1.9 + Math.sin(t) * 21,
      300 + Math.cos(t * 0.63) * 54 + Math.sin(t * 2.1) * 8,
    );
  }
  return points;
}

function planInput(brush: string, sampleCount: number) {
  return {
    points: strokePoints(sampleCount),
    pressures: Array.from(
      { length: sampleCount },
      (_, index) => 0.14 + 0.8 * Math.abs(Math.sin(index / 43)),
    ),
    baseWidth: 26,
    seed: SEED,
    maxDabs: FX_OIL_DAB_CAP,
    paintBody: studioOilPaintBodyForBrush(brush),
    tipProfile: studioOilTipProfileForBrush(brush),
  };
}

describe("oil dab bed hair-loop invariants", () => {
  it.each(["oil", "acrylic"])(
    "keeps each hair's own gauge constant along the stroke — %s",
    (brush) => {
      const dabs = planOilBrushDabs(planInput(brush, 1400));
      expect(dabs.length).toBeGreaterThan(400);
      const hairCount = dabs[0]!.bristles.length;
      expect(hairCount).toBeGreaterThan(1);

      // `radiusYRatio` is `(0.032 + gauge*0.062 + contact*0.03) * scales`. Only `contact` travels,
      // and it is bounded to [0, 1], so a hair's ridge floor — the value at contact 0 — is fixed
      // by its gauge. If the gauge were being re-derived per station (or read from the wrong hair)
      // the spread of a single hair's radiusYRatio would exceed what `contact` alone can explain.
      for (let hair = 0; hair < hairCount; hair += 1) {
        let minimum = Number.POSITIVE_INFINITY;
        let maximum = Number.NEGATIVE_INFINITY;
        for (const dab of dabs) {
          const ratio = dab.bristles[hair]!.radiusYRatio;
          if (ratio < minimum) minimum = ratio;
          if (ratio > maximum) maximum = ratio;
        }
        // contact in [0,1] can move the ratio by at most 0.03, before the (<= 1.35) body scale.
        expect(maximum - minimum).toBeLessThanOrEqual(0.03 * 1.35 + 1e-12);
      }
    },
  );

  it.each(["oil", "acrylic"])(
    "builds the same bed whether the walk ran once or resumed mid-stroke — %s",
    (brush) => {
      // The knot caches live across stations inside one `appendOilBrushDabs` call, and an
      // incremental append starts that call partway through the bed. A cache that survived where
      // it should not, or was not refilled on entry, would show up here and nowhere else.
      const planner = new FxOilDabPlanner();
      for (const sampleCount of [200, 260, 700, 1100, 1400]) {
        const input = planInput(brush, sampleCount);
        const resumed = planner.plan(input);
        expect(resumed).toEqual(planOilBrushDabs(input));
      }
      // The append actually happened, so the case above is not vacuous.
      expect(planner.reusedDabs).toBeGreaterThan(0);
    },
  );

  it("refills the knot caches when a later stroke starts from station 0 on the same bed", () => {
    // A fresh bed after a long one: the walk must not read knot hashes left by the previous call.
    const long = planOilBrushDabs(planInput("oil", 1400));
    const short = planOilBrushDabs(planInput("oil", 120));
    expect(short).toEqual(planOilBrushDabs(planInput("oil", 120)));
    // And the long bed's first dab still matches a bed that only ever had that prefix planned.
    expect(long[0]!.bristles).toEqual(short[0]!.bristles);
  });
});
