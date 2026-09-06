import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { STUDIO_VRM_PROP_ASSET_REVISIONS } from "./studio-vrm-prop-asset-revisions";
import { createStudioVrmPropAssetRuntime, studioVrmPropAssetRequestUrl } from "./studio-vrm-prop-asset-runtime";
import { propDefById, type PropGltfGeometrySource } from "./studio-vrm-props";

interface ManifestAsset { id: string; file: string; sha256: string }
const manifest = JSON.parse(readFileSync(join(process.cwd(), "apps/web/public/assets/3d/wearable-v5-manifest.json"), "utf8")) as { assets: ManifestAsset[] };

describe("content-addressed wearable requests", () => {
  it("versions every revised request with the hash of its committed GLB bytes", () => {
    expect(manifest.assets).toHaveLength(12);
    expect(Object.keys(STUDIO_VRM_PROP_ASSET_REVISIONS)).toHaveLength(12);
    expect(Object.isFrozen(STUDIO_VRM_PROP_ASSET_REVISIONS)).toBe(true);
    for (const asset of manifest.assets) {
      const canonical = `/assets/3d/${asset.file}`;
      const bytes = readFileSync(join(process.cwd(), "apps/web/public/assets/3d", asset.file));
      const digest = createHash("sha256").update(bytes).digest("hex");
      expect(digest).toBe(asset.sha256);
      expect(STUDIO_VRM_PROP_ASSET_REVISIONS[canonical]).toBe(digest);
      expect(studioVrmPropAssetRequestUrl(canonical)).toBe(`${canonical}?v=${digest}`);
      expect(new URL(studioVrmPropAssetRequestUrl(canonical), "https://studio.invalid").pathname).toBe(canonical);
      expect(propDefById(asset.id)?.geometrySource).toEqual({ kind: "gltf", url: canonical });
    }
  });

  it("does not add random cache misses or rewrite unrelated catalogue paths", () => {
    const url = "/assets/3d/cyber_katana.glb";
    expect(studioVrmPropAssetRequestUrl(url)).toBe(url);
    const cap = "/assets/3d/everyday_cap.glb";
    expect(studioVrmPropAssetRequestUrl(cap)).toBe(studioVrmPropAssetRequestUrl(cap));
    expect(propDefById("smartphone")?.geometrySource).toEqual(propDefById("blender_modern_smartphone")?.geometrySource);
  });

  it("sends the revised URL to the real loader boundary and shares the phone alias cache", async () => {
    const source: PropGltfGeometrySource = { kind: "gltf", url: "/assets/3d/modern_smartphone_prop.glb" };
    const loadAsync = vi.fn(async () => ({ scene: new THREE.Group() }));
    vi.resetModules();
    vi.doMock("three/examples/jsm/loaders/GLTFLoader.js", () => ({
      GLTFLoader: class { loadAsync = loadAsync; },
    }));
    try {
      const { acquireStudioVrmPropAsset } = await import("./studio-vrm-prop-asset-runtime");
      const [phone, legacy] = await Promise.all([
        acquireStudioVrmPropAsset("smartphone", source),
        acquireStudioVrmPropAsset("blender_modern_smartphone", source),
      ]);
      try {
        const asset = manifest.assets.find((entry) => entry.id === "smartphone")!;
        expect(loadAsync).toHaveBeenCalledOnce();
        expect(loadAsync).toHaveBeenCalledWith(`${source.url}?v=${asset.sha256}`);
        expect(phone.source).toBe(source);
        expect(legacy.source).toBe(source);
        expect(phone.object).not.toBe(legacy.object);
      } finally {
        phone.release();
        legacy.release();
        await new Promise<void>((resolve) => queueMicrotask(resolve));
      }
    } finally {
      vi.doUnmock("three/examples/jsm/loaders/GLTFLoader.js");
      vi.resetModules();
    }
  });

  it("still rejects arbitrary queries, traversal and third-party paths before loading", async () => {
    const loadRoot = vi.fn(async () => new THREE.Group());
    const runtime = createStudioVrmPropAssetRuntime({
      loadRoot,
      cloneRoot: async (root) => root.clone(true),
      disposeRoot: vi.fn(),
      scheduleCleanup: (callback) => queueMicrotask(callback),
    });
    for (const url of ["/assets/3d/everyday_cap.glb?external=1", "/assets/3d/../private.glb", "https://example.invalid/cap.glb"]) {
      await expect(runtime.acquire("cap", { kind: "gltf", url } as PropGltfGeometrySource)).rejects.toThrow("Unsupported VRM prop GLTF URL");
    }
    expect(loadRoot).not.toHaveBeenCalled();
  });
});
