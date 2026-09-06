import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("/studio custom-font V12 product authority boundary", () => {
  it("mounts the once-dormant panel in the existing lazy typography inspector", () => {
    const inspector = source("./StudioInspectorTypographySection.tsx");
    const page = source("./StudioCuttoonEditorHost.tsx");
    const lazyRegistry = source("./studio-page-lazy-ui.ts");

    // The panel only renders for a selected text element, so it sits one boundary deeper than the
    // inspector itself: the inspector consumes it from the lazy registry instead of pulling the
    // font manager (and studio-custom-fonts) into every Studio launch.
    expect(lazyRegistry).toContain('import("./StudioCustomFontsPanel")');
    expect(inspector).toContain("StudioCustomFontsPanel,");
    expect(inspector).not.toContain('from "./StudioCustomFontsPanel"');
    expect(inspector).toContain("<StudioCustomFontsPanel");
    expect(inspector).toContain('sectionId="element.typography"');
    expect(inspector).toContain("patchEl(selected.id, { font }");
    expect(page).not.toContain("StudioCustomFontsPanel");
  });

  it("routes the uncontrolled shipped panel only to lazy SQLite/OPFS product authority", () => {
    const panel = source("./StudioCustomFontsPanel.tsx");

    expect(panel).toContain('import("./studio-custom-font-sqlite-opfs-repository")');
    expect(panel).toContain("getProductStudioCustomFontRepository");
    expect(panel).toContain("hydrationGenerationRef");
    expect(panel).toContain("mutationGenerationRef");
    expect(panel).toContain('data-studio-custom-font-authority={storageState}');
    expect(panel).toContain("현재 탭 메모리만 사용합니다");
    expect(panel).not.toContain("browserCustomFontStorage");
    expect(panel).not.toContain("listCustomFonts(");
    expect(panel).not.toContain("saveCustomFonts(");
    expect(panel).not.toContain("localStorage");
    expect(panel).not.toContain("indexedDB");
  });

  it("keeps canonical metadata in SQLite and verified original bytes in shared SHA CAS", () => {
    const repository = source("./studio-custom-font-sqlite-opfs-repository.ts");

    expect(repository).toContain("acquireStudioLocalDatabase");
    expect(repository).toContain("acquireProductStudioAssetCasStore");
    expect(repository).toContain('"studio-custom-font-library-v12"');
    expect(repository).toContain('store.get(entry.contentHash, { verify: true })');
    expect(repository).toContain("verifiedBytes: Uint8Array.from(bytes)");
    expect(repository).toContain("await store.setOwnerRefs(STUDIO_CUSTOM_FONT_CAS_OWNER, protectedHashes)");
    expect(repository).toContain("await database.kvSet(");
    expect(repository).toContain("Manifest is now authoritative");
    expect(repository).not.toContain("localStorage");
    expect(repository).not.toContain("indexedDB");
    expect(repository).not.toContain("base64");
  });

  it("retains old synchronous storage functions as explicit legacy seams, never product defaults", () => {
    const model = source("./studio-custom-fonts.ts");
    const repository = source("./studio-custom-font-sqlite-opfs-repository.ts");

    expect(model).toContain("legacy import/test seam");
    expect(model).toContain("export function browserCustomFontStorage");
    expect(model).toContain("export function listCustomFonts");
    expect(model).toContain("export function saveCustomFonts");
    expect(repository).not.toContain("CUSTOM_FONT_LIBRARY_KEY");
    expect(repository).not.toContain("parseCustomFonts");
    expect(repository).not.toContain("saveCustomFonts");
  });
});
