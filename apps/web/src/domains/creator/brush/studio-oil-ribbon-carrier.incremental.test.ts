/**
 * Append-identity contract for `StudioOilRibbonCarrierPlanner`.
 *
 * The live oil overlay replans the carrier on every pointer frame, and the batch planner rebuilds
 * the smoothed geometry, the stations and every bristle run each time — ~17 ms at a 2906-dab bed
 * on this tree, past a 60 Hz frame before a pixel is painted. The incremental planner keeps the
 * prefix an append cannot have changed.
 *
 * The whole value of that is that it changes NOTHING. So the contract asserted here is equality
 * with the batch plan, structurally, at every step of a growing stroke:
 *
 *  1. every intermediate plan deep-equals `planStudioOilRibbonCarrier` on the same dabs;
 *  2. it holds for the plain carrier and for each shipped program combination (load dynamics,
 *     bristle physics, impasto relief, body-only, and the opt-in fixed-anchor banding), because
 *     the settled-prefix argument is only valid for the stages that read a bounded window;
 *  3. it holds through the dab cap, where the spacing ladder keeps the placed stations still so the
 *     prefix survives — and on the one append that climbs a rung, where it does not;
 *  4. it holds when the option object changes mid-stroke, and when the stroke is replaced by an
 *     unrelated one on the same planner instance;
 *  5. reuse actually happens on an ordinary append (otherwise 1–4 pass trivially).
 */
import { describe, expect, it } from "vitest";

import {
  FX_OIL_DAB_CAP,
  FxOilDabPlanner,
  fxBrushSeedFromKey,
  planOilBrushDabs,
  studioOilPaintBodyForBrush,
  studioOilTipProfileForBrush,
  type FxOilDab,
} from "../studio-fx-brush";

import { STUDIO_BRUSH_RETAINED_DRAFT_SYMMETRY_VARIATIONS } from "./studio-brush-symmetry";
import {
  StudioOilRibbonCarrierPlanner,
  planStudioOilRibbonCarrier,
  planStudioOilRibbonCarrierIncremental,
  releaseStudioOilRibbonDraftPlanners,
  studioOilRibbonCarrierRetainedReuse,
  studioOilRibbonProgramsForBrush,
  type StudioOilRibbonCarrierOptions,
} from "./studio-oil-ribbon-carrier";

const SEED = fxBrushSeedFromKey("oil-incremental-contract");
const ELEMENT_ID = "oil-incremental-contract-element";

function strokePoints(count: number): number[] {
  const points: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = index / 37;
    points.push(
      140 + index * 2.6 + Math.sin(t) * 26,
      320 + Math.cos(t * 0.63) * 88 + Math.sin(t * 2.1) * 9,
    );
  }
  return points;
}

function strokePressures(count: number): number[] {
  return Array.from(
    { length: count },
    (_, index) => 0.22 + 0.6 * Math.abs(Math.sin(index / 71)),
  );
}

function dabsAt(brushId: string, sampleCount: number, planner?: FxOilDabPlanner): FxOilDab[] {
  const input = {
    points: strokePoints(sampleCount),
    pressures: strokePressures(sampleCount),
    baseWidth: 24,
    seed: SEED,
    maxDabs: FX_OIL_DAB_CAP,
    paintBody: studioOilPaintBodyForBrush(brushId),
    tipProfile: studioOilTipProfileForBrush(brushId),
    // Matches the live overlay, which is the caller this planner exists for.
    capMode: "prefix-stable-ladder-v2" as const,
  };
  return planner ? planner.plan(input) : planOilBrushDabs(input);
}

/** Programs whose plans must all survive the settled-prefix argument, not only the plain one. */
const PROGRAMS: readonly {
  readonly id: string;
  readonly brushId: string;
  readonly options: StudioOilRibbonCarrierOptions | undefined;
}[] = [
  { id: "plain", brushId: "brush--oil-lanes", options: undefined },
  {
    id: "flat-ribbon",
    brushId: "oil--flat-ribbon",
    options: studioOilRibbonProgramsForBrush("oil--flat-ribbon", SEED),
  },
  {
    id: "filbert (bristle physics)",
    brushId: "oil--filbert-ribbon",
    options: studioOilRibbonProgramsForBrush("oil--filbert-ribbon", SEED),
  },
  {
    id: "impasto (physics + relief)",
    brushId: "oil--impasto-ribbon",
    options: studioOilRibbonProgramsForBrush("oil--impasto-ribbon", SEED),
  },
  {
    id: "load dynamics",
    brushId: "brush--oil-lanes",
    options: { bristleLoadDynamics: { enabled: true, seed: SEED } },
  },
  { id: "body only", brushId: "oil--flat-ribbon", options: { bodyOnly: true } },
  {
    id: "fixed-anchor-v2 banding",
    brushId: "oil--flat-ribbon",
    options: { bristleBanding: "fixed-anchor-v2" },
  },
];

describe("StudioOilRibbonCarrierPlanner", () => {
  for (const program of PROGRAMS) {
    it(`plans a growing stroke exactly like the batch carrier — ${program.id}`, () => {
      const planner = new StudioOilRibbonCarrierPlanner();
      const dabPlanner = new FxOilDabPlanner();
      for (const sampleCount of [1, 2, 3, 9, 10, 40, 200, 203, 640, 1300]) {
        const dabs = dabsAt(program.brushId, sampleCount, dabPlanner);
        expect(planner.plan(dabs, program.options)).toEqual(
          planStudioOilRibbonCarrier(dabs, program.options),
        );
      }
    });
  }

  /**
   * The relief height field is the one stage that carries state ACROSS appends: it bakes a
   * settled layer once and re-stamps only the mutable tail into a copy of it each move. A bake
   * range that is off by one station, a film cursor resumed from the wrong place, or the
   * final-station stride exemption granted to a bake's own last station are all errors the
   * sparse checkpoints above CANNOT see — the tail pass re-covers the boundary a few appends
   * later, so the plan is wrong only on the appends in between. Walking one sample at a time is
   * what actually pins them.
   */
  it("plans every single-sample append exactly like the batch carrier — impasto relief", () => {
    const planner = new StudioOilRibbonCarrierPlanner();
    const dabPlanner = new FxOilDabPlanner();
    const options = studioOilRibbonProgramsForBrush("oil--impasto-ribbon", SEED);
    // Collected rather than asserted in place: which appends diverge is the diagnosis, and a
    // bare first failure hides whether it is one boundary or every append past it.
    const mismatches: number[] = [];
    for (let sampleCount = 1; sampleCount <= 400; sampleCount += 1) {
      const dabs = dabsAt("oil--impasto-ribbon", sampleCount, dabPlanner);
      const incremental = planner.plan(dabs, options);
      const batch = planStudioOilRibbonCarrier(dabs, options);
      try {
        expect(incremental).toEqual(batch);
      } catch {
        mismatches.push(sampleCount);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("reuses the settled prefix on an ordinary append", () => {
    const planner = new StudioOilRibbonCarrierPlanner();
    const dabPlanner = new FxOilDabPlanner();
    planner.plan(dabsAt("oil--flat-ribbon", 900, dabPlanner), undefined);
    const grown = dabsAt("oil--flat-ribbon", 904, dabPlanner);
    const plan = planner.plan(grown, undefined);

    // The dab bed itself must be prefix-stable for any of this to be reachable.
    expect(dabPlanner.reusedDabs).toBeGreaterThan(grown.length * 0.9);
    expect(planner.settledStations).toBeGreaterThan(grown.length * 0.9);
    expect(planner.reusedRuns).toBeGreaterThan(0);
    expect(plan).toEqual(planStudioOilRibbonCarrier(grown, undefined));
  });

  it.each([
    ["oil", "oil"],
    ["acrylic", "acrylic"],
    ["filbert", "oil--filbert-ribbon"],
    ["impasto", "oil--impasto-ribbon"],
  ])(
    "reuses runs for the program-bearing %s preset, and still equals the batch plan",
    (_label, brushId) => {
      // The point of the whole exercise. These presets run bristle physics, and the physics
      // program used to force `reusableStations` to 0 because its `baseRadiusPx` was a
      // stroke-global mean — so `oil` and `acrylic`, the two presets a user means by "the oil
      // brushes", re-simulated their entire hair bed on every pointer frame. With the anchor
      // frozen past its window the march is causal and the settled prefix survives.
      //
      // Both halves are asserted together on purpose: reuse without equality is a wrong answer
      // delivered quickly, and equality without reuse passes trivially.
      const planner = new StudioOilRibbonCarrierPlanner();
      const dabPlanner = new FxOilDabPlanner();
      const options = studioOilRibbonProgramsForBrush(brushId, SEED);
      expect(options?.bristlePhysics?.enabled).toBe(true);

      planner.plan(dabsAt(brushId, 900, dabPlanner), options);
      const grown = dabsAt(brushId, 940, dabPlanner);
      const plan = planner.plan(grown, options);

      expect(planner.settledStations).toBeGreaterThan(grown.length * 0.9);
      expect(planner.reusedRuns).toBeGreaterThan(0);
      expect(plan).toEqual(planStudioOilRibbonCarrier(grown, options));
    },
  );

  it("keeps the frozen anchor plan-identical to the stroke-mean anchor it replaced", () => {
    // The anchor divides back out of every stream the program publishes, so freezing it is a
    // change of derivation and not of picture. If that ever stops being true this fails, and the
    // reuse above is no longer free.
    for (const brushId of ["oil", "acrylic"]) {
      const options = studioOilRibbonProgramsForBrush(brushId, SEED);
      for (const sampleCount of [300, 900, 1600]) {
        const dabs = dabsAt(brushId, sampleCount);
        expect(planStudioOilRibbonCarrier(dabs, options)).toEqual(
          planStudioOilRibbonCarrier(dabs, {
            ...options,
            bristlePhysics: { ...options!.bristlePhysics!, restRadiusAnchor: "stroke-mean-v1" },
          }),
        );
      }
    }
  });

  it("refuses to reuse when a program series is shorter than the stroke", () => {
    // `sampleSeries` holds a short series at its last value, so station 300 reads a different
    // number once the stroke passes 400 stations. Reuse there would be silently wrong.
    const planner = new StudioOilRibbonCarrierPlanner();
    const dabPlanner = new FxOilDabPlanner();
    const options: StudioOilRibbonCarrierOptions = {
      bristlePhysics: { enabled: true, seed: SEED, pressures: [0.2, 0.9, 0.45] },
    };
    planner.plan(dabsAt("oil--filbert-ribbon", 900, dabPlanner), options);
    const grown = dabsAt("oil--filbert-ribbon", 940, dabPlanner);
    const plan = planner.plan(grown, options);
    expect(planner.reusedRuns).toBe(0);
    expect(plan).toEqual(planStudioOilRibbonCarrier(grown, options));
  });

  it("keeps reusing across appends once the bed is capped", () => {
    // Spacing here puts ~1.8 dabs on every source sample, so this pair is well past the cap. The
    // arc-proportional refit this replaces moved every station whenever the arc grew, so a capped
    // stroke shared no prefix and rebuilt the whole carrier on every pointer move for the rest of
    // the drag. On the fixed ladder the placed stations stay put and the prefix survives.
    const planner = new StudioOilRibbonCarrierPlanner();
    const dabPlanner = new FxOilDabPlanner();
    const before = dabsAt("oil--flat-ribbon", 3000, dabPlanner);
    planner.plan(before, undefined);
    const after = dabsAt("oil--flat-ribbon", 3008, dabPlanner);
    expect(after.length).toBeGreaterThan(before.length);
    expect(planner.plan(after, undefined)).toEqual(
      planStudioOilRibbonCarrier(after, undefined),
    );
    expect(planner.reusedRuns).toBeGreaterThan(0);
  });

  it("rebuilds when the program options change mid-stroke", () => {
    const planner = new StudioOilRibbonCarrierPlanner();
    const dabPlanner = new FxOilDabPlanner();
    const first = dabsAt("oil--flat-ribbon", 300, dabPlanner);
    planner.plan(first, undefined);
    const grown = dabsAt("oil--flat-ribbon", 340, dabPlanner);
    const switched: StudioOilRibbonCarrierOptions = { impastoRelief: { enabled: true } };
    expect(planner.plan(grown, switched)).toEqual(
      planStudioOilRibbonCarrier(grown, switched),
    );
    expect(planner.reusedRuns).toBe(0);
    // …and switching back is just as exact.
    expect(planner.plan(grown, undefined)).toEqual(
      planStudioOilRibbonCarrier(grown, undefined),
    );
  });

  it("rebuilds when an unrelated stroke reuses the same planner", () => {
    const planner = new StudioOilRibbonCarrierPlanner();
    planner.plan(dabsAt("oil--flat-ribbon", 400), undefined);
    const unrelated = planOilBrushDabs({
      points: [40, 40, 260, 90, 300, 340, 90, 300],
      pressures: [0.9, 0.4, 0.75, 0.2],
      baseWidth: 31,
      seed: fxBrushSeedFromKey("a different stroke"),
      maxDabs: FX_OIL_DAB_CAP,
      paintBody: studioOilPaintBodyForBrush("oil--flat-ribbon"),
      tipProfile: studioOilTipProfileForBrush("oil--flat-ribbon"),
    });
    expect(planner.plan(unrelated, undefined)).toEqual(
      planStudioOilRibbonCarrier(unrelated, undefined),
    );
  });

  it("returns the batch plan for a shrinking stroke (undo mid-drag)", () => {
    const planner = new StudioOilRibbonCarrierPlanner();
    planner.plan(dabsAt("oil--flat-ribbon", 500), undefined);
    for (const sampleCount of [420, 90, 2, 0]) {
      const dabs = dabsAt("oil--flat-ribbon", sampleCount);
      expect(planner.plan(dabs, undefined)).toEqual(
        planStudioOilRibbonCarrier(dabs, undefined),
      );
    }
  });

  it("keeps reuse across a symmetry fan the renderer walks every frame", () => {
    // Regression: the keyed caches were sized at 8 while `StudioDrawNode` draws every symmetry
    // copy of one active draft per frame, in a fixed index order. A kaleidoscope of 8 directions
    // is 16 copies, so an 8-entry LRU evicted each copy immediately before its next use — a 0%
    // hit rate, with planner construction and a doomed verification pass charged on top of the
    // full rebuild the cache existed to prevent. Walking the fan twice must show real reuse.
    const variations = STUDIO_BRUSH_RETAINED_DRAFT_SYMMETRY_VARIATIONS;
    const dabPlanners = Array.from({ length: variations }, () => new FxOilDabPlanner());
    const beds = dabPlanners.map((planner) => dabsAt("oil--flat-ribbon", 700, planner));
    // Frame 1: every copy plans cold.
    beds.forEach((dabs, index) => {
      planStudioOilRibbonCarrierIncremental(ELEMENT_ID, index, dabs, undefined);
    });
    // Frame 2: the stroke grew by a few samples in every copy.
    const grown = dabPlanners.map((planner) => dabsAt("oil--flat-ribbon", 704, planner));
    for (const [index, dabs] of grown.entries()) {
      const plan = planStudioOilRibbonCarrierIncremental(ELEMENT_ID, index, dabs, undefined);
      // Still exact…
      expect(plan).toEqual(planStudioOilRibbonCarrier(dabs, undefined));
      // …and the copy's own bed survived the frame rather than being evicted by its siblings.
      expect(studioOilRibbonCarrierRetainedReuse(ELEMENT_ID, index)).toBeGreaterThan(0);
    }
    releaseStudioOilRibbonDraftPlanners(ELEMENT_ID);
  });

  it("does not let a finished draft's beds outlive it", () => {
    // Regression: the retained planners lived in a module-level LRU, so a committed 16-copy stroke
    // stayed strongly reachable — hundreds of thousands of run objects at the dab cap — and a
    // later single-copy stroke aged out exactly one stale entry per stroke.
    const draft = `${ELEMENT_ID}:finished`;
    const dabs = dabsAt("oil--flat-ribbon", 400);
    planStudioOilRibbonCarrierIncremental(draft, 0, dabs, undefined);
    planStudioOilRibbonCarrierIncremental(draft, 1, dabs, undefined);
    expect(studioOilRibbonCarrierRetainedReuse(draft, 0)).not.toBeNull();

    // The committed render releases it.
    releaseStudioOilRibbonDraftPlanners(draft);
    expect(studioOilRibbonCarrierRetainedReuse(draft, 0)).toBeNull();
    expect(studioOilRibbonCarrierRetainedReuse(draft, 1)).toBeNull();

    // Releasing a draft that has already been replaced is a no-op, so a late committed render
    // cannot drop the beds of the stroke being drawn now.
    planStudioOilRibbonCarrierIncremental(draft, 0, dabs, undefined);
    releaseStudioOilRibbonDraftPlanners(`${ELEMENT_ID}:someone-else`);
    expect(studioOilRibbonCarrierRetainedReuse(draft, 0)).not.toBeNull();

    // Starting a different draft drops the previous one outright, not one entry at a time.
    planStudioOilRibbonCarrierIncremental(`${ELEMENT_ID}:next`, 0, dabs, undefined);
    expect(studioOilRibbonCarrierRetainedReuse(draft, 0)).toBeNull();
    releaseStudioOilRibbonDraftPlanners(`${ELEMENT_ID}:next`);
  });

  it("reset() drops the retained bed", () => {
    const planner = new StudioOilRibbonCarrierPlanner();
    const dabPlanner = new FxOilDabPlanner();
    planner.plan(dabsAt("oil--flat-ribbon", 600, dabPlanner), undefined);
    planner.reset();
    const grown = dabsAt("oil--flat-ribbon", 610, dabPlanner);
    expect(planner.plan(grown, undefined)).toEqual(
      planStudioOilRibbonCarrier(grown, undefined),
    );
    expect(planner.reusedRuns).toBe(0);
  });
});
