/**
 * Character animation P2 subset — joint limits, retarget report, spring bone, clips, onion pose.
 */

import {
  createStudioDefaultBodyPose,
  type StudioBodyPoseState,
  type StudioIkFkVec3,
} from "./studio-character-ik-fk";

export const STUDIO_CHARACTER_ANIM_P2_REVISION = 1 as const;

export interface StudioJointLimit {
  readonly bone: string;
  readonly minEuler: StudioIkFkVec3;
  readonly maxEuler: StudioIkFkVec3;
}

export function clampStudioJointRotation(
  euler: StudioIkFkVec3,
  limit: StudioJointLimit,
): { readonly rotation: StudioIkFkVec3; readonly clamped: boolean } {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const rotation: StudioIkFkVec3 = [
    clamp(euler[0], limit.minEuler[0], limit.maxEuler[0]),
    clamp(euler[1], limit.minEuler[1], limit.maxEuler[1]),
    clamp(euler[2], limit.minEuler[2], limit.maxEuler[2]),
  ];
  const clamped =
    rotation[0] !== euler[0] || rotation[1] !== euler[1] || rotation[2] !== euler[2];
  return { rotation, clamped };
}

export interface StudioRetargetReport {
  readonly source: string;
  readonly target: string;
  readonly axisCorrection: StudioIkFkVec3;
  readonly scale: number;
  readonly missingBones: readonly string[];
  readonly twistFixed: readonly string[];
  readonly ok: boolean;
}

export function retargetStudioMotionReport(input: {
  readonly source: string;
  readonly target: string;
  readonly sourceBones: readonly string[];
  readonly targetBones: readonly string[];
  readonly sourceUp: "y" | "z";
  readonly targetUp: "y" | "z";
  readonly sourceUnit: number;
  readonly targetUnit: number;
}): StudioRetargetReport {
  const targetSet = new Set(input.targetBones);
  const missingBones = input.sourceBones.filter((b) => !targetSet.has(b));
  const axisCorrection: StudioIkFkVec3 =
    input.sourceUp === input.targetUp ? [0, 0, 0] : [-Math.PI / 2, 0, 0];
  const scale =
    input.targetUnit > 0 && input.sourceUnit > 0
      ? input.targetUnit / input.sourceUnit
      : 1;
  return {
    source: input.source,
    target: input.target,
    axisCorrection,
    scale,
    missingBones,
    twistFixed: missingBones.length === 0 ? ["hips", "spine"] : [],
    ok: missingBones.length < input.sourceBones.length * 0.5,
  };
}

export interface StudioSpringBone {
  readonly id: string;
  readonly head: StudioIkFkVec3;
  readonly tail: StudioIkFkVec3;
  readonly stiffness: number;
  readonly drag: number;
  readonly gravity: StudioIkFkVec3;
  readonly velocity: StudioIkFkVec3;
}

export function stepStudioSpringBone(
  bone: StudioSpringBone,
  dt: number,
): StudioSpringBone {
  const h = Math.max(1e-4, dt);
  // Verlet-ish: pull tail toward rest length with stiffness
  const rest = Math.hypot(
    bone.tail[0] - bone.head[0],
    bone.tail[1] - bone.head[1],
    bone.tail[2] - bone.head[2],
  ) || 0.1;
  let vx = bone.velocity[0] + bone.gravity[0] * h;
  let vy = bone.velocity[1] + bone.gravity[1] * h;
  let vz = bone.velocity[2] + bone.gravity[2] * h;
  vx *= 1 - bone.drag * h;
  vy *= 1 - bone.drag * h;
  vz *= 1 - bone.drag * h;
  let tx = bone.tail[0] + vx * h;
  let ty = bone.tail[1] + vy * h;
  let tz = bone.tail[2] + vz * h;
  const dx = tx - bone.head[0];
  const dy = ty - bone.head[1];
  const dz = tz - bone.head[2];
  const dist = Math.hypot(dx, dy, dz) || 1e-8;
  const corr = (rest - dist) * bone.stiffness;
  tx += (dx / dist) * corr;
  ty += (dy / dist) * corr;
  tz += (dz / dist) * corr;
  return {
    ...bone,
    tail: [tx, ty, tz],
    velocity: [(tx - bone.tail[0]) / h, (ty - bone.tail[1]) / h, (tz - bone.tail[2]) / h],
  };
}

export interface StudioAnimationClip {
  readonly id: string;
  readonly name: string;
  readonly duration: number;
  readonly loop: boolean;
  readonly keys: readonly {
    readonly time: number;
    readonly bone: string;
    readonly rotation: StudioIkFkVec3;
  }[];
}

export function sampleStudioAnimationClip(
  clip: StudioAnimationClip,
  time: number,
): Readonly<Record<string, StudioIkFkVec3>> {
  const t = clip.loop
    ? ((time % clip.duration) + clip.duration) % clip.duration
    : Math.max(0, Math.min(clip.duration, time));
  const byBone = new Map<string, { t: number; r: StudioIkFkVec3 }[]>();
  for (const k of clip.keys) {
    const list = byBone.get(k.bone) ?? [];
    list.push({ t: k.time, r: k.rotation });
    byBone.set(k.bone, list);
  }
  const out: Record<string, StudioIkFkVec3> = {};
  for (const [bone, keys] of byBone) {
    keys.sort((a, b) => a.t - b.t);
    if (keys.length === 0) continue;
    if (t <= keys[0]!.t) {
      out[bone] = keys[0]!.r;
      continue;
    }
    if (t >= keys[keys.length - 1]!.t) {
      out[bone] = keys[keys.length - 1]!.r;
      continue;
    }
    for (let i = 0; i + 1 < keys.length; i += 1) {
      const a = keys[i]!;
      const b = keys[i + 1]!;
      if (t >= a.t && t <= b.t) {
        const u = (t - a.t) / Math.max(1e-8, b.t - a.t);
        out[bone] = [
          a.r[0] + (b.r[0] - a.r[0]) * u,
          a.r[1] + (b.r[1] - a.r[1]) * u,
          a.r[2] + (b.r[2] - a.r[2]) * u,
        ];
        break;
      }
    }
  }
  return out;
}

/** CHR-015 onion/ghost pose compare */
export function diffStudioPoses(
  a: StudioBodyPoseState,
  b: StudioBodyPoseState,
): {
  readonly boneDeltas: readonly { readonly bone: string; readonly distance: number }[];
  readonly maxDistance: number;
} {
  const boneDeltas: { bone: string; distance: number }[] = [];
  let maxDistance = 0;
  for (const name of Object.keys(a.bones)) {
    const pa = a.bones[name]?.position;
    const pb = b.bones[name]?.position;
    if (!pa || !pb) continue;
    const d = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
    boneDeltas.push({ bone: name, distance: d });
    maxDistance = Math.max(maxDistance, d);
  }
  return { boneDeltas: boneDeltas.sort((x, y) => y.distance - x.distance), maxDistance };
}

export function createStudioIdleClip(): StudioAnimationClip {
  return {
    id: "idle",
    name: "Idle",
    duration: 2,
    loop: true,
    keys: [
      { time: 0, bone: "spine", rotation: [0, 0, 0] },
      { time: 1, bone: "spine", rotation: [0.05, 0, 0] },
      { time: 2, bone: "spine", rotation: [0, 0, 0] },
    ],
  };
}

export { createStudioDefaultBodyPose };
