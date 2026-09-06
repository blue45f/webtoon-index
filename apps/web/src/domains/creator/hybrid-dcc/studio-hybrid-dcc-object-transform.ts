/**
 * Canonical object transform contract for the Hybrid DCC authoring document.
 *
 * Geometry remains object-local half-edge authority. Translation, XYZ Euler rotation and scale
 * are persisted independently so viewport interaction never has to bake presentation placement
 * into the mesh. The contract is renderer-free and JSON-safe for undo, OPFS recovery and .toon3d.
 */

export const STUDIO_HYBRID_DCC_OBJECT_TRANSFORM_REVISION = 1 as const;

export const STUDIO_HYBRID_DCC_OBJECT_TRANSFORM_LIMITS = Object.freeze({
  maxPositionMagnitude: 1_000_000,
  maxRotationMagnitude: Math.PI * 1_000_000,
  minScaleMagnitude: 1e-6,
  maxScaleMagnitude: 1_000_000,
});

export type StudioHybridDccVec3Tuple = readonly [number, number, number];

export interface StudioHybridDccObjectTransform {
  readonly revision: typeof STUDIO_HYBRID_DCC_OBJECT_TRANSFORM_REVISION;
  readonly position: StudioHybridDccVec3Tuple;
  /** Intrinsic XYZ Euler rotation in radians (the same convention used by Three.js). */
  readonly rotationEulerRad: StudioHybridDccVec3Tuple;
  readonly scale: StudioHybridDccVec3Tuple;
}

export function createStudioHybridDccIdentityTransform(): StudioHybridDccObjectTransform {
  return {
    revision: STUDIO_HYBRID_DCC_OBJECT_TRANSFORM_REVISION,
    position: [0, 0, 0],
    rotationEulerRad: [0, 0, 0],
    scale: [1, 1, 1],
  };
}

function isVec3Tuple(value: unknown): value is StudioHybridDccVec3Tuple {
  return Array.isArray(value)
    && value.length === 3
    && [0, 1, 2].every((index) => Object.hasOwn(value, index)
      && typeof value[index] === "number" && Number.isFinite(value[index]));
}

/** Validates untrusted persisted/plugin transform data and returns a detached canonical value. */
export function normalizeStudioHybridDccObjectTransform(
  value: unknown,
): StudioHybridDccObjectTransform {
  if (!value || typeof value !== "object") throw new Error("object transform must be an object");
  const candidate = value as Partial<StudioHybridDccObjectTransform>;
  if (candidate.revision !== STUDIO_HYBRID_DCC_OBJECT_TRANSFORM_REVISION) {
    throw new Error("unsupported object transform revision");
  }
  if (!isVec3Tuple(candidate.position)
    || !isVec3Tuple(candidate.rotationEulerRad)
    || !isVec3Tuple(candidate.scale)) {
    throw new Error("object transform requires finite position, rotation and scale vec3 values");
  }
  if (candidate.position.some((component) => (
    Math.abs(component) > STUDIO_HYBRID_DCC_OBJECT_TRANSFORM_LIMITS.maxPositionMagnitude
  ))) {
    throw new Error("object transform position exceeds the authoring range");
  }
  if (candidate.rotationEulerRad.some((component) => (
    Math.abs(component) > STUDIO_HYBRID_DCC_OBJECT_TRANSFORM_LIMITS.maxRotationMagnitude
  ))) {
    throw new Error("object transform rotation exceeds the authoring range");
  }
  if (candidate.scale.some((component) => {
    const magnitude = Math.abs(component);
    return magnitude < STUDIO_HYBRID_DCC_OBJECT_TRANSFORM_LIMITS.minScaleMagnitude
      || magnitude > STUDIO_HYBRID_DCC_OBJECT_TRANSFORM_LIMITS.maxScaleMagnitude;
  })) {
    throw new Error("object transform scale is zero or exceeds the authoring range");
  }
  return {
    revision: STUDIO_HYBRID_DCC_OBJECT_TRANSFORM_REVISION,
    position: [...candidate.position],
    rotationEulerRad: [...candidate.rotationEulerRad],
    scale: [...candidate.scale],
  };
}

/** Applies canonical intrinsic XYZ TRS to an object-local point. */
export function transformStudioHybridDccPoint(
  point: StudioHybridDccVec3Tuple,
  transform: StudioHybridDccObjectTransform,
): StudioHybridDccVec3Tuple {
  const [rx, ry, rz] = transform.rotationEulerRad;
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  const x = point[0] * transform.scale[0];
  const y = point[1] * transform.scale[1];
  const z = point[2] * transform.scale[2];

  // Three.js intrinsic Euler "XYZ" is Rx * Ry * Rz for column vectors.
  // Rz * Ry * Rx only agrees for single-axis rotations, hiding mixed-axis drift.
  const rotatedX = cy * cz * x - cy * sz * y + sy * z;
  const rotatedY = (cx * sz + sx * sy * cz) * x
    + (cx * cz - sx * sy * sz) * y - sx * cy * z;
  const rotatedZ = (sx * sz - cx * sy * cz) * x
    + (sx * cz + cx * sy * sz) * y + cx * cy * z;
  return [
    rotatedX + transform.position[0],
    rotatedY + transform.position[1],
    rotatedZ + transform.position[2],
  ];
}

/** Applies the exact inverse of canonical intrinsic XYZ TRS to a world-space point. */
export function inverseTransformStudioHybridDccPoint(
  point: StudioHybridDccVec3Tuple,
  transform: StudioHybridDccObjectTransform,
): StudioHybridDccVec3Tuple {
  const [rx, ry, rz] = transform.rotationEulerRad;
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  const worldX = point[0] - transform.position[0];
  const worldY = point[1] - transform.position[1];
  const worldZ = point[2] - transform.position[2];

  // Invert T * Rx * Ry * Rz * S: subtract T, transpose R, then divide by S.
  const scaledX = cy * cz * worldX + (cx * sz + sx * sy * cz) * worldY
    + (sx * sz - cx * sy * cz) * worldZ;
  const scaledY = -cy * sz * worldX + (cx * cz - sx * sy * sz) * worldY
    + (sx * cz + cx * sy * sz) * worldZ;
  const scaledZ = sy * worldX - sx * cy * worldY + cx * cy * worldZ;
  return [
    scaledX / transform.scale[0],
    scaledY / transform.scale[1],
    scaledZ / transform.scale[2],
  ];
}

export function hashStudioHybridDccObjectTransform(
  transform: StudioHybridDccObjectTransform,
): string {
  return [
    ...transform.position,
    ...transform.rotationEulerRad,
    ...transform.scale,
  ].map((component) => (Object.is(component, -0) ? 0 : component).toPrecision(17)).join(",");
}
