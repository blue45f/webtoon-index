import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  materializeStudioBrushPackSelection,
} from "../apps/web/src/domains/creator/brush/studio-brush-pack-runtime";
import {
  createStudioStrokeOneEuroV1State,
  filterStudioStrokeOneEuroV1,
  flushStudioStrokeOneEuroV1Endpoint,
  type StudioStrokeOneEuroV1Options,
} from "../apps/web/src/domains/creator/brush/studio-stroke-one-euro-v1";
import {
  createStudioStrokeStabilizerBridge,
  createStudioStrokeStabilizerState,
  flushStudioStrokeStabilizerEndpoint,
  stabilizeStudioStrokeSample,
  type StudioStabilizerMode,
} from "../apps/web/src/domains/creator/brush/studio-stroke-stabilizer";
import {
  planStudioWetInkBrushReplay,
} from "../apps/web/src/domains/creator/brush/studio-wet-ink-brush-runtime";
import {
  beginStudioStrokePointerSession,
  collectStudioStrokePointerBatch,
  type StudioPointerEventLike,
  type StudioStrokePointerSession,
} from "../apps/web/src/domains/creator/canvas/studio-pointer-input";
import {
  beginStudioCausalDynamicBrushDepositV3,
  appendStudioCausalDynamicBrushDepositsV3,
  planStudioCausalDynamicBrushDepositsV3,
  type StudioCausalDynamicBrushSampleV2,
} from "../apps/web/src/domains/creator/studio-causal-dynamic-brush-deposit-v2";
import {
  buildStudioPerfectFreehandOutline,
  peekStudioPerfectFreehandStroker,
  resolveStudioPerfectFreehandProfile,
} from "../apps/web/src/domains/creator/studio-perfect-freehand";

import type {
  NormalizedStudioBrushDynamicsSettings,
  StudioDynamicBrushDab,
} from "../apps/web/src/domains/creator/brush/studio-brush-dynamics";
import type { DrawEl } from "../apps/web/src/domains/creator/studio-element-model";

export const STUDIO_BRUSH_ENGINE_SELECTION_REPORT_SCHEMA_VERSION = 1 as const;

const ONE_EURO_BALANCED_OPTIONS = Object.freeze({
  minCutoffHz: 1.25,
  beta: 0.2,
  derivativeCutoffHz: 1,
  coordinateScale: 1,
}) satisfies StudioStrokeOneEuroV1Options;

const ONE_EURO_MAX_SMOOTH_OPTIONS = Object.freeze({
  minCutoffHz: 0.8,
  beta: 0.2,
  derivativeCutoffHz: 1,
  coordinateScale: 1,
}) satisfies StudioStrokeOneEuroV1Options;

type StabilizerCandidateId =
  | "none"
  | "standard-strength-4"
  | "adaptive-strength-4"
  | "precision-strength-4"
  | "lazy-precision-strength-4"
  | "one-euro-v1-balanced"
  | "one-euro-v1-max-smooth";

interface PointSample {
  readonly x: number;
  readonly y: number;
  readonly timeStamp: number;
  readonly pressure: number;
  readonly targetX: number;
  readonly targetY: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

export interface StudioBrushEngineBenchmarkOptions {
  /** General-purpose fixture size. Production comparison defaults to 512. */
  readonly sampleCount?: number;
  /** Long-stroke sample count used for CPU/heap observations. */
  readonly longStrokeSampleCount?: number;
  /** Natural-media WASM input count. Kept separate because each sample may emit many dabs. */
  readonly hokusaiSampleCount?: number;
  /** Number of repeated timing observations; the median is reported. */
  readonly timingRuns?: number;
}

export interface StudioBrushEngineRoleDecision {
  readonly role: string;
  readonly selected: string;
  readonly status: "selected" | "conditional" | "opt-in" | "first-party-only";
  readonly reason: string;
  readonly requiredExternalGate?: string;
}

export interface StudioBrushEngineSelectionReport {
  readonly schemaVersion: typeof STUDIO_BRUSH_ENGINE_SELECTION_REPORT_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly runtime: {
    readonly node: string;
    readonly platform: NodeJS.Platform;
    readonly architecture: string;
  };
  readonly fixtures: {
    readonly seed: number;
    readonly sampleCount: number;
    readonly longStrokeSampleCount: number;
    readonly hokusaiSampleCount: number;
    readonly samplingRatesHz: readonly [60, 120, 240];
  };
  readonly inputTransport: ReturnType<typeof benchmarkInputTransport>;
  readonly stabilization: Awaited<ReturnType<typeof benchmarkStabilizers>>;
  readonly lineArt: ReturnType<typeof benchmarkPerfectFreehand>;
  readonly dynamicRaster: ReturnType<typeof benchmarkDynamicRaster>;
  readonly wetInk: ReturnType<typeof benchmarkWetInk>;
  readonly naturalMedia: Awaited<ReturnType<typeof benchmarkHokusai>>;
  readonly longStroke: Awaited<ReturnType<typeof benchmarkLongStroke>>;
  readonly roleDecisions: readonly StudioBrushEngineRoleDecision[];
  readonly externalBrowserGates: readonly {
    readonly id: string;
    readonly command: string;
    readonly reason: string;
    readonly measuredInThisNodeRun: false;
  }[];
  readonly limitations: readonly string[];
  readonly qualityGatePassed: boolean;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits = 4): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function quantile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = clamp(Math.ceil(fraction * sorted.length) - 1, 0, sorted.length - 1);
  return sorted[index] ?? 0;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rms(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return Math.sqrt(mean(values.map((value) => value * value)));
}

function coefficientOfVariation(values: readonly number[]): number {
  const average = mean(values);
  if (Math.abs(average) <= Number.EPSILON) return 0;
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2))) / Math.abs(average);
}

function sha256(value: string | Uint8Array): string {
  const hash = createHash("sha256");
  if (typeof value === "string") hash.update(value);
  else hash.update(value);
  return hash.digest("hex");
}

function stableDigest(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function xorshift32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function timed<T>(operation: () => T, runs: number): {
  readonly value: T;
  readonly medianCpuMs: number;
  readonly observedHeapDeltaBytes: number;
} {
  let value: T | undefined;
  const durations: number[] = [];
  let maximumHeapDelta = 0;
  for (let run = 0; run < runs; run += 1) {
    const beforeHeap = process.memoryUsage().heapUsed;
    const startedAt = performance.now();
    value = operation();
    durations.push(performance.now() - startedAt);
    maximumHeapDelta = Math.max(
      maximumHeapDelta,
      process.memoryUsage().heapUsed - beforeHeap,
    );
  }
  if (value === undefined) throw new Error("timed operation did not produce a value");
  return {
    value,
    medianCpuMs: round(quantile(durations, 0.5)),
    observedHeapDeltaBytes: Math.max(0, maximumHeapDelta),
  };
}

function makeStrokeFixture(sampleCount: number, seed = 0x51f15e): PointSample[] {
  const random = xorshift32(seed);
  const samples: PointSample[] = [];
  const count = Math.max(8, Math.floor(sampleCount));
  for (let index = 0; index < count; index += 1) {
    const progress = index / (count - 1);
    const targetX = 24 + progress * 568;
    const targetY = 96
      + Math.sin(progress * Math.PI * 3.4) * 24
      + Math.sin(progress * Math.PI * 9.2) * 4;
    const noiseX = (random() - 0.5) * 0.32;
    const noiseY = (random() - 0.5) * 0.52;
    samples.push({
      x: targetX + noiseX,
      y: targetY + noiseY,
      targetX,
      targetY,
      timeStamp: index * (1_000 / 240),
      pressure: clamp(
        0.16 + progress * 0.72 + Math.sin(progress * Math.PI * 4) * 0.08,
        0.05,
        1,
      ),
    });
  }
  return samples;
}

function makeLongFixture(sampleCount: number): PointSample[] {
  const count = Math.max(16, Math.floor(sampleCount));
  const samples: PointSample[] = [];
  for (let index = 0; index < count; index += 1) {
    const x = 10 + index * 0.7;
    const y = 80 + Math.sin(index / 37) * 18 + Math.sin(index / 11) * 2;
    samples.push({
      x,
      y,
      targetX: x,
      targetY: y,
      timeStamp: index * (1_000 / 240),
      pressure: clamp(0.45 + Math.sin(index / 83) * 0.3, 0.08, 0.95),
    });
  }
  return samples;
}

interface BenchmarkPointerEvent extends StudioPointerEventLike {
  readonly pointerId: number;
  readonly pointerType: "pen";
  readonly isPrimary: true;
  readonly button: 0;
  readonly buttons: 1;
  readonly clientX: number;
  readonly clientY: number;
  readonly pressure: number;
  readonly tangentialPressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly altitudeAngle: number;
  readonly azimuthAngle: number;
  readonly twist: number;
  readonly width: number;
  readonly height: number;
  readonly timeStamp: number;
  readonly getCoalescedEvents?: () => readonly BenchmarkPointerEvent[];
}

function pointerEvent(sample: PointSample, index: number): BenchmarkPointerEvent {
  return {
    pointerId: 7,
    pointerType: "pen",
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: sample.x,
    clientY: sample.y,
    pressure: sample.pressure,
    tangentialPressure: Math.sin(index / 13) * 0.2,
    tiltX: Math.sin(index / 17) * 42,
    tiltY: Math.cos(index / 19) * 36,
    altitudeAngle: 0.7 + Math.sin(index / 23) * 0.2,
    azimuthAngle: 1.1 + Math.cos(index / 29) * 0.3,
    twist: (index * 7) % 360,
    width: 1.2,
    height: 1.6,
    timeStamp: sample.timeStamp,
  };
}

function benchmarkInputTransport(samples: readonly PointSample[]) {
  const events = samples.map(pointerEvent);
  const initial = events[0];
  if (!initial) throw new Error("input fixture is empty");
  const openedSession = beginStudioStrokePointerSession(initial);
  if (!openedSession) {
    throw new Error("pointer fixture did not open a Studio stroke session");
  }
  let session: StudioStrokePointerSession = openedSession;

  const accepted: BenchmarkPointerEvent[] = [];
  let replayedOverlap = 0;
  let candidateCount = 0;
  const deliverySize = 16;
  let previousNewEnd = 0;
  for (let newStart = 1; newStart < events.length; newStart += deliverySize) {
    const newEnd = Math.min(events.length, newStart + deliverySize);
    const overlapStart = Math.max(0, previousNewEnd - 2);
    const coalesced = events.slice(overlapStart, newEnd);
    const parentBase = events[newEnd - 1];
    if (!parentBase) continue;
    const parent: BenchmarkPointerEvent = {
      ...parentBase,
      getCoalescedEvents: () => coalesced,
    };
    const batch = collectStudioStrokePointerBatch(session, parent);
    accepted.push(...batch.authoritative);
    replayedOverlap += batch.diagnostics.overlapReplayCount;
    candidateCount += batch.diagnostics.authoritativeCandidateCount;
    session = batch.session;
    previousNewEnd = newEnd;
  }

  const expected = events.slice(1);
  const exactOrder = accepted.length === expected.length
    && accepted.every((event, index) => {
      const target = expected[index];
      return Boolean(
        target
        && event.timeStamp === target.timeStamp
        && event.clientX === target.clientX
        && event.clientY === target.clientY,
      );
    });
  const expressiveFieldsPreserved = accepted.every((event, index) => {
    const target = expected[index];
    return Boolean(
      target
      && event.pressure === target.pressure
      && event.tiltX === target.tiltX
      && event.tiltY === target.tiltY
      && event.twist === target.twist
      && event.tangentialPressure === target.tangentialPressure,
    );
  });

  return {
    provider: "studio-pointer-input/coalesced authoritative collector",
    sourceHardwareSamples: events.length,
    authoritativeExpectedAfterPointerDown: expected.length,
    authoritativeAccepted: accepted.length,
    candidateSamplesIncludingReplay: candidateCount,
    replayOverlapRemoved: replayedOverlap,
    preservationRatio: round(accepted.length / Math.max(1, expected.length), 6),
    exactDeliveryOrderPreserved: exactOrder,
    pressureTiltTwistPreserved: expressiveFieldsPreserved,
    passed: exactOrder && expressiveFieldsPreserved && accepted.length === expected.length,
  };
}

interface StabilizerRun {
  readonly points: readonly Point[];
  readonly flushPoint: Point;
  readonly medianCpuMs: number;
}

function runStabilizer(
  id: StabilizerCandidateId,
  samples: readonly PointSample[],
): StabilizerRun {
  if (samples.length === 0) {
    return { points: [], flushPoint: { x: 0, y: 0 }, medianCpuMs: 0 };
  }
  const startedAt = performance.now();
  const points: Point[] = [];
  let flushPoint: Point = { x: samples[0]!.x, y: samples[0]!.y };

  if (id === "none") {
    points.push(...samples.map(({ x, y }) => ({ x, y })));
    flushPoint = points[points.length - 1] ?? flushPoint;
  } else if (id.startsWith("one-euro-v1-")) {
    const options = id === "one-euro-v1-balanced"
      ? ONE_EURO_BALANCED_OPTIONS
      : ONE_EURO_MAX_SMOOTH_OPTIONS;
    let state = createStudioStrokeOneEuroV1State(samples[0]!);
    points.push({ x: state.outputX, y: state.outputY });
    for (const sample of samples.slice(1)) {
      const result = filterStudioStrokeOneEuroV1(state, sample, options);
      points.push({ x: result.point[0], y: result.point[1] });
      state = result.state;
    }
    const flushed = flushStudioStrokeOneEuroV1Endpoint(state);
    flushPoint = { x: flushed.point[0], y: flushed.point[1] };
  } else if (id === "lazy-precision-strength-4") {
    const bridge = createStudioStrokeStabilizerBridge();
    for (const sample of samples) {
      const result = bridge.commit({
        x: sample.x,
        y: sample.y,
        timeStamp: sample.timeStamp,
        pointerType: "pen",
        pointerId: 7,
      }, {
        strength: 4,
        mode: "precision",
        coordinateScale: 1,
        useLazyPrecision: true,
        lazyFriction: 0,
      });
      points.push({ x: result.point[0], y: result.point[1] });
    }
    const flushed = bridge.flush();
    flushPoint = flushed
      ? { x: flushed.point[0], y: flushed.point[1] }
      : points[points.length - 1] ?? flushPoint;
  } else {
    const mode: StudioStabilizerMode = id.startsWith("standard")
      ? "standard"
      : id.startsWith("adaptive")
        ? "adaptive"
        : "precision";
    let state = createStudioStrokeStabilizerState(samples[0]!);
    points.push({ x: state.outputX, y: state.outputY });
    for (const sample of samples.slice(1)) {
      const result = stabilizeStudioStrokeSample(state, sample, {
        strength: 4,
        mode,
        coordinateScale: 1,
      });
      state = result.state;
      points.push({ x: result.point[0], y: result.point[1] });
    }
    const flushed = flushStudioStrokeStabilizerEndpoint(state);
    flushPoint = { x: flushed.point[0], y: flushed.point[1] };
  }

  return {
    points,
    flushPoint,
    medianCpuMs: round(performance.now() - startedAt),
  };
}

function makeJitterFixture(rateHz: number, seed = 0x7a11): PointSample[] {
  const random = xorshift32(seed);
  const durationMs = 1_500;
  const count = Math.floor(durationMs / (1_000 / rateHz)) + 1;
  return Array.from({ length: count }, (_, index) => {
    const timeStamp = index * (1_000 / rateHz);
    const progress = timeStamp / durationMs;
    const targetX = 40 + progress * 150;
    const targetY = 80;
    return {
      x: targetX + (random() - 0.5) * 0.7,
      y: targetY + (random() - 0.5) * 0.7,
      targetX,
      targetY,
      timeStamp,
      pressure: 0.55,
    };
  });
}

function makeCornerFixture(rateHz: number): {
  readonly samples: PointSample[];
  readonly cornerIndex: number;
  readonly corner: Point;
} {
  const halfDurationMs = 400;
  const durationMs = halfDurationMs * 2;
  const count = Math.floor(durationMs / (1_000 / rateHz)) + 1;
  const corner = { x: 180, y: 40 };
  const samples = Array.from({ length: count }, (_, index): PointSample => {
    const timeStamp = index * (1_000 / rateHz);
    const beforeCorner = timeStamp <= halfDurationMs;
    const amount = beforeCorner
      ? timeStamp / halfDurationMs
      : (timeStamp - halfDurationMs) / halfDurationMs;
    const targetX = beforeCorner ? 40 + 140 * amount : corner.x;
    const targetY = beforeCorner ? corner.y : 40 + 140 * amount;
    return {
      x: targetX,
      y: targetY,
      targetX,
      targetY,
      timeStamp,
      pressure: 0.6,
    };
  });
  return {
    samples,
    cornerIndex: Math.round(halfDurationMs / (1_000 / rateHz)),
    corner,
  };
}

function makeFastFixture(rateHz: number): PointSample[] {
  const durationMs = 320;
  const count = Math.floor(durationMs / (1_000 / rateHz)) + 1;
  return Array.from({ length: count }, (_, index): PointSample => {
    const timeStamp = index * (1_000 / rateHz);
    const progress = timeStamp / durationMs;
    const targetX = 20 + progress * 520;
    const targetY = 90 + Math.sin(progress * Math.PI) * 22;
    return {
      x: targetX,
      y: targetY,
      targetX,
      targetY,
      timeStamp,
      pressure: 0.25 + progress * 0.65,
    };
  });
}

function makeFrequencyFixture(rateHz: number): PointSample[] {
  const durationMs = 1_000;
  const count = rateHz + 1;
  return Array.from({ length: count }, (_, index): PointSample => {
    const timeStamp = index * (1_000 / rateHz);
    const progress = timeStamp / durationMs;
    const targetX = 30 + progress * 300;
    const targetY = 90
      + Math.sin(progress * Math.PI * 2) * 36
      + Math.sin(progress * Math.PI * 6) * 5;
    return {
      x: targetX,
      y: targetY,
      targetX,
      targetY,
      timeStamp,
      pressure: 0.35 + progress * 0.45,
    };
  });
}

function pointDistance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function distanceToCornerPolyline(point: Point, corner: Point): number {
  const horizontalDistance = point.x <= corner.x
    ? Math.abs(point.y - corner.y)
    : Math.hypot(point.x - corner.x, point.y - corner.y);
  const verticalDistance = point.y >= corner.y
    ? Math.abs(point.x - corner.x)
    : Math.hypot(point.x - corner.x, point.y - corner.y);
  return Math.min(horizontalDistance, verticalDistance);
}

function frequencyInvariance(id: StabilizerCandidateId): {
  readonly rms60To120Px: number;
  readonly rms60To240Px: number;
  readonly maximumRmsPx: number;
} {
  const byRate = new Map<number, readonly Point[]>();
  for (const rate of [60, 120, 240] as const) {
    byRate.set(rate, runStabilizer(id, makeFrequencyFixture(rate)).points);
  }
  const reference = byRate.get(60) ?? [];
  const compare = (rate: 120 | 240): number => {
    const candidate = byRate.get(rate) ?? [];
    const multiplier = rate / 60;
    return rms(reference.map((point, index) => {
      const other = candidate[index * multiplier] ?? candidate[candidate.length - 1] ?? point;
      return pointDistance(point, other);
    }));
  };
  const rms60To120Px = compare(120);
  const rms60To240Px = compare(240);
  return {
    rms60To120Px: round(rms60To120Px),
    rms60To240Px: round(rms60To240Px),
    maximumRmsPx: round(Math.max(rms60To120Px, rms60To240Px)),
  };
}

async function benchmarkStabilizers(timingRuns: number) {
  const candidates = [
    "none",
    "standard-strength-4",
    "adaptive-strength-4",
    "precision-strength-4",
    "lazy-precision-strength-4",
    "one-euro-v1-balanced",
    "one-euro-v1-max-smooth",
  ] as const satisfies readonly StabilizerCandidateId[];
  const jitterFixture = makeJitterFixture(240);
  const cornerFixture = makeCornerFixture(240);
  const fastFixture = makeFastFixture(240);
  const metrics = candidates.map((id) => {
    const jitter = runStabilizer(id, jitterFixture);
    const corner = runStabilizer(id, cornerFixture.samples);
    const fastTimed = timed(() => runStabilizer(id, fastFixture), timingRuns);
    const fast = fastTimed.value;
    const rawEndpoint = fastFixture[fastFixture.length - 1]!;
    const preFlushEndpoint = fast.points[fast.points.length - 1] ?? rawEndpoint;
    const cornerPoint = corner.points[cornerFixture.cornerIndex] ?? cornerFixture.corner;
    const cornerWindow = corner.points.slice(
      Math.max(0, cornerFixture.cornerIndex - 8),
      cornerFixture.cornerIndex + 9,
    );
    const lags = fast.points.map((point, index) => {
      const raw = fastFixture[index] ?? rawEndpoint;
      return pointDistance(point, raw);
    });
    const invariance = frequencyInvariance(id);
    return {
      id,
      jitterCrossTrackRmsPx: round(rms(jitter.points.map((point) => point.y - 80))),
      cornerDeviationAtTurnPx: round(pointDistance(cornerPoint, cornerFixture.corner)),
      cornerMaximumOffPolylinePx: round(Math.max(
        0,
        ...cornerWindow.map((point) => distanceToCornerPolyline(point, cornerFixture.corner)),
      )),
      fastMotionEndpointLagPx: round(pointDistance(preFlushEndpoint, rawEndpoint)),
      fastMotionP95LagPx: round(quantile(lags, 0.95)),
      endpointCatchUpErrorPx: round(pointDistance(fast.flushPoint, rawEndpoint), 8),
      frequencyInvariance: invariance,
      fastFixtureMedianCpuMs: fastTimed.medianCpuMs,
      observedHeapDeltaBytes: fastTimed.observedHeapDeltaBytes,
    };
  });

  const adaptive = metrics.find(({ id }) => id === "adaptive-strength-4");
  if (!adaptive) throw new Error("adaptive stabilizer benchmark is missing");
  const oneEuroCandidates = metrics.filter(({ id }) => id.startsWith("one-euro"));
  const normalizedScore = (candidate: (typeof metrics)[number]): number => (
    candidate.jitterCrossTrackRmsPx / Math.max(0.001, adaptive.jitterCrossTrackRmsPx)
    + candidate.cornerDeviationAtTurnPx / Math.max(0.25, adaptive.cornerDeviationAtTurnPx)
    + candidate.fastMotionEndpointLagPx / Math.max(0.25, adaptive.fastMotionEndpointLagPx)
    + candidate.frequencyInvariance.maximumRmsPx
      / Math.max(0.05, adaptive.frequencyInvariance.maximumRmsPx)
  );
  const eligibleOneEuro = oneEuroCandidates
    .filter((candidate) => (
      candidate.endpointCatchUpErrorPx <= 1e-6
      && candidate.fastMotionEndpointLagPx <= adaptive.fastMotionEndpointLagPx * 1.12 + 0.25
      && candidate.cornerDeviationAtTurnPx <= adaptive.cornerDeviationAtTurnPx * 1.15 + 0.25
      && candidate.frequencyInvariance.maximumRmsPx
        <= adaptive.frequencyInvariance.maximumRmsPx * 1.25 + 0.05
      && candidate.jitterCrossTrackRmsPx <= adaptive.jitterCrossTrackRmsPx
    ))
    .sort((left, right) => normalizedScore(left) - normalizedScore(right));
  const bestOneEuro = eligibleOneEuro[0];
  const promoteOneEuro = Boolean(
    bestOneEuro
    && normalizedScore(bestOneEuro) < normalizedScore(adaptive) * 0.97,
  );

  return {
    fixtureDescription:
      "Same deterministic stationary-jitter, 90° corner, fast curve, and 60/120/240Hz paths.",
    candidates: metrics,
    defaultDecision: {
      selected: promoteOneEuro ? bestOneEuro!.id : adaptive.id,
      oneEuroPromoted: promoteOneEuro,
      policy:
        "One Euro must reduce cross-track jitter without exceeding adaptive corner, fast-lag, "
        + "frequency-invariance, or endpoint-catch-up budgets; existence alone never wins.",
      reason: promoteOneEuro
        ? `${bestOneEuro!.id} cleared every adaptive-relative quality/latency budget and improved the normalized comparison.`
        : "The existing adaptive provider remains default because no One Euro profile cleared every promotion budget with a material total improvement.",
    },
    precisionDecision: {
      selected: "lazy-precision-strength-4",
      status: "opt-in" as const,
      reason:
        "Intentional guide-string lag is useful for deliberate inking but is not comparable to the default zero/low-lag role.",
    },
    passed: metrics.every((candidate) => (
      candidate.endpointCatchUpErrorPx <= 1e-6
      && Number.isFinite(candidate.jitterCrossTrackRmsPx)
      && Number.isFinite(candidate.cornerDeviationAtTurnPx)
      && Number.isFinite(candidate.fastMotionEndpointLagPx)
      && Number.isFinite(candidate.frequencyInvariance.maximumRmsPx)
    )),
  };
}

function flattenFixture(samples: readonly PointSample[]): {
  readonly points: number[];
  readonly pressures: number[];
  readonly speeds: number[];
  readonly tiltXs: number[];
  readonly tiltYs: number[];
  readonly twists: number[];
} {
  const points: number[] = [];
  const pressures: number[] = [];
  const speeds: number[] = [];
  const tiltXs: number[] = [];
  const tiltYs: number[] = [];
  const twists: number[] = [];
  let previous = samples[0];
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]!;
    points.push(sample.x, sample.y);
    pressures.push(sample.pressure);
    const elapsed = Math.max(1, sample.timeStamp - (previous?.timeStamp ?? sample.timeStamp));
    speeds.push(previous ? pointDistance(sample, previous) / elapsed : 0);
    tiltXs.push(Math.sin(index / 17) * 42);
    tiltYs.push(Math.cos(index / 19) * 36);
    twists.push((index * 7) % 360);
    previous = sample;
  }
  return { points, pressures, speeds, tiltXs, tiltYs, twists };
}

function polygonArea(points: readonly number[][]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (!current || !next) continue;
    area += (current[0] ?? 0) * (next[1] ?? 0) - (next[0] ?? 0) * (current[1] ?? 0);
  }
  return Math.abs(area) / 2;
}

function outlineBounds(points: readonly number[][]) {
  const xs = points.map((point) => point[0] ?? 0);
  const ys = points.map((point) => point[1] ?? 0);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function outlineInteriorTurnMetrics(points: readonly number[][]) {
  const turns: number[] = [];
  const segmentLengths: number[] = [];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const next = points[index + 1]!;
    const leftX = (current[0] ?? 0) - (previous[0] ?? 0);
    const leftY = (current[1] ?? 0) - (previous[1] ?? 0);
    const rightX = (next[0] ?? 0) - (current[0] ?? 0);
    const rightY = (next[1] ?? 0) - (current[1] ?? 0);
    const leftLength = Math.hypot(leftX, leftY);
    const rightLength = Math.hypot(rightX, rightY);
    if (leftLength <= 1e-6 || rightLength <= 1e-6) continue;
    segmentLengths.push(leftLength);
    const cosine = clamp(
      (leftX * rightX + leftY * rightY) / (leftLength * rightLength),
      -1,
      1,
    );
    turns.push(Math.acos(cosine));
  }
  return {
    p95TurnRadians: round(quantile(turns, 0.95)),
    maximumSegmentPx: round(Math.max(0, ...segmentLengths)),
    finite: turns.every(Number.isFinite) && segmentLengths.every(Number.isFinite),
  };
}

function localOutlineHalfWidth(
  outline: readonly number[][],
  centerX: number,
  expectedCenterY: number,
  windowPx: number,
): number {
  const local = outline
    .filter((point) => Math.abs((point[0] ?? 0) - centerX) <= windowPx)
    .map((point) => Math.abs((point[1] ?? expectedCenterY) - expectedCenterY));
  return quantile(local, 0.9);
}

function fixtureCenterYAtX(samples: readonly PointSample[], x: number): number {
  let nearest = samples[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const sample of samples) {
    const distance = Math.abs(sample.x - x);
    if (distance < nearestDistance) {
      nearest = sample;
      nearestDistance = distance;
    }
  }
  return nearest?.y ?? 0;
}

function benchmarkPerfectFreehand(samples: readonly PointSample[], timingRuns: number) {
  const stroker = peekStudioPerfectFreehandStroker();
  const profile = resolveStudioPerfectFreehandProfile("gpen");
  if (!stroker || !profile) {
    return {
      provider: "perfect-freehand",
      available: false as const,
      passed: false,
      reason: "The statically installed stroker or G-pen profile was unavailable.",
    };
  }
  const fixture = flattenFixture(samples);
  const baseInput = {
    points: fixture.points,
    pressures: fixture.pressures,
    strokeWidth: 12,
    profile,
  } as const;
  const measured = timed(
    () => buildStudioPerfectFreehandOutline(stroker, baseInput),
    timingRuns,
  );
  const outline = measured.value;
  const repeated = buildStudioPerfectFreehandOutline(stroker, baseInput);
  const lowPressure = buildStudioPerfectFreehandOutline(stroker, {
    ...baseInput,
    pressures: samples.map(() => 0.18),
  });
  const highPressure = buildStudioPerfectFreehandOutline(stroker, {
    ...baseInput,
    pressures: samples.map(() => 0.88),
  });
  const bounds = outlineBounds(outline);
  const first = samples[0]!;
  const middle = samples[Math.floor(samples.length / 2)]!;
  const last = samples[samples.length - 1]!;
  const startProbeX = first.x + 5;
  const endProbeX = last.x - 5;
  const startHalfWidth = localOutlineHalfWidth(
    outline,
    startProbeX,
    fixtureCenterYAtX(samples, startProbeX),
    4,
  );
  const middleHalfWidth = localOutlineHalfWidth(outline, middle.x, middle.y, 4);
  const endHalfWidth = localOutlineHalfWidth(
    outline,
    endProbeX,
    fixtureCenterYAtX(samples, endProbeX),
    4,
  );
  const pressureAreaRatio = polygonArea(highPressure) / Math.max(1e-6, polygonArea(lowPressure));
  const continuity = outlineInteriorTurnMetrics(outline);
  const hash = stableDigest(outline);

  return {
    provider: "perfect-freehand 1.2.3 through Studio G-pen adapter",
    available: true as const,
    inputPointCount: samples.length,
    outlinePointCount: outline.length,
    geometrySha256: hash,
    deterministicReplay: hash === stableDigest(repeated),
    areaPx2: round(polygonArea(outline)),
    bounds: Object.fromEntries(
      Object.entries(bounds).map(([key, value]) => [key, round(value)]),
    ),
    pressureResponse: {
      lowPressureAreaPx2: round(polygonArea(lowPressure)),
      highPressureAreaPx2: round(polygonArea(highPressure)),
      highToLowAreaRatio: round(pressureAreaRatio),
      passed: pressureAreaRatio > 1.25,
    },
    taperResponse: {
      startHalfWidthPx: round(startHalfWidth),
      middleHalfWidthPx: round(middleHalfWidth),
      endHalfWidthPx: round(endHalfWidth),
      maximumEndpointToMiddleRatio: round(
        Math.max(startHalfWidth, endHalfWidth) / Math.max(0.01, middleHalfWidth),
      ),
      observed: middleHalfWidth > Math.min(startHalfWidth, endHalfWidth),
    },
    curvatureContinuity: continuity,
    medianCpuMs: measured.medianCpuMs,
    observedHeapDeltaBytes: measured.observedHeapDeltaBytes,
    estimatedGeometryBytes: outline.length * 2 * Float64Array.BYTES_PER_ELEMENT,
    passed:
      outline.length > 8
      && continuity.finite
      && hash === stableDigest(repeated)
      && pressureAreaRatio > 1.25,
  };
}

function depositSample(
  samples: readonly PointSample[],
  index: number,
): StudioCausalDynamicBrushSampleV2 {
  const sample = samples[index]!;
  const previous = samples[Math.max(0, index - 1)]!;
  const elapsed = Math.max(1, sample.timeStamp - previous.timeStamp);
  return {
    x: sample.x,
    y: sample.y,
    pressure: sample.pressure,
    tangentialPressure: Math.sin(index / 13) * 0.2,
    speed: pointDistance(sample, previous) / elapsed,
    tiltX: Math.sin(index / 17) * 42,
    tiltY: Math.cos(index / 19) * 36,
    twist: (index * 7) % 360,
  };
}

function planDynamic(
  samples: readonly PointSample[],
  settings: NormalizedStudioBrushDynamicsSettings,
) {
  const fixture = flattenFixture(samples);
  return planStudioCausalDynamicBrushDepositsV3({
    ...fixture,
    settings,
  });
}

function planDynamicIncremental(
  samples: readonly PointSample[],
  settings: NormalizedStudioBrushDynamicsSettings,
): readonly StudioDynamicBrushDab[] {
  if (samples.length === 0) return [];
  const begun = beginStudioCausalDynamicBrushDepositV3(
    depositSample(samples, 0),
    settings,
  );
  if (!begun.ok) throw new Error(`dynamic begin failed: ${begun.reason}`);
  let state = begun.state;
  let dabs: StudioDynamicBrushDab[] = [begun.dab];
  for (let start = 1; start < samples.length; start += 17) {
    const chunk = Array.from(
      { length: Math.min(17, samples.length - start) },
      (_, offset) => depositSample(samples, start + offset),
    );
    const appended = appendStudioCausalDynamicBrushDepositsV3(state, chunk, settings);
    if (!appended.ok) throw new Error(`dynamic append failed: ${appended.reason}`);
    if (appended.replaceInitialTap) dabs = [];
    dabs.push(...appended.dabs);
    state = appended.state;
  }
  return dabs;
}

interface AlphaRaster {
  readonly width: number;
  readonly height: number;
  readonly alpha: Float32Array;
}

function stampAlpha(
  raster: AlphaRaster,
  dab: StudioDynamicBrushDab,
  operation: "source-over" | "destination-out",
): void {
  const sourceAlpha = clamp(dab.opacity * dab.flow, 0, 1);
  if (sourceAlpha <= 0) return;
  const radiusX = Math.max(0.45, dab.size / 2);
  const radiusY = Math.max(0.35, radiusX * clamp(dab.roundness, 0.05, 1));
  const radians = dab.angle * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const extent = Math.ceil(Math.max(radiusX, radiusY) + 1);
  const minimumX = Math.max(0, Math.floor(dab.x - extent));
  const maximumX = Math.min(raster.width - 1, Math.ceil(dab.x + extent));
  const minimumY = Math.max(0, Math.floor(dab.y - extent));
  const maximumY = Math.min(raster.height - 1, Math.ceil(dab.y + extent));
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      const dx = x + 0.5 - dab.x;
      const dy = y + 0.5 - dab.y;
      const localX = dx * cosine + dy * sine;
      const localY = -dx * sine + dy * cosine;
      const distanceSquared = (localX / radiusX) ** 2 + (localY / radiusY) ** 2;
      if (distanceSquared > 1) continue;
      const edgeCoverage = clamp((1 - distanceSquared) * 2.2, 0, 1);
      const alpha = sourceAlpha * edgeCoverage;
      const offset = y * raster.width + x;
      const destination = raster.alpha[offset] ?? 0;
      raster.alpha[offset] = operation === "source-over"
        ? alpha + destination * (1 - alpha)
        : destination * (1 - alpha);
    }
  }
}

function renderAlphaDabs(
  dabs: readonly StudioDynamicBrushDab[],
  width: number,
  height: number,
  initial?: Float32Array,
  operation: "source-over" | "destination-out" = "source-over",
): AlphaRaster {
  const raster = {
    width,
    height,
    alpha: initial ? initial.slice() : new Float32Array(width * height),
  };
  for (const dab of dabs) stampAlpha(raster, dab, operation);
  return raster;
}

function bilinearAlpha(raster: AlphaRaster, x: number, y: number): number {
  const x0 = clamp(Math.floor(x), 0, raster.width - 1);
  const y0 = clamp(Math.floor(y), 0, raster.height - 1);
  const x1 = clamp(x0 + 1, 0, raster.width - 1);
  const y1 = clamp(y0 + 1, 0, raster.height - 1);
  const amountX = clamp(x - x0, 0, 1);
  const amountY = clamp(y - y0, 0, 1);
  const top = (raster.alpha[y0 * raster.width + x0] ?? 0) * (1 - amountX)
    + (raster.alpha[y0 * raster.width + x1] ?? 0) * amountX;
  const bottom = (raster.alpha[y1 * raster.width + x0] ?? 0) * (1 - amountX)
    + (raster.alpha[y1 * raster.width + x1] ?? 0) * amountX;
  return top * (1 - amountY) + bottom * amountY;
}

function alphaRasterMetrics(
  raster: AlphaRaster,
  samples: readonly PointSample[],
) {
  const start = Math.floor(samples.length * 0.1);
  const end = Math.max(start + 1, Math.ceil(samples.length * 0.9));
  const centerline = samples.slice(start, end).map((sample) => (
    bilinearAlpha(raster, sample.targetX, sample.targetY)
  ));
  const widths = samples.slice(start, end).map((sample, relativeIndex) => {
    const index = start + relativeIndex;
    const previous = samples[Math.max(0, index - 1)]!;
    const next = samples[Math.min(samples.length - 1, index + 1)]!;
    const dx = next.targetX - previous.targetX;
    const dy = next.targetY - previous.targetY;
    const length = Math.max(1e-6, Math.hypot(dx, dy));
    const normalX = -dy / length;
    const normalY = dx / length;
    let covered = 0;
    for (let offset = -18; offset <= 18; offset += 0.75) {
      if (
        bilinearAlpha(
          raster,
          sample.targetX + normalX * offset,
          sample.targetY + normalY * offset,
        ) > 0.04
      ) covered += 0.75;
    }
    return covered;
  });
  return {
    meanCenterlineAlpha: round(mean(centerline)),
    minimumCenterlineAlpha: round(Math.min(1, ...centerline)),
    centerlineGapRatio: round(
      centerline.filter((alpha) => alpha < 0.02).length / Math.max(1, centerline.length),
    ),
    crossSectionWidthCoefficientOfVariation: round(coefficientOfVariation(widths)),
  };
}

function lagAutocorrelation(values: readonly number[], lag: number): number {
  if (values.length <= lag + 2) return 0;
  const average = mean(values);
  const variance = mean(values.map((value) => (value - average) ** 2));
  if (variance <= 1e-12) return 0;
  let covariance = 0;
  let count = 0;
  for (let index = lag; index < values.length; index += 1) {
    covariance += (values[index]! - average) * (values[index - lag]! - average);
    count += 1;
  }
  return covariance / Math.max(1, count) / variance;
}

function grainProxyMetrics(dabs: readonly StudioDynamicBrushDab[]) {
  const sampled = dabs.slice(Math.floor(dabs.length * 0.1), Math.ceil(dabs.length * 0.9));
  const along: number[] = [];
  const across: number[] = [];
  for (const dab of sampled) {
    const radians = (dab.direction ?? 0) * Math.PI / 180;
    const dx = dab.x - dab.sourceX;
    const dy = dab.y - dab.sourceY;
    along.push(dx * Math.cos(radians) + dy * Math.sin(radians));
    across.push(-dx * Math.sin(radians) + dy * Math.cos(radians));
  }
  const variance = (values: readonly number[]) => {
    const average = mean(values);
    return mean(values.map((value) => (value - average) ** 2));
  };
  const channels = [
    sampled.map((dab) => dab.size),
    sampled.map((dab) => dab.opacity),
    sampled.map((dab) => dab.spacing),
  ];
  let strongestRepetition = 0;
  let strongestLag = 0;
  for (const channel of channels) {
    for (let lag = 2; lag <= Math.min(32, channel.length - 2); lag += 1) {
      const correlation = Math.abs(lagAutocorrelation(channel, lag));
      if (correlation > strongestRepetition) {
        strongestRepetition = correlation;
        strongestLag = lag;
      }
    }
  }
  return {
    scatterAnisotropyVarianceRatio: round(
      variance(across) / Math.max(1e-9, variance(along)),
    ),
    strongestPlanChannelRepetition: round(strongestRepetition),
    strongestPlanChannelLagDabs: strongestLag,
    note:
      "Planner-level proxy only; final texture/grain anisotropy and repetition require the WebGPU pixel gate.",
  };
}

function benchmarkDynamicRaster(samples: readonly PointSample[], timingRuns: number) {
  const brushIds = ["g-pen-flex", "pencil-4b-rough"] as const;
  const results = brushIds.map((brushId) => {
    const selection = materializeStudioBrushPackSelection(brushId);
    if (!selection) {
      return {
        brushId,
        available: false as const,
        passed: false,
        reason: "Brush pack selection is unavailable.",
      };
    }
    const plannedTimed = timed(
      () => planDynamic(samples, selection.brushDynamics),
      timingRuns,
    );
    const planned = plannedTimed.value;
    if (!planned.ok) {
      return {
        brushId,
        available: false as const,
        passed: false,
        reason: `Causal V3 planner failed: ${planned.reason}`,
      };
    }
    const incremental = planDynamicIncremental(samples, selection.brushDynamics);
    const changedSeed = {
      ...selection.brushDynamics,
      seed: (selection.brushDynamics.seed + 1) >>> 0,
    };
    const changedSeedPlan = planDynamic(samples, changedSeed);
    const fullHash = stableDigest(planned.dabs);
    const incrementalHash = stableDigest(incremental);
    const replayPlan = planDynamic(samples, selection.brushDynamics);
    const replayHash = replayPlan.ok ? stableDigest(replayPlan.dabs) : "";
    const changedSeedHash = changedSeedPlan.ok
      ? stableDigest(changedSeedPlan.dabs)
      : "";
    const once = renderAlphaDabs(planned.dabs, 640, 192);
    const twice = renderAlphaDabs(planned.dabs, 640, 192, once.alpha);
    const erased = renderAlphaDabs(
      planned.dabs,
      640,
      192,
      twice.alpha,
      "destination-out",
    );
    let alphaBuildDownRegressions = 0;
    let premultipliedColorDownRegressions = 0;
    let eraseUpRegressions = 0;
    let visiblePixels = 0;
    let firstAlphaEnergy = 0;
    let secondAlphaEnergy = 0;
    let erasedAlphaEnergy = 0;
    for (let index = 0; index < once.alpha.length; index += 1) {
      const first = once.alpha[index] ?? 0;
      const second = twice.alpha[index] ?? 0;
      const afterErase = erased.alpha[index] ?? 0;
      if (second + 1e-7 < first) alphaBuildDownRegressions += 1;
      for (const color of [0.19, 0.53, 0.87]) {
        if (second * color + 1e-7 < first * color) {
          premultipliedColorDownRegressions += 1;
        }
      }
      if (afterErase > second + 1e-7) eraseUpRegressions += 1;
      if (first > 0.002) visiblePixels += 1;
      firstAlphaEnergy += first;
      secondAlphaEnergy += second;
      erasedAlphaEnergy += afterErase;
    }
    const seam = alphaRasterMetrics(once, samples);
    const grain = grainProxyMetrics(planned.dabs);
    const strictContinuous = brushId === "g-pen-flex";
    const seamPassed = strictContinuous
      ? seam.centerlineGapRatio <= 0.02
      : true;
    return {
      brushId,
      runtimeBrushId: selection.runtimeBrushId,
      available: true as const,
      sourcePointCount: samples.length,
      dabCount: planned.dabs.length,
      fullPlanSha256: fullHash,
      deterministicSeedReplay: fullHash === replayHash,
      differentSeedChangesPlan: fullHash !== changedSeedHash,
      liveIncrementalEqualsCommittedPlan: fullHash === incrementalHash,
      seamExposure: {
        policy: strictContinuous ? "strict-continuous" : "record-texture",
        ...seam,
        passed: seamPassed,
        oracle:
          "Analytic CPU ellipse coverage; final tip texture and premultiplied GPU composition remain browser-gated.",
      },
      grainAnisotropyAndRepetition: grain,
      overlapAlpha: {
        visiblePixels,
        firstPassEnergy: round(firstAlphaEnergy),
        secondPassEnergy: round(secondAlphaEnergy),
        alphaDecreaseRegressionPixels: alphaBuildDownRegressions,
        premultipliedColorDecreaseRegressionChannels:
          premultipliedColorDownRegressions,
        monotonic:
          alphaBuildDownRegressions === 0
          && premultipliedColorDownRegressions === 0
          && secondAlphaEnergy >= firstAlphaEnergy,
      },
      erase: {
        postEraseEnergy: round(erasedAlphaEnergy),
        alphaIncreaseRegressionPixels: eraseUpRegressions,
        monotonic: eraseUpRegressions === 0 && erasedAlphaEnergy <= secondAlphaEnergy,
      },
      medianPlannerCpuMs: plannedTimed.medianCpuMs,
      observedHeapDeltaBytes: plannedTimed.observedHeapDeltaBytes,
      estimatedDabBytes: planned.dabs.length * 17 * Float64Array.BYTES_PER_ELEMENT,
      passed:
        fullHash === replayHash
        && fullHash === incrementalHash
        && fullHash !== changedSeedHash
        && alphaBuildDownRegressions === 0
        && premultipliedColorDownRegressions === 0
        && eraseUpRegressions === 0
        && seamPassed,
    };
  });
  return {
    provider: "Studio causal dynamic dab V3 + deterministic CPU coverage oracle",
    brushes: results,
    passed: results.every((result) => result.passed),
  };
}

function wetInkElement(
  brush: "watercolor" | "ink-wash",
  samples: readonly PointSample[],
): DrawEl {
  const selected = samples.slice(0, Math.min(samples.length, 32));
  const minimumX = selected[0]?.x ?? 0;
  const minimumY = Math.min(...selected.map(({ y }) => y));
  const points = selected.flatMap(({ x, y }) => [
    14 + (x - minimumX) * 0.14,
    18 + (y - minimumY) * 0.28,
  ]);
  return {
    id: `benchmark-${brush}`,
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points,
    pressures: selected.map(({ pressure }) => pressure),
    stroke: brush === "watercolor" ? "#2c6eaa" : "#25212b",
    strokeWidth: 4,
    opacity: 0.78,
    brush,
    watercolorPipeline: "causal-walker-v2",
  };
}

function wetUploadsDigest(
  uploads: readonly {
    readonly tileX: number;
    readonly tileY: number;
    readonly rgba: Uint8ClampedArray;
  }[],
): string {
  const hash = createHash("sha256");
  for (const upload of uploads) {
    hash.update(`${upload.tileX},${upload.tileY}:`);
    hash.update(upload.rgba);
  }
  return hash.digest("hex");
}

function benchmarkWetInk(samples: readonly PointSample[], timingRuns: number) {
  const brushes = (["watercolor", "ink-wash"] as const).map((brush) => {
    const element = wetInkElement(brush, samples);
    const measured = timed(
      () => planStudioWetInkBrushReplay(element, { phase: "live" }),
      Math.min(1, timingRuns),
    );
    const live = measured.value;
    const committed = planStudioWetInkBrushReplay(element, { phase: "committed" });
    if (!live.ok || !committed.ok) {
      const reason = !live.ok
        ? `${live.reason}: ${live.detail}`
        : !committed.ok
          ? `${committed.reason}: ${committed.detail}`
          : "unreachable wet-ink planning state";
      return {
        brush,
        available: false as const,
        passed: false,
        reason,
      };
    }
    const liveUploadHash = wetUploadsDigest(live.value.uploads);
    const committedUploadHash = wetUploadsDigest(committed.value.uploads);
    return {
      brush,
      available: true as const,
      fieldDigest: live.value.fieldDigest,
      uploadSha256: liveUploadHash,
      tileCount: live.value.uploads.length,
      allocatedCells: live.value.allocatedCells,
      simulationSteps: live.value.simulationSteps,
      liveCommitFieldParity: live.value.fieldDigest === committed.value.fieldDigest,
      liveCommitPixelParity: liveUploadHash === committedUploadHash,
      medianPlanCpuMs: measured.medianCpuMs,
      observedHeapDeltaBytes: measured.observedHeapDeltaBytes,
      passed:
        live.value.fieldDigest === committed.value.fieldDigest
        && liveUploadHash === committedUploadHash,
    };
  });
  const watercolor = brushes.find(({ brush }) => brush === "watercolor");
  const inkWash = brushes.find(({ brush }) => brush === "ink-wash");
  const distinct = Boolean(
    watercolor?.available
    && inkWash?.available
    && watercolor.fieldDigest !== inkWash.fieldDigest
    && watercolor.uploadSha256 !== inkWash.uploadSha256,
  );
  return {
    provider: "Studio deterministic wet-ink fixed field",
    brushes,
    pigmentWetMixDistinctness: {
      watercolorAndInkWashProduceDistinctFields: distinct,
      comparison:
        "Same geometry uses distinct physical recipes; digest and complete RGBA tile streams must differ.",
      passed: distinct,
    },
    passed: brushes.every((brush) => brush.passed) && distinct,
  };
}

interface HokusaiBrushHandle {
  setRadiusLog(value: number): void;
  setColorHsv(hue: number, saturation: number, value: number): void;
  free(): void;
}

interface HokusaiCanvasHandle {
  beginStroke(brush: HokusaiBrushHandle, seed?: number | null): void;
  addSample(
    brush: HokusaiBrushHandle,
    x: number,
    y: number,
    pressure: number,
    tiltX: number,
    tiltY: number,
    timeMs: number,
  ): boolean;
  finishStroke(brush: HokusaiBrushHandle): boolean;
  fullFrame(): Uint8Array;
  dirtyBounds(): Int32Array;
  dispose(): void;
  free(): void;
}

interface HokusaiModule {
  initSync(input: { module: Uint8Array }): unknown;
  HokusaiBrush: {
    naturalMedia(): HokusaiBrushHandle;
  };
  HokusaiCanvas: new (
    width: number,
    height: number,
    seed: number,
  ) => HokusaiCanvasHandle;
}

let hokusaiModulePromise: Promise<HokusaiModule> | null = null;

async function loadHokusaiModule(): Promise<HokusaiModule> {
  hokusaiModulePromise ??= (async () => {
    const packageDirectory = resolve(
      process.cwd(),
      "packages/studio-hokusai-wasm/pkg",
    );
    const module = await import(
      pathToFileURL(resolve(packageDirectory, "studio_hokusai_wasm.js")).href
    ) as unknown as HokusaiModule;
    const bytes = readFileSync(resolve(packageDirectory, "studio_hokusai_wasm_bg.wasm"));
    module.initSync({ module: bytes });
    return module;
  })();
  return hokusaiModulePromise;
}

function hokusaiFrameMetrics(frame: Uint8Array, width: number, height: number) {
  let visiblePixels = 0;
  let alphaEnergy = 0;
  let horizontalGradient = 0;
  let verticalGradient = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4 + 3;
      const alpha = frame[offset] ?? 0;
      if (alpha > 0) visiblePixels += 1;
      alphaEnergy += alpha;
      if (x > 0) horizontalGradient += Math.abs(alpha - (frame[offset - 4] ?? 0));
      if (y > 0) verticalGradient += Math.abs(
        alpha - (frame[offset - width * 4] ?? 0),
      );
    }
  }
  return {
    visiblePixels,
    meanAlpha: round(alphaEnergy / Math.max(1, width * height) / 255),
    grainGradientAnisotropy: round(
      Math.max(horizontalGradient, verticalGradient)
      / Math.max(1, Math.min(horizontalGradient, verticalGradient)),
    ),
  };
}

async function renderHokusai(
  module: HokusaiModule,
  samples: readonly PointSample[],
  seed: number,
) {
  const width = 768;
  const height = 256;
  const brush = module.HokusaiBrush.naturalMedia();
  brush.setRadiusLog(2.35);
  brush.setColorHsv(0.58, 0.72, 0.72);
  const canvas = new module.HokusaiCanvas(width, height, seed);
  const minimumX = samples[0]?.x ?? 0;
  const maximumX = samples[samples.length - 1]?.x ?? minimumX + 1;
  const rangeX = Math.max(1, maximumX - minimumX);
  const minimumY = Math.min(...samples.map(({ y }) => y));
  const maximumY = Math.max(...samples.map(({ y }) => y));
  const rangeY = Math.max(1, maximumY - minimumY);
  const startedAt = performance.now();
  try {
    canvas.beginStroke(brush, seed);
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index]!;
      canvas.addSample(
        brush,
        36 + ((sample.x - minimumX) / rangeX) * (width - 72),
        64 + ((sample.y - minimumY) / rangeY) * (height - 128),
        sample.pressure,
        clamp(Math.sin(index / 17) * 0.65, -1, 1),
        clamp(Math.cos(index / 19) * 0.55, -1, 1),
        sample.timeStamp,
      );
    }
    canvas.finishStroke(brush);
    const frame = canvas.fullFrame();
    return {
      width,
      height,
      frame,
      frameSha256: sha256(frame),
      dirtyBounds: Array.from(canvas.dirtyBounds()),
      cpuMs: round(performance.now() - startedAt),
      ...hokusaiFrameMetrics(frame, width, height),
    };
  } finally {
    canvas.dispose();
    canvas.free();
    brush.free();
  }
}

async function benchmarkHokusai(samples: readonly PointSample[], timingRuns: number) {
  try {
    const module = await loadHokusaiModule();
    const observations = [];
    for (let run = 0; run < timingRuns; run += 1) {
      observations.push(await renderHokusai(module, samples, 0x71c0ffee));
    }
    const first = observations[0]!;
    const replay = await renderHokusai(module, samples, 0x71c0ffee);
    const changedSeed = await renderHokusai(module, samples, 0x71c0ffef);
    return {
      provider: "Hokusai WASM 0.3.0 naturalMedia",
      available: true as const,
      sampleCount: samples.length,
      frameSize: { width: first.width, height: first.height },
      frameSha256: first.frameSha256,
      visiblePixels: first.visiblePixels,
      meanAlpha: first.meanAlpha,
      dirtyBounds: first.dirtyBounds,
      deterministicSeedReplay: first.frameSha256 === replay.frameSha256,
      changedSeedChangesFrame: first.frameSha256 !== changedSeed.frameSha256,
      grainAnisotropy: {
        alphaGradientRatio: first.grainGradientAnisotropy,
        deterministicAcrossReplay:
          first.grainGradientAnisotropy === replay.grainGradientAnisotropy,
      },
      medianCpuMs: round(quantile(observations.map(({ cpuMs }) => cpuMs), 0.5)),
      frameBytes: first.frame.byteLength,
      passed:
        first.visiblePixels > 0
        && first.frameSha256 === replay.frameSha256
        && first.frameSha256 !== changedSeed.frameSha256,
    };
  } catch (error) {
    return {
      provider: "Hokusai WASM 0.3.0 naturalMedia",
      available: false as const,
      passed: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function benchmarkLongStroke(
  samples: readonly PointSample[],
  timingRuns: number,
) {
  const adaptive = timed(
    () => runStabilizer("adaptive-strength-4", samples),
    timingRuns,
  );
  const oneEuro = timed(
    () => runStabilizer("one-euro-v1-balanced", samples),
    timingRuns,
  );
  const stroker = peekStudioPerfectFreehandStroker();
  const profile = resolveStudioPerfectFreehandProfile("gpen");
  const flattened = flattenFixture(samples);
  const perfect = stroker && profile
    ? timed(() => buildStudioPerfectFreehandOutline(stroker, {
      points: flattened.points,
      pressures: flattened.pressures,
      strokeWidth: 9,
      profile,
    }), timingRuns)
    : null;
  const pencil = materializeStudioBrushPackSelection("pencil-4b-rough");
  const dynamic = pencil
    ? timed(() => planDynamic(samples, pencil.brushDynamics), timingRuns)
    : null;
  const dynamicDabs = dynamic?.value.ok ? dynamic.value.dabs.length : 0;
  const carrierRatios = dynamic?.value.ok
    ? dynamic.value.dabs.slice(1).map((dab, index) => {
      const previous = dynamic.value.ok ? dynamic.value.dabs[index] : undefined;
      const referenceDiameter = Math.max(
        0.01,
        ((previous?.size ?? dab.size) + dab.size) / 2,
      );
      return (dab.distanceFromPrevious ?? 0) / referenceDiameter;
    })
    : [];
  const carrierExposure = {
    p95StationDistanceToDiameterRatio: round(quantile(carrierRatios, 0.95)),
    maximumStationDistanceToDiameterRatio: round(Math.max(0, ...carrierRatios)),
    exposedCarrierRisk:
      quantile(carrierRatios, 0.95) > 1
      || Math.max(0, ...carrierRatios) > 1.75,
    note:
      "A ratio above 1 can expose isolated circular stations; textured final pixels remain browser-gated.",
  };
  const candidates = [
    {
      id: "adaptive-strength-4",
      medianCpuMs: adaptive.medianCpuMs,
      observedHeapDeltaBytes: adaptive.observedHeapDeltaBytes,
      estimatedOutputBytes: samples.length * 2 * Float64Array.BYTES_PER_ELEMENT,
    },
    {
      id: "one-euro-v1-balanced",
      medianCpuMs: oneEuro.medianCpuMs,
      observedHeapDeltaBytes: oneEuro.observedHeapDeltaBytes,
      estimatedOutputBytes: samples.length * 2 * Float64Array.BYTES_PER_ELEMENT,
    },
    {
      id: "perfect-freehand-gpen",
      medianCpuMs: perfect?.medianCpuMs ?? null,
      observedHeapDeltaBytes: perfect?.observedHeapDeltaBytes ?? null,
      estimatedOutputBytes: perfect
        ? perfect.value.length * 2 * Float64Array.BYTES_PER_ELEMENT
        : null,
    },
    {
      id: "causal-dab-v3-pencil",
      medianCpuMs: dynamic?.medianCpuMs ?? null,
      observedHeapDeltaBytes: dynamic?.observedHeapDeltaBytes ?? null,
      estimatedOutputBytes: dynamic
        ? dynamicDabs * 17 * Float64Array.BYTES_PER_ELEMENT
        : null,
      outputDabs: dynamicDabs,
      carrierExposure,
    },
  ];
  const performanceVetoPassed = candidates.every(({ medianCpuMs, observedHeapDeltaBytes }) => (
    (medianCpuMs === null || medianCpuMs < 10_000)
    && (observedHeapDeltaBytes === null || observedHeapDeltaBytes < 512 * 1024 * 1024)
  ));
  return {
    inputSamples: samples.length,
    candidates,
    policy:
      "CPU/heap are a separate veto, never a bonus that can compensate for perceptual-quality failure. Heap deltas remain noisy process observations.",
    performanceVetoPassed,
    passed: performanceVetoPassed,
  };
}

function roleDecisions(
  stabilization: Awaited<ReturnType<typeof benchmarkStabilizers>>,
  lineArt: ReturnType<typeof benchmarkPerfectFreehand>,
  dynamicRaster: ReturnType<typeof benchmarkDynamicRaster>,
  wetInk: ReturnType<typeof benchmarkWetInk>,
  naturalMedia: Awaited<ReturnType<typeof benchmarkHokusai>>,
): StudioBrushEngineRoleDecision[] {
  return [
    {
      role: "authoritative pointer transport",
      selected: "Studio coalesced Pointer Events collector",
      status: "selected",
      reason: "Preserves ordered hardware pressure/tilt/twist samples and removes only replay overlap.",
    },
    {
      role: "default line stabilization",
      selected: stabilization.defaultDecision.selected,
      status: "selected",
      reason: stabilization.defaultDecision.reason,
    },
    {
      role: "strong precision stabilization",
      selected: stabilization.precisionDecision.selected,
      status: "opt-in",
      reason: stabilization.precisionDecision.reason,
    },
    {
      role: "manga line-art geometry",
      selected: lineArt.available && lineArt.passed
        ? "perfect-freehand G-pen outline"
        : "no candidate cleared the gate",
      status: lineArt.available && lineArt.passed ? "selected" : "conditional",
      reason:
        "Pressure, taper, deterministic outline geometry, and curvature are evaluated independently of textured paint.",
    },
    {
      role: "dry/texture dab planning",
      selected: dynamicRaster.passed
        ? "Studio causal dynamic dab V3"
        : "no candidate cleared the gate",
      status: "conditional",
      reason:
        "Planner parity, seed determinism, seam proxy, grain proxy, alpha buildup, and erase pass in Node.",
      requiredExternalGate: "pnpm run verify:studio-engine-webgpu-textured-brush",
    },
    {
      role: "physical watercolor and ink wash",
      selected: wetInk.passed
        ? "Studio deterministic wet-ink fixed field"
        : "no candidate cleared the gate",
      status: wetInk.passed ? "selected" : "conditional",
      reason:
        "Live/commit RGBA tile parity and distinct physical recipes are measured directly.",
    },
    {
      role: "natural-media settled raster",
      selected: naturalMedia.available && naturalMedia.passed
        ? "Hokusai WASM naturalMedia"
        : "no candidate cleared the gate",
      status: naturalMedia.available && naturalMedia.passed ? "selected" : "conditional",
      reason:
        "Actual deterministic WASM pixels, seed response, grain gradient, and CPU cost are measured.",
    },
    {
      role: "procedural texture/effect brushes",
      selected: "p5.brush isolated effects provider",
      status: "conditional",
      reason: "Keep outside canonical line-art/natural-media roles until real browser pixel capture passes.",
      requiredExternalGate: "pnpm run verify:studio-p5-brush-real-runtime",
    },
    {
      role: "canonical document, layers, history, CRDT",
      selected: "ToonSpectrum first-party tile/layer/history model",
      status: "first-party-only",
      reason: "Renderer libraries are replaceable providers and must not own persisted document semantics.",
    },
  ];
}

export async function runStudioBrushEngineSelectionBenchmark(
  options: StudioBrushEngineBenchmarkOptions = {},
): Promise<StudioBrushEngineSelectionReport> {
  const sampleCount = clamp(Math.floor(options.sampleCount ?? 512), 64, 4_096);
  const longStrokeSampleCount = clamp(
    Math.floor(options.longStrokeSampleCount ?? 8_192),
    128,
    32_768,
  );
  const hokusaiSampleCount = clamp(
    Math.floor(options.hokusaiSampleCount ?? 768),
    64,
    4_096,
  );
  const timingRuns = clamp(Math.floor(options.timingRuns ?? 3), 1, 9);
  const samples = makeStrokeFixture(sampleCount);
  const longSamples = makeLongFixture(longStrokeSampleCount);
  const hokusaiSamples = makeStrokeFixture(hokusaiSampleCount, 0x71c0ffee);

  const inputTransport = benchmarkInputTransport(samples);
  const stabilization = await benchmarkStabilizers(timingRuns);
  const lineArt = benchmarkPerfectFreehand(samples, timingRuns);
  const dynamicRaster = benchmarkDynamicRaster(samples, timingRuns);
  const wetInk = benchmarkWetInk(samples, timingRuns);
  const naturalMedia = await benchmarkHokusai(hokusaiSamples, timingRuns);
  const longStroke = await benchmarkLongStroke(longSamples, timingRuns);
  const decisions = roleDecisions(
    stabilization,
    lineArt,
    dynamicRaster,
    wetInk,
    naturalMedia,
  );
  const externalBrowserGates = [
    {
      id: "webgpu-textured-brush-pixels",
      command: "pnpm run verify:studio-engine-webgpu-textured-brush",
      reason:
        "Final tip texture, premultiplied-alpha seams, grain anisotropy/repetition, and live/commit GPU pixels require a real WebGPU browser.",
      measuredInThisNodeRun: false as const,
    },
    {
      id: "webgpu-presentation",
      command: "pnpm run verify:studio-engine-webgpu-presentation",
      reason:
        "Presentation surface/device-loss behavior cannot be inferred from a Node CPU oracle.",
      measuredInThisNodeRun: false as const,
    },
    {
      id: "p5-brush-real-runtime",
      command: "pnpm run verify:studio-p5-brush-real-runtime",
      reason:
        "Procedural settled effects need an actual browser canvas capture and must not win from package presence.",
      measuredInThisNodeRun: false as const,
    },
  ] as const;
  const qualityGatePassed = Boolean(
    inputTransport.passed
    && stabilization.passed
    && lineArt.passed
    && dynamicRaster.passed
    && wetInk.passed
    && naturalMedia.passed
    && longStroke.passed,
  );

  return {
    schemaVersion: STUDIO_BRUSH_ENGINE_SELECTION_REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    fixtures: {
      seed: 0x51f15e,
      sampleCount,
      longStrokeSampleCount,
      hokusaiSampleCount,
      samplingRatesHz: [60, 120, 240],
    },
    inputTransport,
    stabilization,
    lineArt,
    dynamicRaster,
    wetInk,
    naturalMedia,
    longStroke,
    roleDecisions: decisions,
    externalBrowserGates,
    limitations: [
      "Node CPU ellipse coverage is a compositor contract oracle, not a substitute for textured WebGPU pixels.",
      "Planner-level grain autocorrelation cannot see PNG/custom-tip sampling or shader interpolation.",
      "process.memoryUsage().heapUsed deltas include runtime noise and exclude browser GPU allocation.",
      "Hokusai is measured after stroke settlement; interactive worker/upload latency needs browser tracing.",
      "No single total score combines line art, dry texture, wet pigment, and procedural effects; each role has its own gate.",
    ],
    qualityGatePassed,
  };
}

function markdownTable(
  headers: readonly string[],
  rows: readonly (readonly (string | number | boolean | null)[])[],
): string {
  const escape = (value: string | number | boolean | null) => (
    String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ")
  );
  return [
    `| ${headers.map(escape).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escape).join(" | ")} |`),
  ].join("\n");
}

export function renderStudioBrushEngineSelectionMarkdown(
  report: StudioBrushEngineSelectionReport,
): string {
  const stabilizerRows = report.stabilization.candidates.map((candidate) => [
    candidate.id,
    candidate.jitterCrossTrackRmsPx,
    candidate.cornerDeviationAtTurnPx,
    candidate.fastMotionEndpointLagPx,
    candidate.endpointCatchUpErrorPx,
    candidate.frequencyInvariance.maximumRmsPx,
    candidate.fastFixtureMedianCpuMs,
  ]);
  const dynamicRows = report.dynamicRaster.brushes.map((brush) => (
    brush.available
      ? [
        brush.brushId,
        brush.dabCount,
        brush.liveIncrementalEqualsCommittedPlan,
        brush.seamExposure.centerlineGapRatio,
        brush.seamExposure.crossSectionWidthCoefficientOfVariation,
        brush.grainAnisotropyAndRepetition.scatterAnisotropyVarianceRatio,
        brush.grainAnisotropyAndRepetition.strongestPlanChannelRepetition,
        brush.overlapAlpha.monotonic,
        brush.erase.monotonic,
      ]
      : [brush.brushId, null, false, null, null, null, null, false, false]
  ));
  const decisions = report.roleDecisions.map((decision) => [
    decision.role,
    decision.selected,
    decision.status,
    decision.reason,
  ]);
  return [
    "# ToonSpectrum brush-engine role selection gate",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Overall Node gate: **${report.qualityGatePassed ? "PASS" : "FAIL"}**`,
    "",
    "This comparison does not reward dependency count and does not collapse line art, dry texture,",
    "wet pigment, and procedural effects into one misleading total score.",
    "",
    "## Role decisions",
    "",
    markdownTable(
      ["Role", "Selected provider", "Status", "Reason"],
      decisions,
    ),
    "",
    "## Pointer transport",
    "",
    `- Preservation: ${report.inputTransport.authoritativeAccepted}/${report.inputTransport.authoritativeExpectedAfterPointerDown}`,
    `- Ordered pressure/tilt/twist: ${report.inputTransport.pressureTiltTwistPreserved}`,
    `- Overlap samples removed: ${report.inputTransport.replayOverlapRemoved}`,
    "",
    "## Stabilization (same fixtures)",
    "",
    markdownTable(
      [
        "Candidate",
        "Jitter RMS px",
        "Corner dev px",
        "Fast endpoint lag px",
        "Flush error px",
        "60/120/240 max RMS px",
        "CPU ms",
      ],
      stabilizerRows,
    ),
    "",
    `Default: **${report.stabilization.defaultDecision.selected}** — ${report.stabilization.defaultDecision.reason}`,
    "",
    "## Perfect Freehand line art",
    "",
    report.lineArt.available
      ? [
        `- Geometry deterministic: ${report.lineArt.deterministicReplay}`,
        `- Pressure area ratio (high/low): ${report.lineArt.pressureResponse.highToLowAreaRatio}`,
        `- Endpoint/middle taper ratio: ${report.lineArt.taperResponse.maximumEndpointToMiddleRatio}`,
        `- Curvature p95 turn: ${report.lineArt.curvatureContinuity.p95TurnRadians} rad`,
        `- CPU: ${report.lineArt.medianCpuMs} ms`,
      ].join("\n")
      : `- Unavailable: ${report.lineArt.reason}`,
    "",
    "## Dynamic dab / dry texture",
    "",
    markdownTable(
      [
        "Brush",
        "Dabs",
        "Live=commit",
        "Gap ratio",
        "Width CV",
        "Scatter anisotropy",
        "Repeat proxy",
        "Alpha monotonic",
        "Erase monotonic",
      ],
      dynamicRows,
    ),
    "",
    "## Wet pigment",
    "",
    `- Watercolor/ink-wash distinct physical fields: ${report.wetInk.pigmentWetMixDistinctness.passed}`,
    `- Live/commit tile parity: ${report.wetInk.brushes.every((brush) => brush.passed)}`,
    "",
    "## Natural media",
    "",
    report.naturalMedia.available
      ? [
        `- Provider: ${report.naturalMedia.provider}`,
        `- Deterministic pixels: ${report.naturalMedia.deterministicSeedReplay}`,
        `- Seed changes pixels: ${report.naturalMedia.changedSeedChangesFrame}`,
        `- Visible pixels: ${report.naturalMedia.visiblePixels}`,
        `- Grain gradient anisotropy: ${report.naturalMedia.grainAnisotropy.alphaGradientRatio}`,
        `- CPU: ${report.naturalMedia.medianCpuMs} ms`,
      ].join("\n")
      : `- Unavailable: ${report.naturalMedia.reason}`,
    "",
    "## Long-stroke CPU / memory observations",
    "",
    markdownTable(
      ["Candidate", "CPU ms", "Observed heap delta bytes", "Estimated output bytes"],
      report.longStroke.candidates.map((candidate) => [
        candidate.id,
        candidate.medianCpuMs,
        candidate.observedHeapDeltaBytes,
        candidate.estimatedOutputBytes,
      ]),
    ),
    "",
    "## Mandatory external browser gates",
    "",
    ...report.externalBrowserGates.flatMap((gate) => [
      `- \`${gate.command}\``,
      `  - ${gate.reason}`,
    ]),
    "",
    "## Limits",
    "",
    ...report.limitations.map((limitation) => `- ${limitation}`),
    "",
  ].join("\n");
}
