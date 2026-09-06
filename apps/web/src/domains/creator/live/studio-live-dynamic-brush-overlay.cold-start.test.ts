/**
 * Cold-start budgets for the live dynamic-brush overlay, kept in their own FILE on purpose.
 *
 * These two gates ask what the process pays ONCE — the first renderer's first append, and the
 * first append that takes the structural ribbon-chunk path. That question can only be asked by
 * code that runs before anything else has built a renderer, and the sibling suite has fourteen
 * tests that do exactly that before its measured one. Measured rather than supposed: the ordinary
 * cold-start ratio reads 4.05 and 4.62 in file order against 14.69 and 14.42 with the measurement
 * alone in a process, so roughly ten ordinary appends of one-time cost sat outside the window the
 * gate was grading, and it was covering per-renderer cold start while its comment claimed
 * process-wide initialisation.
 *
 * Vitest isolates modules per file, so a separate file is the enforcement. An ordering convention
 * inside the sibling suite would be silently breakable by anyone adding a test above the measured
 * one — the same reason the impasto timing gates were split from their transcendental census.
 *
 * Only ONE pass runs here, and that is the point: a process is cold once, so a minimum across
 * repeats would discard the only reading that answers the question.
 */
import { describe, expect, it } from "vitest";

import { materializeStudioBrushPackSelection } from "../brush/studio-brush-pack-runtime";
import { runStudioPerfCalibrationRounds } from "../brush/studio-perf-calibration";

import {
  APPEND_COLD_START_COST_LIMIT,
  APPEND_FIRST_CHUNK_COLD_START_COST_LIMIT,
  appendColdStartCostRatio,
  appendFirstChunkColdStartCostRatio,
  attachedRenderer,
  drawElement,
} from "./studio-live-dynamic-brush-overlay.fixture";

import type { StudioPerfCalibrationSample } from "../brush/studio-perf-calibration";

/** Matches the sibling suite's loop so the two grade the same appends. */
const APPEND_CALIBRATION_ROUNDS = 80;
/**
 * Enough appends to reach the first ribbon chunk (every eighth) with a settled ordinary-append
 * floor behind it, and no more. The sibling suite runs 199 appends three times over to converge
 * a steady-state ratio; this file only needs the first of everything, and running the full stress
 * loop here would double the suite's cost to re-answer a question it already answers.
 */
const COLD_START_APPENDS = 40;

describe("StudioLiveDynamicBrushOverlayRenderer cold start", () => {
  it("pays no more than a blow-up's worth of one-time cost on its first append or first chunk", () => {
    const selection = materializeStudioBrushPackSelection("crayon-wax-bold");
    if (!selection) throw new Error("missing crayon-wax-bold selection");
    const pointPairs = Array.from({ length: 3000 }, (_, index) => [
      10 + (index % 120) * 8 + Math.cos(index / 10) * 20,
      12 + Math.floor(index / 120) * 14 + Math.sin(index / 10) * 20,
    ]);
    const fullPoints = pointPairs.flat();
    const strokeOptions = (count: number) => ({
      brush: selection.runtimeBrushId,
      brushCatalogId: selection.catalogId,
      brushDynamics: selection.brushDynamics,
      strokeWidth: selection.defaultWidth,
      opacity: selection.defaultOpacity,
      pressures: Array.from({ length: count }, () => 0.72),
      speeds: Array.from({ length: count }, () => 14),
      tiltXs: Array.from({ length: count }, () => 18),
      tiltYs: Array.from({ length: count }, () => -9),
    });

    const { activeCanvas, renderer } = attachedRenderer();
    expect(renderer.begin(
      drawElement("crayon-3000-stress", fullPoints.slice(0, 60), strokeOptions(30)),
    ).status).toBe("started");

    const samples: StudioPerfCalibrationSample[] = [];
    const markDeltas: number[] = [];
    // From zero, exactly as the sibling suite counts, so the first delta includes whatever
    // `begin` deposited and the two files pin the same number.
    let markedBeforeAppend = 0;
    for (let append = 0; append < COLD_START_APPENDS; append += 1) {
      const pointCount = 60 + append * 30;
      const prefixElement = drawElement(
        "crayon-3000-stress",
        fullPoints.slice(0, pointCount),
        strokeOptions(pointCount / 2),
      );
      // The reference is timed immediately before the append it calibrates, so a contended
      // stretch inflates the pair together. Same construction as the sibling suite.
      const referenceStartedMs = performance.now();
      runStudioPerfCalibrationRounds(APPEND_CALIBRATION_ROUNDS);
      const referenceMs = performance.now() - referenceStartedMs;

      const startMs = performance.now();
      const appended = renderer.appendFrom(prefixElement);
      const elapsedMs = performance.now() - startMs;
      expect(appended.status).toBe("appended");

      samples.push({ referenceMs, workMs: elapsedMs });
      markDeltas.push(activeCanvas.recordedMarks.length - markedBeforeAppend);
      markedBeforeAppend = activeCanvas.recordedMarks.length;
    }

    // The loop shape is fully determined, so it is pinned rather than bounded: the cold append
    // deposits exactly 320 marks on every machine, and a chunk append is reached at index 7.
    expect(markDeltas[0], "cold first append marks").toBe(320);
    expect(markDeltas.findIndex((delta) => delta > 1_000), "first ribbon chunk").toBe(7);

    // Both are BLOW-UP bounds, not budgets, and the reason is measured: a single cold reading is
    // JIT-dominated and CANNOT be reduced, because a process is cold exactly once. Every other
    // gate in this suite answers noise with a minimum over repeats; this one has nothing to
    // repeat, and the tail that leaves is long.
    //
    //   ordinary cold append   9.58 - 15.84 idle    10.02 - 65.98 loaded
    //   first chunk           19.54 - 20.28 idle    41.83 - 128.05 loaded
    //
    // Nineteen runs each, loaded meaning six spinning hogs on four cores with the sibling suites
    // in parallel workers — a 250%-oversubscribed box, harsher than CI, where these read under 60
    // and 110 respectively. Two earlier passes were too tight and both are recorded because the
    // lesson is the same one twice: 60/110 came from three loaded samples and failed at 65.98
    // with nothing regressed, and the tail only showed itself at eight and then nineteen. An
    // unreducible sample has a long tail, and three readings do not show it.
    //
    // What that buys and what it costs, stated rather than implied: the cheapest ordinary append
    // is ~0.65ms, so these convict a one-time cost of roughly 160ms and 260ms upward. The 500ms
    // first-use stall and the two-second initialisation that motivated these gates read in the
    // hundreds and thousands and are convicted with margin. A 100ms one-time cost is NOT caught,
    // and no bound on a single unreducible sample can catch it without failing honest code on a
    // busy machine — which is exactly what the two earlier passes did.
    //
    // What covers the cold path exactly is the mark pin above.
    const coldStartRatio = appendColdStartCostRatio(samples, markDeltas);
    expect(
      coldStartRatio,
      `the process-cold first append costs ${coldStartRatio.toFixed(2)} ordinary appends`,
    ).toBeLessThan(APPEND_COLD_START_COST_LIMIT);

    const firstChunkRatio = appendFirstChunkColdStartCostRatio(samples, markDeltas);
    expect(
      firstChunkRatio,
      `the process-cold first ribbon-chunk append costs ${firstChunkRatio.toFixed(2)} `
      + "ordinary appends",
    ).toBeLessThan(APPEND_FIRST_CHUNK_COLD_START_COST_LIMIT);
  });
});
