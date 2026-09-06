import { uid } from "../studio-id";

import type { El } from "../studio-element-model";

export function detachStudioBg3dLtCopy(element: El): El {
  if (element.type !== "image" || !element.bg3dLtBundleId) return element;
  return {
    ...element,
    groupId: undefined,
    bg3dScene: undefined,
    bg3dLtBundleId: undefined,
    bg3dLtRole: undefined,
    bg3dLtRenderMode: undefined,
    name: `${element.name?.trim() || "3D LT 레이어"} · 복사본`,
  };
}

export function remapStudioBg3dLtCopiedBundles(copies: El[], snapshotOnly: boolean): El[] {
  const anchorCounts = new Map<string, number>();
  for (const element of copies) {
    if (element.type !== "image" || !element.bg3dLtBundleId) continue;
    if (element.bg3dScene !== undefined) {
      anchorCounts.set(
        element.bg3dLtBundleId,
        (anchorCounts.get(element.bg3dLtBundleId) ?? 0) + 1,
      );
    }
  }
  const bundleIdMap = new Map<string, string>();
  return copies.map((element) => {
    if (element.type !== "image" || !element.bg3dLtBundleId) return element;
    if (
      snapshotOnly ||
      !element.groupId ||
      anchorCounts.get(element.bg3dLtBundleId) !== 1
    ) {
      return detachStudioBg3dLtCopy(element);
    }
    const sourceBundleId = element.bg3dLtBundleId;
    let bundleId = bundleIdMap.get(sourceBundleId);
    if (!bundleId) {
      bundleId = uid();
      bundleIdMap.set(sourceBundleId, bundleId);
    }
    return { ...element, bg3dLtBundleId: bundleId };
  });
}
