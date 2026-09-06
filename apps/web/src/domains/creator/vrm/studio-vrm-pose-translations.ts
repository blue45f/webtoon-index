import type { StudioVrmPoseMirrorScope } from "./studio-vrm-pose-editing";
import type { Vec3 } from "./studio-vrm-poser-utils";
import type { StudioVrmPoseTranslations } from "./studio-vrm-scene-document";

export const STUDIO_VRM_ROOT_TRANSLATION_LIMIT = 10;
export const STUDIO_VRM_HIPS_TRANSLATION_LIMIT = 2;
export const STUDIO_VRM_SPINE_TRANSLATION_LIMIT = 0.75;

export const EMPTY_STUDIO_VRM_POSE_TRANSLATIONS: StudioVrmPoseTranslations = Object.freeze({
  version: 1,
  root: Object.freeze([0, 0, 0]) as Vec3,
  hips: Object.freeze([0, 0, 0]) as Vec3,
  spine: Object.freeze([0, 0, 0]) as Vec3,
});

function finiteTuple(value: unknown, maximum: number): Vec3 | null {
  if (!Array.isArray(value)) return null;
  try {
    if (
      Object.getPrototypeOf(value) !== Array.prototype
      || Object.getOwnPropertySymbols(value).length > 0
    ) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
    const keys = Object.keys(descriptors);
    const lengthDescriptor = descriptors.length;
    if (
      keys.length !== 4
      || keys.some((key) => !["0", "1", "2", "length"].includes(key))
      || !lengthDescriptor
      || !("value" in lengthDescriptor)
      || lengthDescriptor.value !== 3
    ) return null;
    const coordinates: number[] = [];
    for (const key of ["0", "1", "2"] as const) {
      const descriptor = descriptors[key];
      if (
        !descriptor
        || !("value" in descriptor)
        || !descriptor.enumerable
        || typeof descriptor.value !== "number"
        || !Number.isFinite(descriptor.value)
        || Math.abs(descriptor.value) > maximum
      ) return null;
      coordinates.push(Object.is(descriptor.value, -0) ? 0 : descriptor.value);
    }
    return Object.freeze(coordinates) as unknown as Vec3;
  } catch {
    return null;
  }
}

/** Strictly copies the canonical v3 translation block without invoking accessors. */
export function normalizeStudioVrmPoseTranslations(
  value: unknown,
): StudioVrmPoseTranslations | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  let copy: Record<string, unknown>;
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    if (
      (prototype !== Object.prototype && prototype !== null)
      || Object.getOwnPropertySymbols(value).length > 0
      || keys.length !== 4
      || keys.some((key) => !["version", "root", "hips", "spine"].includes(key))
    ) return null;
    copy = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      copy[key] = descriptor.value;
    }
  } catch {
    return null;
  }
  if (copy.version !== 1) return null;
  const root = finiteTuple(copy.root, STUDIO_VRM_ROOT_TRANSLATION_LIMIT);
  const hips = finiteTuple(copy.hips, STUDIO_VRM_HIPS_TRANSLATION_LIMIT);
  const spine = finiteTuple(copy.spine, STUDIO_VRM_SPINE_TRANSLATION_LIMIT);
  if (!root || root[1] !== 0 || !hips || !spine) return null;
  return Object.freeze({ version: 1, root, hips, spine });
}

/** Returns a detached mutable tuple copy suitable for React state. */
export function cloneStudioVrmPoseTranslations(
  value: StudioVrmPoseTranslations,
): StudioVrmPoseTranslations {
  return {
    version: 1,
    root: [value.root[0], value.root[1], value.root[2]],
    hips: [value.hips[0], value.hips[1], value.hips[2]],
    spine: [value.spine[0], value.spine[1], value.spine[2]],
  };
}

/**
 * Mirrors canonical translation offsets without inventing per-limb ownership that the scene
 * format cannot represent. A full mirror reflects every horizontal offset; arm-only mirrors
 * reflect the spine reach offset; torso-only mirrors reflect the torso-local hips/spine offsets.
 * Leg-only mirroring deliberately leaves the shared root/hips placement unchanged.
 */
export function mirrorStudioVrmPoseTranslations(
  value: StudioVrmPoseTranslations,
  scope: StudioVrmPoseMirrorScope,
): StudioVrmPoseTranslations {
  const mirrorRoot = scope === "all";
  const mirrorHips = scope === "all" || scope === "torso";
  const mirrorSpine = scope === "all" || scope === "arms" || scope === "torso";
  return {
    version: 1,
    root: [mirrorRoot ? -value.root[0] : value.root[0], value.root[1], value.root[2]],
    hips: [mirrorHips ? -value.hips[0] : value.hips[0], value.hips[1], value.hips[2]],
    spine: [mirrorSpine ? -value.spine[0] : value.spine[0], value.spine[1], value.spine[2]],
  };
}
