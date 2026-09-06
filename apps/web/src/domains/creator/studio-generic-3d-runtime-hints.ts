import * as THREE from "three";

import type { StudioBg3dThreeJointDescriptor } from "./studio-background-3d-model";
import type { StudioGeneric3dManifestHints } from "./studio-generic-3d-model-mode";

/** Derives conservative edit capabilities from one admitted Three runtime root. */
export function inspectStudioGeneric3dRuntimeHints(
  root: THREE.Object3D,
  joints: readonly StudioBg3dThreeJointDescriptor[],
): StudioGeneric3dManifestHints {
  let parts = 0;
  let skinnedMeshes = 0;
  let normalMaps = 0;
  const nodeNames: string[] = [];
  root.traverse((object) => {
    if (object.name && nodeNames.length < 4_096) nodeNames.push(object.name);
    const renderable = object as THREE.Mesh & { readonly isSkinnedMesh?: boolean };
    if (!renderable.isMesh) return;
    parts += 1;
    if (renderable.isSkinnedMesh === true) skinnedMeshes += 1;
    const materials = Array.isArray(renderable.material)
      ? renderable.material
      : [renderable.material];
    for (const material of materials) {
      const mapped = material as THREE.Material & {
        readonly normalMap?: { readonly isTexture?: boolean } | null;
        readonly bumpMap?: { readonly isTexture?: boolean } | null;
      };
      if (mapped.normalMap?.isTexture === true || mapped.bumpMap?.isTexture === true) {
        normalMaps += 1;
      }
    }
  });
  return Object.freeze({
    parts,
    // Child-node transforms are detected but not advertised until they round-trip in the schema.
    partTransformsSupported: false,
    bones: new Set(joints.map((joint) => joint.canonicalKey)).size,
    skinnedMeshes,
    normalMaps,
    nodeNames: Object.freeze(nodeNames),
  });
}
