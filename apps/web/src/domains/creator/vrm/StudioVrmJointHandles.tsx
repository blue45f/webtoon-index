/* eslint-disable react-refresh/only-export-components -- 순수 좌표/종료 헬퍼도 포인터 경계 테스트의 공개 계약이다. */

import { Html } from "@react-three/drei/web/Html.js";
import { useFrame, useThree } from "@react-three/fiber";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import * as THREE from "three";

import { studioVrmSceneLocalPointToWorld } from "./studio-vrm-ik-constraints";

import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

const POSITION_EPSILON = 1e-8;
const DEFAULT_DRAG_THRESHOLD_PX = 3;
const DEFAULT_KEYBOARD_STEP = 0.025;
const MINIMUM_TOUCH_TARGET_PX = 44;

export type StudioVrmJointHandleBone =
  | "hips"
  | "head"
  | "leftShoulder"
  | "rightShoulder"
  | "leftLowerArm"
  | "rightLowerArm"
  | "leftHand"
  | "rightHand"
  | "leftLowerLeg"
  | "rightLowerLeg"
  | "leftFoot"
  | "rightFoot";

export type StudioVrmIkEffectorBone =
  | "leftHand"
  | "rightHand"
  | "leftFoot"
  | "rightFoot";

export type StudioVrmJointWorldPoint = readonly [number, number, number];
export type StudioVrmIkHandleControl = "target" | "pole";
export type StudioVrmIkDragMode = "screen" | "depth";
export type StudioVrmIkAxisLock = "free" | "x" | "y" | "z";

type StudioVrmJointSide = "center" | "left" | "right";

export interface StudioVrmJointHandleDefinition {
  bone: StudioVrmJointHandleBone;
  label: string;
  side: StudioVrmJointSide;
  effector: boolean;
}

export const STUDIO_VRM_JOINT_HANDLE_DEFINITIONS = [
  { bone: "hips", label: "골반", side: "center", effector: false },
  { bone: "head", label: "머리", side: "center", effector: false },
  { bone: "leftShoulder", label: "왼쪽 어깨", side: "left", effector: false },
  { bone: "rightShoulder", label: "오른쪽 어깨", side: "right", effector: false },
  { bone: "leftLowerArm", label: "왼쪽 팔꿈치", side: "left", effector: false },
  { bone: "rightLowerArm", label: "오른쪽 팔꿈치", side: "right", effector: false },
  { bone: "leftHand", label: "왼손", side: "left", effector: true },
  { bone: "rightHand", label: "오른손", side: "right", effector: true },
  { bone: "leftLowerLeg", label: "왼쪽 무릎", side: "left", effector: false },
  { bone: "rightLowerLeg", label: "오른쪽 무릎", side: "right", effector: false },
  { bone: "leftFoot", label: "왼발", side: "left", effector: true },
  { bone: "rightFoot", label: "오른발", side: "right", effector: true },
] as const satisfies readonly StudioVrmJointHandleDefinition[];

export interface StudioVrmJointNodeBinding extends StudioVrmJointHandleDefinition {
  node: THREE.Object3D;
}

interface StudioVrmNormalizedHumanoidLike {
  getNormalizedBoneNode(name: VRMHumanBoneName): THREE.Object3D | null;
}

export interface StudioVrmJointDragSnapshot {
  bone: StudioVrmIkEffectorBone;
  startWorld: StudioVrmJointWorldPoint;
  latestWorld: StudioVrmJointWorldPoint;
  didPreview: boolean;
}

export type StudioVrmJointDragOutcome =
  | {
      kind: "selection-only";
      bone: StudioVrmIkEffectorBone;
    }
  | {
      kind: "commit";
      bone: StudioVrmIkEffectorBone;
      worldPosition: StudioVrmJointWorldPoint;
    }
  | {
      kind: "rollback";
      bone: StudioVrmIkEffectorBone;
      worldPosition: StudioVrmJointWorldPoint;
    };

export interface StudioVrmJointHandlesProps {
  vrm: Pick<VRM, "humanoid"> | null;
  selectedBone?: StudioVrmJointHandleBone | null;
  selectedPole?: StudioVrmIkEffectorBone | null;
  effectorSceneTargets?: Partial<Record<StudioVrmIkEffectorBone, StudioVrmJointWorldPoint>>;
  poleSceneTargets?: Partial<Record<StudioVrmIkEffectorBone, StudioVrmJointWorldPoint>>;
  dragPlane?: THREE.Plane | null;
  dragMode?: StudioVrmIkDragMode;
  axisLock?: StudioVrmIkAxisLock;
  screenSize?: number;
  keyboardStep?: number;
  disabled?: boolean;
  visible?: boolean;
  onSelectBone?: (bone: StudioVrmJointHandleBone) => void;
  onSelectPole?: (bone: StudioVrmIkEffectorBone) => void;
  onHoverBoneChange?: (bone: StudioVrmJointHandleBone | null) => void;
  onEffectorPreview?: (
    bone: StudioVrmIkEffectorBone,
    worldPosition: StudioVrmJointWorldPoint
  ) => void;
  onEffectorCommit?: (
    bone: StudioVrmIkEffectorBone,
    worldPosition: StudioVrmJointWorldPoint
  ) => void;
  onEffectorRollback?: (
    bone: StudioVrmIkEffectorBone,
    originalWorldPosition: StudioVrmJointWorldPoint
  ) => void;
  onPolePreview?: (
    bone: StudioVrmIkEffectorBone,
    worldPosition: StudioVrmJointWorldPoint
  ) => void;
  onPoleCommit?: (
    bone: StudioVrmIkEffectorBone,
    worldPosition: StudioVrmJointWorldPoint
  ) => void;
  onPoleRollback?: (
    bone: StudioVrmIkEffectorBone,
    originalWorldPosition: StudioVrmJointWorldPoint
  ) => void;
  /** OrbitControls의 enabled 값을 반대로 연결하기 위한 일시적 상호작용 잠금 신호다. */
  onInteractionActiveChange?: (active: boolean) => void;
}

interface DragSession {
  pointerId: number;
  bone: StudioVrmIkEffectorBone;
  captureTarget: HTMLButtonElement;
  startClientX: number;
  startClientY: number;
  startWorld: THREE.Vector3;
  latestWorld: THREE.Vector3;
  pendingWorld: THREE.Vector3 | null;
  plane: THREE.Plane;
  didPreview: boolean;
}

interface CanvasRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

function isFiniteVector(vector: THREE.Vector3 | null | undefined): vector is THREE.Vector3 {
  return Boolean(vector)
    && Number.isFinite(vector!.x)
    && Number.isFinite(vector!.y)
    && Number.isFinite(vector!.z);
}

function isFiniteWorldPoint(
  point: StudioVrmJointWorldPoint | null | undefined
): point is StudioVrmJointWorldPoint {
  return Boolean(point)
    && point!.length === 3
    && point!.every(Number.isFinite);
}

function isStudioVrmIkEffectorBone(
  bone: StudioVrmJointHandleBone
): bone is StudioVrmIkEffectorBone {
  return bone === "leftHand"
    || bone === "rightHand"
    || bone === "leftFoot"
    || bone === "rightFoot";
}

function worldPoint(vector: THREE.Vector3): StudioVrmJointWorldPoint {
  return [vector.x, vector.y, vector.z];
}

function stopPointerEvent(event: ReactPointerEvent<HTMLButtonElement>) {
  event.preventDefault();
  event.stopPropagation();
  event.nativeEvent.stopImmediatePropagation?.();
}

function stopKeyboardEvent(event: ReactKeyboardEvent<HTMLButtonElement>) {
  event.preventDefault();
  event.stopPropagation();
  event.nativeEvent.stopImmediatePropagation?.();
}

function releaseStudioVrmJointPointerCapture(session: DragSession) {
  try {
    if (session.captureTarget.hasPointerCapture?.(session.pointerId)) {
      session.captureTarget.releasePointerCapture?.(session.pointerId);
    }
  } catch {
    // pointercancel/lostpointercapture 또는 오래된 WebView가 이미 캡처를 해제했을 수 있다.
  }
}

/** 누락되거나 예외를 던지는 비표준 VRM 본은 개별적으로 건너뛴다. */
export function resolveStudioVrmJointNodeBindings(
  humanoid: StudioVrmNormalizedHumanoidLike | null | undefined
): StudioVrmJointNodeBinding[] {
  if (!humanoid) return [];

  const bindings: StudioVrmJointNodeBinding[] = [];
  for (const definition of STUDIO_VRM_JOINT_HANDLE_DEFINITIONS) {
    try {
      const node = humanoid.getNormalizedBoneNode(definition.bone);
      if (node instanceof THREE.Object3D) bindings.push({ ...definition, node });
    } catch {
      // 손상된 개별 bone accessor 때문에 나머지 핸들까지 숨기지 않는다.
    }
  }
  return bindings;
}

/** 명시된 평면이 유효하면 복사해 쓰고, 아니면 시작점을 지나는 카메라 정면 평면을 만든다. */
export function createStudioVrmJointDragPlane(
  camera: THREE.Camera,
  startWorld: THREE.Vector3,
  explicitPlane?: THREE.Plane | null
): THREE.Plane {
  if (
    explicitPlane
    && isFiniteVector(explicitPlane.normal)
    && explicitPlane.normal.lengthSq() > POSITION_EPSILON
    && Number.isFinite(explicitPlane.constant)
  ) {
    return explicitPlane.clone().normalize();
  }

  const normal = camera.getWorldDirection(new THREE.Vector3());
  if (!isFiniteVector(normal) || normal.lengthSq() <= POSITION_EPSILON) {
    normal.set(0, 0, -1);
  }
  return new THREE.Plane().setFromNormalAndCoplanarPoint(normal.normalize(), startWorld);
}

/** DOM 포인터 좌표를 캔버스 NDC로 바꾼 뒤 주어진 3D 평면과 교차시킨다. */
export function projectStudioVrmJointPointerToPlane(
  clientX: number,
  clientY: number,
  canvasRect: CanvasRectLike,
  camera: THREE.Camera,
  plane: THREE.Plane,
  target = new THREE.Vector3()
): THREE.Vector3 | null {
  if (
    !Number.isFinite(clientX)
    || !Number.isFinite(clientY)
    || !Number.isFinite(canvasRect.left)
    || !Number.isFinite(canvasRect.top)
    || !Number.isFinite(canvasRect.width)
    || !Number.isFinite(canvasRect.height)
    || canvasRect.width <= 0
    || canvasRect.height <= 0
  ) {
    return null;
  }

  const pointer = new THREE.Vector2(
    ((clientX - canvasRect.left) / canvasRect.width) * 2 - 1,
    -((clientY - canvasRect.top) / canvasRect.height) * 2 + 1
  );
  const raycaster = new THREE.Raycaster();
  camera.updateMatrixWorld();
  raycaster.setFromCamera(pointer, camera);
  const intersection = raycaster.ray.intersectPlane(plane, target);
  return isFiniteVector(intersection) ? intersection : null;
}

function worldUnitsPerVerticalPixel(
  camera: THREE.Camera,
  startWorld: THREE.Vector3,
  viewportHeight: number
): number | null {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return null;
  if (camera instanceof THREE.PerspectiveCamera) {
    const distance = camera.getWorldPosition(new THREE.Vector3()).distanceTo(startWorld);
    const verticalFov = THREE.MathUtils.degToRad(camera.getEffectiveFOV());
    const units = (2 * Math.tan(verticalFov / 2) * distance) / viewportHeight;
    return Number.isFinite(units) && units > 0 ? units : null;
  }
  if (camera instanceof THREE.OrthographicCamera) {
    const units = Math.abs(camera.top - camera.bottom) / Math.max(camera.zoom, POSITION_EPSILON) / viewportHeight;
    return Number.isFinite(units) && units > 0 ? units : null;
  }
  return null;
}

/** Keeps a pointer candidate on one explicit scene axis without mutating either input vector. */
export function constrainStudioVrmJointWorldPoint(
  startWorld: THREE.Vector3,
  candidateWorld: THREE.Vector3,
  axisLock: StudioVrmIkAxisLock,
  target = new THREE.Vector3()
): THREE.Vector3 | null {
  if (!isFiniteVector(startWorld) || !isFiniteVector(candidateWorld)) return null;
  target.copy(candidateWorld);
  if (axisLock === "x") target.set(candidateWorld.x, startWorld.y, startWorld.z);
  else if (axisLock === "y") target.set(startWorld.x, candidateWorld.y, startWorld.z);
  else if (axisLock === "z") target.set(startWorld.x, startWorld.y, candidateWorld.z);
  return isFiniteVector(target) ? target : null;
}

/**
 * Resolves screen-plane or pointer-driven depth movement, then applies an optional world-axis lock.
 * In depth mode an upward drag moves away from the camera; a locked axis uses that axis directly.
 */
export function projectStudioVrmJointPointerByMode(
  clientX: number,
  clientY: number,
  startClientY: number,
  canvasRect: CanvasRectLike,
  camera: THREE.Camera,
  plane: THREE.Plane,
  startWorld: THREE.Vector3,
  dragMode: StudioVrmIkDragMode,
  axisLock: StudioVrmIkAxisLock,
  target = new THREE.Vector3()
): THREE.Vector3 | null {
  if (!Number.isFinite(startClientY) || !isFiniteVector(startWorld)) return null;
  if (dragMode === "screen") {
    const projected = projectStudioVrmJointPointerToPlane(
      clientX,
      clientY,
      canvasRect,
      camera,
      plane,
      target
    );
    return projected
      ? constrainStudioVrmJointWorldPoint(startWorld, projected, axisLock, target)
      : null;
  }
  if (!Number.isFinite(clientY)) return null;
  const unitsPerPixel = worldUnitsPerVerticalPixel(camera, startWorld, canvasRect.height);
  if (!unitsPerPixel) return null;
  const direction = axisLock === "free"
    ? camera.getWorldDirection(new THREE.Vector3()).normalize()
    : new THREE.Vector3(
        axisLock === "x" ? 1 : 0,
        axisLock === "y" ? 1 : 0,
        axisLock === "z" ? 1 : 0
      );
  if (!isFiniteVector(direction) || direction.lengthSq() <= POSITION_EPSILON) return null;
  target.copy(startWorld).addScaledVector(
    direction,
    (startClientY - clientY) * unitsPerPixel
  );
  return isFiniteVector(target) ? target : null;
}

/** 취소 계열은 항상 시작점 롤백, 정상 종료는 실제 preview가 있었을 때만 확정한다. */
export function resolveStudioVrmJointDragOutcome(
  snapshot: StudioVrmJointDragSnapshot,
  cancelled: boolean
): StudioVrmJointDragOutcome {
  if (cancelled) {
    return {
      kind: "rollback",
      bone: snapshot.bone,
      worldPosition: [...snapshot.startWorld],
    };
  }
  if (!snapshot.didPreview) return { kind: "selection-only", bone: snapshot.bone };
  return {
    kind: "commit",
    bone: snapshot.bone,
    worldPosition: [...snapshot.latestWorld],
  };
}

function handleColor(side: StudioVrmJointSide): string {
  if (side === "left") return "#38bdf8";
  if (side === "right") return "#f472b6";
  return "#fbbf24";
}

function Handle({
  binding,
  control,
  selected,
  controlledSceneTarget,
  dragPlane,
  dragMode,
  axisLock,
  screenSize,
  keyboardStep,
  disabled,
  onSelect,
  onHoverBoneChange,
  onPreview,
  onCommit,
  onRollback,
  onInteractionActiveChange,
}: {
  binding: StudioVrmJointNodeBinding;
  control: StudioVrmIkHandleControl;
  selected: boolean;
  controlledSceneTarget?: StudioVrmJointWorldPoint;
  dragPlane?: THREE.Plane | null;
  dragMode: StudioVrmIkDragMode;
  axisLock: StudioVrmIkAxisLock;
  screenSize: number;
  keyboardStep: number;
  disabled: boolean;
  onSelect?: () => void;
  onHoverBoneChange?: StudioVrmJointHandlesProps["onHoverBoneChange"];
  onPreview?: StudioVrmJointHandlesProps["onEffectorPreview"];
  onCommit?: StudioVrmJointHandlesProps["onEffectorCommit"];
  onRollback?: StudioVrmJointHandlesProps["onEffectorRollback"];
  onInteractionActiveChange?: StudioVrmJointHandlesProps["onInteractionActiveChange"];
}) {
  const groupRef = useRef<THREE.Group>(null);
  const dragRef = useRef<DragSession | null>(null);
  const dragWindowCleanupRef = useRef<(() => void) | null>(null);
  const previewFrameRef = useRef<number | null>(null);
  const scratchWorldRef = useRef(new THREE.Vector3());
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const coordinateScene = useThree((state) => state.scene);
  const effectorBone = isStudioVrmIkEffectorBone(binding.bone) ? binding.bone : null;

  const readControlledWorldPosition = (): THREE.Vector3 | null => {
    if (!binding.effector || !isFiniteWorldPoint(controlledSceneTarget)) return null;
    const world = studioVrmSceneLocalPointToWorld(coordinateScene, controlledSceneTarget);
    return world ? new THREE.Vector3(world[0], world[1], world[2]) : null;
  };

  const rollbackOnUnmount = useEffectEvent((session: DragSession) => {
    onRollback?.(session.bone, worldPoint(session.startWorld));
    onInteractionActiveChange?.(false);
  });

  useEffect(() => () => {
    const previewFrame = previewFrameRef.current;
    previewFrameRef.current = null;
    if (previewFrame !== null) cancelAnimationFrame(previewFrame);
    const cleanupWindowFallbacks = dragWindowCleanupRef.current;
    dragWindowCleanupRef.current = null;
    cleanupWindowFallbacks?.();
    const session = dragRef.current;
    dragRef.current = null;
    if (session) {
      releaseStudioVrmJointPointerCapture(session);
      rollbackOnUnmount(session);
    }
  }, []);

  useFrame(() => {
    const group = groupRef.current;
    if (!group || dragRef.current) return;

    const controlledWorld = readControlledWorldPosition();
    if (controlledWorld) {
      group.position.copy(controlledWorld);
      group.visible = true;
      return;
    }
    if (control === "pole") {
      group.visible = false;
      return;
    }

    binding.node.updateWorldMatrix(true, false);
    const world = binding.node.getWorldPosition(scratchWorldRef.current);
    group.visible = isFiniteVector(world);
    if (group.visible) group.position.copy(world);
  });

  const readCurrentWorldPosition = (): THREE.Vector3 | null => {
    const controlledWorld = readControlledWorldPosition();
    if (controlledWorld) return controlledWorld;
    if (control === "pole") return null;
    binding.node.updateWorldMatrix(true, false);
    const world = binding.node.getWorldPosition(new THREE.Vector3());
    return isFiniteVector(world) ? world : null;
  };

  const cancelPendingPreviewFrame = () => {
    const previewFrame = previewFrameRef.current;
    previewFrameRef.current = null;
    if (previewFrame !== null) cancelAnimationFrame(previewFrame);
  };

  const flushPendingPreview = (session: DragSession) => {
    const pendingWorld = session.pendingWorld;
    if (!pendingWorld) return;
    session.pendingWorld = null;
    session.didPreview = true;
    session.latestWorld.copy(pendingWorld);
    groupRef.current?.position?.copy(pendingWorld);
    onPreview?.(session.bone, worldPoint(pendingWorld));
  };

  const schedulePendingPreview = (session: DragSession) => {
    if (previewFrameRef.current !== null) return;
    previewFrameRef.current = requestAnimationFrame(() => {
      previewFrameRef.current = null;
      if (dragRef.current !== session) return;
      flushPendingPreview(session);
    });
  };

  const clearDragWindowFallbacks = () => {
    const cleanup = dragWindowCleanupRef.current;
    dragWindowCleanupRef.current = null;
    cleanup?.();
  };

  const finishDrag = (pointerId: number, cancelled: boolean) => {
    const session = dragRef.current;
    if (!session || session.pointerId !== pointerId) return;
    // Claim completion before releasing capture or invoking callbacks. A synchronous
    // lostpointercapture and every late local/window event then become deterministic no-ops.
    dragRef.current = null;
    clearDragWindowFallbacks();
    cancelPendingPreviewFrame();
    if (cancelled) session.pendingWorld = null;
    else flushPendingPreview(session);
    setDragging(false);
    onInteractionActiveChange?.(false);
    releaseStudioVrmJointPointerCapture(session);

    const outcome = resolveStudioVrmJointDragOutcome({
      bone: session.bone,
      startWorld: worldPoint(session.startWorld),
      latestWorld: worldPoint(session.latestWorld),
      didPreview: session.didPreview,
    }, cancelled);
    if (outcome.kind === "rollback") {
      groupRef.current?.position?.copy(session.startWorld);
      onRollback?.(outcome.bone, outcome.worldPosition);
    } else if (outcome.kind === "commit") {
      onCommit?.(outcome.bone, outcome.worldPosition);
    }
  };

  const installDragWindowFallbacks = () => {
    clearDragWindowFallbacks();
    const finishMatchingPointer = (event: PointerEvent) => {
      const session = dragRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      finishDrag(event.pointerId, event.type === "pointercancel");
    };
    const finishOnWindowBlur = () => {
      const session = dragRef.current;
      if (session) finishDrag(session.pointerId, true);
    };
    window.addEventListener("pointerup", finishMatchingPointer);
    window.addEventListener("pointercancel", finishMatchingPointer);
    window.addEventListener("blur", finishOnWindowBlur);
    dragWindowCleanupRef.current = () => {
      window.removeEventListener("pointerup", finishMatchingPointer);
      window.removeEventListener("pointercancel", finishMatchingPointer);
      window.removeEventListener("blur", finishOnWindowBlur);
    };
  };

  const handleKeyboardNudge = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!effectorBone || disabled) return;
    const localStep = keyboardStep * (event.shiftKey ? 4 : 1);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
    const forward = camera.getWorldDirection(new THREE.Vector3()).normalize();
    let delta: THREE.Vector3 | null = null;
    if (event.key === "ArrowLeft") delta = right.multiplyScalar(-localStep);
    else if (event.key === "ArrowRight") delta = right.multiplyScalar(localStep);
    else if (event.key === "ArrowUp") delta = up.multiplyScalar(localStep);
    else if (event.key === "ArrowDown") delta = up.multiplyScalar(-localStep);
    else if (event.key === "PageUp") delta = forward.multiplyScalar(localStep);
    else if (event.key === "PageDown") delta = forward.multiplyScalar(-localStep);
    if (!delta) return;

    stopKeyboardEvent(event);
    const current = readCurrentWorldPosition();
    if (!current) return;
    const next = current.clone().add(delta);
    const constrained = constrainStudioVrmJointWorldPoint(current, next, axisLock, next);
    if (!constrained) return;
    groupRef.current?.position?.copy(constrained);
    const nextPoint = worldPoint(constrained);
    onSelect?.();
    onPreview?.(effectorBone, nextPoint);
    onCommit?.(effectorBone, nextPoint);
  };

  const isPole = control === "pole";
  const size = THREE.MathUtils.clamp(
    isPole ? screenSize * 0.82 : screenSize,
    isPole ? 16 : 14,
    36
  );
  const color = isPole ? "#f59e0b" : handleColor(binding.side);
  const active = selected || hovered || dragging;
  const buttonStyle: CSSProperties = {
    width: MINIMUM_TOUCH_TARGET_PX,
    height: MINIMUM_TOUCH_TARGET_PX,
    border: 0,
    background: "transparent",
    cursor: disabled ? "not-allowed" : dragging ? "grabbing" : binding.effector ? "grab" : "pointer",
    display: "grid",
    placeItems: "center",
    opacity: disabled ? 0.45 : 0.94,
    pointerEvents: "auto",
    padding: 0,
    touchAction: "none",
  };
  const visualStyle: CSSProperties = {
    width: size,
    height: size,
    borderRadius: isPole || !binding.effector ? "999px" : Math.max(5, size * 0.28),
    border: `${selected ? 3 : 2}px solid ${selected ? "#ffffff" : "rgba(255,255,255,0.9)"}`,
    background: color,
    boxShadow: selected
      ? `0 0 0 2px rgba(15,23,42,0.92), 0 0 14px ${color}`
      : "0 1px 5px rgba(15,23,42,0.75)",
    position: "relative",
    display: "grid",
    placeItems: "center",
    color: "#3c2b20",
    fontSize: Math.max(9, size * 0.48),
    fontWeight: 900,
    lineHeight: 1,
    transform: `${active ? "scale(1.18)" : "scale(1)"} ${binding.effector && !isPole ? "rotate(45deg)" : ""}`,
    transition: dragging ? "none" : "transform 100ms ease, box-shadow 100ms ease",
  };
  const axisLabel = axisLock === "free" ? "자유 축" : `${axisLock.toUpperCase()}축 제한`;
  const modeLabel = dragMode === "screen" ? "화면 평면" : "깊이";
  const controlLabel = isPole
    ? `${binding.label} IK 폴 방향 이동`
    : `${binding.label} 관절${binding.effector ? " IK 목표 이동" : " 선택"}`;

  return (
    <group ref={groupRef}>
      <Html center transform={false} zIndexRange={[80, 10]} pointerEvents="none">
        <button
          type="button"
          aria-label={controlLabel}
          aria-pressed={selected}
          aria-keyshortcuts={binding.effector ? "ArrowLeft ArrowRight ArrowUp ArrowDown PageUp PageDown" : undefined}
          data-bone={binding.bone}
          data-effector={binding.effector || undefined}
          data-ik-control={binding.effector ? control : undefined}
          disabled={disabled}
          title={binding.effector
            ? `${binding.label} ${isPole ? "폴" : "목표"}: ${modeLabel} 이동 · ${axisLabel}`
            : `${binding.label} 관절 선택`}
          style={buttonStyle}
          onFocus={() => {
            setHovered(true);
            onHoverBoneChange?.(binding.bone);
          }}
          onBlur={() => {
            setHovered(false);
            onHoverBoneChange?.(null);
          }}
          onPointerEnter={() => {
            setHovered(true);
            onHoverBoneChange?.(binding.bone);
          }}
          onPointerLeave={() => {
            setHovered(false);
            onHoverBoneChange?.(null);
          }}
          onPointerDown={(event) => {
            if (disabled || event.button !== 0) return;
            stopPointerEvent(event);
            onSelect?.();
            if (!effectorBone) return;
            if (dragRef.current) return;

            const startWorld = readCurrentWorldPosition();
            if (!startWorld) return;
            dragRef.current = {
              pointerId: event.pointerId,
              bone: effectorBone,
              captureTarget: event.currentTarget,
              startClientX: event.clientX,
              startClientY: event.clientY,
              startWorld: startWorld.clone(),
              latestWorld: startWorld.clone(),
              pendingWorld: null,
              plane: createStudioVrmJointDragPlane(camera, startWorld, dragPlane),
              didPreview: false,
            };
            setDragging(true);
            onInteractionActiveChange?.(true);
            installDragWindowFallbacks();
            try {
              event.currentTarget.setPointerCapture?.(event.pointerId);
            } catch {
              // 오래된 WebView에서는 포인터 캡처 API가 없거나 실패할 수 있다.
            }
          }}
          onPointerMove={(event) => {
            const session = dragRef.current;
            if (!session || session.pointerId !== event.pointerId) return;
            stopPointerEvent(event);
            const movement = Math.hypot(
              event.clientX - session.startClientX,
              event.clientY - session.startClientY
            );
            if (!session.didPreview && movement < DEFAULT_DRAG_THRESHOLD_PX) return;

            const projected = projectStudioVrmJointPointerByMode(
              event.clientX,
              event.clientY,
              session.startClientY,
              canvas.getBoundingClientRect(),
              camera,
              session.plane,
              session.startWorld,
              dragMode,
              axisLock
            );
            if (!projected) return;
            if (session.pendingWorld) session.pendingWorld.copy(projected);
            else session.pendingWorld = projected.clone();
            groupRef.current?.position?.copy(projected);
            schedulePendingPreview(session);
          }}
          onPointerUp={(event) => {
            stopPointerEvent(event);
            finishDrag(event.pointerId, false);
          }}
          onPointerCancel={(event) => {
            stopPointerEvent(event);
            finishDrag(event.pointerId, true);
          }}
          onLostPointerCapture={(event) => {
            stopPointerEvent(event);
            finishDrag(event.pointerId, true);
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onKeyDown={(event) => {
            if ((event.key === "Enter" || event.key === " ") && !disabled) {
              stopKeyboardEvent(event);
              onSelect?.();
              return;
            }
            if (event.key === "Escape" && dragRef.current) {
              stopKeyboardEvent(event);
              finishDrag(dragRef.current.pointerId, true);
              return;
            }
            handleKeyboardNudge(event);
          }}
        >
          <span aria-hidden data-handle-visual={control} style={visualStyle}>
            {isPole ? "P" : binding.effector ? (
              <span
                style={{
                  position: "absolute",
                  inset: "28%",
                  borderRadius: "999px",
                  background: "rgba(15,23,42,0.82)",
                }}
              />
            ) : null}
          </span>
        </button>
      </Html>
    </group>
  );
}

/**
 * VRM normalized humanoid의 주요 관절과 손·발 IK 목표를 표시한다.
 * 영속 포즈 상태는 소유하지 않고 모든 preview/commit/rollback을 상위 콜백으로 전달한다.
 */
export function StudioVrmJointHandles({
  vrm,
  selectedBone = null,
  selectedPole = null,
  effectorSceneTargets,
  poleSceneTargets,
  dragPlane,
  dragMode = "screen",
  axisLock = "free",
  screenSize = 22,
  keyboardStep = DEFAULT_KEYBOARD_STEP,
  disabled = false,
  visible = true,
  onSelectBone,
  onSelectPole,
  onHoverBoneChange,
  onEffectorPreview,
  onEffectorCommit,
  onEffectorRollback,
  onPolePreview,
  onPoleCommit,
  onPoleRollback,
  onInteractionActiveChange,
}: StudioVrmJointHandlesProps) {
  if (!visible) return null;
  const bindings = resolveStudioVrmJointNodeBindings(vrm?.humanoid);
  if (bindings.length === 0) return null;

  const safeScreenSize = Number.isFinite(screenSize) ? screenSize : 22;
  const safeKeyboardStep = Number.isFinite(keyboardStep) && keyboardStep > 0
    ? keyboardStep
    : DEFAULT_KEYBOARD_STEP;

  return (
    <group name="studio-vrm-joint-handles">
      {bindings.map((binding) => (
        <Handle
          key={binding.bone}
          binding={binding}
          control="target"
          selected={selectedBone === binding.bone && selectedPole !== binding.bone}
          controlledSceneTarget={isStudioVrmIkEffectorBone(binding.bone)
            ? effectorSceneTargets?.[binding.bone]
            : undefined}
          dragPlane={dragPlane}
          dragMode={dragMode}
          axisLock={axisLock}
          screenSize={safeScreenSize}
          keyboardStep={safeKeyboardStep}
          disabled={disabled}
          onSelect={() => onSelectBone?.(binding.bone)}
          onHoverBoneChange={onHoverBoneChange}
          onPreview={onEffectorPreview}
          onCommit={onEffectorCommit}
          onRollback={onEffectorRollback}
          onInteractionActiveChange={onInteractionActiveChange}
        />
      ))}
      {bindings.flatMap((binding) => {
        if (!isStudioVrmIkEffectorBone(binding.bone)) return [];
        const effector = binding.bone;
        const pole = poleSceneTargets?.[effector];
        if (!isFiniteWorldPoint(pole)) return [];
        return [(
          <Handle
            key={`${binding.bone}-pole`}
            binding={binding}
            control="pole"
            selected={selectedPole === effector}
            controlledSceneTarget={pole}
            dragPlane={dragPlane}
            dragMode={dragMode}
            axisLock={axisLock}
            screenSize={safeScreenSize}
            keyboardStep={safeKeyboardStep}
            disabled={disabled}
            onSelect={() => onSelectPole?.(effector)}
            onHoverBoneChange={onHoverBoneChange}
            onPreview={onPolePreview}
            onCommit={onPoleCommit}
            onRollback={onPoleRollback}
            onInteractionActiveChange={onInteractionActiveChange}
          />
        )];
      })}
    </group>
  );
}
