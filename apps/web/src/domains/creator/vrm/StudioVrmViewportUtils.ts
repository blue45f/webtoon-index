/**
 * @fileoverview Pure utility functions and types extracted from StudioVrmPoser.tsx.
 * Non-React-component helpers for VRM viewport operations, texture paint, and proportions.
 */

import * as THREE from "three";



import { STUDIO_VRM_BASE_ROTATION_Y_KEY as BASE_ROTATION_Y_KEY } from "./studio-vrm-asset-runtime";
import {
  applyExpressionWeightsToVrm,
  applyPoserVisualState,
  type BodyScale,
  type FingerRotationMap,
  type PoseBoneMap,
} from "./studio-vrm-poser-utils";
import {
  NEUTRAL_STUDIO_VRM_PROPORTIONS,
  } from "./studio-vrm-proportion-core";
import { createStudioVrmProportionFitTransaction } from "./studio-vrm-proportion-fit-transaction";
import {
  adaptThreeRaycastIntersection,
  } from "./studio-vrm-surface-brush-provider";

import type { AvatarForgeState } from "./studio-vrm-avatar-forge";
import type { StudioVrmPoseTranslations } from "./studio-vrm-scene-document";
import type {
  StudioVrmSurfacePaintPointerSample,
} from "./studio-vrm-surface-paint-tool";
import type { StudioVrmTexturePaintRayHit, StudioVrmTexturePaintRuntime  } from "./studio-vrm-texture-paint-runtime";
import type { StudioVrmTexturePaintPanelSettings } from "./StudioVrmTexturePaintPanel";
import type { VRM } from "@pixiv/three-vrm";
import type { ThreeEvent } from "@react-three/fiber";

// ── VRM_FRAME_BASE_PRIORITY ─────────────────────────────────────────

export const VRM_FRAME_BASE_PRIORITY = -3;

// ── applyRotationToVrm ─────────────────────────────────────────────

export function applyRotationToVrm(vrm: VRM, bodyRotation: number) {
  const baseRotationY = typeof vrm.scene.userData[BASE_ROTATION_Y_KEY] === "number" ? vrm.scene.userData[BASE_ROTATION_Y_KEY] : 0;
  vrm.scene.rotation.y = baseRotationY + bodyRotation;
  vrm.scene.updateMatrixWorld(true);
}

// ── StudioVrmProportionPoseTransaction ──────────────────────────────

export type StudioVrmProportionPoseTransactionInput = {
  readonly bones: PoseBoneMap;
  readonly yOffset: number;
  readonly poseTranslations: StudioVrmPoseTranslations;
  readonly fingerEdits: FingerRotationMap;
  readonly bodyScale: BodyScale;
  readonly bodyRotation: number;
  readonly expressionWeights: Record<string, number>;
};

/**
 * Buffers fit measurements until the proportion runtime commits. The lifecycle invokes reapply
 * both for a requested rig and for transactional recovery, so callers publish the buffer only
 * after receiving a successful runtime receipt.
 */
export function createStudioVrmProportionPoseTransaction(
  vrm: VRM,
  input: StudioVrmProportionPoseTransactionInput,
) {
  return createStudioVrmProportionFitTransaction(vrm, () => {
      applyPoserVisualState(vrm, {
        bones: input.bones,
        yOffset: input.yOffset,
        poseTranslations: input.poseTranslations,
        fingerEdits: input.fingerEdits,
        bodyScale: input.bodyScale,
      });
      applyRotationToVrm(vrm, input.bodyRotation);
      applyExpressionWeightsToVrm(vrm, input.expressionWeights);
      vrm.scene.updateMatrixWorld(true);
      return true;
  });
}

export function studioVrmProportionValuesRequireRuntime(
  proportions: AvatarForgeState["proportions"],
) {
  return JSON.stringify(proportions) !== JSON.stringify(NEUTRAL_STUDIO_VRM_PROPORTIONS);
}

export function studioVrmProportionsRequireRuntime(state: AvatarForgeState) {
  return studioVrmProportionValuesRequireRuntime(state.proportions);
}

// ── applyLookAtToVrm ────────────────────────────────────────────────

/**
 * vrm.lookAt 직접 구동. VRMLookAt.yaw/pitch 단위는 도(degree) —
 * 라디안을 넣으면 거의 움직이지 않는다. useFrame 밖 헬퍼로 분리(react-compiler 프롭 변이 제약).
 */
export function applyLookAtToVrm(vrm: VRM, lookAt: { yawDeg: number; pitchDeg: number }) {
  if (!vrm.lookAt) return;
  vrm.lookAt.yaw = lookAt.yawDeg;
  vrm.lookAt.pitch = lookAt.pitchDeg;
}

// ── Texture paint pointer helpers ───────────────────────────────────

export function studioVrmTexturePaintHit(
  event: ThreeEvent<PointerEvent>,
): StudioVrmTexturePaintRayHit | null {
  if (!(event.object instanceof THREE.Mesh) || (!event.uv && !event.uv1)) return null;
  return adaptThreeRaycastIntersection(event);
}

export function studioVrmTexturePaintPressure(event: ThreeEvent<PointerEvent>): number {
  const pressure = event.pressure;
  if (Number.isFinite(pressure) && pressure > 0) {
    return Math.min(1, Math.max(0.01, pressure));
  }
  return event.pointerType === "pen" ? 0.01 : 0.5;
}

export function studioVrmSurfacePaintWorldUnitsPerCssPixel(
  camera: THREE.Camera,
  point: Readonly<{ x: number; y: number; z: number }>,
  viewportHeightCssPixels: number,
  cameraPoint: THREE.Vector3,
): number | null {
  if (!Number.isFinite(viewportHeightCssPixels) || viewportHeightCssPixels <= 0) return null;
  if (camera instanceof THREE.PerspectiveCamera) {
    cameraPoint.set(point.x, point.y, point.z).applyMatrix4(camera.matrixWorldInverse);
    const depth = -cameraPoint.z;
    if (!Number.isFinite(depth) || depth <= 0) return null;
    const verticalFovRadians = THREE.MathUtils.degToRad(camera.getEffectiveFOV());
    const value = (2 * depth * Math.tan(verticalFovRadians / 2)) / viewportHeightCssPixels;
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (camera instanceof THREE.OrthographicCamera) {
    const value = Math.abs(camera.top - camera.bottom)
      / Math.max(Number.EPSILON, camera.zoom)
      / viewportHeightCssPixels;
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  return null;
}

export function studioVrmSurfacePaintPointerSample(
  event: ThreeEvent<PointerEvent>,
  phase: StudioVrmSurfacePaintPointerSample["phase"],
  hit: StudioVrmTexturePaintRayHit,
  camera: THREE.Camera,
  viewportHeightCssPixels: number,
  cameraPoint: THREE.Vector3,
): StudioVrmSurfacePaintPointerSample {
  const tiltX = Number.isFinite(event.tiltX)
    ? THREE.MathUtils.clamp(event.tiltX, -90, 90)
    : 0;
  const tiltY = Number.isFinite(event.tiltY)
    ? THREE.MathUtils.clamp(event.tiltY, -90, 90)
    : 0;
  return Object.freeze({
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    clientX: event.clientX,
    clientY: event.clientY,
    timeStamp: Number.isFinite(event.timeStamp) ? Math.max(0, event.timeStamp) : 0,
    pressure: studioVrmTexturePaintPressure(event),
    tiltX,
    tiltY,
    phase,
    hit,
    worldUnitsPerCssPixel: hit.point
      ? studioVrmSurfacePaintWorldUnitsPerCssPixel(
          camera,
          hit.point,
          viewportHeightCssPixels,
          cameraPoint,
        )
      : null,
  });
}

export const STUDIO_VRM_TEXTURE_PAINT_ONE_SHOT_TAP_MAX_DISTANCE_CSS_PX = 10;
export const STUDIO_VRM_TEXTURE_PAINT_ONE_SHOT_TAP_MAX_DISTANCE_SQUARED =
  STUDIO_VRM_TEXTURE_PAINT_ONE_SHOT_TAP_MAX_DISTANCE_CSS_PX
  * STUDIO_VRM_TEXTURE_PAINT_ONE_SHOT_TAP_MAX_DISTANCE_CSS_PX;

export interface StudioVrmTexturePaintPointerCaptureTarget {
  setPointerCapture(pointerId: number): void;
  releasePointerCapture(pointerId: number): void;
}

export interface StudioVrmTexturePaintPendingOneShotTap {
  readonly kind: "fill" | "sample";
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly hit: StudioVrmTexturePaintRayHit;
  readonly runtime: StudioVrmTexturePaintRuntime;
  readonly settings: StudioVrmTexturePaintPanelSettings;
  readonly explicitEyedropper: boolean;
  captureTarget: StudioVrmTexturePaintPointerCaptureTarget | null;
}

export function studioVrmTexturePaintOneShotTapMoved(
  pending: StudioVrmTexturePaintPendingOneShotTap,
  clientX: number,
  clientY: number,
): boolean {
  if (
    !Number.isFinite(pending.startClientX)
    || !Number.isFinite(pending.startClientY)
    || !Number.isFinite(clientX)
    || !Number.isFinite(clientY)
  ) {
    return true;
  }
  const deltaX = clientX - pending.startClientX;
  const deltaY = clientY - pending.startClientY;
  return deltaX * deltaX + deltaY * deltaY
    > STUDIO_VRM_TEXTURE_PAINT_ONE_SHOT_TAP_MAX_DISTANCE_SQUARED;
}
