import { describe, expect, it } from "vitest";

import {
  listBrushes,
  saveBrushBatchWithResult,
} from "./brush/studio-brush-library";
import {
  STUDIO_CREATOR_PACK_CATALOG,
  type StudioCreatorPackDefinition,
} from "./studio-creator-pack-catalog";
import {
  inspectStudioCreatorPackInstallState,
  installStudioCreatorPack,
  listStudioCreatorFilterPresets,
  materializeStudioCreatorFilterPresetPatch,
  resolveStudioCreatorBundledCatalogTarget,
  STUDIO_CREATOR_FILTER_PRESET_LIBRARY_KEY,
  uninstallStudioCreatorPack,
  validateStudioCreatorPack,
  type StudioCreatorPackStorage,
} from "./studio-creator-pack-runtime";
import {
  STUDIO_MARKETPLACE_LIBRARY_STORAGE_KEY,
  loadStudioMarketplaceLibrary,
} from "./studio-marketplace-packages";
import {
  listPalettes,
  savePalette,
} from "./studio-palette-library";

function storage(): StudioCreatorPackStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe("Studio Creator Pack runtime", () => {
  it("strictly validates every bundled definition against the shared envelope", () => {
    for (const pack of STUDIO_CREATOR_PACK_CATALOG) {
      expect(validateStudioCreatorPack(pack)).toMatchObject({
        valid: true,
        issues: [],
      });
    }
  });

  it("rejects unknown portable fields and remote URLs", () => {
    const source = STUDIO_CREATOR_PACK_CATALOG.find(
      (pack) => pack.metadata.kind === "palette",
    )!;
    const invalid = {
      ...source,
      entries: [{
        ...source.entries[0],
        delivery: {
          mode: "portable-json" as const,
          definition: {
            colors: ["#112233"],
            remoteUrl: "https://example.com/palette.json",
          },
        },
      }],
      runtimeDescriptor: {
        ...source.runtimeDescriptor,
        budget: { entries: 1 },
      },
    } as unknown as StudioCreatorPackDefinition;
    const result = validateStudioCreatorPack(invalid);
    expect(result.valid).toBe(false);
    expect(result.issues.join(" ")).toMatch(/필드|URL|원격/u);
  });

  it("rejects a single portable entry above the shared 16 KiB contract", () => {
    const source = STUDIO_CREATOR_PACK_CATALOG.find(
      (pack) => pack.metadata.kind === "palette",
    )!;
    const invalid = {
      ...source,
      entries: [{
        ...source.entries[0],
        delivery: {
          mode: "portable-json" as const,
          definition: {
            colors: ["#112233"],
            padding: Array.from({ length: 200 }, () => "x".repeat(100)),
          },
        },
      }],
      runtimeDescriptor: {
        ...source.runtimeDescriptor,
        budget: { entries: 1 },
      },
    } as unknown as StudioCreatorPackDefinition;
    const result = validateStudioCreatorPack(invalid);
    expect(result.valid).toBe(false);
    expect(result.issues.join(" ")).toMatch(/크기|초과/u);
  });

  it("installs brush, palette and filter payloads into their real local libraries", () => {
    const target = storage();
    for (const kind of ["brush", "palette", "filter"] as const) {
      const pack = STUDIO_CREATOR_PACK_CATALOG.find(
        (candidate) => candidate.metadata.kind === kind,
      )!;
      expect(installStudioCreatorPack(pack, target, 1_000).status).toBe("installed");
      expect(inspectStudioCreatorPackInstallState(pack, target)).toBe("installed");
    }
    expect(listBrushes(target)).toHaveLength(3);
    expect(listPalettes(target)).toHaveLength(3);
    expect(listStudioCreatorFilterPresets(target)).toHaveLength(3);
  });

  it("uninstalls only deterministic pack entries and preserves user-created resources", () => {
    const target = storage();
    const portablePacks = STUDIO_CREATOR_PACK_CATALOG.filter(
      (pack) => pack.metadata.kind === "brush"
        || pack.metadata.kind === "palette"
        || pack.metadata.kind === "filter",
    );
    for (const pack of portablePacks) {
      expect(installStudioCreatorPack(pack, target, 1_000).status).toBe("installed");
    }

    const installedBrush = listBrushes(target)[0]!;
    expect(saveBrushBatchWithResult(target, [{
      ...installedBrush,
      id: "user-brush",
      name: "사용자 브러시",
    }]).status).toBe("saved");
    const installedPalette = listPalettes(target)[0]!;
    savePalette(target, {
      ...installedPalette,
      id: "user-palette",
      name: "사용자 팔레트",
    });
    const installedFilters = listStudioCreatorFilterPresets(target);
    target.setItem(STUDIO_CREATOR_FILTER_PRESET_LIBRARY_KEY, JSON.stringify([
      ...installedFilters,
      {
        ...installedFilters[0],
        id: "user-filter",
        packageId: "user",
        entryId: "user-filter",
        name: "사용자 필터",
      },
    ]));

    for (const pack of portablePacks) {
      expect(uninstallStudioCreatorPack(pack, target).status).toBe("uninstalled");
      expect(inspectStudioCreatorPackInstallState(pack, target)).toBe("available");
    }
    expect(listBrushes(target).map((brush) => brush.id)).toEqual(["user-brush"]);
    expect(listPalettes(target).map((palette) => palette.id)).toEqual(["user-palette"]);
    expect(listStudioCreatorFilterPresets(target).map((preset) => preset.id))
      .toEqual(["user-filter"]);
    expect(loadStudioMarketplaceLibrary(target).packages).toEqual([]);
  });

  it("rolls back uninstall when a local storage write fails", () => {
    const values = new Map<string, string>();
    let failFilterWrite = false;
    const target: StudioCreatorPackStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        if (failFilterWrite && key === STUDIO_CREATOR_FILTER_PRESET_LIBRARY_KEY) {
          failFilterWrite = false;
          throw new Error("quota");
        }
        values.set(key, value);
      },
      removeItem: (key) => {
        values.delete(key);
      },
    };
    const pack = STUDIO_CREATOR_PACK_CATALOG.find(
      (candidate) => candidate.metadata.kind === "filter",
    )!;
    expect(installStudioCreatorPack(pack, target, 1_000).status).toBe("installed");
    failFilterWrite = true;

    expect(uninstallStudioCreatorPack(pack, target).status).toBe("storage-error");
    expect(inspectStudioCreatorPackInstallState(pack, target)).toBe("installed");
    expect(listStudioCreatorFilterPresets(target)).toHaveLength(3);
  });

  it("blocks same-version marker conflicts before mutating runtime libraries", () => {
    const target = storage();
    const pack = STUDIO_CREATOR_PACK_CATALOG.find(
      (candidate) => candidate.metadata.kind === "brush",
    )!;
    target.setItem(STUDIO_MARKETPLACE_LIBRARY_STORAGE_KEY, JSON.stringify({
      version: 1,
      packages: [{
        packageId: pack.metadata.id,
        version: pack.metadata.version,
        packageFingerprint: "sha256:other-content",
        addedAt: "2026-07-26T00:00:00.000Z",
      }],
    }));

    expect(installStudioCreatorPack(pack, target).status).toBe("conflict");
    expect(listBrushes(target)).toEqual([]);
  });

  it("fails closed when transactional storage capture throws", () => {
    const pack = STUDIO_CREATOR_PACK_CATALOG.find(
      (candidate) => candidate.metadata.kind === "brush",
    )!;
    const target: StudioCreatorPackStorage = {
      getItem: () => {
        throw new Error("privacy mode");
      },
      setItem: () => {
        throw new Error("must not write");
      },
      removeItem: () => {
        throw new Error("must not remove");
      },
    };
    expect(installStudioCreatorPack(pack, target).status).toBe("storage-error");

    const installed = storage();
    expect(installStudioCreatorPack(pack, installed, 1_000).status).toBe("installed");
    let reads = 0;
    const throwsDuringUninstallCapture: StudioCreatorPackStorage = {
      getItem: (key) => {
        reads += 1;
        if (reads > 2) throw new Error("privacy mode");
        return installed.getItem(key);
      },
      setItem: (key, value) => installed.setItem(key, value),
      removeItem: (key) => installed.removeItem(key),
    };
    expect(uninstallStudioCreatorPack(pack, throwsDuringUninstallCapture).status)
      .toBe("storage-error");
    expect(inspectStudioCreatorPackInstallState(pack, installed)).toBe("installed");
  });

  it("materializes installed filter values through the existing non-destructive patch runtime", () => {
    const target = storage();
    const pack = STUDIO_CREATOR_PACK_CATALOG.find(
      (candidate) => candidate.metadata.kind === "filter",
    )!;
    installStudioCreatorPack(pack, target, 1_000);
    const preset = listStudioCreatorFilterPresets(target)[0]!;
    expect(materializeStudioCreatorFilterPresetPatch(preset.id, target)).not.toBeNull();
  });

  it("keeps template and 3D references bundled and fail-closed", () => {
    for (const kind of ["template", "3d-preset"] as const) {
      const pack = STUDIO_CREATOR_PACK_CATALOG.find(
        (candidate) => candidate.metadata.kind === kind,
      )!;
      expect(inspectStudioCreatorPackInstallState(pack, storage())).toBe("bundled");
      expect(installStudioCreatorPack(pack, storage()).status).toBe("bundled");
    }
    const source = STUDIO_CREATOR_PACK_CATALOG.find(
      (candidate) => candidate.metadata.kind === "3d-preset",
    )!;
    const invalid = {
      ...source,
      entries: [{
        ...source.entries[0],
        delivery: {
          mode: "builtin-ref" as const,
          runtimeRef: "unknown-bg3d-pack",
        },
      }],
    } as unknown as StudioCreatorPackDefinition;
    expect(validateStudioCreatorPack(invalid).valid).toBe(false);
  });

  it("resolves only allowlisted single builtin references into catalog targets", () => {
    const templatePack = STUDIO_CREATOR_PACK_CATALOG.find(
      (candidate) => candidate.metadata.kind === "template",
    )!;
    const templateEntry = templatePack.entries[0]!;
    const singleTemplatePack = {
      ...templatePack,
      entries: [templateEntry],
      runtimeDescriptor: {
        ...templatePack.runtimeDescriptor,
        budget: {
          ...templatePack.runtimeDescriptor.budget,
          entries: 1,
        },
      },
    } satisfies StudioCreatorPackDefinition;
    expect(resolveStudioCreatorBundledCatalogTarget(singleTemplatePack)).toEqual({
      status: "supported",
      target: {
        kind: "scene-template-catalog",
        templateId: "confession",
      },
    });

    const bg3dPack = STUDIO_CREATOR_PACK_CATALOG.find(
      (candidate) => candidate.metadata.kind === "3d-preset",
    )!;
    expect(resolveStudioCreatorBundledCatalogTarget(bg3dPack)).toMatchObject({
      status: "supported",
      target: {
        kind: "bg3d-procedural-catalog",
        runtimeRef: "toonspectrum-bg3d-procedural-starter-v1",
      },
    });
  });

  it("rejects unknown and multi-entry builtin references before opening UI", () => {
    const templatePack = STUDIO_CREATOR_PACK_CATALOG.find(
      (candidate) => candidate.metadata.kind === "template",
    )!;
    expect(resolveStudioCreatorBundledCatalogTarget(templatePack)).toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("하나"),
    });

    const singleEntry = templatePack.entries[0]!;
    const unknown = {
      ...templatePack,
      entries: [{
        ...singleEntry,
        delivery: {
          mode: "builtin-ref" as const,
          runtimeRef: "studio-scene-template:not-allowlisted",
        },
      }],
      runtimeDescriptor: {
        ...templatePack.runtimeDescriptor,
        budget: {
          ...templatePack.runtimeDescriptor.budget,
          entries: 1,
        },
      },
    } as StudioCreatorPackDefinition;
    expect(resolveStudioCreatorBundledCatalogTarget(unknown)).toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("알 수 없는 내장 장면 템플릿 참조"),
    });

    const bg3dPack = STUDIO_CREATOR_PACK_CATALOG.find(
      (candidate) => candidate.metadata.kind === "3d-preset",
    )!;
    const unknownBg3d = {
      ...bg3dPack,
      entries: [{
        ...bg3dPack.entries[0]!,
        delivery: {
          mode: "builtin-ref" as const,
          runtimeRef: "unknown-bg3d-pack",
        },
      }],
    } as StudioCreatorPackDefinition;
    expect(resolveStudioCreatorBundledCatalogTarget(unknownBg3d)).toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("알 수 없는 내장 3D 팩 참조"),
    });

    const brushPack = STUDIO_CREATOR_PACK_CATALOG.find(
      (candidate) => candidate.metadata.kind === "brush",
    )!;
    const singlePortablePack = {
      ...brushPack,
      entries: [brushPack.entries[0]!],
      runtimeDescriptor: {
        ...brushPack.runtimeDescriptor,
        budget: {
          ...brushPack.runtimeDescriptor.budget,
          entries: 1,
        },
      },
    } satisfies StudioCreatorPackDefinition;
    expect(resolveStudioCreatorBundledCatalogTarget(singlePortablePack)).toMatchObject({
      status: "unsupported",
      reason: expect.stringContaining("내장 카탈로그 참조가 아닙니다"),
    });
  });
});
