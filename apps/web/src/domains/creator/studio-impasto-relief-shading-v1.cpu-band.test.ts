/**
 * The ggx body and the shared pixel walk, in their own FILE and in that order.
 *
 * This gate measures `emboss-2tap` to completion BEFORE `ggx` is called anywhere, because calling
 * both in one process deoptimises the emboss path — 3.4x its honest cost in 1 of 5 loaded runs
 * when the two are interleaved, and 2.8x when the sibling `.perf.test.ts` merely runs its 512x512
 * ggx blow-up bound first, which drops this ratio from ~20.5 to 6.58 and fails it on unregressed
 * code. Run alone, emboss never collapsed in four loaded runs, so the trigger is the shared entry
 * point going polymorphic rather than contention.
 *
 * That ordering has to hold for the whole PROCESS, not just within a test, so it cannot be a
 * convention inside a file someone may add a ggx-using test to. Vitest isolates modules per file;
 * this file is the enforcement, and nothing here may call `ggx` before the emboss phase below.
 */
import { describe, expect, it } from "vitest";

import { computeStudioImpastoReliefShading } from "./studio-impasto-relief-shading-v1";
import { studioOssUnitHash } from "./studio-oss-brush-kernels";

describe("studio impasto relief shading v1 — body vs shared walk", () => {
  /**
   * The ggx body and the SHARED PIXEL WALK, both graded against the same shader's cheap mode, in
   * CPU milliseconds, on the same tile, in separate phases.
   *
   * Three things had to change together to make this work, and each was forced by a measurement.
   *
   * CPU, NOT WALL. Wall time here is a reading of the scheduler: the previous form of this gate
   * read 1.118-1.193 under six spinning hogs on four cores and 0.19-0.22 when the two modes ran
   * on different tile sizes, because a 512x512 pass walks 2MB and an 88x88 pass walks 31KB, so
   * every migration made the big side refill a working set the small side never lost.
   * `process.cpuUsage()` removes the scheduler outright, the same fix the crayon-family budget
   * needed. Measured, it collapses the whole spread to 2.6%.
   *
   * EQUAL PIXEL COUNTS, per call and normalised per call in the quotient. That is what lets this
   * see the shared walk at all. The old form ran thirty emboss calls against one ggx call to
   * match window durations, so the walk ran thirty times in the denominator and once in the
   * numerator and a walk regression moved the ratio in the ACQUITTING direction. Matching
   * durations is no longer needed, precisely because CPU time does not care how long a window is
   * open — which is what buys the freedom to match pixels instead.
   *
   * PHASED, NOT INTERLEAVED, and this is the subtle one. Calling both modes in one process
   * deoptimises `emboss-2tap`: measured at 3.4x its honest cost in 1 of 5 loaded runs
   * interleaved, and in 3 of 23 with the wall-clock form. Run alone it never collapsed in four
   * loaded runs, so the trigger is the shared entry point going polymorphic, not contention.
   * Measuring the emboss phase to completion BEFORE ggx is ever called removes it: 20.285-20.824
   * across two idle and five loaded runs, no collapse. Interleaving was only ever there to share
   * scheduler noise between the windows, and CPU time makes that unnecessary too.
   *
   * WHAT THIS COVERS, and what it deliberately does NOT. A FLOOR only: a regression in the
   * per-pixel walk shared by both modes — extra arithmetic or a branch, which moves neither the
   * transcendental census nor the height-tap census — costs the cheap mode proportionally far
   * more than the expensive one and pushes this quotient down.
   *
   * There is no ceiling, and that is measured rather than an omission. CI failed the first form
   * of this gate at 9.888 with nothing regressed: the runner reads emboss at 3.03ms per call
   * against this container's 2.84-3.10 — identical — while reading ggx at 29.94ms against 57.75-
   * 64.56, very nearly half. That is the Node 22 versus Node 24 gap this shader already has on
   * record (34.5ms against 18.8ms for a full pass, 1.83x; here 1.98x), and it lands on only one
   * side of the division because the two modes have DIFFERENT instruction mixes — ggx is
   * transcendental-heavy, emboss is two taps and arithmetic. A ratio cancels the machine only
   * when both sides are the same mix, which is exactly the assumption this pairing breaks.
   *
   * So the honest population spans 9.888 to 22.644 across two runtimes, and a doubled ggx body
   * reads 19.8 on the faster one — inside the slower one's honest range. No fixed ceiling can
   * separate those, so none is claimed. The ggx body is covered instead by the exact
   * transcendental census in the sibling file, which is machine-independent and strictly stronger
   * than a clock, and by the 400ms blow-up bound beside it.
   */
  it("keeps the ggx body and the shared pixel walk pinned against the shader's cheap mode", () => {
    const WIDTH = 512;
    const HEIGHT = 512;
    const EMBOSS_WARMUP_CALLS = 16;
    const EMBOSS_CALLS_PER_SAMPLE = 8;
    const GGX_WARMUP_CALLS = 4;
    const GGX_CALLS_PER_SAMPLE = 4;
    const SAMPLES = 5;
    // Recorded cheapest-of-5 per-call quotients on TWO runtimes:
    //
    //   this container   20.225 - 22.644  (twelve runs, idle and under six spinning hogs on four
    //                                      cores, alone and beside sibling suites)
    //   the CI runner     9.888           (emboss 3.03ms/call, ggx 29.94ms/call)
    //
    // The reducer matters and was measured, not assumed: taking the MEDIAN of each phase instead
    // read 15.604 once in roughly fifteen runs, because emboss occasionally spends a whole phase
    // ~1.3x slow. A minimum survives that — one clean sample in five is enough — and that is what
    // a cost's one-sided noise entitles it to.
    //
    // 6 sits 1.65x below the runner's reading, which is the machine that actually gates. That
    // margin is deliberately generous: two runtimes are two data points, the spread between them
    // is already 2.3x, and a first attempt at 16 — set from this container alone — failed CI on
    // unregressed code. What it costs is sensitivity, stated plainly rather than implied: the
    // walk has to grow by 78% on the runner, or 296% here, before this convicts. That is a large
    // regression, and it is the only gate in the suite that sees this class at all.
    const MIN_RATIO = 6;

    const heights = new Float32Array(WIDTH * HEIGHT);
    for (let index = 0; index < heights.length; index += 1) {
      heights[index] = studioOssUnitHash(0x7a11, index);
    }
    const embossInto = new Float32Array(WIDTH * HEIGHT);
    const ggxInto = new Float32Array(WIDTH * HEIGHT);

    const cpuMs = (run: () => void): number => {
      const before = process.cpuUsage();
      run();
      const after = process.cpuUsage(before);
      return (after.user + after.system) / 1_000;
    };
    const emboss = () => {
      computeStudioImpastoReliefShading(heights, {
        width: WIDTH,
        height: HEIGHT,
        into: embossInto,
        quality: "emboss-2tap",
      });
    };
    const ggx = () => {
      computeStudioImpastoReliefShading(heights, {
        width: WIDTH,
        height: HEIGHT,
        into: ggxInto,
        quality: "ggx",
      });
    };
    // The CHEAPEST sample of each phase, not the median. Each side is a COST in CPU
    // milliseconds, and the noise on a cost is one-sided — contention, cache pressure and a
    // half-warm tier only ever ADD — so the cheapest reading is the honest estimate of each. The
    // quotient of two honest floors is the honest quotient; a median would carry each side's
    // noise into it. (This is the same reason the crayon-family CPU budget and the tick-slice
    // floor take minima, and the opposite of what a ratio of two INDEPENDENTLY timed windows
    // needs, which is why the chunk gates next door take medians.)
    const cheapestOf = (values: readonly number[]): number => Math.min(...values);

    // Phase one: emboss, to completion, before `ggx` has ever been called in this process.
    for (let warmup = 0; warmup < EMBOSS_WARMUP_CALLS; warmup += 1) emboss();
    const embossPerCall: number[] = [];
    for (let sample = 0; sample < SAMPLES; sample += 1) {
      embossPerCall.push(
        cpuMs(() => {
          for (let call = 0; call < EMBOSS_CALLS_PER_SAMPLE; call += 1) emboss();
        }) / EMBOSS_CALLS_PER_SAMPLE,
      );
    }

    // Phase two: ggx. Whatever this does to the emboss path is now behind the measurement.
    for (let warmup = 0; warmup < GGX_WARMUP_CALLS; warmup += 1) ggx();
    const ggxPerCall: number[] = [];
    for (let sample = 0; sample < SAMPLES; sample += 1) {
      ggxPerCall.push(
        cpuMs(() => {
          for (let call = 0; call < GGX_CALLS_PER_SAMPLE; call += 1) ggx();
        }) / GGX_CALLS_PER_SAMPLE,
      );
    }

    const embossMs = cheapestOf(embossPerCall);
    const ggxMs = cheapestOf(ggxPerCall);
    expect(embossMs).toBeGreaterThan(0);
    const ratio = ggxMs / embossMs;
    const detail = `ggx ${ggxMs.toFixed(2)}ms/call against emboss ${embossMs.toFixed(2)}ms/call `
      + `over ${WIDTH}x${HEIGHT} = ${ratio.toFixed(3)}`;

    // Below the floor: the walk both modes share got more expensive, which costs the cheap mode
    // proportionally far more. This is the direction no earlier form of this gate could see.
    expect(ratio, detail).toBeGreaterThan(MIN_RATIO);
  });

  /**
   * The floor above, driven with recorded readings from both runtimes instead of a live clock.
   *
   * Neither regression can be injected without a second shader, and asserting on freshly measured
   * numbers would re-measure the machine rather than the rule.
   */
  it("clears both runtimes honestly and still convicts a grown pixel walk", () => {
    const MIN_RATIO = 6;
    // Per-call CPU costs on the two runtimes this has run on.
    const CONTAINER = { ggxMs: 59.4, embossMs: 2.86 };
    const RUNNER = { ggxMs: 29.94, embossMs: 3.03 };
    const HONEST = [
      20.225, 20.368, 20.485, 20.488, 20.495, 20.520,
      20.525, 20.577, 20.617, 20.666, 20.817, 22.644,
      9.888,
    ] as const;

    // Every honest reading clears the floor, including the runner's — which the first form of
    // this gate did not, at 9.888 against a floor of 16.
    expect(Math.min(...HONEST)).toBeGreaterThan(MIN_RATIO);
    expect(Math.min(...HONEST) / MIN_RATIO).toBeGreaterThan(1.6);

    // Shared per-pixel work lands on BOTH modes and so moves the quotient down, far more steeply
    // on the cheap mode. Convicted on either runtime once the walk grows enough.
    const withSharedWork = (base: { ggxMs: number; embossMs: number }, addedMs: number) =>
      (base.ggxMs + addedMs) / (base.embossMs + addedMs);
    expect(withSharedWork(RUNNER, RUNNER.embossMs * 0.78)).toBeLessThan(MIN_RATIO);
    expect(withSharedWork(RUNNER, RUNNER.embossMs * 0.77)).toBeGreaterThan(MIN_RATIO);
    expect(withSharedWork(CONTAINER, CONTAINER.embossMs * 2.96)).toBeLessThan(MIN_RATIO);
    // A doubling of the walk on the runner is convicted outright.
    expect(withSharedWork(RUNNER, RUNNER.embossMs)).toBeLessThan(MIN_RATIO);
    // ...and the sensitivity that costs, stated rather than implied: a walk that grew by only
    // half is NOT caught on this container, which is why the file says 296% and not "a doubling".
    expect(withSharedWork(CONTAINER, CONTAINER.embossMs * 0.5)).toBeGreaterThan(MIN_RATIO);

    // WHY THERE IS NO CEILING, as arithmetic rather than as a claim. A doubled ggx body reads
    // 41.5 on this container and 19.8 on the runner, and 19.8 sits inside the container's honest
    // range — so any ceiling that convicts the doubling on the slower runtime would fail honest
    // code on the faster one, and any ceiling that clears the container acquits the doubling on
    // the runner.
    const doubled = (base: { ggxMs: number; embossMs: number }) => (base.ggxMs * 2) / base.embossMs;
    expect(doubled(CONTAINER)).toBeGreaterThan(40);
    expect(doubled(RUNNER)).toBeLessThan(20);
    expect(doubled(RUNNER)).toBeLessThan(Math.max(...HONEST));
    expect(doubled(RUNNER)).toBeGreaterThan(19);

    // A machine that runs everything 3.4x slower changes nothing, which is what the quotient DOES
    // cancel: uniform speed. What it cannot cancel is a runtime that speeds up one instruction
    // mix more than the other, and that is the whole reason the ceiling is gone.
    expect((CONTAINER.ggxMs * 3.4) / (CONTAINER.embossMs * 3.4))
      .toBeCloseTo(CONTAINER.ggxMs / CONTAINER.embossMs, 6);
  });
});
