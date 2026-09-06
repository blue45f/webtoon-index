export interface StudioBg3dLodProjectionInput {
  /** World-space radius of the model's current bounding sphere. */
  readonly worldRadius: number;
  /** Absolute camera-space depth of the sphere centre in front of the camera. */
  readonly viewDepth: number;
  /** `camera.projectionMatrix.elements[5]`, before taking its absolute value. */
  readonly verticalProjectionScale: number;
  /** CSS-pixel viewport height. The drawing-buffer height (and therefore DPR) must not be used. */
  readonly viewportCssHeight: number;
  readonly perspective: boolean;
  readonly nearPlane: number;
}

export interface StudioBg3dLodProjection {
  readonly projectedDiameterCssPx: number;
  /** Near-plane/camera intersections are deliberately never simplified. */
  readonly forceHighestDetail: boolean;
}

export interface StudioBg3dLodSelectionInput {
  readonly projectedDiameterCssPx: number;
  /**
   * One boundary per fallback, ordered from highest to lowest detail. For `[400, 160]`,
   * level 0 is selected at 400px or above, level 1 at 160–400px, and level 2 below 160px.
   */
  readonly fallbackThresholdsCssPx: readonly number[];
  /** Positive values make lower-detail levels engage sooner; one unit halves effective diameter. */
  readonly lodBias: number;
  /** The last selected level, or null before the first valid measurement. */
  readonly previousLevelIndex: number | null;
  /** Ratio in `[0, 1)`. A value of 0.1 places switch boundaries at -10% and +10%. */
  readonly hysteresisRatio: number;
  readonly forceHighestDetail: boolean;
  /** Offscreen measurements are stale, so the previous valid level is retained. */
  readonly offscreen: boolean;
  /** Upstream bounds/projection failures are handled like stale measurements. */
  readonly invalid: boolean;
}

/**
 * Projects a world-space bounding-sphere diameter into CSS pixels without accepting a DPR input.
 * The caller is responsible for supplying a positive camera-space depth for a sphere in front of
 * the camera. Invalid or non-finite projection state fails closed with null.
 */
export function projectStudioBg3dLodDiameterCssPx(
  input: StudioBg3dLodProjectionInput,
): StudioBg3dLodProjection | null {
  if (
    !Number.isFinite(input.worldRadius) ||
    input.worldRadius <= 0 ||
    !Number.isFinite(input.viewDepth) ||
    input.viewDepth <= 0 ||
    !Number.isFinite(input.verticalProjectionScale) ||
    input.verticalProjectionScale === 0 ||
    !Number.isFinite(input.viewportCssHeight) ||
    input.viewportCssHeight <= 0 ||
    typeof input.perspective !== "boolean" ||
    !Number.isFinite(input.nearPlane) ||
    input.nearPlane < 0
  ) {
    return null;
  }

  const depthDenominator = input.perspective ? input.viewDepth : 1;
  const projectedDiameterCssPx =
    (input.worldRadius * Math.abs(input.verticalProjectionScale) * input.viewportCssHeight) /
    depthDenominator;
  if (!Number.isFinite(projectedDiameterCssPx) || projectedDiameterCssPx < 0) return null;

  return Object.freeze({
    projectedDiameterCssPx,
    forceHighestDetail: input.viewDepth <= input.worldRadius + input.nearPlane,
  });
}

function isValidPreviousLevel(
  previousLevelIndex: number | null,
  fallbackCount: number,
): previousLevelIndex is number {
  return (
    previousLevelIndex !== null &&
    Number.isInteger(previousLevelIndex) &&
    previousLevelIndex >= 0 &&
    previousLevelIndex <= fallbackCount
  );
}

function hasValidThresholdContract(thresholds: readonly number[]): boolean {
  for (let index = 0; index < thresholds.length; index += 1) {
    const threshold = thresholds[index];
    if (!Number.isFinite(threshold) || threshold <= 0) return false;
    if (index > 0 && threshold >= thresholds[index - 1]) return false;
  }
  return true;
}

function compareLog2(left: number, right: number): -1 | 0 | 1 {
  if (Object.is(left, right) || left === right) return 0;
  if (!Number.isFinite(left) || !Number.isFinite(right)) return left < right ? -1 : 1;
  const tolerance = Number.EPSILON * 8 * Math.max(1, Math.abs(left), Math.abs(right));
  if (left < right - tolerance) return -1;
  if (left > right + tolerance) return 1;
  return 0;
}

/**
 * Selects a high-to-low fallback index using CSS-pixel coverage and symmetric hysteresis.
 *
 * The selector is engine-neutral and stateless: callers store the returned index and provide it as
 * `previousLevelIndex` on the next frame. Invalid/offscreen frames retain a valid previous level;
 * without one they conservatively choose the highest-detail level.
 */
export function selectStudioBg3dLodLevel(input: StudioBg3dLodSelectionInput): number {
  const fallbackCount = input.fallbackThresholdsCssPx.length;
  if (input.forceHighestDetail || fallbackCount === 0) return 0;

  const previousLevelIsValid = isValidPreviousLevel(
    input.previousLevelIndex,
    fallbackCount,
  );
  const retainPreviousOrHighest = () => previousLevelIsValid ? input.previousLevelIndex : 0;

  if (
    input.offscreen ||
    input.invalid ||
    !Number.isFinite(input.projectedDiameterCssPx) ||
    input.projectedDiameterCssPx < 0 ||
    !Number.isFinite(input.lodBias) ||
    !Number.isFinite(input.hysteresisRatio) ||
    input.hysteresisRatio < 0 ||
    input.hysteresisRatio >= 1 ||
    !hasValidThresholdContract(input.fallbackThresholdsCssPx)
  ) {
    return retainPreviousOrHighest();
  }

  // Log-space comparison avoids overflow for large but finite diameters and bias values. Zero
  // coverage maps to -Infinity and therefore selects the lowest fallback on a valid onscreen frame.
  const effectiveDiameterLog2 =
    Math.log2(input.projectedDiameterCssPx) - input.lodBias;
  const lowerBoundaryOffsetLog2 = Math.log2(1 - input.hysteresisRatio);
  const upperBoundaryOffsetLog2 = Math.log2(1 + input.hysteresisRatio);

  if (!previousLevelIsValid) {
    let selectedLevel = 0;
    while (
      selectedLevel < fallbackCount &&
      compareLog2(
        effectiveDiameterLog2,
        Math.log2(input.fallbackThresholdsCssPx[selectedLevel]),
      ) < 0
    ) {
      selectedLevel += 1;
    }
    return selectedLevel;
  }

  let selectedLevel = input.previousLevelIndex;

  // A single frame may legitimately cross several boundaries after a camera cut or asset swap.
  while (selectedLevel < fallbackCount) {
    const boundaryLog2 = Math.log2(input.fallbackThresholdsCssPx[selectedLevel]);
    if (
      compareLog2(effectiveDiameterLog2, boundaryLog2 + lowerBoundaryOffsetLog2) >= 0
    ) break;
    selectedLevel += 1;
  }
  while (selectedLevel > 0) {
    const boundaryLog2 = Math.log2(input.fallbackThresholdsCssPx[selectedLevel - 1]);
    if (
      compareLog2(effectiveDiameterLog2, boundaryLog2 + upperBoundaryOffsetLog2) < 0
    ) break;
    selectedLevel -= 1;
  }

  return selectedLevel;
}
