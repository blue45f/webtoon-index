import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { readStudioBg3dObjectWorldBounds } from "./studio-bg3d-camera-application";
import { readStudioBg3dTemplateStaticModelWorldBounds } from "./studio-bg3d-template-organizer-bounds";

describe("Studio BG3D template organizer batched-model bounds", () => {
  it("matches a rendered wrapper without materializing the cached root in the scene", () => {
    const sourceRoot = new THREE.Group();
    sourceRoot.position.set(0.25, 0.5, -0.75);
    sourceRoot.rotation.set(0.2, -0.35, 0.1);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 6));
    mesh.position.set(1, 2, 3);
    mesh.rotation.set(-0.15, 0.4, 0.3);
    sourceRoot.add(mesh);
    const transform = {
      position: [10, -2, 5] as const,
      rotation: [0.35, -0.6, 0.25] as const,
      scale: [2, 0.5, 1.5] as const,
    };
    const sourceMatrixBefore = sourceRoot.matrix.clone();
    const sourceWorldMatrixBefore = sourceRoot.matrixWorld.clone();
    const meshMatrixBefore = mesh.matrix.clone();
    const meshWorldMatrixBefore = mesh.matrixWorld.clone();

    const measured = readStudioBg3dTemplateStaticModelWorldBounds(sourceRoot, transform);
    const renderedWrapper = new THREE.Group();
    renderedWrapper.position.fromArray(transform.position);
    renderedWrapper.rotation.fromArray([...transform.rotation, "XYZ"]);
    renderedWrapper.scale.fromArray(transform.scale);
    renderedWrapper.add(sourceRoot.clone(true));
    const rendered = readStudioBg3dObjectWorldBounds(renderedWrapper);

    expect(measured).not.toBeNull();
    expect(rendered).not.toBeNull();
    measured!.min.forEach((value, index) => {
      expect(value).toBeCloseTo(rendered!.min[index]!, 8);
      expect(measured!.max[index]!).toBeCloseTo(rendered!.max[index]!, 8);
    });
    expect(sourceRoot.parent).toBeNull();
    expect(sourceRoot.matrix.equals(sourceMatrixBefore)).toBe(true);
    expect(sourceRoot.matrixWorld.equals(sourceWorldMatrixBefore)).toBe(true);
    expect(mesh.matrix.equals(meshMatrixBefore)).toBe(true);
    expect(mesh.matrixWorld.equals(meshWorldMatrixBefore)).toBe(true);
    mesh.geometry.dispose();
  });

  it("fails closed for an attached root or unsafe batch transform", () => {
    const parent = new THREE.Group();
    const sourceRoot = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    parent.add(sourceRoot);
    expect(readStudioBg3dTemplateStaticModelWorldBounds(sourceRoot, {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    })).toBeNull();
    parent.remove(sourceRoot);
    expect(readStudioBg3dTemplateStaticModelWorldBounds(sourceRoot, {
      position: [Number.NaN, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    })).toBeNull();
    expect(readStudioBg3dTemplateStaticModelWorldBounds(sourceRoot, {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 0, 1],
    })).toBeNull();
    sourceRoot.geometry.dispose();
  });
});
