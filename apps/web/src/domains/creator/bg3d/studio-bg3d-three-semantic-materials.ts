/** Three.js adapter for the renderer-neutral semantic material classifier. */

import {
  STUDIO_BG3D_SEMANTIC_MATERIAL_MAX_ITEMS,
  STUDIO_BG3D_SEMANTIC_MATERIAL_MAX_METADATA_BYTES,
  STUDIO_BG3D_SEMANTIC_MATERIAL_MAX_NAMES_PER_KIND,
  STUDIO_BG3D_SEMANTIC_MATERIAL_MAX_NAME_BYTES,
  classifyStudioBg3dSemanticMaterials,
  type StudioBg3dSemanticMaterialClassificationResult,
  type StudioBg3dSemanticMaterialDescriptor,
} from "./studio-bg3d-semantic-materials";

import type * as THREE from "three";

const UTF8_ENCODER = new TextEncoder();
const UNSAFE_NAME_PATTERN = /[\p{Cc}\p{Cf}]/u;
const URL_LIKE_NAME_PATTERN = /^(?:https?|blob|data|file):/iu;

interface PendingDescriptor {
  readonly materialKey: string;
  readonly materialName?: string;
  readonly meshNames: Set<string>;
  readonly nodeNames: Set<string>;
}

function safeMetadataName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (
    !normalized ||
    UNSAFE_NAME_PATTERN.test(normalized) ||
    URL_LIKE_NAME_PATTERN.test(normalized) ||
    UTF8_ENCODER.encode(normalized).byteLength > STUDIO_BG3D_SEMANTIC_MATERIAL_MAX_NAME_BYTES
  ) {
    return undefined;
  }
  return normalized;
}

function addBoundedName(target: Set<string>, value: unknown): string | undefined {
  if (target.size >= STUDIO_BG3D_SEMANTIC_MATERIAL_MAX_NAMES_PER_KIND) return undefined;
  const normalized = safeMetadataName(value);
  if (!normalized || target.has(normalized)) return undefined;
  target.add(normalized);
  return normalized;
}

function renderableMaterials(object: THREE.Object3D): readonly THREE.Material[] {
  const candidate = object as THREE.Object3D & {
    readonly isMesh?: boolean;
    readonly isLine?: boolean;
    readonly isPoints?: boolean;
    readonly material?: THREE.Material | readonly THREE.Material[];
  };
  if (!candidate.isMesh && !candidate.isLine && !candidate.isPoints) return [];
  if (!candidate.material) return [];
  return Array.isArray(candidate.material)
    ? candidate.material.filter((material): material is THREE.Material => Boolean(material))
    : [candidate.material as THREE.Material];
}

/**
 * Extracts bounded names from a verified Three scene and classifies each unique shared material.
 * Unsafe or overlong names are omitted instead of being copied into the renderer-neutral result.
 */
export function classifyStudioBg3dThreeSemanticMaterials(
  root: THREE.Object3D,
): StudioBg3dSemanticMaterialClassificationResult {
  try {
    const pendingByMaterial = new Map<THREE.Material, PendingDescriptor>();
    let metadataBytes = 0;
    root.traverse((object) => {
      const materials = renderableMaterials(object);
      for (const material of materials) {
        let pending = pendingByMaterial.get(material);
        if (!pending) {
          if (pendingByMaterial.size >= STUDIO_BG3D_SEMANTIC_MATERIAL_MAX_ITEMS) {
            throw new RangeError("material-budget-exceeded");
          }
          const materialName = safeMetadataName(material.name);
          pending = {
            materialKey: `material-${pendingByMaterial.size}`,
            ...(materialName ? { materialName } : {}),
            meshNames: new Set(),
            nodeNames: new Set(),
          };
          pendingByMaterial.set(material, pending);
          if (materialName) metadataBytes += UTF8_ENCODER.encode(materialName).byteLength;
        }
        const meshName = addBoundedName(pending.meshNames, object.name);
        if (meshName) metadataBytes += UTF8_ENCODER.encode(meshName).byteLength;
        let ancestor = object.parent;
        while (ancestor && pending.nodeNames.size < STUDIO_BG3D_SEMANTIC_MATERIAL_MAX_NAMES_PER_KIND) {
          const nodeName = addBoundedName(pending.nodeNames, ancestor.name);
          if (nodeName) metadataBytes += UTF8_ENCODER.encode(nodeName).byteLength;
          ancestor = ancestor.parent;
        }
        if (metadataBytes > STUDIO_BG3D_SEMANTIC_MATERIAL_MAX_METADATA_BYTES) {
          throw new RangeError("metadata-budget-exceeded");
        }
      }
    });

    const descriptors: StudioBg3dSemanticMaterialDescriptor[] = [...pendingByMaterial.values()]
      .map((pending) => ({
        materialKey: pending.materialKey,
        ...(pending.materialName ? { materialName: pending.materialName } : {}),
        ...(pending.meshNames.size > 0 ? { meshNames: [...pending.meshNames] } : {}),
        ...(pending.nodeNames.size > 0 ? { nodeNames: [...pending.nodeNames] } : {}),
      }));
    return classifyStudioBg3dSemanticMaterials(descriptors);
  } catch (error) {
    return {
      ok: false,
      code: error instanceof RangeError && error.message === "material-budget-exceeded"
        ? "material-budget-exceeded"
        : error instanceof RangeError && error.message === "metadata-budget-exceeded"
          ? "metadata-budget-exceeded"
          : "invalid-input",
    };
  }
}
