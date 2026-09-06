import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  readStudioCuttoonEditorSource,
} from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("/studio asset-library V12 authority boundary", () => {
  it("routes every no-argument product API to shared SQLite plus OPFS CAS", () => {
    const model = source("./studio-asset-library.ts");
    const repository = source("./studio-asset-library-sqlite-opfs-repository.ts");

    expect(model).toContain('import("./studio-asset-library-sqlite-opfs-repository")');
    expect(model).toContain("getProductStudioAssetLibraryRepository");
    expect(model).toContain("createLegacyIndexedDbStudioAssetLibrary");
    expect(model).toContain("Product boot and the exported no-argument functions below never");
    expect(repository).toContain("acquireStudioLocalDatabase");
    expect(repository).toContain("createStudioOpfsAssetStore");
    expect(repository).toContain('"studio-asset-library-v12"');
    expect(repository).toContain('"toonspectrum-studio-assets"');
    expect(repository).not.toContain("localStorage");
    expect(repository).not.toContain("indexedDB");
  });

  it("wires the live Studio page through queued mutations and fenced hydration", () => {
    // 의도적 변경(2026-08-21, B-15): 에셋 보관함 CRUD 는
    // studio-cuttoon-editor/studio-asset-library-mutations.ts 로 추출됐다. 세대 ref 선언과 CRUD
    // 호출부는 StudioPage 에 남고 본문만 이동했으므로, 편집기 표면 전체를 합친 소스를 스캔한다.
    const page = readStudioCuttoonEditorSource();

    expect(page).toContain("assetHydrationGenerationRef");
    expect(page).toContain("assetMutationTailRef");
    expect(page).toContain("saveStudioAssetMutation");
    expect(page).toContain("deleteStudioAssetMutation");
    expect(page).toContain("renameStudioAssetMutation");
    expect(page).toContain("SQLite/OPFS 에셋 보관함을 열지 못해 현재 탭 메모리만 사용합니다");
    expect(page).toContain("손상된 manifest나 누락된 blob을 일부만 불러오지 않았습니다");
    expect(page).not.toContain('const { saveAsset } = await import("./studio-asset-library");\n      await saveAsset({ name: file.name');
  });

  it("keeps binary payloads out of SQLite and commits the canonical manifest last", () => {
    const repository = source("./studio-asset-library-sqlite-opfs-repository.ts");

    expect(repository).toContain("await store.put(decoded.bytes");
    expect(repository).toContain("await verifiedBytes(store, entry)");
    expect(repository).toContain("protectedHashes");
    expect(repository).toContain("await database.kvSet(");
    expect(repository).toContain("Manifest is now authoritative");
    expect(repository).toContain("serializeStudioAssetManifest(next.entries)");
    expect(repository).toContain("byteSize: decoded.bytes.byteLength");
  });
});
