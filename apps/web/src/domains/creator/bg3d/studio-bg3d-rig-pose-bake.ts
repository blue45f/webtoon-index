import {
  normalizeStudioBg3dAnimationPlayback,
  normalizeStudioBg3dPoseLayer,
  type StudioBg3dAnimationPlayback,
  type StudioBg3dPoseLayer,
  type StudioBg3dQuaternion,
} from "./studio-bg3d-scene-document";

const QUATERNION_MIN_MAGNITUDE = 1e-8;
const IDENTITY_VECTOR_EPSILON = 1e-8;
const MAX_JOINT_KEY_LENGTH = 128;
const MAX_POSE_JOINT_OFFSETS = 256;

export interface StudioBg3dRigPoseBakeSample {
  readonly jointKey: string;
  /** Local rotation sampled before procedural constraints run. */
  readonly baseRotation: StudioBg3dQuaternion;
  /** Local rotation sampled after procedural constraints run. */
  readonly outputRotation: StudioBg3dQuaternion;
}

export interface StudioBg3dRigPoseBakeSnapshot {
  readonly pose: StudioBg3dPoseLayer;
  readonly sampledTimeSeconds: number;
}

export interface StudioBg3dRigPoseBakeCommitPatch {
  readonly animation: StudioBg3dAnimationPlayback | undefined;
  readonly pose: StudioBg3dPoseLayer;
  readonly constraints: undefined;
}

export interface StudioBg3dRigPoseBakeHistoryTransition {
  /** Exact live playback state immediately before the destructive constraint bake. */
  readonly beforeAnimation: StudioBg3dAnimationPlayback | undefined;
  /** Paused animation, canonical baked pose, and removed procedural constraints. */
  readonly patch: StudioBg3dRigPoseBakeCommitPatch;
}

function normalizeJointKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return null;
  }
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  return normalized && Array.from(normalized).length <= MAX_JOINT_KEY_LENGTH
    ? normalized
    : null;
}

function canonicalZero(value: number): number {
  return value === 0 ? 0 : value;
}

/**
 * Normalizes a quaternion and chooses one stable representative for the equivalent `q`/`-q`
 * pair. SceneDocument already canonicalizes negative `w`; the spatial tie-breaker also makes exact
 * half-turns (`w === 0`) deterministic.
 */
function normalizeQuaternion(value: unknown): StudioBg3dQuaternion | null {
  if (
    !Array.isArray(value)
    || value.length !== 4
    || value.some((component) => typeof component !== "number" || !Number.isFinite(component))
  ) {
    return null;
  }

  const magnitude = Math.hypot(value[0], value[1], value[2], value[3]);
  if (!Number.isFinite(magnitude) || magnitude < QUATERNION_MIN_MAGNITUDE) return null;

  const normalized = [
    value[0] / magnitude,
    value[1] / magnitude,
    value[2] / magnitude,
    value[3] / magnitude,
  ] as StudioBg3dQuaternion;
  let flip = normalized[3] < 0;
  if (normalized[3] === 0) {
    const firstNonZero = normalized.slice(0, 3).find((component) => component !== 0);
    flip = firstNonZero !== undefined && firstNonZero < 0;
  }
  const sign = flip ? -1 : 1;
  return [
    canonicalZero(normalized[0] * sign),
    canonicalZero(normalized[1] * sign),
    canonicalZero(normalized[2] * sign),
    canonicalZero(normalized[3] * sign),
  ];
}

/** Hamilton product for `[x, y, z, w]` quaternions. */
function multiplyQuaternions(
  left: StudioBg3dQuaternion,
  right: StudioBg3dQuaternion,
): StudioBg3dQuaternion {
  const [lx, ly, lz, lw] = left;
  const [rx, ry, rz, rw] = right;
  return [
    lw * rx + lx * rw + ly * rz - lz * ry,
    lw * ry - lx * rz + ly * rw + lz * rx,
    lw * rz + lx * ry - ly * rx + lz * rw,
    lw * rw - lx * rx - ly * ry - lz * rz,
  ];
}

function inverseUnitQuaternion(value: StudioBg3dQuaternion): StudioBg3dQuaternion {
  return [-value[0], -value[1], -value[2], value[3]];
}

/**
 * Converts static procedural rig output into an additive, engine-neutral SceneDocument pose layer.
 *
 * Each offset is `inverse(baseRotation) * outputRotation`, matching the model runtime's local-space
 * post-animation pose convention. Invalid input fails closed. Identity offsets are omitted, while
 * the relative order of every retained sample is preserved.
 */
export function bakeStudioBg3dRigPoseLayer(
  samples: readonly StudioBg3dRigPoseBakeSample[],
): StudioBg3dPoseLayer | null {
  if (!Array.isArray(samples)) return null;

  const keys = new Set<string>();
  const joints: Array<{ jointKey: string; rotationOffset: StudioBg3dQuaternion }> = [];
  for (const sample of samples) {
    if (typeof sample !== "object" || sample === null) return null;
    const jointKey = normalizeJointKey(sample.jointKey);
    const baseRotation = normalizeQuaternion(sample.baseRotation);
    const outputRotation = normalizeQuaternion(sample.outputRotation);
    if (!jointKey || !baseRotation || !outputRotation || keys.has(jointKey)) return null;
    keys.add(jointKey);

    const rotationOffset = normalizeQuaternion(multiplyQuaternions(
      inverseUnitQuaternion(baseRotation),
      outputRotation,
    ));
    if (!rotationOffset) return null;
    if (Math.hypot(rotationOffset[0], rotationOffset[1], rotationOffset[2]) <= IDENTITY_VECTOR_EPSILON) {
      continue;
    }
    joints.push({ jointKey, rotationOffset });
  }

  // Reuse SceneDocument's canonical 256-joint cap and deep-freeze boundary. Reject the retained
  // collection before entering the throwing persistence normalizer so this user-command boundary
  // keeps its documented null-on-invalid contract.
  if (joints.length > MAX_POSE_JOINT_OFFSETS) return null;

  // A length mismatch means
  // normalization would have dropped or truncated data, which this bake operation must never hide.
  const normalized = normalizeStudioBg3dPoseLayer({ enabled: true, weight: 1, joints });
  return normalized && normalized.joints.length === joints.length ? normalized : null;
}

/**
 * Creates the complete atomic model patch for the user-facing constraint bake command. The current
 * animation is paused at the exact rendered sample, the canonical weight-1 pose replaces any prior
 * pose layer, and procedural constraints are removed. Callers spread this patch over the model in a
 * single history mutation so unrelated material/morph/transform state is retained.
 */
export function createStudioBg3dRigPoseBakeCommitPatch(
  currentAnimation: StudioBg3dAnimationPlayback | undefined,
  snapshot: StudioBg3dRigPoseBakeSnapshot,
): StudioBg3dRigPoseBakeCommitPatch | null {
  if (
    typeof snapshot !== "object" || snapshot === null ||
    !Number.isFinite(snapshot.sampledTimeSeconds) || snapshot.sampledTimeSeconds < 0
  ) return null;
  const pose = normalizeStudioBg3dPoseLayer(snapshot.pose);
  if (!pose || !pose.enabled || pose.weight !== 1) return null;
  let animation: StudioBg3dAnimationPlayback | undefined;
  if (currentAnimation) {
    const normalizedAnimation = normalizeStudioBg3dAnimationPlayback({
      ...currentAnimation,
      playing: false,
      timeSeconds: snapshot.sampledTimeSeconds,
    });
    if (!normalizedAnimation) return null;
    animation = normalizedAnimation;
  }
  return Object.freeze({ animation, pose, constraints: undefined });
}

/**
 * Builds both halves of one atomic history command.
 *
 * A playing mixer advances without writing every frame into SceneDocument. Capturing only the
 * stored playback would therefore make Undo jump back to the last edited timestamp. For playing
 * mixers the before half keeps `playing` while replacing its timestamp with the sampled frame.
 * Paused playback retains its exact authored timestamp (which can intentionally lie outside a
 * looping clip); the after half always pauses at the rendered sample through the normal bake patch.
 */
export function createStudioBg3dRigPoseBakeHistoryTransition(
  currentAnimation: StudioBg3dAnimationPlayback | undefined,
  snapshot: StudioBg3dRigPoseBakeSnapshot,
): StudioBg3dRigPoseBakeHistoryTransition | null {
  const patch = createStudioBg3dRigPoseBakeCommitPatch(currentAnimation, snapshot);
  if (!patch) return null;

  let beforeAnimation: StudioBg3dAnimationPlayback | undefined;
  if (currentAnimation) {
    if (!currentAnimation.playing) {
      beforeAnimation = currentAnimation;
    } else {
      const normalizedBeforeAnimation = normalizeStudioBg3dAnimationPlayback({
        ...currentAnimation,
        timeSeconds: snapshot.sampledTimeSeconds,
      });
      if (!normalizedBeforeAnimation) return null;
      beforeAnimation = normalizedBeforeAnimation;
    }
  }
  return Object.freeze({ beforeAnimation, patch });
}
