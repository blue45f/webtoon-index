/**
 * Pressure response curve graph — CSP/Procreate-class transfer curve math.
 * Pure functions only: maps input pressure → output size/opacity factor via exponent.
 * Not a brand clone of any vendor graph editor.
 */

const EXP_MIN = 0.35;
const EXP_MAX = 2.5;
const PRESSURE_EPSILON = 0.001;

export const STUDIO_PRESSURE_CURVE_HANDLE_INPUT = 0.5;
export const STUDIO_PRESSURE_CALIBRATION_MIN_SAMPLES = 8;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function clampStudioPressureCurveExponent(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 1;
  return Math.min(EXP_MAX, Math.max(EXP_MIN, n));
}

/** Same power curve as resolveBrushPressureSample (studio-brush). */
export function studioPressureCurveMap(input01: number, exponent: number): number {
  const x = Math.min(1, Math.max(0, input01));
  const e = clampStudioPressureCurveExponent(exponent);
  return Math.min(1, Math.max(0, Math.pow(x, e)));
}

export type StudioPressureCurvePoint = { x: number; y: number };

/** Chart samples in unit square (0,0 bottom-left → 1,1 top-right of input/output). */
export function studioPressureCurveGraphPoints(
  exponent: number,
  samples = 24
): StudioPressureCurvePoint[] {
  const n = Math.max(2, Math.min(64, Math.floor(samples)));
  const e = clampStudioPressureCurveExponent(exponent);
  const out: StudioPressureCurvePoint[] = [];
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    out.push({ x, y: studioPressureCurveMap(x, e) });
  }
  return out;
}

/**
 * SVG path for a viewBox chart: origin top-left, y grows down.
 * Unit curve is flipped so output rises toward top of chart.
 */
export function studioPressureCurvePathD(
  exponent: number,
  width: number,
  height: number,
  samples = 24
): string {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const pts = studioPressureCurveGraphPoints(exponent, samples);
  return pts
    .map((p, i) => {
      const sx = p.x * w;
      const sy = (1 - p.y) * h;
      return `${i === 0 ? "M" : "L"}${sx.toFixed(2)} ${sy.toFixed(2)}`;
    })
    .join(" ");
}

export function studioPressureCurveSliderMeta(exponent: number): {
  min: number;
  max: number;
  step: number;
  value: number;
  percent: number;
} {
  const value = clampStudioPressureCurveExponent(exponent);
  return {
    min: EXP_MIN,
    max: EXP_MAX,
    step: 0.05,
    value,
    percent: Math.round(((value - EXP_MIN) / (EXP_MAX - EXP_MIN)) * 100),
  };
}

/** One direct-manipulation handle keeps the legacy scalar exponent fully compatible. */
export function studioPressureCurveHandlePoint(
  exponent: number,
  input01 = STUDIO_PRESSURE_CURVE_HANDLE_INPUT
): StudioPressureCurvePoint {
  const x = clamp(input01, 0.1, 0.9);
  return { x, y: studioPressureCurveMap(x, exponent) };
}

/** Convert a graph point back to the scalar exponent used by existing brush documents. */
export function studioPressureCurveExponentForPoint(
  input01: number,
  output01: number
): number {
  const x = clamp(input01, 0.1, 0.9);
  const y = clamp(output01, PRESSURE_EPSILON, 1 - PRESSURE_EPSILON);
  return clampStudioPressureCurveExponent(Math.log(y) / Math.log(x));
}

export interface StudioPressureCalibrationStats {
  readonly sampleCount: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly median: number;
  readonly p90: number;
  readonly dynamicRange: number;
}

function percentile(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  const position = clamp01(ratio) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  const a = sorted[lower] ?? 0;
  const b = sorted[upper] ?? a;
  return a + (b - a) * weight;
}

/** Zero/release sentinels are excluded so they cannot bias a physical-contact calibration. */
export function studioPressureCalibrationStats(
  samples: readonly number[]
): StudioPressureCalibrationStats | null {
  const normalized = samples
    .filter((sample) => Number.isFinite(sample) && sample > PRESSURE_EPSILON)
    .map(clamp01)
    .sort((a, b) => a - b);
  if (normalized.length === 0) return null;
  const minimum = normalized[0] ?? 0;
  const maximum = normalized.at(-1) ?? minimum;
  return Object.freeze({
    sampleCount: normalized.length,
    minimum,
    maximum,
    median: percentile(normalized, 0.5),
    p90: percentile(normalized, 0.9),
    dynamicRange: maximum - minimum,
  });
}

/**
 * Recommend an exponent that maps the observed median contact to a balanced 50% output.
 * Constant-pressure mouse streams are deliberately rejected rather than pretending to calibrate.
 */
export function recommendStudioPressureCurveExponent(
  samples: readonly number[],
  targetMedianOutput = 0.5
): number | null {
  const stats = studioPressureCalibrationStats(samples);
  if (
    !stats
    || stats.sampleCount < STUDIO_PRESSURE_CALIBRATION_MIN_SAMPLES
    || stats.dynamicRange < 0.08
  ) {
    return null;
  }
  return studioPressureCurveExponentForPoint(stats.median, targetMedianOutput);
}

/** Diameter used only by the pressure test pad; production ink keeps its existing authority. */
export function studioPressurePreviewDiameter(
  rawPressure: number,
  exponent: number,
  minimumSizeRatio = 0,
  maximumDiameter = 18
): number {
  const floor = clamp01(minimumSizeRatio);
  const mapped = studioPressureCurveMap(rawPressure, exponent);
  const diameter = Math.max(1, maximumDiameter);
  return diameter * (floor + (1 - floor) * mapped);
}
