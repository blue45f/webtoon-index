import { localHalfExtentsForPrimitiveKind } from "./studio-bg3d-object-ops";

import type {
  BgPrimitive,
  BgPrimitiveKind,
} from "../studio-background-3d-metadata";

export type StudioBg3dPushPullAxis = "x" | "y" | "z";
export type StudioBg3dPushPullFace = "negative" | "positive";

export type StudioBg3dPushPullFailureReason =
  | "invalid-distance"
  | "locked"
  | "no-change"
  | "unsupported-face";

export interface StudioBg3dPushPullInput {
  /** Scene units to add to the selected face. Negative values pull the face inward. */
  readonly distance: number;
  readonly axis: StudioBg3dPushPullAxis;
  readonly face: StudioBg3dPushPullFace;
  /** Optional scene-unit increment shared with the transform snap controls. */
  readonly snapStep?: number;
  readonly minimumDimension?: number;
}

export interface StudioBg3dPushPullSuccess {
  readonly ok: true;
  readonly appliedDistance: number;
  readonly previousDimension: number;
  readonly nextDimension: number;
  readonly patch: Readonly<{
    position: [number, number, number];
    scale: [number, number, number];
  }>;
}

export interface StudioBg3dPushPullFailure {
  readonly ok: false;
  readonly reason: StudioBg3dPushPullFailureReason;
  readonly message: string;
}

export type StudioBg3dPushPullResult =
  | StudioBg3dPushPullSuccess
  | StudioBg3dPushPullFailure;

export const STUDIO_BG3D_PUSH_PULL_MIN_DIMENSION = 0.01;
export const STUDIO_BG3D_PUSH_PULL_MAX_DISTANCE = 1_000;

const AXIS_INDEX: Record<StudioBg3dPushPullAxis, 0 | 1 | 2> = {
  x: 0,
  y: 1,
  z: 2,
};

const ALL_AXES = ["x", "y", "z"] as const;
const HEIGHT_AXIS = ["y"] as const;
const NO_AXES: readonly StudioBg3dPushPullAxis[] = [];

/**
 * The first release deliberately exposes faces whose geometry remains truthful under a scale
 * operation. Curved caps and tapered primitives need a topology edit rather than a transform and
 * therefore fail closed instead of pretending to extrude them.
 */
export function studioBg3dPushPullAxes(
  kind: BgPrimitiveKind,
): readonly StudioBg3dPushPullAxis[] {
  switch (kind) {
    case "box":
      return ALL_AXES;
    case "cylinder":
    case "triangularPrism":
    case "hexPrism":
    case "tube":
      return HEIGHT_AXIS;
    case "plane":
    case "sphere":
    case "hemisphere":
    case "cone":
    case "pyramid":
    case "torus":
    case "ring":
    case "capsule":
      return NO_AXES;
  }
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function snapDistance(distance: number, step: number | undefined): number {
  if (!Number.isFinite(step) || (step ?? 0) <= 0) return distance;
  return Math.round(distance / (step as number)) * (step as number);
}

function rotateLocalVector(
  vector: readonly [number, number, number],
  rotation: readonly [number, number, number],
): [number, number, number] {
  const rx = finiteOr(rotation[0], 0);
  const ry = finiteOr(rotation[1], 0);
  const rz = finiteOr(rotation[2], 0);

  let [x, y, z] = vector;

  const cosX = Math.cos(rx);
  const sinX = Math.sin(rx);
  [y, z] = [y * cosX - z * sinX, y * sinX + z * cosX];

  const cosY = Math.cos(ry);
  const sinY = Math.sin(ry);
  [x, z] = [x * cosY + z * sinY, -x * sinY + z * cosY];

  const cosZ = Math.cos(rz);
  const sinZ = Math.sin(rz);
  [x, y] = [x * cosZ - y * sinZ, x * sinZ + y * cosZ];

  return [x, y, z];
}

/**
 * Plans a SketchUp-style face Push/Pull for bounded primitives.
 *
 * The selected face moves by `distance`, the opposite face remains pinned, and the object centre
 * moves by half the applied distance along the object's rotated local face normal. The result is a
 * single transform patch so the caller can record one undoable/replayable command.
 */
export function planStudioBg3dPushPull(
  primitive: BgPrimitive,
  input: StudioBg3dPushPullInput,
): StudioBg3dPushPullResult {
  if (primitive.locked === true) {
    return {
      ok: false,
      reason: "locked",
      message: "잠긴 도형은 면을 밀거나 당길 수 없습니다.",
    };
  }

  const supportedAxes = studioBg3dPushPullAxes(primitive.kind);
  if (!supportedAxes.includes(input.axis)) {
    return {
      ok: false,
      reason: "unsupported-face",
      message: "이 도형의 선택한 면은 아직 안전한 Push/Pull 대상이 아닙니다.",
    };
  }

  if (
    !Number.isFinite(input.distance)
    || Math.abs(input.distance) > STUDIO_BG3D_PUSH_PULL_MAX_DISTANCE
  ) {
    return {
      ok: false,
      reason: "invalid-distance",
      message: `거리는 ±${STUDIO_BG3D_PUSH_PULL_MAX_DISTANCE}m 안의 숫자로 입력해 주세요.`,
    };
  }

  const snappedDistance = snapDistance(input.distance, input.snapStep);
  if (Math.abs(snappedDistance) < Number.EPSILON) {
    return {
      ok: false,
      reason: "no-change",
      message: "스냅 간격보다 큰 거리를 입력해 주세요.",
    };
  }

  const axisIndex = AXIS_INDEX[input.axis];
  const localHalfExtents = localHalfExtentsForPrimitiveKind(primitive.kind);
  const baseDimension = Math.max(
    Number.EPSILON,
    Math.abs(localHalfExtents[axisIndex]) * 2,
  );
  const currentScale = Math.max(
    Number.EPSILON,
    Math.abs(finiteOr(primitive.scale[axisIndex], 1)),
  );
  const previousDimension = baseDimension * currentScale;
  const minimumDimension = Math.max(
    Number.EPSILON,
    finiteOr(input.minimumDimension ?? STUDIO_BG3D_PUSH_PULL_MIN_DIMENSION, STUDIO_BG3D_PUSH_PULL_MIN_DIMENSION),
  );
  const nextDimension = Math.max(minimumDimension, previousDimension + snappedDistance);
  const appliedDistance = nextDimension - previousDimension;

  if (Math.abs(appliedDistance) < Number.EPSILON) {
    return {
      ok: false,
      reason: "no-change",
      message: `도형 두께는 ${minimumDimension}m보다 작게 줄일 수 없습니다.`,
    };
  }

  const nextScale: [number, number, number] = [
    Math.max(Number.EPSILON, Math.abs(finiteOr(primitive.scale[0], 1))),
    Math.max(Number.EPSILON, Math.abs(finiteOr(primitive.scale[1], 1))),
    Math.max(Number.EPSILON, Math.abs(finiteOr(primitive.scale[2], 1))),
  ];
  nextScale[axisIndex] = nextDimension / baseDimension;

  const faceSign = input.face === "positive" ? 1 : -1;
  const localCenterOffset: [number, number, number] = [0, 0, 0];
  localCenterOffset[axisIndex] = faceSign * appliedDistance * 0.5;
  const worldCenterOffset = rotateLocalVector(
    localCenterOffset,
    primitive.rotation,
  );
  const nextPosition: [number, number, number] = [
    finiteOr(primitive.position[0], 0) + worldCenterOffset[0],
    finiteOr(primitive.position[1], 0) + worldCenterOffset[1],
    finiteOr(primitive.position[2], 0) + worldCenterOffset[2],
  ];

  return {
    ok: true,
    appliedDistance,
    previousDimension,
    nextDimension,
    patch: {
      position: nextPosition,
      scale: nextScale,
    },
  };
}
