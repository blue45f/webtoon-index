/**
 * Pure one-click placement recipe for Studio 3D custom models.
 *
 * Engine-free: auto-fit → yaw → ground, with fail-closed validation. Callers publish the returned
 * transform through their normal history/state boundary.
 */

import {
  groundTransformPosition,
  halfExtentsFromSize,
  type Bg3dVec3,
} from "./studio-bg3d-object-ops";

export type StudioBg3dPlacementVec3 = readonly [number, number, number];

export interface StudioBg3dModelPlacementRecipeInput {
  readonly position: StudioBg3dPlacementVec3;
  readonly rotation: StudioBg3dPlacementVec3;
  readonly scale: StudioBg3dPlacementVec3;
  /** Full axis-aligned model bounding size (before scale), matching groundModelTransform. */
  readonly boundingSize: StudioBg3dPlacementVec3;
  /**
   * When set, uniformly scales so the largest world-space extent of `boundingSize * scale`
   * is at most this many world units.
   */
  readonly autoFitTargetSize?: number;
  /** Ground plane Y. Defaults to 0 (same as groundModelTransform). */
  readonly groundY?: number;
  /** Degrees added to rotation Y after auto-fit. */
  readonly yawDegrees?: number;
}

export type StudioBg3dModelPlacementRecipeResult =
  | {
      readonly ok: true;
      readonly position: StudioBg3dPlacementVec3;
      readonly rotation: StudioBg3dPlacementVec3;
      readonly scale: StudioBg3dPlacementVec3;
    }
  | {
      readonly ok: false;
      readonly reason: string;
    };

const EPSILON = 1e-9;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFiniteVec3(value: unknown): value is StudioBg3dPlacementVec3 {
  return Array.isArray(value) &&
    value.length === 3 &&
    value.every((component) => isFiniteNumber(component));
}

function freezeVec3(value: readonly [number, number, number]): StudioBg3dPlacementVec3 {
  return Object.freeze([value[0], value[1], value[2]] as const);
}

function fail(reason: string): StudioBg3dModelPlacementRecipeResult {
  return Object.freeze({ ok: false, reason });
}

/**
 * Plans a grounded model placement from a seed transform.
 *
 * Order: validate → optional uniform auto-fit → yaw on rotation Y → ground Y via
 * halfExtentsFromSize + groundTransformPosition (same contract as groundModelTransform).
 * Original inputs are never mutated.
 */
export function planStudioBg3dModelPlacementRecipe(
  input: StudioBg3dModelPlacementRecipeInput,
): StudioBg3dModelPlacementRecipeResult {
  if (typeof input !== "object" || input === null) {
    return fail("배치 입력이 올바르지 않습니다.");
  }
  if (
    !isFiniteVec3(input.position) ||
    !isFiniteVec3(input.rotation) ||
    !isFiniteVec3(input.scale) ||
    !isFiniteVec3(input.boundingSize)
  ) {
    return fail("위치·회전·스케일·바운딩 값이 유한 수가 아닙니다.");
  }

  // Scale components must stay positive so half-extents and auto-fit stay well-defined.
  if (input.scale[0] === 0 || input.scale[1] === 0 || input.scale[2] === 0) {
    return fail("스케일은 0이 될 수 없습니다.");
  }

  let scaleX = input.scale[0];
  let scaleY = input.scale[1];
  let scaleZ = input.scale[2];

  if (input.autoFitTargetSize !== undefined) {
    if (!isFiniteNumber(input.autoFitTargetSize) || input.autoFitTargetSize <= 0) {
      return fail("자동 맞춤 목표 크기가 올바르지 않습니다.");
    }
    const extentX = Math.abs(input.boundingSize[0] * scaleX);
    const extentY = Math.abs(input.boundingSize[1] * scaleY);
    const extentZ = Math.abs(input.boundingSize[2] * scaleZ);
    const maxExtent = Math.max(extentX, extentY, extentZ);
    if (!Number.isFinite(maxExtent) || maxExtent < EPSILON) {
      return fail("바운딩 크기로부터 자동 맞춤 비율을 계산할 수 없습니다.");
    }
    if (maxExtent > input.autoFitTargetSize) {
      const factor = input.autoFitTargetSize / maxExtent;
      if (!Number.isFinite(factor) || factor <= 0) {
        return fail("자동 맞춤 비율이 올바르지 않습니다.");
      }
      scaleX *= factor;
      scaleY *= factor;
      scaleZ *= factor;
    }
  }

  const yawDegrees = input.yawDegrees ?? 0;
  if (!isFiniteNumber(yawDegrees)) {
    return fail("요(yaw) 각도가 유한 수가 아닙니다.");
  }
  const yawRadians = (yawDegrees * Math.PI) / 180;
  const rotation: [number, number, number] = [
    input.rotation[0],
    input.rotation[1] + yawRadians,
    input.rotation[2],
  ];
  if (!rotation.every(isFiniteNumber)) {
    return fail("회전 결과가 유한 수가 아닙니다.");
  }

  const groundY = input.groundY ?? 0;
  if (!isFiniteNumber(groundY)) {
    return fail("접지 높이가 유한 수가 아닙니다.");
  }

  const scale = freezeVec3([scaleX, scaleY, scaleZ]);
  const position = groundTransformPosition(
    input.position as Bg3dVec3,
    rotation,
    scale as Bg3dVec3,
    halfExtentsFromSize(input.boundingSize as Bg3dVec3),
    groundY,
  );
  if (!position.every(isFiniteNumber)) {
    return fail("접지 위치 결과가 유한 수가 아닙니다.");
  }

  return Object.freeze({
    ok: true,
    position: freezeVec3(position),
    rotation: freezeVec3(rotation),
    scale,
  });
}
