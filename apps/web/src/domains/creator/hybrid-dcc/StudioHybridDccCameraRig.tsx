import { useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

import {
  fitStudioHybridDccCamera,
  shouldReframeStudioHybridDccCamera,
  studioHybridDccViewBasis,
  type StudioHybridDccFrameIntent,
  type StudioHybridDccViewVec3,
} from "./studio-hybrid-dcc-viewport-interaction";

type Camera = THREE.PerspectiveCamera | THREE.OrthographicCamera;
interface NavigationControls {
  readonly target: THREE.Vector3;
  update?: () => void;
}
interface PreviousView {
  readonly camera: Camera;
  readonly controls: NavigationControls;
  readonly intent: StudioHybridDccFrameIntent;
  readonly height: number;
}
function visibleHeight(camera: Camera, target: THREE.Vector3): number {
  return camera instanceof THREE.OrthographicCamera
    ? (camera.top - camera.bottom) / camera.zoom
    : 2 * camera.position.distanceTo(target) * Math.tan(camera.fov * Math.PI / 360) / camera.zoom;
}

/** Imperative Three.js adapter: mutable renderer resources never become React-owned state. */
function reconcileCamera(
  camera: THREE.Camera, controls: NavigationControls | null, before: PreviousView | null,
  cx: number, cy: number, cz: number, radius: number,
  sx: number, sy: number, sz: number, sceneRadius: number,
  revision: number, orientationRevision: number, view: StudioHybridDccFrameIntent["view"],
  width: number, height: number,
): PreviousView | null {
  if (!(camera instanceof THREE.PerspectiveCamera || camera instanceof THREE.OrthographicCamera)
    || !controls?.target || width <= 0 || height <= 0) return before;
  const nextIntent = { revision, orientationRevision, view };
  const target = new THREE.Vector3(cx, cy, cz);
  let navigationChanged = false;
  if (shouldReframeStudioHybridDccCamera(before?.intent ?? null, nextIntent)) {
    const fit = fitStudioHybridDccCamera(Math.max(radius, 0.000001), width, height);
    const standardView = !before || before.intent.orientationRevision !== orientationRevision
      || before.intent.view !== view;
    const basis = studioHybridDccViewBasis(view);
    const sourceCamera = before?.camera ?? camera;
    const sourceControls = before?.controls ?? controls;
    const direction = standardView
      ? new THREE.Vector3(...basis.direction).normalize()
      : sourceCamera.position.clone().sub(sourceControls.target).normalize();
    if (direction.lengthSq() < 1e-12) direction.set(0, 0, 1);
    if (standardView) camera.up.set(...basis.up);
    else camera.up.copy(sourceCamera.up);
    camera.position.copy(target).addScaledVector(direction, fit.distance);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = 42;
      camera.zoom = 1;
    } else camera.zoom = fit.orthographicZoom;
    controls.target.copy(target);
    camera.lookAt(target);
    navigationChanged = true;
  } else if (before && before.camera !== camera) {
    // Keep the live outgoing camera, not a stale pose sampled at its last React render.
    const oldTarget = before.controls.target.clone();
    const direction = before.camera.position.clone().sub(oldTarget).normalize();
    if (direction.lengthSq() < 1e-12) direction.set(0, 0, 1);
    const span = Math.max(1e-9, visibleHeight(before.camera, oldTarget));
    camera.up.copy(before.camera.up);
    if (camera instanceof THREE.OrthographicCamera) {
      camera.zoom = (camera.top - camera.bottom) / span;
      camera.position.copy(oldTarget).addScaledVector(direction,
        Math.max(1e-6, before.camera.position.distanceTo(oldTarget)));
    } else {
      camera.fov = 42;
      camera.zoom = 1;
      camera.position.copy(oldTarget).addScaledVector(direction,
        span / (2 * Math.tan(camera.fov * Math.PI / 360)));
    }
    controls.target.copy(oldTarget);
    camera.lookAt(oldTarget);
    navigationChanged = true;
  } else if (before && camera instanceof THREE.OrthographicCamera && before.height !== height) {
    // R3F updates the frustum on resize; retain vertical apparent scale and the user's orbit.
    camera.zoom *= height / before.height;
  }
  // A moved object may need a longer clip range, never a forced camera reposition.
  const reach = camera.position.distanceTo(new THREE.Vector3(sx, sy, sz)) + sceneRadius;
  camera.near = Math.max(1e-6, Math.min(0.01, Math.max(radius, 1e-6) / 1000));
  camera.far = Math.max(100, reach * 4);
  camera.updateProjectionMatrix();
  if (navigationChanged) controls.update?.();
  return { camera, controls, intent: nextIntent, height };
}

/** Camera framing follows user intent, not changing geometry hashes or selection identity. */
export function StudioHybridDccCameraRig({
  center, radius, intent, sceneCenter, sceneRadius,
}: {
  readonly center: StudioHybridDccViewVec3;
  readonly radius: number;
  readonly intent: StudioHybridDccFrameIntent;
  readonly sceneCenter: StudioHybridDccViewVec3;
  readonly sceneRadius: number;
}) {
  // OrbitControls mutate camera/target without changing their identities. The effect reads
  // those live resources for each requested reconciliation; render does not snapshot them.
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as NavigationControls | null;
  const { width, height } = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const previous = useRef<PreviousView | null>(null);
  const [cx, cy, cz] = center;
  const [sx, sy, sz] = sceneCenter;
  const { revision, orientationRevision, view } = intent;

  useEffect(() => {
    previous.current = reconcileCamera(camera, controls, previous.current,
      cx, cy, cz, radius, sx, sy, sz, sceneRadius,
      revision, orientationRevision, view, width, height);
    invalidate();
  }, [camera, controls, cx, cy, cz, radius, sx, sy, sz, sceneRadius,
    revision, orientationRevision, view, width, height, invalidate]);
  return null;
}
