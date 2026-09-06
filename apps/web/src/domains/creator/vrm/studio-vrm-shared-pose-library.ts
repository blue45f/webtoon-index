import type { SharedAssetCatalogItem } from "../../../infrastructure/creator-client";

export interface SharedPoseLibraryGate {
  editorOpen: boolean;
  posePanelActive: boolean;
  libraryExpanded: boolean;
}

/**
 * The shared library is optional remote content. Do not make opening the local
 * VRM editor depend on API availability; fetch only after the author explicitly
 * opens the library while the pose panel is active.
 */
export function shouldLoadSharedPoseLibrary(gate: SharedPoseLibraryGate): boolean {
  return gate.editorOpen && gate.posePanelActive && gate.libraryExpanded;
}

export function selectSharedPoseAssets(assets: readonly SharedAssetCatalogItem[]): SharedAssetCatalogItem[] {
  return assets.filter((asset) => asset.kind === "vrm_pose" || asset.name.startsWith("[3D_POSE]"));
}
