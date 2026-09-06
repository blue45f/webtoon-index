import {
  avatarSideForHand,
  solveHandToFingerBones,
  type FingerEulerMap,
  type HandLandmark,
} from "./studio-vrm-hand-solver";
import { StudioVrmPhotoPoseError } from "./studio-vrm-photo-pose";

export const STUDIO_VRM_PHOTO_HAND_LANDMARK_COUNT = 21 as const;
export const STUDIO_VRM_PHOTO_HAND_MAX_HANDS = 2 as const;

export type StudioVrmPhotoHandSide = "left" | "right";
export type StudioVrmPhotoHandStatus = "detected" | "not-detected" | "unavailable";
export type StudioVrmPhotoHandWarningCode =
  | "ambiguous-side"
  | "inference-failed"
  | "low-confidence"
  | "model-unavailable"
  | "protocol";

export interface StudioVrmPhotoHandDetection {
  readonly side: StudioVrmPhotoHandSide;
  readonly handedness: "Left" | "Right";
  readonly confidence: number;
  readonly normalizedLandmarks: readonly HandLandmark[];
  readonly worldLandmarks: readonly HandLandmark[];
}

export interface StudioVrmPhotoHandInferenceResult {
  readonly status: StudioVrmPhotoHandStatus;
  readonly detections: readonly StudioVrmPhotoHandDetection[];
  readonly detectedSides: readonly StudioVrmPhotoHandSide[];
  readonly ambiguousSides: readonly StudioVrmPhotoHandSide[];
  readonly fingerEdits: FingerEulerMap;
  readonly warnings: readonly StudioVrmPhotoHandWarningCode[];
}

interface StudioVrmPhotoHandOptions {
  readonly mirrorHorizontal: boolean;
  readonly minimumHandednessConfidence?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function copyLandmarkArray(value: unknown, normalized: boolean): readonly HandLandmark[] | null {
  if (!Array.isArray(value) || value.length !== STUDIO_VRM_PHOTO_HAND_LANDMARK_COUNT) return null;
  const maximum = normalized ? 100 : 10_000;
  const copied: HandLandmark[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const coordinates = [entry.x, entry.y, entry.z];
    if (coordinates.some((coordinate) => (
      typeof coordinate !== "number"
      || !Number.isFinite(coordinate)
      || Math.abs(coordinate) > maximum
    ))) return null;
    copied.push(Object.freeze({
      x: entry.x as number,
      y: entry.y as number,
      z: entry.z as number,
    }));
  }
  return Object.freeze(copied);
}

function copyFingerEdits(value: FingerEulerMap): FingerEulerMap {
  const copied: FingerEulerMap = {};
  for (const [bone, rotation] of Object.entries(value)) {
    if (
      !Array.isArray(rotation)
      || rotation.length !== 3
      || rotation.some((axis) => !Number.isFinite(axis))
    ) continue;
    copied[bone] = Object.freeze([rotation[0], rotation[1], rotation[2]]);
  }
  return Object.freeze(copied);
}

function uniqueWarnings(
  warnings: readonly StudioVrmPhotoHandWarningCode[],
): readonly StudioVrmPhotoHandWarningCode[] {
  return Object.freeze([...new Set(warnings)]);
}

export function createStudioVrmPhotoHandUnavailableResult(
  warning: Extract<StudioVrmPhotoHandWarningCode, "inference-failed" | "model-unavailable" | "protocol">,
): StudioVrmPhotoHandInferenceResult {
  return Object.freeze({
    status: "unavailable",
    detections: Object.freeze([]),
    detectedSides: Object.freeze([]),
    ambiguousSides: Object.freeze([]),
    fingerEdits: Object.freeze({}),
    warnings: Object.freeze([warning]),
  });
}

/**
 * Copies and validates the MediaPipe HandLandmarker boundary before solving finger rotations.
 * Duplicate detections that map to the same avatar side fail closed for that side instead of
 * letting array order choose which hand overwrites the other.
 */
export function createStudioVrmPhotoHandInferenceResult(
  rawResult: unknown,
  options: StudioVrmPhotoHandOptions,
): StudioVrmPhotoHandInferenceResult {
  if (!isRecord(rawResult) || typeof options.mirrorHorizontal !== "boolean") {
    throw new StudioVrmPhotoPoseError("protocol");
  }
  const minimumConfidence = options.minimumHandednessConfidence ?? 0.5;
  if (!Number.isFinite(minimumConfidence) || minimumConfidence < 0 || minimumConfidence > 1) {
    throw new StudioVrmPhotoPoseError("invalid-options");
  }
  const normalizedSets = rawResult.landmarks;
  const worldSets = rawResult.worldLandmarks;
  const handednessSets = Array.isArray(rawResult.handedness)
    ? rawResult.handedness
    : rawResult.handednesses;
  if (
    !Array.isArray(normalizedSets)
    || !Array.isArray(worldSets)
    || !Array.isArray(handednessSets)
    || normalizedSets.length !== worldSets.length
    || normalizedSets.length !== handednessSets.length
    || normalizedSets.length > STUDIO_VRM_PHOTO_HAND_MAX_HANDS
  ) {
    throw new StudioVrmPhotoPoseError("protocol");
  }

  const candidates: StudioVrmPhotoHandDetection[] = [];
  const lowConfidenceSides: StudioVrmPhotoHandSide[] = [];
  for (let index = 0; index < normalizedSets.length; index += 1) {
    const normalizedLandmarks = copyLandmarkArray(normalizedSets[index], true);
    const worldLandmarks = copyLandmarkArray(worldSets[index], false);
    const categories = handednessSets[index];
    if (!normalizedLandmarks || !worldLandmarks || !Array.isArray(categories) || categories.length !== 1) {
      throw new StudioVrmPhotoPoseError("protocol");
    }
    const category = categories[0];
    if (!isRecord(category)) throw new StudioVrmPhotoPoseError("protocol");
    const handedness = category.categoryName;
    const confidence = category.score;
    if (
      (handedness !== "Left" && handedness !== "Right")
      || typeof confidence !== "number"
      || !Number.isFinite(confidence)
      || confidence < 0
      || confidence > 1
    ) {
      throw new StudioVrmPhotoPoseError("protocol");
    }
    const side = avatarSideForHand(handedness, options.mirrorHorizontal);
    if (confidence < minimumConfidence) {
      lowConfidenceSides.push(side);
      continue;
    }
    candidates.push(Object.freeze({
      side,
      handedness,
      confidence,
      normalizedLandmarks,
      worldLandmarks,
    }));
  }

  const counts = new Map<StudioVrmPhotoHandSide, number>();
  for (const candidate of candidates) {
    counts.set(candidate.side, (counts.get(candidate.side) ?? 0) + 1);
  }
  const ambiguousSides = (["left", "right"] as const)
    .filter((side) => (counts.get(side) ?? 0) > 1);
  const accepted = candidates.filter((candidate) => !ambiguousSides.includes(candidate.side));
  const fingerEdits: FingerEulerMap = {};
  for (const detection of accepted) {
    Object.assign(
      fingerEdits,
      solveHandToFingerBones(detection.worldLandmarks, detection.side),
    );
  }
  const warnings: StudioVrmPhotoHandWarningCode[] = [];
  if (ambiguousSides.length > 0) warnings.push("ambiguous-side");
  if (lowConfidenceSides.length > 0) warnings.push("low-confidence");
  const detectedSides = accepted.map((detection) => detection.side);

  return Object.freeze({
    status: accepted.length > 0 ? "detected" : "not-detected",
    detections: Object.freeze(accepted),
    detectedSides: Object.freeze(detectedSides),
    ambiguousSides: Object.freeze(ambiguousSides),
    fingerEdits: copyFingerEdits(fingerEdits),
    warnings: uniqueWarnings(warnings),
  });
}
