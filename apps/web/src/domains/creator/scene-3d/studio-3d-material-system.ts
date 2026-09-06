/**
 * Studio 3D Material Override System
 *
 * Shot별 재질 오버라이드 및 Toon/PBR 재질 프리셋을 관리합니다.
 *
 * 설계서 참조: §6.9 Material·Texture·Procedural, MAT-001~MAT-012
 */

export type MaterialType = "pbr" | "mtoon" | "unlit" | "toon-flat";

export interface PBRProperties {
  baseColor: [number, number, number, number]; // RGBA
  metallic: number;
  roughness: number;
  emissive: [number, number, number];
  normalScale: number;
  aoIntensity: number;
}

export interface MToonProperties {
  litColor: [number, number, number, number];
  shadeColor: [number, number, number, number];
  shadingShiftFactor: number;
  shadingToonyFactor: number;
  outlineWidthMode: "none" | "worldCoordinates" | "screenCoordinates";
  outlineWidth: number;
  outlineColor: [number, number, number, number];
  rimColor: [number, number, number, number];
  rimFresnelPower: number;
  uvAnimationSpeedX: number;
  uvAnimationSpeedY: number;
}

export interface ToonFlatProperties {
  baseColor: [number, number, number, number];
  shadowColor: [number, number, number, number];
  shadowBands: number;      // 카툰 그림자 단수 (2 = 2단)
  outlineWidth: number;
  outlineColor: [number, number, number, number];
  specularEnabled: boolean;
  rimEnabled: boolean;
}

export interface UnlitProperties {
  baseColor: [number, number, number, number];
  emissive: [number, number, number];
}

export interface MaterialDefinition {
  id: string;
  name: string;
  type: MaterialType;
  pbr?: PBRProperties;
  mtoon?: MToonProperties;
  toonFlat?: ToonFlatProperties;
  unlit?: UnlitProperties;
  visible: boolean;
  textureSlots: Record<string, string>; // slot name → texture asset ID
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : minimum;
}

function color4(value: readonly [number, number, number, number]): [number, number, number, number] {
  return value.map((component) => clamp(component, 0, 1)) as [number, number, number, number];
}

function color3(value: readonly [number, number, number]): [number, number, number] {
  return value.map((component) => clamp(component, 0, 100)) as [number, number, number];
}

function cloneMaterial(material: MaterialDefinition): MaterialDefinition {
  return {
    ...material,
    pbr: material.pbr ? {
      ...material.pbr,
      baseColor: [...material.pbr.baseColor],
      emissive: [...material.pbr.emissive],
    } : undefined,
    mtoon: material.mtoon ? {
      ...material.mtoon,
      litColor: [...material.mtoon.litColor],
      shadeColor: [...material.mtoon.shadeColor],
      outlineColor: [...material.mtoon.outlineColor],
      rimColor: [...material.mtoon.rimColor],
    } : undefined,
    toonFlat: material.toonFlat ? {
      ...material.toonFlat,
      baseColor: [...material.toonFlat.baseColor],
      shadowColor: [...material.toonFlat.shadowColor],
      outlineColor: [...material.toonFlat.outlineColor],
    } : undefined,
    unlit: material.unlit ? {
      ...material.unlit,
      baseColor: [...material.unlit.baseColor],
      emissive: [...material.unlit.emissive],
    } : undefined,
    textureSlots: { ...material.textureSlots },
  };
}

function cloneOverride(override: MaterialOverridePatch): MaterialOverridePatch {
  return {
    materialId: override.materialId,
    shotId: override.shotId,
    patches: {
      ...override.patches,
      baseColor: override.patches.baseColor ? [...override.patches.baseColor] : undefined,
      emissive: override.patches.emissive ? [...override.patches.emissive] : undefined,
      outlineColor: override.patches.outlineColor ? [...override.patches.outlineColor] : undefined,
    },
  };
}

export interface MaterialOverridePatch {
  materialId: string;
  shotId: string;
  patches: Partial<{
    baseColor: [number, number, number, number];
    metallic: number;
    roughness: number;
    emissive: [number, number, number];
    outlineWidth: number;
    outlineColor: [number, number, number, number];
    shadowBands: number;
    visible: boolean;
  }>;
}

export class Studio3DMaterialSystem {
  private materials = new Map<string, MaterialDefinition>();
  private overrides: MaterialOverridePatch[] = [];
  private nextId = 1;

  public createMaterial(name: string, type: MaterialType): MaterialDefinition {
    const id = `mat-${this.nextId++}`;
    const mat: MaterialDefinition = {
      id,
      name,
      type,
      visible: true,
      textureSlots: {},
    };

    switch (type) {
      case "pbr":
        mat.pbr = {
          baseColor: [0.8, 0.8, 0.8, 1],
          metallic: 0,
          roughness: 0.5,
          emissive: [0, 0, 0],
          normalScale: 1,
          aoIntensity: 1,
        };
        break;
      case "mtoon":
        mat.mtoon = {
          litColor: [1, 1, 1, 1],
          shadeColor: [0.6, 0.6, 0.7, 1],
          shadingShiftFactor: 0,
          shadingToonyFactor: 0.9,
          outlineWidthMode: "screenCoordinates",
          outlineWidth: 1,
          outlineColor: [0, 0, 0, 1],
          rimColor: [0, 0, 0, 0],
          rimFresnelPower: 1,
          uvAnimationSpeedX: 0,
          uvAnimationSpeedY: 0,
        };
        break;
      case "toon-flat":
        mat.toonFlat = {
          baseColor: [1, 1, 1, 1],
          shadowColor: [0.6, 0.6, 0.7, 1],
          shadowBands: 2,
          outlineWidth: 1.5,
          outlineColor: [0.1, 0.08, 0.06, 1],
          specularEnabled: false,
          rimEnabled: false,
        };
        break;
      case "unlit":
        mat.unlit = {
          baseColor: [1, 1, 1, 1],
          emissive: [0, 0, 0],
        };
        break;
    }

    this.materials.set(id, mat);
    return cloneMaterial(mat);
  }

  public getMaterial(id: string): MaterialDefinition | undefined {
    const material = this.materials.get(id);
    return material ? cloneMaterial(material) : undefined;
  }

  public getAllMaterials(): MaterialDefinition[] {
    return [...this.materials.values()].map(cloneMaterial);
  }

  public removeMaterial(id: string): boolean {
    this.overrides = this.overrides.filter((o) => o.materialId !== id);
    return this.materials.delete(id);
  }

  public setTextureSlot(materialId: string, slot: string, textureAssetId: string): boolean {
    const mat = this.materials.get(materialId);
    if (!mat || !slot.trim() || !textureAssetId.trim()) return false;
    mat.textureSlots[slot] = textureAssetId;
    return true;
  }

  public removeTextureSlot(materialId: string, slot: string): boolean {
    const material = this.materials.get(materialId);
    if (!material || !(slot in material.textureSlots)) return false;
    delete material.textureSlots[slot];
    return true;
  }

  // ── Shot Override ──

  public addOverride(override: MaterialOverridePatch): boolean {
    if (!this.materials.has(override.materialId) || !override.shotId.trim()) return false;
    const sanitized: MaterialOverridePatch = {
      materialId: override.materialId,
      shotId: override.shotId,
      patches: {
        baseColor: override.patches.baseColor ? color4(override.patches.baseColor) : undefined,
        metallic: override.patches.metallic === undefined
          ? undefined
          : clamp(override.patches.metallic, 0, 1),
        roughness: override.patches.roughness === undefined
          ? undefined
          : clamp(override.patches.roughness, 0, 1),
        emissive: override.patches.emissive ? color3(override.patches.emissive) : undefined,
        outlineWidth: override.patches.outlineWidth === undefined
          ? undefined
          : clamp(override.patches.outlineWidth, 0, 100),
        outlineColor: override.patches.outlineColor ? color4(override.patches.outlineColor) : undefined,
        shadowBands: override.patches.shadowBands === undefined
          ? undefined
          : Math.trunc(clamp(override.patches.shadowBands, 1, 8)),
        visible: override.patches.visible,
      },
    };
    // 기존 동일 material+shot override 교체
    this.overrides = this.overrides.filter(
      (o) => !(o.materialId === override.materialId && o.shotId === override.shotId),
    );
    this.overrides.push(sanitized);
    return true;
  }

  public getOverridesForShot(shotId: string): MaterialOverridePatch[] {
    return this.overrides.filter((o) => o.shotId === shotId).map(cloneOverride);
  }

  public removeOverride(materialId: string, shotId: string): boolean {
    const before = this.overrides.length;
    this.overrides = this.overrides.filter(
      (o) => !(o.materialId === materialId && o.shotId === shotId),
    );
    return this.overrides.length < before;
  }

  public resolveMaterialForShot(materialId: string, shotId: string): MaterialDefinition | undefined {
    const source = this.materials.get(materialId);
    if (!source) return undefined;
    const resolved = cloneMaterial(source);
    const override = this.overrides.find(
      (candidate) => candidate.materialId === materialId && candidate.shotId === shotId,
    );
    if (!override) return resolved;

    const patch = override.patches;
    if (patch.visible !== undefined) resolved.visible = patch.visible;
    if (patch.baseColor) {
      if (resolved.pbr) resolved.pbr.baseColor = [...patch.baseColor];
      if (resolved.mtoon) resolved.mtoon.litColor = [...patch.baseColor];
      if (resolved.toonFlat) resolved.toonFlat.baseColor = [...patch.baseColor];
      if (resolved.unlit) resolved.unlit.baseColor = [...patch.baseColor];
    }
    if (resolved.pbr) {
      if (patch.metallic !== undefined) resolved.pbr.metallic = patch.metallic;
      if (patch.roughness !== undefined) resolved.pbr.roughness = patch.roughness;
      if (patch.emissive) resolved.pbr.emissive = [...patch.emissive];
    }
    if (resolved.unlit && patch.emissive) resolved.unlit.emissive = [...patch.emissive];
    if (patch.outlineWidth !== undefined) {
      if (resolved.mtoon) resolved.mtoon.outlineWidth = patch.outlineWidth;
      if (resolved.toonFlat) resolved.toonFlat.outlineWidth = patch.outlineWidth;
    }
    if (patch.outlineColor) {
      if (resolved.mtoon) resolved.mtoon.outlineColor = [...patch.outlineColor];
      if (resolved.toonFlat) resolved.toonFlat.outlineColor = [...patch.outlineColor];
    }
    if (resolved.toonFlat && patch.shadowBands !== undefined) {
      resolved.toonFlat.shadowBands = patch.shadowBands;
    }
    return resolved;
  }

  // ── Toon Presets ──

  public static getToonPresets(): Array<{ name: string; type: MaterialType; description: string }> {
    return [
      { name: "웹툰 표준 잉크", type: "toon-flat", description: "2단 툰 셰이딩 + 선화 강조" },
      { name: "수채화 소프트", type: "toon-flat", description: "부드러운 그라데이션 셰이딩" },
      { name: "하이 콘트라스트", type: "toon-flat", description: "명암 대비 강한 극적 연출" },
      { name: "MToon VRM 표준", type: "mtoon", description: "VRM 캐릭터 호환 MToon 재질" },
      { name: "PBR 사실적", type: "pbr", description: "물리 기반 사실적 렌더링" },
      { name: "언릿 플랫", type: "unlit", description: "조명 없는 단색 플랫 렌더" },
    ];
  }
}
