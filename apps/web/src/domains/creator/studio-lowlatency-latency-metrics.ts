/**
 * Pure input-to-present latency math.
 *
 * "The stroke feels faster" is not a claim this repo can currently check. This module turns a
 * recorded pair of timelines — when each input sample was produced, and when each frame carrying it
 * was presented — into a distribution that can be diffed between builds.
 *
 * The model deliberately measures *presentation*, not paint scheduling: a present record is created
 * when the compositor has actually shown a frame (rAF timestamp of the following frame, or a
 * `requestAnimationFrame`-paired `performance.now()` reading at flush time). Everything here is
 * clock-domain agnostic and assumes the caller has already mapped both timelines onto one clock —
 * the repo already owns that mapping in `studio-fixed-rate-stroke-frame-pump`.
 */

export interface StudioLatencyInputSample {
  /** Stable identity, unique within one measurement window. */
  readonly id: string | number;
  /** Sample production time on the shared clock. */
  readonly timeStamp: number;
}

export interface StudioLatencyPresent {
  /** Presentation time on the shared clock. */
  readonly presentedAt: number;
  /** Ids of the input samples first visible in this present. */
  readonly inputIds: readonly (string | number)[];
}

export interface StudioLatencyDistribution {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly min: number;
  readonly mean: number;
  /** Samples that never appeared in any present record. */
  readonly unpresented: number;
  /** Presents that claimed a sample earlier than the sample existed, or had unusable timing. */
  readonly invalid: number;
}

const EMPTY_DISTRIBUTION: StudioLatencyDistribution = Object.freeze({
  count: 0,
  p50: 0,
  p95: 0,
  max: 0,
  min: 0,
  mean: 0,
  unpresented: 0,
  invalid: 0,
});

function isFinitePositiveOrZero(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Nearest-rank percentile over an already-sorted ascending series.
 *
 * Nearest-rank (rather than linear interpolation) keeps the reported value an actually observed
 * latency, which matters when a regression report has to be reproduced from a trace.
 */
export function studioLowLatencyPercentile(
  sortedAscending: readonly number[],
  percentile: number
): number {
  if (sortedAscending.length === 0) return 0;
  const clamped = Number.isFinite(percentile) ? Math.min(100, Math.max(0, percentile)) : 0;
  const rank = Math.ceil((clamped / 100) * sortedAscending.length);
  const index = Math.min(sortedAscending.length - 1, Math.max(0, rank - 1));
  return sortedAscending[index] ?? 0;
}

/**
 * Computes the input-to-present latency distribution.
 *
 * A sample's latency is the presentation time of the *first* present that carried it minus the
 * sample's own timestamp. Later presents carrying the same id are ignored: re-presenting an already
 * visible sample is a redraw, not additional latency.
 */
export function studioInputToPresentLatency(
  inputs: readonly StudioLatencyInputSample[],
  presents: readonly StudioLatencyPresent[]
): StudioLatencyDistribution {
  if (inputs.length === 0) return EMPTY_DISTRIBUTION;

  const inputTime = new Map<string | number, number>();
  let invalid = 0;
  for (const input of inputs) {
    if (!isFinitePositiveOrZero(input.timeStamp)) {
      invalid += 1;
      continue;
    }
    // A duplicated id is a caller bug; keeping the earliest keeps the metric pessimistic.
    const existing = inputTime.get(input.id);
    if (existing === undefined || input.timeStamp < existing) inputTime.set(input.id, input.timeStamp);
  }

  const firstPresent = new Map<string | number, number>();
  // Presents may be recorded out of order by a batching probe; resolving "first" by presentation
  // time rather than array order keeps the metric independent of collection order.
  for (const present of presents) {
    if (!isFinitePositiveOrZero(present.presentedAt)) {
      invalid += 1;
      continue;
    }
    for (const id of present.inputIds) {
      const existing = firstPresent.get(id);
      if (existing === undefined || present.presentedAt < existing) {
        firstPresent.set(id, present.presentedAt);
      }
    }
  }

  const latencies: number[] = [];
  let unpresented = 0;
  for (const [id, produced] of inputTime) {
    const presented = firstPresent.get(id);
    if (presented === undefined) {
      unpresented += 1;
      continue;
    }
    const latency = presented - produced;
    if (latency < 0) {
      // A frame cannot show a sample that did not exist yet; this is a clock-domain mistake.
      invalid += 1;
      continue;
    }
    latencies.push(latency);
  }

  if (latencies.length === 0) {
    return { ...EMPTY_DISTRIBUTION, unpresented, invalid };
  }

  latencies.sort((left, right) => left - right);
  let total = 0;
  for (const latency of latencies) total += latency;

  return {
    count: latencies.length,
    p50: studioLowLatencyPercentile(latencies, 50),
    p95: studioLowLatencyPercentile(latencies, 95),
    max: latencies[latencies.length - 1] ?? 0,
    min: latencies[0] ?? 0,
    mean: total / latencies.length,
    unpresented,
    invalid,
  };
}

export interface StudioLatencyComparison {
  readonly p50Delta: number;
  readonly p95Delta: number;
  readonly maxDelta: number;
  readonly meanDelta: number;
  /** Fractional p95 change; negative means the candidate is faster. */
  readonly p95Ratio: number;
  readonly improved: boolean;
}

/**
 * Diffs two distributions. `improved` uses p95 rather than p50 because pen feel is dominated by the
 * worst frames a user notices, not by the median.
 */
export function compareStudioLatencyDistributions(
  baseline: StudioLatencyDistribution,
  candidate: StudioLatencyDistribution
): StudioLatencyComparison {
  const p95Delta = candidate.p95 - baseline.p95;
  return {
    p50Delta: candidate.p50 - baseline.p50,
    p95Delta,
    maxDelta: candidate.max - baseline.max,
    meanDelta: candidate.mean - baseline.mean,
    p95Ratio: baseline.p95 > 0 ? p95Delta / baseline.p95 : 0,
    improved: p95Delta < 0,
  };
}

export interface StudioLatencyRecorderOptions {
  /** Bounded ring size. Older samples are dropped so a long session cannot grow the recorder. */
  readonly capacity?: number;
}

export const STUDIO_LATENCY_RECORDER_DEFAULT_CAPACITY = 4_096;

/**
 * Bounded collector for live measurement.
 *
 * It performs no timing of its own: the caller supplies both clocks, which keeps the recorder
 * usable from tests, from a worker, and from a synchronous burst probe without a fake global clock.
 */
export class StudioLatencyRecorder {
  private readonly capacity: number;
  private readonly inputs: StudioLatencyInputSample[] = [];
  private readonly presents: StudioLatencyPresent[] = [];

  constructor(options: StudioLatencyRecorderOptions = {}) {
    const requested = options.capacity;
    this.capacity = typeof requested === "number" && Number.isFinite(requested) && requested >= 1
      ? Math.floor(requested)
      : STUDIO_LATENCY_RECORDER_DEFAULT_CAPACITY;
  }

  recordInput(id: string | number, timeStamp: number): void {
    this.inputs.push({ id, timeStamp });
    if (this.inputs.length > this.capacity) this.inputs.shift();
  }

  recordPresent(presentedAt: number, inputIds: readonly (string | number)[]): void {
    this.presents.push({ presentedAt, inputIds: [...inputIds] });
    if (this.presents.length > this.capacity) this.presents.shift();
  }

  snapshot(): StudioLatencyDistribution {
    return studioInputToPresentLatency(this.inputs, this.presents);
  }

  clear(): void {
    this.inputs.length = 0;
    this.presents.length = 0;
  }
}
