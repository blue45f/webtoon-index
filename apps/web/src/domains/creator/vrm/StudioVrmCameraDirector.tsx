import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

import { resolveStudioVrmInspectionBounds, type StudioVrmInspectionLandmarks } from "./studio-vrm-inspection-framing";
import { resolveStudioVrmPortraitBounds } from "./studio-vrm-portrait-framing";
import { findCameraPreset } from "./studio-vrm-poser-helpers";
import { fitStudioVrmPreviewCamera } from "./studio-vrm-preview-framing";
import { applyCameraPreset, type OrbitLike } from "./StudioVrmPoserTypes";

import type { VRM } from "@pixiv/three-vrm";

/** One-shot measurement after pose commit, ignoring hidden/off-camera meshes. */
function visibleCharacterBounds(scene: THREE.Object3D, camera: THREE.Camera): THREE.Box3 {
  const bounds = new THREE.Box3();
  const transformed = new THREE.Box3();
  scene.updateWorldMatrix(true, true);
  scene.traverseVisible((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || !camera.layers.test(mesh.layers)) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!materials.some((material) => material?.visible && !(material.transparent && material.opacity <= 0))) return;
    if (!mesh.matrixWorld.elements.every(Number.isFinite)) return;
    try {
      const skinned = mesh as THREE.SkinnedMesh;
      if (skinned.isSkinnedMesh) {
        skinned.computeBoundingBox();
        if (!skinned.boundingBox) return;
        transformed.copy(skinned.boundingBox).applyMatrix4(mesh.matrixWorld);
      } else {
        mesh.geometry.computeBoundingBox();
        if (!mesh.geometry.boundingBox) return;
        transformed.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
      }
      if ([...transformed.min.toArray(), ...transformed.max.toArray()].every(Number.isFinite) && !transformed.isEmpty()) bounds.union(transformed);
    } catch {
      // A malformed imported primitive must not take down the entire preview.
    }
  });
  return bounds;
}

function portraitLandmarks(vrm: VRM): StudioVrmInspectionLandmarks {
  const points: Partial<Record<keyof StudioVrmInspectionLandmarks, readonly [number, number, number]>> = {};
  for (const name of ["head", "neck", "leftEye", "rightEye", "chest", "leftUpperArm", "rightUpperArm", "hips", "spine", "leftHand", "rightHand", "leftMiddleProximal", "rightMiddleProximal", "leftLowerLeg", "rightLowerLeg", "leftFoot", "rightFoot", "leftToes", "rightToes"] as const) {
    const node = vrm.humanoid?.getNormalizedBoneNode(name);
    if (!node) continue;
    const position = node.getWorldPosition(new THREE.Vector3());
    if (position.toArray().every(Number.isFinite)) points[name] = [position.x, position.y, position.z];
  }
  return points;
}

export function CameraDirector({ presetId, resetNonce, vrm, interactionLocked = false }: {
  presetId: string;
  resetNonce: number;
  vrm?: VRM | null;
  interactionLocked?: boolean;
}) {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const controls = useThree((state) => state.controls) as OrbitLike;
  const pendingRef = useRef(false);
  const preset = findCameraPreset(presetId);

  useEffect(() => {
    pendingRef.current = presetId !== "custom";
    if (pendingRef.current) invalidate();
  }, [camera, controls, invalidate, preset, presetId, resetNonce, vrm]);
  useEffect(() => {
    if (!interactionLocked && pendingRef.current) invalidate();
  }, [interactionLocked, invalidate]);

  // Measure after base pose (-3), prop IK (-2), grip refinement (-1.5) and raw
  // commit (-1). Resizing a panel or editing a finger is not a framing command.
  // Read mutable Three objects from the current frame, not a useThree snapshot.
  useFrame(({ camera: frameCamera, controls: frameControls, size }) => {
    if (!pendingRef.current || presetId === "custom" || interactionLocked || size.width <= 0 || size.height <= 0) return;
    pendingRef.current = false;
    const orbit = frameControls as OrbitLike;
    let effectivePreset = preset;
    let fitDistance: number | null = null;
    let boundsRadius = 0;
    if (vrm?.scene) {
      const box = visibleCharacterBounds(vrm.scene, frameCamera);
      const bodyBounds = { min: box.min.toArray() as [number, number, number], max: box.max.toArray() as [number, number, number] };
      const landmarks = portraitLandmarks(vrm);
      const portrait = resolveStudioVrmInspectionBounds(presetId, bodyBounds, landmarks)
        ?? resolveStudioVrmPortraitBounds(presetId, bodyBounds, landmarks);
      // Keep the actual portrait lens/direction, fitting only its landmark region.
      // Custom and over-shoulder crops never enter this automatic subject fit.
      const fitPreset = portrait ? { ...preset, id: "fullBody" } : preset;
      const selectedBounds = portrait ?? bodyBounds;
      const fitted = fitStudioVrmPreviewCamera(fitPreset, selectedBounds, size.width / size.height);
      if (fitted) {
        effectivePreset = { ...preset, position: fitted.position, target: fitted.target };
        fitDistance = fitted.distance;
        boundsRadius = Math.hypot(...selectedBounds.max.map((value, axis) => value - selectedBounds.min[axis])) / 2;
      } else {
        // Preserve the legacy fallback when the imported rig cannot provide safe landmarks.
        const height = box.max.y - box.min.y;
        if (Number.isFinite(height) && height > 0.3 && height < 10 && Math.abs(height - 1.6) > 0.12) {
          const shift = (height - 1.6) * 0.62;
          const scale = Math.min(1.25, Math.max(0.75, Math.sqrt(height / 1.6)));
          effectivePreset = {
            ...preset,
            target: [preset.target[0], Math.max(box.min.y + 0.1, preset.target[1] + shift), preset.target[2]],
            position: [preset.position[0] * scale, Math.max(box.min.y + 0.2, preset.position[1] + shift), preset.position[2] * scale],
          };
        }
      }
    }
    const vertical = Math.hypot(effectivePreset.position[0] - effectivePreset.target[0], effectivePreset.position[2] - effectivePreset.target[2]) < 1e-8;
    frameCamera.up.set(0, vertical ? 0 : 1, vertical ? 1 : 0);
    if (frameCamera instanceof THREE.PerspectiveCamera) frameCamera.zoom = 1;
    if (fitDistance !== null) {
      if (orbit) {
        orbit.minDistance = Math.min(orbit.minDistance ?? 1.3, fitDistance * 0.25);
        orbit.maxDistance = Math.max(orbit.maxDistance ?? 5.2, fitDistance * 3);
      }
      if (frameCamera instanceof THREE.PerspectiveCamera) {
        frameCamera.near = Math.min(frameCamera.near, Math.max(0.001, fitDistance * 0.005));
        frameCamera.far = Math.max(frameCamera.far, fitDistance + boundsRadius * 3);
      }
    }
    applyCameraPreset(frameCamera, effectivePreset, invalidate);
    if (orbit?.target) {
      orbit.target.set(...effectivePreset.target);
      orbit.update?.();
    }
  });
  return null;
}
