import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { createStudioBg3dThreeStaticInstanceBatch } from "./studio-bg3d-three-instancing";

const PLACEMENTS = [
  { id: "a", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  { id: "b", position: [10, 0, 0], rotation: [0, 0, 0], scale: [2, 2, 2] },
  { id: "c", position: [20, 0, 0], rotation: [0, Math.PI / 2, 0], scale: [1, 1, 1] },
] as const;

describe("Studio BG3D Three static instancing", () => {
  it("turns repeated multi-mesh models into one draw per source mesh with stable pick IDs", () => {
    const source = new THREE.Group();
    source.scale.setScalar(0.5);
    const material = new THREE.MeshStandardMaterial();
    const first = new THREE.Mesh(new THREE.BoxGeometry(), material);
    first.position.set(2, 0, 0);
    first.layers.set(3);
    first.frustumCulled = false;
    const second = new THREE.Mesh(new THREE.SphereGeometry(), material);
    second.position.set(0, 3, 0);
    source.add(first, second);

    const result = createStudioBg3dThreeStaticInstanceBatch(source, PLACEMENTS);
    expect(result).toMatchObject({
      ok: true,
      sourceDrawCalls: 6,
      batchedDrawCalls: 2,
      avoidedDrawCalls: 4,
    });
    if (!result.ok) throw new Error(result.code);
    expect(result.resolveInstanceId(1)).toBe("b");
    expect(result.resolveInstanceId(99)).toBeNull();
    expect(result.meshes[0]?.layers.mask).toBe(first.layers.mask);
    expect(result.meshes[0]?.frustumCulled).toBe(false);
    const matrix = new THREE.Matrix4();
    result.meshes[0]?.getMatrixAt(1, matrix);
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    matrix.decompose(position, rotation, scale);
    expect(position.toArray()).toEqual([12, 0, 0]);
    expect(scale.toArray()).toEqual([1, 1, 1]);

    const dispose = vi.spyOn(result.meshes[0]!, "dispose");
    const disposeGeometry = vi.spyOn(first.geometry, "dispose");
    const disposeMaterial = vi.spyOn(material, "dispose");
    result.dispose();
    result.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    expect(disposeGeometry).not.toHaveBeenCalled();
    expect(disposeMaterial).not.toHaveBeenCalled();
    expect(source.children).toHaveLength(2);
    first.geometry.dispose();
    second.geometry.dispose();
    material.dispose();
  });

  it("rejects unsafe renderables, materials, and transforms instead of changing output", () => {
    const transparentRoot = new THREE.Group();
    transparentRoot.add(new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.5 }),
    ));
    expect(createStudioBg3dThreeStaticInstanceBatch(transparentRoot, PLACEMENTS))
      .toEqual({ ok: false, code: "transparent-or-custom-material" });

    const lineRoot = new THREE.Group();
    lineRoot.add(new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial()));
    expect(createStudioBg3dThreeStaticInstanceBatch(lineRoot, PLACEMENTS))
      .toEqual({ ok: false, code: "unsupported-renderable" });

    const meshRoot = new THREE.Group();
    meshRoot.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    expect(createStudioBg3dThreeStaticInstanceBatch(meshRoot, [
      PLACEMENTS[0],
      { ...PLACEMENTS[1], scale: [-1, 1, 1] },
    ])).toEqual({ ok: false, code: "invalid-placements" });

    expect(createStudioBg3dThreeStaticInstanceBatch(meshRoot, [
      PLACEMENTS[0],
      { ...PLACEMENTS[1], position: [10_001, 0, 0] },
    ])).toEqual({ ok: false, code: "invalid-placements" });

    const customMaterialRoot = new THREE.Group();
    const customMaterial = new THREE.MeshStandardMaterial();
    customMaterial.onBeforeCompile = () => undefined;
    customMaterialRoot.add(new THREE.Mesh(new THREE.BoxGeometry(), customMaterial));
    expect(createStudioBg3dThreeStaticInstanceBatch(customMaterialRoot, PLACEMENTS))
      .toEqual({ ok: false, code: "transparent-or-custom-material" });

    const instancedRoot = new THREE.Group();
    instancedRoot.add(new THREE.InstancedMesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial(),
      2,
    ));
    expect(createStudioBg3dThreeStaticInstanceBatch(instancedRoot, PLACEMENTS))
      .toEqual({ ok: false, code: "unsupported-renderable" });

    const mirroredRoot = new THREE.Group();
    const mirroredParent = new THREE.Group();
    mirroredParent.scale.set(-1, 1, 1);
    mirroredParent.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    mirroredRoot.add(mirroredParent);
    expect(createStudioBg3dThreeStaticInstanceBatch(mirroredRoot, PLACEMENTS))
      .toEqual({ ok: false, code: "unsupported-renderable" });

    const shearedRoot = new THREE.Group();
    const shearedMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    shearedMesh.matrixAutoUpdate = false;
    shearedMesh.matrix.makeShear(0.25, 0, 0, 0, 0, 0);
    shearedRoot.add(shearedMesh);
    expect(createStudioBg3dThreeStaticInstanceBatch(shearedRoot, PLACEMENTS))
      .toEqual({ ok: false, code: "unsupported-renderable" });
  });

  it("counts grouped multi-material render passes instead of only mesh objects", () => {
    const root = new THREE.Group();
    const geometry = new THREE.BoxGeometry();
    geometry.clearGroups();
    geometry.addGroup(0, 6, 0);
    geometry.addGroup(6, 6, 1);
    const materials = [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()];
    root.add(new THREE.Mesh(geometry, materials));

    const result = createStudioBg3dThreeStaticInstanceBatch(root, PLACEMENTS);
    expect(result).toMatchObject({
      ok: true,
      sourceDrawCalls: 6,
      batchedDrawCalls: 2,
      avoidedDrawCalls: 4,
    });
    if (result.ok) result.dispose();
    geometry.dispose();
    for (const material of materials) material.dispose();
  });
});
