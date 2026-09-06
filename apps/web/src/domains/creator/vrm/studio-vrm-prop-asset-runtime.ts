import * as THREE from "three";

import { applyStudioBg3dRuntimeAssetQuality } from "../bg3d/studio-bg3d-runtime-asset-quality";

import { STUDIO_VRM_PROP_ASSET_REVISIONS } from "./studio-vrm-prop-asset-revisions";

import type { PropGltfGeometrySource } from "./studio-vrm-props";

export interface StudioVrmPropAssetLease {
  readonly object: THREE.Object3D;
  readonly released: boolean;
  readonly source: PropGltfGeometrySource;
  /** Idempotent. Detaches this structural clone and releases its cache reservation. */
  release(): void;
}

export interface StudioVrmPropAssetRuntime {
  acquire(propId: string, source: PropGltfGeometrySource): Promise<StudioVrmPropAssetLease>;
}

export interface StudioVrmPropAssetRuntimeDependencies {
  loadRoot(url: string): Promise<THREE.Object3D>;
  cloneRoot(root: THREE.Object3D): Promise<THREE.Object3D>;
  disposeRoot(root: THREE.Object3D): void;
  scheduleCleanup(callback: () => void): void;
}

interface PropAssetCacheEntry {
  readonly url: string;
  rootPromise: Promise<THREE.Object3D>;
  root: THREE.Object3D | null;
  reservations: number;
  cleanupToken: object | null;
}

const FIRST_PARTY_PROP_GLTF_URL = /^\/assets\/3d\/[a-z0-9_-]+\.glb$/u;

function assertFirstPartyPropUrl(url: string): void {
  if (!FIRST_PARTY_PROP_GLTF_URL.test(url)) {
    throw new TypeError(`Unsupported VRM prop GLTF URL: ${url}`);
  }
}

/** Canonical catalogue/cache keys stay stable; the browser request is content-addressed. */
export function studioVrmPropAssetRequestUrl(url: string): string {
  const revision = STUDIO_VRM_PROP_ASSET_REVISIONS[url];
  return revision ? `${url}?v=${revision}` : url;
}

function preparePropClone(object: THREE.Object3D, propId: string): void {
  object.name = `prop:${propId}`;
  applyStudioBg3dRuntimeAssetQuality(object, {
    castShadow: true,
    receiveShadow: true,
  });
}

/** Static GLBs use a structural clone; skinned future props retain independent skeleton bindings. */
export async function cloneStudioVrmPropAssetRoot(root: THREE.Object3D): Promise<THREE.Object3D> {
  let hasSkinnedContent = false;
  root.traverse((object) => {
    if ((object as THREE.SkinnedMesh).isSkinnedMesh === true) hasSkinnedContent = true;
  });
  if (!hasSkinnedContent) return root.clone(true);
  const { clone } = await import("three/examples/jsm/utils/SkeletonUtils.js");
  return clone(root);
}

function collectMaterialTextures(material: THREE.Material, textures: Set<THREE.Texture>): void {
  for (const value of Object.values(material)) {
    if ((value as THREE.Texture | null)?.isTexture === true) textures.add(value as THREE.Texture);
  }
  const uniforms = (material as THREE.ShaderMaterial).uniforms;
  if (!uniforms) return;
  for (const uniform of Object.values(uniforms)) {
    const value = uniform?.value as THREE.Texture | null | undefined;
    if (value?.isTexture === true) textures.add(value);
  }
}

/** Disposes only the cache-owned source graph after its final structural-clone lease is released. */
export function disposeStudioVrmPropAssetRoot(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.removeFromParent();
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry?.isBufferGeometry === true) geometries.add(mesh.geometry);
    const meshMaterials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const material of meshMaterials) {
      materials.add(material);
      collectMaterialTextures(material, textures);
    }
    const boneTexture = (mesh as THREE.SkinnedMesh).skeleton?.boneTexture;
    if (boneTexture) textures.add(boneTexture);
  });

  for (const texture of textures) {
    try { texture.dispose(); } catch { /* 다른 GPU 자원도 계속 정리한다. */ }
  }
  for (const material of materials) {
    try { material.dispose(); } catch { /* 다른 GPU 자원도 계속 정리한다. */ }
  }
  for (const geometry of geometries) {
    try { geometry.dispose(); } catch { /* 다른 GPU 자원도 계속 정리한다. */ }
  }
}

/**
 * URL마다 cache-owned 원본은 하나만 decode하고, 장면에는 공유 GPU 자원을 가리키는 독립
 * Object3D clone만 넘긴다. 마지막 lease 정리는 microtask로 미뤄 React StrictMode의
 * setup→cleanup→setup 재생이 같은 decode를 재사용할 수 있게 한다.
 */
export function createStudioVrmPropAssetRuntime(
  dependencies: StudioVrmPropAssetRuntimeDependencies,
): StudioVrmPropAssetRuntime {
  const cache = new Map<string, PropAssetCacheEntry>();

  function createEntry(url: string): PropAssetCacheEntry {
    const entry = {
      url,
      root: null,
      reservations: 0,
      cleanupToken: null,
      rootPromise: Promise.resolve(null as unknown as THREE.Object3D),
    } as PropAssetCacheEntry;
    entry.rootPromise = Promise.resolve()
      .then(() => dependencies.loadRoot(url))
      .then((root) => {
        if (root?.isObject3D !== true) throw new TypeError(`Invalid VRM prop GLTF root: ${url}`);
        root.removeFromParent();
        entry.root = root;
        return root;
      });
    cache.set(url, entry);
    return entry;
  }

  function scheduleEntryCleanup(entry: PropAssetCacheEntry): void {
    if (entry.reservations !== 0 || entry.cleanupToken) return;
    const token = {};
    entry.cleanupToken = token;
    dependencies.scheduleCleanup(() => {
      if (
        entry.cleanupToken !== token
        || entry.reservations !== 0
        || cache.get(entry.url) !== entry
      ) return;
      entry.cleanupToken = null;
      cache.delete(entry.url);
      if (entry.root) dependencies.disposeRoot(entry.root);
    });
  }

  function releaseReservation(entry: PropAssetCacheEntry): void {
    entry.reservations = Math.max(0, entry.reservations - 1);
    scheduleEntryCleanup(entry);
  }

  return {
    async acquire(propId, source) {
      assertFirstPartyPropUrl(source.url);
      const entry = cache.get(source.url) ?? createEntry(source.url);
      entry.cleanupToken = null;
      entry.reservations += 1;

      let object: THREE.Object3D;
      try {
        const root = await entry.rootPromise;
        object = await dependencies.cloneRoot(root);
        if (object?.isObject3D !== true || object === root) {
          throw new TypeError(`Invalid VRM prop GLTF clone: ${source.url}`);
        }
        preparePropClone(object, propId);
      } catch (error) {
        releaseReservation(entry);
        throw error;
      }

      let released = false;
      return Object.freeze({
        object,
        get released() {
          return released;
        },
        source,
        release() {
          if (released) return;
          released = true;
          object.removeFromParent();
          releaseReservation(entry);
        },
      });
    },
  };
}

async function loadStudioVrmPropAssetRoot(url: string): Promise<THREE.Object3D> {
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().loadAsync(studioVrmPropAssetRequestUrl(url));
  return gltf.scene;
}

const defaultStudioVrmPropAssetRuntime = createStudioVrmPropAssetRuntime({
  loadRoot: loadStudioVrmPropAssetRoot,
  cloneRoot: cloneStudioVrmPropAssetRoot,
  disposeRoot: disposeStudioVrmPropAssetRoot,
  // Window.queueMicrotask is receiver-sensitive in Chromium. Keep the host call bound to
  // globalThis instead of storing the native function and invoking it as a dependency method.
  scheduleCleanup: (callback) => globalThis.queueMicrotask(callback),
});

export function acquireStudioVrmPropAsset(
  propId: string,
  source: PropGltfGeometrySource,
): Promise<StudioVrmPropAssetLease> {
  return defaultStudioVrmPropAssetRuntime.acquire(propId, source);
}
