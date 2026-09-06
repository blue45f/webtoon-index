import * as THREE from "three";

import {
  classifyMeshName,
  resolveCostumeMaterialBaseHex,
  tintColor,
  type CostumeSlot,
  type CostumeState,
} from "./studio-vrm-costume";

import type { VRM } from "@pixiv/three-vrm";

export interface StudioVrmCostumeMeshEntry {
  /** 직렬화·식별 키(노드 이름 우선, 비면 머티리얼 이름). */
  key: string;
  /** 표시용 이름. */
  label: string;
  slot: CostumeSlot;
  mesh: THREE.Mesh;
}

// 원본 머티리얼 색(hex)을 메시별로 1회 캡처해 둔다(틴트는 항상 원본 기준 — 중첩 누적 방지).
const costumeBaseColorCache = new WeakMap<THREE.Material, string>();
const isolatedCostumeMaterialMeshes = new WeakSet<THREE.Mesh>();

function materialBaseHex(mat: THREE.Material): string {
  const cached = costumeBaseColorCache.get(mat);
  if (cached) return cached;
  const colored = mat as THREE.Material & {
    color?: THREE.Color;
    map?: THREE.Texture | null;
  };
  const currentHex = colored.color ? `#${colored.color.getHexString()}` : "#cccccc";
  const resolved = resolveCostumeMaterialBaseHex(currentHex, {
    hasMap: Boolean(colored.map),
    cached: null,
  });
  if (resolved.cacheable) {
    costumeBaseColorCache.set(mat, resolved.hex);
  }
  return resolved.hex;
}

/**
 * Clone materials lazily at the first recolor. Keeping the authored material on load preserves
 * VRoid/MToon textures and avoids a native-albedo flash followed by black garments.
 */
function isolateCostumeMaterialsForRecolor(mesh: THREE.Mesh): THREE.Material[] {
  let materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (isolatedCostumeMaterialMeshes.has(mesh)) {
    return materials.filter((material): material is THREE.Material => Boolean(material));
  }
  const mannequinPoisoned = materials.some((material) => {
    const candidate = material as THREE.Material & { userData?: Record<string, unknown> };
    return candidate?.userData?.__vrmMannequinActive === true;
  });
  if (mannequinPoisoned) {
    return materials.filter((material): material is THREE.Material => Boolean(material));
  }
  materials = materials.map((material) => material.clone());
  mesh.material = Array.isArray(mesh.material) ? materials : materials[0]!;
  isolatedCostumeMaterialMeshes.add(mesh);
  return materials;
}

/** 씬그래프를 순회해 의상 슬롯에 해당하는 메시를 수집한다(피부·얼굴·눈·머리 제외). */
export function collectStudioVrmCostumeMeshes(vrm: VRM): StudioVrmCostumeMeshEntry[] {
  const entries: StudioVrmCostumeMeshEntry[] = [];
  const seenKeys = new Set<string>();
  vrm.scene.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    const mesh = obj as THREE.Mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const matNames = materials.map((m) => (m as THREE.Material | undefined)?.name)
      .filter(Boolean) as string[];
    const materialClasses = matNames.map((name) => classifyMeshName(name));
    const explicitMaterialSlot = materialClasses
      .find((entry) => entry.slot !== null && entry.protected === null)?.slot ?? null;
    const hasProtectedMaterial = materialClasses.some((entry) => entry.protected !== null);
    // Exporters sometimes name every primitive simply "Body". An explicit clothing material is
    // stronger evidence than that generic node name, but a truly mixed skin+cloth material array
    // remains protected because mesh-level visibility would hide skin with the outfit.
    const cls = explicitMaterialSlot && !hasProtectedMaterial
      ? { slot: explicitMaterialSlot, protected: null }
      : classifyMeshName(mesh.name, ...matNames);
    if (cls.slot === null || cls.protected !== null) return;
    const baseKey = mesh.name || matNames[0] || `mesh-${entries.length}`;
    let key = baseKey;
    let duplicateIndex = 2;
    while (seenKeys.has(key)) {
      key = `${baseKey}#${duplicateIndex}`;
      duplicateIndex += 1;
    }
    seenKeys.add(key);
    // Do not clone or cache materials while collecting. Recolor owns the isolation boundary.
    entries.push({ key, label: mesh.name || matNames[0] || "메시", slot: cls.slot, mesh });
  });
  return entries;
}

/** 수집된 의상 메시에 표시/숨김·리컬러 상태를 적용한다. */
export function applyStudioVrmCostumeState(
  entries: StudioVrmCostumeMeshEntry[],
  state: CostumeState,
) {
  for (const entry of entries) {
    entry.mesh.visible = !state.hidden.includes(entry.key);
    const target = state.recolor[entry.key];
    if (!target && !isolatedCostumeMaterialMeshes.has(entry.mesh)) {
      const nativeMaterials = Array.isArray(entry.mesh.material)
        ? entry.mesh.material
        : [entry.mesh.material];
      for (const material of nativeMaterials) {
        const candidate = material as (THREE.Material & {
          userData?: Record<string, unknown>;
        }) | undefined;
        if (candidate?.userData?.__vrmCostumeRecolorApplied === true) {
          candidate.userData.__vrmCostumeRecolorApplied = false;
        }
      }
      continue;
    }

    const materials = target
      ? isolateCostumeMaterialsForRecolor(entry.mesh)
      : (Array.isArray(entry.mesh.material) ? entry.mesh.material : [entry.mesh.material]);

    materials.forEach((m) => {
      const mat = m as (THREE.Material & {
        color?: THREE.Color;
        userData: Record<string, unknown>;
      }) | undefined;
      if (!mat || !mat.color) return;
      if (mat.userData.__vrmMannequinActive === true) return;

      if (target) {
        const base = materialBaseHex(mat);
        mat.color.set(tintColor(base, target));
        mat.userData.__vrmCostumeRecolorApplied = true;
        mat.needsUpdate = true;
        return;
      }

      if (mat.userData.__vrmCostumeRecolorApplied === true) {
        const base = materialBaseHex(mat);
        mat.color.set(base);
        mat.userData.__vrmCostumeRecolorApplied = false;
        mat.needsUpdate = true;
      }
    });
  }
}
