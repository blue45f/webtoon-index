import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import {
  StudioBg3dPrimitiveGeometryPool,
  synchronizeStudioBg3dRootMatrix,
} from "./studio-bg3d-render-optimization";

describe("Studio BG3D render optimization", () => {
  it("shares geometry by primitive kind and disposes the bounded pool exactly once per clear", () => {
    const pool = new StudioBg3dPrimitiveGeometryPool();
    const firstBox = pool.get("box");
    const secondBox = pool.get("box");
    const sphere = pool.get("sphere");
    const boxDispose = vi.spyOn(firstBox.geometry, "dispose");
    const edgeDispose = vi.spyOn(firstBox.edges, "dispose");

    expect(secondBox).toBe(firstBox);
    expect(sphere).not.toBe(firstBox);
    expect(pool.size).toBe(2);
    expect(pool.dispose()).toBe(2);
    expect(boxDispose).toHaveBeenCalledOnce();
    expect(edgeDispose).toHaveBeenCalledOnce();
    expect(pool.dispose()).toBe(0);
    expect(pool.get("box")).not.toBe(firstBox);
    pool.dispose();
  });

  it("cancels StrictMode replay disposal but releases an actually unmounted pool", async () => {
    const pool = new StudioBg3dPrimitiveGeometryPool();
    pool.get("box");

    pool.retain();
    pool.releaseSoon();
    pool.retain();
    await Promise.resolve();
    expect(pool.size).toBe(1);

    pool.releaseSoon();
    await Promise.resolve();
    expect(pool.size).toBe(0);
  });

  it("freezes static local composition but refreshes document changes and restores live editing", () => {
    const parent = new THREE.Group();
    const object = new THREE.Group();
    parent.add(object);
    parent.position.set(5, 0, 0);
    object.position.set(1, 2, 3);

    synchronizeStudioBg3dRootMatrix(object, false);
    parent.updateMatrixWorld(true);
    expect(object.matrixAutoUpdate).toBe(false);
    expect(object.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([6, 2, 3]);

    object.position.set(4, 5, 6);
    parent.updateMatrixWorld(true);
    expect(object.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([6, 2, 3]);
    synchronizeStudioBg3dRootMatrix(object, false);
    parent.updateMatrixWorld(true);
    expect(object.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([9, 5, 6]);

    synchronizeStudioBg3dRootMatrix(object, true);
    object.position.set(7, 8, 9);
    parent.updateMatrixWorld(true);
    expect(object.matrixAutoUpdate).toBe(true);
    expect(object.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([12, 8, 9]);
  });
});
