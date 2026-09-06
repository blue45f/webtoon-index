import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  calculateStudioBg3dThreeReparentTransform,
  calculateStudioBg3dThreeWorldMatrix,
  calculateStudioBg3dThreeWorldDeltaTransform,
  decomposeStudioBg3dThreeLocalMatrix,
  isStudioBg3dThreeAnalyticIkMatrixSupported,
  type StudioBg3dThreeHierarchyEntity,
} from "./studio-bg3d-three-hierarchy";

function matrix(entity: StudioBg3dThreeHierarchyEntity): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...entity.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...entity.rotation, "XYZ")),
    new THREE.Vector3(...entity.scale),
  );
}

function expectMatrixClose(actual: THREE.Matrix4, expected: THREE.Matrix4): void {
  actual.elements.forEach((value, index) => {
    expect(value).toBeCloseTo(expected.elements[index] ?? Number.NaN, 6);
  });
}

describe("studio-bg3d-three-hierarchy", () => {
  it("resolves nested canonical transforms into a deterministic world matrix", () => {
    const parent: StudioBg3dThreeHierarchyEntity = {
      id: "parent",
      position: [3, 2, -1],
      rotation: [0, Math.PI / 3, 0],
      scale: [2, 2, 2],
    };
    const child: StudioBg3dThreeHierarchyEntity = {
      id: "child",
      parentId: "parent",
      position: [1, 0, 2],
      rotation: [0.2, 0, -0.1],
      scale: [0.5, 0.5, 0.5],
    };

    const resolved = calculateStudioBg3dThreeWorldMatrix([parent, child], "child");

    expect(resolved).not.toBeNull();
    expectMatrixClose(resolved!, matrix(parent).multiply(matrix(child)));
    expect(calculateStudioBg3dThreeWorldMatrix([parent], "missing")).toBeNull();
  });

  it("accepts only finite right-handed uniform shear-free matrices for analytic IK", () => {
    expect(isStudioBg3dThreeAnalyticIkMatrixSupported(matrix({
      id: "uniform",
      position: [4, -2, 8],
      rotation: [0.2, -0.3, 0.4],
      scale: [2, 2, 2],
    }))).toBe(true);
    expect(isStudioBg3dThreeAnalyticIkMatrixSupported(matrix({
      id: "non-uniform",
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 2, 1],
    }))).toBe(false);
    expect(isStudioBg3dThreeAnalyticIkMatrixSupported(matrix({
      id: "mirrored",
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [-1, 1, 1],
    }))).toBe(false);
    const shear = new THREE.Matrix4().set(
      1, 0.2, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    );
    expect(isStudioBg3dThreeAnalyticIkMatrixSupported(shear)).toBe(false);
  });

  it("preserves world TRS when moving a root below a transformed parent", () => {
    const parent: StudioBg3dThreeHierarchyEntity = {
      id: "parent",
      position: [4, 2, -3],
      rotation: [0, Math.PI / 2, 0],
      scale: [2, 2, 2],
    };
    const child: StudioBg3dThreeHierarchyEntity = {
      id: "child",
      position: [1, 3, 5],
      rotation: [0.2, -0.1, 0.3],
      scale: [1, 1, 1],
    };
    const next = calculateStudioBg3dThreeReparentTransform([parent, child], "child", "parent");
    expect(next).not.toBeNull();
    if (!next) return;

    expectMatrixClose(matrix(parent).multiply(matrix({ id: "child", ...next })), matrix(child));
  });

  it("preserves world TRS when detaching a nested entity to the root", () => {
    const parent: StudioBg3dThreeHierarchyEntity = {
      id: "parent",
      position: [3, 0, 2],
      rotation: [0, 0.4, 0],
      scale: [1.5, 1.5, 1.5],
    };
    const child: StudioBg3dThreeHierarchyEntity = {
      id: "child",
      parentId: "parent",
      position: [1, 2, 3],
      rotation: [0.1, 0.2, 0.3],
      scale: [0.5, 0.5, 0.5],
    };
    const before = matrix(parent).multiply(matrix(child));
    const next = calculateStudioBg3dThreeReparentTransform([parent, child], "child", null);
    expect(next).not.toBeNull();
    if (!next) return;

    expectMatrixClose(matrix({ id: "child", ...next }), before);
  });

  it("fails closed for missing targets and singular parents", () => {
    const child: StudioBg3dThreeHierarchyEntity = {
      id: "child",
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    };
    const singular: StudioBg3dThreeHierarchyEntity = {
      id: "singular",
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [0, 1, 1],
    };
    expect(calculateStudioBg3dThreeReparentTransform([child], "child", "missing")).toBeNull();
    expect(calculateStudioBg3dThreeReparentTransform([child, singular], "child", "singular")).toBeNull();
  });

  it("rejects shear that cannot round-trip through the scene document TRS contract", () => {
    const shear = new THREE.Matrix4().set(
      1, 0.5, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    );
    expect(decomposeStudioBg3dThreeLocalMatrix(shear)).toBeNull();
  });

  it("applies the driver's full world delta across differently transformed parents", () => {
    const initialDriver = matrix({
      id: "driver",
      position: [3, 1, -2],
      rotation: [0.1, 0.2, 0.3],
      scale: [1, 1, 1],
    });
    const driverDelta = new THREE.Matrix4().compose(
      new THREE.Vector3(2, -1, 4),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.35, 0)),
      new THREE.Vector3(1.25, 1.25, 1.25),
    );
    const currentDriver = driverDelta.clone().multiply(initialDriver);
    const parent = matrix({
      id: "parent",
      position: [-4, 2, 5],
      rotation: [0, -0.4, 0],
      scale: [2, 2, 2],
    });
    const targetLocal = matrix({
      id: "target",
      position: [1, 2, 3],
      rotation: [-0.2, 0.1, 0],
      scale: [0.5, 0.5, 0.5],
    });
    const initialTargetWorld = parent.clone().multiply(targetLocal);

    const next = calculateStudioBg3dThreeWorldDeltaTransform({
      initialDriverWorldMatrix: initialDriver,
      currentDriverWorldMatrix: currentDriver,
      initialTargetWorldMatrix: initialTargetWorld,
      targetParentWorldMatrix: parent,
    });
    expect(next).not.toBeNull();
    if (!next) return;

    expectMatrixClose(
      parent.clone().multiply(matrix({ id: "target", ...next })),
      driverDelta.clone().multiply(initialTargetWorld),
    );
  });
});
