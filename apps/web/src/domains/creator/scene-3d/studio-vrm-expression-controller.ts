/**
 * Studio VRM Facial Expression Controller & 3D Object Orientation Alignment
 *
 * CLIP STUDIO PAINT Ver.3.0 & Ver.4.0 & Ver.4.1.0 Parity:
 * - VRM Facial Expressions (VRM 표정 블렌드셰이프 제어):
 *   - Standard VRM 1.0 expression channels: neutral, happy, angry, sad, relaxed, surprised, blink, lip-sync (aa, ih, ou, ee, oh).
 *   - Preset emotional mood combinations for webtoon characters.
 * - 3D Object Orientation Alignment (3D 오브젝트 방향 일치):
 *   - Aligns an object's rotation (Euler angles in radians/degrees) to match the surface normal or orientation of a parent/reference object.
 *
 * Pure, deterministic, zero-dependency.
 */

export type VrmExpressionPresetName =
  | "neutral"
  | "happy"
  | "angry"
  | "sad"
  | "relaxed"
  | "surprised"
  | "blink"
  | "blinkLeft"
  | "blinkRight"
  | "aa"
  | "ih"
  | "ou"
  | "ee"
  | "oh";

export type VrmExpressionWeights = Readonly<Partial<Record<VrmExpressionPresetName, number>>>;

export interface VrmExpressionState {
  readonly weights: VrmExpressionWeights;
  readonly activePresetMood?: string;
}

export const DEFAULT_VRM_EXPRESSION_STATE: VrmExpressionState = Object.freeze({
  weights: Object.freeze({
    neutral: 1.0,
    happy: 0,
    angry: 0,
    sad: 0,
    relaxed: 0,
    surprised: 0,
    blink: 0,
  }),
});

/**
 * Pre-defined webtoon character emotional mood presets.
 */
export const WEBTOON_VRM_MOOD_PRESETS: Readonly<Record<string, VrmExpressionWeights>> = Object.freeze({
  "기쁨·미소": Object.freeze({ happy: 0.9, relaxed: 0.3, neutral: 0.1 }),
  "분노·격앙": Object.freeze({ angry: 1.0, neutral: 0 }),
  "슬픔·눈물": Object.freeze({ sad: 0.85, relaxed: 0.2, neutral: 0 }),
  "당황·경악": Object.freeze({ surprised: 1.0, happy: 0.2, neutral: 0 }),
  "윙크(좌)": Object.freeze({ blinkLeft: 1.0, happy: 0.7, neutral: 0.2 }),
  "윙크(우)": Object.freeze({ blinkRight: 1.0, happy: 0.7, neutral: 0.2 }),
  "대화·말하기": Object.freeze({ aa: 0.6, neutral: 0.4 }),
});

/**
 * Sets a specific VRM expression weight, clamped to [0.0, 1.0].
 */
export function setVrmExpressionWeight(
  state: VrmExpressionState,
  name: VrmExpressionPresetName,
  weight: number,
): VrmExpressionState {
  const clamped = Math.max(0, Math.min(1, Math.round(weight * 100) / 100));
  return Object.freeze({
    ...state,
    weights: Object.freeze({
      ...state.weights,
      [name]: clamped,
    }),
  });
}

/**
 * Applies a webtoon emotional mood preset.
 */
export function applyVrmMoodPreset(moodName: string): VrmExpressionState {
  const weights = WEBTOON_VRM_MOOD_PRESETS[moodName] ?? DEFAULT_VRM_EXPRESSION_STATE.weights;
  return Object.freeze({
    weights,
    activePresetMood: moodName,
  });
}

/**
 * Calculates Euler angles (pitch, yaw, roll in degrees) to align an object's local up vector [0, 1, 0]
 * with a target surface normal vector [nx, ny, nz].
 */
export function alignObjectToNormal(
  normal: readonly [number, number, number],
): readonly [number, number, number] {
  const [nx, ny, nz] = normal;
  const len = Math.hypot(nx, ny, nz) || 1;
  const ux = nx / len;
  const uy = ny / len;
  const uz = nz / len;

  // Pitch (rotation around X) and Yaw (rotation around Y)
  const pitchRad = Math.asin(-uz);
  const yawRad = Math.atan2(ux, uy);

  const normalizeZero = (v: number) => (Object.is(v, -0) || v === 0 ? 0 : v);
  const pitchDeg = normalizeZero(Math.round(((pitchRad * 180) / Math.PI) * 10) / 10);
  const yawDeg = normalizeZero(Math.round(((yawRad * 180) / Math.PI) * 10) / 10);

  return Object.freeze([pitchDeg, yawDeg, 0]);
}
