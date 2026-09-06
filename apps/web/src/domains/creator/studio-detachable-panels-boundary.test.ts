import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("expanded Studio detachable surfaces", () => {
  it("lets the page and inspector docks detach without replacing mobile sheets", () => {
    const pages = source("apps/web/src/domains/creator/StudioPageListPane.tsx");
    const inspector = source("apps/web/src/domains/creator/StudioInspectorAsideShell.tsx");

    expect(pages).toContain('surfaceId="page-list"');
    expect(pages).toContain("StudioDetachablePanelSlot");
    expect(pages).toContain("STUDIO_MOBILE_PAGES_SHEET_ID");
    expect(pages).toContain("StudioPageListResizeHandle");
    expect(inspector).toContain('surfaceId="inspector"');
    expect(inspector).toContain("StudioDetachablePanelSlot");
    expect(inspector).toContain("StudioMobileSheetHandle");
  });

  it("turns the desktop brush library into a persistent comparison window", () => {
    const brush = source("apps/web/src/domains/creator/brush/StudioBrushLibrarySheet.tsx");
    expect(brush).toContain('surfaceId={`brush-catalog:${operation}`}');
    expect(brush).toContain("closeOnSelection={!desktop}");
    expect(brush).toContain("dismissOnOutsidePointer={!desktop}");
    expect(brush).toContain("StudioFloatingSurface");
    expect(brush).toContain("useStudioFloatingSurfaceLayout");
  });
});
