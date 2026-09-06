/**
 * GPU bristle lane — parity metrics (gate G3), shared by the Node twin suite and the browser
 * verifier so both sides compute the *identical* statistic.
 *
 * PROVENANCE. The quantities measured here describe the David Li Fluid Paint bristle model
 * (github.com/dli/paint, MIT License, © 2017 David Li; notice at `third_party/dli-paint/LICENSE`);
 * `studioFluidPaintDistanceToSegment` is the MIT-attributed transcription of upstream
 * `shaders/splat.frag distanceToLine`. The metrics themselves are first-party.
 *
 * WHY NOT `studioLivingInkReference*`. Those helpers measure divergence, enstrophy and angular
 * momentum of a fluid. This lane has no fluid — nothing there applies, and reusing a fluid metric
 * on a constraint solver would produce a number that cannot fail for the right reason.
 *
 * DESIGN RULE. Every function takes plain typed arrays, never solver state, so a browser harness
 * can feed it a `mapAsync`'d GPU buffer and a Node test can feed it the f64 twin. Every threshold
 * lives in `./studio-gpu-bristle-contract`; none is ever inlined in a test.
 *
 * A gate that cannot fail is not a gate — each judge below names the mutation it catches.
 */

import { studioFluidPaintDistanceToSegment } from "../brush/studio-fluid-paint-reference";

import {
  STUDIO_GPU_BRISTLE_BRISTLE_LAYOUT,
  STUDIO_GPU_BRISTLE_COMPONENTS_PER_BRISTLE,
  STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT,
  STUDIO_GPU_BRISTLE_TIP_LAG_FLOOR_RATIO,
  STUDIO_GPU_BRISTLE_TOLERANCES,
} from "./studio-gpu-bristle-contract";

export const STUDIO_GPU_BRISTLE_METRICS_VERSION = "studio-gpu-bristle-metrics-v1" as const;

const POS_BASE = STUDIO_GPU_BRISTLE_BRISTLE_LAYOUT.members.pos!.offset / 4;

export type StudioGpuBristleFloats = Float32Array | Float64Array;

export interface StudioGpuBristleStateShape {
  readonly bristleCount: number;
  readonly verticesPerBristle: number;
  /** Per-bristle rest edge length in px. A single number applies to every bristle. */
  readonly restLengths: ArrayLike<number> | number;
}

export interface StudioGpuBristleJudgement {
  readonly metric: string;
  readonly value: number;
  readonly threshold: number;
  readonly pass: boolean;
  /** Human-readable reason, in English — this is a developer gate, not user copy. */
  readonly detail: string;
}

export class StudioGpuBristleMetricsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioGpuBristleMetricsError";
  }
}

function restLengthAt(shape: StudioGpuBristleStateShape, bristle: number): number {
  if (typeof shape.restLengths === "number") return shape.restLengths;
  const value = shape.restLengths[bristle];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new StudioGpuBristleMetricsError(`restLengths[${bristle}] is not a finite number`);
  }
  return value;
}

function requireStateLength(state: StudioGpuBristleFloats, shape: StudioGpuBristleStateShape): void {
  const expected = shape.bristleCount * STUDIO_GPU_BRISTLE_COMPONENTS_PER_BRISTLE;
  if (state.length < expected) {
    throw new StudioGpuBristleMetricsError(
      `bristle state holds ${state.length} components, expected at least ${expected}`,
    );
  }
}

/* -------------------------------------------------------------------------------------------- */
/* Constraint satisfaction                                                                         */
/* -------------------------------------------------------------------------------------------- */

/**
 * Largest relative chain-edge stretch after the solve, `max(|edge| / restLength) − 1`.
 *
 * An *output property* of the solver rather than a comparison against another implementation,
 * which is what makes it vendor independent.
 */
export function studioGpuBristleMaxEdgeViolation(
  state: StudioGpuBristleFloats,
  shape: StudioGpuBristleStateShape,
): number {
  requireStateLength(state, shape);
  let worst = 0;
  for (let bristle = 0; bristle < shape.bristleCount; bristle += 1) {
    const base = bristle * STUDIO_GPU_BRISTLE_COMPONENTS_PER_BRISTLE + POS_BASE;
    const rest = restLengthAt(shape, bristle);
    if (!(rest > 0)) continue;
    for (let vertex = 0; vertex + 1 < shape.verticesPerBristle; vertex += 1) {
      const a = base + vertex * 4;
      const b = base + (vertex + 1) * 4;
      const dx = state[b]! - state[a]!;
      const dy = state[b + 1]! - state[a + 1]!;
      const dz = state[b + 2]! - state[a + 2]!;
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const violation = Math.abs(length / rest - 1);
      if (violation > worst) worst = violation;
    }
  }
  return worst;
}

/**
 * Catches: a silently reduced iteration count, a mis-signed correction, and the loss of the
 * red/black edge split (which halves the per-sweep convergence of a chain).
 */
export function judgeStudioGpuBristleConstraintSatisfaction(
  state: StudioGpuBristleFloats,
  shape: StudioGpuBristleStateShape,
): StudioGpuBristleJudgement {
  const value = studioGpuBristleMaxEdgeViolation(state, shape);
  const threshold = STUDIO_GPU_BRISTLE_TOLERANCES.constraintSlack;
  return {
    metric: "constraint-satisfaction",
    value,
    threshold,
    pass: value <= threshold,
    detail: `max edge stretch ${value.toFixed(6)} vs slack ${threshold}`,
  };
}

/* -------------------------------------------------------------------------------------------- */
/* Deposit conservation                                                                            */
/* -------------------------------------------------------------------------------------------- */

/** `Σ(weight × π r²)` over every occupied splat slot. Totals, not per-pixel. */
export function studioGpuBristleSplatCoverage(splats: StudioGpuBristleFloats): number {
  if (splats.length % STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT !== 0) {
    throw new StudioGpuBristleMetricsError(
      `splat buffer length ${splats.length} is not a multiple of ${STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT}`,
    );
  }
  let total = 0;
  for (let slot = 0; slot < splats.length; slot += STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT) {
    const weight = splats[slot + 7]!;
    if (!(weight > 0)) continue;
    const radius = splats[slot + 8]!;
    total += weight * Math.PI * radius * radius;
  }
  return total;
}

/** Slots whose `pigment.w > 0`. Zero here means the lane painted nothing at all. */
export function studioGpuBristleDepositedSplatCount(splats: StudioGpuBristleFloats): number {
  let count = 0;
  for (let slot = 0; slot < splats.length; slot += STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT) {
    if (splats[slot + 7]! > 0) count += 1;
  }
  return count;
}

/**
 * Catches: a splat dropped at a batch boundary, a diverged capsule-radius formula, and a slot
 * capacity that silently truncates.
 */
export function judgeStudioGpuBristlePigmentConservation(
  candidate: StudioGpuBristleFloats,
  reference: StudioGpuBristleFloats,
): StudioGpuBristleJudgement {
  const referenceTotal = studioGpuBristleSplatCoverage(reference);
  const candidateTotal = studioGpuBristleSplatCoverage(candidate);
  const threshold = STUDIO_GPU_BRISTLE_TOLERANCES.pigmentConservation;
  const value =
    referenceTotal > 0
      ? Math.abs(candidateTotal - referenceTotal) / referenceTotal
      : candidateTotal > 0
        ? Number.POSITIVE_INFINITY
        : 0;
  return {
    metric: "pigment-conservation",
    value,
    threshold,
    pass: value <= threshold,
    detail: `coverage ${candidateTotal.toFixed(4)} vs reference ${referenceTotal.toFixed(4)}`,
  };
}

/* -------------------------------------------------------------------------------------------- */
/* Tip lag — the feature a one-vertex hair cannot produce                                          */
/* -------------------------------------------------------------------------------------------- */

/**
 * Maximum distance from a traced tip sample to the polyline the head has swept **up to that
 * sample**. A dli bristle tip trails behind its root through a corner and springs back; today's
 * shipped model snaps to a closed-form offset at every station and reports ≈ 0 here.
 *
 * `rootPath` and `tipPath` are interleaved `[x, y, x, y, …]` and must be the same length.
 */
export function studioGpuBristleTipLag(
  rootPath: ArrayLike<number>,
  tipPath: ArrayLike<number>,
): number {
  if (rootPath.length !== tipPath.length) {
    throw new StudioGpuBristleMetricsError(
      `rootPath length ${rootPath.length} does not match tipPath length ${tipPath.length}`,
    );
  }
  const samples = Math.floor(rootPath.length / 2);
  let worst = 0;
  for (let index = 0; index < samples; index += 1) {
    const tipX = tipPath[index * 2]!;
    const tipY = tipPath[index * 2 + 1]!;
    let nearest = Number.POSITIVE_INFINITY;
    for (let segment = 0; segment + 1 <= index; segment += 1) {
      const distance = studioFluidPaintDistanceToSegment(
        rootPath[segment * 2]!,
        rootPath[segment * 2 + 1]!,
        rootPath[(segment + 1) * 2]!,
        rootPath[(segment + 1) * 2 + 1]!,
        tipX,
        tipY,
      );
      if (distance < nearest) nearest = distance;
    }
    if (index === 0) {
      nearest = Math.hypot(tipX - rootPath[0]!, tipY - rootPath[1]!);
    }
    if (Number.isFinite(nearest) && nearest > worst) worst = nearest;
  }
  return worst;
}

/**
 * Catches: `BRISTLE_JITTER` dropped (+25 % measured), and — the point of this whole lane — the
 * chain silently degenerating to the shipped one-vertex model, which the absolute floor rejects
 * even when the reference has degenerated the same way. It does **not** catch `GRAVITY` removal:
 * a tuft pressed against the paper is already held there by the plane constraint, so gravity moves
 * this number by under 0.05 %. See the observability note in `./studio-gpu-bristle-reference.ts`.
 */
export function judgeStudioGpuBristleTipLag(
  candidateLagPx: number,
  referenceLagPx: number,
  bristleLengthPx: number,
): StudioGpuBristleJudgement {
  const threshold = STUDIO_GPU_BRISTLE_TOLERANCES.tipLagBand;
  const floor = STUDIO_GPU_BRISTLE_TIP_LAG_FLOOR_RATIO * bristleLengthPx;
  const relative =
    referenceLagPx > 0
      ? Math.abs(candidateLagPx - referenceLagPx) / referenceLagPx
      : Number.POSITIVE_INFINITY;
  const aboveFloor = candidateLagPx >= floor && referenceLagPx >= floor;
  return {
    metric: "tip-lag",
    value: relative,
    threshold,
    pass: aboveFloor && relative <= threshold,
    detail: aboveFloor
      ? `lag ${candidateLagPx.toFixed(4)}px vs reference ${referenceLagPx.toFixed(4)}px`
      : `lag ${candidateLagPx.toFixed(4)}px / reference ${referenceLagPx.toFixed(4)}px is below the ${floor.toFixed(4)}px degenerate-chain floor`,
  };
}

/* -------------------------------------------------------------------------------------------- */
/* Splay recovery                                                                                  */
/* -------------------------------------------------------------------------------------------- */

/**
 * Time constant of the tuft's approach to its post-step splay, in seconds: the elapsed time at
 * which the remaining deviation has fallen to `1/e` of the deviation at `stepIndex`. Linearly
 * interpolated between samples; an integral over many stations, not a single value.
 *
 * Returns the full observed duration when the series never reaches `1/e`, which fails the judge
 * rather than silently reporting a small number.
 */
export function studioGpuBristleSplayRecoveryTau(
  spread: ArrayLike<number>,
  dtSeconds: ArrayLike<number>,
  stepIndex: number,
): number {
  const samples = spread.length;
  if (samples === 0 || stepIndex < 0 || stepIndex >= samples) {
    throw new StudioGpuBristleMetricsError(
      `stepIndex ${stepIndex} is outside the ${samples}-sample series`,
    );
  }
  const settled = spread[samples - 1]!;
  const initialDeviation = Math.abs(spread[stepIndex]! - settled);
  if (!(initialDeviation > 0)) return 0;
  const target = initialDeviation / Math.E;
  let elapsed = 0;
  let previousDeviation = initialDeviation;
  for (let index = stepIndex + 1; index < samples; index += 1) {
    const step = dtSeconds[index] ?? 0;
    const deviation = Math.abs(spread[index]! - settled);
    if (deviation <= target) {
      const span = previousDeviation - deviation;
      const fraction = span > 0 ? (previousDeviation - target) / span : 0;
      return elapsed + step * Math.min(1, Math.max(0, fraction));
    }
    elapsed += step;
    previousDeviation = deviation;
  }
  return elapsed;
}

/**
 * Catches: a lost or mis-signed rest-pose recall, which is what gives the tuft a relaxation time at
 * all — without it the splay never returns and this number diverges rather than shifting.
 */
export function judgeStudioGpuBristleSplayRecovery(
  candidateTau: number,
  referenceTau: number,
): StudioGpuBristleJudgement {
  const threshold = STUDIO_GPU_BRISTLE_TOLERANCES.splayRecoveryTau;
  const value =
    referenceTau > 0
      ? Math.abs(candidateTau - referenceTau) / referenceTau
      : candidateTau > 0
        ? Number.POSITIVE_INFINITY
        : 0;
  return {
    metric: "splay-recovery-tau",
    value,
    threshold,
    pass: value <= threshold,
    detail: `tau ${candidateTau.toFixed(6)}s vs reference ${referenceTau.toFixed(6)}s`,
  };
}

/* -------------------------------------------------------------------------------------------- */
/* Terminal load distribution                                                                      */
/* -------------------------------------------------------------------------------------------- */

/** Per-bristle tip ink load at the end of a stroke — `pos[verticesPerBristle − 1].w`. */
export function studioGpuBristleTerminalLoads(
  state: StudioGpuBristleFloats,
  shape: StudioGpuBristleStateShape,
): Float64Array {
  requireStateLength(state, shape);
  const loads = new Float64Array(shape.bristleCount);
  const tip = shape.verticesPerBristle - 1;
  for (let bristle = 0; bristle < shape.bristleCount; bristle += 1) {
    const base = bristle * STUDIO_GPU_BRISTLE_COMPONENTS_PER_BRISTLE + POS_BASE;
    loads[bristle] = state[base + tip * 4 + 3]!;
  }
  return loads;
}

/** Two-sample Kolmogorov–Smirnov statistic: `max |F_a(x) − F_b(x)|`. */
export function studioGpuBristleKolmogorovSmirnov(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
): number {
  if (a.length === 0 || b.length === 0) {
    throw new StudioGpuBristleMetricsError("both samples must be non-empty");
  }
  const sortedA = Float64Array.from(a).sort();
  const sortedB = Float64Array.from(b).sort();
  let indexA = 0;
  let indexB = 0;
  let worst = 0;
  while (indexA < sortedA.length && indexB < sortedB.length) {
    const value = Math.min(sortedA[indexA]!, sortedB[indexB]!);
    while (indexA < sortedA.length && sortedA[indexA]! <= value) indexA += 1;
    while (indexB < sortedB.length && sortedB[indexB]! <= value) indexB += 1;
    const gap = Math.abs(indexA / sortedA.length - indexB / sortedB.length);
    if (gap > worst) worst = gap;
  }
  return worst;
}

/**
 * Catches: `STIFFNESS_VARIATION` or `BRISTLE_JITTER` dropped, which collapses a tuft of unequal
 * hairs into a uniform rake and pins every terminal load to the same value.
 */
export function judgeStudioGpuBristleTerminalLoadDistribution(
  candidate: ArrayLike<number>,
  reference: ArrayLike<number>,
): StudioGpuBristleJudgement {
  const value = studioGpuBristleKolmogorovSmirnov(candidate, reference);
  const threshold = STUDIO_GPU_BRISTLE_TOLERANCES.terminalLoadKs;
  return {
    metric: "terminal-load-ks",
    value,
    threshold,
    pass: value <= threshold,
    detail: `KS ${value.toFixed(6)} over ${candidate.length}/${reference.length} samples`,
  };
}

/** Population spread of a sample — used to prove a tuft is not a uniform rake. */
export function studioGpuBristleStandardDeviation(sample: ArrayLike<number>): number {
  if (sample.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < sample.length; index += 1) sum += sample[index]!;
  const mean = sum / sample.length;
  let variance = 0;
  for (let index = 0; index < sample.length; index += 1) {
    const delta = sample[index]! - mean;
    variance += delta * delta;
  }
  return Math.sqrt(variance / sample.length);
}

/** Every judgement failed by a set, most severe first — for a verifier's JSON report. */
export function studioGpuBristleFailures(
  judgements: readonly StudioGpuBristleJudgement[],
): readonly StudioGpuBristleJudgement[] {
  return judgements
    .filter((judgement) => !judgement.pass)
    .slice()
    .sort((left, right) => right.value / right.threshold - left.value / left.threshold);
}
