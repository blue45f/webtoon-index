import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { resolveStudioBg3dThreeCenterGroundLocalPosition } from "./studio-bg3d-three-model-alignment";

describe("Studio BG3D Three model alignment", () => {
  it("centers off-pivot geometry through a transformed parent without mutating the object", () => {
    const scene = new THREE.Scene();
    const parent = new THREE.Group();
    parent.position.set(4, 3, -2);
    parent.rotation.set(0.2, 0.6, -0.1);
    parent.scale.set(1.5, 0.8, 1.2);
    scene.add(parent);

    const object = new THREE.Group();
    object.position.set(3, 5, -4);
    parent.add(object);
    const geometry = new THREE.BoxGeometry(4, 2, 6);
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(7, -2, 9);
    object.add(mesh);

    const originalPosition = object.position.toArray();
    const nextPosition = resolveStudioBg3dThreeCenterGroundLocalPosition(object);

    expect(nextPosition).not.toBeNull();
    expect(object.position.toArray()).toEqual(originalPosition);
    object.position.fromArray(nextPosition!);
    object.updateWorldMatrix(true, true);
    const alignedBounds = new THREE.Box3().setFromObject(object, true);
    const alignedCenter = alignedBounds.getCenter(new THREE.Vector3());
    expect(alignedCenter.x).toBeCloseTo(0, 8);
    expect(alignedCenter.z).toBeCloseTo(0, 8);
    expect(alignedBounds.min.y).toBeCloseTo(0, 8);

    const repeatedPosition = resolveStudioBg3dThreeCenterGroundLocalPosition(object);
    expect(repeatedPosition).not.toBeNull();
    expect(repeatedPosition![0]).toBeCloseTo(nextPosition![0], 8);
    expect(repeatedPosition![1]).toBeCloseTo(nextPosition![1], 8);
    expect(repeatedPosition![2]).toBeCloseTo(nextPosition![2], 8);

    geometry.dispose();
    material.dispose();
  });

  it("supports a custom target and rejects an empty subtree", () => {
    const object = new THREE.Group();
    expect(resolveStudioBg3dThreeCenterGroundLocalPosition(object)).toBeNull();

    const geometry = new THREE.SphereGeometry(1, 8, 6);
    const material = new THREE.MeshBasicMaterial();
    object.add(new THREE.Mesh(geometry, material));
    const nextPosition = resolveStudioBg3dThreeCenterGroundLocalPosition(object, [2, 3, -4]);
    expect(nextPosition).not.toBeNull();
    object.position.fromArray(nextPosition!);
    object.updateWorldMatrix(true, true);
    const alignedBounds = new THREE.Box3().setFromObject(object, true);
    const alignedCenter = alignedBounds.getCenter(new THREE.Vector3());
    expect(alignedCenter.x).toBeCloseTo(2, 8);
    expect(alignedCenter.z).toBeCloseTo(-4, 8);
    expect(alignedBounds.min.y).toBeCloseTo(3, 8);

    geometry.dispose();
    material.dispose();
  });
});
