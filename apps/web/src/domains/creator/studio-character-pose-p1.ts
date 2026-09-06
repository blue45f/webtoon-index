/**
 * Character P1 subset: humanoid mapping diagnostics, hand pose library, expression mixer,
 * lookAt, pose asset metadata (CHR-002, 007–009, 018). Builds on existing VRM modules.
 */

export const STUDIO_CHARACTER_POSE_P1_REVISION = 1 as const;

export const STUDIO_VRM_HUMANOID_BONES = [
  "hips",
  "spine",
  "chest",
  "upperChest",
  "neck",
  "head",
  "leftShoulder",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  "rightShoulder",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "leftToes",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
  "rightToes",
] as const;

export type StudioVrmHumanoidBone = (typeof STUDIO_VRM_HUMANOID_BONES)[number];

export interface StudioHumanoidBoneMapping {
  readonly bone: StudioVrmHumanoidBone;
  readonly nodeName: string | null;
}

export interface StudioHumanoidMappingReport {
  readonly revision: typeof STUDIO_CHARACTER_POSE_P1_REVISION;
  readonly mapped: readonly StudioHumanoidBoneMapping[];
  readonly missing: readonly StudioVrmHumanoidBone[];
  readonly extraNodeNames: readonly string[];
  readonly complete: boolean;
}

export function diagnoseStudioHumanoidMapping(
  nodeNames: readonly string[],
  mapping: Readonly<Partial<Record<StudioVrmHumanoidBone, string>>>,
): StudioHumanoidMappingReport {
  const nodes = new Set(nodeNames);
  const mapped: StudioHumanoidBoneMapping[] = [];
  const missing: StudioVrmHumanoidBone[] = [];
  const used = new Set<string>();
  for (const bone of STUDIO_VRM_HUMANOID_BONES) {
    const nodeName = mapping[bone] ?? null;
    if (nodeName && nodes.has(nodeName)) {
      mapped.push({ bone, nodeName });
      used.add(nodeName);
    } else {
      missing.push(bone);
      mapped.push({ bone, nodeName: null });
    }
  }
  const extraNodeNames = nodeNames.filter((n) => !used.has(n)).sort();
  // Core body subset required for "complete" posing
  const core: StudioVrmHumanoidBone[] = [
    "hips",
    "spine",
    "head",
    "leftUpperArm",
    "leftHand",
    "rightUpperArm",
    "rightHand",
    "leftUpperLeg",
    "leftFoot",
    "rightUpperLeg",
    "rightFoot",
  ];
  const complete = core.every((b) => mapping[b] && nodes.has(mapping[b]!));
  return {
    revision: STUDIO_CHARACTER_POSE_P1_REVISION,
    mapped,
    missing,
    extraNodeNames,
    complete,
  };
}

export type StudioHandSide = "left" | "right";

export interface StudioHandPosePreset {
  readonly id: string;
  readonly label: string;
  readonly side: StudioHandSide | "both";
  /** Finger curl 0 open … 1 fist for thumb,index,middle,ring,little */
  readonly curls: readonly [number, number, number, number, number];
  readonly gripObject?: string;
}

export const STUDIO_HAND_POSE_LIBRARY: readonly StudioHandPosePreset[] = [
  {
    id: "open",
    label: "Open",
    side: "both",
    curls: [0, 0, 0, 0, 0],
  },
  {
    id: "fist",
    label: "Fist",
    side: "both",
    curls: [0.9, 1, 1, 1, 1],
  },
  {
    id: "point",
    label: "Point",
    side: "both",
    curls: [0.6, 0, 1, 1, 1],
  },
  {
    id: "grip-cup",
    label: "Grip Cup",
    side: "both",
    curls: [0.5, 0.55, 0.55, 0.55, 0.5],
    gripObject: "cup",
  },
  {
    id: "peace",
    label: "Peace",
    side: "both",
    curls: [0.4, 0, 0, 1, 1],
  },
];

export function mirrorStudioHandPose(
  preset: StudioHandPosePreset,
  side: StudioHandSide,
): StudioHandPosePreset {
  return {
    ...preset,
    id: `${preset.id}-${side}`,
    side,
  };
}

export interface StudioExpressionChannel {
  readonly name: string;
  readonly weight: number;
}

export interface StudioExpressionMixerState {
  readonly channels: readonly StudioExpressionChannel[];
  readonly materialBinds: Readonly<Record<string, number>>;
}

export function mixStudioExpressions(
  channels: readonly StudioExpressionChannel[],
): StudioExpressionMixerState {
  const clamped = channels.map((c) => ({
    name: c.name,
    weight: Math.max(0, Math.min(1, c.weight)),
  }));
  // Merge duplicate names by max weight
  const map = new Map<string, number>();
  for (const c of clamped) {
    map.set(c.name, Math.max(map.get(c.name) ?? 0, c.weight));
  }
  const merged = [...map.entries()]
    .map(([name, weight]) => ({ name, weight }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const materialBinds: Record<string, number> = {};
  for (const c of merged) {
    if (c.name.startsWith("mat:")) {
      materialBinds[c.name.slice(4)] = c.weight;
    }
  }
  return { channels: merged, materialBinds };
}

export interface StudioLookAtState {
  readonly target: "camera" | "object" | "world";
  readonly targetId?: string;
  readonly worldPoint?: readonly [number, number, number];
  readonly eyeWeight: number;
  readonly headWeight: number;
}

export function createStudioLookAt(
  partial: Partial<StudioLookAtState> & Pick<StudioLookAtState, "target">,
): StudioLookAtState {
  return {
    target: partial.target,
    targetId: partial.targetId,
    worldPoint: partial.worldPoint,
    eyeWeight: Math.max(0, Math.min(1, partial.eyeWeight ?? 1)),
    headWeight: Math.max(0, Math.min(1, partial.headWeight ?? 0.35)),
  };
}

export interface StudioPoseAssetMetadata {
  readonly id: string;
  readonly label: string;
  readonly bodyType: string;
  readonly contact: readonly string[];
  readonly cameraHint: string | null;
  readonly rightsLicense: string;
  readonly creator: string;
  readonly tags: readonly string[];
}

export function createStudioPoseAssetMetadata(
  input: StudioPoseAssetMetadata,
): StudioPoseAssetMetadata {
  return {
    id: input.id,
    label: input.label,
    bodyType: input.bodyType,
    contact: [...input.contact],
    cameraHint: input.cameraHint,
    rightsLicense: input.rightsLicense,
    creator: input.creator,
    tags: [...input.tags].sort(),
  };
}

export interface StudioDecalPlacement {
  readonly id: string;
  readonly meshObjectId: string;
  readonly mode: "mesh" | "planar" | "camera-only";
  readonly uvOffset: readonly [number, number];
  readonly uvScale: readonly [number, number];
  readonly textureAssetId: string;
  readonly shotOnly: boolean;
}

export function createStudioDecalPlacement(
  input: StudioDecalPlacement,
): StudioDecalPlacement {
  return { ...input };
}

export interface StudioKtx2DerivativeProfile {
  readonly profile: "mobile" | "desktop";
  readonly maxExtent: number;
  readonly format: "etc1s" | "uastc";
}

export function studioKtx2DerivativeForProfile(
  sourceExtent: number,
  profile: "mobile" | "desktop",
): StudioKtx2DerivativeProfile {
  if (profile === "mobile") {
    return {
      profile,
      maxExtent: Math.min(sourceExtent, 1024),
      format: "etc1s",
    };
  }
  return {
    profile,
    maxExtent: Math.min(sourceExtent, 4096),
    format: "uastc",
  };
}
