/**
 * Character Shaper hand glyphs share their joint data with the normalized VRM
 * runtime. The prop silhouette is illustrative; the curl comes from the actual
 * preset rather than a second independently maintained table.
 */
import {
  STUDIO_VRM_HAND_POSE_TYPES,
  studioVrmHandPoseGlyphCurls,
} from "../vrm/studio-vrm-hand-poses";

import type { CharacterHandPoseType } from "./character-shaper-contract";

/** Per-finger curl, thumb → little, 0 = fully extended, 1 = folded into the palm. */
export type CharacterHandGlyphCurls = readonly [number, number, number, number, number];

/** Small object drawn with the hand so grips read as what they hold. */
export type CharacterHandGlyphProp = "phone" | "pen" | "cup" | "rod" | "heart" | "ring";

export interface CharacterHandGlyphLayout {
  readonly curls: CharacterHandGlyphCurls;
  /** 0 = fingers parallel, 1 = fully fanned. */
  readonly spread: number;
  /** Thumb direction in degrees from straight up; negative leans away from the fingers. */
  readonly thumbAngle: number;
  readonly prop: CharacterHandGlyphProp | null;
}

export const CHARACTER_HAND_GLYPH_POSE_TYPES: readonly CharacterHandPoseType[] = STUDIO_VRM_HAND_POSE_TYPES;

function layout(
  pose: CharacterHandPoseType,
  spread: number,
  thumbAngle: number,
  prop: CharacterHandGlyphProp | null = null,
): CharacterHandGlyphLayout {
  return Object.freeze({ curls: Object.freeze(studioVrmHandPoseGlyphCurls(pose)), spread, thumbAngle, prop });
}

const HAND_GLYPH_TABLE: Readonly<Record<CharacterHandPoseType, CharacterHandGlyphLayout>> = Object.freeze({
  fist: layout("fist", 0, 35),
  open: layout("open", 1, -55),
  point: layout("point", 0.15, -25),
  peace: layout("peace", 0.75, 20),
  thumbsUp: layout("thumbsUp", 0, -8),
  holding: layout("holding", 0.05, 30, "rod"),
  phoneGrip: layout("phoneGrip", 0.2, -10, "phone"),
  penGrip: layout("penGrip", 0.2, 15, "pen"),
  fingerHeart: layout("fingerHeart", 0.15, 25, "heart"),
  cupGrip: layout("cupGrip", 0.15, 0, "cup"),
  rockRoll: layout("rockRoll", 0.7, 30),
  okSign: layout("okSign", 0.65, 20, "ring"),
  relaxed: layout("relaxed", 0.35, -40),
});

/** Full glyph layout; unknown ids (foreign catalog data) fall back to the relaxed hand. */
export function characterHandGlyphLayout(poseType: CharacterHandPoseType): CharacterHandGlyphLayout {
  return Object.hasOwn(HAND_GLYPH_TABLE, poseType) ? HAND_GLYPH_TABLE[poseType] : HAND_GLYPH_TABLE.relaxed;
}

/** Thumb → little finger curls in 0..1. */
export function characterHandGlyphCurls(poseType: CharacterHandPoseType): CharacterHandGlyphCurls {
  return characterHandGlyphLayout(poseType).curls;
}

/** Finger fan amount in 0..1. */
export function characterHandGlyphSpread(poseType: CharacterHandPoseType): number {
  return characterHandGlyphLayout(poseType).spread;
}
