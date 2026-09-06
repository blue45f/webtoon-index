import * as THREE from "three";

import {
  isStudioBg3dCameraUpVectorValid,
  resolveStudioBg3dCameraUpVector,
} from "./studio-bg3d-camera-orientation";
import {
  STUDIO_BG3D_SHADOW_MAX_WORLD_COORDINATE,
  type StudioBg3dCollectedShadowBounds,
} from "./studio-bg3d-shadow-frustum";

import type { StudioBg3dCameraSettings } from "./studio-bg3d-scene-document";

export type StudioBg3dImmersiveMode = "immersive-ar" | "immersive-vr";
export type StudioBg3dImmersiveVec3 = readonly [number, number, number];
export type StudioBg3dImmersiveQuaternion = readonly [number, number, number, number];

export const STUDIO_BG3D_AR_MINIATURE_TARGET_RADIUS_METERS = 0.6;
export const STUDIO_BG3D_AR_MINIATURE_MIN_SOURCE_RADIUS = 0.001;
export const STUDIO_BG3D_AR_MINIATURE_MIN_SCALE = 0.0001;
export const STUDIO_BG3D_AR_MINIATURE_MAX_SCALE = 100;
export const STUDIO_BG3D_AR_MINIATURE_MIN_DISTANCE_METERS = 2;
export const STUDIO_BG3D_AR_MINIATURE_MAX_DISTANCE_METERS = 6;

const STUDIO_BG3D_AR_MINIATURE_CENTER_Y_METERS = -0.15;
const STUDIO_BG3D_AR_MINIATURE_DISTANCE_RADIUS_FACTOR = 2.5;
const STUDIO_BG3D_AR_MINIATURE_DISTANCE_MARGIN_METERS = 0.5;
const MIN_CAMERA_DIRECTION_LENGTH = 1e-6;
const QUATERNION_CANONICAL_EPSILON = 1e-14;

export interface StudioBg3dImmersiveTransform {
  readonly position: StudioBg3dImmersiveVec3;
  readonly quaternion: StudioBg3dImmersiveQuaternion;
  readonly uniformScale: number;
}

export interface PlanStudioBg3dImmersiveStageInput {
  readonly mode: StudioBg3dImmersiveMode;
  /** The exact admitted result of `collectStudioBg3dShadowSceneBounds`. */
  readonly sceneBounds: StudioBg3dCollectedShadowBounds;
  /** Canonical scene camera, or a losslessly adapted live camera snapshot. */
  readonly camera: Pick<StudioBg3dCameraSettings, "position" | "target" | "up">;
}

export type StudioBg3dImmersiveStageFailureReason =
  | "invalid-input"
  | "empty-scene"
  | "incomplete-scene"
  | "invalid-bounds"
  | "invalid-camera"
  | "result-out-of-bounds";

export type StudioBg3dImmersiveStagePlan =
  | {
      readonly ok: false;
      readonly reason: StudioBg3dImmersiveStageFailureReason;
    }
  | {
      readonly ok: true;
      readonly mode: StudioBg3dImmersiveMode;
      readonly placement: "ar-miniature" | "vr-authored-camera";
      readonly referenceSpaceType: "local";
      /** Outer group. AR rotates the authored camera view into the viewer's neutral -Z view. */
      readonly stageRootTransform: StudioBg3dImmersiveTransform;
      /** Inner group, applied before `stageRootTransform`, to pivot AR around admitted bounds. */
      readonly contentOffset: StudioBg3dImmersiveVec3;
      /** Parent of a dedicated XR camera. The XR camera itself remains at its tracked local pose. */
      readonly cameraRigTransform: StudioBg3dImmersiveTransform;
      readonly sourceBoundsRadius: number;
      readonly presentedBoundsRadius: number;
    };

export function studioBg3dImmersiveStageFailureMessage(
  reason: StudioBg3dImmersiveStageFailureReason,
): string {
  switch (reason) {
    case "empty-scene":
      return "몰입형 미리보기에 표시할 3D 오브젝트가 없습니다.";
    case "incomplete-scene":
      return "일부 3D 오브젝트의 실제 경계를 확인하지 못해 AR·VR 진입을 중단했습니다.";
    case "invalid-bounds":
      return "장면의 공간 경계가 올바르지 않아 AR·VR 배치를 계산하지 못했습니다.";
    case "invalid-camera":
      return "현재 카메라 구도를 안전한 AR·VR 시점으로 변환하지 못했습니다.";
    case "result-out-of-bounds":
      return "장면 크기가 몰입형 미리보기의 안전 배치 범위를 벗어났습니다.";
    case "invalid-input":
      return "AR·VR 미리보기 입력이 올바르지 않아 장면을 변경하지 않았습니다.";
  }
}

interface AdmittedBounds {
  readonly center: THREE.Vector3;
  readonly radius: number;
}

interface AdmittedCamera {
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
}

function failure(
  reason: StudioBg3dImmersiveStageFailureReason,
): StudioBg3dImmersiveStagePlan {
  return Object.freeze({ ok: false, reason });
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isWorldVec3(value: unknown): value is StudioBg3dImmersiveVec3 {
  return Array.isArray(value) && value.length === 3 && value.every((component) => (
    typeof component === "number" &&
    Number.isFinite(component) &&
    Math.abs(component) <= STUDIO_BG3D_SHADOW_MAX_WORLD_COORDINATE
  ));
}

function canonicalNumber(value: number): number {
  return Math.abs(value) < QUATERNION_CANONICAL_EPSILON || Object.is(value, -0)
    ? 0
    : value;
}

function frozenVec3(
  x: number,
  y: number,
  z: number,
): StudioBg3dImmersiveVec3 {
  return Object.freeze([
    canonicalNumber(x),
    canonicalNumber(y),
    canonicalNumber(z),
  ] as const);
}

function frozenQuaternion(source: THREE.Quaternion): StudioBg3dImmersiveQuaternion | null {
  const quaternion = source.clone().normalize();
  const values = [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
  if (values.some((value) => !Number.isFinite(value))) return null;

  // q and -q encode the same orientation. Canonicalizing the sign keeps receipts deterministic.
  const signPivot = Math.abs(quaternion.w) > QUATERNION_CANONICAL_EPSILON
    ? quaternion.w
    : values.find((value) => Math.abs(value) > QUATERNION_CANONICAL_EPSILON) ?? 1;
  const sign = signPivot < 0 ? -1 : 1;
  return Object.freeze([
    canonicalNumber(quaternion.x * sign),
    canonicalNumber(quaternion.y * sign),
    canonicalNumber(quaternion.z * sign),
    canonicalNumber(quaternion.w * sign),
  ] as const);
}

function frozenTransform(
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
  uniformScale: number,
): StudioBg3dImmersiveTransform | null {
  if (
    ![position.x, position.y, position.z, uniformScale].every(Number.isFinite) ||
    uniformScale <= 0 ||
    uniformScale < STUDIO_BG3D_AR_MINIATURE_MIN_SCALE ||
    uniformScale > STUDIO_BG3D_AR_MINIATURE_MAX_SCALE
  ) {
    return null;
  }
  const frozenRotation = frozenQuaternion(quaternion);
  if (!frozenRotation) return null;
  return Object.freeze({
    position: frozenVec3(position.x, position.y, position.z),
    quaternion: frozenRotation,
    uniformScale,
  });
}

function admitBounds(
  sceneBounds: StudioBg3dCollectedShadowBounds,
): { readonly ok: true; readonly bounds: AdmittedBounds } | {
  readonly ok: false;
  readonly reason: StudioBg3dImmersiveStageFailureReason;
} {
  if (!isRecord(sceneBounds)) return { ok: false, reason: "invalid-input" };
  const { bounds, includedEntityCount, rejectedEntityCount, clamped } = sceneBounds;
  if (
    !isNonNegativeSafeInteger(includedEntityCount) ||
    !isNonNegativeSafeInteger(rejectedEntityCount) ||
    typeof clamped !== "boolean"
  ) {
    return { ok: false, reason: "invalid-input" };
  }
  if (clamped || rejectedEntityCount > 0) {
    return { ok: false, reason: "incomplete-scene" };
  }
  if (includedEntityCount === 0) {
    return bounds === null
      ? { ok: false, reason: "empty-scene" }
      : { ok: false, reason: "invalid-input" };
  }
  if (!isRecord(bounds) || !isWorldVec3(bounds.min) || !isWorldVec3(bounds.max)) {
    return { ok: false, reason: "invalid-bounds" };
  }
  if (
    bounds.min[0] > bounds.max[0] ||
    bounds.min[1] > bounds.max[1] ||
    bounds.min[2] > bounds.max[2]
  ) {
    return { ok: false, reason: "invalid-bounds" };
  }

  const center = new THREE.Vector3(
    bounds.min[0] + (bounds.max[0] - bounds.min[0]) / 2,
    bounds.min[1] + (bounds.max[1] - bounds.min[1]) / 2,
    bounds.min[2] + (bounds.max[2] - bounds.min[2]) / 2,
  );
  const radius = Math.hypot(
    (bounds.max[0] - bounds.min[0]) / 2,
    (bounds.max[1] - bounds.min[1]) / 2,
    (bounds.max[2] - bounds.min[2]) / 2,
  );
  if (![center.x, center.y, center.z, radius].every(Number.isFinite)) {
    return { ok: false, reason: "invalid-bounds" };
  }
  return { ok: true, bounds: { center, radius } };
}

function admitCamera(
  camera: Pick<StudioBg3dCameraSettings, "position" | "target" | "up">,
): AdmittedCamera | null {
  if (!isRecord(camera) || !isWorldVec3(camera.position) || !isWorldVec3(camera.target)) {
    return null;
  }
  if (camera.up !== undefined && !isStudioBg3dCameraUpVectorValid(camera.up, camera)) {
    return null;
  }

  const position = new THREE.Vector3(...camera.position);
  const target = new THREE.Vector3(...camera.target);
  const forward = target.clone().sub(position);
  if (!Number.isFinite(forward.lengthSq()) || forward.length() < MIN_CAMERA_DIRECTION_LENGTH) {
    return null;
  }
  forward.normalize();
  const resolvedUp = new THREE.Vector3(...resolveStudioBg3dCameraUpVector(camera));
  const right = forward.clone().cross(resolvedUp);
  if (!Number.isFinite(right.lengthSq()) || right.length() < MIN_CAMERA_DIRECTION_LENGTH) {
    return null;
  }
  right.normalize();
  const correctedUp = right.clone().cross(forward).normalize();
  const backward = forward.clone().negate();
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(right, correctedUp, backward),
  ).normalize();
  if ([quaternion.x, quaternion.y, quaternion.z, quaternion.w].some(
    (component) => !Number.isFinite(component),
  )) {
    return null;
  }
  return { position, quaternion };
}

function boundedScale(sourceRadius: number): number {
  const framingRadius = Math.max(
    sourceRadius,
    STUDIO_BG3D_AR_MINIATURE_MIN_SOURCE_RADIUS,
  );
  return THREE.MathUtils.clamp(
    STUDIO_BG3D_AR_MINIATURE_TARGET_RADIUS_METERS / framingRadius,
    STUDIO_BG3D_AR_MINIATURE_MIN_SCALE,
    STUDIO_BG3D_AR_MINIATURE_MAX_SCALE,
  );
}

function outputIsFinite(plan: Extract<StudioBg3dImmersiveStagePlan, { readonly ok: true }>): boolean {
  const transforms = [plan.stageRootTransform, plan.cameraRigTransform];
  return transforms.every((transform) => (
    transform.position.every(Number.isFinite) &&
    transform.quaternion.every(Number.isFinite) &&
    Number.isFinite(transform.uniformScale)
  )) && plan.contentOffset.every(Number.isFinite) &&
    Number.isFinite(plan.sourceBoundsRadius) &&
    Number.isFinite(plan.presentedBoundsRadius);
}

/**
 * Plans one immutable WebXR presentation transform without mutating the canonical scene graph.
 *
 * AR uses two nested groups: `stageRootTransform` frames a bounded miniature in front of the
 * viewer, while `contentOffset` pivots the existing scene around its admitted bounds. VR keeps the
 * scene graph untouched and places a dedicated tracked camera under the authored camera rig.
 */
export function planStudioBg3dImmersiveStage(
  input: PlanStudioBg3dImmersiveStageInput,
): StudioBg3dImmersiveStagePlan {
  if (
    !isRecord(input) ||
    (input.mode !== "immersive-ar" && input.mode !== "immersive-vr")
  ) {
    return failure("invalid-input");
  }
  const admittedBounds = admitBounds(input.sceneBounds);
  if (!admittedBounds.ok) return failure(admittedBounds.reason);
  const admittedCamera = admitCamera(input.camera);
  if (!admittedCamera) return failure("invalid-camera");

  const identityPosition = new THREE.Vector3();
  const identityQuaternion = new THREE.Quaternion();
  let success: Extract<StudioBg3dImmersiveStagePlan, { readonly ok: true }>;

  if (input.mode === "immersive-ar") {
    const scale = boundedScale(admittedBounds.bounds.radius);
    const framedRadius = Math.max(
      admittedBounds.bounds.radius,
      STUDIO_BG3D_AR_MINIATURE_MIN_SOURCE_RADIUS,
    ) * scale;
    const distance = THREE.MathUtils.clamp(
      framedRadius * STUDIO_BG3D_AR_MINIATURE_DISTANCE_RADIUS_FACTOR +
        STUDIO_BG3D_AR_MINIATURE_DISTANCE_MARGIN_METERS,
      STUDIO_BG3D_AR_MINIATURE_MIN_DISTANCE_METERS,
      STUDIO_BG3D_AR_MINIATURE_MAX_DISTANCE_METERS,
    );
    const stageRootTransform = frozenTransform(
      new THREE.Vector3(0, STUDIO_BG3D_AR_MINIATURE_CENTER_Y_METERS, -distance),
      admittedCamera.quaternion.clone().invert(),
      scale,
    );
    const cameraRigTransform = frozenTransform(identityPosition, identityQuaternion, 1);
    if (!stageRootTransform || !cameraRigTransform) return failure("result-out-of-bounds");
    success = Object.freeze({
      ok: true,
      mode: input.mode,
      placement: "ar-miniature",
      referenceSpaceType: "local",
      stageRootTransform,
      contentOffset: frozenVec3(
        -admittedBounds.bounds.center.x,
        -admittedBounds.bounds.center.y,
        -admittedBounds.bounds.center.z,
      ),
      cameraRigTransform,
      sourceBoundsRadius: admittedBounds.bounds.radius,
      presentedBoundsRadius: admittedBounds.bounds.radius * scale,
    });
  } else {
    const stageRootTransform = frozenTransform(identityPosition, identityQuaternion, 1);
    const cameraRigTransform = frozenTransform(
      admittedCamera.position,
      admittedCamera.quaternion,
      1,
    );
    if (!stageRootTransform || !cameraRigTransform) return failure("result-out-of-bounds");
    success = Object.freeze({
      ok: true,
      mode: input.mode,
      placement: "vr-authored-camera",
      referenceSpaceType: "local",
      stageRootTransform,
      contentOffset: frozenVec3(0, 0, 0),
      cameraRigTransform,
      sourceBoundsRadius: admittedBounds.bounds.radius,
      presentedBoundsRadius: admittedBounds.bounds.radius,
    });
  }

  return outputIsFinite(success) ? success : failure("result-out-of-bounds");
}
