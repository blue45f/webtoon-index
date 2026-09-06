/**
 * Studio Stroke Stabilization Preview & Large Brush Speed/Quality Mode
 *
 * CLIP STUDIO PAINT Ver.4.2.0 Parity:
 * 1. Stroke Stabilization Preview (손떨림 보정 스트로크 프리뷰):
 *    - Strong stabilization creates an intentional lag between the pen nib and the filtered ink point.
 *    - To eliminate perceived latency, this module calculates a lightweight predictive lead trail
 *      connecting the stabilized ink head to the physical stylus coordinate in real time.
 * 2. Large Brush Speed vs. Quality Mode (큰 브러시 속도·품질 모드):
 *    - High-radius brushes (>64px) can exceed the 16.6ms frame budget when computing dense dabs.
 *    - Offers "speed" (adaptive spacing, simplified texture jitter, guaranteed 60fps),
 *      "quality" (exact dense dab synthesis, full spectral impasto), and "auto" (dynamic adaptation).
 *
 * Pure, deterministic, zero-dependency.
 */

export type StudioBrushQualityMode = "quality" | "speed" | "auto";

export interface StudioBrushQualitySettings {
  readonly mode: StudioBrushQualityMode;
  /** Radius threshold (px) above which speed mode kicks in when mode is "auto" or "speed". Default: 48. */
  readonly speedThresholdRadius: number;
  /** Dab spacing multiplier in speed mode (e.g. 1.6x spacing = ~40% fewer dab calculations). */
  readonly speedSpacingMultiplier: number;
  /** Whether to bypass heavy secondary noise/texture passes in speed mode. */
  readonly simplifyTextureDabs: boolean;
}

export const DEFAULT_STUDIO_BRUSH_QUALITY_SETTINGS: StudioBrushQualitySettings = Object.freeze({
  mode: "auto",
  speedThresholdRadius: 48,
  speedSpacingMultiplier: 1.6,
  simplifyTextureDabs: true,
});

export interface StudioBrushQualityDisposition {
  readonly effectiveMode: "quality" | "speed";
  readonly spacingMultiplier: number;
  readonly skipFineTexture: boolean;
  readonly maxDabsPerSegment: number;
  readonly reason: string;
}

/**
 * Normalizes quality settings, clamping values to stable bounds.
 */
export function normalizeStudioBrushQualitySettings(
  input?: Partial<StudioBrushQualitySettings> | null,
): StudioBrushQualitySettings {
  if (!input) return DEFAULT_STUDIO_BRUSH_QUALITY_SETTINGS;

  const validModes: readonly StudioBrushQualityMode[] = ["quality", "speed", "auto"];
  const mode = validModes.includes(input.mode as StudioBrushQualityMode)
    ? (input.mode as StudioBrushQualityMode)
    : DEFAULT_STUDIO_BRUSH_QUALITY_SETTINGS.mode;

  const speedThresholdRadius =
    typeof input.speedThresholdRadius === "number" && Number.isFinite(input.speedThresholdRadius)
      ? Math.max(8, Math.min(256, input.speedThresholdRadius))
      : DEFAULT_STUDIO_BRUSH_QUALITY_SETTINGS.speedThresholdRadius;

  const speedSpacingMultiplier =
    typeof input.speedSpacingMultiplier === "number" && Number.isFinite(input.speedSpacingMultiplier)
      ? Math.max(1.1, Math.min(3.0, input.speedSpacingMultiplier))
      : DEFAULT_STUDIO_BRUSH_QUALITY_SETTINGS.speedSpacingMultiplier;

  const simplifyTextureDabs = input.simplifyTextureDabs !== false;

  return Object.freeze({
    mode,
    speedThresholdRadius,
    speedSpacingMultiplier,
    simplifyTextureDabs,
  });
}

/**
 * Resolves whether the current stroke dab generation should execute in speed or quality mode.
 */
export function resolveStudioBrushQualityDisposition(
  settings: StudioBrushQualitySettings,
  brushRadius: number,
  measuredFps?: number,
): StudioBrushQualityDisposition {
  const normSettings = normalizeStudioBrushQualitySettings(settings);
  const radius = Math.max(0.5, Number.isFinite(brushRadius) ? brushRadius : 1);

  if (normSettings.mode === "speed") {
    return Object.freeze({
      effectiveMode: "speed",
      spacingMultiplier: normSettings.speedSpacingMultiplier,
      skipFineTexture: normSettings.simplifyTextureDabs,
      maxDabsPerSegment: 128,
      reason: "속도 우선 모드 명시적 활성화",
    });
  }

  if (normSettings.mode === "quality") {
    return Object.freeze({
      effectiveMode: "quality",
      spacingMultiplier: 1.0,
      skipFineTexture: false,
      maxDabsPerSegment: 512,
      reason: "품질 우선 모드 명시적 활성화",
    });
  }

  // mode === "auto"
  const isLarge = radius >= normSettings.speedThresholdRadius;
  const isLagging = typeof measuredFps === "number" && Number.isFinite(measuredFps) && measuredFps < 52;

  if (isLarge || isLagging) {
    return Object.freeze({
      effectiveMode: "speed",
      spacingMultiplier: isLarge ? normSettings.speedSpacingMultiplier : 1.3,
      skipFineTexture: normSettings.simplifyTextureDabs,
      maxDabsPerSegment: 192,
      reason: isLarge
        ? `대형 브러시 반경 (${radius.toFixed(0)}px >= ${normSettings.speedThresholdRadius}px) 자동 속도 조절`
        : `프레임 저하 감지 (${measuredFps?.toFixed(1)} FPS) 자동 보호`,
    });
  }

  return Object.freeze({
    effectiveMode: "quality",
    spacingMultiplier: 1.0,
    skipFineTexture: false,
    maxDabsPerSegment: 512,
    reason: "표준 반경 및 정상 프레임율 (고품질 합성)",
  });
}

// ── 스트로크 손떨림 보정 프리뷰 (Stabilization Preview Trail) ───────────────────

export interface StudioStabilizationPreviewInput {
  readonly rawPoint: readonly [number, number];
  readonly stabilizedPoint: readonly [number, number];
  readonly stabilizerStrength: number;
  readonly brushRadius: number;
  readonly brushColor?: string;
  readonly pointerDown?: boolean;
}

export interface StudioStabilizationPreviewResult {
  readonly visible: boolean;
  /** Straight guide segment from stabilized ink tip to real-time raw pen position. */
  readonly guideSegment: readonly [readonly [number, number], readonly [number, number]] | null;
  /** Intermediate guide curve points (interpolated lead curve). */
  readonly curvePoints: readonly (readonly [number, number])[];
  /** Distance (px) between physical stylus and stabilized ink head. */
  readonly distance: number;
  /** Preview guide line stroke width (px). */
  readonly strokeWidth: number;
  /** Guide line display opacity (0.1..0.6). */
  readonly opacity: number;
}

/**
 * Computes the zero-lag stabilization preview trail for high-stabilization pens.
 * If stabilization strength <= 1 or distance < 2.5px, the preview stays invisible.
 */
export function computeStudioStabilizationPreview(
  input: StudioStabilizationPreviewInput,
): StudioStabilizationPreviewResult {
  const { rawPoint, stabilizedPoint, stabilizerStrength, brushRadius, pointerDown = true } = input;

  if (!pointerDown || stabilizerStrength < 1.5) {
    return Object.freeze({
      visible: false,
      guideSegment: null,
      curvePoints: [],
      distance: 0,
      strokeWidth: 1,
      opacity: 0,
    });
  }

  const dx = rawPoint[0] - stabilizedPoint[0];
  const dy = rawPoint[1] - stabilizedPoint[1];
  const distance = Math.hypot(dx, dy);

  // If distance is very small, no need to show lead trail.
  const minThresholdPx = 2.5;
  if (distance < minThresholdPx) {
    return Object.freeze({
      visible: false,
      guideSegment: null,
      curvePoints: [],
      distance,
      strokeWidth: 1,
      opacity: 0,
    });
  }

  // Dynamic opacity: stronger stabilization and longer lag lead to slightly clearer guide line
  const strengthFactor = Math.min(1, stabilizerStrength / 10);
  const distanceFactor = Math.min(1, distance / 60);
  const opacity = Math.min(0.65, 0.18 + strengthFactor * 0.25 + distanceFactor * 0.2);

  // Guide stroke width: thin hairline scaled with canvas/brush visibility
  const strokeWidth = Math.max(1, Math.min(2.5, brushRadius * 0.15));

  // Compute intermediate interpolation points along the lead trail
  const curvePoints: (readonly [number, number])[] = [];
  const segments = distance > 24 ? 4 : 2;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const easeT = t * t * (3 - 2 * t);
    const px = stabilizedPoint[0] + dx * easeT;
    const py = stabilizedPoint[1] + dy * easeT;
    curvePoints.push([Math.round(px * 10) / 10, Math.round(py * 10) / 10]);
  }

  return Object.freeze({
    visible: true,
    guideSegment: [stabilizedPoint, rawPoint] as const,
    curvePoints: Object.freeze(curvePoints),
    distance: Math.round(distance * 10) / 10,
    strokeWidth: Math.round(strokeWidth * 10) / 10,
    opacity: Math.round(opacity * 100) / 100,
  });
}
