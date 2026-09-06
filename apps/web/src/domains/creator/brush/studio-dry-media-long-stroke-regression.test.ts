import { describe, expect, it } from "vitest";

import { planStudioCausalDynamicBrushDepositSegmentsV3 } from "../studio-causal-dynamic-brush-deposit-v2";
import { planStudioDynamicBrushCoverageMarks } from "../studio-dynamic-brush-coverage-renderer";

import {
  normalizeStudioBrushDynamicsSettings,
  studioBrushDynamicsSettingsForBrushId,
  studioDryMediaUnionComposableProgramPin,
  type NormalizedStudioBrushDynamicsSettings,
  type StudioDynamicBrushDab,
} from "./studio-brush-dynamics";
import {
  STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
  STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID,
} from "./studio-brush-render-budget";
import {
  resolveStudioDynamicBrushMaterialIdentity,
  type StudioDynamicBrushMaterialIdentity,
} from "./studio-dry-media-dynamic-bridge";
import {
  ensureStudioDryMediaKernelTipIdlePrewarm,
  prewarmStudioDryMediaKernelTipMaps,
  resetStudioDryMediaKernelTipCacheForTests,
  studioDryMediaKernelTipCacheSizeForTests,
  studioDryMediaKernelTipWorkingSet,
} from "./studio-dry-media-kernel-tip";
import {
  evaluateStudioCalibratedSampledBudget,
  evaluateStudioCalibratedSampledDetection,
  STUDIO_PERF_CALIBRATION_MAX_GROWTH,
} from "./studio-perf-calibration";


const CORE_DRY_MEDIA = [
  "crayon",
  "chalk",
  "charcoal",
  "pastel",
  "oil-pastel",
] as const;

interface PlannedStroke {
  readonly dabs: readonly StudioDynamicBrushDab[];
  readonly dynamics: NormalizedStudioBrushDynamicsSettings;
  readonly identity: StudioDynamicBrushMaterialIdentity;
  readonly origin: Readonly<{ x: number; y: number }>;
}

function sourceArrays(sampleCount: number, phase = 0) {
  const points = Array.from({ length: sampleCount }, (_, index) => [
    12 + index * 2.35,
    80 + Math.sin(index / 13 + phase) * 9 + Math.sin(index / 47) * 3,
  ]).flat();
  return {
    points,
    pressures: Array.from(
      { length: sampleCount },
      (_, index) => 0.42 + (index % 17) / 40,
    ),
    tangentialPressures: Array.from({ length: sampleCount }, () => 0),
    speeds: Array.from(
      { length: sampleCount },
      (_, index) => 0.35 + (index % 11) * 0.06,
    ),
    tiltXs: Array.from({ length: sampleCount }, (_, index) => 8 + index % 15),
    tiltYs: Array.from({ length: sampleCount }, (_, index) => -12 + index % 9),
    twists: Array.from({ length: sampleCount }, (_, index) => index % 360),
  };
}

function plannedStroke(
  brushId: (typeof CORE_DRY_MEDIA)[number],
  sampleCount: number,
  phase = 0,
  pinnedLegacyUnion = false,
): PlannedStroke {
  const authored = studioBrushDynamicsSettingsForBrushId(brushId);
  const identity = resolveStudioDynamicBrushMaterialIdentity(brushId);
  if (!authored || !identity) throw new Error(`missing ${brushId} authority`);
  const dynamics = normalizeStudioBrushDynamicsSettings({
    ...authored,
    seed: 0x51a7_0000 + CORE_DRY_MEDIA.indexOf(brushId),
    width: { ...authored.width, base: authored.width.base * 1.2 },
    ...(pinnedLegacyUnion
      ? { dryMediaUnionProgram: studioDryMediaUnionComposableProgramPin() }
      : {}),
  });
  const source = sourceArrays(sampleCount, phase);
  const causal = planStudioCausalDynamicBrushDepositSegmentsV3({
    ...source,
    settings: dynamics,
  });
  if (!causal.ok) throw new Error(causal.reason);
  return {
    dabs: causal.segments.flatMap(({ dabs }) => dabs),
    dynamics,
    identity,
    origin: { x: source.points[0]!, y: source.points[1]! },
  };
}

function coverage(
  stroke: PlannedStroke,
  dabs: readonly StudioDynamicBrushDab[] = stroke.dabs,
  leadingSourceDabsToSkip = 0,
) {
  return planStudioDynamicBrushCoverageMarks({
    dabVariations: [dabs],
    materialIdentity: stroke.identity,
    strokeOrigins: [stroke.origin],
    dynamics: stroke.dynamics,
    dynamicSeed: stroke.dynamics.seed,
    stroke: "#2b211c",
    stampGrid: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID,
    markBudget: STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
    ...(leadingSourceDabsToSkip > 0
      ? { dryMediaUnionLeadingSourceDabsToSkip: leadingSourceDabsToSkip }
      : {}),
  });
}

function unionPolygons(plan: ReturnType<typeof coverage>) {
  expect(plan.ok).toBe(true);
  if (!plan.ok) throw new Error(plan.reason);
  expect(plan.marks).toHaveLength(1);
  const mark = plan.marks[0]!;
  expect(mark).toMatchObject({
    alpha: 1,
    ribbon: {
      kind: "dry-media-union-ribbon-polygon",
      role: "stroke-union",
    },
  });
  expect(mark.texture).toBeUndefined();
  expect(mark.falloff).toBeUndefined();
  return mark.ribbon!.polygons;
}

function kernelMarks(plan: ReturnType<typeof coverage>) {
  expect(plan.ok).toBe(true);
  if (!plan.ok) throw new Error(plan.reason);
  expect(plan.marks.length).toBeGreaterThan(0);
  for (const mark of plan.marks) {
    expect(mark.ribbon).toBeUndefined();
    expect(mark.texture?.kind).toBe("alpha-map");
  }
  return plan.marks;
}

describe("core dry-media long-stroke regression", () => {
  it.each(CORE_DRY_MEDIA)(
    "keeps arbitrary PINNED legacy-union causal chunks byte-identical for %s",
    (brushId) => {
      const stroke = plannedStroke(brushId, 768, 0, true);
      const complete = unionPolygons(coverage(stroke));
      const chunkSizes = [1, 7, 31, 113, 257, 59];
      const appended: Array<readonly number[]> = [];
      let cursor = 0;
      let chunkIndex = 0;
      while (cursor < stroke.dabs.length) {
        const end = Math.min(
          stroke.dabs.length,
          cursor + chunkSizes[chunkIndex % chunkSizes.length]!,
        );
        const predecessor = cursor > 0 ? cursor - 1 : cursor;
        appended.push(...unionPolygons(coverage(
          stroke,
          stroke.dabs.slice(predecessor, end),
          cursor > 0 ? 1 : 0,
        )));
        cursor = end;
        chunkIndex += 1;
      }
      expect(appended).toEqual(complete);
    },
  );

  it.each(CORE_DRY_MEDIA)(
    "keeps arbitrary KERNEL dab-path causal chunks byte-identical for %s",
    (brushId) => {
      const stroke = plannedStroke(brushId, 512);
      const complete = kernelMarks(coverage(stroke));
      const chunkSizes = [1, 7, 31, 113, 59];
      const appended: Array<(typeof complete)[number]> = [];
      let cursor = 0;
      let chunkIndex = 0;
      while (cursor < stroke.dabs.length) {
        const end = Math.min(
          stroke.dabs.length,
          cursor + chunkSizes[chunkIndex % chunkSizes.length]!,
        );
        // Kernel marks are per-dab: a suffix plan needs no predecessor station context.
        appended.push(...kernelMarks(coverage(
          stroke,
          stroke.dabs.slice(cursor, end),
        )));
        cursor = end;
        chunkIndex += 1;
      }
      expect(appended).toEqual(complete);
    },
  );

  it("plans fresh strokes without union polygons and without the union program pin", () => {
    for (const brushId of CORE_DRY_MEDIA) {
      const stroke = plannedStroke(brushId, 192);
      expect(stroke.dynamics.dryMediaUnionProgram, brushId).toBeUndefined();
      const plan = coverage(stroke);
      expect(plan.ok, brushId).toBe(true);
      if (!plan.ok) continue;
      expect(
        plan.marks.some((mark) =>
          mark.ribbon?.kind === "dry-media-union-ribbon-polygon"),
        brushId,
      ).toBe(false);
      expect(plan.marks.every((mark) => mark.ribbon === undefined), brushId)
        .toBe(true);
    }
  });

  it("keeps 1k/2k source commits linear and inside an interactive planning budget", () => {
    // Warm module/JIT caches before measuring allocation-heavy material lowering.
    kernelMarks(coverage(plannedStroke("charcoal", 128)));
    const measure = (sampleCount: number) => {
      const startedAt = performance.now();
      const stroke = plannedStroke("charcoal", sampleCount);
      const marks = kernelMarks(coverage(stroke));
      return {
        elapsed: performance.now() - startedAt,
        dabCount: stroke.dabs.length,
        markCount: marks.length,
      };
    };
    const oneThousand = measure(1_000);
    const twoThousand = measure(2_000);

    expect(oneThousand.dabCount).toBeGreaterThan(700);
    expect(twoThousand.dabCount).toBeGreaterThan(oneThousand.dabCount * 1.8);
    expect(twoThousand.markCount).toBeGreaterThan(oneThousand.markCount * 1.8);
    expect(oneThousand.elapsed).toBeLessThan(750);
    expect(twoThousand.elapsed).toBeLessThan(1_500);
    // Wide slack absorbs CI/JIT noise while rejecting accidental prefix-quadratic replanning.
    expect(twoThousand.elapsed).toBeLessThan(oneThousand.elapsed * 6 + 150);
  });

  it("soaks 5 consecutive 2000-sample strokes with stable chunk planning and zero failures", () => {
    // Warm-up before timing.
    kernelMarks(coverage(plannedStroke("crayon", 128)));
    const chunkSize = 128;
    const perStrokeElapsed: number[] = [];
    let maxChunkMs = 0;
    for (let strokeIndex = 0; strokeIndex < 5; strokeIndex += 1) {
      const brushId = CORE_DRY_MEDIA[strokeIndex % CORE_DRY_MEDIA.length]!;
      const stroke = plannedStroke(brushId, 2_000, strokeIndex / 3);
      expect(stroke.dabs.length, brushId).toBeGreaterThan(900);
      let cursor = 0;
      const strokeStartedAt = performance.now();
      while (cursor < stroke.dabs.length) {
        const end = Math.min(stroke.dabs.length, cursor + chunkSize);
        const chunkStartedAt = performance.now();
        const plan = coverage(stroke, stroke.dabs.slice(cursor, end));
        const chunkElapsed = performance.now() - chunkStartedAt;
        if (chunkElapsed > maxChunkMs) maxChunkMs = chunkElapsed;
        // Zero budget failures across the whole soak.
        expect(plan.ok, `${brushId} chunk ${cursor}:${end}`).toBe(true);
        cursor = end;
      }
      perStrokeElapsed.push(performance.now() - strokeStartedAt);
    }
    // No live-session freeze: every incremental chunk stays under one 30fps frame.
    expect(maxChunkMs).toBeLessThan(33);
    // No cross-stroke degradation: the union-era failure mode was state accumulating between
    // strokes. Allow 20% relative drift plus a small absolute grace for CI timer noise.
    const first = perStrokeElapsed[0]!;
    const last = perStrokeElapsed.at(-1)!;
    expect(last).toBeLessThan(first * 1.2 + 40);
  });
});

describe("cold-start first-chunk freeze gate (adversarial-review regression)", () => {
  // Probe being reproduced (Lens 3, major): every freeze gate in this file and in the perf
  // matrix warmed caches before timing, so the measured cold first-stroke class — 75.8ms
  // first chunk on the pre-wave union path; crayon 53.8ms / charcoal 51.1ms / oil-pastel
  // 40.8ms fresh-process on the replacement kernel path vs ~2ms warm — was structurally
  // invisible. The dominant cost is kernel tip cache misses (1.6-5.4ms per 128×128 bake).
  //
  // The product fix pays those bakes during browser idle time before the first stroke
  // (ensureStudioDryMediaKernelTipIdlePrewarm, wired at kernel-tip module load). This gate
  // forces a COLD planner state (tip cache fully reset — "fresh planner state"; process-level
  // module/JIT cost is page-load-amortized in the app and is not part of a stroke), replays
  // the admission prewarm, and pins two facts per material:
  //   1. the prewarmed working set covers the whole first chunk — ZERO tip bakes remain, so
  //      the 1.6-5.4ms × N bake stall class cannot recur on the first chunk;
  //   2. the prewarmed first 24-sample chunk plans well under the 33ms freeze budget
  //      (measured ~2-8ms here — a >4× documented margin).
  // Before the fix, the prewarm APIs did not exist and the first chunk re-baked its tips
  // inside the stroke, exceeding the budget on the banded materials.
  const FIRST_CHUNK_SAMPLES = 24;
  const CHUNK_FREEZE_BUDGET_MS = 33;
  /** Softness the idle-prewarm gate drives every core material at. */
  const IDLE_PREWARM_SOFTNESS = 0.4;
  /**
   * Denominator material for the idle-slice budget: the priciest bake in the authored working
   * set, so an honest one-bake slice reads ≈1x rather than banking credit against a cheap
   * neighbour. Measured mean bake at softness 0.4 — charcoal 4.05-4.24ms against crayon
   * 2.14-2.33, chalk 2.44-2.59, pastel 2.26-2.41, oil-pastel 2.07-2.20 — and the worst slice of
   * a full drain is always one of charcoal's, which is why the ratio sits just above 1.
   */
  const IDLE_PREWARM_REFERENCE_MATERIAL = "charcoal" as const;
  /**
   * Growth over one bake that counts as a regression. The module default: recorded honest drains
   * read x0.94-x1.10 — four idle runs and five with the box oversubscribed 8 hogs against 12
   * cores, which land in the same range — so 1.5 leaves ~36% headroom while convicting from x1.5,
   * and a 2x slice is caught with 33% to spare. The detection assertion below proves that last
   * claim live on the running machine rather than assuming it.
   */
  const IDLE_PREWARM_MAX_SLICE_RATIO = STUDIO_PERF_CALIBRATION_MAX_GROWTH;
  /**
   * Drains reduced into one sample, by taking each slice's MINIMUM across them.
   *
   * The numerator here is a MAX over the drain's ~108 slices, and a maximum collects stalls
   * instead of shedding them: min-of-N over whole samples cannot help, because under contention
   * essentially every drain has some preempted slice, so every sample's maximum is inflated.
   * Measured on a deliberately oversubscribed box (8 spinning hogs against 12 cores), that read
   * 1.92 / 2.28 / 1.78 against a 1.50 budget on an unregressed tree — a false conviction of
   * exactly the kind this file is being repaired for.
   *
   * Reducing per SLICE fixes it at the right level: slice i bakes the same key in every drain, so
   * its minimum across drains is the honest cost of that bake, and the worst honest slice is the
   * maximum of those. Three drains put the odds of the same slice being starved in all of them
   * low enough that the oversubscribed readings come back in line with the idle ones.
   */
  const IDLE_PREWARM_DRAIN_REPEATS = 3;

  it.each(CORE_DRY_MEDIA)(
    "plans the admission-prewarmed cold first chunk for %s under the freeze budget with zero tip bakes",
    (brushId) => {
      resetStudioDryMediaKernelTipCacheForTests();
      const stroke = plannedStroke(brushId, FIRST_CHUNK_SAMPLES);

      // Admission prewarm at the material's authored softness bakes the full working set.
      const baked = prewarmStudioDryMediaKernelTipMaps(
        brushId,
        stroke.dynamics.tip.softness,
      );
      expect(baked).toBe(
        studioDryMediaKernelTipWorkingSet(brushId, stroke.dynamics.tip.softness).length,
      );
      const cacheSizeAfterPrewarm = studioDryMediaKernelTipCacheSizeForTests();

      const startedAt = performance.now();
      const plan = coverage(stroke);
      const elapsedMs = performance.now() - startedAt;
      expect(plan.ok, brushId).toBe(true);

      // 1. Working-set coverage: the first chunk resolved every tip from cache.
      expect(studioDryMediaKernelTipCacheSizeForTests()).toBe(cacheSizeAfterPrewarm);
      // 2. Freeze budget with margin (typical ~2-8ms measured on the gate machine).
      expect(elapsedMs, `${brushId} cold prewarmed first chunk`).toBeLessThan(
        CHUNK_FREEZE_BUDGET_MS,
      );
    },
  );

  it("pumps the idle prewarm one bounded bake per slice until the working set is resident", () => {
    const expectedKeys = CORE_DRY_MEDIA.reduce(
      (total, materialId) =>
        total + studioDryMediaKernelTipWorkingSet(materialId, IDLE_PREWARM_SOFTNESS).length,
      0,
    );
    const referenceKeys = studioDryMediaKernelTipWorkingSet(
      IDLE_PREWARM_REFERENCE_MATERIAL,
      IDLE_PREWARM_SOFTNESS,
    ).length;

    /**
     * The denominator: one cold 128×128 bake of the priciest material in the authored working
     * set, timed immediately before the drain it divides.
     *
     * A raw `< 33ms` ceiling measured the baker AND the machine, and the machine is what made it
     * red on a shared runner (34.93ms against 33). The pump's contract is not "N milliseconds" —
     * it is ONE BAKE PER IDLE SLICE, so a bake is the honest unit to state the budget in, and
     * `studio-perf-calibration.ts`'s "pick the denominator that resembles the work" has no closer
     * match available: numerator and denominator are the same 128×128 shaping loop, so they
     * co-scale exactly and no CPU can move the verdict. That is the property the built-in scalar
     * kernel could not offer here — a tip bake is a pure per-texel sampler, the class the module's
     * header records as scoring 0.93-1.00 on one box and 1.98-2.09 on another.
     *
     * Measured 12 charcoal keys back to back rather than one, so the window (~49ms) is long
     * enough that neither side is reading clock quantisation, then divided back down to one bake.
     *
     * What this reference deliberately CANNOT see, because it moves with the numerator: a
     * uniformly slower baker. That is the shaping kernel's own budget, not the pump's, and the
     * cold first-chunk gate above still holds it to a wall-clock frame.
     */
    const measureOneColdBakeMs = (): number => {
      resetStudioDryMediaKernelTipCacheForTests();
      const startedAt = performance.now();
      const baked = prewarmStudioDryMediaKernelTipMaps(
        IDLE_PREWARM_REFERENCE_MATERIAL,
        IDLE_PREWARM_SOFTNESS,
      );
      const elapsedMs = performance.now() - startedAt;
      // A cache hit here would silently shrink the denominator and manufacture a violation.
      expect(baked, "reference bake was not cold").toBe(referenceKeys);
      return elapsedMs / referenceKeys;
    };

    /** One full cold drain, returning every slice's cost in pump order. */
    const drainSliceCosts = (): readonly number[] => {
      resetStudioDryMediaKernelTipCacheForTests();
      const pending: Array<() => void> = [];
      const listMaterials = () =>
        CORE_DRY_MEDIA.map((materialId) => ({ materialId, softness: IDLE_PREWARM_SOFTNESS }));
      const scheduled = ensureStudioDryMediaKernelTipIdlePrewarm(
        listMaterials,
        (pump) => pending.push(pump),
      );
      expect(scheduled).toBe(true);
      // Re-entry is a no-op while a pump is scheduled (StrictMode/dual-import safety).
      expect(
        ensureStudioDryMediaKernelTipIdlePrewarm(listMaterials, (pump) => pending.push(pump)),
      ).toBe(false);

      const sliceMs: number[] = [];
      let maxResidentGrowth = 0;
      while (pending.length > 0 && sliceMs.length < expectedKeys + 8) {
        const pump = pending.shift()!;
        const residentBefore = studioDryMediaKernelTipCacheSizeForTests();
        const sliceStartedAt = performance.now();
        pump();
        sliceMs.push(performance.now() - sliceStartedAt);
        maxResidentGrowth = Math.max(
          maxResidentGrowth,
          studioDryMediaKernelTipCacheSizeForTests() - residentBefore,
        );
      }
      const slices = sliceMs.length;
      expect(pending).toHaveLength(0);
      expect(studioDryMediaKernelTipCacheSizeForTests()).toBeGreaterThanOrEqual(
        // The 64-entry LRU bounds residency; every slice stays a single bake.
        Math.min(expectedKeys, 64),
      );
      expect(slices).toBeGreaterThanOrEqual(Math.min(expectedKeys, 64));
      // The invariant's DETERMINISTIC witness -- no clock involved, so it holds identically on
      // every machine. A slice that bakes several tip maps grows the cache by more than one,
      // whether or not the runner was fast enough to hide it in the timing. Stated as a bound
      // rather than an equality so an LRU eviction (a slice that bakes and evicts, netting zero)
      // still reads honestly.
      expect(maxResidentGrowth, "tip maps baked in a single idle slice").toBeLessThanOrEqual(1);
      return sliceMs;
    };

    /**
     * One interleaved pair. Both halves are reduced across `IDLE_PREWARM_DRAIN_REPEATS` runs
     * before they meet: the reference by its own minimum, the drain slice by slice, so the
     * numerator is the worst HONEST bake rather than the worst scheduling accident.
     */
    const takeSample = () => {
      let referenceMs = Infinity;
      let honestSliceMs: number[] = [];
      for (let repeat = 0; repeat < IDLE_PREWARM_DRAIN_REPEATS; repeat += 1) {
        referenceMs = Math.min(referenceMs, measureOneColdBakeMs());
        const slices = drainSliceCosts();
        honestSliceMs = repeat === 0
          ? [...slices]
          : honestSliceMs.map((best, index) => Math.min(best, slices[index] ?? Infinity));
      }
      return { referenceMs, workMs: Math.max(...honestSliceMs) };
    };

    // Warmed by hand rather than through `warmups`, so the JIT pass costs one drain instead of
    // one whole reduced sample.
    measureOneColdBakeMs();
    drainSliceCosts();
    const budget = evaluateStudioCalibratedSampledBudget({
      label: "worst idle prewarm slice vs one cold kernel-tip bake",
      takeSample,
      maxRatio: IDLE_PREWARM_MAX_SLICE_RATIO,
      samples: 2,
      warmups: 0,
    });
    // One 128×128 bake per idle slice, and the freeze budget it buys: the worst slice is a single
    // bake plus the pump's own queue walk, which measures x0.94-x1.10 both idle and with the box
    // oversubscribed 8 hogs against 12 cores. Against the 33ms frame the raw ceiling named that is
    // the same >6x margin it always had, now stated without measuring the machine to find out.
    expect(budget.ok, budget.detail).toBe(true);

    // The gate's mirror image, on this machine, from the passes just measured: a slice that
    // started doing twice a bake's work — a second bake, or an unbounded queue walk — would have
    // been convicted. This is what stops the calibrated form from decaying into a no-op.
    const detection = evaluateStudioCalibratedSampledDetection({
      label: budget.label,
      takeSample,
      maxRatio: IDLE_PREWARM_MAX_SLICE_RATIO,
      seed: budget.passes,
      factor: 2,
      samples: 2,
      warmups: 0,
    });
    expect(detection.detected, detection.detail).toBe(true);

    resetStudioDryMediaKernelTipCacheForTests();
  });

  it("keeps PINNED legacy-union chunked replay inside the freeze budget (soak sentinel)", () => {
    // The perf-matrix soak sentinels exercise the kernel path; the pinned union replay path
    // previously had byte-identity coverage but no perf gate at all. Warm-path pin: chunked
    // replay of a pinned 1500-sample stroke must never exceed one 30fps frame per chunk.
    unionPolygons(coverage(plannedStroke("crayon", 96, 0, true)));
    const stroke = plannedStroke("oil-pastel", 1_500, 0.7, true);
    const chunkSize = 128;
    let cursor = 0;
    let maxChunkMs = 0;
    while (cursor < stroke.dabs.length) {
      const end = Math.min(stroke.dabs.length, cursor + chunkSize);
      const predecessor = cursor > 0 ? cursor - 1 : cursor;
      const chunkStartedAt = performance.now();
      const plan = coverage(
        stroke,
        stroke.dabs.slice(predecessor, end),
        cursor > 0 ? 1 : 0,
      );
      maxChunkMs = Math.max(maxChunkMs, performance.now() - chunkStartedAt);
      expect(plan.ok, `pinned union chunk ${cursor}:${end}`).toBe(true);
      cursor = end;
    }
    expect(maxChunkMs).toBeLessThan(CHUNK_FREEZE_BUDGET_MS);
  });
});
