/**
 * Character Shaper — pose card glyphs.
 *
 * Projects a `StudioPosePreset` (the same bone map `applyPoseToVrm` consumes) onto a front-view
 * stick figure so a pose card predicts the viewport instead of showing a generic icon.
 *
 *  - Limb `direction` targets are *world* directions. `{ sideX, y, z }` mirrors `sideX` per side
 *    exactly like `resolveTargetWorldDirection` (left = +X, right = −X); `[x, y, z]` is used as is.
 *  - The model faces +Z (the default camera sits at +Z), so the front view keeps x — the
 *    character's left lands on the viewer's right, as in the viewport — and flips y (SVG y down).
 *  - Depth (z) foreshortens each segment but never below a stub, so a limb aimed straight at the
 *    camera stays visible. The returned depth lets the renderer grow hand markers that come
 *    toward the viewer, the same cue perspective gives in the 3D view.
 *  - Rotation-only limbs rotate the T-pose rest direction with the poser's Euler orders
 *    (YXZ for arms, XYZ otherwise); a rotated parent carries its child, as bone hierarchy does.
 *  - Shoulders and hips are fixed; torso rotations only pitch/roll the head. `yOffset` is ignored.
 *
 * Pure module: no DOM, no three.js, deterministic output for the same preset.
 */
import { EXTRA_POSE_PRESETS, NATURAL_IDLE_POSES } from "../studio-pose-presets";

import type { PoseBoneSpec, PoseDirectionTarget, PoseVec3, StudioPosePreset } from "../studio-pose-presets";
import type { CharacterPoseGlyphFigure } from "./character-shaper-contract";

type Vec3 = readonly [number, number, number];
type Point = readonly [number, number];
type EulerOrder = "XYZ" | "YXZ";
type SideSign = 1 | -1;

/** Hand/foot depth in −1..1; positive comes toward the viewer. */
export interface CharacterPoseGlyphDepth {
  readonly leftHand: number;
  readonly rightHand: number;
  readonly leftFoot: number;
  readonly rightFoot: number;
}

export interface CharacterPoseGlyphDetail {
  readonly figure: CharacterPoseGlyphFigure;
  readonly depth: CharacterPoseGlyphDepth;
}

export interface CharacterPoseGlyphJoints {
  readonly leftShoulder: Point;
  readonly rightShoulder: Point;
  readonly leftHip: Point;
  readonly rightHip: Point;
}

/* -------------------------------------------------------------------------- */
/* Figure geometry (unit box, y down)                                          */
/* -------------------------------------------------------------------------- */

const HIPS: Point = [0.5, 0.56];
const NECK: Point = [0.5, 0.35];
/** Neck → head centre when the head is upright. */
const HEAD_OFFSET = 0.085;
const SHOULDER_HALF = 0.085;
const SHOULDER_DROP = 0.015;
const HIP_HALF = 0.045;
const UPPER_ARM = 0.125;
const LOWER_ARM = 0.115;
const UPPER_LEG = 0.165;
const LOWER_LEG = 0.155;
/** Minimum drawn fraction of a segment, so limbs pointing at the camera keep a stub. */
const MIN_PLANAR = 0.28;
const MAX_HEAD_PITCH = (70 * Math.PI) / 180;
const MAX_HEAD_ROLL = (35 * Math.PI) / 180;
const EDGE = 0.02;

const REST_LEFT_ARM: Vec3 = [1, 0, 0];
const REST_RIGHT_ARM: Vec3 = [-1, 0, 0];
const REST_LEG: Vec3 = [0, -1, 0];

/** Shoulders and hips never move in the glyph; torso rotation only reaches the head. */
const FRAME_JOINTS: CharacterPoseGlyphJoints = Object.freeze({
  leftShoulder: [NECK[0] + SHOULDER_HALF, NECK[1] + SHOULDER_DROP] as Point,
  rightShoulder: [NECK[0] - SHOULDER_HALF, NECK[1] + SHOULDER_DROP] as Point,
  leftHip: [HIPS[0] + HIP_HALF, HIPS[1]] as Point,
  rightHip: [HIPS[0] - HIP_HALF, HIPS[1]] as Point,
});

/* -------------------------------------------------------------------------- */
/* Vector helpers                                                              */
/* -------------------------------------------------------------------------- */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function normalize(vector: Vec3): Vec3 | null {
  const x = finite(vector[0]);
  const y = finite(vector[1]);
  const z = finite(vector[2]);
  const length = Math.hypot(x, y, z);
  if (length < 1e-6) return null;
  return [x / length, y / length, z / length];
}

function rotateX(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}

function rotateY(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

function rotateZ(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}

/** three.js intrinsic Euler: XYZ → Rx·Ry·Rz, YXZ → Ry·Rx·Rz. */
function rotateEuler(v: Vec3, rotation: PoseVec3, order: EulerOrder): Vec3 {
  const x = finite(rotation[0]);
  const y = finite(rotation[1]);
  const z = finite(rotation[2]);
  const afterZ = rotateZ(v, z);
  return order === "YXZ" ? rotateY(rotateX(afterZ, x), y) : rotateX(rotateY(afterZ, y), x);
}

function rotateAboutAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dot = axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2];
  const cross: Vec3 = [
    axis[1] * v[2] - axis[2] * v[1],
    axis[2] * v[0] - axis[0] * v[2],
    axis[0] * v[1] - axis[1] * v[0],
  ];
  const k = (1 - c) * dot;
  return [
    v[0] * c + cross[0] * s + axis[0] * k,
    v[1] * c + cross[1] * s + axis[1] * k,
    v[2] * c + cross[2] * s + axis[2] * k,
  ];
}

const identity = (v: Vec3): Vec3 => v;

/** Rotation that carries unit `from` onto unit `to` (setFromUnitVectors), as a vector transform. */
function alignRotation(from: Vec3, to: Vec3): (v: Vec3) => Vec3 {
  const dot = clamp(from[0] * to[0] + from[1] * to[1] + from[2] * to[2], -1, 1);
  const cross: Vec3 = [
    from[1] * to[2] - from[2] * to[1],
    from[2] * to[0] - from[0] * to[2],
    from[0] * to[1] - from[1] * to[0],
  ];
  const sine = Math.hypot(cross[0], cross[1], cross[2]);
  if (sine < 1e-6) {
    if (dot > 0) return identity;
    // Antiparallel: any axis orthogonal to `from` works; pick the most stable one.
    const orthogonal: Vec3 = Math.abs(from[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const axis = normalize([
      from[1] * orthogonal[2] - from[2] * orthogonal[1],
      from[2] * orthogonal[0] - from[0] * orthogonal[2],
      from[0] * orthogonal[1] - from[1] * orthogonal[0],
    ]) ?? [0, 0, 1];
    return (v) => rotateAboutAxis(v, axis, Math.PI);
  }
  const axis: Vec3 = [cross[0] / sine, cross[1] / sine, cross[2] / sine];
  const angle = Math.atan2(sine, dot);
  return (v) => rotateAboutAxis(v, axis, angle);
}

/* -------------------------------------------------------------------------- */
/* Bone resolution                                                             */
/* -------------------------------------------------------------------------- */

type BoneMap = Readonly<Partial<Record<string, PoseBoneSpec>>>;

function resolveTarget(target: PoseDirectionTarget, sideSign: SideSign): Vec3 | null {
  if ("sideX" in target) {
    return normalize([sideSign * finite(target.sideX), finite(target.y), finite(target.z ?? 0)]);
  }
  return normalize([finite(target[0]), finite(target[1]), finite(target[2])]);
}

interface LimbDirections {
  readonly upper: Vec3;
  readonly lower: Vec3;
}

function resolveLimb(
  upperSpec: PoseBoneSpec | undefined,
  lowerSpec: PoseBoneSpec | undefined,
  rest: Vec3,
  sideSign: SideSign,
  order: EulerOrder,
): LimbDirections {
  let upper = rest;
  let frame = identity;
  if (upperSpec?.direction) {
    const target = resolveTarget(upperSpec.direction, sideSign);
    if (target) {
      upper = target;
      frame = alignRotation(rest, target);
    }
  } else if (upperSpec?.rotation) {
    const rotation = upperSpec.rotation;
    frame = (v) => rotateEuler(v, rotation, order);
    upper = normalize(frame(rest)) ?? rest;
  }

  let lower = upper;
  if (lowerSpec?.direction) {
    lower = resolveTarget(lowerSpec.direction, sideSign) ?? upper;
  } else if (lowerSpec?.rotation) {
    lower = normalize(frame(rotateEuler(rest, lowerSpec.rotation, order))) ?? upper;
  }
  return { upper, lower };
}

function sumRotation(bones: BoneMap, names: readonly string[], axis: 0 | 1 | 2): number {
  let total = 0;
  for (const name of names) {
    const rotation = bones[name]?.rotation;
    if (rotation) total += finite(rotation[axis]);
  }
  return total;
}

/* -------------------------------------------------------------------------- */
/* Projection                                                                  */
/* -------------------------------------------------------------------------- */

function projectSegment(origin: Point, direction: Vec3, length: number, fallback: Point): Point {
  const px = direction[0];
  const py = -direction[1];
  const planar = Math.hypot(px, py);
  const ux = planar < 1e-3 ? fallback[0] : px / planar;
  const uy = planar < 1e-3 ? fallback[1] : py / planar;
  const drawn = length * Math.max(planar, MIN_PLANAR);
  return [origin[0] + ux * drawn, origin[1] + uy * drawn];
}

function segmentDepth(limb: LimbDirections, upperLength: number, lowerLength: number): number {
  const total = upperLength + lowerLength;
  return clamp((limb.upper[2] * upperLength + limb.lower[2] * lowerLength) / total, -1, 1);
}

function settle(point: Point): Point {
  return [
    Math.round(clamp(finite(point[0]), EDGE, 1 - EDGE) * 1e4) / 1e4,
    Math.round(clamp(finite(point[1]), EDGE, 1 - EDGE) * 1e4) / 1e4,
  ];
}

function round(value: number): number {
  return Math.round(clamp(finite(value), -1, 1) * 1e4) / 1e4;
}

const HEAD_PITCH_BONES = ["spine", "chest", "upperChest", "neck", "head"] as const;
const HEAD_ROLL_BONES = ["hips", "spine", "chest", "upperChest", "neck", "head"] as const;

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/** Joints the figure implies but does not carry (shoulders/hips are fixed offsets). */
export function characterPoseGlyphJoints(figure: CharacterPoseGlyphFigure): CharacterPoseGlyphJoints {
  return {
    leftShoulder: [figure.neck[0] + SHOULDER_HALF, figure.neck[1] + SHOULDER_DROP],
    rightShoulder: [figure.neck[0] - SHOULDER_HALF, figure.neck[1] + SHOULDER_DROP],
    leftHip: [figure.hips[0] + HIP_HALF, figure.hips[1]],
    rightHip: [figure.hips[0] - HIP_HALF, figure.hips[1]],
  };
}

/** Builds the pose glyph plus per-extremity depth for a preset (never throws on odd data). */
export function buildCharacterPoseGlyphDetail(preset: StudioPosePreset): CharacterPoseGlyphDetail {
  const bones: BoneMap = preset.bones ?? {};
  const joints = FRAME_JOINTS;

  const leftArm = resolveLimb(bones.leftUpperArm, bones.leftLowerArm, REST_LEFT_ARM, 1, "YXZ");
  const rightArm = resolveLimb(bones.rightUpperArm, bones.rightLowerArm, REST_RIGHT_ARM, -1, "YXZ");
  const leftLeg = resolveLimb(bones.leftUpperLeg, bones.leftLowerLeg, REST_LEG, 1, "XYZ");
  const rightLeg = resolveLimb(bones.rightUpperLeg, bones.rightLowerLeg, REST_LEG, -1, "XYZ");

  const leftElbow = projectSegment(joints.leftShoulder, leftArm.upper, UPPER_ARM, [0.5, 0.87]);
  const leftHand = projectSegment(leftElbow, leftArm.lower, LOWER_ARM, [0.5, 0.87]);
  const rightElbow = projectSegment(joints.rightShoulder, rightArm.upper, UPPER_ARM, [-0.5, 0.87]);
  const rightHand = projectSegment(rightElbow, rightArm.lower, LOWER_ARM, [-0.5, 0.87]);
  const leftKnee = projectSegment(joints.leftHip, leftLeg.upper, UPPER_LEG, [0, 1]);
  const leftFoot = projectSegment(leftKnee, leftLeg.lower, LOWER_LEG, [0, 1]);
  const rightKnee = projectSegment(joints.rightHip, rightLeg.upper, UPPER_LEG, [0, 1]);
  const rightFoot = projectSegment(rightKnee, rightLeg.lower, LOWER_LEG, [0, 1]);

  const pitch = clamp(sumRotation(bones, HEAD_PITCH_BONES, 0), -MAX_HEAD_PITCH, MAX_HEAD_PITCH);
  const roll = clamp(sumRotation(bones, HEAD_ROLL_BONES, 2), -MAX_HEAD_ROLL, MAX_HEAD_ROLL);
  const head: Point = [NECK[0] - Math.sin(roll) * HEAD_OFFSET, NECK[1] - Math.cos(pitch) * HEAD_OFFSET];

  return {
    figure: Object.freeze({
      head: settle(head),
      neck: settle(NECK),
      hips: settle(HIPS),
      leftHand: settle(leftHand),
      rightHand: settle(rightHand),
      leftElbow: settle(leftElbow),
      rightElbow: settle(rightElbow),
      leftKnee: settle(leftKnee),
      rightKnee: settle(rightKnee),
      leftFoot: settle(leftFoot),
      rightFoot: settle(rightFoot),
    }),
    depth: Object.freeze({
      leftHand: round(segmentDepth(leftArm, UPPER_ARM, LOWER_ARM)),
      rightHand: round(segmentDepth(rightArm, UPPER_ARM, LOWER_ARM)),
      leftFoot: round(segmentDepth(leftLeg, UPPER_LEG, LOWER_LEG)),
      rightFoot: round(segmentDepth(rightLeg, UPPER_LEG, LOWER_LEG)),
    }),
  };
}

/** Front-view stick figure for a preset; normalized joints in a 0..1 box, y down. */
export function buildCharacterPoseGlyph(preset: StudioPosePreset): CharacterPoseGlyphFigure {
  return buildCharacterPoseGlyphDetail(preset).figure;
}

/** Bundled presets the pose slot exposes, in shelf order. */
export const CHARACTER_POSE_GLYPH_PRESETS: readonly StudioPosePreset[] = Object.freeze([
  ...NATURAL_IDLE_POSES,
  ...EXTRA_POSE_PRESETS,
]);

const PRESETS_BY_ID: ReadonlyMap<string, StudioPosePreset> = new Map(
  CHARACTER_POSE_GLYPH_PRESETS.map((preset) => [preset.id, preset] as const),
);

export function findCharacterPosePreset(presetId: string): StudioPosePreset | null {
  return PRESETS_BY_ID.get(presetId) ?? null;
}

/** Relaxed attention — the same limb aims `BASE_LIMBS` uses for every bundled preset. */
const STANDING_PRESET: StudioPosePreset = {
  id: "character-shaper:standing",
  label: "차렷",
  tone: "기본 서기",
  bones: {
    leftUpperArm: { direction: { sideX: 0.28, y: -0.96, z: 0.02 } },
    rightUpperArm: { direction: { sideX: 0.3, y: -0.95, z: 0.03 } },
    leftLowerArm: { direction: { sideX: 0.14, y: -0.98, z: 0.14 } },
    rightLowerArm: { direction: { sideX: 0.16, y: -0.97, z: 0.16 } },
    leftUpperLeg: { direction: { sideX: 0.06, y: -1 } },
    rightUpperLeg: { direction: { sideX: 0.08, y: -1 } },
    leftLowerLeg: { direction: { sideX: 0.02, y: -1 } },
    rightLowerLeg: { direction: { sideX: 0.03, y: -1 } },
  },
};

const STANDING_DETAIL: CharacterPoseGlyphDetail = buildCharacterPoseGlyphDetail(STANDING_PRESET);

/** Fallback glyph for unknown preset ids: relaxed standing, arms at the sides. */
export const STANDING_CHARACTER_POSE_GLYPH: CharacterPoseGlyphFigure = STANDING_DETAIL.figure;

const detailCache = new Map<string, CharacterPoseGlyphDetail>();

/** Resolves a bundled preset id (NATURAL_IDLE_POSES + EXTRA_POSE_PRESETS); unknown → standing. */
export function resolveCharacterPoseGlyphDetail(presetId: string): CharacterPoseGlyphDetail {
  const preset = findCharacterPosePreset(presetId);
  if (!preset) return STANDING_DETAIL;
  const cached = detailCache.get(presetId);
  if (cached) return cached;
  const detail = buildCharacterPoseGlyphDetail(preset);
  detailCache.set(presetId, detail);
  return detail;
}

export function resolveCharacterPoseGlyph(presetId: string): CharacterPoseGlyphFigure {
  return resolveCharacterPoseGlyphDetail(presetId).figure;
}

/**
 * Polylines to stroke, in draw order: spine (hips → neck → head), left arm, right arm, left leg,
 * right leg. Shoulder and hip joints come from `characterPoseGlyphJoints`.
 */
export function characterPoseGlyphToPolyline(figure: CharacterPoseGlyphFigure): readonly (readonly Point[])[] {
  const joints = characterPoseGlyphJoints(figure);
  return [
    [figure.hips, figure.neck, figure.head],
    [joints.rightShoulder, joints.leftShoulder],
    [joints.leftShoulder, figure.leftElbow, figure.leftHand],
    [joints.rightShoulder, figure.rightElbow, figure.rightHand],
    [joints.leftHip, figure.leftKnee, figure.leftFoot],
    [joints.rightHip, figure.rightKnee, figure.rightFoot],
  ];
}
