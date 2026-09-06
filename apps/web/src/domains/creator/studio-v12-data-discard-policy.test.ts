import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("V12 in-place cutover data-discard policy", () => {
  it("opens a V12-only SQLite file instead of the pre-V12 database", () => {
    const database = source("./studio-local-database.ts");
    expect(database).toContain(
      'STUDIO_SQLITE_DATABASE_FILENAME = "studio-local-v12.db"',
    );
    expect(database).not.toContain(
      'STUDIO_SQLITE_DATABASE_FILENAME = "studio-local.db"',
    );
  });

  it("keeps browser fallback authorities in V12-only namespaces", () => {
    expect(source("./studio-autosave.ts")).toContain(
      'STUDIO_AUTOSAVE_PREFIX = "toonspectrum-studio-autosave:v12"',
    );
    expect(source("./studio-checkpoints.ts")).toContain(
      'STUDIO_CHECKPOINT_PREFIX = "toonspectrum-studio-checkpoints:v12"',
    );
    expect(source("./studio-checkpoints.ts")).toContain(
      'STUDIO_CHECKPOINT_SQLITE_NAMESPACE = "studio-named-checkpoints-v12"',
    );
    expect(source("./studio-workspaces.ts")).toContain(
      'STUDIO_WORKSPACE_STORAGE_KEY = "toonspectrum:studio:workspaces-v12"',
    );
    expect(source("./studio-renderer-tournament-runtime.ts")).toContain(
      '"toonspectrum-studio-v12-tournament-winners-v1"',
    );
    expect(source("./brush/studio-brush-library-sqlite-repository.ts")).toContain(
      '"toonspectrum-studio-v12-brush-library-fallback"',
    );
    expect(source("./filter/studio-filter-library-sqlite-repository.ts")).toContain(
      '"toonspectrum.studio-filter-library.v12.fallback"',
    );
    expect(source("./studio-animatic-timeline.ts")).toContain(
      '"toonspectrum-studio-animatic:v12"',
    );
    expect(source("./studio-animatic-sqlite-persistence.ts")).toContain(
      'STUDIO_ANIMATIC_SQLITE_NAMESPACE = "studio-animatic-v12"',
    );
    expect(source("./studio-community-pack-legacy-migration.ts")).toContain(
      'export const STUDIO_CREATOR_PACK_SQLITE_NAMESPACE = "studio-creator-pack-v12"',
    );
    expect(source("./studio-creator-pack-product-runtime.ts")).toContain(
      'export { STUDIO_CREATOR_PACK_SQLITE_NAMESPACE } from "./studio-community-pack-legacy-migration"',
    );
    expect(source("./studio-translation-memory-sqlite-persistence.ts")).toContain(
      '"studio-translation-memory-v12"',
    );
    expect(source("./studio-production-bible-sqlite-persistence.ts")).toContain(
      '"studio-production-bible-v12"',
    );
    expect(source("./studio-emeres-sqlite-repository.ts")).toContain(
      'STUDIO_EMERES_SQLITE_NAMESPACE = "studio-emeres-library-v12"',
    );
    expect(source("./studio-scene-snapshot-sqlite-repository.ts")).toContain(
      'STUDIO_SCENE_SNAPSHOT_SQLITE_NAMESPACE = "studio-scene-snapshots-v12"',
    );
    expect(source("./vrm/studio-vrm-creative-sqlite-repository.ts")).toContain(
      'STUDIO_VRM_CUSTOM_POSE_SQLITE_NAMESPACE = "studio-vrm-custom-poses-v12"',
    );
    expect(source("./vrm/studio-vrm-creative-sqlite-repository.ts")).toContain(
      'STUDIO_VRM_FULL_STATE_SQLITE_NAMESPACE = "studio-vrm-full-poser-states-v12"',
    );
    expect(source("./vrm/studio-vrm-pose-material-sqlite-repository.ts")).toContain(
      '"studio-vrm-pose-materials-v12"',
    );
    expect(source("./studio-palette-sqlite-repository.ts")).toContain(
      'STUDIO_PALETTE_SQLITE_NAMESPACE = "studio-named-palettes-v12"',
    );
    expect(source("./studio-brand-kit-sqlite-repository.ts")).toContain(
      'STUDIO_BRAND_KIT_SQLITE_NAMESPACE = "studio-brand-kits-v12"',
    );
    expect(source("./studio-saved-clip-sqlite-repository.ts")).toContain(
      'STUDIO_SAVED_CLIP_SQLITE_NAMESPACE = "studio-saved-clips-v12"',
    );
    expect(source("./bg3d/studio-bg3d-shot-batch-recovery-store.ts")).toContain(
      '"studio-bg3d-shot-batch-recovery-v12"',
    );
    expect(source("./live/studio-crdt-recovery-vault.ts")).toContain(
      "requireStudioCrdtRecoveryDatabase",
    );
    expect(source("./scene-3d/studio-mannequin-bg3d-preset-sqlite-repository.ts")).toContain(
      '"studio-mannequin-state-v12"',
    );
    expect(source("./scene-3d/studio-mannequin-bg3d-preset-sqlite-repository.ts")).toContain(
      '"studio-bg3d-lt-user-presets-v12"',
    );
    expect(source("./studio-marketplace-library-sqlite-repository.ts")).toContain(
      '"studio-marketplace-package-library-v12"',
    );
    expect(source("./studio-asset-library-sqlite-opfs-repository.ts")).toContain(
      'STUDIO_ASSET_LIBRARY_SQLITE_NAMESPACE = "studio-asset-library-v12"',
    );
    expect(source("./vrm/studio-vrm-asset-sqlite-opfs-repository.ts")).toContain(
      'STUDIO_VRM_MODEL_SQLITE_NAMESPACE = "studio-vrm-model-assets-v12"',
    );
    expect(source("./vrm/studio-vrm-asset-sqlite-opfs-repository.ts")).toContain(
      'STUDIO_VRM_TEXTURE_SQLITE_NAMESPACE = "studio-vrm-texture-paint-assets-v12"',
    );
    expect(source("./bg3d/studio-bg3d-libraries-sqlite-opfs-authority.ts")).toContain(
      '"studio-bg3d-libraries-v12"',
    );
  });

  it("requires explicit developer policy before any legacy import helper runs", () => {
    const brush = source("./brush/studio-brush-library-sqlite-repository.ts");
    const workspace = source("./studio-workspaces.ts");
    const page = source("./StudioCuttoonEditorHost.tsx");
    const filter = source("./filter/studio-filter-library-sqlite-repository.ts");
    expect(brush).toContain('options.legacyDataPolicy === "import-explicit"');
    expect(workspace).toContain(
      'options.legacyDataPolicy !== "import-explicit"',
    );
    expect(page).toContain("allowLegacy: false");
    expect(page).not.toContain("allowLegacy: !workId && !remixId");
    expect(filter).toContain(
      'STUDIO_FILTER_LIBRARY_DATA_POLICY = "discard-existing-studio-data"',
    );
    const animaticPanel = source("./StudioAnimaticTimelinePanel.tsx");
    expect(animaticPanel).toContain("createStudioAnimaticSqlitePersistence()");
    expect(animaticPanel).not.toContain("studioAnimaticBrowserStorage()");
    const creatorPacks = source("./studio-creator-pack-product-runtime.ts");
    const productAuthorityGuards = creatorPacks.match(
      /pack\.metadata\.kind !== "filter"\s*&&\s*pack\.metadata\.kind !== "brush"\s*&&\s*pack\.metadata\.kind !== "palette"/gu,
    ) ?? [];
    expect(productAuthorityGuards).toHaveLength(3);
    expect(creatorPacks).toContain("openProductBrushLibraryRepository");
    expect(creatorPacks).toContain("getProductStudioPaletteSqliteRepository");
    const translationMemoryPanel = source("./StudioDialogueTranslationMemoryPanel.tsx");
    expect(translationMemoryPanel).toContain(
      "createStudioTranslationMemorySqlitePersistence",
    );
    expect(translationMemoryPanel).not.toContain(
      "studioTranslationMemoryBrowserStorage",
    );
    const productionBibleWorkspace = source("./StudioProductionBibleWorkspace.tsx");
    expect(productionBibleWorkspace).toContain(
      "createStudioProductionBibleSqlitePersistence",
    );
    expect(productionBibleWorkspace).not.toContain(
      "studioProductionBibleBrowserStorage",
    );
    const emeresPanel = source("./StudioEmeresLibraryPanel.tsx");
    expect(emeresPanel).toContain(
      "getProductStudioEmeresSqliteRepository",
    );
    expect(emeresPanel).not.toContain("globalThis.localStorage");
    const sceneSnapshotPanel = source("./StudioSceneSnapshotPanel.tsx");
    expect(sceneSnapshotPanel).toContain(
      "getProductStudioSceneSnapshotSqliteRepository",
    );
    expect(sceneSnapshotPanel).not.toContain(
      "studioSceneSnapshotIndexedDbLibrary",
    );
    const vrmPoser = source("./vrm/useStudioVrmPoserState.ts");
    expect(vrmPoser).toContain("createStudioVrmCreativeSqliteRepository");
    expect(vrmPoser).not.toContain('localStorage.getItem("studio_vrm_full_states")');
    const vrmPoseMaterials = source("./vrm/StudioVrmPoseMaterialPanel.tsx");
    expect(vrmPoseMaterials).toContain(
      "createStudioVrmPoseMaterialSqliteRepository",
    );
    expect(vrmPoseMaterials).not.toContain("window.localStorage");
    const palettePanel = source("./StudioPaletteLibraryPanel.tsx");
    expect(palettePanel).toContain("getProductStudioPaletteSqliteRepository");
    const brandKitPanel = source("./StudioBrandKitPanel.tsx");
    expect(brandKitPanel).toContain("getProductStudioBrandKitSqliteRepository");
    const studioPage = source("./StudioCuttoonEditorHost.tsx");
    expect(studioPage).toContain("getProductStudioSavedClipSqliteRepository");
    const crdtOutbox = source("./live/studio-crdt-outbox.ts");
    expect(crdtOutbox).toContain("acquireStudioLocalDatabase");
    expect(crdtOutbox).toContain("LegacyIndexedDbStudioCrdtOutbox");
    const crdtRecoveryVault = source("./live/studio-crdt-recovery-vault.ts");
    expect(crdtRecoveryVault).toContain(
      "createStudioCrdtRecoverySqlitePersistence()",
    );
    expect(crdtRecoveryVault).toContain(
      "new SamePageStudioCrdtRejectionMarkerLatch()",
    );
    expect(crdtRecoveryVault).not.toContain("localStorage");
    expect(crdtRecoveryVault).not.toContain("indexedDB");
    const shotRecovery = source("./bg3d/studio-bg3d-shot-batch-recovery-store.ts");
    expect(shotRecovery).toContain("SqliteOpfsStudioBg3dShotBatchRecoveryStore");
    expect(shotRecovery).toContain(
      'Object.prototype.hasOwnProperty.call(options, "indexedDB")',
    );
    const checkpointsController = source("./checkpoint/studio-checkpoints-controller.ts");
    expect(checkpointsController).toContain(
      "listDurableStudioCheckpoints(undefined, checkpointKey)",
    );
    expect(checkpointsController).toContain(
      "createDurableStudioCheckpoint(undefined, checkpointKey",
    );
    expect(checkpointsController).toContain(
      "deleteDurableStudioCheckpoint(undefined, checkpointKey",
    );
    expect(checkpointsController).not.toContain(
      "listDurableStudioCheckpoints(globalThis.localStorage, checkpointKey)",
    );
    const helpCenter = source("./StudioHelpCenterDialog.tsx");
    expect(helpCenter).toContain("countDurableStudioCheckpoints");
    expect(helpCenter).not.toContain(
      "listDurableStudioCheckpoints(storage, key)",
    );
    const communityMarketplace = source("./StudioCommunityMarketplacePanel.tsx");
    expect(communityMarketplace).toContain("openProductBrushLibraryRepository");
    expect(communityMarketplace).toContain("getProductStudioPaletteSqliteRepository");
    expect(communityMarketplace).toContain(
      "listStudioCommunityShareCandidates({",
    );
    const communityProjection = source("./studio-community-marketplace.ts");
    expect(communityProjection).toContain("const brushes = input.brushes ?? []");
    expect(communityProjection).not.toContain(
      "input.brushes ?? listBrushes(browserBrushLibraryStorage())",
    );
    const mannequin = source("./scene-3d/StudioMannequinPoserPanel.tsx");
    expect(mannequin).toContain("getProductStudioMannequinStateSqliteRepository");
    expect(mannequin).not.toContain("localStorage.setItem(");
    const background3d = [
      source("./bg3d/StudioBackground3D.tsx"),
      source("./bg3d/useStudioBg3dEditorState.ts"),
    ].join("\n");
    expect(background3d).toContain("getProductStudioBg3dLtPresetSqliteRepository");
    expect(background3d).not.toContain("studio-bg3d-lt-preset-storage");
    const originalMarketplace = source("./StudioOriginalAssetMarketplacePanel.tsx");
    expect(originalMarketplace).toContain(
      "getProductStudioMarketplaceLibrarySqliteRepository",
    );
    expect(originalMarketplace).not.toContain("globalThis.localStorage");
    expect(originalMarketplace).not.toContain("saveStudioMarketplaceLibrary");
    const assetRepository = source("./studio-asset-library-sqlite-opfs-repository.ts");
    expect(assetRepository).toContain("acquireStudioLocalDatabase");
    expect(assetRepository).not.toContain("globalThis.indexedDB");
    const vrmAssetRepository = source("./vrm/studio-vrm-asset-sqlite-opfs-repository.ts");
    expect(vrmAssetRepository).toContain("acquireStudioLocalDatabase");
    expect(vrmAssetRepository).not.toContain("globalThis.indexedDB");
    const bg3dAuthority = source("./bg3d/studio-bg3d-libraries-sqlite-opfs-authority.ts");
    expect(bg3dAuthority).toContain("acquireStudioLocalDatabase");
    expect(bg3dAuthority).not.toContain("globalThis.indexedDB");
  });

  it("keeps destructive reset triple-gated and covers all Studio prefixes", () => {
    const destruction = source("./studio-data-destruction.ts");
    expect(destruction).toContain("REPLACE_CURRENT_TOONSTUDIO_IN_PLACE_V12");
    expect(destruction).toContain('"toonspectrum-studio-"');
    expect(destruction).toContain('RESET_EXISTING_STUDIO_DATA !== "YES"');
  });
});
