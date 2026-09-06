import * as THREE from "three";

export function supportsStudioVrmPropTint(material: THREE.Material, propId: string): boolean {
  return (material as THREE.MeshStandardMaterial).color?.isColor === true
    && (
      material.userData.toonspectrum_tintable === true
      // The shared v2 phone predates material-role extras. Keep the stable smartphone's existing
      // color control without changing or duplicating that already-audited GLB.
      || (propId === "smartphone" && material.name === "PhoneV2_AnodizedBody")
    );
}

/**
 * GLTF structural clones share cache-owned materials. Clone only explicitly tintable materials,
 * then restore and dispose them on dependency changes so per-instance color remains independent.
 */
export function applyStudioVrmPropTint(
  object: THREE.Object3D,
  propId: string,
  color: string,
): () => void {
  const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const tintedByOriginal = new Map<THREE.Material, THREE.Material>();

  const tintedMaterial = (source: THREE.Material): THREE.Material => {
    if (!supportsStudioVrmPropTint(source, propId)) return source;
    const cached = tintedByOriginal.get(source);
    if (cached) return cached;
    const tinted = source.clone();
    (tinted as THREE.MeshStandardMaterial).color.set(color);
    tinted.needsUpdate = true;
    tintedByOriginal.set(source, tinted);
    return tinted;
  };

  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh !== true || !mesh.material) return;
    const source = mesh.material;
    if (Array.isArray(source)) {
      const next = source.map(tintedMaterial);
      if (!next.some((material, index) => material !== source[index])) return;
      originals.set(mesh, source);
      mesh.material = next;
      return;
    }
    const next = tintedMaterial(source);
    if (next === source) return;
    originals.set(mesh, source);
    mesh.material = next;
  });

  return () => {
    for (const [mesh, source] of originals) mesh.material = source;
    for (const material of tintedByOriginal.values()) material.dispose();
  };
}
