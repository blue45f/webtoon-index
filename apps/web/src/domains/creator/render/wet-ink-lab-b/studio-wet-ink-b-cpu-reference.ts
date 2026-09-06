/**
 * Lane B wet-ink CPU reference backend.
 *
 * Two jobs, deliberately fused into one implementation:
 *   1. the **fallback** when WebGPU is unavailable — it must actually render, not merely
 *      decline to crash;
 *   2. the **reference** the GPU runtime is compared against by the Lane B gate.
 *
 * Derived from Curtis et al., SIGGRAPH 1997, §4. Staggered MAC grid after Foster & Metaxas 1996,
 * as Curtis §4.3.1 specifies.
 *
 * Index convention (ours, not the paper's):
 *   u[i + j*(N+1)] = horizontal velocity on the LEFT face of cell (i,j)  == Curtis u_{i-.5,j}
 *   v[i + j*N]     = vertical   velocity on the TOP  face of cell (i,j)  == Curtis v_{i,j-.5}
 * so Curtis u_{i+.5,j} == u[(i+1) + j*(N+1)] and Curtis v_{i,j+.5} == v[i + (j+1)*N].
 *
 * ## Why every kernel here is written in GATHER form
 *
 * The Phase 1 prototype scattered: each cell added its outflow into its neighbours' slots.
 * That is a data race on the GPU, where all cells run concurrently. Every kernel below is
 * therefore rewritten so a cell computes only its OWN next value, reading its neighbours'
 * current values. This is not an approximation — each scattered amount was already a pure
 * function of the donor cell's state, so the gather form is exactly equal. Keeping the CPU
 * reference in gather form too is what makes it a legitimate reference for the GPU.
 */

import {
  STUDIO_WET_INK_B_HOLLOW_AFFINITY_GAIN,
  STUDIO_WET_INK_B_MAX_SUBSTEPS,
  STUDIO_WET_INK_B_SETTLE_FLUX_CLAMP,
  normalizeStudioWetInkBDab,
  normalizeStudioWetInkBOptions,
  studioWetInkBGaussianTaps,
  studioWetInkBSubstepCount,
} from "./studio-wet-ink-b-model";
import { studioWetInkBDequantize } from "./studio-wet-ink-b-substrate";

import type {
  StudioWetInkBDab,
  StudioWetInkBOptions,
  StudioWetInkBPigment,
} from "./studio-wet-ink-b-model";
import type { StudioWetInkBSubstrate } from "./studio-wet-ink-b-substrate";

export const STUDIO_WET_INK_B_CPU_REFERENCE_REVISION = 1 as const;

export interface StudioWetInkBCpuOptions {
  readonly substrate: Readonly<StudioWetInkBSubstrate>;
  readonly pigment: Readonly<StudioWetInkBPigment>;
  readonly options?: Partial<StudioWetInkBOptions>;
}

/** Snapshot of the invariants the model claims. Used by the gate, never in the pointer loop. */
export interface StudioWetInkBMassSnapshot {
  /** Total suspended pigment. */
  readonly suspended: number;
  /** Total deposited pigment. */
  readonly deposited: number;
  /** `suspended + deposited` — Curtis §5.2's thickness integral, conserved between dabs. */
  readonly total: number;
  /** Number of cells currently in the wet-area mask. */
  readonly wetCells: number;
}

function dequantizePlane(plane: Uint8Array): Float32Array {
  const out = new Float32Array(plane.length);
  for (let i = 0; i < plane.length; i += 1) out[i] = studioWetInkBDequantize(plane[i]);
  return out;
}

export class StudioWetInkBCpuReference {
  readonly size: number;
  readonly options: Readonly<StudioWetInkBOptions>;
  readonly pigment: Readonly<StudioWetInkBPigment>;

  /** Wet-area mask. */
  readonly mask: Uint8Array;
  /** Water pressure in the shallow-water layer. */
  readonly pressure: Float32Array;
  /** Pigment in suspension, as optical quantity. Never a colour. */
  readonly suspended: Float32Array;
  /** Pigment deposited on the paper, as optical quantity. Never a colour. */
  readonly deposited: Float32Array;
  /** Capillary-layer water saturation. */
  readonly saturation: Float32Array;
  readonly velocityU: Float32Array;
  readonly velocityV: Float32Array;

  readonly #height: Float32Array;
  readonly #tooth: Float32Array;
  readonly #capacity: Float32Array;

  readonly #nextU: Float32Array;
  readonly #nextV: Float32Array;
  readonly #nextSuspended: Float32Array;
  readonly #nextSaturation: Float32Array;
  readonly #nextMask: Uint8Array;
  readonly #blur: Float32Array;
  readonly #blurTmp: Float32Array;
  readonly #relaxE: Float32Array;
  readonly #taps: Float32Array;

  #lastRelaxResidual = 0;

  constructor(config: StudioWetInkBCpuOptions) {
    const { substrate } = config;
    this.size = substrate.size;
    this.options = normalizeStudioWetInkBOptions(config.options);
    this.pigment = config.pigment;

    const n = this.size * this.size;
    this.#height = dequantizePlane(substrate.height);
    this.#tooth = dequantizePlane(substrate.tooth);
    this.#capacity = dequantizePlane(substrate.capacity);

    this.mask = new Uint8Array(n);
    this.pressure = new Float32Array(n);
    this.suspended = new Float32Array(n);
    this.deposited = new Float32Array(n);
    this.saturation = new Float32Array(n);
    this.velocityU = new Float32Array((this.size + 1) * this.size);
    this.velocityV = new Float32Array(this.size * (this.size + 1));

    this.#nextU = new Float32Array(this.velocityU.length);
    this.#nextV = new Float32Array(this.velocityV.length);
    this.#nextSuspended = new Float32Array(n);
    this.#nextSaturation = new Float32Array(n);
    this.#nextMask = new Uint8Array(n);
    this.#blur = new Float32Array(n);
    this.#blurTmp = new Float32Array(n);
    this.#relaxE = new Float32Array(n);
    this.#taps = studioWetInkBGaussianTaps(this.options.edgeK);
  }

  /** Zeroes all dynamic state. The substrate is static and survives. */
  reset(): void {
    this.mask.fill(0);
    this.pressure.fill(0);
    this.suspended.fill(0);
    this.deposited.fill(0);
    this.saturation.fill(0);
    this.velocityU.fill(0);
    this.velocityV.fill(0);
    this.#lastRelaxResidual = 0;
  }

  /**
   * Curtis §4.7 drybrush, generalised (LANE B, independent).
   *
   * The paper says: "exclude from the wet-area mask any pixel whose paper height h is less than
   * a user-defined threshold" — a BINARY threshold on the coverage mask, not a colour multiply.
   * Lane B makes that threshold a function of local brush load rather than a global constant, so
   * the same rule produces a ragged silhouette where load tapers at the stroke edge as well as
   * interior holes. `dryness = 0` reproduces Curtis's full-wet case exactly.
   *
   * Because `tooth` is rank-uniform, `threshold = 1 - wetness` covers a paper fraction equal to
   * `wetness` exactly — the property that makes drybrush resolution- and octave-stable.
   */
  applyDab(input: Readonly<Partial<StudioWetInkBDab>> & Pick<StudioWetInkBDab, "x" | "y">): void {
    const dab = normalizeStudioWetInkBDab(input);
    if (dab.radius <= 0 || dab.load <= 0) return;
    const { size } = this;
    const minX = Math.max(0, Math.floor(dab.x - dab.radius));
    const maxX = Math.min(size - 1, Math.ceil(dab.x + dab.radius));
    const minY = Math.max(0, Math.floor(dab.y - dab.radius));
    const maxY = Math.min(size - 1, Math.ceil(dab.y + dab.radius));
    const r2 = dab.radius * dab.radius;

    for (let j = minY; j <= maxY; j += 1) {
      for (let i = minX; i <= maxX; i += 1) {
        const dx = i + 0.5 - dab.x;
        const dy = j + 0.5 - dab.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 > r2) continue;
        const falloff = 1 - Math.sqrt(dist2 / r2);
        const load = dab.load * falloff;
        if (load <= 0) continue;
        const k = i + j * size;

        const wetness = Math.min(1, Math.max(0, load * (1 - dab.dryness)));
        // Contact is decided by the TOOTH, not the macro undulation.
        if (this.#tooth[k] < 1 - wetness) continue; // valley stays bone dry -> a hole

        this.mask[k] = 1;
        // A dry brush carries little water, so capillary flow cannot re-wet the valleys it
        // skipped. This is what makes drybrush holes PERSIST rather than heal.
        const water = dab.water * wetness;
        this.pressure[k] += water;
        this.suspended[k] += dab.pigment * load;
        this.saturation[k] = Math.max(
          this.saturation[k],
          Math.min(this.#capacity[k], water),
        );
      }
    }
  }

  /** One full timestep: MoveWater -> MovePigment -> TransferPigment -> Capillary -> Evaporate. */
  step(): void {
    this.#updateVelocities();
    this.#relaxDivergence();
    this.#flowOutward();
    this.#movePigment();
    this.#settlePigment();
    this.#transferPigment();
    this.#simulateCapillaryFlow();
    this.#evaporate();
  }

  advance(steps: number): void {
    for (let i = 0; i < steps; i += 1) this.step();
  }

  /** Curtis §5.2: thickness `x = g + d`. */
  thickness(): Float32Array {
    const out = new Float32Array(this.size * this.size);
    for (let k = 0; k < out.length; k += 1) out[k] = this.suspended[k] + this.deposited[k];
    return out;
  }

  massSnapshot(): Readonly<StudioWetInkBMassSnapshot> {
    let suspended = 0;
    let deposited = 0;
    let wetCells = 0;
    for (let k = 0; k < this.mask.length; k += 1) {
      suspended += this.suspended[k];
      deposited += this.deposited[k];
      if (this.mask[k]) wetCells += 1;
    }
    return Object.freeze({ suspended, deposited, total: suspended + deposited, wetCells });
  }

  /**
   * `max |epsilon|` from the last RelaxDivergence sweep.
   *
   * Curtis §4.3.2 stops the sweep early once this drops below `tau`. Lane B runs a FIXED
   * `relaxN` iterations instead, because an early-out makes the GPU dispatch count depend on
   * data and would force a readback in the pointer loop. Dropping the early-out is only safe
   * if the fixed count actually converges, so the residual is exposed here and asserted
   * against `relaxTau` by the test suite. That turns a dropped optimisation into a checked claim.
   */
  relaxResidual(): number {
    return this.#lastRelaxResidual;
  }

  #velocityMax(): number {
    let max = 0;
    for (let i = 0; i < this.velocityU.length; i += 1) {
      const a = Math.abs(this.velocityU[i]);
      if (a > max) max = a;
    }
    for (let i = 0; i < this.velocityV.length; i += 1) {
      const a = Math.abs(this.velocityV[i]);
      if (a > max) max = a;
    }
    return max;
  }

  /**
   * Curtis §4.3.1. The paper enters the velocity field here, once per step.
   *
   * Two documented departures from the printed algorithm:
   *   - `+mu*B`, not the paper's printed `-mu*B`. B is the discrete Laplacian, so a minus sign
   *     makes the viscous term ANTI-diffusive and the solver diverges. Curtis's own Eq. 1 has
   *     `+mu*grad^2 u`. See PROVENANCE CORRECTION-1.
   *   - `slopeGain` on the `-grad(h)` term, which Curtis prints with an implicit gain of 1.
   *     Their `h` is a smooth mottled texture; ours is rank-uniform at tooth scale where mean
   *     |grad h| is ~0.11/cell. At gain 1 this stops being Curtis's perturbation and becomes the
   *     dominant forcing, opening its own convection cells. See PROVENANCE CORRECTION-3.
   */
  #updateVelocities(): void {
    const { size, velocityU: u, velocityV: v, pressure: p } = this;
    const h = this.#height;
    const { mu, kappa, slopeGain } = this.options;

    for (let j = 0; j < size; j += 1) {
      for (let i = 1; i < size; i += 1) {
        u[i + j * (size + 1)] -= slopeGain * (h[i + j * size] - h[i - 1 + j * size]);
      }
    }
    for (let j = 1; j < size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        v[i + j * size] -= slopeGain * (h[i + j * size] - h[i + (j - 1) * size]);
      }
    }
    this.#clampVelocities();
    this.#enforceBoundary();

    const substeps = studioWetInkBSubstepCount(this.#velocityMax());
    const dt = 1 / substeps;

    const uFace = (i: number, j: number): number =>
      i < 0 || i > size || j < 0 || j >= size ? 0 : u[i + j * (size + 1)];
    const vFace = (i: number, j: number): number =>
      i < 0 || i >= size || j < 0 || j > size ? 0 : v[i + j * size];
    const uCentre = (i: number, j: number): number =>
      i < 0 || i >= size || j < 0 || j >= size
        ? 0
        : 0.5 * (u[i + j * (size + 1)] + u[i + 1 + j * (size + 1)]);
    const vCentre = (i: number, j: number): number =>
      i < 0 || i >= size || j < 0 || j >= size
        ? 0
        : 0.5 * (v[i + j * size] + v[i + (j + 1) * size]);
    // Curtis's corner-averaged product (uv)_{i+.5,j+.5}.
    const uvCorner = (i: number, j: number): number =>
      0.5 * (uFace(i + 1, j) + uFace(i + 1, j + 1)) * 0.5 * (vFace(i, j + 1) + vFace(i + 1, j + 1));

    for (let substep = 0; substep < substeps; substep += 1) {
      this.#nextU.set(u);
      this.#nextV.set(v);
      for (let j = 0; j < size; j += 1) {
        for (let i = 0; i < size; i += 1) {
          const k = i + j * size;
          if (i < size - 1) {
            const a =
              uCentre(i, j) * uCentre(i, j) -
              uCentre(i + 1, j) * uCentre(i + 1, j) +
              uvCorner(i, j - 1) -
              uvCorner(i, j);
            const b =
              uFace(i + 2, j) +
              uFace(i, j) +
              uFace(i + 1, j + 1) +
              uFace(i + 1, j - 1) -
              4 * uFace(i + 1, j);
            this.#nextU[i + 1 + j * (size + 1)] =
              uFace(i + 1, j) +
              dt * (a + mu * b + p[k] - p[k + 1] - kappa * uFace(i + 1, j));
          }
          if (j < size - 1) {
            const a =
              vCentre(i, j) * vCentre(i, j) -
              vCentre(i, j + 1) * vCentre(i, j + 1) +
              uvCorner(i - 1, j) -
              uvCorner(i, j);
            const b =
              vFace(i + 1, j + 1) +
              vFace(i - 1, j + 1) +
              vFace(i, j + 2) +
              vFace(i, j) -
              4 * vFace(i, j + 1);
            this.#nextV[i + (j + 1) * size] =
              vFace(i, j + 1) +
              dt * (a + mu * b + p[k] - p[k + size] - kappa * vFace(i, j + 1));
          }
        }
      }
      u.set(this.#nextU);
      v.set(this.#nextV);
      this.#clampVelocities();
      this.#enforceBoundary();
    }
  }

  /**
   * Keeps the CFL condition true at the fixed substep cap. Curtis guarantees it by choosing
   * `dt = 1/ceil(max|v|)` with no cap; Lane B caps the substep count to keep the GPU dispatch
   * schedule data-independent, so the guarantee has to come from the clamp instead.
   */
  #clampVelocities(): void {
    const limit = STUDIO_WET_INK_B_MAX_SUBSTEPS;
    const { velocityU: u, velocityV: v } = this;
    for (let i = 0; i < u.length; i += 1) {
      if (u[i] > limit) u[i] = limit;
      else if (u[i] < -limit) u[i] = -limit;
    }
    for (let i = 0; i < v.length; i += 1) {
      if (v[i] > limit) v[i] = limit;
      else if (v[i] < -limit) v[i] = -limit;
    }
  }

  /**
   * Curtis §4.3.1: "sets the velocity at the boundary of any pixel not in the wet-area mask to
   * zero". This is what keeps a wet-on-dry stroke from spreading, and it is also why pigment
   * advection cannot leak out of the domain: the outermost faces always border a non-mask cell.
   */
  #enforceBoundary(): void {
    const { size, velocityU: u, velocityV: v, mask } = this;
    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i <= size; i += 1) {
        const left = i > 0 ? mask[i - 1 + j * size] : 0;
        const right = i < size ? mask[i + j * size] : 0;
        if (!left || !right) u[i + j * (size + 1)] = 0;
      }
    }
    for (let j = 0; j <= size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        const up = j > 0 ? mask[i + (j - 1) * size] : 0;
        const down = j < size ? mask[i + j * size] : 0;
        if (!up || !down) v[i + j * size] = 0;
      }
    }
  }

  /** Curtis §4.3.2 — Jacobi pressure relaxation. N = 50, xi = 0.1, gather form. */
  #relaxDivergence(): void {
    const { size, velocityU: u, velocityV: v, pressure: p, mask } = this;
    const { relaxN, relaxXi } = this.options;
    const e = this.#relaxE;
    let residual = 0;

    for (let iteration = 0; iteration < relaxN; iteration += 1) {
      residual = 0;
      for (let j = 0; j < size; j += 1) {
        for (let i = 0; i < size; i += 1) {
          const k = i + j * size;
          if (!mask[k]) {
            e[k] = 0;
            continue;
          }
          const div =
            u[i + 1 + j * (size + 1)] -
            u[i + j * (size + 1)] +
            (v[i + (j + 1) * size] - v[i + j * size]);
          const value = -relaxXi * div;
          e[k] = value;
          const abs = Math.abs(value);
          if (abs > residual) residual = abs;
        }
      }
      for (let k = 0; k < p.length; k += 1) p[k] += e[k];

      // Face f = i + j*(size+1) is the LEFT face of cell (i,j) and the RIGHT face of (i-1,j).
      for (let j = 0; j < size; j += 1) {
        for (let i = 0; i <= size; i += 1) {
          const here = i < size ? e[i + j * size] : 0;
          const before = i > 0 ? e[i - 1 + j * size] : 0;
          this.#nextU[i + j * (size + 1)] = u[i + j * (size + 1)] - here + before;
        }
      }
      for (let j = 0; j <= size; j += 1) {
        for (let i = 0; i < size; i += 1) {
          const here = j < size ? e[i + j * size] : 0;
          const before = j > 0 ? e[i + (j - 1) * size] : 0;
          this.#nextV[i + j * size] = v[i + j * size] - here + before;
        }
      }
      u.set(this.#nextU);
      v.set(this.#nextV);
      this.#enforceBoundary();
    }
    this.#lastRelaxResidual = residual;
  }

  /** Curtis §4.3.3 / Eq. 3: `p <- p - eta*(1 - M')*M`, `M' = gaussian_K(M)`, separable. */
  #flowOutward(): void {
    const { size, mask, pressure: p } = this;
    const taps = this.#taps;
    const radius = (taps.length - 1) >> 1;
    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        let acc = 0;
        for (let t = -radius; t <= radius; t += 1) {
          acc += taps[t + radius] * mask[Math.min(size - 1, Math.max(0, i + t)) + j * size];
        }
        this.#blurTmp[i + j * size] = acc;
      }
    }
    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        let acc = 0;
        for (let t = -radius; t <= radius; t += 1) {
          acc += taps[t + radius] * this.#blurTmp[i + Math.min(size - 1, Math.max(0, j + t)) * size];
        }
        this.#blur[i + j * size] = acc;
      }
    }
    const { eta } = this.options;
    for (let k = 0; k < mask.length; k += 1) {
      if (mask[k]) p[k] -= eta * (1 - this.#blur[k]);
    }
  }

  /**
   * Outflow of suspended pigment from one cell, per Curtis §4.4's upwind rule.
   *
   * Only IN-DOMAIN directions contribute to `total`. The Phase 1 prototype summed all four and
   * then subtracted the full total, which silently destroyed pigment at the domain edge whenever
   * the boundary condition had not already zeroed those faces. See PROVENANCE CORRECTION-4.
   */
  #outflow(i: number, j: number, dt: number): [number, number, number, number, number] {
    const { size, velocityU: u, velocityV: v, suspended: g } = this;
    const k = i + j * size;
    const value = g[k];
    if (value <= 0) return [0, 0, 0, 0, 1];
    const right = i + 1 < size ? Math.max(0, u[i + 1 + j * (size + 1)] * value) * dt : 0;
    const left = i > 0 ? Math.max(0, -u[i + j * (size + 1)] * value) * dt : 0;
    const down = j + 1 < size ? Math.max(0, v[i + (j + 1) * size] * value) * dt : 0;
    const up = j > 0 ? Math.max(0, -v[i + j * size] * value) * dt : 0;
    const total = right + left + down + up;
    const scale = total > value ? value / total : 1;
    return [right, left, down, up, scale];
  }

  /** Curtis §4.4 — upwind advection of pigment by the velocity field, in gather form. */
  #movePigment(): void {
    const { size, suspended: g } = this;
    const substeps = studioWetInkBSubstepCount(this.#velocityMax());
    const dt = 1 / substeps;

    for (let substep = 0; substep < substeps; substep += 1) {
      for (let j = 0; j < size; j += 1) {
        for (let i = 0; i < size; i += 1) {
          const k = i + j * size;
          const [right, left, down, up, scale] = this.#outflow(i, j, dt);
          let next = g[k] - (right + left + down + up) * scale;
          if (i > 0) {
            const n = this.#outflow(i - 1, j, dt);
            next += n[0] * n[4]; // left neighbour's rightward flux
          }
          if (i + 1 < size) {
            const n = this.#outflow(i + 1, j, dt);
            next += n[1] * n[4]; // right neighbour's leftward flux
          }
          if (j > 0) {
            const n = this.#outflow(i, j - 1, dt);
            next += n[2] * n[4]; // upper neighbour's downward flux
          }
          if (j + 1 < size) {
            const n = this.#outflow(i, j + 1, dt);
            next += n[3] * n[4]; // lower neighbour's upward flux
          }
          this.#nextSuspended[k] = next;
        }
      }
      g.set(this.#nextSuspended);
    }
  }

  /**
   * LANE B ADDITION (independent), an ENHANCEMENT to Curtis §4.5 rather than a fix.
   *
   * Curtis §2.1 defines granulation physically as particles that "settle into the hollows of
   * rough paper" — a TRANSPORT of suspended pigment. Curtis §4.5 models only the rate
   * consequence (adsorption is faster in valleys), never the transport itself. Measured: literal
   * Curtis §4.5 with a live flow field DOES granulate, at 3.95x gamma-separation. This term
   * raises that to 6.2x and 1.8x grain amplitude, and makes granulation independent of how much
   * flow happened to occur. `settle: 0` returns to literal Curtis and still works.
   *
   * The flux is a DETAILED-BALANCE form: zero when `g_k/g_m == w_k/w_m`, so the field relaxes to
   * `g proportional to w` and STOPS. A plain downhill flux has no fixed point and piles pigment
   * into towers — measured `x_max` drifting 1.0 -> 19.7 with bare white craters between.
   * See PROVENANCE CORRECTION-2.
   */
  #settlePigment(): void {
    const { size, mask, suspended: g } = this;
    const tooth = this.#tooth;
    const sigma = this.options.settle;
    const { gamma } = this.pigment;
    if (sigma <= 0 || gamma <= 0) return;

    const affinity = (k: number): number =>
      1 + gamma * STUDIO_WET_INK_B_HOLLOW_AFFINITY_GAIN * (0.5 - tooth[k]);

    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        const k = i + j * size;
        if (!mask[k]) {
          this.#nextSuspended[k] = g[k];
          continue;
        }
        const wk = affinity(k);
        let outward = 0;
        for (let dir = 0; dir < 4; dir += 1) {
          const ni = i + (dir === 0 ? 1 : dir === 1 ? -1 : 0);
          const nj = j + (dir === 2 ? 1 : dir === 3 ? -1 : 0);
          if (ni < 0 || ni >= size || nj < 0 || nj >= size) continue;
          const m = ni + nj * size;
          if (!mask[m]) continue;
          const wm = affinity(m);
          const q = (sigma * (g[k] * wm - g[m] * wk)) / (wk + wm);
          // Antisymmetric clamp: the neighbour computing this same pair gets exactly -flux.
          const flux =
            q > 0
              ? Math.min(q, g[k] * STUDIO_WET_INK_B_SETTLE_FLUX_CLAMP)
              : Math.max(q, -g[m] * STUDIO_WET_INK_B_SETTLE_FLUX_CLAMP);
          outward += flux;
        }
        this.#nextSuspended[k] = g[k] - outward;
      }
    }
    g.set(this.#nextSuspended);
  }

  /**
   * Curtis §4.5 — the whole of granulation, two lines:
   *   delta_down = g * (1 - h^gamma) * rho            (adsorption)
   *   delta_up   = d * (1 + (h-1)*gamma) * rho/omega  (desorption)
   * `gamma` is the ONLY place `h` enters; `omega` is staining power, `rho` is density.
   *
   * The exponent is as the paper prints it (`h^gamma` for adsorption, linear `(h-1)*gamma` for
   * desorption). A linear `(1 - h*gamma)` reading also "works" but separates gamma=0.91 from
   * gamma=0.08 far more weakly. See PROVENANCE NOTE-A — this one is worth a second opinion.
   *
   * Both clamps apply to the same pair of deltas, so `g + d` is conserved exactly.
   */
  #transferPigment(): void {
    const { mask, suspended: g, deposited: d } = this;
    const h = this.#height;
    const { rho, omega, gamma } = this.pigment;
    for (let k = 0; k < mask.length; k += 1) {
      if (!mask[k]) continue;
      let down = g[k] * (1 - Math.pow(h[k], gamma)) * rho;
      let up = (d[k] * (1 + (h[k] - 1) * gamma) * rho) / omega;
      if (d[k] + down > 1) down = Math.max(0, 1 - d[k]);
      if (g[k] + up > 1) up = Math.max(0, 1 - g[k]);
      d[k] += down - up;
      g[k] += up - down;
    }
  }

  /** Curtis §4.6 — capillary diffusion inside the paper; expands the wet mask. Gather form. */
  #simulateCapillaryFlow(): void {
    const { size, mask, saturation: s } = this;
    const c = this.#capacity;
    const { absorbRate, sDiffuseMin, sReceiveMin, sExpandMask } = this.options;

    for (let k = 0; k < mask.length; k += 1) {
      if (mask[k] > 0) s[k] += Math.max(0, Math.min(absorbRate, c[k] - s[k]));
    }

    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        const k = i + j * size;
        let delta = 0;
        for (let dir = 0; dir < 4; dir += 1) {
          const ni = i + (dir === 0 ? 1 : dir === 1 ? -1 : 0);
          const nj = j + (dir === 2 ? 1 : dir === 3 ? -1 : 0);
          if (ni < 0 || ni >= size || nj < 0 || nj >= size) continue;
          const m = ni + nj * size;
          // Receive from m when m is the wetter side and this cell can take it.
          if (s[m] >= sDiffuseMin && s[m] >= s[k] && s[k] >= sReceiveMin) {
            delta += Math.max(0, Math.min(s[m] - s[k], c[k] - s[k]) / 4);
          }
          // Give to m when this cell is the wetter side.
          if (s[k] >= sDiffuseMin && s[k] >= s[m] && s[m] >= sReceiveMin) {
            delta -= Math.max(0, Math.min(s[k] - s[m], c[m] - s[m]) / 4);
          }
        }
        this.#nextSaturation[k] = s[k] + delta;
      }
    }
    s.set(this.#nextSaturation);

    for (let k = 0; k < mask.length; k += 1) {
      this.#nextMask[k] = s[k] > sExpandMask ? 1 : mask[k];
    }
    mask.set(this.#nextMask);
  }

  /**
   * LANE B ADDITION (independent). Curtis's loop has no explicit drying term — the paper runs a
   * fixed number of steps and stops. Without evaporation the wet mask only ever grows (capillary
   * flow expands it) and edge darkening never locks in. Draining pressure and retiring cells
   * whose water is gone is what turns FlowOutward's rim into a permanent deposit.
   *
   * `d += g; g = 0` moves pigment between fields, so `g + d` is conserved.
   */
  #evaporate(): void {
    const { mask, pressure: p, saturation: s, suspended: g, deposited: d } = this;
    const rate = this.options.evaporate;
    if (rate <= 0) return;
    for (let k = 0; k < mask.length; k += 1) {
      if (!mask[k]) continue;
      p[k] = Math.max(0, p[k] - rate);
      s[k] = Math.max(0, s[k] - rate * 0.5);
      if (p[k] <= 0 && s[k] <= this.options.sReceiveMin) {
        d[k] += g[k];
        g[k] = 0;
        mask[k] = 0;
      }
    }
  }
}
