/**
 * Lane B wet-ink model contract.
 *
 * Numerical constants and types shared by the CPU reference backend and the WebGPU runtime.
 * Both backends MUST read every tunable from here so that a divergence between them is a
 * genuine arithmetic difference and never a transcription slip.
 *
 * Derivation: Curtis et al., "Computer-Generated Watercolor", SIGGRAPH 1997, §4;
 * Van Laerhoven & Van Reeth, CGI 2004, §3-4. Provenance for every constant is recorded in
 * the Lane B PROVENANCE.md; the short form is in the comments below.
 *
 * This module is pure data + pure functions. It imports nothing from the studio runtime and
 * must stay free of `GPUDevice`, DOM, and React so that the gate harness can load it in Node.
 */

export const STUDIO_WET_INK_B_MODEL_REVISION = 1 as const;

/**
 * Fixed-substep ceiling.
 *
 * Curtis §4.3.1 uses an adaptive `dt = 1/ceil(max|v|)` and loops `ceil(max|v|)` times, which
 * makes the *number of dispatches* data-dependent. On the GPU that would require reading the
 * velocity maximum back to the CPU every pointer move — exactly the readback the webgpu skill
 * forbids in an interactive loop.
 *
 * Lane B instead dispatches a FIXED `MAX_SUBSTEPS` velocity passes and lets each pass early-out
 * on the GPU by comparing its own substep index against a substep count that a reduction pass
 * wrote into a GPU buffer. The CPU reference applies the identical cap so the two backends run
 * the same number of substeps for the same state. Velocities are clamped to `MAX_SUBSTEPS`
 * cells/step to keep the CFL condition true at the cap.
 */
export const STUDIO_WET_INK_B_MAX_SUBSTEPS = 8 as const;

/** Compute workgroup edge; every sim pass is a 4-neighbour stencil, so 8x8 with a 1-cell apron. */
export const STUDIO_WET_INK_B_WORKGROUP = 8 as const;

export interface StudioWetInkBOptions {
  /** Viscosity. Curtis §4: "we set mu = 0.1". */
  readonly mu: number;
  /** Viscous drag. Curtis §4: "kappa = 0.01". */
  readonly kappa: number;
  /** RelaxDivergence iteration cap. Curtis §4.3.2: N = 50. */
  readonly relaxN: number;
  /** RelaxDivergence tolerance. Curtis §4.3.2: tau = 0.01. */
  readonly relaxTau: number;
  /** RelaxDivergence redistribution factor. Curtis §4.3.2: xi = 0.1. */
  readonly relaxXi: number;
  /** FlowOutward gaussian kernel width. Curtis §4.3.3: K = 10. */
  readonly edgeK: number;
  /** Edge-darkening strength. Curtis Eq. 3: 0.01 <= eta <= 0.05. */
  readonly eta: number;
  /** Capillary absorption rate (Curtis §4.6 beta). */
  readonly absorbRate: number;
  /** Minimum saturation that will diffuse (Curtis §4.6 epsilon). */
  readonly sDiffuseMin: number;
  /** Minimum saturation a cell will receive into (Curtis §4.6 delta). */
  readonly sReceiveMin: number;
  /** Saturation above which the wet mask expands (Curtis §4.6 sigma). */
  readonly sExpandMask: number;
  /** LANE B: explicit water loss per step. Curtis's loop has no drying term. */
  readonly evaporate: number;
  /** LANE B: granular settling rate. 0 reproduces literal Curtis §4.5. */
  readonly settle: number;
  /** LANE B: gain on the -grad(h) velocity term. Curtis implies 1.0; see PROVENANCE CORRECTION-3. */
  readonly slopeGain: number;
}

export const STUDIO_WET_INK_B_DEFAULT_OPTIONS: Readonly<StudioWetInkBOptions> = Object.freeze({
  mu: 0.1,
  kappa: 0.01,
  relaxN: 50,
  relaxTau: 0.01,
  relaxXi: 0.1,
  edgeK: 10,
  eta: 0.025,
  absorbRate: 0.02,
  sDiffuseMin: 0.02,
  sReceiveMin: 0.01,
  sExpandMask: 0.35,
  evaporate: 0.0025,
  settle: 0.2,
  slopeGain: 0.15,
});

export interface StudioWetInkBPigment {
  /** Kubelka-Munk absorption per linear RGB channel (Curtis Figure 5). */
  readonly K: readonly [number, number, number];
  /** Kubelka-Munk scattering per linear RGB channel (Curtis Figure 5). */
  readonly S: readonly [number, number, number];
  /** Density. Curtis §4.5 `rho`. */
  readonly rho: number;
  /** Staining power. Curtis §4.5 `omega`. Burnt Umber is the strong stainer at 9.3. */
  readonly omega: number;
  /** Granularity. Curtis §4.5 `gamma` — the ONLY place paper height enters pigment transfer. */
  readonly gamma: number;
}

export type StudioWetInkBPigmentId =
  | "french-ultramarine"
  | "hansa-yellow"
  | "burnt-umber"
  | "quinacridone-rose"
  | "hookers-green"
  | "cerulean";

/** Curtis Figure 5's published pigment table. French Ultramarine granulates; Hansa Yellow does not. */
export const STUDIO_WET_INK_B_PIGMENTS: Readonly<
  Record<StudioWetInkBPigmentId, Readonly<StudioWetInkBPigment>>
> = Object.freeze({
  "french-ultramarine": Object.freeze({
    K: [0.86, 0.86, 0.06] as const,
    S: [0.005, 0.005, 0.09] as const,
    rho: 0.01,
    omega: 3.1,
    gamma: 0.91,
  }),
  "hansa-yellow": Object.freeze({
    K: [0.06, 0.21, 1.78] as const,
    S: [0.5, 0.88, 0.009] as const,
    rho: 0.06,
    omega: 1.0,
    gamma: 0.08,
  }),
  "burnt-umber": Object.freeze({
    K: [0.74, 1.54, 2.1] as const,
    S: [0.09, 0.09, 0.004] as const,
    rho: 0.09,
    omega: 9.3,
    gamma: 0.9,
  }),
  "quinacridone-rose": Object.freeze({
    K: [0.14, 1.08, 0.44] as const,
    S: [0.22, 0.07, 0.57] as const,
    rho: 0.03,
    omega: 2.2,
    gamma: 0.12,
  }),
  "hookers-green": Object.freeze({
    K: [1.62, 0.61, 1.64] as const,
    S: [0.01, 0.01, 0.01] as const,
    rho: 0.04,
    omega: 4.8,
    gamma: 0.24,
  }),
  cerulean: Object.freeze({
    K: [1.52, 0.32, 0.06] as const,
    S: [0.06, 0.26, 0.44] as const,
    rho: 0.02,
    omega: 1.8,
    gamma: 0.76,
  }),
});

/**
 * Hollow-affinity gain in the Lane B settling term.
 *
 * PROVENANCE: invented. No paper behind this value — it sets granulation contrast and was
 * chosen by measured sweep, not derived. Kept as a named constant precisely so it is easy to
 * find and challenge.
 */
export const STUDIO_WET_INK_B_HOLLOW_AFFINITY_GAIN = 1.2 as const;

/** Per-pair settling flux clamp, as a fraction of the donor cell's suspended pigment. */
export const STUDIO_WET_INK_B_SETTLE_FLUX_CLAMP = 0.25 as const;

export interface StudioWetInkBDab {
  /** Dab centre in grid cells. */
  readonly x: number;
  readonly y: number;
  /** Dab radius in grid cells. */
  readonly radius: number;
  /** Brush load in [0,1] at the dab centre; falls off to 0 at the rim. */
  readonly load: number;
  /** Dryness in [0,1]. 0 = fully charged brush (Curtis's full-wet case), 1 = bone dry. */
  readonly dryness: number;
  /** Water deposited per unit wetness. */
  readonly water: number;
  /** Pigment deposited per unit load, as optical quantity — never a colour. */
  readonly pigment: number;
}

export const STUDIO_WET_INK_B_DEFAULT_DAB: Readonly<Omit<StudioWetInkBDab, "x" | "y">> =
  Object.freeze({
    radius: 18,
    load: 1,
    dryness: 0,
    water: 1,
    pigment: 1,
  });

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Normalizes partial options against the defaults, rejecting non-finite input. */
export function normalizeStudioWetInkBOptions(
  input?: Partial<StudioWetInkBOptions>,
): Readonly<StudioWetInkBOptions> {
  const base = STUDIO_WET_INK_B_DEFAULT_OPTIONS;
  if (!input) return base;
  return Object.freeze({
    mu: finiteOr(input.mu, base.mu),
    kappa: finiteOr(input.kappa, base.kappa),
    relaxN: Math.max(0, Math.floor(finiteOr(input.relaxN, base.relaxN))),
    relaxTau: finiteOr(input.relaxTau, base.relaxTau),
    relaxXi: finiteOr(input.relaxXi, base.relaxXi),
    edgeK: Math.max(1, Math.floor(finiteOr(input.edgeK, base.edgeK))),
    eta: finiteOr(input.eta, base.eta),
    absorbRate: finiteOr(input.absorbRate, base.absorbRate),
    sDiffuseMin: finiteOr(input.sDiffuseMin, base.sDiffuseMin),
    sReceiveMin: finiteOr(input.sReceiveMin, base.sReceiveMin),
    sExpandMask: finiteOr(input.sExpandMask, base.sExpandMask),
    evaporate: finiteOr(input.evaporate, base.evaporate),
    settle: finiteOr(input.settle, base.settle),
    slopeGain: finiteOr(input.slopeGain, base.slopeGain),
  });
}

/** Normalizes a dab, clamping the unit-interval fields. */
export function normalizeStudioWetInkBDab(
  input: Readonly<Partial<StudioWetInkBDab>> & Pick<StudioWetInkBDab, "x" | "y">,
): Readonly<StudioWetInkBDab> {
  const base = STUDIO_WET_INK_B_DEFAULT_DAB;
  return Object.freeze({
    x: finiteOr(input.x, 0),
    y: finiteOr(input.y, 0),
    radius: Math.max(0, finiteOr(input.radius, base.radius)),
    load: clamp01(finiteOr(input.load, base.load)),
    dryness: clamp01(finiteOr(input.dryness, base.dryness)),
    water: Math.max(0, finiteOr(input.water, base.water)),
    pigment: Math.max(0, finiteOr(input.pigment, base.pigment)),
  });
}

/**
 * Separable gaussian taps for the FlowOutward mask blur (Curtis §4.3.3, K = 10).
 *
 * Normalized to sum 1 so that `M' == 1` deep inside a large wet region and the edge-darkening
 * term `p -= eta * (1 - M') * M` vanishes there, as Eq. 3 requires.
 */
export function studioWetInkBGaussianTaps(edgeK: number): Float32Array {
  const radius = Math.max(1, Math.floor(edgeK / 2));
  const sigma = edgeK / 6;
  const size = 2 * radius + 1;
  const taps = new Float32Array(size);
  let sum = 0;
  for (let i = 0; i < size; i += 1) {
    const x = i - radius;
    taps[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
    sum += taps[i];
  }
  for (let i = 0; i < size; i += 1) taps[i] /= sum;
  return taps;
}

/**
 * The substep count Curtis's adaptive rule would choose, capped at `MAX_SUBSTEPS`.
 * Shared by both backends so the fixed-dispatch GPU schedule and the CPU loop agree exactly.
 */
export function studioWetInkBSubstepCount(velocityMax: number): number {
  if (!Number.isFinite(velocityMax) || velocityMax <= 0) return 1;
  return Math.min(STUDIO_WET_INK_B_MAX_SUBSTEPS, Math.max(1, Math.ceil(velocityMax)));
}
