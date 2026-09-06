/**
 * GPU bristle lane — deterministic f64 CPU twin of the dli position-based-dynamics bristle chain.
 *
 * PROVENANCE. Derived from David Li's Fluid Paint (github.com/dli/paint, MIT License,
 * © 2017 David Li, http://david.li), verbatim permission notice checked in at
 * `third_party/dli-paint/LICENSE`. Upstream files: `brush.js` and its constraint fragment shaders
 * `project.frag` (Verlet integrate + gravity), `setbristles.frag` (pin the chain root to the brush
 * head), `distanceconstraint.frag`, `bendingconstraint.frag`, `planeconstraint.frag` and
 * `updatevelocity.frag`; plus `shaders/splat.frag` for the capsule stamp. Every numeric tunable is
 * imported from `./studio-gpu-bristle-contract`, which re-exports the MIT-attributed transcription
 * in `../brush/studio-fluid-paint-reference.ts`. Nothing is re-typed here.
 *
 * WHAT THIS IS FOR. The lane's WGSL kernel cannot be bit-compared against a CPU mirror — twenty
 * Gauss-Seidel sweeps of FMA-contracted f32 diverge from JS f64 within a handful of steps, and this
 * repo already concedes the point (`../studio-living-ink-fluid-reference.ts` exists for the same
 * reason). This module is therefore a *statistical* oracle: it computes the same physics in f64 so
 * `./studio-gpu-bristle-metrics` can compare invariants and distributions. It is an explicitly
 * selected reference/QA provider, never a runtime substitute for an unavailable WebGPU stroke.
 *
 * DETERMINISM CONTRACT, matching `../studio-bristle-physics-oil-v1.ts:28-31`: no clock, no
 * `Math.random`, no iteration over object key order. Same input → identical typed arrays. The tuft
 * layout is a pure function of `(seed, bristleIndex, channel)` via `studioGpuBristleUnitHash`, and
 * every per-station timestep travels inside the station record rather than being derived from the
 * station index — that is what makes an incremental suffix solve byte-identical to a from-scratch
 * replay (gate G1).
 *
 * ADAPTATIONS, stated so nobody mistakes them for upstream:
 * - dli runs six ping-ponged fragment passes twenty times because a 2017 fragment shader cannot
 *   write an arbitrary address. There are **no inter-bristle constraints** in the model (distance,
 *   bending and plane are all intra-chain), so the whole chain and all twenty iterations collapse
 *   into one serial loop. This twin is written in that shape so the WGSL transcription is literal.
 * - The head's height above the canvas plane is driven by stylus pressure:
 *   `headZ = (BRISTLE_LENGTH − BRUSH_HEIGHT × pressure) × scale`. At zero pressure the nominal tip
 *   just grazes the plane; at full pressure the head is pressed `BRUSH_HEIGHT × scale` below what
 *   the chain can reach, and the plane constraint converts that into splay. dli drives the same
 *   quantity from a mouse-height slider.
 * - `BRISTLE_JITTER` perturbs each hair's **length** (`±jitter/2` relative). A tuft of identical
 *   hairs is a uniform rake; unequal hairs are what makes some contact early and starve first.
 * - Ink load is not upstream at all — dli's brush carries no pigment reservoir. It is added here as
 *   a per-vertex channel with conservative root→tip capillary transport, because the shipped CPU
 *   lane already models loading (`packages/studio-brush-platform/src/bristle-model.ts`) and losing
 *   it would be a quality regression, not a simplification.
 * - A **rest-pose recall** with a stiffness-driven flare. Distance and bending constraints are both
 *   direction-free: they fix lengths and collinearity and are satisfied by a chain pointing
 *   anywhere. Without a rest pose, a pressed tuft drifts outward into a taut diagonal that
 *   satisfies every constraint, the tips lift off the paper within about forty stations, and the
 *   brush never springs back when lifted — all three were measured before this term was added. It
 *   is applied once per station as an elastic force, never once per Gauss-Seidel iteration.
 *
 * MEASURED OBSERVABILITY, recorded so no gate claims more than it can prove. Against a 300-station
 * 90° corner at pressure 0.6 with 44 hairs, removing `STIFFNESS_VARIATION` moves total deposited
 * coverage by −26 %, removing `BRISTLE_JITTER` by +8 % and tip lag by +25 %, removing bending by
 * −13 %, and removing the rest-pose recall by −81 % — every one of those trips a G3 threshold.
 * `BRUSH_DAMPING` is weak (−1.6 % on tip lag, +7 % on the terminal-load spread) and `GRAVITY` is
 * **not observable at all** (< 0.05 % on every metric), because a tuft pressed against the plane is
 * already held there by the plane constraint. Both are retained because they are dli's model, but
 * no gate here claims to catch their removal.
 */

import {
  STUDIO_GPU_BRISTLE_BRISTLE_LAYOUT,
  STUDIO_GPU_BRISTLE_COMPONENTS_PER_BRISTLE,
  STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT,
  STUDIO_GPU_BRISTLE_LIMITS,
  STUDIO_GPU_BRISTLE_PHYSICS_DEFAULTS,
  STUDIO_FLUID_PAINT_BRUSH,
  STUDIO_GPU_BRISTLE_DLI_PAINTING,
  clampStudioGpuBristleCount,
  clampStudioGpuBristleStationDtMs,
  studioGpuBristleSplatCapacity,
  studioGpuBristleSplatSlot,
  studioGpuBristleUnitHash,
} from "./studio-gpu-bristle-contract";

export const STUDIO_GPU_BRISTLE_REFERENCE_VERSION = "studio-gpu-bristle-reference-v1" as const;

const TAU = Math.PI * 2;
const POS_BASE = 0;
const PREV_BASE = STUDIO_GPU_BRISTLE_BRISTLE_LAYOUT.members.prev!.offset / 4;
const PARAMS_BASE = STUDIO_GPU_BRISTLE_BRISTLE_LAYOUT.members.params!.offset / 4;

export class StudioGpuBristleReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioGpuBristleReferenceError";
  }
}

export interface StudioGpuBristleStation {
  readonly x: number;
  readonly y: number;
  /** Stylus pressure in [0, 1]. */
  readonly pressure: number;
  /** Elapsed time since the previous station, in milliseconds. Never derived from the index. */
  readonly dtMs: number;
  readonly tiltX?: number;
  readonly tiltY?: number;
  /** Head speed in device px per second. Derived from the previous station when omitted. */
  readonly speed?: number;
}

export interface StudioGpuBristleTuftOptions {
  /** Brush head radius in device px. This is dli's brush `scale`. */
  readonly baseRadiusPx: number;
  readonly bristleCount?: number;
  /** Deterministic layout seed. Same seed → same tuft, forever. */
  readonly seed?: number;
  /** Pigment in RYB (see `studioFluidPaintRgbToRyb`). */
  readonly ink?: readonly [number, number, number];
  /** Initial per-vertex ink load in [0, 1]. */
  readonly inkLoad?: number;
  readonly gravity?: number;
  readonly damping?: number;
  readonly iterations?: number;
  readonly bristleLength?: number;
  readonly bristleJitter?: number;
  readonly stiffnessVariation?: number;
  readonly brushHeight?: number;
  readonly zThreshold?: number;
  readonly splatRadius?: number;
  readonly splatVelocityScale?: number;
  readonly bendStiffnessRatio?: number;
  readonly distanceSweepsPerIteration?: number;
  readonly restPoseStiffnessRatio?: number;
  readonly restPoseFlareRatio?: number;
  readonly capillaryRate?: number;
  readonly depletionRate?: number;
  readonly minSplatRadiusPx?: number;
}

export interface StudioGpuBristleResolvedConfig {
  readonly baseRadiusPx: number;
  readonly bristleCount: number;
  readonly verticesPerBristle: number;
  readonly seed: number;
  readonly ink: readonly [number, number, number];
  readonly inkLoad: number;
  readonly gravity: number;
  readonly damping: number;
  readonly iterations: number;
  readonly bristleLength: number;
  readonly bristleJitter: number;
  readonly stiffnessVariation: number;
  readonly brushHeight: number;
  readonly zThreshold: number;
  readonly splatRadius: number;
  readonly splatVelocityScale: number;
  readonly bendStiffnessRatio: number;
  readonly distanceSweepsPerIteration: number;
  readonly restPoseStiffnessRatio: number;
  readonly restPoseFlareRatio: number;
  readonly capillaryRate: number;
  readonly depletionRate: number;
  readonly minSplatRadiusPx: number;
}

export interface StudioGpuBristleTrace {
  /** `[x, y]` of the head per station. */
  readonly root: Float64Array;
  /** `[x, y]` of the traced bristle's tip per station. */
  readonly tip: Float64Array;
  /** Mean per-hair root→tip lateral distance per station — the tuft's splay. */
  readonly spread: Float64Array;
  /** Per-station timestep in seconds, after clamping. */
  readonly dtSeconds: Float64Array;
}

export interface StudioGpuBristleAdvanceResult {
  /** Stations consumed by this call. */
  readonly stationCount: number;
  /** Stations consumed by this stroke so far. */
  readonly consumedStationCount: number;
  /** `stationCount * bristleCount` records of 12 f64, station-major (see `studioGpuBristleSplatSlot`). */
  readonly splats: Float64Array;
  readonly splatCapacity: number;
  /** Slots whose `pigment.w > 0`. */
  readonly depositedSplatCount: number;
  readonly trace: StudioGpuBristleTrace | null;
}

export interface StudioGpuBristleReference {
  readonly config: StudioGpuBristleResolvedConfig;
  /** `bristleCount × 84` f64, laid out exactly like the WGSL `Bristle` array. */
  readonly bristleState: Float64Array;
  /** Per-bristle rest edge length in px (index by bristle). */
  readonly restLengths: Float64Array;
  consumedStationCount: number;
  placed: boolean;
  lastX: number;
  lastY: number;
  lastPressure: number;
  readonly speedRing: Float64Array;
  speedRingCount: number;
}

function optionalFinite(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new StudioGpuBristleReferenceError(
      `${name} must be a finite number, got ${String(value)}`,
    );
  }
  return value;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value >= 1 ? 1 : value;
}

/** Resolve tuft options against the contract defaults. Exported so the GPU lane shares it. */
export function resolveStudioGpuBristleConfig(
  options: StudioGpuBristleTuftOptions,
): StudioGpuBristleResolvedConfig {
  const defaults = STUDIO_GPU_BRISTLE_PHYSICS_DEFAULTS;
  const baseRadiusPx = optionalFinite("baseRadiusPx", options.baseRadiusPx, Number.NaN);
  if (!(baseRadiusPx > 0)) {
    throw new StudioGpuBristleReferenceError(
      `baseRadiusPx must be positive, got ${String(options.baseRadiusPx)}`,
    );
  }
  const iterations = Math.round(
    optionalFinite("iterations", options.iterations, defaults.iterations),
  );
  if (iterations < 1) {
    throw new StudioGpuBristleReferenceError(`iterations must be ≥ 1, got ${iterations}`);
  }
  const ink = options.ink ?? ([1, 1, 1] as const);
  return Object.freeze({
    baseRadiusPx,
    bristleCount: clampStudioGpuBristleCount(
      options.bristleCount ?? STUDIO_GPU_BRISTLE_DLI_PAINTING.minBristleCount,
    ),
    verticesPerBristle: STUDIO_GPU_BRISTLE_LIMITS.verticesPerBristle,
    seed: Math.trunc(optionalFinite("seed", options.seed, 1)) | 0,
    ink: Object.freeze([clamp01(ink[0]), clamp01(ink[1]), clamp01(ink[2])] as const) as readonly [
      number,
      number,
      number,
    ],
    inkLoad: clamp01(optionalFinite("inkLoad", options.inkLoad, 1)),
    gravity: optionalFinite("gravity", options.gravity, defaults.gravity),
    damping: optionalFinite("damping", options.damping, defaults.damping),
    iterations,
    bristleLength: optionalFinite("bristleLength", options.bristleLength, defaults.bristleLength),
    bristleJitter: optionalFinite("bristleJitter", options.bristleJitter, defaults.bristleJitter),
    stiffnessVariation: optionalFinite(
      "stiffnessVariation",
      options.stiffnessVariation,
      defaults.stiffnessVariation,
    ),
    brushHeight: optionalFinite("brushHeight", options.brushHeight, defaults.brushHeight),
    zThreshold: optionalFinite("zThreshold", options.zThreshold, defaults.zThreshold),
    splatRadius: optionalFinite("splatRadius", options.splatRadius, defaults.splatRadius),
    splatVelocityScale: optionalFinite(
      "splatVelocityScale",
      options.splatVelocityScale,
      defaults.splatVelocityScale,
    ),
    bendStiffnessRatio: optionalFinite(
      "bendStiffnessRatio",
      options.bendStiffnessRatio,
      defaults.bendStiffnessRatio,
    ),
    distanceSweepsPerIteration: Math.max(
      1,
      Math.round(
        optionalFinite(
          "distanceSweepsPerIteration",
          options.distanceSweepsPerIteration,
          defaults.distanceSweepsPerIteration,
        ),
      ),
    ),
    restPoseStiffnessRatio: optionalFinite(
      "restPoseStiffnessRatio",
      options.restPoseStiffnessRatio,
      defaults.restPoseStiffnessRatio,
    ),
    restPoseFlareRatio: optionalFinite(
      "restPoseFlareRatio",
      options.restPoseFlareRatio,
      defaults.restPoseFlareRatio,
    ),
    capillaryRate: optionalFinite("capillaryRate", options.capillaryRate, defaults.capillaryRate),
    depletionRate: optionalFinite("depletionRate", options.depletionRate, defaults.depletionRate),
    minSplatRadiusPx: optionalFinite(
      "minSplatRadiusPx",
      options.minSplatRadiusPx,
      defaults.minSplatRadiusPx,
    ),
  });
}

/** Per-bristle layout draw. Pure in `(seed, bristleIndex)`; no storage needed on either side. */
export interface StudioGpuBristleLayoutDraw {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly directionX: number;
  readonly directionY: number;
  readonly lengthScale: number;
  readonly stiffness: number;
}

export function studioGpuBristleLayoutDraw(
  config: StudioGpuBristleResolvedConfig,
  bristleIndex: number,
): StudioGpuBristleLayoutDraw {
  const radial = Math.sqrt(studioGpuBristleUnitHash(config.seed, bristleIndex, 1));
  const angle = studioGpuBristleUnitHash(config.seed, bristleIndex, 2) * TAU;
  const directionX = Math.cos(angle);
  const directionY = Math.sin(angle);
  const radius = radial * config.baseRadiusPx;
  const jitter = studioGpuBristleUnitHash(config.seed, bristleIndex, 3) - 0.5;
  const stiffnessDraw = studioGpuBristleUnitHash(config.seed, bristleIndex, 4);
  return {
    offsetX: directionX * radius,
    offsetY: directionY * radius,
    directionX,
    directionY,
    lengthScale: 1 + config.bristleJitter * jitter,
    stiffness: 1 - config.stiffnessVariation * stiffnessDraw,
  };
}

export function createStudioGpuBristleReference(
  options: StudioGpuBristleTuftOptions,
): StudioGpuBristleReference {
  const config = resolveStudioGpuBristleConfig(options);
  const reference: StudioGpuBristleReference = {
    config,
    bristleState: new Float64Array(config.bristleCount * STUDIO_GPU_BRISTLE_COMPONENTS_PER_BRISTLE),
    restLengths: new Float64Array(config.bristleCount),
    consumedStationCount: 0,
    placed: false,
    lastX: 0,
    lastY: 0,
    lastPressure: 0,
    speedRing: new Float64Array(STUDIO_FLUID_PAINT_BRUSH.previousSpeeds),
    speedRingCount: 0,
  };
  resetStudioGpuBristleReference(reference);
  return reference;
}

/**
 * Drop every trace of the current stroke. The host calls this on a prefix break — the documented
 * 4096-dab arc refit, an undo, or a pressure-array resample — and replays from station 0. A naive
 * "append the new stations" cache silently desyncs the tuft; here the recovery is one dispatch, so
 * `reset` is an explicit operation and never an implicit fallback.
 */
export function resetStudioGpuBristleReference(reference: StudioGpuBristleReference): void {
  reference.bristleState.fill(0);
  reference.restLengths.fill(0);
  reference.speedRing.fill(0);
  reference.speedRingCount = 0;
  reference.consumedStationCount = 0;
  reference.placed = false;
  reference.lastX = 0;
  reference.lastY = 0;
  reference.lastPressure = 0;
  const { config } = reference;
  for (let bristle = 0; bristle < config.bristleCount; bristle += 1) {
    const draw = studioGpuBristleLayoutDraw(config, bristle);
    const base = bristle * STUDIO_GPU_BRISTLE_COMPONENTS_PER_BRISTLE;
    const length = config.bristleLength * config.baseRadiusPx * draw.lengthScale;
    reference.restLengths[bristle] = length / (config.verticesPerBristle - 1);
    reference.bristleState[base + PARAMS_BASE] = draw.stiffness;
    reference.bristleState[base + PARAMS_BASE + 1] = draw.lengthScale;
    reference.bristleState[base + PARAMS_BASE + 2] = config.inkLoad;
    reference.bristleState[base + PARAMS_BASE + 3] = length / (config.verticesPerBristle - 1);
  }
}

function placeTuft(
  reference: StudioGpuBristleReference,
  headX: number,
  headY: number,
  headZ: number,
): void {
  const { config, bristleState } = reference;
  const vertices = config.verticesPerBristle;
  for (let bristle = 0; bristle < config.bristleCount; bristle += 1) {
    const draw = studioGpuBristleLayoutDraw(config, bristle);
    const base = bristle * STUDIO_GPU_BRISTLE_COMPONENTS_PER_BRISTLE;
    const length = config.bristleLength * config.baseRadiusPx * draw.lengthScale;
    const rootX = headX + draw.offsetX;
    const rootY = headY + draw.offsetY;
    for (let vertex = 0; vertex < vertices; vertex += 1) {
      const t = vertex / (vertices - 1);
      const straightZ = headZ - t * length;
      // Straight down until the plane, then straight out along the hair's own radial direction.
      // Path length is preserved edge-for-edge except on the single straddling edge, which the
      // first constraint sweep repairs.
      const buckle = straightZ < 0 ? -straightZ : 0;
      const slot = base + POS_BASE + vertex * 4;
      const x = rootX + draw.directionX * buckle;
      const y = rootY + draw.directionY * buckle;
      const z = straightZ < 0 ? 0 : straightZ;
      bristleState[slot] = x;
      bristleState[slot + 1] = y;
      bristleState[slot + 2] = z;
      bristleState[slot + 3] = config.inkLoad;
      const previous = base + PREV_BASE + vertex * 4;
      bristleState[previous] = x;
      bristleState[previous + 1] = y;
      bristleState[previous + 2] = z;
      bristleState[previous + 3] = config.inkLoad;
    }
  }
  reference.placed = true;
}

/**
 * `distanceconstraint.frag` / `bendingconstraint.frag`.
 *
 * `fallbackX/Y` is the hair's own radial direction, used when two vertices have collapsed onto each
 * other. That happens routinely: a chain pressed straight down into the plane piles its lower
 * vertices at one point, and a guard that simply returns leaves them piled forever. Splaying them
 * outward along the hair's radial axis is both the deterministic choice and the physical one — it
 * is how a pressed tuft opens.
 */
function solveDistance(
  state: Float64Array,
  base: number,
  a: number,
  b: number,
  rest: number,
  stiffness: number,
  fallbackX: number,
  fallbackY: number,
): void {
  const ai = base + POS_BASE + a * 4;
  const bi = base + POS_BASE + b * 4;
  const dx = state[bi]! - state[ai]!;
  const dy = state[bi + 1]! - state[ai + 1]!;
  const dz = state[bi + 2]! - state[ai + 2]!;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(distance > 1e-9)) {
    // Exact deterministic separation: place `b` one rest length out along the hair's radial axis.
    // Scaling a unit fallback through the correction formula would move it by an arbitrary amount.
    state[bi] = state[ai]! + fallbackX * rest;
    state[bi + 1] = state[ai + 1]! + fallbackY * rest;
    state[bi + 2] = state[ai + 2]!;
    return;
  }
  // Vertex 0 is pinned to the ferrule, so it carries zero inverse mass.
  const weightA = a === 0 ? 0 : 1;
  const total = weightA + 1;
  const correction = ((distance - rest) / distance) * stiffness;
  if (weightA > 0) {
    const share = (weightA / total) * correction;
    state[ai] = state[ai]! + dx * share;
    state[ai + 1] = state[ai + 1]! + dy * share;
    state[ai + 2] = state[ai + 2]! + dz * share;
  }
  const shareB = (1 / total) * correction;
  state[bi] = state[bi]! - dx * shareB;
  state[bi + 1] = state[bi + 1]! - dy * shareB;
  state[bi + 2] = state[bi + 2]! - dz * shareB;
}

interface StationStepOutput {
  readonly tipX: number;
  readonly tipY: number;
  readonly previousTipX: number;
  readonly previousTipY: number;
  readonly contact: number;
  readonly load: number;
  /** Lateral distance from this hair's own root to its tip — the hair's splay. */
  readonly splay: number;
}

function stepBristle(
  reference: StudioGpuBristleReference,
  bristle: number,
  headX: number,
  headY: number,
  headZ: number,
  dtSeconds: number,
): StationStepOutput {
  const { config, bristleState: state } = reference;
  const vertices = config.verticesPerBristle;
  const base = bristle * STUDIO_GPU_BRISTLE_COMPONENTS_PER_BRISTLE;
  const stiffness = state[base + PARAMS_BASE]!;
  const rest = state[base + PARAMS_BASE + 3]!;
  const draw = studioGpuBristleLayoutDraw(config, bristle);
  // dli's GRAVITY is expressed in the same scale-relative units as BRISTLE_LENGTH and
  // BRUSH_HEIGHT, so it is multiplied by the brush scale to reach device px/s².
  const gravityStep = config.gravity * config.baseRadiusPx * dtSeconds * dtSeconds;

  // 1. project.frag — Verlet integrate every free vertex, then apply gravity along −z.
  for (let vertex = 1; vertex < vertices; vertex += 1) {
    const slot = base + POS_BASE + vertex * 4;
    const previous = base + PREV_BASE + vertex * 4;
    const px = state[slot]!;
    const py = state[slot + 1]!;
    const pz = state[slot + 2]!;
    const vx = (px - state[previous]!) * config.damping;
    const vy = (py - state[previous + 1]!) * config.damping;
    const vz = (pz - state[previous + 2]!) * config.damping;
    state[previous] = px;
    state[previous + 1] = py;
    state[previous + 2] = pz;
    state[previous + 3] = state[slot + 3]!;
    state[slot] = px + vx;
    state[slot + 1] = py + vy;
    state[slot + 2] = pz + vz - gravityStep;
  }

  // 2. setbristles.frag — pin the root to the ferrule.
  const rootSlot = base + POS_BASE;
  const rootPrevious = base + PREV_BASE;
  state[rootPrevious] = state[rootSlot]!;
  state[rootPrevious + 1] = state[rootSlot + 1]!;
  state[rootPrevious + 2] = state[rootSlot + 2]!;
  state[rootPrevious + 3] = state[rootSlot + 3]!;
  state[rootSlot] = headX + draw.offsetX;
  state[rootSlot + 1] = headY + draw.offsetY;
  state[rootSlot + 2] = headZ;

  // 3. The rest-pose recall once, then Gauss-Seidel `iterations` times over
  //    bending → plane → distance (red/black × `distanceSweepsPerIteration`). Distance runs LAST
  //    inside each iteration because it is the constraint the G3 satisfaction gate measures;
  //    clamping to the plane after it would leave a residual stretch on every edge that crosses the
  //    paper. Measured with one sweep instead of five: a 4 % residual that no number of outer
  //    iterations removes, because the black half of the split always perturbs the edges the red
  //    half just fixed.
  const bendStiffness = stiffness * config.bendStiffnessRatio;
  const restPoseStiffness = stiffness * config.restPoseStiffnessRatio;
  // A stiff hair rests straight along the ferrule axis; a soft one flares outward — which is why a
  // real round brush has a cone-shaped tuft rather than a cylinder. This is what makes
  // STIFFNESS_VARIATION an equilibrium parameter instead of a mere convergence rate: with twenty
  // iterations every stiffness value converges to the same place, so a stiffness that only scaled
  // the correction factor would wash out entirely and the KS gate below could not see it.
  const flare = (1 - stiffness) * config.restPoseFlareRatio;
  const flareDrop = Math.sqrt(Math.max(0, 1 - flare * flare));
  const rootX = state[rootSlot]!;
  const rootY = state[rootSlot + 1]!;
  const rootZ = state[rootSlot + 2]!;
  // `setbristles.frag` — the hair's own elasticity recalls it toward the rest pose hanging from the
  // ferrule. Applied ONCE per station, as an elastic force, not once per Gauss-Seidel iteration:
  // twenty projections per station pull the chain 88 % of the way home every 8 ms, which erases the
  // Verlet velocity entirely and turns the solver quasi-static — i.e. back into the closed-form
  // model this lane exists to replace. Once per station leaves a real relaxation time, so
  // BRUSH_DAMPING and the tip's inertia survive to the mark.
  for (let vertex = 1; vertex < vertices; vertex += 1) {
    const slot = base + POS_BASE + vertex * 4;
    const reach = vertex * rest;
    state[slot] += (rootX + draw.directionX * flare * reach - state[slot]!) * restPoseStiffness;
    state[slot + 1] +=
      (rootY + draw.directionY * flare * reach - state[slot + 1]!) * restPoseStiffness;
    state[slot + 2] += (rootZ - reach * flareDrop - state[slot + 2]!) * restPoseStiffness;
  }
  for (let iteration = 0; iteration < config.iterations; iteration += 1) {
    for (let vertex = 0; vertex + 2 < vertices; vertex += 1) {
      solveDistance(
        state,
        base,
        vertex,
        vertex + 2,
        rest * 2,
        bendStiffness,
        draw.directionX,
        draw.directionY,
      );
    }
    for (let vertex = 1; vertex < vertices; vertex += 1) {
      const slot = base + POS_BASE + vertex * 4;
      if (state[slot + 2]! < 0) state[slot + 2] = 0;
    }
    for (let sweep = 0; sweep < config.distanceSweepsPerIteration; sweep += 1) {
      for (let parity = 0; parity < 2; parity += 1) {
        for (let edge = parity; edge + 1 < vertices; edge += 2) {
          solveDistance(
            state,
            base,
            edge,
            edge + 1,
            rest,
            stiffness,
            draw.directionX,
            draw.directionY,
          );
        }
      }
    }
  }

  // 4. Capillary transport, root → tip only, conservative within the hair.
  for (let vertex = 0; vertex + 1 < vertices; vertex += 1) {
    const from = base + POS_BASE + vertex * 4 + 3;
    const to = base + POS_BASE + (vertex + 1) * 4 + 3;
    const flow = (state[from]! - state[to]!) * config.capillaryRate;
    if (flow > 0) {
      state[from] = state[from]! - flow;
      state[to] = state[to]! + flow;
    }
  }

  const tip = vertices - 1;
  const tipSlot = base + POS_BASE + tip * 4;
  const tipPrevious = base + PREV_BASE + tip * 4;
  // Deposit strength is read out of the solved chain, never from pressure directly. A hair only
  // marks while its tip is inside the Z_THRESHOLD band, and how hard it marks is how far that tip
  // has been pushed sideways out from under its own root — which is buckling, i.e. exactly what
  // pressure does to a brush. Normalised by the head's pressure travel `BRUSH_HEIGHT × scale`, so
  // it is dimensionless. Every G3 failure mode moves this number: dropping STIFFNESS_VARIATION
  // makes every hair splay identically, dropping gravity or damping removes the drag component,
  // and collapsing the chain to one vertex pins splay at zero.
  const band = config.zThreshold * config.baseRadiusPx;
  const travel = config.brushHeight * config.baseRadiusPx;
  const splay = Math.hypot(
    state[tipSlot]! - state[rootSlot]!,
    state[tipSlot + 1]! - state[rootSlot + 1]!,
  );
  const contact = state[tipSlot + 2]! < band && travel > 0 ? clamp01(splay / travel) : 0;
  const load = clamp01(state[tipSlot + 3]!);
  if (contact > 0) {
    state[tipSlot + 3] = state[tipSlot + 3]! * (1 - config.depletionRate * contact);
  }
  return {
    tipX: state[tipSlot]!,
    tipY: state[tipSlot + 1]!,
    previousTipX: state[tipPrevious]!,
    previousTipY: state[tipPrevious + 1]!,
    contact,
    load,
    splay,
  };
}

function pushSpeed(reference: StudioGpuBristleReference, speed: number): number {
  const window = reference.speedRing.length;
  reference.speedRing[reference.speedRingCount % window] = speed;
  reference.speedRingCount += 1;
  const filled = Math.min(reference.speedRingCount, window);
  let peak = 0;
  for (let index = 0; index < filled; index += 1) {
    const value = reference.speedRing[index]!;
    if (value > peak) peak = value;
  }
  return peak;
}

/**
 * Step the tuft over `stations` and emit one capsule splat per bristle per station.
 *
 * The splat array is station-major (`studioGpuBristleSplatSlot`), so the emitted sequence is
 * identical whether the caller hands over 3,200 stations at once or one at a time — the property
 * gate G1 asserts. Unused slots carry `pigment.w = 0`.
 */
export function advanceStudioGpuBristleReference(
  reference: StudioGpuBristleReference,
  stations: readonly StudioGpuBristleStation[],
  options?: { readonly trace?: boolean; readonly traceBristle?: number },
): StudioGpuBristleAdvanceResult {
  const { config } = reference;
  const stationCount = stations.length;
  const capacity = studioGpuBristleSplatCapacity(config.bristleCount, stationCount);
  const splats = new Float64Array(capacity * STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT);
  const wantTrace = options?.trace === true;
  const traceBristle = Math.min(
    Math.max(0, Math.trunc(options?.traceBristle ?? 0)),
    Math.max(0, config.bristleCount - 1),
  );
  const trace: StudioGpuBristleTrace | null = wantTrace
    ? {
        root: new Float64Array(stationCount * 2),
        tip: new Float64Array(stationCount * 2),
        spread: new Float64Array(stationCount),
        dtSeconds: new Float64Array(stationCount),
      }
    : null;
  let deposited = 0;

  for (let index = 0; index < stationCount; index += 1) {
    const station = stations[index]!;
    const dtMs = clampStudioGpuBristleStationDtMs(station.dtMs);
    const dtSeconds = dtMs / 1000;
    const pressure = clamp01(station.pressure);
    const headZ = (config.bristleLength - config.brushHeight * pressure) * config.baseRadiusPx;
    const tiltX = Number.isFinite(station.tiltX ?? 0) ? (station.tiltX ?? 0) : 0;
    const tiltY = Number.isFinite(station.tiltY ?? 0) ? (station.tiltY ?? 0) : 0;
    // A tilted ferrule leans by the tilt angle over its own height; no new constant is needed.
    const headX = station.x + tiltX * headZ;
    const headY = station.y + tiltY * headZ;

    const travelled = reference.placed
      ? Math.hypot(station.x - reference.lastX, station.y - reference.lastY)
      : 0;
    const rawSpeed =
      station.speed !== undefined && Number.isFinite(station.speed)
        ? Math.abs(station.speed)
        : dtSeconds > 0
          ? travelled / dtSeconds
          : 0;
    const filteredSpeed = pushSpeed(reference, rawSpeed);
    // Dimensionless: how far the head travelled this station relative to its own radius.
    const normalizedSpeed = clamp01((filteredSpeed * dtSeconds) / config.baseRadiusPx);
    const radius = Math.max(
      config.minSplatRadiusPx,
      config.splatRadius
        * config.baseRadiusPx
        * (1 + config.splatVelocityScale * normalizedSpeed),
    );

    if (!reference.placed) placeTuft(reference, headX, headY, headZ);

    let spreadSum = 0;
    for (let bristle = 0; bristle < config.bristleCount; bristle += 1) {
      const step = stepBristle(reference, bristle, headX, headY, headZ, dtSeconds);
      spreadSum += step.splay;
      const slot =
        studioGpuBristleSplatSlot(bristle, index, config.bristleCount)
        * STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT;
      const weight =
        step.contact > 0
          ? STUDIO_GPU_BRISTLE_DLI_PAINTING.thinMinAlpha
            + (STUDIO_GPU_BRISTLE_DLI_PAINTING.thinMaxAlpha
              - STUDIO_GPU_BRISTLE_DLI_PAINTING.thinMinAlpha)
              * step.contact
              * step.load
          : 0;
      splats[slot] = step.previousTipX;
      splats[slot + 1] = step.previousTipY;
      splats[slot + 2] = step.tipX;
      splats[slot + 3] = step.tipY;
      splats[slot + 4] = config.ink[0];
      splats[slot + 5] = config.ink[1];
      splats[slot + 6] = config.ink[2];
      splats[slot + 7] = weight;
      splats[slot + 8] = weight > 0 ? radius : 0;
      splats[slot + 9] = weight;
      splats[slot + 10] = 0;
      splats[slot + 11] = 0;
      if (weight > 0) deposited += 1;
      if (trace && bristle === traceBristle) {
        trace.tip[index * 2] = step.tipX;
        trace.tip[index * 2 + 1] = step.tipY;
      }
    }

    if (trace) {
      trace.root[index * 2] = headX;
      trace.root[index * 2 + 1] = headY;
      trace.spread[index] = config.bristleCount > 0 ? spreadSum / config.bristleCount : 0;
      trace.dtSeconds[index] = dtSeconds;
    }

    reference.lastX = station.x;
    reference.lastY = station.y;
    reference.lastPressure = pressure;
    reference.consumedStationCount += 1;
  }

  return {
    stationCount,
    consumedStationCount: reference.consumedStationCount,
    splats,
    splatCapacity: capacity,
    depositedSplatCount: deposited,
    trace,
  };
}

/**
 * Pack the f64 twin state into the byte layout the GPU holds (f32). Gate G2 compares this against
 * the buffer the runtime uploads; gate G1 compares two of these against each other.
 */
export function packStudioGpuBristleState(
  reference: StudioGpuBristleReference,
  into?: Float32Array,
): Float32Array {
  const target = into ?? new Float32Array(reference.bristleState.length);
  if (target.length !== reference.bristleState.length) {
    throw new StudioGpuBristleReferenceError(
      `into length ${target.length} does not match ${reference.bristleState.length}`,
    );
  }
  target.set(reference.bristleState);
  return target;
}

/** Pack an advance result's splat array into the f32 layout the deposit pass reads. */
export function packStudioGpuBristleSplats(
  splats: Float64Array,
  into?: Float32Array,
): Float32Array {
  const target = into ?? new Float32Array(splats.length);
  if (target.length !== splats.length) {
    throw new StudioGpuBristleReferenceError(
      `into length ${target.length} does not match ${splats.length}`,
    );
  }
  target.set(splats);
  return target;
}
