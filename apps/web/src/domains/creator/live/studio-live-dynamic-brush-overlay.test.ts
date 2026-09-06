import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isStudioDynamicBrushCausalDepositPipeline,
  normalizeStudioBrushDynamicsSettings,
  STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
  STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
  studioBrushDynamicsPresetSettings,
  studioBrushDynamicsSeedFromKey,
  studioBrushDynamicsSettingsForBrushId,
  studioDryMediaUnionComposableProgramPin,
} from "../brush/studio-brush-dynamics";
import { STUDIO_BRUSH_PACK_DESCRIPTORS } from "../brush/studio-brush-pack-index";
import { materializeStudioBrushPackSelection } from "../brush/studio-brush-pack-runtime";
import {
  hydrateStudioBrushR8GrainAsset,
  resetStudioBrushR8GrainRegistry,
} from "../brush/studio-brush-r8-grain-runtime";
import {
  planStudioDynamicBrushRenderBudget,
  STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
  STUDIO_DYNAMIC_BRUSH_CAUSAL_MARK_BUDGET,
  STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID,
  STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET,
  STUDIO_DYNAMIC_BRUSH_RENDER_STAMP_GRIDS,
} from "../brush/studio-brush-render-budget";
import { studioCoreBrushCatalogSelection } from "../brush/studio-brush-selection";
import { clearStudioBrushTextureStampCache } from "../brush/studio-brush-textured-stamp";
import { STUDIO_DRY_MEDIA_UNION_RIBBON_CARRIER_VERSION } from "../brush/studio-dry-media-union-ribbon-carrier";
import {
  reduceStudioPerfCalibrationSamples,
  runStudioPerfCalibrationRounds,
  type StudioPerfCalibrationSample,
} from "../brush/studio-perf-calibration";
import { BRUSH_PRESETS } from "../studio-brush";
import {
  planStudioCausalDynamicBrushDepositSegmentsV3,
  STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_DABS,
} from "../studio-causal-dynamic-brush-deposit-v2";
import {
  planStudioDynamicBrushCoverageAndLegacyMarks,
  renderStudioDynamicBrushCoverageMark,
  STUDIO_DYNAMIC_COVERAGE_R8_ALPHA_MAP_BYTE_BUDGET,
  type StudioDynamicBrushCoverageMark,
} from "../studio-dynamic-brush-coverage-renderer";
import { planStudioDynamicBrushRender } from "../studio-dynamic-brush-render-plan";
import { STUDIO_LIVE_SURFACE_MAX_BACKING_PIXELS } from "../studio-low-latency-canvas";
import { sha256HexPortable } from "../studio-sha256";
import {
  planStudioWebDrawingKitOwnedDabs,
  recommendStudioWebDrawingLiveMaxDabs,
  STUDIO_WEB_DRAWING_KIT_OWNED_BRUSH_IDS,
  studioWebDrawingKitOwnsStrokeGeometry,
} from "../studio-web-drawing-stroke-bridge";

import {
  appendDryMediaUnionAccumulator,
  createDryMediaUnionAccumulator,
  snapshotDryMediaUnionAccumulator,
  StudioLiveDynamicBrushOverlayRenderer,
  studioLiveDynamicBrushOverlaySupportsElement,
} from "./studio-live-dynamic-brush-overlay";
import {
  APPEND_CHUNK_MARK_THRESHOLD,
  APPEND_COLD_START_COST_LIMIT,
  APPEND_FIRST_CHUNK_COLD_START_COST_LIMIT,
  appendColdStartCostRatio,
  appendFirstChunkColdStartCostRatio,
  attachedRenderer,
  complexDynamics,
  drawElement,
  recordingCanvas,
  SURFACE,
  type RecordedEllipse,
} from "./studio-live-dynamic-brush-overlay.fixture";

function segmentedCausalOverlayDynamics() {
  return normalizeStudioBrushDynamicsSettings({
    ...studioBrushDynamicsPresetSettings("ink-particle"),
    depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
    width: { base: 2, mappings: [] },
    opacity: { base: 1, mappings: [] },
    flow: { base: 1, mappings: [] },
    tip: { shape: "round", softness: 0 },
    grain: { amount: 0 },
    tipLayers: [],
    dualBrush: { enabled: false },
    taper: { enabled: false },
    spacingRatio: null,
    spacing: { base: 0.25, mappings: [] },
    scatterRatio: null,
    scatter: { base: 0, mappings: [] },
    roundness: { base: 1, mappings: [] },
  });
}

function segmentedCausalOverlayRoute(): number[] {
  return Array.from({ length: 75 }, (_, index) => [
    index % 2 === 0 ? 8 : 232,
    24,
  ]).flat();
}

function operationResultLabel(
  result: { readonly status: string; readonly reason?: string },
): string {
  return result.status === "unavailable" || result.status === "rejected"
    ? result.reason ?? result.status
    : result.status;
}

/**
 * How much more a stroke's late appends draw than its early ones -- the O(1) claim as a number.
 *
 * Pure and count-based, so both the healthy shape and the regression it must reject are pinned as
 * data rather than measured on a clock. An incremental appender keeps this at ~1: each append
 * deposits one step's worth of marks no matter how long the stroke behind it is. An appender that
 * repaints the cumulative stroke makes append k draw O(k), which puts the second half at ~3x the
 * first.
 */
function appendMarkGrowthRatio(deltas: readonly number[]): number {
  if (deltas.length < 2) throw new Error("An append-growth ratio needs at least two appends.");
  const half = Math.floor(deltas.length / 2);
  const sum = (slice: readonly number[]): number => slice.reduce((total, d) => total + d, 0);
  const early = sum(deltas.slice(0, half));
  if (!(early > 0)) throw new Error("The first half of a stroke drew nothing.");
  return sum(deltas.slice(half)) / early;
}

/**
 * What one ribbon-chunk append costs in units of one ordinary append — the periodic class graded
 * against the steady one, inside a single pass.
 *
 * The cheapest append over a whole stroke is always an ordinary one, and both halves of the
 * stroke contain the same 1:8 mix, so a slowdown confined to the CHUNK class moves neither the
 * whole-stroke floor nor the early/late ratio, and draws exactly the same marks. Every eighth frame
 * growing to 25ms can remain inside the absolute 30ms append ceiling while becoming a visible
 * periodic hitch, so the class needs its own relative gate.
 *
 * The obvious fix — calibrating the chunk class against the reference kernel like everything else
 * — does not survive measurement: 24 samples of a ~13ms window do not converge under contention,
 * and the class read 12.72-22.30 against the kernel across idle and loaded runs. Dividing by the
 * ORDINARY class instead removes the machine exactly rather than approximately: both classes are
 * the same code on the same box interleaved through the same stroke, so a machine 60% slower at
 * appends (which is what CI is) cancels completely, and only the classes' relative cost survives.
 *
 * Which ordinary appends, and reduced how, both had to be measured rather than assumed. Cheapest
 * chunk over cheapest ordinary anywhere in the stroke does NOT hold: the two windows are 13ms and
 * 1ms, so the longer one absorbs more preemption, and under six spinning hogs plus five other
 * suites in parallel workers that form read 17.08-19.91 where it had recorded 11.69-12.75. Each
 * chunk against the seven ordinary appends of its own cycle (~7.9ms against ~13.4ms, adjacent in
 * time) removes that asymmetry, and the median across cycles removes the two-sided noise the
 * ratio then carries: 1.089-1.154 across the same conditions, a 6% spread.
 */
function appendChunkCostRatio(
  samples: readonly StudioPerfCalibrationSample[],
  markDeltas: readonly number[],
): number {
  if (samples.length !== markDeltas.length) {
    throw new Error("Every append sample needs its own mark delta.");
  }
  // Each chunk is graded against the ordinary appends of ITS OWN cycle -- the seven that precede
  // it -- rather than against the cheapest ordinary append anywhere in the stroke. Those seven
  // cost ~7.9ms together against the chunk's ~13.4ms, so the two windows span comparable
  // durations and comparable stretches of wall clock.
  const cycles: number[] = [];
  for (let index = 0; index < samples.length; index += 1) {
    if (markDeltas[index]! <= APPEND_CHUNK_MARK_THRESHOLD) continue;
    let ordinaryMs = 0;
    let ordinaryCount = 0;
    for (let back = Math.max(0, index - 7); back < index; back += 1) {
      if (markDeltas[back]! > APPEND_CHUNK_MARK_THRESHOLD) continue;
      ordinaryMs += samples[back]!.workMs;
      ordinaryCount += 1;
    }
    if (ordinaryCount < 5 || !(ordinaryMs > 0)) continue;
    cycles.push(samples[index]!.workMs / ordinaryMs);
  }
  if (cycles.length < 8) {
    throw new Error(`Chunk cost needs at least eight complete cycles, got ${cycles.length}.`);
  }
  // The MEDIAN, not the minimum, and that is the one place in this file where the minimum is the
  // wrong reducer. Everywhere else the quantity is a cost and noise is one-sided, so the cheapest
  // reading is the honest one. Here the quantity is already a ratio of two same-duration windows,
  // so a stall lands on either side with equal ease and the noise is two-sided: across 24 cycles
  // the extremes ran 0.34-2.44 while the median moved only 1.089-1.154. Taking the minimum of a
  // two-sided distribution measures the luckiest cycle, not the class.
  const sorted = [...cycles].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * How much more the stroke's LATE ribbon-chunk appends cost than its early ones.
 *
 * The two growth gates above reduce different populations, and the gap between them is real: the
 * early/late ratio picks an ORDINARY append from each half, while the chunk/ordinary ratio picks
 * the cheapest chunk across the WHOLE stroke. So re-planning that becomes length-dependent only
 * on the chunk path — the append that actually does the extra planning — leaves an unaffected
 * early chunk as the cheapest one, moves neither ratio, and changes no mark count.
 *
 * Both halves are chunk appends on the same machine, so this is machine-independent by the same
 * construction as the chunk/ordinary ratio: what survives the division is length dependence
 * within the class and nothing else.
 */
function appendChunkGrowthRatio(
  samples: readonly StudioPerfCalibrationSample[],
  markDeltas: readonly number[],
): number {
  if (samples.length !== markDeltas.length) {
    throw new Error("Every append sample needs its own mark delta.");
  }
  const chunks = samples.filter((_, index) => markDeltas[index]! > APPEND_CHUNK_MARK_THRESHOLD);
  if (chunks.length < 4) {
    throw new Error(`Chunk growth needs at least four chunk appends, got ${chunks.length}.`);
  }
  // Split by POSITION IN THE STROKE, and calibrate each half against the reference floor of that
  // same stretch. This stroke runs for seconds, so a runner that gets busier partway through
  // moves the two halves' raw milliseconds by different amounts, and a raw comparison reports
  // that machine-speed shift as length growth.
  //
  // The machine-speed estimate is the cheapest reference window over EVERY append in the half —
  // roughly ninety of them — not over the dozen chunks. That distinction is measured, not
  // stylistic: a reference window is ~1ms, so its own noise is large next to the append it
  // calibrates, and estimating it from the chunks alone injects more variance than the drift it
  // removes. Reducing each half with `reduceStudioPerfCalibrationSamples` reads 0.5052-1.6583
  // under load and pairing sample-by-sample reads 0.4002-1.1978, both worse than the uncalibrated
  // form's 0.728-0.833; drawing the floor from all ninety appends is what makes calibration pay.
  const half = Math.floor(samples.length / 2);
  const referenceFloorMs = (from: number, to: number): number => {
    let best = Number.POSITIVE_INFINITY;
    for (let index = from; index < to; index += 1) {
      best = Math.min(best, samples[index]!.referenceMs);
    }
    return best;
  };
  const chunkFloorMs = (from: number, to: number): number => {
    let best = Number.POSITIVE_INFINITY;
    for (let index = from; index < to; index += 1) {
      if (markDeltas[index]! > APPEND_CHUNK_MARK_THRESHOLD) {
        best = Math.min(best, samples[index]!.workMs);
      }
    }
    return best;
  };
  const calibratedHalf = (from: number, to: number): number => {
    const reference = referenceFloorMs(from, to);
    const chunk = chunkFloorMs(from, to);
    if (!(reference > 0)) {
      throw new Error("A zero-length reference window cannot calibrate a chunk append.");
    }
    if (!Number.isFinite(chunk)) {
      throw new Error("Chunk growth needs chunk appends in both halves of the stroke.");
    }
    return chunk / reference;
  };
  const early = calibratedHalf(0, half);
  if (!(early > 0)) throw new Error("An early chunk append that costs nothing is not a denominator.");
  return calibratedHalf(half, samples.length) / early;
}

/**
 * Recorded on the CALIBRATED form, cheapest-of-3 per run: 0.8749 / 0.9172 idle and 0.4845 /
 * 0.5034 / 0.5191 / 0.769 under six spinning hogs on four cores. The individual passes behind
 * those are much wider — 0.8749-0.9785 idle and 0.4845-1.683 loaded — which is why the reduction
 * across passes is a minimum here; see the comment at the assertion.
 *
 * 1.25 carries 36% headroom over the worst honest reading while a doubled late-chunk class
 * (>=1.46) is convicted with 17% margin, and 500ms added to late chunks alone reads ~34.
 */
const APPEND_CHUNK_GROWTH_LIMIT = 1.25;

/**
 * Recorded on the median-of-3-passes form: 1.1218 / 1.1356 / 1.2028 idle and 1.0835 / 1.1808 /
 * 1.2123 under six spinning hogs on four cores; the individual passes behind those span
 * 1.1157-1.2089 idle and 1.0742-1.2544 loaded. A 12% spread, because both sides of the division
 * are the same code on the same machine over comparable durations.
 *
 * 1.45 carries 21% headroom over the worst honest median, while a doubled chunk class (>=2.18) is
 * convicted with 50% margin and the 500ms-every-eighth-frame case reads in the tens.
 */
const APPEND_CHUNK_COST_LIMIT = 1.45;

/**
 * How much more a stroke's LATE appends cost than its early ones, with the machine divided out of
 * both halves — the O(1) claim on the clock rather than on mark counts.
 *
 * The cheapest append over a whole stroke cannot answer this. It is always an early one, so a
 * regression that only slows later appends leaves it exactly where it was; adding 100ms to every
 * append in the second half moves neither that minimum nor any mark count, because a planner can
 * recompute prior geometry and still render only the unseen suffix. Splitting the pass in two and
 * calibrating each half against the references timed beside ITS OWN appends catches precisely
 * that: both halves cancel the machine independently, so what survives the division is length
 * dependence and nothing else.
 */
function appendCalibratedHalfGrowth(
  samples: readonly StudioPerfCalibrationSample[],
): number {
  if (samples.length < 4) {
    throw new Error("A half-growth ratio needs at least four appends.");
  }
  const half = Math.floor(samples.length / 2);
  const early = reduceStudioPerfCalibrationSamples(samples.slice(0, half));
  const late = reduceStudioPerfCalibrationSamples(samples.slice(half));
  return late.ratio / early.ratio;
}

/**
 * Recorded across idle and six-hogs-on-four-cores runs at 0.881 / 0.904 / 0.933 / 0.953 / 0.964 /
 * 0.977 / 1.004 / 1.009 / 1.018 — a 14% spread, centred just below 1 because the second half of a
 * stroke runs on a warmer JIT. 1.3 carries 28% headroom over the worst of those, while any real
 * length dependence lands far above it: a linear replan puts this near 100, and even a leak that
 * adds 1% of the base cost per append reaches ~2. Confirmed live rather than argued — slowing
 * only the second half of the appends by 1.5x scored 1.357 / 1.492 / 1.621 and failed on every
 * pass, while the global cheapest append, and every mark count, stayed exactly where they were.
 */
const APPEND_LENGTH_GROWTH_LIMIT = 1.3;

/**
 * Recorded 0.9996 for the incremental appender, identically in every pass on every machine (mark
 * counts do not vary). 1.25 leaves room for a step-count change without admitting anything
 * asymptotic: the cheapest cumulative repaint this loop can express already lands near 3.
 */
const APPEND_MARK_GROWTH_LIMIT = 1.25;

function maximumLongitudinalCoverageGap(
  marks: readonly RecordedEllipse[],
  startX: number,
  endX: number,
): number {
  const intervals = marks
    .map((mark) => {
      const cosine = Math.cos(mark.angleRadians);
      const sine = Math.sin(mark.angleRadians);
      const halfWidth = Math.hypot(
        mark.radiusX * cosine,
        mark.radiusY * sine,
      );
      return {
        start: Math.max(startX, mark.x - halfWidth),
        end: Math.min(endX, mark.x + halfWidth),
      };
    })
    .filter(({ start, end }) => end >= startX && start <= endX)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  let maximum = 0;
  let coveredUntil = startX;
  for (const interval of intervals) {
    maximum = Math.max(maximum, interval.start - coveredUntil);
    coveredUntil = Math.max(coveredUntil, interval.end);
  }
  return Math.max(maximum, endX - coveredUntil);
}

afterEach(() => {
  clearStudioBrushTextureStampCache();
  resetStudioBrushR8GrainRegistry();
  vi.unstubAllGlobals();
});

describe("StudioLiveDynamicBrushOverlayRenderer", () => {
  it("enforces one stroke-wide R8 alpha-map budget across incremental pointer frames", () => {
    const decoded = Uint8Array.from([
      0, 64, 128, 255,
      255, 128, 64, 0,
      32, 96, 160, 224,
      224, 160, 96, 32,
    ]);
    const source = {
      kind: "r8-texture-v1",
      asset: {
        assetId: "paper.live-budget.v1",
        encodedSha256: `sha256:${"e".repeat(64)}`,
        decodedSha256: `sha256:${sha256HexPortable(decoded)}`,
        byteLength: 137,
        mediaType: "image/png",
        width: 4,
        height: 4,
        channel: "luminance",
        encoding: "r8-unorm",
      },
    } as const;
    expect(hydrateStudioBrushR8GrainAsset(source, decoded).status).toBe("ready");
    const dynamics = normalizeStudioBrushDynamicsSettings({
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
      width: { base: 16, mappings: [] },
      opacity: { base: 1, mappings: [] },
      flow: { base: 1, mappings: [] },
      tip: { shape: "hard", softness: 0, alphaMapSize: 256 },
      grain: {
        amount: 0.8,
        scale: 24,
        contrast: 0.55,
        seed: 17,
        space: "canvas-fixed",
        source,
      },
      taper: { enabled: false },
      spacingRatio: null,
      spacing: { base: 1, mappings: [] },
      scatterRatio: null,
      scatter: { base: 0, mappings: [] },
      roundness: { base: 1, mappings: [] },
    });
    const { renderer } = attachedRenderer();
    const points = [10, 20];
    expect(renderer.begin(drawElement("r8-live-budget", points, {
      brush: "dry-media",
      brushDynamics: dynamics,
    }))).toMatchObject({ status: "started" });

    let successfulFrames = 0;
    let failure: ReturnType<typeof renderer.appendFrom> | null = null;
    for (let index = 1; index <= 96; index += 1) {
      points.push(10 + index, 20);
      const result = renderer.appendFrom(drawElement("r8-live-budget", points, {
        brush: "dry-media",
        brushDynamics: dynamics,
      }));
      if (result.status === "unavailable" || result.status === "rejected") {
        failure = result;
        break;
      }
      successfulFrames += 1;
    }

    const alphaMapBytesPerDab = 256 * 256 * Float32Array.BYTES_PER_ELEMENT;
    expect(
      STUDIO_DYNAMIC_COVERAGE_R8_ALPHA_MAP_BYTE_BUDGET
        / alphaMapBytesPerDab,
    ).toBe(64);
    expect(successfulFrames).toBeGreaterThan(1);
    expect(successfulFrames).toBeLessThanOrEqual(63);
    expect(failure).toEqual({ status: "rejected", reason: "material-plan" });
  });

  it("keeps legacy texture grids adaptive while causal-v2 starts and seals on grid3", () => {
    const authoredDynamics = studioBrushDynamicsSettingsForBrushId("charcoal");
    if (!authoredDynamics) throw new Error("missing charcoal dynamics");
    const dynamics = normalizeStudioBrushDynamicsSettings({
      ...authoredDynamics,
      depositPipeline: undefined,
    });
    const pointerDown = planStudioDynamicBrushRenderBudget({
      settings: dynamics,
      dabCount: 1,
      symmetryCount: 1,
      markBudget: STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET,
    });
    const longStroke = planStudioDynamicBrushRenderBudget({
      settings: dynamics,
      dabCount: 900,
      symmetryCount: 1,
      markBudget: STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET,
    });

    expect(pointerDown.stampGrid).toBe(STUDIO_DYNAMIC_BRUSH_RENDER_STAMP_GRIDS[0]);
    expect(pointerDown.estimatedMarks).toBeLessThanOrEqual(
      STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET,
    );
    expect(longStroke.estimatedUnbudgetedMarks).toBeGreaterThan(
      STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET,
    );
    expect(longStroke.stampGrid).toBeLessThan(pointerDown.stampGrid);
    expect(longStroke.capped).toBe(true);

    const causalPointerDown = planStudioDynamicBrushRenderBudget({
      settings: authoredDynamics,
      dabCount: 1,
      symmetryCount: 1,
      markBudget: STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET,
    });
    const causalLongStroke = planStudioDynamicBrushRenderBudget({
      settings: authoredDynamics,
      dabCount: 900,
      symmetryCount: 1,
      markBudget: STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET,
    });
    expect(causalPointerDown.stampGrid).toBe(STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID);
    expect(causalLongStroke.stampGrid).toBe(STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID);
  });

  it.each(["pencil-4b-rough", "g-pen-flex"] as const)(
    "keeps causal %s marks identical through live drawing, pointer-up and retained replay",
    (catalogId) => {
      const { activeCanvas, renderer, settledCanvas } = attachedRenderer();
      const selection = materializeStudioBrushPackSelection(catalogId);
      if (!selection) throw new Error(`missing ${catalogId} selection`);
      const element = drawElement(
        `causal-${catalogId}`,
        [12, 30, 25, 31, 40, 35, 58, 43, 79, 50, 103, 47, 128, 37, 154, 25],
        {
          brush: selection.runtimeBrushId,
          brushCatalogId: selection.catalogId,
          brushDynamics: selection.brushDynamics,
          strokeWidth: selection.defaultWidth,
          opacity: selection.defaultOpacity,
        },
      );

      expect(renderer.begin(element).status).toBe("started");
      const appended = renderer.appendFrom(element);
      expect(operationResultLabel(appended))
        .toBe("appended");
      const liveMarks = structuredClone(activeCanvas.recordedMarks);
      expect(liveMarks.length).toBeGreaterThan(4);

      const sealed = renderer.end(element);
      expect(sealed.status).toBe("settled");
      if (sealed.status !== "settled") return;
      expect(sealed.markCount).toBe(liveMarks.length);
      expect(settledCanvas.recordedComposites).toEqual([{
        opacity: element.opacity,
        marks: liveMarks,
      }]);

      renderer.setSurface({ ...SURFACE, left: 2 });
      expect(settledCanvas.recordedComposites).toEqual([{
        opacity: element.opacity,
        marks: liveMarks,
      }]);
    },
  );

  it("plans kit-owned catalog brushes through kit dabs on the live overlay, not causal stations", () => {
    const ownedId = STUDIO_WEB_DRAWING_KIT_OWNED_BRUSH_IDS[0];
    expect(ownedId).toBeDefined();
    expect(studioWebDrawingKitOwnsStrokeGeometry(ownedId)).toBe(true);
    const catalog = studioBrushDynamicsSettingsForBrushId(ownedId!);
    expect(catalog).not.toBeNull();
    // Catalogue snapshots are causal-v3. The live overlay must still skip that branch.
    expect(isStudioDynamicBrushCausalDepositPipeline(catalog!.depositPipeline)).toBe(true);

    const points = [12, 30, 25, 31, 40, 35, 58, 43, 79, 50, 103, 47];
    const { activeCanvas, renderer } = attachedRenderer();
    const element = drawElement("live-kit-owned", points, {
      brush: ownedId,
      brushDynamics: catalog!,
      strokeWidth: 10,
      opacity: 1,
    });

    const started = renderer.begin(element);
    expect(operationResultLabel(started)).toBe("started");
    const appended = renderer.appendFrom(element);
    expect(operationResultLabel(appended))
      .toBe("appended");
    expect(activeCanvas.recordedMarks.length).toBeGreaterThan(0);

    const seed = studioBrushDynamicsSeedFromKey(`${element.id}:${catalog!.seed}`);
    const dynamics = normalizeStudioBrushDynamicsSettings({
      ...catalog!,
      seed,
      width: { ...catalog!.width, base: Math.max(1, element.strokeWidth) },
    });
    const liveCap = recommendStudioWebDrawingLiveMaxDabs({
      brushId: ownedId,
      points: element.points,
      pressures: element.pressures,
      baseWidth: Math.max(1, element.strokeWidth),
      seed,
      markBudget: STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET,
    }).maxDabs;
    const kitDabs = planStudioWebDrawingKitOwnedDabs(
      {
        brushId: ownedId,
        points: element.points,
        pressures: element.pressures,
        baseWidth: Math.max(1, element.strokeWidth),
        baseOpacity: dynamics.opacity.base,
        seed,
        maxDabs: liveCap,
      },
      dynamics,
    );
    expect(kitDabs).not.toBeNull();
    expect(kitDabs!.length).toBeGreaterThan(0);

    const causal = planStudioCausalDynamicBrushDepositSegmentsV3({
      points: element.points,
      pressures: element.pressures,
      tangentialPressures: element.tangentialPressures,
      speeds: element.speeds,
      tiltXs: element.tiltXs,
      tiltYs: element.tiltYs,
      twists: element.twists,
      settings: dynamics,
    });
    expect(causal.ok).toBe(true);
    const causalDabs = causal.ok && "segments" in causal
      ? causal.segments.flatMap((segment) => segment.dabs)
      : [];
    expect(causalDabs.length).toBeGreaterThan(0);
    expect(
      kitDabs!.map((dab) => ({ x: dab.x, y: dab.y })),
    ).not.toEqual(
      causalDabs.slice(0, kitDabs!.length).map((dab) => ({ x: dab.x, y: dab.y })),
    );

    const liveMarks = activeCanvas.recordedMarks;
    expect(liveMarks.some((mark) => kitDabs!.some((dab) => (
      Math.hypot(mark.x - dab.x, mark.y - dab.y) <= Math.max(dab.size, 8)
    )))).toBe(true);
    const nearerToKit = liveMarks.filter((mark) => {
      const kitDist = Math.min(
        ...kitDabs!.map((dab) => Math.hypot(mark.x - dab.x, mark.y - dab.y)),
      );
      const causalDist = Math.min(
        ...causalDabs.map((dab) => Math.hypot(mark.x - dab.x, mark.y - dab.y)),
      );
      return kitDist <= causalDist;
    });
    expect(nearerToKit.length).toBeGreaterThan(liveMarks.length / 2);

    const sealed = renderer.end(element);
    expect(operationResultLabel(sealed)).toBe("settled");
  });

  it("keeps a long causal G-pen on the append-only surface beyond the old 1,024-dab ceiling", () => {
    const { activeCanvas, renderer, settledCanvas } = attachedRenderer();
    const selection = materializeStudioBrushPackSelection("g-pen-flex");
    if (!selection) throw new Error("missing g-pen-flex selection");
    const points = Array.from({ length: 1_300 }, (_, index) => [
      8 + index * 1.4,
      52 + Math.sin(index / 19) * 12,
    ]).flat();
    const element = drawElement("long-causal-gpen", points, {
      brush: selection.runtimeBrushId,
      brushDynamics: selection.brushDynamics,
      strokeWidth: selection.defaultWidth,
      opacity: selection.defaultOpacity,
    });

    expect(renderer.begin(element).status).toBe("started");
    const appended = renderer.appendFrom(element);
    expect(operationResultLabel(appended))
      .toBe("appended");
    expect(activeCanvas.recordedMarks.length).toBeGreaterThan(1_024);
    const acceptedLiveMarks = structuredClone(activeCanvas.recordedMarks);
    const sealed = renderer.end(element);
    expect(sealed).toMatchObject({
      status: "settled",
      markCount: acceptedLiveMarks.length,
    });
    expect(settledCanvas.recordedComposites).toEqual([{
      opacity: element.opacity,
      marks: acceptedLiveMarks,
    }]);
    expect(renderer.lastOperationFailureReason).toBeNull();
  });

  it("streams v3 beyond 65,536 dabs, seals one opacity composite and releases it atomically", () => {
    const { activeCanvas, renderer, settledCanvas } = attachedRenderer();
    const points = segmentedCausalOverlayRoute();
    const pointCount = points.length / 2;
    const brushDynamics = segmentedCausalOverlayDynamics();
    const element = drawElement("causal-v3-segmented-live", points, {
      brush: "ink-particle",
      brushDynamics,
      strokeWidth: 2,
      opacity: 0.37,
      pressures: Array.from({ length: pointCount }, () => 0.72),
      tangentialPressures: Array.from({ length: pointCount }, () => 0),
      speeds: Array.from({ length: pointCount }, () => 0.35),
      tiltXs: Array.from({ length: pointCount }, () => 0),
      tiltYs: Array.from({ length: pointCount }, () => 0),
      twists: Array.from({ length: pointCount }, () => 0),
    });
    const budget = planStudioDynamicBrushRenderBudget({
      settings: brushDynamics,
      dabCount: STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_DABS + 1,
      symmetryCount: 1,
      markBudget: STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
    });
    expect(budget).toMatchObject({
      maxDabsPerVariation: STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_DABS + 1,
      dabCapped: false,
    });

    expect(renderer.begin(element)).toMatchObject({
      status: "started",
      dabCount: 1,
    });
    const appended = renderer.appendFrom(element);
    expect(appended.status).toBe("appended");
    if (appended.status !== "appended") return;
    expect(appended.appendedDabs).toBeGreaterThan(
      STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_DABS,
    );
    expect(activeCanvas.recordedMarks.length).toBe(appended.appendedDabs);
    expect(renderer.lastOperationFailureReason).toBeNull();

    const selectedIndexes = [
      0,
      127,
      STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_DABS - 1,
      STUDIO_CAUSAL_DYNAMIC_BRUSH_MAX_DABS,
      activeCanvas.recordedMarks.length - 1,
    ];
    const acceptedPrefixAndBoundary = selectedIndexes.map(
      (index) => structuredClone(activeCanvas.recordedMarks[index]!),
    );
    expect(acceptedPrefixAndBoundary.every(Boolean)).toBe(true);

    const sealed = renderer.end(element);
    expect(sealed).toMatchObject({
      status: "settled",
      dabCount: appended.appendedDabs,
      markCount: appended.appendedDabs,
    });
    expect(renderer.settledStrokeCount).toBe(1);
    expect(settledCanvas.recordedComposites).toHaveLength(1);
    expect(settledCanvas.recordedComposites[0]!.opacity).toBe(element.opacity);
    expect(settledCanvas.recordedComposites[0]!.marks.length).toBe(
      appended.appendedDabs,
    );
    expect(selectedIndexes.map(
      (index) => settledCanvas.recordedComposites[0]!.marks[index],
    )).toEqual(acceptedPrefixAndBoundary);

    renderer.setSurface({ ...SURFACE, left: 2 });
    expect(renderer.settledStrokeCount).toBe(1);
    expect(settledCanvas.recordedComposites).toHaveLength(1);
    expect(settledCanvas.recordedComposites[0]!.opacity).toBe(element.opacity);
    expect(selectedIndexes.map(
      (index) => settledCanvas.recordedComposites[0]!.marks[index],
    )).toEqual(acceptedPrefixAndBoundary);

    // One logical DrawEl remains one settled FIFO receipt, so Undo/release cannot leave a tail
    // segment behind even though the material planner crossed its historical segment boundary.
    expect(renderer.releaseSettledPrefix(1)).toBe(1);
    expect(renderer.settledStrokeCount).toBe(0);
    expect(settledCanvas.recordedComposites).toEqual([]);
  }, 30_000);

  it("keeps the global 64-way three-tip accepted prefix authoritative across zero-alpha batches", () => {
    const { activeCanvas, renderer, settledCanvas } = attachedRenderer();
    const tip = { shape: "round" as const, softness: 0 };
    const brushDynamics = normalizeStudioBrushDynamicsSettings({
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
      width: { base: 8, mappings: [] },
      opacity: {
        base: 1,
        mappings: [{ source: "pressure", from: 0, to: 1 }],
      },
      flow: { base: 1, mappings: [] },
      spacingRatio: null,
      spacing: { base: 0.25, mappings: [] },
      scatterRatio: null,
      scatter: { base: 0, mappings: [] },
      roundness: { base: 1, mappings: [] },
      tip,
      tipLayers: [
        { tip, opacity: 1 },
        { tip, opacity: 0.5 },
      ],
      grain: { amount: 0 },
      taper: { enabled: false },
    });
    const pointPairs = Array.from({ length: 360 }, (_, index) => [
      20 + index * 0.25,
      80,
    ]);
    const pressures = pointPairs.map((_, index) => (
      index === 0 || index >= 350 ? 1 : 0
    ));
    const elementAt = (count: number) => drawElement(
      "causal-zero-alpha-prefix",
      pointPairs.slice(0, count).flat(),
      {
        brush: "ink-particle",
        brushDynamics,
        strokeWidth: 8,
        opacity: 0.42,
        pressures: pressures.slice(0, count),
        symmetry: {
          type: "kaleidoscope",
          centerX: 60,
          centerY: 80,
          // 32 radial sectors × mirrored family = 64 affine copies.
          radialCount: 32,
        },
      },
    );

    const firstBatch = elementAt(200);
    const begun = renderer.begin(firstBatch);
    expect(operationResultLabel(begun)).toBe("started");
    if (begun.status !== "started") return;
    expect(begun.markCount).toBe(64 * 3);
    expect(activeCanvas.recordedMarks).toHaveLength(64 * 3);
    expect(renderer.appendFrom(firstBatch).status).toBe("appended");
    const visiblePrefix = structuredClone(activeCanvas.recordedMarks);
    expect(visiblePrefix).toHaveLength(64 * 3);

    const complete = elementAt(360);
    const appended = renderer.appendFrom(complete);
    expect(appended.status).toBe("appended");
    if (appended.status !== "appended" && appended.status !== "noop") return;
    expect(appended.acceptedPrefixReceipt).toMatchObject({
      policy: "accepted-prefix-v1",
      acceptedDabsPerVariation: Math.floor(
        STUDIO_DYNAMIC_BRUSH_CAUSAL_MARK_BUDGET / (64 * 3),
      ),
      marksPerDab: 3,
      symmetryCount: 64,
    });
    // Zero-alpha dabs still own causal prefix slots. The late visible suffix cannot borrow their
    // unused mark storage and then disappear when pointer-up replay applies the global ceiling.
    expect(activeCanvas.recordedMarks).toEqual(visiblePrefix);
    expect(renderer.lastOperationFailureReason).toBeNull();

    const sealed = renderer.end(complete);
    expect(sealed.status).toBe("settled");
    if (sealed.status !== "settled") return;
    expect(sealed.acceptedPrefixReceipt).toEqual(
      appended.acceptedPrefixReceipt,
    );
    expect(sealed.markCount).toBe(visiblePrefix.length);
    expect(settledCanvas.recordedComposites).toEqual([{
      opacity: complete.opacity,
      marks: visiblePrefix,
    }]);

    renderer.setSurface({ ...SURFACE, left: 2 });
    expect(settledCanvas.recordedComposites).toEqual([{
      opacity: complete.opacity,
      marks: visiblePrefix,
    }]);
  });

  it("streams every authored brush pack from only the prior sample plus unseen suffix", () => {
    expect(STUDIO_BRUSH_PACK_DESCRIPTORS).toHaveLength(160);
    let dryMediaCount = 0;
    const prefixPointCount = 24;
    const completePointCount = 48;
    const completePoints = Array.from(
      { length: completePointCount },
      (_, index) => [8 + index * 4, 20 + Math.sin(index / 4) * 3],
    ).flat();
    const prefixPoints = completePoints.slice(0, prefixPointCount * 2);
    const firstReadableCoordinate = (prefixPointCount - 1) * 2;
    const expectedReads = Array.from(
      {
        length:
          2 + (completePointCount - prefixPointCount) * 2,
      },
      (_, index) => firstReadableCoordinate + index,
    );
    const wholePrefixRibbonIds = new Set([
      "oil-filbert",
      "bristle-round-loaded",
      "bristle-fan-dry",
      "bristle-flat-streak",
      "palette-knife-edge",
    ]);

    for (const descriptor of STUDIO_BRUSH_PACK_DESCRIPTORS) {
      if (descriptor.runtimeBrushId === "dry-media") dryMediaCount += 1;
      const selection = materializeStudioBrushPackSelection(descriptor.catalogId);
      if (!selection) throw new Error(`missing ${descriptor.catalogId} selection`);
      expect(
        selection.brushDynamics.depositPipeline,
        `${descriptor.catalogId}: authored pipeline`,
      ).toBe(STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3);

      const { activeCanvas, renderer, settledCanvas } = attachedRenderer();
      const id = `stream-${descriptor.catalogId}`;
      const prefix = drawElement(id, prefixPoints, {
        brush: selection.runtimeBrushId,
        brushCatalogId: selection.catalogId,
        brushDynamics: selection.brushDynamics,
        strokeWidth: selection.defaultWidth,
        opacity: selection.defaultOpacity,
      });
      expect(renderer.begin(prefix).status, `${descriptor.catalogId}: begin`)
        .toBe("started");
      const prefixResult = renderer.appendFrom(prefix);
      expect(prefixResult.status, `${descriptor.catalogId}: prefix`)
        .not.toBe("unavailable");
      expect(prefixResult.status, `${descriptor.catalogId}: prefix rejected`)
        .not.toBe("rejected");
      const clearsAfterPrefix = activeCanvas.clearCount();
      const numericReads: number[] = [];
      const points = new Proxy(
        completePoints,
        {
          get(target, property, receiver) {
            if (typeof property === "string" && /^\d+$/.test(property)) {
              numericReads.push(Number(property));
            }
            return Reflect.get(target, property, receiver);
          },
        },
      );
      const extended = drawElement(id, points, {
        brush: selection.runtimeBrushId,
        brushCatalogId: selection.catalogId,
        brushDynamics: selection.brushDynamics,
        strokeWidth: selection.defaultWidth,
        opacity: selection.defaultOpacity,
        points,
      });
      numericReads.length = 0;

      const result = renderer.appendFrom(extended);
      expect(result.status, `${descriptor.catalogId}: suffix`)
        .not.toBe("unavailable");
      expect(result.status, `${descriptor.catalogId}: suffix rejected`)
        .not.toBe("rejected");
      if (wholePrefixRibbonIds.has(descriptor.catalogId)) {
        expect(
          activeCanvas.clearCount(),
          `${descriptor.catalogId}: whole-prefix rebuild surface`,
        ).toBeGreaterThan(clearsAfterPrefix);
      } else {
        expect(
          activeCanvas.clearCount(),
          `${descriptor.catalogId}: append-only surface`,
        ).toBe(clearsAfterPrefix);
      }
      expect(
        numericReads,
        `${descriptor.catalogId}: O(suffix) point reads`,
      ).toEqual(expectedReads);
      const liveMarks = structuredClone(activeCanvas.recordedMarks);
      const sealed = renderer.end(extended);
      expect(sealed.status, `${descriptor.catalogId}: pointer-up`)
        .toBe("settled");
      expect(
        settledCanvas.recordedComposites[0]?.marks,
        `${descriptor.catalogId}: live/retained parity`,
      ).toEqual(liveMarks);
    }

    expect(dryMediaCount).toBe(61);
  });

  it("uses the same one-mark analytic soft tip during live drawing, seal and replay", () => {
    const { activeCanvas, renderer, settledCanvas } = attachedRenderer();
    const selection = materializeStudioBrushPackSelection("airbrush-grand-soft");
    if (!selection) throw new Error("missing airbrush-grand-soft selection");
    const element = drawElement(
      "analytic-soft",
      [10, 24, 28, 26, 48, 31, 70, 38],
      {
        brush: selection.runtimeBrushId,
        brushDynamics: selection.brushDynamics,
      },
    );

    const begun = renderer.begin(element);
    expect(operationResultLabel(begun)).toBe("started");
    expect(renderer.appendFrom(element).status).toBe("appended");
    expect(activeCanvas.radialGradientCount()).toBe(0);
    expect(activeCanvas.recordedMarks.length).toBeGreaterThan(0);
    const sealed = renderer.end(element);
    expect(sealed.status).toBe("settled");
    if (sealed.status !== "settled") return;
    expect(sealed.markCount).toBe(sealed.dabCount);
    expect(settledCanvas.recordedComposites).toHaveLength(1);
    expect(settledCanvas.recordedComposites[0]!.marks).toHaveLength(
      sealed.markCount,
    );

    renderer.setSurface({ ...SURFACE, left: 2 });
    expect(activeCanvas.radialGradientCount()).toBe(0);
    expect(settledCanvas.recordedComposites[0]!.marks).toHaveLength(
      sealed.markCount,
    );
  });

  it("admits only the explicit bounded-flow dynamic freehand contract", () => {
    const supported = drawElement("supported", [10, 10]);
    expect(studioLiveDynamicBrushOverlaySupportsElement(supported)).toBe(true);
    expect(studioLiveDynamicBrushOverlaySupportsElement({
      ...supported,
      paintModel: undefined,
    })).toBe(false);
    expect(studioLiveDynamicBrushOverlaySupportsElement({
      ...supported,
      mode: "eraser",
    })).toBe(false);
  });

  it("reads only the unseen source suffix while canonical legacy replay never rereads it", () => {
    const { activeCanvas, renderer } = attachedRenderer();
    const dynamics = complexDynamics();
    const prefix = drawElement("suffix", [10, 20, 22, 21, 38, 25], { brushDynamics: dynamics });
    expect(renderer.begin(prefix).status).toBe("started");
    expect(renderer.appendFrom(prefix).status).toBe("appended");
    const clearsAfterPrefix = activeCanvas.clearCount();
    const numericReads: number[] = [];
    const points = new Proxy(
      [10, 20, 22, 21, 38, 25, 56, 31, 76, 39],
      {
        get(target, property, receiver) {
          if (typeof property === "string" && /^\d+$/.test(property)) {
            numericReads.push(Number(property));
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const extended = drawElement("suffix", points, {
      brushDynamics: dynamics,
      points,
    });
    numericReads.length = 0;

    expect(renderer.appendFrom(extended).status).toBe("appended");
    // Suffix-only live paint keeps already-accepted pixels. A whole-prefix clear here is a long task.
    expect(activeCanvas.clearCount()).toBe(clearsAfterPrefix);
    expect(Math.min(...numericReads)).toBe(4);
    numericReads.length = 0;
    const clearsAfterExtension = activeCanvas.clearCount();
    expect(renderer.appendFrom(extended).status).toBe("noop");
    expect(numericReads).toEqual([]);
    expect(activeCanvas.clearCount()).toBe(clearsAfterExtension);
  });

  it.each([
    "dry-media",
    "crayon",
    "chalk",
    "charcoal",
    "pastel",
    "oil-pastel",
  ] as const)(
    "keeps fast long %s live texture marks byte-identical to pointer-up",
    (brushId) => {
      const { activeCanvas, renderer, settledCanvas } = attachedRenderer();
      const brushDynamics = studioBrushDynamicsSettingsForBrushId(brushId);
      if (!brushDynamics) throw new Error(`missing ${brushId} dynamics`);
      const pointPairs = Array.from({ length: 180 }, (_, index) => [
        8 + index * 9,
        72 + Math.sin(index / 7) * 5,
      ]);
      const points = pointPairs.flat();
      const element = drawElement(`fast-long-${brushId}`, points, {
        brush: brushId,
        brushDynamics,
        strokeWidth: brushDynamics.width.base,
        pressures: Array.from({ length: pointPairs.length }, () => 0.72),
        speeds: Array.from({ length: pointPairs.length }, () => 12),
        tiltXs: Array.from({ length: pointPairs.length }, () => 18),
        tiltYs: Array.from({ length: pointPairs.length }, () => -9),
      });

      expect(renderer.begin(element).status).toBe("started");
      const appended = renderer.appendFrom(element);
      expect(operationResultLabel(appended))
        .toBe("appended");
      const liveMarks = structuredClone(activeCanvas.recordedMarks);
      if (brushId === "dry-media") {
        expect(liveMarks.length).toBeGreaterThan(100);
        // Start/end taper intentionally thins the terminal footprint. Audit the stable body where
        // a fast delivery must not expose a pointer-sample-sized hole.
        const startX = pointPairs[0]![0] + brushDynamics.width.base * 2;
        const endX = pointPairs.at(-1)![0] - brushDynamics.width.base * 2;
        const maximumGap = maximumLongitudinalCoverageGap(
          liveMarks,
          startX,
          endX,
        );
        expect(maximumGap).toBeLessThan(brushDynamics.width.base * 1.1);
      } else {
        // T1 kernel dab path: fresh unpinned core dry media renders per-fibre textured marks and
        // never paints a union polygon command. Coverage must stay continuous through the body.
        expect(liveMarks.length).toBeGreaterThan(pointPairs.length);
        expect(
          liveMarks.every((mark) => mark.unionGeometry === undefined),
        ).toBe(true);
        const startX = pointPairs[0]![0] + brushDynamics.width.base * 2;
        const endX = pointPairs.at(-1)![0] - brushDynamics.width.base * 2;
        const maximumGap = maximumLongitudinalCoverageGap(
          liveMarks,
          startX,
          endX,
        );
        expect(maximumGap).toBeLessThan(brushDynamics.width.base * 1.1);
      }

      const liveRoundMarks = liveMarks.filter((mark) =>
        Math.abs(mark.radiusX - mark.radiusY) <= 1e-9
      ).length;
      const sealed = renderer.end(element);
      expect(sealed.status).toBe("settled");
      if (sealed.status !== "settled") return;
      const retainedMarks = settledCanvas.recordedComposites[0]!.marks;
      const retainedRoundMarks = retainedMarks.filter((mark) =>
        Math.abs(mark.radiusX - mark.radiusY) <= 1e-9
      ).length;
      expect(retainedMarks).toEqual(liveMarks);
      expect(retainedMarks[0]?.unionGeometry?.byteLength).toBe(
        liveMarks[0]?.unionGeometry?.byteLength,
      );
      expect(retainedMarks[0]?.unionGeometry?.sha256).toBe(
        liveMarks[0]?.unionGeometry?.sha256,
      );
      expect(retainedRoundMarks).toBe(liveRoundMarks);
      expect(sealed.markCount).toBe(liveMarks.length);
    },
  );

  it("streams and seals every core wet preset with identical live and retained marks", () => {
    const wetBrushIds = [
      "watercolor",
      "ink-wash",
      "inkwash-pen",
      "inkwash-water-brush",
      "inkwash-bleed-wash",
      "inkwash-white-ink",
    ] as const;
    const pointPairs = Array.from({ length: 72 }, (_, index) => [
      12 + index * 4,
      70 + Math.sin(index / 7) * 9,
    ]);

    for (const brushId of wetBrushIds) {
      const preset = BRUSH_PRESETS.find((candidate) => candidate.id === brushId);
      if (!preset) throw new Error(`missing ${brushId} preset`);
      const selection = studioCoreBrushCatalogSelection(preset);
      if (!selection.brushDynamics) throw new Error(`missing ${brushId} dynamics`);
      const { activeCanvas, renderer, settledCanvas } = attachedRenderer();
      const element = drawElement(`core-wet-${brushId}`, pointPairs.flat(), {
        brush: selection.runtimeBrushId,
        brushCatalogId: selection.catalogId,
        brushDynamics: selection.brushDynamics,
        strokeWidth: selection.defaultWidth,
        opacity: selection.defaultOpacity,
      });

      expect(studioLiveDynamicBrushOverlaySupportsElement(element), `${brushId}: route`)
        .toBe(true);
      expect(renderer.begin(element).status, `${brushId}: begin`).toBe("started");
      expect(renderer.appendFrom(element).status, `${brushId}: append`).toBe("appended");
      const liveMarks = structuredClone(activeCanvas.recordedMarks);
      const clearsBeforeEnd = activeCanvas.clearCount();
      const sealed = renderer.end(element);

      expect(sealed.status, `${brushId}: end`).toBe("settled");
      expect(activeCanvas.clearCount(), `${brushId}: no pointer-up repaint`)
        .toBe(clearsBeforeEnd + 1);
      expect(settledCanvas.recordedComposites[0]?.marks, `${brushId}: live/final parity`)
        .toEqual(liveMarks);
    }
  });

  it("rebuilds release-corrected first points with corrected stroke-fixed paper origins", () => {
    const preset = BRUSH_PRESETS.find((candidate) => candidate.id === "ink-wash");
    if (!preset) throw new Error("missing ink-wash preset");
    const selection = studioCoreBrushCatalogSelection(preset);
    if (!selection.brushDynamics) throw new Error("missing ink-wash dynamics");
    const original = drawElement(
      "corrected-origin",
      [18, 28, 42, 33, 68, 41, 94, 52],
      {
        brush: selection.runtimeBrushId,
        brushCatalogId: selection.catalogId,
        brushDynamics: selection.brushDynamics,
      },
    );
    const corrected = {
      ...original,
      points: [24, 34, ...original.points.slice(2)],
    };
    const correctedLive = attachedRenderer();
    expect(correctedLive.renderer.begin(original).status).toBe("started");
    expect(correctedLive.renderer.appendFrom(original).status).toBe("appended");
    expect(correctedLive.renderer.end(corrected).status).toBe("settled");

    const reference = attachedRenderer();
    expect(reference.renderer.begin(corrected).status).toBe("started");
    expect(reference.renderer.end(corrected).status).toBe("settled");
    expect(correctedLive.settledCanvas.recordedComposites)
      .toEqual(reference.settledCanvas.recordedComposites);
  });

  it.each([
    "crayon",
    "chalk",
    "charcoal",
    "pastel",
    "oil-pastel",
  ] as const)(
    "replaces every accepted PINNED %s crossing prefix with the canonical one-fill union",
    (brushId) => {
      const authoredDynamics = studioBrushDynamicsSettingsForBrushId(brushId);
      if (!authoredDynamics) throw new Error(`missing ${brushId} dynamics`);
      // The union carrier is now a pinned legacy-replay authority; fresh strokes take the
      // kernel dab path (covered by the dedicated O(1) append test below).
      const brushDynamics = normalizeStudioBrushDynamicsSettings({
        ...authoredDynamics,
        dryMediaUnionProgram: studioDryMediaUnionComposableProgramPin(),
      });
      const anchors = [
        [18, 30],
        [210, 130],
        [18, 30],
        [210, 30],
        [18, 130],
      ] as const;
      const pointPairs = anchors.slice(0, -1).flatMap((start, segmentIndex) => {
        const end = anchors[segmentIndex + 1]!;
        return Array.from({ length: 24 }, (_, step) => {
          const amount = step / 24;
          return [
            start[0] + (end[0] - start[0]) * amount,
            start[1] + (end[1] - start[1]) * amount,
          ] as const;
        });
      });
      const live = attachedRenderer();
      const elementAt = (count: number) => {
        const points = pointPairs.slice(0, count).flat();
        return drawElement(`${brushId}-union-prefix`, points, {
          brush: brushId,
          brushDynamics,
          strokeWidth: brushDynamics.width.base,
          pressures: Array.from({ length: count }, () => 0.68),
          speeds: Array.from({ length: count }, () => 9),
          tiltXs: Array.from({ length: count }, () => 12),
          tiltYs: Array.from({ length: count }, () => -6),
        });
      };
      expect(live.renderer.begin(elementAt(1)).status).toBe("started");
      let appendedFills = 0;
      let activeClearsAfterFirstMove: number | null = null;
      for (const count of [12, 37, 68, 96]) {
        const prefix = elementAt(count);
        const presentationClearsBefore = live.presentationCanvas.clearCount();
        const presentationCopiesBefore =
          live.presentationCanvas.recordedCopies.length;
        const appended = live.renderer.appendFrom(prefix);
        expect(appended.status, `${brushId}: append ${count}`).toBe("appended");
        if (appended.status !== "appended") continue;
        appendedFills += 1;
        expect(appended.appendedMarks).toBe(1);
        expect(live.presentationCanvas.clearCount()).toBeGreaterThan(
          presentationClearsBefore,
        );
        expect(live.presentationCanvas.recordedCopies).toHaveLength(
          presentationCopiesBefore + 1,
        );
        const dirtyCopy = live.presentationCanvas.recordedCopies.at(-1)!;
        expect(dirtyCopy.sourceRect).toEqual(dirtyCopy.destinationRect);
        expect(dirtyCopy.sourceRect[2]).toBeGreaterThan(0);
        expect(dirtyCopy.sourceRect[3]).toBeGreaterThan(0);
        // O(1) append contract: after the tap-replacing first movement frame the accumulator
        // never clears or repaints the cumulative union; each pointer frame adds exactly one
        // suffix fill to the active surface.
        if (activeClearsAfterFirstMove === null) {
          activeClearsAfterFirstMove = live.activeCanvas.clearCount();
        } else {
          expect(
            live.activeCanvas.clearCount(),
            `${brushId}: no cumulative redraw at ${count}`,
          ).toBe(activeClearsAfterFirstMove);
        }

        const liveMarks = structuredClone(live.activeCanvas.recordedMarks);
        expect(liveMarks, `${brushId}: one fill per append at ${count}`)
          .toHaveLength(appendedFills);

        const reference = attachedRenderer();
        expect(reference.renderer.begin(prefix).status).toBe("started");
        const sealed = reference.renderer.end(prefix);
        expect(sealed.status).toBe("settled");
        if (sealed.status !== "settled") return;
        expect(sealed.markCount).toBe(1);
        // Mid-contact vs pointer-up semantic parity. The incremental accumulator legitimately
        // splits the union across one fill command per pointer frame, so byte-comparing command
        // lists would be false strictness. The truthful strongest assertion: every live fill
        // carries the same colour and stroke-local alpha as the canonical union, and the
        // order-preserving concatenation of the live suffix geometry streams is coordinate- and
        // hash-identical to the one-fill union pointer-up composites.
        const referenceMarks = reference.settledCanvas.recordedComposites[0]!.marks;
        expect(referenceMarks, `${brushId}: canonical one-fill union at ${count}`)
          .toHaveLength(1);
        const referenceUnion = referenceMarks[0]!;
        expect(referenceUnion.unionGeometry).toBeDefined();
        for (const fill of liveMarks) {
          expect(fill.unionGeometry, `${brushId}: live union fill at ${count}`)
            .toBeDefined();
          expect(fill.color).toBe(referenceUnion.color);
          expect(fill.alpha).toBe(referenceUnion.alpha);
        }
        const concatenated = liveMarks.flatMap(
          (fill) => fill.unionGeometry!.coordinates,
        );
        expect(
          concatenated.length,
          `${brushId}: concatenated live geometry at ${count}`,
        ).toBe(referenceUnion.unionGeometry!.coordinateCount);
        expect(
          sha256HexPortable(new TextEncoder().encode(concatenated.join(","))),
          `${brushId}: mid-contact/pointer-up geometry parity at ${count}`,
        ).toBe(referenceUnion.unionGeometry!.sha256);
      }

      const complete = elementAt(96);
      const settled = live.renderer.end(complete);
      expect(settled.status).toBe("settled");
      expect(live.settledCanvas.recordedComposites[0]?.marks).toHaveLength(4);
    },
  );

  it.each([
    "crayon",
    "chalk",
    "charcoal",
    "pastel",
    "oil-pastel",
  ] as const)(
    "appends fresh unpinned %s strokes O(1) per frame with no union accumulator",
    (brushId) => {
      const brushDynamics = studioBrushDynamicsSettingsForBrushId(brushId);
      if (!brushDynamics) throw new Error(`missing ${brushId} dynamics`);
      expect(brushDynamics.dryMediaUnionProgram).toBeUndefined();
      const pointPairs = Array.from({ length: 96 }, (_, index) => [
        14 + index * 5,
        66 + Math.sin(index / 6) * 8,
      ]);
      const live = attachedRenderer();
      const elementAt = (count: number) =>
        drawElement(
          `${brushId}-kernel-o1`,
          pointPairs.slice(0, count).flat(),
          {
            brush: brushId,
            brushDynamics,
            strokeWidth: brushDynamics.width.base,
            pressures: Array.from({ length: count }, () => 0.68),
            speeds: Array.from({ length: count }, () => 9),
            tiltXs: Array.from({ length: count }, () => 12),
            tiltYs: Array.from({ length: count }, () => -6),
          },
        );
      expect(live.renderer.begin(elementAt(1)).status).toBe("started");
      let clearsAfterFirstMove: number | null = null;
      let cumulativeMarks = 0;
      for (const count of [12, 37, 68, 96]) {
        const appended = live.renderer.appendFrom(elementAt(count));
        expect(appended.status, `${brushId}: append ${count}`).toBe("appended");
        if (appended.status !== "appended") continue;
        // O(1) per append: the causal kernel path paints only the new suffix marks. After the
        // tap-replacing first movement frame the active surface is never cleared or rebuilt, so
        // recorded mark count grows exactly by the appended amount — no cumulative union replay.
        if (clearsAfterFirstMove === null) {
          clearsAfterFirstMove = live.activeCanvas.clearCount();
          cumulativeMarks = live.activeCanvas.recordedMarks.length;
        } else {
          expect(
            live.activeCanvas.clearCount(),
            `${brushId}: no cumulative redraw at ${count}`,
          ).toBe(clearsAfterFirstMove);
          expect(
            live.activeCanvas.recordedMarks.length,
            `${brushId}: additive marks at ${count}`,
          ).toBe(cumulativeMarks + appended.appendedMarks);
          cumulativeMarks += appended.appendedMarks;
        }
        expect(appended.appendedMarks).toBeGreaterThan(0);
      }
      // No union accumulator involvement: not a single fill carries union polygon geometry.
      expect(
        live.activeCanvas.recordedMarks.every(
          (mark) => mark.unionGeometry === undefined,
        ),
        brushId,
      ).toBe(true);

      const complete = elementAt(96);
      const liveMarks = structuredClone(live.activeCanvas.recordedMarks);
      const settled = live.renderer.end(complete);
      expect(settled.status).toBe("settled");
      if (settled.status !== "settled") return;
      // Live suffix appends and pointer-up replay agree byte-for-byte on the kernel path.
      expect(live.settledCanvas.recordedComposites[0]?.marks).toEqual(liveMarks);
      expect(settled.markCount).toBe(liveMarks.length);
    },
  );

  it("accumulates fractional-alpha union ribbon marks and replays them at live alpha", () => {
    // The shipped union carrier emits stroke-locally opaque masks (alpha 1) today, so this
    // contract is exercised directly: if a future carrier version ships flow-scaled unions
    // (0 < alpha < 1), the incremental accumulator must carry that alpha into every snapshot.
    // A snapshot that silently forced alpha back to 1 would make replay/settle composite darker
    // than the already-presented live suffix fills.
    const unionRibbonMark = (
      polygons: readonly (readonly number[])[],
      alpha: number,
    ): StudioDynamicBrushCoverageMark => ({
      x: 0,
      y: 0,
      radiusX: 1,
      radiusY: 1,
      angleRadians: 0,
      alpha,
      color: "#5a3c28",
      ribbon: {
        kind: "dry-media-union-ribbon-polygon",
        version: STUDIO_DRY_MEDIA_UNION_RIBBON_CARRIER_VERSION,
        role: "stroke-union",
        polygons,
      },
    });
    const initialPolygons = [[4, 4, 24, 6, 22, 16, 6, 14]] as const;
    const suffixPolygons = [[22, 6, 44, 10, 42, 20, 20, 16]] as const;
    const elementOpacityFlowAlpha = 0.72;

    const accumulator = createDryMediaUnionAccumulator([
      unionRibbonMark(initialPolygons, elementOpacityFlowAlpha),
    ]);
    expect(accumulator).not.toBeNull();
    if (!accumulator) return;
    const initialSnapshot = snapshotDryMediaUnionAccumulator(accumulator);
    expect(appendDryMediaUnionAccumulator(accumulator, [
      unionRibbonMark(suffixPolygons, elementOpacityFlowAlpha),
    ])).toBe(true);
    const settledSnapshot = snapshotDryMediaUnionAccumulator(accumulator);
    expect(settledSnapshot).toHaveLength(1);
    expect(settledSnapshot[0]!.alpha).toBe(elementOpacityFlowAlpha);
    expect(settledSnapshot[0]!.ribbon?.polygons).toEqual([
      ...initialPolygons,
      ...suffixPolygons,
    ]);

    // Live sequence = first-frame cumulative snapshot + one suffix fill; settle/replay rebuilds
    // the canonical snapshot once. Both must paint the same colour, the same fractional alpha and
    // the same total geometry stream.
    const liveCanvas = recordingCanvas();
    const liveContext = liveCanvas.getContext("2d")!;
    for (const mark of initialSnapshot) {
      renderStudioDynamicBrushCoverageMark(liveContext, mark);
    }
    renderStudioDynamicBrushCoverageMark(
      liveContext,
      unionRibbonMark(suffixPolygons, elementOpacityFlowAlpha),
    );
    const settledCanvas = recordingCanvas();
    const settledContext = settledCanvas.getContext("2d")!;
    for (const mark of settledSnapshot) {
      renderStudioDynamicBrushCoverageMark(settledContext, mark);
    }
    expect(liveCanvas.recordedMarks).toHaveLength(2);
    expect(settledCanvas.recordedMarks).toHaveLength(1);
    for (const fill of liveCanvas.recordedMarks) {
      expect(fill.alpha).toBe(elementOpacityFlowAlpha);
      expect(fill.color).toBe(settledCanvas.recordedMarks[0]!.color);
    }
    expect(settledCanvas.recordedMarks[0]!.alpha).toBe(elementOpacityFlowAlpha);
    expect(liveCanvas.recordedMarks.flatMap(
      (fill) => fill.unionGeometry!.coordinates,
    )).toEqual([...settledCanvas.recordedMarks[0]!.unionGeometry!.coordinates]);

    // Fail-closed gates: an invisible union is a planner contract violation, and a suffix that
    // mutates the stroke-local alpha must not be merged into an already-presented accumulator.
    expect(createDryMediaUnionAccumulator([
      unionRibbonMark(initialPolygons, 0),
    ])).toBeNull();
    expect(appendDryMediaUnionAccumulator(accumulator, [
      unionRibbonMark(suffixPolygons, 0.5),
    ])).toBe(false);
  });

  it.each([
    ["crayon", "crayon-wax-bold"],
    ["chalk", "chalk-rough"],
    ["charcoal", "velvet-charcoal"],
    ["pastel", "pastel-paper-soft"],
    ["oil-pastel", "oil-dry-scumble"],
  ] as const)(
    "keeps long %s texture stable at every live prefix and after seal",
    (_material, catalogId) => {
      const selection = materializeStudioBrushPackSelection(catalogId);
      if (!selection) throw new Error(`missing ${catalogId} selection`);
      expect(selection.runtimeBrushId).toBe("dry-media");
      expect(selection.brushDynamics.depositPipeline).toBe(
        STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
      );
      const pointPairs = Array.from({ length: 72 }, (_, index) => [
        6 + index * 7,
        78 + Math.sin(index / 5) * 7,
      ]);
      const live = attachedRenderer();
      const elementAt = (count: number) => {
        const points = pointPairs.slice(0, count).flat();
        return drawElement(`texture-prefix-${catalogId}`, points, {
          brush: selection.runtimeBrushId,
          brushCatalogId: selection.catalogId,
          brushDynamics: selection.brushDynamics,
          strokeWidth: selection.defaultWidth,
          opacity: selection.defaultOpacity,
          pressures: Array.from({ length: count }, () => 0.72),
          speeds: Array.from({ length: count }, () => 11),
          tiltXs: Array.from({ length: count }, () => 16),
          tiltYs: Array.from({ length: count }, () => -8),
        });
      };
      expect(live.renderer.begin(elementAt(1)).status).toBe("started");

      for (const count of [24, 48, 72]) {
        const prefix = elementAt(count);
        const appended = live.renderer.appendFrom(prefix);
        expect(
          operationResultLabel(appended),
          `${catalogId}: live prefix ${count}`,
        ).toBe("appended");
        const midContactMarks = structuredClone(live.activeCanvas.recordedMarks);
        expect(midContactMarks.length).toBeGreaterThan(0);
        expect(midContactMarks.length).toBeLessThanOrEqual(
          STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET,
        );
        const reference = attachedRenderer();
        expect(reference.renderer.begin(prefix).status).toBe("started");
        const sealedPrefix = reference.renderer.end(prefix);
        expect(sealedPrefix.status).toBe("settled");
        expect(
          reference.settledCanvas.recordedComposites[0]?.marks,
          `${catalogId}: mid-contact/pointer-up parity at ${count}`,
        ).toEqual(midContactMarks);
      }

      const complete = elementAt(72);
      const liveMarks = structuredClone(live.activeCanvas.recordedMarks);
      const liveRoundMarks = liveMarks.filter((mark) =>
        Math.abs(mark.radiusX - mark.radiusY) <= 1e-9
      ).length;
      const sealed = live.renderer.end(complete);
      expect(sealed.status).toBe("settled");
      if (sealed.status !== "settled") return;
      const retainedMarks = live.settledCanvas.recordedComposites[0]!.marks;
      expect(retainedMarks).toEqual(liveMarks);
      expect(retainedMarks.filter((mark) =>
        Math.abs(mark.radiusX - mark.radiusY) <= 1e-9
      )).toHaveLength(liveRoundMarks);
      expect(sealed.markCount).toBeLessThanOrEqual(
        STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET,
      );
    },
  );

  it("keeps 3,000-sample crayon live appends O(1) inside the 30ms main-thread CPU budget", () => {
    const selection = materializeStudioBrushPackSelection("crayon-wax-bold");
    if (!selection) throw new Error("missing crayon-wax-bold selection");
    const pointPairs = Array.from({ length: 3000 }, (_, index) => [
      10 + (index % 120) * 8 + Math.cos(index / 10) * 20,
      12 + Math.floor(index / 120) * 14 + Math.sin(index / 10) * 20,
    ]);
    const fullPoints = pointPairs.flat();
    const element = drawElement("crayon-3000-stress", fullPoints, {
      brush: selection.runtimeBrushId,
      brushCatalogId: selection.catalogId,
      brushDynamics: selection.brushDynamics,
      strokeWidth: selection.defaultWidth,
      opacity: selection.defaultOpacity,
      pressures: Array.from({ length: pointPairs.length }, () => 0.72),
      speeds: Array.from({ length: pointPairs.length }, () => 14),
      tiltXs: Array.from({ length: pointPairs.length }, () => 18),
      tiltYs: Array.from({ length: pointPairs.length }, () => -9),
    });

    const firstChunk = drawElement("crayon-3000-stress", fullPoints.slice(0, 60), {
      brush: selection.runtimeBrushId,
      brushCatalogId: selection.catalogId,
      brushDynamics: selection.brushDynamics,
      strokeWidth: selection.defaultWidth,
      opacity: selection.defaultOpacity,
      pressures: Array.from({ length: 30 }, () => 0.72),
      speeds: Array.from({ length: 30 }, () => 14),
      tiltXs: Array.from({ length: 30 }, () => 18),
      tiltYs: Array.from({ length: 30 }, () => -9),
    });

    // A synchronous appender CPU budget should measure work on the JavaScript worker that executes
    // the appender, not time when it was descheduled or CPU used concurrently by V8 helper threads.
    // `process.threadCpuUsage()` provides that current-thread user + system cost. In contrast,
    // `process.cpuUsage()` aggregates every thread in the process, so sibling V8 helper-thread CPU
    // (parallel or concurrent) can make an append appear to consume more CPU than its executing
    // JavaScript thread did; keep that process-wide reading only in failure diagnostics.
    // This is not end-to-end browser frame latency: off-CPU waits and compositor presentation are
    // outside this Node fixture, while the wide wall-clock assertion below remains hang protection.
    // The fastest COMPLETE pass is the honest estimate: taking a per-frame minimum would splice
    // together frames that never ran as one stroke, while a genuine steady over-budget frame
    // survives every complete pass.
    const APPEND_BUDGET_PASSES = 3;
    // The reference remains only for relative early/late and chunk-growth comparisons. Those
    // compare the appender with itself inside one stroke, where a nearby reference removes a
    // mid-stroke machine-speed shift. It is deliberately not an absolute cost denominator below.
    const APPEND_CALIBRATION_ROUNDS = 80;
    const halfGrowths: number[] = [];
    const chunkCostRatios: number[] = [];
    const chunkGrowthRatios: number[] = [];
    const appendCpuPasses: Array<{
      readonly mainThreadMaxMs: number;
      readonly processMaxMs: number;
    }> = [];
    let maxAppendFrameMs = Number.POSITIVE_INFINITY;
    let totalAppendMs = Number.POSITIVE_INFINITY;
    let markDeltas: number[] = [];
    let appendCount = 0;
    let liveMarks: ReturnType<typeof attachedRenderer>["activeCanvas"]["recordedMarks"] = [];
    let lastRenderer: ReturnType<typeof attachedRenderer>["renderer"] | null = null;

    for (let pass = 0; pass < APPEND_BUDGET_PASSES; pass += 1) {
    const { activeCanvas, renderer } = attachedRenderer();
    lastRenderer = renderer;
    expect(renderer.begin(firstChunk).status).toBe("started");

    let passMaxAppendMainThreadCpuMs = 0;
    let passMaxAppendProcessCpuMs = 0;
    let passMaxAppendFrameMs = 0;
    let passTotalAppendMs = 0;
    let passAppendCount = 0;
    let activeClearsAfterFirstMove: number | null = null;
    const passSamples: StudioPerfCalibrationSample[] = [];
    const passMarkDeltas: number[] = [];
    let markedBeforeAppend = 0;

    for (let pointCount = 60; pointCount <= fullPoints.length; pointCount += 30) {
      const prefixPoints = fullPoints.slice(0, pointCount);
      const prefixElement = drawElement("crayon-3000-stress", prefixPoints, {
        brush: selection.runtimeBrushId,
        brushCatalogId: selection.catalogId,
        brushDynamics: selection.brushDynamics,
        strokeWidth: selection.defaultWidth,
        opacity: selection.defaultOpacity,
        pressures: Array.from({ length: pointCount / 2 }, () => 0.72),
        speeds: Array.from({ length: pointCount / 2 }, () => 14),
        tiltXs: Array.from({ length: pointCount / 2 }, () => 18),
        tiltYs: Array.from({ length: pointCount / 2 }, () => -9),
      });

      // The reference is timed immediately before the append it calibrates, every append. Both
      // windows are ~1ms and adjacent, so a contended stretch or a GC pause inflates the pair
      // together -- which is precisely what the old form could not do, measuring its calibration
      // in one separate window after all three passes had finished.
      const referenceStartedMs = performance.now();
      runStudioPerfCalibrationRounds(APPEND_CALIBRATION_ROUNDS);
      const referenceMs = performance.now() - referenceStartedMs;

      const processCpuBefore = process.cpuUsage();
      const threadCpuBefore = process.threadCpuUsage();
      const startMs = performance.now();
      const appended = renderer.appendFrom(prefixElement);
      const elapsedMs = performance.now() - startMs;
      const threadCpuAfter = process.threadCpuUsage(threadCpuBefore);
      const processCpuAfter = process.cpuUsage(processCpuBefore);
      const mainThreadCpuMs = (threadCpuAfter.user + threadCpuAfter.system) / 1_000;
      const processCpuMs = (processCpuAfter.user + processCpuAfter.system) / 1_000;

      expect(appended.status).toBe("appended");
      passSamples.push({ referenceMs, workMs: elapsedMs });
      passMarkDeltas.push(activeCanvas.recordedMarks.length - markedBeforeAppend);
      markedBeforeAppend = activeCanvas.recordedMarks.length;
      passAppendCount += 1;
      passTotalAppendMs += elapsedMs;
      passMaxAppendMainThreadCpuMs = Math.max(
        passMaxAppendMainThreadCpuMs,
        mainThreadCpuMs,
      );
      passMaxAppendProcessCpuMs = Math.max(
        passMaxAppendProcessCpuMs,
        processCpuMs,
      );
      // The FIRST append is excluded from the outlier max, and only from that.
      //
      // It is not an outlier against its neighbours; it is a different amount of work. This loop
      // starts at 60 points and grows by 30, and `appendFrom` is incremental, so the first call
      // plans a 60-point chunk from a cold renderer while every later one extends by 30. On the
      // reference container that structural gap hid inside a 5.51-5.87 ratio; on a slower CI
      // runner it surfaced as 9.84 against this bound of 9, with nothing regressed. Grading the
      // steady-state frames says what this bound is actually for -- no ordinary append is an
      // outlier against the appends around it -- and a first frame that truly blew up is still
      // caught by the 30ms CPU budget below, which includes it.
      if (passAppendCount > 1 && elapsedMs > passMaxAppendFrameMs) {
        passMaxAppendFrameMs = elapsedMs;
      }
      // Structural O(1) proof alongside the timing budget: after the tap-replacing first movement
      // frame, an append must never clear and repaint the cumulative stroke.
      if (activeClearsAfterFirstMove === null) {
        activeClearsAfterFirstMove = activeCanvas.clearCount();
      } else {
        expect(activeCanvas.clearCount()).toBe(activeClearsAfterFirstMove);
      }
    }

    // Keep the fastest complete pass, not the fastest frames from different passes.
    appendCpuPasses.push({
      mainThreadMaxMs: passMaxAppendMainThreadCpuMs,
      processMaxMs: passMaxAppendProcessCpuMs,
    });
    if (passMaxAppendFrameMs < maxAppendFrameMs) {
      maxAppendFrameMs = passMaxAppendFrameMs;
      totalAppendMs = passTotalAppendMs;
    }
    halfGrowths.push(appendCalibratedHalfGrowth(passSamples));
    chunkCostRatios.push(appendChunkCostRatio(passSamples, passMarkDeltas));
    chunkGrowthRatios.push(appendChunkGrowthRatio(passSamples, passMarkDeltas));
    markDeltas = passMarkDeltas;
    appendCount = passAppendCount;
    liveMarks = activeCanvas.recordedMarks;
    }

    // The append loop is fully determined -- 60 points, +30 each step, up to 6,000 -- so its shape
    // is pinned exactly rather than bounded loosely.
    expect(appendCount).toBe(199);

    // ---------------------------------------------------------------------------------------
    // What O(1) actually claims, asserted without a clock.
    //
    // The regression this test exists to catch is an append that repaints the cumulative stroke:
    // append k would then draw O(k) marks and the run would cost O(n^2). That is a statement about
    // WORK, and the recorder counts work exactly -- so it is graded on mark counts, which are
    // identical on every machine, under every load, in every pass. Every timing bound below is a
    // second opinion, not the proof.
    //
    // Recorded shape: 76,565 marks over 199 appends. Every eighth append re-plans a ribbon chunk
    // and deposits 1,695-1,780 marks; every other one deposits 150-240; the first, which starts a
    // 60-point stroke from a cold renderer rather than extending by 30, deposits 320.
    const totalMarkDeltas = markDeltas.reduce((sum, delta) => sum + delta, 0);
    expect(totalMarkDeltas).toBe(76_565);
    expect(totalMarkDeltas).toBe(liveMarks.length);
    // No append draws more than one chunk's worth, however long the stroke behind it has grown.
    // Under a cumulative repaint the last append alone would draw all 76,565.
    expect(Math.max(...markDeltas), `heaviest append draws ${Math.max(...markDeltas)} marks`)
      .toBeLessThanOrEqual(1_800);
    // The asymptotic statement itself: the second half of the stroke costs what the first half
    // did. Recorded 38,275 against 38,290 -- a ratio of 0.9996. A cumulative repaint makes the
    // per-append cost grow linearly with the index, which puts this ratio at ~3.
    expect(
      appendMarkGrowthRatio(markDeltas),
      `late appends draw ${appendMarkGrowthRatio(markDeltas).toFixed(3)}x what early ones did`,
    ).toBeLessThan(APPEND_MARK_GROWTH_LIMIT);

    // ---------------------------------------------------------------------------------------
    // The stable absolute requirement: at least one clean, complete warm-process pass keeps every
    // append under 30ms CPU on the JavaScript worker that synchronously executes it.
    //
    // The former synthetic-kernel ratio cannot make a valid constant-factor claim on this path.
    // The allocating appender and the cache-resident float kernel do not co-scale: honest ratios
    // now span 0.604 locally to 1.559 on a runner, so an honest runner overlaps a doubled local
    // append at 1.208. No fixed threshold can clear both honest populations and convict a doubling.
    // Raising or lowering that threshold would only choose which machine to fail.
    //
    // Current-thread CPU removes scheduler descheduling and sibling V8 helper-thread CPU, not the
    // machine: a slower gated JS worker that spends more than 30ms still violates this warm-process
    // ceiling. Synchronous allocation, zero-fill and GC work on that worker remain included.
    // The deterministic mark total,
    // per-append mark ceiling, mark-growth ratio and no-clear invariant above remain the stronger,
    // machine-independent proof against cumulative repaint and extra mark work. This clock only
    // covers constant arithmetic/allocating work that does not alter those receipts, and it claims
    // exactly 30ms in this warm process rather than pretending every sub-millisecond doubling is
    // a visible regression. True process-cold first use stays in the dedicated cold-start suite.
    const bestCpuPass = appendCpuPasses.reduce((best, candidate) =>
      candidate.mainThreadMaxMs < best.mainThreadMaxMs ? candidate : best
    );
    expect(
      bestCpuPass.mainThreadMaxMs,
      `worst append in the fastest complete pass used `
        + `${bestCpuPass.mainThreadMaxMs.toFixed(2)}ms main-thread CPU `
        + `(same-pass process CPU max ${bestCpuPass.processMaxMs.toFixed(2)}ms; `
        + `main-thread pass maxima ${appendCpuPasses
          .map((pass) => pass.mainThreadMaxMs.toFixed(2))
          .join(", ")})`,
    ).toBeLessThan(30);

    // The absolute ceiling alone cannot say whether cost grows with stroke length while every
    // append remains below 30ms. A regression can recompute prior geometry for later frames while
    // still rendering only the unseen suffix, moving no mark count. Each half is calibrated
    // against references timed beside its own appends, so a mid-stroke machine-speed shift cancels
    // and what is left is length dependence. The cheapest of the three passes decides.
    const halfGrowth = Math.min(...halfGrowths);
    expect(
      halfGrowth,
      `late appends cost ${halfGrowth.toFixed(3)}x what early ones did `
      + `(passes: ${halfGrowths.map((value) => value.toFixed(3)).join(", ")})`,
    ).toBeLessThan(APPEND_LENGTH_GROWTH_LIMIT);

    // ...and the periodic class graded against the steady one. A slowdown confined to every
    // eighth ribbon-chunk append can remain below the absolute 30ms ceiling, leaves both
    // half-minima on ordinary appends, and draws exactly the same marks. The class ratio detects
    // that periodic hitch before it consumes a whole frame.
    // The MEDIAN across passes, not the minimum, for the same reason the reduction INSIDE each
    // pass is a median: this is a ratio of two independently timed windows, so its noise is
    // two-sided. A pass whose seven ordinary-append denominators absorbed more delay than its
    // chunk windows produces a low quotient, and a minimum selects that pass on purpose. The
    // inner median handles a stalled cycle; the outer one has to handle a stalled pass.
    const orderedChunkCostRatios = [...chunkCostRatios].sort((left, right) => left - right);
    const chunkCostRatio = orderedChunkCostRatios[Math.floor(orderedChunkCostRatios.length / 2)]!;
    expect(
      chunkCostRatio,
      `a ribbon-chunk append costs ${chunkCostRatio.toFixed(3)}x its cycle's ordinary appends `
      + `(passes: ${chunkCostRatios.map((value) => value.toFixed(2)).join(", ")})`,
    ).toBeLessThan(APPEND_CHUNK_COST_LIMIT);

    // ...and length dependence WITHIN the chunk class, which the two ratios above miss between
    // them: the early/late gate reduces ordinary appends in each half, this class's own gate
    // reduces the cheapest chunk across the whole stroke, so re-planning that grows only on the
    // chunk path leaves an unaffected early chunk as the cheapest and moves neither.
    // The MINIMUM across passes, unlike the chunk-cost gate above, and that asymmetry is measured
    // rather than stylistic.
    //
    // A median was tried here first, on the argument that a quotient of two calibrated ratios has
    // two-sided noise and deserves the same reducer the cost gate needs. Under six spinning hogs
    // on four cores that form read passes of 1.337 / 1.683 / 0.769 and failed at 1.337 against
    // 1.25 with nothing regressed: this quotient's upward tail is far wider than the cost gate's,
    // because it divides two per-half floors that are each drawn from only ~12 chunk appends.
    //
    // So it keeps this file's existing convention — a violation must be earned by EVERY pass —
    // which costs nothing against the regression it exists for: length dependence on the chunk
    // path raises all three passes together, so the minimum rises with them. The cost gate cannot
    // use a minimum for the reason Codex gave, and this one cannot use a median for the reason
    // the machine gave.
    const chunkGrowthRatio = Math.min(...chunkGrowthRatios);
    expect(
      chunkGrowthRatio,
      `late ribbon-chunk appends cost ${chunkGrowthRatio.toFixed(3)}x what early ones did `
      + `(passes: ${chunkGrowthRatios.map((value) => value.toFixed(3)).join(", ")})`,
    ).toBeLessThan(APPEND_CHUNK_GROWTH_LIMIT);

    // The main-thread CPU ceiling above includes this renderer's first append. It still cannot
    // measure true PROCESS-COLD initialisation here: fourteen tests in this file construct
    // renderers and drive appends before this one runs, so whatever the process pays once has
    // already been paid by the time the first pass here is measured. That is measured, not
    // supposed: this same reading is 4.05 and 4.62 in file order against 14.69 and 14.42 when the
    // test is run on its own, so roughly ten ordinary appends of one-time cost sit outside the
    // window. Closing that gap needs this measurement in its OWN file, the way the impasto shader
    // gates were split from their census, rather than a different statistic here.
    expect(markDeltas[0], "cold first append marks").toBe(320);
    // The cold-start COST gates are not here, deliberately. Fourteen tests in this file build
    // renderers before this one runs, so whatever the process pays once is already paid by the
    // time the first pass is measured -- 4.05 in file order against 14.69 with the measurement
    // alone in its own process. They live in
    // `studio-live-dynamic-brush-overlay.cold-start.test.ts`, which vitest gives its own module
    // process, and this mark pin stays because a count does not care how warm the process is.

    // A blow-up bound, not a budget. The worst single append is a pure noise measurement -- 30.1
    // to 45.8ms idle on this container, where the median append is 1.8ms, because one GC pause
    // lands wherever it lands (the 1ms reference kernel itself was seen taking 7.2ms). It was
    // previously graded against the pass mean at a limit of 9 and read 9.6 in a single idle pass,
    // one unlucky collection away from failing. Kept only wide enough to catch a hang.
    expect(maxAppendFrameMs, `worst single append ${maxAppendFrameMs.toFixed(1)}ms`)
      .toBeLessThan(1_000);
    expect(totalAppendMs).toBeLessThan(60_000);

    expect(liveMarks.length).toBeGreaterThan(0);
    // Bounded by the complete-stroke ceiling, not the per-segment one: a 3,000-sample crayon
    // plans 76,565 marks across its five native wax fibres and is drawn whole (the recorded count
    // IS the planned count — no accepted-prefix truncation). The old 65,536 pin here was the
    // per-segment budget, which this path never applied; three lanes merely happened to fit it.
    expect(liveMarks.length)
      .toBeLessThanOrEqual(STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET);
    const sealed = lastRenderer!.end(element);
    expect(sealed.status).toBe("settled");
  });

  it("convicts length-dependent appends before the absolute append ceiling", () => {
    // The blind spot the mark-count pins do NOT cover: a planner that recomputes prior geometry
    // for later frames but still renders only the unseen suffix. Every mark delta is unchanged,
    // so the counts above stay green, while every append can remain under 30ms. Stated as data, so
    // it needs no clock and no machine.
    const APPENDS = 200;
    const REFERENCE_MS = 1;
    const honest = Array.from({ length: APPENDS }, (_, index) => ({
      referenceMs: REFERENCE_MS,
      // The recorded shape's two levels: every eighth append re-plans a ribbon chunk.
      workMs: index % 8 === 7 ? 9 : 1.1,
    }));
    expect(appendCalibratedHalfGrowth(honest)).toBeCloseTo(1, 6);
    expect(appendCalibratedHalfGrowth(honest)).toBeLessThan(APPEND_LENGTH_GROWTH_LIMIT);

    // Ten milliseconds added to every append in the second half: still under the 30ms ceiling,
    // but unmistakably length-dependent.
    const lateStall = honest.map((sample, index) => (index < APPENDS / 2
      ? sample
      : { ...sample, workMs: sample.workMs + 10 }));
    expect(Math.max(...lateStall.map((sample) => sample.workMs))).toBeLessThan(30);
    expect(appendCalibratedHalfGrowth(lateStall)).toBeGreaterThan(APPEND_LENGTH_GROWTH_LIMIT);
    // ...and the statistic the global minimum reports for that same series is unchanged, which is
    // exactly why this gate exists alongside it.
    expect(reduceStudioPerfCalibrationSamples(lateStall).workMs)
      .toBe(reduceStudioPerfCalibrationSamples(honest).workMs);

    // A linear replan — append k re-derives k appends' worth — is convicted overwhelmingly.
    const linear = honest.map((sample, index) => ({
      ...sample,
      workMs: sample.workMs * (index + 1),
    }));
    expect(appendCalibratedHalfGrowth(linear)).toBeGreaterThan(50);

    // And a partial leak: 1% of the base cost re-derived per append behind the cursor.
    const leak = honest.map((sample, index) => ({
      ...sample,
      workMs: sample.workMs * (1 + 0.01 * index),
    }));
    expect(appendCalibratedHalfGrowth(leak)).toBeGreaterThan(APPEND_LENGTH_GROWTH_LIMIT);

    // Not vacuous in the other direction: a uniform 40% slowdown is NOT length dependence and
    // remains inside the absolute append ceiling, so this gate must not convict it.
    const uniform = honest.map((sample) => ({ ...sample, workMs: sample.workMs * 1.4 }));
    expect(Math.max(...uniform.map((sample) => sample.workMs))).toBeLessThan(30);
    expect(appendCalibratedHalfGrowth(uniform)).toBeLessThan(APPEND_LENGTH_GROWTH_LIMIT);
    // A machine 3x slower at everything, references included, is likewise not length dependence.
    const slowBox = honest.map((sample) => ({
      referenceMs: sample.referenceMs * 3,
      workMs: sample.workMs * 3,
    }));
    expect(appendCalibratedHalfGrowth(slowBox)).toBeCloseTo(1, 6);

    expect(() => appendCalibratedHalfGrowth(honest.slice(0, 3)))
      .toThrow(/at least four appends/);
  });

  it("convicts periodic appends below the absolute and length-growth bounds", () => {
    // A slowdown confined to the every-eighth ribbon-chunk append can stay below 30ms. The
    // whole-stroke floor stays on an ordinary append, both
    // half-minima stay ordinary so the early/late ratio stays flat, and the mark counts do not
    // move at all. Stated as data, so it needs no clock and no machine.
    const APPENDS = 200;
    const deltas = Array.from({ length: APPENDS }, (_, index) => (index % 8 === 7 ? 1_740 : 210));
    // Ordinary appends at their MEAN (1.74ms), not their minimum: the cycle sums seven of them,
    // so the recorded ~1.10 median comes out of the mean rather than the noise floor.
    const honest = Array.from({ length: APPENDS }, (_, index) => ({
      referenceMs: 1,
      workMs: index % 8 === 7 ? 13.4 : 1.74,
    }));
    expect(appendChunkCostRatio(honest, deltas)).toBeCloseTo(1.10, 1);
    expect(appendChunkCostRatio(honest, deltas)).toBeLessThan(APPEND_CHUNK_COST_LIMIT);

    // Every eighth append at 25ms, ordinary ones untouched: still inside the absolute budget,
    // but a periodic hitch relative to its own cycle.
    const periodicStall = honest.map((sample, index) => (index % 8 === 7
      ? { ...sample, workMs: 25 }
      : sample));
    expect(Math.max(...periodicStall.map((sample) => sample.workMs))).toBeLessThan(30);
    expect(appendChunkCostRatio(periodicStall, deltas)).toBeGreaterThan(2);
    expect(appendChunkCostRatio(periodicStall, deltas))
      .toBeGreaterThan(APPEND_CHUNK_COST_LIMIT);
    // ...and the bounds it slips past, which is why this gate exists alongside them.
    expect(reduceStudioPerfCalibrationSamples(periodicStall).workMs)
      .toBe(reduceStudioPerfCalibrationSamples(honest).workMs);
    expect(appendCalibratedHalfGrowth(periodicStall))
      .toBeCloseTo(appendCalibratedHalfGrowth(honest), 6);

    // A mere doubling of the class is convicted too, not just a catastrophe.
    const doubledClass = honest.map((sample, index) => (index % 8 === 7
      ? { ...sample, workMs: sample.workMs * 2 }
      : sample));
    expect(appendChunkCostRatio(doubledClass, deltas))
      .toBeGreaterThan(APPEND_CHUNK_COST_LIMIT);

    // Not vacuous in the other direction. A uniformly slower machine — every append 3x, chunk
    // and ordinary alike — is not a class regression and must not convict here.
    const slowBox = honest.map((sample) => ({ ...sample, workMs: sample.workMs * 3 }));
    expect(appendChunkCostRatio(slowBox, deltas)).toBeCloseTo(1.10, 1);
    // Nor is a slowdown confined to the ORDINARY class: this class-specific ratio moves DOWN
    // there, and the absolute CPU ceiling remains the appropriate bound.
    const ordinaryStall = honest.map((sample, index) => (index % 8 === 7
      ? sample
      : { ...sample, workMs: sample.workMs * 2 }));
    expect(appendChunkCostRatio(ordinaryStall, deltas)).toBeLessThan(APPEND_CHUNK_COST_LIMIT);

    expect(() => appendChunkCostRatio(honest, deltas.slice(1)))
      .toThrow(/its own mark delta/);
    expect(() => appendChunkCostRatio(honest, deltas.map(() => 210)))
      .toThrow(/at least eight complete cycles/);
  });

  it("cancels a mid-stroke machine-speed shift instead of reporting it as chunk growth", () => {
    // The failure this calibration exists for: the runner gets busier partway through a
    // several-second stroke. Every append in the late half costs more, the reference kernel timed
    // beside each one costs proportionally more, and an uncalibrated comparison of raw `workMs`
    // reports that shift as length dependence. Stated as data, so it needs no busy machine.
    const APPENDS = 200;
    const deltas: number[] = Array.from(
      { length: APPENDS },
      (_, index) => (index % 8 === 7 ? 1_740 : 210),
    );
    deltas[0] = 320;
    const honest: StudioPerfCalibrationSample[] = Array.from({ length: APPENDS }, (_, index) => ({
      referenceMs: 1,
      workMs: index % 8 === 7 ? 13.4 : 1.13,
    }));
    expect(appendChunkGrowthRatio(honest, deltas)).toBeCloseTo(1, 6);

    // The whole machine runs 1.7x slower from the midpoint on — work AND reference alike.
    const SLOWDOWN = 1.7;
    const drifted = honest.map((sample, index) => (index < APPENDS / 2 ? sample : {
      referenceMs: sample.referenceMs * SLOWDOWN,
      workMs: sample.workMs * SLOWDOWN,
    }));
    expect(appendChunkGrowthRatio(drifted, deltas)).toBeCloseTo(1, 6);
    expect(appendChunkGrowthRatio(drifted, deltas)).toBeLessThan(APPEND_CHUNK_GROWTH_LIMIT);
    // ...where the uncalibrated form this replaced reported exactly the slowdown as growth, and
    // 1.7 clears the 1.25 limit, so it would have failed healthy code on a runner that got busy.
    const rawGrowth = (series: readonly StudioPerfCalibrationSample[]): number => {
      const chunks = series.filter((_, index) => deltas[index]! > APPEND_CHUNK_MARK_THRESHOLD);
      const half = Math.floor(chunks.length / 2);
      const cheapest = (slice: readonly StudioPerfCalibrationSample[]) =>
        Math.min(...slice.map((sample) => sample.workMs));
      return cheapest(chunks.slice(half)) / cheapest(chunks.slice(0, half));
    };
    expect(rawGrowth(drifted)).toBeCloseTo(SLOWDOWN, 6);
    expect(rawGrowth(drifted)).toBeGreaterThan(APPEND_CHUNK_GROWTH_LIMIT);

    // And the converse: real length dependence on the chunk path is still convicted, because the
    // reference kernel does NOT grow with it. This is the regression the gate is for.
    const lengthDependent = honest.map((sample, index) => (
      index >= APPENDS / 2 && index % 8 === 7
        ? { ...sample, workMs: sample.workMs * 2 }
        : sample
    ));
    expect(appendChunkGrowthRatio(lengthDependent, deltas)).toBeCloseTo(2, 6);
    expect(appendChunkGrowthRatio(lengthDependent, deltas))
      .toBeGreaterThan(APPEND_CHUNK_GROWTH_LIMIT);

    // A drifting machine AND a real regression together still convict: the drift divides out and
    // the regression does not.
    const both = drifted.map((sample, index) => (
      index >= APPENDS / 2 && index % 8 === 7
        ? { ...sample, workMs: sample.workMs * 2 }
        : sample
    ));
    expect(appendChunkGrowthRatio(both, deltas)).toBeCloseTo(2, 6);
    expect(appendChunkGrowthRatio(both, deltas)).toBeGreaterThan(APPEND_CHUNK_GROWTH_LIMIT);

    // A zero-length reference window is not a calibration.
    expect(() => appendChunkGrowthRatio(
      honest.map((sample) => ({ ...sample, referenceMs: 0 })),
      deltas,
    )).toThrow(/zero-length reference window/);
  });

  it("convicts a cold FIRST-CHUNK regression every other bound discards", () => {
    // The sixth blind spot: the first ribbon-chunk append. Deferring initialisation to the chunk
    // path rather than to the renderer's first ordinary append moves it out of reach of every
    // gate in this file. Stated as data, so it needs no clock and no machine.
    const APPENDS = 200;
    const deltas: number[] = Array.from(
      { length: APPENDS },
      (_, index) => (index % 8 === 7 ? 1_740 : 210),
    );
    deltas[0] = 320;
    const honest: StudioPerfCalibrationSample[] = Array.from({ length: APPENDS }, (_, index) => ({
      referenceMs: 1,
      workMs: index % 8 === 7 ? 13.4 : 1.13,
    }));
    honest[0] = { referenceMs: 1, workMs: 2.6 };
    // ~12 ordinary appends before anything is wrong, which is why this is a blow-up bound: a
    // chunk append re-plans a ribbon chunk where an ordinary one extends by 30 points.
    expect(appendFirstChunkColdStartCostRatio(honest, deltas)).toBeCloseTo(11.86, 1);
    expect(appendFirstChunkColdStartCostRatio(honest, deltas))
      .toBeLessThan(APPEND_FIRST_CHUNK_COLD_START_COST_LIMIT);

    // Codex's case, verbatim: a 500ms first-use stall on the structural chunk path.
    const coldChunkStall = honest.map((sample, index) => (index === 7
      ? { ...sample, workMs: sample.workMs + 500 }
      : sample));
    expect(appendFirstChunkColdStartCostRatio(coldChunkStall, deltas)).toBeGreaterThan(450);
    expect(appendFirstChunkColdStartCostRatio(coldChunkStall, deltas))
      .toBeGreaterThan(APPEND_FIRST_CHUNK_COLD_START_COST_LIMIT);

    // ...and here is every bound it slips past, which is the whole reason this gate exists.
    // The global minimum is an ordinary append and never moves.
    expect(reduceStudioPerfCalibrationSamples(coldChunkStall).workMs)
      .toBe(reduceStudioPerfCalibrationSamples(honest).workMs);
    // The chunk-cost gate is a MEDIAN over ~24 cycles, so one stalled cycle is discarded by
    // construction — the same property that makes it robust to a scheduler pause makes it blind
    // here, which is precisely why a separate first-chunk gate is needed rather than a tighter
    // chunk-cost limit.
    // (Equality, not "under the limit": this fixture's two-level shape is not calibrated to that
    // gate's budget. The claim is that the 500ms stall does not move its verdict AT ALL.)
    expect(appendChunkCostRatio(coldChunkStall, deltas))
      .toBeCloseTo(appendChunkCostRatio(honest, deltas), 6);
    // The chunk-growth gate takes the cheapest chunk in each half; the stalled chunk is the first
    // one, in the early half, where the other early chunks are unaffected and stay cheapest.
    expect(appendChunkGrowthRatio(coldChunkStall, deltas))
      .toBeCloseTo(appendChunkGrowthRatio(honest, deltas), 6);
    expect(appendChunkGrowthRatio(coldChunkStall, deltas)).toBeLessThan(APPEND_CHUNK_GROWTH_LIMIT);
    // The ordinary cold-start gate grades `samples[0]`, a different append entirely.
    expect(appendColdStartCostRatio(coldChunkStall, deltas))
      .toBeCloseTo(appendColdStartCostRatio(honest, deltas), 6);
    // The early/late calibration reduces ordinary appends in each half and never sees a chunk.
    expect(appendCalibratedHalfGrowth(coldChunkStall))
      .toBeCloseTo(appendCalibratedHalfGrowth(honest), 6);
    // And the mark counts are identical, because no extra geometry was planned.
    expect(appendMarkGrowthRatio(deltas)).toBeLessThan(APPEND_MARK_GROWTH_LIMIT);

    // A stall on a LATER chunk is not this gate's business and it says so, rather than
    // overlapping the growth gate that does cover it.
    const lateChunkStall = honest.map((sample, index) => (index % 8 === 7 && index > APPENDS / 2
      ? { ...sample, workMs: sample.workMs + 500 }
      : sample));
    expect(appendFirstChunkColdStartCostRatio(lateChunkStall, deltas))
      .toBeCloseTo(appendFirstChunkColdStartCostRatio(honest, deltas), 6);
    expect(appendChunkGrowthRatio(lateChunkStall, deltas))
      .toBeGreaterThan(APPEND_CHUNK_GROWTH_LIMIT);

    // A slower machine moves both sides of the division together and changes nothing.
    const slowBox = honest.map((sample) => ({ ...sample, workMs: sample.workMs * 3.4 }));
    expect(appendFirstChunkColdStartCostRatio(slowBox, deltas)).toBeCloseTo(11.86, 1);

    // Read on the FIRST pass, not the cheapest: process-wide initialisation is paid once, so a
    // minimum across passes acquits exactly the regression this exists for.
    const perPassRatios = [
      appendFirstChunkColdStartCostRatio(coldChunkStall, deltas),
      appendFirstChunkColdStartCostRatio(honest, deltas),
      appendFirstChunkColdStartCostRatio(honest, deltas),
    ];
    expect(Math.min(...perPassRatios)).toBeLessThan(APPEND_FIRST_CHUNK_COLD_START_COST_LIMIT);
    expect(perPassRatios[0]!).toBeGreaterThan(APPEND_FIRST_CHUNK_COLD_START_COST_LIMIT);

    // It is not evidence of anything without matched inputs or a chunk to grade.
    expect(() => appendFirstChunkColdStartCostRatio(honest, deltas.slice(1)))
      .toThrow(/its own mark delta/);
    expect(() => appendFirstChunkColdStartCostRatio(honest, deltas.map(() => 210)))
      .toThrow(/No ribbon-chunk append/);
    expect(() => appendFirstChunkColdStartCostRatio(honest, deltas.map(() => 1_740)))
      .toThrow(/No ordinary append/);
  });

  it("convicts a cold-start regression the other three bounds cannot see", () => {
    // The fourth blind spot: the first append, one member per pass. It is excluded from the
    // outlier max, it is never the global minimum, and it sits in the early half so it cannot
    // move the early/late ratio either. Stated as data.
    const APPENDS = 200;
    const deltas: number[] = Array.from(
      { length: APPENDS },
      (_, index) => (index % 8 === 7 ? 1_740 : 210),
    );
    deltas[0] = 320;
    const honest: StudioPerfCalibrationSample[] = Array.from({ length: APPENDS }, (_, index) => ({
      referenceMs: 1,
      workMs: index % 8 === 7 ? 13.4 : 1.13,
    }));
    honest[0] = { referenceMs: 1, workMs: 2.6 };
    expect(appendColdStartCostRatio(honest, deltas)).toBeCloseTo(2.30, 1);
    expect(appendColdStartCostRatio(honest, deltas)).toBeLessThan(APPEND_COLD_START_COST_LIMIT);

    // Codex's case, verbatim: a two-second initialisation on the cold path alone.
    const coldStall = honest.map((sample, index) => (index === 0
      ? { ...sample, workMs: 2_000 }
      : sample));
    expect(appendColdStartCostRatio(coldStall, deltas)).toBeGreaterThan(1_500);
    expect(appendColdStartCostRatio(coldStall, deltas))
      .toBeGreaterThan(APPEND_COLD_START_COST_LIMIT);
    // ...and every bound it slips past, which is the whole reason this gate exists.
    expect(reduceStudioPerfCalibrationSamples(coldStall).workMs)
      .toBe(reduceStudioPerfCalibrationSamples(honest).workMs);
    expect(appendChunkCostRatio(coldStall, deltas))
      .toBeCloseTo(appendChunkCostRatio(honest, deltas), 6);
    expect(appendMarkGrowthRatio(deltas)).toBeLessThan(APPEND_MARK_GROWTH_LIMIT);

    // The fifth blind spot, and the one the four bounds share BETWEEN them: re-planning that
    // grows only on the chunk path. The early/late gate reduces ordinary appends in each half;
    // the chunk/ordinary gate reduces the cheapest chunk across the whole stroke — so an
    // unaffected early chunk stays cheapest and neither ratio moves.
    const lateChunkStall = honest.map((sample, index) => (index % 8 === 7 && index > APPENDS / 2
      ? { ...sample, workMs: sample.workMs + 500 }
      : sample));
    expect(appendChunkGrowthRatio(lateChunkStall, deltas))
      .toBeGreaterThan(APPEND_CHUNK_GROWTH_LIMIT);
    expect(appendChunkGrowthRatio(lateChunkStall, deltas)).toBeGreaterThan(30);
    // The chunk-cost gate catches this one too, now that it reduces by the MEDIAN across cycles
    // rather than the cheapest chunk: half the cycles are late and stalled, so the median moves
    // with them. Under the cheapest-chunk form it did not, and that is what this growth gate was
    // added for — the fix to the OTHER finding happened to close this hole as well. They are kept
    // separate because they answer different questions (is the class expensive / does it grow),
    // not because one catches a leak the other misses; on this regression both convict.
    expect(appendChunkCostRatio(lateChunkStall, deltas))
      .toBeGreaterThan(APPEND_CHUNK_COST_LIMIT);
    // ...and the bounds that do NOT see it.
    expect(appendCalibratedHalfGrowth(lateChunkStall))
      .toBeCloseTo(appendCalibratedHalfGrowth(honest), 6);
    expect(reduceStudioPerfCalibrationSamples(lateChunkStall).workMs)
      .toBe(reduceStudioPerfCalibrationSamples(honest).workMs);
    // Not vacuous: a uniformly 3x slower machine is not growth within the class.
    expect(appendChunkGrowthRatio(
      honest.map((sample) => ({ ...sample, workMs: sample.workMs * 3 })),
      deltas,
    )).toBeCloseTo(appendChunkGrowthRatio(honest, deltas), 6);
    expect(() => appendChunkGrowthRatio(honest.slice(0, 8), deltas.slice(0, 8)))
      .toThrow(/at least four chunk appends/);

    // The sensitivity boundary, pinned from both sides so nobody credits this gate with more
    // than it does. A single process-cold sample cannot be reduced, its loaded tail reaches 65.98
    // on a 250%-oversubscribed box, and the limit has to clear that — so the smallest one-time
    // cost this convicts is ~285ms against this fixture's 1.13ms ordinary append.
    const withColdStart = (workMs: number) => appendColdStartCostRatio(
      honest.map((sample, index) => (index === 0 ? { ...sample, workMs } : sample)),
      deltas,
    );
    expect(withColdStart(300)).toBeGreaterThan(APPEND_COLD_START_COST_LIMIT);
    expect(withColdStart(200)).toBeLessThan(APPEND_COLD_START_COST_LIMIT);
    // The regression it exists for is not a 100ms one, though: it is a first-use initialisation
    // measured in hundreds of milliseconds or seconds, and that is convicted overwhelmingly.
    expect(withColdStart(2_000)).toBeGreaterThan(APPEND_COLD_START_COST_LIMIT * 7);

    // Not vacuous the other way: a uniformly 3x slower machine is not a cold-start regression.
    const slowBox = honest.map((sample) => ({ ...sample, workMs: sample.workMs * 3 }));
    expect(appendColdStartCostRatio(slowBox, deltas)).toBeCloseTo(2.30, 1);

    // The reducer matters as much as the statistic. Process-wide initialisation is paid ONCE, by
    // the first renderer, so a minimum across passes acquits it using a warmed pass -- which is
    // why this gate reads the first pass and not the cheapest.
    const perPassRatios = [2_000, 2.4, 2.4];
    expect(Math.min(...perPassRatios)).toBeLessThan(APPEND_COLD_START_COST_LIMIT);
    expect(perPassRatios[0]!).toBeGreaterThan(APPEND_COLD_START_COST_LIMIT);

    expect(() => appendColdStartCostRatio(honest, deltas.slice(1)))
      .toThrow(/its own mark delta/);
  });

  it("convicts a cumulative-repaint appender on mark counts alone", () => {
    // The counterfactual the O(1) pins above are worth, stated as data so it needs no clock and no
    // machine. 199 appends either way.
    const APPENDS = 199;
    // Incremental: each append deposits one step's worth, every eighth a ribbon chunk -- the
    // recorded shape, reduced to its two levels.
    const incremental = Array.from({ length: APPENDS }, (_, index) =>
      (index % 8 === 7 ? 1_740 : 210));
    expect(appendMarkGrowthRatio(incremental)).toBeLessThan(APPEND_MARK_GROWTH_LIMIT);

    // Cumulative repaint: append k redraws everything drawn so far, so it deposits k steps' worth.
    // This is the regression -- an O(n^2) run whose per-append cost grows with the stroke.
    const cumulative = incremental.map((_, index) => 210 * (index + 1));
    expect(appendMarkGrowthRatio(cumulative)).toBeGreaterThan(2.9);
    expect(appendMarkGrowthRatio(cumulative)).toBeGreaterThan(APPEND_MARK_GROWTH_LIMIT);

    // And it is not only the extreme case: even a HALF-strength leak -- every append redrawing
    // half the stroke behind it on top of its own step -- clears the limit comfortably.
    const halfLeak = incremental.map((delta, index) => delta + 105 * index);
    expect(appendMarkGrowthRatio(halfLeak)).toBeGreaterThan(APPEND_MARK_GROWTH_LIMIT);

    // The limit is not vacuous in the other direction either: a 20% uniform increase in per-append
    // work is NOT asymptotic and must not be convicted here -- that is the calibrated timing
    // budget's job, not this one's.
    expect(appendMarkGrowthRatio(incremental.map((delta) => delta * 1.2)))
      .toBeLessThan(APPEND_MARK_GROWTH_LIMIT);

    expect(() => appendMarkGrowthRatio([])).toThrow(/at least two appends/);
    expect(() => appendMarkGrowthRatio([0, 0, 5, 5])).toThrow(/drew nothing/);
  });

  it("audits every professional dry-media pack for live/pointer-up mark parity", () => {
    const dryMediaDescriptors = STUDIO_BRUSH_PACK_DESCRIPTORS.filter(
      ({ runtimeBrushId }) => runtimeBrushId === "dry-media",
    );
    expect(dryMediaDescriptors.length).toBeGreaterThan(50);
    const pointPairs = Array.from({ length: 48 }, (_, index) => [
      5 + index * 7,
      76 + Math.sin(index / 4) * 6,
    ]);
    const points = pointPairs.flat();

    for (const descriptor of dryMediaDescriptors) {
      const selection = materializeStudioBrushPackSelection(descriptor.catalogId);
      if (!selection) throw new Error(`missing ${descriptor.catalogId} selection`);
      const { activeCanvas, renderer, settledCanvas } = attachedRenderer();
      const element = drawElement(`pack-${descriptor.catalogId}`, points, {
        brush: selection.runtimeBrushId,
        brushCatalogId: selection.catalogId,
        brushDynamics: selection.brushDynamics,
        strokeWidth: selection.defaultWidth,
        opacity: selection.defaultOpacity,
        pressures: Array.from({ length: pointPairs.length }, () => 0.7),
        speeds: Array.from({ length: pointPairs.length }, () => 10),
        tiltXs: Array.from({ length: pointPairs.length }, () => 14),
        tiltYs: Array.from({ length: pointPairs.length }, () => -7),
      });

      expect(
        renderer.begin(element).status,
        `${descriptor.catalogId}: begin`,
      ).toBe("started");
      expect(
        renderer.appendFrom(element).status,
        `${descriptor.catalogId}: append`,
      ).toBe("appended");
      const liveMarks = structuredClone(activeCanvas.recordedMarks);
      expect(
        liveMarks.length,
        `${descriptor.catalogId}: visible live coverage`,
      ).toBeGreaterThan(0);
      const roundMarks = liveMarks.filter((mark) =>
        Math.abs(mark.radiusX - mark.radiusY) <= 1e-9
      ).length;
      const sealed = renderer.end(element);
      expect(sealed.status, `${descriptor.catalogId}: pointer-up`).toBe("settled");
      if (sealed.status !== "settled") continue;
      const retainedMarks = settledCanvas.recordedComposites[0]!.marks;
      expect(
        retainedMarks,
        `${descriptor.catalogId}: live/retained geometry and material`,
      ).toEqual(liveMarks);
      expect(
        retainedMarks.filter((mark) =>
          Math.abs(mark.radiusX - mark.radiusY) <= 1e-9
        ).length,
        `${descriptor.catalogId}: transient round stamp particles`,
      ).toBe(roundMarks);
    }
  });

  it.each([
    "watercolor-wet-wash",
    "sumi-wash-fray",
  ] as const)(
    "seals the already-canonical %s live surface without a pointer-up repaint",
    (catalogId) => {
      const selection = materializeStudioBrushPackSelection(catalogId);
      if (!selection) throw new Error(`missing ${catalogId} selection`);
      const { activeCanvas, renderer, settledCanvas } = attachedRenderer();
      const pointPairs = Array.from({ length: 96 }, (_, index) => [
        8 + index * 4,
        64 + Math.sin(index / 6) * 11,
      ]);
      const element = drawElement(`fast-seal-${catalogId}`, pointPairs.flat(), {
        brush: selection.runtimeBrushId,
        brushCatalogId: selection.catalogId,
        brushDynamics: selection.brushDynamics,
        strokeWidth: selection.defaultWidth,
        opacity: selection.defaultOpacity,
        pressures: Array.from({ length: pointPairs.length }, (_, index) =>
          0.38 + (index % 7) * 0.075
        ),
        speeds: Array.from({ length: pointPairs.length }, (_, index) => 3 + (index % 5)),
        tiltXs: Array.from({ length: pointPairs.length }, () => 12),
        tiltYs: Array.from({ length: pointPairs.length }, () => -9),
        twists: Array.from({ length: pointPairs.length }, () => 23),
      });

      expect(renderer.begin(element).status).toBe("started");
      expect(renderer.appendFrom(element).status).toBe("appended");
      const liveMarks = structuredClone(activeCanvas.recordedMarks);
      const clearsBeforeEnd = activeCanvas.clearCount();
      const sealed = renderer.end(element);

      expect(sealed.status).toBe("settled");
      // One clear retires the active surface. A second clear would mean end rebuilt it first.
      expect(activeCanvas.clearCount()).toBe(clearsBeforeEnd + 1);
      expect(settledCanvas.recordedComposites[0]?.marks).toEqual(liveMarks);
    },
  );

  it.each([
    "chalk-rough",
    "watercolor-dry-granule",
  ] as const)(
    "matches the retained StudioDrawNode plan for a resized seeded %s stroke",
    (catalogId) => {
    const selection = materializeStudioBrushPackSelection(catalogId);
    if (!selection) throw new Error(`missing ${catalogId} selection`);
    const pointPairs = Array.from({ length: 54 }, (_, index) => [
      8 + index * 6,
      72 + Math.sin(index / 4) * 9,
    ]);
    const element = drawElement(`${catalogId}-retained-parity`, pointPairs.flat(), {
      brush: selection.runtimeBrushId,
      brushCatalogId: selection.catalogId,
      brushDynamics: selection.brushDynamics,
      // Brush-size changes are persisted on DrawEl independently from the immutable catalog
      // dynamics snapshot. Live and retained planners must therefore derive one stroke identity
      // from this authored width instead of silently using different bases.
      strokeWidth: selection.defaultWidth * 1.6,
      opacity: selection.defaultOpacity,
      pressures: Array.from({ length: pointPairs.length }, (_, index) =>
        0.34 + (index % 9) * 0.065
      ),
      speeds: Array.from({ length: pointPairs.length }, (_, index) =>
        2 + (index % 7) * 1.4
      ),
      tiltXs: Array.from({ length: pointPairs.length }, () => 17),
      tiltYs: Array.from({ length: pointPairs.length }, () => -11),
    });

    const live = attachedRenderer();
    expect(live.renderer.begin(element).status).toBe("started");
    expect(live.renderer.end(element).status).toBe("settled");
    const liveMarks = live.settledCanvas.recordedComposites[0]?.marks;
    expect(liveMarks?.length).toBeGreaterThan(0);

    const retainedPlan = planStudioDynamicBrushRender(
      element,
      selection.runtimeBrushId,
      false,
    );
    expect(retainedPlan.status).toBe("ready");
    if (retainedPlan.status !== "ready") return;
    const retainedMarks = planStudioDynamicBrushCoverageAndLegacyMarks({
      dabVariations: retainedPlan.plan.dabVariations,
      dynamics: retainedPlan.plan.dynamics,
      materialIdentity: retainedPlan.plan.materialIdentity,
      dynamicSeed: retainedPlan.plan.seed,
      stroke: element.stroke,
      stampGrid: retainedPlan.plan.renderBudget.stampGrid,
      markBudget: retainedPlan.plan.markBudget,
      // StudioDrawNode가 하는 것과 같은 전달 — 종이 결은 요소가 아니라 렌더 플랜이 들고 온다.
      ...(retainedPlan.plan.paper ? { paper: retainedPlan.plan.paper } : {}),
    }).coveragePlan;
    expect(retainedMarks.ok).toBe(true);
    if (!retainedMarks.ok) return;
    const retainedCanvas = recordingCanvas();
    const retainedContext = retainedCanvas.getContext("2d");
    if (!retainedContext) throw new Error("missing retained recording context");
    for (const mark of retainedMarks.marks) {
      renderStudioDynamicBrushCoverageMark(retainedContext, mark);
    }

    expect(retainedCanvas.recordedMarks).toEqual(liveMarks);
    },
  );

  it("accepts canonical-equivalent dynamics clones while rejecting material mutations", () => {
    const { renderer } = attachedRenderer();
    const element = drawElement("clone", [5, 8, 24, 12]);
    expect(renderer.begin(element).status).toBe("started");
    expect(renderer.appendFrom({
      ...element,
      brushDynamics: structuredClone(element.brushDynamics),
    }).status).toBe("appended");
    expect(renderer.appendFrom({
      ...element,
      points: [...element.points, 42, 20],
      brushDynamics: normalizeStudioBrushDynamicsSettings({
        ...element.brushDynamics,
        grain: { amount: 0 },
      }),
    })).toEqual({ status: "rejected", reason: "stroke-identity" });
    expect(renderer.isActive).toBe(true);
    expect(renderer.lastOperationFailureReason).toBe("stroke-identity");
    expect(renderer.appendFrom(element)).toEqual({
      status: "rejected",
      reason: "stroke-identity",
    });
    expect(renderer.resetActive()).toBe(true);
    expect(renderer.isActive).toBe(false);
  });

  it("preserves complex tip, grain, dual, colour, symmetry and stroke opacity through seal and replay", () => {
    const {
      activeCanvas,
      presentationCanvas,
      renderer,
      settledCanvas,
    } = attachedRenderer();
    const element = drawElement(
      "quality",
      [15, 30, 29, 33, 46, 41, 66, 48, 89, 54, 115, 66],
      {
        symmetry: { type: "vertical", centerX: 120, centerY: 80 },
      },
    );
    expect(renderer.begin(element).status).toBe("started");
    const live = renderer.appendFrom(element);
    expect(live.status).toBe("appended");
    const liveMarks = activeCanvas.recordedMarks.map((mark) => ({ ...mark }));
    expect(liveMarks.length).toBeGreaterThan(4);
    expect(new Set(liveMarks.map((mark) => mark.color)).size).toBeGreaterThan(1);
    expect(new Set(liveMarks.map((mark) => mark.alpha)).size).toBeGreaterThan(1);
    expect(activeCanvas.style.opacity).toBe("1");
    expect(presentationCanvas.style.opacity).toBe("1");
    expect(presentationCanvas.recordedCopies.length).toBeGreaterThan(0);
    expect(presentationCanvas.recordedCopies.at(-1)?.opacity).toBe(element.opacity);

    const sealed = renderer.end(element);
    expect(sealed.status).toBe("settled");
    if (sealed.status !== "settled") return;
    expect(sealed.markCount).toBeGreaterThan(sealed.dabCount * 2);
    expect(settledCanvas.recordedComposites).toHaveLength(1);
    const sealedComposite = structuredClone(settledCanvas.recordedComposites[0]!);
    expect(sealedComposite.opacity).toBe(element.opacity);
    expect(activeCanvas.recordedMarks).toHaveLength(0);

    renderer.setSurface({ ...SURFACE, left: 2 });
    expect(settledCanvas.recordedComposites).toHaveLength(1);
    const replayedComposite = settledCanvas.recordedComposites[0]!;
    expect(replayedComposite).toEqual(sealedComposite);

    // Quantified quality gate: seal→committed replay changes neither geometry, material nor alpha.
    const maximumDelta = replayedComposite.marks.reduce((maximum, mark, index) => {
      const sealedMark = sealedComposite.marks[index]!;
      return Math.max(
        maximum,
        Math.abs(mark.x - sealedMark.x),
        Math.abs(mark.y - sealedMark.y),
        Math.abs(mark.radiusX - sealedMark.radiusX),
        Math.abs(mark.radiusY - sealedMark.radiusY),
        Math.abs(mark.angleRadians - sealedMark.angleRadians),
        Math.abs(mark.alpha - sealedMark.alpha),
      );
    }, 0);
    expect(maximumDelta).toBe(0);
    expect(replayedComposite.marks.map((mark) => mark.color))
      .toEqual(sealedComposite.marks.map((mark) => mark.color));
  });

  it("recomposites only the changed live crop with Canvas2D alpha and clears it on cancel", () => {
    const {
      activeCanvas,
      presentationCanvas,
      renderer,
    } = attachedRenderer();
    const element = drawElement(
      "dirty-presentation",
      [30, 50, 42, 52, 56, 55, 72, 58],
      { opacity: 0.43, symmetry: { type: "none", centerX: 0, centerY: 0 } },
    );

    expect(renderer.begin(element).status).toBe("started");
    expect(renderer.appendFrom(element).status).toBe("appended");
    const copy = presentationCanvas.recordedCopies.at(-1);
    expect(copy).toBeDefined();
    expect(copy?.opacity).toBe(element.opacity);
    expect(copy?.sourceRect).toEqual(copy?.destinationRect);
    expect((copy?.sourceRect[2] ?? activeCanvas.width) * (copy?.sourceRect[3] ?? activeCanvas.height))
      .toBeLessThan(activeCanvas.width * activeCanvas.height);
    expect(activeCanvas.style.opacity).toBe("1");
    expect(presentationCanvas.style.opacity).toBe("1");

    const coverageClears = activeCanvas.clearCount();
    const presentationClears = presentationCanvas.clearCount();
    expect(renderer.resetActive()).toBe(true);
    expect(activeCanvas.clearCount()).toBe(coverageClears + 1);
    expect(presentationCanvas.clearCount()).toBe(presentationClears + 1);
    expect(activeCanvas.recordedMarks).toEqual([]);
    expect(presentationCanvas.recordedComposites).toEqual([]);
  });

  it("mirrors the dirty crop under flipX and clears live authority after settling", () => {
    const element = drawElement(
      "mirrored-dirty-presentation",
      [30, 50, 42, 52, 56, 55, 72, 58],
      { opacity: 0.43, symmetry: { type: "none", centerX: 0, centerY: 0 } },
    );
    const normal = attachedRenderer();
    expect(normal.renderer.begin(element).status).toBe("started");
    expect(normal.renderer.appendFrom(element).status).toBe("appended");
    const normalCopy = normal.presentationCanvas.recordedCopies.at(-1);
    expect(normalCopy).toBeDefined();

    const mirrored = attachedRenderer({ ...SURFACE, flipX: true });
    expect(mirrored.renderer.begin(element).status).toBe("started");
    expect(mirrored.renderer.appendFrom(element).status).toBe("appended");
    const mirroredCopy = mirrored.presentationCanvas.recordedCopies.at(-1);
    expect(mirroredCopy).toBeDefined();
    expect(mirroredCopy?.sourceRect).toEqual(mirroredCopy?.destinationRect);
    expect(mirroredCopy?.sourceRect[0]).toBe(
      mirrored.activeCanvas.width
        - (normalCopy?.sourceRect[0] ?? 0)
        - (normalCopy?.sourceRect[2] ?? 0),
    );
    expect(mirroredCopy?.sourceRect.slice(1)).toEqual(normalCopy?.sourceRect.slice(1));
    expect(
      (mirroredCopy?.sourceRect[2] ?? mirrored.activeCanvas.width)
        * (mirroredCopy?.sourceRect[3] ?? mirrored.activeCanvas.height),
    ).toBeLessThan(mirrored.activeCanvas.width * mirrored.activeCanvas.height);

    const activeClears = mirrored.activeCanvas.clearCount();
    const presentationClears = mirrored.presentationCanvas.clearCount();
    expect(mirrored.renderer.end(element).status).toBe("settled");
    expect(mirrored.activeCanvas.clearCount()).toBeGreaterThan(activeClears);
    expect(mirrored.presentationCanvas.clearCount()).toBeGreaterThan(presentationClears);
    expect(mirrored.activeCanvas.recordedMarks).toEqual([]);
    expect(mirrored.presentationCanvas.recordedComposites).toEqual([]);
    expect(mirrored.settledCanvas.recordedComposites).toHaveLength(1);

    expect(mirrored.renderer.releaseSettledPrefix(1)).toBe(1);
    expect(mirrored.settledCanvas.recordedComposites).toEqual([]);
  });

  it("releases only the acknowledged settled FIFO prefix", () => {
    const { renderer, settledCanvas } = attachedRenderer();
    const first = drawElement("first", [10, 12, 34, 18, 62, 26]);
    const second = drawElement("second", [14, 60, 42, 55, 78, 49]);
    expect(renderer.begin(first).status).toBe("started");
    expect(renderer.end(first).status).toBe("settled");
    expect(renderer.begin(second).status).toBe("started");
    expect(renderer.end(second).status).toBe("settled");
    expect(renderer.settledStrokeCount).toBe(2);
    const secondComposite = structuredClone(settledCanvas.recordedComposites[1]!);

    // One commit receipt acknowledges exactly one authoritative draft; the later stroke remains.
    expect(renderer.releaseSettledPrefix(1)).toBe(1);
    expect(renderer.settledStrokeCount).toBe(1);
    expect(settledCanvas.recordedComposites).toEqual([secondComposite]);
    expect(renderer.releaseSettledPrefix(99)).toBe(1);
    expect(renderer.settledStrokeCount).toBe(0);
    expect(settledCanvas.recordedComposites).toEqual([]);
  });

  it.each([2, 3])("keeps all three live canvases at native DPR %i", (devicePixelRatio) => {
    vi.stubGlobal("devicePixelRatio", devicePixelRatio);
    const {
      activeCanvas,
      presentationCanvas,
      renderer,
      settledCanvas,
    } = attachedRenderer();
    expect(renderer.begin(drawElement(`dpr-${devicePixelRatio}`, [4, 4])).status)
      .toBe("started");
    expect(activeCanvas.width).toBe(SURFACE.width * devicePixelRatio);
    expect(activeCanvas.height).toBe(SURFACE.height * devicePixelRatio);
    expect(presentationCanvas.width).toBe(SURFACE.width * devicePixelRatio);
    expect(presentationCanvas.height).toBe(SURFACE.height * devicePixelRatio);
    expect(settledCanvas.width).toBe(SURFACE.width * devicePixelRatio);
    expect(settledCanvas.height).toBe(SURFACE.height * devicePixelRatio);
  });

  it("parks only hidden coverage while idle and restores it before first-contact drawing", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const {
      activeCanvas,
      presentationCanvas,
      renderer,
      settledCanvas,
    } = attachedRenderer();

    expect([activeCanvas.width, activeCanvas.height]).toEqual([1, 1]);
    expect([presentationCanvas.width, presentationCanvas.height]).toEqual([
      SURFACE.width * 2,
      SURFACE.height * 2,
    ]);
    expect([settledCanvas.width, settledCanvas.height]).toEqual([
      SURFACE.width * 2,
      SURFACE.height * 2,
    ]);

    const element = drawElement("idle-coverage-restore", [24, 28, 70, 52]);
    expect(renderer.begin(element).status).toBe("started");
    expect([activeCanvas.width, activeCanvas.height]).toEqual([
      SURFACE.width * 2,
      SURFACE.height * 2,
    ]);
    expect(presentationCanvas.recordedMarks.length).toBeGreaterThan(0);
    expect(renderer.end(element).status).toBe("settled");

    expect([activeCanvas.width, activeCanvas.height]).toEqual([1, 1]);
    expect([presentationCanvas.width, presentationCanvas.height]).toEqual([
      SURFACE.width * 2,
      SURFACE.height * 2,
    ]);
    expect([settledCanvas.width, settledCanvas.height]).toEqual([
      SURFACE.width * 2,
      SURFACE.height * 2,
    ]);
    expect(settledCanvas.recordedComposites).toHaveLength(1);
  });

  it("re-parks restored coverage when another required surface context is unavailable", () => {
    const activeCanvas = recordingCanvas();
    const presentationCanvas = recordingCanvas();
    presentationCanvas.getContext = () => null;
    const settledCanvas = recordingCanvas();
    const renderer = new StudioLiveDynamicBrushOverlayRenderer();
    renderer.attach({ activeCanvas, presentationCanvas, settledCanvas });
    renderer.setSurface(SURFACE);

    expect([activeCanvas.width, activeCanvas.height]).toEqual([1, 1]);
    expect(renderer.begin(drawElement("missing-presentation-context", [24, 28]))).toEqual({
      status: "unavailable",
      reason: "surface-unavailable",
    });
    expect([activeCanvas.width, activeCanvas.height]).toEqual([1, 1]);
    expect([settledCanvas.width, settledCanvas.height]).toEqual([
      SURFACE.width,
      SURFACE.height,
    ]);
  });

  it("re-parks deferred coverage when append flushes after the surface becomes unavailable", () => {
    let pendingFrame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      pendingFrame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("PerformanceObserver", class {
      static readonly supportedEntryTypes = ["longtask"];
    });
    const { activeCanvas, renderer } = attachedRenderer();
    const element = drawElement("deferred-surface-unavailable", [24, 28, 70, 52]);

    expect(renderer.begin(element)).toMatchObject({ status: "started" });
    expect(renderer.hasPendingBegin).toBe(true);
    expect(pendingFrame).not.toBeNull();
    expect([activeCanvas.width, activeCanvas.height]).toEqual([
      SURFACE.width,
      SURFACE.height,
    ]);

    renderer.setSurface(null);
    expect(renderer.appendFrom(element)).toEqual({
      status: "unavailable",
      reason: "surface-budget",
    });
    expect(renderer.hasPendingBegin).toBe(false);
    expect([activeCanvas.width, activeCanvas.height]).toEqual([1, 1]);
  });

  it("fails closed and keeps only three cleared 1x1 stores when native DPR exceeds budget", () => {
    vi.stubGlobal("devicePixelRatio", 3);
    const dimension = Math.floor(
      Math.sqrt(STUDIO_LIVE_SURFACE_MAX_BACKING_PIXELS / 3),
    );
    const {
      activeCanvas,
      presentationCanvas,
      renderer,
      settledCanvas,
    } = attachedRenderer({
      ...SURFACE,
      width: dimension,
      height: dimension,
      documentWidth: dimension,
    });
    expect(renderer.begin(drawElement("native-budget", [4, 4]))).toEqual({
      status: "unavailable",
      reason: "surface-budget",
    });
    expect(renderer.backingPixelCount).toBe(3);
    expect([
      activeCanvas.width,
      activeCanvas.height,
      presentationCanvas.width,
      presentationCanvas.height,
      settledCanvas.width,
      settledCanvas.height,
    ]).toEqual([1, 1, 1, 1, 1, 1]);
    expect(activeCanvas.recordedMarks).toEqual([]);
    expect(presentationCanvas.recordedComposites).toEqual([]);
    expect(settledCanvas.recordedComposites).toEqual([]);
  });

  it("releases an existing 64MiB-class backing allocation when the surface is unavailable", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const dimension = Math.floor(
      Math.sqrt(STUDIO_LIVE_SURFACE_MAX_BACKING_PIXELS / 3),
    );
    const {
      activeCanvas,
      presentationCanvas,
      renderer,
      settledCanvas,
    } = attachedRenderer({
      ...SURFACE,
      width: dimension,
      height: dimension,
      documentWidth: dimension,
    });
    expect(renderer.backingPixelCount).toBe(2 * dimension * dimension + 1);

    renderer.setSurface({
      ...SURFACE,
      width: dimension + 1,
      height: dimension + 1,
      documentWidth: dimension + 1,
    });

    expect(renderer.begin(drawElement("surface-budget-release", [4, 4]))).toEqual({
      status: "unavailable",
      reason: "surface-budget",
    });
    expect(renderer.backingPixelCount).toBe(3);
    expect([
      activeCanvas.width,
      activeCanvas.height,
      presentationCanvas.width,
      presentationCanvas.height,
      settledCanvas.width,
      settledCanvas.height,
    ]).toEqual([1, 1, 1, 1, 1, 1]);
    expect(activeCanvas.clearCount()).toBeGreaterThan(0);
    expect(presentationCanvas.clearCount()).toBeGreaterThan(0);
    expect(settledCanvas.clearCount()).toBeGreaterThan(0);
  });

  it("releases existing stores when a DPR increase would require a reduced live surface", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const dimension = 2_200;
    const {
      activeCanvas,
      presentationCanvas,
      renderer,
      settledCanvas,
    } = attachedRenderer({
      ...SURFACE,
      width: dimension,
      height: dimension,
      documentWidth: dimension,
    });
    expect(renderer.backingPixelCount).toBe(2 * dimension * dimension + 1);

    vi.stubGlobal("devicePixelRatio", 3);
    renderer.setSurface({
      ...SURFACE,
      left: 1,
      width: dimension,
      height: dimension,
      documentWidth: dimension,
    });

    expect(renderer.begin(drawElement("native-dpr-release", [4, 4]))).toEqual({
      status: "unavailable",
      reason: "surface-budget",
    });
    expect(renderer.backingPixelCount).toBe(3);
    expect([
      activeCanvas.width,
      activeCanvas.height,
      presentationCanvas.width,
      presentationCanvas.height,
      settledCanvas.width,
      settledCanvas.height,
    ]).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("crops the settle flatten to the whole-stroke dirty union with pixel-identical coverage", () => {
    const anchors = [
      [24, 28],
      [70, 52],
      [122, 84],
      [188, 122],
    ] as const;
    const elementAt = (count: number) => drawElement(
      "settle-dirty-union",
      anchors.slice(0, count).flat(),
      {
        brush: "ink-particle",
        brushDynamics: segmentedCausalOverlayDynamics(),
        strokeWidth: 2,
        pressures: Array.from({ length: count }, () => 0.7),
      },
    );

    const live = attachedRenderer();
    expect(live.renderer.begin(elementAt(1)).status).toBe("started");
    expect(live.renderer.appendFrom(elementAt(2)).status).toBe("appended");
    expect(live.renderer.appendFrom(elementAt(4)).status).toBe("appended");
    expect(live.renderer.end(elementAt(4)).status).toBe("settled");

    // The settle flatten is one identity-mapped copy cropped strictly below the full surface.
    expect(live.settledCanvas.recordedCopies).toHaveLength(1);
    const settleCopy = live.settledCanvas.recordedCopies[0]!;
    expect(settleCopy.sourceRect).toEqual(settleCopy.destinationRect);
    const [cropX, cropY, cropWidth, cropHeight] = settleCopy.sourceRect;
    expect(cropWidth).toBeGreaterThan(0);
    expect(cropHeight).toBeGreaterThan(0);
    expect(cropWidth).toBeLessThan(live.presentationCanvas.width);
    expect(cropHeight).toBeLessThan(live.presentationCanvas.height);

    // Pixel identity: every retained mark footprint sits inside the crop, so the pixels outside
    // the crop that the flatten no longer copies were never painted on the active surface.
    const retained = live.settledCanvas.recordedComposites;
    expect(retained).toHaveLength(1);
    expect(retained[0]!.marks.length).toBeGreaterThan(0);
    for (const mark of retained[0]!.marks) {
      const cosine = Math.cos(mark.angleRadians);
      const sine = Math.sin(mark.angleRadians);
      const extentX = Math.hypot(mark.radiusX * cosine, mark.radiusY * sine);
      const extentY = Math.hypot(mark.radiusX * sine, mark.radiusY * cosine);
      expect(mark.x - extentX).toBeGreaterThanOrEqual(cropX);
      expect(mark.x + extentX).toBeLessThanOrEqual(cropX + cropWidth);
      expect(mark.y - extentY).toBeGreaterThanOrEqual(cropY);
      expect(mark.y + extentY).toBeLessThanOrEqual(cropY + cropHeight);
    }

    // With-crop/without-incremental-frames equivalence: a one-shot pointer-up reference produces
    // the same retained composite and the same crop, because the per-frame rect union distributes
    // over the one-shot whole-stroke rect.
    const reference = attachedRenderer();
    expect(reference.renderer.begin(elementAt(4)).status).toBe("started");
    expect(reference.renderer.end(elementAt(4)).status).toBe("settled");
    expect(reference.settledCanvas.recordedCopies).toHaveLength(1);
    expect(reference.settledCanvas.recordedCopies[0]!.sourceRect)
      .toEqual(settleCopy.sourceRect);
    expect(live.settledCanvas.recordedComposites)
      .toEqual(reference.settledCanvas.recordedComposites);
  });

  it("keeps the fail-safe full-surface settle copy when the dirty union is empty", () => {
    // Every mark of this stroke lands outside the clipped live viewport, so no per-frame paint
    // rect exists. The flatten must still settle through the legacy full-surface copy instead of
    // calling drawImage with a degenerate crop.
    const { renderer, settledCanvas } = attachedRenderer();
    const element = drawElement(
      "settle-empty-union",
      [400, 300, 460, 320, 520, 340],
      {
        brush: "ink-particle",
        brushDynamics: segmentedCausalOverlayDynamics(),
        strokeWidth: 2,
        pressures: [0.7, 0.7, 0.7],
      },
    );
    expect(renderer.begin(element).status).toBe("started");
    expect(renderer.appendFrom(element).status).toBe("appended");
    expect(renderer.end(element).status).toBe("settled");

    expect(settledCanvas.recordedCopies).toEqual([]);
    expect(settledCanvas.recordedComposites).toHaveLength(1);
    expect(settledCanvas.recordedComposites[0]!.opacity).toBe(element.opacity);
    expect(renderer.lastOperationFailureReason).toBeNull();
  });

  it("does not seal an active stroke after its backing surface is released", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const dimension = Math.floor(
      Math.sqrt(STUDIO_LIVE_SURFACE_MAX_BACKING_PIXELS / 3),
    );
    const { renderer, settledCanvas } = attachedRenderer();
    const element = drawElement(
      "surface-released-before-end",
      [10, 20, 34, 24, 58, 31],
      { brushDynamics: segmentedCausalOverlayDynamics() },
    );
    expect(renderer.begin(element).status).toBe("started");
    expect(renderer.appendFrom(element).status).toBe("appended");

    renderer.setSurface({
      ...SURFACE,
      width: dimension + 1,
      height: dimension + 1,
      documentWidth: dimension + 1,
    });

    expect(renderer.backingPixelCount).toBe(3);
    expect(renderer.end(element)).toEqual({
      status: "unavailable",
      reason: "surface-budget",
    });
    expect(settledCanvas.recordedComposites).toEqual([]);
  });
});
