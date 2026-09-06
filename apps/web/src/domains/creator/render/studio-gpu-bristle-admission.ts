/**
 * studio-gpu-bristle runtime admission — the picture proof, not a liveness check.
 *
 * Modelled on `proveWatercolourResolve` (`studio-living-ink-webgpu-pure-runtime.ts:118-134`) and
 * on the lesson recorded in that file's header at `:9-16`: a liveness-only gate once admitted a
 * resolve that drew ink roughly thirty times too faint. A pipeline that compiles, a device that
 * survives, and a canvas that is not blank are all necessary and none of them is sufficient.
 *
 * Four thresholds must clear on the artist's own device before the lane is allowed to paint:
 *   1. paper luminance stddev  — the r8 grain survived the resolve rather than being averaged flat;
 *   2. probe stroke darkness   — catches the zero-pixel / flat-stroke trap;
 *   3. untouched-region stddev — nothing bled outside the probe stroke;
 *   4. normal-map ridge contrast — NEW for this lane, and the only check that catches NORMAL_SCALE
 *      collapsing so the impasto reads flat while every other number stays green.
 *
 * This module is deliberately shader-free and GPU-free: it is a pure function over sampled pixel
 * statistics, so the Node suite can exercise every verdict and the browser verifier can run the
 * identical arithmetic on real readback.
 */

export const STUDIO_GPU_BRISTLE_ADMISSION_VERSION =
  "studio-gpu-bristle-admission-v1" as const;

/**
 * Thresholds. Chosen against the same reasoning as the living-ink admission: each one is far
 * enough from a correct resolve's value that noise cannot trip it, and close enough that the
 * specific defect it targets cannot pass.
 */
export const STUDIO_GPU_BRISTLE_ADMISSION_THRESHOLDS = Object.freeze({
  /** 0-255 luminance stddev over the papered, unpainted region. A flat fill scores ~0. */
  minPaperLuminanceStdDev: 1,
  /** 0-255 mean darkening under the probe stroke versus the paper mean. */
  minProbeStrokeDarkness: 6,
  /** 0-255 luminance stddev far outside the probe stroke. Bleed or garbage raises it. */
  maxUntouchedStdDev: 0.5,
  /** 0-255 luminance floor far outside the probe stroke — the surface must stay near-white. */
  minUntouchedLuminance: 254.5,
  /**
   * Ratio between the brightest and darkest flank of a synthetic ridge under the impasto resolve.
   * A flat (NORMAL_SCALE-collapsed) relief scores 1.0 exactly; the shaded ridge is well above it.
   */
  minNormalRidgeContrast: 1.08,
});

/** Product floor. Below this the already-selected GPU lane rejects the stroke. */
export const STUDIO_GPU_BRISTLE_SURFACE_LIMITS = Object.freeze({
  minShortEdgePx: 32,
  maxSurfacePixels: 4_000_000,
  maxEdgePx: 8192,
});

export type StudioGpuBristleAdmissionReason =
  | "paper-grain-flat"
  | "probe-stroke-too-faint"
  | "untouched-region-contaminated"
  | "untouched-region-darkened"
  | "impasto-relief-flat"
  | "probe-statistics-invalid";

export interface StudioGpuBristleAdmissionSamples {
  readonly paperLuminanceStdDev: number;
  readonly probeStrokeDarkness: number;
  readonly untouchedLuminanceStdDev: number;
  readonly untouchedLuminance: number;
  readonly normalRidgeContrast: number;
}

export interface StudioGpuBristleAdmissionVerdict {
  readonly admitted: boolean;
  readonly version: typeof STUDIO_GPU_BRISTLE_ADMISSION_VERSION;
  readonly reasons: readonly StudioGpuBristleAdmissionReason[];
  readonly samples: StudioGpuBristleAdmissionSamples;
  /** User-facing Korean copy; empty when admitted. */
  readonly message: string;
}

const REASON_MESSAGES_KO: Readonly<
  Record<StudioGpuBristleAdmissionReason, string>
> = Object.freeze({
  "paper-grain-flat": "종이 결이 사라져 GPU 강모 레인을 쓰지 않습니다.",
  "probe-stroke-too-faint": "시험 획이 너무 흐려 GPU 강모 레인을 쓰지 않습니다.",
  "untouched-region-contaminated": "획 바깥이 번져 GPU 강모 레인을 쓰지 않습니다.",
  "untouched-region-darkened": "빈 영역이 어두워져 GPU 강모 레인을 쓰지 않습니다.",
  "impasto-relief-flat": "임파스토 요철이 평평해 GPU 강모 레인을 쓰지 않습니다.",
  "probe-statistics-invalid": "GPU 강모 레인 검증값을 읽지 못했습니다.",
});

const UNAVAILABLE_SUFFIX_KO =
  " 현재 획을 다른 엔진으로 자동 전환하지 않습니다. 다음 획에서 다른 엔진을 명시적으로 선택해 주세요.";

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Evaluate one device's probe. Admission is all-or-nothing: any failed threshold makes this
 * selected lane unavailable for the device epoch. It never authorizes a CPU carrier for the same
 * stroke.
 */
export function proveStudioGpuBristleAdmission(
  samples: StudioGpuBristleAdmissionSamples,
  thresholds: typeof STUDIO_GPU_BRISTLE_ADMISSION_THRESHOLDS =
    STUDIO_GPU_BRISTLE_ADMISSION_THRESHOLDS,
): StudioGpuBristleAdmissionVerdict {
  const normalized: StudioGpuBristleAdmissionSamples = {
    paperLuminanceStdDev: finite(samples?.paperLuminanceStdDev)
      ? samples.paperLuminanceStdDev
      : Number.NaN,
    probeStrokeDarkness: finite(samples?.probeStrokeDarkness)
      ? samples.probeStrokeDarkness
      : Number.NaN,
    untouchedLuminanceStdDev: finite(samples?.untouchedLuminanceStdDev)
      ? samples.untouchedLuminanceStdDev
      : Number.NaN,
    untouchedLuminance: finite(samples?.untouchedLuminance)
      ? samples.untouchedLuminance
      : Number.NaN,
    normalRidgeContrast: finite(samples?.normalRidgeContrast)
      ? samples.normalRidgeContrast
      : Number.NaN,
  };

  const reasons: StudioGpuBristleAdmissionReason[] = [];
  if (Object.values(normalized).some((value) => !Number.isFinite(value))) {
    reasons.push("probe-statistics-invalid");
  } else {
    if (normalized.paperLuminanceStdDev < thresholds.minPaperLuminanceStdDev) {
      reasons.push("paper-grain-flat");
    }
    if (normalized.probeStrokeDarkness < thresholds.minProbeStrokeDarkness) {
      reasons.push("probe-stroke-too-faint");
    }
    if (normalized.untouchedLuminanceStdDev > thresholds.maxUntouchedStdDev) {
      reasons.push("untouched-region-contaminated");
    }
    if (normalized.untouchedLuminance < thresholds.minUntouchedLuminance) {
      reasons.push("untouched-region-darkened");
    }
    if (normalized.normalRidgeContrast < thresholds.minNormalRidgeContrast) {
      reasons.push("impasto-relief-flat");
    }
  }

  const admitted = reasons.length === 0;
  return Object.freeze({
    admitted,
    version: STUDIO_GPU_BRISTLE_ADMISSION_VERSION,
    reasons: Object.freeze(reasons),
    samples: Object.freeze(normalized),
    message: admitted
      ? ""
      : `${REASON_MESSAGES_KO[reasons[0]!]}${UNAVAILABLE_SUFFIX_KO}`,
  });
}

export type StudioGpuBristleSurfaceRejection =
  | "surface-too-small"
  | "surface-too-large"
  | "surface-invalid";

export interface StudioGpuBristleSurfaceVerdict {
  readonly accepted: boolean;
  readonly reason: StudioGpuBristleSurfaceRejection | null;
  readonly message: string;
}

const SURFACE_MESSAGES_KO: Readonly<
  Record<StudioGpuBristleSurfaceRejection, string>
> = Object.freeze({
  "surface-too-small": "획 영역이 너무 작아 GPU 강모 레인을 쓰지 않습니다.",
  "surface-too-large": "캔버스가 너무 커서 GPU 강모 레인을 쓸 수 없습니다.",
  "surface-invalid": "획 영역을 계산하지 못해 GPU 강모 레인을 쓰지 않습니다.",
});

/**
 * Per-stroke surface floor and ceiling, mirroring `studio-living-ink-product-policy.ts:44-61`:
 * a refusal is a Korean sentence and a terminal result for this selected stroke. Another
 * vector/ribbon provider may be selected only before a later stroke begins.
 */
export function acceptStudioGpuBristleSurface(
  widthPx: number,
  heightPx: number,
  limits: typeof STUDIO_GPU_BRISTLE_SURFACE_LIMITS = STUDIO_GPU_BRISTLE_SURFACE_LIMITS,
): StudioGpuBristleSurfaceVerdict {
  const valid =
    finite(widthPx) && finite(heightPx) && widthPx > 0 && heightPx > 0;
  if (!valid) {
    return Object.freeze({
      accepted: false,
      reason: "surface-invalid" as const,
      message: `${SURFACE_MESSAGES_KO["surface-invalid"]}${UNAVAILABLE_SUFFIX_KO}`,
    });
  }
  const width = Math.ceil(widthPx);
  const height = Math.ceil(heightPx);
  if (Math.min(width, height) < limits.minShortEdgePx) {
    return Object.freeze({
      accepted: false,
      reason: "surface-too-small" as const,
      message: `${SURFACE_MESSAGES_KO["surface-too-small"]}${UNAVAILABLE_SUFFIX_KO}`,
    });
  }
  if (
    width > limits.maxEdgePx
    || height > limits.maxEdgePx
    || width * height > limits.maxSurfacePixels
  ) {
    return Object.freeze({
      accepted: false,
      reason: "surface-too-large" as const,
      message: `${SURFACE_MESSAGES_KO["surface-too-large"]}${UNAVAILABLE_SUFFIX_KO}`,
    });
  }
  return Object.freeze({ accepted: true, reason: null, message: "" });
}

// ---------------------------------------------------------------------------
// Probe statistics. Shared by the worker's admission run and the browser verifier so both sides
// compute the identical number from the identical pixels.
// ---------------------------------------------------------------------------

export interface StudioGpuBristleProbeRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface LuminanceAccumulator {
  count: number;
  sum: number;
  sumSquares: number;
}

/** Rec. 709 luminance over straight (non-premultiplied) RGBA8 composited onto white paper. */
function accumulate(
  rgba: Uint8Array | Uint8ClampedArray,
  surfaceWidth: number,
  surfaceHeight: number,
  region: StudioGpuBristleProbeRegion,
  accumulator: LuminanceAccumulator,
): void {
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(surfaceWidth, Math.ceil(region.x + region.width));
  const y1 = Math.min(surfaceHeight, Math.ceil(region.y + region.height));
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * surfaceWidth + x) * 4;
      const r = rgba[offset] ?? 0;
      const g = rgba[offset + 1] ?? 0;
      const b = rgba[offset + 2] ?? 0;
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      accumulator.count += 1;
      accumulator.sum += luminance;
      accumulator.sumSquares += luminance * luminance;
    }
  }
}

export interface StudioGpuBristleLuminanceStats {
  readonly count: number;
  readonly mean: number;
  readonly stdDev: number;
}

export function measureStudioGpuBristleLuminance(
  rgba: Uint8Array | Uint8ClampedArray,
  surfaceWidth: number,
  surfaceHeight: number,
  region: StudioGpuBristleProbeRegion,
): StudioGpuBristleLuminanceStats {
  const accumulator: LuminanceAccumulator = { count: 0, sum: 0, sumSquares: 0 };
  if (
    !finite(surfaceWidth)
    || !finite(surfaceHeight)
    || surfaceWidth <= 0
    || surfaceHeight <= 0
    || rgba.length < surfaceWidth * surfaceHeight * 4
  ) {
    return Object.freeze({ count: 0, mean: Number.NaN, stdDev: Number.NaN });
  }
  accumulate(rgba, surfaceWidth, surfaceHeight, region, accumulator);
  if (accumulator.count === 0) {
    return Object.freeze({ count: 0, mean: Number.NaN, stdDev: Number.NaN });
  }
  const mean = accumulator.sum / accumulator.count;
  const variance = Math.max(
    0,
    accumulator.sumSquares / accumulator.count - mean * mean,
  );
  return Object.freeze({
    count: accumulator.count,
    mean,
    stdDev: Math.sqrt(variance),
  });
}

/**
 * Geometry of the standard probe: a horizontal drag across the middle of a small surface. Declared
 * here rather than in the worker so the worker's admission run and the browser parity verifier
 * sample the identical rectangles.
 */
export const STUDIO_GPU_BRISTLE_PROBE = Object.freeze({
  width: 96,
  height: 64,
  strokeStartX: 12,
  strokeStations: 48,
  strokePressure: 0.85,
  baseRadiusPx: 9,
  bristleCount: 24,
  seed: 20260821,
});

/**
 * Turn one probe readback into the four admission statistics. The stroke's own two flanks are the
 * ridge: the impasto resolve must light the upper edge and shade the lower one, and a collapsed
 * NORMAL_SCALE makes them identical.
 */
export function evaluateStudioGpuBristleProbe(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number = STUDIO_GPU_BRISTLE_PROBE.width,
  height: number = STUDIO_GPU_BRISTLE_PROBE.height,
): StudioGpuBristleAdmissionSamples {
  const midY = Math.round(height / 2);
  const paper = measureStudioGpuBristleLuminance(rgba, width, height, {
    x: STUDIO_GPU_BRISTLE_PROBE.strokeStartX,
    y: midY - 10,
    width: STUDIO_GPU_BRISTLE_PROBE.strokeStations,
    height: 4,
  });
  const stroke = measureStudioGpuBristleLuminance(rgba, width, height, {
    x: STUDIO_GPU_BRISTLE_PROBE.strokeStartX + 8,
    y: midY - 2,
    width: STUDIO_GPU_BRISTLE_PROBE.strokeStations - 16,
    height: 5,
  });
  const untouched = measureStudioGpuBristleLuminance(rgba, width, height, {
    x: width - 8,
    y: 0,
    width: 8,
    height: 8,
  });
  const ridge = measureStudioGpuBristleRidgeContrast(
    rgba,
    width,
    height,
    {
      x: STUDIO_GPU_BRISTLE_PROBE.strokeStartX + 8,
      y: midY - 4,
      width: STUDIO_GPU_BRISTLE_PROBE.strokeStations - 16,
      height: 2,
    },
    {
      x: STUDIO_GPU_BRISTLE_PROBE.strokeStartX + 8,
      y: midY + 2,
      width: STUDIO_GPU_BRISTLE_PROBE.strokeStations - 16,
      height: 2,
    },
  );
  return Object.freeze({
    paperLuminanceStdDev: paper.stdDev,
    probeStrokeDarkness: paper.mean - stroke.mean,
    untouchedLuminanceStdDev: untouched.stdDev,
    untouchedLuminance: untouched.mean,
    normalRidgeContrast: ridge,
  });
}

/**
 * Ridge contrast: the impasto resolve must light one flank of a synthetic ridge and shade the
 * other. A collapsed NORMAL_SCALE returns exactly 1. Both flanks are measured from the same
 * readback so the paper and pigment terms cancel.
 */
export function measureStudioGpuBristleRidgeContrast(
  rgba: Uint8Array | Uint8ClampedArray,
  surfaceWidth: number,
  surfaceHeight: number,
  litFlank: StudioGpuBristleProbeRegion,
  shadedFlank: StudioGpuBristleProbeRegion,
): number {
  const lit = measureStudioGpuBristleLuminance(
    rgba,
    surfaceWidth,
    surfaceHeight,
    litFlank,
  );
  const shaded = measureStudioGpuBristleLuminance(
    rgba,
    surfaceWidth,
    surfaceHeight,
    shadedFlank,
  );
  if (!finite(lit.mean) || !finite(shaded.mean)) return Number.NaN;
  const brighter = Math.max(lit.mean, shaded.mean);
  const darker = Math.min(lit.mean, shaded.mean);
  if (darker <= 0) return Number.NaN;
  return brighter / darker;
}
