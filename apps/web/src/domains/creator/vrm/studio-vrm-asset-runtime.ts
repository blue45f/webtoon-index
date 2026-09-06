import * as THREE from "three";

import { applyStudioBg3dRuntimeAssetQuality } from "../bg3d/studio-bg3d-runtime-asset-quality";

import {
  inspectStudioVrmLicenseAuthority,
  type StudioVrmLicenseAuthority,
} from "./studio-vrm-license-product-gate";
import { stampStudioVrmTexturePaintMaterialLocator } from "./studio-vrm-texture-paint-binding";
import { isUsableVrmAssetResponse } from "./vrm-library";

import type { VRM } from "@pixiv/three-vrm";

import { resolveAssetUrl } from "@/src/shared/catalog/catalog-static";

export const STUDIO_VRM_BASE_ROTATION_Y_KEY = "studioVrmBaseRotationY";
export const STUDIO_VRM_HTML_FALLBACK_ERROR =
  "VRM 파일 대신 웹 페이지가 응답했습니다. 배포에 해당 .vrm 파일이 포함되어 있는지 확인해 주세요.";

/**
 * Which MToon implementation the loaded VRM carries.
 *
 * MToon ships two materials for the same specification. `"webgl-shader"` is `MToonMaterial`, a
 * `ShaderMaterial` that only `WebGLRenderer` can compile. `"webgpu-node"` is `MToonNodeMaterial`,
 * the TSL node port, which only a `WebGPURenderer` can build. There is no material that works on
 * both, so the choice belongs to whoever owns the renderer — never to a default in here.
 */
export type StudioVrmMaterialVariant = "webgl-shader" | "webgpu-node";

export interface StudioVrmAssetLoadOptions {
  /**
   * MToon material class the loader must instantiate. Omitted means MToon's WebGL `ShaderMaterial`.
   *
   * The class is passed in rather than imported here on purpose. `MToonNodeMaterial` lives in
   * `@pixiv/three-vrm/nodes`, which statically imports Three's WebGPU build, and this module is a
   * leaf shared with the VRM poser — importing it from here would put the poser's chunk on the
   * WebGPU graph for a material it never asks for. The caller that owns a WebGPU renderer supplies
   * the class from the approved lazy entry instead.
   */
  readonly mtoonMaterialType?: typeof THREE.Material;
}

export type StudioVrmAssetRuntime = {
  load: (url: string, options?: StudioVrmAssetLoadOptions) => Promise<VRM>;
  dispose: (vrm: VRM) => void;
};

export type StudioVrmAssetRuntimeDependencies = {
  resolveUrl: (url: string) => string;
  preflight: (resolvedUrl: string) => Promise<void>;
  loadResolved: (
    resolvedUrl: string,
    mtoonMaterialType: typeof THREE.Material | undefined,
  ) => Promise<VRM>;
  prepare: (vrm: VRM) => void;
  deepDispose: (scene: THREE.Object3D) => Promise<void>;
  fallbackDispose: (scene: THREE.Object3D) => void;
};

type StudioVrmGltfAssociation = Readonly<{
  materials?: number;
}>;

const studioVrmLicenseAuthorityByAsset = new WeakMap<VRM, StudioVrmLicenseAuthority>();

/**
 * Binds the bounded, immutable license receipt to the loaded VRM object. Keeping the authority in
 * a WeakMap avoids trusting mutable scene userData and releases it automatically with the asset.
 */
export function stampStudioVrmAssetLicenseAuthority(
  vrm: VRM,
  gltfJson: unknown,
): StudioVrmLicenseAuthority {
  const authority = inspectStudioVrmLicenseAuthority(gltfJson);
  studioVrmLicenseAuthorityByAsset.set(vrm, authority);
  return authority;
}

export function readStudioVrmAssetLicenseAuthority(
  vrm: VRM | null | undefined,
): StudioVrmLicenseAuthority | null {
  return vrm ? studioVrmLicenseAuthorityByAsset.get(vrm) ?? null : null;
}

const studioVrmMaterialVariantByAsset = new WeakMap<VRM, StudioVrmMaterialVariant>();

/**
 * Records which MToon implementation an asset was built with. A VRM loaded for one renderer can
 * never be shown on the other, so callers that cache or hand assets around need to be able to ask
 * rather than guess from the material class.
 */
export function stampStudioVrmMaterialVariant(
  vrm: VRM,
  variant: StudioVrmMaterialVariant,
): void {
  studioVrmMaterialVariantByAsset.set(vrm, variant);
}

export function readStudioVrmMaterialVariant(
  vrm: VRM | null | undefined,
): StudioVrmMaterialVariant | null {
  return vrm ? studioVrmMaterialVariantByAsset.get(vrm) ?? null : null;
}

/**
 * Keeps GLTFLoader's stable material index after the parser is released. Runtime UUIDs and model
 * names are deliberately not used because neither survives a project round trip reliably.
 */
export function stampStudioVrmGltfMaterialAssociations(
  associations: ReadonlyMap<unknown, StudioVrmGltfAssociation> | null | undefined,
): number {
  if (!associations) return 0;
  let stamped = 0;
  for (const [candidate, association] of associations) {
    const material = candidate as THREE.Material & { readonly isMaterial?: unknown };
    const materialIndex = association?.materials;
    if (
      material?.isMaterial !== true
      || !Number.isSafeInteger(materialIndex)
      || (materialIndex ?? -1) < 0
    ) {
      continue;
    }
    if (stampStudioVrmTexturePaintMaterialLocator(material, materialIndex as number)) {
      stamped += 1;
    }
  }
  return stamped;
}

export function createStudioVrmAssetRuntime(
  dependencies: StudioVrmAssetRuntimeDependencies,
): StudioVrmAssetRuntime {
  return {
    async load(url, options) {
      const resolvedUrl = dependencies.resolveUrl(url);
      await dependencies.preflight(resolvedUrl);
      const vrm = await dependencies.loadResolved(resolvedUrl, options?.mtoonMaterialType);
      dependencies.prepare(vrm);
      stampStudioVrmMaterialVariant(
        vrm,
        options?.mtoonMaterialType ? "webgpu-node" : "webgl-shader",
      );
      return vrm;
    },
    dispose(vrm) {
      vrm.scene.parent?.remove(vrm.scene);
      void dependencies.deepDispose(vrm.scene).catch(() => {
        dependencies.fallbackDispose(vrm.scene);
      });
    },
  };
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true;
}

function prepareVrmScene(vrm: VRM): void {
  vrm.scene.traverse((object) => {
    object.frustumCulled = false;
    if (isMesh(object)) object.receiveShadow = true;
  });
  applyStudioBg3dRuntimeAssetQuality(vrm.scene, {
    castShadow: true,
    receiveShadow: true,
    qualityBudget: 1,
  });
  vrm.scene.position.set(0, 0, 0);
  vrm.scene.userData[STUDIO_VRM_BASE_ROTATION_Y_KEY] = vrm.scene.rotation.y;
}

function fallbackDisposeVrmScene(scene: THREE.Object3D): void {
  scene.traverse((object) => {
    if (!isMesh(object)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => material.dispose());
  });
}

async function preflightVrmUrl(url: string): Promise<void> {
  if (typeof globalThis.fetch !== "function" || url.startsWith("blob:") || url.startsWith("data:")) return;
  const response = await globalThis.fetch(url, { method: "HEAD", cache: "force-cache" });
  if (!response.ok) throw new Error(`VRM 파일을 찾지 못했습니다. (${response.status})`);
  if (!isUsableVrmAssetResponse(response)) throw new Error(STUDIO_VRM_HTML_FALLBACK_ERROR);
}

async function loadResolvedVrm(
  url: string,
  mtoonMaterialType: typeof THREE.Material | undefined,
): Promise<VRM> {
  const [{ GLTFLoader }, { VRMLoaderPlugin, VRMUtils, MToonMaterialLoaderPlugin }] =
    await Promise.all([
      import("three/examples/jsm/loaders/GLTFLoader.js"),
      import("@pixiv/three-vrm"),
    ]);
  const loader = new GLTFLoader();
  if (mtoonMaterialType) {
    loader.register(
      (parser) =>
        new VRMLoaderPlugin(parser, {
          mtoonMaterialPlugin: new MToonMaterialLoaderPlugin(parser, {
            materialType: mtoonMaterialType,
          }),
        }),
    );
  } else {
    loader.register((parser) => new VRMLoaderPlugin(parser));
  }
  const gltf = await loader.loadAsync(url);
  stampStudioVrmGltfMaterialAssociations(
    (gltf.parser as unknown as {
      readonly associations?: ReadonlyMap<unknown, StudioVrmGltfAssociation>;
    }).associations,
  );
  VRMUtils.combineSkeletons?.(gltf.scene);
  const loadedVrm = gltf.userData.vrm as VRM | undefined;
  if (!loadedVrm) {
    VRMUtils.deepDispose(gltf.scene);
    throw new Error("VRM 데이터를 찾지 못했습니다.");
  }
  stampStudioVrmAssetLicenseAuthority(
    loadedVrm,
    (gltf.parser as unknown as { readonly json?: unknown }).json,
  );
  if (loadedVrm.meta.metaVersion === "0") VRMUtils.rotateVRM0(loadedVrm);
  return loadedVrm;
}

const defaultStudioVrmAssetRuntime = createStudioVrmAssetRuntime({
  resolveUrl: resolveAssetUrl,
  preflight: preflightVrmUrl,
  loadResolved: loadResolvedVrm,
  prepare: prepareVrmScene,
  deepDispose: async (scene) => {
    const { VRMUtils } = await import("@pixiv/three-vrm");
    VRMUtils.deepDispose(scene);
  },
  fallbackDispose: fallbackDisposeVrmScene,
});

export function loadStudioVrmAsset(
  url: string,
  options?: StudioVrmAssetLoadOptions,
): Promise<VRM> {
  return defaultStudioVrmAssetRuntime.load(url, options);
}

export function disposeStudioVrmAsset(vrm: VRM): void {
  defaultStudioVrmAssetRuntime.dispose(vrm);
}
