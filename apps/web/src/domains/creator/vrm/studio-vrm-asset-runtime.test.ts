import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import {
  createStudioVrmAssetRuntime,
  readStudioVrmAssetLicenseAuthority,
  readStudioVrmMaterialVariant,
  stampStudioVrmAssetLicenseAuthority,
  stampStudioVrmGltfMaterialAssociations,
  type StudioVrmAssetRuntimeDependencies,
} from "./studio-vrm-asset-runtime";
import { STUDIO_VRM_TEXTURE_PAINT_MATERIAL_LOCATOR_USER_DATA_KEY } from "./studio-vrm-texture-paint-binding";

import type { VRM } from "@pixiv/three-vrm";

function fakeVrm(scene: THREE.Object3D = new THREE.Group()): VRM {
  return { scene } as unknown as VRM;
}

function dependencies(
  patch: Partial<StudioVrmAssetRuntimeDependencies> = {},
): StudioVrmAssetRuntimeDependencies {
  const vrm = fakeVrm();
  return {
    resolveUrl: vi.fn((url: string) => url),
    preflight: vi.fn(async () => undefined),
    loadResolved: vi.fn(async () => vrm),
    prepare: vi.fn(),
    deepDispose: vi.fn(async () => undefined),
    fallbackDispose: vi.fn(),
    ...patch,
  };
}

describe("studio VRM asset runtime", () => {
  it("binds an immutable license authority to only the inspected VRM instance", () => {
    const inspected = fakeVrm();
    const different = fakeVrm();
    const authority = stampStudioVrmAssetLicenseAuthority(inspected, {
      extensions: {
        VRMC_vrm: {
          specVersion: "1.0",
          meta: {
            name: "CC0 avatar",
            authors: ["ToonSpectrum"],
            licenseUrl: "https://vrm.dev/licenses/1.0/",
            avatarPermission: "everyone",
            commercialUsage: "corporation",
            allowRedistribution: true,
            modification: "allowModificationRedistribution",
            creditNotation: "unnecessary",
          },
        },
      },
    });

    expect(authority).toMatchObject({
      status: "verified",
      receipt: { licenseIdentifier: "VRM-Public-License-1.0" },
    });
    expect(readStudioVrmAssetLicenseAuthority(inspected)).toBe(authority);
    expect(readStudioVrmAssetLicenseAuthority(different)).toBeNull();
    expect(readStudioVrmAssetLicenseAuthority(null)).toBeNull();
  });

  it("preserves stable glTF material indices for surface-paint rehydration", () => {
    const first = new THREE.MeshStandardMaterial();
    const second = new THREE.MeshStandardMaterial();
    const invalid = new THREE.MeshStandardMaterial();
    const notMaterial = new THREE.Group();
    const associations = new Map<unknown, { materials?: number }>([
      [first, { materials: 7 }],
      [second, { materials: 2 }],
      [invalid, { materials: -1 }],
      [notMaterial, { materials: 1 }],
    ]);

    expect(stampStudioVrmGltfMaterialAssociations(associations)).toBe(2);
    expect(first.userData[STUDIO_VRM_TEXTURE_PAINT_MATERIAL_LOCATOR_USER_DATA_KEY])
      .toBe("gltf-material:7");
    expect(second.userData[STUDIO_VRM_TEXTURE_PAINT_MATERIAL_LOCATOR_USER_DATA_KEY])
      .toBe("gltf-material:2");
    expect(invalid.userData[STUDIO_VRM_TEXTURE_PAINT_MATERIAL_LOCATOR_USER_DATA_KEY])
      .toBeUndefined();
  });

  it("resolves once and keeps preflight before loader and preparation after load", async () => {
    const order: string[] = [];
    const vrm = fakeVrm();
    const injected = dependencies({
      resolveUrl: vi.fn(() => {
        order.push("resolve");
        return "https://assets.example/avatar.vrm";
      }),
      preflight: vi.fn(async () => {
        order.push("preflight");
      }),
      loadResolved: vi.fn(async () => {
        order.push("load");
        return vrm;
      }),
      prepare: vi.fn(() => {
        order.push("prepare");
      }),
    });
    const runtime = createStudioVrmAssetRuntime(injected);

    await expect(runtime.load("/vrm/avatar.vrm")).resolves.toBe(vrm);
    expect(order).toEqual(["resolve", "preflight", "load", "prepare"]);
    expect(injected.resolveUrl).toHaveBeenCalledOnce();
    expect(injected.preflight).toHaveBeenCalledExactlyOnceWith("https://assets.example/avatar.vrm");
    expect(injected.loadResolved).toHaveBeenCalledExactlyOnceWith(
      "https://assets.example/avatar.vrm",
      // No class was injected, so the loader builds MToon's WebGL ShaderMaterial. Defaulting the
      // other way would hand a WebGL renderer a node material it cannot compile.
      undefined,
    );
    expect(injected.prepare).toHaveBeenCalledExactlyOnceWith(vrm);
  });

  it("hands an injected MToon class to the loader and records the resulting variant", async () => {
    // MToon's ShaderMaterial and its TSL node port each compile on exactly one backend, so the
    // class travels with the request from whoever owns the renderer — this leaf never picks one,
    // which is what keeps the VRM poser's chunk off Three's WebGPU graph.
    const vrm = fakeVrm();
    const injected = dependencies({
      resolveUrl: vi.fn(() => "https://assets.example/avatar.vrm"),
      loadResolved: vi.fn(async () => vrm),
    });
    const runtime = createStudioVrmAssetRuntime(injected);
    const nodeMaterial = class extends THREE.Material {} as unknown as typeof THREE.Material;

    await expect(runtime.load("/vrm/avatar.vrm", { mtoonMaterialType: nodeMaterial }))
      .resolves.toBe(vrm);
    expect(injected.loadResolved).toHaveBeenCalledExactlyOnceWith(
      "https://assets.example/avatar.vrm",
      nodeMaterial,
    );
    expect(readStudioVrmMaterialVariant(vrm)).toBe("webgpu-node");
    expect(readStudioVrmMaterialVariant(null)).toBeNull();
  });

  it("fails closed before loader and preparation when preflight rejects", async () => {
    const failure = new Error("preflight failed");
    const injected = dependencies({
      preflight: vi.fn(async () => {
        throw failure;
      }),
    });
    const runtime = createStudioVrmAssetRuntime(injected);

    await expect(runtime.load("/vrm/missing.vrm")).rejects.toBe(failure);
    expect(injected.loadResolved).not.toHaveBeenCalled();
    expect(injected.prepare).not.toHaveBeenCalled();
  });

  it("detaches from the parent before one successful deep-dispose and never falls back", async () => {
    const order: string[] = [];
    const scene = new THREE.Group();
    const parent = new THREE.Group();
    parent.add(scene);
    const originalRemove = parent.remove.bind(parent);
    vi.spyOn(parent, "remove").mockImplementation((...objects) => {
      order.push("detach");
      return originalRemove(...objects);
    });
    const injected = dependencies({
      deepDispose: vi.fn(async () => {
        order.push("deep-dispose");
      }),
      fallbackDispose: vi.fn(() => {
        order.push("fallback");
      }),
    });
    const runtime = createStudioVrmAssetRuntime(injected);

    runtime.dispose(fakeVrm(scene));
    await Promise.resolve();

    expect(order).toEqual(["detach", "deep-dispose"]);
    expect(scene.parent).toBeNull();
    expect(injected.deepDispose).toHaveBeenCalledExactlyOnceWith(scene);
    expect(injected.fallbackDispose).not.toHaveBeenCalled();
  });

  it("detaches first, attempts deep-dispose once, and falls back exactly once only on failure", async () => {
    const order: string[] = [];
    const scene = new THREE.Group();
    const parent = new THREE.Group();
    parent.add(scene);
    const originalRemove = parent.remove.bind(parent);
    vi.spyOn(parent, "remove").mockImplementation((...objects) => {
      order.push("detach");
      return originalRemove(...objects);
    });
    const injected = dependencies({
      deepDispose: vi.fn(async () => {
        order.push("deep-dispose");
        throw new Error("dynamic import failed");
      }),
      fallbackDispose: vi.fn(() => {
        order.push("fallback");
      }),
    });
    const runtime = createStudioVrmAssetRuntime(injected);

    runtime.dispose(fakeVrm(scene));
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual(["detach", "deep-dispose", "fallback"]);
    expect(scene.parent).toBeNull();
    expect(injected.deepDispose).toHaveBeenCalledExactlyOnceWith(scene);
    expect(injected.fallbackDispose).toHaveBeenCalledExactlyOnceWith(scene);
  });
});
