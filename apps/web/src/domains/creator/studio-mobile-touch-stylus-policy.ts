/**
 * Studio Mobile/Tablet Touch & Stylus Policy: Palm Rejection, Role Separation & Stroke Prediction
 *
 * CLIP STUDIO PAINT Ver.5.1.0 Parity:
 * 1. Palm Rejection Filter (모바일·태블릿 팜 리젝션):
 *    - Detects palm resting on screen while drawing with active stylus.
 *    - Analyzes contact patch geometry (radiusX, radiusY, contact area) to suppress palm accidental marks.
 * 2. Stylus vs Finger Role Separation (펜과 손가락 역할 분리):
 *    - Stylus is dedicated exclusively to drawing, inking, and erasing.
 *    - Single finger is assigned to canvas navigation (pan) or tool interaction.
 *    - Multi-touch gestures: Two-finger pinch for zoom/pan, two-finger tap for Undo, three-finger tap for Redo.
 * 3. Mobile Stroke Prediction Modes (스트로크 예측 방식):
 *    - Extrapolates upcoming coordinates by 1~2 frames to eliminate hardware display latency.
 *
 * Pure, deterministic, zero-dependency.
 */

export type StudioPointerDeviceType = "pen" | "touch" | "mouse";

export type StudioFingerActionRole = "navigate" | "draw" | "select";

export type StudioStrokePredictionAlgorithm = "off" | "linear" | "quadratic" | "device-native";

export interface StudioTouchStylusPolicyConfig {
  readonly fingerAction: StudioFingerActionRole;
  readonly palmRejectionEnabled: boolean;
  readonly palmContactThresholdRadiusPx: number; // e.g. 24px
  readonly palmContactThresholdAreaPx: number; // e.g. 900px²
  readonly predictionAlgorithm: StudioStrokePredictionAlgorithm;
  readonly twoFingerTapUndo: boolean;
  readonly threeFingerTapRedo: boolean;
}

export const DEFAULT_STUDIO_TOUCH_STYLUS_POLICY: StudioTouchStylusPolicyConfig = Object.freeze({
  fingerAction: "navigate", // Finger navigates canvas, stylus paints
  palmRejectionEnabled: true,
  palmContactThresholdRadiusPx: 22,
  palmContactThresholdAreaPx: 800,
  predictionAlgorithm: "linear",
  twoFingerTapUndo: true,
  threeFingerTapRedo: true,
});

export interface PointerSampleEventData {
  readonly pointerType: StudioPointerDeviceType | string;
  readonly clientX: number;
  readonly clientY: number;
  readonly width?: number;
  readonly height?: number;
  readonly pressure?: number;
  readonly isPrimary?: boolean;
}

export interface PalmRejectionDecision {
  readonly isPalm: boolean;
  readonly action: "accept" | "suppress-palm" | "delegate-navigation";
  readonly reason: string;
}

/**
 * Evaluates whether an incoming pointer event should be accepted as drawing,
 * delegated to canvas navigation, or suppressed as palm interference.
 */
export function evaluatePointerSamplePolicy(
  sample: PointerSampleEventData,
  config: StudioTouchStylusPolicyConfig = DEFAULT_STUDIO_TOUCH_STYLUS_POLICY,
  activeStylusDrawing = false,
): PalmRejectionDecision {
  const isPen = sample.pointerType === "pen";
  const isTouch = sample.pointerType === "touch";

  // Stylus is always accepted for drawing
  if (isPen) {
    return Object.freeze({
      isPalm: false,
      action: "accept",
      reason: "스타일러스 펜 입력 정상 수락",
    });
  }

  // If stylus is actively drawing on screen, any concurrent touch is suppressed as palm
  if (isTouch && activeStylusDrawing && config.palmRejectionEnabled) {
    return Object.freeze({
      isPalm: true,
      action: "suppress-palm",
      reason: "스타일러스 작화 중 동시 터치 감지 (팜 리젝션 차단)",
    });
  }

  // Check touch contact patch size (palm detection)
  if (isTouch && config.palmRejectionEnabled) {
    const radiusX = (sample.width ?? 1) / 2;
    const radiusY = (sample.height ?? 1) / 2;
    const contactArea = Math.PI * radiusX * radiusY;

    if (
      radiusX >= config.palmContactThresholdRadiusPx ||
      radiusY >= config.palmContactThresholdRadiusPx ||
      contactArea >= config.palmContactThresholdAreaPx
    ) {
      return Object.freeze({
        isPalm: true,
        action: "suppress-palm",
        reason: `대형 접촉 면적 감지 (${contactArea.toFixed(0)}px² >= ${config.palmContactThresholdAreaPx}px² 팜 차단)`,
      });
    }
  }

  // Normal touch behavior based on role policy
  if (isTouch) {
    if (config.fingerAction === "navigate") {
      return Object.freeze({
        isPalm: false,
        action: "delegate-navigation",
        reason: "손가락 입력: 캔버스 이동 및 제스처 전담",
      });
    }
    return Object.freeze({
      isPalm: false,
      action: "accept",
      reason: "손가락 작화 허용 모드",
    });
  }

  // Default mouse input
  return Object.freeze({
    isPalm: false,
    action: "accept",
    reason: "마우스 입력 수락",
  });
}

/**
 * Predicts the next stylus point along trajectory to compensate for display refresh lag.
 */
export function predictNextStrokePoint(
  points: readonly (readonly [number, number])[],
  algorithm: StudioStrokePredictionAlgorithm = "linear",
  predictionScale = 1.0,
): readonly [number, number] | null {
  if (algorithm === "off" || points.length < 2) return null;

  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const vx = (last[0] - prev[0]) * predictionScale;
  const vy = (last[1] - prev[1]) * predictionScale;

  if (algorithm === "linear" || points.length < 3) {
    return Object.freeze([
      Math.round((last[0] + vx) * 10) / 10,
      Math.round((last[1] + vy) * 10) / 10,
    ]);
  }

  // Quadratic extrapolation with acceleration
  const prev2 = points[points.length - 3];
  const prevVx = prev[0] - prev2[0];
  const prevVy = prev[1] - prev2[1];
  const ax = vx - prevVx;
  const ay = vy - prevVy;

  return Object.freeze([
    Math.round((last[0] + vx + 0.5 * ax) * 10) / 10,
    Math.round((last[1] + vy + 0.5 * ay) * 10) / 10,
  ]);
}
