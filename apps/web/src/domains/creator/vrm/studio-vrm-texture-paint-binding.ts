export const STUDIO_VRM_TEXTURE_PAINT_MATERIAL_LOCATOR_USER_DATA_KEY =
  "studioVrmMaterialLocator" as const;
export const STUDIO_VRM_TEXTURE_PAINT_BASE_COLOR_SLOT = "baseColor" as const;

export interface StudioVrmTexturePaintBindingDescriptor {
  readonly bindingKey: string;
  readonly materialLocator: string;
  readonly textureSlot: typeof STUDIO_VRM_TEXTURE_PAINT_BASE_COLOR_SLOT;
}

interface StudioVrmTexturePaintMaterialLocatorTarget {
  readonly userData: Record<string, unknown>;
}

const GLTF_MATERIAL_LOCATOR_PATTERN = /^gltf-material:(?:0|[1-9][0-9]{0,5})$/u;
const SCENE_PATH_MATERIAL_LOCATOR_PATTERN =
  /^scene-path:[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}){0,7}$/u;
const BINDING_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export function canonicalizeStudioVrmTexturePaintMaterialLocator(
  value: unknown,
): string | null {
  return typeof value === "string"
    && (
      GLTF_MATERIAL_LOCATOR_PATTERN.test(value)
      || SCENE_PATH_MATERIAL_LOCATOR_PATTERN.test(value)
    )
    ? value
    : null;
}

function bindingKeyForLocator(materialLocator: string): string | null {
  const safeStem = materialLocator
    .replace(/^gltf-material:/u, "gltf-material-")
    .replace(/^scene-path:/u, "scene-path-")
    .replaceAll("/", "-");
  const key = `${safeStem}-${STUDIO_VRM_TEXTURE_PAINT_BASE_COLOR_SLOT}`;
  return BINDING_KEY_PATTERN.test(key) ? key : null;
}

export function createStudioVrmTexturePaintBindingDescriptor(
  materialLocator: string,
): StudioVrmTexturePaintBindingDescriptor | null {
  const locator = canonicalizeStudioVrmTexturePaintMaterialLocator(materialLocator);
  if (!locator) return null;
  const bindingKey = bindingKeyForLocator(locator);
  if (!bindingKey) return null;
  return Object.freeze({
    bindingKey,
    materialLocator: locator,
    textureSlot: STUDIO_VRM_TEXTURE_PAINT_BASE_COLOR_SLOT,
  });
}

export function isCanonicalStudioVrmTexturePaintBindingDescriptor(
  value: StudioVrmTexturePaintBindingDescriptor,
): boolean {
  return BINDING_KEY_PATTERN.test(value.bindingKey)
    && canonicalizeStudioVrmTexturePaintMaterialLocator(value.materialLocator)
      === value.materialLocator
    && value.textureSlot === STUDIO_VRM_TEXTURE_PAINT_BASE_COLOR_SLOT;
}

/** Stamps a loader-provided glTF material index without persisting a Three.js UUID. */
export function stampStudioVrmTexturePaintMaterialLocator(
  material: StudioVrmTexturePaintMaterialLocatorTarget,
  gltfMaterialIndex: number,
): StudioVrmTexturePaintBindingDescriptor | null {
  if (!Number.isSafeInteger(gltfMaterialIndex) || gltfMaterialIndex < 0) return null;
  const descriptor = createStudioVrmTexturePaintBindingDescriptor(
    `gltf-material:${gltfMaterialIndex}`,
  );
  if (!descriptor) return null;
  try {
    material.userData[STUDIO_VRM_TEXTURE_PAINT_MATERIAL_LOCATOR_USER_DATA_KEY] =
      descriptor.materialLocator;
  } catch {
    // Frozen/proxied custom materials must not abort the surrounding VRM load.
    return null;
  }
  return descriptor;
}
