import type { StudioBrushMediaPixelImage } from "./studio-brush-media-pixel-quality";

/**
 * Multi-stroke scenario quality — the metrics the single-stroke long matrix cannot see.
 *
 * The long matrix draws one straight stroke and compares live/released/settled frames. Real
 * drawing crosses strokes, layers brushes over each other, taps, flicks and lifts. Each of those
 * has its own way of being wrong, and every one of them was reported by artists before it was
 * measured:
 *
 *  - flicker: the overlay clears before the retained document paints, so a stroke vanishes for a
 *    frame (or several) right after pointer-up and comes back — visible as a blink;
 *  - crossing drift: where a second stroke crosses a first, the live composite and the committed
 *    composite disagree (the overlay blends differently from the retained layer);
 *  - cap drift: the live pointer-down cap or the pointer-up cap exists only in one representation.
 *
 * Every function here is pure over decoded frames so the verifier's judgement is unit-testable.
 */

export interface StudioBrushScenarioRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioBrushScenarioMaskStats {
  readonly count: number;
  readonly bounds: Readonly<{ left: number; top: number; right: number; bottom: number }> | null;
}

export interface StudioBrushScenarioFlickerAnalysis {
  /** Ink pixels (vs baseline) of every captured frame after pointer-up, in capture order. */
  readonly counts: readonly number[];
  /** Largest fractional drop from one frame to the next. */
  readonly maxDropRatio: number;
  /** Index of the frame that dipped, when a dip later recovered. */
  readonly dipFrame: number | null;
  readonly verdict: "stable" | "flicker" | "vanish" | "empty";
}

/** One presented frame while the pointer is still down. */
export interface StudioBrushScenarioInStrokeFrame {
  readonly tMs: number;
  /** Ink pixels inside the judged region, measured against the pre-gesture frame. */
  readonly ink: number;
}

export interface StudioBrushScenarioInStrokeAnalysis {
  readonly frameCount: number;
  readonly peakInk: number;
  /** Deepest fall below the running maximum, as a fraction of that maximum. */
  readonly worstDropRatio: number;
  readonly worstDropAtMs: number | null;
  /** Frames that fell past the threshold and were painted again afterwards. */
  readonly blinkCount: number;
  readonly verdict: "stable" | "blink" | "too-few-frames";
}

export interface StudioBrushScenarioDiscrepancy {
  readonly liveInk: number;
  readonly releasedInk: number;
  readonly liveOnly: number;
  readonly releasedOnly: number;
  readonly shared: number;
  /** XOR / union of the two ink masks, 0 = identical silhouette, 1 = disjoint. */
  readonly shapeDifferenceRatio: number;
  /** Mean per-channel delta over pixels inked in both frames. */
  readonly sharedMeanDelta: number;
}

export interface StudioBrushScenarioFinding {
  readonly level: "error" | "warning";
  readonly code:
    | "post-release-flicker"
    | "post-release-vanish"
    | "post-release-empty"
    | "crossing-live-commit-drift"
    | "crossing-live-commit-tone"
    | "start-cap-live-commit-drift"
    | "end-cap-live-commit-drift"
    | "eraser-gap-missing"
    | "eraser-live-commit-drift"
    | "long-task"
    | "frame-stall"
    | "stroke-refused"
    | "undo-residue"
    | "buildup-lost"
    | "in-stroke-flicker";
  readonly message: string;
}

function assertSameGeometry(a: StudioBrushMediaPixelImage, b: StudioBrushMediaPixelImage): void {
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) {
    throw new Error(
      `scenario frames differ in geometry: ${a.width}x${a.height}x${a.channels} vs `
        + `${b.width}x${b.height}x${b.channels}`,
    );
  }
}

/** 1 where any colour channel moved more than `tolerance` code values from the baseline. */
export function studioBrushScenarioInkMask(
  baseline: StudioBrushMediaPixelImage,
  frame: StudioBrushMediaPixelImage,
  tolerance = 12,
): Uint8Array {
  assertSameGeometry(baseline, frame);
  const channels = Math.min(3, baseline.channels);
  const pixels = baseline.width * baseline.height;
  const mask = new Uint8Array(pixels);
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * baseline.channels;
    for (let channel = 0; channel < channels; channel += 1) {
      if (Math.abs(baseline.data[offset + channel]! - frame.data[offset + channel]!) > tolerance) {
        mask[index] = 1;
        break;
      }
    }
  }
  return mask;
}

export function studioBrushScenarioMaskStats(
  mask: Uint8Array,
  width: number,
  height: number,
  region?: StudioBrushScenarioRegion,
): StudioBrushScenarioMaskStats {
  const x0 = region ? Math.max(0, Math.floor(region.x)) : 0;
  const y0 = region ? Math.max(0, Math.floor(region.y)) : 0;
  const x1 = region ? Math.min(width, Math.ceil(region.x + region.width)) : width;
  const y1 = region ? Math.min(height, Math.ceil(region.y + region.height)) : height;
  let count = 0;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (mask[y * width + x] === 0) continue;
      count += 1;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return {
    count,
    bounds: count === 0 ? null : { left, top, right, bottom },
  };
}

/**
 * Post-release frame series. A stroke that is painted by the live overlay and then by the retained
 * document must never be painted by neither: a dip that recovers is a blink, a dip that never
 * recovers is a stroke that vanished.
 */
export function analyzeStudioBrushScenarioFlicker(
  baseline: StudioBrushMediaPixelImage,
  frames: readonly StudioBrushMediaPixelImage[],
  tolerance = 12,
): StudioBrushScenarioFlickerAnalysis {
  const counts = frames.map((frame) =>
    studioBrushScenarioMaskStats(
      studioBrushScenarioInkMask(baseline, frame, tolerance),
      baseline.width,
      baseline.height,
    ).count,
  );
  if (counts.length === 0 || Math.max(...counts) < 4) {
    return { counts, maxDropRatio: 0, dipFrame: null, verdict: "empty" };
  }
  let maxDropRatio = 0;
  let dipFrame: number | null = null;
  for (let index = 1; index < counts.length; index += 1) {
    const previous = counts[index - 1]!;
    const current = counts[index]!;
    if (previous < 4) continue;
    const drop = 1 - current / previous;
    if (drop > maxDropRatio) maxDropRatio = drop;
    // A dip is a frame that lost more than half of its predecessor's ink while a later frame
    // holds at least three quarters of that predecessor again.
    if (dipFrame === null && drop > 0.5) {
      const recovered = counts.slice(index + 1).some((later) => later >= previous * 0.75);
      if (recovered) dipFrame = index;
    }
  }
  if (dipFrame !== null) {
    return { counts, maxDropRatio, dipFrame, verdict: "flicker" };
  }
  const first = counts[0]!;
  const last = counts[counts.length - 1]!;
  if (first >= 4 && last < first * 0.25) {
    return { counts, maxDropRatio, dipFrame: null, verdict: "vanish" };
  }
  return { counts, maxDropRatio, dipFrame: null, verdict: "stable" };
}

/** Live vs released silhouettes and tone inside one region. */
/**
 * Every frame the compositor presented while the pointer was still down.
 *
 * The post-release series above only watches the overlay -> document hand-off, which is one frame
 * at the end of a gesture. It is structurally blind to the thing artists actually report: a line
 * that blinks *while they are still drawing it*. This is the check for that, and its contract is
 * the simplest one in the file — a gesture only ever adds ink, so the ink already on screen cannot
 * go away before the pointer comes up. A frame that falls well under the running maximum and is
 * repainted afterwards is a blink the artist saw.
 *
 * `dropRatio` is deliberately loose (a third of the stroke gone) because the series is measured
 * from lossy screencast frames; a real blink drops most of the stroke, not a few edge pixels.
 */
export function analyzeStudioBrushScenarioInStroke(
  frames: readonly StudioBrushScenarioInStrokeFrame[],
  options: { readonly inkFloor?: number; readonly dropRatio?: number } = {},
): StudioBrushScenarioInStrokeAnalysis {
  const inkFloor = options.inkFloor ?? 200;
  const dropRatio = options.dropRatio ?? 0.35;
  const started = frames.findIndex((frame) => frame.ink >= inkFloor);
  if (started < 0 || frames.length - started < 4) {
    return {
      frameCount: frames.length,
      peakInk: frames.reduce((peak, frame) => Math.max(peak, frame.ink), 0),
      worstDropRatio: 0,
      worstDropAtMs: null,
      blinkCount: 0,
      verdict: "too-few-frames",
    };
  }
  let runningMax = 0;
  let worstDropRatio = 0;
  let worstDropAtMs: number | null = null;
  let blinkCount = 0;
  const dipped: number[] = [];
  for (let index = started; index < frames.length; index += 1) {
    const { ink, tMs } = frames[index]!;
    if (ink > runningMax) {
      // Anything that dipped before this frame has now been painted over again: those were blinks.
      blinkCount += dipped.length;
      dipped.length = 0;
      runningMax = ink;
      continue;
    }
    const drop = (runningMax - ink) / runningMax;
    if (drop <= dropRatio) continue;
    dipped.push(index);
    if (drop > worstDropRatio) {
      worstDropRatio = drop;
      worstDropAtMs = tMs;
    }
  }
  return {
    frameCount: frames.length,
    peakInk: runningMax,
    worstDropRatio,
    worstDropAtMs,
    blinkCount,
    verdict: blinkCount > 0 ? "blink" : "stable",
  };
}

export function analyzeStudioBrushScenarioDiscrepancy(
  baseline: StudioBrushMediaPixelImage,
  live: StudioBrushMediaPixelImage,
  released: StudioBrushMediaPixelImage,
  region: StudioBrushScenarioRegion,
  tolerance = 12,
): StudioBrushScenarioDiscrepancy {
  assertSameGeometry(baseline, live);
  assertSameGeometry(baseline, released);
  const liveMask = studioBrushScenarioInkMask(baseline, live, tolerance);
  const releasedMask = studioBrushScenarioInkMask(baseline, released, tolerance);
  const channels = Math.min(3, baseline.channels);
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(baseline.width, Math.ceil(region.x + region.width));
  const y1 = Math.min(baseline.height, Math.ceil(region.y + region.height));
  let liveOnly = 0;
  let releasedOnly = 0;
  let shared = 0;
  let sharedDelta = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = y * baseline.width + x;
      const inLive = liveMask[index] === 1;
      const inReleased = releasedMask[index] === 1;
      if (inLive && inReleased) {
        shared += 1;
        const offset = index * baseline.channels;
        let delta = 0;
        for (let channel = 0; channel < channels; channel += 1) {
          delta += Math.abs(live.data[offset + channel]! - released.data[offset + channel]!);
        }
        sharedDelta += delta / channels;
      } else if (inLive) {
        liveOnly += 1;
      } else if (inReleased) {
        releasedOnly += 1;
      }
    }
  }
  const union = liveOnly + releasedOnly + shared;
  return {
    liveInk: liveOnly + shared,
    releasedInk: releasedOnly + shared,
    liveOnly,
    releasedOnly,
    shared,
    shapeDifferenceRatio: union === 0 ? 0 : (liveOnly + releasedOnly) / union,
    sharedMeanDelta: shared === 0 ? 0 : sharedDelta / shared,
  };
}

export interface StudioBrushScenarioJudgementInput {
  readonly softWet: boolean;
  readonly transparent: boolean;
  /** Opaque by material (stroke opacity at 1): it has no headroom, so there is no ladder to judge. */
  readonly opaque?: boolean;
}

function finding(
  level: StudioBrushScenarioFinding["level"],
  code: StudioBrushScenarioFinding["code"],
  message: string,
): StudioBrushScenarioFinding {
  return { level, code, message };
}

export function judgeStudioBrushScenarioFlicker(
  flicker: StudioBrushScenarioFlickerAnalysis,
  input: StudioBrushScenarioJudgementInput,
): StudioBrushScenarioFinding[] {
  if (input.transparent) return [];
  switch (flicker.verdict) {
    case "flicker":
      return [finding(
        "error",
        "post-release-flicker",
        `ink dipped to ${flicker.counts[flicker.dipFrame!]} px at post-release frame `
          + `${flicker.dipFrame} (${flicker.counts.join(",")})`,
      )];
    case "vanish":
      return [finding(
        "error",
        "post-release-vanish",
        `ink fell from ${flicker.counts[0]} to ${flicker.counts[flicker.counts.length - 1]} px `
          + `after pointer-up (${flicker.counts.join(",")})`,
      )];
    case "empty":
      return [finding("error", "post-release-empty", "no ink in any post-release frame")];
    default:
      return [];
  }
}

export function judgeStudioBrushScenarioInStroke(
  analysis: StudioBrushScenarioInStrokeAnalysis,
  input: StudioBrushScenarioJudgementInput,
): StudioBrushScenarioFinding[] {
  if (input.transparent) return [];
  if (analysis.verdict !== "blink") return [];
  return [finding(
    "error",
    "in-stroke-flicker",
    `ink vanished and came back ${analysis.blinkCount}x while the pointer was down `
      + `(worst ${Math.round(analysis.worstDropRatio * 100)}% of ${analysis.peakInk} px gone at `
      + `${Math.round(analysis.worstDropAtMs ?? 0)} ms, ${analysis.frameCount} frames)`,
  )];
}

/**
 * Crossing and cap regions compare live against released silhouettes. Soft/wet media settle their
 * edges for a moment after pointer-up, so their bound is looser; a transparent wash records only.
 */
export function judgeStudioBrushScenarioDiscrepancy(
  discrepancy: StudioBrushScenarioDiscrepancy,
  code: Extract<
    StudioBrushScenarioFinding["code"],
    | "crossing-live-commit-drift"
    | "start-cap-live-commit-drift"
    | "end-cap-live-commit-drift"
    | "eraser-live-commit-drift"
  >,
  input: StudioBrushScenarioJudgementInput,
): StudioBrushScenarioFinding[] {
  if (input.transparent) return [];
  const findings: StudioBrushScenarioFinding[] = [];
  const union = discrepancy.liveOnly + discrepancy.releasedOnly + discrepancy.shared;
  if (union < 16) return findings;
  const shapeLimit = input.softWet ? 0.72 : 0.55;
  const shapeWarn = input.softWet ? 0.5 : 0.35;
  if (discrepancy.shapeDifferenceRatio > shapeLimit) {
    findings.push(finding(
      "error",
      code,
      `live/committed silhouettes differ by ${(discrepancy.shapeDifferenceRatio * 100).toFixed(1)}% `
        + `(live-only ${discrepancy.liveOnly}, committed-only ${discrepancy.releasedOnly}, `
        + `shared ${discrepancy.shared})`,
    ));
  } else if (discrepancy.shapeDifferenceRatio > shapeWarn) {
    findings.push(finding(
      "warning",
      code,
      `live/committed silhouettes differ by ${(discrepancy.shapeDifferenceRatio * 100).toFixed(1)}%`,
    ));
  }
  if (code === "crossing-live-commit-drift" && discrepancy.shared >= 16) {
    const toneLimit = input.softWet ? 48 : 32;
    if (discrepancy.sharedMeanDelta > toneLimit) {
      findings.push(finding(
        "warning",
        "crossing-live-commit-tone",
        `shared crossing pixels moved ${discrepancy.sharedMeanDelta.toFixed(1)} code values `
          + "between live and committed",
      ));
    }
  }
  return findings;
}

export interface StudioBrushScenarioPerfSample {
  readonly longTasks: readonly number[];
  readonly frameGapsMs: readonly number[];
}

export function judgeStudioBrushScenarioPerf(
  perf: StudioBrushScenarioPerfSample,
): StudioBrushScenarioFinding[] {
  const findings: StudioBrushScenarioFinding[] = [];
  const worstTask = perf.longTasks.length === 0 ? 0 : Math.max(...perf.longTasks);
  if (worstTask >= 200) {
    findings.push(finding(
      "error",
      "long-task",
      `a ${worstTask.toFixed(0)} ms task blocked the main thread during the gesture `
        + `(${perf.longTasks.length} long tasks)`,
    ));
  } else if (worstTask >= 100) {
    findings.push(finding(
      "warning",
      "long-task",
      `a ${worstTask.toFixed(0)} ms task blocked the main thread during the gesture`,
    ));
  }
  const stalls = perf.frameGapsMs.filter((gap) => gap >= 250);
  if (stalls.length > 0) {
    findings.push(finding(
      "warning",
      "frame-stall",
      `${stalls.length} animation frame(s) stalled ≥250 ms (worst ${Math.max(...stalls).toFixed(0)} ms)`,
    ));
  }
  return findings;
}

/**
 * How many stacked passes the build-up ladder must still be climbing, and by how much.
 *
 * Mirrors the planner-side contract pinned in
 * `apps/web/src/domains/creator/brush/studio-pencil-alias-passes.test.ts` ("stacking the same stroke gets
 * monotonically darker for at least the first 5 passes"). One 8-bit code value is the smallest
 * difference a pixel can carry, so a pass that adds less than that added nothing an artist can see.
 */
export const STUDIO_BRUSH_BUILDUP_LADDER_PASSES = 5;
export const STUDIO_BRUSH_BUILDUP_MIN_PASS_GAIN = 1;

/**
 * The same-place-20-times ladder.
 *
 * The first cut of this judge only compared pass 1 against pass 20 at a 1.05 ratio, and that is
 * blind to the failure it was written for: `pencil` at defaultOpacity 0.85 measured
 * 82.9 → 91.1 → 95.0 → 97.0 → 97.9 → 98.4, a 1.19 overall ratio that sails past the ratio gate
 * while pass 5 adds 0.9 of a code value — the ladder is over by the third stroke and an artist
 * cannot build tone. So judge the ladder itself.
 *
 * A brush that gains nothing on pass 2 is opaque in one stroke (pen at opacity 1, a 6B laid flat)
 * and has no build-up to lose; only a brush that demonstrably started climbing is held to keeping
 * it up through pass `STUDIO_BRUSH_BUILDUP_LADDER_PASSES`.
 */
export function judgeStudioBrushScenarioBuildupLadder(
  meanDarkness: readonly number[],
  input: StudioBrushScenarioJudgementInput,
): StudioBrushScenarioFinding[] {
  if (input.transparent) return [];
  // A brush that is opaque by material paints its ceiling on the first pass. What its second
  // pass adds is anti-aliased edge coverage, not tone — measured on the pen: 89.8 -> 92.1 over
  // twenty passes — and reading that as a ladder that then died is the judge inventing a contract
  // the medium never made.
  if (input.opaque) return [];
  if (meanDarkness.length < STUDIO_BRUSH_BUILDUP_LADDER_PASSES) return [];
  const gain = (pass: number): number => meanDarkness[pass - 1]! - meanDarkness[pass - 2]!;
  if (gain(2) < STUDIO_BRUSH_BUILDUP_MIN_PASS_GAIN) return [];
  for (let pass = 3; pass <= STUDIO_BRUSH_BUILDUP_LADDER_PASSES; pass += 1) {
    if (gain(pass) >= STUDIO_BRUSH_BUILDUP_MIN_PASS_GAIN) continue;
    return [finding(
      "error",
      "buildup-lost",
      `stacking stopped darkening at pass ${pass}: it added ${gain(pass).toFixed(2)} code values `
        + `where pass 2 added ${gain(2).toFixed(2)} `
        + `(${meanDarkness.slice(0, STUDIO_BRUSH_BUILDUP_LADDER_PASSES)
          .map((value) => value.toFixed(1)).join(" → ")})`,
    )];
  }
  return [];
}

/** Square region around a point, clamped to the frame. */
export function studioBrushScenarioPointRegion(
  point: Readonly<{ x: number; y: number }>,
  radius: number,
  frame: Readonly<{ width: number; height: number }>,
): StudioBrushScenarioRegion {
  const x = Math.max(0, Math.floor(point.x - radius));
  const y = Math.max(0, Math.floor(point.y - radius));
  const right = Math.min(frame.width, Math.ceil(point.x + radius));
  const bottom = Math.min(frame.height, Math.ceil(point.y + radius));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}
