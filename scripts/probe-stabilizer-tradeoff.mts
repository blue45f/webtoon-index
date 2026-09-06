/**
 * Stabilizer strength/mode tradeoff probe (owner report 2026-08-14: 긴 선 미세 떨림).
 *
 * Feeds a seeded hand-tremor signal (perfectly straight intent + high-frequency noise) through the
 * production stabilizer at every strength/mode and reports what actually matters for the choice:
 * tremor passthrough (residual noise vs. input noise) against positional lag (how far the filtered
 * tip trails the true pointer). Pure Node — no browser, no rendering — so the numbers isolate the
 * input filter from paint.
 */
import {
  createStudioStrokeStabilizerState,
  describeStudioStabilizerLatency,
  stabilizeStudioStrokeSample,
  STUDIO_STABILIZER_MODES,
  type StudioStabilizerMode,
} from "../apps/web/src/domains/creator/brush/studio-stroke-stabilizer";

const TREMOR_AMPLITUDE_PX = 1.5;
const SAMPLE_INTERVAL_MS = 1000 / 120;
const SPEED_PX_PER_MS = Number(process.env.TOONSPECTRUM_PROBE_SPEED ?? "0.35"); // px/ms
const SAMPLE_COUNT = 900;

function tremorSignal(): Array<{ x: number; y: number; trueY: number; timeStamp: number }> {
  let state = 0x9e3779b9 >>> 0;
  const noise = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return ((state / 0xffffffff) * 2 - 1) * TREMOR_AMPLITUDE_PX;
  };
  return Array.from({ length: SAMPLE_COUNT }, (_, index) => {
    const timeStamp = index * SAMPLE_INTERVAL_MS;
    const trueY = 400;
    return {
      x: 100 + timeStamp * SPEED_PX_PER_MS,
      y: trueY + noise(),
      trueY,
      timeStamp,
    };
  });
}

function rms(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return Math.sqrt(values.reduce((total, value) => total + value * value, 0) / values.length);
}

interface Row {
  mode: StudioStabilizerMode;
  strength: number;
  tremorPassthroughPct: number;
  lagPx: number;
  estimatedLatencyMs: number | null;
}

function measure(mode: StudioStabilizerMode, strength: number): Row {
  const samples = tremorSignal();
  const first = samples[0]!;
  let state = createStudioStrokeStabilizerState({ x: first.x, y: first.y, timeStamp: first.timeStamp });
  const residuals: number[] = [];
  const lags: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const sample = samples[index]!;
    const result = stabilizeStudioStrokeSample(
      state,
      { x: sample.x, y: sample.y, timeStamp: sample.timeStamp },
      { strength, mode },
    );
    state = result.state;
    const [pointX, pointY] = result.point;
    // Warm-up: skip the first quarter so filter priming does not inflate lag.
    if (index < samples.length / 4) continue;
    residuals.push(pointY - sample.trueY);
    lags.push(sample.x - pointX);
  }
  const inputRms = rms(samples.map((sample) => sample.y - sample.trueY));
  return {
    mode,
    strength,
    tremorPassthroughPct: (rms(residuals) / inputRms) * 100,
    lagPx: lags.reduce((total, value) => total + value, 0) / Math.max(1, lags.length),
    estimatedLatencyMs: describeStudioStabilizerLatency(mode, strength).estimatedMs,
  };
}

const rows: Row[] = [];
for (const { id } of STUDIO_STABILIZER_MODES) {
  for (const strength of [0, 1, 2, 3, 4, 6, 8, 10]) rows.push(measure(id, strength));
}

console.log("mode        strength  tremor%   lagPx   latencyMs");
for (const row of rows) {
  console.log(
    `${row.mode.padEnd(11)} ${String(row.strength).padStart(6)}  `
      + `${row.tremorPassthroughPct.toFixed(1).padStart(6)}  `
      + `${row.lagPx.toFixed(2).padStart(6)}  `
      + `${row.estimatedLatencyMs === null ? "     -" : row.estimatedLatencyMs.toFixed(0).padStart(6)}`,
  );
}
