/* eslint-disable react-refresh/only-export-components -- the pure raycast contract is tested with its null-rendering R3F transport. */
import { useThree } from "@react-three/fiber";
import { useEffect, useEffectEvent } from "react";
import * as THREE from "three";

import {
  isStudioBg3dViewportControlTarget,
  readStudioBg3dWorldSurfaceHit,
} from "./studio-bg3d-camera-application";
import { STUDIO_BG3D_PLACEMENT_MAX_WORLD_COORDINATE } from "./studio-bg3d-placement-session";

import type { StudioBg3dPlacementPointerTarget } from "./studio-bg3d-placement-session";

/** Set this on preview meshes, handles, grids, and other helpers that must never receive placement. */
export const STUDIO_BG3D_PLACEMENT_RAYCAST_IGNORE_USER_DATA_KEY =
  "studioBg3dPlacementRaycastIgnore";

const STUDIO_BG3D_FLOOR_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const STUDIO_BG3D_MIN_RAY_DIRECTION_LENGTH_SQUARED = 1e-12;

export type StudioBg3dPlacementRotationDirection = "clockwise" | "counter-clockwise";

export interface StudioBg3dPlacementObjectsRef {
  readonly current: ReadonlyMap<string, THREE.Object3D> | null;
}

export interface StudioBg3dPlacementPointerControllerProps {
  readonly active: boolean;
  /** Only canonical scene model/primitive roots belong in this registry. */
  readonly objectsRef: StudioBg3dPlacementObjectsRef;
  readonly onMove: (target: StudioBg3dPlacementPointerTarget, shiftKey: boolean) => void;
  readonly onCommit: (target: StudioBg3dPlacementPointerTarget, shiftKey: boolean) => void;
  readonly onCancel: () => void;
  readonly onRotate: (direction: StudioBg3dPlacementRotationDirection) => void;
}

export interface StudioBg3dPlacementViewportRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioBg3dPlacementPointerRaycastInput {
  readonly camera: THREE.Camera;
  readonly clientX: number;
  readonly clientY: number;
  readonly objects: ReadonlyMap<string, THREE.Object3D>;
  readonly rect: StudioBg3dPlacementViewportRect;
}

export interface StudioBg3dPlacementRaycastScratch {
  readonly floorIntersection: THREE.Vector3;
  readonly intersections: THREE.Intersection[];
  readonly normalizedPointer: THREE.Vector2;
  readonly raycaster: THREE.Raycaster;
  readonly roots: THREE.Object3D[];
  readonly rootSet: Set<THREE.Object3D>;
}

export function createStudioBg3dPlacementRaycastScratch(): StudioBg3dPlacementRaycastScratch {
  return {
    floorIntersection: new THREE.Vector3(),
    intersections: [],
    normalizedPointer: new THREE.Vector2(),
    raycaster: new THREE.Raycaster(),
    roots: [],
    rootSet: new Set<THREE.Object3D>(),
  };
}

function finiteWithinWorldBudget(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= STUDIO_BG3D_PLACEMENT_MAX_WORLD_COORDINATE;
}

function finiteMatrix(matrix: THREE.Matrix4): boolean {
  return matrix.elements.every(Number.isFinite);
}

function isRaycastIgnored(object: THREE.Object3D): boolean {
  return object.userData[STUDIO_BG3D_PLACEMENT_RAYCAST_IGNORE_USER_DATA_KEY] === true;
}

function isVisibleRaycastRoot(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible || isRaycastIgnored(current)) return false;
    current = current.parent;
  }
  return true;
}

function isSupportedSurfaceObject(object: THREE.Object3D): boolean {
  return (object as THREE.Mesh).isMesh === true;
}

/**
 * Returns a mapped root only when every node between the hit and that root is visible and selectable.
 * This excludes transform handles and preview descendants without relying on names or render order.
 */
function findEligibleMappedRoot(
  object: THREE.Object3D,
  roots: ReadonlySet<THREE.Object3D>,
): THREE.Object3D | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible || isRaycastIgnored(current)) return null;
    if (roots.has(current)) return current;
    current = current.parent;
  }
  return null;
}

function prepareRaycastRoots(
  objects: ReadonlyMap<string, THREE.Object3D>,
  scratch: StudioBg3dPlacementRaycastScratch,
): void {
  scratch.roots.length = 0;
  scratch.rootSet.clear();
  for (const object of objects.values()) {
    if (!object?.isObject3D || scratch.rootSet.has(object) || !isVisibleRaycastRoot(object)) continue;
    scratch.rootSet.add(object);
    scratch.roots.push(object);
  }
}

function hasFiniteRay(ray: THREE.Ray): boolean {
  return ray.origin.toArray().every(Number.isFinite) &&
    ray.direction.toArray().every(Number.isFinite) &&
    ray.direction.lengthSq() >= STUDIO_BG3D_MIN_RAY_DIRECTION_LENGTH_SQUARED;
}

function readNormalizedPointer(
  input: Pick<StudioBg3dPlacementPointerRaycastInput, "clientX" | "clientY" | "rect">,
  target: THREE.Vector2,
): THREE.Vector2 | null {
  const { clientX, clientY, rect } = input;
  const { left, top, width, height } = rect;
  const right = left + width;
  const bottom = top + height;
  if (
    ![clientX, clientY, left, top, width, height, right, bottom].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    clientX < left ||
    clientX > right ||
    clientY < top ||
    clientY > bottom
  ) return null;

  const x = ((clientX - left) / width) * 2 - 1;
  const y = -((clientY - top) / height) * 2 + 1;
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1 || Math.abs(y) > 1) {
    return null;
  }
  return target.set(x, y);
}

/**
 * Resolves one native canvas pointer sample. The closest eligible mapped mesh is authoritative:
 * malformed hit data fails closed rather than silently placing on a different surface or the floor.
 */
export function resolveStudioBg3dPlacementPointerTarget(
  input: StudioBg3dPlacementPointerRaycastInput,
  scratch = createStudioBg3dPlacementRaycastScratch(),
): StudioBg3dPlacementPointerTarget | null {
  const pointer = readNormalizedPointer(input, scratch.normalizedPointer);
  const camera = input.camera;
  if (
    !pointer ||
    !camera?.isCamera ||
    !finiteMatrix(camera.matrixWorld) ||
    !finiteMatrix(camera.projectionMatrix)
  ) return null;

  try {
    scratch.raycaster.setFromCamera(pointer, camera);
  } catch {
    return null;
  }
  if (!hasFiniteRay(scratch.raycaster.ray)) return null;

  prepareRaycastRoots(input.objects, scratch);
  scratch.intersections.length = 0;
  try {
    scratch.raycaster.intersectObjects(scratch.roots, true, scratch.intersections);
    for (const intersection of scratch.intersections) {
      if (!findEligibleMappedRoot(intersection.object, scratch.rootSet)) continue;
      if (!isSupportedSurfaceObject(intersection.object)) continue;

      const hit = readStudioBg3dWorldSurfaceHit(intersection);
      if (!hit) return null;
      return Object.freeze({
        surfaceHit: Object.freeze({
          point: hit.point,
          normal: hit.normal,
        }),
      });
    }
  } catch {
    return null;
  } finally {
    scratch.intersections.length = 0;
  }

  const floor = scratch.raycaster.ray.intersectPlane(
    STUDIO_BG3D_FLOOR_PLANE,
    scratch.floorIntersection,
  );
  if (!floor || !finiteWithinWorldBudget(floor.x) || !finiteWithinWorldBudget(floor.z)) return null;
  return Object.freeze({
    floorPoint: Object.freeze([
      Object.is(floor.x, -0) ? 0 : floor.x,
      Object.is(floor.z, -0) ? 0 : floor.z,
    ] as const),
  });
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  const candidate = target as {
    readonly isContentEditable?: boolean;
    readonly tagName?: string;
  } | null;
  if (!candidate) return false;
  if (candidate.isContentEditable) return true;
  return candidate.tagName === "INPUT" || candidate.tagName === "TEXTAREA" || candidate.tagName === "SELECT";
}

function blockPlacementPointerDown(event: PointerEvent): void {
  if (event.cancelable) event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

/**
 * Native capture-phase placement transport. Rendering stays in the owning R3F tree, while this
 * controller prevents a placement click from also becoming an R3F selection or OrbitControls drag.
 */
export function StudioBg3dPlacementPointerController({
  active,
  objectsRef,
  onMove,
  onCommit,
  onCancel,
  onRotate,
}: StudioBg3dPlacementPointerControllerProps) {
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const connectedEventTarget = useThree(
    (state) => state.events.connected as HTMLElement | undefined,
  );
  const emitMove = useEffectEvent(onMove);
  const emitCommit = useEffectEvent(onCommit);
  const emitCancel = useEffectEvent(onCancel);
  const emitRotate = useEffectEvent(onRotate);

  useEffect(() => {
    if (!active || !canvas?.addEventListener) return undefined;
    const pointerEventTarget = connectedEventTarget ?? canvas;
    const ownerWindow = canvas.ownerDocument?.defaultView;
    if (!ownerWindow) return undefined;

    let disposed = false;
    const scratch = createStudioBg3dPlacementRaycastScratch();
    const readTarget = (event: PointerEvent): StudioBg3dPlacementPointerTarget | null => {
      const objects = objectsRef.current;
      if (disposed || !objects) return null;
      return resolveStudioBg3dPlacementPointerTarget({
        camera,
        clientX: event.clientX,
        clientY: event.clientY,
        objects,
        rect: canvas.getBoundingClientRect(),
      }, scratch);
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (
        disposed ||
        event.isPrimary === false ||
        isStudioBg3dViewportControlTarget(event.target)
      ) return;
      const target = readTarget(event);
      if (target) emitMove(target, event.shiftKey);
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (disposed || isStudioBg3dViewportControlTarget(event.target)) return;
      blockPlacementPointerDown(event);
      if (event.isPrimary === false || event.button !== 0) return;
      const target = readTarget(event);
      if (target) emitCommit(target, event.shiftKey);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (disposed) return;
      if (event.key === "Escape") {
        if (event.repeat) return;
        event.preventDefault();
        event.stopPropagation();
        emitCancel();
        return;
      }
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableKeyboardTarget(event.target)
      ) return;

      const direction = event.code === "BracketLeft"
        ? "counter-clockwise"
        : event.code === "BracketRight"
          ? "clockwise"
          : null;
      if (!direction) return;
      event.preventDefault();
      event.stopPropagation();
      emitRotate(direction);
    };

    pointerEventTarget.addEventListener("pointermove", handlePointerMove, { capture: true, passive: true });
    pointerEventTarget.addEventListener("pointerdown", handlePointerDown, { capture: true, passive: false });
    ownerWindow.addEventListener("keydown", handleKeyDown, true);
    return () => {
      disposed = true;
      pointerEventTarget.removeEventListener("pointermove", handlePointerMove, true);
      pointerEventTarget.removeEventListener("pointerdown", handlePointerDown, true);
      ownerWindow.removeEventListener("keydown", handleKeyDown, true);
      scratch.intersections.length = 0;
      scratch.roots.length = 0;
      scratch.rootSet.clear();
    };
  }, [active, camera, canvas, connectedEventTarget, objectsRef]);

  return null;
}
