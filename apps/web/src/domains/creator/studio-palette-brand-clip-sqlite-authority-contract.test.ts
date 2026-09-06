import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("palette, Brand Kit and clip product SQLite authority", () => {
  it("routes both product panels to V12 repositories with no legacy boot read", () => {
    const palettePanel = source("./StudioPaletteLibraryPanel.tsx");
    const brandPanel = source("./StudioBrandKitPanel.tsx");

    expect(palettePanel).toContain("getProductStudioPaletteSqliteRepository");
    expect(palettePanel).not.toContain("globalThis.localStorage");
    expect(palettePanel).not.toContain("listPalettes(");
    expect(palettePanel).not.toContain("savePalette(");
    expect(brandPanel).toContain("getProductStudioBrandKitSqliteRepository");
    expect(brandPanel).toContain("getProductStudioPaletteSqliteRepository");
    expect(brandPanel).not.toContain("globalThis.localStorage");
    expect(brandPanel).not.toContain("listBrandKits(");
    expect(brandPanel).not.toContain("listPalettes(");
  });

  it("routes StudioPage AI palette and clip list/save/delete to queued repositories", () => {
    const page = source("./StudioCuttoonEditorHost.tsx");

    expect(page).toMatch(/import\(\s*["']\.\/studio-palette-sqlite-repository["']\s*\)/u);
    expect(page).toMatch(/import\(\s*["']\.\/studio-saved-clip-sqlite-repository["']\s*\)/u);
    expect(page).toContain("clipMutationTailRef.current.then(run, run)");
    expect(page).toContain("repository.list()");
    expect(page).toContain("repository.save(clip)");
    expect(page).toContain("repository.delete(id)");
    expect(page).not.toContain("savePalette(globalThis.localStorage");
    expect(page).not.toContain("listClips(globalThis.localStorage");
    expect(page).not.toContain("saveClip(globalThis.localStorage");
    expect(page).not.toContain("removeClip(globalThis.localStorage");
  });

  it("pins three separate V12 KV namespaces to the shared database handle", () => {
    const palette = source("./studio-palette-sqlite-repository.ts");
    const brand = source("./studio-brand-kit-sqlite-repository.ts");
    const clip = source("./studio-saved-clip-sqlite-repository.ts");

    expect(palette).toContain('"studio-named-palettes-v12"');
    expect(brand).toContain('"studio-brand-kits-v12"');
    expect(clip).toContain('"studio-saved-clips-v12"');
    for (const repository of [palette, brand, clip]) {
      expect(repository).toContain("acquireStudioLocalDatabase");
      expect(repository).toContain("mutationTail.then(work, work)");
      expect(repository).not.toContain("localStorage");
      expect(repository).not.toContain("indexedDB");
    }
  });

  it("keeps durable failure, memory-only state and stale-generation rejection visible", () => {
    const palettePanel = source("./StudioPaletteLibraryPanel.tsx");
    const brandPanel = source("./StudioBrandKitPanel.tsx");
    const page = source("./StudioCuttoonEditorHost.tsx");

    expect(palettePanel).toContain("data-studio-palette-authority");
    expect(palettePanel).toContain("현재 탭 메모리 임시");
    expect(palettePanel).toContain("loadGenerationRef");
    expect(palettePanel).toContain("mutationGenerationRef");
    expect(brandPanel).toContain("data-studio-brand-kit-authority");
    expect(brandPanel).toContain("현재 탭 메모리 임시");
    expect(brandPanel).toContain("paletteLoadGenerationRef");
    expect(page).toContain("clipHydrationGenerationRef");
    expect(page).toContain("clipMutationGenerationRef");
    expect(page).toContain("클립 변경을 현재 탭 메모리에만 유지합니다");
    expect(page).toContain("제안은 현재 탭 메모리에만 남고 라이브러리에는 저장되지 않았습니다");
  });
});
