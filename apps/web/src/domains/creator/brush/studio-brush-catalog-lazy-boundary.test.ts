import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  STUDIO_BRUSH_CATALOG_COUNTS,
  STUDIO_CORE_BRUSH_CATALOG_ITEMS,
  listStudioCoreQuickBrushCatalogItems,
} from "./studio-brush-catalog-core";

const coreSource = readFileSync(
  new URL("./studio-brush-catalog-core.ts", import.meta.url),
  "utf8"
);
const loaderSource = readFileSync(
  new URL("./studio-brush-catalog-loader.ts", import.meta.url),
  "utf8"
);
const traySource = readFileSync(new URL("./StudioBrushTray.tsx", import.meta.url), "utf8");
const summarySource = readFileSync(
  new URL("../StudioActiveBrushSummary.tsx", import.meta.url),
  "utf8"
);
const viteSource = readFileSync(new URL("../../../../../../apps/web/config/vite-manual-chunks.ts", import.meta.url), "utf8");

describe("Studio brush catalogue lazy boundary", () => {
  it("keeps launch-safe core metadata independent from pro descriptors and library filtering", () => {
    expect(coreSource).not.toContain("studio-brush-pack-index");
    expect(coreSource).not.toContain("studio-draw-ux");
    expect(coreSource).not.toContain('import("./studio-brush-catalog")');
    expect(STUDIO_CORE_BRUSH_CATALOG_ITEMS.length).toBeGreaterThanOrEqual(99);
    expect(STUDIO_CORE_BRUSH_CATALOG_ITEMS).toHaveLength(STUDIO_BRUSH_CATALOG_COUNTS.core);
    expect(STUDIO_BRUSH_CATALOG_COUNTS).toEqual({
      core: STUDIO_CORE_BRUSH_CATALOG_ITEMS.length,
      pro: 160,
      total: STUDIO_CORE_BRUSH_CATALOG_ITEMS.length + 160,
      erase: 2,
      paint: STUDIO_CORE_BRUSH_CATALOG_ITEMS.length - 2 + 160,
    });
  });

  it("keeps the quick shelf exact and useful while no pro metadata is required", () => {
    expect(
      listStudioCoreQuickBrushCatalogItems({
        favoriteIds: ["pen", "heart-stamp"],
        recentIds: ["marker"],
        limit: 3,
      }).map(({ id, quickSource }) => [id, quickSource])
    ).toEqual([
      ["pen", "favorite"],
      ["marker", "recent"],
      ["gpen", "starter"],
    ]);
  });

  it("loads the full catalogue only through a retryable dynamic import", () => {
    expect(loaderSource).toContain('import("./studio-brush-catalog")');
    expect(loaderSource).not.toContain('from "./studio-brush-catalog"');
    expect(traySource).not.toMatch(/from\s+["']\.\/studio-brush-catalog["']/u);
    expect(summarySource).not.toMatch(/from\s+["']\.\/studio-brush-catalog["']/u);
  });

  it("does not force the procedural descriptor index into the eager micro-contract chunk", () => {
    const microChunkStart = viteSource.indexOf(
      'id.endsWith("/lib/studio-raster-asset-admission.ts")'
    );
    const microChunkEnd = viteSource.indexOf('return "studio-core-micro-contracts"', microChunkStart);
    expect(microChunkStart).toBeGreaterThanOrEqual(0);
    expect(microChunkEnd).toBeGreaterThan(microChunkStart);
    expect(viteSource.slice(microChunkStart, microChunkEnd)).not.toContain(
      "studio-brush-pack-index.ts"
    );
  });
});
