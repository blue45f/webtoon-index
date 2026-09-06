import * as THREE from "three";

const MIPMAP_MIN_FILTERS: ReadonlySet<number> = new Set([
  THREE.NearestMipmapNearestFilter,
  THREE.NearestMipmapLinearFilter,
  THREE.LinearMipmapNearestFilter,
  THREE.LinearMipmapLinearFilter,
]);

const STUDIO_BG3D_COLOR_TEXTURE_KEYS: ReadonlySet<string> = new Set([
  "map",
  "matcap",
  "emissiveMap",
  "specularMap",
]);

const STUDIO_BG3D_RUNTIME_LIGHTING_HINTS = {
  default: {
    castShadow: true,
    receiveShadow: true,
  },
  off: {
    castShadow: false,
    receiveShadow: false,
  },
};

const STUDIO_BG3D_RUNTIME_MAX_ANISOTROPY = 16;

interface StudioBg3dRuntimeAssetQualityMaterialTextureInput {
  readonly texture: THREE.Texture;
  readonly isColorTexture: boolean;
}

export interface StudioBg3dRuntimeAssetQualityInput {
  castShadow: boolean;
  receiveShadow: boolean;
  /**
   * Renderer that will draw the asset, used only to read the device anisotropy ceiling.
   *
   * WebGL exposes it under `capabilities`; WebGPU exposes it on the renderer itself. Naming one
   * type would silently fall back to the constant on the other, so both shapes are accepted.
   */
  readonly renderer?:
    | (Partial<THREE.WebGLRenderer> & { getMaxAnisotropy?: () => number })
    | null;
  /** qualityBudget lowers anisotropy only; mesh lighting/casting is still controlled by flags. */
  readonly qualityBudget?: number;
}

function clampQualityBudget(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.max(0.2, Math.min(1, value));
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

function textureSize(texture: THREE.Texture): { readonly width: number; readonly height: number } | null {
  const source = texture.source?.data ?? texture.image;
  if (!source || typeof source !== "object") return null;
  const record = source as { readonly width?: unknown; readonly height?: unknown };
  const width = record.width;
  const height = record.height;
  if (!Number.isFinite(width as number) || !Number.isFinite(height as number)) return null;
  return { width: width as number, height: height as number };
}

function isReadableMipMapCandidate(texture: THREE.Texture): boolean {
  if (!MIPMAP_MIN_FILTERS.has(texture.minFilter) && !texture.generateMipmaps) return false;
  const size = textureSize(texture);
  if (!size) return false;
  return isPowerOfTwo(size.width) && isPowerOfTwo(size.height);
}

function supportsHighQualityFiltering(texture: THREE.Texture): boolean {
  const size = textureSize(texture);
  if (!size || size.width <= 0 || size.height <= 0) return false;
  return true;
}

function collectMaterialTextures(material: THREE.Material): StudioBg3dRuntimeAssetQualityMaterialTextureInput[] {
  const textures: StudioBg3dRuntimeAssetQualityMaterialTextureInput[] = [];

  for (const [key, value] of Object.entries(material)) {
    if (!((value as { readonly isTexture?: unknown })?.isTexture === true)) continue;
    if (value instanceof THREE.Texture) {
      textures.push({
        texture: value,
        isColorTexture: STUDIO_BG3D_COLOR_TEXTURE_KEYS.has(key),
      });
    }
  }

  if ((material as THREE.ShaderMaterial).isShaderMaterial === true) {
    const shaderUniforms = (material as THREE.ShaderMaterial).uniforms;
    if (shaderUniforms) {
      for (const uniform of Object.values(shaderUniforms)) {
        const candidate = uniform?.value;
        if (candidate instanceof THREE.Texture) {
          textures.push({
            texture: candidate,
            isColorTexture: false,
          });
        }
      }
    }
  }

  return textures;
}

function improveTextureSamplingForRuntime(
  texture: THREE.Texture,
  qualityBudget: number,
  maxAnisotropy: number,
  isColorTexture: boolean,
): boolean {
  let updated = false;
  if (!supportsHighQualityFiltering(texture)) return false;

  const targetColorSpace = isColorTexture ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (texture.colorSpace !== targetColorSpace) {
    texture.colorSpace = targetColorSpace;
    updated = true;
  }

  const shouldUseMipMap = qualityBudget >= 0.85 && isReadableMipMapCandidate(texture);
  if (texture.generateMipmaps !== shouldUseMipMap) {
    texture.generateMipmaps = shouldUseMipMap;
    updated = true;
  }
  const targetMinFilter = shouldUseMipMap ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  if (texture.minFilter !== targetMinFilter) {
    texture.minFilter = targetMinFilter;
    updated = true;
  }
  if (texture.magFilter !== THREE.LinearFilter) {
    texture.magFilter = THREE.LinearFilter;
    updated = true;
  }

  const effectiveAnisotropy = Math.max(1, Math.floor(maxAnisotropy * qualityBudget));
  if (texture.anisotropy !== effectiveAnisotropy) {
    texture.anisotropy = effectiveAnisotropy;
    updated = true;
  }

  if (updated) texture.needsUpdate = true;
  return updated;
}

function improveMaterialsForRuntimeQuality(
  material: THREE.Material,
  qualityBudget: number,
  maxAnisotropy: number,
): boolean {
  let updated = false;
  for (const { texture, isColorTexture } of collectMaterialTextures(material)) {
    if (improveTextureSamplingForRuntime(texture, qualityBudget, maxAnisotropy, isColorTexture)) {
      updated = true;
    }
  }
  if (updated) material.needsUpdate = true;
  return updated;
}

export function applyStudioBg3dRuntimeAssetQuality(
  root: THREE.Object3D,
  quality: StudioBg3dRuntimeAssetQualityInput
): void {
  const hints =
    quality.castShadow || quality.receiveShadow
      ? STUDIO_BG3D_RUNTIME_LIGHTING_HINTS.default
      : STUDIO_BG3D_RUNTIME_LIGHTING_HINTS.off;
  const qualityBudget = clampQualityBudget(quality.qualityBudget);
  const maxAnisotropy = Math.max(
    1,
    Math.min(
      STUDIO_BG3D_RUNTIME_MAX_ANISOTROPY,
      quality.renderer?.capabilities?.getMaxAnisotropy?.()
        ?? quality.renderer?.getMaxAnisotropy?.()
        ?? STUDIO_BG3D_RUNTIME_MAX_ANISOTROPY,
    ),
  );

  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if ((mesh as THREE.Mesh).isMesh === true) {
      mesh.castShadow = hints.castShadow;
      mesh.receiveShadow = hints.receiveShadow;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!(material instanceof THREE.Material)) continue;
        improveMaterialsForRuntimeQuality(material, qualityBudget, maxAnisotropy);
      }
    }
  });
}
