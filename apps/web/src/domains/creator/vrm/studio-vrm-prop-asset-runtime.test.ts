import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import {
  cloneStudioVrmPropAssetRoot,
  createStudioVrmPropAssetRuntime,
  disposeStudioVrmPropAssetRoot,
} from "./studio-vrm-prop-asset-runtime";

import type { PropGltfGeometrySource } from "./studio-vrm-props";

const SOURCE: PropGltfGeometrySource = {
  kind: "gltf",
  url: "/assets/3d/cyber_katana.glb",
};

async function flushCleanup(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}

function createSourceRoot() {
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 2, 3);
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "authored-mesh";
  root.add(mesh);
  return { geometry, material, mesh, root, texture };
}

describe("Studio VRM prop GLTF asset runtime", () => {
  it("keeps the default browser queueMicrotask call bound to its global host", async () => {
    const source = createSourceRoot();
    const pending: VoidFunction[] = [];
    const queueMicrotaskDescriptor = Object.getOwnPropertyDescriptor(globalThis, "queueMicrotask");
    const brandedQueueMicrotask = vi.fn(function (
      this: typeof globalThis,
      callback: VoidFunction,
    ) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      pending.push(callback);
    });

    Object.defineProperty(globalThis, "queueMicrotask", {
      configurable: true,
      value: brandedQueueMicrotask,
      writable: true,
    });
    vi.resetModules();
    vi.doMock("three/examples/jsm/loaders/GLTFLoader.js", () => ({
      GLTFLoader: class MockGltfLoader {
        async loadAsync() {
          return { scene: source.root };
        }
      },
    }));

    try {
      const { acquireStudioVrmPropAsset } = await import("./studio-vrm-prop-asset-runtime");
      const lease = await acquireStudioVrmPropAsset("blender_cyber_katana", SOURCE);

      expect(() => lease.release()).not.toThrow();
      expect(brandedQueueMicrotask).toHaveBeenCalledOnce();
      expect(pending).toHaveLength(1);
      pending.shift()?.();
    } finally {
      vi.doUnmock("three/examples/jsm/loaders/GLTFLoader.js");
      vi.resetModules();
      if (queueMicrotaskDescriptor) {
        Object.defineProperty(globalThis, "queueMicrotask", queueMicrotaskDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "queueMicrotask");
      }
    }
  });

  it("decodes one cache-owned root and returns independent structural clones", async () => {
    const source = createSourceRoot();
    const loadRoot = vi.fn(async () => source.root);
    const disposeRoot = vi.fn(disposeStudioVrmPropAssetRoot);
    const runtime = createStudioVrmPropAssetRuntime({
      loadRoot,
      cloneRoot: cloneStudioVrmPropAssetRoot,
      disposeRoot,
      scheduleCleanup: queueMicrotask,
    });

    const [first, second] = await Promise.all([
      runtime.acquire("blender_cyber_katana", SOURCE),
      runtime.acquire("blender_cyber_katana", SOURCE),
    ]);
    const firstMesh = first.object.getObjectByName("authored-mesh") as THREE.Mesh;
    const secondMesh = second.object.getObjectByName("authored-mesh") as THREE.Mesh;

    expect(loadRoot).toHaveBeenCalledOnce();
    expect(loadRoot).toHaveBeenCalledWith(SOURCE.url);
    expect(first.object).not.toBe(source.root);
    expect(second.object).not.toBe(source.root);
    expect(second.object).not.toBe(first.object);
    expect(first.object.name).toBe("prop:blender_cyber_katana");
    expect(firstMesh.geometry).toBe(source.geometry);
    expect(secondMesh.geometry).toBe(source.geometry);
    expect(firstMesh.material).toBe(source.material);
    expect(secondMesh.material).toBe(source.material);
    expect(firstMesh.castShadow).toBe(true);
    expect(firstMesh.receiveShadow).toBe(true);

    first.release();
    first.release();
    await flushCleanup();
    expect(first.released).toBe(true);
    expect(disposeRoot).not.toHaveBeenCalled();

    second.release();
    await flushCleanup();
    expect(disposeRoot).toHaveBeenCalledOnce();
    expect(disposeRoot).toHaveBeenCalledWith(source.root);
  });

  it("cancels pending source disposal when StrictMode immediately reacquires the same URL", async () => {
    const source = createSourceRoot();
    const loadRoot = vi.fn(async () => source.root);
    const disposeRoot = vi.fn();
    const runtime = createStudioVrmPropAssetRuntime({
      loadRoot,
      cloneRoot: cloneStudioVrmPropAssetRoot,
      disposeRoot,
      scheduleCleanup: queueMicrotask,
    });

    const first = await runtime.acquire("blender_cyber_katana", SOURCE);
    first.release();
    const secondPromise = runtime.acquire("blender_cyber_katana", SOURCE);
    const second = await secondPromise;
    await flushCleanup();

    expect(loadRoot).toHaveBeenCalledOnce();
    expect(disposeRoot).not.toHaveBeenCalled();

    second.release();
    await flushCleanup();
    expect(disposeRoot).toHaveBeenCalledOnce();
  });

  it("removes a failed decode from the cache so a later mount can retry", async () => {
    const source = createSourceRoot();
    const loadRoot = vi.fn()
      .mockRejectedValueOnce(new Error("broken GLB"))
      .mockResolvedValueOnce(source.root);
    const runtime = createStudioVrmPropAssetRuntime({
      loadRoot,
      cloneRoot: cloneStudioVrmPropAssetRoot,
      disposeRoot: vi.fn(),
      scheduleCleanup: queueMicrotask,
    });

    await expect(runtime.acquire("blender_cyber_katana", SOURCE)).rejects.toThrow("broken GLB");
    await flushCleanup();
    const retried = await runtime.acquire("blender_cyber_katana", SOURCE);

    expect(loadRoot).toHaveBeenCalledTimes(2);
    retried.release();
    await flushCleanup();
  });

  it("rejects non-first-party paths before loading and never substitutes a generated cube", async () => {
    const loadRoot = vi.fn();
    const runtime = createStudioVrmPropAssetRuntime({
      loadRoot,
      cloneRoot: cloneStudioVrmPropAssetRoot,
      disposeRoot: vi.fn(),
      scheduleCleanup: queueMicrotask,
    });
    const hostileSource = {
      kind: "gltf",
      url: "https://example.invalid/prop.glb",
    } as unknown as PropGltfGeometrySource;

    await expect(runtime.acquire("blender_cyber_katana", hostileSource))
      .rejects.toThrow("Unsupported VRM prop GLTF URL");
    expect(loadRoot).not.toHaveBeenCalled();
  });

  it("disposes shared geometry, material, and texture exactly once after the final lease", async () => {
    const source = createSourceRoot();
    const geometryDispose = vi.spyOn(source.geometry, "dispose");
    const materialDispose = vi.spyOn(source.material, "dispose");
    const textureDispose = vi.spyOn(source.texture, "dispose");
    const runtime = createStudioVrmPropAssetRuntime({
      loadRoot: async () => source.root,
      cloneRoot: cloneStudioVrmPropAssetRoot,
      disposeRoot: disposeStudioVrmPropAssetRoot,
      scheduleCleanup: queueMicrotask,
    });

    const first = await runtime.acquire("blender_cyber_katana", SOURCE);
    const second = await runtime.acquire("blender_cyber_katana", SOURCE);
    first.release();
    second.release();
    await flushCleanup();

    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(textureDispose).toHaveBeenCalledOnce();
  });
});
