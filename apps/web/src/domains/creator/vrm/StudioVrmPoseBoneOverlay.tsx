import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

import { VIEWPORT_POSE_BONES } from "./StudioVrmPoserTypes";

import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

export function VrmPoseBoneMarker({
  vrm,
  boneName,
  selected,
  locked,
  draggable,
  onSelect,
  onDrag,
}: {
  readonly vrm: VRM;
  readonly boneName: VRMHumanBoneName;
  readonly selected: boolean;
  readonly locked: boolean;
  readonly draggable: boolean;
  readonly onSelect: (boneName: VRMHumanBoneName) => void;
  readonly onDrag: (
    boneName: VRMHumanBoneName,
    target: readonly [number, number, number],
    phase: "start" | "move" | "end",
  ) => void;
}) {
  const markerRef = useRef<THREE.Mesh>(null);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const worldPositionRef = useRef(new THREE.Vector3());
  const dragPlaneRef = useRef(new THREE.Plane());
  const dragPointRef = useRef(new THREE.Vector3());
  const dragNormalRef = useRef(new THREE.Vector3());
  const lastDragPointRef = useRef(new THREE.Vector3());
  const draggingRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const pointerCaptureTargetRef = useRef<{
    releasePointerCapture(pointerId: number): void;
  } | null>(null);
  const onDragRef = useRef(onDrag);
  const finishDragRef = useRef<(target?: THREE.Vector3) => void>(() => undefined);

  useEffect(() => {
    onDragRef.current = onDrag;
  }, [onDrag]);

  useEffect(() => {
    const finishDrag = (target = lastDragPointRef.current) => {
      // R3F 9.6 does not dispatch object-level pointercancel/lostpointercapture handlers.
      // Every R3F and native exit path converges here; the guard makes the pose commit exact-once.
      if (!draggingRef.current) return;
      draggingRef.current = false;
      const pointerId = activePointerIdRef.current;
      activePointerIdRef.current = null;
      const pointerCaptureTarget = pointerCaptureTargetRef.current;
      pointerCaptureTargetRef.current = null;
      if (pointerId !== null && pointerCaptureTarget) {
        try {
          pointerCaptureTarget.releasePointerCapture(pointerId);
        } catch {
          // The browser may already have released capture before lostpointercapture/blur arrives.
        }
      }
      onDragRef.current(boneName, [target.x, target.y, target.z], "end");
    };
    finishDragRef.current = finishDrag;

    const finishMatchingPointer = (event: PointerEvent) => {
      const activePointerId = activePointerIdRef.current;
      if (activePointerId === null || event.pointerId !== activePointerId) return;
      finishDrag();
    };
    const finishOnWindowBlur = () => finishDrag();

    // Bubble-stage window handlers run after the normal R3F pointerup path. If R3F already
    // finished the drag, finishDrag's guard makes these fallbacks harmless.
    window.addEventListener("pointerup", finishMatchingPointer);
    window.addEventListener("pointercancel", finishMatchingPointer);
    window.addEventListener("blur", finishOnWindowBlur);
    gl.domElement.addEventListener("lostpointercapture", finishMatchingPointer);
    return () => {
      window.removeEventListener("pointerup", finishMatchingPointer);
      window.removeEventListener("pointercancel", finishMatchingPointer);
      window.removeEventListener("blur", finishOnWindowBlur);
      gl.domElement.removeEventListener("lostpointercapture", finishMatchingPointer);
      finishDrag();
      if (finishDragRef.current === finishDrag) {
        finishDragRef.current = () => undefined;
      }
    };
  }, [boneName, gl]);

  useFrame(() => {
    const marker = markerRef.current;
    const bone = vrm.humanoid?.getNormalizedBoneNode(boneName);
    if (!marker || !bone) {
      if (marker) marker.visible = false;
      return;
    }
    bone.getWorldPosition(worldPositionRef.current);
    if (!draggingRef.current) lastDragPointRef.current.copy(worldPositionRef.current);
    marker.position.copy(worldPositionRef.current);
    const markerScale = THREE.MathUtils.clamp(
      camera.position.distanceTo(worldPositionRef.current) * 0.011,
      0.024,
      0.065,
    );
    marker.scale.setScalar(markerScale);
    marker.visible = true;
  });

  return (
    <mesh
      ref={markerRef}
      renderOrder={100}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(boneName);
      }}
      onPointerDown={(event) => {
        if (!draggable) return;
        event.stopPropagation();
        onSelect(boneName);
        camera.getWorldDirection(dragNormalRef.current);
        dragPlaneRef.current.setFromNormalAndCoplanarPoint(
          dragNormalRef.current,
          worldPositionRef.current,
        );
        draggingRef.current = true;
        activePointerIdRef.current = event.pointerId;
        lastDragPointRef.current.copy(worldPositionRef.current);
        // R3F owns an internal capturedMap in addition to the browser canvas capture. Capturing
        // through the event object keeps move/up delivery bound to this small 3D marker even when
        // the ray leaves it during a fast IK drag.
        const pointerTarget = event.currentTarget as unknown as {
          setPointerCapture(pointerId: number): void;
          releasePointerCapture(pointerId: number): void;
        };
        pointerTarget.setPointerCapture(event.pointerId);
        pointerCaptureTargetRef.current = pointerTarget;
        onDrag(boneName, [
          worldPositionRef.current.x,
          worldPositionRef.current.y,
          worldPositionRef.current.z,
        ], "start");
      }}
      onPointerMove={(event) => {
        if (!draggingRef.current || !draggable) return;
        event.stopPropagation();
        const target = event.ray.intersectPlane(dragPlaneRef.current, dragPointRef.current);
        if (!target || ![target.x, target.y, target.z].every(Number.isFinite)) return;
        lastDragPointRef.current.copy(target);
        onDrag(boneName, [target.x, target.y, target.z], "move");
      }}
      onPointerUp={(event) => {
        if (!draggingRef.current) return;
        event.stopPropagation();
        const target = event.ray.intersectPlane(dragPlaneRef.current, dragPointRef.current)
          ?? lastDragPointRef.current;
        lastDragPointRef.current.copy(target);
        finishDragRef.current(target);
      }}
      onPointerCancel={(event) => {
        if (!draggingRef.current) return;
        event.stopPropagation();
        finishDragRef.current();
      }}
      onLostPointerCapture={(event) => {
        if (!draggingRef.current) return;
        event.stopPropagation();
        finishDragRef.current();
      }}
    >
      <sphereGeometry args={[1, 16, 12]} />
      <meshBasicMaterial
        color={selected ? "#ff5a36" : locked ? "#f2a93b" : draggable ? "#32c48d" : "#39a9ff"}
        transparent
        opacity={selected ? 1 : 0.82}
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

export function VrmPoseBoneOverlay({
  vrm,
  selectedBone,
  lockedBones,
  handIkEnabled,
  onSelect,
  onDrag,
}: {
  readonly vrm: VRM;
  readonly selectedBone: VRMHumanBoneName | null;
  readonly lockedBones: readonly VRMHumanBoneName[];
  readonly handIkEnabled: boolean;
  readonly onSelect: (boneName: VRMHumanBoneName) => void;
  readonly onDrag: (
    boneName: VRMHumanBoneName,
    target: readonly [number, number, number],
    phase: "start" | "move" | "end",
  ) => void;
}) {
  return (
    <group name="studio-vrm-pose-bone-overlay">
      {VIEWPORT_POSE_BONES.map((boneName) => (
        <VrmPoseBoneMarker
          key={boneName}
          vrm={vrm}
          boneName={boneName}
          selected={selectedBone === boneName}
          locked={lockedBones.includes(boneName)}
          draggable={
            handIkEnabled &&
            (boneName === "leftHand" || boneName === "rightHand") &&
            !lockedBones.some((lockedBone) => (
              boneName === "leftHand"
                ? ["leftUpperArm", "leftLowerArm", "leftHand"].includes(lockedBone)
                : ["rightUpperArm", "rightLowerArm", "rightHand"].includes(lockedBone)
            ))
          }
          onSelect={onSelect}
          onDrag={onDrag}
        />
      ))}
    </group>
  );
}
