import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("remaining durable creative data uses the shared V12 SQLite authority", () => {
  it("routes the product scene snapshot panel to SQLite without probing legacy IndexedDB", () => {
    const panel = source("./StudioSceneSnapshotPanel.tsx");
    const repository = source("./studio-scene-snapshot-sqlite-repository.ts");

    expect(panel).toContain("getProductStudioSceneSnapshotSqliteRepository");
    expect(panel).not.toContain("listStudioSceneSnapshots");
    expect(panel).not.toContain("saveStudioSceneSnapshot");
    expect(panel).not.toContain("indexedDB");
    expect(repository).toContain("acquireStudioLocalDatabase");
    expect(repository).toContain('"studio-scene-snapshots-v12"');
    expect(repository).not.toContain("indexedDB");
    expect(repository).not.toContain("localStorage");
  });

  it("routes every shipped Emeres read and write to SQLite without a localStorage fallback", () => {
    const panel = source("./StudioEmeresLibraryPanel.tsx");
    const page = source("./StudioCuttoonEditorHost.tsx");
    const repository = source("./studio-emeres-sqlite-repository.ts");

    expect(panel).toContain("getProductStudioEmeresSqliteRepository");
    expect(panel).not.toContain("globalThis.localStorage");
    expect(panel).not.toContain("listEmeresLibraryItems");
    expect(page).toContain("getProductStudioEmeresSqliteRepository");
    expect(page).not.toContain("saveEmeresLibraryItem(globalThis.localStorage");
    expect(repository).toContain("acquireStudioLocalDatabase");
    expect(repository).toContain('"studio-emeres-library-v12"');
    expect(repository).not.toContain("localStorage");
    expect(repository).not.toContain("indexedDB");
  });

  it("keeps failure visible and memory-only state explicit in both product panels", () => {
    const scenePanel = source("./StudioSceneSnapshotPanel.tsx");
    const emeresPanel = source("./StudioEmeresLibraryPanel.tsx");

    expect(scenePanel).toContain("data-studio-scene-snapshot-authority");
    expect(scenePanel).toContain("저장되지 않았습니다");
    expect(emeresPanel).toContain("data-studio-emeres-authority");
    expect(emeresPanel).toContain("현재 탭 메모리 임시");
    expect(emeresPanel).toContain("memoryModeRef");
  });
});
