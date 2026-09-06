/**
 * GPU bristle lane — shared numeric contract (Partition A owns; the GPU lane consumes read-only).
 *
 * PROVENANCE. Derived from David Li's Fluid Paint (github.com/dli/paint, MIT License,
 * © 2017 David Li, http://david.li). The verbatim permission notice is checked in at
 * `third_party/dli-paint/LICENSE` and reaches
 * `dist/legal/THIRD_PARTY_NOTICES.generated.md`. The upstream files this contract encodes are
 * `brush.js` (VERTICES_PER_BRISTLE / BRISTLE_LENGTH / BRISTLE_JITTER / ITERATIONS / GRAVITY /
 * BRUSH_DAMPING / STIFFNESS_VARIATION and the six constraint fragment shaders
 * `project.frag`, `distanceconstraint.frag`, `bendingconstraint.frag`, `planeconstraint.frag`,
 * `setbristles.frag`, `updatevelocity.frag`), `shaders/splat.frag` (capsule
 * `distanceToLine`) and `paint.js` (Z_THRESHOLD, BRUSH_HEIGHT, SPLAT_RADIUS,
 * SPLAT_VELOCITY_SCALE, MIN/MAX_BRISTLE_COUNT, THIN/THICK alpha ranges).
 *
 * Numbers that already live in `../brush/studio-fluid-paint-reference.ts` are **re-exported, never
 * re-typed** — that module is the single MIT-attributed transcription of `brush.js` and
 * `painting.frag`. Only the `paint.js` constants absent from it are declared here, in
 * `STUDIO_GPU_BRISTLE_DLI_PAINTING`.
 *
 * WHY THIS FILE EXISTS. The lane's CPU twin (`studio-gpu-bristle-reference.ts`) and its WGSL
 * kernel must agree byte-for-byte on struct layout and value-for-value on every tunable. The
 * discipline is the one that made the living-ink oracle honest
 * (`../studio-living-ink-execution-protocol.ts:17-20`): every tunable is an exported TypeScript
 * value and **no numeric tunable is ever written inside shader text**. The layout tables below are
 * expressed as explicit byte offsets rather than "structs are 16-aligned" prose so a boundary test
 * can assert them.
 *
 * `vec3f` is avoided everywhere: array stride 16 with size 12 is the classic WGSL trap. The
 * uniform block is `vec4` lanes only, which removes uniform member alignment and array stride as
 * failure modes entirely and lets the CPU twin read the byte-identical `Float32Array` the GPU is
 * handed (parity gate G2).
 */

import {
  STUDIO_FLUID_PAINT_BRUSH,
  STUDIO_FLUID_PAINT_DISPLAY,
  STUDIO_FLUID_PAINT_PROVENANCE,
  STUDIO_FLUID_PAINT_RYB_CUBE,
  STUDIO_FLUID_PAINT_SPLAT,
  studioFluidPaintRgbToRyb,
  studioFluidPaintRybToRgb,
} from "../brush/studio-fluid-paint-reference";

export {
  STUDIO_FLUID_PAINT_BRUSH,
  STUDIO_FLUID_PAINT_DISPLAY,
  STUDIO_FLUID_PAINT_RYB_CUBE,
  STUDIO_FLUID_PAINT_SPLAT,
  studioFluidPaintRgbToRyb,
  studioFluidPaintRybToRgb,
};

export const STUDIO_GPU_BRISTLE_CONTRACT_VERSION = "studio-gpu-bristle-contract-v1" as const;

export const STUDIO_GPU_BRISTLE_PROVENANCE = Object.freeze({
  license: "MIT (dli/paint LICENSE, © 2017 David Li)",
  licensePath: "third_party/dli-paint/LICENSE",
  source: "http://david.li/paint — github.com/dli/paint",
  upstream: STUDIO_FLUID_PAINT_PROVENANCE,
  derivedFrom:
    "brush.js position-based-dynamics bristle chain + shaders/splat.frag capsule + paint.js painting constants",
  adaptation:
    "10-vertex chain solved as one serial Gauss-Seidel loop (compute owns the address, so dli's six ping-ponged fragment passes collapse); deterministic splat slot index instead of atomic append; head depth driven by stylus pressure",
} as const);

/* -------------------------------------------------------------------------------------------- */
/* paint.js constants that `studio-fluid-paint-reference.ts` does not already carry               */
/* -------------------------------------------------------------------------------------------- */

/**
 * `paint.js` painting constants. Only the ones this lane consumes are declared; anything already
 * present in `STUDIO_FLUID_PAINT_BRUSH` / `_SPLAT` / `_DISPLAY` is re-exported above instead.
 */
export const STUDIO_GPU_BRISTLE_DLI_PAINTING = Object.freeze({
  /** `BRUSH_HEIGHT` — head height above the canvas plane, in units of the brush scale. */
  brushHeight: 2.0,
  /** `Z_THRESHOLD` — a vertex deposits only inside this band above the plane. */
  zThreshold: 0.13333,
  /** `SPLAT_RADIUS` — capsule radius in units of the brush scale. */
  splatRadius: 0.05,
  /** `SPLAT_VELOCITY_SCALE` — how much head speed widens a capsule. */
  splatVelocityScale: 0.14,
  /** `MIN_BRISTLE_COUNT` / `MAX_BRISTLE_COUNT`. */
  minBristleCount: 10,
  maxBristleCount: 100,
  /** `THIN_MIN_ALPHA` / `THIN_MAX_ALPHA` — the deposit alpha band. */
  thinMinAlpha: 0.002,
  thinMaxAlpha: 0.08,
} as const);

/* -------------------------------------------------------------------------------------------- */
/* Lane limits                                                                                    */
/* -------------------------------------------------------------------------------------------- */

/**
 * Hard caps for the lane. `bristleCount ≤ 128` because the render lane caps hairs at
 * `BRISTLE_MAX_HAIRS = 44` (`../studio-fx-brush.ts`), 128 leaves headroom, and 128 is inside the
 * universal `maxComputeInvocationsPerWorkgroup` floor of 256 — so one workgroup holds the whole
 * tuft and the twenty Gauss-Seidel iterations need no barrier.
 */
export const STUDIO_GPU_BRISTLE_LIMITS = Object.freeze({
  maxBristleCount: 128,
  minBristleCount: 1,
  /** dli `VERTICES_PER_BRISTLE`. Fixed — the layout tables below encode it. */
  verticesPerBristle: STUDIO_FLUID_PAINT_BRUSH.verticesPerBristle,
  /** One compute workgroup covers the whole tuft. */
  workgroupSize: 128,
  /** Stations uploaded per batch; also the splat-slot stride. */
  maxStationsPerBatch: 256,
  /** Guard rails on the per-station timestep so a stalled pointer cannot explode the integrator. */
  minStationDtMs: 1 / 16,
  maxStationDtMs: 64,
  /** Used only when a caller supplies a non-finite `dtMs`; never derived from the station index. */
  retainedStationDtMs: 1000 / 60,
} as const);

/* -------------------------------------------------------------------------------------------- */
/* Struct layouts — explicit byte offsets                                                          */
/* -------------------------------------------------------------------------------------------- */

export interface StudioGpuBristleMemberLayout {
  /** Byte offset from the start of the struct. */
  readonly offset: number;
  /** Total size of the member in bytes. */
  readonly size: number;
  /** Number of array elements (1 for a plain member). */
  readonly count: number;
  /** f32/u32 components per element. */
  readonly components: number;
}

export interface StudioGpuBristleStructLayout {
  readonly alignOf: number;
  readonly sizeOf: number;
  readonly arrayStride: number;
  readonly members: Readonly<Record<string, StudioGpuBristleMemberLayout>>;
}

function member(
  offset: number,
  count: number,
  components: number,
): StudioGpuBristleMemberLayout {
  return Object.freeze({ offset, size: count * components * 4, count, components });
}

/**
 * ```wgsl
 * struct Bristle {                 // AlignOf 16, SizeOf 336, array stride 336 (336 = 21 x 16)
 *   pos    : array<vec4f, 10>,     // offset   0  xyz = position, w = ink load
 *   prev   : array<vec4f, 10>,     // offset 160  xyz = previous position (Verlet), w = previous load
 *   params : vec4f,                // offset 320  stiffness, jitter, ink, restLength
 * }
 * ```
 */
export const STUDIO_GPU_BRISTLE_BRISTLE_LAYOUT: StudioGpuBristleStructLayout = Object.freeze({
  alignOf: 16,
  sizeOf: 336,
  arrayStride: 336,
  members: Object.freeze({
    pos: member(0, 10, 4),
    prev: member(160, 10, 4),
    params: member(320, 1, 4),
  }),
});

/**
 * ```wgsl
 * struct Station {                 // AlignOf 16, SizeOf 32
 *   pose  : vec4f,                 // x, y, pressure, dtMs
 *   drive : vec4f,                 // tiltX, tiltY, speed, _pad
 * }
 * ```
 * `dtMs` travels **in the station**, never derived from the station index — that is what makes an
 * incremental suffix solve byte-identical to a from-scratch replay (gate G1).
 */
export const STUDIO_GPU_BRISTLE_STATION_LAYOUT: StudioGpuBristleStructLayout = Object.freeze({
  alignOf: 16,
  sizeOf: 32,
  arrayStride: 32,
  members: Object.freeze({
    pose: member(0, 1, 4),
    drive: member(16, 1, 4),
  }),
});

/**
 * ```wgsl
 * struct Splat {                   // AlignOf 16, SizeOf 48
 *   seg     : vec4f,               // ax, ay, bx, by  (capsule — splat.frag distanceToLine)
 *   pigment : vec4f,               // r, y, b, weight (RYB — STUDIO_FLUID_PAINT_RYB_CUBE)
 *   shape   : vec4f,               // radius, height, _pad, _pad
 * }
 * ```
 * `pigment.w === 0` marks an unused slot; the vertex stage degenerates it to a zero-area triangle.
 */
export const STUDIO_GPU_BRISTLE_SPLAT_LAYOUT: StudioGpuBristleStructLayout = Object.freeze({
  alignOf: 16,
  sizeOf: 48,
  arrayStride: 48,
  members: Object.freeze({
    seg: member(0, 1, 4),
    pigment: member(16, 1, 4),
    shape: member(32, 1, 4),
  }),
});

/**
 * ```wgsl
 * struct Tuft {                    // uniform. vec4 lanes only — no offset arithmetic anywhere.
 *   counts   : vec4u,              // bristleCount, verticesPerBristle, iterations, stationCount
 *   physics  : vec4f,              // dt, gravity, damping, stiffnessVariation
 *   geometry : vec4f,              // bristleLength, jitter, baseRadiusPx, zThreshold
 *   head     : vec4f,              // headX, headY, brushHeight, filteredSpeed
 * }                                // SizeOf 64
 * ```
 */
export const STUDIO_GPU_BRISTLE_TUFT_LAYOUT: StudioGpuBristleStructLayout = Object.freeze({
  alignOf: 16,
  sizeOf: 64,
  arrayStride: 64,
  members: Object.freeze({
    counts: member(0, 1, 4),
    physics: member(16, 1, 4),
    geometry: member(32, 1, 4),
    head: member(48, 1, 4),
  }),
});

/** f32/u32 components per bristle record (336 B / 4 B). */
export const STUDIO_GPU_BRISTLE_COMPONENTS_PER_BRISTLE =
  STUDIO_GPU_BRISTLE_BRISTLE_LAYOUT.sizeOf / 4;
/** f32 components per splat record (48 B / 4 B). */
export const STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT =
  STUDIO_GPU_BRISTLE_SPLAT_LAYOUT.sizeOf / 4;
/** f32 components per station record (32 B / 4 B). */
export const STUDIO_GPU_BRISTLE_COMPONENTS_PER_STATION =
  STUDIO_GPU_BRISTLE_STATION_LAYOUT.sizeOf / 4;
/** f32/u32 components in the tuft uniform block (64 B / 4 B). */
export const STUDIO_GPU_BRISTLE_COMPONENTS_PER_TUFT =
  STUDIO_GPU_BRISTLE_TUFT_LAYOUT.sizeOf / 4;

/* -------------------------------------------------------------------------------------------- */
/* Physics defaults                                                                                */
/* -------------------------------------------------------------------------------------------- */

/**
 * Tunables the solver reads. Everything dli specifies comes from `STUDIO_FLUID_PAINT_BRUSH`;
 * the rest are this lane's own and are documented where they are not upstream.
 */
export const STUDIO_GPU_BRISTLE_PHYSICS_DEFAULTS = Object.freeze({
  gravity: STUDIO_FLUID_PAINT_BRUSH.gravity,
  damping: STUDIO_FLUID_PAINT_BRUSH.damping,
  iterations: STUDIO_FLUID_PAINT_BRUSH.constraintIterations,
  bristleLength: STUDIO_FLUID_PAINT_BRUSH.bristleLength,
  bristleJitter: STUDIO_FLUID_PAINT_BRUSH.bristleJitter,
  stiffnessVariation: STUDIO_FLUID_PAINT_BRUSH.stiffnessVariation,
  brushHeight: STUDIO_GPU_BRISTLE_DLI_PAINTING.brushHeight,
  zThreshold: STUDIO_GPU_BRISTLE_DLI_PAINTING.zThreshold,
  splatRadius: STUDIO_GPU_BRISTLE_DLI_PAINTING.splatRadius,
  splatVelocityScale: STUDIO_GPU_BRISTLE_DLI_PAINTING.splatVelocityScale,
  /**
   * Bending stiffness as a fraction of the per-bristle distance stiffness. dli runs
   * `bendingconstraint.frag` alongside the distance passes; upstream does not expose the ratio, so
   * it is declared here. It must stay strictly below 1 or the chain locks straight and the tuft
   * stops splaying — the exact degeneration gate G3's tip-lag band is written to catch.
   */
  bendStiffnessRatio: 0.35,
  /**
   * Distance sweeps per Gauss-Seidel iteration. Inextensibility is a *hard* constraint while
   * bending and rest-pose recall are *soft* ones, so the hard constraint is relaxed several times
   * per iteration. Measured: one sweep leaves a 4 % residual stretch that more outer iterations do
   * not remove — the last half-sweep of the red/black split always perturbs the edges the other
   * half just fixed — while five sweeps bring it to ~0.4 %, comfortably inside
   * `STUDIO_GPU_BRISTLE_TOLERANCES.constraintSlack`.
   */
  distanceSweepsPerIteration: 5,
  /**
   * Rest-pose recall, as a fraction of the per-bristle stiffness. Distance and bending constraints
   * are both **direction-free** — they fix lengths and collinearity, and are satisfied by a chain
   * pointing anywhere. Without a rest pose a pressed tuft drifts outward into a taut diagonal that
   * satisfies everything, the tips lift off the paper after a few dozen stations, and the brush
   * never springs back when lifted. This term pulls every free vertex toward the straight-down pose
   * hanging from the ferrule, which is what a bristle's own elasticity does. It must stay small: it
   * is a recall, not a cage, and a large value flattens the tip lag this lane exists to produce.
   */
  restPoseStiffnessRatio: 0.3,
  /**
   * How far a fully soft hair (`stiffness → 0`) flares away from the ferrule axis at rest, as a
   * fraction of its own reach. This is what makes `STIFFNESS_VARIATION` an *equilibrium* parameter:
   * a stiffness that only scaled a PBD correction factor washes out completely at twenty
   * iterations, so the tuft would read as a uniform rake no matter what the constant said. A real
   * round brush is cone-shaped for exactly this reason — the softer hairs sit further out.
   */
  restPoseFlareRatio: 0.9,
  /**
   * Capillary transport of ink along one hair per station, root → tip. Conservative: whatever
   * leaves vertex `j` arrives at vertex `j + 1`. Not upstream — dli carries no ink model.
   */
  capillaryRate: 0.18,
  /** Fraction of the tip's remaining load consumed by a full-weight deposit. Not upstream. */
  depletionRate: 0.09,
  /** Minimum capsule radius in device px, so a tiny brush still lays a visible film. */
  minSplatRadiusPx: 0.35,
  /**
   * Gain that maps accumulated deposit weight into display opacity and into relief height before
   * the Sobel height→normal step. Not upstream: dli's paint texture carries thickness in its own
   * units and NORMAL_SCALE 7.0 is tuned against those, while this lane accumulates
   * `THIN_MIN_ALPHA…THIN_MAX_ALPHA` weights that top out near 0.13 on a normally loaded stroke.
   * Measured on a 140-station stroke at pressure 0.8: gain 1 leaves the relief invisible (shading
   * contrast 0.013) and the mark 87 % paper, gain 6 gives a readable ridge (0.21) and a
   * near-opaque core, and gain 12 blows the specular into the multiplier ceiling (0.55). Leaving
   * it at 1 is the "roughly thirty times too faint" trap recorded in
   * `../studio-living-ink-webgpu-pure-runtime.ts:9-16`.
   */
  resolveDepositGain: 6,
} as const);

/* -------------------------------------------------------------------------------------------- */
/* Parity tolerances (gate G3). Declared here so no test may inline a threshold.                   */
/* -------------------------------------------------------------------------------------------- */

export const STUDIO_GPU_BRISTLE_TOLERANCES = Object.freeze({
  /**
   * G3 constraint satisfaction. After `iterations` sweeps every chain edge must be within
   * `restLength × (1 + constraintSlack)`. An output property of the solver, not a comparison —
   * therefore vendor independent.
   */
  constraintSlack: 0.02,
  /** G3 conservation: total deposited area, GPU vs twin. */
  pigmentConservation: 0.02,
  /**
   * G3 tip lag at a 90° corner, as a fraction of the pinned band. Fails when `BRISTLE_JITTER` is
   * dropped and — the point of the whole lane — when the chain collapses to one vertex, which the
   * companion floor `STUDIO_GPU_BRISTLE_TIP_LAG_FLOOR_RATIO` rejects outright.
   */
  tipLagBand: 0.12,
  /** G3 splay recovery time constant after a pressure step. */
  splayRecoveryTau: 0.15,
  /** G3 per-bristle terminal-load distribution, Kolmogorov–Smirnov statistic. */
  terminalLoadKs: 0.15,
  /** G3 impasto GGX resolve, per 8-bit channel. */
  impastoChannelLsb: 1,
  /**
   * G2 static equilibrium: with gravity and pressure at zero the chain must be straight to this
   * relative tolerance, which is f32 round-off accumulated over nine edges, not a physics slack.
   */
  staticEquilibrium: 1e-5,
} as const);

/**
 * A tip-lag band is only meaningful with a floor: a one-vertex chain reports lag ≈ 0 and would
 * pass any "within ±12 %" comparison against a twin that had also degenerated. The absolute floor
 * is expressed as a fraction of the bristle length so it scales with the brush.
 */
export const STUDIO_GPU_BRISTLE_TIP_LAG_FLOOR_RATIO = 0.04;

/* -------------------------------------------------------------------------------------------- */
/* Deterministic hash — WGSL-portable                                                              */
/* -------------------------------------------------------------------------------------------- */

/**
 * 32-bit integer avalanche (`Math.imul` is a u32 multiply and `>>>` a u32 shift, so the WGSL
 * transcription is literal). No `Math.random`, no clock: the tuft layout is a pure function of
 * `(seed, index, channel)`. `studio-gpu-bristle-contract.test.ts` pins concrete outputs so the
 * WGSL side has fixtures to match.
 */
export function studioGpuBristleHash32(seed: number, index: number, channel: number): number {
  // The trailing constant keeps `hash32(0, 0, 0)` off zero: an avalanche of zero is zero, which
  // would hand bristle 0 of seed 0 a degenerate layout draw on every channel.
  let h =
    (Math.imul(seed | 0, 0x9e3779b1)
      ^ Math.imul(index | 0, 0x85ebca6b)
      ^ Math.imul(channel | 0, 0xc2b2ae35)
      ^ 0x27d4eb2f)
    | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** `studioGpuBristleHash32` mapped into `[0, 1)`. */
export function studioGpuBristleUnitHash(
  seed: number,
  index: number,
  channel: number,
): number {
  return studioGpuBristleHash32(seed, index, channel) / 4294967296;
}

/* -------------------------------------------------------------------------------------------- */
/* Tuft uniform packer (gate G2 reads the byte-identical view this produces)                       */
/* -------------------------------------------------------------------------------------------- */

export interface StudioGpuBristleTuftUniform {
  readonly bristleCount: number;
  readonly verticesPerBristle: number;
  readonly iterations: number;
  readonly stationCount: number;
  readonly dt: number;
  readonly gravity: number;
  readonly damping: number;
  readonly stiffnessVariation: number;
  readonly bristleLength: number;
  readonly jitter: number;
  readonly baseRadiusPx: number;
  readonly zThreshold: number;
  readonly headX: number;
  readonly headY: number;
  readonly brushHeight: number;
  readonly filteredSpeed: number;
}

export class StudioGpuBristleContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioGpuBristleContractError";
  }
}

function requireFiniteNumber(name: string, value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new StudioGpuBristleContractError(
      `${name} must be a finite number, got ${String(value)}`,
    );
  }
  return value;
}

function requireCount(name: string, value: number): number {
  const finite = requireFiniteNumber(name, value);
  if (!Number.isInteger(finite) || finite < 0 || finite > 0xffffffff) {
    throw new StudioGpuBristleContractError(
      `${name} must be a u32 integer, got ${String(value)}`,
    );
  }
  return finite;
}

/** Allocate a zeroed uniform block sized exactly to `Tuft`. */
export function createStudioGpuBristleTuftUniform(): Float32Array {
  return new Float32Array(STUDIO_GPU_BRISTLE_COMPONENTS_PER_TUFT);
}

/**
 * Pack `Tuft` into `target`, which must be at least 16 f32 long. The `counts` lane is `vec4u`, so
 * it is written through a `Uint32Array` view onto the same bytes — this is exactly the buffer the
 * GPU is handed, which is why gate G2 can compare the two sides with `toEqual` on raw components.
 */
export function writeStudioGpuBristleTuftUniform(
  target: Float32Array,
  values: StudioGpuBristleTuftUniform,
): Float32Array {
  if (!(target instanceof Float32Array)) {
    throw new StudioGpuBristleContractError("target must be a Float32Array");
  }
  if (target.length < STUDIO_GPU_BRISTLE_COMPONENTS_PER_TUFT) {
    throw new StudioGpuBristleContractError(
      `target must hold at least ${STUDIO_GPU_BRISTLE_COMPONENTS_PER_TUFT} f32, got ${target.length}`,
    );
  }
  const counts = new Uint32Array(target.buffer, target.byteOffset, 4);
  counts[0] = requireCount("bristleCount", values.bristleCount);
  counts[1] = requireCount("verticesPerBristle", values.verticesPerBristle);
  counts[2] = requireCount("iterations", values.iterations);
  counts[3] = requireCount("stationCount", values.stationCount);

  target[4] = requireFiniteNumber("dt", values.dt);
  target[5] = requireFiniteNumber("gravity", values.gravity);
  target[6] = requireFiniteNumber("damping", values.damping);
  target[7] = requireFiniteNumber("stiffnessVariation", values.stiffnessVariation);

  target[8] = requireFiniteNumber("bristleLength", values.bristleLength);
  target[9] = requireFiniteNumber("jitter", values.jitter);
  target[10] = requireFiniteNumber("baseRadiusPx", values.baseRadiusPx);
  target[11] = requireFiniteNumber("zThreshold", values.zThreshold);

  target[12] = requireFiniteNumber("headX", values.headX);
  target[13] = requireFiniteNumber("headY", values.headY);
  target[14] = requireFiniteNumber("brushHeight", values.brushHeight);
  target[15] = requireFiniteNumber("filteredSpeed", values.filteredSpeed);
  return target;
}

/** Read a packed `Tuft` block back into named fields — the inverse of the packer. */
export function readStudioGpuBristleTuftUniform(
  source: Float32Array,
): StudioGpuBristleTuftUniform {
  if (source.length < STUDIO_GPU_BRISTLE_COMPONENTS_PER_TUFT) {
    throw new StudioGpuBristleContractError(
      `source must hold at least ${STUDIO_GPU_BRISTLE_COMPONENTS_PER_TUFT} f32, got ${source.length}`,
    );
  }
  const counts = new Uint32Array(source.buffer, source.byteOffset, 4);
  return Object.freeze({
    bristleCount: counts[0]!,
    verticesPerBristle: counts[1]!,
    iterations: counts[2]!,
    stationCount: counts[3]!,
    dt: source[4]!,
    gravity: source[5]!,
    damping: source[6]!,
    stiffnessVariation: source[7]!,
    bristleLength: source[8]!,
    jitter: source[9]!,
    baseRadiusPx: source[10]!,
    zThreshold: source[11]!,
    headX: source[12]!,
    headY: source[13]!,
    brushHeight: source[14]!,
    filteredSpeed: source[15]!,
  });
}

/* -------------------------------------------------------------------------------------------- */
/* Deterministic splat slot index (gate G1 depends on this being a pure function)                   */
/* -------------------------------------------------------------------------------------------- */

/**
 * `slot = localStationIndex * bristleCount + bristleIndex` — **station-major**.
 *
 * There are **no atomics anywhere in this lane**. Atomic append is order non-deterministic across
 * dispatches: two runs produce the same *set* of splats in a different *order*, and with
 * `blend {one, one}` on rgba16float the sums differ in the last ulp — which makes gate G1
 * (byte-exact self-parity) unimplementable. A fixed-capacity slot buffer with `pigment.w = 0` on
 * unused entries costs some empty vertex invocations and buys exact reproducibility of blend order.
 *
 * DEVIATION FROM THE DESIGN DOC, DELIBERATE. The design specifies bristle-major
 * (`bristleIndex * maxStationsPerBatch + stationIndex`). That layout is *not* chunking-invariant:
 * slot order is draw order is blend order, so for a two-station batch it deposits
 * `b0s0, b0s1, b1s0, b1s1`, while the same two stations arriving as two one-station batches
 * deposit `b0s0, b1s0 | b0s1, b1s1`. Under `blend {one, one}` those two sums differ in the last
 * ulp — which is the exact failure the design rejected atomics to avoid, reintroduced by the
 * replacement. Station-major produces `b0s0, b1s0, b0s1, b1s1` under **every** chunking, so an
 * incremental suffix solve and a from-scratch replay agree byte-for-byte. Capacity is
 * `stationCount * bristleCount` for the batch actually dispatched; the stride is the bristle
 * count, not `maxStationsPerBatch`.
 */
export function studioGpuBristleSplatSlot(
  bristleIndex: number,
  localStationIndex: number,
  bristleCount: number,
): number {
  return localStationIndex * bristleCount + bristleIndex;
}

/** Total splat slots for one dispatch of `stationCount` stations. */
export function studioGpuBristleSplatCapacity(
  bristleCount: number,
  stationCount: number,
): number {
  return bristleCount * stationCount;
}

/** Clamp a requested hair count into the lane's supported range. */
export function clampStudioGpuBristleCount(requested: number): number {
  if (!Number.isFinite(requested)) return STUDIO_GPU_BRISTLE_DLI_PAINTING.minBristleCount;
  const rounded = Math.round(requested);
  if (rounded < STUDIO_GPU_BRISTLE_LIMITS.minBristleCount) {
    return STUDIO_GPU_BRISTLE_LIMITS.minBristleCount;
  }
  return rounded > STUDIO_GPU_BRISTLE_LIMITS.maxBristleCount
    ? STUDIO_GPU_BRISTLE_LIMITS.maxBristleCount
    : rounded;
}

/** Clamp a per-station timestep into the integrator's stable window, in milliseconds. */
export function clampStudioGpuBristleStationDtMs(requested: number): number {
  if (!Number.isFinite(requested) || requested <= 0) {
    return STUDIO_GPU_BRISTLE_LIMITS.retainedStationDtMs;
  }
  if (requested < STUDIO_GPU_BRISTLE_LIMITS.minStationDtMs) {
    return STUDIO_GPU_BRISTLE_LIMITS.minStationDtMs;
  }
  return requested > STUDIO_GPU_BRISTLE_LIMITS.maxStationDtMs
    ? STUDIO_GPU_BRISTLE_LIMITS.maxStationDtMs
    : requested;
}
