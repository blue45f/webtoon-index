import {
  studioShared3dCharacterWorldTransform,
  type StudioShared3dCharacterSource,
} from "../studio-shared-3d-scene-bridge";

import {
  STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_RECEIPT_KIND,
  STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_RECEIPT_VERSION,
  type StudioBg3dSharedCharacterGroundingResult,
} from "./studio-bg3d-shared-character-grounding";

export const STUDIO_BG3D_SHARED_CHARACTER_CONTACT_SHADOW_LIMITS = Object.freeze({
  maximumAbsoluteWorldCoordinate: 10_000,
  minimumUpwardNormalY: 0.25,
  minimumWidthScale: 0.5,
  maximumWidthScale: 1.6,
  minimumNormalOffsetMeters: 0.002,
  maximumNormalOffsetMeters: 0.004,
  maximumBroadCenterTravelWidthFactor: 0.3,
});

export const STUDIO_BG3D_SHARED_CHARACTER_CONTACT_SHADOW_PROFILE = Object.freeze({
  coreRadiusXMeters: 0.24,
  coreRadiusYMeters: 0.14,
  broadRadiusXMeters: 0.62,
  broadRadiusYMeters: 0.34,
  coreOpacityAtUnitWidth: 0.34,
  broadOpacityAtUnitWidth: 0.14,
});

export type StudioBg3dSharedCharacterContactShadowVec2 = readonly [number, number];
export type StudioBg3dSharedCharacterContactShadowVec3 = readonly [number, number, number];
export type StudioBg3dSharedCharacterContactShadowQuaternion = readonly [
  number,
  number,
  number,
  number,
];

export interface StudioBg3dSharedCharacterContactShadowLobe {
  readonly kind: "core" | "broad";
  /** World-space centre, lifted 2–4mm from the support plane to avoid z-fighting. */
  readonly center: StudioBg3dSharedCharacterContactShadowVec3;
  /** Local XY radii. The renderer supplies a unit XY patch whose +Z is its normal. */
  readonly radii: StudioBg3dSharedCharacterContactShadowVec2;
  readonly opacity: number;
}

export interface StudioBg3dSharedCharacterContactShadowPlan {
  /** React-safe stable identity bound to both content runtime and placement generation. */
  readonly key: string;
  readonly elementId: string;
  readonly runtimeKey: string;
  readonly placementHash: `sha256:${string}`;
  readonly surfaceSource: "background-surface" | "stage-plane";
  readonly surfaceTargetEntityId: string | null;
  readonly normal: StudioBg3dSharedCharacterContactShadowVec3;
  /** Rotates a unit XY plane so local +Z follows `normal` and local +X follows character right. */
  readonly quaternion: StudioBg3dSharedCharacterContactShadowQuaternion;
  readonly lobes: readonly [
    StudioBg3dSharedCharacterContactShadowLobe,
    StudioBg3dSharedCharacterContactShadowLobe,
  ];
}

export interface PlanStudioBg3dSharedCharacterContactShadowsInput {
  readonly characters: readonly StudioShared3dCharacterSource[];
  readonly groundingResults: Readonly<
    Record<string, StudioBg3dSharedCharacterGroundingResult>
  >;
  readonly capturableElementIds: readonly string[];
  readonly includeInCapture: boolean;
}

const EMPTY_PLANS = Object.freeze([]) as readonly StudioBg3dSharedCharacterContactShadowPlan[];
const EPSILON = 1e-10;

function canonicalZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteWorldVec3(value: unknown): StudioBg3dSharedCharacterContactShadowVec3 | null {
  if (
    !Array.isArray(value)
    || value.length !== 3
    || !value.every((component) =>
      typeof component === "number"
      && Number.isFinite(component)
      && Math.abs(component) <=
        STUDIO_BG3D_SHARED_CHARACTER_CONTACT_SHADOW_LIMITS.maximumAbsoluteWorldCoordinate)
  ) return null;
  return [value[0], value[1], value[2]];
}

function normalize(
  value: StudioBg3dSharedCharacterContactShadowVec3,
): StudioBg3dSharedCharacterContactShadowVec3 | null {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (!Number.isFinite(length) || length <= EPSILON) return null;
  return [
    canonicalZero(value[0] / length),
    canonicalZero(value[1] / length),
    canonicalZero(value[2] / length),
  ];
}

function dot(
  left: StudioBg3dSharedCharacterContactShadowVec3,
  right: StudioBg3dSharedCharacterContactShadowVec3,
): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(
  left: StudioBg3dSharedCharacterContactShadowVec3,
  right: StudioBg3dSharedCharacterContactShadowVec3,
): StudioBg3dSharedCharacterContactShadowVec3 {
  return [
    canonicalZero(left[1] * right[2] - left[2] * right[1]),
    canonicalZero(left[2] * right[0] - left[0] * right[2]),
    canonicalZero(left[0] * right[1] - left[1] * right[0]),
  ];
}

function addNormalOffset(
  point: StudioBg3dSharedCharacterContactShadowVec3,
  normal: StudioBg3dSharedCharacterContactShadowVec3,
  offset: number,
): StudioBg3dSharedCharacterContactShadowVec3 | null {
  return finiteWorldVec3([
    canonicalZero(point[0] + normal[0] * offset),
    canonicalZero(point[1] + normal[1] * offset),
    canonicalZero(point[2] + normal[2] * offset),
  ]);
}

function canonicalQuaternion(
  value: StudioBg3dSharedCharacterContactShadowQuaternion,
): StudioBg3dSharedCharacterContactShadowQuaternion | null {
  const length = Math.hypot(value[0], value[1], value[2], value[3]);
  if (!Number.isFinite(length) || length <= EPSILON) return null;
  let normalized = value.map((component) => canonicalZero(component / length)) as [
    number,
    number,
    number,
    number,
  ];
  const firstNonZero = normalized.find((component) => Math.abs(component) > EPSILON) ?? 0;
  if (normalized[3] < -EPSILON || (Math.abs(normalized[3]) <= EPSILON && firstNonZero < 0)) {
    normalized = normalized.map((component) => canonicalZero(-component)) as typeof normalized;
  }
  return Object.freeze(normalized);
}

/** Converts an orthonormal basis, supplied as matrix columns, to a stable unit quaternion. */
function quaternionFromBasis(
  xAxis: StudioBg3dSharedCharacterContactShadowVec3,
  yAxis: StudioBg3dSharedCharacterContactShadowVec3,
  zAxis: StudioBg3dSharedCharacterContactShadowVec3,
): StudioBg3dSharedCharacterContactShadowQuaternion | null {
  const m00 = xAxis[0];
  const m01 = yAxis[0];
  const m02 = zAxis[0];
  const m10 = xAxis[1];
  const m11 = yAxis[1];
  const m12 = zAxis[1];
  const m20 = xAxis[2];
  const m21 = yAxis[2];
  const m22 = zAxis[2];
  const trace = m00 + m11 + m22;

  if (trace > 0) {
    const scale = Math.sqrt(trace + 1) * 2;
    if (scale <= EPSILON) return null;
    return canonicalQuaternion([
      (m21 - m12) / scale,
      (m02 - m20) / scale,
      (m10 - m01) / scale,
      scale / 4,
    ]);
  }
  if (m00 > m11 && m00 > m22) {
    const scale = Math.sqrt(1 + m00 - m11 - m22) * 2;
    if (scale <= EPSILON) return null;
    return canonicalQuaternion([
      scale / 4,
      (m01 + m10) / scale,
      (m02 + m20) / scale,
      (m21 - m12) / scale,
    ]);
  }
  if (m11 > m22) {
    const scale = Math.sqrt(1 + m11 - m00 - m22) * 2;
    if (scale <= EPSILON) return null;
    return canonicalQuaternion([
      (m01 + m10) / scale,
      scale / 4,
      (m12 + m21) / scale,
      (m02 - m20) / scale,
    ]);
  }
  const scale = Math.sqrt(1 + m22 - m00 - m11) * 2;
  if (scale <= EPSILON) return null;
  return canonicalQuaternion([
    (m02 + m20) / scale,
    (m12 + m21) / scale,
    scale / 4,
    (m10 - m01) / scale,
  ]);
}

function exactGroundedResult(
  source: StudioShared3dCharacterSource,
  result: StudioBg3dSharedCharacterGroundingResult | undefined,
) {
  if (!result?.ok) return null;
  const { receipt } = result;
  if (
    receipt.kind !== STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_RECEIPT_KIND
    || receipt.version !== STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_RECEIPT_VERSION
    || receipt.diagnosis !== "grounded"
    || receipt.identity.elementId !== source.elementId
    || receipt.identity.modelRuntimeKey !== source.modelRuntimeKey
    || receipt.identity.placementHash !== source.placementHash
    || receipt.identity.stageId !== (source.stageId ?? null)
  ) return null;
  return receipt;
}

function createPlan(
  source: StudioShared3dCharacterSource,
  result: StudioBg3dSharedCharacterGroundingResult | undefined,
): StudioBg3dSharedCharacterContactShadowPlan | null {
  const receipt = exactGroundedResult(source, result);
  if (!receipt) return null;
  const surfacePoint = finiteWorldVec3(receipt.surface.point);
  const rawNormal = finiteWorldVec3(receipt.surface.normal);
  if (!surfacePoint || !rawNormal) return null;
  const normal = normalize(rawNormal);
  if (
    !normal
    || normal[1] <
      STUDIO_BG3D_SHARED_CHARACTER_CONTACT_SHADOW_LIMITS.minimumUpwardNormalY
  ) return null;

  let world: ReturnType<typeof studioShared3dCharacterWorldTransform>;
  try {
    world = studioShared3dCharacterWorldTransform(source.scene, source.stageTransform);
  } catch {
    return null;
  }
  const root = finiteWorldVec3(world.position);
  const rotation = finiteWorldVec3(world.rotation);
  const scale = finiteWorldVec3(world.scale);
  if (!root || !rotation || !scale || scale.some((component) => component <= 0)) return null;
  const widthScale = clamp(
    scale[0],
    STUDIO_BG3D_SHARED_CHARACTER_CONTACT_SHADOW_LIMITS.minimumWidthScale,
    STUDIO_BG3D_SHARED_CHARACTER_CONTACT_SHADOW_LIMITS.maximumWidthScale,
  );

  const yaw = rotation[1] % (Math.PI * 2);
  const characterRight: StudioBg3dSharedCharacterContactShadowVec3 = [
    Math.cos(yaw),
    0,
    canonicalZero(-Math.sin(yaw)),
  ];
  const rightNormalDot = dot(characterRight, normal);
  const right = normalize([
    characterRight[0] - normal[0] * rightNormalDot,
    characterRight[1] - normal[1] * rightNormalDot,
    characterRight[2] - normal[2] * rightNormalDot,
  ]);
  if (!right) return null;
  const planeUp = normalize(cross(normal, right));
  if (!planeUp) return null;
  const quaternion = quaternionFromBasis(right, planeUp, normal);
  if (!quaternion) return null;

  const rootFromSurface: StudioBg3dSharedCharacterContactShadowVec3 = [
    root[0] - surfacePoint[0],
    root[1] - surfacePoint[1],
    root[2] - surfacePoint[2],
  ];
  const rootNormalDistance = dot(rootFromSurface, normal);
  const projectedRootDelta: StudioBg3dSharedCharacterContactShadowVec3 = [
    rootFromSurface[0] - normal[0] * rootNormalDistance,
    rootFromSurface[1] - normal[1] * rootNormalDistance,
    rootFromSurface[2] - normal[2] * rootNormalDistance,
  ];
  const projectedRootDistance = Math.hypot(...projectedRootDelta);
  if (!Number.isFinite(projectedRootDistance)) return null;
  const maximumBroadTravel = widthScale
    * STUDIO_BG3D_SHARED_CHARACTER_CONTACT_SHADOW_LIMITS.maximumBroadCenterTravelWidthFactor;
  const broadTravelScale = projectedRootDistance <= maximumBroadTravel
    ? 1
    : maximumBroadTravel / projectedRootDistance;
  const broadBase: StudioBg3dSharedCharacterContactShadowVec3 = [
    canonicalZero(surfacePoint[0] + projectedRootDelta[0] * broadTravelScale),
    canonicalZero(surfacePoint[1] + projectedRootDelta[1] * broadTravelScale),
    canonicalZero(surfacePoint[2] + projectedRootDelta[2] * broadTravelScale),
  ];

  const broadOffset = clamp(
    0.0025 * widthScale,
    STUDIO_BG3D_SHARED_CHARACTER_CONTACT_SHADOW_LIMITS.minimumNormalOffsetMeters,
    0.0035,
  );
  const coreOffset = clamp(
    broadOffset + 0.0005,
    STUDIO_BG3D_SHARED_CHARACTER_CONTACT_SHADOW_LIMITS.minimumNormalOffsetMeters,
    STUDIO_BG3D_SHARED_CHARACTER_CONTACT_SHADOW_LIMITS.maximumNormalOffsetMeters,
  );
  const coreCenter = addNormalOffset(surfacePoint, normal, coreOffset);
  const broadCenter = addNormalOffset(broadBase, normal, broadOffset);
  if (!coreCenter || !broadCenter) return null;

  const opacityScale = Math.sqrt(widthScale);
  const core = Object.freeze({
    kind: "core" as const,
    center: Object.freeze(coreCenter),
    radii: Object.freeze([
      STUDIO_BG3D_SHARED_CHARACTER_CONTACT_SHADOW_PROFILE.coreRadiusXMeters * widthScale,
      STUDIO_BG3D_SHARED_CHARACTER_CONTACT_SHADOW_PROFILE.coreRadiusYMeters * widthScale,
    ]) as StudioBg3dSharedCharacterContactShadowVec2,
    opacity: clamp(
      STUDIO_BG3D_SHARED_CHARACTER_CONTACT_SHADOW_PROFILE.coreOpacityAtUnitWidth
        * opacityScale,
      0.24,
      0.43,
    ),
  });
  const broad = Object.freeze({
    kind: "broad" as const,
    center: Object.freeze(broadCenter),
    radii: Object.freeze([
      STUDIO_BG3D_SHARED_CHARACTER_CONTACT_SHADOW_PROFILE.broadRadiusXMeters * widthScale,
      STUDIO_BG3D_SHARED_CHARACTER_CONTACT_SHADOW_PROFILE.broadRadiusYMeters * widthScale,
    ]) as StudioBg3dSharedCharacterContactShadowVec2,
    opacity: clamp(
      STUDIO_BG3D_SHARED_CHARACTER_CONTACT_SHADOW_PROFILE.broadOpacityAtUnitWidth
        * opacityScale,
      0.1,
      0.19,
    ),
  });
  return Object.freeze({
    key: `shared-character-contact-shadow:${source.runtimeKey}:${source.placementHash}`,
    elementId: source.elementId,
    runtimeKey: source.runtimeKey,
    placementHash: source.placementHash,
    surfaceSource: receipt.surface.source,
    surfaceTargetEntityId: receipt.surface.targetEntityId,
    normal: Object.freeze(normal),
    quaternion,
    lobes: Object.freeze([core, broad] as const),
  });
}

/**
 * Plans capture-authoritative contact patches without mutating the Shared Stage or VRM documents.
 * Source order is retained so overlapping characters follow the existing deterministic cast order.
 */
export function planStudioBg3dSharedCharacterContactShadows({
  characters,
  groundingResults,
  capturableElementIds,
  includeInCapture,
}: PlanStudioBg3dSharedCharacterContactShadowsInput): readonly StudioBg3dSharedCharacterContactShadowPlan[] {
  if (!includeInCapture || characters.length === 0 || capturableElementIds.length === 0) {
    return EMPTY_PLANS;
  }
  const capturable = new Set(capturableElementIds);
  const seenKeys = new Set<string>();
  const plans: StudioBg3dSharedCharacterContactShadowPlan[] = [];
  for (const source of characters) {
    if (!capturable.has(source.elementId)) continue;
    const result = Object.hasOwn(groundingResults, source.runtimeKey)
      ? groundingResults[source.runtimeKey]
      : undefined;
    const plan = createPlan(source, result);
    if (!plan || seenKeys.has(plan.key)) continue;
    seenKeys.add(plan.key);
    plans.push(plan);
  }
  return plans.length === 0 ? EMPTY_PLANS : Object.freeze(plans);
}
