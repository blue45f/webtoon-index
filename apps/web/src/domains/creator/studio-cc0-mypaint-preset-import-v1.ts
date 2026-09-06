/**
 * CC0 MyPaint preset import v1 — verbatim parameter harvest from mypaint/mypaint-brushes.
 *
 * Upstream: github.com/mypaint/mypaint-brushes (brush data licensed CC0 1.0 Universal — the
 * package COPYING file is the CC0 legal code and the README states "Only public domain (CC0 1.0)
 * is an acceptable license for the official mypaint-brushes package"). The parameter tables below
 * are transcribed verbatim from the named `.myb` v3 JSON files; CC0 permits verbatim reuse, and
 * we keep the exact upstream file path per preset as provenance.
 *
 * What this module is:
 * - a data table (verbatim `.myb` settings for 12 standout texture presets),
 * - a documented mapping of those settings onto the EXISTING stamp-brush walker
 *   (studio-brush-stamp-engine): spacing from dab densities, flow from effective opacity at the
 *   reference pressure, pressure size span from the radius input curve, scatter/radius jitter
 *   from `offset_by_random` / `radius_by_random`,
 * - the libmypaint dab-accumulation linearization helpers (ISC-licensed reference:
 *   libmypaint `mypaint-brush.c`, `prepare_and_draw_dab`, © 2007-2011 Martin Renold; the
 *   formula `alpha_dab = 1 − (1 − opaque)^(1/dabs_per_pixel)` with
 *   `dabs_per_pixel = 1 + opaque_linearize·((DPAR + DPBR)·2 − 1)` is reimplemented here).
 *
 * Determinism/identity contract: this module is pure data + pure math. The stamp engine consumes
 * it only for `mypaint-cc0--*` brush ids; every other brush id resolves to null here, so existing
 * brush output stays byte-identical (mirrors the wetEdgeBloomProgramId / paperProgramId opt-in
 * discipline). Unknown `mypaint-cc0--*` suffixes also resolve to null — the engine then refuses
 * the stamp lane entirely instead of converging to another renderer (fail-closed contract).
 *
 * Known down-scoped inputs (honesty policy — approximations are named, never silent):
 * - `elliptical_dab_ratio/angle`, `smudge*`, `tracking_noise`, `slow_tracking*`, stroke/speed
 *   input envelopes are NOT executed by the stamp walker; the verbatim table still records them
 *   so a future planner can pick them up. Per-preset `mappingNotes` call out what was dropped.
 * - `dabs_per_second` (time-based dabs) has no distance-walker equivalent and is ignored for
 *   spacing (recorded verbatim).
 */

export const STUDIO_CC0_MYPAINT_PRESET_IMPORT_VERSION_V1 = 1 as const;

/** Exact upstream provenance for every value in this module. */
export const STUDIO_CC0_MYPAINT_PRESET_PROVENANCE = Object.freeze({
  repository: "github.com/mypaint/mypaint-brushes",
  license: "CC0-1.0",
  licenseEvidence:
    "mypaint-brushes COPYING = CC0 1.0 Universal legal code; README: \"Only public domain (CC0 1.0) is an acceptable license for the official mypaint-brushes package\"",
  linearizationReference:
    "libmypaint mypaint-brush.c prepare_and_draw_dab (ISC license, © 2007-2011 Martin Renold) — alpha_dab = 1 − (1 − opaque)^(1/dabs_per_pixel)",
} as const);

/** Brush ids of this import pool: `mypaint-cc0--{preset}`. */
export const STUDIO_CC0_MYPAINT_PRESET_BRUSH_ID_PREFIX = "mypaint-cc0--" as const;

/**
 * Stamp kinds this pool maps onto. Subset of the engine's `StudioStampBrushKind` — declared
 * locally so this data module stays a leaf (the engine imports us, never the reverse).
 */
export type StudioCc0MypaintStampKind =
  | "airbrush"
  | "pencil"
  | "ink"
  | "watercolor"
  | "mypaint"
  | "charcoal"
  | "pastel";

/** One verbatim `.myb` setting: base value + optional input curves, exactly as upstream. */
export interface StudioCc0MypaintVerbatimSetting {
  readonly baseValue: number;
  readonly inputs?: Readonly<Record<string, readonly (readonly [number, number])[]>>;
}

export type StudioCc0MypaintVerbatimSettings = Readonly<
  Record<string, StudioCc0MypaintVerbatimSetting>
>;

/**
 * Mapped stamp tuning — the walker-executable projection of the verbatim table.
 * Field derivations (uniform rules, per-preset numbers in the table):
 * - `spacingRatio` = 1 / (2·(dabs_per_actual_radius + dabs_per_basic_radius)), clamped to
 *   [0.03, 4] (sparse splatter presets legitimately exceed one diameter of spacing).
 * - `flow` = clamp01(effective opaque at reference pressure 0.5):
 *   (opaque.base + opaqueCurve(0.5)) · clamp01(opaque_multiply.base + multiplyCurve(0.5)).
 * - `minSizeRatio` = exp(radiusCurve(0) − max(radiusCurve)) — the pressure span of
 *   radius_logarithmic; 1 when the preset has no pressure→radius mapping.
 * - `scatter`/`scatterPressureResponse` = offset_by_random base / its pressure-curve endpoint
 *   delta (units: dab radii, matching libmypaint's base-radius offsets).
 * - `radiusJitter` = radius_by_random base (log-space jitter, symmetric adaptation).
 * - `dabsPerPixel` = max(1, 2·(DPAR + DPBR)) and `opaqueLinearize` = the preset's explicit
 *   opaque_linearize base value (several presets pin it to 0 — linearization stays off there,
 *   mirroring libmypaint's `if (opaque_linearize)` guard).
 */
export interface StudioCc0MypaintStampTuning {
  readonly spacingRatio: number;
  readonly flow: number;
  readonly hardness: number;
  readonly minSizeRatio: number;
  readonly sizeScale: number;
  readonly scatter: number;
  readonly scatterPressureResponse: number;
  readonly radiusJitter: number;
  readonly opaqueLinearize: number;
  readonly dabsPerPixel: number;
  /**
   * Knife class: this preset scrapes a LOAD of paint rather than laying ink, so its mark carries
   * standing paint along the blade's two edges. Opt-in and absent everywhere else, which keeps
   * every other preset's plan structurally identical.
   */
  readonly reliefBody?: boolean;
  /**
   * Flat-nib geometry, verbatim from `elliptical_dab_ratio` / `elliptical_dab_angle`.
   * Optional - a round preset omits both and keeps a byte-identical dab plan.
   */
  readonly ellipticalRatio?: number;
  readonly ellipticalAngleDegrees?: number;
  /**
   * Derived, not transcribed: the pressure response of `opaque`/`opaque_multiply`, normalised to
   * the reference pressure the hand-authored `flow` above is quoted at. Built in `preset()` from
   * the verbatim table so the two can never drift apart.
   */
  readonly flowPressureResponse?: readonly number[];
}

/** Style-resident dynamics the stamp planner executes for a cc0 preset (absent = legacy path). */
export interface StudioCc0MypaintDabDynamicsStyle {
  /** Deterministic per-dab positional jitter in dab radii (libmypaint offset_by_random). */
  readonly scatter: number;
  /** Pressure endpoint delta added to scatter (scatter_eff = max(0, scatter + response·p)). */
  readonly scatterPressureResponse: number;
  /** Symmetric log-space radius jitter amplitude (libmypaint radius_by_random adaptation). */
  readonly radiusJitter: number;
  /**
   * Flat-nib geometry, verbatim from `elliptical_dab_ratio` / `elliptical_dab_angle`.
   *
   * Optional: a preset that does not declare a ratio keeps a round dab and a byte-identical plan.
   * This was the module's largest documented down-scope, and it was the reason CC0 calligraphy and
   * the fat marker measured 0.186 apart despite obviously different upstream files - the flatness
   * IS what separates those two media, so dropping it collapsed them onto each other.
   */
  readonly ellipticalRatio?: number;
  readonly ellipticalAngleDegrees?: number;
  /**
   * Pre-linearized per-dab alpha (libmypaint opaque_linearize) — null when the preset pins
   * opaque_linearize to 0, in which case the plain flow value is used unchanged.
   */
  readonly linearizedFlow: number | null;
  /**
   * The libmypaint `dabs_per_pixel` exponent that produced `linearizedFlow`, so a consumer that
   * scales the deposit can re-derive the per-dab alpha at the SCALED target.
   *
   * Order matters and is not interchangeable: `opaque` is a stroke-level saturation target and the
   * per-dab alpha is solved from it, so a pressure response multiplies the TARGET and the solve
   * happens afterwards. Scaling the already-solved alpha instead is a different (and wrong) curve —
   * measured on mypaint-cc0--knife it lightened the mark about five-fold.
   */
  readonly linearizeDabsPerPixel: number | null;
  /** Knife class — the ink ribbon adds edge relief bands for it. See the tuning field. */
  readonly reliefBody?: boolean;
  /**
   * Flow multiplier sampled at pressure 0…1 in 1/16 steps, normalised to 1 at half pressure.
   * Absent when the preset's deposit does not vary with pressure, which keeps its dab plan
   * byte-identical.
   */
  readonly flowPressureResponse?: readonly number[];
}

export interface StudioCc0MypaintPresetImport {
  /** Short preset id (brushId = `mypaint-cc0--` + presetId). */
  readonly presetId: string;
  readonly brushId: string;
  readonly nameKo: string;
  /** Exact file inside github.com/mypaint/mypaint-brushes. */
  readonly upstreamFile: string;
  readonly pack: "classic" | "deevad" | "tanda" | "ramon";
  readonly kind: StudioCc0MypaintStampKind;
  readonly verbatim: StudioCc0MypaintVerbatimSettings;
  readonly mapped: StudioCc0MypaintStampTuning;
  /** Honesty notes: which verbatim behaviors the stamp walker does not execute. */
  readonly mappingNotes: string;
}

// ---------------------------------------------------------------------------
// libmypaint dab-accumulation linearization (ISC reference, reimplemented)
// ---------------------------------------------------------------------------

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * `dabs_per_pixel` estimate for the walker: raw density `2·(DPAR + DPBR)` floored at 1
 * ("the correction is probably not wanted if the dabs don't overlap"), then interpreted
 * smoothly through the user linearize setting: `1 + opaque_linearize·(dabs_per_pixel − 1)`.
 */
export function studioLibmypaintDabsPerPixel(
  dabsPerActualRadius: number,
  dabsPerBasicRadius: number,
  opaqueLinearize: number,
): number {
  const safeActual = Number.isFinite(dabsPerActualRadius) ? Math.max(0, dabsPerActualRadius) : 0;
  const safeBasic = Number.isFinite(dabsPerBasicRadius) ? Math.max(0, dabsPerBasicRadius) : 0;
  let dabsPerPixel = (safeActual + safeBasic) * 2;
  if (dabsPerPixel < 1) dabsPerPixel = 1;
  const linearize = clamp01(Number.isFinite(opaqueLinearize) ? opaqueLinearize : 0);
  return 1 + linearize * (dabsPerPixel - 1);
}

/**
 * libmypaint opacity linearization: the user's `opaque` is the STROKE-level saturation target;
 * the per-dab alpha is derived so overlapping dabs converge exactly there:
 * `beta = beta_dab^dabs_per_pixel  ⇔  alpha_dab = 1 − (1 − opaque)^(1/dabs_per_pixel)`.
 */
export function studioLibmypaintLinearizedDabAlpha(
  opaque: number,
  dabsPerPixel: number,
): number {
  const target = clamp01(Number.isFinite(opaque) ? opaque : 0);
  if (!Number.isFinite(dabsPerPixel) || dabsPerPixel <= 1) return target;
  return 1 - Math.pow(1 - target, 1 / dabsPerPixel);
}

/**
 * Number of samples in a flow-vs-pressure response table (pressure 0…1 at 1/16 steps).
 *
 * A table rather than a formula because the engine must stay a pure consumer: the `.myb` curves
 * are piecewise-linear control points, and baking them here keeps the interpolation in the module
 * that owns the upstream semantics.
 */
const FLOW_PRESSURE_RESPONSE_SAMPLES = 17;

/**
 * Reference pressure the mapped `flow` is quoted at. The response table is NORMALISED to it, so a
 * preset's deposit at half pressure is exactly the number in its table and this field can only add
 * a response around the existing operating point — never silently restate the whole preset.
 */
const FLOW_REFERENCE_PRESSURE = 0.5;

/** Piecewise-linear evaluation of a `.myb` input curve; 0 outside a missing curve. */
function mybCurveAt(
  points: readonly (readonly [number, number])[] | undefined,
  at: number,
): number {
  if (!points || points.length === 0) return 0;
  const first = points[0]!;
  if (at <= first[0]) return first[1];
  const last = points[points.length - 1]!;
  if (at >= last[0]) return last[1];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    if (at <= current[0]) {
      const span = current[0] - previous[0];
      if (span <= 0) return current[1];
      return previous[1] + ((at - previous[0]) / span) * (current[1] - previous[1]);
    }
  }
  return last[1];
}

/**
 * Effective `opaque` at a pressure — the same product the mapped `flow` is quoted from, evaluated
 * anywhere on the curve instead of only at the reference pressure.
 *
 * A preset with no `opaque_multiply` at all multiplies by 1; that is the only reading under which
 * the mapped numbers in the table below reproduce, and it matches libmypaint, where the setting
 * defaults to fully opaque rather than to zero.
 */
function effectiveOpaqueAtPressure(
  verbatim: StudioCc0MypaintVerbatimSettings,
  pressure: number,
): number {
  const opaque = verbatim.opaque;
  const multiply = verbatim.opaque_multiply;
  const base = clamp01((opaque?.baseValue ?? 0) + mybCurveAt(opaque?.inputs?.pressure, pressure));
  const scale = multiply
    ? clamp01(multiply.baseValue + mybCurveAt(multiply.inputs?.pressure, pressure))
    : 1;
  return base * scale;
}

/**
 * Flow multiplier per pressure, normalised so that half pressure is exactly 1.
 *
 * This exists because the import used to collapse `opaque`/`opaque_multiply` to ONE number — the
 * value at half pressure — and the stamp engine has no pressure term in its dab alpha at all. The
 * result was measurable and wrong in the obvious direction: rendered over a 0.12→0.90 pressure
 * ramp, `mypaint-cc0--marker-fat` and `mypaint-cc0--knife` produced an identical mark at both ends
 * (ink ratio 1.000, thickness ratio 1.000) and `mypaint-cc0--dry-brush` actually got LIGHTER when
 * pressed (0.926). Eighteen of these presets record a pressure curve on `opaque_multiply`; none of
 * them could reach a pixel.
 *
 * Returns null when the preset's deposit genuinely does not vary with pressure, so those presets
 * keep a byte-identical dab plan and carry no table.
 */
function flowPressureResponseTable(
  verbatim: StudioCc0MypaintVerbatimSettings,
): readonly number[] | null {
  const reference = effectiveOpaqueAtPressure(verbatim, FLOW_REFERENCE_PRESSURE);
  if (!(reference > 0)) return null;
  const table: number[] = [];
  let varies = false;
  for (let index = 0; index < FLOW_PRESSURE_RESPONSE_SAMPLES; index += 1) {
    const pressure = index / (FLOW_PRESSURE_RESPONSE_SAMPLES - 1);
    const ratio = effectiveOpaqueAtPressure(verbatim, pressure) / reference;
    if (Math.abs(ratio - 1) > 1e-6) varies = true;
    table.push(Math.max(0, ratio));
  }
  return varies ? Object.freeze(table) : null;
}

/** Resolve the style-resident dynamics for a cc0 tuning at the final (post-override) flow. */
export function resolveStudioCc0MypaintDabDynamicsStyle(
  tuning: StudioCc0MypaintStampTuning,
  resolvedFlow: number,
): StudioCc0MypaintDabDynamicsStyle {
  const linearizeDabsPerPixel = tuning.opaqueLinearize > 0
    ? 1 + clamp01(tuning.opaqueLinearize) * (Math.max(1, tuning.dabsPerPixel) - 1)
    : null;
  const linearizedFlow = linearizeDabsPerPixel === null
    ? null
    : studioLibmypaintLinearizedDabAlpha(resolvedFlow, linearizeDabsPerPixel);
  return Object.freeze({
    scatter: tuning.scatter,
    scatterPressureResponse: tuning.scatterPressureResponse,
    radiusJitter: tuning.radiusJitter,
    linearizedFlow,
    linearizeDabsPerPixel,
    ...(tuning.reliefBody === true ? { reliefBody: true } : {}),
    // Only forwarded when the preset actually declares a flat nib, so a round preset's dab plan
    // stays byte-identical.
    ...(tuning.ellipticalRatio && tuning.ellipticalRatio > 1
      ? {
          ellipticalRatio: tuning.ellipticalRatio,
          ellipticalAngleDegrees: tuning.ellipticalAngleDegrees ?? 0,
        }
      : {}),
    ...(tuning.flowPressureResponse
      ? { flowPressureResponse: tuning.flowPressureResponse }
      : {}),
  });
}

// ---------------------------------------------------------------------------
// Verbatim preset tables (transcribed from the named upstream .myb v3 files)
// ---------------------------------------------------------------------------

function preset(
  presetId: string,
  nameKo: string,
  upstreamFile: string,
  pack: StudioCc0MypaintPresetImport["pack"],
  kind: StudioCc0MypaintStampKind,
  verbatim: StudioCc0MypaintVerbatimSettings,
  mapped: StudioCc0MypaintStampTuning,
  mappingNotes: string,
): StudioCc0MypaintPresetImport {
  return Object.freeze({
    presetId,
    brushId: `${STUDIO_CC0_MYPAINT_PRESET_BRUSH_ID_PREFIX}${presetId}`,
    nameKo,
    upstreamFile,
    pack,
    kind,
    verbatim: Object.freeze(verbatim),
    // The flow response is DERIVED from the verbatim curves here rather than transcribed into the
    // table, so a preset can never declare a pressure response its own upstream settings do not
    // have — and so the hand-authored `flow` and the response cannot drift apart.
    mapped: Object.freeze(((): StudioCc0MypaintStampTuning => {
      const flowPressureResponse = flowPressureResponseTable(verbatim);
      return flowPressureResponse ? { ...mapped, flowPressureResponse } : mapped;
    })()),
    mappingNotes,
  });
}

export const STUDIO_CC0_MYPAINT_PRESET_IMPORTS: readonly StudioCc0MypaintPresetImport[] =
  Object.freeze([
    preset(
      "charcoal",
      "MyPaint 오픈소스 · 목탄",
      "brushes/classic/charcoal.myb",
      "classic",
      "charcoal",
      {
        opaque: { baseValue: 0.4, inputs: { pressure: [[0, 0], [1, 0.4]] } },
        opaque_multiply: { baseValue: 0, inputs: { pressure: [[0, 0], [1, 1]] } },
        opaque_linearize: { baseValue: 0 },
        radius_logarithmic: { baseValue: 0.7 },
        hardness: { baseValue: 0.2 },
        dabs_per_actual_radius: { baseValue: 5 },
        offset_by_random: { baseValue: 1.6, inputs: { pressure: [[0, 0], [1, -1.4]] } },
        smudge_length: { baseValue: 0.5 },
        slow_tracking: { baseValue: 2 },
      },
      {
        // 2·(5+0) = 10 dabs per diameter → spacing 0.1; flow (0.4+0.2)·0.5 = 0.3.
        spacingRatio: 0.1, flow: 0.3, hardness: 0.2, minSizeRatio: 1, sizeScale: 1,
        // Signature charcoal feel: jitter 1.6 radii that SHRINKS as you press (−1.4·p).
        scatter: 1.6, scatterPressureResponse: -1.4, radiusJitter: 0,
        opaqueLinearize: 0, dabsPerPixel: 10,
      },
      "smudge_length / slow_tracking are recorded but not executed by the stamp walker.",
    ),
    preset(
      "charcoal-tanda",
      "MyPaint 오픈소스 · 목탄 슬리버",
      "brushes/tanda/charcoal-01.myb",
      "tanda",
      "charcoal",
      {
        opaque: {
          baseValue: 0.2,
          inputs: { pressure: [[0, 0], [1, 0.5]], random: [[0, -0.6], [1, 0.6]] },
        },
        opaque_multiply: { baseValue: 0, inputs: { pressure: [[0, 0], [0.083333, 1], [1, 1]] } },
        opaque_linearize: { baseValue: 1 },
        radius_logarithmic: { baseValue: -0.4, inputs: { pressure: [[0, 0], [1, 0.6]] } },
        hardness: { baseValue: 0.9 },
        dabs_per_actual_radius: { baseValue: 5 },
        offset_by_random: { baseValue: 1 },
        elliptical_dab_ratio: { baseValue: 3, inputs: { random: [[0, -1], [1, 1]] } },
        elliptical_dab_angle: { baseValue: 0, inputs: { random: [[0, -180], [1, 180]] } },
        smudge: { baseValue: 0, inputs: { speed1: [[0, 0], [4, 0.2]] } },
      },
      {
        // flow (0.2+0.25)·1 = 0.45; radius pressure span exp(0 − 0.6) = 0.5488.
        spacingRatio: 0.1, flow: 0.45, hardness: 0.9, minSizeRatio: 0.5488, sizeScale: 1,
        scatter: 1, scatterPressureResponse: 0, radiusJitter: 0,
        opaqueLinearize: 1, dabsPerPixel: 10,
      },
      "Random-oriented elliptical slivers (ratio 3, angle ±180°) and per-dab opacity flicker (random ±0.6) are recorded, not executed — scatter 1.0 carries the tooth.",
    ),
    preset(
      "2b-pencil",
      "MyPaint 오픈소스 · 2B 연필",
      "brushes/deevad/2B_pencil.myb",
      "deevad",
      "pencil",
      {
        opaque: { baseValue: 0.15000000000027122 },
        opaque_multiply: { baseValue: 0, inputs: { pressure: [[0, 0], [1, 1]] } },
        opaque_linearize: { baseValue: 0 },
        radius_logarithmic: {
          baseValue: 0.75,
          inputs: { pressure: [[0, -0.687917], [0.752976, 0.236471], [1, 0.286632]] },
        },
        hardness: { baseValue: 0.2, inputs: { pressure: [[0, 0], [1, 0.3]] } },
        dabs_per_actual_radius: { baseValue: 4 },
        offset_by_random: { baseValue: 0.5, inputs: { pressure: [[0, 0], [1, -0.3]] } },
        slow_tracking: { baseValue: 1.03 },
        slow_tracking_per_dab: { baseValue: 1.5 },
      },
      {
        // flow 0.15·0.5 = 0.075 — a real 2B is faint at half pressure and builds by hatching.
        // minSizeRatio exp(−0.687917 − 0.286632) = 0.3773.
        spacingRatio: 0.125, flow: 0.075, hardness: 0.2, minSizeRatio: 0.3773, sizeScale: 1,
        scatter: 0.5, scatterPressureResponse: -0.3, radiusJitter: 0,
        opaqueLinearize: 0, dabsPerPixel: 8,
      },
      "Pressure→hardness (+0.3) and slow_tracking smoothing are recorded, not executed.",
    ),
    preset(
      "dry-brush",
      "MyPaint 오픈소스 · 드라이 브러시",
      "brushes/classic/dry_brush.myb",
      "classic",
      // 2026-08-16: was "ink", which is the engine's SOLID-DISC tip. Measured over all 168 brushes,
      // this preset laid 4016 dabs and rendered exactly ONE distinct interior tone (sd 0.000) — a
      // flat grey slab with a scalloped edge, which is not a dry brush by any reading. Every cc0
      // preset on a textured kind measures 88–213 tones; every one on "ink" measures 1–8.
      //
      // The kind is only the tip kernel ("retained pixel authority"), so this swaps the solid disc
      // for a grainy dry tip and changes nothing else. The note that used to sit below claimed
      // "ink" was chosen for a velocity factor supplying the preset's speed2→radius thinning; there
      // is no velocity or speed term anywhere in the stamp engine or the OSS kernels, so that
      // reason was not real and the preset was paying a flat tip for nothing.
      "charcoal",
      {
        opaque: { baseValue: 0.8, inputs: { pressure: [[0, 0], [1, 0.2]] } },
        opaque_multiply: { baseValue: 0, inputs: { pressure: [[0, 0], [1, 1]] } },
        opaque_linearize: { baseValue: 0 },
        radius_logarithmic: { baseValue: 0.6, inputs: { speed2: [[0, 0.042857], [4, -0.3]] } },
        hardness: { baseValue: 0.2 },
        dabs_per_basic_radius: { baseValue: 6 },
        dabs_per_actual_radius: { baseValue: 6 },
        offset_by_random: { baseValue: 0, inputs: { pressure: [[0, 0], [1, 1.4]] } },
        radius_by_random: { baseValue: 0.1 },
      },
      {
        // 2·(6+6) = 24 → spacing 1/24; flow (0.8+0.1)·0.5 = 0.45.
        spacingRatio: 0.0417, flow: 0.45, hardness: 0.2, minSizeRatio: 1, sizeScale: 1,
        // Inverse of charcoal: pressing harder splays the dry bristles (+1.4·p radii).
        scatter: 0, scatterPressureResponse: 1.4, radiusJitter: 0.1,
        opaqueLinearize: 0, dabsPerPixel: 24,
      },
      "speed2→radius thinning is recorded, not executed — the stamp engine has no velocity term.",
    ),
    preset(
      "splatter",
      "MyPaint 오픈소스 · 스플래터",
      "brushes/tanda/splatter-02.myb",
      "tanda",
      "airbrush",
      {
        opaque: { baseValue: 0.5, inputs: { pressure: [[0, -0.3], [1, 0.45]] } },
        opaque_multiply: { baseValue: 1 },
        opaque_linearize: { baseValue: 0.9 },
        radius_logarithmic: { baseValue: 1.3 },
        hardness: { baseValue: 0.88, inputs: { pressure: [[0, 0], [1, 0.3]] } },
        dabs_per_basic_radius: { baseValue: 0.05 },
        offset_by_random: { baseValue: 2 },
        radius_by_random: { baseValue: 1.5 },
        tracking_noise: { baseValue: 12 },
        slow_tracking: { baseValue: 1 },
      },
      {
        // 2·(0+0.05) = 0.1 dabs per diameter → spacing 10, clamped to the sparse cap 4.
        // dabsPerPixel floors at 1 (libmypaint: no correction when dabs don't overlap).
        spacingRatio: 4, flow: 0.575, hardness: 0.88, minSizeRatio: 1, sizeScale: 1,
        scatter: 2, scatterPressureResponse: 0, radiusJitter: 1.5,
        opaqueLinearize: 0.9, dabsPerPixel: 1,
      },
      "tracking_noise 12 (input-path wobble) is recorded, not executed — scatter 2 + radius jitter 1.5 carry the burst.",
    ),
    preset(
      "ink-blot",
      "MyPaint 오픈소스 · 잉크 블롯",
      "brushes/classic/ink_blot.myb",
      "classic",
      "mypaint",
      {
        opaque: { baseValue: 1 },
        opaque_multiply: { baseValue: 0, inputs: { pressure: [[0, 0], [1, 1]] } },
        opaque_linearize: { baseValue: 0.9 },
        radius_logarithmic: { baseValue: 2.5 },
        hardness: { baseValue: 0.28 },
        dabs_per_actual_radius: { baseValue: 3.32 },
        dabs_per_second: { baseValue: 15 },
        offset_by_random: { baseValue: 0.17 },
        radius_by_random: { baseValue: 0.63 },
      },
      {
        // 2·3.32 = 6.64 → spacing 0.1506; flow 1·0.5 = 0.5, linearized over dpp 6.076.
        spacingRatio: 0.1506, flow: 0.5, hardness: 0.28, minSizeRatio: 1, sizeScale: 1,
        scatter: 0.17, scatterPressureResponse: 0, radiusJitter: 0.63,
        opaqueLinearize: 0.9, dabsPerPixel: 6.64,
      },
      "dabs_per_second 15 (time dabs while hovering) has no distance-walker equivalent; recorded only.",
    ),
    preset(
      "kabura",
      "MyPaint 오픈소스 · 카부라 펜",
      "brushes/classic/kabura.myb",
      "classic",
      "ink",
      {
        opaque: {
          baseValue: 1.29,
          inputs: {
            pressure: [[0, -0.989583], [0.38253, -0.59375], [0.656627, 0.041667], [1, 1]],
          },
        },
        opaque_multiply: {
          baseValue: 0,
          inputs: { pressure: [[0, 0], [0.015, 0], [0.069277, 0.9375], [0.25, 1], [1, 1]] },
        },
        opaque_linearize: { baseValue: 0.29 },
        radius_logarithmic: {
          baseValue: 0.92,
          inputs: {
            pressure: [[0, -0.7875], [0.237952, -0.6], [0.5, -0.15], [0.76506, 0.6], [1, 0.9]],
          },
        },
        hardness: { baseValue: 0.43 },
        dabs_per_basic_radius: { baseValue: 3.24 },
        dabs_per_actual_radius: { baseValue: 2 },
        dabs_per_second: { baseValue: 48.87 },
        slow_tracking_per_dab: {
          baseValue: 10,
          inputs: { speed1: [[0, -1.428571], [4, 10]], speed2: [[0, -1.428571], [4, 10]] },
        },
      },
      {
        // 2·(2+3.24) = 10.48 → spacing 0.0954; flow at ref 0.5 = (1.29 − 0.3214)·1 = 0.9686;
        // radius S-curve span exp(−0.7875 − 0.9) = 0.185 — the kabura pressure taper.
        spacingRatio: 0.0954, flow: 0.9686, hardness: 0.43, minSizeRatio: 0.185, sizeScale: 1,
        scatter: 0, scatterPressureResponse: 0, radiusJitter: 0,
        opaqueLinearize: 0.29, dabsPerPixel: 10.48,
      },
      "Speed-adaptive smoothing (slow_tracking_per_dab ← speed) is recorded, not executed; the ink kind's velocity thinning stands in for the pen's speed response.",
    ),
    preset(
      "watercolor-fringe",
      "MyPaint 오픈소스 · 수채 프린지",
      "brushes/deevad/large_watercolor_fringe.myb",
      "deevad",
      "watercolor",
      {
        opaque: { baseValue: 0.17146776406, inputs: { pressure: [[0, 0.81], [1, 0.81]] } },
        opaque_multiply: {
          baseValue: 0,
          inputs: { pressure: [[0, 0], [0.058642, 0.604167], [1, 1]] },
        },
        opaque_linearize: { baseValue: 0.9 },
        radius_logarithmic: { baseValue: 3.8000000000000007 },
        hardness: { baseValue: 0.9 },
        dabs_per_basic_radius: { baseValue: 4.39 },
        dabs_per_actual_radius: { baseValue: 6 },
        dabs_per_second: { baseValue: 6.99 },
        elliptical_dab_ratio: { baseValue: 10, inputs: { random: [[0, -1.9], [1, 1.9]] } },
        elliptical_dab_angle: { baseValue: 90, inputs: { random: [[0, -180], [1, 180]] } },
        smudge: { baseValue: 0.75 },
        smudge_length: { baseValue: 0.7 },
        smudge_radius_log: { baseValue: -0.8 },
        direction_filter: { baseValue: 1.68 },
      },
      {
        // 2·(6+4.39) = 20.78 → spacing 0.0481; flow (0.17146776406+0.81)·0.7898 = 0.7752,
        // linearized over dpp 18.8 → ≈0.076 per dab: the fringe wash saturation behavior.
        spacingRatio: 0.0481, flow: 0.7752, hardness: 0.9, minSizeRatio: 1, sizeScale: 1,
        scatter: 0.35, scatterPressureResponse: 0, radiusJitter: 0.5,
        opaqueLinearize: 0.9, dabsPerPixel: 20.78,
      },
      "The elliptical sliver fringe (ratio 10, random angle) and small-radius smudge are approximated by scatter 0.35 + radius jitter 0.5 on the watercolor wet-edge tip; verbatim values retained for a future elliptical-dab planner.",
    ),
    preset(
      "watercolor-expressive",
      "MyPaint 오픈소스 · 수채 익스프레시브",
      "brushes/deevad/watercolor_expressive.myb",
      "deevad",
      "watercolor",
      {
        opaque: { baseValue: 2, inputs: { random: [[0, 1], [1, 1]] } },
        opaque_multiply: {
          baseValue: 0,
          inputs: { pressure: [[0, 0], [0.040123, 0.885417], [0.138889, 1], [1, 1]] },
        },
        opaque_linearize: { baseValue: 0.9 },
        radius_logarithmic: {
          baseValue: 3.5,
          inputs: { pressure: [[0, -2.9], [1, 0.845833]] },
        },
        hardness: {
          baseValue: 0.23,
          inputs: { pressure: [[0, 0], [0.746914, 0], [0.884375, 0], [1, -0.032083]] },
        },
        dabs_per_basic_radius: { baseValue: 6 },
        dabs_per_actual_radius: { baseValue: 2 },
        offset_by_random: { baseValue: 0, inputs: { pressure: [[0, 0], [0.75, 0], [1, 0.8]] } },
        elliptical_dab_ratio: {
          baseValue: 4,
          inputs: { pressure: [[0, 0], [0.75, 0], [1, -2.7]], speed1: [[0, -0.37], [4, 0.37]] },
        },
        elliptical_dab_angle: { baseValue: 90, inputs: { random: [[0, -180], [1, 180]] } },
        smudge: {
          baseValue: 0.71,
          inputs: {
            pressure: [[0, -0.65], [0.5, -0.358854], [0.796875, -0.094792], [1, 0.24375]],
            speed1: [[0, -0.01], [4, 0.01]],
          },
        },
        smudge_length: { baseValue: 0.1 },
      },
      {
        // Signature: radius pressure span exp(−2.9 − 0.845833) = 0.0236 — hairline drips to fat
        // washes in one stroke. flow saturates at 1 (opaque 2 + constant random +1, clamped).
        spacingRatio: 0.0625, flow: 1, hardness: 0.23, minSizeRatio: 0.0236, sizeScale: 1,
        scatter: 0, scatterPressureResponse: 0.8, radiusJitter: 0,
        opaqueLinearize: 0.9, dabsPerPixel: 16,
      },
      "Canvas-color smudge 0.71 (the MyPaint wash pull) is not executed — translucency comes from the default lane opacity; offset curve gates at p>0.75 upstream, linear ramp here (approximation).",
    ),
    preset(
      "oil-paint",
      "MyPaint 오픈소스 · 오일 페인트",
      "brushes/tanda/oil-01-paint.myb",
      "tanda",
      "mypaint",
      {
        opaque: { baseValue: 1, inputs: { pressure: [[0, 0], [0.166667, 0.75], [1, 1]] } },
        opaque_multiply: {
          baseValue: 0,
          inputs: { pressure: [[0, 0], [0.067901, 0.78125], [0.185185, 1], [1, 1]] },
        },
        opaque_linearize: { baseValue: 0.9 },
        radius_logarithmic: {
          baseValue: 2,
          inputs: { pressure: [[0, -2.3], [0.398148, 0], [1, 0]] },
        },
        hardness: { baseValue: 0.8 },
        dabs_per_basic_radius: { baseValue: 6 },
        dabs_per_actual_radius: { baseValue: 6 },
        dabs_per_second: { baseValue: 80 },
        offset_by_random: { baseValue: 0.6 },
        elliptical_dab_ratio: { baseValue: 7.1, inputs: { stroke: [[0, -0.4], [1, 0.4]] } },
        elliptical_dab_angle: { baseValue: 0, inputs: { direction: [[0, 0], [180, 180]] } },
        smudge: {
          baseValue: 0.4,
          inputs: { pressure: [[0, 0], [1, -0.6]], stroke: [[0, 0], [0.5, 0], [1, 1]] },
        },
        smudge_length: { baseValue: 0, inputs: { stroke: [[0, 1], [1, -1]] } },
        tracking_noise: { baseValue: 0.2 },
      },
      {
        // 2·(6+6) = 24 → spacing 0.0417; radius span exp(−2.3) = 0.1003 (light graze = thin).
        spacingRatio: 0.0417, flow: 1, hardness: 0.8, minSizeRatio: 0.1003, sizeScale: 1,
        scatter: 0.6, scatterPressureResponse: 0, radiusJitter: 0,
        opaqueLinearize: 0.9, dabsPerPixel: 24,
      },
      "Direction-following elliptical bristle (angle ← stroke direction) and stroke-length smudge envelope are recorded, not executed.",
    ),
    preset(
      "pastel",
      "MyPaint 오픈소스 · 파스텔",
      "brushes/ramon/Pastel_1.myb",
      "ramon",
      "pastel",
      {
        opaque: { baseValue: 1 },
        opaque_multiply: {
          baseValue: 0.48,
          inputs: {
            pressure: [
              [0, -0.3125],
              [0.0701219512195122, -0.10416666666666674],
              [1, 1],
            ],
          },
        },
        opaque_linearize: { baseValue: 0.45 },
        radius_logarithmic: { baseValue: 0.71 },
        hardness: {
          baseValue: 0.8,
          inputs: {
            pressure: [
              [0, -0.666667],
              [0.426471, 0.052083],
              [0.755882, 0.072917],
              [0.844118, 0.947917],
              [1, 1],
            ],
          },
        },
        dabs_per_basic_radius: { baseValue: 3.54 },
        dabs_per_actual_radius: { baseValue: 3.57 },
        offset_by_random: {
          baseValue: 0,
          inputs: {
            pressure: [[0, 0], [0.435294, -0.041667], [0.753425, -0.6875], [1, 0]],
            speed1: [[0, -0.24285690000000001], [4, 1.7]],
            speed2: [[0, -0.24285690000000001], [4, 1.7]],
          },
        },
        radius_by_random: { baseValue: 1.08 },
        elliptical_dab_ratio: { baseValue: 1.48 },
        smudge: { baseValue: 0.1 },
      },
      {
        // 2·(3.57+3.54) = 14.22 → spacing 0.0703; flow 1·(0.48+0.407) = 0.887 at ref pressure.
        spacingRatio: 0.0703, flow: 0.887, hardness: 0.8, minSizeRatio: 1, sizeScale: 1,
        // offset_by_random is speed-driven upstream (up to 1.7 radii at high speed); the walker
        // has no speed state for scatter, so a mid-speed constant 0.35 stands in (approximation).
        scatter: 0.35, scatterPressureResponse: 0, radiusJitter: 1.08,
        opaqueLinearize: 0.45, dabsPerPixel: 14.22,
      },
      "Speed-driven scatter approximated by a mid-speed constant; hardness←pressure S-curve (soft graze → hard press) recorded, not executed.",
    ),
    preset(
      "calligraphy",
      "MyPaint 오픈소스 · 캘리그래피",
      "brushes/classic/calligraphy.myb",
      "classic",
      "ink",
      {
        opaque: { baseValue: 1 },
        opaque_multiply: {
          baseValue: 0,
          inputs: { pressure: [[0, 0], [0.015, 0], [0.015, 1], [1, 1]] },
        },
        radius_logarithmic: {
          baseValue: 2.02,
          inputs: { pressure: [[0, 0], [1, 0.5]], speed1: [[0, -0], [1, -0.12]] },
        },
        hardness: {
          baseValue: 0.74,
          inputs: { pressure: [[0, 0], [1, 0.05]], speed1: [[0, -0], [1, -0.04]] },
        },
        dabs_per_actual_radius: { baseValue: 2.2 },
        elliptical_dab_ratio: { baseValue: 5.46 },
        elliptical_dab_angle: { baseValue: 45.92 },
        direction_filter: { baseValue: 2 },
        anti_aliasing: { baseValue: 3.53 },
        offset_by_speed_slowness: { baseValue: 1 },
        smudge_length: { baseValue: 0.5 },
        slow_tracking: { baseValue: 0.65 },
        slow_tracking_per_dab: { baseValue: 0.8 },
      },
      {
        // 2·(2.2+0) = 4.4 dabs per diameter → spacing 0.2273; opaque 1 gated ON above p=0.015,
        // so effective opacity at the p=0.5 reference is 1·1 = 1.
        spacingRatio: 0.2273, flow: 1, hardness: 0.74, minSizeRatio: 0.6065, sizeScale: 1,
        scatter: 0, scatterPressureResponse: 0, radiusJitter: 0,
        opaqueLinearize: 0, dabsPerPixel: 4.4,
        ellipticalRatio: 5.46, ellipticalAngleDegrees: 45.92,
      },
      "elliptical_dab_ratio 5.46 / angle 45.92 is the flat nib and is NOT executed by the stamp walker — this import lands the wax/ink density and spacing, not the chisel geometry. direction_filter, speed1 envelopes, smudge_length and both slow_tracking settings are recorded verbatim and unexecuted.",
    ),
    preset(
      "marker-fat",
      "MyPaint 오픈소스 · 광폭 마커",
      "brushes/classic/marker_fat.myb",
      "classic",
      "ink",
      {
        opaque: { baseValue: 1 },
        opaque_multiply: {
          baseValue: 0,
          inputs: { pressure: [[0, 0], [0.060241, 1], [1, 1]] },
        },
        opaque_linearize: { baseValue: 0.9 },
        radius_logarithmic: {
          baseValue: 2.48,
          inputs: { tilt_declination: [[20, -0], [50, -0], [80, -1]] },
        },
        hardness: { baseValue: 1 },
        dabs_per_actual_radius: { baseValue: 2 },
        dabs_per_basic_radius: { baseValue: 1.5 },
        elliptical_dab_ratio: {
          baseValue: 10,
          inputs: { tilt_declination: [[0, -0], [68.042169, -9], [90, -9]] },
        },
        elliptical_dab_angle: {
          baseValue: 113.08,
          inputs: { tilt_ascension: [[-180, -180], [180, 180]] },
        },
        direction_filter: { baseValue: 2 },
        anti_aliasing: { baseValue: 0.78 },
        smudge_length: { baseValue: 0.5 },
        slow_tracking: { baseValue: 3 },
      },
      {
        // 2·(2+1.5) = 7 dabs per diameter → spacing 0.1429; hardness 1 and opaque 1 gated ON above
        // p=0.0602 give the flat, saturated marker bed. opaque_linearize 0.9 is the upstream value.
        spacingRatio: 0.1429, flow: 1, hardness: 1, minSizeRatio: 1, sizeScale: 1,
        scatter: 0, scatterPressureResponse: 0, radiusJitter: 0,
        opaqueLinearize: 0.9, dabsPerPixel: 7,
        ellipticalRatio: 10, ellipticalAngleDegrees: 113.08,
      },
      "The chisel is tilt-driven upstream (elliptical_dab_ratio 10 collapsing to -9 with declination, angle following ascension); the stamp walker executes neither tilt input nor elliptical dabs, so this import lands the dense saturated marker bed and its 0.9 linearization, not the chisel. minSizeRatio is 1 because the radius envelope is tilt-driven, not pressure-driven.",
    ),
    preset(
      "marker-small",
      "MyPaint 오픈소스 · 세필 마커",
      "brushes/classic/marker_small.myb",
      "classic",
      "ink",
      {
        opaque: { baseValue: 1 },
        opaque_multiply: { baseValue: 0, inputs: { pressure: [[0, 0], [0.060241, 1], [1, 1]] } },
        opaque_linearize: { baseValue: 0.9 },
        radius_logarithmic: { baseValue: 1, inputs: { tilt_declination: [[20, 0], [50, 0], [80, -0.8]] } },
        hardness: { baseValue: 0.8 },
        dabs_per_actual_radius: { baseValue: 2 },
        elliptical_dab_ratio: { baseValue: 8, inputs: { tilt_declination: [[0, 0], [68.042169, -9], [90, -9]] } },
        elliptical_dab_angle: { baseValue: 113.08, inputs: { tilt_ascension: [[-180, -180], [180, 180]] } },
        smudge_length: { baseValue: 0.5 },
        slow_tracking: { baseValue: 3 },
        speed1_slowness: { baseValue: 0.04 },
        stroke_duration_logarithmic: { baseValue: 4 },
      },
      {
        spacingRatio: 0.25, flow: 1.0, hardness: 0.8, minSizeRatio: 1.0, sizeScale: 1,
        scatter: 0, scatterPressureResponse: 0.0, radiusJitter: 0,
        opaqueLinearize: 0.9, dabsPerPixel: 4.0,
        ellipticalRatio: 8.0, ellipticalAngleDegrees: 113.08,
      },
      "Tilt-driven nib inputs are recorded and unexecuted; the declared elliptical ratio IS executed, so this reads as a narrower chisel than the fat marker.",
    ),
    preset(
      "slow-ink",
      "MyPaint 오픈소스 · 슬로우 잉크",
      "brushes/classic/slow_ink.myb",
      "classic",
      "ink",
      {
        opaque: { baseValue: 1 },
        opaque_multiply: { baseValue: 0, inputs: { pressure: [[0, 0], [0.191358, 0], [0.200617, 1], [1, 1]] } },
        opaque_linearize: { baseValue: 0.9 },
        radius_logarithmic: { baseValue: 1.37, inputs: { pressure: [[0, 0], [1, 0.5]], speed1: [[0, 0], [1, -0.16]] } },
        hardness: { baseValue: 0.8, inputs: { pressure: [[0, 0], [1, 0.06]], speed1: [[0, 0], [1, -0.08]] } },
        dabs_per_actual_radius: { baseValue: 2 },
        elliptical_dab_ratio: { baseValue: 1 },
        elliptical_dab_angle: { baseValue: 90 },
        smudge_length: { baseValue: 0.5 },
        slow_tracking: { baseValue: 8.64 },
        speed1_slowness: { baseValue: 0.11 },
        stroke_duration_logarithmic: { baseValue: 4 },
      },
      {
        spacingRatio: 0.25, flow: 1.0, hardness: 0.8, minSizeRatio: 0.6065, sizeScale: 1,
        scatter: 0, scatterPressureResponse: 0.0, radiusJitter: 0,
        opaqueLinearize: 0.9, dabsPerPixel: 4.0,
      },
      "slow_tracking is recorded but the distance walker has no time term; spacing and flow carry the deposit.",
    ),
    preset(
      "knife",
      "MyPaint 오픈소스 · 나이프",
      "brushes/classic/knife.myb",
      "classic",
      // Stays on "ink" — the flat, hard-edged tip — deliberately. This preset measures only 5
      // interior tones at sd 0.073 from 1185 dabs, and both of this repo's classifications file it
      // as `paint-oil`, so it was moved to the softer "mypaint" tip its oil sibling uses and
      // re-measured: 92 tones, sd 20.8. Rendered, that is a soft graded ribbon, which is further
      // from a palette knife than the flat slab it replaced — and `elliptical_dab_ratio` 6.52 with
      // `hardness` 0.8 says upstream means a flat HARD nib. What this preset is actually missing is
      // paint body (ridge/impasto relief), not a softer dab, so the change was backed out rather
      // than kept for the metric.
      "ink",
      {
        opaque: { baseValue: 1 },
        opaque_multiply: { baseValue: 0, inputs: { pressure: [[0, 0], [1, 1]] } },
        opaque_linearize: { baseValue: 0.9 },
        radius_logarithmic: { baseValue: 2.9 },
        hardness: { baseValue: 0.8 },
        dabs_per_actual_radius: { baseValue: 5.75 },
        elliptical_dab_ratio: { baseValue: 6.52 },
        elliptical_dab_angle: { baseValue: 90, inputs: { direction: [[0, 0], [180, 180]] } },
        smudge_length: { baseValue: 0.26 },
        speed1_slowness: { baseValue: 0.04 },
        stroke_duration_logarithmic: { baseValue: 4 },
      },
      {
        spacingRatio: 0.087, flow: 0.5, hardness: 0.8, minSizeRatio: 1.0, sizeScale: 1,
        scatter: 0, scatterPressureResponse: 0.0, radiusJitter: 0,
        opaqueLinearize: 0.9, dabsPerPixel: 11.5,
        ellipticalRatio: 6.52, ellipticalAngleDegrees: 90.0,
        reliefBody: true,
      },
      "smudge/colour pickup is recorded and unexecuted (the stamp walker deposits stroke colour); the flat blade geometry IS executed.",
    ),
    preset(
      "spray",
      "MyPaint 오픈소스 · 스프레이",
      "brushes/deevad/spray.myb",
      "deevad",
      "airbrush",
      {
        opaque: { baseValue: 1, inputs: { stroke: [[0, 0], [0.62963, 0], [1, -1]] } },
        opaque_multiply: { baseValue: 0, inputs: { pressure: [[0, 0], [1, 1]] } },
        opaque_linearize: { baseValue: 0 },
        radius_logarithmic: {
          baseValue: 2.19,
          inputs: { stroke: [[0, 0], [0.54321, -1.82], [1, 0]] },
        },
        hardness: { baseValue: 0.43 },
        dabs_per_basic_radius: { baseValue: 3.92 },
        dabs_per_actual_radius: { baseValue: 0.95 },
        dabs_per_second: { baseValue: 74.55 },
        offset_by_random: { baseValue: 2 },
        radius_by_random: { baseValue: 0.28 },
        tracking_noise: { baseValue: 1.36 },
        slow_tracking: { baseValue: 0.83 },
      },
      {
        // 2·(0.95+3.92) = 9.74 → spacing 0.1027; flow 1·0.5 = 0.5.
        spacingRatio: 0.1027, flow: 0.5, hardness: 0.43, minSizeRatio: 1, sizeScale: 1,
        scatter: 2, scatterPressureResponse: 0, radiusJitter: 0.28,
        opaqueLinearize: 0, dabsPerPixel: 9.74,
      },
      "Stroke-length fade-out envelope (opaque/radius ← stroke) is recorded, not executed.",
    ),
  ]);

const PRESET_BY_BRUSH_ID: ReadonlyMap<string, StudioCc0MypaintPresetImport> = new Map(
  STUDIO_CC0_MYPAINT_PRESET_IMPORTS.map((entry) => [entry.brushId, entry]),
);

export function listStudioCc0MypaintPresetImports(): readonly StudioCc0MypaintPresetImport[] {
  return STUDIO_CC0_MYPAINT_PRESET_IMPORTS;
}

/**
 * True only for brush ids of REGISTERED cc0 presets. An unknown `mypaint-cc0--*` suffix returns
 * false, so the stamp engine refuses the lane instead of guessing a renderer (fail-closed).
 */
export function isStudioCc0MypaintPresetBrushId(brushId: string | null | undefined): boolean {
  return typeof brushId === "string" && PRESET_BY_BRUSH_ID.has(brushId);
}

export function resolveStudioCc0MypaintPresetImport(
  brushId: string | null | undefined,
): StudioCc0MypaintPresetImport | null {
  if (!brushId) return null;
  return PRESET_BY_BRUSH_ID.get(brushId) ?? null;
}

/**
 * Spacing — not scatter — is what breaks a continuous bed. Charcoal and spray displace their dabs
 * by one to two diameters yet still cover the path because they place one every tenth of a
 * diameter; only a preset whose neighbouring dabs cannot touch skips ground (the imported
 * splatter sits at 4 diameters, every other import at or below 0.16).
 */
const DISCRETE_SPACING_RATIO = 1;

/**
 * True when an imported preset deposits intentionally separated marks rather than a continuous
 * carrier — derived from the upstream `dabs_per_basic_radius` itself, never from a hand-kept id
 * list. Splatter-class presets are faithful to their CC0 source precisely because they skip
 * ground between marks, so coverage gates record their density instead of demanding an unbroken
 * line; every denser import keeps the ordinary continuity requirement.
 */
export function studioCc0MypaintPresetUsesIntentionalDiscreteCarrier(
  brushId: string | null | undefined,
): boolean {
  const preset = resolveStudioCc0MypaintPresetImport(brushId);
  return preset !== null && preset.mapped.spacingRatio >= DISCRETE_SPACING_RATIO;
}

/** Stamp kind for a registered cc0 preset id; null for everything else (incl. unknown suffixes). */
export function resolveStudioCc0MypaintStampBrushKind(
  brushId: string | null | undefined,
): StudioCc0MypaintStampKind | null {
  return resolveStudioCc0MypaintPresetImport(brushId)?.kind ?? null;
}

export function resolveStudioCc0MypaintStampTuning(
  brushId: string | null | undefined,
): StudioCc0MypaintStampTuning | null {
  return resolveStudioCc0MypaintPresetImport(brushId)?.mapped ?? null;
}
