/**
 * Shared, normalized-VRM hand poses. Degrees are authored per joint, not copied
 * to all three phalanges. The runtime and shelf glyphs consume this same table.
 * These are pose presets, not a claim of mesh-level collision-free contact.
 */
export type StudioVrmHandSide = "left" | "right";
export type StudioVrmHandPoseType =
  | "fist" | "open" | "point" | "peace" | "thumbsUp" | "holding"
  | "phoneGrip" | "penGrip" | "fingerHeart" | "cupGrip"
  | "rockRoll" | "okSign" | "relaxed";
export type StudioVrmHandFinger = "thumb" | "index" | "middle" | "ring" | "little";
export type StudioVrmHandRotations = Record<string, [number, number, number]>;
type Triple = readonly [number, number, number];
type FingerJoints = readonly [Triple, Triple, Triple, Triple];
interface HandPoseDefinition {
  /** Index → little; MCP / PIP / DIP flexion in degrees. */
  readonly fingers: FingerJoints;
  /** Lateral spread is applied only to the proximal joint. */
  readonly spread: readonly [number, number, number, number];
  /** Metacarpal / proximal / distal XYZ rotations for the right hand. */
  readonly thumb: readonly [Triple, Triple, Triple];
}
const NAMES = ["Index", "Middle", "Ring", "Little"] as const;
const SEGMENTS = ["Proximal", "Intermediate", "Distal"] as const;
const FOLDED: FingerJoints = [[62, 88, 52], [68, 94, 58], [72, 96, 60], [74, 92, 56]];
const FOLDED_THUMB: HandPoseDefinition["thumb"] = [[0, 14, 8], [0, 25, 28], [0, 0, 20]];
const STRAIGHT: Triple = [0, 0, 0];
const DEG = Math.PI / 180;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const DEFINITIONS: Readonly<Record<StudioVrmHandPoseType, HandPoseDefinition>> = {
  fist: { fingers: FOLDED, spread: [0, 0, 0, 0], thumb: FOLDED_THUMB },
  open: {
    fingers: [STRAIGHT, STRAIGHT, STRAIGHT, STRAIGHT], spread: [10, 3, -4, -10],
    thumb: [[0, -12, -8], [0, -6, 0], STRAIGHT],
  },
  point: {
    fingers: [[0, 4, 0], FOLDED[1], FOLDED[2], FOLDED[3]], spread: [3, 0, 0, 0],
    thumb: [[0, 8, 4], [0, 16, 18], [0, 0, 12]],
  },
  peace: {
    fingers: [[2, 3, 0], [2, 4, 0], FOLDED[2], FOLDED[3]], spread: [13, -8, 0, 0],
    thumb: FOLDED_THUMB,
  },
  thumbsUp: {
    fingers: FOLDED, spread: [0, 0, 0, 0],
    thumb: [[0, -14, -15], STRAIGHT, STRAIGHT],
  },
  holding: {
    fingers: [[50, 74, 40], [54, 80, 44], [58, 82, 46], [60, 78, 44]], spread: [0, 0, 0, 0],
    thumb: [[0, 12, 6], [0, 22, 24], [0, 0, 18]],
  },
  phoneGrip: {
    fingers: [[18, 34, 16], [38, 60, 28], [44, 64, 32], [52, 62, 30]], spread: [3, 0, -2, -4],
    thumb: [[0, 6, 3], [0, 12, 14], [0, 0, 8]],
  },
  penGrip: {
    fingers: [[34, 60, 30], [40, 65, 32], [50, 72, 40], [56, 76, 44]], spread: [3, 0, -2, -3],
    thumb: [[0, 14, 5], [0, 20, 20], [0, 0, 14]],
  },
  fingerHeart: {
    fingers: [[30, 52, 22], FOLDED[1], FOLDED[2], FOLDED[3]], spread: [10, 0, 0, 0],
    thumb: [[0, -12, 8], [0, -10, 24], [0, 0, 18]],
  },
  cupGrip: {
    fingers: [[32, 52, 26], [36, 56, 28], [40, 58, 30], [44, 56, 28]], spread: [2, 0, -2, -3],
    thumb: [[0, 8, 4], [0, 14, 18], [0, 0, 10]],
  },
  rockRoll: {
    fingers: [[0, 3, 0], FOLDED[1], FOLDED[2], [0, 4, 0]], spread: [10, 0, 0, -12],
    thumb: FOLDED_THUMB,
  },
  okSign: {
    fingers: [[45, 66, 30], [6, 10, 4], [10, 14, 6], [14, 18, 8]], spread: [4, 3, -5, -12],
    thumb: [[0, 14, 6], [0, 24, 22], [0, 0, 16]],
  },
  relaxed: {
    fingers: [[8, 14, 6], [12, 20, 10], [18, 26, 14], [24, 32, 18]], spread: [4, 1, -2, -5],
    thumb: [[0, 4, 2], [0, 8, 10], [0, 0, 6]],
  },
};

export const STUDIO_VRM_HAND_POSE_TYPES: readonly StudioVrmHandPoseType[] = Object.freeze(
  Object.keys(DEFINITIONS) as StudioVrmHandPoseType[],
);

function definitionFor(pose: StudioVrmHandPoseType): HandPoseDefinition {
  return Object.hasOwn(DEFINITIONS, pose) ? DEFINITIONS[pose] : DEFINITIONS.relaxed;
}

function mirroredRadians(rotation: Triple, side: StudioVrmHandSide): [number, number, number] {
  const sign = side === "left" ? -1 : 1;
  return [rotation[0] * DEG, rotation[1] * sign * DEG, rotation[2] * sign * DEG];
}

/** Complete replacement for just one hand: no stale thumb opposition or finger spread. */
export function createStudioVrmHandPose(
  side: StudioVrmHandSide,
  pose: StudioVrmHandPoseType,
): StudioVrmHandRotations {
  if (side !== "left" && side !== "right") return {};
  const definition = definitionFor(pose);
  const result: StudioVrmHandRotations = {};
  NAMES.forEach((name, finger) => {
    SEGMENTS.forEach((segment, joint) => {
      result[`${side}${name}${segment}`] = mirroredRadians(
        [0, joint === 0 ? definition.spread[finger] : 0, definition.fingers[finger][joint]], side,
      );
    });
  });
  (["Metacarpal", "Proximal", "Distal"] as const).forEach((segment, joint) => {
    result[`${side}Thumb${segment}`] = mirroredRadians(definition.thumb[joint], side);
  });
  return result;
}

/**
 * Curl control remains in MCP degrees, preserving the existing slider readback.
 * The middle joint leads the distal joint; thumb opposition is distributed over
 * the thumb chain. Non-finite input is ignored, not converted to a reset pose.
 */
export function createStudioVrmFingerCurlPose(
  side: StudioVrmHandSide,
  degrees: number,
  finger?: StudioVrmHandFinger,
): StudioVrmHandRotations {
  if (!Number.isFinite(degrees) || (side !== "left" && side !== "right")) return {};
  const curl = clamp(degrees, 0, 90);
  const result: StudioVrmHandRotations = {};
  NAMES.forEach((name) => {
    if (finger && finger !== name.toLowerCase()) return;
    const joints = [curl, Math.min(100, curl * 1.15), curl * 0.65];
    SEGMENTS.forEach((segment, joint) => {
      result[`${side}${name}${segment}`] = mirroredRadians([0, 0, joints[joint]], side);
    });
  });
  if (!finger || finger === "thumb") {
    result[`${side}ThumbMetacarpal`] = mirroredRadians([0, curl * 0.2, curl * 0.12], side);
    result[`${side}ThumbProximal`] = mirroredRadians([0, curl * 0.6, curl * 0.3], side);
    result[`${side}ThumbDistal`] = mirroredRadians([0, 0, curl * 0.32], side);
  }
  return result;
}

/** Thumbnail curl values are computed from the actual preset, not a second angle table. */
export function studioVrmHandPoseGlyphCurls(
  pose: StudioVrmHandPoseType,
): readonly [number, number, number, number, number] {
  const definition = definitionFor(pose);
  const fingerCurls = definition.fingers.map((joints, index) => (
    clamp(joints.reduce((sum, angle) => sum + Math.max(0, angle), 0)
      / FOLDED[index].reduce((sum, angle) => sum + angle, 0), 0, 1)
  ));
  const thumbCurl = clamp(definition.thumb.reduce((sum, rotation) => sum + Math.max(0, rotation[2]), 0) / 56, 0, 1);
  return [thumbCurl, fingerCurls[0], fingerCurls[1], fingerCurls[2], fingerCurls[3]];
}
