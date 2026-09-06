import { describe, expect, it } from "vitest";

import { readStudioBg3dEditorSource } from "../bg3d/read-studio-bg3d-editor-source";
import ltPanelSource from "../bg3d/StudioBg3dLtPanel.tsx?raw";

import repositorySource from "./studio-mannequin-bg3d-preset-sqlite-repository.ts?raw";
import mannequinSource from "./StudioMannequinPoserPanel.tsx?raw";

const bg3dSource = readStudioBg3dEditorSource();

describe("mannequin and BG3D LT V12 product persistence boundary", () => {
  it("routes both default product paths to the shared SQLite runtime", () => {
    expect(repositorySource).toContain("acquireStudioLocalDatabase");
    expect(repositorySource).toContain("studio-mannequin-state-v12");
    expect(repositorySource).toContain("studio-bg3d-lt-user-presets-v12");
    expect(mannequinSource).toContain("getProductStudioMannequinStateSqliteRepository");
    expect(bg3dSource).toContain("getProductStudioBg3dLtPresetSqliteRepository");
    expect(mannequinSource).not.toContain("localStorage");
    expect(bg3dSource).not.toContain("getBrowserLtPresetStorage");
    expect(bg3dSource).not.toContain("loadStudioBg3dLtUserPresetsFromStorage");
    expect(bg3dSource).not.toContain("saveStudioBg3dLtUserPresetsToStorage");
    expect(bg3dSource).not.toContain("window.localStorage");
  });

  it("keeps async ordering, generation fencing, and memory-only failures visible", () => {
    expect(mannequinSource).toContain("hydrationGenerationRef");
    expect(mannequinSource).toContain("persistenceGenerationRef");
    expect(mannequinSource).toContain("현재 탭 메모리 임시 · 새로고침 시 사라짐");
    expect(bg3dSource).toContain("ltUserPresetHydrationGenerationRef");
    expect(bg3dSource).toContain("ltUserPresetMutationGenerationRef");
    expect(bg3dSource).toContain("ltUserPresetRepository.save(result.payload)");
    expect(bg3dSource).toContain("현재 탭 메모리 임시 · 새로고침 시 사라짐");
    expect(ltPanelSource).toContain("현재 탭 메모리 임시");
  });

  it("preserves explicit JSON export/import while legacy keys stay outside product boot", () => {
    expect(mannequinSource).toContain("handleExportJson");
    expect(mannequinSource).toContain("handleImportJson");
    expect(mannequinSource).toContain("JSON 내보내기");
    expect(mannequinSource).not.toContain("STUDIO_MANNEQUIN_STATE_STORAGE_KEY");
    expect(bg3dSource).not.toContain("studio-bg3d-lt-preset-storage");
  });
});
