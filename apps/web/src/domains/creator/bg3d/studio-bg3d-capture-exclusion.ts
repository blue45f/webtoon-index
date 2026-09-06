import type * as THREE from "three";

// Identity-only registry: GLTF extras are copied into Object3D.userData, so a public string flag
// would let uploaded assets accidentally or deliberately remove themselves from Studio exports.
const captureExcludedObjects = new WeakSet<THREE.Object3D>();
const depthExcludedObjects = new WeakSet<THREE.Object3D>();

/** Registers a renderer-owned viewport helper that never belongs in a color/depth export. */
export function registerStudioBg3dCaptureExcludedObject(object: THREE.Object3D | null): void {
  if (object) captureExcludedObjects.add(object);
}

/** Registers beauty-only renderer geometry that must never become authored LT depth. */
export function registerStudioBg3dDepthExcludedObject(object: THREE.Object3D | null): void {
  if (object) depthExcludedObjects.add(object);
}

/** Temporarily hides registered viewport helpers while a renderer submits its capture passes. */
export function hideStudioBg3dCaptureExcludedObjects(scene: THREE.Scene): () => void {
  const previousVisibility: Array<{ object: THREE.Object3D; visible: boolean }> = [];
  scene.traverse((object) => {
    if (!captureExcludedObjects.has(object)) return;
    previousVisibility.push({ object, visible: object.visible });
    object.visible = false;
  });
  return () => {
    for (const { object, visible } of previousVisibility) object.visible = visible;
  };
}

/** Temporarily hides beauty-only renderer geometry while the canonical LT depth pass submits. */
export function hideStudioBg3dDepthExcludedObjects(scene: THREE.Scene): () => void {
  const previousVisibility: Array<{ object: THREE.Object3D; visible: boolean }> = [];
  scene.traverse((object) => {
    if (!depthExcludedObjects.has(object)) return;
    previousVisibility.push({ object, visible: object.visible });
    object.visible = false;
  });
  return () => {
    for (const { object, visible } of previousVisibility) object.visible = visible;
  };
}
