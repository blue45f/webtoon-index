/** Product workspace transaction for editable Room/Set presets. */

import { STUDIO_HYBRID_DCC_ASSET_LAYOUT_LIMITS } from "./studio-hybrid-dcc-asset-layout";
import { hybridDccRegisterAssets } from "./studio-hybrid-dcc-document";
import {
  buildStudioHybridDccRoomPresetAuthority,
} from "./studio-hybrid-dcc-room-authority";
import {
  synchronizeWorkspaceGeometryAuthority,
  type StudioHybridDccWorkspace,
} from "./studio-hybrid-dcc-workspace";

function nextRoomInstanceId(workspace: StudioHybridDccWorkspace, presetId: string): string {
  const occupied = new Set(Object.keys(workspace.session.state.geometry.records));
  for (let suffix = 1; suffix <= 1_000; suffix += 1) {
    const instanceId = suffix === 1 ? presetId : `${presetId}-${suffix}`;
    const prefix = `room-${instanceId}-part-`;
    if (![...occupied].some((assetId) => assetId.startsWith(prefix))) return instanceId;
  }
  throw new Error("방 인스턴스 수가 너무 많습니다. 기존 방을 정리해 주세요.");
}

export function workspaceLoadEditableRoomPreset(
  workspace: StudioHybridDccWorkspace,
  presetId = "classroom",
): StudioHybridDccWorkspace {
  const build = buildStudioHybridDccRoomPresetAuthority(
    presetId,
    nextRoomInstanceId(workspace, presetId),
  );
  const existingAssetCount = Object.keys(workspace.session.state.geometry.records).length;
  if (existingAssetCount + build.assets.length
    > STUDIO_HYBRID_DCC_ASSET_LAYOUT_LIMITS.maxAssets) {
    throw new Error(
      `현재 ${existingAssetCount}개 오브젝트에 방 파츠 ${build.assets.length}개를 더하면 `
      + `${STUDIO_HYBRID_DCC_ASSET_LAYOUT_LIMITS.maxAssets}개 안전 한도를 넘습니다.`,
    );
  }
  const session = hybridDccRegisterAssets(
    workspace.session,
    build.assets.map((asset) => ({
      assetId: asset.assetId,
      mesh: asset.mesh,
      rights: asset.rights,
      initialTransform: asset.transform,
    })),
  );
  return {
    ...synchronizeWorkspaceGeometryAuthority(workspace, session),
    activeAssetId: build.assets[0]?.assetId ?? null,
  };
}
