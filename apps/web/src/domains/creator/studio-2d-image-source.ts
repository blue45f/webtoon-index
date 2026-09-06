import { svgToDataUrl } from "./studio-characters";

import type { Studio2dScene } from "./studio-2d-asset-quality";

import { resolveAssetUrl } from "@/src/shared/catalog/catalog-static";

export function studio2dImageSource(scene: Studio2dScene): string {
  return resolveAssetUrl(scene.imgSrc || svgToDataUrl(scene.svg || ""));
}

/** Exact source identity, not just the catalog ID: a replacement must load again. */
export function studio2dSceneIdentity(scene: Studio2dScene): string {
  return JSON.stringify([scene.id, scene.imgSrc || null, scene.imgSrc ? null : scene.svg ?? null]);
}

/** Do not keep a removed/replaced original available through an already-open preview. */
export function currentStudio2dPreview(
  groups: readonly { readonly scenes: readonly Studio2dScene[] }[],
  selected: Studio2dScene | null,
): Studio2dScene | null {
  if (!selected) return null;
  const identity = studio2dSceneIdentity(selected);
  for (const group of groups) {
    for (const scene of group.scenes) {
      if (scene.id === selected.id && studio2dSceneIdentity(scene) === identity) return scene;
    }
  }
  return null;
}
